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

  describe('Domain title rules', function () {
    it("apply only to their own domain's titles", async function () {
      await setSettings({
        domainTitleRules:
          '127.0.0.1: /^\\[Local\\] / =>\nexample.org: story => tale',
      });
      const url = siteUrl(base, '[Local] A story');
      expect(await pasteAndRead(url)).toBe(`[A story](${url})`);
    });

    it('run before the page title rules', async function () {
      await setSettings({
        domainTitleRules: '127.0.0.1: Draft => Final',
        titleRules: '/^Final: (.*)$/ => $1 (final)',
      });
      const url = siteUrl(base, 'Draft: Notes');
      expect(await pasteAndRead(url)).toBe(`[Notes (final)](${url})`);
    });

    it('work without any page title rules, and the other way round', async function () {
      await setSettings({ domainTitleRules: '127.0.0.1: A => Z' });
      const url = siteUrl(base, 'A B');
      expect(await pasteAndRead(url)).toBe(`[Z B](${url})`);

      await setSettings({ domainTitleRules: '', titleRules: 'B => Y' });
      expect(await pasteAndRead(url)).toBe(`[A Y](${url})`);
    });
  });

  describe('Page title rules', function () {
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
      await browser.waitUntil(async () => (await rowText()) !== null, {
        timeout: 10000,
        timeoutMsg: 'title rules row did not render',
      });
    }

    const PAGE_RULES = 'Page title rules';
    const DOMAIN_RULES = 'Domain title rules';

    function rowText(name = PAGE_RULES): Promise<string | null> {
      return browser.executeObsidian(({ app }, name) => {
        const el = (app as any).setting.activeTab?.containerEl as
          HTMLElement | undefined;
        const row = Array.from(
          el?.querySelectorAll('.setting-item') ?? []
        ).find(
          (r) => r.querySelector('.setting-item-name')?.textContent === name
        ) as HTMLElement | undefined;
        return row ? row.innerText : null;
      }, name);
    }

    async function typeRules(text: string, name = PAGE_RULES) {
      await browser.executeObsidian(
        ({ app }, text, name) => {
          const el = (app as any).setting.activeTab.containerEl as HTMLElement;
          const row = Array.from(el.querySelectorAll('.setting-item')).find(
            (r) => r.querySelector('.setting-item-name')?.textContent === name
          )!;
          const area = row.querySelector('textarea')!;
          area.value = text;
          area.dispatchEvent(new Event('input', { bubbles: true }));
          area.dispatchEvent(new Event('change', { bubbles: true }));
          area.blur();
        },
        text,
        name
      );
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

    it('saves the domain rules', async function () {
      await openSettings();
      await typeRules('github.com: a => b', DOMAIN_RULES);
      await browser.waitUntil(
        async () =>
          (await getSettings()).domainTitleRules === 'github.com: a => b',
        { timeoutMsg: 'domain title rules did not reach the settings' }
      );
    });

    it('says which domain rule has no domain', async function () {
      await openSettings();
      await typeRules('github.com: a => b\nWikipedia => WP', DOMAIN_RULES);
      await browser.waitUntil(
        async () =>
          (await rowText(DOMAIN_RULES))?.includes(
            'Line 2: it needs to start with a domain and a colon'
          ) ?? false,
        { timeoutMsg: 'no validation message for the missing domain' }
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
          (await rowText())?.includes(
            'Line 2: the regular expression is invalid'
          ) ?? false,
        { timeoutMsg: 'no validation message for the bad regex' }
      );
    });
  });
});
