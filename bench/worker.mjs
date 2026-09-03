/**
 * Phase 0 spike: what does it cost to move a decoded scene across a worker boundary?
 *
 * ARCHITECTURE.md sect.7 wants the render loop in an OffscreenCanvas worker, and the cold-open
 * path wants the document decoded off the main thread. Both depend on a cost nobody had
 * measured: getting a 50,000-shape scene from one thread to the other. If that cost is
 * comparable to the 1,900ms decode it is meant to hide, the whole approach is pointless.
 *
 * Deliberately a throwaway. It measures three transports and prints numbers; it ships nothing.
 */
import { Worker, isMainThread, parentPort, workerData } from 'node:worker_threads';
import { performance } from 'node:perf_hooks';

const SHAPES = 50_000;

const buildObjectScene = (n) => {
  const shapes = new Array(n);
  for (let i = 0; i < n; i++) {
    shapes[i] = {
      id: `s${i}`,
      v: 1,
      kind: 'rect',
      t: { x: i % 4000, y: (i * 7) % 3000, w: 80, h: 60, rot: 0 },
      idx: `a${i.toString(36)}`,
      style: { fill: '#3b82f6', stroke: '#1e293b', strokeWidth: 1, opacity: 1 },
      author: 'u1',
    };
  }
  return shapes;
};

/** The same geometry as flat typed arrays — the transferable representation. */
const buildPackedScene = (n) => ({
  transform: new Float32Array(n * 5),
  kind: new Uint8Array(n),
});

if (!isMainThread) {
  // The worker only acknowledges. We are measuring transport, not work.
  parentPort.postMessage({ ack: workerData?.tag ?? 'ready' });
  parentPort.on('message', (msg) => {
    parentPort.postMessage({ ack: msg.tag });
  });
} else {
  const objectScene = buildObjectScene(SHAPES);
  const packed = buildPackedScene(SHAPES);

  const t0 = performance.now();
  structuredClone(objectScene);
  const cloneMs = performance.now() - t0;

  const worker = new Worker(new URL(import.meta.url), { workerData: { tag: 'boot' } });

  const roundTrip = (payload, tag, transferList) =>
    new Promise((resolve) => {
      const start = performance.now();
      const onMessage = (msg) => {
        if (msg.ack !== tag) return;
        worker.off('message', onMessage);
        resolve(performance.now() - start);
      };
      worker.on('message', onMessage);
      worker.postMessage({ tag, payload }, transferList);
    });

  await new Promise((resolve) => {
    const onBoot = (msg) => {
      if (msg.ack === 'boot') {
        worker.off('message', onBoot);
        resolve();
      }
    };
    worker.on('message', onBoot);
  });

  const objectMs = await roundTrip(objectScene, 'objects');
  const packedMs = await roundTrip(packed, 'packed', [packed.transform.buffer, packed.kind.buffer]);

  console.log(`worker boundary spike — ${SHAPES} shapes\n`);
  console.log(`  structuredClone in-process (objects)   ${cloneMs.toFixed(1)}ms`);
  console.log(`  postMessage round trip (objects)       ${objectMs.toFixed(1)}ms`);
  console.log(`  postMessage round trip (transferable)  ${packedMs.toFixed(1)}ms`);
  console.log(`\n  node ${process.version}`);

  await worker.terminate();
}
