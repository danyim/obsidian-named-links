import { browser, expect } from '@wdio/globals';

import {
  editorValue,
  getSettings,
  openNote,
  paste,
  resetPlugin,
  setSettings,
  settled,
} from '../helpers';
import { fixtureBase, stopFixtureServer } from '../server';

function siteUrl(base: string, title: string, site?: string): string {
  const params = new URLSearchParams({ title });
  if (site) params.set('site', site);
  return `${base}/site?${params.toString()}`;
}

async function pasteAndRead(url: string): Promise<string> {
  await openNote('‸');
  await paste(url);
  await settled();
  return editorValue();
}

describe('Cleaning up titles', function () {
  let base: string;

  before(async function () {
    base = await fixtureBase();
  });

  after(async function () {
    await stopFixtureServer();
  });

  beforeEach(async function () {
    await resetPlugin();
  });

  describe('Remove the site name', function () {
    it('keeps the title whole when off', async function () {
      const url = siteUrl(base, 'A story | Fixture Site', 'Fixture Site');
      expect(await pasteAndRead(url)).toBe(
        `[A story \\| Fixture Site](${url})`
      );
    });

    it('drops the name the page declares from the end', async function () {
      await setSettings({ removeSiteName: true });
      const url = siteUrl(base, 'A story | Fixture Site', 'Fixture Site');
      expect(await pasteAndRead(url)).toBe(`[A story](${url})`);
    });

    it('drops the name from the start', async function () {
      await setSettings({ removeSiteName: true });
      const url = siteUrl(
        base,
        'The Fixture Site - Another story',
        'Fixture Site'
      );
      expect(await pasteAndRead(url)).toBe(`[Another story](${url})`);
    });

    it('keeps a separator that belongs to the title', async function () {
      await setSettings({ removeSiteName: true });
      const url = siteUrl(base, 'C - The Language', 'Fixture Site');
      expect(await pasteAndRead(url)).toBe(`[C - The Language](${url})`);
    });

    it('leaves the title alone when the page names no site', async function () {
      // 127.0.0.1 has no name to stand in for one.
      await setSettings({ removeSiteName: true });
      const url = siteUrl(base, 'A story | Somewhere');
      expect(await pasteAndRead(url)).toBe(`[A story \\| Somewhere](${url})`);
    });
  });

  describe('Title rules', function () {
    it('applies literal and regex rules in order', async function () {
      await setSettings({
        titleRules:
          '# tidy up\n(Official Video) =>\n/^\\[(\\w+)\\] (.*)$/ => $2 ($1)',
      });
      const url = siteUrl(base, '[News] A song (Official Video)');
      expect(await pasteAndRead(url)).toBe(`[A song (News)](${url})`);
    });

    it('runs after the site name is removed and before shortening', async function () {
      await setSettings({
        removeSiteName: true,
        titleRules: '/^Draft: / =>',
        maxTitleLength: 5,
      });
      const url = siteUrl(
        base,
        'Draft: Abcdefgh | Fixture Site',
        'Fixture Site'
      );
      expect(await pasteAndRead(url)).toBe(`[Abcde…](${url})`);
    });

    it('keeps the title when the rules would empty it', async function () {
      await setSettings({ titleRules: '/.*/ =>' });
      const url = siteUrl(base, 'Still here');
      expect(await pasteAndRead(url)).toBe(`[Still here](${url})`);
    });

    it('skips a line with an invalid regex', async function () {
      await setSettings({ titleRules: '/(/ => x\nhere => there' });
      const url = siteUrl(base, 'Still here');
      expect(await pasteAndRead(url)).toBe(`[Still there](${url})`);
    });
  });

  describe('in the settings tab', function () {
    async function openSettings() {
      await browser.executeObsidian(({ app }) => {
        const setting = (app as any).setting;
        setting.open();
        setting.openTabById('named-links');
      });
      await browser.waitUntil(async () => (await rulesRowText()) !== null, {
        timeout: 10000,
        timeoutMsg: 'title rules row did not render',
      });
    }

    function rulesRowText(): Promise<string | null> {
      return browser.executeObsidian(({ app }) => {
        const el = (app as any).setting.activeTab?.containerEl as
          HTMLElement | undefined;
        const row = Array.from(
          el?.querySelectorAll('.setting-item') ?? []
        ).find(
          (r) =>
            r.querySelector('.setting-item-name')?.textContent === 'Title rules'
        ) as HTMLElement | undefined;
        return row ? row.innerText : null;
      });
    }

    async function typeRules(text: string) {
      await browser.executeObsidian(({ app }, text) => {
        const el = (app as any).setting.activeTab.containerEl as HTMLElement;
        const row = Array.from(el.querySelectorAll('.setting-item')).find(
          (r) =>
            r.querySelector('.setting-item-name')?.textContent === 'Title rules'
        )!;
        const area = row.querySelector('textarea')!;
        area.value = text;
        area.dispatchEvent(new Event('input', { bubbles: true }));
        area.dispatchEvent(new Event('change', { bubbles: true }));
        area.blur();
      }, text);
    }

    afterEach(async function () {
      await browser.executeObsidian(({ app }) => (app as any).setting.close());
    });

    it('saves the rules', async function () {
      await openSettings();
      await typeRules('foo => bar');
      await browser.waitUntil(
        async () => (await getSettings()).titleRules === 'foo => bar',
        { timeoutMsg: 'title rules did not reach the settings' }
      );
    });

    it('saves the site name toggle', async function () {
      await openSettings();
      await browser.executeObsidian(({ app }) => {
        const el = (app as any).setting.activeTab.containerEl as HTMLElement;
        const row = Array.from(el.querySelectorAll('.setting-item')).find(
          (r) =>
            r.querySelector('.setting-item-name')?.textContent ===
            'Remove the site name'
        )!;
        (row.querySelector('.checkbox-container') as HTMLElement).click();
      });
      await browser.waitUntil(
        async () => (await getSettings()).removeSiteName === true,
        { timeoutMsg: 'toggle did not reach the settings' }
      );
    });

    it('says which line has an invalid regex', async function () {
      await openSettings();
      await typeRules('ok => fine\n/(unclosed/ => x');
      await browser.waitUntil(
        async () =>
          (await rulesRowText())?.includes(
            'Line 2: the regular expression is invalid'
          ) ?? false,
        { timeoutMsg: 'no validation message for the bad regex' }
      );
    });
  });
});
