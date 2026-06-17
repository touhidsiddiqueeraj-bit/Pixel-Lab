'use client';

import { useEditorStore } from '@/lib/editor-store';
import {
  applyBrightnessContrast,
  applyHueSaturation,
  applyGrayscale,
  applyInvert,
  applySepia,
  applyThreshold,
  applyFastBlur,
  applySharpen,
  autoRemoveBackground,
} from '@/lib/image-processing';
import { toast } from 'sonner';
import { useState, useCallback } from 'react';
import { Sparkles, SunMedium, Contrast, Droplets, Palette, CircleOff, Image as ImageIcon, Focus, Scissors, Wand2 } from 'lucide-react';
import { Slider } from '@/components/ui/slider';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';

export function AdjustmentsPanel() {
  const layers = useEditorStore((s) => s.layers);
  const activeLayerId = useEditorStore((s) => s.activeLayerId);
  const refreshThumbnail = useEditorStore((s) => s.refreshThumbnail);
  const pushHistory = useEditorStore((s) => s.pushHistory);
  const replaceLayerCanvas = useEditorStore((s) => s.replaceLayerCanvas);

  const [brightness, setBrightness] = useState(0);
  const [contrast, setContrast] = useState(0);
  const [hue, setHue] = useState(0);
  const [saturation, setSaturation] = useState(0);
  const [lightness, setLightness] = useState(0);
  const [blurRadius, setBlurRadius] = useState(0);
  const [sharpenAmount, setSharpenAmount] = useState(0);
  const [bgTolerance, setBgTolerance] = useState(32);

  const getActive = useCallback(() => layers.find((l) => l.id === activeLayerId) ?? null, [layers, activeLayerId]);

  const applyAdjustment = useCallback((label: string, fn: (ctx: CanvasRenderingContext2D, w: number, h: number) => void) => {
    const layer = getActive();
    if (!layer) {
      toast.error('No active layer');
      return;
    }
    if (layer.locked) {
      toast.error('Layer is locked');
      return;
    }
    const ctx = layer.canvas.getContext('2d')!;
    fn(ctx, layer.canvas.width, layer.canvas.height);
    refreshThumbnail(layer.id);
    pushHistory(label);
  }, [getActive, refreshThumbnail, pushHistory]);

  const handleAutoBgRemove = useCallback(() => {
    const layer = getActive();
    if (!layer) {
      toast.error('No active layer');
      return;
    }
    if (layer.locked) {
      toast.error('Layer is locked');
      return;
    }
    const result = autoRemoveBackground(layer.canvas, bgTolerance, 1);
    replaceLayerCanvas(layer.id, result);
    pushHistory('Auto Remove Background');
    toast.success('Background removed');
  }, [getActive, bgTolerance, replaceLayerCanvas, pushHistory]);

  const quickFilters = [
    { label: 'Grayscale', icon: <CircleOff size={14} />, action: () => applyAdjustment('Grayscale', (ctx, w, h) => applyGrayscale(ctx, w, h)) },
    { label: 'Invert', icon: <ImageIcon size={14} />, action: () => applyAdjustment('Invert', (ctx, w, h) => applyInvert(ctx, w, h)) },
    { label: 'Sepia', icon: <Palette size={14} />, action: () => applyAdjustment('Sepia', (ctx, w, h) => applySepia(ctx, w, h)) },
  ];

  return (
    <div className="flex flex-col h-full bg-zinc-900 text-zinc-200 overflow-y-auto custom-scroll">
      <div className="px-3 py-2 border-b border-zinc-800 text-xs font-semibold uppercase tracking-wide text-zinc-400">
        Adjustments
      </div>

      <div className="p-3 space-y-4">
        {/* Auto background removal */}
        <div className="space-y-2">
          <div className="flex items-center gap-2 text-xs font-semibold text-sky-400">
            <Sparkles size={14} />
            <span>AI Auto Background Remove</span>
          </div>
          <div className="space-y-1.5">
            <div className="flex items-center justify-between text-xs">
              <Label className="text-zinc-400 flex items-center gap-1"><Scissors size={11} /> Tolerance</Label>
              <span className="text-zinc-300">{bgTolerance}</span>
            </div>
            <Slider value={[bgTolerance]} min={5} max={80} step={1} onValueChange={(v) => setBgTolerance(v[0])} />
            <Button
              onClick={handleAutoBgRemove}
              className="w-full bg-sky-600 hover:bg-sky-500 text-white text-xs h-8"
            >
              <Wand2 size={12} className="mr-1" /> Remove Background
            </Button>
            <p className="text-[10px] text-zinc-500 leading-snug">
              Smart edge-detection flood-fill. Best for images with solid or gradient backgrounds. Adjust tolerance for similar-color removal.
            </p>
          </div>
        </div>

        <div className="h-px bg-zinc-800" />

        {/* Brightness/Contrast */}
        <div className="space-y-2">
          <div className="text-xs font-semibold text-zinc-300 flex items-center gap-1.5">
            <SunMedium size={12} /> Brightness
            <span className="ml-auto text-zinc-500">{brightness}</span>
          </div>
          <Slider value={[brightness]} min={-100} max={100} step={1} onValueChange={setBrightness} />
          <div className="text-xs font-semibold text-zinc-300 flex items-center gap-1.5">
            <Contrast size={12} /> Contrast
            <span className="ml-auto text-zinc-500">{contrast}</span>
          </div>
          <Slider value={[contrast]} min={-100} max={100} step={1} onValueChange={setContrast} />
          <Button
            onClick={() => applyAdjustment('Brightness/Contrast', (ctx, w, h) => applyBrightnessContrast(ctx, w, h, brightness, contrast))}
            variant="secondary"
            size="sm"
            className="w-full h-7 text-xs"
          >Apply</Button>
        </div>

        <div className="h-px bg-zinc-800" />

        {/* Hue/Saturation */}
        <div className="space-y-2">
          <div className="text-xs font-semibold text-zinc-300 flex items-center gap-1.5">
            <Palette size={12} /> Hue
            <span className="ml-auto text-zinc-500">{hue}°</span>
          </div>
          <Slider value={[hue]} min={-180} max={180} step={1} onValueChange={setHue} />
          <div className="text-xs font-semibold text-zinc-300">Saturation <span className="ml-auto text-zinc-500">{saturation}</span></div>
          <Slider value={[saturation]} min={-100} max={100} step={1} onValueChange={setSaturation} />
          <div className="text-xs font-semibold text-zinc-300">Lightness <span className="ml-auto text-zinc-500">{lightness}</span></div>
          <Slider value={[lightness]} min={-100} max={100} step={1} onValueChange={setLightness} />
          <Button
            onClick={() => applyAdjustment('Hue/Saturation', (ctx, w, h) => applyHueSaturation(ctx, w, h, hue, saturation, lightness))}
            variant="secondary"
            size="sm"
            className="w-full h-7 text-xs"
          >Apply</Button>
        </div>

        <div className="h-px bg-zinc-800" />

        {/* Blur & Sharpen */}
        <div className="space-y-2">
          <div className="text-xs font-semibold text-zinc-300 flex items-center gap-1.5">
            <Droplets size={12} /> Gaussian Blur
            <span className="ml-auto text-zinc-500">{blurRadius}px</span>
          </div>
          <Slider value={[blurRadius]} min={0} max={30} step={0.5} onValueChange={setBlurRadius} />
          <Button
            onClick={() => applyAdjustment('Gaussian Blur', (ctx, w, h) => applyFastBlur(ctx, w, h, blurRadius))}
            variant="secondary"
            size="sm"
            className="w-full h-7 text-xs"
            disabled={blurRadius <= 0}
          >Apply Blur</Button>
        </div>

        <div className="space-y-2">
          <div className="text-xs font-semibold text-zinc-300 flex items-center gap-1.5">
            <Focus size={12} /> Sharpen
            <span className="ml-auto text-zinc-500">{sharpenAmount.toFixed(1)}</span>
          </div>
          <Slider value={[sharpenAmount * 10]} min={0} max={50} step={1} onValueChange={(v) => setSharpenAmount(v[0] / 10)} />
          <Button
            onClick={() => applyAdjustment('Sharpen', (ctx, w, h) => applySharpen(ctx, w, h, sharpenAmount))}
            variant="secondary"
            size="sm"
            className="w-full h-7 text-xs"
            disabled={sharpenAmount <= 0}
          >Apply Sharpen</Button>
        </div>

        <div className="h-px bg-zinc-800" />

        {/* Quick filters */}
        <div className="space-y-2">
          <div className="text-xs font-semibold text-zinc-300">Quick Filters</div>
          <div className="grid grid-cols-3 gap-1.5">
            {quickFilters.map((f) => (
              <button
                key={f.label}
                onClick={f.action}
                className="flex flex-col items-center gap-1 p-2 rounded border border-zinc-700 bg-zinc-800 hover:bg-zinc-700 hover:border-sky-500 transition-colors"
              >
                {f.icon}
                <span className="text-[10px]">{f.label}</span>
              </button>
            ))}
          </div>
          <Button
            onClick={() => {
              const t = prompt('Threshold level (0-255):', '128');
              if (t === null) return;
              applyAdjustment('Threshold', (ctx, w, h) => applyThreshold(ctx, w, h, parseFloat(t) || 128));
            }}
            variant="secondary"
            size="sm"
            className="w-full h-7 text-xs"
          >Apply Threshold...</Button>
        </div>
      </div>
    </div>
  );
}
