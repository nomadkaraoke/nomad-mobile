import { lineDirection } from '../direction';

describe('lineDirection', () => {
  it('uses the first strong character', () => {
    expect(lineDirection('שלום world')).toBe('rtl');
    expect(lineDirection('Hi שלום')).toBe('ltr');
    expect(lineDirection('مرحبا hello')).toBe('rtl');
    expect(lineDirection('ﻣﺮﺣﺒﺎ')).toBe('rtl'); // presentation forms
  });
  it('skips digits and punctuation', () => {
    expect(lineDirection('123 שלום')).toBe('rtl');
    expect(lineDirection('(1) "Hello"')).toBe('ltr');
    expect(lineDirection('— 42 —')).toBe('ltr');
    expect(lineDirection('')).toBe('ltr');
    expect(lineDirection('\uFEFFHello world')).toBe('ltr'); // BOM is neutral
    expect(lineDirection('\uFEFF\u05E9\u05DC\u05D5\u05DD')).toBe('rtl');
  });
});
