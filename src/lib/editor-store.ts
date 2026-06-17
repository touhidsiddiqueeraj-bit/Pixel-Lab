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

const DEFAULT_TOOL_OPTIONS: ToolOptions = {
  brushSize: 20,
  brushHardness: 80,
  brushOpacity: 100,
  tolerance: 32,
  fontSize: 48,
  fontFamily: 'Inter, sans-serif',
  shapeFilled: true,
  shapeStrokeWidth: 2,
  zoomLevel: 1,
};

const MAX_HISTORY = 40;

function generateId(): string {
  return Math.random().toString(36).substring(2, 11) + Date.now().toString(36);
}

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
  updateLayer: (id: string, patch: Partial<Omit<LayerData, 'id' | 'canvas' | 'thumbnail'>>) => void;
  renameLayer: (id: string, name: string) => void;
  reorderLayers: (fromIndex: number, toIndex: number) => void;
  refreshThumbnail: (id: string) => void;
  replaceLayerCanvas: (id: string, canvas: HTMLCanvasElement) => void;

  setSelection: (mask: HTMLCanvasElement | null, bounds: { x: number; y: number; w: number; h: number } | null) => void;
  clearSelection: () => void;
  selectAll: () => void;
  invertSelection: () => void;

  pushHistory: (label: string) => void;
  undo: () => void;
  redo: () => void;
  canUndo: () => boolean;
  canRedo: () => boolean;

  setZoom: (z: number) => void;
  setPan: (x: number, y: number) => void;
  setDocName: (name: string) => void;
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
    };
    set({
      layers: [...state.layers, newLayer],
      activeLayerId: newLayer.id,
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
      const newLayer: LayerData = {
        ...orig,
        id: generateId(),
        name: `${orig.name} copy`,
        canvas: newCanvas,
        thumbnail: generateThumbnail(newCanvas),
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

  pushHistory: (label) => {
    set((s) => {
      const snapshots: LayerSnapshot[] = s.layers.map((l) => ({
        id: l.id,
        name: l.name,
        visible: l.visible,
        opacity: l.opacity,
        blendMode: l.blendMode,
        locked: l.locked,
        dataUrl: canvasToDataUrl(l.canvas),
      }));
      const entry: HistoryEntry = {
        id: generateId(),
        label,
        timestamp: Date.now(),
        layers: snapshots,
        activeLayerId: s.activeLayerId,
      };
      // Truncate any redo history
      const truncated = s.history.slice(0, s.historyIndex + 1);
      truncated.push(entry);
      // Cap history
      if (truncated.length > MAX_HISTORY) {
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

  setZoom: (z) => set({ zoom: Math.max(0.05, Math.min(32, z)) }),
  setPan: (x, y) => set({ panX: x, panY: y }),
  setDocName: (name) => set({ docName: name }),
}));

// Restore editor state from a history entry
async function restoreFromHistory(entry: HistoryEntry) {
  const store = useEditorStore.getState();
  const newLayers: LayerData[] = [];
  for (const snap of entry.layers) {
    const canvas = createBlankCanvas(store.docWidth, store.docHeight);
    await loadIntoCanvas(canvas, snap.dataUrl);
    newLayers.push({
      id: snap.id,
      name: snap.name,
      visible: snap.visible,
      opacity: snap.opacity,
      blendMode: snap.blendMode,
      locked: snap.locked,
      canvas,
      thumbnail: generateThumbnail(canvas),
    });
  }
  useEditorStore.setState({
    layers: newLayers,
    activeLayerId: entry.activeLayerId,
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
