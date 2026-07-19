'use client';

import { useEditorStore } from '@/lib/editor-store';
import {
  applyHighlightsShadows,
  applyWhitesBlacks,
  applyClarity,
  applyDehaze,
  applyTexture,
  applyVibrance,
  applySaturation,
  applySplitToning,
  applyGrain,
  applyLensVignette,
  applySharpening,
  applyLuminanceNR,
  applyColorNR,
  applyHSL,
  applyBrightnessContrast,
} from '@/lib/image-processing';
import { toast } from 'sonner';
import { useState, useCallback, useRef } from 'react';
import { Slider } from '@/components/ui/slider';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import {
  Sun,
  Contrast,
  Sparkles,
  Droplets,
  Palette,
  Aperture,
  Focus,
  Waves,
  Scissors,
  RotateCcw,
} from 'lucide-react';

type AdjustSection = 'light' | 'color' | 'effects' | 'detail' | 'split' | 'hsl';

export function DevelopPanel() {
  const layers = useEditorStore((s) => s.layers);
  const activeLayerId = useEditorStore((s) => s.activeLayerId);
  const refreshThumbnail = useEditorStore((s) => s.refreshThumbnail);
  const pushHistory = useEditorStore((s) => s.pushHistory);
  const getActive = useCallback(() => layers.find((l) => l.id === activeLayerId) ?? null, [layers, activeLayerId]);

  // Light section
  const [exposure, setExposure] = useState(0);
  const [contrast, setContrast] = useState(0);
  const [highlights, setHighlights] = useState(0);
  const [shadows, setShadows] = useState(0);
  const [whites, setWhites] = useState(0);
  const [blacks, setBlacks] = useState(0);

  // Presence
  const [clarity, setClarity] = useState(0);
  const [dehaze, setDehaze] = useState(0);
  const [texture, setTexture] = useState(0);

  // Color
  const [vibrance, setVibrance] = useState(0);
  const [saturation, setSaturation] = useState(0);

  // Effects
  const [grainAmount, setGrainAmount] = useState(0);
  const [grainSize, setGrainSize] = useState(25);
  const [vignetteAmount, setVignetteAmount] = useState(0);
  const [vignetteMidpoint, setVignetteMidpoint] = useState(50);

  // Detail
  const [sharpenAmount, setSharpenAmount] = useState(0);
  const [sharpenRadius, setSharpenRadius] = useState(1);
  const [lumNR, setLumNR] = useState(0);
  const [colorNR, setColorNR] = useState(0);

  // Split Toning
  const [highlightHue, setHighlightHue] = useState(30);
  const [highlightSat, setHighlightSat] = useState(0);
  const [shadowHue, setShadowHue] = useState(220);
  const [shadowSat, setShadowSat] = useState(0);
  const [balance, setBalance] = useState(0);

  const [activeSection, setActiveSection] = useState<AdjustSection>('light');
  const previewRef = useRef(false);

  const applyDevelop = useCallback((label: string, fn: (ctx: CanvasRenderingContext2D, w: number, h: number) => void) => {
    const layer = getActive();
    if (!layer) { toast.error('No active layer'); return; }
    if (layer.locked) { toast.error('Layer is locked'); return; }
    const ctx = layer.canvas.getContext('2d')!;
    fn(ctx, layer.canvas.width, layer.canvas.height);
    refreshThumbnail(layer.id);
    pushHistory(label);
  }, [getActive, refreshThumbnail, pushHistory]);

  const resetAll = () => {
    setExposure(0); setContrast(0); setHighlights(0); setShadows(0);
    setWhites(0); setBlacks(0); setClarity(0); setDehaze(0); setTexture(0);
    setVibrance(0); setSaturation(0);
    setGrainAmount(0); setVignetteAmount(0);
    setSharpenAmount(0); setLumNR(0); setColorNR(0);
    setHighlightSat(0); setShadowSat(0);
  };

  const sections: { id: AdjustSection; label: string; icon: React.ReactNode }[] = [
    { id: 'light', label: 'Light', icon: <Sun size={11} /> },
    { id: 'color', label: 'Color', icon: <Palette size={11} /> },
    { id: 'effects', label: 'Effects', icon: <Sparkles size={11} /> },
    { id: 'detail', label: 'Detail', icon: <Focus size={11} /> },
    { id: 'split', label: 'Split', icon: <Droplets size={11} /> },
  ];

  const sliderRow = (label: string, value: number, min: number, max: number, setter: (v: number) => void, step = 1) => (
    <div className="space-y-1">
      <div className="flex items-center justify-between text-xs">
        <span className="editor-text-muted">{label}</span>
        <span className="editor-text font-mono w-10 text-right">{value > 0 ? '+' : ''}{value}</span>
      </div>
      <Slider value={[value]} min={min} max={max} step={step} onValueChange={(v) => setter(v[0])} />
    </div>
  );

  return (
    <div className="flex flex-col h-full editor-surface editor-text overflow-y-auto custom-scroll">
      <div className="px-3 py-2 border-b editor-border flex items-center justify-between">
        <span className="text-xs font-semibold uppercase tracking-wide editor-text-muted">Develop (Lightroom)</span>
        <Button variant="ghost" size="sm" onClick={resetAll} className="h-6 px-2 text-[10px] editor-text-dim hover:editor-surface-3">
          <RotateCcw size={10} className="mr-1" /> Reset
        </Button>
      </div>

      {/* Section tabs */}
      <div className="flex gap-1 p-2 border-b editor-border overflow-x-auto custom-scroll">
        {sections.map(s => (
          <button
            key={s.id}
            onClick={() => setActiveSection(s.id)}
            className={`flex items-center gap-1 px-2 py-1 rounded text-[10px] shrink-0 transition-colors ${
              activeSection === s.id ? 'editor-accent-bg text-white' : 'editor-surface-2 editor-text-muted hover:editor-surface-3'
            }`}
          >
            {s.icon} {s.label}
          </button>
        ))}
      </div>

      <div className="p-3 space-y-3">
        {activeSection === 'light' && (
          <>
            <div className="text-xs font-semibold editor-text flex items-center gap-1.5"><Sun size={12} /> Tone</div>
            {sliderRow('Exposure', exposure, -100, 100, setExposure)}
            {sliderRow('Contrast', contrast, -100, 100, setContrast)}
            {sliderRow('Highlights', highlights, -100, 100, setHighlights)}
            {sliderRow('Shadows', shadows, -100, 100, setShadows)}
            {sliderRow('Whites', whites, -100, 100, setWhites)}
            {sliderRow('Blacks', blacks, -100, 100, setBlacks)}
            <Button onClick={() => applyDevelop('Light: Tone', (ctx, w, h) => {
              applyBrightnessContrast(ctx, w, h, exposure, contrast);
              applyHighlightsShadows(ctx, w, h, highlights, shadows);
              applyWhitesBlacks(ctx, w, h, whites, blacks);
            })} className="w-full h-7 text-xs bg-sky-600 hover:bg-sky-500 text-white">Apply Tone</Button>

            <div className="h-px editor-border" />
            <div className="text-xs font-semibold editor-text flex items-center gap-1.5"><Sparkles size={12} /> Presence</div>
            {sliderRow('Clarity', clarity, -100, 100, setClarity)}
            {sliderRow('Dehaze', dehaze, -100, 100, setDehaze)}
            {sliderRow('Texture', texture, -100, 100, setTexture)}
            <Button onClick={() => applyDevelop('Light: Presence', (ctx, w, h) => {
              if (clarity !== 0) applyClarity(ctx, w, h, clarity);
              if (dehaze !== 0) applyDehaze(ctx, w, h, dehaze);
              if (texture !== 0) applyTexture(ctx, w, h, texture);
            })} className="w-full h-7 text-xs bg-sky-600 hover:bg-sky-500 text-white">Apply Presence</Button>
          </>
        )}

        {activeSection === 'color' && (
          <>
            <div className="text-xs font-semibold editor-text flex items-center gap-1.5"><Palette size={12} /> Color</div>
            {sliderRow('Vibrance', vibrance, -100, 100, setVibrance)}
            {sliderRow('Saturation', saturation, -100, 100, setSaturation)}
            <Button onClick={() => applyDevelop('Color', (ctx, w, h) => {
              if (vibrance !== 0) applyVibrance(ctx, w, h, vibrance);
              if (saturation !== 0) applySaturation(ctx, w, h, saturation);
            })} className="w-full h-7 text-xs bg-sky-600 hover:bg-sky-500 text-white">Apply Color</Button>
          </>
        )}

        {activeSection === 'effects' && (
          <>
            <div className="text-xs font-semibold editor-text flex items-center gap-1.5"><Aperture size={12} /> Effects</div>
            {sliderRow('Grain Amount', grainAmount, 0, 100, setGrainAmount)}
            {sliderRow('Grain Size', grainSize, 1, 100, setGrainSize)}
            {sliderRow('Vignette', vignetteAmount, -100, 100, setVignetteAmount)}
            {sliderRow('Vignette Midpoint', vignetteMidpoint, 0, 100, setVignetteMidpoint)}
            <Button onClick={() => applyDevelop('Effects', (ctx, w, h) => {
              if (grainAmount > 0) applyGrain(ctx, w, h, grainAmount, grainSize);
              if (vignetteAmount !== 0) applyLensVignette(ctx, w, h, vignetteAmount, vignetteMidpoint, 50, 50);
            })} className="w-full h-7 text-xs bg-sky-600 hover:bg-sky-500 text-white">Apply Effects</Button>
          </>
        )}

        {activeSection === 'detail' && (
          <>
            <div className="text-xs font-semibold editor-text flex items-center gap-1.5"><Focus size={12} /> Sharpening</div>
            {sliderRow('Amount', sharpenAmount, 0, 150, setSharpenAmount)}
            {sliderRow('Radius', sharpenRadius, 1, 3, setSharpenRadius, 0.1)}
            <Button onClick={() => applyDevelop('Sharpening', (ctx, w, h) => {
              if (sharpenAmount > 0) applySharpening(ctx, w, h, sharpenAmount, sharpenRadius, 25);
            })} variant="secondary" size="sm" className="w-full h-7 text-xs">Apply Sharpening</Button>

            <div className="h-px editor-border" />
            <div className="text-xs font-semibold editor-text flex items-center gap-1.5"><Waves size={12} /> Noise Reduction</div>
            {sliderRow('Luminance NR', lumNR, 0, 100, setLumNR)}
            {sliderRow('Color NR', colorNR, 0, 100, setColorNR)}
            <Button onClick={() => applyDevelop('Noise Reduction', (ctx, w, h) => {
              if (lumNR > 0) applyLuminanceNR(ctx, w, h, lumNR, 50);
              if (colorNR > 0) applyColorNR(ctx, w, h, colorNR);
            })} className="w-full h-7 text-xs bg-sky-600 hover:bg-sky-500 text-white">Apply NR</Button>
          </>
        )}

        {activeSection === 'split' && (
          <>
            <div className="text-xs font-semibold editor-text flex items-center gap-1.5"><Droplets size={12} /> Split Toning</div>
            <div className="text-[10px] editor-text-dim uppercase mt-1">Highlights</div>
            {sliderRow('Hue', highlightHue, 0, 360, setHighlightHue)}
            {sliderRow('Saturation', highlightSat, 0, 100, setHighlightSat)}
            <div className="text-[10px] editor-text-dim uppercase mt-2">Shadows</div>
            {sliderRow('Hue', shadowHue, 0, 360, setShadowHue)}
            {sliderRow('Saturation', shadowSat, 0, 100, setShadowSat)}
            {sliderRow('Balance', balance, -100, 100, setBalance)}
            <Button onClick={() => applyDevelop('Split Toning', (ctx, w, h) => {
              applySplitToning(ctx, w, h, highlightHue, highlightSat, shadowHue, shadowSat, balance);
            })} className="w-full h-7 text-xs bg-sky-600 hover:bg-sky-500 text-white">Apply Split Toning</Button>
          </>
        )}
      </div>
    </div>
  );
}
