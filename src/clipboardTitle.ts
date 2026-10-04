/**
 * The title a pasted or dropped URL already carries. Copying a link from a
 * browser page, Edge's "Copy link", dragging a link out of a page, and
 * Firefox all put the link's text on the clipboard alongside the URL, and
 * using it means no request at all, which also works for pages behind a
 * login (upstream #129, and in part #42, #103, #112, #114, #143).
 *
 * No Obsidian imports, so the unit tests can run it under plain Node.
 */
import { cleanTitle } from './title';
import { hostnameOf, isUrl, toAbsoluteUrl } from './url';

/** What a paste or drop carries besides its plain text. */
export interface ClipboardLinkData {
  /** `text/html` */
  html?: string;
  /** `text/x-moz-url`: the URL, a newline, then the title (Firefox). */
  mozUrl?: string;
}

/**
 * A URL in a form two copies of the same address agree on: parsed, with an
 * empty path's trailing slash dropped (a browser adds one to a bare host),
 * and a leading `www.` on the host ignored.
 */
function comparable(url: string): string | null {
  const absolute = toAbsoluteUrl(url);
  if (!absolute) return null;
  try {
    const parsed = new URL(absolute);
    parsed.hostname = parsed.hostname.replace(/^www\./i, '');
    const href = parsed.href;
    return parsed.pathname === '/' && !parsed.search && !parsed.hash
      ? href.replace(/\/$/, '')
      : href;
  } catch {
    return null;
  }
}

function sameUrl(a: string, b: string): boolean {
  const ca = comparable(a);
  return ca !== null && ca === comparable(b);
}

// Anchor text that says nothing about the page. A fetched title is better
// than "[here](url)", so these fall back to fetching rather than become the
// title.
const GENERIC_TEXT = new Set([
  'click here',
  'go',
  'here',
  'learn more',
  'link',
  'more',
  'open',
  'read more',
  'source',
  'this',
  'this link',
  'url',
  'view',
  'website',
]);

/**
 * The link text worth using as a title, or null when it is no better than
 * fetching one:
 *
 * - empty or only whitespace;
 * - a URL, including the URL itself with or without its scheme or `www.`,
 *   and one written without a scheme, like `example.org/page`;
 * - only the host name, with or without `www.`;
 * - generic text that names nothing, like "here" or "read-more", or text
 *   that is nothing but punctuation.
 */
export function usefulLinkText(text: string, url: string): string | null {
  const title = cleanTitle(text);
  if (title === '') return null;

  const bare = (s: string) =>
    s
      .toLowerCase()
      .replace(/^https?:\/\//, '')
      .replace(/^www\./, '')
      .replace(/\/$/, '');
  if (bare(title) === bare(url)) return null;
  if (bare(title) === bare(hostnameOf(url))) return null;
  if (isUrl(title)) return null;
  // A URL written without its scheme. Only with a path after the host, so a
  // dotted name like "Node.js" or "ASP.NET" is still a usable title.
  if (/^[^\s/]+\.[^\s/]+\/\S*$/.test(title) && isUrl(`https://${title}`)) {
    return null;
  }

  // Punctuation separates words rather than joining them, so "read-more"
  // reads as "read more", and text that is only punctuation is nothing.
  const words = title
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
  if (words === '' || GENERIC_TEXT.has(words)) return null;

  return title;
}

/**
 * The text of the one link in clipboard HTML that points at `url`, or null
 * if the HTML is anything other than that link: more than one link, a link
 * to somewhere else, or other text around it (a sentence, or the rest of a
 * table row), which would make it a copy of content rather than of a link.
 */
export function linkTextFromHtml(html: string, url: string): string | null {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  // Styles and scripts some apps put on the clipboard aren't text anyone
  // copied.
  doc.querySelectorAll('style, script').forEach((el) => el.remove());
  const anchors = Array.from(doc.querySelectorAll('a[href]'));
  if (anchors.length !== 1) return null;
  const [anchor] = anchors;
  if (!sameUrl(anchor.getAttribute('href') ?? '', url)) return null;

  const linkText = anchor.textContent ?? '';
  // The whole document rather than the body: a fragment's text belongs in
  // the body, but the head's (a <title>) isn't what was copied.
  doc.head?.remove();
  const allText = doc.documentElement?.textContent ?? '';
  // What's left once the link's own text is taken out has to be nothing but
  // whitespace and punctuation.
  const rest = allText.replace(linkText, '');
  if (/[\p{L}\p{N}]/u.test(rest)) return null;

  return linkText;
}

/** The title in Firefox's `text/x-moz-url`, if its URL is `url`. */
export function linkTextFromMozUrl(data: string, url: string): string | null {
  const [first, second] = data.split(/\r?\n/);
  if (!first || second === undefined || !sameUrl(first, url)) return null;
  return second;
}

/**
 * The title a paste or drop of `url` already carries, ready to go through
 * the same clean-up as a fetched one, or null to fetch it instead.
 */
export function copiedLinkTitle(
  data: ClipboardLinkData,
  url: string
): string | null {
  const candidates = [
    data.html ? linkTextFromHtml(data.html, url) : null,
    data.mozUrl ? linkTextFromMozUrl(data.mozUrl, url) : null,
  ];
  for (const text of candidates) {
    const useful = text === null ? null : usefulLinkText(text, url);
    if (useful) return useful;
  }
  return null;
}
