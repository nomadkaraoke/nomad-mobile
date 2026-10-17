import { Text as RNText, type TextProps as RNTextProps } from 'react-native';

const VARIANTS = {
  title: 'text-2xl font-bold text-text',
  body: 'text-base text-text',
  muted: 'text-sm text-muted',
  error: 'text-sm text-danger',
} as const;

export type TextProps = RNTextProps & { variant?: keyof typeof VARIANTS; className?: string };

const START = { textAlign: 'left' } as const;
const EXPLICIT_ALIGN = /(^|\s)text-(left|right|center|justify)(\s|$)/;

/**
 * Text aligned to the start of the line. The default ("auto", iOS natural alignment) left paragraphs
 * left-aligned under forced RTL (ar, he); an explicit 'left' is mirrored to the right by React Native
 * when I18nManager.isRTL (checked on the simulator).
 */
export function Text({ variant = 'body', className, style, ...rest }: TextProps) {
  const start = className && EXPLICIT_ALIGN.test(className) ? null : START;
  return <RNText className={`${VARIANTS[variant]} ${className ?? ''}`} style={start ? [start, style] : style} {...rest} />;
}
