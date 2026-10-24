import { LogBox } from 'react-native';

/** React's dev warning for a state update on a component that hasn't mounted yet (Ruling T). */
export const NOT_MOUNTED_WARNING = "hasn't mounted yet";
/** The prefix of the caller-stack line this module logs after that warning. */
const TRACE_PREFIX = '[Ruling T]';

let installed = false;

/**
 * Ruling T: Android dev builds sometimes warn "Can't perform a React state update on a component that
 * hasn't mounted yet", and React's message doesn't say which component. In dev, console.error is wrapped
 * once so the next occurrence also logs a stack that names the caller. In the E2E builds (dev + fake social
 * sign-in) the warning is also kept out of LogBox: its toast covers the bottom of the screen and breaks
 * Maestro taps. Release builds are untouched.
 */
export function installDevWarningTrace({ dev, e2e }: { dev: boolean; e2e: boolean }): void {
  if (!dev || installed) return;
  installed = true;
  const original = console.error;
  console.error = (...args: unknown[]) => {
    original(...args);
    const message = args.map((a) => (typeof a === 'string' ? a : '')).join(' ');
    if (message.includes(NOT_MOUNTED_WARNING)) {
      original(`${TRACE_PREFIX} state update before mount; caller stack:\n${new Error().stack ?? '(no stack)'}`);
    }
  };
  // The trace line as well: it doesn't contain the warning's text, so its own toast showed (Android discover-4).
  if (e2e) LogBox.ignoreLogs([NOT_MOUNTED_WARNING, TRACE_PREFIX]);
}

/** Tests only: allow installing again. */
export function __resetDevWarningTrace(): void {
  installed = false;
}
