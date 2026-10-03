import { browser, expect } from '@wdio/globals';

import {
  editorValue,
  getSettings,
  openNote,
  paste,
  renderedLinks,
  resetPlugin,
  runCommand,
  setSettings,
  settled,
} from '../helpers';
import {
  clearRequestLog,
  fixtureBase,
  requestLog,
  stopFixtureServer,
} from '../server';

/** Pastes `url` into an empty note and returns what the note holds after. */
async function pasteInto(url: string): Promise<string> {
  await openNote('‸');
  await paste(url);
  await settled();
  return editorValue();
}

describe('Decoding URLs', function () {
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

  it('leaves the URL encoded when off', async function () {
    const url = `${base}/word/%E5%AF%BF%E5%8F%B8`;
    expect(await pasteInto(url)).toBe(`[Word 寿司](${url})`);
  });

  it('decodes the URL in the link when on, fetching the URL as pasted', async function () {
    await setSettings({ decodeUrls: true });
    const url = `${base}/word/%E5%AF%BF%E5%8F%B8`;
    expect(await pasteInto(url)).toBe(`[Word 寿司](${base}/word/寿司)`);
    expect(requestLog().map((r) => r.path)).toContain(
      '/word/%E5%AF%BF%E5%8F%B8'
    );
  });

  it('keeps reserved characters encoded', async function () {
    await setSettings({ decodeUrls: true });
    const url = `${base}/word/a%2Fb%3Fc%E5%AF%BF`;
    expect(await pasteInto(url)).toBe(
      `[Word a/b?c寿](${base}/word/a%2Fb%3Fc寿)`
    );
  });

  it('writes a decoded space in the <...> form, which still links', async function () {
    await setSettings({ decodeUrls: true });
    const url = `${base}/word/Blue%20jay`;
    const value = await pasteInto(url);
    expect(value).toBe(`[Word Blue jay](<${base}/word/Blue jay>)`);

    // Obsidian's own renderer has to read it as one link to the right place.
    const links = await renderedLinks(value);
    expect(links).toHaveLength(1);
    expect(links[0].text).toBe('Word Blue jay');
    expect(decodeURI(links[0].href ?? '')).toBe(`${base}/word/Blue jay`);
  });

  it('renders a decoded link that leads to the same page', async function () {
    await setSettings({ decodeUrls: true });
    const value = await pasteInto(`${base}/word/%E5%AF%BF%E5%8F%B8`);
    const [link] = await renderedLinks(value);
    expect(new URL(link.href ?? '').pathname).toBe('/word/%E5%AF%BF%E5%8F%B8');
  });

  it('keeps the URL as pasted when no title is found', async function () {
    await setSettings({ decodeUrls: true });
    const url = `${base}/missing/%E5%AF%BF`;
    expect(await pasteInto(url)).toBe(url);
  });

  it('decodes the link the enhance command writes', async function () {
    await setSettings({ decodeUrls: true });
    const url = `${base}/word/%E5%AF%BF%E5%8F%B8`;
    await openNote(`see ${url}‸ now`);
    await runCommand('enhance-url-with-title');
    await settled();
    expect(await editorValue()).toBe(`see [Word 寿司](${base}/word/寿司) now`);
  });

  it('decodes a selection linked as the title', async function () {
    await setSettings({ decodeUrls: true });
    const url = `${base}/word/%E5%AF%BF%E5%8F%B8`;
    await openNote('see «sushi» now');
    await paste(url);
    await settled();
    expect(await editorValue()).toBe(`see [sushi](${base}/word/寿司) now`);
  });

  it('encodes a decoded space again in a URL written as text', async function () {
    await setSettings({
      decodeUrls: true,
      linkFormat: 'custom',
      customLinkFormat: '{title}: {url}',
    });
    const url = `${base}/word/Blue%20jay%E5%AF%BF`;
    const value = await pasteInto(url);
    expect(value).toBe(`Word Blue jay寿: ${base}/word/Blue%20jay寿`);
    const links = await renderedLinks(value);
    expect(links).toHaveLength(1);
  });

  it('saves the toggle', async function () {
    await browser.executeObsidian(({ app }) => {
      const setting = (app as any).setting;
      setting.open();
      setting.openTabById('named-links');
    });
    await browser.waitUntil(
      async () =>
        await browser.executeObsidian(({ app }) => {
          const el = (app as any).setting.activeTab?.containerEl as
            HTMLElement | undefined;
          return (el?.innerText ?? '').includes('Decode URLs');
        }),
      { timeout: 10000, timeoutMsg: 'settings tab did not render' }
    );
    await browser.executeObsidian(({ app }) => {
      const el = (app as any).setting.activeTab.containerEl as HTMLElement;
      const row = Array.from(el.querySelectorAll('.setting-item')).find(
        (r) =>
          r.querySelector('.setting-item-name')?.textContent === 'Decode URLs'
      )!;
      (row.querySelector('.checkbox-container') as HTMLElement).click();
    });
    await browser.waitUntil(
      async () => (await getSettings()).decodeUrls === true,
      { timeoutMsg: 'toggle did not reach the settings' }
    );
    await browser.executeObsidian(({ app }) => (app as any).setting.close());
  });
});
