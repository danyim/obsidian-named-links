import assert from 'node:assert/strict';

import { API_VERSION, ApiHost, apiUrl, createApi } from '../../src/api';
import {
  needsPageInfo,
  needsTitle,
  renderLink,
  templateFor,
} from '../../src/linkFormat';
import type { PageInfo } from '../../src/scraper';
import { DEFAULT_SETTINGS, NamedLinksSettings } from '../../src/settings';

/** A host that renders links like the plugin and counts its lookups. */
function fakeHost(
  overrides: Partial<NamedLinksSettings> = {},
  titles: Record<string, string | Partial<PageInfo> | null> = {}
) {
  const settings = { ...DEFAULT_SETTINGS, ...overrides };
  const lookups: string[] = [];
  const host: ApiHost = {
    settings: () => settings,
    fetchPageInfo: (url) => {
      lookups.push(url);
      if (!(url in titles)) {
        return Promise.reject(new Error('unexpected lookup ' + url));
      }
      const found = titles[url];
      if (found === null) return Promise.resolve(null);
      const page: PageInfo = {
        siteName: null,
        author: null,
        description: null,
        section: null,
        ...(typeof found === 'string' ? { title: found } : found),
      } as PageInfo;
      return Promise.resolve(page);
    },
    link: (url, title, page) =>
      renderLink(templateFor(settings), {
        url,
        title,
        author: page?.author,
        site: page?.siteName,
        description: page?.description,
        section: page?.section,
      }),
    wantsTitle: () => needsTitle(templateFor(settings)),
    wantsPageInfo: () => needsPageInfo(templateFor(settings)),
  };
  return { api: createApi(host), lookups, settings };
}

describe('getLink with page placeholders', () => {
  it('fills the format from the same lookup as the title', async () => {
    const url = 'https://example.com/v';
    const { api, lookups } = fakeHost(
      {
        linkFormat: 'custom',
        customLinkFormat: '[{title}]({url}) by {author}',
      },
      { [url]: { title: 'A video', author: 'A channel' } }
    );
    assert.equal(await api.getLink(url), `[A video](${url}) by A channel`);
    assert.deepEqual(lookups, [url]);
  });

  it('fetches for a format that shows no title but shows the author', async () => {
    const url = 'https://example.com/v';
    const { api } = fakeHost(
      { linkFormat: 'custom', customLinkFormat: '[{author}]({url})' },
      { [url]: { title: 'A video', author: 'A channel' } }
    );
    assert.equal(await api.getLink(url), `[A channel](${url})`);
  });
});

describe('apiUrl', () => {
  it('reads URLs as a paste would', () => {
    assert.equal(apiUrl(' https://example.com '), 'https://example.com');
    assert.equal(apiUrl('<https://example.com>'), 'https://example.com');
    assert.equal(apiUrl('www.example.com'), 'https://www.example.com');
  });

  it('rejects anything else, of any type', () => {
    for (const input of ['', 'not a url', null, undefined, 42, {}]) {
      assert.equal(apiUrl(input), null);
    }
  });
});

describe('createApi', () => {
  const url = 'https://example.com/a';

  it('reports its version and is frozen', () => {
    const { api } = fakeHost();
    assert.equal(api.version, API_VERSION);
    assert.equal(Object.isFrozen(api), true);
  });

  describe('getTitle', () => {
    it('returns the title, shortened but not escaped', async () => {
      const { api } = fakeHost(
        { maxTitleLength: 9 },
        { [url]: 'A *bold* [title]' }
      );
      assert.equal(await api.getTitle(url), 'A *bold*…');
    });

    it('is null for bad input, without a lookup or a throw', async () => {
      const { api, lookups } = fakeHost();
      for (const input of ['nope', '', null, 3] as unknown as string[]) {
        assert.equal(await api.getTitle(input), null);
      }
      assert.deepEqual(lookups, []);
    });

    it('is null for an excluded site, without a lookup', async () => {
      const { api, lookups } = fakeHost({ excludedSites: 'example.com' });
      assert.equal(await api.getTitle(url), null);
      assert.deepEqual(lookups, []);
    });

    it('is null when the lookup finds nothing or fails', async () => {
      const { api } = fakeHost({}, { [url]: null });
      assert.equal(await api.getTitle(url), null);
      assert.equal(await api.getTitle('https://example.com/throws'), null);
    });
  });

  describe('getLink', () => {
    it('writes the link in the configured format', async () => {
      const { api } = fakeHost({ linkFormat: 'html' }, { [url]: 'A & B' });
      assert.equal(await api.getLink(url), `<a href="${url}">A & B</a>`);
    });

    it('falls back to the URL as given', async () => {
      const { api } = fakeHost({}, { [url]: null });
      assert.equal(await api.getLink(` ${url}`), ` ${url}`);
      assert.equal(await api.getLink('not a url'), 'not a url');
      assert.equal(await api.getLink(null as unknown as string), '');
    });

    it('leaves an image as given', async () => {
      const { api, lookups } = fakeHost();
      const image = 'https://example.com/a.png';
      assert.equal(await api.getLink(image), image);
      assert.deepEqual(lookups, []);
    });

    it('follows "Paste excluded sites as"', async () => {
      const asUrl = fakeHost({ excludedSites: 'example.com' });
      assert.equal(await asUrl.api.getLink(url), url);
      const asDomain = fakeHost({
        excludedSites: 'example.com',
        excludedSiteFormat: 'domain',
      });
      assert.equal(await asDomain.api.getLink(url), `[example.com](${url})`);
      assert.deepEqual([...asUrl.lookups, ...asDomain.lookups], []);
    });

    it("doesn't fetch for a format without the title", async () => {
      const { api, lookups } = fakeHost({
        linkFormat: 'custom',
        customLinkFormat: '[source]({url})',
      });
      assert.equal(await api.getLink(url), `[source](${url})`);
      assert.deepEqual(lookups, []);
    });
  });

  describe('formatLink', () => {
    it('applies the link format to a known title, without a lookup', () => {
      const { api, lookups } = fakeHost();
      assert.equal(
        api.formatLink(url, 'Known [title]'),
        `[Known \\[title\\]](${url})`
      );
      assert.deepEqual(lookups, []);
    });

    it('returns the URL as given for bad input or an empty title', () => {
      const { api } = fakeHost();
      assert.equal(api.formatLink('nope', 'Title'), 'nope');
      assert.equal(api.formatLink(url, '  '), url);
      assert.equal(api.formatLink(url, null as unknown as string), url);
    });
  });
});
