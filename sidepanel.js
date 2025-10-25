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
  // Clean old placeholder prefix "Meaning (offline demo): ..."
  function cleanMeaning(s) {
    if (!s) return "";
    return String(s).replace(/^Meaning\s*\(.*?\)\s*:\s*/i, "").trim();
  }

  // Replace your current function render(vocab) { … } with this implementation
  function render(vocab) {
    ensureStyles();
    const el = document.getElementById('list');

  // Header (reuses your previous export/clear buttons)
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

  // —— Grouping: default → My deck; listening → Listening deck; others use original name ——
    const groups = {};
    for (let i = 0; i < vocab.length; i++) {
      const v = vocab[i];
      const raw = v.deck || 'default';
      const name = raw === 'default' ? 'My deck'
        : raw === 'listening' ? 'Listening deck'
          : raw;
  (groups[name] ||= []).push({ v, i }); // record original index i for remove/play convenience
    }

  // HTML escape utility (keeps your original style)
    const escapeHTML = s => String(s ?? "")
      .replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  // Assemble each row (reuses your structure/button classes so event bindings still work)
    const sectionHTML = Object.entries(groups).map(([name, items]) => {
      const rows = items.map(({ v, i }) => {
        const wordHtml = `<div class="word">${escapeHTML(v.surface || v.lemma || "")}</div>`;
  // Meaning: strip the "Meaning (offline demo): ..." prefix
        const m = cleanMeaning(v.meaning);
        const metaHtml = m ? `<div class="meta">${escapeHTML(m)}</div>` : "";

  // Examples: show up to 2; keep read & copy buttons (remove links)
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

  // Ops area: pronounce / open source (if URL) / remove
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

  // A small title for each group
      return `
      <h3 class="sp-group">${escapeHTML(name)}</h3>
      ${rows}
    `;
    }).join("");

    el.innerHTML = header + sectionHTML;

  // Bind header (export/clear)
    bindHeader(vocab, vocab);

  // —— Inline event bindings: reuse original logic —— //
  // Pronunciation (play)
    el.querySelectorAll(".row .play").forEach(b => {
      b.onclick = (e) => {
        const i = +e.currentTarget.closest(".row").dataset.i;
        const item = vocab[i];
        play(item.surface || item.lemma);
      };
    });

  // Open source (keep button only; list no longer shows long URLs)
    el.querySelectorAll(".row .open").forEach(b => {
      b.onclick = (e) => {
        const i = +e.currentTarget.closest(".row").dataset.i;
        const item = vocab[i];
        if (item.url) chrome.tabs.create({ url: item.url });
      };
    });

  // Remove
    el.querySelectorAll(".row .del").forEach(b => {
      b.onclick = async (e) => {
        const i = +e.currentTarget.closest(".row").dataset.i;
        await removeByIndex(i);
      };
    });

  // Example: read aloud
    el.querySelectorAll(".row .ex-say").forEach(b => {
      b.onclick = (e) => {
        const row = e.currentTarget.closest(".row");
        const i = +row.dataset.i;
        const j = +e.currentTarget.closest(".ex-row").dataset.j;
        const ex = (vocab[i].examples || vocab[i].raw?.examples || [])[j];
        if (ex?.text) play(ex.text);
      };
    });

  // Example: copy
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
          const v = norm(raw); // reuse the normalization function defined above
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
      // If you have an automatic refresh listener for VOCAB_UPDATED, you can send a message here:
      // chrome.runtime.sendMessage({ type: 'VOCAB_UPDATED' });
      // Then the page will call load()/render() to refresh
      location.reload();
    };

  // —— Style injection (you already had this) ——
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
    /* Header area (title + actions) */
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

    /* Group title (deck) — this is the .sp-group you previously put in HTML */
    .sp-group {
      margin: 14px 0 8px;
      font: 600 14px/1.2 system-ui, Inter, ui-sans-serif;
      color: #374151;
    }

    /* Each word row */
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

    /* Make layout a bit cleaner */
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