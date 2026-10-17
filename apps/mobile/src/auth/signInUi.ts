import { useTranslations } from '@nomad/i18n';
import { router, type Href } from 'expo-router';

import { isSignInError } from './authApi';

/** Sign-in route params (all three sign-in screens). */
export type SignInParams = { returnTo?: string };

/** Only in-app paths ("/make/new"), never a URL or a protocol-relative "//host" from a crafted deep link. */
export const isInAppPath = (p: string) => p.startsWith('/') && !p.startsWith('//') && !p.startsWith('/\\');

/**
 * Leave the sign-in sheet for `returnTo` (the make flow passes `/make/new`). The sign-in screens replace one
 * another rather than stacking, so dismissing to `returnTo` (or replacing the sheet with it when it isn't
 * in the history) never leaves a sign-in screen behind.
 */
export function finishSignIn(returnTo: string | undefined) {
  if (returnTo && isInAppPath(returnTo)) router.dismissTo(returnTo as Href);
  else if (router.canGoBack()) router.back();
  else router.replace('/');
}

/** The message for a failed sign-in step; `provider` picks the Google/Apple fallback wording. */
export function useSignInErrorText() {
  const t = useTranslations('signIn');
  const tc = useTranslations('common');
  return (e: unknown, provider?: 'google' | 'apple'): string => {
    if (e instanceof Error && e.message === 'invalid_email') return t('emailInvalid');
    if (e instanceof Error && e.message === 'invalid_code_format') return t('codeInvalid');
    if (!isSignInError(e)) return tc('error');
    switch (e.kind) {
      case 'invalid':
        return t('codeWrong', { left: e.attemptsLeft ?? 0 });
      case 'locked':
        return t('codeLocked');
      case 'expired':
        return t('codeExpired');
      case 'tooManyCodes':
        return t('tooManyCodes');
      case 'disposable':
        return t('disposable');
      case 'notAllowed':
        return t('notAllowed');
      case 'signupLimited':
        return t('signupLimited');
      case 'network':
        return t('network');
      case 'failed':
        return provider === 'google' ? t('googleFailed') : provider === 'apple' ? t('appleFailed') : tc('error');
    }
  };
}
