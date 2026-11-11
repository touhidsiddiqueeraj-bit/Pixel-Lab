'use client';

// Mobile-first UI shell for the editor: a floating minimal tool dock, a
// slide-up options drawer with big touch controls, and a "more tools"
// bottom sheet. The goal of this redesign is MINIMALISM with EASY ACCESS:
//
//   • The canvas gets nearly the whole screen — no fixed OptionsBar and no
//     fixed two-row toolbar (the old design burned ~176px of chrome and
//     crammed tool options into a horizontally-scrolling strip of tiny
//     sliders that fought with scrolling).
//   • The 5 most-used tools (Brush, Eraser, Fill, Eyedropper, Pan) sit in a
//     floating translucent dock — ONE tap, no category strip.
//   • Options (size / hardness / opacity / symmetry / colors…) open as a
//     roomy vertical drawer: tap the ACTIVE tool button again, or use the
//     sliders toggle. Big 44px+ touch targets, one control per row.
//   • Every remaining tool lives in the "•••" bottom sheet, grouped and
//     searchable by eye.
//   • Layers / Adjust / Luna (AI) float as three edge buttons — one tap
//     opens the corresponding panel.
//
// The dock floats INSIDE the canvas wrapper's bottom padding, so the
// canvas's own zoom cluster and status bar sit just above it, unobstructed.

import { useCallback, useState } from 'react';
import {
  MousePointer2, Square, Circle, Lasso, Spline, Wand2, Crop,
  Brush, Pencil, Eraser, PaintBucket, Palette, Pipette, Stamp, Bandage,
  Droplet, PenTool, Pen, Scissors, Type, Star, Hexagon, MoveRight, Heart,
  MessageCircle, RefreshCw, Wind, Shrink, Expand, RotateCw, Minus,
  Hand, ZoomIn, ChevronDown, Triangle, Crosshair, FlipHorizontal2,
  Columns2, Grid2x2, Sun, Sparkles, Layers, SlidersHorizontal, Menu as MenuIcon,
} from 'lucide-react';
import { useEditorStore } from '@/lib/editor-store';
import { useAgentStore } from '@/lib/agent/agent-store';
import { Slider } from '@/components/ui/slider';
import { Switch } from '@/components/ui/switch';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { ToolType } from '@/lib/editor-types';

// Which panel tab to open from the floating edge buttons — PhotoEditor owns
// the tabs, so it just receives this value back.
export type MobilePanelTarget = 'layers' | 'adjust' | 'color' | 'history' | 'nav' | 'develop' | 'agent' | 'automations';

interface MobileToolDef {
  type: ToolType;
  icon: React.ReactNode;
  label: string;
}

// Tools that ship in the DOCK — the daily drivers. 5 icons + the More
// button keeps the pill comfortably narrow even on 360px screens.
const DOCK_TOOLS: MobileToolDef[] = [
  { type: 'brush', icon: <Brush size={22} />, label: 'Brush' },
  { type: 'eraser', icon: <Eraser size={22} />, label: 'Eraser' },
  { type: 'bucket', icon: <PaintBucket size={22} />, label: 'Fill' },
  { type: 'eyedropper', icon: <Pipette size={22} />, label: 'Color picker' },
  { type: 'hand', icon: <Hand size={22} />, label: 'Pan' },
];

// Every tool, grouped for the "•••" sheet. Mirrors the desktop Toolbar's
// groupings so muscle memory transfers.
const TOOL_GROUPS: { category: string; tools: MobileToolDef[] }[] = [
  {
    category: 'Select',
    tools: [
      { type: 'move', icon: <MousePointer2 size={20} />, label: 'Move' },
      { type: 'marquee-rect', icon: <Square size={20} />, label: 'Rect' },
      { type: 'marquee-ellipse', icon: <Circle size={20} />, label: 'Ellipse' },
      { type: 'lasso', icon: <Lasso size={20} />, label: 'Lasso' },
      { type: 'polygonal-lasso', icon: <Spline size={20} />, label: 'Poly Lasso' },
      { type: 'magnetic-lasso', icon: <PenTool size={20} />, label: 'Magnet' },
      { type: 'magic-wand', icon: <Wand2 size={20} />, label: 'Wand' },
      { type: 'crop', icon: <Crop size={20} />, label: 'Crop' },
    ],
  },
  {
    category: 'Paint',
    tools: [
      { type: 'brush', icon: <Brush size={20} />, label: 'Brush' },
      { type: 'pencil', icon: <Pencil size={20} />, label: 'Pencil' },
      { type: 'eraser', icon: <Eraser size={20} />, label: 'Eraser' },
      { type: 'bucket', icon: <PaintBucket size={20} />, label: 'Fill' },
      { type: 'gradient', icon: <Palette size={20} />, label: 'Gradient' },
      { type: 'eyedropper', icon: <Pipette size={20} />, label: 'Picker' },
      { type: 'clone-stamp', icon: <Stamp size={20} />, label: 'Clone' },
      { type: 'heal-brush', icon: <Bandage size={20} />, label: 'Heal' },
      { type: 'blob-brush', icon: <Droplet size={20} />, label: 'Blob' },
      { type: 'smooth-tool', icon: <Sparkles size={20} />, label: 'Smooth' },
    ],
  },
  {
    category: 'Shapes',
    tools: [
      { type: 'shape-rect', icon: <Square size={20} />, label: 'Rect' },
      { type: 'shape-ellipse', icon: <Circle size={20} />, label: 'Ellipse' },
      { type: 'shape-line', icon: <Minus size={20} />, label: 'Line' },
      { type: 'shape-star', icon: <Star size={20} />, label: 'Star' },
      { type: 'shape-polygon', icon: <Hexagon size={20} />, label: 'Polygon' },
      { type: 'shape-arrow', icon: <MoveRight size={20} />, label: 'Arrow' },
      { type: 'shape-heart', icon: <Heart size={20} />, label: 'Heart' },
      { type: 'shape-speech-bubble', icon: <MessageCircle size={20} />, label: 'Bubble' },
      { type: 'shape-spiral', icon: <RefreshCw size={20} />, label: 'Spiral' },
      { type: 'text', icon: <Type size={20} />, label: 'Text' },
    ],
  },
  {
    category: 'Pen',
    tools: [
      { type: 'pen', icon: <Pen size={20} />, label: 'Pen' },
      { type: 'curvature-pen', icon: <Spline size={20} />, label: 'Curvature' },
      { type: 'calligraphy-brush', icon: <PenTool size={20} />, label: 'Calligraphy' },
      { type: 'scatter-brush', icon: <Scissors size={20} />, label: 'Scatter' },
    ],
  },
  {
    category: 'Liquify',
    tools: [
      { type: 'liquify-push', icon: <Wind size={20} />, label: 'Push' },
      { type: 'liquify-pucker', icon: <Shrink size={20} />, label: 'Pucker' },
      { type: 'liquify-bloat', icon: <Expand size={20} />, label: 'Bloat' },
      { type: 'liquify-twirl', icon: <RotateCw size={20} />, label: 'Twirl' },
    ],
  },
  {
    category: 'View',
    tools: [
      { type: 'hand', icon: <Hand size={20} />, label: 'Pan' },
      { type: 'zoom', icon: <ZoomIn size={20} />, label: 'Zoom' },
    ],
  },
];

// Tools whose option drawer would have real content. Tools not listed here
// (move, selections, crop, pan, zoom…) have no settings — the drawer toggle
// hides itself and tapping the active tool does nothing.
const TOOLS_WITH_OPTIONS: ReadonlySet<ToolType> = new Set<ToolType>([
  'brush', 'pencil', 'eraser', 'bucket', 'magic-wand', 'gradient', 'text',
  'shape-rect', 'shape-ellipse', 'shape-line', 'shape-star', 'shape-polygon',
  'shape-arrow', 'shape-heart', 'shape-speech-bubble', 'shape-spiral',
  'pen', 'curvature-pen', 'clone-stamp', 'heal-brush', 'blob-brush',
  'calligraphy-brush', 'scatter-brush', 'smooth-tool',
  'liquify-push', 'liquify-pucker', 'liquify-bloat', 'liquify-twirl',
]);

const FONTS = [
  'Inter, sans-serif',
  'Georgia, serif',
  '"Times New Roman", serif',
  'Arial, sans-serif',
  '"Courier New", monospace',
  'Verdana, sans-serif',
  'Impact, sans-serif',
  '"Comic Sans MS", cursive',
];

export function MobileToolDock({
  onOpenPanel,
  onOpenAgent,
}: {
  onOpenPanel: (tab: MobilePanelTarget) => void;
  onOpenAgent: () => void;
}) {
  const activeTool = useEditorStore((s) => s.activeTool);
  const agentApiKey = useAgentStore((s) => s.apiKey);
  const agentStatus = useAgentStore((s) => s.status);

  const [optionsOpen, setOptionsOpen] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);

  // Switching to a tool without settings must close the drawer — otherwise it
  // would linger showing a stale tool's controls. This uses React's official
  // "adjust state during render" pattern (setState during render re-renders
  // immediately without committing the stale tree; no effect, no cascade).
  if (optionsOpen && !TOOLS_WITH_OPTIONS.has(activeTool)) {
    setOptionsOpen(false);
  }

  const setTool = useEditorStore((s) => s.setTool);

  const handleDockTap = useCallback((tool: ToolType) => {
    if (tool === activeTool) {
      // Tap the ALREADY-active tool → toggle its options drawer. This is the
      // zero-extra-buttons way to reach settings; the badge chevron on the
      // button hints that something opens.
      if (TOOLS_WITH_OPTIONS.has(tool)) setOptionsOpen((o) => !o);
      return;
    }
    setTool(tool);
  }, [activeTool, setTool]);

  return (
    <>
      {/* Floating edge buttons — Layers / Adjust / Luna. Vertically centered
          on the right edge, clear of the zoom cluster (bottom) and the
          title bar (top). Fade out while the options drawer is open so the
          drawer can use the full width without visual pile-up. */}
      <div className={cn(
        'absolute right-2 top-1/2 -translate-y-1/2 z-20 flex flex-col gap-2 transition-opacity duration-150',
        optionsOpen && 'opacity-0 pointer-events-none',
      )}>
        <FloatingEdgeButton
          icon={<Layers size={19} />}
          label="Layers"
          onClick={() => onOpenPanel('layers')}
        />
        <FloatingEdgeButton
          icon={<Sun size={19} />}
          label="Adjust"
          onClick={() => onOpenPanel('adjust')}
        />
        <FloatingEdgeButton
          icon={<Sparkles size={19} />}
          label="Luna (AI)"
          onClick={onOpenAgent}
          accent
          pulse={!agentApiKey}
          busy={agentStatus === 'running'}
          badge={agentStatus === 'awaiting-accept' || agentStatus === 'error'}
          badgeTone={agentStatus === 'error' ? 'error' : 'ok'}
        />
      </div>

      {/* Options drawer — slides in above the dock. Rendered FIRST in the
          DOM order here so it stacks visually above the dock (both are
          siblings inside the canvas wrapper). */}
      {optionsOpen && <MobileOptionsDrawer onClose={() => setOptionsOpen(false)} />}

      {/* The dock itself: a translucent floating pill pinned into the
          canvas wrapper's bottom padding zone. */}
      <div className="absolute bottom-2 left-1/2 -translate-x-1/2 z-30 flex items-center gap-1 p-1.5 rounded-2xl editor-glass backdrop-blur border editor-border shadow-lg no-select">
        {DOCK_TOOLS.map((tool) => {
          const isActive = activeTool === tool.type;
          const hasOptions = TOOLS_WITH_OPTIONS.has(tool.type);
          return (
            <button
              key={tool.type}
              onClick={() => handleDockTap(tool.type)}
              className={cn(
                'relative w-11 h-11 rounded-xl flex items-center justify-center transition-colors',
                isActive
                  ? 'editor-accent-bg text-white'
                  : 'editor-text-muted active:bg-[var(--editor-surface-3)]',
              )}
              title={tool.label}
              aria-label={tool.label}
              aria-pressed={isActive}
            >
              {tool.icon}
              {/* Hint badge: the active tool opens its options when tapped
                  again — a tiny chevron makes that discoverable. */}
              {isActive && hasOptions && (
                <span className="absolute -bottom-0.5 left-1/2 -translate-x-1/2 text-white/80 pointer-events-none">
                  <ChevronDown size={10} />
                </span>
              )}
            </button>
          );
        })}
        {/* More tools — opens the grouped bottom sheet */}
        <button
          onClick={() => setMoreOpen(true)}
          className="w-11 h-11 rounded-xl flex flex-col items-center justify-center gap-0.5 editor-text-muted active:bg-[var(--editor-surface-3)] transition-colors"
          title="More tools"
          aria-label="More tools"
        >
          <MenuIcon size={18} />
          <span className="flex gap-0.5">
            <span className="w-1 h-1 rounded-full bg-current" />
            <span className="w-1 h-1 rounded-full bg-current" />
            <span className="w-1 h-1 rounded-full bg-current" />
          </span>
        </button>
      </div>

      <MobileMoreToolsSheet open={moreOpen} onClose={() => setMoreOpen(false)} />
    </>
  );
}

function FloatingEdgeButton({
  icon, label, onClick, accent, pulse, busy, badge, badgeTone,
}: {
  icon: React.ReactNode;
  label: string;
  onClick: () => void;
  accent?: boolean;
  pulse?: boolean;
  busy?: boolean;
  badge?: boolean;
  badgeTone?: 'ok' | 'error';
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        'relative w-11 h-11 rounded-full flex items-center justify-center shadow-lg border transition-colors active:scale-95',
        accent
          ? 'bg-gradient-to-br from-sky-500 to-purple-600 text-white border-white/20'
          : 'editor-glass backdrop-blur editor-text editor-border',
        pulse && 'animate-pulse',
      )}
      title={label}
      aria-label={label}
    >
      {busy ? (
        <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24" fill="none">
          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
        </svg>
      ) : (
        icon
      )}
      {badge && (
        <span className={cn(
          'absolute top-0.5 right-0.5 h-2.5 w-2.5 rounded-full border-2',
          badgeTone === 'error' ? 'bg-red-500 border-white' : 'bg-emerald-400 border-white',
        )} />
      )}
    </button>
  );
}

// ---------------------------------------------------------------------------
// Options drawer — one big control per row instead of the old horizontally
// scrolling strip of tiny sliders.
// ---------------------------------------------------------------------------

function OptRow({
  label, value, children,
}: {
  label: string;
  value: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-center gap-3">
      <span className="w-14 shrink-0 text-[11px] editor-text-muted">{label}</span>
      {children}
      <span className="w-14 shrink-0 text-right text-[11px] font-mono tabular-nums editor-text">{value}</span>
    </div>
  );
}

function MobileOptionsDrawer({ onClose }: { onClose: () => void }) {
  const activeTool = useEditorStore((s) => s.activeTool);
  const opts = useEditorStore((s) => s.toolOptions);
  const setOpts = useEditorStore((s) => s.setToolOptions);
  const foreground = useEditorStore((s) => s.foregroundColor);
  const background = useEditorStore((s) => s.backgroundColor);
  const swapColors = useEditorStore((s) => s.swapColors);
  const settingSource = useEditorStore((s) => s.settingSource);
  const setSettingSource = useEditorStore((s) => s.setSettingSource);

  const isBrushFamily = activeTool === 'brush' || activeTool === 'pencil' || activeTool === 'eraser';
  const isShape =
    activeTool.startsWith('shape-') || activeTool === 'pen' || activeTool === 'curvature-pen';
  const isLiquify = activeTool.startsWith('liquify-');
  const isCloneHeal = activeTool === 'clone-stamp' || activeTool === 'heal-brush';
  const isExtraBrush =
    activeTool === 'blob-brush' || activeTool === 'calligraphy-brush' ||
    activeTool === 'scatter-brush' || activeTool === 'smooth-tool';

  const toolLabel =
    TOOL_GROUPS.flatMap((g) => g.tools).find((t) => t.type === activeTool)?.label ?? 'Tool';

  return (
    <div className="absolute bottom-[72px] left-2 right-2 z-30 rounded-2xl editor-glass-strong backdrop-blur border editor-border shadow-xl flex flex-col max-h-[46dvh]">
      {/* Header: what am I editing + close */}
      <div className="flex items-center justify-between px-3 py-2 border-b editor-border shrink-0">
        <span className="flex items-center gap-2 text-xs font-medium editor-text">
          <SlidersHorizontal size={13} className="editor-accent" />
          {toolLabel} options
        </span>
        <button
          onClick={onClose}
          className="w-7 h-7 rounded-md flex items-center justify-center editor-text-muted active:bg-[var(--editor-surface-3)]"
          title="Close options"
          aria-label="Close options"
        >
          <ChevronDown size={16} />
        </button>
      </div>

      {/* Control rows — scroll if taller than the drawer */}
      <div className="flex flex-col gap-3 px-3 py-3 overflow-y-auto custom-scroll">
        {isBrushFamily && (
          <>
            <OptRow label="Size" value={`${opts.brushSize}px`}>
              <Slider value={[opts.brushSize]} min={1} max={500} step={1} onValueChange={(v) => setOpts({ brushSize: v[0] })} className="flex-1" />
            </OptRow>
            {activeTool !== 'pencil' && (
              <OptRow label="Hardness" value={`${opts.brushHardness}%`}>
                <Slider value={[opts.brushHardness]} min={0} max={100} step={1} onValueChange={(v) => setOpts({ brushHardness: v[0] })} className="flex-1" />
              </OptRow>
            )}
            <OptRow label="Opacity" value={`${opts.brushOpacity}%`}>
              <Slider value={[opts.brushOpacity]} min={1} max={100} step={1} onValueChange={(v) => setOpts({ brushOpacity: v[0] })} className="flex-1" />
            </OptRow>
            <OptRow label="Stabilize" value={opts.brushStabilizer}>
              <Slider value={[opts.brushStabilizer]} min={0} max={100} step={1} onValueChange={(v) => setOpts({ brushStabilizer: v[0] })} className="flex-1" />
            </OptRow>
            <SymmetryRow />
          </>
        )}

        {(activeTool === 'bucket' || activeTool === 'magic-wand') && (
          <OptRow label="Tolerance" value={opts.tolerance}>
            <Slider value={[opts.tolerance]} min={0} max={100} step={1} onValueChange={(v) => setOpts({ tolerance: v[0] })} className="flex-1" />
          </OptRow>
        )}

        {isCloneHeal && (
          <>
            <OptRow label="Size" value={`${opts.brushSize}px`}>
              <Slider value={[opts.brushSize]} min={1} max={500} step={1} onValueChange={(v) => setOpts({ brushSize: v[0] })} className="flex-1" />
            </OptRow>
            <OptRow label="Hardness" value={`${opts.brushHardness}%`}>
              <Slider value={[opts.brushHardness]} min={0} max={100} step={1} onValueChange={(v) => setOpts({ brushHardness: v[0] })} className="flex-1" />
            </OptRow>
            <OptRow label="Opacity" value={`${opts.brushOpacity}%`}>
              <Slider value={[opts.brushOpacity]} min={1} max={100} step={1} onValueChange={(v) => setOpts({ brushOpacity: v[0] })} className="flex-1" />
            </OptRow>
            <Button
              onClick={() => setSettingSource(!settingSource)}
              className={cn(
                'h-9 text-xs gap-1 w-full',
                settingSource
                  ? 'bg-amber-600 hover:bg-amber-500 text-white'
                  : 'editor-surface-2 editor-border editor-text hover:editor-surface-3',
              )}
              title="Tap, then tap the canvas to set the clone/heal source"
            >
              <Crosshair size={13} />
              {settingSource ? 'Tap canvas to set source…' : 'Set Source (Alt+Click)'}
            </Button>
          </>
        )}

        {isExtraBrush && (
          <>
            <OptRow label="Size" value={`${opts.brushSize}px`}>
              <Slider value={[opts.brushSize]} min={1} max={500} step={1} onValueChange={(v) => setOpts({ brushSize: v[0] })} className="flex-1" />
            </OptRow>
            <OptRow label="Opacity" value={`${opts.brushOpacity}%`}>
              <Slider value={[opts.brushOpacity]} min={1} max={100} step={1} onValueChange={(v) => setOpts({ brushOpacity: v[0] })} className="flex-1" />
            </OptRow>
            {activeTool === 'calligraphy-brush' && (
              <OptRow label="Angle" value={`${opts.calligraphyAngle}°`}>
                <Slider value={[opts.calligraphyAngle]} min={0} max={360} step={5} onValueChange={(v) => setOpts({ calligraphyAngle: v[0] })} className="flex-1" />
              </OptRow>
            )}
            {activeTool === 'scatter-brush' && (
              <>
                <OptRow label="Count" value={opts.scatterCount}>
                  <Slider value={[opts.scatterCount]} min={1} max={20} step={1} onValueChange={(v) => setOpts({ scatterCount: v[0] })} className="flex-1" />
                </OptRow>
                <OptRow label="Scatter" value={`${Math.round(opts.scatterSize * 100)}%`}>
                  <Slider value={[opts.scatterSize * 100]} min={10} max={300} step={10} onValueChange={(v) => setOpts({ scatterSize: v[0] / 100 })} className="flex-1" />
                </OptRow>
              </>
            )}
            {activeTool === 'smooth-tool' && (
              <OptRow label="Strength" value={`${opts.smoothStrength}%`}>
                <Slider value={[opts.smoothStrength]} min={0} max={100} step={5} onValueChange={(v) => setOpts({ smoothStrength: v[0] })} className="flex-1" />
              </OptRow>
            )}
          </>
        )}

        {isLiquify && (
          <>
            <OptRow label="Size" value={`${opts.brushSize}px`}>
              <Slider value={[opts.brushSize]} min={4} max={300} step={1} onValueChange={(v) => setOpts({ brushSize: v[0] })} className="flex-1" />
            </OptRow>
            <OptRow label="Strength" value={opts.liquifyStrength}>
              <Slider value={[opts.liquifyStrength]} min={1} max={100} step={1} onValueChange={(v) => setOpts({ liquifyStrength: v[0] })} className="flex-1" />
            </OptRow>
          </>
        )}

        {activeTool === 'text' && (
          <>
            <div className="flex items-center gap-3">
              <span className="w-14 shrink-0 text-[11px] editor-text-muted">Font</span>
              <select
                value={opts.fontFamily}
                onChange={(e) => setOpts({ fontFamily: e.target.value })}
                className="flex-1 h-9 px-2 rounded-md editor-surface editor-border text-xs editor-text"
              >
                {FONTS.map((f) => (
                  <option key={f} value={f}>{f.replace(/["']/g, '').split(',')[0]}</option>
                ))}
              </select>
            </div>
            <OptRow label="Size" value={`${opts.fontSize}px`}>
              <Slider value={[opts.fontSize]} min={8} max={400} step={1} onValueChange={(v) => setOpts({ fontSize: v[0] })} className="flex-1" />
            </OptRow>
          </>
        )}

        {isShape && (
          <>
            <div className="flex items-center gap-3">
              <span className="w-14 shrink-0 text-[11px] editor-text-muted">Fill</span>
              <Switch checked={opts.shapeFilled} onCheckedChange={(v) => setOpts({ shapeFilled: v })} />
              <span className="flex-1" />
              <span className="text-[11px] editor-text-muted">Stroke</span>
              <Switch checked={opts.shapeStrokeWidth > 0} onCheckedChange={(v) => setOpts({ shapeStrokeWidth: v ? Math.max(1, opts.shapeStrokeWidth) : 0 })} />
            </div>
            <OptRow label="Stroke" value={`${opts.shapeStrokeWidth}px`}>
              <Slider value={[opts.shapeStrokeWidth]} min={0} max={50} step={1} onValueChange={(v) => setOpts({ shapeStrokeWidth: v[0] })} className="flex-1" />
            </OptRow>
            {activeTool === 'shape-star' && (
              <>
                <OptRow label="Points" value={opts.shapeStarPoints}>
                  <Slider value={[opts.shapeStarPoints]} min={3} max={20} step={1} onValueChange={(v) => setOpts({ shapeStarPoints: v[0] })} className="flex-1" />
                </OptRow>
                <OptRow label="Inner" value={`${Math.round(opts.shapeStarInnerRatio * 100)}%`}>
                  <Slider value={[opts.shapeStarInnerRatio * 100]} min={10} max={90} step={5} onValueChange={(v) => setOpts({ shapeStarInnerRatio: v[0] / 100 })} className="flex-1" />
                </OptRow>
              </>
            )}
            {activeTool === 'shape-polygon' && (
              <OptRow label="Sides" value={opts.shapeSides}>
                <Slider value={[opts.shapeSides]} min={3} max={12} step={1} onValueChange={(v) => setOpts({ shapeSides: v[0] })} className="flex-1" />
              </OptRow>
            )}
            {activeTool === 'shape-arrow' && (
              <OptRow label="Head" value={`${Math.round(opts.shapeArrowHeadSize * 100)}%`}>
                <Slider value={[opts.shapeArrowHeadSize * 100]} min={10} max={60} step={5} onValueChange={(v) => setOpts({ shapeArrowHeadSize: v[0] / 100 })} className="flex-1" />
              </OptRow>
            )}
            {activeTool === 'shape-spiral' && (
              <OptRow label="Turns" value={opts.shapeSpiralTurns.toFixed(1)}>
                <Slider value={[opts.shapeSpiralTurns * 10]} min={5} max={100} step={1} onValueChange={(v) => setOpts({ shapeSpiralTurns: v[0] / 10 })} className="flex-1" />
              </OptRow>
            )}
          </>
        )}

        {/* Colors — always visible (they matter for every paint tool). */}
        <div className="flex items-center gap-3 pt-1 border-t editor-border">
          <button
            onClick={() => document.getElementById('fg-color-input')?.click()}
            className="w-9 h-9 rounded-lg border-2 border-white/70 shadow shrink-0"
            style={{ backgroundColor: foreground }}
            title="Foreground color"
            aria-label="Foreground color"
          />
          <button
            onClick={swapColors}
            className="w-8 h-8 rounded-lg flex items-center justify-center editor-text-dim active:bg-[var(--editor-surface-3)] shrink-0"
            title="Swap colors"
            aria-label="Swap colors"
          >
            <Triangle size={12} className="rotate-90 fill-current" />
          </button>
          <button
            onClick={() => document.getElementById('bg-color-input')?.click()}
            className="w-9 h-9 rounded-lg border-2 border-white/70 shadow shrink-0"
            style={{ backgroundColor: background }}
            title="Background color"
            aria-label="Background color"
          />
          <span className="ml-auto text-[10px] editor-text-dim font-mono">{foreground}</span>
        </div>
      </div>
    </div>
  );
}

// Symmetry chips — with the live symmetry feedback in the canvas these are
// genuinely fun on mobile (draw a mandala with your thumb).
function SymmetryRow() {
  const opts = useEditorStore((s) => s.toolOptions);
  const setOpts = useEditorStore((s) => s.setToolOptions);

  const modes: { value: typeof opts.symmetryMode; label: string; icon: React.ReactNode }[] = [
    { value: 'none', label: 'Off', icon: <Minus size={13} /> },
    { value: 'horizontal', label: 'H', icon: <FlipHorizontal2 size={13} /> },
    { value: 'vertical', label: 'V', icon: <Columns2 size={13} /> },
    { value: 'quad', label: 'Quad', icon: <Grid2x2 size={13} /> },
    { value: 'mandala', label: 'Mandala', icon: <Sparkles size={13} /> },
  ];

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center gap-1">
        {modes.map((m) => (
          <button
            key={m.value}
            onClick={() => setOpts({ symmetryMode: m.value })}
            className={cn(
              'flex-1 h-9 rounded-lg flex items-center justify-center gap-1 text-[10px] font-medium transition-colors',
              opts.symmetryMode === m.value
                ? 'editor-accent-bg text-white'
                : 'editor-surface-2 editor-border editor-text-muted active:bg-[var(--editor-surface-3)]',
            )}
            title={`Symmetry: ${m.label}`}
            aria-pressed={opts.symmetryMode === m.value}
          >
            {m.icon}
            <span>{m.label}</span>
          </button>
        ))}
      </div>
      {opts.symmetryMode === 'mandala' && (
        <div className="flex items-center justify-center gap-3">
          <button
            onClick={() => setOpts({ symmetrySegments: Math.max(2, opts.symmetrySegments - 1) })}
            className="w-8 h-8 rounded-lg editor-surface-2 editor-border editor-text flex items-center justify-center active:bg-[var(--editor-surface-3)]"
            aria-label="Fewer segments"
          >−</button>
          <span className="text-[11px] editor-text-muted">{opts.symmetrySegments} segments</span>
          <button
            onClick={() => setOpts({ symmetrySegments: Math.min(12, opts.symmetrySegments + 1) })}
            className="w-8 h-8 rounded-lg editor-surface-2 editor-border editor-text flex items-center justify-center active:bg-[var(--editor-surface-3)]"
            aria-label="More segments"
          >+</button>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// More-tools bottom sheet — the full inventory, grouped, with big chips.
// ---------------------------------------------------------------------------

function MobileMoreToolsSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const activeTool = useEditorStore((s) => s.activeTool);
  const setTool = useEditorStore((s) => s.setTool);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[60]">
      {/* Scrim */}
      <button
        className="absolute inset-0 bg-black/50"
        onClick={onClose}
        aria-label="Close tools"
      />
      {/* Sheet */}
      <div className="absolute inset-x-0 bottom-0 max-h-[70dvh] editor-surface border-t editor-border rounded-t-2xl shadow-2xl flex flex-col">
        <div className="flex items-center justify-between px-4 py-3 border-b editor-border shrink-0">
          <span className="text-sm font-medium editor-text">All tools</span>
          <button
            onClick={onClose}
            className="w-8 h-8 rounded-md flex items-center justify-center editor-text-muted active:bg-[var(--editor-surface-3)]"
            title="Close"
            aria-label="Close"
          >
            <ChevronDown size={18} />
          </button>
        </div>
        <div className="overflow-y-auto custom-scroll px-4 py-3 flex flex-col gap-4">
          {TOOL_GROUPS.map((group) => (
            <div key={group.category}>
              <div className="text-[10px] font-medium editor-text-dim uppercase tracking-wider mb-2">{group.category}</div>
              <div className="grid grid-cols-5 gap-2">
                {group.tools.map((tool) => {
                  const isActive = activeTool === tool.type;
                  return (
                    <button
                      key={tool.type}
                      onClick={() => { setTool(tool.type); onClose(); }}
                      className={cn(
                        'h-14 rounded-xl flex flex-col items-center justify-center gap-1 transition-colors',
                        isActive
                          ? 'editor-accent-bg text-white'
                          : 'editor-surface-2 editor-border editor-text-muted active:bg-[var(--editor-surface-3)]',
                      )}
                      title={tool.label}
                      aria-label={tool.label}
                      aria-pressed={isActive}
                    >
                      {tool.icon}
                      <span className="text-[9px] leading-none font-medium">{tool.label}</span>
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
          <div className="h-[max(12px,env(safe-area-inset-bottom))]" />
        </div>
      </div>
    </div>
  );
}
