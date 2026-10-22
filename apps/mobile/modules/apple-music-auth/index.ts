// Native Apple Music sign-in (iOS only; see ios/AppleMusicAuthModule.swift). Android has no native MusicKit
// that fits, so it keeps decide web's MusicKit JS page in the browser.
import { requireOptionalNativeModule } from 'expo';

export type AppleMusicAuthResult =
  | { status: 'authorized'; token: string }
  | { status: 'denied' | 'restricted' | 'notDetermined' }
  | { status: 'error'; code: string };

type Native = { requestUserToken(developerToken: string): Promise<Record<string, string>> };

const native = requireOptionalNativeModule<Native>('AppleMusicAuth');

/** True on an iOS build that includes the module. */
export const nativeAppleMusicAvailable = (): boolean => native != null;

/** Shows Apple's Apple Music permission prompt (first time only) and returns a Music User Token. */
export async function requestAppleMusicUserToken(developerToken: string): Promise<AppleMusicAuthResult> {
  if (!native) return { status: 'error', code: 'unavailable' };
  const r = await native.requestUserToken(developerToken);
  if (r.status === 'authorized' && r.token) return { status: 'authorized', token: r.token };
  if (r.status === 'denied' || r.status === 'restricted' || r.status === 'notDetermined') return { status: r.status };
  return { status: 'error', code: r.code ?? 'unknown' };
}
