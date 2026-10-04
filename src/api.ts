/**
 * The API other plugins and scripts reach at
 * `app.plugins.plugins['named-links'].api` (upstream #52, #146), for
 * Templater, QuickAdd, Dataview and the like.
 *
 * Only type imports from modules that import Obsidian, so the unit tests can
 * run the whole API against a fake host.
 */
import type { PageInfo } from './scraper';
import type { NamedLinksSettings } from './settings';
import { isExcluded, parseExcludedSites } from './settings';
import { readableTitle } from './title';
import { hostnameOf, isImageUrl, toAbsoluteUrl, unwrapAutolink } from './url';

/**
 * Bumped only for a breaking change: a method removed or renamed, a
 * parameter or return type changed, or a method that could only resolve
 * starting to reject. New methods and new optional parameters keep the
 * version.
 */
export const API_VERSION = 1;

export interface NamedLinksApi {
  readonly version: number;
  /**
   * The page's title as a pasted link would get it: the site name removed
   * and the title rules applied, as configured, and shortened to the maximum
   * length, but not escaped. Null when there's no title, the URL isn't one,
   * or the site is excluded.
   */
  getTitle(url: string): Promise<string | null>;
  /**
   * The finished link a paste of `url` would write, in the user's link
   * format. The URL as given when no title is found, and an excluded site
   * as "Paste excluded sites as" says.
   */
  getLink(url: string): Promise<string>;
  /**
   * The user's link format applied to a title you already have. Nothing is
   * fetched. The URL as given if it isn't one, or the title is empty.
   */
  formatLink(url: string, title: string): string;
}

/** What the API needs from the plugin. */
export interface ApiHost {
  /** Read on every call, so the API follows changes to the settings. */
  settings(): NamedLinksSettings;
  /**
   * What the page says about itself, its title cleaned up, within the
   * request timeout, or null.
   */
  fetchPageInfo(url: string): Promise<PageInfo | null>;
  /**
   * A finished link in the user's link format, from a readable title and,
   * for its other placeholders, what the page says about itself.
   */
  link(url: string, title: string, page?: PageInfo | null): string;
  /** Whether the link format shows the title at all. */
  wantsTitle(): boolean;
  /** Whether the link format shows anything read from the page. */
  wantsPageInfo(): boolean;
}

/** The absolute URL a caller's argument names, or null for anything else. */
export function apiUrl(input: unknown): string | null {
  if (typeof input !== 'string') return null;
  return toAbsoluteUrl(unwrapAutolink(input.trim()));
}

/** A caller's argument as text, for falling back to it unchanged. */
function asGiven(input: unknown): string {
  return typeof input === 'string' ? input : '';
}

export function createApi(host: ApiHost): NamedLinksApi {
  const excluded = (url: string) =>
    isExcluded(url, parseExcludedSites(host.settings().excludedSites));

  /** The page's info with its title made readable, or null. */
  const readablePage = async (
    url: string
  ): Promise<{ title: string; page: PageInfo } | null> => {
    let page: PageInfo | null = null;
    try {
      page = await host.fetchPageInfo(url);
    } catch {
      return null;
    }
    if (page === null) return null;
    const title = readableTitle(page.title, host.settings().maxTitleLength);
    return title === '' ? null : { title, page };
  };

  const getTitle = async (input: string): Promise<string | null> => {
    const url = apiUrl(input);
    if (!url || excluded(url)) return null;
    return (await readablePage(url))?.title ?? null;
  };

  return Object.freeze({
    version: API_VERSION,

    getTitle,

    async getLink(input: string): Promise<string> {
      const url = apiUrl(input);
      // An image stays as given, the same as a paste leaves it, so it can
      // still be embedded.
      if (!url || isImageUrl(url)) return asGiven(input);
      if (excluded(url)) {
        return host.settings().excludedSiteFormat === 'domain'
          ? host.link(url, hostnameOf(url))
          : asGiven(input);
      }
      // A format showing nothing from the page needs no fetch, as with a
      // paste; otherwise its other placeholders ({author}, {section}...)
      // are filled from the same lookup as the title.
      if (!host.wantsPageInfo()) return host.link(url, '');
      const found = await readablePage(url);
      return found === null
        ? asGiven(input)
        : host.link(url, found.title, found.page);
    },

    formatLink(input: string, title: string): string {
      const url = apiUrl(input);
      if (!url) return asGiven(input);
      const readable =
        typeof title === 'string'
          ? readableTitle(title, host.settings().maxTitleLength)
          : '';
      if (readable === '' && host.wantsTitle()) return asGiven(input);
      return host.link(url, readable);
    },
  });
}
