// Performance optimization utilities

// ============================================================================
// RAF Throttle - batch high-frequency events into animation frames
// ============================================================================
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

// ============================================================================
// Debounce - delay function call until after wait period
// ============================================================================
export function debounce<T extends (...args: any[]) => void>(fn: T, wait: number): T {
  let timeout: ReturnType<typeof setTimeout> | null = null;
  const debounced = (...args: any[]) => {
    if (timeout) clearTimeout(timeout);
    timeout = setTimeout(() => fn(...args), wait);
  };
  return debounced as T;
}

// ============================================================================
// Performance monitor - tracks FPS and operation times
// ============================================================================
class PerfMonitor {
  private fps = 0;
  private frameCount = 0;
  private lastTime = performance.now();
  private opTimes: Record<string, number[]> = {};
  private enabled = false;

  enable() { this.enabled = true; }
  disable() { this.enabled = false; }

  tick() {
    if (!this.enabled) return;
    this.frameCount++;
    const now = performance.now();
    if (now - this.lastTime >= 1000) {
      this.fps = this.frameCount;
      this.frameCount = 0;
      this.lastTime = now;
    }
  }

  getFps() { return this.fps; }

  time<T>(name: string, fn: () => T): T {
    if (!this.enabled) return fn();
    const start = performance.now();
    const result = fn();
    const elapsed = performance.now() - start;
    if (!this.opTimes[name]) this.opTimes[name] = [];
    this.opTimes[name].push(elapsed);
    if (this.opTimes[name].length > 30) this.opTimes[name].shift();
    return result;
  }

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

  reset() {
    this.opTimes = {};
    this.frameCount = 0;
  }
}

export const perf = new PerfMonitor();

// ============================================================================
// Canvas pool - reuse canvas elements to avoid GC pressure
// ============================================================================
const canvasPool: HTMLCanvasElement[] = [];

export function getPooledCanvas(w: number, h: number): HTMLCanvasElement {
  let canvas = canvasPool.pop();
  if (!canvas) canvas = document.createElement('canvas');
  if (canvas.width !== w) canvas.width = w;
  if (canvas.height !== h) canvas.height = h;
  return canvas;
}

export function releaseCanvas(canvas: HTMLCanvasElement) {
  const ctx = canvas.getContext('2d');
  if (ctx) ctx.clearRect(0, 0, canvas.width, canvas.height);
  if (canvasPool.length < 10) {
    canvasPool.push(canvas);
  }
}

// ============================================================================
// OffscreenCanvas support detection
// ============================================================================
export function supportsOffscreenCanvas(): boolean {
  return typeof OffscreenCanvas !== 'undefined';
}

// ============================================================================
// Image data cache - avoid re-reading pixels for repeated operations
// ============================================================================
const imageDataCache = new WeakMap<HTMLCanvasElement, ImageData>();

export function getCachedImageData(canvas: HTMLCanvasElement): ImageData {
  const cached = imageDataCache.get(canvas);
  if (cached && cached.width === canvas.width && cached.height === canvas.height) {
    return cached;
  }
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
  const data = ctx.getImageData(0, 0, canvas.width, canvas.height);
  imageDataCache.set(canvas, data);
  return data;
}

export function invalidateImageDataCache(canvas: HTMLCanvasElement) {
  imageDataCache.delete(canvas);
}

// ============================================================================
// Memory manager - track and limit memory usage
// ============================================================================
class MemoryManager {
  private historyMemoryBytes = 0;
  private maxHistoryMemory = 200 * 1024 * 1024; // 200MB default

  setMaxHistoryMemory(bytes: number) {
    this.maxHistoryMemory = bytes;
  }

  addHistoryMemory(bytes: number) {
    this.historyMemoryBytes += bytes;
  }

  removeHistoryMemory(bytes: number) {
    this.historyMemoryBytes = Math.max(0, this.historyMemoryBytes - bytes);
  }

  getHistoryMemory(): number {
    return this.historyMemoryBytes;
  }

  isHistoryMemoryExceeded(): boolean {
    return this.historyMemoryBytes > this.maxHistoryMemory;
  }

  getMemoryStats() {
    return {
      historyBytes: this.historyMemoryBytes,
      historyMB: (this.historyMemoryBytes / 1024 / 1024).toFixed(1),
      maxMB: (this.maxHistoryMemory / 1024 / 1024).toFixed(0),
      percent: ((this.historyMemoryBytes / this.maxHistoryMemory) * 100).toFixed(1),
    };
  }
}

export const memory = new MemoryManager();

// ============================================================================
// Detect device performance tier
// ============================================================================
export type PerfTier = 'low' | 'medium' | 'high';

export function detectPerfTier(): PerfTier {
  if (typeof navigator === 'undefined') return 'medium';
  // Use hardwareConcurrency and deviceMemory as hints
  const cores = navigator.hardwareConcurrency || 4;
  // @ts-ignore - deviceMemory is experimental
  const mem = (navigator as any).deviceMemory || 4;
  // Mobile detection
  const isMobile = /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent);
  if (isMobile || cores <= 2 || mem <= 2) return 'low';
  if (cores >= 8 && mem >= 8) return 'high';
  return 'medium';
}

// ============================================================================
// Performance mode settings
// ============================================================================
export interface PerfSettings {
  tier: PerfTier;
  realTimePreview: boolean;   // Update canvas during slider drag
  maxHistoryStates: number;   // Max undo states
  thumbnailSize: number;      // Layer thumbnail size
  historyImageQuality: number; // 0-1 JPEG quality for history
  useOffscreenCanvas: boolean;
  debounceSliderMs: number;
}

export function getPerfSettings(tier?: PerfTier): PerfSettings {
  const t = tier || detectPerfTier();
  switch (t) {
    case 'low':
      return {
        tier: t,
        realTimePreview: false,
        maxHistoryStates: 15,
        thumbnailSize: 32,
        historyImageQuality: 0.6,
        useOffscreenCanvas: false,
        debounceSliderMs: 150,
      };
    case 'high':
      return {
        tier: t,
        realTimePreview: true,
        maxHistoryStates: 60,
        thumbnailSize: 64,
        historyImageQuality: 0.85,
        useOffscreenCanvas: supportsOffscreenCanvas(),
        debounceSliderMs: 0,
      };
    case 'medium':
    default:
      return {
        tier: t,
        realTimePreview: true,
        maxHistoryStates: 30,
        thumbnailSize: 48,
        historyImageQuality: 0.7,
        useOffscreenCanvas: supportsOffscreenCanvas(),
        debounceSliderMs: 50,
      };
  }
}
