// -----------------------------------------------------------------------------
// The texts read by Gladys, the store and people are clean UTF-8: no BOM, no
// mojibake, no control bytes, never "chiffré" nor "encrypted".
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';

const root = new URL('../', import.meta.url);
const sources = (dir) =>
  readdirSync(new URL(dir, root), { recursive: true })
    .map(String)
    .filter((name) => name.endsWith('.js'))
    .map((name) => `${dir}${name.replaceAll('\\', '/')}`);

const FILES = [
  'gladys-assistant-integration.json',
  'docs/fr.md',
  'docs/en.md',
  'README.md',
  'CHANGELOG.md',
  'TODO.md',
  'CLAUDE.md',
  'THIRD_PARTY_NOTICES.md',
  'index.js',
  ...sources('src/'),
];

const MOJIBAKE = /Ã|Â|â€|Å[’“]/;

test('the mojibake check catches lowercase and uppercase accents', () => {
  for (const word of ['Ã©tÃ©', 'Ã‰tÃ©', 'Ã€ jour', 'FranÃ‡ais', 'â€™', 'Å“uvre', 'Â°C']) {
    assert.ok(MOJIBAKE.test(word), word);
  }
  for (const word of ['été', 'Été', 'À jour', 'Ça', 'l’heure', 'œuvre', 'm³', '…']) {
    assert.ok(!MOJIBAKE.test(word), word);
  }
});

test('the source files are part of the check', () => {
  assert.ok(FILES.includes('src/i18n.js'));
  assert.ok(FILES.includes('src/app.js'));
});

for (const file of FILES) {
  test(`${file} is clean UTF-8`, () => {
    const bytes = readFileSync(new URL(file, root));
    assert.ok(
      !(bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf),
      `${file} starts with a BOM`,
    );
    const text = bytes.toString('utf8');
    assert.ok(!text.includes('�'), `${file} has invalid UTF-8`);
    const match = MOJIBAKE.exec(text);
    assert.equal(match, null, `${file} has mojibake`);
  });
}

test('no control bytes in the texts; never "chiffré" nor "encrypted"', () => {
  for (const file of FILES) {
    const text = readFileSync(new URL(file, root), 'utf8');
    // eslint-disable-next-line no-control-regex
    assert.doesNotMatch(text, /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/, file);
    assert.doesNotMatch(text, /chiffr[ée]|encrypt/i, file);
  }
});
