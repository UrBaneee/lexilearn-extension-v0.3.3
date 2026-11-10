const toggle = document.querySelector('#toggle');
const language = document.querySelector('#lang');
const status = document.querySelector('#status');
let tab;
let highlighted = false;

function showToggle() {
  toggle.textContent = highlighted ? 'Turn off GRE highlights' : 'Enable GRE highlights';
}

async function init() {
  const { targetLang = 'zh' } = await chrome.storage.local.get('targetLang');
  language.value = ({ 'zh-CN': 'zh', 'zh-TW': 'zh-Hant' })[targetLang] || targetLang;
  [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!/^https?:/.test(tab?.url || '')) {
    status.textContent = 'GRE highlights are available on ordinary web pages.';
    return;
  }
  highlighted = !!(await chrome.tabs.sendMessage(tab.id, { type: 'HIGHLIGHT_STATUS' }).catch(() => false));
  showToggle();
  toggle.disabled = false;
}

language.addEventListener('change', async () => {
  try {
    await chrome.storage.local.set({ targetLang: language.value });
  } catch {
    status.textContent = 'Could not save the language setting.';
  }
});

toggle.addEventListener('click', async () => {
  toggle.disabled = true;
  status.textContent = '';
  try {
    const target = { tabId: tab.id };
    if (!highlighted) await chrome.scripting.insertCSS({ target, files: ['highlights.css'] });
    await chrome.scripting.executeScript({ target, files: ['lookup.js', 'content.js'] });
    const result = await chrome.tabs.sendMessage(tab.id, { type: 'SET_HIGHLIGHTS', enabled: !highlighted });
    if (!result?.ok) throw new Error(result?.error);
    highlighted = result.enabled;
    showToggle();
    status.textContent = highlighted ? 'Click a highlighted word to look it up.' : 'GRE highlights are off.';
  } catch {
    status.textContent = 'Could not change highlights on this page.';
  } finally {
    toggle.disabled = false;
  }
});

document.querySelector('#openSide').addEventListener('click', () => {
  if (!tab) return;
  chrome.sidePanel.open({ windowId: tab.windowId }).catch(() => {
    status.textContent = 'Could not open the vocabulary panel.';
  });
});

init().catch(() => { status.textContent = 'Could not read extension settings.'; });
