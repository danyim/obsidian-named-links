import assert from 'node:assert/strict';

import {
  DEFAULT_SETTINGS,
  isExcluded,
  mergeSettings,
  parseExcludedSites,
  settingsFromAutoLinkTitle,
} from '../../src/settings';

describe('isExcluded', () => {
  const excluded = (url: string, list: string) =>
    isExcluded(url, parseExcludedSites(list));

  it('matches a domain and its subdomains', () => {
    assert.equal(excluded('https://tiktok.com/@a', 'tiktok.com'), true);
    assert.equal(excluded('https://www.tiktok.com/@a', 'tiktok.com'), true);
    assert.equal(excluded('https://vm.tiktok.com/x', 'tiktok.com'), true);
  });

  it("doesn't match a different domain ending in the same letters", () => {
    // Upstream's substring test excluded netflix.com for "x.com".
    assert.equal(excluded('https://netflix.com', 'x.com'), false);
    assert.equal(excluded('https://x.com/a', 'x.com'), true);
  });

  it('accepts entries written as URLs or with www.', () => {
    assert.equal(
      excluded('https://example.com/a', 'https://example.com/'),
      true
    );
    assert.equal(excluded('https://example.com/a', 'www.example.com'), true);
  });

  it('matches localhost and a port', () => {
    assert.equal(excluded('http://localhost:3000/x', 'localhost'), true);
  });

  it('still matches other text as a substring, as upstream documented', () => {
    assert.equal(
      excluded('https://example.com/private/a', 'example.com/private'),
      true
    );
    assert.equal(excluded('https://tiktok.com', 'tiktok'), true);
  });

  it('splits on commas and newlines and ignores blanks', () => {
    assert.deepEqual(parseExcludedSites(' a.com,\n\nB.com , '), [
      'a.com',
      'b.com',
    ]);
    assert.equal(excluded('https://example.com', ''), false);
  });
});

describe('mergeSettings', () => {
  it('fills in defaults and drops mistyped values', () => {
    const merged = mergeSettings({
      enhancePaste: false,
      maxTitleLength: 'long',
      excludedSiteFormat: 'weird',
      unknown: 1,
    });
    assert.deepEqual(merged, { ...DEFAULT_SETTINGS, enhancePaste: false });
  });

  it('drops settings that no longer exist', () => {
    // "Skip code and frontmatter" was a toggle before code and frontmatter
    // were always skipped.
    const merged = mergeSettings({ skipCodeAndFrontmatter: false });
    assert.equal('skipCodeAndFrontmatter' in merged, false);
  });

  it('survives no stored data', () => {
    assert.deepEqual(mergeSettings(null), DEFAULT_SETTINGS);
  });
});

describe('settingsFromAutoLinkTitle', () => {
  it("translates Auto Link Title's keys", () => {
    assert.deepEqual(
      settingsFromAutoLinkTitle({
        enhanceDefaultPaste: false,
        enhanceDropEvents: true,
        shouldPreserveSelectionAsTitle: true,
        maximumTitleLength: 40,
        websiteBlacklist: 'tiktok.com',
        useNewScraper: true,
        linkPreviewApiKey: 'x'.repeat(32),
      }),
      {
        enhancePaste: false,
        enhanceDrop: true,
        useSelectionAsTitle: true,
        maxTitleLength: 40,
        excludedSites: 'tiktok.com',
        excludedSiteFormat: 'domain',
      }
    );
  });

  it('returns null for data from something else', () => {
    assert.equal(settingsFromAutoLinkTitle({ foo: 1 }), null);
    assert.equal(settingsFromAutoLinkTitle('nope'), null);
  });
});
