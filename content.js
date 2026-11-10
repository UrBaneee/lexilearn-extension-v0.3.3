(() => {
  if (globalThis.lexiReading) return;
  globalThis.lexiReading = true;

  const blockSelector = 'p, li, dd, dt, blockquote, figcaption, td, h1, h2, h3, h4, h5, h6, div';
  const ignored = 'script, style, noscript, code, pre, input, textarea, select, button, [contenteditable], [hidden]';
  const segmenter = new Intl.Segmenter('en', { granularity: 'sentence' });
  const highlightName = 'lexilearn-gre';
  const host = document.createElement('div');
  const shadow = host.attachShadow({ mode: 'closed' });
  const style = new CSSStyleSheet();
  style.replaceSync(`
    :host { all: initial; color-scheme: light dark; }
    section { position: fixed; z-index: 2147483647; box-sizing: border-box; width: min(350px, calc(100vw - 16px));
      max-height: calc(100vh - 16px); overflow: auto; padding: 14px; border: 1px solid GrayText;
      border-radius: 12px; background: Canvas; color: CanvasText; box-shadow: 0 6px 24px #0004;
      font: 14px/1.45 system-ui, sans-serif; overflow-wrap: anywhere; }
    header, .actions { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; }
    header strong { flex: 1; font-size: 17px; }
    p { margin: 8px 0; }
    blockquote { margin: 8px 0; padding-inline-start: 8px; border-inline-start: 2px solid GrayText; }
    button, select, input { font: inherit; color: CanvasText; background: Canvas; border: 1px solid GrayText;
      border-radius: 6px; padding: 4px 7px; }
    input { box-sizing: border-box; width: 100%; margin: 8px 0; }
    button { cursor: pointer; }
    button:disabled { opacity: .6; cursor: default; }
    a { color: LinkText; }
    .muted { font-size: 12px; }
  `);
  shadow.adoptedStyleSheets = [style];
  document.documentElement.append(host);

  let card;
  let gre;
  let known = new Set();
  let enabled = false;
  let marked = new Map();
  let refreshTimer;

  async function request(message) {
    const result = await chrome.runtime.sendMessage(message);
    if (!result?.ok) throw new Error(result?.error || 'LexiLearn could not finish the request.');
    return result.data;
  }

  function element(tag, text, parent) {
    const item = document.createElement(tag);
    if (text) item.textContent = text;
    if (parent) parent.append(item);
    return item;
  }

  function button(text, parent, action) {
    const item = element('button', text, parent);
    item.type = 'button';
    item.addEventListener('click', action);
    return item;
  }

  function closeCard() {
    card?.remove();
    card = undefined;
  }

  function getSentence(range) {
    if (!range) return '';
    const node = range.startContainer;
    const block = (node.parentElement || node).closest(blockSelector);
    if (!block || !block.contains(range.endContainer)) return '';
    const before = document.createRange();
    before.selectNodeContents(block);
    before.setEnd(node, range.startOffset);
    const offset = before.toString().length;
    const sentence = segmenter.segment(block.textContent).containing(offset);
    if (!sentence) return '';
    const start = Math.max(0, offset - sentence.index - 160);
    return sentence.segment.slice(start, start + 360).replace(/\s+/g, ' ').trim();
  }

  async function showCard(word, range) {
    const selection = word.replace(/\s+/g, ' ').trim();
    if (!selection || selection.length > 120) return;
    const sentence = getSentence(range);
    const anchor = range?.getBoundingClientRect();
    closeCard();

    const panel = card = element('section', '', shadow);
    panel.setAttribute('role', 'dialog');
    panel.setAttribute('aria-label', 'LexiLearn lookup');
    panel.tabIndex = -1;
    const header = element('header', '', panel);
    element('strong', selection, header);
    button('Listen', header, () => {
      const voice = speechSynthesis.getVoices().find(item => item.localService && item.lang.startsWith('en'));
      if (!voice) {
        status.textContent = 'No local English voice is available.';
        return;
      }
      const utterance = new SpeechSynthesisUtterance(selection);
      utterance.voice = voice;
      speechSynthesis.cancel();
      speechSynthesis.speak(utterance);
    });
    const close = button('×', header, closeCard);
    close.setAttribute('aria-label', 'Close');
    if (sentence) element('blockquote', sentence, panel);

    const lookups = element('div', '', panel);
    lookups.className = 'actions';
    const status = element('p', '', panel);
    status.className = 'muted';
    status.setAttribute('role', 'status');
    const meaning = element('input', '', panel);
    meaning.maxLength = 300;
    meaning.placeholder = 'Meaning or your own note';
    meaning.setAttribute('aria-label', 'Meaning');
    const saveActions = element('div', '', panel);
    saveActions.className = 'actions';
    const deck = element('select', '', saveActions);
    deck.setAttribute('aria-label', 'Deck');
    const newDeck = element('input', '', panel);
    newDeck.placeholder = 'Name of new deck';
    newDeck.setAttribute('aria-label', 'New deck name');
    newDeck.maxLength = 80;
    newDeck.hidden = true;
    deck.addEventListener('change', () => {
      newDeck.hidden = deck.value !== 'new';
      if (!newDeck.hidden) newDeck.focus();
    });
    const save = button('Save', saveActions, async () => {
      const name = deck.value === 'new' ? newDeck.value.trim() : deck.selectedOptions[0]?.dataset.deck;
      if (!name) {
        status.textContent = 'Enter a deck name first.';
        return;
      }
      save.disabled = true;
      try {
        await request({
          type: 'ADD_VOCAB',
          entry: {
            word: selection, deck: name, url: location.href, meaning: meaning.value,
            example: sentence ? { text: sentence, url: location.href } : undefined,
          },
        });
        status.textContent = 'Saved to your vocabulary.';
      } catch {
        status.textContent = 'Could not save. Try again.';
      } finally {
        save.disabled = false;
      }
    });
    save.disabled = true;

    if (gre?.has(selection.toLowerCase()) && !known.has(selection.toLowerCase())) {
      const knownButton = button('I know this', saveActions, async () => {
        try {
          await request({ type: 'MARK_KNOWN', word: selection });
          closeCard();
        } catch {
          status.textContent = 'Could not update known words.';
        }
      });
      knownButton.title = 'Hide this word from GRE highlights';
    }

    function position() {
      if (card !== panel) return;
      const left = anchor?.width ? anchor.left : innerWidth / 2 - panel.offsetWidth / 2;
      const below = anchor?.width ? anchor.bottom + 8 : 24;
      const above = anchor?.top - panel.offsetHeight - 8;
      panel.style.left = Math.max(8, Math.min(left, innerWidth - panel.offsetWidth - 8)) + 'px';
      const top = below + panel.offsetHeight <= innerHeight ? below : above || 8;
      panel.style.top = Math.max(8, Math.min(top, innerHeight - panel.offsetHeight - 8)) + 'px';
    }

    position();
    panel.focus({ preventScroll: true });
    try {
      const { vocab = [], targetLang = 'zh' } = await chrome.storage.local.get(['vocab', 'targetLang']);
      if (card !== panel) return;
      const target = ({ 'zh-CN': 'zh', 'zh-TW': 'zh-Hant' })[targetLang] || targetLang;
      for (const [index, name] of [...new Set(['default', ...vocab.map(item => item.deck || 'default')])].entries()) {
        const label = name === 'default' ? 'My deck' : name === 'listening' ? 'Listening deck' : name;
        const option = element('option', label, deck);
        option.value = String(index);
        option.dataset.deck = name;
      }
      element('option', 'New deck…', deck).value = 'new';
      save.disabled = false;
      const online = element('a', 'Open Google Translate ↗', panel);
      const params = new URLSearchParams({ sl: 'en', tl: ({ zh: 'zh-CN', 'zh-Hant': 'zh-TW' })[target] || target, text: selection, op: 'translate' });
      online.href = 'https://translate.google.com/?' + params;
      online.target = '_blank';
      online.rel = 'noopener noreferrer';
      online.className = 'muted';

      function lookup(label, action, success) {
        return button(label, lookups, async () => {
          const actions = [...lookups.querySelectorAll('button')];
          actions.forEach(item => { item.disabled = true; });
          status.textContent = 'Working on this device…';
          position();
          try {
            const result = await action(progress => { status.textContent = progress; position(); });
            const text = typeof result === 'string' ? result : result.meaning;
            if (!text) throw new Error('Chrome returned no result.');
            meaning.value = text;
            status.textContent = result.language && result.language !== target ? success + ' (English)' : success;
          } catch {
            status.textContent = label === 'Translate'
              ? 'On-device translation is unavailable. You can add your own note or open Google Translate.'
              : 'Context explanation is unavailable. Try Translate, or add your own note.';
          } finally {
            actions.forEach(item => { item.disabled = false; });
            position();
          }
        });
      }

      if (sentence) {
        lookup('Explain in context', onProgress => lexiLookup.explain(selection, sentence, target, onProgress),
          'Context explanation · Chrome on-device AI');
      }
      lookup('Translate', onProgress => lexiLookup.translate(selection, target, onProgress),
        'Word translation · Chrome on-device AI');
      position();
    } catch {
      status.textContent = 'Could not load LexiLearn settings. Reopen the card to try again.';
      position();
    }
  }

  function highlight() {
    if (!enabled || !document.body) return;
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    const marks = new Highlight();
    const matches = new Map();
    while (walker.nextNode()) {
      const node = walker.currentNode;
      if (node.parentElement?.closest(ignored)) continue;
      for (const match of node.data.matchAll(/\b[A-Za-z]+(?:[-'][A-Za-z]+)*\b/g)) {
        const word = match[0].toLowerCase();
        if (!gre.has(word) || known.has(word)) continue;
        const range = document.createRange();
        range.setStart(node, match.index);
        range.setEnd(node, match.index + match[0].length);
        marks.add(range);
        if (!matches.has(node)) matches.set(node, []);
        matches.get(node).push(range);
      }
    }
    marked = matches;
    CSS.highlights.set(highlightName, marks);
  }

  function scheduleHighlight() {
    clearTimeout(refreshTimer);
    refreshTimer = setTimeout(highlight, 150);
  }

  const observer = new MutationObserver(scheduleHighlight);
  async function setHighlights(value) {
    if (value) {
      gre ||= new Set(await request({ type: 'GRE_WORDS' }));
      known = new Set((await chrome.storage.local.get('known')).known || []);
      enabled = true;
      highlight();
      observer.observe(document.body, { childList: true, subtree: true, characterData: true });
    } else {
      enabled = false;
      observer.disconnect();
      clearTimeout(refreshTimer);
      CSS.highlights.delete(highlightName);
      marked.clear();
    }
    return enabled;
  }

  document.addEventListener('click', event => {
    if (event.target === host) return;
    closeCard();
    if (!enabled || event.defaultPrevented || event.target.closest?.('a, button, [role="button"], [contenteditable]') ||
      !getSelection()?.isCollapsed) return;
    const caret = document.caretRangeFromPoint(event.clientX, event.clientY);
    if (!caret) return;
    const match = marked.get(caret.startContainer)?.find(range =>
      range.startOffset <= caret.startOffset && range.endOffset >= caret.startOffset &&
      [...range.getClientRects()].some(rect =>
        rect.left <= event.clientX && rect.right >= event.clientX && rect.top <= event.clientY && rect.bottom >= event.clientY));
    if (match) showCard(match.toString(), match);
  });
  document.addEventListener('keydown', event => { if (event.key === 'Escape') closeCard(); });
  chrome.storage.onChanged.addListener((changes, area) => {
    if (enabled && area === 'local' && changes.known) {
      known = new Set(changes.known.newValue || []);
      scheduleHighlight();
    }
  });
  chrome.runtime.onMessage.addListener((message, _sender, reply) => {
    if (message.type === 'HIGHLIGHT_STATUS') reply(enabled);
    if (message.type === 'SHOW_SELECTION') {
      const selection = getSelection();
      const range = selection?.rangeCount && selection.toString().trim() === message.text.trim()
        ? selection.getRangeAt(0).cloneRange() : null;
      showCard(message.text, range);
      reply(true);
    }
    if (message.type === 'SET_HIGHLIGHTS') {
      setHighlights(message.enabled).then(
        active => reply({ ok: true, enabled: active }),
        error => reply({ ok: false, error: error.message }),
      );
      return true;
    }
  });
})();
