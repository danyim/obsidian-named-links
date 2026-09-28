/** The settings shape, defaults, and the rules that read them. */
import { toAbsoluteUrl } from './url';

/** What an excluded site's URL becomes when pasted. */
export type ExcludedSiteFormat = 'url' | 'domain';

export interface NamedLinksSettings {
  /** Title URLs pasted with the normal paste command. */
  enhancePaste: boolean;
  /** Title URLs dragged in from another app. */
  enhanceDrop: boolean;
  /** Pasting a URL over selected text links that text instead of fetching. */
  useSelectionAsTitle: boolean;
  /** Leave URLs pasted into code or frontmatter as they are. */
  skipCodeAndFrontmatter: boolean;
  /** Characters to keep of a fetched title; 0 keeps all of it. */
  maxTitleLength: number;
  /** Look X posts up through FxTwitter, a third-party service. */
  twitterProxy: boolean;
  /** Sites never fetched, one per line or comma separated. */
  excludedSites: string;
  excludedSiteFormat: ExcludedSiteFormat;
}

export const DEFAULT_SETTINGS: NamedLinksSettings = {
  enhancePaste: true,
  enhanceDrop: true,
  useSelectionAsTitle: false,
  skipCodeAndFrontmatter: true,
  maxTitleLength: 0,
  twitterProxy: false,
  excludedSites: '',
  excludedSiteFormat: 'url',
};

/** Merges stored data over the defaults, dropping keys of the wrong type. */
export function mergeSettings(stored: unknown): NamedLinksSettings {
  const result: NamedLinksSettings = { ...DEFAULT_SETTINGS };
  if (!stored || typeof stored !== 'object') return result;
  const data = stored as Record<string, unknown>;
  const target = result as unknown as Record<string, unknown>;
  for (const key of Object.keys(DEFAULT_SETTINGS)) {
    if (typeof data[key] === typeof target[key]) target[key] = data[key];
  }
  if (!['url', 'domain'].includes(result.excludedSiteFormat)) {
    result.excludedSiteFormat = DEFAULT_SETTINGS.excludedSiteFormat;
  }
  if (!Number.isFinite(result.maxTitleLength) || result.maxTitleLength < 0) {
    result.maxTitleLength = 0;
  }
  return result;
}

export function parseExcludedSites(text: string): string[] {
  return text
    .split(/[,\n]/)
    .map((s) => s.trim().toLowerCase())
    .filter((s) => s !== '');
}

function stripWww(host: string): string {
  return host.startsWith('www.') ? host.slice(4) : host;
}

/**
 * Whether a URL matches any excluded-site entry.
 *
 * A domain entry matches that host and its subdomains, so `x.com` no longer
 * catches `netflix.com` as upstream's substring test did. Anything else, an
 * entry with a path or arbitrary text, is still matched as a substring of the
 * URL, which is what upstream documented.
 */
export function isExcluded(url: string, entries: string[]): boolean {
  const absolute = toAbsoluteUrl(url);
  if (!absolute) return false;
  const parsed = new URL(absolute);
  const host = stripWww(parsed.hostname.toLowerCase());
  const lowerUrl = absolute.toLowerCase();

  return entries.some((raw) => {
    const entry = raw.replace(/^https?:\/\//, '').replace(/^\*\./, '');
    const bare = entry.replace(/\/$/, '');
    const isDomain =
      /^[a-z0-9.-]+(?::\d+)?$/.test(bare) &&
      (bare.includes('.') || bare.startsWith('localhost'));
    if (isDomain) {
      const domain = stripWww(bare.replace(/:\d+$/, ''));
      return host === domain || host.endsWith(`.${domain}`);
    }
    return lowerUrl.includes(raw);
  });
}

/** Folder name of the plugin this one was forked from. */
export const AUTO_LINK_TITLE_ID = 'obsidian-auto-link-title';
export const AUTO_LINK_TITLE_NAME = 'Auto Link Title';

/**
 * Settings from Auto Link Title's data.json, translated to this plugin's
 * keys. Returns null if the data isn't recognizably from that plugin.
 */
export function settingsFromAutoLinkTitle(
  stored: unknown
): Partial<NamedLinksSettings> | null {
  if (!stored || typeof stored !== 'object') return null;
  const data = stored as Record<string, unknown>;
  const result: Partial<NamedLinksSettings> = {};

  if (typeof data.enhanceDefaultPaste === 'boolean') {
    result.enhancePaste = data.enhanceDefaultPaste;
  }
  if (typeof data.enhanceDropEvents === 'boolean') {
    result.enhanceDrop = data.enhanceDropEvents;
  }
  if (typeof data.shouldPreserveSelectionAsTitle === 'boolean') {
    result.useSelectionAsTitle = data.shouldPreserveSelectionAsTitle;
  }
  if (typeof data.maximumTitleLength === 'number') {
    result.maxTitleLength = Math.max(0, data.maximumTitleLength);
  }
  if (typeof data.websiteBlacklist === 'string') {
    result.excludedSites = data.websiteBlacklist;
    // Auto Link Title linked an excluded URL under its domain name; keep
    // that for someone carrying their list over.
    result.excludedSiteFormat = 'domain';
  }

  return Object.keys(result).length > 0 ? result : null;
}
