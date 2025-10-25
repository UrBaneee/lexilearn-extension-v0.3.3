// Track whether each targetLang has been prewarmed
const __lexiWarm = new Map();

async function ensureTranslatorWarmed() {
  // Read current target language
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

// ── Single-inject guard (DOM sentinel; visible to page⇆content) ──
const LEXI_SENTINEL = 'data-lexi-injected';
const root = document.documentElement;

if (root.hasAttribute(LEXI_SENTINEL)) {
  console.log('[Lexi] already running, skip new inject');
  // return early to avoid double initialization
  // Note: if old script is stale, refresh the page to let the new script take over
} else {
  root.setAttribute(LEXI_SENTINEL, 'alive');   // mark in DOM so page Console can see it too
  console.log('[Lexi] initializing fresh content script...');

  // ── Utils: TTS (same level as loadTxtSet / onEnter) ──
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
    speechSynthesis.cancel(); // avoid overlapping audio
        speechSynthesis.speak(utter);
      }
    } catch (e) {
      console.warn('[Lexi] TTS failed:', e);
    }
  }
  // Extract the sentence containing the word (from nearest paragraph/header/list item), split on sentence endings and pick the one containing the target word
  function extractExample(span, word) {
    const blk = span.closest('p, li, blockquote, h1, h2, h3, h4, h5, h6') || span.parentElement;
    const raw = (blk?.innerText || '').replace(/\s+/g, ' ').trim();
    if (!raw) return null;

    const W = word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); // escape
  const parts = raw.split(/(?<=[.!?])\s+/); // simple sentence split (good enough)
    let best = parts.find(s => new RegExp(`\\b${W}\\b`, 'i').test(s)) || parts[0] || '';
  best = best.slice(0, 260); // limit max length
    const html = best.replace(new RegExp(`\\b(${W})\\b`, 'gi'), '<mark class="lexi-mark-in-sent">$1</mark>');
    return { text: best, html };
  }

  // Translation cache: translate a given word/language only once
  const __lexiTransCache = new Map(); // key: "word|lang" -> translation
  let __lexiHoverSeq = 0;             // Concurrency sequence number to avoid older requests overwriting newer results

  function cleanMeaning(s) {
    if (!s) return "";
    return String(s).replace(/^Meaning\s*\(.*?\)\s*:\s*/i, "").trim();
  }

  // Append/update translation to tooltip (the green line)
  // Note: keep only the single-argument version
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

  // Read whole sentence (reuse TTS, with slightly slower rate)
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

  // Copy to clipboard (async)
  async function copyText(t) {
    try { await navigator.clipboard?.writeText(t); return true; } catch { return false; }
  }

// ↓↓↓ From here, your original initialization logic starts (wordlists, event binding, etc.) ↓↓↓
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
      // Load wordlists first, then scan
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
  
  // —— Built-in Translator cache & helpers ——
  // translator cache: one per target language
  const __lexiTranslators = new Map(); // key: "en->zh-CN" -> Translator

  async function getOrCreateTranslator(targetLanguage, { requireGesture = true } = {}) {
    if (!('Translator' in self)) return null;

  // Do not create on hover (return null when no user gesture)
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
  
  // Heuristic: detect probable proper nouns (TitleCase and not in any wordlist/common set)
  // Keep heuristic light to avoid false positives for regular words
  function isProbProperNounSurface(surface) {
    // 1) Only block TitleCase: initial uppercase followed by lowercase (e.g., "Boston").
    //    All-caps abbreviations like "USA" or "AI" are not handled here.
    if (!/^[A-Z][a-z]+(?:[-'][A-Za-z]+)*$/.test(surface)) return false;
    
    // 2) Allow very short words (length <= 2)
    if (surface.length <= 2) return false;
    
    // 3) If word appears in any wordlist/common set, it's not a proper noun
    const t = surface.toLowerCase();
    if (COMMON.has(t)) return false;
    if (WORDLISTS.cet4 && WORDLISTS.cet4.has(t)) return false;
    if (WORDLISTS.freq5k && WORDLISTS.freq5k.has(t)) return false;
    if (WORDLISTS.gre && WORDLISTS.gre.has(t)) return false;
    
    // 4) Whitelist months/days etc.
    const whitelist = new Set([
      "Monday","Tuesday","Wednesday","Thursday","Friday","Saturday","Sunday",
      "January","February","March","April","May","June","July","August","September","October","November","December"
    ]);
    if (whitelist.has(surface)) return false;
    
    return true; // If all checks pass -> treat as a proper noun
  }
  
  function shouldHighlight(w) {
    const t = w.toLowerCase();
    if (t.length < 4) return false;
    if (COMMON.has(t)) return false;

  // Apply one rule at a time; verify before adding more rules
  // ① Exclude common words
    if (WORDLISTS.freq5k && WORDLISTS.freq5k.has(t)) return false;

  // ② Your additional stopwords
    if (WORDLISTS.stopExtra && WORDLISTS.stopExtra.has(t)) return false;

    // Enabled only when not in gre-only mode; pass original surface (don't lowercase first)
    if (highlightMode !== "gre-only" && isProbProperNounSurface(w)) return false;

    // —— Mode switch ——
    if (highlightMode === "gre-only") {
      // In gre-only mode: must match the gre list; if gre list is empty, do not highlight everything
       return WORDLISTS.gre && WORDLISTS.gre.size ? WORDLISTS.gre.has(t) : false;
    }

    return true;   // For now, ignore wordlists and confirm the pipeline is working
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
  // Dynamically generate deck menu
    async function updateDeckMenu(menuEl) {
      const { vocab = [] } = await chrome.storage.local.get({ vocab: [] });
      const decks = [...new Set(vocab.map(v => v.deck || "default"))];

      menuEl.innerHTML = decks
        .map(d => `<div class="mi" data-deck="${d}" role="menuitem">📘 ${d}</div>`)
        .join('') + `<div class="mi" data-deck="new" role="menuitem">➕ New deck...</div>`;
    }
  // Safety guard: if extension context is missing, return to avoid errors
  if (typeof chrome === "undefined" || !chrome.runtime || !chrome.runtime.id) return;

    const span = e.currentTarget;
    const word = span.textContent?.trim() || "";
    const context = getContextSentence(span);

  // Render a skeleton first
  tip.innerHTML = "Loading…";
    showTipNear(span);

  // Lookup meaning (your existing pipeline)
    chrome.runtime.sendMessage(
      { type: "LOOKUP_WORD", payload: { word, context } },
      (res) => {
        if (!res || !res.ok) {
          tip.innerHTML = "No meaning available.";
          return;
        }

        const { pos, short } = res.data || {};
        const safeShort = cleanMeaning(short) || "";

  // Optional: fetch example sentence (use your existing implementation)
        const ex = extractExample(span, word); // => { html, text } | null

  // ======== Single-version tooltip header + Add dropdown ========
        tip.innerHTML = `
        <div class="lexi-head">
          <div class="lexi-word-row">
            <span class="lexi-word">${word}</span>
            <button class="lexi-btn lexi-audio" title="Pronounce">🔈</button>
            <span class="lexi-pos">${pos || ""}</span>
            <div class="lexi-spacer"></div>

            <!-- ▼ Add + dropdown menu -->
            <div id="lexi-add-wrap" class="lexi-add-wrap">
              <button class="lexi-btn" id="lexi-add" title="Add to deck">+ Add</button>
              <div id="lexi-add-menu" class="lexi-menu hidden" role="menu" aria-hidden="true">
                <div class="mi selected" data-deck="default" role="menuitem">My deck</div>
                <div class="mi" data-deck="listening" role="menuitem">Listening deck</div>
                <div class="mi" data-deck="new" role="menuitem">+ New deck…</div>
        </div>
      </div>
      <!-- ▲ Add + dropdown menu -->

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

        // ======== Event: Pronounce ========
        tip.querySelector(".lexi-audio")?.addEventListener("click", async (ev) => {
          ev.stopPropagation();
          playPronunciation(word);
        });

        // ======== Event: +Add (toggle menu) ========
        const addBtn = document.getElementById("lexi-add");
        const addMenu = document.getElementById("lexi-add-menu");
        // On +Add click: dynamically refresh deck list and toggle the menu
        addBtn.onclick = async (ev) => {
          ev.stopPropagation();
          // ✅ Call updateDeckMenu() before opening to refresh the menu contents
          await updateDeckMenu(addMenu);
          const hidden = addMenu.classList.toggle("hidden");
          addMenu.setAttribute("aria-hidden", hidden ? "true" : "false");
        };

        // On menu item click: record selected deck and send ADD_VOCAB
        addMenu.addEventListener("click", async (ev) => {
          const item = ev.target.closest(".mi");
          if (!item) return;
          ev.stopPropagation();

          let deck = item.dataset.deck || "default";

          // Highlight the currently selected item
          addMenu.querySelectorAll(".mi").forEach((el) => el.classList.remove("selected"));
          item.classList.add("selected");

          // 'new' -> prompt for a new name
          if (deck === "new") {
            const name = prompt("New deck name:");
            if (!name) return; // cancel
            deck = name.trim();
          }

          // Collapse menu
          addMenu.classList.add("hidden");
          addMenu.setAttribute("aria-hidden", "true");

          // Assemble payload the same way you currently do...
          const payload = {
            word,
            lemma: span.dataset.lemma,
            url: location.href,
            meaning: cleanMeaning(short),
            example: ex ? { text: ex.text, url: location.href } : undefined,
            deck, // ← this is the deck you just selected
          };

          chrome.runtime.sendMessage({ type: "ADD_VOCAB", payload }, async (res) => {
            tip.querySelector(".lexi-source").textContent = "Added ✓";
            setTimeout(hideTip, 800);

            // ➜ After successful add, open Side Panel
            try {
              await chrome.runtime.sendMessage({ type: "OPEN_SIDEPANEL" });
            } catch { }
          });

        // ======== Event: Example buttons ========
        if (ex) {
          tip.querySelector(".ex-say")?.addEventListener("click", (ev) => {
            ev.stopPropagation();
            speakSentence?.(ex.text); // if you have implemented speakSentence
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

  // Close
  document.getElementById("lexi-close").onclick = hideTip;

        // ======== Hover auto-translation (only used if prewarmed; won't create translator here) ========
  tip.dataset.word = word;                   // Remember which word this tooltip is for
        const mySeq = ++__lexiHoverSeq;           // increment sequence to avoid races
        chrome.storage.local.get({ targetLang: "zh-CN" }, async ({ targetLang }) => {
          // Cache hit -> render directly
          const cacheKey = `${word.toLowerCase()}|${targetLang}`;
          const cached = __lexiTransCache.get(cacheKey);
          if (cached && mySeq === __lexiHoverSeq) {
            appendTranslationToTip(cached);
            return;
          }

          try {
            // Reuse only when already prewarmed (don't create): requireGesture:false
            const tr = await getOrCreateTranslator(targetLang, { requireGesture: false });
            if (!tr) return; // Not prewarmed yet: fail silently; user click can create

            const r = await tr.translate(word);
            const t = r?.translation || "";
            if (t && mySeq === __lexiHoverSeq) {
              __lexiTransCache.set(cacheKey, t);
              appendTranslationToTip(t);
            }
          } catch (err) {
            // Fail silently: in hover scenario don't open Google Translate, just don't show translation
          }
        });

        showTipNear(span);
      });
    });
  }

  function onLeave() {
    // Keep tooltip if mouse moves into it
    // (do nothing; close via × or clicking outside)
  }
  
  function onClickWord(e) {
    if (typeof chrome === 'undefined' || !chrome.runtime || !chrome.runtime.id) return;

    const span = e.currentTarget;
    e.preventDefault(); e.stopPropagation();

    const word = span.textContent?.trim();
    if (!word) return;

  // Debug logs: can keep
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
  
  
    // Clicking outside the page closes the tooltip
    // On page click: if a highlighted word was clicked -> translate; otherwise clicking outside closes the tooltip
  document.addEventListener("click", (e) => {
    if (!tip.contains(e.target)) hideTip();
  }, true);

  // New: close tooltip with Esc key
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") hideTip();
  }, true);
  // ── Optional: periodically detect lost extension context and warn to refresh (runs every 5s)
  setInterval(() => {
    // Typical failure signs: chrome.runtime missing or no id
    if (typeof chrome === 'undefined' || !chrome.runtime || !chrome.runtime.id) {
      console.warn('[Lexi] extension context lost. Please refresh this page.');
  // You may auto-refresh (enable with caution): location.reload();
    }
  }, 5000);

}

// —— First click prewarms translator (runs once) ——
(function setupPrewarmOnce() {
  async function prewarmOnce() {
    document.removeEventListener('click', prewarmOnce, true);
    try {
      const { targetLang } = await chrome.storage.local.get({ targetLang: 'zh-CN' });
      await getOrCreateTranslator(targetLang, { requireGesture: true }); // allow creation
      console.debug('[Lexi] Translator prewarmed');
    } catch { }
  }
  document.addEventListener('click', prewarmOnce, true);
})();