/**
 * Rendering a finished link from a format template such as
 * `[{title}]({url})` (upstream #53, #96, #127, #139). No Obsidian imports, so
 * the unit tests can run it under plain Node.
 *
 * Each placeholder is escaped for the part of the template it sits in, found
 * by reading the template left to right:
 *
 * - **text**: anywhere outside the parts below, including the text of a
 *   markdown link and the content between HTML tags. Markdown escaping, the
 *   same as titles have always had, so markup in a title renders as text.
 *   A URL is the exception: written bare, it is autolinked as it stands.
 * - **destination**: inside the `(...)` after `](`, before any quote. The URL
 *   gets the same treatment as a link's target always has; other values are
 *   percent-encoded so they can't end the destination.
 * - **link title**: inside a quoted title in a markdown destination, such as
 *   `({url} "{title}")`. The quote and backslash are escaped.
 * - **attribute**: inside a quoted attribute value of an HTML tag. HTML
 *   escaping, so a quote or `>` in a title can't end the attribute or tag.
 * - **tag**: inside an HTML tag but not in a quoted value. No escaping makes
 *   a title safe there, so {@link validateTemplate} rejects it, and rendering
 *   percent-encodes as a last resort.
 */
import { escapeMarkdown } from './title';
import { linkDestination } from './url';

export type LinkFormat = 'markdown' | 'markdown-title' | 'html' | 'custom';

export const LINK_FORMATS: Record<Exclude<LinkFormat, 'custom'>, string> = {
  markdown: '[{title}]({url})',
  'markdown-title': '[{title}]({url} "{title}")',
  html: '<a href="{url}">{title}</a>',
};

export const DEFAULT_TEMPLATE = LINK_FORMATS.markdown;

const PLACEHOLDERS = [
  'title',
  'url',
  'domain',
  'author',
  'site',
  'description',
  'section',
  'date',
] as const;
type Placeholder = (typeof PLACEHOLDERS)[number];

/** The placeholders whose values come from fetching the page. */
const PAGE_PLACEHOLDERS: readonly Placeholder[] = [
  'title',
  'author',
  'site',
  'description',
  'section',
];

/** `{date}` with no format of its own. */
export const DEFAULT_DATE_FORMAT = 'YYYY-MM-DD';

type Context = 'text' | 'destination' | 'linkTitle' | 'attribute' | 'tag';

interface Piece {
  literal?: string;
  placeholder?: Placeholder;
  /** Any `{name}`, known or not, so validation can report unknown ones. */
  name?: string;
  /** What follows the colon in `{name:format}`, or undefined if none. */
  format?: string;
  context: Context;
  /** The quote character a link title or attribute value is enclosed in. */
  quote?: string;
  /**
   * Whether the placeholder follows a `<`, as in `](<{url}>)` or a `<{url}>`
   * autolink, where backslash escapes aren't read and only the brackets
   * themselves need encoding.
   */
  angled?: boolean;
}

function isPlaceholder(name: string): name is Placeholder {
  return (PLACEHOLDERS as readonly string[]).includes(name);
}

/** Splits a template into literal runs and placeholders with their context. */
function parse(template: string): Piece[] {
  const pieces: Piece[] = [];
  let context: Context = 'text';
  let quote = '';
  let literal = '';

  const flush = () => {
    if (literal !== '') pieces.push({ literal, context });
    literal = '';
  };

  for (let i = 0; i < template.length; i++) {
    const ch = template[i];

    const name = /^\{([a-zA-Z]+)(?::([^{}\n]*))?\}/.exec(template.slice(i));
    if (name) {
      flush();
      pieces.push({
        name: name[1],
        format: name[2],
        placeholder: isPlaceholder(name[1]) ? name[1] : undefined,
        context,
        quote: quote || undefined,
        angled: template[i - 1] === '<',
      });
      i += name[0].length - 1;
      continue;
    }

    literal += ch;
    // A literal stays within one context, so tidying around an empty value
    // can tell link text from the destination after it. The characters that
    // switch contexts stay with the context they close.
    const before: Context = context;
    switch (context) {
      case 'text':
        if (ch === ']' && template[i + 1] === '(') {
          literal += '(';
          i++;
          context = 'destination';
        } else if (ch === '<' && /[a-zA-Z]/.test(template[i + 1] ?? '')) {
          context = 'tag';
        }
        break;
      case 'destination':
        if (ch === '"' || ch === "'") {
          quote = ch;
          context = 'linkTitle';
        } else if (ch === ')') {
          context = 'text';
        }
        break;
      case 'linkTitle':
        if (ch === quote) {
          quote = '';
          context = 'destination';
        }
        break;
      case 'tag':
        if (ch === '"' || ch === "'") {
          quote = ch;
          context = 'attribute';
        } else if (ch === '>') {
          context = 'text';
        }
        break;
      case 'attribute':
        if (ch === quote) {
          quote = '';
          context = 'tag';
        }
        break;
    }
    if (context !== before && literal !== '') {
      pieces.push({ literal, context: before });
      literal = '';
    }
  }
  flush();
  return pieces;
}

export type TemplateError =
  | { code: 'missingUrl' }
  | { code: 'unknownPlaceholder'; name: string }
  | { code: 'unquotedInTag'; name: string }
  | { code: 'emptyDateFormat' };

/** `{name}`, or `{name:format}`, as the template wrote it. */
function written(piece: Piece): string {
  return piece.format === undefined
    ? (piece.name ?? '')
    : `${piece.name}:${piece.format}`;
}

/** Why a template can't be used, or null if it can. */
export function validateTemplate(template: string): TemplateError | null {
  const pieces = parse(template);
  for (const piece of pieces) {
    if (piece.name === undefined) continue;
    // Only {date} takes a format.
    if (
      !piece.placeholder ||
      (piece.format !== undefined && piece.placeholder !== 'date')
    ) {
      return { code: 'unknownPlaceholder', name: written(piece) };
    }
    if (piece.placeholder === 'date' && piece.format?.trim() === '') {
      return { code: 'emptyDateFormat' };
    }
    if (piece.context === 'tag') {
      return { code: 'unquotedInTag', name: piece.name };
    }
  }
  if (!pieces.some((piece) => piece.placeholder === 'url')) {
    return { code: 'missingUrl' };
  }
  return null;
}

/** Whether the template shows a title. */
export function needsTitle(template: string): boolean {
  return parse(template).some((piece) => piece.placeholder === 'title');
}

/** Something a page says about itself, other than its title. */
export type PageField = 'author' | 'site' | 'description' | 'section';

const PAGE_FIELDS: readonly PageField[] = [
  'author',
  'site',
  'description',
  'section',
];

/**
 * The page fields the template shows besides the title, so a lookup can
 * tell which of them it has to find.
 */
export function pageFieldsIn(template: string): PageField[] {
  const shown = new Set<PageField>();
  for (const piece of parse(template)) {
    const name = piece.placeholder as PageField | undefined;
    if (name && PAGE_FIELDS.includes(name)) shown.add(name);
  }
  return [...shown];
}

/**
 * Whether rendering the template needs the page fetched at all: it shows the
 * title, author, site, description or section. `{date}`, `{url}` and
 * `{domain}` don't need it.
 */
export function needsPageInfo(template: string): boolean {
  return parse(template).some(
    (piece) =>
      piece.placeholder !== undefined &&
      PAGE_PLACEHOLDERS.includes(piece.placeholder)
  );
}

/**
 * The template the settings select. An invalid custom template, which the
 * settings tab should already have refused, falls back to the default
 * rather than writing broken markup.
 */
export function templateFor(settings: {
  linkFormat: LinkFormat;
  customLinkFormat: string;
}): string {
  if (settings.linkFormat === 'custom') {
    return validateTemplate(settings.customLinkFormat) === null
      ? settings.customLinkFormat
      : DEFAULT_TEMPLATE;
  }
  return LINK_FORMATS[settings.linkFormat] ?? DEFAULT_TEMPLATE;
}

export function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * Selected text as link text. The user's own markdown is kept, but brackets
 * that don't pair up would end the link text early or leave it open, so then
 * every bracket is escaped.
 */
export function selectionAsLinkText(selection: string): string {
  let depth = 0;
  let balanced = true;
  for (let i = 0; i < selection.length; i++) {
    const ch = selection[i];
    if (ch === '\\') i++;
    else if (ch === '[') depth++;
    else if (ch === ']' && --depth < 0) balanced = false;
  }
  if (balanced && depth === 0) return selection;
  let out = '';
  for (let i = 0; i < selection.length; i++) {
    const ch = selection[i];
    if (ch === '\\') {
      out += ch + (selection[i + 1] ?? '');
      i++;
    } else {
      out += ch === '[' || ch === ']' ? `\\${ch}` : ch;
    }
  }
  return out;
}

export interface LinkValues {
  /** The title as it should read: cleaned and shortened, but not escaped. */
  title: string;
  url: string;
  /**
   * Set when the title is text the user selected, which may hold markdown
   * of their own to keep rather than escape.
   */
  titleIsMarkdown?: boolean;
  /** The rest of what the page says about itself; missing ones render empty. */
  author?: string | null;
  site?: string | null;
  description?: string | null;
  section?: string | null;
  /**
   * Formats the moment the link is written with a moment.js-style format.
   * The plugin passes Obsidian's bundled moment; without one, `{date}` is the
   * local ISO date whatever its format says, which only tests rely on.
   */
  formatDate?: (format: string) => string;
}

/** Today in the local time zone, as YYYY-MM-DD. */
export function localIsoDate(now = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

function domainOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./i, '');
  } catch {
    return url;
  }
}

/**
 * Percent-encodes a value for a URL. encodeURIComponent leaves parentheses
 * alone, and a `)` would end a markdown destination early.
 */
function encodeValue(value: string): string {
  return encodeURIComponent(value).replace(
    /[()]/g,
    (ch) => `%${ch.charCodeAt(0).toString(16).toUpperCase()}`
  );
}

function encodeAngles(url: string): string {
  return url.replace(/</g, '%3C').replace(/>/g, '%3E');
}

function escapeFor(
  piece: Piece,
  name: Placeholder,
  value: string,
  values: LinkValues
): string {
  switch (piece.context) {
    case 'text':
      // A bare URL in text is autolinked as written. Escaping it would put
      // the backslashes into the link: Obsidian renders a\_b as a%5C_b. A
      // space, which a decoded URL can hold, would end the autolink, so it
      // goes back to %20 here.
      if (name === 'url') {
        const bare = value.replace(/ /g, '%20');
        return piece.angled ? encodeAngles(bare) : bare;
      }
      return name === 'title' && values.titleIsMarkdown
        ? selectionAsLinkText(value)
        : escapeMarkdown(value);
    case 'destination':
      if (name === 'url') {
        // Already inside the user's own <...>: only the brackets need
        // encoding. Otherwise the URL picks its own form.
        return piece.angled ? encodeAngles(value) : linkDestination(value);
      }
      return encodeValue(value);
    case 'linkTitle':
      return value
        .replace(/\\/g, '\\\\')
        .replace(
          new RegExp(piece.quote ?? '"', 'g'),
          `\\${piece.quote ?? '"'}`
        );
    case 'attribute':
      return escapeHtml(value);
    case 'tag':
      return encodeValue(value);
  }
}

// A separator between two values: a hyphen, dash, bar, middle dot, bullet,
// colon, comma, slash, guillemet or arrow (as in "Page › Section"), with any
// spaces around it. A plain > isn't one: in `<{url}> {author}` it closes the
// autolink.
const SEPARATOR = String.raw`\s*(?:[-|·•:,/›»→]|–|—)\s*`;
const SEPARATOR_AT_END = new RegExp(`${SEPARATOR}$`, 'u');
const SEPARATOR_AT_START = new RegExp(`^${SEPARATOR}`, 'u');

interface Rendered {
  text: string;
  context: Context;
  /** A placeholder whose value came out empty. */
  empty: boolean;
}

/**
 * Tidies the text around values that came out empty, such as a page with no
 * author, so a template like `{title} - {author}` doesn't leave `Title - `.
 * For each empty value, in text and quoted link titles only:
 *
 * 1. Wrapped in parentheses, as in ` ({author})`, the parentheses and the
 *    space before them go.
 * 2. Otherwise one separator next to it goes: the one just before it if
 *    there is one (`{title} - {author}`), else the one just after it
 *    (`{author}: {title}`).
 * 3. Otherwise, a space on both sides becomes one space.
 *
 * Only the literal text right next to the empty value changes; the rest of
 * the template is written as it stands.
 */
function collapseEmpty(parts: Rendered[]): void {
  parts.forEach((part, i) => {
    if (!part.empty) return;
    if (part.context !== 'text' && part.context !== 'linkTitle') return;
    const sameContext = (other: Rendered | undefined) =>
      other !== undefined && !other.empty && other.context === part.context;
    const before = sameContext(parts[i - 1]) ? parts[i - 1] : undefined;
    const after = sameContext(parts[i + 1]) ? parts[i + 1] : undefined;

    if (
      before &&
      after &&
      /\s*\($/.test(before.text) &&
      after.text.startsWith(')')
    ) {
      before.text = before.text.replace(/\s*\($/, '');
      after.text = after.text.slice(1);
    } else if (before && SEPARATOR_AT_END.test(before.text)) {
      before.text = before.text.replace(SEPARATOR_AT_END, '');
    } else if (after && SEPARATOR_AT_START.test(after.text)) {
      after.text = after.text.replace(SEPARATOR_AT_START, '');
    } else if (
      before &&
      after &&
      /\s$/.test(before.text) &&
      /^\s/.test(after.text)
    ) {
      after.text = after.text.replace(/^\s+/, '');
    }
  });
}

/** Renders a finished link from a template that passes validation. */
export function renderLink(template: string, values: LinkValues): string {
  const date = (format: string | undefined) =>
    values.formatDate
      ? values.formatDate(format ?? DEFAULT_DATE_FORMAT)
      : localIsoDate();
  const raw = (name: Placeholder, format: string | undefined): string => {
    switch (name) {
      case 'title':
        return values.title;
      case 'url':
        return values.url;
      case 'domain':
        return domainOf(values.url);
      case 'author':
        return values.author ?? '';
      case 'site':
        return values.site ?? '';
      case 'description':
        return values.description ?? '';
      case 'section':
        return values.section ?? '';
      case 'date':
        return date(format);
    }
  };

  const parts: Rendered[] = parse(template).map((piece) => {
    if (piece.literal !== undefined) {
      return { text: piece.literal, context: piece.context, empty: false };
    }
    const name = piece.placeholder;
    // Unknown placeholders are left as written; validation reports them.
    if (!name) {
      return {
        text: `{${written(piece)}}`,
        context: piece.context,
        empty: false,
      };
    }
    const value = raw(name, piece.format);
    return {
      text: escapeFor(piece, name, value, values),
      context: piece.context,
      empty: value === '' && name !== 'url',
    };
  });
  collapseEmpty(parts);
  return parts.map((part) => part.text).join('');
}
