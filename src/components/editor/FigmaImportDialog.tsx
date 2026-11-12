'use client';

import { useState, useCallback } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import { useEditorStore } from '@/lib/editor-store';
import {
  fetchFigmaFileInfo,
  importFigmaFrames,
  type FigmaFrameInfo,
} from '@/lib/figma/figma-import';
import { createBlankCanvas, generateThumbnail } from '@/lib/image-processing';
import { toast } from 'sonner';

interface FigmaImportDialogProps {
  open: boolean;
  onClose: () => void;
}

export function FigmaImportDialog({ open, onClose }: FigmaImportDialogProps) {
  const [step, setStep] = useState<'input' | 'select' | 'importing' | 'done'>('input');
  const [fileKey, setFileKey] = useState('');
  const [pat, setPat] = useState('');
  const [fileName, setFileName] = useState('');
  const [frames, setFrames] = useState<FigmaFrameInfo[]>([]);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [importProgress, setImportProgress] = useState(0);
  const [importTotal, setImportTotal] = useState(0);
  const [error, setError] = useState('');

  const addLayer = useEditorStore((s) => s.addLayer);
  const refreshThumbnail = useEditorStore((s) => s.refreshThumbnail);
  const pushHistory = useEditorStore((s) => s.pushHistory);
  const newDocument = useEditorStore((s) => s.newDocument);

  const handleFetch = useCallback(async () => {
    setError('');
    // Extract file key from URL if a full URL was pasted
    let key = fileKey.trim();
    if (key.includes('figma.com')) {
      const m = key.match(/figma\.com\/(?:file|proto)\/([a-zA-Z0-9]+)/);
      if (m) key = m[1];
    }
    if (!key) { setError('Enter a Figma file key or URL.'); return; }
    if (!pat.trim()) { setError('Enter your Figma Personal Access Token.'); return; }
    // Store PAT only for the duration of this import — never persisted
    try {
      setStep('select');
      const info = await fetchFigmaFileInfo(key, pat.trim());
      setFileName(info.name);
      setFrames(info.frames);
      // Pre-select all frames
      setSelectedIds(new Set(info.frames.map((f) => f.id)));
    } catch (e) {
      setError((e as Error).message);
      setStep('input');
    }
  }, [fileKey, pat]);

  const toggleFrame = useCallback((id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const handleImport = useCallback(async () => {
    let key = fileKey.trim();
    if (key.includes('figma.com')) {
      const m = key.match(/figma\.com\/(?:file|proto)\/([a-zA-Z0-9]+)/);
      if (m) key = m[1];
    }
    const ids = Array.from(selectedIds);
    if (ids.length === 0) { setError('Select at least one frame.'); return; }

    setStep('importing');
    setImportProgress(0);
    setImportTotal(ids.length);

    try {
      const results = await importFigmaFrames(
        key,
        ids,
        pat.trim(),
        2,
        (done) => setImportProgress(done),
      );

      // Create layers from imported frames
      const store = useEditorStore.getState();
      // If there are no existing layers, create a new document matching the first frame
      if (store.layers.length === 0 && results.length > 0) {
        const first = results.find((r) => r.width > 0);
        if (first) {
          newDocument(first.width, first.height, '#ffffff');
        }
      }

      for (const result of results) {
        if (!result.dataUrl) continue;
        await new Promise<void>((resolve, reject) => {
          const img = new Image();
          img.onload = () => {
            const state = useEditorStore.getState();
            const layerId = state.addLayer(result.frameName);
            // Wait a tick for the layer to be added
            setTimeout(() => {
              const s = useEditorStore.getState();
              const layer = s.layers.find((l) => l.id === layerId);
              if (layer) {
                const ctx = layer.canvas.getContext('2d')!;
                ctx.drawImage(img, 0, 0);
                s.refreshThumbnail(layerId);
              }
              resolve();
            }, 0);
          };
          img.onerror = () => resolve();
          img.src = result.dataUrl;
        });
      }

      pushHistory('Figma Import');
      toast.success(`Imported ${results.filter((r) => r.dataUrl).length} frame(s) from Figma.`);
      setStep('done');
    } catch (e) {
      setError((e as Error).message);
      setStep('select');
    }
  }, [fileKey, selectedIds, pat, newDocument, pushHistory]);

  const handleClose = useCallback(() => {
    setStep('input');
    setFileKey('');
    setPat('');
    setFileName('');
    setFrames([]);
    setSelectedIds(new Set());
    setImportProgress(0);
    setImportTotal(0);
    setError('');
    onClose();
  }, [onClose]);

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) handleClose(); }}>
      <DialogContent className="sm:max-w-lg editor-surface editor-text border editor-border">
        <DialogHeader>
          <DialogTitle>Import from Figma</DialogTitle>
          <DialogDescription className="editor-text-dim text-xs">
            Paste a Figma Personal Access Token and file URL to import frames as layers.
          </DialogDescription>
        </DialogHeader>

        {step === 'input' && (
          <div className="space-y-3">
            <div>
              <label className="block text-xs font-medium mb-1 editor-text-dim">Figma File URL or Key</label>
              <input
                className="w-full px-3 py-2 rounded editor-surface-3 editor-text text-sm border editor-border focus:outline-none focus:border-blue-500"
                placeholder="https://www.figma.com/file/abc123/..."
                value={fileKey}
                onChange={(e) => setFileKey(e.target.value)}
              />
            </div>
            <div>
              <label className="block text-xs font-medium mb-1 editor-text-dim">
                Personal Access Token
                <span className="ml-1 text-[10px]">(in-memory only, never saved)</span>
              </label>
              <input
                type="password"
                className="w-full px-3 py-2 rounded editor-surface-3 editor-text text-sm border editor-border focus:outline-none focus:border-blue-500"
                placeholder="figd_..."
                value={pat}
                onChange={(e) => setPat(e.target.value)}
              />
            </div>
            {error && <p className="text-red-400 text-xs">{error}</p>}
            <button
              onClick={handleFetch}
              className="w-full py-2 rounded bg-blue-600 hover:bg-blue-500 text-white text-sm font-medium transition-colors"
            >
              Fetch Frames
            </button>
          </div>
        )}

        {step === 'select' && (
          <div className="space-y-3">
            {fileName && <p className="text-sm font-medium">{fileName}</p>}
            {frames.length === 0 && (
              <p className="text-xs editor-text-dim">No frames found. Make sure the file contains frames (top-level nodes on a page).</p>
            )}
            <div className="max-h-60 overflow-y-auto space-y-1">
              {frames.slice(0, 20).map((frame) => (
                <label
                  key={frame.id}
                  className="flex items-center gap-2 px-2 py-1.5 rounded hover:editor-surface-3 cursor-pointer text-sm"
                >
                  <input
                    type="checkbox"
                    checked={selectedIds.has(frame.id)}
                    onChange={() => toggleFrame(frame.id)}
                    className="accent-blue-500"
                  />
                  <span className="truncate flex-1">{frame.name}</span>
                  <span className="text-[10px] editor-text-dim whitespace-nowrap">
                    {Math.round(frame.rect.w)} × {Math.round(frame.rect.h)}
                  </span>
                </label>
              ))}
              {frames.length > 20 && (
                <p className="text-xs editor-text-dim text-center pt-1">
                  +{frames.length - 20} more frames (showing first 20)
                </p>
              )}
            </div>
            {error && <p className="text-red-400 text-xs">{error}</p>}
            <div className="flex gap-2">
              <button
                onClick={() => setStep('input')}
                className="flex-1 py-2 rounded editor-surface-3 hover:editor-surface-2 text-sm transition-colors"
              >
                Back
              </button>
              <button
                onClick={handleImport}
                disabled={selectedIds.size === 0}
                className="flex-1 py-2 rounded bg-blue-600 hover:bg-blue-500 disabled:opacity-40 text-white text-sm font-medium transition-colors"
              >
                Import {selectedIds.size} Frame{selectedIds.size !== 1 ? 's' : ''}
              </button>
            </div>
          </div>
        )}

        {step === 'importing' && (
          <div className="space-y-3 py-4 text-center">
            <p className="text-sm">Importing frames...</p>
            <div className="w-full bg-editor-surface-3 rounded-full h-2 overflow-hidden">
              <div
                className="h-full bg-blue-500 rounded-full transition-all duration-200"
                style={{ width: `${importTotal > 0 ? (importProgress / importTotal) * 100 : 0}%` }}
              />
            </div>
            <p className="text-xs editor-text-dim">{importProgress} / {importTotal}</p>
          </div>
        )}

        {step === 'done' && (
          <div className="space-y-3 py-4 text-center">
            <p className="text-sm text-green-400">Import complete!</p>
            <button
              onClick={handleClose}
              className="w-full py-2 rounded bg-blue-600 hover:bg-blue-500 text-white text-sm font-medium transition-colors"
            >
              Done
            </button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
