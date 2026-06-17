'use client';

import { useEditorStore } from '@/lib/editor-store';
import { LayerData, BLEND_MODES, BlendMode } from '@/lib/editor-types';
import {
  Eye,
  EyeOff,
  Plus,
  Trash2,
  Copy,
  ChevronsDown,
  Lock,
  Unlock,
  ImageIcon,
} from 'lucide-react';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { Slider } from '@/components/ui/slider';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { cn } from '@/lib/utils';
import { useState, useRef } from 'react';

export function LayersPanel() {
  const layers = useEditorStore((s) => s.layers);
  const activeLayerId = useEditorStore((s) => s.activeLayerId);
  const setActiveLayer = useEditorStore((s) => s.setActiveLayer);
  const addLayer = useEditorStore((s) => s.addLayer);
  const deleteLayer = useEditorStore((s) => s.deleteLayer);
  const duplicateLayer = useEditorStore((s) => s.duplicateLayer);
  const mergeDown = useEditorStore((s) => s.mergeDown);
  const updateLayer = useEditorStore((s) => s.updateLayer);
  const reorderLayers = useEditorStore((s) => s.reorderLayers);
  const pushHistory = useEditorStore((s) => s.pushHistory);

  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingName, setEditingName] = useState('');
  const dragIndex = useRef<number | null>(null);

  const activeIdx = layers.findIndex((l) => l.id === activeLayerId);

  const commitRename = (id: string) => {
    if (editingName.trim()) {
      updateLayer(id, { name: editingName.trim() });
      pushHistory('Rename Layer');
    }
    setEditingId(null);
  };

  return (
    <div className="flex flex-col h-full editor-surface editor-text">
      <div className="px-3 py-2 border-b editor-border text-xs font-semibold uppercase tracking-wide editor-text-muted flex items-center justify-between">
        <span>Layers</span>
        <span className="editor-text-dim normal-case">{layers.length}</span>
      </div>

      {/* Blend mode & opacity controls */}
      <div className="p-2 border-b editor-border space-y-2">
        <div className="flex items-center gap-2">
          <Select
            value={layers.find((l) => l.id === activeLayerId)?.blendMode ?? 'source-over'}
            onValueChange={(v) => {
              if (activeLayerId) {
                updateLayer(activeLayerId, { blendMode: v as BlendMode });
                pushHistory('Change Blend Mode');
              }
            }}
            disabled={!activeLayerId}
          >
            <SelectTrigger className="h-7 editor-surface-2 editor-border text-xs">
              <SelectValue placeholder="Blend Mode" />
            </SelectTrigger>
            <SelectContent className="editor-surface editor-border max-h-72">
              {BLEND_MODES.map((m) => (
                <SelectItem key={m.value} value={m.value} className="hover:editor-accent-bg hover:text-white text-xs">
                  {m.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-xs editor-text-muted w-12">Opacity</span>
          <Slider
            value={[Math.round((layers.find((l) => l.id === activeLayerId)?.opacity ?? 1) * 100)]}
            min={0}
            max={100}
            step={1}
            onValueChange={(v) => activeLayerId && updateLayer(activeLayerId, { opacity: v[0] / 100 })}
            onPointerUp={() => pushHistory('Change Opacity')}
            disabled={!activeLayerId}
            className="flex-1"
          />
          <span className="text-xs w-9 text-right">
            {Math.round((layers.find((l) => l.id === activeLayerId)?.opacity ?? 1) * 100)}%
          </span>
        </div>
      </div>

      {/* Layer list */}
      <div className="flex-1 overflow-y-auto custom-scroll">
        {[...layers].reverse().map((layer, revIdx) => {
          const realIdx = layers.length - 1 - revIdx;
          const isActive = layer.id === activeLayerId;
          return (
            <div
              key={layer.id}
              draggable
              onDragStart={() => { dragIndex.current = realIdx; }}
              onDragOver={(e) => e.preventDefault()}
              onDrop={() => {
                if (dragIndex.current !== null && dragIndex.current !== realIdx) {
                  reorderLayers(dragIndex.current, realIdx);
                  pushHistory('Reorder Layers');
                }
                dragIndex.current = null;
              }}
              onClick={() => setActiveLayer(layer.id)}
              className={cn(
                'flex items-center gap-2 px-2 py-1.5 border-b editor-border/50 cursor-pointer transition-colors group',
                isActive ? 'editor-accent-bg/20 border-l-2 border-l-[var(--editor-accent)]' : 'hover:editor-surface-2/50',
              )}
            >
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  updateLayer(layer.id, { visible: !layer.visible });
                }}
                className="editor-text-muted hover:text-white shrink-0"
                title={layer.visible ? 'Hide layer' : 'Show layer'}
              >
                {layer.visible ? <Eye size={14} /> : <EyeOff size={14} className="editor-text-dim" />}
              </button>

              <div className="w-10 h-10 rounded border editor-border editor-surface-2 shrink-0 overflow-hidden flex items-center justify-center checkerboard">
                {layer.thumbnail ? (
                  <img src={layer.thumbnail} alt="" className="w-full h-full object-contain" />
                ) : (
                  <ImageIcon size={12} className="editor-text-dim" />
                )}
              </div>

              <div className="flex-1 min-w-0">
                {editingId === layer.id ? (
                  <input
                    autoFocus
                    value={editingName}
                    onChange={(e) => setEditingName(e.target.value)}
                    onBlur={() => commitRename(layer.id)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') commitRename(layer.id);
                      if (e.key === 'Escape') setEditingId(null);
                    }}
                    onClick={(e) => e.stopPropagation()}
                    className="w-full editor-surface-2 border border-[var(--editor-accent)] px-1 py-0.5 rounded text-xs text-white outline-none"
                  />
                ) : (
                  <div
                    onDoubleClick={(e) => {
                      e.stopPropagation();
                      setEditingId(layer.id);
                      setEditingName(layer.name);
                    }}
                    className="text-xs truncate editor-text"
                  >
                    {layer.name}
                  </div>
                )}
                <div className="text-[10px] editor-text-dim">
                  {Math.round(layer.opacity * 100)}% · {BLEND_MODES.find((m) => m.value === layer.blendMode)?.label ?? 'Normal'}
                </div>
              </div>

              <button
                onClick={(e) => {
                  e.stopPropagation();
                  updateLayer(layer.id, { locked: !layer.locked });
                }}
                className={cn(
                  'shrink-0',
                  layer.locked ? 'text-amber-400' : 'editor-text-dim opacity-0 group-hover:opacity-100 hover:text-white',
                )}
                title={layer.locked ? 'Unlock layer' : 'Lock layer'}
              >
                {layer.locked ? <Lock size={12} /> : <Unlock size={12} />}
              </button>
            </div>
          );
        })}
      </div>

      {/* Footer actions */}
      <TooltipProvider delayDuration={400}>
        <div className="flex items-center gap-1 px-2 py-1.5 border-t editor-border editor-surface">
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                onClick={() => { addLayer(); pushHistory('New Layer'); }}
                className="p-1.5 rounded hover:editor-surface-2 editor-text"
              >
                <Plus size={16} />
              </button>
            </TooltipTrigger>
            <TooltipContent side="top" className="text-xs">New Layer</TooltipContent>
          </Tooltip>

          <Tooltip>
            <TooltipTrigger asChild>
              <button
                onClick={() => activeLayerId && duplicateLayer(activeLayerId)}
                disabled={!activeLayerId}
                className="p-1.5 rounded hover:editor-surface-2 editor-text disabled:opacity-40"
              >
                <Copy size={16} />
              </button>
            </TooltipTrigger>
            <TooltipContent side="top" className="text-xs">Duplicate Layer</TooltipContent>
          </Tooltip>

          <Tooltip>
            <TooltipTrigger asChild>
              <button
                onClick={() => activeLayerId && mergeDown(activeLayerId)}
                disabled={activeIdx <= 0}
                className="p-1.5 rounded hover:editor-surface-2 editor-text disabled:opacity-40"
              >
                <ChevronsDown size={16} />
              </button>
            </TooltipTrigger>
            <TooltipContent side="top" className="text-xs">Merge Down</TooltipContent>
          </Tooltip>

          <div className="flex-1" />

          <Tooltip>
            <TooltipTrigger asChild>
              <button
                onClick={() => activeLayerId && deleteLayer(activeLayerId)}
                disabled={layers.length <= 1 || !activeLayerId}
                className="p-1.5 rounded hover:bg-red-600 hover:text-white editor-text disabled:opacity-40"
              >
                <Trash2 size={16} />
              </button>
            </TooltipTrigger>
            <TooltipContent side="top" className="text-xs">Delete Layer</TooltipContent>
          </Tooltip>
        </div>
      </TooltipProvider>
    </div>
  );
}
