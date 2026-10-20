/**
 * Wraps text that goes into a translated sentence (a song title, an email) in Unicode first-strong
 * isolate marks (U+2068 … U+2069). Without them, a Latin title inside an Arabic or Hebrew sentence
 * gets its words reordered around the surrounding text.
 */
export const isolate = (value: string): string => (value ? `⁨${value}⁩` : value);

/**
 * Wraps text that must always read left to right (a "0:06 / 0:30" time, a "1×" rate) in left-to-right
 * isolate marks (U+2066 … U+2069). Digits and separators are weak or neutral, so inside RTL text the
 * pieces got reordered (Android showed "0:30 / 0:06").
 */
export const isolateLtr = (value: string): string => (value ? `\u2066${value}\u2069` : value);
