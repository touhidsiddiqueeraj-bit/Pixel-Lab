'use client';

import { create } from 'zustand';
import {
  LayerData,
  LayerSnapshot,
  ToolType,
  ToolOptions,
  BlendMode,
  HistoryEntry,
} from './editor-types';
import {
  createBlankCanvas,
  canvasToDataUrl,
  generateThumbnail,
} from './image-processing';
import { featherSelection as featherMask } from './image-processing';
import { getPerfSettings, type PerfSettings } from './perf';
import { toast } from 'sonner';

const DEFAULT_TOOL_OPTIONS: ToolOptions = {
  brushSize: 20,
  brushHardness: 80,
  brushOpacity: 100,
  brushSpacing: 25,
  brushStabilizer: 0,
  tolerance: 32,
  fontSize: 48,
  fontFamily: 'Inter, sans-serif',
  shapeFilled: true,
  shapeStrokeWidth: 2,
  shapeSides: 6,
  shapeStarPoints: 5,
  shapeStarInnerRatio: 0.4,
  shapeArrowHeadSize: 0.3,
  shapeSpiralTurns: 3,
  zoomLevel: 1,
  liquifyStrength: 50,
  symmetryMode: 'none',
  symmetrySegments: 6,
  calligraphyAngle: 45,
  scatterCount: 5,
  scatterSize: 1.0,
  smoothStrength: 50,
  blobMerge: true,
};

const MAX_HISTORY = 40;
const DEFAULT_PERF_SETTINGS = getPerfSettings();

import { generateId } from '@/lib/utils';

interface EditorState {
  // Document
  docWidth: number;
  docHeight: number;
  docName: string;

  // Layers
  layers: LayerData[];
  activeLayerId: string | null;

  // Tool
  activeTool: ToolType;
  toolOptions: ToolOptions;

  // Colors
  foregroundColor: string;
  backgroundColor: string;

  // Selection (mask canvas; null = no selection)
  selectionMask: HTMLCanvasElement | null;
  selectionBounds: { x: number; y: number; w: number; h: number } | null;

  // History
  history: HistoryEntry[];
  historyIndex: number; // -1 = at latest

  // UI
  zoom: number;
  panX: number;
  panY: number;

  // Actions
  newDocument: (w: number, h: number, bg: string) => void;
  setTool: (tool: ToolType) => void;
  setToolOptions: (opts: Partial<ToolOptions>) => void;
  setForeground: (color: string) => void;
  setBackground: (color: string) => void;
  swapColors: () => void;
  resetColors: () => void;

  addLayer: (name?: string, canvas?: HTMLCanvasElement) => string;
  deleteLayer: (id: string) => void;
  duplicateLayer: (id: string) => void;
  mergeDown: (id: string) => void;
  mergeVisible: () => void;
  flattenImage: () => void;
  setActiveLayer: (id: string) => void;
  updateLayer: (id: string, patch: Partial<Omit<LayerData, 'id' | 'canvas' | 'thumbnail' | 'maskCanvas'>>) => void;
  renameLayer: (id: string, name: string) => void;
  reorderLayers: (fromIndex: number, toIndex: number) => void;
  refreshThumbnail: (id: string) => void;
  replaceLayerCanvas: (id: string, canvas: HTMLCanvasElement) => void;
  addLayerMask: (id: string) => void;
  removeLayerMask: (id: string) => void;
  toggleLayerMask: (id: string) => void;
  replaceLayerMask: (id: string, mask: HTMLCanvasElement) => void;
  editingMask: boolean;
  setEditingMask: (v: boolean) => void;

  // Clone/Heal source setting mode (for mobile where Alt+Click isn't available)
  settingSource: boolean;
  setSettingSource: (v: boolean) => void;

  // Clipboard (copy/paste between layers)
  clipboard: HTMLCanvasElement | null;
  copySelection: () => void;
  pasteAsNewLayer: () => void;

  // Adjustment layers (non-destructive)
  addAdjustmentLayer: (name: string, settings: Record<string, number>) => void;
  updateAdjustmentLayer: (id: string, settings: Record<string, number>) => void;
  adjustmentLayers: { id: string; name: string; visible: boolean; settings: Record<string, number>; type: string }[];
  setAdjustmentLayers: (layers: { id: string; name: string; visible: boolean; settings: Record<string, number>; type: string }[]) => void;

  // Recent files (session storage, no cloud)
  recentFiles: { name: string; dataUrl: string; timestamp: number }[];
  addRecentFile: (name: string, dataUrl: string) => void;
  clearRecentFiles: () => void;

  // MCP bridge toggle (persisted, off by default)
  mcpEnabled: boolean;
  setMcpEnabled: (v: boolean) => void;

  setSelection: (mask: HTMLCanvasElement | null, bounds: { x: number; y: number; w: number; h: number } | null) => void;
  clearSelection: () => void;
  selectAll: () => void;
  invertSelection: () => void;
  featherSelection: (radius: number) => void;
  expandSelection: (pixels: number) => void;
  contractSelection: (pixels: number) => void;

  // Guides & rulers
  guides: { x: number[]; y: number[] };
  addGuide: (orientation: 'h' | 'v', pos: number) => void;
  removeGuide: (orientation: 'h' | 'v', index: number) => void;
  clearGuides: () => void;
  showRulers: boolean;
  toggleRulers: () => void;
  snapToGuides: boolean;
  toggleSnapToGuides: () => void;
  showGrid: boolean;
  toggleGrid: () => void;

  pushHistory: (label: string) => void;
  undo: () => void;
  redo: () => void;
  canUndo: () => boolean;
  canRedo: () => boolean;

  setZoom: (z: number) => void;
  setPan: (x: number, y: number) => void;
  setDocName: (name: string) => void;

  // Performance
  perfSettings: PerfSettings;
  setPerfSettings: (settings: Partial<PerfSettings>) => void;

  // Tutorial
  tutorialActive: boolean;
  tutorialStep: number;
  setTutorialActive: (v: boolean) => void;
  setTutorialStep: (v: number) => void;
  startTutorial: () => void;
  endTutorial: () => void;
}

export const useEditorStore = create<EditorState>((set, get) => ({
  docWidth: 1280,
  docHeight: 720,
  docName: 'Untitled-1',

  layers: [],
  activeLayerId: null,

  activeTool: 'brush',
  toolOptions: DEFAULT_TOOL_OPTIONS,

  foregroundColor: '#000000',
  backgroundColor: '#ffffff',

  selectionMask: null,
  selectionBounds: null,

  history: [],
  historyIndex: -1,

  zoom: 1,
  panX: 0,
  panY: 0,

  editingMask: false,

  settingSource: false,

  // Clipboard
  clipboard: null,
  copySelection: () => {
    const state = get();
    const layer = state.layers.find((l) => l.id === state.activeLayerId);
    if (!layer) return;
    const clip = createBlankCanvas(state.docWidth, state.docHeight);
    const ctx = clip.getContext('2d')!;
    if (state.selectionMask) {
      ctx.drawImage(layer.canvas, 0, 0);
      ctx.globalCompositeOperation = 'destination-in';
      ctx.drawImage(state.selectionMask, 0, 0);
    } else {
      ctx.drawImage(layer.canvas, 0, 0);
    }
    set({ clipboard: clip });
    toast.success('Copied to clipboard');
  },
  pasteAsNewLayer: () => {
    const state = get();
    if (!state.clipboard) { toast.error('Clipboard is empty'); return; }
    const layerId = state.addLayer('Pasted');
    const newState = get();
    const layer = newState.layers.find((l) => l.id === layerId);
    if (layer) {
      const ctx = layer.canvas.getContext('2d')!;
      ctx.drawImage(state.clipboard, 0, 0);
      newState.refreshThumbnail(layerId);
      newState.pushHistory('Paste');
    }
  },

  // Layer groups (simple: toggle a group flag on layer)
  // Adjustment layers
  adjustmentLayers: [],
  addAdjustmentLayer: (name, settings) => set((s) => ({
    adjustmentLayers: [...s.adjustmentLayers, {
      id: generateId(), name, visible: true, settings, type: name,
    }],
  })),
  updateAdjustmentLayer: (id, settings) => set((s) => ({
    adjustmentLayers: s.adjustmentLayers.map((a) => a.id === id ? { ...a, settings } : a),
  })),
  setAdjustmentLayers: (layers) => set({ adjustmentLayers: layers }),

  // Recent files (stored in memory, optionally persisted to localStorage)
  recentFiles: [],
  addRecentFile: (name, dataUrl) => set((s) => {
    const file = { name, dataUrl, timestamp: Date.now() };
    const filtered = s.recentFiles.filter((f) => f.name !== name);
    return { recentFiles: [file, ...filtered].slice(0, 10) };
  }),
  clearRecentFiles: () => set({ recentFiles: [] }),

  // MCP bridge — off by default, persisted
  mcpEnabled: (() => {
    try { return localStorage.getItem('pixel-lab-mcp-enabled') === 'true'; } catch { return false; }
  })(),
  setMcpEnabled: (v) => {
    try { localStorage.setItem('pixel-lab-mcp-enabled', String(v)); } catch {}
    set({ mcpEnabled: v });
  },

  guides: { x: [], y: [] },
  showRulers: false,
  snapToGuides: true,
  showGrid: false,

  newDocument: (w, h, bg) => {
    const bgCanvas = createBlankCanvas(w, h);
    const bgCtx = bgCanvas.getContext('2d')!;
    bgCtx.fillStyle = bg;
    bgCtx.fillRect(0, 0, w, h);
    const bgLayer: LayerData = {
      id: generateId(),
      name: 'Background',
      visible: true,
      opacity: 1,
      blendMode: 'source-over',
      locked: false,
      canvas: bgCanvas,
      thumbnail: generateThumbnail(bgCanvas),
      maskCanvas: null,
      maskEnabled: true,
    };
    set({
      docWidth: w,
      docHeight: h,
      layers: [bgLayer],
      activeLayerId: bgLayer.id,
      history: [],
      historyIndex: -1,
      zoom: 1,
      panX: 0,
      panY: 0,
      selectionMask: null,
      selectionBounds: null,
      editingMask: false,
      guides: { x: [], y: [] },
    });
    // push initial state
    setTimeout(() => get().pushHistory('New Document'), 0);
  },

  setTool: (tool) => set({ activeTool: tool }),
  setToolOptions: (opts) => set((s) => ({ toolOptions: { ...s.toolOptions, ...opts } })),

  setForeground: (color) => set({ foregroundColor: color }),
  setBackground: (color) => set({ backgroundColor: color }),
  swapColors: () => set((s) => ({ foregroundColor: s.backgroundColor, backgroundColor: s.foregroundColor })),
  resetColors: () => set({ foregroundColor: '#000000', backgroundColor: '#ffffff' }),

  addLayer: (name, canvas) => {
    const state = get();
    const newCanvas = canvas ?? createBlankCanvas(state.docWidth, state.docHeight);
    const newLayer: LayerData = {
      id: generateId(),
      name: name ?? `Layer ${state.layers.length + 1}`,
      visible: true,
      opacity: 1,
      blendMode: 'source-over',
      locked: false,
      canvas: newCanvas,
      thumbnail: generateThumbnail(newCanvas),
      maskCanvas: null,
      maskEnabled: true,
    };
    set({
      layers: [...state.layers, newLayer],
      activeLayerId: newLayer.id,
      editingMask: false,
    });
    return newLayer.id;
  },

  deleteLayer: (id) => {
    set((s) => {
      if (s.layers.length <= 1) return s;
      const idx = s.layers.findIndex((l) => l.id === id);
      if (idx < 0) return s;
      const newLayers = s.layers.filter((l) => l.id !== id);
      const newActive = s.activeLayerId === id
        ? newLayers[Math.min(idx, newLayers.length - 1)].id
        : s.activeLayerId;
      return { layers: newLayers, activeLayerId: newActive };
    });
    setTimeout(() => get().pushHistory('Delete Layer'), 0);
  },

  duplicateLayer: (id) => {
    set((s) => {
      const idx = s.layers.findIndex((l) => l.id === id);
      if (idx < 0) return s;
      const orig = s.layers[idx];
      const newCanvas = createBlankCanvas(orig.canvas.width, orig.canvas.height);
      const ctx = newCanvas.getContext('2d')!;
      ctx.drawImage(orig.canvas, 0, 0);
      let newMask: HTMLCanvasElement | null = null;
      if (orig.maskCanvas) {
        newMask = createBlankCanvas(orig.canvas.width, orig.canvas.height);
        newMask.getContext('2d')!.drawImage(orig.maskCanvas, 0, 0);
      }
      const newLayer: LayerData = {
        ...orig,
        id: generateId(),
        name: `${orig.name} copy`,
        canvas: newCanvas,
        thumbnail: generateThumbnail(newCanvas),
        maskCanvas: newMask,
      };
      const newLayers = [...s.layers];
      newLayers.splice(idx + 1, 0, newLayer);
      return { layers: newLayers, activeLayerId: newLayer.id };
    });
    setTimeout(() => get().pushHistory('Duplicate Layer'), 0);
  },

  mergeDown: (id) => {
    set((s) => {
      const idx = s.layers.findIndex((l) => l.id === id);
      if (idx <= 0) return s; // need a layer below
      const top = s.layers[idx];
      const bottom = s.layers[idx - 1];
      const ctx = bottom.canvas.getContext('2d')!;
      ctx.save();
      ctx.globalAlpha = top.opacity;
      ctx.globalCompositeOperation = top.blendMode;
      ctx.drawImage(top.canvas, 0, 0);
      ctx.restore();
      const newLayers = [...s.layers];
      newLayers.splice(idx, 1);
      // update thumbnail of merged bottom
      newLayers[idx - 1] = {
        ...bottom,
        thumbnail: generateThumbnail(bottom.canvas),
      };
      return { layers: newLayers, activeLayerId: bottom.id };
    });
    setTimeout(() => get().pushHistory('Merge Down'), 0);
  },

  mergeVisible: () => {
    set((s) => {
      const visible = s.layers.filter((l) => l.visible);
      if (visible.length < 2) return s;
      const merged = createBlankCanvas(s.docWidth, s.docHeight);
      const ctx = merged.getContext('2d')!;
      for (const layer of s.layers) {
        if (!layer.visible) continue;
        ctx.save();
        ctx.globalAlpha = layer.opacity;
        ctx.globalCompositeOperation = layer.blendMode;
        ctx.drawImage(layer.canvas, 0, 0);
        ctx.restore();
      }
      const newLayer: LayerData = {
        id: generateId(),
        name: 'Merged',
        visible: true,
        opacity: 1,
        blendMode: 'source-over',
        locked: false,
        canvas: merged,
        thumbnail: generateThumbnail(merged),
      };
      // Remove visible layers, add merged at bottom
      const newLayers = s.layers.filter((l) => !l.visible);
      newLayers.unshift(newLayer);
      return { layers: newLayers, activeLayerId: newLayer.id };
    });
    setTimeout(() => get().pushHistory('Merge Visible'), 0);
  },

  flattenImage: () => {
    set((s) => {
      const flat = createBlankCanvas(s.docWidth, s.docHeight);
      const ctx = flat.getContext('2d')!;
      // Fill white background first
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, s.docWidth, s.docHeight);
      for (const layer of s.layers) {
        ctx.save();
        ctx.globalAlpha = layer.opacity;
        ctx.globalCompositeOperation = layer.blendMode;
        ctx.drawImage(layer.canvas, 0, 0);
        ctx.restore();
      }
      const newLayer: LayerData = {
        id: generateId(),
        name: 'Background',
        visible: true,
        opacity: 1,
        blendMode: 'source-over',
        locked: false,
        canvas: flat,
        thumbnail: generateThumbnail(flat),
      };
      return { layers: [newLayer], activeLayerId: newLayer.id };
    });
    setTimeout(() => get().pushHistory('Flatten Image'), 0);
  },

  setActiveLayer: (id) => set({ activeLayerId: id }),

  updateLayer: (id, patch) => set((s) => ({
    layers: s.layers.map((l) => l.id === id ? { ...l, ...patch } : l),
  })),

  renameLayer: (id, name) => set((s) => ({
    layers: s.layers.map((l) => l.id === id ? { ...l, name } : l),
  })),

  reorderLayers: (fromIndex, toIndex) => set((s) => {
    const newLayers = [...s.layers];
    const [moved] = newLayers.splice(fromIndex, 1);
    newLayers.splice(toIndex, 0, moved);
    return { layers: newLayers };
  }),

  refreshThumbnail: (id) => set((s) => ({
    layers: s.layers.map((l) => l.id === id ? { ...l, thumbnail: generateThumbnail(l.canvas) } : l),
  })),

  replaceLayerCanvas: (id, canvas) => set((s) => ({
    layers: s.layers.map((l) => l.id === id ? { ...l, canvas, thumbnail: generateThumbnail(canvas) } : l),
  })),

  addLayerMask: (id) => set((s) => {
    const layer = s.layers.find((l) => l.id === id);
    if (!layer || layer.maskCanvas) return s;
    // If there's a selection, use it as the mask; otherwise white (all visible)
    const mask = createBlankCanvas(s.docWidth, s.docHeight);
    const mctx = mask.getContext('2d')!;
    if (s.selectionMask) {
      mctx.drawImage(s.selectionMask, 0, 0);
    } else {
      mctx.fillStyle = '#ffffff';
      mctx.fillRect(0, 0, s.docWidth, s.docHeight);
    }
    return {
      layers: s.layers.map((l) => l.id === id ? { ...l, maskCanvas: mask, maskEnabled: true } : l),
      editingMask: true,
    };
  }),

  removeLayerMask: (id) => set((s) => ({
    layers: s.layers.map((l) => l.id === id ? { ...l, maskCanvas: null } : l),
    editingMask: false,
  })),

  toggleLayerMask: (id) => set((s) => ({
    layers: s.layers.map((l) => l.id === id && l.maskCanvas ? { ...l, maskEnabled: !l.maskEnabled } : l),
  })),

  replaceLayerMask: (id, mask) => set((s) => ({
    layers: s.layers.map((l) => l.id === id ? { ...l, maskCanvas: mask } : l),
  })),

  setEditingMask: (v) => set({ editingMask: v }),
  setSettingSource: (v) => set({ settingSource: v }),

  setSelection: (mask, bounds) => set({ selectionMask: mask, selectionBounds: bounds }),
  clearSelection: () => set({ selectionMask: null, selectionBounds: null }),
  selectAll: () => {
    const { docWidth, docHeight } = get();
    const mask = createBlankCanvas(docWidth, docHeight);
    const ctx = mask.getContext('2d')!;
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, docWidth, docHeight);
    set({ selectionMask: mask, selectionBounds: { x: 0, y: 0, w: docWidth, h: docHeight } });
  },
  invertSelection: () => {
    const { selectionMask, docWidth, docHeight } = get();
    if (!selectionMask) {
      // If no selection, invert means select nothing (empty mask) - unusual. Or select nothing then everything. Photoshop makes empty selection.
      const mask = createBlankCanvas(docWidth, docHeight);
      set({ selectionMask: mask, selectionBounds: { x: 0, y: 0, w: 0, h: 0 } });
      return;
    }
    const ctx = selectionMask.getContext('2d')!;
    const imageData = ctx.getImageData(0, 0, docWidth, docHeight);
    const data = imageData.data;
    for (let i = 0; i < data.length; i += 4) {
      data[i] = 255 - data[i];
      data[i + 1] = 255 - data[i + 1];
      data[i + 2] = 255 - data[i + 2];
      // keep alpha
    }
    ctx.putImageData(imageData, 0, 0);
    set({ selectionMask: selectionMask });
  },

  featherSelection: (radius) => {
    const { selectionMask } = get();
    if (!selectionMask || radius <= 0) return;
    featherMask(selectionMask, radius);
    set({ selectionMask: selectionMask });
  },

  expandSelection: (pixels) => {
    const { selectionMask, docWidth, docHeight } = get();
    if (!selectionMask || pixels <= 0) return;
    // Dilate the mask
    const ctx = selectionMask.getContext('2d', { willReadFrequently: true })!;
    const imageData = ctx.getImageData(0, 0, docWidth, docHeight);
    const src = imageData.data;
    const dst = new Uint8ClampedArray(src);
    const r = Math.max(1, Math.round(pixels));
    for (let y = 0; y < docHeight; y++) {
      for (let x = 0; x < docWidth; x++) {
        const idx = (y * docWidth + x) * 4;
        // Check if any neighbor within radius is selected
        let maxAlpha = 0;
        for (let dy = -r; dy <= r; dy++) {
          for (let dx = -r; dx <= r; dx++) {
            if (dx * dx + dy * dy > r * r) continue;
            const nx = x + dx, ny = y + dy;
            if (nx < 0 || nx >= docWidth || ny < 0 || ny >= docHeight) continue;
            const nIdx = (ny * docWidth + nx) * 4;
            maxAlpha = Math.max(maxAlpha, src[nIdx + 3]);
          }
        }
        dst[idx + 3] = maxAlpha;
      }
    }
    ctx.putImageData(new ImageData(dst, docWidth, docHeight), 0, 0);
    set({ selectionMask: selectionMask });
  },

  contractSelection: (pixels) => {
    const { selectionMask, docWidth, docHeight } = get();
    if (!selectionMask || pixels <= 0) return;
    // Erode the mask
    const ctx = selectionMask.getContext('2d', { willReadFrequently: true })!;
    const imageData = ctx.getImageData(0, 0, docWidth, docHeight);
    const src = imageData.data;
    const dst = new Uint8ClampedArray(src);
    const r = Math.max(1, Math.round(pixels));
    for (let y = 0; y < docHeight; y++) {
      for (let x = 0; x < docWidth; x++) {
        const idx = (y * docWidth + x) * 4;
        // Check if all neighbors within radius are selected
        let minAlpha = 255;
        for (let dy = -r; dy <= r; dy++) {
          for (let dx = -r; dx <= r; dx++) {
            if (dx * dx + dy * dy > r * r) continue;
            const nx = x + dx, ny = y + dy;
            if (nx < 0 || nx >= docWidth || ny < 0 || ny >= docHeight) {
              minAlpha = 0;
              break;
            }
            const nIdx = (ny * docWidth + nx) * 4;
            minAlpha = Math.min(minAlpha, src[nIdx + 3]);
            if (minAlpha === 0) break;
          }
          if (minAlpha === 0) break;
        }
        dst[idx + 3] = minAlpha;
      }
    }
    ctx.putImageData(new ImageData(dst, docWidth, docHeight), 0, 0);
    set({ selectionMask: selectionMask });
  },

  pushHistory: (label) => {
    set((s) => {
      const settings = s.perfSettings;
      const maxHistory = settings.maxHistoryStates;
      // Use JPEG for history snapshots (much smaller than PNG) when layer is fully opaque
      // PNG preserves alpha but is 5-10x larger
      const snapshots: LayerSnapshot[] = s.layers.map((l) => {
        // Check if layer has any transparency
        const ctx = l.canvas.getContext('2d', { willReadFrequently: true })!;
        // Quick check: sample a few pixels to detect transparency (faster than full scan)
        let hasAlpha = false;
        const data = ctx.getImageData(0, 0, l.canvas.width, l.canvas.height).data;
        for (let i = 3; i < data.length; i += 4) {
          if (data[i] < 255) { hasAlpha = true; break; }
        }
        const dataUrl = hasAlpha
          ? l.canvas.toDataURL('image/png')
          : l.canvas.toDataURL('image/jpeg', settings.historyImageQuality);
        return {
          id: l.id,
          name: l.name,
          visible: l.visible,
          opacity: l.opacity,
          blendMode: l.blendMode,
          locked: l.locked,
          dataUrl,
          maskDataUrl: l.maskCanvas ? canvasToDataUrl(l.maskCanvas) : null,
          maskEnabled: l.maskEnabled,
        };
      });
      const entry: HistoryEntry = {
        id: generateId(),
        label,
        timestamp: Date.now(),
        layers: snapshots,
        activeLayerId: s.activeLayerId,
        docWidth: s.docWidth,
        docHeight: s.docHeight,
      };
      // Truncate any redo history
      const truncated = s.history.slice(0, s.historyIndex + 1);
      truncated.push(entry);
      // Cap history based on perf settings
      while (truncated.length > maxHistory) {
        truncated.shift();
      }
      return { history: truncated, historyIndex: truncated.length - 1 };
    });
  },

  undo: () => {
    set((s) => {
      if (s.historyIndex <= 0) return s;
      const newIndex = s.historyIndex - 1;
      const entry = s.history[newIndex];
      restoreFromHistory(entry);
      return { historyIndex: newIndex };
    });
  },

  redo: () => {
    set((s) => {
      if (s.historyIndex >= s.history.length - 1) return s;
      const newIndex = s.historyIndex + 1;
      const entry = s.history[newIndex];
      restoreFromHistory(entry);
      return { historyIndex: newIndex };
    });
  },

  canUndo: () => get().historyIndex > 0,
  canRedo: () => get().historyIndex < get().history.length - 1,

  // Guides
  addGuide: (orientation, pos) => set((s) => {
    if (orientation === 'h') {
      // Avoid duplicates
      if (s.guides.y.includes(pos)) return s;
      return { guides: { x: s.guides.x, y: [...s.guides.y, pos].sort((a, b) => a - b) } };
    } else {
      if (s.guides.x.includes(pos)) return s;
      return { guides: { x: [...s.guides.x, pos].sort((a, b) => a - b), y: s.guides.y } };
    }
  }),
  removeGuide: (orientation, index) => set((s) => {
    if (orientation === 'h') {
      const newY = [...s.guides.y];
      newY.splice(index, 1);
      return { guides: { x: s.guides.x, y: newY } };
    } else {
      const newX = [...s.guides.x];
      newX.splice(index, 1);
      return { guides: { x: newX, y: s.guides.y } };
    }
  }),
  clearGuides: () => set({ guides: { x: [], y: [] } }),
  toggleRulers: () => set((s) => ({ showRulers: !s.showRulers })),
  toggleSnapToGuides: () => set((s) => ({ snapToGuides: !s.snapToGuides })),
  toggleGrid: () => set((s) => ({ showGrid: !s.showGrid })),

  setZoom: (z) => set({ zoom: Math.max(0.05, Math.min(32, z)) }),
  setPan: (x, y) => set({ panX: x, panY: y }),
  setDocName: (name) => set({ docName: name }),

  // Performance settings
  perfSettings: DEFAULT_PERF_SETTINGS,
  setPerfSettings: (settings) => set((s) => ({ perfSettings: { ...s.perfSettings, ...settings } })),

  // Tutorial
  tutorialActive: false,
  tutorialStep: 0,
  setTutorialActive: (v) => set({ tutorialActive: v }),
  setTutorialStep: (v) => set({ tutorialStep: v }),
  startTutorial: () => {
    set({ tutorialActive: true, tutorialStep: 0 });
    // Load a sample tutorial image
    const w = 1024, h = 768;
    const canvas = createBlankCanvas(w, h);
    const ctx = canvas.getContext('2d')!;
    // Sky gradient
    const skyGrad = ctx.createLinearGradient(0, 0, 0, h * 0.6);
    skyGrad.addColorStop(0, '#1e3a5f');
    skyGrad.addColorStop(0.5, '#4a90d9');
    skyGrad.addColorStop(1, '#f0a060');
    ctx.fillStyle = skyGrad;
    ctx.fillRect(0, 0, w, h * 0.6);
    // Sun
    const sunGrad = ctx.createRadialGradient(w * 0.7, h * 0.2, 10, w * 0.7, h * 0.2, 80);
    sunGrad.addColorStop(0, '#fff8e0');
    sunGrad.addColorStop(0.5, '#fde047');
    sunGrad.addColorStop(1, 'rgba(253,224,71,0)');
    ctx.fillStyle = sunGrad;
    ctx.beginPath();
    ctx.arc(w * 0.7, h * 0.2, 80, 0, Math.PI * 2);
    ctx.fill();
    // Mountains (back)
    ctx.fillStyle = '#4a5568';
    ctx.beginPath();
    ctx.moveTo(0, h * 0.55);
    ctx.lineTo(w * 0.2, h * 0.3);
    ctx.lineTo(w * 0.4, h * 0.45);
    ctx.lineTo(w * 0.6, h * 0.25);
    ctx.lineTo(w * 0.8, h * 0.4);
    ctx.lineTo(w, h * 0.35);
    ctx.lineTo(w, h * 0.6);
    ctx.lineTo(0, h * 0.6);
    ctx.closePath();
    ctx.fill();
    // Mountains (front)
    ctx.fillStyle = '#2d3748';
    ctx.beginPath();
    ctx.moveTo(0, h * 0.6);
    ctx.lineTo(w * 0.15, h * 0.4);
    ctx.lineTo(w * 0.35, h * 0.5);
    ctx.lineTo(w * 0.55, h * 0.35);
    ctx.lineTo(w * 0.75, h * 0.48);
    ctx.lineTo(w, h * 0.42);
    ctx.lineTo(w, h * 0.7);
    ctx.lineTo(0, h * 0.7);
    ctx.closePath();
    ctx.fill();
    // Ground
    const groundGrad = ctx.createLinearGradient(0, h * 0.6, 0, h);
    groundGrad.addColorStop(0, '#2d4a2d');
    groundGrad.addColorStop(1, '#1a2e1a');
    ctx.fillStyle = groundGrad;
    ctx.fillRect(0, h * 0.6, w, h * 0.4);
    // Trees
    ctx.fillStyle = '#1a3a1a';
    for (const [tx, ty] of [[100, 550], [200, 580], [850, 560], [950, 590]]) {
      ctx.fillStyle = '#451a03';
      ctx.fillRect(tx - 4, ty, 8, 50);
      ctx.fillStyle = '#166534';
      ctx.beginPath();
      ctx.arc(tx, ty - 10, 30, 0, Math.PI * 2);
      ctx.fill();
    }
    // Create the document with this image
    get().newDocument(w, h, '#ffffff');
    setTimeout(() => {
      const state = get();
      const layerId = state.addLayer('Tutorial Photo');
      const newState = get();
      const layer = newState.layers.find((l) => l.id === layerId);
      if (layer) {
        const lctx = layer.canvas.getContext('2d')!;
        lctx.drawImage(canvas, 0, 0);
        newState.refreshThumbnail(layerId);
      }
    }, 100);
  },
  endTutorial: () => set({ tutorialActive: false, tutorialStep: 0 }),
}));

// Restore editor state from a history entry
async function restoreFromHistory(entry: HistoryEntry) {
  const store = useEditorStore.getState();
  // Use the entry's document dimensions if available (needed for Crop undo —
  // otherwise the layer canvases would be created at the post-crop size and
  // the original image would be clipped/truncated).
  const docWidth = entry.docWidth ?? store.docWidth;
  const docHeight = entry.docHeight ?? store.docHeight;
  const newLayers: LayerData[] = [];
  for (const snap of entry.layers) {
    const canvas = createBlankCanvas(docWidth, docHeight);
    await loadIntoCanvas(canvas, snap.dataUrl);
    let maskCanvas: HTMLCanvasElement | null = null;
    if (snap.maskDataUrl) {
      maskCanvas = createBlankCanvas(docWidth, docHeight);
      await loadIntoCanvas(maskCanvas, snap.maskDataUrl);
    }
    newLayers.push({
      id: snap.id,
      name: snap.name,
      visible: snap.visible,
      opacity: snap.opacity,
      blendMode: snap.blendMode,
      locked: snap.locked,
      canvas,
      thumbnail: generateThumbnail(canvas),
      maskCanvas,
      maskEnabled: snap.maskEnabled,
    });
  }
  useEditorStore.setState({
    layers: newLayers,
    activeLayerId: entry.activeLayerId,
    docWidth,
    docHeight,
  });
}

function loadIntoCanvas(canvas: HTMLCanvasElement, dataUrl: string): Promise<void> {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      const ctx = canvas.getContext('2d')!;
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(img, 0, 0);
      resolve();
    };
    img.src = dataUrl;
  });
}
