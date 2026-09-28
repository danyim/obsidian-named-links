/** Turning a fetched page title into safe markdown link text. */

/**
 * Collapses runs of whitespace, newlines included, into single spaces.
 * Upstream deleted newlines outright, gluing "Foo\nBar" into "FooBar".
 */
export function cleanTitle(raw: string): string {
  return raw.replace(/\s+/g, ' ').trim();
}

/** Shortens a title to `max` characters plus an ellipsis; 0 means no limit. */
export function truncateTitle(title: string, max: number): string {
  if (!max || max <= 0 || title.length <= max) return title;
  return `${title.slice(0, max).trimEnd()}…`;
}

/**
 * Escapes the characters that would change how the link text renders.
 *
 * Anything already backslash-escaped is unescaped first so a title that
 * arrives escaped isn't double-escaped. Beyond upstream's set, this covers
 * `$` (inline math), `==` (highlights), a `#` that would start a tag, a
 * leading `^` (footnote syntax) and `::` (Dataview inline fields, upstream
 * #132).
 */
export function escapeMarkdown(text: string): string {
  const unescaped = text.replace(/\\([\\*_`~[\]<>|$#^=:])/g, '$1');
  return unescaped
    .replace(/([\\*_`~[\]<>|$])/g, '\\$1')
    .replace(/==/g, '\\=\\=')
    .replace(/::/g, '\\:\\:')
    .replace(/(^|\s)#(?=[^\s#])/g, '$1\\#')
    .replace(/^\^/, '\\^');
}

/** Clean, truncate, then escape, so the limit counts visible characters. */
export function formatTitle(raw: string, maxLength: number): string {
  return escapeMarkdown(truncateTitle(cleanTitle(raw), maxLength));
}
