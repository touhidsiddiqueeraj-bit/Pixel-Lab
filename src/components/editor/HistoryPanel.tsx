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
    <div className="flex flex-col h-full bg-zinc-900 text-zinc-200">
      <div className="px-3 py-2 border-b border-zinc-800 text-xs font-semibold uppercase tracking-wide text-zinc-400 flex items-center gap-2">
        <HistoryIcon size={12} />
        <span>History</span>
        <span className="ml-auto text-zinc-600 normal-case">{history.length} states</span>
      </div>

      <div className="flex items-center gap-1 px-2 py-1.5 border-b border-zinc-800">
        <TooltipProvider delayDuration={400}>
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                onClick={undo}
                disabled={historyIndex <= 0}
                className="p-1.5 rounded hover:bg-zinc-800 text-zinc-300 disabled:opacity-40"
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
                className="p-1.5 rounded hover:bg-zinc-800 text-zinc-300 disabled:opacity-40"
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
          <div className="p-4 text-xs text-zinc-500 text-center">No history yet</div>
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
              'w-full text-left px-3 py-1.5 text-xs border-b border-zinc-800/50 flex items-center gap-2 transition-colors',
              idx === historyIndex
                ? 'bg-sky-600/20 text-white border-l-2 border-l-sky-500'
                : idx > historyIndex
                  ? 'text-zinc-500 hover:bg-zinc-800/30'
                  : 'text-zinc-300 hover:bg-zinc-800/50',
            )}
          >
            <span className="font-mono text-[10px] text-zinc-600 w-6">{idx + 1}</span>
            <span className="flex-1 truncate">{entry.label}</span>
            {idx > historyIndex && <Trash2 size={10} className="text-zinc-600" />}
          </button>
        ))}
      </div>
    </div>
  );
}
