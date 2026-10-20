// Hebrew 0590-05FF; Arabic 0600-06FF, 0750-077F, 08A0-08FF, presentation forms FB1D-FDFF, FE70-FEFC.
// FEFF (the BOM) is deliberately excluded: it is neutral, not Arabic.
const RTL = /[\u0590-\u05FF\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF\uFB1D-\uFDFF\uFE70-\uFEFC]/;
const LETTER = /\p{L}/u;

/** Text direction of a line from its first strong character (digits and punctuation are neutral). */
export function lineDirection(text: string): 'ltr' | 'rtl' {
  for (const ch of text) {
    if (RTL.test(ch)) return 'rtl';
    if (LETTER.test(ch)) return 'ltr';
  }
  return 'ltr';
}
