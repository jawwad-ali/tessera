import type { Vec2 } from '@tessera/core';
import type { GestureEvent, Tool } from './gesture.ts';

/**
 * The DOM adapter: `PointerEvent`s and keys in, board-space {@link GestureEvent}s out.
 *
 * This is the only file in the interaction layer that touches an element, and it decides
 * nothing. It converts, coalesces and forwards; the gesture machine decides. Keeping it this
 * thin is what leaves the decisions in code that runs in node.
 */

export interface PointerTargets {
  /** Client coordinates to board units, through the current camera. */
  readonly toBoard: (client: Vec2) => Vec2;
  readonly dispatch: (event: GestureEvent) => void;
  /** Pan the camera by a CSS-pixel delta — space-drag and middle-button drag. */
  readonly pan: (deltaCss: Vec2) => void;
}

export interface KeyTargets {
  readonly dispatch: (event: GestureEvent) => void;
  readonly setTool: (tool: Tool) => void;
  readonly undo: () => void;
  readonly redo: () => void;
}

const MIDDLE_BUTTON = 1;

const sampleOf = (event: PointerEvent, toBoard: (client: Vec2) => Vec2) => ({
  board: toBoard({ x: event.clientX, y: event.clientY }),
  t: event.timeStamp,
  shift: event.shiftKey,
});

/**
 * Attach pointer handling to the overlay canvas. Returns the detach function.
 *
 * Pointer Events from the start, never mouse or touch events: one code path for mouse, pen and
 * finger, with `pointerId` to tell them apart. `setPointerCapture` keeps a drag alive when the
 * pointer leaves the canvas, which it does on every fast drag toward an edge.
 *
 * `getCoalescedEvents` is used on move: at 120Hz+ input rates the browser batches several
 * samples into one event, and a drag that only reads the last one draws a stroke that cuts
 * corners. Every coalesced sample is forwarded, in order.
 */
export const attachPointer = (canvas: HTMLCanvasElement, targets: PointerTargets): (() => void) => {
  let spaceHeld = false;
  let panning: Vec2 | undefined;

  const onKeyDown = (event: KeyboardEvent): void => {
    if (event.code === 'Space' && !isTyping(event)) {
      spaceHeld = true;
      event.preventDefault();
    }
  };
  const onKeyUp = (event: KeyboardEvent): void => {
    if (event.code === 'Space') spaceHeld = false;
  };

  const onDown = (event: PointerEvent): void => {
    canvas.setPointerCapture(event.pointerId);
    if (spaceHeld || event.button === MIDDLE_BUTTON) {
      panning = { x: event.clientX, y: event.clientY };
      return;
    }
    if (event.button !== 0) return;
    targets.dispatch({ type: 'down', sample: sampleOf(event, targets.toBoard) });
  };

  const onMove = (event: PointerEvent): void => {
    if (panning !== undefined) {
      targets.pan({ x: event.clientX - panning.x, y: event.clientY - panning.y });
      panning = { x: event.clientX, y: event.clientY };
      return;
    }
    const samples = typeof event.getCoalescedEvents === 'function' ? event.getCoalescedEvents() : [];
    for (const sample of samples.length > 0 ? samples : [event]) {
      targets.dispatch({ type: 'move', sample: sampleOf(sample, targets.toBoard) });
    }
  };

  const onUp = (event: PointerEvent): void => {
    if (canvas.hasPointerCapture(event.pointerId)) canvas.releasePointerCapture(event.pointerId);
    if (panning !== undefined) {
      panning = undefined;
      return;
    }
    if (event.button !== 0) return;
    targets.dispatch({ type: 'up', sample: sampleOf(event, targets.toBoard) });
  };

  const onCancel = (event: PointerEvent): void => {
    if (canvas.hasPointerCapture(event.pointerId)) canvas.releasePointerCapture(event.pointerId);
    panning = undefined;
    targets.dispatch({ type: 'cancel' });
  };

  canvas.addEventListener('pointerdown', onDown);
  canvas.addEventListener('pointermove', onMove);
  canvas.addEventListener('pointerup', onUp);
  canvas.addEventListener('pointercancel', onCancel);
  window.addEventListener('keydown', onKeyDown);
  window.addEventListener('keyup', onKeyUp);

  return () => {
    canvas.removeEventListener('pointerdown', onDown);
    canvas.removeEventListener('pointermove', onMove);
    canvas.removeEventListener('pointerup', onUp);
    canvas.removeEventListener('pointercancel', onCancel);
    window.removeEventListener('keydown', onKeyDown);
    window.removeEventListener('keyup', onKeyUp);
  };
};

/** Keys pressed while typing in a field belong to the field. */
const isTyping = (event: KeyboardEvent): boolean => {
  const target = event.target;
  return target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement;
};

/**
 * Keyboard shortcuts. Returns the detach function.
 *
 * V select, R rectangle, Escape cancel, Delete/Backspace delete, Ctrl/Cmd+Z undo,
 * Ctrl/Cmd+Shift+Z or Ctrl/Cmd+Y redo. Nothing fires while focus is in a text field.
 */
export const attachKeyboard = (targets: KeyTargets): (() => void) => {
  const onKeyDown = (event: KeyboardEvent): void => {
    if (isTyping(event)) return;
    const mod = event.ctrlKey || event.metaKey;

    if (mod && event.key.toLowerCase() === 'z') {
      event.preventDefault();
      if (event.shiftKey) targets.redo();
      else targets.undo();
      return;
    }
    if (mod && event.key.toLowerCase() === 'y') {
      event.preventDefault();
      targets.redo();
      return;
    }
    if (mod) return;

    switch (event.key) {
      case 'Escape':
        targets.dispatch({ type: 'cancel' });
        return;
      case 'Delete':
      case 'Backspace':
        event.preventDefault();
        targets.dispatch({ type: 'key', key: 'Delete' });
        return;
      case 'v':
      case 'V':
        targets.setTool('select');
        return;
      case 'r':
      case 'R':
        targets.setTool('rect');
        return;
      default:
        return;
    }
  };

  window.addEventListener('keydown', onKeyDown);
  return () => {
    window.removeEventListener('keydown', onKeyDown);
  };
};
