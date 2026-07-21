export function rafThrottle<T extends (...args: any[]) => void>(fn: T): T {
  let scheduled = false;
  let lastArgs: any[];
  const throttled = (...args: any[]) => {
    lastArgs = args;
    if (scheduled) return;
    scheduled = true;
    requestAnimationFrame(() => {
      scheduled = false;
      fn(...lastArgs);
    });
  };
  return throttled as T;
}

class PerfMonitor {
  private opTimes: Record<string, number[]> = {};
  private enabled = false;

  enable() { this.enabled = true; }

  getStats(): Record<string, { avg: number; max: number; count: number }> {
    const stats: Record<string, { avg: number; max: number; count: number }> = {};
    for (const [name, times] of Object.entries(this.opTimes)) {
      const sum = times.reduce((a, b) => a + b, 0);
      stats[name] = {
        avg: sum / times.length,
        max: Math.max(...times),
        count: times.length,
      };
    }
    return stats;
  }
}

export const perf = new PerfMonitor();

export type PerfTier = 'low' | 'medium' | 'high';

export function detectPerfTier(): PerfTier {
  if (typeof navigator === 'undefined') return 'medium';
  const cores = navigator.hardwareConcurrency || 4;
  const mem = (navigator as any).deviceMemory || 4;
  const isMobile = /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent);
  if (isMobile || cores <= 2 || mem <= 2) return 'low';
  if (cores >= 8 && mem >= 8) return 'high';
  return 'medium';
}

export interface PerfSettings {
  tier: PerfTier;
  realTimePreview: boolean;
  maxHistoryStates: number;
  thumbnailSize: number;
  historyImageQuality: number;
  useOffscreenCanvas: boolean;
  debounceSliderMs: number;
}

function supportsOffscreenCanvas(): boolean {
  return typeof OffscreenCanvas !== 'undefined';
}

export function getPerfSettings(tier?: PerfTier): PerfSettings {
  const t = tier || detectPerfTier();
  const offscreen = supportsOffscreenCanvas();
  switch (t) {
    case 'low':
      return { tier: t, realTimePreview: false, maxHistoryStates: 15, thumbnailSize: 32, historyImageQuality: 0.6, useOffscreenCanvas: false, debounceSliderMs: 150 };
    case 'high':
      return { tier: t, realTimePreview: true, maxHistoryStates: 60, thumbnailSize: 64, historyImageQuality: 0.85, useOffscreenCanvas: offscreen, debounceSliderMs: 0 };
    case 'medium':
    default:
      return { tier: t, realTimePreview: true, maxHistoryStates: 30, thumbnailSize: 48, historyImageQuality: 0.7, useOffscreenCanvas: offscreen, debounceSliderMs: 50 };
  }
}
