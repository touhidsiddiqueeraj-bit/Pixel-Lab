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
  autoUnblur,
  addNoise,
  medianDenoise,
  applyVignette,
  applyEdgeDetect,
  applyEmboss,
  applyPixelate,
  applyPosterize,
  applyColorTemperature,
  applyCurves,
  applyLevels,
  applyChannelMixer,
  applyHDRToning,
} from '@/lib/image-processing';
import { toast } from 'sonner';
import { useState, useCallback } from 'react';
import { Sparkles, SunMedium, Contrast, Droplets, Palette, CircleOff, Image as ImageIcon, Focus, Scissors, Wand2, Zap, Wind, Aperture, Grid3x3, Layers as LayersIcon, Thermometer, AudioWaveform, LineChart, BarChart3, SplitSquareHorizontal, TrendingUp } from 'lucide-react';
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
  const [bgTolerance, setBgTolerance] = useState(15);

  // Auto unblur state
  const [unblurStrength, setUnblurStrength] = useState(60);
  const [unblurRadius, setUnblurRadius] = useState(1.5);
  const [unblurThreshold, setUnblurThreshold] = useState(2);

  // New filter state
  const [noiseAmount, setNoiseAmount] = useState(15);
  const [denoiseRadius, setDenoiseRadius] = useState(1);
  const [vignetteAmount, setVignetteAmount] = useState(50);
  const [vignetteSize, setVignetteSize] = useState(50);
  const [pixelateSize, setPixelateSize] = useState(8);
  const [posterizeLevels, setPosterizeLevels] = useState(4);
  const [temperature, setTemperature] = useState(0);

  // Pro color tools
  const [levelsBlack, setLevelsBlack] = useState(0);
  const [levelsWhite, setLevelsWhite] = useState(255);
  const [levelsGamma, setLevelsGamma] = useState(1);
  const [curvesMid, setCurvesMid] = useState(128);
  const [hdrStrength, setHdrStrength] = useState(40);
  const [hdrRadius, setHdrRadius] = useState(8);
  const [channelMixR, setChannelMixR] = useState(100);

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

  const handleAutoUnblur = useCallback(() => {
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
    // Use a promise-friendly toast for long operations
    const tid = toast.loading('Deblurring image...');
    setTimeout(() => {
      try {
        autoUnblur(ctx, layer.canvas.width, layer.canvas.height, unblurStrength, unblurRadius, unblurThreshold);
        refreshThumbnail(layer.id);
        pushHistory('Auto Unblur');
        toast.success('Image deblurred', { id: tid });
      } catch (e) {
        toast.error('Failed to deblur image', { id: tid });
      }
    }, 50);
  }, [getActive, unblurStrength, unblurRadius, unblurThreshold, refreshThumbnail, pushHistory]);

  const quickFilters = [
    { label: 'Grayscale', icon: <CircleOff size={14} />, action: () => applyAdjustment('Grayscale', (ctx, w, h) => applyGrayscale(ctx, w, h)) },
    { label: 'Invert', icon: <ImageIcon size={14} />, action: () => applyAdjustment('Invert', (ctx, w, h) => applyInvert(ctx, w, h)) },
    { label: 'Sepia', icon: <Palette size={14} />, action: () => applyAdjustment('Sepia', (ctx, w, h) => applySepia(ctx, w, h)) },
    { label: 'Edge Detect', icon: <Aperture size={14} />, action: () => applyAdjustment('Edge Detect', (ctx, w, h) => applyEdgeDetect(ctx, w, h)) },
    { label: 'Emboss', icon: <LayersIcon size={14} />, action: () => applyAdjustment('Emboss', (ctx, w, h) => applyEmboss(ctx, w, h)) },
    { label: 'Denoise', icon: <Wind size={14} />, action: () => applyAdjustment('Denoise', (ctx, w, h) => medianDenoise(ctx, w, h, denoiseRadius)) },
  ];

  return (
    <div className="flex flex-col h-full editor-surface editor-text overflow-y-auto custom-scroll">
      <div className="px-3 py-2 border-b editor-border text-xs font-semibold uppercase tracking-wide editor-text-muted">
        Adjustments & Filters
      </div>

      <div className="p-3 space-y-4">
        {/* AUTO UNBLUR - prominent AI feature */}
        <div className="space-y-2 p-3 rounded-lg bg-gradient-to-br from-emerald-900/30 to-sky-900/30 border border-emerald-700/40">
          <div className="flex items-center gap-2 text-xs font-bold text-emerald-400">
            <Zap size={14} />
            <span>AI Auto Unblur</span>
            <span className="ml-auto text-[9px] text-emerald-600 font-normal uppercase">Smart Deconvolution</span>
          </div>
          <div className="space-y-1.5">
            <div className="flex items-center justify-between text-xs">
              <Label className="editor-text-muted">Strength</Label>
              <span className="editor-text">{unblurStrength}</span>
            </div>
            <Slider value={[unblurStrength]} min={0} max={100} step={1} onValueChange={(v) => setUnblurStrength(v[0])} />
            <div className="flex items-center justify-between text-xs">
              <Label className="editor-text-muted">Radius</Label>
              <span className="editor-text">{unblurRadius.toFixed(1)}px</span>
            </div>
            <Slider value={[unblurRadius * 10]} min={1} max={50} step={1} onValueChange={(v) => setUnblurRadius(v[0] / 10)} />
            <div className="flex items-center justify-between text-xs">
              <Label className="editor-text-muted">Threshold</Label>
              <span className="editor-text">{unblurThreshold}</span>
            </div>
            <Slider value={[unblurThreshold]} min={0} max={30} step={1} onValueChange={(v) => setUnblurThreshold(v[0])} />
            <Button
              onClick={handleAutoUnblur}
              className="w-full bg-emerald-600 hover:bg-emerald-500 text-white text-xs h-8"
            >
              <Zap size={12} className="mr-1" /> Unblur Image
            </Button>
            <p className="text-[10px] editor-text-dim leading-snug">
              Uses unsharp masking + Sobel edge enhancement to restore sharpness. Best for slightly blurred photos.
            </p>
          </div>
        </div>

        {/* Auto background removal */}
        <div className="space-y-2 p-3 rounded-lg bg-gradient-to-br from-sky-900/30 to-purple-900/30 border border-sky-700/40">
          <div className="flex items-center gap-2 text-xs font-bold editor-accent">
            <Sparkles size={14} />
            <span>AI Auto Background Remove</span>
          </div>
          <div className="space-y-1.5">
            <div className="flex items-center justify-between text-xs">
              <Label className="editor-text-muted flex items-center gap-1"><Scissors size={11} /> Tolerance</Label>
              <span className="editor-text">{bgTolerance}</span>
            </div>
            <Slider value={[bgTolerance]} min={1} max={80} step={1} onValueChange={(v) => setBgTolerance(v[0])} />
            <Button
              onClick={handleAutoBgRemove}
              className="w-full editor-accent-bg hover:editor-accent-bg text-white text-xs h-8"
            >
              <Wand2 size={12} className="mr-1" /> Remove Background
            </Button>
            <p className="text-[10px] editor-text-dim leading-snug">
              Smart edge-detection flood-fill. Best for images with solid or gradient backgrounds.
            </p>
          </div>
        </div>

        <div className="h-px editor-surface-2" />

        {/* Brightness/Contrast */}
        <div className="space-y-2">
          <div className="text-xs font-semibold editor-text flex items-center gap-1.5">
            <SunMedium size={12} /> Brightness
            <span className="ml-auto editor-text-dim">{brightness}</span>
          </div>
          <Slider value={[brightness]} min={-100} max={100} step={1} onValueChange={setBrightness} />
          <div className="text-xs font-semibold editor-text flex items-center gap-1.5">
            <Contrast size={12} /> Contrast
            <span className="ml-auto editor-text-dim">{contrast}</span>
          </div>
          <Slider value={[contrast]} min={-100} max={100} step={1} onValueChange={setContrast} />
          <Button
            onClick={() => applyAdjustment('Brightness/Contrast', (ctx, w, h) => applyBrightnessContrast(ctx, w, h, brightness, contrast))}
            variant="secondary"
            size="sm"
            className="w-full h-7 text-xs"
          >Apply</Button>
        </div>

        <div className="h-px editor-surface-2" />

        {/* Hue/Saturation */}
        <div className="space-y-2">
          <div className="text-xs font-semibold editor-text flex items-center gap-1.5">
            <Palette size={12} /> Hue
            <span className="ml-auto editor-text-dim">{hue}°</span>
          </div>
          <Slider value={[hue]} min={-180} max={180} step={1} onValueChange={setHue} />
          <div className="text-xs font-semibold editor-text">Saturation <span className="ml-auto editor-text-dim">{saturation}</span></div>
          <Slider value={[saturation]} min={-100} max={100} step={1} onValueChange={setSaturation} />
          <div className="text-xs font-semibold editor-text">Lightness <span className="ml-auto editor-text-dim">{lightness}</span></div>
          <Slider value={[lightness]} min={-100} max={100} step={1} onValueChange={setLightness} />
          <Button
            onClick={() => applyAdjustment('Hue/Saturation', (ctx, w, h) => applyHueSaturation(ctx, w, h, hue, saturation, lightness))}
            variant="secondary"
            size="sm"
            className="w-full h-7 text-xs"
          >Apply</Button>
        </div>

        <div className="h-px editor-surface-2" />

        {/* Color Temperature */}
        <div className="space-y-2">
          <div className="text-xs font-semibold editor-text flex items-center gap-1.5">
            <Thermometer size={12} /> Color Temperature
            <span className="ml-auto editor-text-dim">{temperature > 0 ? `+${temperature}` : temperature}</span>
          </div>
          <Slider value={[temperature]} min={-100} max={100} step={1} onValueChange={setTemperature} />
          <Button
            onClick={() => applyAdjustment('Color Temperature', (ctx, w, h) => applyColorTemperature(ctx, w, h, temperature))}
            variant="secondary"
            size="sm"
            className="w-full h-7 text-xs"
          >Apply Temperature</Button>
        </div>

        <div className="h-px editor-surface-2" />

        {/* Blur & Sharpen */}
        <div className="space-y-2">
          <div className="text-xs font-semibold editor-text flex items-center gap-1.5">
            <Droplets size={12} /> Gaussian Blur
            <span className="ml-auto editor-text-dim">{blurRadius}px</span>
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
          <div className="text-xs font-semibold editor-text flex items-center gap-1.5">
            <Focus size={12} /> Sharpen
            <span className="ml-auto editor-text-dim">{sharpenAmount.toFixed(1)}</span>
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

        <div className="h-px editor-surface-2" />

        {/* Vignette */}
        <div className="space-y-2">
          <div className="text-xs font-semibold editor-text flex items-center gap-1.5">
            <Aperture size={12} /> Vignette
            <span className="ml-auto editor-text-dim">{vignetteAmount}</span>
          </div>
          <Slider value={[vignetteAmount]} min={0} max={100} step={1} onValueChange={setVignetteAmount} />
          <div className="text-xs editor-text-muted">Size <span className="ml-auto editor-text-dim">{vignetteSize}</span></div>
          <Slider value={[vignetteSize]} min={0} max={100} step={1} onValueChange={setVignetteSize} />
          <Button
            onClick={() => applyAdjustment('Vignette', (ctx, w, h) => applyVignette(ctx, w, h, vignetteAmount, vignetteSize))}
            variant="secondary"
            size="sm"
            className="w-full h-7 text-xs"
            disabled={vignetteAmount <= 0}
          >Apply Vignette</Button>
        </div>

        <div className="h-px editor-surface-2" />

        {/* Noise */}
        <div className="space-y-2">
          <div className="text-xs font-semibold editor-text flex items-center gap-1.5">
            <AudioWaveform size={12} /> Add Noise (Grain)
            <span className="ml-auto editor-text-dim">{noiseAmount}</span>
          </div>
          <Slider value={[noiseAmount]} min={0} max={100} step={1} onValueChange={setNoiseAmount} />
          <Button
            onClick={() => applyAdjustment('Add Noise', (ctx, w, h) => addNoise(ctx, w, h, noiseAmount))}
            variant="secondary"
            size="sm"
            className="w-full h-7 text-xs"
            disabled={noiseAmount <= 0}
          >Add Noise</Button>
          <div className="text-xs editor-text-muted mt-2">Denoise Radius <span className="ml-auto editor-text-dim">{denoiseRadius}</span></div>
          <Slider value={[denoiseRadius]} min={1} max={3} step={1} onValueChange={setDenoiseRadius} />
          <Button
            onClick={() => applyAdjustment('Denoise', (ctx, w, h) => medianDenoise(ctx, w, h, denoiseRadius))}
            variant="secondary"
            size="sm"
            className="w-full h-7 text-xs"
          >Denoise (Median)</Button>
        </div>

        <div className="h-px editor-surface-2" />

        {/* Pixelate & Posterize */}
        <div className="space-y-2">
          <div className="text-xs font-semibold editor-text flex items-center gap-1.5">
            <Grid3x3 size={12} /> Pixelate
            <span className="ml-auto editor-text-dim">{pixelateSize}px</span>
          </div>
          <Slider value={[pixelateSize]} min={2} max={50} step={1} onValueChange={setPixelateSize} />
          <Button
            onClick={() => applyAdjustment('Pixelate', (ctx, w, h) => applyPixelate(ctx, w, h, pixelateSize))}
            variant="secondary"
            size="sm"
            className="w-full h-7 text-xs"
          >Apply Pixelate</Button>
          <div className="text-xs editor-text-muted mt-2">Posterize Levels <span className="ml-auto editor-text-dim">{posterizeLevels}</span></div>
          <Slider value={[posterizeLevels]} min={2} max={32} step={1} onValueChange={setPosterizeLevels} />
          <Button
            onClick={() => applyAdjustment('Posterize', (ctx, w, h) => applyPosterize(ctx, w, h, posterizeLevels))}
            variant="secondary"
            size="sm"
            className="w-full h-7 text-xs"
          >Apply Posterize</Button>
        </div>

        <div className="h-px editor-surface-2" />

        {/* Quick filters */}
        <div className="space-y-2">
          <div className="text-xs font-semibold editor-text">Quick Filters</div>
          <div className="grid grid-cols-3 gap-1.5">
            {quickFilters.map((f) => (
              <button
                key={f.label}
                onClick={f.action}
                className="flex flex-col items-center gap-1 p-2 rounded border editor-border editor-surface-2 hover:editor-surface-3 hover:editor-accent transition-colors"
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

        <div className="h-px editor-border" />

        {/* Pro Color Tools */}
        <div className="space-y-3">
          <div className="text-xs font-semibold editor-text flex items-center gap-1.5">
            <LineChart size={12} /> Pro Color Tools
          </div>

          {/* Levels */}
          <div className="space-y-2 p-2 rounded editor-surface-2">
            <div className="text-xs font-semibold editor-text flex items-center gap-1.5">
              <BarChart3 size={11} /> Levels
            </div>
            <div className="flex items-center justify-between text-xs">
              <Label className="editor-text-muted">Black</Label>
              <span className="editor-text">{levelsBlack}</span>
            </div>
            <Slider value={[levelsBlack]} min={0} max={254} step={1} onValueChange={setLevelsBlack} />
            <div className="flex items-center justify-between text-xs">
              <Label className="editor-text-muted">White</Label>
              <span className="editor-text">{levelsWhite}</span>
            </div>
            <Slider value={[levelsWhite]} min={1} max={255} step={1} onValueChange={setLevelsWhite} />
            <div className="flex items-center justify-between text-xs">
              <Label className="editor-text-muted">Gamma</Label>
              <span className="editor-text">{levelsGamma.toFixed(2)}</span>
            </div>
            <Slider value={[levelsGamma * 100]} min={10} max={1000} step={1} onValueChange={(v) => setLevelsGamma(v[0] / 100)} />
            <Button
              onClick={() => applyAdjustment('Levels', (ctx, w, h) => applyLevels(ctx, w, h, levelsBlack, levelsWhite, levelsGamma))}
              variant="secondary"
              size="sm"
              className="w-full h-7 text-xs"
            >Apply Levels</Button>
          </div>

          {/* Curves (simplified: S-curve with single mid-point) */}
          <div className="space-y-2 p-2 rounded editor-surface-2">
            <div className="text-xs font-semibold editor-text flex items-center gap-1.5">
              <LineChart size={11} /> Curves (S-Curve)
            </div>
            <div className="flex items-center justify-between text-xs">
              <Label className="editor-text-muted">Mid point</Label>
              <span className="editor-text">{curvesMid}</span>
            </div>
            <Slider value={[curvesMid]} min={32} max={224} step={1} onValueChange={setCurvesMid} />
            <Button
              onClick={() => applyAdjustment('Curves', (ctx, w, h) => applyCurves(ctx, w, h, [
                { x: 0, y: 0 },
                { x: curvesMid - 32, y: Math.max(0, curvesMid - 48) },
                { x: curvesMid + 32, y: Math.min(255, curvesMid + 48) },
                { x: 255, y: 255 },
              ]))}
              variant="secondary"
              size="sm"
              className="w-full h-7 text-xs"
            >Apply Curves</Button>
          </div>

          {/* Channel Mixer */}
          <div className="space-y-2 p-2 rounded editor-surface-2">
            <div className="text-xs font-semibold editor-text flex items-center gap-1.5">
              <SplitSquareHorizontal size={11} /> Channel Mixer
            </div>
            <div className="flex items-center justify-between text-xs">
              <Label className="editor-text-muted">Red ← Red %</Label>
              <span className="editor-text">{channelMixR}</span>
            </div>
            <Slider value={[channelMixR]} min={0} max={200} step={1} onValueChange={setChannelMixR} />
            <Button
              onClick={() => applyAdjustment('Channel Mixer', (ctx, w, h) => applyChannelMixer(ctx, w, h, {
                rOut: { r: channelMixR, g: 0, b: 0 },
                gOut: { r: (100 - channelMixR) / 2, g: 100, b: 0 },
                bOut: { r: (100 - channelMixR) / 2, g: 0, b: 100 },
              }))}
              variant="secondary"
              size="sm"
              className="w-full h-7 text-xs"
            >Apply Channel Mixer</Button>
          </div>

          {/* HDR Toning */}
          <div className="space-y-2 p-2 rounded editor-surface-2">
            <div className="text-xs font-semibold editor-text flex items-center gap-1.5">
              <TrendingUp size={11} /> HDR Toning
            </div>
            <div className="flex items-center justify-between text-xs">
              <Label className="editor-text-muted">Strength</Label>
              <span className="editor-text">{hdrStrength}</span>
            </div>
            <Slider value={[hdrStrength]} min={0} max={100} step={1} onValueChange={setHdrStrength} />
            <div className="flex items-center justify-between text-xs">
              <Label className="editor-text-muted">Radius</Label>
              <span className="editor-text">{hdrRadius}px</span>
            </div>
            <Slider value={[hdrRadius]} min={1} max={20} step={1} onValueChange={setHdrRadius} />
            <Button
              onClick={() => applyAdjustment('HDR Toning', (ctx, w, h) => applyHDRToning(ctx, w, h, hdrStrength, hdrRadius))}
              variant="secondary"
              size="sm"
              className="w-full h-7 text-xs"
              disabled={hdrStrength <= 0}
            >Apply HDR Toning</Button>
          </div>
        </div>
      </div>
    </div>
  );
}
