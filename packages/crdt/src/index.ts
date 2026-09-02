/**
 * The Yjs binding. Per ARCHITECTURE.md §3 this is the only package that touches a Y type,
 * and per invariant 3 the only place a Y write happens is `tx.ts`.
 */
export { assertSingleYjsInstance } from './yjs-instance.ts';
