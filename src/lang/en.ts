/** English strings, and the shape every other locale fills in. */
const en = {
  commands: {
    pasteWithTitle: 'Paste URL and fetch its title',
    pasteWithoutTitle: 'Paste without fetching a title',
    enhance: 'Add a title to an existing URL',
  },
  notices: {
    offline: 'No internet connection, so no title was fetched.',
    noTitle: (host: string) => `Couldn't find a title for ${host}.`,
    noUrlHere: 'There is no URL here to add a title to.',
    noUrlInSelection: 'The selection has no URL in it.',
    imported: (from: string) => `Imported settings from ${from}.`,
    importFailed: (reason: string) => `Import failed. ${reason}`,
    importInvalidJson: (from: string) =>
      `The settings file of ${from} isn't valid JSON.`,
    importEmpty: (from: string) =>
      `The settings file of ${from} has no settings in it.`,
  },
  placeholder: 'Fetching title…',
  settings: {
    conflict: {
      name: (other: string) => `${other} is also enabled`,
      desc: (other: string) =>
        `Both plugins act on pasted URLs, and whichever runs first wins. Disable ${other} in community plugins once you've moved over.`,
    },
    import: {
      name: (from: string) => `Import from ${from}`,
      desc: (from: string) =>
        `Settings from ${from} were found in this vault and can be copied over.`,
      button: 'Import',
      confirm: (from: string) =>
        `This replaces your current settings with the ones saved by ${from}. It can't be undone.`,
      cancel: 'Cancel',
    },
    whenHeading: 'When to fetch titles',
    enhancePaste: {
      name: 'Title pasted URLs',
      desc: 'Fetch the title of a URL pasted with the normal paste command. Pasting as plain text (Ctrl/Cmd+Shift+V) always leaves the URL as it is.',
    },
    enhanceDrop: {
      name: 'Title dropped URLs',
      desc: 'Fetch the title of a URL dragged in from another app.',
    },
    useSelectionAsTitle: {
      name: 'Use the selection as the title',
      desc: 'When a URL is pasted over selected text, link that text instead of fetching a title.',
    },
    pasteTitleOntoUrl: {
      name: 'Paste text onto a selected URL as its title',
      desc: 'When text is pasted over a selected URL or link, make the text its title instead of replacing the URL.',
    },
    titlesHeading: 'Titles',
    removeSiteName: {
      name: 'Remove the site name',
      desc: 'Drop the name of the site from the start or end of a title, as in "Video - YouTube" or "GitHub - owner/repo".',
    },
    domainTitleRules: {
      name: 'Domain title rules',
      desc: 'Find and replace in titles from one site, before the page title rules. One rule per line, written as domain: pattern => replacement. The domain also covers its subdomains; the pattern and replacement work as in page title rules.',
    },
    titleRules: {
      name: 'Page title rules',
      desc: 'Find and replace in every fetched title, after the domain title rules. One rule per line, written as pattern => replacement. Write the pattern as /pattern/flags for a regular expression, whose replacement can use $1. Lines starting with # are skipped.',
      problem: (line: number, reason: string) => `Line ${line}: ${reason}`,
      missingArrow: 'there is no => between the pattern and the replacement.',
      emptyPattern: 'the pattern is empty.',
      missingDomain:
        'it needs to start with a domain and a colon, as in example.com: pattern => replacement.',
      invalidRegex: (message: string) =>
        `the regular expression is invalid (${message}).`,
    },
    maxTitleLength: {
      name: 'Maximum title length',
      desc: 'Shorten longer titles to this many characters. 0 keeps the whole title.',
    },
    twitterProxy: {
      name: 'Fetch X posts through FxTwitter',
      desc: 'X shows no title without JavaScript. When this is on, twitter.com and x.com links are looked up through fxtwitter.com or fixupx.com, a third-party service, which then sees those URLs.',
    },
    excludedHeading: 'Excluded sites',
    excludedSites: {
      name: 'Sites',
      desc: 'Never fetch titles for these. A domain such as example.com also covers its subdomains; anything else matches any URL containing it. One per line, or separated by commas.',
    },
    excludedSiteFormat: {
      name: 'Paste excluded sites as',
      url: 'The URL as it is',
      domain: 'A link titled with the domain',
    },
    linkFormatHeading: 'Link format',
    linkFormat: {
      name: 'Link format',
      desc: 'How a finished link is written.',
      markdown: 'Markdown link',
      markdownTitle: 'Markdown link with a hover title',
      html: 'HTML link',
      custom: 'Custom',
    },
    customLinkFormat: {
      name: 'Custom format',
      desc: 'Use {title}, {url}, {domain}, {author}, {site}, {description}, {section} (the heading a #link points to) and {date} or {date:YYYY-MM-DD}. A missing value is left out along with one separator next to it (- – — | · • : , / › » →) or the parentheses around it. Text in {?…} is written only when every value in it is there, as in {title}{? | {author}}. Use only {url}, {domain} and {date} and nothing is fetched.',
    },
    decodeUrls: {
      name: 'Decode URLs',
      desc: 'Write the link with its URL decoded for reading, so %E5%AF%BF%E5%8F%B8 shows as 寿司 and %20 as a space. Characters that would change where the URL leads stay encoded.',
    },
    templateErrors: {
      missingUrl: 'The format needs {url}.',
      unknownPlaceholder: (name: string) =>
        `{${name}} isn't a placeholder. Use {title}, {url}, {domain}, {author}, {site}, {description}, {section} or {date}.`,
      unquotedInTag: (name: string) =>
        `Put {${name}} inside a quoted attribute value, such as href="{${name}}".`,
      emptyDateFormat:
        'Give {date:} a format after the colon, such as {date:YYYY-MM-DD}, or use {date}.',
      unclosedGroup: 'Close {? with a }, as in {title}{? | {author}}.',
      nestedGroup: "A {?…} group can't hold another one.",
      groupAcrossParts:
        'Keep each {?…} group within one part of the link: its text, its URL or its title.',
      groupWithoutPlaceholder:
        'Put a placeholder in each {?…} group, as in {? | {author}}. A group is written only when its values are there.',
    },
  },
};

export type Strings = typeof en;
export default en;
