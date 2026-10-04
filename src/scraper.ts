/**
 * Finds a page's title, and what else a link format can show about it, from
 * its HTML, without running any of the page.
 *
 * Upstream loaded the page in a hidden Electron BrowserWindow with
 * nodeIntegration on and webSecurity off, which handed every pasted site's
 * scripts Node access inside Obsidian, played its media, and could leave the
 * window running (upstream #164, #177). Reading the HTML as data rules all of
 * that out, and also works on mobile.
 *
 * The HTTP call is injected so this module has no Obsidian imports and the
 * unit tests can run it under Node.
 */
import { cleanTitle } from './title';
import { fileNameFromUrl, hostnameOf, isFileUrl, toAbsoluteUrl } from './url';

export interface HttpRequest {
  url: string;
  method: 'GET' | 'HEAD';
  headers: Record<string, string>;
}

export interface HttpResponse {
  status: number;
  headers: Record<string, string>;
  /** Read lazily: a HEAD response has no body to decode. */
  body: () => ArrayBuffer;
}

export type HttpClient = (request: HttpRequest) => Promise<HttpResponse>;

export interface OEmbedProvider {
  pattern: RegExp;
  endpoint: string;
}

export interface FetchTitleOptions {
  http: HttpClient;
  /** Sent as Accept-Language so sites answer in the user's language. */
  language?: string;
  /** Look X posts up through FxTwitter instead of x.com. */
  twitterProxy?: boolean;
  /** Replaces the built-in oEmbed providers; the e2e suite points it locally. */
  oEmbedProviders?: OEmbedProvider[];
}

/**
 * What a page says about itself. Only the title is required; a page without
 * one counts as no answer at all. The rest feed the link format's other
 * placeholders and the title clean-up, and are null when the page is silent.
 */
export interface PageInfo {
  title: string;
  /** `og:site_name`, `application-name`, or oEmbed's `provider_name`. */
  siteName: string | null;
  /** oEmbed's `author_name` (a video's channel), or the author meta tags. */
  author: string | null;
  /** The Open Graph, standard or Twitter description. */
  description: string | null;
  /** The text of the heading the URL's `#fragment` points at. */
  section: string | null;
}

// Some sites refuse requests that don't look like a browser (upstream #171).
const USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36';

// Interstitials served instead of the page. Their title names the gate, not
// the page, so it is better to report no title than to insert it.
const CHALLENGE_TITLES = [
  /^just a moment\.*$/i,
  /^attention required!? \| cloudflare$/i,
  /^please wait\.* \| cloudflare$/i,
  /^checking your browser/i,
  /^access denied$/i,
  /^ddos-guard$/i,
];

// Sites whose HTML title is missing or generic without JavaScript, but that
// publish the real one through oEmbed.
const OEMBED_PROVIDERS: OEmbedProvider[] = [
  {
    pattern:
      /^https?:\/\/(?:(?:www|m|music)\.)?(?:youtube\.com\/(?:watch|shorts\/|live\/|playlist)|youtu\.be\/)/i,
    endpoint: 'https://www.youtube.com/oembed',
  },
  {
    pattern: /^https?:\/\/(?:www\.|player\.)?vimeo\.com\//i,
    endpoint: 'https://vimeo.com/api/oembed.json',
  },
  {
    pattern: /^https?:\/\/open\.spotify\.com\//i,
    endpoint: 'https://open.spotify.com/oembed',
  },
  {
    pattern: /^https?:\/\/(?:www\.|m\.)?soundcloud\.com\//i,
    endpoint: 'https://soundcloud.com/oembed',
  },
];

const TWITTER_HOSTS: Record<string, string> = {
  'twitter.com': 'fxtwitter.com',
  'www.twitter.com': 'fxtwitter.com',
  'mobile.twitter.com': 'fxtwitter.com',
  'x.com': 'fixupx.com',
  'www.x.com': 'fixupx.com',
  'mobile.x.com': 'fixupx.com',
};

/**
 * The FxTwitter mirror of a twitter.com or x.com URL, or null for any other
 * URL. X serves a page with no title to a client that doesn't run its
 * JavaScript, while FxTwitter answers with the post's metadata. Borrowed from
 * yuu1111/obsidian-auto-link-title.
 */
export function twitterProxyUrl(url: string): string | null {
  const parsed = new URL(url);
  const mirror = TWITTER_HOSTS[parsed.hostname.toLowerCase()];
  if (!mirror) return null;
  parsed.hostname = mirror;
  return parsed.toString();
}

// FxTwitter only answers with metadata to clients it recognizes as link
// preview bots; to anything that looks like a browser it redirects to X.
const LINK_PREVIEW_USER_AGENT =
  'ObsidianLinkPreview/1.0 (+https://obsidian.md)';

function header(res: HttpResponse, name: string): string | undefined {
  const wanted = name.toLowerCase();
  for (const key of Object.keys(res.headers)) {
    if (key.toLowerCase() === wanted) return res.headers[key];
  }
  return undefined;
}

function isHtml(contentType: string | undefined): boolean {
  // No content type at all: assume a page, as a browser would sniff it.
  if (!contentType) return true;
  return /text\/html|application\/xhtml\+xml/i.test(contentType);
}

function charsetOf(contentType: string | undefined): string | null {
  const match = contentType?.match(/charset\s*=\s*["']?([\w.:-]+)/i);
  return match ? match[1] : null;
}

/**
 * Decodes an HTML body using the charset the server or the document declares.
 * Decoding everything as UTF-8 garbled GBK and other legacy encodings
 * (upstream #133).
 */
export function decodeHtml(
  body: ArrayBuffer,
  contentType: string | undefined
): string {
  const bytes = new Uint8Array(body);
  let charset = charsetOf(contentType);

  if (!charset) {
    if (bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) {
      charset = 'utf-8';
    } else if (bytes[0] === 0xff && bytes[1] === 0xfe) {
      charset = 'utf-16le';
    } else if (bytes[0] === 0xfe && bytes[1] === 0xff) {
      charset = 'utf-16be';
    } else {
      // A <meta> charset has to appear in the first 1024 bytes per the HTML
      // spec; read a little more for pages that don't quite comply. Latin-1
      // maps every byte, so the ASCII of the tag survives any real encoding.
      const head = new TextDecoder('latin1').decode(bytes.slice(0, 4096));
      const meta =
        head.match(/<meta[^>]+charset\s*=\s*["']?\s*([\w.:-]+)/i) ?? null;
      charset = meta ? meta[1] : null;
    }
  }

  try {
    return new TextDecoder(charset ?? 'utf-8').decode(bytes);
  } catch {
    return new TextDecoder('utf-8').decode(bytes);
  }
}

function usable(title: string | null | undefined): string | null {
  if (!title) return null;
  const cleaned = cleanTitle(title);
  if (cleaned === '') return null;
  if (CHALLENGE_TITLES.some((re) => re.test(cleaned))) return null;
  return cleaned;
}

/** Whitespace collapsed, or null if nothing is left. */
function text(value: string | null | undefined): string | null {
  if (!value) return null;
  const cleaned = cleanTitle(value);
  return cleaned === '' ? null : cleaned;
}

function parseHtml(html: string): Document {
  return new DOMParser().parseFromString(html, 'text/html');
}

function metaContent(doc: Document, selector: string): string | null {
  return doc.querySelector(selector)?.getAttribute('content') ?? null;
}

function titleOf(doc: Document, preferOpenGraph: boolean): string | null {
  // An inline <svg> can carry its own <title> ahead of or instead of the
  // document's.
  const titleEl = Array.from(doc.querySelectorAll('title')).find(
    (el) => !el.closest('svg')
  );
  const documentTitle = preferOpenGraph ? null : usable(titleEl?.textContent);
  return (
    documentTitle ??
    usable(metaContent(doc, 'meta[property="og:title"]')) ??
    usable(metaContent(doc, 'meta[name="og:title"]')) ??
    usable(metaContent(doc, 'meta[name="twitter:title"]')) ??
    usable(metaContent(doc, 'meta[property="twitter:title"]')) ??
    usable(titleEl?.textContent)
  );
}

function siteNameOf(doc: Document): string | null {
  return (
    usable(metaContent(doc, 'meta[property="og:site_name"]')) ??
    usable(metaContent(doc, 'meta[name="og:site_name"]')) ??
    usable(metaContent(doc, 'meta[name="application-name"]'))
  );
}

function authorOf(doc: Document): string | null {
  // article:author is often a profile URL rather than a name, which would
  // read badly as text.
  const article = text(metaContent(doc, 'meta[property="article:author"]'));
  return (
    text(metaContent(doc, 'meta[name="author"]')) ??
    (article && !/^https?:\/\//i.test(article) ? article : null)
  );
}

function descriptionOf(doc: Document): string | null {
  return (
    text(metaContent(doc, 'meta[property="og:description"]')) ??
    text(metaContent(doc, 'meta[name="description"]')) ??
    text(metaContent(doc, 'meta[name="twitter:description"]')) ??
    text(metaContent(doc, 'meta[property="twitter:description"]'))
  );
}

const HEADING = 'h1, h2, h3, h4, h5, h6';

// What a fragment may be written as: raw, percent-decoded, and with `+` for a
// space, as Obsidian Publish writes them (upstream #130).
function fragmentForms(fragment: string): string[] {
  const forms = [fragment];
  try {
    forms.push(decodeURIComponent(fragment));
  } catch {
    // A stray % leaves only the raw form.
  }
  for (const form of [...forms]) forms.push(form.replace(/\+/g, ' '));
  return [...new Set(forms)];
}

// Fragments made from heading text: case, spaces, `+`, `-` and `_` don't
// matter.
function looseKey(value: string): string {
  return value
    .toLowerCase()
    .replace(/[\s+_-]+/g, ' ')
    .trim();
}

// Permalink markers sites put next to a heading's text.
const PERMALINK_MARKS = /^[#¶§🔗\s]+|[#¶§🔗\s]+$/gu;

function headingText(el: Element): string | null {
  const cleaned = text(el.textContent);
  if (!cleaned) return null;
  return text(cleaned.replace(PERMALINK_MARKS, ''));
}

// A target that isn't a heading only names its section if it is this short.
const MAX_SECTION_LENGTH = 120;

/**
 * The text of the heading a URL's `#fragment` points at (upstream #130): the
 * element whose `id`, or an `<a name>`, matches the fragment, and the heading
 * it is, sits in, holds, or comes right before. Pages whose headings carry no
 * id in their HTML are matched on the heading's own text instead.
 */
function sectionOf(doc: Document, fragment: string): string | null {
  if (!fragment) return null;
  const forms = fragmentForms(fragment);

  let target: Element | null = null;
  for (const form of forms) {
    target =
      doc.getElementById(form) ??
      Array.from(doc.querySelectorAll('a[name]')).find(
        (a) => a.getAttribute('name') === form
      ) ??
      null;
    if (target) break;
  }

  if (target) {
    const next = target.nextElementSibling;
    const heading =
      (target.matches(HEADING) ? target : null) ??
      target.closest(HEADING) ??
      target.querySelector(HEADING) ??
      (next && next.matches(HEADING) ? next : null);
    if (heading) return headingText(heading);
    const own = headingText(target);
    return own && own.length <= MAX_SECTION_LENGTH ? own : null;
  }

  const keys = new Set(forms.map(looseKey));
  const byText = Array.from(doc.querySelectorAll(HEADING)).find((h) => {
    const value = headingText(h);
    return value !== null && keys.has(looseKey(value));
  });
  return byText ? headingText(byText) : null;
}

function fragmentOf(url: string): string {
  try {
    return new URL(url).hash.replace(/^#/, '');
  } catch {
    return '';
  }
}

/**
 * Everything an HTML document says about itself, or null if it has no title.
 * `url` supplies the `#fragment` for the section. `preferOpenGraph` puts Open
 * Graph's title first, for pages made for link previews whose <title> is
 * generic.
 */
export function extractPageInfo(
  html: string,
  url = '',
  preferOpenGraph = false
): PageInfo | null {
  const doc = parseHtml(html);
  const title = titleOf(doc, preferOpenGraph);
  if (!title) return null;
  return {
    title,
    siteName: siteNameOf(doc),
    author: authorOf(doc),
    description: descriptionOf(doc),
    section: sectionOf(doc, fragmentOf(url)),
  };
}

/**
 * The best title in an HTML document: its <title>, then Open Graph, then
 * Twitter card metadata.
 */
export function extractTitle(
  html: string,
  preferOpenGraph = false
): string | null {
  return titleOf(parseHtml(html), preferOpenGraph);
}

/**
 * The site's own name as the page declares it: Open Graph's `og:site_name`,
 * else the `application-name` meta tag.
 */
export function extractSiteName(html: string): string | null {
  return siteNameOf(parseHtml(html));
}

/** The text of the heading `fragment` points at in an HTML document. */
export function extractSection(html: string, fragment: string): string | null {
  return sectionOf(parseHtml(html), fragment);
}

/** A page known only by a name, such as a file's. */
function namedOnly(title: string): PageInfo {
  return {
    title,
    siteName: null,
    author: null,
    description: null,
    section: null,
  };
}

async function tryRequest(
  http: HttpClient,
  request: HttpRequest
): Promise<HttpResponse | null> {
  try {
    return await http(request);
  } catch {
    return null;
  }
}

async function oEmbedInfo(
  url: string,
  options: FetchTitleOptions,
  headers: Record<string, string>
): Promise<PageInfo | null> {
  const providers = options.oEmbedProviders ?? OEMBED_PROVIDERS;
  const provider = providers.find((p) => p.pattern.test(url));
  if (!provider) return null;

  const res = await tryRequest(options.http, {
    url: `${provider.endpoint}?format=json&url=${encodeURIComponent(url)}`,
    method: 'GET',
    headers: { ...headers, Accept: 'application/json' },
  });
  if (!res || res.status >= 400) return null;

  try {
    const data = JSON.parse(
      new TextDecoder('utf-8').decode(res.body())
    ) as Record<string, unknown>;
    const field = (key: string) => {
      const value = data[key];
      return typeof value === 'string' ? value : null;
    };
    const title = usable(field('title'));
    if (!title) return null;
    return {
      title,
      siteName: usable(field('provider_name')),
      author: text(field('author_name')),
      description: text(field('description')),
      section: null,
    };
  } catch {
    return null;
  }
}

/**
 * The title for a URL, or null when none could be found: the site is
 * unreachable, answered with an error, or its page has no title.
 */
export async function fetchTitle(
  url: string,
  options: FetchTitleOptions
): Promise<string | null> {
  return (await fetchPageInfo(url, options))?.title ?? null;
}

/**
 * What the page at a URL says about itself, or null when no title could be
 * found: the site is unreachable, answered with an error, or its page has no
 * title.
 */
export async function fetchPageInfo(
  url: string,
  options: FetchTitleOptions
): Promise<PageInfo | null> {
  const absolute = toAbsoluteUrl(url);
  if (!absolute) return null;

  // A file is named after its path; downloading it would only tell us that
  // it isn't a page.
  if (isFileUrl(absolute)) {
    const name = fileNameFromUrl(absolute);
    return name ? namedOnly(name) : null;
  }

  const headers: Record<string, string> = {
    'User-Agent': USER_AGENT,
    Accept: 'text/html,application/xhtml+xml;q=0.9,*/*;q=0.8',
  };
  if (options.language) headers['Accept-Language'] = options.language;

  const embedded = await oEmbedInfo(absolute, options, headers);
  if (embedded) return embedded;

  const mirror = options.twitterProxy ? twitterProxyUrl(absolute) : null;
  if (mirror) {
    const res = await tryRequest(options.http, {
      url: mirror,
      method: 'GET',
      headers: { ...headers, 'User-Agent': LINK_PREVIEW_USER_AGENT },
    });
    if (!res || res.status >= 400) return null;
    return extractPageInfo(
      decodeHtml(res.body(), header(res, 'content-type')),
      absolute,
      true
    );
  }

  // requestUrl can't stream, so a GET of a large download is a full
  // download. Asking with HEAD first keeps a URL without a telltale
  // extension from pulling a video or an installer (upstream #164). Servers
  // that mishandle HEAD just fall through to the GET.
  const head = await tryRequest(options.http, {
    url: absolute,
    method: 'HEAD',
    headers,
  });
  if (head && head.status < 400 && !isHtml(header(head, 'content-type'))) {
    return namedOnly(fileNameFromUrl(absolute) ?? hostnameOf(absolute));
  }

  const res = await tryRequest(options.http, {
    url: absolute,
    method: 'GET',
    headers,
  });
  if (!res || res.status >= 400) return null;

  const contentType = header(res, 'content-type');
  if (!isHtml(contentType)) {
    return namedOnly(fileNameFromUrl(absolute) ?? hostnameOf(absolute));
  }

  return extractPageInfo(decodeHtml(res.body(), contentType), absolute);
}
