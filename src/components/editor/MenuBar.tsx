'use client';

import { useEditorStore } from '@/lib/editor-store';
import {
  Menubar,
  MenubarMenu,
  MenubarTrigger,
  MenubarContent,
  MenubarItem,
  MenubarSeparator,
  MenubarSub,
  MenubarSubTrigger,
  MenubarSubContent,
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
  autoUnblur,
  addNoise,
  medianDenoise,
  applyVignette,
  applyEdgeDetect,
  applyEmboss,
  applyPixelate,
  applyPosterize,
  applyColorTemperature,
  rotateCanvas,
  flipCanvas,
  scaleCanvas,
  createBlankCanvas,
  generateThumbnail,
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

  const handleAutoUnblur = useCallback((strength: number, radius: number, threshold: number) => {
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
    const tid = toast.loading('Deblurring image...');
    setTimeout(() => {
      try {
        autoUnblur(ctx, layer.canvas.width, layer.canvas.height, strength, radius, threshold);
        refreshThumbnail(layer.id);
        pushHistory('Auto Unblur');
        toast.success('Image deblurred', { id: tid });
      } catch (e) {
        toast.error('Failed to deblur image', { id: tid });
      }
    }, 50);
  }, [getActiveLayer, refreshThumbnail, pushHistory]);

  // Transform: rotate/flip the active layer's canvas
  const handleTransform = useCallback((op: 'rotate90' | 'rotate180' | 'rotate270' | 'flipH' | 'flipV') => {
    const layer = getActiveLayer();
    if (!layer) {
      toast.error('No active layer');
      return;
    }
    if (layer.locked) {
      toast.error('Layer is locked');
      return;
    }
    let newCanvas: HTMLCanvasElement;
    switch (op) {
      case 'rotate90': newCanvas = rotateCanvas(layer.canvas, 90); break;
      case 'rotate180': newCanvas = rotateCanvas(layer.canvas, 180); break;
      case 'rotate270': newCanvas = rotateCanvas(layer.canvas, 270); break;
      case 'flipH': newCanvas = flipCanvas(layer.canvas, true); break;
      case 'flipV': newCanvas = flipCanvas(layer.canvas, false); break;
    }
    replaceLayerCanvas(layer.id, newCanvas);
    pushHistory(`Transform: ${op}`);
  }, [getActiveLayer, replaceLayerCanvas, pushHistory]);

  // Resize the whole document
  const handleResizeDoc = useCallback(() => {
    const w = prompt('New width (px):', String(docWidth));
    if (w === null) return;
    const h = prompt('New height (px):', String(docHeight));
    if (h === null) return;
    const newW = parseInt(w, 10);
    const newH = parseInt(h, 10);
    if (isNaN(newW) || isNaN(newH) || newW < 1 || newH < 1) {
      toast.error('Invalid dimensions');
      return;
    }
    const state = useEditorStore.getState();
    const newLayers = state.layers.map((l) => {
      const newCanvas = scaleCanvas(l.canvas, newW, newH);
      return { ...l, canvas: newCanvas, thumbnail: generateThumbnail(newCanvas) };
    });
    useEditorStore.setState({ layers: newLayers, docWidth: newW, docHeight: newH });
    pushHistory(`Resize to ${newW}x${newH}`);
    toast.success(`Resized to ${newW}×${newH}`);
  }, [docWidth, docHeight, pushHistory]);

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
            {/* Select Modify submenu */}
            <MenubarSub>
              <MenubarSubTrigger className="cursor-pointer hover:bg-sky-600 hover:text-white data-[highlighted]:bg-sky-600 data-[highlighted]:text-white">
                Modify Selection
              </MenubarSubTrigger>
              <MenubarSubContent className="bg-zinc-900 border-zinc-700 text-zinc-200 min-w-[200px]">
                <MenubarItem className={itemClass} onClick={() => {
                  const r = prompt('Feather radius (px):', '5');
                  if (r === null) return;
                  store.featherSelection(parseFloat(r) || 0);
                }} disabled={!selectionMask}>
                  <span>Feather...</span><span></span>
                </MenubarItem>
                <MenubarItem className={itemClass} onClick={() => {
                  const r = prompt('Expand by (px):', '5');
                  if (r === null) return;
                  store.expandSelection(parseFloat(r) || 0);
                }} disabled={!selectionMask}>
                  <span>Expand...</span><span></span>
                </MenubarItem>
                <MenubarItem className={itemClass} onClick={() => {
                  const r = prompt('Contract by (px):', '5');
                  if (r === null) return;
                  store.contractSelection(parseFloat(r) || 0);
                }} disabled={!selectionMask}>
                  <span>Contract...</span><span></span>
                </MenubarItem>
              </MenubarSubContent>
            </MenubarSub>
            <MenubarSeparator className="bg-zinc-700" />
            <MenubarItem className={itemClass} onClick={() => {
              const s = prompt('Unblur strength (0-100, default 60):', '60');
              if (s === null) return;
              const r = prompt('Radius (0.1-5.0, default 1.5):', '1.5');
              if (r === null) return;
              const t = prompt('Threshold (0-30, default 2):', '2');
              if (t === null) return;
              handleAutoUnblur(
                Math.max(0, Math.min(100, parseFloat(s) || 60)),
                Math.max(0.1, Math.min(5, parseFloat(r) || 1.5)),
                Math.max(0, Math.min(30, parseFloat(t) || 2)),
              );
            }}>
              <span>Auto Unblur (Deconvolution)...</span><span></span>
            </MenubarItem>
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
            <MenubarItem className={itemClass} onClick={handleResizeDoc}>
              <span>Image Size...</span><span className="text-xs text-zinc-500">Ctrl+Alt+I</span>
            </MenubarItem>
            {/* Transform submenu */}
            <MenubarSub>
              <MenubarSubTrigger className="cursor-pointer hover:bg-sky-600 hover:text-white data-[highlighted]:bg-sky-600 data-[highlighted]:text-white">
                Transform
              </MenubarSubTrigger>
              <MenubarSubContent className="bg-zinc-900 border-zinc-700 text-zinc-200 min-w-[200px]">
                <MenubarItem className={itemClass} onClick={() => handleTransform('rotate90')}>
                  <span>Rotate 90° CW</span><span></span>
                </MenubarItem>
                <MenubarItem className={itemClass} onClick={() => handleTransform('rotate180')}>
                  <span>Rotate 180°</span><span></span>
                </MenubarItem>
                <MenubarItem className={itemClass} onClick={() => handleTransform('rotate270')}>
                  <span>Rotate 90° CCW</span><span></span>
                </MenubarItem>
                <MenubarSeparator className="bg-zinc-700" />
                <MenubarItem className={itemClass} onClick={() => handleTransform('flipH')}>
                  <span>Flip Horizontal</span><span></span>
                </MenubarItem>
                <MenubarItem className={itemClass} onClick={() => handleTransform('flipV')}>
                  <span>Flip Vertical</span><span></span>
                </MenubarItem>
              </MenubarSubContent>
            </MenubarSub>
            <MenubarSeparator className="bg-zinc-700" />
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
            {/* Layer Effects submenu */}
            <MenubarSub>
              <MenubarSubTrigger className="cursor-pointer hover:bg-sky-600 hover:text-white data-[highlighted]:bg-sky-600 data-[highlighted]:text-white">
                Layer Effects
              </MenubarSubTrigger>
              <MenubarSubContent className="bg-zinc-900 border-zinc-700 text-zinc-200 min-w-[220px]">
                <MenubarItem className={itemClass} onClick={() => {
                  const layer = getActiveLayer();
                  if (!layer || layer.locked) { toast.error('No active layer or layer locked'); return; }
                  const color = prompt('Shadow color (hex):', '#000000');
                  if (color === null) return;
                  const offset = prompt('Offset (px, e.g. 5):', '5');
                  if (offset === null) return;
                  const blur = prompt('Blur (px, e.g. 10):', '10');
                  if (blur === null) return;
                  const opacity = prompt('Opacity (0-100):', '60');
                  if (opacity === null) return;
                  applyDropShadow(layer, color, parseFloat(offset) || 5, parseFloat(blur) || 10, parseFloat(opacity) / 100 || 0.6);
                  refreshThumbnail(layer.id);
                  pushHistory('Drop Shadow');
                }} disabled={!activeLayerId}>
                  <span>Drop Shadow...</span><span></span>
                </MenubarItem>
                <MenubarItem className={itemClass} onClick={() => {
                  const layer = getActiveLayer();
                  if (!layer || layer.locked) { toast.error('No active layer or layer locked'); return; }
                  const color = prompt('Stroke color (hex):', '#ff0000');
                  if (color === null) return;
                  const width = prompt('Stroke width (px):', '3');
                  if (width === null) return;
                  applyStrokeEffect(layer, color, parseFloat(width) || 3);
                  refreshThumbnail(layer.id);
                  pushHistory('Stroke Effect');
                }} disabled={!activeLayerId}>
                  <span>Stroke...</span><span></span>
                </MenubarItem>
                <MenubarItem className={itemClass} onClick={() => {
                  const layer = getActiveLayer();
                  if (!layer || layer.locked) { toast.error('No active layer or layer locked'); return; }
                  const color = prompt('Glow color (hex):', '#00ffff');
                  if (color === null) return;
                  const blur = prompt('Glow size (px):', '15');
                  if (blur === null) return;
                  const opacity = prompt('Opacity (0-100):', '80');
                  if (opacity === null) return;
                  applyGlowEffect(layer, color, parseFloat(blur) || 15, parseFloat(opacity) / 100);
                  refreshThumbnail(layer.id);
                  pushHistory('Outer Glow');
                }} disabled={!activeLayerId}>
                  <span>Outer Glow...</span><span></span>
                </MenubarItem>
              </MenubarSubContent>
            </MenubarSub>
          </MenubarContent>
        </MenubarMenu>

        {/* Filter menu */}
        <MenubarMenu>
          <MenubarTrigger className="px-3 h-8 text-sm cursor-pointer hover:bg-zinc-800 rounded-sm data-[state=open]:bg-zinc-800">
            Filter
          </MenubarTrigger>
          <MenubarContent className="bg-zinc-900 border-zinc-700 text-zinc-200 min-w-[220px]">
            <MenubarItem className={itemClass} onClick={() => handleAutoUnblur(60, 1.5, 2)}>
              <span>Auto Unblur (Quick)</span><span className="text-xs text-zinc-500">Ctrl+Shift+U</span>
            </MenubarItem>
            <MenubarItem className={itemClass} onClick={() => {
              const s = prompt('Unblur strength (0-100, default 60):', '60');
              if (s === null) return;
              const r = prompt('Radius (0.1-5.0, default 1.5):', '1.5');
              if (r === null) return;
              const t = prompt('Threshold (0-30, default 2):', '2');
              if (t === null) return;
              handleAutoUnblur(
                Math.max(0, Math.min(100, parseFloat(s) || 60)),
                Math.max(0.1, Math.min(5, parseFloat(r) || 1.5)),
                Math.max(0, Math.min(30, parseFloat(t) || 2)),
              );
            }}>
              <span>Auto Unblur (Custom)...</span><span></span>
            </MenubarItem>
            <MenubarSeparator className="bg-zinc-700" />
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
            <MenubarItem className={itemClass} onClick={() => runFilter('Denoise', (ctx, w, h) => medianDenoise(ctx, w, h, 1))}>
              <span>Denoise (Median)</span><span></span>
            </MenubarItem>
            <MenubarSeparator className="bg-zinc-700" />
            <MenubarItem className={itemClass} onClick={() => {
              const a = prompt('Noise amount (0-100):', '15');
              if (a === null) return;
              runFilter('Add Noise', (ctx, w, h) => addNoise(ctx, w, h, parseFloat(a) || 0));
            }}>
              <span>Add Noise...</span><span></span>
            </MenubarItem>
            <MenubarItem className={itemClass} onClick={() => {
              const amt = prompt('Vignette amount (0-100):', '50');
              if (amt === null) return;
              const sz = prompt('Vignette size (0-100):', '50');
              if (sz === null) return;
              runFilter('Vignette', (ctx, w, h) => applyVignette(ctx, w, h, parseFloat(amt) || 50, parseFloat(sz) || 50));
            }}>
              <span>Vignette...</span><span></span>
            </MenubarItem>
            <MenubarSeparator className="bg-zinc-700" />
            <MenubarItem className={itemClass} onClick={() => runFilter('Edge Detect', (ctx, w, h) => applyEdgeDetect(ctx, w, h))}>
              <span>Edge Detect (Sobel)</span><span></span>
            </MenubarItem>
            <MenubarItem className={itemClass} onClick={() => runFilter('Emboss', (ctx, w, h) => applyEmboss(ctx, w, h))}>
              <span>Emboss</span><span></span>
            </MenubarItem>
            <MenubarItem className={itemClass} onClick={() => {
              const bs = prompt('Block size (2-50):', '8');
              if (bs === null) return;
              runFilter('Pixelate', (ctx, w, h) => applyPixelate(ctx, w, h, Math.max(2, Math.min(50, parseFloat(bs) || 8))));
            }}>
              <span>Pixelate...</span><span></span>
            </MenubarItem>
            <MenubarItem className={itemClass} onClick={() => {
              const lv = prompt('Levels (2-32):', '4');
              if (lv === null) return;
              runFilter('Posterize', (ctx, w, h) => applyPosterize(ctx, w, h, Math.max(2, Math.min(32, parseFloat(lv) || 4))));
            }}>
              <span>Posterize...</span><span></span>
            </MenubarItem>
            <MenubarItem className={itemClass} onClick={() => {
              const t = prompt('Temperature (-100 cool to 100 warm):', '20');
              if (t === null) return;
              runFilter('Color Temperature', (ctx, w, h) => applyColorTemperature(ctx, w, h, parseFloat(t) || 0));
            }}>
              <span>Color Temperature...</span><span></span>
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

// ============================================================================
// LAYER EFFECT HELPERS
// ============================================================================

// Find the bounding box of non-transparent pixels in a layer canvas
function getLayerContentBounds(canvas: HTMLCanvasElement): { x: number; y: number; w: number; h: number } | null {
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
  const w = canvas.width, h = canvas.height;
  const imageData = ctx.getImageData(0, 0, w, h);
  const data = imageData.data;
  let minX = w, minY = h, maxX = -1, maxY = -1;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (data[(y * w + x) * 4 + 3] > 0) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }
  if (maxX < 0) return null;
  return { x: minX, y: minY, w: maxX - minX + 1, h: maxY - minY + 1 };
}

// Apply a drop shadow to a layer (destructive - bakes shadow into the layer)
function applyDropShadow(layer: { canvas: HTMLCanvasElement }, color: string, offset: number, blur: number, opacity: number) {
  const w = layer.canvas.width, h = layer.canvas.height;
  // Create a shadow canvas: copy the layer's alpha shape, fill with shadow color, offset and blur
  const shadowCanvas = document.createElement('canvas');
  shadowCanvas.width = w; shadowCanvas.height = h;
  const sCtx = shadowCanvas.getContext('2d')!;
  sCtx.drawImage(layer.canvas, 0, 0);
  // Recolor to shadow color
  sCtx.globalCompositeOperation = 'source-in';
  sCtx.fillStyle = color;
  sCtx.fillRect(0, 0, w, h);
  // Apply blur
  if (blur > 0) {
    sCtx.filter = `blur(${blur}px)`;
    // Re-blur by drawing onto itself with filter
    const tmp = document.createElement('canvas');
    tmp.width = w; tmp.height = h;
    const tCtx = tmp.getContext('2d')!;
    tCtx.filter = `blur(${blur}px)`;
    tCtx.drawImage(shadowCanvas, 0, 0);
    sCtx.clearRect(0, 0, w, h);
    sCtx.filter = 'none';
    sCtx.drawImage(tmp, 0, 0);
  }
  // Now draw the shadow first (offset), then the original layer on top
  const ctx = layer.canvas.getContext('2d')!;
  // Save the original
  const origCanvas = document.createElement('canvas');
  origCanvas.width = w; origCanvas.height = h;
  origCanvas.getContext('2d')!.drawImage(layer.canvas, 0, 0);
  // Clear and redraw with shadow
  ctx.clearRect(0, 0, w, h);
  ctx.save();
  ctx.globalAlpha = opacity;
  ctx.drawImage(shadowCanvas, offset, offset);
  ctx.restore();
  ctx.drawImage(origCanvas, 0, 0);
}

// Apply a stroke (outline) effect to a layer
function applyStrokeEffect(layer: { canvas: HTMLCanvasElement }, color: string, width: number) {
  const w = layer.canvas.width, h = layer.canvas.height;
  const ctx = layer.canvas.getContext('2d')!;
  // Save original
  const origCanvas = document.createElement('canvas');
  origCanvas.width = w; origCanvas.height = h;
  origCanvas.getContext('2d')!.drawImage(layer.canvas, 0, 0);
  // Create a dilated version
  const strokeCanvas = document.createElement('canvas');
  strokeCanvas.width = w; strokeCanvas.height = h;
  const sCtx = strokeCanvas.getContext('2d')!;
  // Draw the alpha shape multiple times with offsets to dilate
  for (let dy = -width; dy <= width; dy++) {
    for (let dx = -width; dx <= width; dx++) {
      if (dx * dx + dy * dy > width * width) continue;
      sCtx.drawImage(origCanvas, dx, dy);
    }
  }
  // Recolor to stroke color
  sCtx.globalCompositeOperation = 'source-in';
  sCtx.fillStyle = color;
  sCtx.fillRect(0, 0, w, h);
  // Draw stroke first, then original on top
  ctx.clearRect(0, 0, w, h);
  ctx.drawImage(strokeCanvas, 0, 0);
  ctx.drawImage(origCanvas, 0, 0);
}

// Apply an outer glow effect to a layer
function applyGlowEffect(layer: { canvas: HTMLCanvasElement }, color: string, size: number, opacity: number) {
  const w = layer.canvas.width, h = layer.canvas.height;
  // Create a glow canvas
  const glowCanvas = document.createElement('canvas');
  glowCanvas.width = w; glowCanvas.height = h;
  const gCtx = glowCanvas.getContext('2d')!;
  gCtx.drawImage(layer.canvas, 0, 0);
  // Recolor to glow color
  gCtx.globalCompositeOperation = 'source-in';
  gCtx.fillStyle = color;
  gCtx.fillRect(0, 0, w, h);
  // Apply blur for glow
  if (size > 0) {
    const tmp = document.createElement('canvas');
    tmp.width = w; tmp.height = h;
    const tCtx = tmp.getContext('2d')!;
    tCtx.filter = `blur(${size}px)`;
    tCtx.drawImage(glowCanvas, 0, 0);
    gCtx.clearRect(0, 0, w, h);
    gCtx.filter = 'none';
    gCtx.drawImage(tmp, 0, 0);
  }
  // Draw glow first, then original on top
  const ctx = layer.canvas.getContext('2d')!;
  const origCanvas = document.createElement('canvas');
  origCanvas.width = w; origCanvas.height = h;
  origCanvas.getContext('2d')!.drawImage(layer.canvas, 0, 0);
  ctx.clearRect(0, 0, w, h);
  ctx.save();
  ctx.globalAlpha = opacity;
  ctx.drawImage(glowCanvas, 0, 0);
  ctx.restore();
  ctx.drawImage(origCanvas, 0, 0);
}
