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

const PLACEHOLDERS = ['title', 'url', 'domain'] as const;
type Placeholder = (typeof PLACEHOLDERS)[number];

type Context = 'text' | 'destination' | 'linkTitle' | 'attribute' | 'tag';

interface Piece {
  literal?: string;
  placeholder?: Placeholder;
  /** Any `{name}`, known or not, so validation can report unknown ones. */
  name?: string;
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

    const name = /^\{([a-zA-Z]+)\}/.exec(template.slice(i));
    if (name) {
      flush();
      pieces.push({
        name: name[1],
        placeholder: isPlaceholder(name[1]) ? name[1] : undefined,
        context,
        quote: quote || undefined,
        angled: template[i - 1] === '<',
      });
      i += name[0].length - 1;
      continue;
    }

    literal += ch;
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
  }
  flush();
  return pieces;
}

export type TemplateError =
  | { code: 'missingUrl' }
  | { code: 'unknownPlaceholder'; name: string }
  | { code: 'unquotedInTag'; name: string };

/** Why a template can't be used, or null if it can. */
export function validateTemplate(template: string): TemplateError | null {
  const pieces = parse(template);
  for (const piece of pieces) {
    if (piece.name === undefined) continue;
    if (!piece.placeholder) {
      return { code: 'unknownPlaceholder', name: piece.name };
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

/** Whether rendering the template needs a fetched title at all. */
export function needsTitle(template: string): boolean {
  return parse(template).some((piece) => piece.placeholder === 'title');
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
      // the backslashes into the link: Obsidian renders a\_b as a%5C_b.
      if (name === 'url') return piece.angled ? encodeAngles(value) : value;
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

/** Renders a finished link from a template that passes validation. */
export function renderLink(template: string, values: LinkValues): string {
  const raw: Record<Placeholder, string> = {
    title: values.title,
    url: values.url,
    domain: domainOf(values.url),
  };
  return parse(template)
    .map((piece) => {
      if (piece.literal !== undefined) return piece.literal;
      const name = piece.placeholder;
      // Unknown placeholders are left as written; validation reports them.
      if (!name) return `{${piece.name}}`;
      return escapeFor(piece, name, raw[name], values);
    })
    .join('');
}
