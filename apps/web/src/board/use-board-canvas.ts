'use client';

import { useEffect, type RefObject } from 'react';

import type { Camera, SceneStore, Viewport } from '@tessera/core';
import { fitToContent, visibleShapes } from '@tessera/core';
import { installBench, timed } from './bench.ts';
import { applyDrag, applyWheel } from './camera-input.ts';
import { boardBounds } from './fixture.ts';
import { createFrameLoop } from './render/loop.ts';
import { paintStatic } from './render/static-layer.ts';

/**
 * Wire a canvas to a store: size it, paint it when something changes, move the camera.
 *
 * Everything here is an effect over refs and nothing is React state, deliberately. The camera
 * changes on every pointermove of a drag, and a `setState` per move re-renders the component
 * tree 300 times per second for a change that only the canvas cares about. The canvas is
 * repainted by the frame loop; React is told nothing.
 */

/**
 * Cap on device pixel ratio.
 *
 * Past about 2 nobody can see the difference and the backing store grows with the square of
 * it — a 2560x1440 viewport at dpr 3 is 133MB per canvas. The measurement in `3.C4` states its
 * dpr for exactly this reason.
 */
const MAX_DPR = 2;

export interface BoardCanvasOptions {
  readonly store: SceneStore;
  /** Record paint durations to `window.__tessera` for the frame-time measurement. */
  readonly bench: boolean;
}

/**
 * The backing-store size in device pixels, from a resize observation.
 *
 * `devicePixelContentBoxSize` is the exact size in device pixels and sidesteps the rounding
 * that `contentRect * dpr` produces at fractional zoom levels — a half-pixel mismatch there is
 * a blurred board. Not every browser reports it, so the rounded product is the fallback.
 */
/**
 * Widened on purpose, behind a function so assignment narrowing cannot undo it: the DOM lib
 * types `devicePixelContentBoxSize` as always present, and Safari does not ship it. Trusting
 * the type is a `TypeError` on every iPhone.
 */
const exactSizes = (entry: ResizeObserverEntry): readonly ResizeObserverSize[] | undefined =>
  entry.devicePixelContentBoxSize;

const deviceSizeOf = (entry: ResizeObserverEntry, dpr: number): { w: number; h: number } => {
  const exact = exactSizes(entry)?.[0];
  if (exact !== undefined) return { w: exact.inlineSize, h: exact.blockSize };
  return {
    w: Math.round(entry.contentRect.width * dpr),
    h: Math.round(entry.contentRect.height * dpr),
  };
};

export const useBoardCanvas = (
  canvasRef: RefObject<HTMLCanvasElement | null>,
  { store, bench }: BoardCanvasOptions,
): void => {
  useEffect(() => {
    const canvas = canvasRef.current;
    if (canvas === null) return;
    const ctx = canvas.getContext('2d');
    if (ctx === null) return;

    const dpr = Math.min(window.devicePixelRatio, MAX_DPR);
    let viewport: Viewport = { css: { x: canvas.clientWidth, y: canvas.clientHeight }, dpr };
    // Fitted on the first real resize observation, when the CSS size is known. Until then the
    // camera is a placeholder that paints nothing wrong, only nothing.
    let camera: Camera = { x: 0, y: 0, zoom: 1 };
    let fitted = false;

    const plan = () => visibleShapes(store, camera, viewport);
    const paint = (): void => {
      paintStatic(ctx, plan(), camera, viewport);
    };
    const loop = createFrameLoop(
      bench
        ? timed(
            installBench(() => plan().map((item) => ({ id: item.shape.id, device: item.device }))),
            paint,
          )
        : paint,
      (callback) => window.requestAnimationFrame(callback),
      (handle) => {
        window.cancelAnimationFrame(handle);
      },
    );

    const resize = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (entry === undefined) return;
      const device = deviceSizeOf(entry, dpr);
      canvas.width = device.w;
      canvas.height = device.h;
      viewport = { css: { x: entry.contentRect.width, y: entry.contentRect.height }, dpr };
      if (!fitted && viewport.css.x > 0 && viewport.css.y > 0) {
        camera = fitToContent(boardBounds(store), viewport.css);
        fitted = true;
      }
      loop.invalidate();
    });
    resize.observe(canvas, { box: 'device-pixel-content-box' });

    // ---- camera input ------------------------------------------------------------------
    let dragging: { x: number; y: number } | undefined;

    const onPointerDown = (event: PointerEvent): void => {
      canvas.setPointerCapture(event.pointerId);
      dragging = { x: event.clientX, y: event.clientY };
    };
    const onPointerMove = (event: PointerEvent): void => {
      if (dragging === undefined) return;
      camera = applyDrag(camera, { x: event.clientX - dragging.x, y: event.clientY - dragging.y });
      dragging = { x: event.clientX, y: event.clientY };
      loop.invalidate();
    };
    const onPointerUp = (event: PointerEvent): void => {
      if (canvas.hasPointerCapture(event.pointerId)) canvas.releasePointerCapture(event.pointerId);
      dragging = undefined;
    };
    const onWheel = (event: WheelEvent): void => {
      // The page must not scroll and the browser must not zoom: this canvas owns the gesture.
      // Requires the listener to be non-passive, which is why it is not a React prop.
      event.preventDefault();
      const box = canvas.getBoundingClientRect();
      camera = applyWheel(camera, {
        deltaX: event.deltaX,
        deltaY: event.deltaY,
        ctrlKey: event.ctrlKey,
        at: { x: event.clientX - box.left, y: event.clientY - box.top },
      });
      loop.invalidate();
    };

    canvas.addEventListener('pointerdown', onPointerDown);
    canvas.addEventListener('pointermove', onPointerMove);
    canvas.addEventListener('pointerup', onPointerUp);
    canvas.addEventListener('pointercancel', onPointerUp);
    canvas.addEventListener('wheel', onWheel, { passive: false });

    return () => {
      // Order matters: stop the loop before the observer, so a final resize notification
      // delivered during teardown cannot schedule a paint into a canvas React is removing.
      loop.stop();
      resize.disconnect();
      canvas.removeEventListener('pointerdown', onPointerDown);
      canvas.removeEventListener('pointermove', onPointerMove);
      canvas.removeEventListener('pointerup', onPointerUp);
      canvas.removeEventListener('pointercancel', onPointerUp);
      canvas.removeEventListener('wheel', onWheel);
    };
  }, [canvasRef, store, bench]);
};
