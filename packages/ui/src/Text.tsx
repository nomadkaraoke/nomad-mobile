import { Text as RNText, type TextProps as RNTextProps } from 'react-native';

const VARIANTS = {
  title: 'text-2xl font-bold text-text',
  body: 'text-base text-text',
  muted: 'text-sm text-muted',
  error: 'text-sm text-danger',
} as const;

export type TextProps = RNTextProps & { variant?: keyof typeof VARIANTS; className?: string };

export function Text({ variant = 'body', className, ...rest }: TextProps) {
  return <RNText className={`${VARIANTS[variant]} ${className ?? ''}`} {...rest} />;
}
