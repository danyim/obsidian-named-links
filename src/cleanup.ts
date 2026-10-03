/**
 * Optional clean-up of a fetched title before it becomes link text: dropping
 * the site's name, and the user's own find/replace rules (upstream #23, #80,
 * #84, #115, #151). No Obsidian imports, so the unit tests run it directly.
 */
import { cleanTitle } from './title';
import { toAbsoluteUrl } from './url';

// Separators sites put between a page's name and their own: a bar, a hyphen,
// an en dash, an em dash, a middle dot, a bullet, a double colon and a
// guillemet. Only with spaces around them, so a hyphenated word or a "C|C++"
// isn't split.
const SEPARATORS = [
  ' | ',
  ' - ',
  ' \u2013 ',
  ' \u2014 ',
  ' · ',
  ' • ',
  ' :: ',
  ' » ',
];

// Second-level labels under a country code that are part of the suffix, as
// in bbc.co.uk or abc.net.au, rather than the site's own name.
const SECOND_LEVEL = new Set([
  'ac',
  'co',
  'com',
  'edu',
  'gov',
  'ne',
  'net',
  'or',
  'org',
]);

/** Lowercase letters and digits only, in any script. */
function normalize(text: string): string {
  return text.toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');
}

function words(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter((w) => w !== '');
}

/**
 * The ways a title segment may spell a site's name: as written, without a
 * leading "The", and abbreviated, so "The New York Times" also reads as
 * "nytimes" (initials then the last word) and "Wall Street Journal" as
 * "wsj" (all initials).
 */
function segmentForms(segment: string): string[] {
  let w = words(segment);
  const forms = [w.join('')];
  if (w.length > 1 && w[0] === 'the') {
    w = w.slice(1);
    forms.push(w.join(''));
  }
  if (w.length > 1) {
    const initials = w.map((x) => x[0]);
    forms.push(initials.slice(0, -1).join('') + w[w.length - 1]);
    forms.push(initials.join(''));
  }
  return forms.filter((f) => f !== '');
}

/** The registrable name of a URL's host: "nytimes" for www.nytimes.com. */
export function hostLabel(url: string): string | null {
  const absolute = toAbsoluteUrl(url);
  if (!absolute) return null;
  const host = new URL(absolute).hostname.toLowerCase();
  // An IP address names no site.
  if (/^[\d.]+$/.test(host) || host.startsWith('[')) return null;
  const labels = host.split('.');
  if (labels.length < 2) return null;
  labels.pop();
  const last = labels[labels.length - 1];
  if (labels.length > 1 && SECOND_LEVEL.has(last)) labels.pop();
  return labels.pop() ?? null;
}

/** Normalized names a segment is compared with. */
function siteCandidates(siteName: string | null, url: string): string[] {
  const candidates: string[] = [];
  if (siteName) {
    // As declared, and without a leading "The", but not abbreviated: an
    // abbreviation of the declared name would match too loosely.
    const w = words(siteName);
    candidates.push(w.join(''));
    if (w.length > 1 && w[0] === 'the') candidates.push(w.slice(1).join(''));
  }
  const label = hostLabel(url);
  if (label) candidates.push(normalize(label));
  return candidates.filter((c) => c.length > 0);
}

/**
 * Whether a title segment names the site. A form of the segment has to equal
 * a candidate. With `allowPrefix`, starting with one at least three
 * characters long is enough too, so a trailing "BBC News" matches bbc.com;
 * a leading segment gets no such leeway, since that is where a site puts its
 * own product names ("GitHub Copilot · Your AI pair programmer · GitHub"). A
 * segment is never matched for being contained in a longer name: on
 * rust-lang.org, "Rust" in "Rust - The Rust Programming Language" is the
 * page's subject, not the site.
 */
function namesSite(
  segment: string,
  candidates: string[],
  allowPrefix: boolean
): boolean {
  return segmentForms(segment).some((form) =>
    candidates.some(
      (c) => form === c || (allowPrefix && c.length >= 3 && form.startsWith(c))
    )
  );
}

function lastSeparator(
  title: string
): { index: number; length: number } | null {
  let best: { index: number; length: number } | null = null;
  for (const sep of SEPARATORS) {
    const index = title.lastIndexOf(sep);
    if (index > 0 && (!best || index > best.index)) {
      best = { index, length: sep.length };
    }
  }
  return best;
}

function firstSeparator(
  title: string
): { index: number; length: number } | null {
  let best: { index: number; length: number } | null = null;
  for (const sep of SEPARATORS) {
    const index = title.indexOf(sep);
    if (index > 0 && (!best || index < best.index)) {
      best = { index, length: sep.length };
    }
  }
  return best;
}

/**
 * Drops the site's name from the end of a title, then from the start: "Video
 * - YouTube" becomes "Video", "GitHub - owner/repo: About" becomes
 * "owner/repo: About". `siteName` is the name the page declares, if any; the
 * URL's host stands in for it otherwise. A title that is nothing but the
 * site's name is left whole.
 */
export function removeSiteName(
  title: string,
  siteName: string | null,
  url: string
): string {
  const candidates = siteCandidates(siteName, url);
  if (candidates.length === 0) return title;

  let result = title;
  const tail = lastSeparator(result);
  if (
    tail &&
    namesSite(result.slice(tail.index + tail.length), candidates, true)
  ) {
    result = result.slice(0, tail.index);
  }
  const head = firstSeparator(result);
  if (head && namesSite(result.slice(0, head.index), candidates, false)) {
    result = result.slice(head.index + head.length);
  }

  result = result.trim();
  return result === '' ? title : result;
}

export interface TitleRule {
  pattern: RegExp;
  replacement: string;
}

export type RuleProblem =
  | { line: number; kind: 'missingArrow' }
  | { line: number; kind: 'emptyPattern' }
  | { line: number; kind: 'invalidRegex'; message: string };

export interface ParsedRules {
  rules: TitleRule[];
  /** Lines that couldn't be read as a rule, 1-based. */
  problems: RuleProblem[];
}

const REGEX_LITERAL = /^\/(.+)\/([a-z]*)$/s;

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Reads the find/replace rules setting: one `pattern => replacement` per
 * line. A pattern written `/.../flags` is a regular expression; anything else
 * is literal text, replaced wherever it appears. Spaces around `=>` are
 * ignored, and blank lines and lines starting with `#` are skipped.
 */
export function parseTitleRules(text: string): ParsedRules {
  const rules: TitleRule[] = [];
  const problems: RuleProblem[] = [];

  text.split(/\r?\n/).forEach((raw, i) => {
    const lineNumber = i + 1;
    const line = raw.trim();
    if (line === '' || line.startsWith('#')) return;

    const arrow = line.indexOf('=>');
    if (arrow < 0) {
      problems.push({ line: lineNumber, kind: 'missingArrow' });
      return;
    }
    const source = line.slice(0, arrow).trim();
    const replacement = line.slice(arrow + 2).trim();
    if (source === '') {
      problems.push({ line: lineNumber, kind: 'emptyPattern' });
      return;
    }

    const literal = REGEX_LITERAL.exec(source);
    if (!literal) {
      rules.push({
        pattern: new RegExp(escapeRegExp(source), 'g'),
        replacement,
      });
      return;
    }
    try {
      rules.push({ pattern: new RegExp(literal[1], literal[2]), replacement });
    } catch (e) {
      problems.push({
        line: lineNumber,
        kind: 'invalidRegex',
        message: (e as Error).message,
      });
    }
  });

  return { rules, problems };
}

/**
 * Runs the rules over a title in order. A literal pattern replaces every
 * occurrence; a regular expression follows its own flags, so it needs `g` to
 * replace more than the first match. If the rules leave nothing, the title is
 * kept as it was before them.
 */
export function applyTitleRules(title: string, rules: TitleRule[]): string {
  let result = title;
  for (const rule of rules) {
    rule.pattern.lastIndex = 0;
    result = result.replace(rule.pattern, rule.replacement);
  }
  result = cleanTitle(result);
  return result === '' ? title : result;
}

export interface CleanupOptions {
  url: string;
  siteName: string | null;
  removeSiteName: boolean;
  rules: string;
}

/**
 * Everything the settings ask for between fetching a title and shortening and
 * escaping it: whitespace clean-up, then the site's name, then the rules.
 */
export function cleanupTitle(raw: string, options: CleanupOptions): string {
  let title = cleanTitle(raw);
  if (options.removeSiteName) {
    title = removeSiteName(title, options.siteName, options.url);
  }
  const { rules } = parseTitleRules(options.rules);
  return rules.length > 0 ? applyTitleRules(title, rules) : title;
}
