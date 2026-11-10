import { addEntry, normalizeEntry } from './vocab.mjs';

let writes = Promise.resolve();
function mutateVocab(change) {
  const operation = writes.then(async () => {
    const { vocab = [] } = await chrome.storage.local.get('vocab');
    const entries = vocab.map(normalizeEntry);
    change(entries);
    await chrome.storage.local.set({ vocab: entries });
  });
  writes = operation.catch(() => {});
  return operation;
}

chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({
      id: 'lexi_lookup',
      title: 'Look up in LexiLearn',
      contexts: ['selection'],
      documentUrlPatterns: ['http://*/*', 'https://*/*'],
    });
  });
  mutateVocab(() => {}).catch(console.error);
});

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (info.menuItemId !== 'lexi_lookup' || !info.selectionText || !tab?.id) return;
  const target = { tabId: tab.id, frameIds: [info.frameId ?? 0] };
  try {
    await chrome.scripting.executeScript({ target, files: ['lookup.js', 'content.js'] });
    await chrome.tabs.sendMessage(tab.id, { type: 'SHOW_SELECTION', text: info.selectionText }, {
      frameId: info.frameId ?? 0,
    });
  } catch (error) {
    console.warn('LexiLearn could not open on this page.', error);
  }
});

async function loadGre() {
  const response = await fetch(chrome.runtime.getURL('assets/lists/gre.txt'));
  if (!response.ok) throw new Error('Could not load the GRE word list.');
  return (await response.text()).trim().toLowerCase().split(/\s+/);
}

let knownWrites = Promise.resolve();
function markKnown(word) {
  const operation = knownWrites.then(async () => {
    const { known = [] } = await chrome.storage.local.get('known');
    await chrome.storage.local.set({ known: [...new Set([...known, word.toLowerCase()])] });
  });
  knownWrites = operation.catch(() => {});
  return operation;
}

const handlers = new Map([
  ['GRE_WORDS', loadGre],
  ['ADD_VOCAB', ({ entry }) => mutateVocab(vocab => addEntry(vocab, entry))],
  ['REMOVE_VOCAB', ({ id }) => mutateVocab(vocab => {
    const index = vocab.findIndex(item => item.id === id);
    if (index !== -1) vocab.splice(index, 1);
  })],
  ['CLEAR_VOCAB', () => mutateVocab(vocab => { vocab.length = 0; })],
  ['MARK_KNOWN', ({ word }) => markKnown(word)],
]);

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  const handle = handlers.get(message?.type);
  if (!handle) return;
  Promise.resolve().then(() => handle(message)).then(
    data => sendResponse({ ok: true, data }),
    error => sendResponse({ ok: false, error: error.message }),
  );
  return true;
});
