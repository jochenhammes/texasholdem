import { cubicOut, backOut } from 'svelte/easing';

/** Card appearing: quick flip + lift (GPU-friendly: transform/opacity only). */
export function cardIn(_node: Element, { delay = 0, duration = 320 }: { delay?: number; duration?: number } = {}) {
  return {
    delay,
    duration,
    easing: cubicOut,
    css: (t: number) =>
      `transform: perspective(600px) translateY(${(1 - t) * -14}px) rotateY(${(1 - t) * 90}deg); opacity: ${Math.min(1, t * 2)}`,
  };
}

/** Pop-in for chips, badges and toasts. */
export function pop(_node: Element, { delay = 0, duration = 260 }: { delay?: number; duration?: number } = {}) {
  return {
    delay,
    duration,
    easing: backOut,
    css: (t: number) => `transform: scale(${0.6 + 0.4 * t}); opacity: ${t}`,
  };
}
