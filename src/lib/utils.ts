import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

export function generateId(): string {
  return Math.random().toString(36).substring(2, 11) + Date.now().toString(36);
}

/**
 * True when the primary pointer is coarse (touch) — i.e. phones/tablets.
 * Used to hide desktop-only affordances (keyboard shortcut hints, Alt+Click
 * phrasing) inside the APK / on touch devices. Evaluated once and cached:
 * matchMedia result does not change without a reload in practice.
 */
let cachedTouch: boolean | null = null;
export function isTouchDevice(): boolean {
  if (cachedTouch === null) {
    cachedTouch =
      typeof window !== 'undefined' &&
      typeof window.matchMedia === 'function' &&
      (window.matchMedia('(pointer: coarse)').matches ||
        // No pointer at all (older WebViews): fall back to touch detection
        (!window.matchMedia('(pointer: fine)').matches && 'ontouchstart' in window));
  }
  return cachedTouch;
}
