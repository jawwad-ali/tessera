/**
 * Wire message types, frame reading, permission facets, close codes.
 *
 * Imported by both the browser provider and the relay gate, so it stays free of node and
 * of yjs: the gate must read the two varUints that decide a viewer's write WITHOUT
 * instantiating a document (ARCHITECTURE.md §9).
 */
export { AuthMessage, OuterMessage, ProviderDefaults, SyncMessage } from './messages.ts';
export {
  CloseCode,
  MAX_CLOSE_REASON_BYTES,
  clampReason,
  defaultReason,
  isPermanent,
} from './close-codes.ts';
export { NO_ACCESS, Role, facetsFor } from './facets.ts';
export type { Facet, Facets } from './facets.ts';
export { adjudicate, describe, peek } from './frame.ts';
export type { Frame, Verdict } from './frame.ts';
