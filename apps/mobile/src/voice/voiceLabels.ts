import { midiToName, type Register, type VoiceType } from '@nomad/core';
import { isolate, useTranslations } from '@nomad/i18n';

import type { LocalVoiceProfile } from './voiceStore';

const TYPE_KEY: Record<VoiceType, string> = {
  bass: 'typeBass',
  baritone: 'typeBaritone',
  tenor: 'typeTenor',
  alto: 'typeAlto',
  mezzo: 'typeMezzo',
  soprano: 'typeSoprano',
};
const REGISTER_KEY: Record<Register, string> = { lower: 'registerLower', middle: 'registerMiddle', higher: 'registerHigher' };
const LIKELY_REGISTER_KEY: Record<Register, string> = { lower: 'likelyLower', middle: 'likelyMiddle', higher: 'likelyHigher' };
const ORDER: readonly VoiceType[] = ['bass', 'baritone', 'tenor', 'alto', 'mezzo', 'soprano'];
const isVoiceType = (v: string | null | undefined): v is VoiceType => v != null && (ORDER as readonly string[]).includes(v);

/** "A2–E4": note names aren't translated; isolated so the range reads low to high inside RTL text. */
export const noteRange = (low: number, high: number) => isolate(`${midiToName(low)}–${midiToName(high)}`);

/** Voice-type wording, always hedged: "Likely Baritone", "Between Baritone and Tenor", "Likely a lower voice". */
export function useVoiceLabels() {
  const t = useTranslations('voice');
  const typeName = (v: VoiceType) => t(TYPE_KEY[v]);
  const likely = (p: Pick<LocalVoiceProfile, 'voiceType' | 'voiceTypeBetween' | 'register'>): string => {
    if (p.voiceType && p.voiceTypeBetween && p.voiceTypeBetween !== p.voiceType) {
      const [low, high] = [p.voiceType, p.voiceTypeBetween].sort((a, b) => ORDER.indexOf(a) - ORDER.indexOf(b));
      return t('between', { low: typeName(low!), high: typeName(high!) });
    }
    if (p.voiceType) return t('likely', { type: typeName(p.voiceType) });
    return t(LIKELY_REGISTER_KEY[p.register ?? 'middle']);
  };
  return {
    typeName,
    registerName: (r: Register) => t(REGISTER_KEY[r]),
    likely,
    /** A session result's type ("Likely Baritone", "Between Baritone and Tenor"); a type this app doesn't know reads generically. */
    session(r: { voice_type: string; between: string | null }): string {
      if (!isVoiceType(r.voice_type)) return t('typeUnknown');
      return likely({ voiceType: r.voice_type, voiceTypeBetween: isVoiceType(r.between) ? r.between : null, register: null });
    },
  };
}
