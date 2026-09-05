'use client';

import { useEffect, type RefObject } from 'react';

import type { Camera, SceneStore, Vec2, Viewport } from '@tessera/core';
import { fitToContent, screenToWorld, visibleShapes } from '@tessera/core';
import { installBench, timed } from './bench.ts';
import { applyDrag, applyWheel } from './camera-input.ts';
import type { BoardController } from './controller.ts';
import { boardBounds } from './fixture.ts';
import { attachKeyboard, attachPointer } from './input/pointer.ts';
import { createFrameLoop } from './render/loop.ts';
import { paintOverlay } from './render/overlay-layer.ts';
import { paintStatic } from './render/static-layer.ts';

/**
 * Wire two canvases to a store and a controller: size them, paint each when its own inputs
 * change, and route pointer and keyboard input.
 *
 * Two canvases, two loops, two invalidation sources. The static layer repaints when the store
 * commits or the camera moves; the overlay repaints when the gesture state or the camera
 * changes. A drag therefore repaints the overlay every frame and the static layer twice — at
 * drag start and drag end, when the set of shapes it must skip changes. That is the reason the
 * overlay exists: 5,000 committed shapes are not repainted for one shape's ghost.
 *
 * Everything here is an effect over refs and nothing is React state. The camera changes on every
 * pointermove of a pan and the gesture state on every pointermove of a drag; React is told only
 * what the toolbar shows, through the controller's snapshot.
 */

/** Cap on device pixel ratio; past ~2 the backing store grows for no visible gain. */
const MAX_DPR = 2;

export interface BoardCanvasOptions {
  readonly staticRef: RefObject<HTMLCanvasElement | null>;
  readonly overlayRef: RefObject<HTMLCanvasElement | null>;
  /** Owned by the host so the controller's hit slop can read the zoom. */
  readonly cameraRef: { current: Camera };
  readonly store: SceneStore;
  readonly controller: BoardController;
  readonly bench: boolean;
}

const exactSizes = (entry: ResizeObserverEntry): readonly ResizeObserverSize[] | undefined =>
  entry.devicePixelContentBoxSize;

const deviceSizeOf = (entry: ResizeObserverEntry, dpr: number): { w: number; h: number } => {
  const exact = exactSizes(entry)?.[0];
  if (exact !== undefined) return { w: exact.inlineSize, h: exact.blockSize };
  return { w: Math.round(entry.contentRect.width * dpr), h: Math.round(entry.contentRect.height * dpr) };
};

const raf = (callback: () => void): number => window.requestAnimationFrame(callback);
const cancelRaf = (handle: number): void => {
  window.cancelAnimationFrame(handle);
};

export const useBoardCanvas = ({ staticRef, overlayRef, cameraRef, store, controller, bench }: BoardCanvasOptions): void => {
  useEffect(() => {
    const staticCanvas = staticRef.current;
    const overlayCanvas = overlayRef.current;
    if (staticCanvas === null || overlayCanvas === null) return;
    const staticCtx = staticCanvas.getContext('2d');
    const overlayCtx = overlayCanvas.getContext('2d');
    if (staticCtx === null || overlayCtx === null) return;

    const dpr = Math.min(window.devicePixelRatio, MAX_DPR);
    let viewport: Viewport = { css: { x: overlayCanvas.clientWidth, y: overlayCanvas.clientHeight }, dpr };
    let fitted = false;

    const plan = () => visibleShapes(store, cameraRef.current, viewport);

    const paintStaticLayer = (): void => {
      // Shapes in flight are drawn by the overlay at their offset; here they are skipped, or the
      // user sees the shape twice — once where it was and once where their hand is.
      const dragging = controller.dragging();
      const items = dragging.size === 0 ? plan() : plan().filter((item) => !dragging.has(item.shape.id));
      paintStatic(staticCtx, items, cameraRef.current, viewport);
    };
    const paintOverlayLayer = (): void => {
      paintOverlay(overlayCtx, controller.overlay(), cameraRef.current, viewport);
    };

    const staticLoop = createFrameLoop(
      bench
        ? timed(installBench(() => plan().map((item) => ({ id: item.shape.id, device: item.device }))), paintStaticLayer)
        : paintStaticLayer,
      raf,
      cancelRaf,
    );
    const overlayLoop = createFrameLoop(paintOverlayLayer, raf, cancelRaf);
    const invalidateAll = (): void => {
      staticLoop.invalidate();
      overlayLoop.invalidate();
    };

    // ---- sizing ------------------------------------------------------------------------
    const resize = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (entry === undefined) return;
      const device = deviceSizeOf(entry, dpr);
      for (const canvas of [staticCanvas, overlayCanvas]) {
        canvas.width = device.w;
        canvas.height = device.h;
      }
      viewport = { css: { x: entry.contentRect.width, y: entry.contentRect.height }, dpr };
      if (!fitted && viewport.css.x > 0 && viewport.css.y > 0) {
        cameraRef.current = fitToContent(boardBounds(store), viewport.css);
        fitted = true;
      }
      invalidateAll();
    });
    resize.observe(overlayCanvas, { box: 'device-pixel-content-box' });

    // ---- invalidation from the model ------------------------------------------------------
    const unsubscribeStore = store.subscribe(() => {
      staticLoop.invalidate();
    });
    let lastDragKey = '';
    const unsubscribeController = controller.subscribe(() => {
      overlayLoop.invalidate();
      // The static layer only cares when the set it must skip changes — drag start and end.
      const key = [...controller.dragging()].join(',');
      if (key !== lastDragKey) {
        lastDragKey = key;
        staticLoop.invalidate();
      }
    });

    // ---- input -----------------------------------------------------------------------------
    const toBoard = (client: Vec2): Vec2 => {
      const box = overlayCanvas.getBoundingClientRect();
      return screenToWorld(cameraRef.current, { x: client.x - box.left, y: client.y - box.top });
    };
    const detachPointer = attachPointer(overlayCanvas, {
      toBoard,
      dispatch: controller.dispatch,
      pan: (delta) => {
        cameraRef.current = applyDrag(cameraRef.current, delta);
        invalidateAll();
      },
    });
    const detachKeyboard = attachKeyboard({
      dispatch: controller.dispatch,
      setTool: controller.setTool,
      undo: controller.undo,
      redo: controller.redo,
    });
    const onWheel = (event: WheelEvent): void => {
      event.preventDefault();
      const box = overlayCanvas.getBoundingClientRect();
      cameraRef.current = applyWheel(cameraRef.current, {
        deltaX: event.deltaX,
        deltaY: event.deltaY,
        ctrlKey: event.ctrlKey,
        at: { x: event.clientX - box.left, y: event.clientY - box.top },
      });
      invalidateAll();
    };
    overlayCanvas.addEventListener('wheel', onWheel, { passive: false });

    return () => {
      staticLoop.stop();
      overlayLoop.stop();
      resize.disconnect();
      unsubscribeStore();
      unsubscribeController();
      detachPointer();
      detachKeyboard();
      overlayCanvas.removeEventListener('wheel', onWheel);
    };
  }, [staticRef, overlayRef, cameraRef, store, controller, bench]);
};
