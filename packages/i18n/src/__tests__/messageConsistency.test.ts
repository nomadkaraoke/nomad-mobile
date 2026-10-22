import * as fs from 'fs';
import * as path from 'path';

import { LOCALES } from '../locales';

// Machine translation slips that i18n:check (keys + placeholders) can't see.

type Messages = { [key: string]: string | Messages };

const MESSAGES_DIR = path.join(__dirname, '../../messages');

function load(locale: string): Messages {
  return JSON.parse(fs.readFileSync(path.join(MESSAGES_DIR, `${locale}.json`), 'utf8')) as Messages;
}

function flatten(messages: Messages, prefix = ''): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(messages)) {
    const full = prefix + key;
    if (typeof value === 'string') out[full] = value;
    else Object.assign(out, flatten(value, `${full}.`));
  }
  return out;
}

const en = flatten(load('en'));
const others = LOCALES.filter((l) => l !== 'en');

// A "$" next to a placeholder (either side: ro writes "{amount} $") stays exactly where English has one. Dropped,
// the user sees a bare number; added before a placeholder that is already formatted with its currency (tips.perk
// gets t('amount')), it renders "$$10".
describe.each(others)('%s currency signs', (locale) => {
  const messages = flatten(load(locale));
  it('keeps a "$" by a placeholder where English has one and adds none elsewhere', () => {
    const problems: string[] = [];
    for (const [key, source] of Object.entries(en)) {
      const translated = messages[key];
      if (translated === undefined) continue;
      for (const [, name] of source.matchAll(/\{(\w+)\}/g)) {
        const dollar = new RegExp(`\\$\\s?\\{${name}\\}|\\{${name}\\}\\s?\\$`);
        const enHasDollar = dollar.test(source);
        const hasDollar = dollar.test(translated);
        if (enHasDollar !== hasDollar) problems.push(`${key}: ${translated}`);
      }
    }
    expect(problems).toEqual([]);
  });
});

// The Tonight tab has a translated name in every locale; copy pointing back to it must use that name.
describe.each(others)('%s Tonight tab name', (locale) => {
  const messages = flatten(load(locale));
  it('never says the English "Tonight" in Tonight copy', () => {
    const tab = messages['tabs.tonight'];
    const leaks = Object.entries(messages).filter(
      ([key, value]) => key.startsWith('tonight.') && value.includes('Tonight') && tab !== 'Tonight',
    );
    expect(leaks).toEqual([]);
    expect(tab).not.toBe('Tonight');
  });
});
