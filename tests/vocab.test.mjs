import assert from 'node:assert/strict';
import test from 'node:test';
import { addEntry, normalizeEntry } from '../vocab.mjs';

test('migrates older words, URLs and meanings without keeping demo text', () => {
  const entry = normalizeEntry({
    word: 'Bank', meaning: 'Click the highlighted word to translate',
    meanings: [{ gloss: 'river edge' }], sourceUrls: ['https://example.org'],
  });
  assert.equal(entry.surface, 'Bank');
  assert.equal(entry.lemma, 'bank');
  assert.equal(entry.url, 'https://example.org');
  assert.deepEqual(entry.meanings, [{ short: 'river edge' }]);
  assert.equal(normalizeEntry(entry).id, entry.id);
});

test('saves the same word in multiple decks and keeps distinct senses', () => {
  const vocab = [];
  const river = { word: 'bank', meaning: 'river edge', example: { text: 'They sat on the river bank.' } };
  addEntry(vocab, river);
  addEntry(vocab, river);
  addEntry(vocab, { ...river, deck: 'GRE' });
  addEntry(vocab, { word: 'bank', meaning: 'financial institution' });
  assert.deepEqual(vocab.map(({ deck, meanings }) => [deck, meanings[0].short]), [
    ['default', 'river edge'], ['GRE', 'river edge'], ['default', 'financial institution'],
  ]);
  assert.equal(vocab[0].examples.length, 1);
});
