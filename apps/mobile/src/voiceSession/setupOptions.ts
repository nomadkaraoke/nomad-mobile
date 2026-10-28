import type { SessionSetup } from '@nomad/api-decide';

/** The setup's posture and warmth choices, shared by the setup screen and the context chip. */
export type Posture = SessionSetup['posture'];
export type Warmth = SessionSetup['warmth'];
export const POSTURES: readonly Posture[] = ['standing', 'sitting', 'lying'];
export const WARMTHS: readonly Warmth[] = ['cold', 'bit_warm', 'warm'];

/** The optional singing-background answers (decide v0.33 `SessionSetup.experience` / `uses_falsetto`). */
export type Experience = NonNullable<SessionSetup['experience']>;
export type UsesFalsetto = NonNullable<SessionSetup['uses_falsetto']>;
export const EXPERIENCES: readonly Experience[] = ['none', 'some', 'trained'];
export const USES_FALSETTO: readonly UsesFalsetto[] = ['yes', 'sometimes', 'no', 'unsure'];
