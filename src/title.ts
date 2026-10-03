/** Turning a fetched page title into safe markdown link text. */

/**
 * Collapses runs of whitespace, newlines included, into single spaces.
 * Upstream deleted newlines outright, gluing "Foo\nBar" into "FooBar".
 */
export function cleanTitle(raw: string): string {
  return raw.replace(/\s+/g, ' ').trim();
}

/**
 * Shortens a title to `max` characters plus an ellipsis; 0 means no limit.
 * Counts code points, so an emoji or other astral character is never cut in
 * half.
 */
export function truncateTitle(title: string, max: number): string {
  const chars = Array.from(title);
  if (!max || max <= 0 || chars.length <= max) return title;
  return `${chars.slice(0, max).join('').trimEnd()}…`;
}

/**
 * Escapes the characters that would change how the link text renders.
 *
 * Titles come from HTML, where a backslash is just a backslash, so every one
 * is escaped; upstream first stripped any backslash in front of a markdown
 * character, which lost real ones ("Escape \\$ in bash"). Beyond upstream's
 * set, this covers `$` (inline math), `==` (highlights), a `#` that would
 * start a tag, a leading `^` (footnote syntax) and `::` (Dataview inline
 * fields, upstream #132).
 */
export function escapeMarkdown(text: string): string {
  return text
    .replace(/([\\*_`~[\]<>|$])/g, '\\$1')
    .replace(/==/g, '\\=\\=')
    .replace(/::/g, '\\:\\:')
    .replace(/(^|\s)#(?=[^\s#])/g, '$1\\#')
    .replace(/^\^/, '\\^');
}

/** A fetched title as it should read, before escaping for where it goes. */
export function readableTitle(raw: string, maxLength: number): string {
  return truncateTitle(cleanTitle(raw), maxLength);
}

/** Clean, truncate, then escape, so the limit counts visible characters. */
export function formatTitle(raw: string, maxLength: number): string {
  return escapeMarkdown(readableTitle(raw, maxLength));
}
