import { browser, expect } from '@wdio/globals';

import { resetPlugin, setSettings } from '../helpers';
import {
  clearRequestLog,
  fixtureBase,
  requestLog,
  stopFixtureServer,
} from '../server';

type Method = 'getTitle' | 'getLink' | 'formatLink';

/**
 * Calls the API the way another plugin or a Templater script would, through
 * `app.plugins.plugins['named-links'].api`.
 */
function callApi(method: Method, ...args: unknown[]): Promise<unknown> {
  return browser.executeObsidian(
    async ({ app }, method, args) => {
      const api = (app as any).plugins.plugins['named-links'].api;
      return await api[method](...args);
    },
    method,
    args
  );
}

describe('Scripting API', function () {
  let base: string;

  before(async function () {
    base = await fixtureBase();
  });

  after(async function () {
    await stopFixtureServer();
  });

  beforeEach(async function () {
    await resetPlugin();
    clearRequestLog();
  });

  it('is reachable from another plugin, with a version', async function () {
    const api = await browser.executeObsidian(({ app }) => {
      const api = (app as any).plugins.plugins['named-links'].api;
      return {
        version: api.version,
        methods: Object.keys(api).sort(),
      };
    });
    expect(api).toEqual({
      version: 1,
      methods: ['formatLink', 'getLink', 'getTitle', 'version'],
    });
  });

  it('gets the title with the clean-up settings applied', async function () {
    await setSettings({
      removeSiteName: true,
      titleRules: '/^Draft: / =>',
    });
    const url = `${base}/site?title=${encodeURIComponent('Draft: A *story* | Fixture Site')}&site=Fixture%20Site`;
    expect(await callApi('getTitle', url)).toBe('A *story*');
  });

  it('gets the link in the chosen format, with URLs decoded', async function () {
    await setSettings({ linkFormat: 'html', decodeUrls: true });
    const url = `${base}/word/%E5%AF%BF%E5%8F%B8`;
    expect(await callApi('getLink', url)).toBe(
      `<a href="${base}/word/寿司">Word 寿司</a>`
    );
  });

  it('formats a known title without fetching anything', async function () {
    const url = `${base}/page?title=Unused`;
    expect(await callApi('formatLink', url, 'My [own] title')).toBe(
      `[My \\[own\\] title](${url})`
    );
    expect(requestLog()).toEqual([]);
  });

  it('works with titling pasted URLs turned off', async function () {
    await setSettings({ enhancePaste: false, enhanceDrop: false });
    const url = `${base}/page?title=Scripted`;
    expect(await callApi('getLink', url)).toBe(`[Scripted](${url})`);
  });

  it('leaves an excluded site alone, without a request', async function () {
    await setSettings({ excludedSites: '127.0.0.1' });
    const url = `${base}/page?title=Never`;
    expect(await callApi('getTitle', url)).toBeNull();
    expect(await callApi('getLink', url)).toBe(url);
    expect(requestLog()).toEqual([]);
  });

  it('falls back to the URL when the site answers 404', async function () {
    const url = `${base}/missing`;
    expect(await callApi('getTitle', url)).toBeNull();
    expect(await callApi('getLink', url)).toBe(url);
  });

  it("doesn't throw for input that isn't a URL", async function () {
    for (const input of ['not a url', '', null, 42, { url: 'x' }]) {
      expect(await callApi('getTitle', input)).toBeNull();
    }
    expect(await callApi('getLink', 'not a url')).toBe('not a url');
    expect(await callApi('getLink', null)).toBe('');
    expect(await callApi('formatLink', 'not a url', 'Title')).toBe('not a url');
    expect(requestLog()).toEqual([]);
  });
});
