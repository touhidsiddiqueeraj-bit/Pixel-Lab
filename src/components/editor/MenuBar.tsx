'use client';

import { useEditorStore } from '@/lib/editor-store';
import {
  Menubar,
  MenubarMenu,
  MenubarTrigger,
  MenubarContent,
  MenubarItem,
  MenubarSeparator,
} from '@/components/ui/menubar';
import { toast } from 'sonner';
import { useCallback, useRef } from 'react';
import {
  applyBrightnessContrast,
  applyHueSaturation,
  applyGrayscale,
  applyInvert,
  applySepia,
  applyThreshold,
  applyFastBlur,
  applySharpen,
  autoRemoveBackground,
  createBlankCanvas,
} from '@/lib/image-processing';

export function MenuBar({ onOpenNewDoc }: { onOpenNewDoc: () => void }) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const placeInputRef = useRef<HTMLInputElement>(null);

  const store = useEditorStore();
  const {
    layers,
    activeLayerId,
    docWidth,
    docHeight,
    docName,
    selectionMask,
    newDocument,
    addLayer,
    deleteLayer,
    duplicateLayer,
    mergeDown,
    mergeVisible,
    flattenImage,
    pushHistory,
    clearSelection,
    selectAll,
    invertSelection,
    undo,
    redo,
    setZoom,
    refreshThumbnail,
    replaceLayerCanvas,
    renameLayer,
  } = store;

  const getActiveLayer = useCallback(() => {
    return layers.find((l) => l.id === activeLayerId) ?? null;
  }, [layers, activeLayerId]);

  const handleOpenFile = useCallback(() => {
    fileInputRef.current?.click();
  }, []);

  const handleFileSelected = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      newDocument(img.naturalWidth, img.naturalHeight, '#ffffff');
      setTimeout(() => {
        const layerId = addLayer(file.name.replace(/\.[^/.]+$/, ''));
        const state = useEditorStore.getState();
        const layer = state.layers.find((l) => l.id === layerId);
        if (layer) {
          const ctx = layer.canvas.getContext('2d')!;
          ctx.drawImage(img, 0, 0);
          refreshThumbnail(layerId);
          pushHistory('Open Image');
        }
        URL.revokeObjectURL(url);
      }, 50);
    };
    img.src = url;
    e.target.value = '';
  }, [newDocument, addLayer, refreshThumbnail, pushHistory]);

  const handleExport = useCallback((format: 'png' | 'jpeg') => {
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
      ctx.drawImage(layer.canvas, 0, 0);
      ctx.restore();
    }
    const mime = format === 'png' ? 'image/png' : 'image/jpeg';
    const dataUrl = flat.toDataURL(mime, 0.95);
    const link = document.createElement('a');
    link.href = dataUrl;
    link.download = `${docName.replace(/\.[^/.]+$/, '')}.${format}`;
    link.click();
    toast.success(`Exported as ${format.toUpperCase()}`);
  }, [layers, docWidth, docHeight, docName]);

  const handlePlaceClick = useCallback(() => {
    placeInputRef.current?.click();
  }, []);

  const handlePlaceImage = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      const layerId = addLayer(file.name.replace(/\.[^/.]+$/, ''));
      const state = useEditorStore.getState();
      const layer = state.layers.find((l) => l.id === layerId);
      if (layer) {
        const ctx = layer.canvas.getContext('2d')!;
        ctx.drawImage(img, 0, 0);
        refreshThumbnail(layerId);
        pushHistory('Place Image');
      }
      URL.revokeObjectURL(url);
    };
    img.src = url;
    e.target.value = '';
  }, [addLayer, refreshThumbnail, pushHistory]);

  const runFilter = useCallback((label: string, fn: (ctx: CanvasRenderingContext2D, w: number, h: number) => void) => {
    const layer = getActiveLayer();
    if (!layer) {
      toast.error('No active layer');
      return;
    }
    if (layer.locked) {
      toast.error('Layer is locked');
      return;
    }
    const ctx = layer.canvas.getContext('2d')!;
    fn(ctx, layer.canvas.width, layer.canvas.height);
    refreshThumbnail(layer.id);
    pushHistory(label);
  }, [getActiveLayer, refreshThumbnail, pushHistory]);

  const handleAutoBgRemove = useCallback((tolerance: number) => {
    const layer = getActiveLayer();
    if (!layer) {
      toast.error('No active layer');
      return;
    }
    if (layer.locked) {
      toast.error('Layer is locked');
      return;
    }
    const result = autoRemoveBackground(layer.canvas, tolerance, 1);
    replaceLayerCanvas(layer.id, result);
    pushHistory('Auto Remove Background');
    toast.success('Background removed');
  }, [getActiveLayer, replaceLayerCanvas, pushHistory]);

  const itemClass = 'cursor-pointer flex justify-between items-center gap-4 hover:bg-sky-600 hover:text-white focus:bg-sky-600 focus:text-white';

  return (
    <div className="bg-zinc-900 border-b border-zinc-800 text-sm text-zinc-200 select-none px-2">
      <input ref={fileInputRef} type="file" accept="image/*" className="hidden" onChange={handleFileSelected} />
      <input ref={placeInputRef} type="file" accept="image/*" className="hidden" onChange={handlePlaceImage} />

      <Menubar className="bg-transparent border-0 shadow-none h-8 gap-0 p-0">
        {/* File menu */}
        <MenubarMenu>
          <MenubarTrigger className="px-3 h-8 text-sm cursor-pointer hover:bg-zinc-800 rounded-sm data-[highlighted]:bg-zinc-800 data-[state=open]:bg-zinc-800">
            File
          </MenubarTrigger>
          <MenubarContent className="bg-zinc-900 border-zinc-700 text-zinc-200 min-w-[220px]">
            <MenubarItem className={itemClass} onClick={onOpenNewDoc}>
              <span>New...</span><span className="text-xs text-zinc-500">Ctrl+N</span>
            </MenubarItem>
            <MenubarItem className={itemClass} onClick={handleOpenFile}>
              <span>Open...</span><span className="text-xs text-zinc-500">Ctrl+O</span>
            </MenubarItem>
            <MenubarItem className={itemClass} onClick={handlePlaceClick}>
              <span>Place Image...</span><span></span>
            </MenubarItem>
            <MenubarSeparator className="bg-zinc-700" />
            <MenubarItem className={itemClass} onClick={() => handleExport('png')}>
              <span>Export as PNG</span><span className="text-xs text-zinc-500">Ctrl+S</span>
            </MenubarItem>
            <MenubarItem className={itemClass} onClick={() => handleExport('jpeg')}>
              <span>Export as JPEG</span><span className="text-xs text-zinc-500">Ctrl+Shift+S</span>
            </MenubarItem>
          </MenubarContent>
        </MenubarMenu>

        {/* Edit menu */}
        <MenubarMenu>
          <MenubarTrigger className="px-3 h-8 text-sm cursor-pointer hover:bg-zinc-800 rounded-sm data-[state=open]:bg-zinc-800">
            Edit
          </MenubarTrigger>
          <MenubarContent className="bg-zinc-900 border-zinc-700 text-zinc-200 min-w-[220px]">
            <MenubarItem className={itemClass} onClick={undo} disabled={!useEditorStore.getState().canUndo()}>
              <span>Undo</span><span className="text-xs text-zinc-500">Ctrl+Z</span>
            </MenubarItem>
            <MenubarItem className={itemClass} onClick={redo} disabled={!useEditorStore.getState().canRedo()}>
              <span>Redo</span><span className="text-xs text-zinc-500">Ctrl+Y</span>
            </MenubarItem>
            <MenubarSeparator className="bg-zinc-700" />
            <MenubarItem className={itemClass} onClick={selectAll}>
              <span>Select All</span><span className="text-xs text-zinc-500">Ctrl+A</span>
            </MenubarItem>
            <MenubarItem className={itemClass} onClick={clearSelection} disabled={!selectionMask}>
              <span>Deselect</span><span className="text-xs text-zinc-500">Ctrl+D</span>
            </MenubarItem>
            <MenubarItem className={itemClass} onClick={invertSelection} disabled={!selectionMask}>
              <span>Inverse Selection</span><span className="text-xs text-zinc-500">Ctrl+Shift+I</span>
            </MenubarItem>
            <MenubarSeparator className="bg-zinc-700" />
            <MenubarItem className={itemClass} onClick={() => {
              const tol = prompt('Tolerance (0-100, default 32):', '32');
              if (tol === null) return;
              const n = parseInt(tol, 10);
              handleAutoBgRemove(isNaN(n) ? 32 : n);
            }}>
              <span>Auto Remove Background...</span><span></span>
            </MenubarItem>
          </MenubarContent>
        </MenubarMenu>

        {/* Image menu */}
        <MenubarMenu>
          <MenubarTrigger className="px-3 h-8 text-sm cursor-pointer hover:bg-zinc-800 rounded-sm data-[state=open]:bg-zinc-800">
            Image
          </MenubarTrigger>
          <MenubarContent className="bg-zinc-900 border-zinc-700 text-zinc-200 min-w-[220px]">
            <MenubarItem className={itemClass} onClick={() => {
              const b = prompt('Brightness (-100 to 100):', '0');
              const c = prompt('Contrast (-100 to 100):', '0');
              if (b === null || c === null) return;
              runFilter('Brightness/Contrast', (ctx, w, h) => applyBrightnessContrast(ctx, w, h, parseFloat(b) || 0, parseFloat(c) || 0));
            }}>
              <span>Brightness/Contrast...</span><span></span>
            </MenubarItem>
            <MenubarItem className={itemClass} onClick={() => {
              const h = prompt('Hue (-180 to 180):', '0');
              const s = prompt('Saturation (-100 to 100):', '0');
              const l = prompt('Lightness (-100 to 100):', '0');
              if (h === null || s === null || l === null) return;
              runFilter('Hue/Saturation', (ctx, w, hh) => applyHueSaturation(ctx, w, hh, parseFloat(h) || 0, parseFloat(s) || 0, parseFloat(l) || 0));
            }}>
              <span>Hue/Saturation...</span><span></span>
            </MenubarItem>
            <MenubarSeparator className="bg-zinc-700" />
            <MenubarItem className={itemClass} onClick={() => runFilter('Grayscale', (ctx, w, h) => applyGrayscale(ctx, w, h))}>
              <span>Grayscale</span><span></span>
            </MenubarItem>
            <MenubarItem className={itemClass} onClick={() => runFilter('Invert', (ctx, w, h) => applyInvert(ctx, w, h))}>
              <span>Invert</span><span></span>
            </MenubarItem>
            <MenubarItem className={itemClass} onClick={() => runFilter('Sepia', (ctx, w, h) => applySepia(ctx, w, h))}>
              <span>Sepia</span><span></span>
            </MenubarItem>
            <MenubarItem className={itemClass} onClick={() => {
              const t = prompt('Threshold level (0-255):', '128');
              if (t === null) return;
              runFilter('Threshold', (ctx, w, h) => applyThreshold(ctx, w, h, parseFloat(t) || 128));
            }}>
              <span>Threshold...</span><span></span>
            </MenubarItem>
          </MenubarContent>
        </MenubarMenu>

        {/* Layer menu */}
        <MenubarMenu>
          <MenubarTrigger className="px-3 h-8 text-sm cursor-pointer hover:bg-zinc-800 rounded-sm data-[state=open]:bg-zinc-800">
            Layer
          </MenubarTrigger>
          <MenubarContent className="bg-zinc-900 border-zinc-700 text-zinc-200 min-w-[220px]">
            <MenubarItem className={itemClass} onClick={() => { addLayer(); pushHistory('New Layer'); }}>
              <span>New Layer</span><span className="text-xs text-zinc-500">Ctrl+Shift+N</span>
            </MenubarItem>
            <MenubarItem className={itemClass} onClick={() => activeLayerId && duplicateLayer(activeLayerId)} disabled={!activeLayerId}>
              <span>Duplicate Layer</span><span></span>
            </MenubarItem>
            <MenubarItem className={itemClass} onClick={() => activeLayerId && deleteLayer(activeLayerId)} disabled={layers.length <= 1 || !activeLayerId}>
              <span>Delete Layer</span><span></span>
            </MenubarItem>
            <MenubarSeparator className="bg-zinc-700" />
            <MenubarItem className={itemClass} onClick={() => activeLayerId && mergeDown(activeLayerId)} disabled={!activeLayerId || layers.findIndex((l) => l.id === activeLayerId) <= 0}>
              <span>Merge Down</span><span className="text-xs text-zinc-500">Ctrl+E</span>
            </MenubarItem>
            <MenubarItem className={itemClass} onClick={mergeVisible}>
              <span>Merge Visible</span><span></span>
            </MenubarItem>
            <MenubarItem className={itemClass} onClick={flattenImage}>
              <span>Flatten Image</span><span></span>
            </MenubarItem>
            <MenubarSeparator className="bg-zinc-700" />
            <MenubarItem className={itemClass} onClick={() => {
              const layer = getActiveLayer();
              if (!layer) return;
              const name = prompt('Layer name:', layer.name);
              if (name !== null) {
                renameLayer(layer.id, name);
                pushHistory('Rename Layer');
              }
            }} disabled={!activeLayerId}>
              <span>Rename Layer...</span><span></span>
            </MenubarItem>
          </MenubarContent>
        </MenubarMenu>

        {/* Filter menu */}
        <MenubarMenu>
          <MenubarTrigger className="px-3 h-8 text-sm cursor-pointer hover:bg-zinc-800 rounded-sm data-[state=open]:bg-zinc-800">
            Filter
          </MenubarTrigger>
          <MenubarContent className="bg-zinc-900 border-zinc-700 text-zinc-200 min-w-[220px]">
            <MenubarItem className={itemClass} onClick={() => {
              const r = prompt('Blur radius (px):', '5');
              if (r === null) return;
              runFilter('Gaussian Blur', (ctx, w, h) => applyFastBlur(ctx, w, h, parseFloat(r) || 0));
            }}>
              <span>Gaussian Blur...</span><span></span>
            </MenubarItem>
            <MenubarItem className={itemClass} onClick={() => {
              const a = prompt('Sharpen amount (0-5):', '1');
              if (a === null) return;
              runFilter('Sharpen', (ctx, w, h) => applySharpen(ctx, w, h, Math.max(0, Math.min(5, parseFloat(a) || 0))));
            }}>
              <span>Sharpen...</span><span></span>
            </MenubarItem>
          </MenubarContent>
        </MenubarMenu>

        {/* View menu */}
        <MenubarMenu>
          <MenubarTrigger className="px-3 h-8 text-sm cursor-pointer hover:bg-zinc-800 rounded-sm data-[state=open]:bg-zinc-800">
            View
          </MenubarTrigger>
          <MenubarContent className="bg-zinc-900 border-zinc-700 text-zinc-200 min-w-[220px]">
            <MenubarItem className={itemClass} onClick={() => setZoom(useEditorStore.getState().zoom * 1.25)}>
              <span>Zoom In</span><span className="text-xs text-zinc-500">Ctrl++</span>
            </MenubarItem>
            <MenubarItem className={itemClass} onClick={() => setZoom(useEditorStore.getState().zoom / 1.25)}>
              <span>Zoom Out</span><span className="text-xs text-zinc-500">Ctrl+-</span>
            </MenubarItem>
            <MenubarItem className={itemClass} onClick={() => setZoom(1)}>
              <span>Actual Size (100%)</span><span></span>
            </MenubarItem>
          </MenubarContent>
        </MenubarMenu>
      </Menubar>
    </div>
  );
}
