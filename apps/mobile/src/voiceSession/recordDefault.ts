// "Record me by default" (Me -> voice recordings): the singer's standing answer to the setup screen's "Record me
// singing?". Unset until they choose; the setup question is then pre-filled from it (they can still change it).
import { appStorage } from '../storage';

export const RECORD_DEFAULT_KEY = 'voiceSession.recordDefault';

/** The stored default, or null when the singer never set one. */
export const readRecordDefault = (): boolean | null => appStorage.getBoolean(RECORD_DEFAULT_KEY) ?? null;

export const writeRecordDefault = (on: boolean): void => appStorage.set(RECORD_DEFAULT_KEY, on);
