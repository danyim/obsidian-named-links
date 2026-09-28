/**
 * Where in a note the cursor is, for deciding whether a pasted URL should be
 * left exactly as pasted. Plain text in, so the unit tests need no editor.
 */

/** Whether `offset` falls inside a YAML frontmatter block (upstream #21). */
export function isInFrontmatter(text: string, offset: number): boolean {
  if (!/^---\r?\n/.test(text)) return false;
  const close = /\r?\n(?:---|\.\.\.)[ \t]*(?:\r?\n|$)/g;
  close.lastIndex = 3;
  const match = close.exec(text);
  // An unclosed block is still frontmatter while it is being typed.
  const end = match ? match.index + match[0].length : text.length;
  return offset > 3 && offset < end;
}

// Container markers a fence can sit behind: blockquote `>`s and list
// indentation.
const FENCE = /^(?:[ \t]*>)*[ \t]*(`{3,}|~{3,})(.*)$/;

/** Whether the line at `lineIndex` is inside a fenced code block. */
function isInFence(lines: string[], lineIndex: number): boolean {
  let open: { char: string; length: number } | null = null;
  for (let i = 0; i < lineIndex; i++) {
    const match = FENCE.exec(lines[i]);
    if (!match) continue;
    const [, run, rest] = match;
    if (!open) {
      // A backtick fence's info string can't itself contain a backtick.
      if (run[0] === '`' && rest.includes('`')) continue;
      open = { char: run[0], length: run.length };
    } else if (
      run[0] === open.char &&
      run.length >= open.length &&
      rest.trim() === ''
    ) {
      open = null;
    }
  }
  return open !== null;
}

/**
 * Whether column `ch` of `line` is inside an inline code span. A backtick run
 * with no closing run yet counts too: that's someone typing `` ` `` and then
 * pasting, and they want the URL literal.
 */
function isInInlineCode(line: string, ch: number): boolean {
  let openLength = 0;
  let i = 0;
  while (i < ch) {
    if (line[i] === '\\' && openLength === 0) {
      i += 2;
      continue;
    }
    if (line[i] !== '`') {
      i++;
      continue;
    }
    let run = 0;
    while (line[i + run] === '`') run++;
    if (openLength === 0) {
      openLength = run;
    } else if (run === openLength) {
      openLength = 0;
    }
    i += run;
  }
  return openLength > 0;
}

/** Whether `offset` is in a fenced code block or an inline code span. */
export function isInCode(text: string, offset: number): boolean {
  const before = text.slice(0, offset);
  const lines = text.split('\n');
  const lineIndex = before.split('\n').length - 1;
  if (isInFence(lines, lineIndex)) return true;
  const ch = offset - (before.lastIndexOf('\n') + 1);
  return isInInlineCode(lines[lineIndex], ch);
}

/**
 * Whether the text just before the cursor means the URL is going into markup
 * that already says what it is: the target of a `[text](` link, a quoted
 * HTML attribute, or a `<` autolink (upstream #156).
 */
export function isLinkTargetPosition(lineBefore: string): boolean {
  return /(?:\]\(|["'<])$/.test(lineBefore);
}
