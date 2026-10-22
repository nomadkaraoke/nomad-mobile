// Only the contract's types and the app-facing facades are public; the generated SDK function names
// (getNight, searchSongs, ...) deliberately stay internal so they cannot collide with the facades.
export type * from './client/types.gen';
export { configureClient, configureClient as configureKjbox, type ClientDeps } from './configure';
export { KjboxError, type KjboxErrorCode } from './errors';
export * from './facades';
