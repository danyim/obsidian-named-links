/** Picks the locale matching Obsidian's display language. */
import { getLanguage } from 'obsidian';

import en, { Strings } from './en';
import ja from './ja';

const locales: Record<string, Strings> = { en, ja };

/**
 * Looked up on each use rather than once at import, so the strings follow
 * the language Obsidian reports rather than one captured before it was set.
 */
export function t(): Strings {
  const language = getLanguage();
  return locales[language] ?? locales[language.split('-')[0]] ?? en;
}
