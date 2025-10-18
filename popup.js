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
  // content_scripts 只匹配了 *://*/*，不会注入到 chrome://、chromewebstore:// 等页面
  return /^(https?:|file:)/i.test(url);
}

// 初始化 UI
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
    // 在不支持的页面上，给出友好提示而不是抛错
    console.warn("LexiLearn: current page doesn't allow content scripts.", tab?.url);
    // 也可以把提示写进 popup（可选）
    // document.body.insertAdjacentHTML("beforeend", "<p style='color:#c00'>Open a normal webpage (http/https) and try again.</p>");
    return;
  }
  chrome.tabs.sendMessage(tab.id, { type: "PREFS_CHANGED", payload }, () => {
    // 吞掉可能的 lastError（例如刚刷新页面、脚本尚未注入）
    void chrome.runtime.lastError;
  });
}

// Learning Mode 开关
toggle.addEventListener("change", async () => {
  await chrome.storage.local.set({ learningMode: toggle.checked });
  await notifyContent({ learningMode: toggle.checked });
});

// 高亮模式下拉框
if (modeSel) {
  modeSel.addEventListener("change", async () => {
    await chrome.storage.local.set({ highlightMode: modeSel.value });
    await notifyContent({ highlightMode: modeSel.value });
  });
}

// 监听语言变化并保存&通知当前页
if (langSel) {
  langSel.addEventListener("change", async () => {
    await chrome.storage.local.set({ targetLang: langSel.value });
    await notifyContent({ targetLang: langSel.value });
  });
}

// 打开 Side Panel
openSide.addEventListener("click", async (e) => {
  e.preventDefault();
  await chrome.sidePanel.open({ windowId: (await chrome.windows.getCurrent()).id });
});