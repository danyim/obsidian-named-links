/**
 * Regenerates the README screenshots from a real Obsidian render.
 *
 * Run with `npm run screenshots`. Writes straight into screenshots/, so the
 * images in the README are always something the current code produced.
 *
 * Each image is a composite: the same view rendered in light mode on the left
 * and dark mode on the right, joined at a seam down the middle.
 *
 * Adapted from the capture script in danyim/obsidian-list-callouts-improved.
 */
import { browser } from '@wdio/globals';
import * as fs from 'fs/promises';
import { before, describe, it } from 'mocha';
import * as path from 'path';

import type { NamedLinksSettings } from '../../src/settings';
import { isMobile, resetPlugin, setSettings } from '../helpers';

const OUT_DIR = path.resolve('screenshots');

/** Gutter between the two halves of a composite, in pixels. */
const GAP = 20;

/**
 * The settings the pictures show: the defaults, with the title clean-up and
 * an excluded site filled in so the rows read as they do in use.
 */
const SHOWN_SETTINGS: Partial<NamedLinksSettings> = {
  removeSiteName: true,
  titleRules: '(Official Video) =>\n/\\s+on X$/ =>',
  excludedSites: 'localhost',
};

async function setColorScheme(dark: boolean): Promise<void> {
  await browser.execute((isDark: boolean) => {
    document.body.classList.toggle('theme-dark', isDark);
    document.body.classList.toggle('theme-light', !isDark);
  }, dark);

  // Let the repaint settle before the screenshot.
  await browser.pause(250);
}

/**
 * Stitch two captures side by side on a canvas.
 *
 * Done in the page rather than with an image library so `npm run screenshots`
 * needs nothing beyond what the tests already install. A canvas is also not
 * bound by the window size, which a screenshot of a composed element would be.
 */
async function sideBySide(light: string, dark: string): Promise<Buffer> {
  const encoded = await browser.executeObsidian(
    async (_obsidian, lightData: string, darkData: string, gap: number) => {
      const load = (data: string) =>
        new Promise<HTMLImageElement>((resolve, reject) => {
          const img = new Image();
          img.onload = () => resolve(img);
          img.onerror = () => reject(new Error('could not decode a capture'));
          img.src = `data:image/png;base64,${data}`;
        });

      const [a, b] = await Promise.all([load(lightData), load(darkData)]);

      const canvas = document.createElement('canvas');
      canvas.width = a.width + gap + b.width;
      canvas.height = Math.max(a.height, b.height);

      const ctx = canvas.getContext('2d')!;
      ctx.drawImage(a, 0, 0);
      ctx.drawImage(b, a.width + gap, 0);

      // Nothing is left transparent: the gap and whatever lies below the
      // shorter capture take on the background of the half they belong to,
      // so the seam sits in the middle and no viewer shows a checkerboard.
      // The color comes from the capture's bottom row, below the last
      // settings group, which is plain page background; the top edge can
      // carry the remains of a shadow or fade from above the pane.
      const cornerColor = (img: HTMLImageElement, x: number) => {
        const probe = document.createElement('canvas');
        probe.width = 1;
        probe.height = 1;
        const probeCtx = probe.getContext('2d')!;
        probeCtx.drawImage(img, x, img.height - 1, 1, 1, 0, 0, 1, 1);
        const [r, g, bl] = probeCtx.getImageData(0, 0, 1, 1).data;
        return `rgb(${r}, ${g}, ${bl})`;
      };

      const half = Math.floor(gap / 2);
      const mid = a.width + half;

      ctx.fillStyle = cornerColor(a, a.width - 1);
      ctx.fillRect(a.width, 0, half, canvas.height);
      ctx.fillRect(0, a.height, a.width, canvas.height - a.height);

      ctx.fillStyle = cornerColor(b, 0);
      ctx.fillRect(mid, 0, gap - half, canvas.height);
      ctx.fillRect(a.width + gap, b.height, b.width, canvas.height - b.height);

      return canvas.toDataURL('image/png').split(',')[1];
    },
    light,
    dark,
    GAP
  );

  return Buffer.from(encoded, 'base64');
}

/**
 * Base64 of an element crop.
 *
 * Goes via a file because element.takeScreenshot() hands back the whole
 * viewport here rather than the element's box, while saveScreenshot crops
 * correctly.
 */
async function shotElement(selector: string, label: string): Promise<string> {
  const el = browser.$(selector);
  await el.waitForExist({ timeout: 10000 });

  const tmp = path.join(OUT_DIR, `.tmp-${label}.png`);
  await el.saveScreenshot(tmp);

  try {
    return (await fs.readFile(tmp)).toString('base64');
  } finally {
    await fs.rm(tmp, { force: true });
  }
}

/** The settings pane holding the plugin's own rows, without the tab sidebar. */
async function settingsPane(): Promise<string> {
  // Inner content first: the outer container carries wide empty margins and
  // the scrollbar gutter.
  const candidates = [
    '.vertical-tab-content',
    '.vertical-tab-content-container',
    '.modal-content .vertical-tab-content',
  ];

  for (const selector of candidates) {
    if (await browser.$(selector).isExisting()) return selector;
  }

  throw new Error(
    `None of these matched the settings pane: ${candidates.join(', ')}`
  );
}

/** Whether the current window shows this plugin's settings tab. */
function showsOurTab(): Promise<boolean> {
  return browser.execute(() =>
    Array.from(document.querySelectorAll('.vertical-tab-content')).some((el) =>
      (el.textContent ?? '').includes('Excluded sites')
    )
  );
}

/**
 * Open the plugin settings and switch to whichever window they render in.
 *
 * On Obsidian 1.13 desktop the settings tab opens in its own window, so
 * anything that looks at its DOM has to run against that window handle.
 */
async function enterSettingsWindow(): Promise<{
  pane: string;
  original: string;
  /**
   * Height of whatever floats over the top of the pane: on a phone, the
   * tab's header (back button, title, close) is laid over the scrolling pane
   * rather than above it. 0 on desktop.
   */
  topInset: number;
}> {
  await browser.executeObsidian(({ app }) => {
    const setting = (app as any).setting;
    setting.open();
    setting.openTabById('named-links');
  });

  const original = await browser.getWindowHandle();

  let found = false;
  await browser.waitUntil(
    async () => {
      for (const handle of await browser.getWindowHandles()) {
        await browser.switchToWindow(handle);
        if (await showsOurTab()) {
          found = true;
          return true;
        }
      }
      return false;
    },
    { timeout: 10000, interval: 250 }
  );

  if (!found) {
    await browser.switchToWindow(original);
    throw new Error('Could not find a window showing the plugin settings');
  }

  const pane = await settingsPane();

  await browser.execute(() => {
    const style = document.createElement('style');
    style.textContent = [
      // On a phone, the settings header (with a fade that reaches past its
      // own box) and its round buttons, which sit beside it rather than in
      // it and cast shadows below it, float over the top of the pane, and the app's navigation bar floats over the bottom, higher
      // than SLICE_INSET allows for. Each slice starts below the header and
      // ends above the bottom inset, so whatever of them reaches further
      // would cloud the edges of every slice and show as a band at each
      // seam. Neither is part of the settings tab.
      '.modal-header, .modal-header::after, .modal-header-button, .modal-setting-back-button { visibility: hidden !important; }',
      '.mobile-navbar { display: none !important; }',
      // Inter draws "=>" as an arrow, which would show the title rules in a
      // form nobody can type.
      'body, body * { font-variant-ligatures: none; font-feature-settings: "calt" 0; }',
    ].join('\n');
    document.head.appendChild(style);
  });

  // The popout opens at whatever size Obsidian last used. Ask for room; a
  // window manager may decline, and there the window keeps its size. (The
  // driver's own setWindowSize is not implemented for Electron popouts,
  // hence the DOM call.)
  await browser.execute(() => window.resizeTo(1280, 1000));
  await browser.pause(250);

  // Obsidian centers the settings column inside a much wider pane, which would
  // leave the image mostly empty background. Narrow the pane to the column,
  // or to what the window can show if that is less: anything past the
  // window's edge is simply absent from a screenshot.
  const topInset = await browser.execute((selector: string) => {
    const el = document.querySelector<HTMLElement>(selector);
    if (!el) return 0;

    // The phone header is absolutely positioned over the pane's top, and the
    // pane's own padding is what keeps its content out from under it;
    // replacing that padding has to keep the clearance.
    const header = el
      .closest('.modal')
      ?.querySelector<HTMLElement>(':scope > .modal-header');
    const inset =
      header && getComputedStyle(header).position === 'absolute'
        ? Math.ceil(header.getBoundingClientRect().bottom)
        : 0;

    el.style.setProperty('padding', `${inset + 16}px 16px 16px`, 'important');

    const room = window.innerWidth - el.getBoundingClientRect().left - 16;
    const width = Math.min(720, room);
    el.style.setProperty('width', `${width}px`, 'important');
    el.style.setProperty('max-width', `${width}px`, 'important');

    return inset;
  }, pane);

  return { pane, original, topInset };
}

/** One viewport's worth of a scrolled element, and the slice of it that is new. */
interface PaneSlice {
  data: string;
  /** CSS width of the shot, so the slice can be scaled to the image's pixels. */
  cssWidth: number;
  /** Where the not-yet-captured content starts in this shot, in CSS px. */
  y: number;
  height: number;
}

/** Marks the element being scrolled and shot, so each round trip finds it. */
const SCROLLER_ATTR = 'data-nl-capture-scroller';

/**
 * Height, in CSS px, left out of the bottom of every slice. Whatever floats
 * over the bottom of a window (Obsidian's status bar, today) never makes it
 * into a capture, without having to know what it is.
 */
const SLICE_INSET = 48;

/**
 * Shoot scrolling content in full, however tall it is and however small the
 * window.
 *
 * The scroll container is found from `anchor`: the nearest ancestor that
 * scrolls, or failing that the nearest one allowed to. An element screenshot
 * only ever shows the part of it inside the window, so the content is shot
 * one window at a time and the slices stacked.
 *
 * Each slice begins exactly where the previous one ended: the container is
 * padded by a window's worth at the bottom first, so scrolling never clamps
 * short of the content and there is no overlap to subtract. A seam a pixel
 * off doubles a line of text. The padding is trimmed from the result.
 *
 * `topInset` is how much of the container's top something else covers (the
 * phone header): left out of every slice, like the bottom inset, and never
 * scrolled into view; the first slice starts below it.
 */
async function shotScrolled(
  anchor: string,
  label: string,
  topInset = 0
): Promise<string> {
  const contentHeight = await browser.execute(
    (selector: string, attr: string) => {
      const scrolls = (el: HTMLElement) =>
        /(auto|scroll)/.test(getComputedStyle(el).overflowY);

      let found: HTMLElement | null = null;
      for (
        let el = document.querySelector<HTMLElement>(selector);
        el;
        el = el.parentElement
      ) {
        if (scrolls(el) && el.scrollHeight > el.clientHeight + 1) {
          found = el;
          break;
        }
        if (!found && scrolls(el)) found = el;
      }

      const scroller = found ?? document.querySelector<HTMLElement>(selector)!;
      const height = scroller.scrollHeight;

      scroller.setAttribute(attr, '');
      // The scrollbar thumb would otherwise be stitched in at a different
      // height in every slice.
      scroller.style.setProperty('scrollbar-width', 'none');
      scroller.style.setProperty(
        'padding-bottom',
        `${window.innerHeight}px`,
        'important'
      );

      return height;
    },
    anchor,
    SCROLLER_ATTR
  );

  const scrollerSelector = `[${SCROLLER_ATTR}]`;

  const slices: PaneSlice[] = [];
  // What the inset covers is only ever padding, added by enterSettingsWindow
  // to keep the content clear of the header, so skipping it loses nothing.
  let covered = topInset;

  while (covered < contentHeight) {
    const m = await browser.execute(
      (selector: string, target: number, top: number, bottom: number) => {
        const el = document.querySelector<HTMLElement>(selector)!;

        // Put content offset `target` at the top of the on-screen part of the
        // box, which is the box's own top unless that sits above the window
        // or under the inset.
        const above = Math.max(0, top - el.getBoundingClientRect().top);
        el.scrollTop = target - above;

        const r = el.getBoundingClientRect();
        // The shot is of the box's on-screen part, insets included: they are
        // trimmed from the slice afterward, not from the shot.
        const shotTop = Math.max(r.top, 0);
        const usableBottom = Math.min(r.bottom, window.innerHeight - bottom);
        const visLeft = Math.max(r.left, 0);
        const visRight = Math.min(r.right, window.innerWidth);

        // Rects are fractional; the screenshot is not.
        return {
          shownFrom: Math.round(el.scrollTop + (shotTop - r.top)),
          usableHeight: Math.round(usableBottom - shotTop),
          shotWidth: Math.round(visRight - visLeft),
        };
      },
      scrollerSelector,
      covered,
      topInset,
      SLICE_INSET
    );
    // Let the scroll and any repaint settle before shooting.
    await browser.pause(150);

    const y = covered - m.shownFrom;
    const height = Math.min(m.usableHeight - y, contentHeight - covered);
    if (height <= 0) {
      throw new Error(
        `Could not scroll ${anchor} past ${covered}px of ${contentHeight}px`
      );
    }

    const data = await shotElement(
      scrollerSelector,
      `${label}-${slices.length}`
    );
    slices.push({ data, cssWidth: m.shotWidth, y, height });
    covered += height;
  }

  await browser.execute(
    (selector: string, attr: string) => {
      const el = document.querySelector<HTMLElement>(selector)!;
      el.scrollTop = 0;
      el.style.removeProperty('scrollbar-width');
      el.style.removeProperty('padding-bottom');
      el.removeAttribute(attr);
    },
    scrollerSelector,
    SCROLLER_ATTR
  );

  return stackVertically(slices);
}

/** Stitch pane slices top to bottom on a canvas, returning base64 PNG data. */
async function stackVertically(slices: PaneSlice[]): Promise<string> {
  return browser.execute(async (parts: PaneSlice[]) => {
    const load = (data: string) =>
      new Promise<HTMLImageElement>((resolve, reject) => {
        const img = new Image();
        img.onload = () => resolve(img);
        img.onerror = () => reject(new Error('could not decode a capture'));
        img.src = `data:image/png;base64,${data}`;
      });

    const images = await Promise.all(parts.map((p) => load(p.data)));

    // A retina display shoots at more than one pixel per CSS pixel, so the
    // CSS-measured slice has to be scaled to the image's own pixels.
    const scaled = parts.map((p, i) => {
      const scale = images[i].width / p.cssWidth;
      return { img: images[i], y: p.y * scale, height: p.height * scale };
    });

    const canvas = document.createElement('canvas');
    canvas.width = Math.max(...scaled.map((s) => s.img.width));
    canvas.height = Math.ceil(scaled.reduce((sum, s) => sum + s.height, 0));

    const ctx = canvas.getContext('2d')!;
    let offset = 0;
    for (const { img, y, height } of scaled) {
      ctx.drawImage(img, 0, y, img.width, height, 0, offset, img.width, height);
      offset += height;
    }

    return canvas.toDataURL('image/png').split(',')[1];
  }, slices);
}

/** Capture the whole of the plugin's settings tab, in both color schemes. */
async function captureSettingsPage(name: string): Promise<void> {
  await fs.mkdir(OUT_DIR, { recursive: true });

  const { pane, original, topInset } = await enterSettingsWindow();

  await setColorScheme(false);
  const light = await shotScrolled(pane, 'settings-light', topInset);

  await setColorScheme(true);
  const dark = await shotScrolled(pane, 'settings-dark', topInset);

  await setColorScheme(false);

  // Compose back in the main window, where the Obsidian globals live.
  await browser.switchToWindow(original);
  await browser.executeObsidian(({ app }) => (app as any).setting.close());
  await fs.writeFile(path.join(OUT_DIR, name), await sideBySide(light, dark));
}

/**
 * The vault asks for Inter so the images do not depend on whatever the
 * capturing machine's default sans-serif happens to be. Fail rather than
 * quietly fall back to another typeface.
 */
async function assertInterFont(): Promise<void> {
  const font = await browser.executeObsidian(() => ({
    installed: document.fonts.check('16px Inter'),
    family: getComputedStyle(document.body).fontFamily,
  }));

  if (!font.installed || !/inter/i.test(font.family)) {
    throw new Error(
      `Screenshots need the Inter font. Resolved family: ${font.family}. ` +
        'Install it with: sudo apt-get install fonts-inter'
    );
  }
}

/** Pinned rather than inherited, so the images never depend on saved state. */
async function prepare(): Promise<void> {
  await resetPlugin();
  await setSettings(SHOWN_SETTINGS);
  await assertInterFont();
}

describe('README screenshots', function () {
  before(async function () {
    // The desktop set; the emulated phone gets the suite below instead.
    if (await isMobile()) this.skip();
    await prepare();
  });

  it('captures the whole settings tab', async function () {
    await captureSettingsPage('settings.png');
  });
});

/**
 * The settings tab as a phone lays it out: one narrow column, with each
 * control below its description rather than beside it.
 */
describe('README screenshots (mobile)', function () {
  before(async function () {
    if (!(await isMobile())) this.skip();
    await prepare();
  });

  it('captures the whole settings tab', async function () {
    await captureSettingsPage('settings-mobile.png');
  });
});
