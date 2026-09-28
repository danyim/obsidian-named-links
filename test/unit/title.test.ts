import assert from 'node:assert/strict';

import {
  cleanTitle,
  escapeMarkdown,
  formatTitle,
  truncateTitle,
} from '../../src/title';

describe('cleanTitle', () => {
  it('turns line breaks into spaces instead of gluing words', () => {
    assert.equal(cleanTitle('  Foo\n  Bar\r\n\tBaz '), 'Foo Bar Baz');
  });
});

describe('truncateTitle', () => {
  it('keeps titles at or under the limit', () => {
    assert.equal(truncateTitle('abcde', 5), 'abcde');
    assert.equal(truncateTitle('abcde', 0), 'abcde');
  });

  it('cuts a longer title to the limit plus an ellipsis', () => {
    // Upstream kept titles up to max + 2 characters long.
    assert.equal(truncateTitle('abcdef', 5), 'abcde…');
    assert.equal(truncateTitle('abcd efgh', 5), 'abcd…');
  });

  it('never cuts an emoji in half', () => {
    assert.equal(truncateTitle('ab😀cd', 3), 'ab😀…');
  });
});

describe('escapeMarkdown', () => {
  const cases: [string, string][] = [
    ['[Bracketed] title', '\\[Bracketed\\] title'],
    ['a | b', 'a \\| b'],
    ['*bold* _it_ `code` ~x~', '\\*bold\\* \\_it\\_ \\`code\\` \\~x\\~'],
    ['<b>', '\\<b\\>'],
    ['Costs $5-$10', 'Costs \\$5-\\$10'],
    ['a ==b== c', 'a \\=\\=b\\=\\= c'],
    ['Key:: value', 'Key\\:\\: value'],
    ['#tag and C# and # heading', '\\#tag and C# and # heading'],
    ['^footnote', '\\^footnote'],
    // Titles come from HTML, so a backslash is a real one and is kept.
    ['Escape \\$ in bash', 'Escape \\\\\\$ in bash'],
    ['C:\\\\server', 'C:\\\\\\\\server'],
    ['back\\slash', 'back\\\\slash'],
  ];
  for (const [input, expected] of cases) {
    it(`escapes ${JSON.stringify(input)}`, () =>
      assert.equal(escapeMarkdown(input), expected));
  }
});

describe('formatTitle', () => {
  it('truncates before escaping, so no escape is cut in half', () => {
    assert.equal(formatTitle('ab[cd', 3), 'ab\\[…');
  });
});
