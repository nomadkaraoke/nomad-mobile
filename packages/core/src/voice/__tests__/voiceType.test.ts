import { classifyVoice, VOICE_TYPES } from '../voiceType';

describe('classifyVoice', () => {
  it('lists the six types in order', () => {
    expect(VOICE_TYPES.map((v) => v.type)).toEqual(['bass', 'baritone', 'tenor', 'alto', 'mezzo', 'soprano']);
  });
  it('soprano: 60..84, comfort 67..79', () => {
    const c = classifyVoice({ low: 60, high: 84, comfortLow: 67, comfortHigh: 79, heldCount: 6, freeVoicedS: 6 });
    expect(c.type).toBe('soprano');
    expect(c.confidence).toBe('high');
    expect(c.scores.soprano).toBeCloseTo(0.8917, 3);
  });
  it('between baritone and tenor when scores tie', () => {
    expect(classifyVoice({ low: 47, high: 70, comfortLow: 53, comfortHigh: 64, heldCount: 4, freeVoicedS: 6 })).toMatchObject({
      type: 'baritone',
      between: 'tenor',
    });
  });
  it('confidence low for narrow untrained range', () => {
    expect(classifyVoice({ low: 50, high: 56, comfortLow: 51, comfortHigh: 55, heldCount: 2, freeVoicedS: 0 }).confidence).toBe('low');
  });
  it('confidence medium in between', () => {
    expect(classifyVoice({ low: 45, high: 64, comfortLow: 52, comfortHigh: 60, heldCount: 4, freeVoicedS: 6 }).confidence).toBe('medium');
  });
});
