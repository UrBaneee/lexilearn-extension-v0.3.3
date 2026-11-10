import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';

const code = await readFile(new URL('../lookup.js', import.meta.url), 'utf8');

test('passes the selected sentence to the model and translates its definition', async () => {
  let destroyed = false;
  const mock = {
    LanguageModel: {
      availability: async () => 'available',
      create: async options => {
        assert.equal(options.expectedOutputs[0].languages[0], 'en');
        return {
          prompt: async (input, { responseConstraint }) => {
            assert.deepEqual(JSON.parse(input), { word: 'bank', sentence: 'They sat on the river bank.' });
            assert.equal(responseConstraint.properties.meaning.type, 'string');
            return '{"meaning":"the edge of a river"}';
          },
          destroy: () => { destroyed = true; },
        };
      },
    },
    Translator: {
      availability: async () => 'available',
      create: async ({ targetLanguage }) => {
        assert.equal(targetLanguage, 'zh');
        return { translate: async text => text === 'the edge of a river' ? '河岸' : '银行' };
      },
    },
  };
  runInNewContext(code, mock);
  const result = await mock.lexiLookup.explain('bank', 'They sat on the river bank.', 'zh', () => {});
  assert.equal(result.meaning, '河岸');
  assert.equal(result.language, 'zh');
  assert.equal(destroyed, true);
});

test('keeps the English explanation when the translation model is unavailable', async () => {
  const mock = {
    LanguageModel: {
      availability: async () => 'available',
      create: async () => ({ prompt: async () => '{"meaning":"river edge"}', destroy() {} }),
    },
    Translator: { availability: async () => 'unavailable' },
  };
  runInNewContext(code, mock);
  const result = await mock.lexiLookup.explain('bank', 'The river bank.', 'zh', () => {});
  assert.equal(result.meaning, 'river edge');
  assert.equal(result.language, 'en');
  await assert.rejects(mock.lexiLookup.translate('bank', 'zh', () => {}), /cannot translate/);
});
