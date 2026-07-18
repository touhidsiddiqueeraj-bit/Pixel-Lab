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
    <div className="flex items-center gap-2 sm:gap-3 px-2 h-9 sm:h-10 editor-surface-2 border-b editor-border editor-text text-xs overflow-x-auto custom-scroll shrink-0">
      <div className="flex items-center gap-1.5 shrink-0">
        <span className="editor-accent">{preset?.icon}</span>
        <span className="font-medium hidden md:inline">{preset?.label ?? 'Tool'}</span>
      </div>

      <div className="w-px h-5 editor-border shrink-0" />

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
      {(activeTool === 'shape-rect' || activeTool === 'shape-ellipse' || activeTool === 'shape-line' || activeTool === 'pen' || activeTool === 'curvature-pen' ||
        activeTool === 'shape-star' || activeTool === 'shape-polygon' || activeTool === 'shape-arrow' || activeTool === 'shape-heart' || activeTool === 'shape-speech-bubble' || activeTool === 'shape-spiral') && (
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
          {/* Star: points + inner radius */}
          {activeTool === 'shape-star' && (
            <>
              <div className="flex items-center gap-2 shrink-0">
                <Label className="editor-text-muted">Points</Label>
                <Slider value={[opts.shapeStarPoints]} min={3} max={20} step={1} onValueChange={(v) => setOpts({ shapeStarPoints: v[0] })} className="w-16 sm:w-20" />
                <span className="w-6">{opts.shapeStarPoints}</span>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <Label className="editor-text-muted">Inner</Label>
                <Slider value={[opts.shapeStarInnerRatio * 100]} min={10} max={90} step={5} onValueChange={(v) => setOpts({ shapeStarInnerRatio: v[0] / 100 })} className="w-16 sm:w-20" />
                <span className="w-8">{Math.round(opts.shapeStarInnerRatio * 100)}%</span>
              </div>
            </>
          )}
          {/* Polygon: sides */}
          {activeTool === 'shape-polygon' && (
            <div className="flex items-center gap-2 shrink-0">
              <Label className="editor-text-muted">Sides</Label>
              <Slider value={[opts.shapeSides]} min={3} max={12} step={1} onValueChange={(v) => setOpts({ shapeSides: v[0] })} className="w-16 sm:w-20" />
              <span className="w-6">{opts.shapeSides}</span>
            </div>
          )}
          {/* Arrow: head size */}
          {activeTool === 'shape-arrow' && (
            <div className="flex items-center gap-2 shrink-0">
              <Label className="editor-text-muted">Head</Label>
              <Slider value={[opts.shapeArrowHeadSize * 100]} min={10} max={60} step={5} onValueChange={(v) => setOpts({ shapeArrowHeadSize: v[0] / 100 })} className="w-16 sm:w-20" />
              <span className="w-8">{Math.round(opts.shapeArrowHeadSize * 100)}%</span>
            </div>
          )}
          {/* Spiral: turns */}
          {activeTool === 'shape-spiral' && (
            <div className="flex items-center gap-2 shrink-0">
              <Label className="editor-text-muted">Turns</Label>
              <Slider value={[opts.shapeSpiralTurns * 10]} min={5} max={100} step={1} onValueChange={(v) => setOpts({ shapeSpiralTurns: v[0] / 10 })} className="w-16 sm:w-20" />
              <span className="w-8">{opts.shapeSpiralTurns.toFixed(1)}</span>
            </div>
          )}
          {(activeTool === 'pen' || activeTool === 'curvature-pen') && (
            <span className="editor-text-dim text-[10px] hidden sm:inline">Enter to commit · Esc to cancel</span>
          )}
        </>
      )}

      {/* New brush tools options */}
      {(activeTool === 'blob-brush' || activeTool === 'calligraphy-brush' || activeTool === 'scatter-brush' || activeTool === 'smooth-tool') && (
        <>
          <div className="flex items-center gap-2 shrink-0">
            <Label className="editor-text-muted w-12 sm:w-14">Size</Label>
            <Slider value={[opts.brushSize]} min={1} max={500} step={1} onValueChange={(v) => setOpts({ brushSize: v[0] })} className="w-20 sm:w-28" />
            <span className="editor-text-dim">{opts.brushSize}px</span>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <Label className="editor-text-muted w-12 sm:w-14">Opacity</Label>
            <Slider value={[opts.brushOpacity]} min={1} max={100} step={1} onValueChange={(v) => setOpts({ brushOpacity: v[0] })} className="w-16 sm:w-24" />
            <span className="w-8">{opts.brushOpacity}%</span>
          </div>
          {activeTool === 'calligraphy-brush' && (
            <div className="flex items-center gap-2 shrink-0">
              <Label className="editor-text-muted">Angle</Label>
              <Slider value={[opts.calligraphyAngle]} min={0} max={360} step={5} onValueChange={(v) => setOpts({ calligraphyAngle: v[0] })} className="w-16 sm:w-24" />
              <span className="w-10">{opts.calligraphyAngle}°</span>
            </div>
          )}
          {activeTool === 'scatter-brush' && (
            <>
              <div className="flex items-center gap-2 shrink-0">
                <Label className="editor-text-muted">Count</Label>
                <Slider value={[opts.scatterCount]} min={1} max={20} step={1} onValueChange={(v) => setOpts({ scatterCount: v[0] })} className="w-16 sm:w-20" />
                <span className="w-6">{opts.scatterCount}</span>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <Label className="editor-text-muted">Size</Label>
                <Slider value={[opts.scatterSize * 100]} min={10} max={300} step={10} onValueChange={(v) => setOpts({ scatterSize: v[0] / 100 })} className="w-16 sm:w-20" />
                <span className="w-8">{Math.round(opts.scatterSize * 100)}%</span>
              </div>
            </>
          )}
          {activeTool === 'smooth-tool' && (
            <div className="flex items-center gap-2 shrink-0">
              <Label className="editor-text-muted">Strength</Label>
              <Slider value={[opts.smoothStrength]} min={0} max={100} step={5} onValueChange={(v) => setOpts({ smoothStrength: v[0] })} className="w-16 sm:w-24" />
              <span className="w-8">{opts.smoothStrength}%</span>
            </div>
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

      {/* Zoom controls — hidden on mobile (use canvas zoom buttons instead) */}
      <div className="ml-auto flex items-center gap-1 shrink-0 hidden md:flex">
        <button
          onClick={() => setZoom(zoom / 1.25)}
          className="w-6 h-6 flex items-center justify-center rounded hover:editor-surface-3 editor-text"
          title="Zoom out"
        >−</button>
        <input
          type="number"
          value={Math.round(zoom * 100)}
          min={1}
          max={3200}
          onChange={(e) => setZoom(Math.max(0.01, parseInt(e.target.value) || 100) / 100)}
          className="w-12 h-6 editor-surface editor-border rounded text-center text-[10px]"
        />
        <span className="editor-text-muted text-[10px]">%</span>
        <button
          onClick={() => setZoom(zoom * 1.25)}
          className="w-6 h-6 flex items-center justify-center rounded hover:editor-surface-3 editor-text"
          title="Zoom in"
        >+</button>
        <button
          onClick={() => setZoom(1)}
          className="px-1.5 h-6 rounded hover:editor-surface-3 editor-text text-[10px]"
          title="100%"
        >1:1</button>
      </div>
    </div>
  );
}

// Tool presets for icon and label
export { TOOL_PRESETS };
