// popup.js — robust version
const toggle   = document.getElementById("toggle");
const openSide = document.getElementById("openSide");
const modeSel  = document.getElementById("mode");
const langSel = document.getElementById("lang");

function getActiveTab() {
  return new Promise((resolve) => {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      resolve(tabs && tabs[0] ? tabs[0] : null);
    });
  });
}

function isSupportedUrl(url = "") {
  // content_scripts only match *://*/* and won't inject into chrome://, chromewebstore://, etc.
  return /^(https?:|file:)/i.test(url);
}

// Initialize UI
chrome.storage.local.get({ learningMode: false, highlightMode: "basic" }, (res) => {
  if (toggle)  toggle.checked = !!res.learningMode;
  if (modeSel) modeSel.value  = res.highlightMode || "basic";
});

chrome.storage.local.get({ targetLang: "zh-CN" }, (res) => {
  if (langSel) langSel.value = res.targetLang;
});

async function notifyContent(payload) {
  const tab = await getActiveTab();
  if (!tab || !isSupportedUrl(tab.url)) {
    // On unsupported pages, show a friendly warning instead of throwing an error
    console.warn("LexiLearn: current page doesn't allow content scripts.", tab?.url);
    // Optionally you could display this message in the popup
    // document.body.insertAdjacentHTML("beforeend", "<p style='color:#c00'>Open a normal webpage (http/https) and try again.</p>");
    return;
  }
  chrome.tabs.sendMessage(tab.id, { type: "PREFS_CHANGED", payload }, () => {
    // swallow possible lastError (e.g. page just refreshed and script not injected yet)
    void chrome.runtime.lastError;
  });
}

// Learning Mode toggle
toggle.addEventListener("change", async () => {
  await chrome.storage.local.set({ learningMode: toggle.checked });
  await notifyContent({ learningMode: toggle.checked });
});

// Highlight mode dropdown
if (modeSel) {
  modeSel.addEventListener("change", async () => {
    await chrome.storage.local.set({ highlightMode: modeSel.value });
    await notifyContent({ highlightMode: modeSel.value });
  });
}

// Listen for language changes, save & notify the current page
if (langSel) {
  langSel.addEventListener("change", async () => {
    await chrome.storage.local.set({ targetLang: langSel.value });
    await notifyContent({ targetLang: langSel.value });
  });
}

// Open Side Panel
openSide.addEventListener("click", async (e) => {
  e.preventDefault();
  await chrome.sidePanel.open({ windowId: (await chrome.windows.getCurrent()).id });
});