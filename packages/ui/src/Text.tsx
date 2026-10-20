import { Text as RNText, type TextProps as RNTextProps } from 'react-native';

const VARIANTS = {
  title: 'text-2xl font-bold text-text',
  body: 'text-base text-text',
  muted: 'text-sm text-muted',
  error: 'text-sm text-danger',
} as const;

export type TextProps = RNTextProps & { variant?: keyof typeof VARIANTS; className?: string };
export type StartTextProps = RNTextProps & { className?: string };

const START = { textAlign: 'left' } as const;
const EXPLICIT_ALIGN = /(^|\s)text-(left|right|center|justify)(\s|$)/;

/**
 * React Native's Text aligned to the start of the line, with only the caller's classes. The default ("auto",
 * iOS natural alignment) left paragraphs left-aligned under forced RTL (ar, he); an explicit 'left' is
 * mirrored to the right by React Native when I18nManager.isRTL (checked on the simulator). An explicit
 * text-left/right/center/justify class keeps its own alignment.
 */
export function StartText({ className, style, ...rest }: StartTextProps) {
  const start = className && EXPLICIT_ALIGN.test(className) ? null : START;
  return <RNText className={className} style={start ? [start, style] : style} {...rest} />;
}

/** Start-aligned text (see StartText) in one of the app's type variants. */
export function Text({ variant = 'body', className, ...rest }: TextProps) {
  return <StartText className={`${VARIANTS[variant]} ${className ?? ''}`} {...rest} />;
}
