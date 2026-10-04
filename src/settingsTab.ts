import {
  App,
  Modal,
  Notice,
  PluginSettingTab,
  Setting,
  SettingDefinitionItem,
} from 'obsidian';

import { RuleProblem, parseDomainTitleRules, parseTitleRules } from './cleanup';
import { t } from './lang';
import { TemplateError, validateTemplate } from './linkFormat';
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

/**
 * What's wrong with a set of title rules, one sentence per bad line, or
 * nothing if every line reads. Bad lines are skipped when the rules run, so
 * this is the only place they show up.
 */
function describeRuleProblems(problems: RuleProblem[]): string | void {
  const strings = t().settings.titleRules;
  if (problems.length === 0) return;
  return problems
    .map((p) =>
      strings.problem(
        p.line,
        p.kind === 'invalidRegex'
          ? strings.invalidRegex(p.message)
          : strings[p.kind]
      )
    )
    .join(' ');
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
    // The custom format field shows only for the Custom preset.
    if (key === 'linkFormat') this.refreshDomState();
  }

  private templateError(error: TemplateError | null): string | undefined {
    if (!error) return undefined;
    const messages = t().settings.templateErrors;
    switch (error.code) {
      case 'missingUrl':
        return messages.missingUrl;
      case 'unknownPlaceholder':
        return messages.unknownPlaceholder(error.name);
      case 'unquotedInTag':
        return messages.unquotedInTag(error.name);
      case 'emptyDateFormat':
        return messages.emptyDateFormat;
    }
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
        heading: s.linkFormatHeading,
        items: [
          {
            ...s.linkFormat,
            control: {
              type: 'dropdown',
              key: 'linkFormat',
              defaultValue: DEFAULT_SETTINGS.linkFormat,
              options: {
                markdown: s.linkFormat.markdown,
                'markdown-title': s.linkFormat.markdownTitle,
                html: s.linkFormat.html,
                custom: s.linkFormat.custom,
              },
            },
          },
          {
            ...s.customLinkFormat,
            visible: () => this.plugin.settings.linkFormat === 'custom',
            control: {
              type: 'text',
              key: 'customLinkFormat',
              defaultValue: DEFAULT_SETTINGS.customLinkFormat,
              placeholder: DEFAULT_SETTINGS.customLinkFormat,
              validate: (value: string) =>
                this.templateError(validateTemplate(value)),
            },
          },
          {
            ...s.decodeUrls,
            control: {
              type: 'toggle',
              key: 'decodeUrls',
              defaultValue: DEFAULT_SETTINGS.decodeUrls,
            },
          },
        ],
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
            ...s.pasteTitleOntoUrl,
            control: {
              type: 'toggle',
              key: 'pasteTitleOntoUrl',
              defaultValue: DEFAULT_SETTINGS.pasteTitleOntoUrl,
            },
          },
        ],
      },
      {
        type: 'group',
        heading: s.titlesHeading,
        items: [
          {
            ...s.removeSiteName,
            control: {
              type: 'toggle',
              key: 'removeSiteName',
              defaultValue: DEFAULT_SETTINGS.removeSiteName,
            },
          },
          {
            ...s.domainTitleRules,
            control: {
              type: 'textarea',
              key: 'domainTitleRules',
              defaultValue: DEFAULT_SETTINGS.domainTitleRules,
              placeholder:
                'github.com: /^GitHub - / =>\nyoutube.com: (Official Video) =>',
              rows: 4,
              validate: (value: string) =>
                describeRuleProblems(parseDomainTitleRules(value).problems),
            },
          },
          {
            name: s.titleRules.name,
            desc: s.titleRules.desc,
            control: {
              type: 'textarea',
              key: 'titleRules',
              defaultValue: DEFAULT_SETTINGS.titleRules,
              placeholder: '/\\s*\\|\\s*My Site$/ =>\n(Official Video) =>',
              rows: 4,
              validate: (value: string) =>
                describeRuleProblems(parseTitleRules(value).problems),
            },
          },
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
