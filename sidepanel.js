const list = document.getElementById("list");

function render(vocab) {
  list.innerHTML = "";
  if (!vocab.length) {
    list.textContent = "No words yet. Hover a word and click ＋ Add.";
    return;
  }
  for (const v of vocab.slice().reverse()) {
    const div = document.createElement("div");
    div.className = "item";
    div.innerHTML = `
      <div class="word">${v.surface} <span class="meta">(${v.lemma})</span></div>
      <div class="meta">${v.meanings?.[0]?.short || ""}</div>
      <div class="actions">
        <button data-open="${v.sourceUrls?.[0] || ""}">Open source</button>
        <button data-remove="${v.id}">Remove</button>
      </div>
    `;
    list.appendChild(div);
  }

  list.querySelectorAll("[data-open]").forEach(btn => {
    btn.onclick = () => {
      const url = btn.getAttribute("data-open");
      if (url) chrome.tabs.create({ url });
    };
  });
  list.querySelectorAll("[data-remove]").forEach(btn => {
    btn.onclick = async () => {
      const id = btn.getAttribute("data-remove");
      const { vocab } = await chrome.storage.local.get({ vocab: [] });
      const next = vocab.filter(v => v.id !== id);
      await chrome.storage.local.set({ vocab: next });
      render(next);
    };
  });
}

async function load() {
  const { vocab } = await chrome.storage.local.get({ vocab: [] });
  render(vocab);
}
load();

// listen background updates
chrome.runtime.onMessage.addListener((msg) => {
  if (msg.type === "VOCAB_UPDATED") load();
});