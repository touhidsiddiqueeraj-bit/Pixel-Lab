'use client';

import { useEditorStore } from '@/lib/editor-store';
import { History as HistoryIcon, Undo2, Redo2, Trash2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';

export function HistoryPanel() {
  const history = useEditorStore((s) => s.history);
  const historyIndex = useEditorStore((s) => s.historyIndex);
  const undo = useEditorStore((s) => s.undo);
  const redo = useEditorStore((s) => s.redo);

  return (
    <div className="flex flex-col h-full editor-surface editor-text">
      <div className="px-3 py-2 border-b editor-border text-xs font-semibold uppercase tracking-wide editor-text-muted flex items-center gap-2">
        <HistoryIcon size={12} />
        <span>History</span>
        <span className="ml-auto editor-text-dim normal-case">{history.length} states</span>
      </div>

      <div className="flex items-center gap-1 px-2 py-1.5 border-b editor-border">
        <TooltipProvider delayDuration={400}>
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                onClick={undo}
                disabled={historyIndex <= 0}
                className="p-1.5 rounded hover:editor-surface-2 editor-text disabled:opacity-40"
              >
                <Undo2 size={14} />
              </button>
            </TooltipTrigger>
            <TooltipContent side="bottom" className="text-xs">Undo (Ctrl+Z)</TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                onClick={redo}
                disabled={historyIndex >= history.length - 1}
                className="p-1.5 rounded hover:editor-surface-2 editor-text disabled:opacity-40"
              >
                <Redo2 size={14} />
              </button>
            </TooltipTrigger>
            <TooltipContent side="bottom" className="text-xs">Redo (Ctrl+Y)</TooltipContent>
          </Tooltip>
        </TooltipProvider>
      </div>

      <div className="flex-1 overflow-y-auto custom-scroll">
        {history.length === 0 && (
          <div className="p-4 text-xs editor-text-dim text-center">No history yet</div>
        )}
        {history.map((entry, idx) => (
          <button
            key={entry.id}
            onClick={() => {
              // Jump to this history state
              const diff = idx - historyIndex;
              if (diff > 0) {
                for (let i = 0; i < diff; i++) redo();
              } else if (diff < 0) {
                for (let i = 0; i < -diff; i++) undo();
              }
            }}
            className={cn(
              'w-full text-left px-3 py-1.5 text-xs border-b editor-border/50 flex items-center gap-2 transition-colors',
              idx === historyIndex
                ? 'editor-accent-bg/20 text-white border-l-2 border-l-[var(--editor-accent)]'
                : idx > historyIndex
                  ? 'editor-text-dim hover:editor-surface-2/30'
                  : 'editor-text hover:editor-surface-2/50',
            )}
          >
            <span className="font-mono text-[10px] editor-text-dim w-6">{idx + 1}</span>
            <span className="flex-1 truncate">{entry.label}</span>
            {idx > historyIndex && <Trash2 size={10} className="editor-text-dim" />}
          </button>
        ))}
      </div>
    </div>
  );
}
