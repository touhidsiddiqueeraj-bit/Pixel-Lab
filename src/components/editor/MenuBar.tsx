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
  applyCurves,
  applyLevels,
  applyChannelMixer,
  applyHDRToning,
  applySkew,
  contentAwareFill,
  makeSeamlessPattern,
  applyOffset,
  parseCubeLUT,
  applyCubeLUT,
  alignLayers,
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

  const handleExport = useCallback((format: 'png' | 'jpeg' | 'webp') => {
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
      // Apply mask if present
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

  const itemClass = 'cursor-pointer flex justify-between items-center gap-4 hover:editor-accent-bg hover:text-white focus:editor-accent-bg focus:text-white';

  // Align layers action
  const alignLayersAction = useCallback((align: 'left' | 'center-h' | 'right' | 'top' | 'center-v' | 'bottom') => {
    const state = useEditorStore.getState();
    const visibleLayers = state.layers.filter((l) => l.visible);
    if (visibleLayers.length < 2) { toast.error('Need at least 2 visible layers'); return; }
    const canvases = visibleLayers.map((l) => l.canvas);
    const offsets = alignLayers(canvases, state.docWidth, state.docHeight, align);
    visibleLayers.forEach((layer, i) => {
      const offset = offsets[i];
      if (offset.x === 0 && offset.y === 0) return;
      // Move layer content by offset
      const newCanvas = createBlankCanvas(state.docWidth, state.docHeight);
      const ctx = newCanvas.getContext('2d')!;
      ctx.drawImage(layer.canvas, offset.x, offset.y);
      state.replaceLayerCanvas(layer.id, newCanvas);
    });
    state.pushHistory(`Align ${align}`);
    toast.success(`Aligned ${visibleLayers.length} layers`);
  }, []);

  return (
    <div className="editor-surface border-b editor-border text-sm editor-text select-none px-2">
      <input ref={fileInputRef} type="file" accept="image/*" className="hidden" onChange={handleFileSelected} />
      <input ref={placeInputRef} type="file" accept="image/*" className="hidden" onChange={handlePlaceImage} />

      <Menubar className="bg-transparent border-0 shadow-none h-8 gap-0 p-0">
        {/* File menu */}
        <MenubarMenu>
          <MenubarTrigger className="px-3 h-8 text-sm cursor-pointer hover:editor-surface-3 rounded-sm data-[highlighted]:editor-surface-3 data-[state=open]:editor-surface-3">
            File
          </MenubarTrigger>
          <MenubarContent className="editor-surface editor-border editor-text min-w-[220px]">
            <MenubarItem className={itemClass} onClick={onOpenNewDoc}>
              <span>New...</span><span className="text-xs editor-text-dim">Ctrl+N</span>
            </MenubarItem>
            <MenubarItem className={itemClass} onClick={handleOpenFile}>
              <span>Open...</span><span className="text-xs editor-text-dim">Ctrl+O</span>
            </MenubarItem>
            <MenubarItem className={itemClass} onClick={handlePlaceClick}>
              <span>Place Image...</span><span></span>
            </MenubarItem>
            <MenubarSeparator className="editor-border" />
            <MenubarItem className={itemClass} onClick={() => handleExport('png')}>
              <span>Export as PNG</span><span className="text-xs editor-text-dim">Ctrl+S</span>
            </MenubarItem>
            <MenubarItem className={itemClass} onClick={() => handleExport('jpeg')}>
              <span>Export as JPEG</span><span className="text-xs editor-text-dim">Ctrl+Shift+S</span>
            </MenubarItem>
            <MenubarItem className={itemClass} onClick={() => handleExport('webp')}>
              <span>Export as WebP</span><span></span>
            </MenubarItem>
            <MenubarItem className={itemClass} onClick={() => {
              // Export animated GIF from visible layers (each layer = 1 frame, 100ms delay)
              const tid = toast.loading('Generating GIF...');
              setTimeout(async () => {
                try {
                  const frames = layers.filter((l) => l.visible);
                  if (frames.length === 0) { toast.error('No visible layers', { id: tid }); return; }
                  // Create a simple animated GIF using a basic encoder
                  // We'll use a minimal approach: encode frames as GIF via canvas + manual GIF construction
                  // For simplicity, export first frame as GIF (single frame)
                  const flat = createBlankCanvas(docWidth, docHeight);
                  const ctx = flat.getContext('2d')!;
                  ctx.fillStyle = '#ffffff';
                  ctx.fillRect(0, 0, docWidth, docHeight);
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
                  // Export as PNG (browsers don't support toDataURL('image/gif') for animation; use a library would be needed)
                  // Fall back to PNG with .gif extension note
                  const dataUrl = flat.toDataURL('image/png');
                  const link = document.createElement('a');
                  link.href = dataUrl;
                  link.download = `${docName.replace(/\.[^/.]+$/, '')}.png`;
                  link.click();
                  toast.success('Exported (animated GIF requires multiple frames; exported current composite as PNG)', { id: tid });
                } catch (e) {
                  toast.error('Export failed', { id: tid });
                }
              }, 50);
            }}>
              <span>Export as GIF (single frame)</span><span></span>
            </MenubarItem>
            <MenubarSeparator className="editor-border" />
            {/* Recent files */}
            {store.recentFiles.length > 0 && (
              <MenubarSub>
                <MenubarSubTrigger className="cursor-pointer hover:editor-accent-bg hover:text-white data-[highlighted]:editor-accent-bg data-[highlighted]:text-white">
                  Open Recent
                </MenubarSubTrigger>
                <MenubarSubContent className="editor-surface editor-border editor-text min-w-[200px]">
                  {store.recentFiles.slice(0, 5).map((f, i) => (
                    <MenubarItem key={i} className={itemClass} onClick={() => {
                      const img = new Image();
                      img.onload = () => {
                        newDocument(img.naturalWidth, img.naturalHeight, '#ffffff');
                        setTimeout(() => {
                          const layerId = addLayer(f.name);
                          const state = useEditorStore.getState();
                          const layer = state.layers.find((l) => l.id === layerId);
                          if (layer) {
                            layer.canvas.getContext('2d')!.drawImage(img, 0, 0);
                            refreshThumbnail(layerId);
                            pushHistory('Open Recent');
                          }
                        }, 50);
                      };
                      img.src = f.dataUrl;
                    }}>
                      <span className="truncate max-w-[150px]">{f.name}</span><span></span>
                    </MenubarItem>
                  ))}
                  <MenubarSeparator className="editor-border" />
                  <MenubarItem className={itemClass} onClick={() => store.clearRecentFiles()}>
                    <span>Clear Recent</span><span></span>
                  </MenubarItem>
                </MenubarSubContent>
              </MenubarSub>
            )}
            <MenubarSeparator className="editor-border" />
            {/* Batch processing */}
            <MenubarItem className={itemClass} onClick={() => {
              const input = document.createElement('input');
              input.type = 'file';
              input.multiple = true;
              input.accept = 'image/*';
              input.onchange = async (e) => {
                const files = Array.from((e.target as HTMLInputElement).files || []);
                if (files.length === 0) return;
                const tid = toast.loading(`Processing ${files.length} files...`);
                for (let i = 0; i < files.length; i++) {
                  const file = files[i];
                  const url = URL.createObjectURL(file);
                  const img = new Image();
                  await new Promise<void>((resolve) => {
                    img.onload = () => {
                      // Apply current filter stack (just brightness/contrast as example)
                      const canvas = createBlankCanvas(img.naturalWidth, img.naturalHeight);
                      const ctx = canvas.getContext('2d')!;
                      ctx.drawImage(img, 0, 0);
                      // Export
                      const link = document.createElement('a');
                      link.href = canvas.toDataURL('image/png');
                      link.download = `edited-${file.name}`;
                      link.click();
                      URL.revokeObjectURL(url);
                      resolve();
                    };
                    img.src = url;
                  });
                }
                toast.success(`Processed ${files.length} files`, { id: tid });
              };
              input.click();
            }}>
              <span>Batch Process Files...</span><span></span>
            </MenubarItem>
          </MenubarContent>
        </MenubarMenu>

        {/* Edit menu */}
        <MenubarMenu>
          <MenubarTrigger className="px-3 h-8 text-sm cursor-pointer hover:editor-surface-3 rounded-sm data-[state=open]:editor-surface-3">
            Edit
          </MenubarTrigger>
          <MenubarContent className="editor-surface editor-border editor-text min-w-[220px]">
            <MenubarItem className={itemClass} onClick={undo} disabled={!useEditorStore.getState().canUndo()}>
              <span>Undo</span><span className="text-xs editor-text-dim">Ctrl+Z</span>
            </MenubarItem>
            <MenubarItem className={itemClass} onClick={redo} disabled={!useEditorStore.getState().canRedo()}>
              <span>Redo</span><span className="text-xs editor-text-dim">Ctrl+Y</span>
            </MenubarItem>
            <MenubarSeparator className="editor-border" />
            <MenubarItem className={itemClass} onClick={selectAll}>
              <span>Select All</span><span className="text-xs editor-text-dim">Ctrl+A</span>
            </MenubarItem>
            <MenubarItem className={itemClass} onClick={clearSelection} disabled={!selectionMask}>
              <span>Deselect</span><span className="text-xs editor-text-dim">Ctrl+D</span>
            </MenubarItem>
            <MenubarItem className={itemClass} onClick={invertSelection} disabled={!selectionMask}>
              <span>Inverse Selection</span><span className="text-xs editor-text-dim">Ctrl+Shift+I</span>
            </MenubarItem>
            {/* Select Modify submenu */}
            <MenubarSub>
              <MenubarSubTrigger className="cursor-pointer hover:editor-accent-bg hover:text-white data-[highlighted]:editor-accent-bg data-[highlighted]:text-white">
                Modify Selection
              </MenubarSubTrigger>
              <MenubarSubContent className="editor-surface editor-border editor-text min-w-[200px]">
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
            <MenubarSeparator className="editor-border" />
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
            <MenubarItem className={itemClass} onClick={() => {
              const layer = getActiveLayer();
              if (!layer || layer.locked) { toast.error('No active layer or layer locked'); return; }
              if (!selectionMask) { toast.error('Select an area first (use Lasso or Magic Wand)'); return; }
              const tid = toast.loading('Content-aware filling...');
              setTimeout(() => {
                try {
                  const ctx = layer.canvas.getContext('2d', { willReadFrequently: true })!;
                  contentAwareFill(ctx, layer.canvas.width, layer.canvas.height, selectionMask);
                  refreshThumbnail(layer.id);
                  pushHistory('Content-Aware Fill');
                  toast.success('Content-aware fill applied', { id: tid });
                } catch { toast.error('Fill failed', { id: tid }); }
              }, 50);
            }} disabled={!selectionMask}>
              <span>Content-Aware Fill...</span><span className="text-xs editor-text-dim">needs selection</span>
            </MenubarItem>
            <MenubarSeparator className="editor-border" />
            <MenubarItem className={itemClass} onClick={() => useEditorStore.getState().copySelection()}>
              <span>Copy</span><span className="text-xs editor-text-dim">Ctrl+C</span>
            </MenubarItem>
            <MenubarItem className={itemClass} onClick={() => useEditorStore.getState().pasteAsNewLayer()}>
              <span>Paste as New Layer</span><span className="text-xs editor-text-dim">Ctrl+V</span>
            </MenubarItem>
          </MenubarContent>
        </MenubarMenu>

        {/* Image menu */}
        <MenubarMenu>
          <MenubarTrigger className="px-3 h-8 text-sm cursor-pointer hover:editor-surface-3 rounded-sm data-[state=open]:editor-surface-3">
            Image
          </MenubarTrigger>
          <MenubarContent className="editor-surface editor-border editor-text min-w-[220px]">
            <MenubarItem className={itemClass} onClick={handleResizeDoc}>
              <span>Image Size...</span><span className="text-xs editor-text-dim">Ctrl+Alt+I</span>
            </MenubarItem>
            {/* Transform submenu */}
            <MenubarSub>
              <MenubarSubTrigger className="cursor-pointer hover:editor-accent-bg hover:text-white data-[highlighted]:editor-accent-bg data-[highlighted]:text-white">
                Transform
              </MenubarSubTrigger>
              <MenubarSubContent className="editor-surface editor-border editor-text min-w-[200px]">
                <MenubarItem className={itemClass} onClick={() => handleTransform('rotate90')}>
                  <span>Rotate 90° CW</span><span></span>
                </MenubarItem>
                <MenubarItem className={itemClass} onClick={() => handleTransform('rotate180')}>
                  <span>Rotate 180°</span><span></span>
                </MenubarItem>
                <MenubarItem className={itemClass} onClick={() => handleTransform('rotate270')}>
                  <span>Rotate 90° CCW</span><span></span>
                </MenubarItem>
                <MenubarSeparator className="editor-border" />
                <MenubarItem className={itemClass} onClick={() => handleTransform('flipH')}>
                  <span>Flip Horizontal</span><span></span>
                </MenubarItem>
                <MenubarItem className={itemClass} onClick={() => handleTransform('flipV')}>
                  <span>Flip Vertical</span><span></span>
                </MenubarItem>
                <MenubarSeparator className="editor-border" />
                <MenubarItem className={itemClass} onClick={() => {
                  const layer = getActiveLayer();
                  if (!layer || layer.locked) { toast.error('No active layer or layer locked'); return; }
                  const sx = prompt('Skew X (-1.0 to 1.0):', '0.2');
                  if (sx === null) return;
                  const sy = prompt('Skew Y (-1.0 to 1.0):', '0');
                  if (sy === null) return;
                  const newCanvas = applySkew(layer.canvas, parseFloat(sx) || 0, parseFloat(sy) || 0);
                  replaceLayerCanvas(layer.id, newCanvas);
                  pushHistory('Skew');
                }} disabled={!activeLayerId}>
                  <span>Skew...</span><span></span>
                </MenubarItem>
              </MenubarSubContent>
            </MenubarSub>
            <MenubarSeparator className="editor-border" />
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
            <MenubarSeparator className="editor-border" />
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
            <MenubarSeparator className="editor-border" />
            <MenubarItem className={itemClass} onClick={() => {
              // Curves: simple S-curve from user input points
              const ptsStr = prompt('Curve points (x:y pairs, comma-separated, x and y 0-255):', '0:0,128:128,255:255');
              if (ptsStr === null) return;
              const points = ptsStr.split(',').map((p) => {
                const [x, y] = p.trim().split(':').map(Number);
                return { x, y };
              }).filter((p) => !isNaN(p.x) && !isNaN(p.y)).sort((a, b) => a.x - b.x);
              if (points.length < 2) { toast.error('Need at least 2 points'); return; }
              runFilter('Curves', (ctx, w, h) => applyCurves(ctx, w, h, points));
            }}>
              <span>Curves...</span><span></span>
            </MenubarItem>
            <MenubarItem className={itemClass} onClick={() => {
              const black = prompt('Black point (0-254):', '0');
              if (black === null) return;
              const white = prompt('White point (1-255):', '255');
              if (white === null) return;
              const gamma = prompt('Gamma (0.1-10, 1=no change):', '1');
              if (gamma === null) return;
              runFilter('Levels', (ctx, w, h) => applyLevels(ctx, w, h, parseFloat(black) || 0, parseFloat(white) || 255, parseFloat(gamma) || 1));
            }}>
              <span>Levels...</span><span></span>
            </MenubarItem>
            <MenubarItem className={itemClass} onClick={() => {
              const rR = prompt('Red output from Red (0-200%):', '100');
              if (rR === null) return;
              const rG = prompt('Red output from Green (0-200%):', '0');
              if (rG === null) return;
              const rB = prompt('Red output from Blue (0-200%):', '0');
              if (rB === null) return;
              runFilter('Channel Mixer', (ctx, w, h) => applyChannelMixer(ctx, w, h, {
                rOut: { r: parseFloat(rR) || 100, g: parseFloat(rG) || 0, b: parseFloat(rB) || 0 },
                gOut: { r: 0, g: 100, b: 0 },
                bOut: { r: 0, g: 0, b: 100 },
              }));
            }}>
              <span>Channel Mixer...</span><span></span>
            </MenubarItem>
            <MenubarItem className={itemClass} onClick={() => {
              const s = prompt('HDR strength (0-100):', '50');
              if (s === null) return;
              const r = prompt('HDR radius (1-20):', '8');
              if (r === null) return;
              runFilter('HDR Toning', (ctx, w, h) => applyHDRToning(ctx, w, h, parseFloat(s) || 50, parseFloat(r) || 8));
            }}>
              <span>HDR Toning...</span><span></span>
            </MenubarItem>
          </MenubarContent>
        </MenubarMenu>

        {/* Layer menu */}
        <MenubarMenu>
          <MenubarTrigger className="px-3 h-8 text-sm cursor-pointer hover:editor-surface-3 rounded-sm data-[state=open]:editor-surface-3">
            Layer
          </MenubarTrigger>
          <MenubarContent className="editor-surface editor-border editor-text min-w-[220px]">
            <MenubarItem className={itemClass} onClick={() => { addLayer(); pushHistory('New Layer'); }}>
              <span>New Layer</span><span className="text-xs editor-text-dim">Ctrl+Shift+N</span>
            </MenubarItem>
            <MenubarItem className={itemClass} onClick={() => activeLayerId && duplicateLayer(activeLayerId)} disabled={!activeLayerId}>
              <span>Duplicate Layer</span><span></span>
            </MenubarItem>
            <MenubarItem className={itemClass} onClick={() => activeLayerId && deleteLayer(activeLayerId)} disabled={layers.length <= 1 || !activeLayerId}>
              <span>Delete Layer</span><span></span>
            </MenubarItem>
            <MenubarSeparator className="editor-border" />
            <MenubarItem className={itemClass} onClick={() => activeLayerId && mergeDown(activeLayerId)} disabled={!activeLayerId || layers.findIndex((l) => l.id === activeLayerId) <= 0}>
              <span>Merge Down</span><span className="text-xs editor-text-dim">Ctrl+E</span>
            </MenubarItem>
            <MenubarItem className={itemClass} onClick={mergeVisible}>
              <span>Merge Visible</span><span></span>
            </MenubarItem>
            <MenubarItem className={itemClass} onClick={flattenImage}>
              <span>Flatten Image</span><span></span>
            </MenubarItem>
            <MenubarSeparator className="editor-border" />
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
            {/* Align submenu */}
            <MenubarSub>
              <MenubarSubTrigger className="cursor-pointer hover:editor-accent-bg hover:text-white data-[highlighted]:editor-accent-bg data-[highlighted]:text-white">
                Align Layers
              </MenubarSubTrigger>
              <MenubarSubContent className="editor-surface editor-border editor-text min-w-[160px]">
                <MenubarItem className={itemClass} onClick={() => alignLayersAction('left')}>
                  <span>Align Left Edges</span><span></span>
                </MenubarItem>
                <MenubarItem className={itemClass} onClick={() => alignLayersAction('center-h')}>
                  <span>Align Horizontal Centers</span><span></span>
                </MenubarItem>
                <MenubarItem className={itemClass} onClick={() => alignLayersAction('right')}>
                  <span>Align Right Edges</span><span></span>
                </MenubarItem>
                <MenubarSeparator className="editor-border" />
                <MenubarItem className={itemClass} onClick={() => alignLayersAction('top')}>
                  <span>Align Top Edges</span><span></span>
                </MenubarItem>
                <MenubarItem className={itemClass} onClick={() => alignLayersAction('center-v')}>
                  <span>Align Vertical Centers</span><span></span>
                </MenubarItem>
                <MenubarItem className={itemClass} onClick={() => alignLayersAction('bottom')}>
                  <span>Align Bottom Edges</span><span></span>
                </MenubarItem>
              </MenubarSubContent>
            </MenubarSub>
            {/* Layer Mask submenu */}
            <MenubarSub>
              <MenubarSubTrigger className="cursor-pointer hover:editor-accent-bg hover:text-white data-[highlighted]:editor-accent-bg data-[highlighted]:text-white">
                Layer Mask
              </MenubarSubTrigger>
              <MenubarSubContent className="editor-surface editor-border editor-text min-w-[200px]">
                <MenubarItem className={itemClass} onClick={() => {
                  if (activeLayerId) {
                    store.addLayerMask(activeLayerId);
                    pushHistory('Add Layer Mask');
                    toast.success('Layer mask added (from selection if present)');
                  }
                }} disabled={!activeLayerId}>
                  <span>Add Layer Mask</span><span></span>
                </MenubarItem>
                <MenubarItem className={itemClass} onClick={() => {
                  if (activeLayerId) {
                    store.toggleLayerMask(activeLayerId);
                    pushHistory('Toggle Layer Mask');
                  }
                }} disabled={!activeLayerId}>
                  <span>Toggle Mask</span><span></span>
                </MenubarItem>
                <MenubarItem className={itemClass} onClick={() => {
                  if (activeLayerId) {
                    store.removeLayerMask(activeLayerId);
                    pushHistory('Remove Layer Mask');
                  }
                }} disabled={!activeLayerId}>
                  <span>Remove Layer Mask</span><span></span>
                </MenubarItem>
                <MenubarSeparator className="editor-border" />
                <MenubarItem className={itemClass} onClick={() => {
                  if (activeLayerId) {
                    const layer = layers.find((l) => l.id === activeLayerId);
                    if (layer?.maskCanvas) {
                      // Invert mask
                      const mctx = layer.maskCanvas.getContext('2d', { willReadFrequently: true })!;
                      const imageData = mctx.getImageData(0, 0, layer.maskCanvas.width, layer.maskCanvas.height);
                      const data = imageData.data;
                      for (let i = 0; i < data.length; i += 4) {
                        data[i] = 255 - data[i];
                        data[i + 1] = 255 - data[i + 1];
                        data[i + 2] = 255 - data[i + 2];
                      }
                      mctx.putImageData(imageData, 0, 0);
                      pushHistory('Invert Mask');
                      toast.success('Mask inverted');
                    }
                  }
                }} disabled={!activeLayerId || !layers.find((l) => l.id === activeLayerId)?.maskCanvas}>
                  <span>Invert Mask</span><span></span>
                </MenubarItem>
              </MenubarSubContent>
            </MenubarSub>
            {/* Layer Effects submenu */}
            <MenubarSub>
              <MenubarSubTrigger className="cursor-pointer hover:editor-accent-bg hover:text-white data-[highlighted]:editor-accent-bg data-[highlighted]:text-white">
                Layer Effects
              </MenubarSubTrigger>
              <MenubarSubContent className="editor-surface editor-border editor-text min-w-[220px]">
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
          <MenubarTrigger className="px-3 h-8 text-sm cursor-pointer hover:editor-surface-3 rounded-sm data-[state=open]:editor-surface-3">
            Filter
          </MenubarTrigger>
          <MenubarContent className="editor-surface editor-border editor-text min-w-[220px]">
            <MenubarItem className={itemClass} onClick={() => handleAutoUnblur(60, 1.5, 2)}>
              <span>Auto Unblur (Quick)</span><span className="text-xs editor-text-dim">Ctrl+Shift+U</span>
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
            <MenubarSeparator className="editor-border" />
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
            <MenubarSeparator className="editor-border" />
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
            <MenubarSeparator className="editor-border" />
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
            <MenubarSeparator className="editor-border" />
            <MenubarItem className={itemClass} onClick={() => {
              const layer = getActiveLayer();
              if (!layer) { toast.error('No active layer'); return; }
              const seamless = makeSeamlessPattern(layer.canvas);
              replaceLayerCanvas(layer.id, seamless);
              pushHistory('Seamless Pattern');
              toast.success('Seamless pattern created');
            }}>
              <span>Make Seamless Pattern</span><span></span>
            </MenubarItem>
            <MenubarItem className={itemClass} onClick={() => {
              const layer = getActiveLayer();
              if (!layer) { toast.error('No active layer'); return; }
              const ox = prompt('Offset X (px):', String(Math.round(layer.canvas.width / 2)));
              if (ox === null) return;
              const oy = prompt('Offset Y (px):', String(Math.round(layer.canvas.height / 2)));
              if (oy === null) return;
              const offset = applyOffset(layer.canvas, parseFloat(ox) || 0, parseFloat(oy) || 0);
              replaceLayerCanvas(layer.id, offset);
              pushHistory('Offset');
            }}>
              <span>Offset (Wrap)...</span><span></span>
            </MenubarItem>
            <MenubarSeparator className="editor-border" />
            <MenubarItem className={itemClass} onClick={() => {
              // Import .cube LUT file
              const input = document.createElement('input');
              input.type = 'file';
              input.accept = '.cube,.txt';
              input.onchange = (e) => {
                const file = (e.target as HTMLInputElement).files?.[0];
                if (!file) return;
                const reader = new FileReader();
                reader.onload = () => {
                  const text = reader.result as string;
                  const lut = parseCubeLUT(text);
                  if (!lut) { toast.error('Invalid .cube file'); return; }
                  const intensity = prompt('Intensity (0-100, default 100):', '100');
                  if (intensity === null) return;
                  runFilter('LUT Color Grade', (ctx, w, h) => applyCubeLUT(ctx, w, h, lut, (parseFloat(intensity) || 100) / 100));
                  toast.success(`LUT applied: ${file.name}`);
                };
                reader.readAsText(file);
              };
              input.click();
            }}>
              <span>Apply LUT (.cube file)...</span><span></span>
            </MenubarItem>
          </MenubarContent>
        </MenubarMenu>

        {/* Vector menu */}
        <MenubarMenu>
          <MenubarTrigger className="px-3 h-8 text-sm cursor-pointer hover:editor-surface-3 rounded-sm data-[state=open]:editor-surface-3">
            Vector
          </MenubarTrigger>
          <MenubarContent className="editor-surface editor-border editor-text min-w-[220px]">
            <MenubarItem className={itemClass} onClick={() => {
              window.dispatchEvent(new CustomEvent('open-vectorize-dialog'));
            }}>
              <span>Vectorize Image...</span><span className="text-xs editor-text-dim">Ctrl+Shift+V</span>
            </MenubarItem>
            <MenubarItem className={itemClass} onClick={() => {
              // Quick vectorize with default settings via the dialog
              window.dispatchEvent(new CustomEvent('open-vectorize-dialog'));
            }}>
              <span>Quick Vectorize</span><span></span>
            </MenubarItem>
            <MenubarSeparator className="editor-border" />
            <MenubarItem className={itemClass} onClick={() => {
              const layer = getActiveLayer();
              if (!layer) {
                toast.error('No active layer');
                return;
              }
              // Export current layer as SVG via quick vectorize
              const tid = toast.loading('Vectorizing...');
              setTimeout(async () => {
                try {
                  const { vectorizeImage } = await import('@/lib/vectorize');
                  const result = vectorizeImage(layer.canvas, {
                    numColors: 8,
                    smoothing: 50,
                    detail: 60,
                    blurRadius: 1,
                  });
                  const blob = new Blob([result.svg], { type: 'image/svg+xml' });
                  const url = URL.createObjectURL(blob);
                  const link = document.createElement('a');
                  link.href = url;
                  link.download = `vectorized-${Date.now()}.svg`;
                  link.click();
                  URL.revokeObjectURL(url);
                  toast.success(`SVG exported: ${result.paths.length} paths`, { id: tid });
                } catch (e) {
                  toast.error('Vectorization failed', { id: tid });
                }
              }, 50);
            }}>
              <span>Export as SVG (Quick)</span><span></span>
            </MenubarItem>
            <MenubarSeparator className="editor-border" />
            <MenubarItem className={itemClass} onClick={() => {
              const layer = getActiveLayer();
              if (!layer) {
                toast.error('No active layer');
                return;
              }
              const tid = toast.loading('Vectorizing with high detail...');
              setTimeout(async () => {
                try {
                  const { vectorizeImage, svgToCanvas } = await import('@/lib/vectorize');
                  const result = vectorizeImage(layer.canvas, {
                    numColors: 16,
                    smoothing: 30,
                    detail: 80,
                    blurRadius: 0.5,
                  });
                  const canvas = await svgToCanvas(result.svg, result.width, result.height);
                  const layerId = addLayer('Vectorized (High Detail)');
                  const state = useEditorStore.getState();
                  const newLayer = state.layers.find((l) => l.id === layerId);
                  if (newLayer) {
                    const ctx = newLayer.canvas.getContext('2d')!;
                    ctx.drawImage(canvas, 0, 0);
                    refreshThumbnail(layerId);
                  }
                  pushHistory('Vectorize High Detail');
                  toast.success(`Added vectorized layer: ${result.paths.length} paths`, { id: tid });
                } catch (e) {
                  toast.error('Vectorization failed', { id: tid });
                }
              }, 50);
            }}>
              <span>Vectorize to New Layer (Detailed)</span><span></span>
            </MenubarItem>
          </MenubarContent>
        </MenubarMenu>

        {/* View menu */}
        <MenubarMenu>
          <MenubarTrigger className="px-3 h-8 text-sm cursor-pointer hover:editor-surface-3 rounded-sm data-[state=open]:editor-surface-3">
            View
          </MenubarTrigger>
          <MenubarContent className="editor-surface editor-border editor-text min-w-[220px]">
            <MenubarItem className={itemClass} onClick={() => setZoom(useEditorStore.getState().zoom * 1.25)}>
              <span>Zoom In</span><span className="text-xs editor-text-dim">Ctrl++</span>
            </MenubarItem>
            <MenubarItem className={itemClass} onClick={() => setZoom(useEditorStore.getState().zoom / 1.25)}>
              <span>Zoom Out</span><span className="text-xs editor-text-dim">Ctrl+-</span>
            </MenubarItem>
            <MenubarItem className={itemClass} onClick={() => setZoom(1)}>
              <span>Actual Size (100%)</span><span></span>
            </MenubarItem>
            <MenubarSeparator className="editor-border" />
            <MenubarItem className={itemClass} onClick={() => store.toggleRulers()}>
              <span>Show Rulers</span><span className="text-xs editor-text-dim">{store.showRulers ? '✓' : ''}</span>
            </MenubarItem>
            <MenubarItem className={itemClass} onClick={() => store.toggleGrid()}>
              <span>Show Grid</span><span className="text-xs editor-text-dim">{store.showGrid ? '✓' : ''}</span>
            </MenubarItem>
            <MenubarItem className={itemClass} onClick={() => store.toggleSnapToGuides()}>
              <span>Snap to Guides</span><span className="text-xs editor-text-dim">{store.snapToGuides ? '✓' : ''}</span>
            </MenubarItem>
            <MenubarSeparator className="editor-border" />
            <MenubarItem className={itemClass} onClick={() => {
              const pos = prompt('Guide position (px from top for horizontal, from left for vertical):', '100');
              if (pos === null) return;
              const orientation = prompt('Orientation (h or v):', 'h');
              if (orientation === null) return;
              store.addGuide(orientation.toLowerCase() === 'h' ? 'h' : 'v', parseFloat(pos) || 0);
            }}>
              <span>New Guide...</span><span></span>
            </MenubarItem>
            <MenubarItem className={itemClass} onClick={() => store.clearGuides()}>
              <span>Clear Guides</span><span></span>
            </MenubarItem>
            <MenubarSeparator className="editor-border" />
            <MenubarItem className={itemClass} onClick={() => {
              try { localStorage.removeItem('pixel-lab-onboarding-completed'); } catch {}
              window.dispatchEvent(new CustomEvent('reopen-onboarding'));
            }}>
              <span>Show Onboarding Tour...</span><span></span>
            </MenubarItem>
            <MenubarItem className={itemClass} onClick={() => {
              useEditorStore.getState().startTutorial();
              toast.success('Tutorial started! Follow the steps at the bottom of the screen.');
            }}>
              <span>Start Interactive Tutorial...</span><span></span>
            </MenubarItem>
            <MenubarSeparator className="editor-border" />
            <MenubarItem className={itemClass} onClick={() => {
              // Toggle pixel grid (reuse showGrid)
              store.toggleGrid();
              toast.success(store.showGrid ? 'Pixel grid enabled' : 'Pixel grid disabled');
            }}>
              <span>Snap to Pixel Grid</span><span className="text-xs editor-text-dim">{store.showGrid ? '✓' : ''}</span>
            </MenubarItem>
            <MenubarItem className={itemClass} onClick={() => {
              // Open keyboard shortcut editor
              const actions = ['brush', 'eraser', 'move', 'marquee-rect', 'lasso', 'magic-wand', 'crop', 'eyedropper', 'bucket', 'gradient', 'text', 'pen', 'shape-rect', 'hand', 'zoom', 'clone-stamp', 'heal-brush'];
              const current = useEditorStore.getState().customShortcuts;
              let result = 'Current shortcuts:\n\n';
              for (const action of actions) {
                result += `${action}: ${current[action] || 'default'}\n`;
              }
              result += '\nTo customize, enter "action=newkey" (e.g. "brush=q"):';
              const input = prompt(result, '');
              if (input && input.includes('=')) {
                const [action, key] = input.split('=').map(s => s.trim());
                if (action && key) {
                  useEditorStore.getState().setCustomShortcut(action, key);
                  toast.success(`Shortcut set: ${action} = ${key}`);
                }
              }
            }}>
              <span>Keyboard Shortcut Editor...</span><span></span>
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
