export const formatCredits = (n: number, locale: string): string => new Intl.NumberFormat(locale).format(n);

export const formatPrice = (cents: number, currency: string, locale: string): string =>
  new Intl.NumberFormat(locale, { style: 'currency', currency }).format(cents / 100);
