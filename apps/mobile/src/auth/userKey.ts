import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex, utf8ToBytes } from '@noble/hashes/utils.js';

/** Hex sha256 of the lowercased, trimmed email: names per-user storage keys and owns queued work (Tonight, imports). */
export const userKeyFor = (email: string): string =>
  bytesToHex(sha256(utf8ToBytes(email.trim().toLowerCase())));
