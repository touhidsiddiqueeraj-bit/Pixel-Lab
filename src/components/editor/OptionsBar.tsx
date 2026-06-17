'use client';

import { useEditorStore } from '@/lib/editor-store';
import { Slider } from '@/components/ui/slider';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Crosshair } from 'lucide-react';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { TOOL_PRESETS } from './tool-presets';
import { cn } from '@/lib/utils';

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
  const settingSource = useEditorStore((s) => s.settingSource);
  const setSettingSource = useEditorStore((s) => s.setSettingSource);
  const zoom = useEditorStore((s) => s.zoom);

  const preset = TOOL_PRESETS[activeTool];

  return (
    <div className="flex items-center gap-3 sm:gap-4 px-2 sm:px-3 h-10 editor-surface-2 border-b editor-border editor-text text-xs overflow-x-auto custom-scroll">
      <div className="flex items-center gap-2 shrink-0">
        <span className="editor-accent">{preset?.icon}</span>
        <span className="font-medium hidden sm:inline">{preset?.label ?? 'Tool'}</span>
      </div>

      <div className="w-px h-6 editor-border shrink-0" />

      {/* Set Source button for Clone Stamp & Healing Brush (mobile-friendly) */}
      {(activeTool === 'clone-stamp' || activeTool === 'heal-brush') && (
        <div className="flex items-center gap-2 shrink-0">
          <Button
            onClick={() => setSettingSource(!settingSource)}
            className={cn(
              'h-7 px-2 text-xs gap-1',
              settingSource
                ? 'bg-amber-600 hover:bg-amber-500 text-white'
                : 'editor-surface-2 editor-border editor-text hover:editor-surface-3',
            )}
            title="Click to set clone/heal source point"
          >
            <Crosshair size={12} />
            <span className="hidden sm:inline">{settingSource ? 'Click canvas to set source...' : 'Set Source'}</span>
            <span className="sm:hidden">{settingSource ? 'Set...' : 'Source'}</span>
          </Button>
          <span className="text-[10px] editor-text-dim hidden md:inline">or Alt+Click</span>
        </div>
      )}

      {/* Brush size */}
      {(activeTool === 'brush' || activeTool === 'pencil' || activeTool === 'eraser') && (
        <div className="flex items-center gap-2 shrink-0">
          <Label className="editor-text-muted w-12 sm:w-14">Size</Label>
          <Slider
            value={[opts.brushSize]}
            min={1}
            max={500}
            step={1}
            onValueChange={(v) => setOpts({ brushSize: v[0] })}
            className="w-20 sm:w-28"
          />
          <Input
            type="number"
            value={opts.brushSize}
            min={1}
            max={500}
            onChange={(e) => setOpts({ brushSize: Math.max(1, Math.min(500, parseInt(e.target.value) || 1)) })}
            className="w-14 h-7 editor-surface editor-border"
          />
          <span className="editor-text-dim">px</span>
        </div>
      )}

      {/* Brush hardness */}
      {(activeTool === 'brush' || activeTool === 'eraser') && (
        <div className="flex items-center gap-2 shrink-0">
          <Label className="editor-text-muted w-12 sm:w-14">Hardness</Label>
          <Slider
            value={[opts.brushHardness]}
            min={0}
            max={100}
            step={1}
            onValueChange={(v) => setOpts({ brushHardness: v[0] })}
            className="w-16 sm:w-24"
          />
          <span className="w-8">{opts.brushHardness}%</span>
        </div>
      )}

      {/* Brush opacity */}
      {(activeTool === 'brush' || activeTool === 'pencil' || activeTool === 'eraser') && (
        <div className="flex items-center gap-2 shrink-0">
          <Label className="editor-text-muted w-12 sm:w-14">Opacity</Label>
          <Slider
            value={[opts.brushOpacity]}
            min={1}
            max={100}
            step={1}
            onValueChange={(v) => setOpts({ brushOpacity: v[0] })}
            className="w-16 sm:w-24"
          />
          <span className="w-8">{opts.brushOpacity}%</span>
        </div>
      )}

      {/* Tolerance for magic wand & bucket */}
      {(activeTool === 'magic-wand' || activeTool === 'bucket') && (
        <div className="flex items-center gap-2 shrink-0">
          <Label className="editor-text-muted w-12 sm:w-14">Tolerance</Label>
          <Slider
            value={[opts.tolerance]}
            min={0}
            max={100}
            step={1}
            onValueChange={(v) => setOpts({ tolerance: v[0] })}
            className="w-16 sm:w-24"
          />
          <span className="w-8">{opts.tolerance}</span>
        </div>
      )}

      {/* Text options */}
      {activeTool === 'text' && (
        <>
          <div className="flex items-center gap-2 shrink-0">
            <Label className="editor-text-muted">Font</Label>
            <Select value={opts.fontFamily} onValueChange={(v) => setOpts({ fontFamily: v })}>
              <SelectTrigger className="w-32 sm:w-44 h-7 editor-surface editor-border">
                <SelectValue />
              </SelectTrigger>
              <SelectContent className="editor-surface editor-border">
                {FONTS.map((f) => (
                  <SelectItem key={f} value={f} className="hover:editor-accent-bg hover:text-white">
                    <span style={{ fontFamily: f }}>{f.replace(/["']/g, '').split(',')[0]}</span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <Label className="editor-text-muted">Size</Label>
            <Input
              type="number"
              value={opts.fontSize}
              min={8}
              max={400}
              onChange={(e) => setOpts({ fontSize: Math.max(8, Math.min(400, parseInt(e.target.value) || 48)) })}
              className="w-16 h-7 editor-surface editor-border"
            />
            <span className="editor-text-dim">px</span>
          </div>
        </>
      )}

      {/* Shape options */}
      {(activeTool === 'shape-rect' || activeTool === 'shape-ellipse' || activeTool === 'shape-line' || activeTool === 'pen') && (
        <>
          <div className="flex items-center gap-2 shrink-0">
            <Label className="editor-text-muted">Fill</Label>
            <Switch checked={opts.shapeFilled} onCheckedChange={(v) => setOpts({ shapeFilled: v })} />
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <Label className="editor-text-muted">Stroke</Label>
            <Slider
              value={[opts.shapeStrokeWidth]}
              min={0}
              max={50}
              step={1}
              onValueChange={(v) => setOpts({ shapeStrokeWidth: v[0] })}
              className="w-16 sm:w-24"
            />
            <span className="w-8">{opts.shapeStrokeWidth}px</span>
          </div>
          {activeTool === 'pen' && (
            <span className="editor-text-dim text-[10px] hidden sm:inline">Enter to commit · Esc to cancel</span>
          )}
        </>
      )}

      {/* Liquify options */}
      {(activeTool === 'liquify-push' || activeTool === 'liquify-pucker' || activeTool === 'liquify-bloat' || activeTool === 'liquify-twirl') && (
        <>
          <div className="flex items-center gap-2 shrink-0">
            <Label className="editor-text-muted w-12 sm:w-14">Size</Label>
            <Slider
              value={[opts.brushSize]}
              min={4}
              max={300}
              step={1}
              onValueChange={(v) => setOpts({ brushSize: v[0] })}
              className="w-20 sm:w-28"
            />
            <span className="editor-text-dim">{opts.brushSize}px</span>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <Label className="editor-text-muted w-12 sm:w-14">Strength</Label>
            <Slider
              value={[opts.liquifyStrength]}
              min={1}
              max={100}
              step={1}
              onValueChange={(v) => setOpts({ liquifyStrength: v[0] })}
              className="w-16 sm:w-24"
            />
            <span className="w-8">{opts.liquifyStrength}</span>
          </div>
        </>
      )}

      {/* Brush stabilizer & symmetry (for brush/pencil/eraser) */}
      {(activeTool === 'brush' || activeTool === 'pencil' || activeTool === 'eraser') && (
        <>
          <div className="flex items-center gap-2 shrink-0 hidden md:flex">
            <Label className="editor-text-muted w-12 sm:w-14">Stabilize</Label>
            <Slider
              value={[opts.brushStabilizer]}
              min={0}
              max={100}
              step={1}
              onValueChange={(v) => setOpts({ brushStabilizer: v[0] })}
              className="w-16 sm:w-24"
            />
            <span className="w-8">{opts.brushStabilizer}</span>
          </div>
          <div className="flex items-center gap-1 shrink-0">
            <Label className="editor-text-muted text-[10px]">Sym</Label>
            <select
              value={opts.symmetryMode}
              onChange={(e) => setOpts({ symmetryMode: e.target.value as typeof opts.symmetryMode })}
              className="h-7 px-1 editor-surface editor-border rounded text-xs editor-text"
              title="Symmetry mode"
            >
              <option value="none">Off</option>
              <option value="horizontal">H Mirror</option>
              <option value="vertical">V Mirror</option>
              <option value="quad">Quad</option>
              <option value="mandala">Mandala</option>
            </select>
            {opts.symmetryMode === 'mandala' && (
              <input
                type="number"
                value={opts.symmetrySegments}
                min={2}
                max={12}
                onChange={(e) => setOpts({ symmetrySegments: Math.max(2, Math.min(12, parseInt(e.target.value) || 6)) })}
                className="w-10 h-7 editor-surface editor-border rounded text-center text-xs editor-text"
                title="Mandala segments"
              />
            )}
          </div>
        </>
      )}

      {/* Zoom controls */}
      <div className="ml-auto flex items-center gap-1 sm:gap-2 shrink-0">
        <button
          onClick={() => setZoom(zoom / 1.25)}
          className="px-2 h-7 rounded hover:editor-surface-3 editor-border editor-text touch-target"
          title="Zoom out"
        >−</button>
        <input
          type="number"
          value={Math.round(zoom * 100)}
          min={1}
          max={3200}
          onChange={(e) => setZoom(Math.max(0.01, parseInt(e.target.value) || 100) / 100)}
          className="w-14 h-7 editor-surface editor-border rounded text-center"
        />
        <span className="editor-text-muted hidden sm:inline">%</span>
        <button
          onClick={() => setZoom(zoom * 1.25)}
          className="px-2 h-7 rounded hover:editor-surface-3 editor-border editor-text touch-target"
          title="Zoom in"
        >+</button>
        <button
          onClick={() => setZoom(1)}
          className="px-2 h-7 rounded hover:editor-surface-3 editor-border editor-text text-xs touch-target hidden sm:block"
          title="100%"
        >1:1</button>
      </div>
    </div>
  );
}

// Tool presets for icon and label
export { TOOL_PRESETS };
