/**
 * The scraper parses HTML with the browser's DOMParser, which Node lacks.
 * linkedom's is close enough for reading <title> and <meta> tags.
 */
import { DOMParser } from 'linkedom';

(globalThis as any).DOMParser = DOMParser;
