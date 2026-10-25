/**
 * The voice session's Stack.Screen props. `dangerouslySingular` (a Screen prop, not an option) makes a second push to
 * the same route (a reminder tap while the session is already open) reuse the open one instead of stacking a
 * duplicate modal.
 */
export function voiceSessionScreenProps(title: string) {
  return { options: { presentation: 'modal' as const, title }, dangerouslySingular: true };
}
