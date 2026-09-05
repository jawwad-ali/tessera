// 4.C3 — updates and bytes per gesture: one transaction per frame vs one on pointerup.
//
// The claim commit-on-pointerup makes is not about structs (crit1.mjs measured those) but about
// the WIRE: how many update messages a 60-frame drag sends, and how many bytes. A relay fans
// every update out to every peer, so this number times peers times gestures is the network.
//
// Run: node bench/gesture.mjs   (from the repo root; bench/ is a workspace member with yjs)

import * as Y from 'yjs';

const FRAMES = 60;

const shapeAt = (x) => ({ x, y: 10, w: 40, h: 30, rot: 0 });

/** A doc with one shape, and a counter on its update stream. */
const board = (shapes) => {
  const doc = new Y.Doc({ gc: true });
  const map = doc.getMap('shapes');
  doc.transact(() => {
    for (let n = 0; n < shapes; n++) {
      const shape = new Y.Map();
      shape.set('t', shapeAt(0));
      map.set(`s${n}`, shape);
    }
  });
  let updates = 0;
  let bytes = 0;
  doc.on('update', (update) => {
    updates += 1;
    bytes += update.byteLength;
  });
  return { doc, map, tally: () => ({ updates, bytes }) };
};

/** Naive: every pointer frame is its own transaction, so every frame is an update on the wire. */
const naive = (shapes) => {
  const { doc, map, tally } = board(shapes);
  for (let frame = 1; frame <= FRAMES; frame++) {
    doc.transact(() => {
      for (let n = 0; n < shapes; n++) map.get(`s${n}`).set('t', shapeAt(frame * 2));
    });
  }
  return { ...tally(), docBytes: Y.encodeStateAsUpdateV2(doc).byteLength };
};

/** Commit-on-pointerup: the frames are tier-1 state; one transaction carries the final geometry. */
const pointerup = (shapes) => {
  const { doc, map, tally } = board(shapes);
  doc.transact(() => {
    for (let n = 0; n < shapes; n++) map.get(`s${n}`).set('t', shapeAt(FRAMES * 2));
  });
  return { ...tally(), docBytes: Y.encodeStateAsUpdateV2(doc).byteLength };
};

for (const shapes of [1, 3]) {
  const a = naive(shapes);
  const b = pointerup(shapes);
  console.log(`--- ${shapes} shape(s), ${FRAMES}-frame drag ---`);
  console.log(`naive ${shapes} shape: ${a.updates} updates, ${a.bytes} bytes on the wire, doc ${a.docBytes} bytes`);
  console.log(`pointerup ${shapes} shape: ${b.updates} updates, ${b.bytes} bytes on the wire, doc ${b.docBytes} bytes`);
  console.log(`ratio ${shapes} shape bytes naive/pointerup: ${(a.bytes / b.bytes).toFixed(1)}x`);
  console.log(`ratio ${shapes} shape updates naive/pointerup: ${(a.updates / b.updates).toFixed(1)}x`);
}
