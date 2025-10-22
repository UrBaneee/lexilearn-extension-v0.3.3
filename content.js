// 记录每种 targetLang 是否已预热
const __lexiWarm = new Map();

async function ensureTranslatorWarmed() {
  // 读取当前目标语言
  const { targetLang = 'zh-CN' } = await new Promise(r => chrome.storage.local.get({ targetLang: 'zh-CN' }, r));
  if (__lexiWarm.get(targetLang)) return true;

  try {
    const tr = await getOrCreateTranslator(targetLang, { requireGesture: true });
    if (tr) {
      __lexiWarm.set(targetLang, true);
      return true;
    }
  } catch { }
  return false;
}

// ── Single-inject guard (DOM sentinel; page⇆content 可见) ──
const LEXI_SENTINEL = 'data-lexi-injected';
const root = document.documentElement;

if (root.hasAttribute(LEXI_SENTINEL)) {
  console.log('[Lexi] already running, skip new inject');
  // 直接 return，避免重复初始化
  // 注意：旧脚本失效时，请务必刷新页面让新脚本接管
} else {
  root.setAttribute(LEXI_SENTINEL, 'alive');   // 用 DOM 标记，页面 Console 也能看到
  console.log('[Lexi] initializing fresh content script...');

  // ── Utils: TTS（与 loadTxtSet / onEnter 平级） ──
  function playPronunciation(word, lang = 'en-US') {
    try {
      const utter = new SpeechSynthesisUtterance(word);
      utter.lang = lang;
      utter.rate = 0.95;
      const pick = (voices) =>
        voices.find(v => v.lang.startsWith('en') && /female|samantha|victoria|allison/i.test(v.name))
        || voices.find(v => v.lang.startsWith('en'));
      const voices = speechSynthesis.getVoices();
      const v = pick(voices);
      if (v) utter.voice = v;
      if (!voices.length) {
        const once = () => {
          const v2 = pick(speechSynthesis.getVoices());
          if (v2) utter.voice = v2;
          speechSynthesis.speak(utter);
          speechSynthesis.removeEventListener('voiceschanged', once);
        };
        speechSynthesis.addEventListener('voiceschanged', once);
      } else {
        speechSynthesis.cancel(); // 避免叠音
        speechSynthesis.speak(utter);
      }
    } catch (e) {
      console.warn('[Lexi] TTS failed:', e);
    }
  }
  // 提取所在句子（从最近段落/标题/列表项里找，按句号切分，选包含目标词的那句）
  function extractExample(span, word) {
    const blk = span.closest('p, li, blockquote, h1, h2, h3, h4, h5, h6') || span.parentElement;
    const raw = (blk?.innerText || '').replace(/\s+/g, ' ').trim();
    if (!raw) return null;

    const W = word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); // escape
    const parts = raw.split(/(?<=[.!?])\s+/); // 句子切分（简单够用）
    let best = parts.find(s => new RegExp(`\\b${W}\\b`, 'i').test(s)) || parts[0] || '';
    best = best.slice(0, 260); // 控最大长度
    const html = best.replace(new RegExp(`\\b(${W})\\b`, 'gi'), '<mark class="lexi-mark-in-sent">$1</mark>');
    return { text: best, html };
  }

  // 译文缓存：同一个词/语言只翻译一次
  const __lexiTransCache = new Map(); // key: "word|lang" -> translation
  let __lexiHoverSeq = 0;             // 并发序号，防止旧请求覆盖新结果

  function cleanMeaning(s) {
    if (!s) return "";
    return String(s).replace(/^Meaning\s*\(.*?\)\s*:\s*/i, "").trim();
  }

  // 把翻译追加/更新到 tooltip（绿色一行）
  // 统一：只保留单参版本
  function appendTranslationToTip(translation) {
    if (tip.style.display === "none") return;
    const meanDiv = tip.querySelector(".lexi-mean");
    if (!meanDiv) return;

    const ex = tip.querySelector(".lexi-mean-zh");
    if (ex) {
      ex.textContent = translation || "";
    } else {
      const zh = document.createElement("div");
      zh.className = "lexi-mean-zh";
      zh.style.marginTop = "6px";
      zh.style.color = "#0a7";
      zh.textContent = translation || "";
      meanDiv.insertAdjacentElement("afterend", zh);
    }
  }

  // 朗读整句（沿用你的 TTS，给句子一个更慢的速率）
  function speakSentence(text, lang = 'en-US') {
    try {
      const u = new SpeechSynthesisUtterance(text);
      u.lang = lang; u.rate = 0.92;
      const voices = speechSynthesis.getVoices();
      const pick = voices.find(v => v.lang.startsWith('en') && /female|samantha|victoria|allison/i.test(v.name))
        || voices.find(v => v.lang.startsWith('en'));
      if (pick) u.voice = pick;
      speechSynthesis.cancel();
      speechSynthesis.speak(u);
    } catch (e) { console.warn('[Lexi] speakSentence failed:', e); }
  }

  // 复制到剪贴板（异步）
  async function copyText(t) {
    try { await navigator.clipboard?.writeText(t); return true; } catch { return false; }
  }

// ↓↓↓ 从这里开始写你原来的初始化逻辑（词表、事件绑定等）↓↓↓
  // ===== Wordlist loader =====
  let WORDLISTS = {
    cet4: null,
    gre: null,
    stopExtra: null,
    freq5k: null
  };
  let highlightMode = "basic"; // default

  async function loadTxtSet(path) {
    const url = chrome.runtime.getURL(path);
    const txt = await fetch(url).then(r => r.text());
    const set = new Set();
    txt.split(/\r?\n/).forEach(line => {
      const w = line.trim().toLowerCase();
      if (w) set.add(w);
    });
    return set;
  }
  
  async function ensureWordlistsLoaded() {
    const jobs = [];
    if (!WORDLISTS.cet4) jobs.push(loadTxtSet("assets/lists/cet4.txt").then(s => WORDLISTS.cet4 = s).catch(()=>WORDLISTS.cet4=new Set()));
    if (!WORDLISTS.gre) jobs.push(loadTxtSet("assets/lists/gre.txt").then(s => WORDLISTS.gre = s).catch(()=>WORDLISTS.gre=new Set()));
    if (!WORDLISTS.stopExtra) jobs.push(loadTxtSet("assets/lists/stopwords_extra.txt").then(s => WORDLISTS.stopExtra = s).catch(()=>WORDLISTS.stopExtra=new Set()));
    if (!WORDLISTS.freq5k) jobs.push(loadTxtSet("assets/lists/freq_top5000.txt").then(s => WORDLISTS.freq5k = s).catch(()=>WORDLISTS.freq5k=new Set()));
    await Promise.all(jobs);
  }

  window.__lexiInjected = true;

  const COMMON = new Set([
    "the","be","to","of","and","a","in","that","have","i","it","for","not",
    "on","with","he","as","you","do","at","this","but","his","by","from"
  ]);

  let learningMode = false;

  // Tooltip element
  const tip = document.createElement("div");
  tip.id = "lexi-tooltip";
  tip.style.display = "none";
  document.documentElement.appendChild(tip);

  // Observe prefs
  chrome.runtime.sendMessage({ type: "GET_PREFS" }, async (res) => {
    learningMode = !!res.learningMode;
    highlightMode = res.highlightMode || "basic";
    // 先加载词表，再扫描
    await ensureWordlistsLoaded();
    if (learningMode) scanAndMark();
  });

  // Listen pref changes from popup
  chrome.runtime.onMessage.addListener((msg) => {
    if (msg.type === "PREFS_CHANGED") {
      if (msg.payload.hasOwnProperty("learningMode")) {
        learningMode = !!msg.payload.learningMode;
      }
      if (msg.payload.highlightMode) {
        highlightMode = msg.payload.highlightMode;
      }
      clearMarks();
      (async () => {
        await ensureWordlistsLoaded();
        if (learningMode) scanAndMark();
      })();
    }
  });
  
  // —— Built-in Translator 缓存 & 工具 ——
  // translator 缓存：每种目标语言一个
  const __lexiTranslators = new Map(); // key: "en->zh-CN" -> Translator

  async function getOrCreateTranslator(targetLanguage, { requireGesture = true } = {}) {
    if (!('Translator' in self)) return null;

    // 悬停不允许创建（没有用户手势时直接返回 null）
    if (requireGesture && !navigator.userActivation?.isActive) return null;

    const key = `en->${targetLanguage}`;
    const cached = __lexiTranslators.get(key);
    if (cached) return cached;

    try {
      const tr = await Translator.create({ sourceLanguage: 'en', targetLanguage });
      __lexiTranslators.set(key, tr);
      return tr;
    } catch (e) {
      console.warn('[Lexi] Translator.create failed:', e);
      return null;
    }
  }
  
  function openGoogleTranslateFallback(word, targetLanguage) {
    const url = `https://translate.google.com/?sl=en&tl=${encodeURIComponent(targetLanguage)}&text=${encodeURIComponent(word)}&op=translate`;
    window.open(url, "_blank");
  }

  // Scan and mark words
  function scanAndMark() {
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    const toWrap = [];
    while (walker.nextNode()) {
      const node = walker.currentNode;
      if (!node.nodeValue) continue;
      if (!isVisible(node.parentElement)) continue;
      if (isInIgnoredNode(node.parentElement)) continue;

      const parts = tokenize(node.nodeValue);
      if (!parts.some(p => p.type === "word")) continue;

      // Build a new fragment with <span> wraps
      const frag = document.createDocumentFragment();
      parts.forEach(p => {
        if (p.type === "word" && shouldHighlight(p.text)) {
          const span = document.createElement("span");
          span.className = "lexi-mark";
          span.textContent = p.text;
          span.dataset.lemma = normalize(p.text);
          span.addEventListener("mouseenter", onEnter);
          span.addEventListener("mouseleave", onLeave);
          span.addEventListener("click", onClickWord);
          frag.appendChild(span);
        } else {
          frag.appendChild(document.createTextNode(p.text));
        }
      });
      toWrap.push([node, frag]);
    }
    // Replace nodes in batch
    for (const [node, frag] of toWrap) node.parentNode.replaceChild(frag, node);
  }

  function clearMarks() {
    document.querySelectorAll("span.lexi-mark").forEach((el) => {
      const text = document.createTextNode(el.textContent);
      el.replaceWith(text);
    });
    hideTip();
  }

  function tokenize(text) {
    // Split into words and separators
    const parts = [];
    const re = /\b[A-Za-z][A-Za-z\-’']+\b/g;
    let last = 0, m;
    while ((m = re.exec(text)) !== null) {
      if (m.index > last) parts.push({ type: "sep", text: text.slice(last, m.index) });
      parts.push({ type: "word", text: m[0] });
      last = re.lastIndex;
    }
    if (last < text.length) parts.push({ type: "sep", text: text.slice(last) });
    return parts;
  }

  function normalize(w) {
    return w.toLowerCase();
  }
  
  // 判断是否“疑似专有名词”（TitleCase 且不在任何词表/常见集）
  // 只做轻量启发式，尽量不误伤普通单词
  function isProbProperNounSurface(surface) {
    // 1) 只拦 TitleCase：首字母大写+后续小写（"Boston"），
    //    全大写缩写（"USA", "AI"）不在这里处理，交给其它规则
    if (!/^[A-Z][a-z]+(?:[-'][A-Za-z]+)*$/.test(surface)) return false;
    
    // 2) 不拦很短的（如 "It", "We"），长度<=2 放过
    if (surface.length <= 2) return false;
    
    // 3) 如果出现在任何词表/常见列表，则不是专有名词
    const t = surface.toLowerCase();
    if (COMMON.has(t)) return false;
    if (WORDLISTS.cet4 && WORDLISTS.cet4.has(t)) return false;
    if (WORDLISTS.freq5k && WORDLISTS.freq5k.has(t)) return false;
    if (WORDLISTS.gre && WORDLISTS.gre.has(t)) return false;
    
    // 4) 白名单（月份/星期等常见首字母大写词）
    const whitelist = new Set([
      "Monday","Tuesday","Wednesday","Thursday","Friday","Saturday","Sunday",
      "January","February","March","April","May","June","July","August","September","October","November","December"
    ]);
    if (whitelist.has(surface)) return false;
    
    return true; // 满足上述条件 → 认为是专有名词
  }
  
  function shouldHighlight(w) {
    const t = w.toLowerCase();
    if (t.length < 4) return false;
    if (COMMON.has(t)) return false;

    // 一次只加一条，测试通过再加下一条
    // ① 排除常见词
    if (WORDLISTS.freq5k && WORDLISTS.freq5k.has(t)) return false;

    // ② 你的额外停用词
    if (WORDLISTS.stopExtra && WORDLISTS.stopExtra.has(t)) return false;

    // 仅在非 GRE-only 模式下启用；并且要传入“原始 surface”，不能先 toLowerCase
    if (highlightMode !== "gre-only" && isProbProperNounSurface(w)) return false;

    // —— 模式开关 ——
    if (highlightMode === "gre-only") {
      // gre-only 时：gre 列表必须命中；若 gre 列表为空，也不要“全亮”
       return WORDLISTS.gre && WORDLISTS.gre.size ? WORDLISTS.gre.has(t) : false;
    }

    return true;   // 先不考虑任何词表，确认管道正常
  }

  function isVisible(el) {
    if (!el) return false;
    const style = window.getComputedStyle(el);
    if (style.display === "none" || style.visibility === "hidden") return false;
    const rect = el.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
  }

  function isInIgnoredNode(el) {
    const bad = new Set(["SCRIPT","STYLE","NOSCRIPT","CODE","PRE","TEXTAREA","INPUT","IMG","VIDEO","AUDIO"]);
    while (el) {
      if (bad.has(el.tagName)) return true;
      el = el.parentElement;
    }
    return false;
  }

  function getContextSentence(span) {
    // Pick the parent paragraph text as context
    const p = span.closest("p") || span.parentElement;
    return p ? p.innerText.slice(0, 200) : "";
  }

  function onEnter(e) {
    // —— 安全保护：扩展上下文失效直接返回（避免报错）——
    if (typeof chrome === "undefined" || !chrome.runtime || !chrome.runtime.id) return;

    const span = e.currentTarget;
    const word = span.textContent?.trim() || "";
    const context = getContextSentence(span);

    // 先画一个“骨架”
    tip.innerHTML = "Loading…";
    showTipNear(span);

    // 查义（你原来的管道）
    chrome.runtime.sendMessage(
      { type: "LOOKUP_WORD", payload: { word, context } },
      (res) => {
        if (!res || !res.ok) {
          tip.innerHTML = "No meaning available.";
          return;
        }

        const { pos, short } = res.data || {};
        const safeShort = cleanMeaning(short) || "";

        // 可选：抓例句（你已有的实现）
        const ex = extractExample(span, word); // => { html, text } | null

        // ======== 单一版本的 tooltip 头部 + Add 下拉菜单 ========
        tip.innerHTML = `
        <div class="lexi-head">
          <div class="lexi-word-row">
            <span class="lexi-word">${word}</span>
            <button class="lexi-btn lexi-audio" title="Pronounce">🔈</button>
            <span class="lexi-pos">${pos || ""}</span>
            <div class="lexi-spacer"></div>

            <!-- ▼ Add + 下拉菜单 -->
            <div id="lexi-add-wrap" class="lexi-add-wrap">
              <button class="lexi-btn" id="lexi-add" title="Add to deck">+ Add</button>
              <div id="lexi-add-menu" class="lexi-menu hidden" role="menu" aria-hidden="true">
                <div class="mi selected" data-deck="default" role="menuitem">My deck</div>
                <div class="mi" data-deck="listening" role="menuitem">Listening deck</div>
                <div class="mi" data-deck="new" role="menuitem">+ New deck…</div>
              </div>
            </div>
            <!-- ▲ Add + 下拉菜单 -->

            <button class="lexi-btn" id="lexi-close" title="Close">✕</button>
          </div>
        </div>

        <div class="lexi-mean">${safeShort}</div>

        ${ex
            ? `
        <div class="lexi-ex">
          <div class="ex-label">Example</div>
          <div class="ex-text">${ex.html}</div>
          <div class="ex-ops">
            <button class="lexi-btn ex-say" title="Read aloud">🔉</button>
            <button class="lexi-btn ex-copy" title="Copy sentence">📋</button>
          </div>
        </div>`
            : ""
          }

        <div class="lexi-source">via Chrome built-in AI</div>
      `;

        // ======== 事件：发音 ========
        tip.querySelector(".lexi-audio")?.addEventListener("click", async (ev) => {
          ev.stopPropagation();
          playPronunciation(word);
        });

        // ======== 事件：+Add（展开/收起菜单） ========
        const addBtn = document.getElementById("lexi-add");
        const addMenu = document.getElementById("lexi-add-menu");
        addBtn.onclick = (ev) => {
          ev.stopPropagation();
          const hidden = addMenu.classList.toggle("hidden");
          addMenu.setAttribute("aria-hidden", hidden ? "true" : "false");
        };

        // 点击菜单项：记录 deck，立即发送 ADD_VOCAB
        addMenu.addEventListener("click", async (ev) => {
          const item = ev.target.closest(".mi");
          if (!item) return;
          ev.stopPropagation();

          let deck = item.dataset.deck || "default";

          // 高亮当前选中项
          addMenu.querySelectorAll(".mi").forEach((el) => el.classList.remove("selected"));
          item.classList.add("selected");

          // “new” -> 询问新名字
          if (deck === "new") {
            const name = prompt("New deck name:");
            if (!name) return; // 放弃
            deck = name.trim();
          }

          // 收起菜单
          addMenu.classList.add("hidden");
          addMenu.setAttribute("aria-hidden", "true");

          // 组装 payload 同你现在的一样……
          const payload = {
            word,
            lemma: span.dataset.lemma,
            url: location.href,
            meaning: cleanMeaning(short),
            example: ex ? { text: ex.text, url: location.href } : undefined,
            deck, // ← 这是你刚选中的 deck
          };

          chrome.runtime.sendMessage({ type: "ADD_VOCAB", payload }, async (res) => {
            tip.querySelector(".lexi-source").textContent = "Added ✓";
            setTimeout(hideTip, 800);

            // ➜ 添加成功后，打开 Side Panel
            try {
              await chrome.runtime.sendMessage({ type: "OPEN_SIDEPANEL" });
            } catch { }
          });

        // ======== 事件：Example 按钮 ========
        if (ex) {
          tip.querySelector(".ex-say")?.addEventListener("click", (ev) => {
            ev.stopPropagation();
            speakSentence?.(ex.text); // 若你已实现 speakSentence
          });

          tip.querySelector(".ex-copy")?.addEventListener("click", async (ev) => {
            ev.stopPropagation();
            try {
              await navigator.clipboard.writeText(ex.text);
              const btn = ev.currentTarget;
              const old = btn.textContent;
              btn.textContent = "✓ Copied";
              setTimeout(() => (btn.textContent = old), 1000);
            } catch { }
          });
        }

        // 关闭
        document.getElementById("lexi-close").onclick = hideTip;

        // ======== Hover 自动翻译（已预热才使用；不会在这里强制创建） ========
        tip.dataset.word = word;                   // 给本次 tooltip 记住是什么词
        const mySeq = ++__lexiHoverSeq;           // 递增序号，避免竞态
        chrome.storage.local.get({ targetLang: "zh-CN" }, async ({ targetLang }) => {
          // 命中缓存 → 直接渲染
          const cacheKey = `${word.toLowerCase()}|${targetLang}`;
          const cached = __lexiTransCache.get(cacheKey);
          if (cached && mySeq === __lexiHoverSeq) {
            appendTranslationToTip(cached);
            return;
          }

          try {
            // 只在已预热的情况下复用（不创建）：requireGesture:false
            const tr = await getOrCreateTranslator(targetLang, { requireGesture: false });
            if (!tr) return; // 还没预热：静默；用户点击后再创建

            const r = await tr.translate(word);
            const t = r?.translation || "";
            if (t && mySeq === __lexiHoverSeq) {
              __lexiTransCache.set(cacheKey, t);
              appendTranslationToTip(t);
            }
          } catch (err) {
            // 静默：hover 场景失败不弹 GTranslate，只是不展示翻译
          }
        });

        showTipNear(span);
      });
    });
  }

  function onLeave() {
    // Keep tooltip if mouse moves into it
    // (do nothing; close via × 或点击空白区域)
  }
  
  function onClickWord(e) {
    if (typeof chrome === 'undefined' || !chrome.runtime || !chrome.runtime.id) return;

    const span = e.currentTarget;
    e.preventDefault(); e.stopPropagation();

    const word = span.textContent?.trim();
    if (!word) return;

    // 调试日志：可保留
    console.log('[Lexi] click word:', word);
    console.log('[Lexi] Translator in self?', 'Translator' in self);
    console.log('[Lexi] top frame?', window === window.top);
    console.log('[Lexi] userActivation?', navigator.userActivation?.isActive);

    if (tip.style.display === "none") {
      try { onEnter({ currentTarget: span }); } catch { }
    }

    chrome.storage.local.get({ targetLang: "zh-CN" }, async (res) => {
      const tgt = res.targetLang || "zh-CN";

      let timedOut = false;
      const timer = setTimeout(() => {
        timedOut = true;
        console.warn('[Lexi] fallback -> Google Translate (timeout)');
        openGoogleTranslateFallback(word, tgt);
      }, 600);

      try {
        console.log('[Lexi] creating/using translator for', tgt);
        const translator = await getOrCreateTranslator(tgt, { requireGesture: true });
        if (!translator) {
          clearTimeout(timer);
          if (!timedOut) {
            console.warn('[Lexi] no translator instance -> fallback');
            openGoogleTranslateFallback(word, tgt);
          }
          return;
        }

        console.log('[Lexi] calling translate()...');
        const result = await translator.translate(word);
        clearTimeout(timer);
        if (timedOut) return;

        const translation = result?.translation || result || "";
        console.log('[Lexi] translate() result:', result);

        if (!translation) {
          console.warn('[Lexi] empty translation -> fallback');
          openGoogleTranslateFallback(word, tgt);
          return;
        }
        appendTranslationToTip(translation);
      } catch (err) {
        clearTimeout(timer);
        console.error('[Lexi] Translator error:', {
          name: err?.name, message: err?.message, stack: err?.stack
        });
        if (!timedOut) openGoogleTranslateFallback(word, tgt);
      }
    });
  }

  function showTipNear(el) {
    const r = el.getBoundingClientRect();
    tip.style.display = "block";
    tip.style.position = "fixed";
    tip.style.left = Math.min(r.left, window.innerWidth - 240) + "px";
    tip.style.top = (r.bottom + 8) + "px";
  }

  function hideTip() {
    tip.style.display = "none";
  }
  
  
  // 点击页面空白处关闭 tooltip
  // 点击页面：若点到高亮词 → 翻译；否则点空白处关闭 tooltip
  document.addEventListener("click", (e) => {
    if (!tip.contains(e.target)) hideTip();
  }, true);

  // 新增：按 Esc 关闭 tooltip
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") hideTip();
  }, true);
  // ── 可选：自动检测扩展上下文失效并提示刷新（5s一次）
  setInterval(() => {
    // 失效典型表现：chrome.runtime 不存在 或 没有 id
    if (typeof chrome === 'undefined' || !chrome.runtime || !chrome.runtime.id) {
      console.warn('[Lexi] extension context lost. Please refresh this page.');
      // 你也可以自动刷新（谨慎开启）：location.reload();
    }
  }, 5000);
};

// —— 首次任意点击即预热 translator（只执行一次）——
(function setupPrewarmOnce() {
  async function prewarmOnce() {
    document.removeEventListener('click', prewarmOnce, true);
    try {
      const { targetLang } = await chrome.storage.local.get({ targetLang: 'zh-CN' });
      await getOrCreateTranslator(targetLang, { requireGesture: true }); // 允许创建
      console.debug('[Lexi] Translator prewarmed');
    } catch { }
  }
  document.addEventListener('click', prewarmOnce, true);
})();