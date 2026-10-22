import { selfReportProfile } from '../selfReport';

describe('selfReportProfile', () => {
  it('type presets', () => {
    expect(selfReportProfile('tenor')).toEqual({ low: 48, high: 72, comfortLow: 53, comfortHigh: 67, voiceType: 'tenor', register: null });
  });
  it('register presets', () => {
    expect(selfReportProfile('lower')).toEqual({ low: 40, high: 69, comfortLow: 47, comfortHigh: 62, voiceType: null, register: 'lower' });
    expect(selfReportProfile('middle')).toMatchObject({ low: 48, high: 77, comfortLow: 55, comfortHigh: 70 });
    expect(selfReportProfile('higher')).toMatchObject({ low: 57, high: 84, comfortLow: 64, comfortHigh: 79 });
  });
});
