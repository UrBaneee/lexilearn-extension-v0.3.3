import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { cp, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { chromium } from 'playwright';

test('looks up, saves, reviews and exports vocabulary in Chromium', { timeout: 60_000 }, async t => {
  const folder = await mkdtemp(join(tmpdir(), 'lexilearn-browser-'));
  let browser;
  let server;
  t.after(async () => {
    await browser?.close();
    server?.close();
    await rm(folder, { recursive: true, force: true });
  });
  const root = join(folder, 'extension');
  for (const path of ['manifest.json', 'background.js', 'vocab.mjs', 'content.js', 'lookup.js',
    'highlights.css', 'sidepanel.html', 'sidepanel.js', 'popup.html', 'popup.js', 'panel.css', 'assets', 'vendor']) {
    await cp(path, join(root, path), { recursive: true });
  }
  const manifestFile = join(root, 'manifest.json');
  const manifest = JSON.parse(await readFile(manifestFile, 'utf8'));
  // Browser chrome context menus are outside Playwright's scope. Grant only the fixture origin
  // so the service worker can exercise the same injection and messages as the real menu.
  manifest.host_permissions = ['http://127.0.0.1/*'];
  await writeFile(manifestFile, JSON.stringify(manifest));

  server = createServer((_request, response) => {
    response.setHeader('content-type', 'text/html');
    response.setHeader('content-security-policy', "default-src 'none'");
    response.end('<p id="river">The bank closed early. They sat on the river <b>bank</b>.</p><p id="gre">Life is ephemeral.</p><div id="dynamic"></div>');
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const url = `http://127.0.0.1:${server.address().port}/`;

  browser = await chromium.launchPersistentContext(join(folder, 'profile'), {
    channel: 'chromium', headless: true,
    args: [`--disable-extensions-except=${root}`, `--load-extension=${root}`],
  });
  const worker = browser.serviceWorkers()[0] || await browser.waitForEvent('serviceworker');
  const extension = 'chrome-extension://' + new URL(worker.url()).host;
  const page = await browser.newPage();
  await page.goto(url);
  const tabId = await worker.evaluate(async url => (await chrome.tabs.query({})).find(tab => tab.url === url).id, url);
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  assert.equal(await page.evaluate(() => CSS.highlights.size), 0);

  // Instrument only this fixture's isolated world so Playwright can read the closed card
  // and deterministically exercise both branches without relying on a model download.
  await worker.evaluate(async tabId => {
    const target = { tabId };
    await chrome.scripting.executeScript({ target, func: () => {
      const attachShadow = Element.prototype.attachShadow;
      Element.prototype.attachShadow = function (options) {
        Element.prototype.attachShadow = attachShadow;
        return attachShadow.call(this, { ...options, mode: 'open' });
      };
      globalThis.LanguageModel = {
        availability: async () => 'available',
        create: async () => ({
          prompt: async input => {
            const { word, sentence } = JSON.parse(input);
            if (word !== 'bank' || sentence !== 'They sat on the river bank.') throw new Error('Wrong context');
            return '{"meaning":"the edge of a river"}';
          },
          destroy() {},
        }),
      };
      globalThis.Translator = {
        availability: async () => 'available',
        create: async () => ({ translate: async text => text === 'the edge of a river' ? '河岸' : '银行' }),
      };
    } });
    await chrome.scripting.insertCSS({ target, files: ['highlights.css'] });
    await chrome.scripting.executeScript({ target, files: ['lookup.js', 'content.js'] });
  }, tabId);
  const message = data => worker.evaluate(({ tabId, data }) => chrome.tabs.sendMessage(tabId, data), { tabId, data });
  await page.locator('#river b').evaluate(node => getSelection().selectAllChildren(node));
  await message({ type: 'SHOW_SELECTION', text: 'bank' });
  const card = page.getByRole('dialog', { name: 'LexiLearn lookup' });
  assert.equal(await card.locator('blockquote').textContent(), 'They sat on the river bank.');
  await card.getByRole('button', { name: 'Explain in context' }).click();
  await page.waitForFunction(() => Array.from(document.querySelectorAll('html > div'))
    .some(node => node.shadowRoot?.querySelector('input[aria-label="Meaning"]')?.value === '河岸'));
  await card.getByRole('combobox', { name: 'Deck' }).selectOption('new');
  await card.getByRole('textbox', { name: 'New deck name' }).fill('Reading');
  await card.getByRole('button', { name: 'Save', exact: true }).click();
  await card.getByText('Saved to your vocabulary.').waitFor();

  assert.deepEqual(await message({ type: 'SET_HIGHLIGHTS', enabled: true }), { ok: true, enabled: true });
  assert.equal(await page.evaluate(() => CSS.highlights.get('lexilearn-gre').size), 1);
  await page.locator('#dynamic').evaluate(node => { node.textContent = 'An ephemeral moment.'; });
  await page.waitForFunction(() => CSS.highlights.get('lexilearn-gre')?.size === 2);
  await page.locator('#gre').evaluate(node => getSelection().removeAllRanges());
  const point = await page.locator('#gre').evaluate(node => {
    const text = node.firstChild;
    const range = document.createRange();
    range.setStart(text, text.data.indexOf('ephemeral'));
    range.setEnd(text, text.data.indexOf('ephemeral') + 'ephemeral'.length);
    const rect = range.getBoundingClientRect();
    return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
  });
  await page.mouse.click(point.x, point.y);
  await card.getByRole('button', { name: 'I know this' }).click();
  await page.waitForFunction(() => CSS.highlights.get('lexilearn-gre')?.size === 0);
  assert.deepEqual(await message({ type: 'SET_HIGHLIGHTS', enabled: false }), { ok: true, enabled: false });

  const sidepanel = await browser.newPage();
  const panelErrors = [];
  sidepanel.on('pageerror', error => panelErrors.push(error.message));
  await sidepanel.goto(extension + '/sidepanel.html');
  await sidepanel.getByRole('heading', { name: 'Reading' }).waitFor();
  assert.equal(await sidepanel.getByText('河岸').textContent(), '河岸');
  assert.equal(await sidepanel.getByRole('link', { name: 'Open source' }).getAttribute('href'), url);
  await sidepanel.reload();
  await sidepanel.getByRole('button', { name: 'Review', exact: true }).click();
  await sidepanel.getByText('They sat on the river ____.').waitFor();
  assert.equal(await sidepanel.getByText('河岸').isVisible(), false);
  await sidepanel.getByRole('button', { name: 'Show answer' }).click();
  await sidepanel.getByText('河岸').waitFor();
  const download = sidepanel.waitForEvent('download');
  await sidepanel.getByRole('button', { name: 'Export Excel' }).click();
  const file = await download;
  assert.equal(file.suggestedFilename(), 'My_Vocabulary.xlsx');
  const exported = await readFile(await file.path());
  assert.equal(exported.subarray(0, 2).toString(), 'PK');
  await sidepanel.getByRole('button', { name: 'Finish review' }).click();
  await sidepanel.getByRole('button', { name: 'Remove' }).click();
  await sidepanel.getByText('Look up a word on a webpage to start your vocabulary.').waitFor();
  const writes = await sidepanel.evaluate(async () => Promise.all(['reading', 'writing'].map(word =>
    chrome.runtime.sendMessage({ type: 'ADD_VOCAB', entry: { word } }))));
  assert.equal(writes.every(result => result.ok), true);
  await sidepanel.getByText('reading', { exact: true }).waitFor();
  await sidepanel.getByText('writing', { exact: true }).waitFor();
  assert.deepEqual(errors, []);
  assert.deepEqual(panelErrors, []);
});
