'use client';

import { useEditorStore } from '@/lib/editor-store';
import { useEffect, useRef, useState } from 'react';
import { Brush, Save, Trash2, Map, Crosshair } from 'lucide-react';
import { Slider } from '@/components/ui/slider';
import { Label } from '@/components/ui/label';
import { toast } from 'sonner';

const DEFAULT_BRUSH_PRESETS = [
  { name: 'Soft Round', size: 30, hardness: 80, opacity: 100 },
  { name: 'Hard Round', size: 20, hardness: 100, opacity: 100 },
  { name: 'Pencil', size: 3, hardness: 100, opacity: 100 },
  { name: 'Airbrush', size: 60, hardness: 0, opacity: 40 },
  { name: 'Marker', size: 40, hardness: 60, opacity: 80 },
  { name: 'Calligraphy', size: 25, hardness: 90, opacity: 100 },
  { name: 'Spatter', size: 50, hardness: 20, opacity: 70 },
  { name: 'Cloud', size: 80, hardness: 0, opacity: 30 },
];

interface BrushPreset {
  name: string;
  size: number;
  hardness: number;
  opacity: number;
}

export function NavigatorPanel() {
  const layers = useEditorStore((s) => s.layers);
  const docWidth = useEditorStore((s) => s.docWidth);
  const docHeight = useEditorStore((s) => s.docHeight);
  const zoom = useEditorStore((s) => s.zoom);
  const panX = useEditorStore((s) => s.panX);
  const panY = useEditorStore((s) => s.panY);
  const setZoom = useEditorStore((s) => s.setZoom);
  const setPan = useEditorStore((s) => s.setPan);
  const toolOptions = useEditorStore((s) => s.toolOptions);
  const setToolOptions = useEditorStore((s) => s.setToolOptions);

  const previewRef = useRef<HTMLCanvasElement>(null);
  const [customPresets, setCustomPresets] = useState<BrushPreset[]>([]);
  const [, setTick] = useState(0);

  // Load custom presets
  useEffect(() => {
    const load = () => {
      try {
        setCustomPresets(JSON.parse(localStorage.getItem('brush-presets') || '[]'));
      } catch {
        setCustomPresets([]);
      }
    };
    load();
    window.addEventListener('brush-presets-changed', load);
    return () => window.removeEventListener('brush-presets-changed', load);
  }, []);

  // Draw navigator preview
  useEffect(() => {
    const canvas = previewRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d')!;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    for (const layer of layers) {
      if (!layer.visible) continue;
      ctx.save();
      ctx.globalAlpha = layer.opacity;
      ctx.globalCompositeOperation = layer.blendMode as GlobalCompositeOperation;
      if (layer.maskCanvas && layer.maskEnabled) {
        const tmp = document.createElement('canvas');
        tmp.width = docWidth; tmp.height = docHeight;
        const tctx = tmp.getContext('2d')!;
        tctx.drawImage(layer.canvas, 0, 0);
        tctx.globalCompositeOperation = 'destination-in';
        tctx.drawImage(layer.maskCanvas, 0, 0);
        ctx.drawImage(tmp, 0, 0, canvas.width, canvas.height);
      } else {
        ctx.drawImage(layer.canvas, 0, 0, canvas.width, canvas.height);
      }
      ctx.restore();
    }
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setTick((t) => t + 1);
  }, [layers, docWidth, docHeight]);

  const aspectRatio = docWidth / docHeight;
  const previewW = 200;
  const previewH = Math.round(previewW / aspectRatio);

  const handleSaveBrush = () => {
    const name = prompt('Brush preset name:', 'My Brush');
    if (!name) return;
    try {
      const presets = JSON.parse(localStorage.getItem('brush-presets') || '[]');
      presets.push({
        name,
        size: toolOptions.brushSize,
        hardness: toolOptions.brushHardness,
        opacity: toolOptions.brushOpacity,
      });
      localStorage.setItem('brush-presets', JSON.stringify(presets));
      toast.success(`Brush "${name}" saved`);
      window.dispatchEvent(new Event('brush-presets-changed'));
    } catch {
      toast.error('Failed to save brush');
    }
  };

  const handleLoadBrush = (preset: BrushPreset) => {
    setToolOptions({
      brushSize: preset.size,
      brushHardness: preset.hardness,
      brushOpacity: preset.opacity,
    });
    toast.success(`Brush "${preset.name}" loaded`);
  };

  const handleDeleteCustomPresets = () => {
    if (confirm('Delete all custom brush presets?')) {
      localStorage.removeItem('brush-presets');
      window.dispatchEvent(new Event('brush-presets-changed'));
      toast.success('Custom presets cleared');
    }
  };

  return (
    <div className="flex flex-col h-full editor-surface editor-text overflow-y-auto custom-scroll">
      <div className="px-3 py-2 border-b editor-border text-xs font-semibold uppercase tracking-wide editor-text-muted">
        Navigator & Brushes
      </div>

      <div className="p-3 space-y-4">
        {/* Navigator */}
        <div className="space-y-2">
          <div className="text-xs font-semibold editor-text flex items-center gap-1.5">
            <Map size={12} /> Navigator
          </div>
          <div className="relative w-full editor-surface-2 rounded border editor-border overflow-hidden flex items-center justify-center" style={{ minHeight: previewH }}>
            <canvas
              ref={previewRef}
              width={previewW}
              height={previewH}
              className="max-w-full"
              style={{ imageRendering: 'auto' }}
              onClick={(e) => {
                const rect = e.currentTarget.getBoundingClientRect();
                const x = (e.clientX - rect.left) / rect.width;
                const y = (e.clientY - rect.top) / rect.height;
                const canvasX = x * docWidth;
                const canvasY = y * docHeight;
                setPan(-canvasX * zoom + (window.innerWidth - 60) / 2, -canvasY * zoom + (window.innerHeight - 200) / 2);
              }}
            />
          </div>
          <div className="flex items-center gap-2">
            <Crosshair size={10} className="editor-text-dim" />
            <span className="text-[10px] editor-text-dim">Click preview to recenter</span>
          </div>
          <div className="flex items-center gap-2">
            <Label className="editor-text-muted text-xs w-12">Zoom</Label>
            <Slider
              value={[Math.round(zoom * 100)]}
              min={1}
              max={800}
              step={1}
              onValueChange={(v) => setZoom(v[0] / 100)}
              className="flex-1"
            />
            <span className="text-xs editor-text w-12">{Math.round(zoom * 100)}%</span>
          </div>
          <div className="text-[10px] editor-text-dim">
            {docWidth} × {docHeight}px · Pan: {Math.round(panX)}, {Math.round(panY)}
          </div>
        </div>

        <div className="h-px editor-border" />

        {/* Brush Presets */}
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <div className="text-xs font-semibold editor-text flex items-center gap-1.5">
              <Brush size={12} /> Brush Presets
            </div>
            <div className="flex gap-1">
              <button
                onClick={handleSaveBrush}
                className="p-1 rounded hover:editor-surface-2 editor-text-muted"
                title="Save current brush"
              >
                <Save size={12} />
              </button>
              <button
                onClick={handleDeleteCustomPresets}
                className="p-1 rounded hover:editor-surface-2 editor-text-muted"
                title="Clear custom presets"
              >
                <Trash2 size={12} />
              </button>
            </div>
          </div>

          <div className="text-[10px] editor-text-dim uppercase">Default</div>
          <div className="grid grid-cols-2 gap-1">
            {DEFAULT_BRUSH_PRESETS.map((preset) => (
              <button
                key={preset.name}
                onClick={() => handleLoadBrush(preset)}
                className="flex items-center gap-1.5 p-1.5 rounded border editor-border editor-surface-2 hover:editor-surface-3 transition-colors text-left"
                title={`${preset.name} - Size ${preset.size}, Hardness ${preset.hardness}%`}
              >
                <BrushPreview size={preset.size} hardness={preset.hardness} />
                <div className="flex-1 min-w-0">
                  <div className="text-[10px] editor-text truncate">{preset.name}</div>
                  <div className="text-[9px] editor-text-dim">{preset.size}px</div>
                </div>
              </button>
            ))}
          </div>

          {customPresets.length > 0 && (
            <>
              <div className="text-[10px] editor-text-dim uppercase pt-1">Custom</div>
              <div className="grid grid-cols-2 gap-1">
                {customPresets.map((preset, i) => (
                  <button
                    key={i}
                    onClick={() => handleLoadBrush(preset)}
                    className="flex items-center gap-1.5 p-1.5 rounded border editor-border editor-surface-2 hover:editor-surface-3 transition-colors text-left"
                  >
                    <BrushPreview size={preset.size} hardness={preset.hardness} />
                    <div className="flex-1 min-w-0">
                      <div className="text-[10px] editor-text truncate">{preset.name}</div>
                      <div className="text-[9px] editor-text-dim">{preset.size}px</div>
                    </div>
                  </button>
                ))}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function BrushPreview({ size, hardness }: { size: number; hardness: number }) {
  const visualSize = Math.min(16, Math.max(6, size / 4));
  return (
    <div
      className="rounded-full shrink-0"
      style={{
        width: visualSize,
        height: visualSize,
        background: `radial-gradient(circle, #000 0%, #000 ${hardness}%, transparent 100%)`,
      }}
    />
  );
}
