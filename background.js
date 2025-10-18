// TODO: 用 Chrome Built-in Translator API 替换本函数
async function translateOnDevice(text, targetLang = "zh-CN") {
  // 伪代码示例（拿到官方 API 后把下面注释替换为真实调用）：
  // const res = await chrome.ai.translate({ text, src: "en", tgt: targetLang });
  // return res.translation;

  // ---- 临时降级方案：返回 null，让前端决定是否打开 Google Translate ----
  return "";
}

// Simple in-memory fallback dictionary for demo
const MINI_DICT = {
  ubiquitous: "present or found everywhere",
  serendipity: "the occurrence of events by chance in a happy way",
  meticulous: "showing great attention to detail; very careful",
  ephemeral: "lasting for a very short time",
};

// Get or set default prefs
async function getPrefs() {
  return new Promise((resolve) => {
    chrome.storage.local.get(
      { learningMode: false, highlightMode: "basic", targetLang: "zh-CN", vocab: [] },
      (res) => resolve(res)
    );
  });
}

async function setPrefs(partial) {
  return new Promise((resolve) => {
    chrome.storage.local.set(partial, () => resolve());
  });
}

// ---- Built-in AI placeholder ----
// TODO: Replace with Chrome Built-in AI Translator/Prompt APIs.
async function lookupWithBuiltInAI(word, contextSentence) {
  // 1) Try your on-device Translator API here.
  // 2) Optionally format/shorten via Prompt API.
  // For now use fallback mini dict:
  const key = word.toLowerCase();
  const meaning = MINI_DICT[key] || "Meaning (offline demo): tap + to save";
  return { pos: "?", short: meaning };
}

// Context menu: Add selected text
chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({
    id: "lexi_add",
    title: "LexiLearn: Add to vocabulary",
    contexts: ["selection"]
  });
});

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (info.menuItemId === "lexi_add" && info.selectionText) {
    const word = info.selectionText.trim();
    await addToVocab({ word, lemma: word.toLowerCase(), url: tab?.url || "" });
  }
});

// Add word to vocab
async function addToVocab({ word, lemma, url, meaning }) {
  const { vocab } = await getPrefs();
  const id = lemma + "|en";
  if (!vocab.find(v => v.id === id)) {
    vocab.push({
      id, surface: word, lemma, language: "en",
      meanings: meaning ? [{ short: meaning }] : [],
      sourceUrls: url ? [url] : [],
      createdAt: Date.now()
    });
    await setPrefs({ vocab });
    // notify side panel / content
    chrome.runtime.sendMessage({ type: "VOCAB_UPDATED" });
  }
}

// Messaging with content script
chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  (async () => {
    try {
      if (msg.type === "GET_PREFS") {
        sendResponse(await getPrefs());
      }
      if (msg.type === "SET_PREFS") {
        await setPrefs(msg.payload);
        sendResponse({ ok: true });
      }
      if (msg.type === "LOOKUP_WORD") {
        const { word, context } = msg.payload;
        const res = await lookupWithBuiltInAI(word, context);
        sendResponse({ ok: true, data: res });
      }
      if (msg.type === "ADD_VOCAB") {
        await addToVocab(msg.payload);
        sendResponse({ ok: true });
      }
      if (msg.type === "TRANSLATE_WORD") {
        const { word, targetLang } = msg.payload || {};
        const t = await translateOnDevice(word, targetLang);
        sendResponse({ ok: true, data: { translation:t || ""} });
      }
    } catch (e) {
      console.error("[LexiLearn] TRANSLATE_WORD failed:", e);
      sendResponse({ ok: false, error: String(e) });
    }
  })();
  // Keep sendResponse alive for async
  return true;
});