import { browser, expect } from '@wdio/globals';

import {
  drop,
  editorValue,
  openNote,
  resetPlugin,
  setSettings,
  settled,
} from '../helpers';
import {
  clearRequestLog,
  fixtureBase,
  requestLog,
  stopFixtureServer,
} from '../server';

describe('Dropping a URL', function () {
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

  it('inserts the titled link where it is dropped, not at the cursor', async function () {
    // Upstream replaced the selection, so the link landed wherever the
    // cursor had been left rather than under the pointer.
    await openNote('Start here‸.\n\nDrop target: .');
    const url = `${base}/page?title=Dropped`;
    const target = 'Start here.\n\nDrop target: '.length;
    await drop(url, target);
    await settled();
    expect(await editorValue()).toBe(
      `Start here.\n\nDrop target: [Dropped](${url}).`
    );
  });

  it('leaves the drop alone when turned off', async function () {
    await setSettings({ enhanceDrop: false });
    await openNote('Target: ‸');
    await drop(`${base}/page`, 'Target: '.length);
    await settled();
    expect(await editorValue()).not.toContain('Fetching title');
    expect(requestLog()).toEqual([]);
  });

  it('leaves a drag that started inside Obsidian alone', async function () {
    // Moving a URL within a note is a drag too; taking it over would copy
    // the URL instead of moving it.
    await openNote('Target: ‸');
    await browser.executeObsidian(() => {
      document.body.dispatchEvent(
        new DragEvent('dragstart', { bubbles: true })
      );
    });
    await drop(`${base}/page`, 'Target: '.length);
    await browser.executeObsidian(() => {
      document.body.dispatchEvent(new DragEvent('dragend', { bubbles: true }));
    });
    await settled();
    expect(await editorValue()).not.toContain('Fetching title');
    expect(requestLog()).toEqual([]);
  });
});
