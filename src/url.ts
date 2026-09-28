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
 * Formats a URL as a markdown link destination. Unbalanced parentheses would
 * end the link early, so those URLs use the `<...>` form.
 */
export function linkDestination(url: string): string {
  let depth = 0;
  for (const ch of url) {
    if (ch === '(') depth++;
    else if (ch === ')' && --depth < 0) break;
  }
  return depth === 0 && !/[<>]/.test(url) ? url : `<${url}>`;
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
    // Straight after a quote or `=` it is an HTML attribute value, which
    // belongs to the markup around it rather than being a link of its own.
    const before = line[start - 1];
    if (before === '"' || before === "'" || before === '=') continue;
    const url = trimBareUrl(match[0]);
    if (!isUrl(url)) continue;
    found.push({ start, end: start + url.length, url });
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
