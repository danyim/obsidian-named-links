import { browser, expect } from '@wdio/globals';
import { obsidianPage } from 'wdio-obsidian-service';

import {
  editorValue,
  getSettings,
  openNote,
  paste,
  removeAutoLinkTitle,
  resetPlugin,
  settled,
} from '../helpers';
import { fixtureBase, stopFixtureServer } from '../server';

const AUTO_LINK_TITLE = 'obsidian-auto-link-title';

function settingsText(): Promise<string> {
  return browser.executeObsidian(({ app }) => {
    const el = (app as any).setting.activeTab?.containerEl as
      HTMLElement | undefined;
    return (el?.innerText ?? '') as string;
  });
}

async function openSettings() {
  await browser.executeObsidian(({ app }) => {
    const setting = (app as any).setting;
    setting.open();
    setting.openTabById('named-links');
  });
}

describe('Alongside Auto Link Title', function () {
  let base: string;

  before(async function () {
    base = await fixtureBase();
  });

  after(async function () {
    await stopFixtureServer();
    await removeAutoLinkTitle();
  });

  beforeEach(async function () {
    await resetPlugin();
  });

  it('imports the settings Auto Link Title saved', async function () {
    // Have the real plugin write its own data.json, so the import is
    // checked against what it actually saves rather than a hand-made file.
    await obsidianPage.enablePlugin(AUTO_LINK_TITLE);
    await browser.executeObsidian(async ({ app }) => {
      const p = (app as any).plugins.plugins['obsidian-auto-link-title'];
      p.settings.enhanceDefaultPaste = false;
      p.settings.maximumTitleLength = 42;
      p.settings.websiteBlacklist = 'tiktok.com, example.org';
      p.settings.shouldPreserveSelectionAsTitle = true;
      await p.saveSettings();
    });

    await openSettings();
    await browser.waitUntil(
      async () =>
        (await settingsText()).includes('Import from Auto Link Title'),
      { timeout: 10000, timeoutMsg: 'import row did not appear' }
    );
    expect(await settingsText()).toContain('Auto Link Title is also enabled');

    await browser.executeObsidian(async ({ app }) => {
      await (app as any).plugins.plugins[
        'named-links'
      ].importAutoLinkTitleSettings();
      (app as any).setting.close();
    });

    const settings = await getSettings();
    expect(settings).toMatchObject({
      enhancePaste: false,
      maxTitleLength: 42,
      excludedSites: 'tiktok.com, example.org',
      excludedSiteFormat: 'domain',
      useSelectionAsTitle: true,
    });
  });

  it('handles a paste once when both are enabled', async function () {
    await obsidianPage.enablePlugin(AUTO_LINK_TITLE);
    await browser.executeObsidian(async ({ app }) => {
      const p = (app as any).plugins.plugins['obsidian-auto-link-title'];
      p.settings.enhanceDefaultPaste = true;
      await p.saveSettings();
    });
    await openNote('‸');
    const url = `${base}/page?title=Once`;
    await paste(url);
    await settled();
    // Give Auto Link Title's own fetch time to land if it had taken the
    // paste too.
    await browser.pause(1500);
    expect(await editorValue()).toBe(`[Once](${url})`);
  });
});
