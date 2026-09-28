import * as path from 'path';
import { env } from 'process';
import { obsidianBetaAvailable, parseObsidianVersions } from 'wdio-obsidian-service';

// wdio-obsidian-service downloads Obsidian versions into this directory.
const cacheDir = path.resolve('.obsidian-cache');

// Our minAppVersion is 1.13.0, but 1.13.0 through 1.13.3 were insiders-only
// releases with no public installer, so wdio's "earliest" can't be downloaded
// without Catalyst credentials. 1.13.4 is the oldest public build at or above
// our floor.
const OLDEST_PUBLIC_VERSION = '1.13.4';

// The plugin this one was forked from, pinned so a new upstream release can't
// change what the tests exercise.
const AUTO_LINK_TITLE_VERSION = '1.5.5';

let defaultVersions = `${OLDEST_PUBLIC_VERSION}/latest latest/latest`;
if (await obsidianBetaAvailable({ cacheDir })) {
  defaultVersions += ' latest-beta/latest';
}

const desktopVersions = await parseObsidianVersions(
  env.OBSIDIAN_VERSIONS ?? defaultVersions,
  { cacheDir }
);

if (env.CI) {
  // Printed so the workflow can key its Obsidian download cache on it.
  console.log('obsidian-cache-key:', JSON.stringify(desktopVersions));
}

// Auto Link Title is installed but left off so most specs don't see it. The
// coexistence spec turns it on to check that the two plugins don't both act
// on one paste, and that the import reads what it really writes.
const plugins = [
  '..',
  {
    repo: 'zolrath/obsidian-auto-link-title',
    version: AUTO_LINK_TITLE_VERSION,
    enabled: false,
  },
];

export const config: WebdriverIO.Config = {
  runner: 'local',
  framework: 'mocha',

  specs: ['../test/specs/**/*.e2e.ts'],

  maxInstances: Number(env.WDIO_MAX_INSTANCES || 4),

  capabilities: [
    ...desktopVersions.map<WebdriverIO.Capabilities>(
      ([appVersion, installerVersion]) => ({
        browserName: 'obsidian',
        'wdio:obsidianOptions': {
          appVersion,
          installerVersion,
          plugins,
          vault: '../test/vaults/basic',
        },
      })
    ),
    // Obsidian's mobile UI is a different layout for the settings tab, and
    // requestUrl is the only way the plugin reaches the network there too.
    ...desktopVersions.map<WebdriverIO.Capabilities>(
      ([appVersion, installerVersion]) => ({
        browserName: 'obsidian',
        'wdio:obsidianOptions': {
          appVersion,
          installerVersion,
          emulateMobile: true,
          plugins,
          vault: '../test/vaults/basic',
        },
        'goog:chromeOptions': {
          mobileEmulation: {
            deviceMetrics: { width: 390, height: 844 },
          },
        },
      })
    ),
  ],

  services: ['obsidian'],
  reporters: ['obsidian'],

  mochaOpts: {
    ui: 'bdd',
    // reloadObsidian reboots the app, which is slow enough on a loaded CI box
    // that a 60s ceiling trips on hooks that use it.
    timeout: 120 * 1000,
  },

  waitforInterval: 250,
  waitforTimeout: 5 * 1000,
  logLevel: 'warn',

  cacheDir: cacheDir,

  injectGlobals: false,
};
