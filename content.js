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
  // 缓存每种目标语言的 translator，避免重复创建/重复下载
  const __lexiTranslators = new Map();
  async function getOrCreateTranslator(targetLanguage) {
    // 特性检测：这是 Web API，存在于 window/self 上
    if (!('Translator' in self)) return null;
    
    try {
      const key = `en->${targetLanguage}`;
      if (__lexiTranslators.has(key)) return __lexiTranslators.get(key);
      
      // 需要在用户手势里调用，这里我们在 click 处理器中用它（满足要求）
      const translator = await Translator.create({
        sourceLanguage: 'en',
        targetLanguage
      });
      
      __lexiTranslators.set(key, translator);
      return translator;
    } catch (e) {
      console.warn('[Lexi] Translator.create failed:', e);
      return null;
    }
  }
  
  function openGoogleTranslateFallback(word, targetLanguage) {
    const url = `https://translate.google.com/?sl=en&tl=${encodeURIComponent(targetLanguage)}&text=${encodeURIComponent(word)}&op=translate`;
    window.open(url, "_blank");
  }
  
  function appendTranslationToTip(translation) {
    const meanDiv = tip.querySelector(".lexi-mean");
    if (!meanDiv) return;
    const existing = tip.querySelector(".lexi-mean-zh");
    if (existing) {
      existing.textContent = translation;
    } else {
      const zh = document.createElement("div");
      zh.className = "lexi-mean-zh";
      zh.style.marginTop = "6px";
      zh.style.color = "#0a7";
      zh.textContent = translation;
      meanDiv.insertAdjacentElement("afterend", zh);
    }
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

    if (highlightMode === "exclude-cet4") {
      if (WORDLISTS.cet4 && WORDLISTS.cet4.has(t)) return false;
      if (WORDLISTS.freq5k && WORDLISTS.freq5k.has(t)) return false;
      return true;
    }

    return true;   // 先不考虑任何词表，确认管道正常
  }

  /* function shouldHighlight(w) {
    const t = normalize(w);             // 全小写
    if (t.length < 3) return false;     // 太短不高亮
    if (COMMON.has(t)) return false;    // 基础停用词
    if (WORDLISTS.stopExtra && WORDLISTS.stopExtra.has(t)) return false; // 你自定义的绝不高亮词

    // 三种模式：basic / exclude-cet4 / gre-only
    if (highlightMode === "gre-only") {
      return WORDLISTS.gre ? WORDLISTS.gre.has(t) : true;
    }
    if (highlightMode === "exclude-cet4") {
      // 常见词与 CET4 统统排除
      if (WORDLISTS.cet4 && WORDLISTS.cet4.has(t)) return false;
      if (WORDLISTS.freq5k && WORDLISTS.freq5k.has(t)) return false; // 进一步排除常见5k
      return true;
    }
    // basic：只做基础停用 + 可选常见5k排除
    if (WORDLISTS.freq5k && WORDLISTS.freq5k.has(t)) return false;
    return true;
  } */

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
    if (typeof chrome === 'undefined' || !chrome.runtime || !chrome.runtime.id) return;

    const span = e.currentTarget;
    const word = span.textContent;
    const context = getContextSentence(span);

    tip.innerHTML = "Loading…";
    showTipNear(span);

    chrome.runtime.sendMessage({ type: "LOOKUP_WORD", payload: { word, context } }, (res) => {
      if (!res || !res.ok) {
        tip.innerHTML = "No meaning available.";
        return;
      }
      const { pos, short } = res.data || {};
      tip.innerHTML = `
        <div class="lexi-title">${word} <span class="lexi-pos">${pos || ""}</span></div>
        <div class="lexi-mean">${short || ""}</div>
        <div class="lexi-actions">
          <button id="lexi-add">＋ Add</button>
          <button id="lexi-close">×</button>
        </div>
      `;
      document.getElementById("lexi-add").onclick = () => {
        chrome.runtime.sendMessage({
          type: "ADD_VOCAB",
          payload: { word, lemma: span.dataset.lemma, url: location.href, meaning: short }
        }, () => {
          tip.innerHTML = `<div class="lexi-ok">Added!</div>`;
          setTimeout(hideTip, 800);
        });
      };
      document.getElementById("lexi-close").onclick = hideTip;
      showTipNear(span);
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
        const translator = await getOrCreateTranslator(tgt);
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
    tip.style.left = Math.min(r.left + window.scrollX, window.innerWidth - 240) + "px";
    tip.style.top = (r.bottom + 8) + "px";
  }

  function hideTip() {
    tip.style.display = "none";
  }
  
  /* // 点击高亮词 → 请求后台翻译
  function handleWordClick(word) {
    chrome.storage.local.get({ targetLang: "zh-CN" }, (res) => {
      const tgt = res.targetLang || "zh-CN";
      
      chrome.runtime.sendMessage(
        { type: "TRANSLATE_WORD", payload: { word, targetLang: tgt } },
        (r) => {
          const ok = r && r.ok;
          const t = ok ? (r.data?.translation || "") : "";
          if (t) {
            showTranslationInTip(word, t);
          } else {
            // 没接上内置翻译时的降级：打开 Google Translate
            const url = `https://translate.google.com/?sl=en&tl=${encodeURIComponent(tgt)}&text=${encodeURIComponent(word)}&op=translate`;
            window.open(url, "_blank");
          }      
        }
      );
    });
  } */
  
  /*  // 把翻译追加到现有 tooltip（绿色小行）
  function showTranslationInTip(word, translation) {
    if (tip.style.display === "none") return; // 没有打开 tooltip 就算了
    const meanDiv = tip.querySelector(".lexi-mean");
    if (!meanDiv) return;
    
    const existing = tip.querySelector(".lexi-mean-zh");
    if (existing) {
      existing.textContent = translation;
    } else {
      const zh = document.createElement("div");
      zh.className = "lexi-mean-zh";
      zh.style.marginTop = "6px";
      zh.style.color = "#0a7";
      zh.textContent = translation;
      meanDiv.insertAdjacentElement("afterend", zh);
    }
  } */
  
  // 点击页面空白处关闭 tooltip
  // 点击页面：若点到高亮词 → 翻译；否则点空白处关闭 tooltip
  document.addEventListener("click", (e) => {
    if (!tip.contains(e.target)) hideTip();
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

