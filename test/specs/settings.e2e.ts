import { browser, expect } from '@wdio/globals';

import {
  captureRendering,
  getSettings,
  removeAutoLinkTitle,
  resetPlugin,
} from '../helpers';

async function openSettings() {
  await browser.executeObsidian(({ app }) => {
    const setting = (app as any).setting;
    setting.open();
    setting.openTabById('named-links');
  });
  await browser.waitUntil(
    async () => (await settingsText()).includes('Excluded sites'),
    { timeout: 10000, timeoutMsg: 'settings tab did not render' }
  );
}

function settingsText(): Promise<string> {
  return browser.executeObsidian(({ app }) => {
    const el = (app as any).setting.activeTab?.containerEl as
      HTMLElement | undefined;
    return (el?.innerText ?? '') as string;
  });
}

async function closeSettings() {
  await browser.executeObsidian(({ app }) => (app as any).setting.close());
}

describe('Settings tab', function () {
  beforeEach(async function () {
    await resetPlugin();
    await removeAutoLinkTitle();
  });

  afterEach(async function () {
    await closeSettings();
  });

  it('shows every setting', async function () {
    await openSettings();
    const text = await settingsText();
    for (const name of [
      'When to fetch titles',
      'Title pasted URLs',
      'Title dropped URLs',
      'Use the selection as the title',
      'Skip code and frontmatter',
      'Maximum title length',
      'Fetch X posts through FxTwitter',
      'Excluded sites',
      'Paste excluded sites as',
    ]) {
      expect(text).toContain(name);
    }
    // Neither Auto Link Title row applies to a vault without it.
    expect(text).not.toContain('Import from Auto Link Title');
    expect(text).not.toContain('Auto Link Title is also enabled');
    // Let the settings open animation finish before the capture.
    await browser.pause(500);
    await captureRendering('settings', { window: 'newest' });
  });

  it('saves a toggled setting', async function () {
    await openSettings();
    await browser.executeObsidian(({ app }) => {
      const el = (app as any).setting.activeTab.containerEl as HTMLElement;
      const row = Array.from(el.querySelectorAll('.setting-item')).find((r) =>
        r.textContent?.includes('Use the selection as the title')
      )!;
      (row.querySelector('.checkbox-container') as HTMLElement).click();
    });
    await browser.waitUntil(
      async () => (await getSettings()).useSelectionAsTitle === true,
      { timeoutMsg: 'toggle did not reach the settings' }
    );
    const saved = await browser.executeObsidian(({ app }) =>
      (app as any).plugins.plugins['named-links'].loadData()
    );
    expect(saved.useSelectionAsTitle).toBe(true);
  });

  it('saves the excluded sites text', async function () {
    await openSettings();
    await browser.executeObsidian(({ app }) => {
      const el = (app as any).setting.activeTab.containerEl as HTMLElement;
      const area = el.querySelector('textarea') as HTMLTextAreaElement;
      area.value = 'example.com\nlocalhost';
      area.dispatchEvent(new Event('input', { bubbles: true }));
      area.dispatchEvent(new Event('change', { bubbles: true }));
      area.blur();
    });
    await browser.waitUntil(
      async () =>
        (await getSettings()).excludedSites === 'example.com\nlocalhost',
      { timeoutMsg: 'excluded sites did not reach the settings' }
    );
  });
});
