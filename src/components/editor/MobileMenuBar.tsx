'use client';

/**
 * MobileMenuBar — compact horizontal command bar for phones.
 *
 * Replaces the old slide-out menu sheet, which embedded the desktop Radix
 * Menubar: on touch its dropdowns never opened (empty panel behind a scrim)
 * and the tab strip scrolled with a visible scrollbar. This bar is a single
 * floating pill docked under the title bar instead:
 *
 *   - Level 1: category chips (File / Image / Layer / Filter / Enhance /
 *     Vector / View) — all visible at once, horizontally scrollable with a
 *     hidden scrollbar.
 *   - Level 2: tapping a category swaps the chips in place for that
 *     category's actions plus a back chip. One tap runs the action with
 *     sensible defaults — no prompt() chains, no submenus.
 *
 * It overlays the canvas top edge (no scrim, canvas stays interactive) and
 * auto-closes after an action runs.
 */

import { useCallback, useState } from 'react';
import { useTheme } from 'next-themes';
import { toast } from 'sonner';
import {
  ArrowLeft, FilePlus2, FolderOpen, ImageDown, FileImage, FileUp,
  Scaling, RotateCw, FlipHorizontal, FlipVertical,
  Plus, Copy, Trash2, Merge, Layers2,
  Contrast, RefreshCcw, SunMedium, Aperture, Droplets, Grid3x3, Circle, Sparkle, Stamp, Palette,
  Wand2, Zap,
  Moon, Sun, Monitor, Keyboard, Spline,
} from 'lucide-react';
import {
  applyGrayscale, applyInvert, applySepia, applyFastBlur, applySharpen,
  medianDenoise, applyPixelate, applyVignette, applyEdgeDetect, applyEmboss,
  applyPosterize, autoRemoveBackground, autoUnblur, rotateCanvas, flipCanvas,
  scaleCanvas, createBlankCanvas, generateThumbnail, clampImageSize,
} from '@/lib/image-processing';
import { useEditorStore } from '@/lib/editor-store';
import { cn } from '@/lib/utils';
import { describeFileError, isNativeApp, pickImageFromLibrary, saveCanvasImage } from '@/lib/file-io';

type Category = 'root' | 'file' | 'image' | 'layer' | 'filter' | 'enhance' | 'vector' | 'view';

interface MobileMenuBarProps {
  onClose: () => void;
  onOpenNewDoc: () => void;
  onOpenFigmaImport: () => void;
  onOpenShortcuts: () => void;
}

function sanitizeFileName(name: string): string {
  const cleaned = name.replace(/[\\/:*?"<>|\r\n\t]/g, '_').trim();
  return cleaned || 'untitled';
}

export function MobileMenuBar({ onClose, onOpenNewDoc, onOpenFigmaImport, onOpenShortcuts }: MobileMenuBarProps) {
  const [category, setCategory] = useState<Category>('root');
  const { theme, setTheme } = useTheme();

  const close = useCallback(() => {
    setCategory('root');
    onClose();
  }, [onClose]);

  // Run an action and dismiss the bar — one tap, one result.
  const run = useCallback((fn: () => void) => {
    fn();
    close();
  }, [close]);

  const getActiveLayer = () => {
    const state = useEditorStore.getState();
    return state.layers.find((l) => l.id === state.activeLayerId) ?? null;
  };

  const guardLayer = () => {
    const layer = getActiveLayer();
    if (!layer) { toast.error('No active layer'); return null; }
    if (layer.locked) { toast.error('Layer is locked'); return null; }
    return layer;
  };

  const runFilter = (label: string, fn: (ctx: CanvasRenderingContext2D, w: number, h: number) => void) => {
    const layer = guardLayer();
    if (!layer) return;
    const ctx = layer.canvas.getContext('2d')!;
    fn(ctx, layer.canvas.width, layer.canvas.height);
    useEditorStore.getState().refreshThumbnail(layer.id);
    useEditorStore.getState().pushHistory(label);
  };

  const exportAs = async (format: 'png' | 'jpeg' | 'webp') => {
    try {
      const { layers, docWidth, docHeight, docName } = useEditorStore.getState();
      const flat = createBlankCanvas(docWidth, docHeight);
      const ctx = flat.getContext('2d')!;
      if (format === 'jpeg') {
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, docWidth, docHeight);
      }
      for (const layer of layers) {
        if (!layer.visible) continue;
        ctx.save();
        ctx.globalAlpha = layer.opacity;
        ctx.globalCompositeOperation = layer.blendMode;
        if (layer.maskCanvas && layer.maskEnabled) {
          const tmp = createBlankCanvas(docWidth, docHeight);
          const tmpCtx = tmp.getContext('2d')!;
          tmpCtx.drawImage(layer.canvas, 0, 0);
          tmpCtx.globalCompositeOperation = 'destination-in';
          tmpCtx.drawImage(layer.maskCanvas, 0, 0);
          ctx.drawImage(tmp, 0, 0);
        } else {
          ctx.drawImage(layer.canvas, 0, 0);
        }
        ctx.restore();
      }
      const mime = format === 'png' ? 'image/png' : format === 'jpeg' ? 'image/jpeg' : 'image/webp';
      const fileName = `${sanitizeFileName(docName.replace(/\.[^/.]+$/, ''))}.${format}`;
      // Native shell: a.download is silently dropped by the Android WebView
      // (no DownloadListener), so writes go through the Filesystem plugin into
      // the public Documents folder instead.
      const result = await saveCanvasImage(flat, mime, 0.95, fileName);
      toast.success(
        isNativeApp()
          ? `Saved to ${result.where}`
          : `Exported as ${format.toUpperCase()}`,
      );
    } catch (e) {
      toast.error(describeFileError(e));
    }
  };

  const transform = (op: 'rotate90' | 'rotate180' | 'flipH' | 'flipV') => {
    const layer = guardLayer();
    if (!layer) return;
    let newCanvas: HTMLCanvasElement;
    switch (op) {
      case 'rotate90': newCanvas = rotateCanvas(layer.canvas, 90); break;
      case 'rotate180': newCanvas = rotateCanvas(layer.canvas, 180); break;
      case 'flipH': newCanvas = flipCanvas(layer.canvas, true); break;
      case 'flipV': newCanvas = flipCanvas(layer.canvas, false); break;
    }
    const state = useEditorStore.getState();
    state.replaceLayerCanvas(layer.id, newCanvas);
    state.pushHistory(`Transform: ${op}`);
  };

  const resizeDoc = () => {
    const { docWidth, docHeight } = useEditorStore.getState();
    const w = prompt('New width (px):', String(docWidth));
    if (w === null) return;
    const h = prompt('New height (px):', String(docHeight));
    if (h === null) return;
    let newW = parseInt(w, 10);
    let newH = parseInt(h, 10);
    if (isNaN(newW) || isNaN(newH) || newW < 1 || newH < 1) {
      toast.error('Invalid dimensions');
      return;
    }
    ({ w: newW, h: newH } = clampImageSize(newW, newH));
    const state = useEditorStore.getState();
    const newLayers = state.layers.map((l) => {
      const newCanvas = scaleCanvas(l.canvas, newW, newH);
      const maskCanvas = l.maskCanvas ? scaleCanvas(l.maskCanvas, newW, newH) : l.maskCanvas;
      return { ...l, canvas: newCanvas, maskCanvas, thumbnail: generateThumbnail(newCanvas) };
    });
    useEditorStore.setState({
      layers: newLayers,
      docWidth: newW,
      docHeight: newH,
      selectionMask: null,
      selectionBounds: null,
    });
    state.pushHistory(`Resize to ${newW}x${newH}`);
    toast.success(`Resized to ${newW}×${newH}`);
  };

  const cycleTheme = () => {
    setTheme(theme === 'dark' ? 'light' : theme === 'light' ? 'system' : 'dark');
  };

  // Render helper (NOT a nested component — a capitalized component created
  // during render would remount and lose state on every parent render).
  const chip = (args: { key: string; icon: React.ReactNode; label: string; onClick: () => void; keepsOpen?: boolean }): React.ReactNode => (
    <button
      key={args.key}
      onClick={args.keepsOpen ? args.onClick : () => run(args.onClick)}
      className="h-9 px-3 rounded-xl flex items-center gap-1.5 text-xs font-medium whitespace-nowrap shrink-0 editor-text active:bg-[var(--editor-surface-3)] hover:bg-[var(--editor-surface-3)] transition-colors"
    >
      {args.icon}
      <span>{args.label}</span>
    </button>
  );

  const categoryChips: { key: Category; icon: React.ReactNode; label: string }[] = [
    { key: 'file', icon: <FilePlus2 size={15} />, label: 'File' },
    { key: 'image', icon: <ImageDown size={15} />, label: 'Image' },
    { key: 'layer', icon: <Layers2 size={15} />, label: 'Layer' },
    { key: 'filter', icon: <Sparkle size={15} />, label: 'Filter' },
    { key: 'enhance', icon: <Wand2 size={15} />, label: 'Enhance' },
    { key: 'vector', icon: <Spline size={15} />, label: 'Vector' },
    { key: 'view', icon: <Aperture size={15} />, label: 'View' },
  ];

  const backChip = (
    <button
      onClick={() => setCategory('root')}
      aria-label="Back to categories"
      className="h-9 w-9 rounded-xl flex items-center justify-center shrink-0 editor-accent-bg text-white"
    >
      <ArrowLeft size={15} />
    </button>
  );

  const actions: Record<Exclude<Category, 'root'>, React.ReactNode[]> = {
    file: [
      chip({ key: 'new', icon: <FilePlus2 size={15} />, label: 'New…', onClick: () => { onOpenNewDoc(); close(); } }),
      // Native shell: launches the Android Photo Picker (no permission
      // needed on any Android version). Web: transient file input.
      chip({
        key: 'open',
        icon: <FolderOpen size={15} />, label: 'Open Image…',
        onClick: () => {
          void pickImageFromLibrary()
            .then((res) => {
              if (!res) return;
              useEditorStore.getState().openImage(res.img, res.name, 'Open Photo');
            })
            .catch((e) => toast.error(describeFileError(e)));
        },
      }),
      chip({ key: 'png', icon: <ImageDown size={15} />, label: 'Save PNG', onClick: () => exportAs('png') }),
      chip({ key: 'jpg', icon: <FileImage size={15} />, label: 'Save JPG', onClick: () => exportAs('jpeg') }),
      chip({ key: 'webp', icon: <FileUp size={15} />, label: 'Save WebP', onClick: () => exportAs('webp') }),
    ],
    image: [
      chip({ key: 'resize', icon: <Scaling size={15} />, label: 'Resize…', onClick: resizeDoc }),
      chip({ key: 'rot90', icon: <RotateCw size={15} />, label: 'Rotate 90°', onClick: () => transform('rotate90') }),
      chip({ key: 'rot180', icon: <RotateCw size={15} />, label: 'Rotate 180°', onClick: () => transform('rotate180') }),
      chip({ key: 'flipH', icon: <FlipHorizontal size={15} />, label: 'Flip H', onClick: () => transform('flipH') }),
      chip({ key: 'flipV', icon: <FlipVertical size={15} />, label: 'Flip V', onClick: () => transform('flipV') }),
    ],
    layer: [
      chip({ key: 'add', icon: <Plus size={15} />, label: 'Add Layer', onClick: () => { const s = useEditorStore.getState(); s.addLayer(); s.pushHistory('New Layer'); } }),
      chip({ key: 'dup', icon: <Copy size={15} />, label: 'Duplicate', onClick: () => { const s = useEditorStore.getState(); if (s.activeLayerId) s.duplicateLayer(s.activeLayerId); } }),
      chip({ key: 'del', icon: <Trash2 size={15} />, label: 'Delete', onClick: () => { const s = useEditorStore.getState(); if (s.activeLayerId && s.layers.length > 1) s.deleteLayer(s.activeLayerId); } }),
      chip({ key: 'merge', icon: <Merge size={15} />, label: 'Merge Down', onClick: () => { const s = useEditorStore.getState(); if (s.activeLayerId) s.mergeDown(s.activeLayerId); } }),
      chip({ key: 'flat', icon: <Layers2 size={15} />, label: 'Flatten', onClick: () => useEditorStore.getState().flattenImage() }),
    ],
    filter: [
      chip({ key: 'gray', icon: <Contrast size={15} />, label: 'Grayscale', onClick: () => runFilter('Grayscale', (ctx, w, h) => applyGrayscale(ctx, w, h)) }),
      chip({ key: 'invert', icon: <RefreshCcw size={15} />, label: 'Invert', onClick: () => runFilter('Invert', (ctx, w, h) => applyInvert(ctx, w, h)) }),
      chip({ key: 'sepia', icon: <SunMedium size={15} />, label: 'Sepia', onClick: () => runFilter('Sepia', (ctx, w, h) => applySepia(ctx, w, h)) }),
      chip({ key: 'blur', icon: <Droplets size={15} />, label: 'Blur', onClick: () => runFilter('Gaussian Blur', (ctx, w, h) => applyFastBlur(ctx, w, h, 5)) }),
      chip({ key: 'sharp', icon: <Grid3x3 size={15} />, label: 'Sharpen', onClick: () => runFilter('Sharpen', (ctx, w, h) => applySharpen(ctx, w, h, 1)) }),
      chip({ key: 'denoise', icon: <Droplets size={15} />, label: 'Denoise', onClick: () => runFilter('Denoise', (ctx, w, h) => medianDenoise(ctx, w, h, 1)) }),
      chip({ key: 'pixel', icon: <Grid3x3 size={15} />, label: 'Pixelate', onClick: () => runFilter('Pixelate', (ctx, w, h) => applyPixelate(ctx, w, h, 8)) }),
      chip({ key: 'vig', icon: <Circle size={15} />, label: 'Vignette', onClick: () => runFilter('Vignette', (ctx, w, h) => applyVignette(ctx, w, h, 50, 50)) }),
      chip({ key: 'edge', icon: <Stamp size={15} />, label: 'Edge Detect', onClick: () => runFilter('Edge Detect', (ctx, w, h) => applyEdgeDetect(ctx, w, h)) }),
      chip({ key: 'emboss', icon: <Stamp size={15} />, label: 'Emboss', onClick: () => runFilter('Emboss', (ctx, w, h) => applyEmboss(ctx, w, h)) }),
      chip({ key: 'poster', icon: <Palette size={15} />, label: 'Posterize', onClick: () => runFilter('Posterize', (ctx, w, h) => applyPosterize(ctx, w, h, 4)) }),
    ],
    enhance: [
      chip({ key: 'bg', icon: <Wand2 size={15} />, label: 'Remove Background', onClick: () => {
        const layer = guardLayer();
        if (!layer) return;
        const result = autoRemoveBackground(layer.canvas, 30, 1);
        const s = useEditorStore.getState();
        s.replaceLayerCanvas(layer.id, result);
        s.pushHistory('Auto Remove Background');
        toast.success('Background removed');
      } }),
      chip({ key: 'unblur', icon: <Zap size={15} />, label: 'Auto Unblur', onClick: () => {
        const layer = guardLayer();
        if (!layer) return;
        const ctx = layer.canvas.getContext('2d')!;
        const tid = toast.loading('Deblurring image...');
        setTimeout(() => {
          try {
            autoUnblur(ctx, layer.canvas.width, layer.canvas.height, 60, 1.5, 2);
            const s = useEditorStore.getState();
            s.refreshThumbnail(layer.id);
            s.pushHistory('Auto Unblur');
            toast.success('Image deblurred', { id: tid });
          } catch {
            toast.error('Failed to deblur image', { id: tid });
          }
        }, 50);
      } }),
    ],
    vector: [
      chip({ key: 'vec', icon: <Spline size={15} />, label: 'Vectorize…', onClick: () => { window.dispatchEvent(new CustomEvent('open-vectorize-dialog')); close(); } }),
      chip({ key: 'figma', icon: <FolderOpen size={15} />, label: 'Import from Figma…', onClick: () => { onOpenFigmaImport(); close(); } }),
    ],
    view: [
      chip({ key: 'theme', icon: theme === 'dark' ? <Moon size={15} /> : theme === 'light' ? <Sun size={15} /> : <Monitor size={15} />,
        label: `Theme: ${theme === 'dark' ? 'Dark' : theme === 'light' ? 'Light' : 'System'}`, onClick: cycleTheme, keepsOpen: true }),
      chip({ key: 'keys', icon: <Keyboard size={15} />, label: 'Shortcuts', onClick: () => { onOpenShortcuts(); close(); } }),
    ],
  };

  return (
    <div
      className="absolute top-2 left-2 right-2 z-30 animate-in fade-in slide-in-from-top-2 duration-150"
      role="toolbar"
      aria-label="Menu commands"
    >
      <div className="editor-glass backdrop-blur border editor-border rounded-2xl shadow-lg no-select">
        <div className="flex items-center gap-1 p-1.5 overflow-x-auto hide-scrollbar">
          {category === 'root' ? (
            categoryChips.map((c) => (
              <button
                key={c.key}
                onClick={() => setCategory(c.key)}
                className="h-9 px-3.5 rounded-xl flex items-center gap-1.5 text-xs font-medium whitespace-nowrap shrink-0 editor-text hover:bg-[var(--editor-surface-3)] active:bg-[var(--editor-surface-3)] transition-colors"
              >
                {c.icon}
                <span>{c.label}</span>
              </button>
            ))
          ) : (
            <>
              {backChip}
              {actions[category]}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
