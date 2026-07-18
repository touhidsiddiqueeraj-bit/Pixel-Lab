'use client';

/**
 * ShortcutsDialog — a searchable, categorized view of all keyboard shortcuts.
 *
 * Opens via:
 *   - View menu → "Keyboard Shortcuts..."
 *   - Ctrl+/ (or Cmd+/ on macOS)
 *   - The "?" button in the title bar (wired in PhotoEditor)
 *
 * Reads from the centralized shortcuts module (src/lib/shortcuts.ts) so it's
 * always in sync with the actual keydown handler in EditorCanvas.tsx.
 */

import { useState, useMemo } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { SHORTCUTS, getShortcutsByCategory, formatShortcut, isMacOS, type ShortcutCategory } from '@/lib/shortcuts';
import { Search, Keyboard } from 'lucide-react';

interface ShortcutsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

const CATEGORY_ORDER: ShortcutCategory[] = [
  'Tools',
  'Edit',
  'Layer',
  'Selection',
  'View',
  'File',
  'Brush',
  'Color',
];

export function ShortcutsDialog({ open, onOpenChange }: ShortcutsDialogProps) {
  const [query, setQuery] = useState('');
  const isMac = useMemo(() => isMacOS(), []);

  const grouped = useMemo(() => getShortcutsByCategory(), []);

  // Filter shortcuts by search query (matches action, keys, or category)
  const filteredGrouped = useMemo(() => {
    if (!query.trim()) return grouped;
    const q = query.toLowerCase();
    const result: Record<ShortcutCategory, typeof SHORTCUTS> = {
      Tools: [], Edit: [], Layer: [], Selection: [], View: [], File: [], Brush: [], Color: [],
    };
    for (const [cat, list] of Object.entries(grouped)) {
      const filtered = list.filter(
        (s) =>
          s.action.toLowerCase().includes(q) ||
          s.keys.toLowerCase().includes(q) ||
          s.category.toLowerCase().includes(q) ||
          s.description?.toLowerCase().includes(q),
      );
      if (filtered.length > 0) {
        result[cat as ShortcutCategory] = filtered;
      }
    }
    return result;
  }, [query, grouped]);

  const totalCount = SHORTCUTS.length;
  const visibleCount = Object.values(filteredGrouped).reduce((sum, list) => sum + list.length, 0);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="editor-surface editor-text border editor-border max-w-2xl max-h-[80vh] flex flex-col p-0 gap-0">
        <DialogHeader className="p-4 border-b editor-border shrink-0">
          <DialogTitle className="flex items-center gap-2 text-base">
            <Keyboard size={18} className="editor-accent" />
            Keyboard Shortcuts
          </DialogTitle>
          <DialogDescription className="text-xs editor-text-muted">
            {visibleCount === totalCount
              ? `${totalCount} shortcuts · Photoshop-style`
              : `${visibleCount} of ${totalCount} shortcuts matching "${query}"`}
            {' · '}
            Modifier: {isMac ? '⌘ Cmd' : 'Ctrl'}
          </DialogDescription>
        </DialogHeader>

        {/* Search bar */}
        <div className="p-3 border-b editor-border shrink-0">
          <div className="relative">
            <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 editor-text-dim" />
            <Input
              type="text"
              placeholder="Search shortcuts... (e.g. 'undo', 'brush', 'layer')"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              className="h-8 pl-8 text-xs editor-surface-2 editor-border"
              autoFocus
            />
          </div>
        </div>

        {/* Scrollable shortcuts list */}
        <div className="flex-1 min-h-0 overflow-y-auto custom-scroll p-3 space-y-4">
          {visibleCount === 0 && (
            <div className="text-center py-8 text-xs editor-text-muted">
              No shortcuts match "{query}"
            </div>
          )}
          {CATEGORY_ORDER.map((cat) => {
            const list = filteredGrouped[cat];
            if (!list || list.length === 0) return null;
            return (
              <div key={cat}>
                <h3 className="text-[10px] font-semibold uppercase tracking-wider editor-text-dim mb-1.5 px-1">
                  {cat}
                </h3>
                <div className="space-y-0.5">
                  {list.map((s, i) => (
                    <div
                      key={`${s.keys}-${s.action}-${i}`}
                      className="flex items-center justify-between gap-3 px-2 py-1.5 rounded-md hover:editor-surface-2 transition-colors"
                    >
                      <div className="flex-1 min-w-0">
                        <div className="text-xs editor-text font-medium truncate">{s.action}</div>
                        {s.description && (
                          <div className="text-[10px] editor-text-dim truncate">{s.description}</div>
                        )}
                      </div>
                      <kbd className="shrink-0 inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded border editor-border editor-surface-2 text-[10px] editor-text font-mono">
                        {formatShortcut(s.keys, isMac)}
                      </kbd>
                    </div>
                  ))}
                </div>
              </div>
            );
          })}
        </div>

        {/* Footer */}
        <div className="p-2.5 border-t editor-border shrink-0 text-[10px] editor-text-dim text-center">
          Press <kbd className="px-1 py-0.5 rounded editor-surface-2 editor-border font-mono">Esc</kbd> to close
          {' · '}
          <kbd className="px-1 py-0.5 rounded editor-surface-2 editor-border font-mono">
            {isMac ? '⌘' : 'Ctrl'}+/
          </kbd>{' '}
          to reopen
        </div>
      </DialogContent>
    </Dialog>
  );
}
