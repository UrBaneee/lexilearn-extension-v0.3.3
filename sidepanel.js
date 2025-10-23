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
  // 清洗旧版占位前缀 "Meaning (offline demo): ..."
  function cleanMeaning(s) {
    if (!s) return "";
    return String(s).replace(/^Meaning\s*\(.*?\)\s*:\s*/i, "").trim();
  }

  // 用这段完整替换你当前的 function render(vocab) { … }
  function render(vocab) {
    ensureStyles();
    const el = document.getElementById('list');

    // 头部（沿用你之前的导出/清空按钮）
    const header = `
      <div class="sp-head">
        <div class="sp-title">
          <h2>My Vocabulary</h2>
        </div>
        <div class="sp-actions">
          <button id="sp-export">Export</button>
          <button id="sp-clear">Clear All</button>
        </div>
      </div>
    `;

    if (!vocab || !vocab.length) {
      el.innerHTML = header + '<p style="color:#6b7280">No words yet. Hover a word and click <b>＋ Add</b>.</p>';
      bindHeader([], vocab);
      return;
    }

    // —— 分组：default → My deck；listening → Listening deck；其它用原始名 ——
    const groups = {};
    for (let i = 0; i < vocab.length; i++) {
      const v = vocab[i];
      const raw = v.deck || 'default';
      const name = raw === 'default' ? 'My deck'
        : raw === 'listening' ? 'Listening deck'
          : raw;
      (groups[name] ||= []).push({ v, i }); // 记录原始下标 i，方便删除/播放等
    }

    // HTML 转义工具（保留你原有的风格）
    const escapeHTML = s => String(s ?? "")
      .replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

    // 组装每一行（复用你之前的结构/按钮类名，保证下面的事件绑定还能工作）
    const sectionHTML = Object.entries(groups).map(([name, items]) => {
      const rows = items.map(({ v, i }) => {
        const wordHtml = `<div class="word">${escapeHTML(v.surface || v.lemma || "")}</div>`;
        // 释义：去掉“Meaning (offline demo): …”前缀
        const m = cleanMeaning(v.meaning);
        const metaHtml = m ? `<div class="meta">${escapeHTML(m)}</div>` : "";

        // 例句：最多显示 2 条，保留朗读与复制按钮（去掉链接）
        const exList = (v.examples || v.raw?.examples || []).slice(0, 2);
        const exHtml = exList.map((e, j) => `
        <div class="ex-row" data-j="${j}">
          <span class="ex-text">${escapeHTML(e.text || "")}</span>
          <span class="ex-ops">
            <button class="btn ex-say"  title="Read aloud">🔈</button>
            <button class="btn ex-copy" title="Copy">📋</button>
          </span>
        </div>
      `).join("");
        const exBlock = exHtml ? `<div class="ex-list">${exHtml}</div>` : "";

        // 操作区：发音 / 打开来源(有链接时) / 删除
        const ops = `
        <div class="ops">
          <button class="btn play" title="Pronounce">🔈</button>
          ${v.url ? `<button class="btn open" title="Open source">🔗</button>` : ""}
          <button class="btn del"  title="Remove">🗑</button>
        </div>
      `;

        return `
        <div class="row" data-i="${i}">
          <div class="w">
            ${wordHtml}
            ${metaHtml}
            ${exBlock}
          </div>
          ${ops}
        </div>
      `;
      }).join("");

      // 每个分组一个小标题
      return `
      <h3 class="sp-group">${escapeHTML(name)}</h3>
      ${rows}
    `;
    }).join("");

    el.innerHTML = header + sectionHTML;

    // 绑定头部（导出/清空）
    bindHeader(vocab, vocab);

    // —— 行内事件绑定：沿用你原来逻辑 —— //
    // 发音
    el.querySelectorAll(".row .play").forEach(b => {
      b.onclick = (e) => {
        const i = +e.currentTarget.closest(".row").dataset.i;
        const item = vocab[i];
        play(item.surface || item.lemma);
      };
    });

    // 打开来源（仅保留按钮；列表不再展示长链接）
    el.querySelectorAll(".row .open").forEach(b => {
      b.onclick = (e) => {
        const i = +e.currentTarget.closest(".row").dataset.i;
        const item = vocab[i];
        if (item.url) chrome.tabs.create({ url: item.url });
      };
    });

    // 删除
    el.querySelectorAll(".row .del").forEach(b => {
      b.onclick = async (e) => {
        const i = +e.currentTarget.closest(".row").dataset.i;
        await removeByIndex(i);
      };
    });

    // 例句：朗读
    el.querySelectorAll(".row .ex-say").forEach(b => {
      b.onclick = (e) => {
        const row = e.currentTarget.closest(".row");
        const i = +row.dataset.i;
        const j = +e.currentTarget.closest(".ex-row").dataset.j;
        const ex = (vocab[i].examples || vocab[i].raw?.examples || [])[j];
        if (ex?.text) play(ex.text);
      };
    });

    // 例句：复制
    el.querySelectorAll(".row .ex-copy").forEach(b => {
      b.onclick = async (e) => {
        const row = e.currentTarget.closest(".row");
        const i = +row.dataset.i;
        const j = +e.currentTarget.closest(".ex-row").dataset.j;
        const ex = (vocab[i].examples || vocab[i].raw?.examples || [])[j];
        if (!ex?.text) return;
        try {
          await navigator.clipboard.writeText(ex.text);
          const btn = e.currentTarget;
          const old = btn.textContent;
          btn.textContent = "✓";
          setTimeout(() => (btn.textContent = old), 900);
        } catch { }
      };
    });
  }
  
  function bindHeader(items, rawVocab) {
    document.getElementById("sp-export").addEventListener("click", async () => {
      const { vocab = [] } = await chrome.storage.local.get({ vocab: [] });
      const groups = {};
      for (const v of vocab) {
        const key = v.deck || "default";
        (groups[key] ||= []).push(v);
      }

      const wb = XLSX.utils.book_new();

      const toSheetName = (name) =>
        String(name || "default").replace(/[\\\/\?\*\:\[\]]/g, "_").slice(0, 31);

      for (const [deck, rows] of Object.entries(groups)) {
        const data = rows.map(raw => {
          const v = norm(raw); // 复用你前面定义的规范化函数
          return {
            Word: v.surface || v.word || v.lemma || v.term || "",
            Meaning: v.meaning || v.meanings?.[0]?.short || v.short || "",
            Example: v.examples?.[0]?.text || "",
            Deck: v.deck || "default",
            SourceURL: v.url || v.sourceUrl || ""
          };
        });
        const ws = XLSX.utils.json_to_sheet(data);
        XLSX.utils.book_append_sheet(wb, ws, toSheetName(deck));
      }
      XLSX.writeFile(wb, "My_Vocabulary.xlsx");
    });


    document.getElementById("sp-clear").onclick = async () => {
      const ok = confirm("Clear all saved words?");
      if (!ok) return;
      await chrome.storage.local.set({ vocab: [] });
      // 你如果有 VOCAB_UPDATED 的自动刷新监听，这里也可以：
      // chrome.runtime.sendMessage({ type: 'VOCAB_UPDATED' });
      // 然后本页调用 load()/render() 刷新
      location.reload();
    };

    // —— 样式注入（你原来就有）
    ensureStyles();
  }

  function ensureStyles() {
    let style = document.getElementById("sp-style");
    if (!style) {
      style = document.createElement("style");
      style.id = "sp-style";
      document.head.appendChild(style);
    }

    style.textContent = `
    /* 顶部区域（标题 + 按钮） */
    .sp-head {
      display: flex; align-items: center; justify-content: space-between;
      padding: 6px 0 10px; border-bottom: 1px solid #eee; margin-bottom: 12px;
    }
    .sp-title h2 { margin: 0; font-size: 18px; font-weight: 700; color: #111; }
    .sp-actions { display: flex; gap: 10px; }
    .sp-actions button {
      font-size: 13px; border: 1px solid #e5e5e5; background: #fff;
      border-radius: 10px; padding: 6px 12px; cursor: pointer;
    }
    .sp-actions button:hover { background: #f6f6f6; }

    /* 分组标题(deck)—— 这就是你原来写在 HTML 里的 .sp-group */
    .sp-group {
      margin: 14px 0 8px;
      font: 600 14px/1.2 system-ui, Inter, ui-sans-serif;
      color: #374151;
    }

    /* 每个单词行 */
    .row {
      display: flex; align-items: flex-start; justify-content: space-between;
      border-bottom: 1px solid #f2f2f2; padding: 10px 0;
    }
    .word { font-size: 15px; font-weight: 700; color: #111; margin-bottom: 4px; }
    .meta { font-size: 13px; color: #444; margin-top: 2px; }
    .ex-list { font-size: 13px; color: #555; margin-top: 6px; }
    .ops { display: flex; align-items: center; gap: 8px; }
    .btn, .lexi-btn {
      border: 1px solid #e5e5e5; background: #fff; border-radius: 10px;
      padding: 4px 10px; font-size: 12px; cursor: pointer;
    }
    .btn:hover, .lexi-btn:hover { background: #f6f6f6; }

    /* 让排版更清爽一点 */
    #list .row .word { font-size: 16px; font-weight: 700; margin-bottom: 2px; }
    #list .row .meta { font-size: 13px; color: #4b5563; margin-bottom: 6px; }
    #list .ex-list { margin-top: 4px; display: flex; flex-direction: column; gap: 4px; }
    #list .ex-row { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
    #list .ex-text { font-size: 12px; color: #374151; flex: 1; }
    #list .ex-ops .btn { padding: 2px 6px; }
  `;
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

  chrome.runtime.onMessage.addListener((msg) => {
    if (msg.type === "VOCAB_UPDATED") load();
  });

})();