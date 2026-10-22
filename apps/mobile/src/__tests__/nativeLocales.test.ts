import fs from 'fs';
import path from 'path';
import { LOCALES } from '@nomad/i18n';

const MESSAGES = path.resolve(__dirname, '../../../../packages/i18n/messages');
const LOCALES_DIR = path.resolve(__dirname, '../../locales');

describe('native locale files (iOS InfoPlist strings)', () => {
  it.each([...LOCALES])('%s: locales/<code>.json holds permissions.microphone from messages/<code>.json', (code) => {
    const messages = JSON.parse(fs.readFileSync(path.join(MESSAGES, `${code}.json`), 'utf8'));
    const native = JSON.parse(fs.readFileSync(path.join(LOCALES_DIR, `${code}.json`), 'utf8'));
    expect(typeof messages.permissions.microphone).toBe('string');
    expect(native).toEqual({ ios: { NSMicrophoneUsageDescription: messages.permissions.microphone } });
  });

  it('has no stray files besides one per locale', () => {
    expect(fs.readdirSync(LOCALES_DIR).sort()).toEqual(LOCALES.map((l) => `${l}.json`).sort());
  });
});
