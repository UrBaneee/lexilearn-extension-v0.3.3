import { deckLabel, normalizeEntry } from './vocab.mjs';

const list = document.querySelector('#list');
const status = document.querySelector('#status');
const search = document.querySelector('#search');
const review = document.querySelector('#review');
const exportButton = document.querySelector('#export');
const clearButton = document.querySelector('#clear');
let entries = [];
let reviewing = false;

function element(tag, text, parent) {
  const node = document.createElement(tag);
  if (text) node.textContent = text;
  parent.append(node);
  return node;
}

function button(text, parent, action) {
  const node = element('button', text, parent);
  node.type = 'button';
  node.addEventListener('click', action);
  return node;
}

async function mutate(message) {
  try {
    const result = await chrome.runtime.sendMessage(message);
    if (!result?.ok) throw new Error(result?.error);
    status.textContent = '';
  } catch {
    status.textContent = 'Could not update vocabulary. Try again.';
  }
}

function speak(text) {
  const voice = speechSynthesis.getVoices().find(item => item.localService && item.lang.startsWith('en'));
  if (!voice) {
    status.textContent = 'No local English voice is available.';
    return;
  }
  const utterance = new SpeechSynthesisUtterance(text);
  utterance.voice = voice;
  speechSynthesis.cancel();
  speechSynthesis.speak(utterance);
}

function renderEntry(entry, group) {
  const card = element('article', '', group);
  const title = element('strong', entry.surface, card);
  const meaning = entry.meanings.map(({ short }) => short).join(' · ');
  const answer = element('p', meaning || 'No meaning saved.', card);
  answer.hidden = reviewing;
  title.hidden = reviewing;
  for (const example of entry.examples) {
    const text = reviewing && entry.surface ? example.text.replace(
      new RegExp(entry.surface.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi'), '____',
    ) : example.text;
    const sentence = element('blockquote', text, card);
    if (!reviewing) {
      const exampleActions = element('div', '', sentence);
      exampleActions.className = 'actions';
      button('Listen to sentence', exampleActions, () => speak(example.text));
      button('Copy', exampleActions, async () => {
        try {
          await navigator.clipboard.writeText(example.text);
          status.textContent = 'Sentence copied.';
        } catch {
          status.textContent = 'Could not copy the sentence.';
        }
      });
      addSourceLink(example.url, 'Sentence source', exampleActions);
    }
  }
  const actions = element('div', '', card);
  actions.className = 'actions';
  if (reviewing) {
    if (!entry.examples.length) title.hidden = false;
    button('Show answer', actions, event => {
      title.hidden = !title.hidden && entry.examples.length > 0;
      answer.hidden = !answer.hidden;
      event.currentTarget.textContent = answer.hidden ? 'Show answer' : 'Hide answer';
    });
    return;
  }
  button('Listen', actions, () => speak(entry.surface));
  addSourceLink(entry.url, 'Open source', actions);
  button('Remove', actions, () => mutate({ type: 'REMOVE_VOCAB', id: entry.id }));
}

function addSourceLink(url, label, parent) {
  if (!/^https?:\/\//i.test(url)) return;
  const link = element('a', label, parent);
  link.href = url;
  link.target = '_blank';
  link.rel = 'noopener noreferrer';
}

function groups(items) {
  const result = new Map();
  for (const entry of items) {
    if (!result.has(entry.deck)) result.set(entry.deck, []);
    result.get(entry.deck).push(entry);
  }
  return result;
}

function render() {
  list.replaceChildren();
  exportButton.disabled = clearButton.disabled = !entries.length;
  const query = search.value.trim().toLowerCase();
  const shown = entries.filter(entry =>
    [entry.surface, deckLabel(entry.deck), ...entry.meanings.map(item => item.short)]
      .some(value => value.toLowerCase().includes(query)));
  if (!shown.length) {
    element('p', entries.length ? 'No matching words.' : 'Look up a word on a webpage to start your vocabulary.', list);
    return;
  }
  for (const [deck, items] of groups(shown)) {
    const group = element('section', '', list);
    element('h2', deckLabel(deck), group);
    items.forEach(entry => renderEntry(entry, group));
  }
}

exportButton.addEventListener('click', () => {
  try {
    const workbook = XLSX.utils.book_new();
    const usedNames = new Set();
    for (const [deck, items] of groups(entries)) {
      const base = deckLabel(deck).replace(/[\\/?:*\[\]]/g, '_').replace(/^'+|'+$/g, '') || 'Deck';
      let name = base.slice(0, 31).replace(/'+$/, '');
      for (let index = 2; usedNames.has(name.toLowerCase()); index++) {
        const suffix = ` (${index})`;
        name = base.slice(0, 31 - suffix.length) + suffix;
      }
      usedNames.add(name.toLowerCase());
      const rows = items.flatMap(entry => (entry.examples.length ? entry.examples : [{}]).map(example => ({
        Word: entry.surface, Meaning: entry.meanings.map(({ short }) => short).join(' · '),
        Example: example.text || '', Deck: deckLabel(deck), SourceURL: example.url || entry.url,
      })));
      XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(rows), name);
    }
    XLSX.writeFile(workbook, 'My_Vocabulary.xlsx');
    status.textContent = 'Exported vocabulary.';
  } catch {
    status.textContent = 'Could not export vocabulary.';
  }
});

clearButton.addEventListener('click', () => {
  if (confirm('Delete all saved vocabulary?')) mutate({ type: 'CLEAR_VOCAB' });
});
review.addEventListener('click', () => {
  reviewing = !reviewing;
  review.setAttribute('aria-pressed', String(reviewing));
  review.textContent = reviewing ? 'Finish review' : 'Review';
  render();
});
search.addEventListener('input', render);

function update(vocab) {
  entries = vocab.map(normalizeEntry);
  render();
}

try {
  const { vocab = [] } = await chrome.storage.local.get('vocab');
  update(vocab);
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && changes.vocab) update(changes.vocab.newValue || []);
  });
} catch {
  status.textContent = 'Could not load vocabulary.';
}
