'use client';

/**
 * MobileAdjustDrawer — Snapseed-style bottom drawer for photo adjustments.
 *
 * Replaces the old mobile flow where the "Adjust" edge button opened the
 * DESKTOP AdjustmentsPanel inside a side sheet covering 86vw of the screen
 * (and with it, the photo). This drawer follows the v1.0.2 mobile redesign:
 *
 *   • Anchored above the floating tool dock, translucent glass — the photo
 *     stays visible in the upper half of the screen the whole time.
 *   • Group chips (Light / Color / Detail / Effects / Pro / AI / Filters)
 *     swap in place — one adjustment family at a time, roomy 44px rows.
 *   • LIVE PREVIEW: sliders re-render the photo in real time while dragging
 *     (throttled to ~80ms — heavy pixel ops like Clarity stay smooth).
 *     The original is snapshotted; ✕ or closing restores it untouched.
 *   • Apply commits the current group (thumbnail + history entry); Reset
 *     zeroes the group's sliders; Compare (press & hold) flashes the
 *     untouched original — Snapseed's signature affordance.
 *   • AI actions (Auto Unblur, Remove Background) and one-tap Filters
 *     commit instantly with history, matching the desktop panels.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import {
  SunMedium, Palette, Focus, Aperture, LineChart, Zap, Sparkle,
  ChevronDown, Check, RotateCcw, Eye, SlidersHorizontal,
} from 'lucide-react';
import { Slider } from '@/components/ui/slider';
import { useEditorStore } from '@/lib/editor-store';
import { cn } from '@/lib/utils';
import {
  applyBrightnessContrast, applyHueSaturation, applyColorTemperature, applyVibrance,
  applyHighlightsShadows, applyWhitesBlacks, applyClarity, applySharpen, applyFastBlur,
  medianDenoise, applyVignette, addNoise, applyPixelate, applyPosterize,
  applyGrayscale, applyInvert, applySepia, applyEdgeDetect, applyEmboss,
  applyCurves, applyLevels, applyChannelMixer, applyHDRToning,
  autoRemoveBackground, autoUnblur, createBlankCanvas,
} from '@/lib/image-processing';

type Group = 'light' | 'color' | 'detail' | 'effects' | 'pro' | 'ai' | 'filters';

const GROUPS: { key: Group; label: string; icon: React.ReactNode }[] = [
  { key: 'light', label: 'Light', icon: <SunMedium size={14} /> },
  { key: 'color', label: 'Color', icon: <Palette size={14} /> },
  { key: 'detail', label: 'Detail', icon: <Focus size={14} /> },
  { key: 'effects', label: 'Effects', icon: <Aperture size={14} /> },
  { key: 'pro', label: 'Pro', icon: <LineChart size={14} /> },
  { key: 'ai', label: 'AI', icon: <Zap size={14} /> },
  { key: 'filters', label: 'Filters', icon: <Sparkle size={14} /> },
];

// Live-previewed groups — sliders render the photo as you drag.
const LIVE_GROUPS: ReadonlySet<Group> = new Set(['light', 'color', 'detail', 'effects', 'pro']);

const DEFAULTS = {
  // Light
  brightness: 0, contrast: 0, highlights: 0, shadows: 0, whites: 0, blacks: 0,
  // Color
  hue: 0, saturation: 0, lightness: 0, vibrance: 0, temperature: 0,
  // Detail
  clarity: 0, sharpen: 0, blurRadius: 0, denoise: 0,
  // Effects
  vignetteAmount: 0, vignetteSize: 50, grain: 0, pixelate: 0, posterize: 0,
  // Pro
  levelsBlack: 0, levelsWhite: 255, levelsGamma: 1, curvesMid: 128, channelR: 100,
  hdrStrength: 0, hdrRadius: 8,
  // AI (not live — instant commits)
  unblurStrength: 60, unblurRadius: 1.5, unblurThreshold: 2, bgTolerance: 15,
};
type Values = typeof DEFAULTS;

const GROUP_KEYS: Record<Group, (keyof Values)[]> = {
  light: ['brightness', 'contrast', 'highlights', 'shadows', 'whites', 'blacks'],
  color: ['hue', 'saturation', 'lightness', 'vibrance', 'temperature'],
  detail: ['clarity', 'sharpen', 'blurRadius', 'denoise'],
  effects: ['vignetteAmount', 'vignetteSize', 'grain', 'pixelate', 'posterize'],
  pro: ['levelsBlack', 'levelsWhite', 'levelsGamma', 'curvesMid', 'channelR', 'hdrStrength', 'hdrRadius'],
  ai: ['unblurStrength', 'unblurRadius', 'unblurThreshold', 'bgTolerance'],
  filters: [],
};

// Pixel chains — each applied to a copy of the snapshot, top to bottom.
const CHAINS: Record<Group, (ctx: CanvasRenderingContext2D, w: number, h: number, v: Values) => void> = {
  light: (ctx, w, h, v) => {
    if (v.highlights !== 0 || v.shadows !== 0) applyHighlightsShadows(ctx, w, h, v.highlights, v.shadows);
    if (v.whites !== 0 || v.blacks !== 0) applyWhitesBlacks(ctx, w, h, v.whites, v.blacks);
    if (v.brightness !== 0 || v.contrast !== 0) applyBrightnessContrast(ctx, w, h, v.brightness, v.contrast);
  },
  color: (ctx, w, h, v) => {
    if (v.hue !== 0 || v.saturation !== 0 || v.lightness !== 0) {
      applyHueSaturation(ctx, w, h, v.hue, v.saturation, v.lightness);
    }
    if (v.vibrance !== 0) applyVibrance(ctx, w, h, v.vibrance);
    if (v.temperature !== 0) applyColorTemperature(ctx, w, h, v.temperature);
  },
  detail: (ctx, w, h, v) => {
    if (v.clarity !== 0) applyClarity(ctx, w, h, v.clarity);
    if (v.sharpen > 0) applySharpen(ctx, w, h, v.sharpen);
    if (v.blurRadius > 0) applyFastBlur(ctx, w, h, v.blurRadius);
    if (v.denoise > 0) medianDenoise(ctx, w, h, v.denoise);
  },
  effects: (ctx, w, h, v) => {
    if (v.vignetteAmount > 0) applyVignette(ctx, w, h, v.vignetteAmount, v.vignetteSize);
    if (v.grain > 0) addNoise(ctx, w, h, v.grain);
    if (v.pixelate >= 2) applyPixelate(ctx, w, h, v.pixelate);
    if (v.posterize >= 2) applyPosterize(ctx, w, h, v.posterize);
  },
  pro: (ctx, w, h, v) => {
    if (v.levelsBlack !== 0 || v.levelsWhite !== 255 || v.levelsGamma !== 1) {
      applyLevels(ctx, w, h, v.levelsBlack, v.levelsWhite, v.levelsGamma);
    }
    if (v.curvesMid !== 128) {
      applyCurves(ctx, w, h, [
        { x: 0, y: 0 },
        { x: v.curvesMid - 32, y: Math.max(0, v.curvesMid - 48) },
        { x: v.curvesMid + 32, y: Math.min(255, v.curvesMid + 48) },
        { x: 255, y: 255 },
      ]);
    }
    if (v.channelR !== 100) {
      applyChannelMixer(ctx, w, h, {
        rOut: { r: v.channelR, g: 0, b: 0 },
        gOut: { r: (100 - v.channelR) / 2, g: 100, b: 0 },
        bOut: { r: (100 - v.channelR) / 2, g: 0, b: 100 },
      });
    }
    if (v.hdrStrength > 0) applyHDRToning(ctx, w, h, v.hdrStrength, v.hdrRadius);
  },
  // AI / Filters are instant-commit — no live chain.
  ai: () => {},
  filters: () => {},
};

interface RowDef {
  key: keyof Values;
  label: string;
  min: number;
  max: number;
  step: number;
  /** slider-space -> display string */
  fmt: (raw: number) => string;
  /** value at which nothing renders (drives the reset affordance only) */
}

const signed = (v: number) => (v > 0 ? `+${v}` : String(v));

const ROWS: Record<Group, RowDef[]> = {
  light: [
    { key: 'brightness', label: 'Brightness', min: -100, max: 100, step: 1, fmt: signed },
    { key: 'contrast', label: 'Contrast', min: -100, max: 100, step: 1, fmt: signed },
    { key: 'highlights', label: 'Highlights', min: -100, max: 100, step: 1, fmt: signed },
    { key: 'shadows', label: 'Shadows', min: -100, max: 100, step: 1, fmt: signed },
    { key: 'whites', label: 'Whites', min: -100, max: 100, step: 1, fmt: signed },
    { key: 'blacks', label: 'Blacks', min: -100, max: 100, step: 1, fmt: signed },
  ],
  color: [
    { key: 'hue', label: 'Hue', min: -180, max: 180, step: 1, fmt: (v) => `${v}°` },
    { key: 'saturation', label: 'Saturation', min: -100, max: 100, step: 1, fmt: signed },
    { key: 'lightness', label: 'Lightness', min: -100, max: 100, step: 1, fmt: signed },
    { key: 'vibrance', label: 'Vibrance', min: -100, max: 100, step: 1, fmt: signed },
    { key: 'temperature', label: 'Warmth', min: -100, max: 100, step: 1, fmt: signed },
  ],
  detail: [
    { key: 'clarity', label: 'Clarity', min: -100, max: 100, step: 1, fmt: signed },
    { key: 'sharpen', label: 'Sharpen', min: 0, max: 5, step: 0.1, fmt: (v) => v.toFixed(1) },
    { key: 'blurRadius', label: 'Blur', min: 0, max: 30, step: 0.5, fmt: (v) => `${v}px` },
    { key: 'denoise', label: 'Denoise', min: 0, max: 3, step: 1, fmt: (v) => (v > 0 ? `r${v}` : 'off') },
  ],
  effects: [
    { key: 'vignetteAmount', label: 'Vignette', min: 0, max: 100, step: 1, fmt: (v) => (v > 0 ? String(v) : 'off') },
    { key: 'vignetteSize', label: 'Vig. size', min: 0, max: 100, step: 1, fmt: String },
    { key: 'grain', label: 'Grain', min: 0, max: 100, step: 1, fmt: (v) => (v > 0 ? String(v) : 'off') },
    { key: 'pixelate', label: 'Pixelate', min: 0, max: 50, step: 1, fmt: (v) => (v >= 2 ? `${v}px` : 'off') },
    { key: 'posterize', label: 'Posterize', min: 0, max: 32, step: 1, fmt: (v) => (v >= 2 ? String(v) : 'off') },
  ],
  pro: [
    { key: 'levelsBlack', label: 'Black', min: 0, max: 254, step: 1, fmt: String },
    { key: 'levelsWhite', label: 'White', min: 1, max: 255, step: 1, fmt: String },
    { key: 'levelsGamma', label: 'Gamma', min: 10, max: 1000, step: 1, fmt: (v) => (v / 100).toFixed(2) },
    { key: 'curvesMid', label: 'Curve mid', min: 32, max: 224, step: 1, fmt: String },
    { key: 'channelR', label: 'Channel R', min: 0, max: 200, step: 1, fmt: (v) => `${v}%` },
    { key: 'hdrStrength', label: 'HDR', min: 0, max: 100, step: 1, fmt: (v) => (v > 0 ? String(v) : 'off') },
    { key: 'hdrRadius', label: 'HDR radius', min: 1, max: 20, step: 1, fmt: (v) => `${v}px` },
  ],
  ai: [],
  filters: [],
};

const FILTERS: { label: string; fn: (ctx: CanvasRenderingContext2D, w: number, h: number) => void }[] = [
  { label: 'Grayscale', fn: applyGrayscale },
  { label: 'Invert', fn: applyInvert },
  { label: 'Sepia', fn: applySepia },
  { label: 'Edge Detect', fn: applyEdgeDetect },
  { label: 'Emboss', fn: applyEmboss },
  { label: 'Denoise', fn: (ctx, w, h) => medianDenoise(ctx, w, h, 1) },
];

function AdjRow({
  label, value, min, max, step, fmt, onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  fmt: (raw: number) => string;
  onChange: (v: number) => void;
}) {
  return (
    <div className="flex items-center gap-2.5">
      <span className="w-[76px] shrink-0 text-[11px] editor-text-muted">{label}</span>
      <Slider value={[value]} min={min} max={max} step={step} onValueChange={(v) => onChange(v[0])} className="flex-1" />
      <span className="w-11 shrink-0 text-right text-[11px] font-mono tabular-nums editor-text">{fmt(value)}</span>
    </div>
  );
}

export function MobileAdjustDrawer({ onClose }: { onClose: () => void }) {
  const [group, setGroup] = useState<Group>('light');
  const [values, setValues] = useState<Values>({ ...DEFAULTS });
  const [comparing, setComparing] = useState(false);

  // Session capture — computed ONCE per mount (the drawer remounts on every
  // open, so a lazy useState initializer is exactly the right lifetime).
  // Reads the store without setting it; creates the snapshot/original/
  // preview canvases; resolves the no-layer/locked guard.
  const [session] = useState(() => {
    const s = useEditorStore.getState();
    const layer = s.layers.find((l) => l.id === s.activeLayerId);
    if (!layer) {
      return { layerId: null as string | null, reason: 'No active layer — add or open an image first.', snap: null, original: null, preview: null };
    }
    if (layer.locked) {
      return { layerId: null as string | null, reason: 'This layer is locked.', snap: null, original: null, preview: null };
    }
    const { width, height } = layer.canvas;
    // Committed state — starts as the layer's pixels at open; advanced by
    // Apply and by instant AI/Filter commits. ✕ restores it untouched.
    const snap = createBlankCanvas(width, height);
    snap.getContext('2d')!.drawImage(layer.canvas, 0, 0);
    // Never-mutated original for the Compare affordance.
    const original = createBlankCanvas(width, height);
    original.getContext('2d')!.drawImage(layer.canvas, 0, 0);
    // Scratch canvas the live preview chain renders into (reused per tick).
    const preview = createBlankCanvas(width, height);
    preview.getContext('2d')!.drawImage(snap, 0, 0);
    return { layerId: layer.id as string | null, reason: null as string | null, snap, original, preview };
  });

  const unavailable = session.reason;

  // The layer this session edits (captured once on open).
  const layerIdRef = useRef<string | null>(session.layerId);
  const snapshotRef = useRef<HTMLCanvasElement | null>(session.snap);
  const originalRef = useRef<HTMLCanvasElement | null>(session.original);
  const previewRef = useRef<HTMLCanvasElement | null>(session.preview);

  // "Latest value" mirrors for async callbacks (throttled timers / rAF runs
  // always fire after effects have flushed the mirror). Synced in an effect,
  // never during render.
  const valuesRef = useRef(values);
  const groupRef = useRef(group);
  useEffect(() => {
    valuesRef.current = values;
    groupRef.current = group;
  });

  // Throttle bookkeeping: at most one queued preview run, min 80ms apart.
  const pendingRef = useRef(false);
  const lastRunRef = useRef(0);
  const disposedRef = useRef(false);

  /** Render snapshot + current group's chain into the preview canvas and
      swap it in silently — the photo updates in real time while dragging. */
  const runPreview = useCallback(() => {
    const layerId = layerIdRef.current;
    const snap = snapshotRef.current;
    const preview = previewRef.current;
    if (!layerId || !snap || !preview) return;
    const ctx = preview.getContext('2d')!;
    ctx.clearRect(0, 0, preview.width, preview.height);
    ctx.drawImage(snap, 0, 0);
    CHAINS[groupRef.current](ctx, preview.width, preview.height, valuesRef.current);
    useEditorStore.getState().setLayerCanvasSilent(layerId, preview);
  }, []);

  /** Throttled scheduler — called on every slider tick. */
  const schedulePreview = useCallback(() => {
    if (pendingRef.current || disposedRef.current || !LIVE_GROUPS.has(groupRef.current)) return;
    const now = performance.now();
    const wait = Math.max(0, 80 - (now - lastRunRef.current));
    pendingRef.current = true;
    window.setTimeout(() => {
      pendingRef.current = false;
      if (disposedRef.current) return;
      lastRunRef.current = performance.now();
      requestAnimationFrame(() => {
        if (disposedRef.current) return;
        runPreview();
      });
    }, wait);
  }, [runPreview]);

  // Capture disposal + restore the committed state on unmount (✕, parent
  // teardown). After instant AI/Filter commits the layer already IS the
  // snapshot — restoring is a no-op then. No setState here — store only.
  useEffect(() => {
    disposedRef.current = false;
    return () => {
      disposedRef.current = true;
      const id = layerIdRef.current;
      const finalSnap = snapshotRef.current;
      if (!id || !finalSnap) return;
      const st = useEditorStore.getState();
      const l = st.layers.find((x) => x.id === id);
      if (l && l.canvas !== finalSnap) st.setLayerCanvasSilent(id, finalSnap);
    };
  }, []);

  const setVal = useCallback((key: keyof Values, v: number) => {
    setValues((prev) => ({ ...prev, [key]: v }));
    schedulePreview();
  }, [schedulePreview]);

  /** Switch group — re-run the preview from the snapshot for the new group. */
  const switchGroup = useCallback((g: Group) => {
    setGroup(g);
    groupRef.current = g;
    // Non-live groups show the committed snapshot itself (no chain).
    requestAnimationFrame(() => {
      if (disposedRef.current) return;
      if (LIVE_GROUPS.has(g)) runPreview();
      else {
        const layerId = layerIdRef.current;
        const snap = snapshotRef.current;
        if (layerId && snap) useEditorStore.getState().setLayerCanvasSilent(layerId, snap);
      }
    });
  }, [runPreview]);

  // Reads the STATE (not the ref mirror) so render-time disabled/enabled
  // styling stays reactive; apply() reuses it from its click closure.
  const isPristine = useCallback((g: Group) =>
    GROUP_KEYS[g].every((k) => values[k] === DEFAULTS[k]),
  [values]);

  /** Commit the current live group onto the snapshot (thumbnail + history). */
  const apply = useCallback(() => {
    const layerId = layerIdRef.current;
    const snap = snapshotRef.current;
    if (!layerId || !snap) return;
    if (isPristine(groupRef.current)) {
      toast('Nothing to apply — move a slider first');
      return;
    }
    const ctx = snap.getContext('2d')!;
    CHAINS[groupRef.current](ctx, snap.width, snap.height, valuesRef.current);
    const s = useEditorStore.getState();
    s.replaceLayerCanvas(layerId, snap);
    s.pushHistory(`Adjust: ${GROUPS.find((g) => g.key === groupRef.current)?.label ?? groupRef.current}`);
    // Group values reset so re-entering the group starts from the new base.
    setValues((prev) => {
      const next = { ...prev };
      for (const k of GROUP_KEYS[groupRef.current]) next[k] = DEFAULTS[k];
      return next;
    });
    toast.success('Applied');
  }, [isPristine]);

  const resetGroup = useCallback(() => {
    setValues((prev) => {
      const next = { ...prev };
      for (const k of GROUP_KEYS[groupRef.current]) next[k] = DEFAULTS[k];
      return next;
    });
    schedulePreview();
  }, [schedulePreview]);

  /** Instant commit helper for AI actions and one-tap filters: mutates the
      snapshot (or replaces it), then publishes it with thumbnail + history. */
  const commitInstant = useCallback((label: string, fn: (ctx: CanvasRenderingContext2D, w: number, h: number) => void) => {
    const layerId = layerIdRef.current;
    const snap = snapshotRef.current;
    if (!layerId || !snap) return;
    fn(snap.getContext('2d')!, snap.width, snap.height);
    const s = useEditorStore.getState();
    s.replaceLayerCanvas(layerId, snap);
    s.pushHistory(label);
  }, []);

  const runUnblur = useCallback(() => {
    const layerId = layerIdRef.current;
    const snap = snapshotRef.current;
    if (!layerId || !snap) return;
    const v = valuesRef.current;
    const tid = toast.loading('Deblurring image...');
    setTimeout(() => {
      if (disposedRef.current) return;
      try {
        commitInstant('Auto Unblur', (ctx, w, h) =>
          autoUnblur(ctx, w, h, v.unblurStrength, v.unblurRadius, v.unblurThreshold));
        toast.success('Image deblurred', { id: tid });
      } catch {
        toast.error('Failed to deblur image', { id: tid });
      }
    }, 50);
  }, [commitInstant]);

  const runRemoveBackground = useCallback(() => {
    const layerId = layerIdRef.current;
    const snap = snapshotRef.current;
    if (!layerId || !snap) return;
    try {
      const result = autoRemoveBackground(snap, valuesRef.current.bgTolerance, 1);
      snapshotRef.current = result;
      const s = useEditorStore.getState();
      s.replaceLayerCanvas(layerId, result);
      s.pushHistory('Auto Remove Background');
      toast.success('Background removed');
    } catch {
      toast.error('Failed to remove background');
    }
  }, []);

  /** Compare (press & hold): flash the untouched original; release restores. */
  const startCompare = useCallback(() => {
    const layerId = layerIdRef.current;
    const original = originalRef.current;
    if (!layerId || !original) return;
    setComparing(true);
    useEditorStore.getState().setLayerCanvasSilent(layerId, original);
  }, []);

  const endCompare = useCallback(() => {
    if (!comparing) return;
    setComparing(false);
    if (LIVE_GROUPS.has(groupRef.current)) runPreview();
    else {
      const layerId = layerIdRef.current;
      const snap = snapshotRef.current;
      if (layerId && snap) useEditorStore.getState().setLayerCanvasSilent(layerId, snap);
    }
  }, [comparing, runPreview]);

  if (unavailable) {
    return (
      <div className="absolute bottom-[72px] left-2 right-2 z-30 rounded-2xl editor-glass-strong backdrop-blur border editor-border shadow-xl flex flex-col">
        <div className="flex items-center justify-between px-3 py-2.5">
          <span className="flex items-center gap-2 text-xs font-medium editor-text">
            <SlidersHorizontal size={13} className="editor-accent" />
            Adjust
          </span>
          <button
            onClick={onClose}
            className="w-7 h-7 rounded-md flex items-center justify-center editor-text-muted active:bg-[var(--editor-surface-3)]"
            aria-label="Close adjust drawer"
          >
            <ChevronDown size={16} />
          </button>
        </div>
        <div className="px-3 pb-3 text-xs editor-text-muted">{unavailable}</div>
      </div>
    );
  }

  const isLive = LIVE_GROUPS.has(group);
  const rows = ROWS[group];

  return (
    <div className="absolute bottom-[72px] left-2 right-2 z-30 rounded-2xl editor-glass-strong backdrop-blur border editor-border shadow-xl flex flex-col max-h-[62dvh] animate-in fade-in slide-in-from-bottom-2 duration-150">
      {/* Header: title + Reset / Apply / Compare / close */}
      <div className="flex items-center justify-between px-2.5 py-2 border-b editor-border shrink-0 gap-1">
        <span className="flex items-center gap-2 text-xs font-medium editor-text shrink-0">
          <SlidersHorizontal size={13} className="editor-accent" />
          Adjust
        </span>
        <div className="flex items-center gap-1 ml-auto">
          {/* Compare (press & hold) — Snapseed's signature original-vs-edit flash */}
          <button
            onPointerDown={startCompare}
            onPointerUp={endCompare}
            onPointerLeave={() => comparing && endCompare()}
            onPointerCancel={endCompare}
            aria-label="Hold to compare with original"
            title="Hold to see the original"
            className={cn(
              'h-7 px-2.5 rounded-md flex items-center gap-1 text-[11px] transition-colors touch-target',
              comparing ? 'editor-accent-bg text-white' : 'editor-text-muted active:bg-[var(--editor-surface-3)]',
            )}
          >
            <Eye size={13} />
          </button>
          {isLive && (
            <>
              <button
                onClick={resetGroup}
                aria-label="Reset this group"
                className="h-7 px-2.5 rounded-md flex items-center gap-1 text-[11px] editor-text-muted active:bg-[var(--editor-surface-3)] transition-colors touch-target"
              >
                <RotateCcw size={13} />
                <span>Reset</span>
              </button>
              <button
                onClick={apply}
                disabled={isPristine(group)}
                aria-label="Apply adjustments"
                className={cn(
                  'h-7 px-3 rounded-md flex items-center gap-1 text-[11px] font-medium transition-colors touch-target',
                  isPristine(group)
                    ? 'opacity-40 editor-text-muted cursor-not-allowed'
                    : 'editor-accent-bg text-white active:opacity-90',
                )}
              >
                <Check size={13} />
                <span>Apply</span>
              </button>
            </>
          )}
          <button
            onClick={onClose}
            className="w-7 h-7 rounded-md flex items-center justify-center editor-text-muted active:bg-[var(--editor-surface-3)]"
            aria-label="Close adjust drawer"
          >
            <ChevronDown size={16} />
          </button>
        </div>
      </div>

      {/* Group chips — swap in place */}
      <div className="flex items-center gap-1 px-1.5 py-1.5 overflow-x-auto hide-scrollbar shrink-0">
        {GROUPS.map((g) => (
          <button
            key={g.key}
            onClick={() => switchGroup(g.key)}
            className={cn(
              'h-9 px-3 rounded-xl flex items-center gap-1.5 text-xs font-medium whitespace-nowrap shrink-0 transition-colors',
              group === g.key
                ? 'editor-accent-bg text-white'
                : 'editor-text active:bg-[var(--editor-surface-3)]',
            )}
            aria-pressed={group === g.key}
          >
            {g.icon}
            <span>{g.label}</span>
          </button>
        ))}
      </div>

      {/* Body: slider rows / AI actions / filter grid */}
      <div className="flex flex-col gap-3 px-3 pb-3 pt-1 overflow-y-auto custom-scroll">
        {isLive && rows.map((r) => (
          <AdjRow
            key={r.key}
            label={r.label}
            value={values[r.key]}
            min={r.min}
            max={r.max}
            step={r.step}
            fmt={r.fmt}
            onChange={(v) => setVal(r.key, v)}
          />
        ))}

        {group === 'ai' && (
          <>
            <div className="space-y-3 p-2.5 rounded-xl bg-gradient-to-br from-emerald-900/30 to-sky-900/30 border border-emerald-700/40">
              <div className="flex items-center gap-1.5 text-[11px] font-bold text-emerald-400">
                <Zap size={12} /> AI Auto Unblur
              </div>
              <AdjRow label="Strength" value={values.unblurStrength} min={0} max={100} step={1} fmt={String} onChange={(v) => setVal('unblurStrength', v)} />
              <AdjRow label="Radius" value={values.unblurRadius} min={0.5} max={5} step={0.1} fmt={(v) => `${v}px`} onChange={(v) => setVal('unblurRadius', v)} />
              <AdjRow label="Threshold" value={values.unblurThreshold} min={0} max={30} step={1} fmt={String} onChange={(v) => setVal('unblurThreshold', v)} />
              <button onClick={runUnblur} className="h-9 w-full rounded-lg bg-emerald-600 hover:bg-emerald-500 active:bg-emerald-600 text-white text-xs font-medium flex items-center justify-center gap-1.5 transition-colors">
                <Zap size={13} /> Unblur Image
              </button>
            </div>
            <div className="space-y-3 p-2.5 rounded-xl bg-gradient-to-br from-sky-900/30 to-purple-900/30 border border-sky-700/40">
              <div className="flex items-center gap-1.5 text-[11px] font-bold editor-accent">
                <Sparkle size={12} /> AI Remove Background
              </div>
              <AdjRow label="Tolerance" value={values.bgTolerance} min={1} max={80} step={1} fmt={String} onChange={(v) => setVal('bgTolerance', v)} />
              <button onClick={runRemoveBackground} className="h-9 w-full rounded-lg editor-accent-bg hover:opacity-90 active:opacity-100 text-white text-xs font-medium flex items-center justify-center gap-1.5 transition-opacity">
                <Sparkle size={13} /> Remove Background
              </button>
            </div>
          </>
        )}

        {group === 'filters' && (
          <div className="grid grid-cols-3 gap-1.5 pt-1">
            {FILTERS.map((f) => (
              <button
                key={f.label}
                onClick={() => commitInstant(f.label, f.fn)}
                className="h-12 rounded-xl flex items-center justify-center text-[11px] editor-text editor-surface-2 editor-border border active:editor-accent-bg active:text-white transition-colors"
              >
                {f.label}
              </button>
            ))}
            <p className="col-span-3 text-[10px] editor-text-dim leading-snug pt-1">
              One-tap filters apply instantly to the active layer — Undo reverts them.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
