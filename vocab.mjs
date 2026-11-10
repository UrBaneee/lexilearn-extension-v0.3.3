const placeholder = 'Click the highlighted word to translate';

export function normalizeEntry(entry) {
  const surface = entry.surface || entry.word || entry.lemma || entry.term || '';
  const { meaning, ...rest } = entry;
  const meanings = [meaning, ...(entry.meanings || []).map(item => item.short || item.gloss), entry.short]
    .filter(value => typeof value === 'string')
    .map(value => value.replace(/^Meaning\s*\(.*?\)\s*:\s*/i, '').trim())
    .filter(value => value && value !== placeholder);
  return {
    ...rest,
    id: entry.id || crypto.randomUUID(),
    surface,
    lemma: (entry.lemma || surface).toLowerCase(),
    deck: entry.deck || 'default',
    url: entry.url || entry.sourceUrl || entry.sourceUrls?.[0] || '',
    meanings: [...new Set(meanings)].map(short => ({ short })),
    examples: entry.examples || [],
  };
}

export function addEntry(vocab, { word, deck, url, meaning, example }) {
  const surface = String(word ?? '').trim().slice(0, 120);
  if (!surface) throw new Error('Select a word or phrase first.');
  const entry = normalizeEntry({
    surface,
    deck: String(deck ?? '').trim().slice(0, 80),
    url,
    meaning,
    examples: example?.text ? [example] : [],
    createdAt: Date.now(),
  });
  const current = vocab.find(item =>
    item.lemma === entry.lemma &&
    item.deck === entry.deck &&
    (!entry.meanings.length || !item.meanings.length ||
      item.meanings.some(({ short }) => short === entry.meanings[0].short) ||
      item.examples.some(prior => prior.text === example?.text && prior.url === example.url))
  );
  if (!current) {
    vocab.push(entry);
    return;
  }
  for (const meaning of entry.meanings) {
    if (!current.meanings.some(prior => prior.short === meaning.short)) current.meanings.push(meaning);
  }
  for (const example of entry.examples) {
    if (!current.examples.some(prior => prior.text === example.text && prior.url === example.url)) {
      current.examples.push(example);
    }
  }
  current.url ||= entry.url;
}

export function deckLabel(deck) {
  if (deck === 'default') return 'My deck';
  if (deck === 'listening') return 'Listening deck';
  return deck;
}
