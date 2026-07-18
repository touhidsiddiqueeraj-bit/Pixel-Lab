'use client';

import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Slider } from '@/components/ui/slider';
import { useState, useCallback, useEffect, useRef } from 'react';
import { useEditorStore } from '@/lib/editor-store';
import { vectorizeImage, VectorizationOptions, VectorizationResult } from '@/lib/vectorize';
import { svgToCanvas } from '@/lib/vectorize';
import { generateThumbnail, createBlankCanvas } from '@/lib/image-processing';
import { toast } from 'sonner';
import { Spline, Download, Loader2, Wand2 } from 'lucide-react';

interface VectorizeDialogProps {
  open: boolean;
  onClose: () => void;
}

export function VectorizeDialog({ open, onClose }: VectorizeDialogProps) {
  const layers = useEditorStore((s) => s.layers);
  const activeLayerId = useEditorStore((s) => s.activeLayerId);
  const docWidth = useEditorStore((s) => s.docWidth);
  const docHeight = useEditorStore((s) => s.docHeight);
  const addLayer = useEditorStore((s) => s.addLayer);
  const replaceLayerCanvas = useEditorStore((s) => s.replaceLayerCanvas);
  const refreshThumbnail = useEditorStore((s) => s.refreshThumbnail);
  const pushHistory = useEditorStore((s) => s.pushHistory);

  const [numColors, setNumColors] = useState(8);
  const [smoothing, setSmoothing] = useState(50);
  const [detail, setDetail] = useState(60);
  const [blurRadius, setBlurRadius] = useState(1);
  const [isProcessing, setIsProcessing] = useState(false);
  const [result, setResult] = useState<VectorizationResult | null>(null);
  const [mode, setMode] = useState<'replace' | 'new-layer'>('new-layer');

  const previewRef = useRef<HTMLDivElement>(null);

  const getActiveLayer = useCallback(() => layers.find((l) => l.id === activeLayerId) ?? null, [layers, activeLayerId]);

  const handleVectorize = useCallback(async () => {
    const layer = getActiveLayer();
    if (!layer) {
      toast.error('No active layer');
      return;
    }
    setIsProcessing(true);
    // Allow UI to update before heavy computation
    setTimeout(async () => {
      try {
        const options: VectorizationOptions = {
          numColors,
          smoothing,
          detail,
          blurRadius,
        };
        const result = vectorizeImage(layer.canvas, options);
        setResult(result);
        toast.success(`Vectorized: ${result.paths.length} paths, ${result.palette.length} colors`);
      } catch (e) {
        console.error(e);
        toast.error('Vectorization failed');
      } finally {
        setIsProcessing(false);
      }
    }, 50);
  }, [getActiveLayer, numColors, smoothing, detail, blurRadius]);

  // Update preview when result changes
  useEffect(() => {
    if (!result || !previewRef.current) return;
    previewRef.current.innerHTML = result.svg;
    const svg = previewRef.current.querySelector('svg');
    if (svg) {
      svg.style.width = '100%';
      svg.style.height = '100%';
      svg.style.objectFit = 'contain';
    }
  }, [result]);

  const handleApply = useCallback(async () => {
    if (!result) return;
    setIsProcessing(true);
    try {
      const canvas = await svgToCanvas(result.svg, result.width, result.height);
      if (mode === 'new-layer') {
        const layerId = addLayer('Vectorized');
        const state = useEditorStore.getState();
        const layer = state.layers.find((l) => l.id === layerId);
        if (layer) {
          const ctx = layer.canvas.getContext('2d')!;
          ctx.drawImage(canvas, 0, 0);
          refreshThumbnail(layerId);
        }
      } else {
        // Replace current layer
        if (activeLayerId) {
          replaceLayerCanvas(activeLayerId, canvas);
        }
      }
      pushHistory('Vectorize Image');
      toast.success('Vectorized layer added');
      onClose();
    } catch (e) {
      toast.error('Failed to apply vectorized result');
    } finally {
      setIsProcessing(false);
    }
  }, [result, mode, addLayer, replaceLayerCanvas, refreshThumbnail, pushHistory, activeLayerId, onClose]);

  const handleExportSVG = useCallback(() => {
    if (!result) return;
    const blob = new Blob([result.svg], { type: 'image/svg+xml' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `vectorized-${Date.now()}.svg`;
    link.click();
    URL.revokeObjectURL(url);
    toast.success('SVG exported');
  }, [result]);

  // Reset when dialog closes
  useEffect(() => {
    if (!open) {
      setResult(null);
    }
  }, [open]);

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="editor-surface editor-border editor-text max-w-3xl max-h-[90vh] overflow-hidden flex flex-col">
        <DialogHeader>
          <DialogTitle className="editor-text flex items-center gap-2">
            <Spline size={18} className="text-purple-500" />
            Vectorize Image
          </DialogTitle>
        </DialogHeader>

        <div className="flex flex-col md:flex-row gap-4 flex-1 min-h-0 overflow-hidden">
          {/* Options column */}
          <div className="w-full md:w-64 space-y-4 overflow-y-auto custom-scroll p-1">
            <div className="space-y-2">
              <div className="flex items-center justify-between text-xs">
                <Label className="editor-text-muted">Number of Colors</Label>
                <span className="editor-text">{numColors}</span>
              </div>
              <Slider value={[numColors]} min={2} max={32} step={1} onValueChange={(v) => setNumColors(v[0])} />
              <p className="text-[10px] editor-text-dim">More colors = more detail, larger file</p>
            </div>

            <div className="space-y-2">
              <div className="flex items-center justify-between text-xs">
                <Label className="editor-text-muted">Smoothing</Label>
                <span className="editor-text">{smoothing}</span>
              </div>
              <Slider value={[smoothing]} min={0} max={100} step={1} onValueChange={(v) => setSmoothing(v[0])} />
              <p className="text-[10px] editor-text-dim">Higher = smoother curves, less detail</p>
            </div>

            <div className="space-y-2">
              <div className="flex items-center justify-between text-xs">
                <Label className="editor-text-muted">Detail</Label>
                <span className="editor-text">{detail}</span>
              </div>
              <Slider value={[detail]} min={0} max={100} step={1} onValueChange={(v) => setDetail(v[0])} />
              <p className="text-[10px] editor-text-dim">Higher = keeps smaller regions</p>
            </div>

            <div className="space-y-2">
              <div className="flex items-center justify-between text-xs">
                <Label className="editor-text-muted">Pre-blur</Label>
                <span className="editor-text">{blurRadius.toFixed(1)}px</span>
              </div>
              <Slider value={[blurRadius * 10]} min={0} max={30} step={1} onValueChange={(v) => setBlurRadius(v[0] / 10)} />
              <p className="text-[10px] editor-text-dim">Smooths noise before tracing</p>
            </div>

            <div className="space-y-2 pt-2 border-t editor-border">
              <Label className="editor-text-muted text-xs">Output Mode</Label>
              <div className="grid grid-cols-2 gap-1.5">
                <button
                  onClick={() => setMode('new-layer')}
                  className={`px-2 py-1.5 rounded text-xs border transition-colors ${mode === 'new-layer' ? 'bg-sky-600 border-sky-500 text-white' : 'editor-surface-2 editor-border editor-text hover:editor-surface-3'}`}
                >
                  New Layer
                </button>
                <button
                  onClick={() => setMode('replace')}
                  className={`px-2 py-1.5 rounded text-xs border transition-colors ${mode === 'replace' ? 'bg-sky-600 border-sky-500 text-white' : 'editor-surface-2 editor-border editor-text hover:editor-surface-3'}`}
                >
                  Replace Layer
                </button>
              </div>
            </div>

            {result && (
              <div className="pt-2 border-t editor-border space-y-1">
                <div className="text-[10px] editor-text-dim uppercase tracking-wide">Result</div>
                <div className="text-xs editor-text">{result.paths.length} paths</div>
                <div className="text-xs editor-text">{result.palette.length} colors</div>
                <div className="flex flex-wrap gap-1 mt-2">
                  {result.palette.map((c, i) => (
                    <div key={i} className="w-5 h-5 rounded border editor-border" style={{ backgroundColor: c === 'transparent' ? 'transparent' : c }} title={c} />
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* Preview column */}
          <div className="flex-1 min-h-[300px] md:min-h-0 flex flex-col gap-2">
            <div className="text-xs editor-text-muted uppercase tracking-wide">Preview</div>
            <div
              ref={previewRef}
              className="flex-1 rounded border editor-border bg-white overflow-hidden flex items-center justify-center min-h-[250px]"
            >
              {!result && !isProcessing && (
                <div className="editor-text-muted text-sm text-center p-8">
                  <Wand2 size={32} className="mx-auto mb-2 opacity-50" />
                  Click "Vectorize" to convert the active layer to vector paths
                </div>
              )}
              {isProcessing && (
                <div className="editor-text-dim text-sm flex items-center gap-2">
                  <Loader2 size={16} className="animate-spin" />
                  Processing...
                </div>
              )}
            </div>
            {result && (
              <div className="text-[10px] editor-text-dim text-center">
                {result.width} × {result.height}px · SVG ready to export
              </div>
            )}
          </div>
        </div>

        <DialogFooter className="flex gap-2 sm:gap-2">
          <Button variant="ghost" onClick={onClose} className="editor-text hover:editor-surface-2">
            Cancel
          </Button>
          <Button
            onClick={handleVectorize}
            disabled={isProcessing}
            variant="secondary"
            className="editor-surface-2 hover:editor-surface-3 editor-text"
          >
            {isProcessing && !result ? <Loader2 size={14} className="mr-1 animate-spin" /> : <Wand2 size={14} className="mr-1" />}
            Vectorize
          </Button>
          {result && (
            <Button
              onClick={handleExportSVG}
              variant="secondary"
              className="bg-purple-600 hover:bg-purple-500 text-white"
            >
              <Download size={14} className="mr-1" /> Export SVG
            </Button>
          )}
          {result && (
            <Button
              onClick={handleApply}
              disabled={isProcessing}
              className="editor-accent-bg hover:editor-accent-bg text-white"
            >
              Apply to {mode === 'new-layer' ? 'New Layer' : 'Layer'}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
