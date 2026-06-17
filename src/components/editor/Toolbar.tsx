'use client';

import {
  MousePointer2,
  Square,
  Circle,
  Lasso,
  Spline,
  Wand2,
  Crop,
  Pipette,
  Brush,
  Pencil,
  Eraser,
  PaintBucket,
  Palette,
  Type,
  Minus,
  Hand,
  ZoomIn,
  Triangle,
  Stamp,
} from 'lucide-react';
import { useEditorStore } from '@/lib/editor-store';
import { ToolType } from '@/lib/editor-types';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';

interface ToolDef {
  type: ToolType;
  icon: React.ReactNode;
  label: string;
  shortcut: string;
}

const TOOLS: { section: string; items: ToolDef[] }[] = [
  {
    section: 'Selection',
    items: [
      { type: 'move', icon: <MousePointer2 size={18} />, label: 'Move', shortcut: 'V' },
      { type: 'marquee-rect', icon: <Square size={18} />, label: 'Rectangular Marquee', shortcut: 'M' },
      { type: 'marquee-ellipse', icon: <Circle size={18} />, label: 'Elliptical Marquee', shortcut: 'M' },
      { type: 'lasso', icon: <Lasso size={18} />, label: 'Lasso', shortcut: 'L' },
      { type: 'polygonal-lasso', icon: <Spline size={18} />, label: 'Polygonal Lasso', shortcut: 'L' },
      { type: 'magnetic-lasso', icon: <Spline size={18} />, label: 'Magnetic Lasso', shortcut: 'L' },
      { type: 'magic-wand', icon: <Wand2 size={18} />, label: 'Magic Wand', shortcut: 'W' },
      { type: 'crop', icon: <Crop size={18} />, label: 'Crop', shortcut: 'C' },
    ],
  },
  {
    section: 'Painting',
    items: [
      { type: 'eyedropper', icon: <Pipette size={18} />, label: 'Eyedropper', shortcut: 'I' },
      { type: 'brush', icon: <Brush size={18} />, label: 'Brush', shortcut: 'B' },
      { type: 'pencil', icon: <Pencil size={18} />, label: 'Pencil', shortcut: 'B' },
      { type: 'eraser', icon: <Eraser size={18} />, label: 'Eraser', shortcut: 'E' },
      { type: 'clone-stamp', icon: <Stamp size={18} />, label: 'Clone Stamp', shortcut: 'S' },
      { type: 'bucket', icon: <PaintBucket size={18} />, label: 'Paint Bucket', shortcut: 'G' },
      { type: 'gradient', icon: <Palette size={18} />, label: 'Gradient', shortcut: 'G' },
    ],
  },
  {
    section: 'Vector & Text',
    items: [
      { type: 'text', icon: <Type size={18} />, label: 'Text', shortcut: 'T' },
      { type: 'shape-rect', icon: <Square size={18} />, label: 'Rectangle Shape', shortcut: 'U' },
      { type: 'shape-ellipse', icon: <Circle size={18} />, label: 'Ellipse Shape', shortcut: 'U' },
      { type: 'shape-line', icon: <Minus size={18} />, label: 'Line Shape', shortcut: 'U' },
    ],
  },
  {
    section: 'View',
    items: [
      { type: 'hand', icon: <Hand size={18} />, label: 'Hand (Pan)', shortcut: 'H' },
      { type: 'zoom', icon: <ZoomIn size={18} />, label: 'Zoom', shortcut: 'Z' },
    ],
  },
];

export function Toolbar() {
  const activeTool = useEditorStore((s) => s.activeTool);
  const setTool = useEditorStore((s) => s.setTool);
  const foreground = useEditorStore((s) => s.foregroundColor);
  const background = useEditorStore((s) => s.backgroundColor);
  const swapColors = useEditorStore((s) => s.swapColors);
  const resetColors = useEditorStore((s) => s.resetColors);

  return (
    <div className="flex flex-col items-center gap-1 bg-zinc-900 border-r border-zinc-800 px-1 py-2 w-12 overflow-y-auto custom-scroll shrink-0">
      <TooltipProvider delayDuration={300}>
        {TOOLS.map((section, si) => (
          <div key={si} className="flex flex-col items-center gap-1">
            {section.items.map((tool) => (
              <Tooltip key={tool.type}>
                <TooltipTrigger asChild>
                  <button
                    onClick={() => setTool(tool.type)}
                    className={cn(
                      'flex items-center justify-center w-9 h-9 rounded-md transition-colors',
                      activeTool === tool.type
                        ? 'bg-sky-600 text-white shadow-inner'
                        : 'text-zinc-300 hover:bg-zinc-800 hover:text-white',
                    )}
                  >
                    {tool.icon}
                  </button>
                </TooltipTrigger>
                <TooltipContent side="right" className="text-xs">
                  <div className="font-medium">{tool.label}</div>
                  <div className="text-zinc-400">Shortcut: {tool.shortcut}</div>
                </TooltipContent>
              </Tooltip>
            ))}
            {si < TOOLS.length - 1 && <div className="w-6 h-px bg-zinc-700 my-1" />}
          </div>
        ))}

        {/* Color swatches */}
        <div className="mt-2 relative w-10 h-10">
          <button
            onClick={() => {
              const input = document.getElementById('fg-color-input') as HTMLInputElement | null;
              input?.click();
            }}
            className="absolute top-0 left-0 w-7 h-7 rounded border-2 border-white/80 shadow-md"
            style={{ backgroundColor: foreground }}
            title="Foreground color"
          />
          <button
            onClick={() => {
              const input = document.getElementById('bg-color-input') as HTMLInputElement | null;
              input?.click();
            }}
            className="absolute bottom-0 right-0 w-7 h-7 rounded border-2 border-white/80 shadow-md"
            style={{ backgroundColor: background }}
            title="Background color"
          />
          <button
            onClick={swapColors}
            className="absolute -top-1 -right-1 w-4 h-4 rounded-full bg-zinc-800 border border-zinc-600 text-zinc-200 flex items-center justify-center hover:bg-zinc-700"
            title="Swap colors (X)"
          >
            <Triangle size={8} className="rotate-90 fill-current" />
          </button>
          <button
            onClick={resetColors}
            className="absolute -bottom-1 -left-1 w-4 h-4 rounded-full bg-zinc-800 border border-zinc-600 text-zinc-200 flex items-center justify-center text-[8px] hover:bg-zinc-700"
            title="Reset colors (D)"
          >
            <span className="font-bold">D</span>
          </button>
        </div>
      </TooltipProvider>
    </div>
  );
}
