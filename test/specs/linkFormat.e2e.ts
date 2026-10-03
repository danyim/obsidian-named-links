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
  HOSTILE_TITLE,
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

describe('Link format', function () {
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

  describe('a hostile title renders as text in every preset', function () {
    it('Markdown link', async function () {
      const url = `${base}/hostile`;
      const links = await renderedLinks(await pasteInto(url));
      expect(links).toEqual([{ text: HOSTILE_TITLE, href: url, title: null }]);
    });

    it('Markdown link with a hover title', async function () {
      await setSettings({ linkFormat: 'markdown-title' });
      const url = `${base}/hostile`;
      const links = await renderedLinks(await pasteInto(url));
      expect(links).toEqual([
        { text: HOSTILE_TITLE, href: url, title: HOSTILE_TITLE },
      ]);
    });

    it('HTML link', async function () {
      await setSettings({ linkFormat: 'html' });
      const url = `${base}/hostile`;
      const value = await pasteInto(url);
      expect(value).toMatch(/^<a href="[^"]+">.*<\/a>$/);
      const links = await renderedLinks(value);
      expect(links).toEqual([{ text: HOSTILE_TITLE, href: url, title: null }]);
    });

    it('a custom HTML link with the title in an attribute', async function () {
      await setSettings({
        linkFormat: 'custom',
        customLinkFormat: '<a href="{url}" title="{title}">{domain}</a>',
      });
      const url = `${base}/hostile`;
      const links = await renderedLinks(await pasteInto(url));
      expect(links).toEqual([
        { text: '127.0.0.1', href: url, title: HOSTILE_TITLE },
      ]);
    });
  });

  it('writes a custom template', async function () {
    await setSettings({
      linkFormat: 'custom',
      customLinkFormat: '[{title}]({url}) ({domain})',
    });
    const url = `${base}/page?title=Custom`;
    expect(await pasteInto(url)).toBe(`[Custom](${url}) (127.0.0.1)`);
  });

  it('inserts a format without a title at once, without fetching', async function () {
    await setSettings({
      linkFormat: 'custom',
      customLinkFormat: '[source]({url})',
    });
    const url = `${base}/page?title=Unused`;
    await openNote('see ‸');
    await paste(url);
    // No settled(): the link has to be there as soon as the paste is.
    expect(await editorValue()).toBe(`see [source](${url})`);
    await settled();
    expect(requestLog()).toEqual([]);
  });

  it('leaves the URL as pasted when no title is found', async function () {
    await setSettings({ linkFormat: 'html' });
    expect(await pasteInto(`${base}/missing`)).toBe(`${base}/missing`);
  });

  it('formats the link the enhance command writes', async function () {
    await setSettings({ linkFormat: 'html' });
    const url = `${base}/page?title=Enhanced`;
    await openNote(`[old](${url}‸) after`, { source: true });
    await runCommand('enhance-url-with-title');
    await settled();
    expect(await editorValue()).toBe(
      `<a href="${url.replace('&', '&amp;')}">Enhanced</a> after`
    );
  });

  it('formats the enhance command at once when no title is needed', async function () {
    await setSettings({
      linkFormat: 'custom',
      customLinkFormat: '[{domain}]({url})',
    });
    const url = `${base}/page`;
    await openNote(`«${url}»`);
    await runCommand('enhance-url-with-title');
    expect(await editorValue()).toBe(`[127.0.0.1](${url})`);
    await settled();
    expect(requestLog()).toEqual([]);
  });

  it('formats an excluded site linked under its domain', async function () {
    await setSettings({
      linkFormat: 'html',
      excludedSites: '127.0.0.1',
      excludedSiteFormat: 'domain',
    });
    const url = `${base}/page`;
    expect(await pasteInto(url)).toBe(`<a href="${url}">127.0.0.1</a>`);
    expect(requestLog()).toEqual([]);
  });

  it('formats a selection used as the title', async function () {
    await setSettings({
      linkFormat: 'markdown-title',
      useSelectionAsTitle: true,
    });
    const url = `${base}/page`;
    await openNote('see «my "pick"» now');
    await paste(url);
    await settled();
    expect(await editorValue()).toBe(
      `see [my "pick"](${url} "my \\"pick\\"") now`
    );
    expect(requestLog()).toEqual([]);
  });

  describe('in the settings tab', function () {
    async function openSettings() {
      await browser.executeObsidian(({ app }) => {
        const setting = (app as any).setting;
        setting.open();
        setting.openTabById('named-links');
      });
      await browser.waitUntil(
        async () => (await settingsText()).includes('Link format'),
        { timeout: 10000, timeoutMsg: 'settings tab did not render' }
      );
    }

    function settingsText(): Promise<string> {
      return browser.executeObsidian(({ app }) => {
        const el = (app as any).setting.activeTab?.containerEl as
          HTMLElement | undefined;
        return el?.innerText ?? '';
      });
    }

    afterEach(async function () {
      await browser.executeObsidian(({ app }) => (app as any).setting.close());
    });

    it('shows the custom format only for Custom', async function () {
      await openSettings();
      expect(await settingsText()).not.toContain('Custom format');

      await browser.executeObsidian(({ app }) => {
        const el = (app as any).setting.activeTab.containerEl as HTMLElement;
        const select = Array.from(el.querySelectorAll('select')).find((s) =>
          Array.from(s.options).some((o) => o.value === 'custom')
        )!;
        select.value = 'custom';
        select.dispatchEvent(new Event('change', { bubbles: true }));
      });
      await browser.waitUntil(
        async () => (await settingsText()).includes('Custom format'),
        { timeoutMsg: 'custom format field did not appear' }
      );
      expect((await getSettings()).linkFormat).toBe('custom');
    });

    it('shows why a custom format is invalid', async function () {
      await setSettings({ linkFormat: 'custom' });
      await openSettings();
      await browser.executeObsidian(({ app }) => {
        const el = (app as any).setting.activeTab.containerEl as HTMLElement;
        const row = Array.from(el.querySelectorAll('.setting-item')).find((r) =>
          r.textContent?.includes('Custom format')
        )!;
        const input = row.querySelector('input') as HTMLInputElement;
        input.value = '[{titel}]({url})';
        input.dispatchEvent(new Event('input', { bubbles: true }));
        input.dispatchEvent(new Event('change', { bubbles: true }));
      });
      await browser.waitUntil(
        async () =>
          (await settingsText()).includes("{titel} isn't a placeholder."),
        { timeoutMsg: 'validation message did not appear' }
      );
    });
  });
});
