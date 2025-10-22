// 实际保存：支持 deck / example / meanings 等
async function addToVocab(payload) {
  const {
    word,
    lemma,
    url,
    meaning,              // string（简释）
    example,              // { text, url } | undefined
    deck = 'default',     // 新增：词本/分组，默认 default
  } = payload || {};

  const { vocab = [] } = await chrome.storage.local.get({ vocab: [] });

  const key = (lemma || word || '').toLowerCase();
  let idx = vocab.findIndex(x => (x.lemma || x.word || '').toLowerCase() === key);

  if (idx >= 0) {
    // 合并已有词条
    const cur = vocab[idx];
    if (meaning) {
      // 兼容旧结构：转成数组结构
      if (!Array.isArray(cur.meanings)) cur.meanings = [];
      // 简单策略：如果没有“短义”就追加一条
      if (!cur.meanings.some(m => m.short === meaning)) {
        cur.meanings.push({ short: meaning });
      }
    }
    if (url) cur.url = url;
    if (deck && !cur.deck) cur.deck = deck;

    if (example?.text) {
      cur.examples = cur.examples || [];
      if (!cur.examples.some(e => e.text === example.text)) {
        cur.examples.push(example);
      }
    }
    vocab[idx] = cur;
  } else {
    // 新词条
    const item = {
      id: crypto.randomUUID?.() || Date.now().toString(36),
      surface: word,
      lemma,
      url,
      meanings: meaning ? [{ short: meaning }] : [],
      examples: example ? [example] : [],
      deck,
      createdAt: Date.now(),
    };
    vocab.push(item);
  }

  await chrome.storage.local.set({ vocab });
  // 🔔 新增：通知前端/侧栏刷新
  try { chrome.runtime.sendMessage({ type: "VOCAB_UPDATED" }); } catch { }
}


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
  const key = word.toLowerCase();
  // 想要的英文提示（随便选一个/改成你喜欢的）
  const fallback = "Click the highlight word to translate";
  const meaning = MINI_DICT[key] || fallback;
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
        await addToVocab(msg.payload);   // 这里会处理 deck、example 等逻辑
        sendResponse({ ok: true });
        return; // 别忘了 return，否则会继续往下走
      }

      if (msg.type === "OPEN_SIDEPANEL") {
        try {
          const tabId = sender?.tab?.id;
          // 确保为当前 tab 启用 side panel，并指定路径
          await chrome.sidePanel.setOptions({
            tabId,
            path: "sidepanel.html",
            enabled: true,
          });
          // 打开
          await chrome.sidePanel.open({ tabId });
          sendResponse({ ok: true });
        } catch (e) {
          sendResponse({ ok: false, error: String(e) });
        }
        return;
      }

      if (msg.type === "ADD_EXAMPLE") {
        const p = msg.payload || {};
        const { vocab = [] } = await chrome.storage.local.get({ vocab: [] });
        const key = (p.lemma || p.word || '').toLowerCase();
        const idx = vocab.findIndex(x => (x.lemma || x.word || '').toLowerCase() === key);
        if (idx >= 0 && p.example?.text) {
          vocab[idx].examples = vocab[idx].examples || [];
          if (!vocab[idx].examples.some(e => e.text === p.example.text)) {
            vocab[idx].examples.push(p.example);
          }
          await chrome.storage.local.set({ vocab });
          sendResponse({ ok: true });
        } else {
          sendResponse({ ok: false });
        }
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