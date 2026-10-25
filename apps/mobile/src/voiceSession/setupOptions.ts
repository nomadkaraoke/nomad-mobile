import type { SessionSetup } from '@nomad/api-decide';

/** The setup's posture and warmth choices, shared by the setup screen and the context chip. */
export type Posture = SessionSetup['posture'];
export type Warmth = SessionSetup['warmth'];
export const POSTURES: readonly Posture[] = ['standing', 'sitting', 'lying'];
export const WARMTHS: readonly Warmth[] = ['cold', 'bit_warm', 'warm'];
