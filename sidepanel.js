// sidepanel.js — unified, schema-compatible panel (play/open/remove/export)
(async function () {
  const list = document.getElementById("list");

  // --- utils: normalize a vocab item from mixed schemas ---
  function norm(v, i) {
    const surface =
      v.word || v.surface || v.lemma || v.term || "(unknown)";
    const lemma =
      v.lemma || v.word || v.surface || "";
    const meaning =
      v.meaning ||
      v.meanings?.[0]?.short ||
      v.meanings?.[0]?.gloss ||
      v.short ||
      "";
    const url =
      v.url || v.sourceUrl || v.sourceUrls?.[0] || "";
    // stable id for remove; fall back to old id or derive one
    const id = v.id ?? `${lemma || surface}-${i}`;
    return { surface, lemma, meaning, url, id, raw: v };
  }

  // --- TTS ---
  function play(word) {
    try {
      const u = new SpeechSynthesisUtterance(word);
      u.lang = "en-US";
      u.rate = 0.95;
      const voices = speechSynthesis.getVoices();
      const pick =
        voices.find(v => v.lang.startsWith("en") && /female|samantha|victoria|allison/i.test(v.name)) ||
        voices.find(v => v.lang.startsWith("en")) ||
        voices[0];
      if (pick) u.voice = pick;
      speechSynthesis.cancel();
      speechSynthesis.speak(u);
    } catch (e) {
      console.warn("[Lexi] TTS failed:", e);
    }
  }

  // --- load/save ---
  async function load() {
    const { vocab = [] } = await chrome.storage.local.get({ vocab: [] });
    render(vocab);
  }

  async function save(vocab) {
    await chrome.storage.local.set({ vocab });
  }

  async function removeByIndex(idx) {
    const { vocab = [] } = await chrome.storage.local.get({ vocab: [] });
    if (idx >= 0 && idx < vocab.length) {
      vocab.splice(idx, 1);
      await save(vocab);
      render(vocab);
    }
  }

  async function clearAll() {
    await save([]);
    render([]);
  }

  function exportJSON(vocab) {
    const blob = new Blob([JSON.stringify(vocab, null, 2)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const a = Object.assign(document.createElement("a"), {
      href: url,
      download: "lexilearn-vocab.json",
    });
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  // --- render ---
  function render(vocab) {
    // 头部（导出/清空）
    const header = `
    <div class="sp-head">
      <h2>My Vocabulary</h2>
      <div class="sp-actions">
        <button id="sp-export">Export</button>
        <button id="sp-clear">Clear All</button>
      </div>
    </div>
  `;

    if (!vocab.length) {
      list.innerHTML =
        header +
        `<p style="color:#6b7280">No words yet. Hover a word on a page and click <b>＋ Add</b>.</p>`;
      bindHeader([], vocab);
      return;
    }

    // 统一/兼容化
    const items = vocab.slice().map(norm);

    // 每一行（含例句）
    const rows = items
      .map((v, i) => {
        const exList = (v.raw?.examples || []).slice(0, 2); // 最多显示 2 条
        const exHtml = exList
          .map(
            (e, j) => `
        <div class="ex-row" data-j="${j}">
          <span class="ex-text">${escapeHTML(e.text)}</span>
          <span class="ex-ops">
            <button class="btn ex-say"  title="Read aloud">🔊</button>
            <button class="btn ex-copy" title="Copy">📋</button>
          </span>
        </div>`
          )
          .join("");

        return `
        <div class="row" data-i="${i}">
          <div class="w">
            <div class="word">${escapeHTML(v.surface)}
              <span class="lemma">${escapeHTML(v.lemma || "")}</span>
            </div>
            <div class="meta">${escapeHTML(v.meaning || "")}</div>
            ${v.url ? `<div class="src">${escapeHTML(v.url)}</div>` : ""}
            ${exHtml ? `<div class="ex-list">${exHtml}</div>` : ""}
          </div>
          <div class="ops">
            <button class="btn play" title="Pronounce">🔊</button>
            ${v.url ? `<button class="btn open" title="Open source">↗️</button>` : ""}
            <button class="btn del" title="Remove">🗑️</button>
          </div>
        </div>`;
      })
      .join("");

    list.innerHTML = header + rows;

    // 绑定头部按钮
    bindHeader(items, vocab);

    // 原有按钮：发音 / 打开 / 删除
    list.querySelectorAll(".row .play").forEach((b) => {
      b.onclick = (e) => {
        const i = +e.currentTarget.closest(".row").dataset.i;
        const item = items[i];
        play(item.surface || item.lemma);
      };
    });

    list.querySelectorAll(".row .open").forEach((b) => {
      b.onclick = (e) => {
        const i = +e.currentTarget.closest(".row").dataset.i;
        const item = items[i];
        if (item.url) chrome.tabs.create({ url: item.url });
      };
    });

    list.querySelectorAll(".row .del").forEach((b) => {
      b.onclick = async (e) => {
        const i = +e.currentTarget.closest(".row").dataset.i;
        await removeByIndex(i);
      };
    });

    // ✅ 新增：例句 朗读/复制
    list.querySelectorAll(".row .ex-say").forEach((b) => {
      b.onclick = (e) => {
        const row = e.currentTarget.closest(".row");
        const i = +row.dataset.i;
        const j = +e.currentTarget.closest(".ex-row").dataset.j;
        const ex = (items[i].raw?.examples || [])[j];
        if (ex?.text) play(ex.text);
      };
    });

    list.querySelectorAll(".row .ex-copy").forEach((b) => {
      b.onclick = async (e) => {
        const row = e.currentTarget.closest(".row");
        const i = +row.dataset.i;
        const j = +e.currentTarget.closest(".ex-row").dataset.j;
        const ex = (items[i].raw?.examples || [])[j];
        if (ex?.text) {
          try {
            await navigator.clipboard.writeText(ex.text);
            b.textContent = "✓";
            setTimeout(() => (b.textContent = "📋"), 900);
          } catch { }
        }
      };
    });
  }

  function bindHeader(items, rawVocab) {
    document.getElementById("sp-export")?.addEventListener("click", async () => {
      const { vocab = [] } = await chrome.storage.local.get({ vocab: [] });
      exportJSON(vocab);
    });
    document.getElementById("sp-clear")?.addEventListener("click", async () => {
      if (confirm("Clear all saved words?")) await clearAll();
    });

    // inject minimal styles (if you don't already style in sidepanel.html)
    ensureStyles();
  }

  function ensureStyles() {
    if (document.getElementById("sp-style")) return;
    const style = document.createElement("style");
    style.id = "sp-style";
    style.textContent = `
      .sp-head{display:flex;align-items:center;justify-content:space-between;margin-bottom:8px}
      .sp-head h2{margin:0;font:600 16px/1.2 system-ui,Inter,ui-sans-serif}
      .sp-actions{display:flex;gap:8px}
      .sp-actions button{border:1px solid #e5e7eb;background:#fff;padding:6px 10px;border-radius:8px;cursor:pointer}
      .row{display:flex;align-items:center;gap:8px;justify-content:space-between;border-bottom:1px solid #e5e7eb;padding:8px 0}
      .w{min-width:0}
      .word{font-weight:700}
      .lemma{color:#6b7280;font-weight:400;margin-left:6px;font-size:12px}
      .meta{color:#6b7280;font-size:12px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:52vw}
      .src{color:#9ca3af;font-size:12px;word-break:break-all}
      .ops{display:flex;gap:6px}
      .btn{border:1px solid #e5e7eb;background:#f9fafb;padding:4px 8px;border-radius:8px;cursor:pointer}
      .btn:hover{background:#eef2ff;border-color:#c7d2fe}
    `; 
    style.textContent += `
      .ex-list{margin-top:6px;display:flex;flex-direction:column;gap:6px}
      .ex-row{display:flex;align-items:center;justify-content:space-between;gap:8px}
      .ex-text{font-size:12px;color:#374151;flex:1}
      .ex-ops .btn{padding:2px 6px}
    `;

    document.head.appendChild(style);
  }

  function escapeHTML(s) {
    return String(s || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");
  }

  // live refresh on storage changes
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === "local" && changes.vocab) {
      const vocab = changes.vocab.newValue || [];
      render(vocab);
    }
  });

  // init
  await load();
})();