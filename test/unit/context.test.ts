import assert from 'node:assert/strict';

import {
  isInCode,
  isInFrontmatter,
  isLinkTargetPosition,
} from '../../src/context';

/** Splits a fixture at its `|` into text and cursor offset. */
function at(fixture: string): [string, number] {
  const offset = fixture.indexOf('|');
  return [fixture.slice(0, offset) + fixture.slice(offset + 1), offset];
}

describe('isInFrontmatter', () => {
  it('is true inside the block', () => {
    assert.equal(isInFrontmatter(...at('---\nsource: |\n---\nbody')), true);
  });

  it('is false after the block', () => {
    assert.equal(isInFrontmatter(...at('---\na: 1\n---\nbody |')), false);
  });

  it('is false in a note without frontmatter', () => {
    assert.equal(isInFrontmatter(...at('text\n---\n|')), false);
  });
});

describe('isInCode', () => {
  it('is true in a fenced block', () => {
    assert.equal(isInCode(...at('```js\nconst u = "|"\n```')), true);
  });

  it('is false after the block closes', () => {
    assert.equal(isInCode(...at('```\ncode\n```\n|')), false);
  });

  it('handles tilde fences and longer closing fences', () => {
    assert.equal(isInCode(...at('~~~\n|\n~~~')), true);
    assert.equal(isInCode(...at('````\n```\n|\n````')), true);
  });

  it('handles fences in a list item and a blockquote', () => {
    assert.equal(isInCode(...at('- item\n  ```\n  |\n  ```')), true);
    assert.equal(isInCode(...at('> ```\n> |\n> ```')), true);
  });

  it('is true in inline code, closed or still being typed (upstream #166)', () => {
    assert.equal(isInCode(...at('run `curl |` now')), true);
    assert.equal(isInCode(...at('run `|')), true);
    assert.equal(isInCode(...at('run ``a ` |`` now')), true);
  });

  it('is false after an inline code span', () => {
    assert.equal(isInCode(...at('run `curl` then |')), false);
  });

  it('ignores an escaped backtick', () => {
    assert.equal(isInCode(...at('a \\` b |')), false);
  });
});

describe('isLinkTargetPosition', () => {
  it('is true after "](", a quote, or "<"', () => {
    assert.equal(isLinkTargetPosition('[text]('), true);
    assert.equal(isLinkTargetPosition('<a href="'), true);
    assert.equal(isLinkTargetPosition("src='"), true);
    assert.equal(isLinkTargetPosition('see <'), true);
  });

  it('is false in plain prose', () => {
    assert.equal(isLinkTargetPosition('see '), false);
  });
});
