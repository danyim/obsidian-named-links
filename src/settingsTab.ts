import {
  App,
  Modal,
  Notice,
  PluginSettingTab,
  Setting,
  SettingDefinitionItem,
} from 'obsidian';

import { t } from './lang';
import type NamedLinksPlugin from './main';
import {
  AUTO_LINK_TITLE_NAME,
  DEFAULT_SETTINGS,
  mergeSettings,
} from './settings';

export class ConfirmImportModal extends Modal {
  constructor(
    app: App,
    private onConfirm: () => void
  ) {
    super(app);
  }

  onOpen(): void {
    const s = t().settings.import;
    this.titleEl.setText(s.name(AUTO_LINK_TITLE_NAME));
    this.contentEl.createEl('p', { text: s.confirm(AUTO_LINK_TITLE_NAME) });
    new Setting(this.contentEl)
      .addButton((btn) =>
        btn.setButtonText(s.cancel).onClick(() => this.close())
      )
      .addButton((btn) =>
        btn
          .setButtonText(s.button)
          .setCta()
          .onClick(() => {
            this.close();
            this.onConfirm();
          })
      );
  }

  onClose(): void {
    this.contentEl.empty();
  }
}

export class NamedLinksSettingTab extends PluginSettingTab {
  constructor(
    app: App,
    private plugin: NamedLinksPlugin
  ) {
    super(app, plugin);
  }

  getControlValue(key: string): unknown {
    return (this.plugin.settings as unknown as Record<string, unknown>)[key];
  }

  async setControlValue(key: string, value: unknown): Promise<void> {
    this.plugin.settings = mergeSettings({
      ...this.plugin.settings,
      [key]: value,
    });
    await this.plugin.saveSettings();
  }

  private async runImport(): Promise<void> {
    const notices = t().notices;
    try {
      await this.plugin.importAutoLinkTitleSettings();
      new Notice(notices.imported(AUTO_LINK_TITLE_NAME));
      this.update();
    } catch (e) {
      new Notice(notices.importFailed((e as Error).message));
    }
  }

  getSettingDefinitions(): SettingDefinitionItem[] {
    const s = t().settings;
    return [
      {
        name: s.conflict.name(AUTO_LINK_TITLE_NAME),
        desc: s.conflict.desc(AUTO_LINK_TITLE_NAME),
        visible: () => this.plugin.autoLinkTitleEnabled(),
      },
      {
        name: s.import.name(AUTO_LINK_TITLE_NAME),
        desc: s.import.desc(AUTO_LINK_TITLE_NAME),
        // Evaluated each time the tab renders, which makes it the one place
        // to notice that the other plugin has saved settings since load. The
        // check is async and this isn't, so the row paints from the last
        // answer and is toggled if that changed.
        visible: () => {
          void this.plugin.checkForAutoLinkTitleData().then((changed) => {
            if (changed) this.refreshDomState();
          });
          return this.plugin.autoLinkTitleDataAvailable;
        },
        render: (setting: Setting) => {
          setting.addButton((btn) =>
            btn
              .setButtonText(s.import.button)
              .setCta()
              .onClick(() => {
                new ConfirmImportModal(this.app, () => {
                  void this.runImport();
                }).open();
              })
          );
        },
      },
      {
        type: 'group',
        heading: s.whenHeading,
        items: [
          {
            ...s.enhancePaste,
            control: {
              type: 'toggle',
              key: 'enhancePaste',
              defaultValue: DEFAULT_SETTINGS.enhancePaste,
            },
          },
          {
            ...s.enhanceDrop,
            control: {
              type: 'toggle',
              key: 'enhanceDrop',
              defaultValue: DEFAULT_SETTINGS.enhanceDrop,
            },
          },
          {
            ...s.useSelectionAsTitle,
            control: {
              type: 'toggle',
              key: 'useSelectionAsTitle',
              defaultValue: DEFAULT_SETTINGS.useSelectionAsTitle,
            },
          },
          {
            ...s.skipCodeAndFrontmatter,
            control: {
              type: 'toggle',
              key: 'skipCodeAndFrontmatter',
              defaultValue: DEFAULT_SETTINGS.skipCodeAndFrontmatter,
            },
          },
        ],
      },
      {
        type: 'group',
        heading: s.titlesHeading,
        items: [
          {
            ...s.maxTitleLength,
            control: {
              type: 'number',
              key: 'maxTitleLength',
              defaultValue: DEFAULT_SETTINGS.maxTitleLength,
              min: 0,
              step: 1,
            },
          },
          {
            ...s.twitterProxy,
            control: {
              type: 'toggle',
              key: 'twitterProxy',
              defaultValue: DEFAULT_SETTINGS.twitterProxy,
            },
          },
        ],
      },
      {
        type: 'group',
        heading: s.excludedHeading,
        items: [
          {
            ...s.excludedSites,
            control: {
              type: 'textarea',
              key: 'excludedSites',
              defaultValue: DEFAULT_SETTINGS.excludedSites,
              placeholder: 'localhost\nexample.com',
              rows: 4,
            },
          },
          {
            name: s.excludedSiteFormat.name,
            control: {
              type: 'dropdown',
              key: 'excludedSiteFormat',
              defaultValue: DEFAULT_SETTINGS.excludedSiteFormat,
              options: {
                url: s.excludedSiteFormat.url,
                domain: s.excludedSiteFormat.domain,
              },
            },
          },
        ],
      },
    ];
  }
}
