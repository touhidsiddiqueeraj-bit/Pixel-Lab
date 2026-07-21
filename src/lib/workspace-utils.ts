import { useEditorStore } from '@/lib/editor-store';
import { createBlankCanvas } from '@/lib/image-processing';
import type { LayerData } from '@/lib/editor-types';
import type { AgentWorkspace } from '@/lib/agent/tools';

export function cloneLayer(layer: LayerData, docWidth: number, docHeight: number): LayerData {
  const canvas = createBlankCanvas(docWidth, docHeight);
  const ctx = canvas.getContext('2d')!;
  ctx.drawImage(layer.canvas, 0, 0);
  let maskCanvas: HTMLCanvasElement | null = null;
  if (layer.maskCanvas) {
    maskCanvas = createBlankCanvas(docWidth, docHeight);
    maskCanvas.getContext('2d')!.drawImage(layer.maskCanvas, 0, 0);
  }
  return { ...layer, canvas, maskCanvas, thumbnail: '' };
}

export function snapshotWorkspace(): AgentWorkspace {
  const s = useEditorStore.getState();
  const layers = s.layers.map((l) => cloneLayer(l, s.docWidth, s.docHeight));
  let selectionMask: HTMLCanvasElement | null = null;
  if (s.selectionMask) {
    selectionMask = createBlankCanvas(s.docWidth, s.docHeight);
    selectionMask.getContext('2d')!.drawImage(s.selectionMask, 0, 0);
  }
  return {
    layers,
    activeLayerId: s.activeLayerId,
    docWidth: s.docWidth,
    docHeight: s.docHeight,
    selectionMask,
    selectionBounds: s.selectionBounds ? { ...s.selectionBounds } : null,
  };
}

export function commitWorkspace(ws: AgentWorkspace, historyLabel: string): void {
  const editorStore = useEditorStore.getState();
  const s = useEditorStore.getState();
  for (const wsLayer of ws.layers) {
    const liveLayer = s.layers.find((l) => l.id === wsLayer.id);
    if (!liveLayer) continue;
    const ctx = liveLayer.canvas.getContext('2d')!;
    ctx.clearRect(0, 0, liveLayer.canvas.width, liveLayer.canvas.height);
    ctx.drawImage(wsLayer.canvas, 0, 0);
    if (wsLayer.maskCanvas) {
      if (!liveLayer.maskCanvas) {
        liveLayer.maskCanvas = createBlankCanvas(s.docWidth, s.docHeight);
      }
      const mctx = liveLayer.maskCanvas.getContext('2d')!;
      mctx.clearRect(0, 0, liveLayer.maskCanvas.width, liveLayer.maskCanvas.height);
      mctx.drawImage(wsLayer.maskCanvas, 0, 0);
      liveLayer.maskEnabled = wsLayer.maskEnabled;
    }
    editorStore.refreshThumbnail(wsLayer.id);
  }
  editorStore.pushHistory(historyLabel);
}
