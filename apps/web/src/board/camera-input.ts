import type { Camera, Vec2 } from '@tessera/core';
import { panByScreen, zoomAbout } from '@tessera/core';

/**
 * Camera gestures, as pure functions from an event's numbers to the next camera.
 *
 * Phase 3 is read-only: a user can move the camera and nothing else. Keeping these pure — no
 * event object, no element, no `preventDefault` — is what lets the sign conventions be tested
 * without a browser, and what keeps the DOM listener in the hook down to "read the numbers,
 * call this, store the result".
 */

/**
 * Wheel-to-zoom rate.
 *
 * A trackpad reports small deltas at high frequency and a mouse wheel large ones at low
 * frequency, so the factor is exponential in the delta: pinch and scroll then feel like the
 * same control at different speeds rather than like two controls.
 */
const ZOOM_PER_PIXEL = 0.0015;

export interface WheelInput {
  readonly deltaX: number;
  readonly deltaY: number;
  /** Browsers set ctrl for a trackpad pinch, so ctrl+wheel *is* the pinch gesture. */
  readonly ctrlKey: boolean;
  /** Pointer position in CSS pixels relative to the canvas. */
  readonly at: Vec2;
}

/**
 * A wheel event, applied.
 *
 * Pinch (ctrl+wheel) zooms about the pointer, so the board point under the cursor stays under
 * the cursor — zooming about the viewport centre makes the thing you are looking at slide
 * away as you zoom in on it. A plain wheel scrolls: wheel down moves the content up, which is
 * the convention every scrollable surface has, so the delta is negated before it pans.
 */
export const applyWheel = (camera: Camera, input: WheelInput): Camera => {
  if (input.ctrlKey) {
    const factor = Math.exp(-input.deltaY * ZOOM_PER_PIXEL);
    return zoomAbout(camera, input.at, factor);
  }
  return panByScreen(camera, { x: -input.deltaX, y: -input.deltaY });
};

/**
 * A drag, applied.
 *
 * The content follows the pointer: the board point under the pointer stays under it for the
 * whole gesture, so `panByScreen` gets the raw delta — it already moves the camera *against*
 * the delta. That equality is exactly what `3.C1` measures through pixels.
 */
export const applyDrag = (camera: Camera, deltaCss: Vec2): Camera => panByScreen(camera, deltaCss);
