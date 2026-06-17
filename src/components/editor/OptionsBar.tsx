'use client';

import { useEditorStore } from '@/lib/editor-store';
import { Slider } from '@/components/ui/slider';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Brush, Pipette, Eraser, Type, Square, Hand, ZoomIn, MousePointer2, Lasso, Wand2, Crop } from 'lucide-react';
import { TOOL_PRESETS } from './tool-presets';

const FONTS = [
  'Inter, sans-serif',
  'Georgia, serif',
  '"Times New Roman", serif',
  'Arial, sans-serif',
  '"Courier New", monospace',
  'Verdana, sans-serif',
  'Impact, sans-serif',
  'Comic Sans MS, cursive',
];

export function OptionsBar() {
  const activeTool = useEditorStore((s) => s.activeTool);
  const opts = useEditorStore((s) => s.toolOptions);
  const setOpts = useEditorStore((s) => s.setToolOptions);
  const setZoom = useEditorStore((s) => s.setZoom);
  const zoom = useEditorStore((s) => s.zoom);

  const preset = TOOL_PRESETS[activeTool];

  return (
    <div className="flex items-center gap-4 px-3 h-10 bg-zinc-850 border-b border-zinc-800 text-zinc-200 text-xs overflow-x-auto">
      <div className="flex items-center gap-2 shrink-0">
        <span className="text-sky-400">{preset?.icon}</span>
        <span className="font-medium">{preset?.label ?? 'Tool'}</span>
      </div>

      <div className="w-px h-6 bg-zinc-700 shrink-0" />

      {/* Brush size */}
      {(activeTool === 'brush' || activeTool === 'pencil' || activeTool === 'eraser') && (
        <div className="flex items-center gap-2 shrink-0">
          <Label className="text-zinc-400 w-14">Size</Label>
          <Slider
            value={[opts.brushSize]}
            min={1}
            max={500}
            step={1}
            onValueChange={(v) => setOpts({ brushSize: v[0] })}
            className="w-28"
          />
          <Input
            type="number"
            value={opts.brushSize}
            min={1}
            max={500}
            onChange={(e) => setOpts({ brushSize: Math.max(1, Math.min(500, parseInt(e.target.value) || 1)) })}
            className="w-14 h-7 bg-zinc-800 border-zinc-700"
          />
          <span className="text-zinc-500">px</span>
        </div>
      )}

      {/* Brush hardness */}
      {(activeTool === 'brush' || activeTool === 'eraser') && (
        <div className="flex items-center gap-2 shrink-0">
          <Label className="text-zinc-400 w-14">Hardness</Label>
          <Slider
            value={[opts.brushHardness]}
            min={0}
            max={100}
            step={1}
            onValueChange={(v) => setOpts({ brushHardness: v[0] })}
            className="w-24"
          />
          <span className="w-8">{opts.brushHardness}%</span>
        </div>
      )}

      {/* Brush opacity */}
      {(activeTool === 'brush' || activeTool === 'pencil' || activeTool === 'eraser') && (
        <div className="flex items-center gap-2 shrink-0">
          <Label className="text-zinc-400 w-14">Opacity</Label>
          <Slider
            value={[opts.brushOpacity]}
            min={1}
            max={100}
            step={1}
            onValueChange={(v) => setOpts({ brushOpacity: v[0] })}
            className="w-24"
          />
          <span className="w-8">{opts.brushOpacity}%</span>
        </div>
      )}

      {/* Tolerance for magic wand & bucket */}
      {(activeTool === 'magic-wand' || activeTool === 'bucket') && (
        <div className="flex items-center gap-2 shrink-0">
          <Label className="text-zinc-400 w-14">Tolerance</Label>
          <Slider
            value={[opts.tolerance]}
            min={0}
            max={100}
            step={1}
            onValueChange={(v) => setOpts({ tolerance: v[0] })}
            className="w-24"
          />
          <span className="w-8">{opts.tolerance}</span>
        </div>
      )}

      {/* Text options */}
      {activeTool === 'text' && (
        <>
          <div className="flex items-center gap-2 shrink-0">
            <Label className="text-zinc-400">Font</Label>
            <Select value={opts.fontFamily} onValueChange={(v) => setOpts({ fontFamily: v })}>
              <SelectTrigger className="w-44 h-7 bg-zinc-800 border-zinc-700">
                <SelectValue />
              </SelectTrigger>
              <SelectContent className="bg-zinc-900 border-zinc-700">
                {FONTS.map((f) => (
                  <SelectItem key={f} value={f} className="hover:bg-sky-600 hover:text-white">
                    <span style={{ fontFamily: f }}>{f.replace(/["']/g, '').split(',')[0]}</span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <Label className="text-zinc-400">Size</Label>
            <Input
              type="number"
              value={opts.fontSize}
              min={8}
              max={400}
              onChange={(e) => setOpts({ fontSize: Math.max(8, Math.min(400, parseInt(e.target.value) || 48)) })}
              className="w-16 h-7 bg-zinc-800 border-zinc-700"
            />
            <span className="text-zinc-500">px</span>
          </div>
        </>
      )}

      {/* Shape options */}
      {(activeTool === 'shape-rect' || activeTool === 'shape-ellipse' || activeTool === 'shape-line') && (
        <>
          <div className="flex items-center gap-2 shrink-0">
            <Label className="text-zinc-400">Fill</Label>
            <Switch checked={opts.shapeFilled} onCheckedChange={(v) => setOpts({ shapeFilled: v })} />
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <Label className="text-zinc-400">Stroke</Label>
            <Slider
              value={[opts.shapeStrokeWidth]}
              min={0}
              max={50}
              step={1}
              onValueChange={(v) => setOpts({ shapeStrokeWidth: v[0] })}
              className="w-24"
            />
            <span className="w-8">{opts.shapeStrokeWidth}px</span>
          </div>
        </>
      )}

      {/* Zoom controls */}
      <div className="ml-auto flex items-center gap-2 shrink-0">
        <button
          onClick={() => setZoom(zoom / 1.25)}
          className="px-2 h-7 rounded hover:bg-zinc-800 border border-zinc-700"
          title="Zoom out"
        >−</button>
        <input
          type="number"
          value={Math.round(zoom * 100)}
          min={1}
          max={3200}
          onChange={(e) => setZoom(Math.max(0.01, parseInt(e.target.value) || 100) / 100)}
          className="w-16 h-7 bg-zinc-800 border border-zinc-700 rounded text-center"
        />
        <span className="text-zinc-400">%</span>
        <button
          onClick={() => setZoom(zoom * 1.25)}
          className="px-2 h-7 rounded hover:bg-zinc-800 border border-zinc-700"
          title="Zoom in"
        >+</button>
        <button
          onClick={() => setZoom(1)}
          className="px-2 h-7 rounded hover:bg-zinc-800 border border-zinc-700 text-xs"
          title="100%"
        >1:1</button>
      </div>
    </div>
  );
}

// Tool presets for icon and label
export { TOOL_PRESETS };
