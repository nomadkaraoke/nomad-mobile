import { VOICE_TYPES, type VoiceType } from './voiceType';

export type Register = 'lower' | 'middle' | 'higher';

const REGISTERS: Record<Register, { low: number; high: number; comfortLow: number; comfortHigh: number }> = {
  lower: { low: 40, high: 69, comfortLow: 47, comfortHigh: 62 },
  middle: { low: 48, high: 77, comfortLow: 55, comfortHigh: 70 },
  higher: { low: 57, high: 84, comfortLow: 64, comfortHigh: 79 },
};

export function selfReportProfile(choice: VoiceType | Register): {
  low: number;
  high: number;
  comfortLow: number;
  comfortHigh: number;
  voiceType: VoiceType | null;
  register: Register | null;
} {
  if (choice === 'lower' || choice === 'middle' || choice === 'higher') {
    return { ...REGISTERS[choice], voiceType: null, register: choice };
  }
  const v = VOICE_TYPES.find((t) => t.type === choice)!;
  return { low: v.lo, high: v.hi, comfortLow: v.lo + 5, comfortHigh: v.hi - 5, voiceType: v.type, register: null };
}
