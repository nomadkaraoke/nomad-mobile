/**
 * Wraps text that goes into a translated sentence (a song title, an email) in Unicode first-strong
 * isolate marks (U+2068 … U+2069). Without them, a Latin title inside an Arabic or Hebrew sentence
 * gets its words reordered around the surrounding text.
 */
export const isolate = (value: string): string => (value ? `⁨${value}⁩` : value);
