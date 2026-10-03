/**
 * URL recognition and link parsing. Kept free of Obsidian imports so the unit
 * tests can run it under plain Node.
 */

// Extensions whose URL is a file rather than a page. An image has no <title>
// to fetch, and the other files are named better by their path than by
// downloading them to find out what they are (upstream #64, #111, #164).
const IMAGE_EXTENSIONS = new Set([
  'apng',
  'avif',
  'bmp',
  'gif',
  'heic',
  'ico',
  'jpeg',
  'jpg',
  'png',
  'svg',
  'tif',
  'tiff',
  'webp',
]);

const FILE_EXTENSIONS = new Set([
  ...IMAGE_EXTENSIONS,
  '7z',
  'csv',
  'dmg',
  'doc',
  'docx',
  'epub',
  'exe',
  'flac',
  'gz',
  'iso',
  'm4a',
  'mkv',
  'mov',
  'mp3',
  'mp4',
  'ogg',
  'pdf',
  'ppt',
  'pptx',
  'rar',
  'tar',
  'tgz',
  'wav',
  'webm',
  'xls',
  'xlsx',
  'zip',
]);

/**
 * The absolute URL `text` refers to, or null if it isn't a single web URL.
 *
 * Accepts `http(s)://` URLs and bare `www.` hosts, the same inputs upstream's
 * regex did, but by parsing rather than pattern-matching the host: the regex
 * rejected hosts it didn't anticipate and let through strings `URL` refuses.
 */
export function toAbsoluteUrl(text: string): string | null {
  const trimmed = text.trim();
  if (trimmed === '' || /\s/.test(trimmed)) return null;

  let candidate = trimmed;
  if (/^www\./i.test(candidate)) {
    candidate = `https://${candidate}`;
  } else if (!/^https?:\/\//i.test(candidate)) {
    return null;
  }

  let parsed: URL;
  try {
    parsed = new URL(candidate);
  } catch {
    return null;
  }

  const host = parsed.hostname;
  const isIp = /^\d{1,3}(\.\d{1,3}){3}$/.test(host) || host.startsWith('[');
  if (host !== 'localhost' && !isIp) {
    // A dotted host with a non-empty last label, so "https://foo" and
    // "https://foo." are left alone.
    const labels = host.split('.');
    if (labels.length < 2 || labels.some((label) => label === '')) {
      return null;
    }
  }

  return candidate;
}

export function isUrl(text: string): boolean {
  return toAbsoluteUrl(text) !== null;
}

function pathExtension(url: string): string | null {
  const absolute = toAbsoluteUrl(url);
  if (!absolute) return null;
  // Only the path counts: a host like openclaw.ai is not an Adobe
  // Illustrator file (upstream #172, #175).
  const path = new URL(absolute).pathname;
  const last = path.split('/').pop() ?? '';
  const dot = last.lastIndexOf('.');
  if (dot <= 0) return null;
  return last.slice(dot + 1).toLowerCase();
}

export function isImageUrl(url: string): boolean {
  const ext = pathExtension(url);
  return ext !== null && IMAGE_EXTENSIONS.has(ext);
}

/** Whether the URL points at a file we can name without downloading. */
export function isFileUrl(url: string): boolean {
  const ext = pathExtension(url);
  return ext !== null && FILE_EXTENSIONS.has(ext);
}

/** The last non-empty path segment, decoded, e.g. "Annual report.pdf". */
export function fileNameFromUrl(url: string): string | null {
  const absolute = toAbsoluteUrl(url);
  if (!absolute) return null;
  const segments = new URL(absolute).pathname
    .split('/')
    .filter((s) => s !== '');
  const last = segments.pop();
  if (!last) return null;
  try {
    return decodeURIComponent(last);
  } catch {
    return last;
  }
}

export function hostnameOf(url: string): string {
  const absolute = toAbsoluteUrl(url);
  if (!absolute) return url;
  return new URL(absolute).hostname;
}

/**
 * Formats a URL as a markdown link destination. Unbalanced or nested
 * parentheses would end the link early, or past what the link parsers here
 * read back, and whitespace (a decoded URL can hold spaces) ends a bare
 * destination outright, so those URLs use the `<...>` form.
 */
export function linkDestination(url: string): string {
  let depth = 0;
  let deepest = 0;
  for (const ch of url) {
    if (ch === '(') deepest = Math.max(deepest, ++depth);
    else if (ch === ')' && --depth < 0) break;
  }
  const plain = depth === 0 && deepest <= 1 && !/[<>\s]/.test(url);
  return plain ? url : `<${url}>`;
}

// ASCII characters left percent-encoded when decoding a URL for display:
//
// - `%`, so decoding never creates an escape that wasn't there.
// - RFC 3986's reserved characters, `: / ? # [ ] @` and `! $ & ' ( ) * + , ;
//   =`. Encoded, they are data; decoded, they are delimiters, so decoding
//   one can change which part of the URL a character belongs to or what the
//   server receives (an encoded `&` in a query value is not a new parameter).
// - Characters that would break the markdown or HTML the URL is written
//   into, or that RFC 1738 calls unsafe: `< > " \ ^ { | }` and the backtick.
//
// Controls, whitespace other than a plain space, and invisible formatting
// characters (bidirectional overrides among them, which can make a URL read
// as something it isn't) stay encoded too; see `keepsEncoding`.
const KEEP_ENCODED = new Set('%:/?#[]@!$&\'()*+,;=<>"\\^`{|}'.split(''));

/** Whether a decoded character should be written back as its escapes. */
function keepsEncoding(ch: string): boolean {
  if (KEEP_ENCODED.has(ch)) return true;
  if (ch === ' ') return false;
  return /[\p{Cc}\p{Cf}\p{Z}]/u.test(ch);
}

/** How many bytes a UTF-8 sequence starting with `lead` has, or 0 if none. */
function sequenceLength(lead: number): number {
  if (lead < 0x80) return 1;
  if (lead >= 0xc2 && lead <= 0xdf) return 2;
  if (lead >= 0xe0 && lead <= 0xef) return 3;
  if (lead >= 0xf0 && lead <= 0xf4) return 4;
  return 0;
}

function decodeUtf8(bytes: number[]): string | null {
  try {
    // ignoreBOM keeps a byte order mark as U+FEFF; by default the decoder
    // drops it, and the escape would vanish from the URL.
    return new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(
      Uint8Array.from(bytes)
    );
  } catch {
    return null;
  }
}

/**
 * A URL with its percent-escapes decoded for reading, as in
 * `https://jisho.org/word/寿司` for `.../%E5%AF%BF%E5%8F%B8` (#6).
 *
 * Only escapes that spell valid UTF-8 are decoded; anything else, such as a
 * stray `%E5` or a Latin-1 `%E9`, stays as written. Characters for which
 * `keepsEncoding` holds stay encoded even when valid. A decoded space
 * becomes a real space, which `linkDestination` then wraps in `<...>`.
 * Punycode hosts (`xn--`) are left as they are.
 */
export function decodeUrlForDisplay(url: string): string {
  return url.replace(/(?:%[0-9a-fA-F]{2})+/g, (run) => {
    const escapes = run.split('%').slice(1);
    const bytes = escapes.map((hex) => parseInt(hex, 16));
    let out = '';
    let i = 0;
    while (i < bytes.length) {
      const length = sequenceLength(bytes[i]);
      const ch =
        length > 0 && i + length <= bytes.length
          ? decodeUtf8(bytes.slice(i, i + length))
          : null;
      if (ch === null) {
        // Not the start of a valid sequence: keep this one escape and try
        // again from the next byte.
        out += `%${escapes[i]}`;
        i += 1;
        continue;
      }
      out += keepsEncoding(ch)
        ? escapes
            .slice(i, i + length)
            .map((e) => `%${e}`)
            .join('')
        : ch;
      i += length;
    }
    return out;
  });
}

export interface LinkAtCursor {
  /** Offsets into the line, `end` exclusive. */
  start: number;
  end: number;
  url: string;
  /** Set when the URL is already the target of a `[text](url)` link. */
  text?: string;
}

// [text](url) with a URL that may hold balanced parentheses, e.g. Wikipedia's
// https://en.wikipedia.org/wiki/Mercury_(planet), or the <url> form.
const MARKDOWN_LINK =
  /\[((?:\\.|[^\]\\])*)\]\((<[^>\n]*>|[^\s()]*(?:\([^\s()]*\)[^\s()]*)*)\)/g;

// A bare URL runs to the next whitespace or angle bracket. Trailing sentence
// punctuation and an unmatched closing parenthesis are trimmed afterwards.
const BARE_URL = /(?:https?:\/\/|www\.)[^\s<>]+/gi;

function trimBareUrl(raw: string): string {
  let url = raw.replace(/[.,;:!?'"*_~]+$/, '');
  while (url.endsWith(')')) {
    const opens = url.split('(').length - 1;
    const closes = url.split(')').length - 1;
    if (closes <= opens) break;
    url = url.slice(0, -1).replace(/[.,;:!?'"*_~]+$/, '');
  }
  return url;
}

function stripAngles(dest: string): string {
  return dest.startsWith('<') && dest.endsWith('>') ? dest.slice(1, -1) : dest;
}

/** Every markdown link and bare URL on a line, in order. */
export function findLinks(line: string): LinkAtCursor[] {
  const found: LinkAtCursor[] = [];

  for (const match of line.matchAll(MARKDOWN_LINK)) {
    const url = stripAngles(match[2]);
    if (!isUrl(url)) continue;
    // An image embed ![alt](url) is not a link to retitle.
    if (match.index > 0 && line[match.index - 1] === '!') continue;
    found.push({
      start: match.index,
      end: match.index + match[0].length,
      url,
      text: match[1],
    });
  }

  for (const match of line.matchAll(BARE_URL)) {
    const start = match.index;
    if (found.some((link) => start >= link.start && start < link.end)) {
      continue;
    }
    const before = line.slice(0, start);
    // A URL that is already part of markup is left to it: an HTML attribute
    // value, the target of a link or image the pattern above didn't take
    // (one with a title, nested brackets, or an image embed), or a
    // reference definition's target.
    if (/(?:["'=]|\]\()$/.test(before)) continue;
    if (/^\s{0,3}\[[^\]]+\]:\s*$/.test(before)) continue;
    const url = trimBareUrl(match[0]);
    if (!isUrl(url)) continue;
    const end = start + url.length;
    // A <https://...> autolink is taken whole, brackets included, so it
    // becomes a titled link rather than one nested inside the brackets.
    if (before.endsWith('<') && line[end] === '>') {
      found.push({ start: start - 1, end: end + 1, url });
    } else if (!before.endsWith('<')) {
      found.push({ start, end, url });
    }
  }

  return found.sort((a, b) => a.start - b.start);
}

/**
 * The link or bare URL the cursor is on or touching.
 *
 * Upstream skipped any match at index 0 (it tested `!match.index`), so a URL
 * at the start of a line could never be enhanced.
 */
export function linkAt(line: string, ch: number): LinkAtCursor | null {
  return (
    findLinks(line).find((link) => ch >= link.start && ch <= link.end) ?? null
  );
}

/**
 * A pasted token with the angle brackets of a `<https://...>` autolink
 * removed, so it is recognized as the URL it holds (upstream #156).
 */
export function unwrapAutolink(token: string): string {
  return token.length > 2 && token.startsWith('<') && token.endsWith('>')
    ? token.slice(1, -1)
    : token;
}

function stripWww(host: string): string {
  return host.startsWith('www.') ? host.slice(4) : host;
}

/**
 * The domain an entry such as `example.com`, `*.example.com`,
 * `https://www.example.com/` or `localhost:3000` names, or null if it isn't
 * a bare domain (it has a path, spaces, or no dot and isn't localhost).
 */
export function domainOf(entry: string): string | null {
  const bare = entry
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, '')
    .replace(/^\*\./, '')
    .replace(/\/$/, '');
  if (!/^[a-z0-9.-]+(?::\d+)?$/.test(bare)) return null;
  if (!bare.includes('.') && !bare.startsWith('localhost')) return null;
  return stripWww(bare.replace(/:\d+$/, ''));
}

/**
 * Whether a URL is on `domain` or one of its subdomains, so `x.com` matches
 * x.com and www.x.com but not netflix.com. `domain` is what `domainOf`
 * returns.
 */
export function hostMatchesDomain(url: string, domain: string): boolean {
  const absolute = toAbsoluteUrl(url);
  if (!absolute) return false;
  const host = stripWww(new URL(absolute).hostname.toLowerCase());
  return host === domain || host.endsWith(`.${domain}`);
}

export interface TitleOntoUrl {
  /** The URL the pasted text becomes the title of. */
  url: string;
  /** The pasted text, trimmed. */
  title: string;
  /** Whitespace selected around the URL, kept where it was. */
  before: string;
  after: string;
}

/**
 * Whether pasting `clipboard` over `selection` should make the pasted text
 * the title of the selected URL (issue #7): the selection is one URL, bare
 * or a `<url>` autolink, or one whole `[text](url)` link, and the clipboard
 * is a single line of text that isn't itself a URL. Anything else is an
 * ordinary paste, including a URL pasted over a URL.
 */
export function titleOntoUrl(
  selection: string,
  clipboard: string
): TitleOntoUrl | null {
  const title = clipboard.trim();
  if (title === '' || /[\r\n]/.test(title)) return null;
  const tokens = title.split(/\s+/);
  if (tokens.every((t) => toAbsoluteUrl(unwrapAutolink(t)) !== null)) {
    return null;
  }

  const core = selection.trim();
  if (core === '') return null;
  const before = selection.slice(0, selection.indexOf(core));
  const after = selection.slice(before.length + core.length);

  const bare = toAbsoluteUrl(unwrapAutolink(core));
  if (bare) return { url: bare, title, before, after };

  const links = findLinks(core);
  const [link] = links;
  if (
    links.length === 1 &&
    link.text !== undefined &&
    link.start === 0 &&
    link.end === core.length
  ) {
    const url = toAbsoluteUrl(link.url);
    if (url) return { url, title, before, after };
  }
  return null;
}
