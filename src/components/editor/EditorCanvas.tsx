'use client';

import { useEditorStore } from '@/lib/editor-store';
import { ToolType, BlendMode } from '@/lib/editor-types';
import { useEffect, useRef, useState, useCallback } from 'react';
import {
  createBlankCanvas,
  hexToRgb,
  sampleColor,
  generateThumbnail,
} from '@/lib/image-processing';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';

interface Point { x: number; y: number; }

export function EditorCanvas() {
  const layers = useEditorStore((s) => s.layers);
  const activeLayerId = useEditorStore((s) => s.activeLayerId);
  const activeTool = useEditorStore((s) => s.activeTool);
  const toolOptions = useEditorStore((s) => s.toolOptions);
  const foreground = useEditorStore((s) => s.foregroundColor);
  const background = useEditorStore((s) => s.backgroundColor);
  const zoom = useEditorStore((s) => s.zoom);
  const panX = useEditorStore((s) => s.panX);
  const panY = useEditorStore((s) => s.panY);
  const docWidth = useEditorStore((s) => s.docWidth);
  const docHeight = useEditorStore((s) => s.docHeight);
  const selectionMask = useEditorStore((s) => s.selectionMask);
  const selectionBounds = useEditorStore((s) => s.selectionBounds);
  const setSelection = useEditorStore((s) => s.setSelection);
  const clearSelection = useEditorStore((s) => s.clearSelection);
  const setZoom = useEditorStore((s) => s.setZoom);
  const setPan = useEditorStore((s) => s.setPan);
  const setForeground = useEditorStore((s) => s.setForeground);
  const refreshThumbnail = useEditorStore((s) => s.refreshThumbnail);
  const pushHistory = useEditorStore((s) => s.pushHistory);
  const setToolOptions = useEditorStore((s) => s.setToolOptions);
  const setTool = useEditorStore((s) => s.setTool);

  const containerRef = useRef<HTMLDivElement>(null);
  const compositeCanvasRef = useRef<HTMLCanvasElement>(null);
  const overlayCanvasRef = useRef<HTMLCanvasElement>(null);
  const checkerRef = useRef<HTMLCanvasElement>(null);

  // Tool state
  const drawingRef = useRef(false);
  const lastPointRef = useRef<Point | null>(null);
  const startPointRef = useRef<Point | null>(null);
  const lassoPointsRef = useRef<Point[]>([]);
  const polygonPointsRef = useRef<Point[]>([]);
  const panStartRef = useRef<{ x: number; y: number; panX: number; panY: number } | null>(null);

  // For brush stroke compositing - we draw into a temp canvas, then composite to layer
  const strokeCanvasRef = useRef<HTMLCanvasElement | null>(null);
  // Spacebar state for pan mode
  const spacePressed = useRef(false);

  const [cursorPos, setCursorPos] = useState<Point | null>(null);
  const [, forceRender] = useState(0);
  const [containerSize, setContainerSize] = useState<{ w: number; h: number }>({ w: 0, h: 0 });

  // Build a checkerboard pattern canvas (for transparency)
  useEffect(() => {
    const size = 16;
    const c = document.createElement('canvas');
    c.width = size * 2;
    c.height = size * 2;
    const ctx = c.getContext('2d')!;
    ctx.fillStyle = '#6b7280';
    ctx.fillRect(0, 0, size * 2, size * 2);
    ctx.fillStyle = '#9ca3af';
    ctx.fillRect(0, 0, size, size);
    ctx.fillRect(size, size, size, size);
    checkerRef.current = c;
  }, []);

  // Composite all visible layers onto the visible canvas
  const composite = useCallback(() => {
    const canvas = compositeCanvasRef.current;
    if (!canvas) return;
    canvas.width = docWidth;
    canvas.height = docHeight;
    const ctx = canvas.getContext('2d')!;
    ctx.clearRect(0, 0, docWidth, docHeight);

    for (const layer of layers) {
      if (!layer.visible) continue;
      ctx.save();
      ctx.globalAlpha = layer.opacity;
      ctx.globalCompositeOperation = layer.blendMode as GlobalCompositeOperation;
      ctx.drawImage(layer.canvas, 0, 0);
      ctx.restore();
    }
  }, [layers, docWidth, docHeight]);

  // Draw overlay (selection, lasso preview, etc.)
  const drawOverlay = useCallback(() => {
    const canvas = overlayCanvasRef.current;
    if (!canvas) return;
    canvas.width = docWidth;
    canvas.height = docHeight;
    const ctx = canvas.getContext('2d')!;
    ctx.clearRect(0, 0, docWidth, docHeight);

    // Selection marquee ("marching ants")
    if (selectionMask && selectionBounds) {
      const { x, y, w, h } = selectionBounds;
      if (w > 0 && h > 0) {
        ctx.save();
        ctx.strokeStyle = '#000000';
        ctx.lineWidth = 1;
        ctx.setLineDash([4, 4]);
        ctx.lineDashOffset = -(Date.now() / 80) % 8;
        ctx.strokeRect(x + 0.5, y + 0.5, w, h);
        ctx.strokeStyle = '#ffffff';
        ctx.lineDashOffset = (-(Date.now() / 80) % 8) + 4;
        ctx.strokeRect(x + 0.5, y + 0.5, w, h);
        ctx.restore();
      }
    }

    // Polygonal lasso in-progress
    if (activeTool === 'polygonal-lasso' && polygonPointsRef.current.length > 0) {
      const pts = polygonPointsRef.current;
      ctx.save();
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 1;
      ctx.setLineDash([4, 4]);
      ctx.beginPath();
      ctx.moveTo(pts[0].x, pts[0].y);
      for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
      if (cursorPos) ctx.lineTo(cursorPos.x, cursorPos.y);
      ctx.stroke();
      ctx.restore();
    }
  }, [selectionMask, selectionBounds, activeTool, cursorPos, docWidth, docHeight]);

  // Animation loop for marching ants
  useEffect(() => {
    if (!selectionMask) return;
    let raf: number;
    const tick = () => {
      drawOverlay();
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [selectionMask, drawOverlay]);

  // Recomposite on layer changes
  useEffect(() => {
    composite();
  }, [composite]);

  // Redraw overlay on relevant state changes
  useEffect(() => {
    drawOverlay();
  }, [drawOverlay]);

  // Convert client coords to canvas coords
  const toCanvasCoords = useCallback((clientX: number, clientY: number): Point => {
    const canvas = compositeCanvasRef.current;
    if (!canvas) return { x: 0, y: 0 };
    const rect = canvas.getBoundingClientRect();
    const x = ((clientX - rect.left) / rect.width) * docWidth;
    const y = ((clientY - rect.top) / rect.height) * docHeight;
    return { x, y };
  }, [docWidth, docHeight]);

  // Get active layer
  const getActiveLayer = useCallback(() => layers.find((l) => l.id === activeLayerId) ?? null, [layers, activeLayerId]);

  // Stroke canvas for brush/eraser (accumulates one continuous stroke)
  const ensureStrokeCanvas = useCallback(() => {
    if (!strokeCanvasRef.current) {
      strokeCanvasRef.current = createBlankCanvas(docWidth, docHeight);
    } else if (strokeCanvasRef.current.width !== docWidth || strokeCanvasRef.current.height !== docHeight) {
      strokeCanvasRef.current = createBlankCanvas(docWidth, docHeight);
    }
    return strokeCanvasRef.current;
  }, [docWidth, docHeight]);

  // Drawing tools: brush stroke segment
  const drawStrokeSegment = useCallback((from: Point, to: Point, opts: {
    color: string;
    size: number;
    hardness: number;
    opacity: number;
    erase: boolean;
  }) => {
    const strokeCanvas = ensureStrokeCanvas();
    const ctx = strokeCanvas.getContext('2d')!;
    const { color, size, hardness, opacity, erase } = opts;
    const radius = Math.max(0.5, size / 2);

    // Use a temporary canvas for this segment with a radial gradient based on hardness
    ctx.save();
    ctx.globalAlpha = opacity / 100;
    if (erase) {
      ctx.globalCompositeOperation = 'destination-out';
      ctx.strokeStyle = 'rgba(0,0,0,1)';
    } else {
      ctx.globalCompositeOperation = 'source-over';
      ctx.strokeStyle = color;
    }
    ctx.lineWidth = size;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    // If hardness is 100, just draw a solid line. Otherwise use multiple passes for soft edge.
    if (hardness >= 99 || erase) {
      ctx.beginPath();
      ctx.moveTo(from.x, from.y);
      ctx.lineTo(to.x, to.y);
      ctx.stroke();
    } else {
      // Soft brush: draw with multiple alpha layers
      const passes = 8;
      const softFactor = (100 - hardness) / 100;
      for (let i = 0; i < passes; i++) {
        const r = radius * (1 - i * softFactor / passes * 0.9);
        if (r < 0.5) break;
        ctx.globalAlpha = (opacity / 100) * (1 / passes);
        ctx.lineWidth = r * 2;
        ctx.beginPath();
        ctx.moveTo(from.x, from.y);
        ctx.lineTo(to.x, to.y);
        ctx.stroke();
      }
    }
    ctx.restore();
  }, [ensureStrokeCanvas]);

  // Commit the stroke canvas onto the active layer (respecting selection)
  const commitStrokeToLayer = useCallback(() => {
    const layer = getActiveLayer();
    if (!layer || !strokeCanvasRef.current) return;
    const ctx = layer.canvas.getContext('2d')!;
    ctx.save();
    // If there's a selection, clip to it
    if (selectionMask) {
      // Use mask as clip - mask is white where selected
      // We can use destination-in approach: composite stroke onto layer, then mask result
      ctx.save();
      // Create clip from mask
      const clipCanvas = createBlankCanvas(docWidth, docHeight);
      const clipCtx = clipCanvas.getContext('2d')!;
      clipCtx.drawImage(selectionMask, 0, 0);
      // We need to apply stroke only inside the mask area.
      // Approach: draw stroke to a temp canvas, apply mask via destination-in, then draw onto layer.
      const tmp = createBlankCanvas(docWidth, docHeight);
      const tmpCtx = tmp.getContext('2d')!;
      tmpCtx.drawImage(strokeCanvasRef.current, 0, 0);
      tmpCtx.globalCompositeOperation = 'destination-in';
      tmpCtx.drawImage(clipCanvas, 0, 0);
      ctx.restore();
      ctx.drawImage(tmp, 0, 0);
    } else {
      ctx.drawImage(strokeCanvasRef.current, 0, 0);
    }
    ctx.restore();
    refreshThumbnail(layer.id);
  }, [getActiveLayer, selectionMask, docWidth, docHeight, refreshThumbnail]);

  const clearStrokeCanvas = useCallback(() => {
    if (strokeCanvasRef.current) {
      const ctx = strokeCanvasRef.current.getContext('2d')!;
      ctx.clearRect(0, 0, strokeCanvasRef.current.width, strokeCanvasRef.current.height);
    }
  }, []);

  // Preview stroke (draw stroke canvas on top of composite)
  const previewStroke = useCallback(() => {
    const canvas = compositeCanvasRef.current;
    if (!canvas || !strokeCanvasRef.current) return;
    const ctx = canvas.getContext('2d')!;
    ctx.save();
    if (activeTool === 'eraser') {
      // For eraser preview, we need to show what the layer will look like after erasing
      // Re-composite first, then apply eraser as destination-out
      composite();
      const layer = getActiveLayer();
      if (layer) {
        // Create a temp copy of the layer with the eraser applied, draw it in place
        const tmp = createBlankCanvas(docWidth, docHeight);
        const tmpCtx = tmp.getContext('2d')!;
        tmpCtx.drawImage(layer.canvas, 0, 0);
        tmpCtx.globalCompositeOperation = 'destination-out';
        tmpCtx.drawImage(strokeCanvasRef.current, 0, 0);
        // Re-composite but replace the active layer
        ctx.clearRect(0, 0, docWidth, docHeight);
        for (const l of layers) {
          if (!l.visible) continue;
          ctx.save();
          ctx.globalAlpha = l.opacity;
          ctx.globalCompositeOperation = l.blendMode as GlobalCompositeOperation;
          if (l.id === activeLayerId) {
            ctx.drawImage(tmp, 0, 0);
          } else {
            ctx.drawImage(l.canvas, 0, 0);
          }
          ctx.restore();
        }
      }
    } else {
      // For brush/pencil, composite normally then overlay stroke
      composite();
      const layer = getActiveLayer();
      if (layer) {
        ctx.save();
        ctx.globalAlpha = layer.opacity * (toolOptions.brushOpacity / 100);
        ctx.globalCompositeOperation = layer.blendMode as GlobalCompositeOperation;
        ctx.drawImage(strokeCanvasRef.current, 0, 0);
        ctx.restore();
      }
    }
    ctx.restore();
  }, [activeTool, composite, getActiveLayer, layers, activeLayerId, docWidth, docHeight, toolOptions.brushOpacity]);

  // Selection creation helpers
  const createRectMask = useCallback((x: number, y: number, w: number, h: number, ellipse: boolean) => {
    const mask = createBlankCanvas(docWidth, docHeight);
    const ctx = mask.getContext('2d')!;
    ctx.fillStyle = '#ffffff';
    if (ellipse) {
      ctx.beginPath();
      ctx.ellipse(x + w / 2, y + h / 2, Math.abs(w / 2), Math.abs(h / 2), 0, 0, Math.PI * 2);
      ctx.fill();
    } else {
      ctx.fillRect(x, y, w, h);
    }
    return { mask, bounds: { x: Math.min(x, x + w), y: Math.min(y, y + h), w: Math.abs(w), h: Math.abs(h) } };
  }, [docWidth, docHeight]);

  const createLassoMask = useCallback((points: Point[]) => {
    if (points.length < 2) return null;
    const mask = createBlankCanvas(docWidth, docHeight);
    const ctx = mask.getContext('2d')!;
    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.moveTo(points[0].x, points[0].y);
    for (let i = 1; i < points.length; i++) ctx.lineTo(points[i].x, points[i].y);
    ctx.closePath();
    ctx.fill();
    // Compute bounds
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const p of points) {
      minX = Math.min(minX, p.x);
      minY = Math.min(minY, p.y);
      maxX = Math.max(maxX, p.x);
      maxY = Math.max(maxY, p.y);
    }
    return { mask, bounds: { x: minX, y: minY, w: maxX - minX, h: maxY - minY } };
  }, [docWidth, docHeight]);

  // Magic wand selection: flood-fill pixels similar to clicked pixel
  const magicWand = useCallback((startX: number, startY: number, tolerance: number) => {
    const layer = getActiveLayer();
    if (!layer) return;
    startX = Math.floor(startX);
    startY = Math.floor(startY);
    if (startX < 0 || startY < 0 || startX >= docWidth || startY >= docHeight) return;
    const ctx = layer.canvas.getContext('2d', { willReadFrequently: true })!;
    const imageData = ctx.getImageData(0, 0, docWidth, docHeight);
    const data = imageData.data;
    const startIdx = (startY * docWidth + startX) * 4;
    const targetR = data[startIdx], targetG = data[startIdx + 1], targetB = data[startIdx + 2];
    const threshold = (tolerance / 100) * (150 * 150 * 3);
    const visited = new Uint8Array(docWidth * docHeight);
    const selected = new Uint8Array(docWidth * docHeight);
    const queue = [startY * docWidth + startX];
    visited[startY * docWidth + startX] = 1;
    while (queue.length > 0) {
      const idx = queue.shift()!;
      const i = idx * 4;
      const dr = data[i] - targetR;
      const dg = data[i + 1] - targetG;
      const db = data[i + 2] - targetB;
      const d2 = dr * dr + dg * dg + db * db;
      if (d2 > threshold) continue;
      selected[idx] = 1;
      const x = idx % docWidth;
      const y = Math.floor(idx / docWidth);
      if (x > 0 && !visited[idx - 1]) { visited[idx - 1] = 1; queue.push(idx - 1); }
      if (x < docWidth - 1 && !visited[idx + 1]) { visited[idx + 1] = 1; queue.push(idx + 1); }
      if (y > 0 && !visited[idx - docWidth]) { visited[idx - docWidth] = 1; queue.push(idx - docWidth); }
      if (y < docHeight - 1 && !visited[idx + docWidth]) { visited[idx + docWidth] = 1; queue.push(idx + docWidth); }
    }
    // Build mask
    const mask = createBlankCanvas(docWidth, docHeight);
    const mctx = mask.getContext('2d')!;
    const maskData = mctx.createImageData(docWidth, docHeight);
    for (let idx = 0; idx < selected.length; idx++) {
      if (selected[idx]) {
        const i = idx * 4;
        maskData.data[i] = 255;
        maskData.data[i + 1] = 255;
        maskData.data[i + 2] = 255;
        maskData.data[i + 3] = 255;
      }
    }
    mctx.putImageData(maskData, 0, 0);
    // Bounds
    let minX = docWidth, minY = docHeight, maxX = 0, maxY = 0;
    for (let y = 0; y < docHeight; y++) {
      for (let x = 0; x < docWidth; x++) {
        if (selected[y * docWidth + x]) {
          minX = Math.min(minX, x); minY = Math.min(minY, y);
          maxX = Math.max(maxX, x); maxY = Math.max(maxY, y);
        }
      }
    }
    setSelection(mask, { x: minX, y: minY, w: maxX - minX + 1, h: maxY - minY + 1 });
  }, [getActiveLayer, docWidth, docHeight, setSelection]);

  // Paint bucket fill
  const bucketFill = useCallback((startX: number, startY: number, color: string, tolerance: number) => {
    const layer = getActiveLayer();
    if (!layer || layer.locked) return;
    startX = Math.floor(startX);
    startY = Math.floor(startY);
    if (startX < 0 || startY < 0 || startX >= docWidth || startY >= docHeight) return;
    const ctx = layer.canvas.getContext('2d', { willReadFrequently: true })!;
    const imageData = ctx.getImageData(0, 0, docWidth, docHeight);
    const data = imageData.data;
    const startIdx = (startY * docWidth + startX) * 4;
    const targetR = data[startIdx], targetG = data[startIdx + 1], targetB = data[startIdx + 2], targetA = data[startIdx + 3];
    const rgb = hexToRgb(color);
    const threshold = (tolerance / 100) * (150 * 150 * 3);
    const visited = new Uint8Array(docWidth * docHeight);
    const queue = [startY * docWidth + startX];
    visited[startY * docWidth + startX] = 1;
    let count = 0;
    while (queue.length > 0) {
      const idx = queue.shift()!;
      const i = idx * 4;
      const dr = data[i] - targetR;
      const dg = data[i + 1] - targetG;
      const db = data[i + 2] - targetB;
      const da = data[i + 3] - targetA;
      const d2 = dr * dr + dg * dg + db * db + da * da;
      if (d2 > threshold) continue;
      data[i] = rgb.r; data[i + 1] = rgb.g; data[i + 2] = rgb.b; data[i + 3] = 255;
      count++;
      const x = idx % docWidth;
      const y = Math.floor(idx / docWidth);
      if (x > 0 && !visited[idx - 1]) { visited[idx - 1] = 1; queue.push(idx - 1); }
      if (x < docWidth - 1 && !visited[idx + 1]) { visited[idx + 1] = 1; queue.push(idx + 1); }
      if (y > 0 && !visited[idx - docWidth]) { visited[idx - docWidth] = 1; queue.push(idx - docWidth); }
      if (y < docHeight - 1 && !visited[idx + docWidth]) { visited[idx + docWidth] = 1; queue.push(idx + docWidth); }
    }
    ctx.putImageData(imageData, 0, 0);
    refreshThumbnail(layer.id);
    pushHistory('Bucket Fill');
    if (count === 0) toast.info('No matching pixels');
  }, [getActiveLayer, docWidth, docHeight, refreshThumbnail, pushHistory]);

  // Gradient fill
  const gradientFill = useCallback((from: Point, to: Point) => {
    const layer = getActiveLayer();
    if (!layer || layer.locked) return;
    const ctx = layer.canvas.getContext('2d')!;
    const fg = hexToRgb(foreground);
    const bg = hexToRgb(background);
    const gradient = ctx.createLinearGradient(from.x, from.y, to.x, to.y);
    gradient.addColorStop(0, `rgba(${fg.r}, ${fg.g}, ${fg.b}, 1)`);
    gradient.addColorStop(1, `rgba(${bg.r}, ${bg.g}, ${bg.b}, 1)`);
    ctx.save();
    if (selectionMask) {
      // Clip to selection
      const tmp = createBlankCanvas(docWidth, docHeight);
      const tmpCtx = tmp.getContext('2d')!;
      tmpCtx.fillStyle = gradient as unknown as string;
      // createLinearGradient returns CanvasGradient which is acceptable as fillStyle
      tmpCtx.fillStyle = gradient;
      tmpCtx.fillRect(0, 0, docWidth, docHeight);
      tmpCtx.globalCompositeOperation = 'destination-in';
      tmpCtx.drawImage(selectionMask, 0, 0);
      ctx.drawImage(tmp, 0, 0);
    } else {
      ctx.fillStyle = gradient;
      ctx.fillRect(0, 0, docWidth, docHeight);
    }
    ctx.restore();
    refreshThumbnail(layer.id);
    pushHistory('Gradient Fill');
  }, [getActiveLayer, foreground, background, selectionMask, docWidth, docHeight, refreshThumbnail, pushHistory]);

  // Draw shape (rectangle, ellipse, line)
  const drawShapeOnCtx = useCallback((ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, shape: 'rect' | 'ellipse' | 'line', from: Point, to: Point) => {
    const rgb = hexToRgb(foreground);
    ctx.fillStyle = `rgb(${rgb.r}, ${rgb.g}, ${rgb.b})`;
    ctx.strokeStyle = `rgb(${rgb.r}, ${rgb.g}, ${rgb.b})`;
    ctx.lineWidth = toolOptions.shapeStrokeWidth;
    if (shape === 'rect') {
      if (toolOptions.shapeFilled) ctx.fillRect(x, y, w, h);
      if (toolOptions.shapeStrokeWidth > 0) ctx.strokeRect(x, y, w, h);
    } else if (shape === 'ellipse') {
      ctx.beginPath();
      ctx.ellipse(x + w / 2, y + h / 2, w / 2, h / 2, 0, 0, Math.PI * 2);
      if (toolOptions.shapeFilled) ctx.fill();
      if (toolOptions.shapeStrokeWidth > 0) ctx.stroke();
    } else if (shape === 'line') {
      ctx.beginPath();
      ctx.moveTo(from.x, from.y);
      ctx.lineTo(to.x, to.y);
      ctx.lineWidth = Math.max(1, toolOptions.shapeStrokeWidth);
      ctx.stroke();
    }
  }, [foreground, toolOptions.shapeFilled, toolOptions.shapeStrokeWidth]);

  const drawShape = useCallback((from: Point, to: Point, shape: 'rect' | 'ellipse' | 'line') => {
    const layer = getActiveLayer();
    if (!layer || layer.locked) return;
    const ctx = layer.canvas.getContext('2d')!;
    const x = Math.min(from.x, to.x);
    const y = Math.min(from.y, to.y);
    const w = Math.abs(to.x - from.x);
    const h = Math.abs(to.y - from.y);
    ctx.save();
    if (selectionMask) {
      // Create clipping from mask
      const clipCanvas = createBlankCanvas(docWidth, docHeight);
      const clipCtx = clipCanvas.getContext('2d')!;
      clipCtx.drawImage(selectionMask, 0, 0);
      // Render shape onto tmp, then clip
      const tmp = createBlankCanvas(docWidth, docHeight);
      const tmpCtx = tmp.getContext('2d')!;
      drawShapeOnCtx(tmpCtx, x, y, w, h, shape, from, to);
      tmpCtx.globalCompositeOperation = 'destination-in';
      tmpCtx.drawImage(clipCanvas, 0, 0);
      ctx.drawImage(tmp, 0, 0);
    } else {
      drawShapeOnCtx(ctx, x, y, w, h, shape, from, to);
    }
    ctx.restore();
    refreshThumbnail(layer.id);
    pushHistory(`Draw ${shape}`);
  }, [getActiveLayer, selectionMask, docWidth, docHeight, refreshThumbnail, pushHistory, drawShapeOnCtx]);

  // Add text to layer
  const addText = useCallback((pos: Point) => {
    const layer = getActiveLayer();
    if (!layer || layer.locked) return;
    const text = prompt('Enter text:', 'Lorem ipsum');
    if (!text) return;
    const ctx = layer.canvas.getContext('2d')!;
    ctx.save();
    ctx.fillStyle = foreground;
    ctx.font = `${toolOptions.fontSize}px ${toolOptions.fontFamily}`;
    ctx.textBaseline = 'top';
    ctx.fillText(text, pos.x, pos.y);
    ctx.restore();
    refreshThumbnail(layer.id);
    pushHistory('Add Text');
  }, [getActiveLayer, foreground, toolOptions.fontSize, toolOptions.fontFamily, refreshThumbnail, pushHistory]);

  // Pan the canvas
  const handlePan = useCallback((clientX: number, clientY: number) => {
    if (!panStartRef.current) return;
    const dx = clientX - panStartRef.current.x;
    const dy = clientY - panStartRef.current.y;
    setPan(panStartRef.current.panX + dx, panStartRef.current.panY + dy);
  }, [setPan]);

  // Mouse event handlers
  const onPointerDown = useCallback((e: React.PointerEvent) => {
    if (e.button === 1 || (e.button === 0 && (activeTool === 'hand' || spacePressed.current || (e.altKey && activeTool !== 'eyedropper' && activeTool !== 'zoom')))) {
      // Pan with middle mouse or hand tool
      panStartRef.current = { x: e.clientX, y: e.clientY, panX, panY };
      (e.target as HTMLElement).setPointerCapture(e.pointerId);
      return;
    }

    const pt = toCanvasCoords(e.clientX, e.clientY);

    // Eyedropper
    if (activeTool === 'eyedropper') {
      const composite = compositeCanvasRef.current;
      if (composite) {
        const color = sampleColor(composite, Math.floor(pt.x), Math.floor(pt.y));
        if (color) {
          const hex = `#${[color.r, color.g, color.b].map((n) => Math.round(n).toString(16).padStart(2, '0')).join('')}`;
          setForeground(hex);
          toast.success(`Picked: ${hex}`);
        }
      }
      return;
    }

    // Zoom
    if (activeTool === 'zoom') {
      const factor = e.altKey ? 1 / 1.5 : 1.5;
      setZoom(zoom * factor);
      return;
    }

    // Move tool (no immediate action on down)
    if (activeTool === 'move') {
      drawingRef.current = true;
      startPointRef.current = pt;
      return;
    }

    // Crop
    if (activeTool === 'crop') {
      drawingRef.current = true;
      startPointRef.current = pt;
      return;
    }

    // Selection tools
    if (activeTool === 'marquee-rect' || activeTool === 'marquee-ellipse') {
      if (e.shiftKey) {
        // Add to selection - not fully supported, just replace
      } else {
        clearSelection();
      }
      drawingRef.current = true;
      startPointRef.current = pt;
      return;
    }

    if (activeTool === 'lasso') {
      drawingRef.current = true;
      lassoPointsRef.current = [pt];
      return;
    }

    if (activeTool === 'polygonal-lasso') {
      // If close to first point, close polygon
      const pts = polygonPointsRef.current;
      if (pts.length >= 3) {
        const first = pts[0];
        const dx = pt.x - first.x;
        const dy = pt.y - first.y;
        if (Math.sqrt(dx * dx + dy * dy) < 10) {
          const result = createLassoMask(pts);
          if (result) setSelection(result.mask, result.bounds);
          polygonPointsRef.current = [];
          return;
        }
      }
      polygonPointsRef.current.push(pt);
      forceRender(v => v + 1);
      return;
    }

    if (activeTool === 'magnetic-lasso') {
      drawingRef.current = true;
      lassoPointsRef.current = [pt];
      return;
    }

    if (activeTool === 'magic-wand') {
      magicWand(pt.x, pt.y, toolOptions.tolerance);
      return;
    }

    if (activeTool === 'bucket') {
      bucketFill(pt.x, pt.y, foreground, toolOptions.tolerance);
      return;
    }

    if (activeTool === 'gradient') {
      drawingRef.current = true;
      startPointRef.current = pt;
      return;
    }

    if (activeTool === 'text') {
      addText(pt);
      return;
    }

    if (activeTool === 'shape-rect' || activeTool === 'shape-ellipse' || activeTool === 'shape-line') {
      drawingRef.current = true;
      startPointRef.current = pt;
      return;
    }

    // Brush / pencil / eraser
    if (activeTool === 'brush' || activeTool === 'pencil' || activeTool === 'eraser') {
      const layer = getActiveLayer();
      if (!layer) {
        toast.error('No active layer');
        return;
      }
      if (layer.locked) {
        toast.error('Layer is locked');
        return;
      }
      drawingRef.current = true;
      clearStrokeCanvas();
      const hardness = activeTool === 'pencil' ? 100 : toolOptions.brushHardness;
      drawStrokeSegment(pt, pt, {
        color: foreground,
        size: toolOptions.brushSize,
        hardness,
        opacity: toolOptions.brushOpacity,
        erase: activeTool === 'eraser',
      });
      previewStroke();
      lastPointRef.current = pt;
      return;
    }
  }, [
    activeTool, panX, panY, toCanvasCoords, setPan, setZoom, zoom,
    clearSelection, magicWand, toolOptions, foreground, bucketFill,
    addText, clearStrokeCanvas, drawStrokeSegment, previewStroke,
    setSelection, createLassoMask, setForeground, getActiveLayer,
  ]);

  const onPointerMove = useCallback((e: React.PointerEvent) => {
    const pt = toCanvasCoords(e.clientX, e.clientY);
    setCursorPos(pt);

    if (panStartRef.current) {
      handlePan(e.clientX, e.clientY);
      return;
    }

    if (!drawingRef.current) return;

    if (activeTool === 'move') {
      // Could implement layer move; for now just track
      return;
    }

    // Marquee preview
    if (activeTool === 'marquee-rect' || activeTool === 'marquee-ellipse') {
      const start = startPointRef.current!;
      const { mask, bounds } = createRectMask(
        Math.min(start.x, pt.x),
        Math.min(start.y, pt.y),
        Math.abs(pt.x - start.x),
        Math.abs(pt.y - start.y),
        activeTool === 'marquee-ellipse',
      );
      setSelection(mask, bounds);
      return;
    }

    if (activeTool === 'crop') {
      // Show crop overlay
      const start = startPointRef.current!;
      // Reuse selection display for crop preview
      const mask = createBlankCanvas(docWidth, docHeight);
      const ctx = mask.getContext('2d')!;
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(Math.min(start.x, pt.x), Math.min(start.y, pt.y), Math.abs(pt.x - start.x), Math.abs(pt.y - start.y));
      setSelection(mask, { x: Math.min(start.x, pt.x), y: Math.min(start.y, pt.y), w: Math.abs(pt.x - start.x), h: Math.abs(pt.y - start.y) });
      return;
    }

    if (activeTool === 'lasso' || activeTool === 'magnetic-lasso') {
      const last = lassoPointsRef.current[lassoPointsRef.current.length - 1];
      if (!last || Math.hypot(pt.x - last.x, pt.y - last.y) > 2) {
        lassoPointsRef.current.push(pt);
      }
      // Live preview as selection
      const result = createLassoMask(lassoPointsRef.current);
      if (result) setSelection(result.mask, result.bounds);
      return;
    }

    if (activeTool === 'gradient' || activeTool === 'shape-rect' || activeTool === 'shape-ellipse' || activeTool === 'shape-line') {
      // Live preview on overlay canvas
      const canvas = compositeCanvasRef.current;
      if (!canvas) return;
      composite();
      const ctx = canvas.getContext('2d')!;
      const start = startPointRef.current!;
      ctx.save();
      if (activeTool === 'gradient') {
        const fg = hexToRgb(foreground);
        const bg = hexToRgb(background);
        const grad = ctx.createLinearGradient(start.x, start.y, pt.x, pt.y);
        grad.addColorStop(0, `rgba(${fg.r}, ${fg.g}, ${fg.b}, 0.8)`);
        grad.addColorStop(1, `rgba(${bg.r}, ${bg.g}, ${bg.b}, 0.8)`);
        ctx.fillStyle = grad;
        ctx.fillRect(0, 0, docWidth, docHeight);
      } else {
        const rgb = hexToRgb(foreground);
        ctx.fillStyle = `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, 0.6)`;
        ctx.strokeStyle = `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, 0.9)`;
        ctx.lineWidth = toolOptions.shapeStrokeWidth;
        const x = Math.min(start.x, pt.x);
        const y = Math.min(start.y, pt.y);
        const w = Math.abs(pt.x - start.x);
        const h = Math.abs(pt.y - start.y);
        if (activeTool === 'shape-rect') {
          if (toolOptions.shapeFilled) ctx.fillRect(x, y, w, h);
          if (toolOptions.shapeStrokeWidth > 0) ctx.strokeRect(x, y, w, h);
        } else if (activeTool === 'shape-ellipse') {
          ctx.beginPath();
          ctx.ellipse(x + w / 2, y + h / 2, w / 2, h / 2, 0, 0, Math.PI * 2);
          if (toolOptions.shapeFilled) ctx.fill();
          if (toolOptions.shapeStrokeWidth > 0) ctx.stroke();
        } else if (activeTool === 'shape-line') {
          ctx.beginPath();
          ctx.moveTo(start.x, start.y);
          ctx.lineTo(pt.x, pt.y);
          ctx.lineWidth = Math.max(1, toolOptions.shapeStrokeWidth);
          ctx.stroke();
        }
      }
      ctx.restore();
      return;
    }

    if (activeTool === 'brush' || activeTool === 'pencil' || activeTool === 'eraser') {
      const last = lastPointRef.current ?? pt;
      const hardness = activeTool === 'pencil' ? 100 : toolOptions.brushHardness;
      drawStrokeSegment(last, pt, {
        color: foreground,
        size: toolOptions.brushSize,
        hardness,
        opacity: toolOptions.brushOpacity,
        erase: activeTool === 'eraser',
      });
      previewStroke();
      lastPointRef.current = pt;
      return;
    }
  }, [
    activeTool, toCanvasCoords, handlePan, createRectMask, setSelection,
    createLassoMask, docWidth, docHeight, composite, foreground, background,
    toolOptions, drawStrokeSegment, previewStroke,
  ]);

  const onPointerUp = useCallback((e: React.PointerEvent) => {
    if (panStartRef.current) {
      panStartRef.current = null;
      return;
    }

    if (!drawingRef.current) return;
    drawingRef.current = false;

    const pt = toCanvasCoords(e.clientX, e.clientY);
    const start = startPointRef.current;

    if (activeTool === 'marquee-rect' || activeTool === 'marquee-ellipse' || activeTool === 'lasso' || activeTool === 'magnetic-lasso') {
      // Selection already set during move. For lasso, finalize.
      if (activeTool === 'lasso' || activeTool === 'magnetic-lasso') {
        const result = createLassoMask(lassoPointsRef.current);
        if (result) setSelection(result.mask, result.bounds);
        lassoPointsRef.current = [];
      }
      return;
    }

    if (activeTool === 'crop') {
      // Apply crop: resize document to selection bounds
      if (selectionBounds && selectionBounds.w > 5 && selectionBounds.h > 5) {
        // Crop all layers
        const { x, y, w, h } = selectionBounds;
        const newLayers = useEditorStore.getState().layers.map((l) => {
          const newCanvas = createBlankCanvas(Math.round(w), Math.round(h));
          const ctx = newCanvas.getContext('2d')!;
          ctx.drawImage(l.canvas, -x, -y);
          return { ...l, canvas: newCanvas, thumbnail: generateThumbnail(newCanvas) };
        });
        useEditorStore.setState({
          layers: newLayers,
          docWidth: Math.round(w),
          docHeight: Math.round(h),
          selectionMask: null,
          selectionBounds: null,
        });
        pushHistory('Crop');
        toast.success(`Cropped to ${Math.round(w)} × ${Math.round(h)}`);
      } else {
        clearSelection();
      }
      return;
    }

    if (activeTool === 'gradient' && start) {
      gradientFill(start, pt);
      return;
    }

    if (activeTool === 'shape-rect' && start) {
      drawShape(start, pt, 'rect');
      return;
    }
    if (activeTool === 'shape-ellipse' && start) {
      drawShape(start, pt, 'ellipse');
      return;
    }
    if (activeTool === 'shape-line' && start) {
      drawShape(start, pt, 'line');
      return;
    }

    if (activeTool === 'brush' || activeTool === 'pencil' || activeTool === 'eraser') {
      commitStrokeToLayer();
      clearStrokeCanvas();
      pushHistory(activeTool === 'eraser' ? 'Erase' : activeTool === 'pencil' ? 'Pencil' : 'Brush Stroke');
      lastPointRef.current = null;
      composite();
      return;
    }
  }, [
    activeTool, toCanvasCoords, panStartRef, selectionBounds, createLassoMask,
    setSelection, pushHistory, clearSelection, gradientFill, drawShape,
    commitStrokeToLayer, clearStrokeCanvas, composite,
  ]);

  // Wheel for zoom & pan
  const onWheel = useCallback((e: React.WheelEvent) => {
    if (e.ctrlKey || e.metaKey) {
      // Zoom
      const factor = e.deltaY < 0 ? 1.1 : 1 / 1.1;
      setZoom(zoom * factor);
    } else {
      setPan(panX - e.deltaX, panY - e.deltaY);
    }
  }, [zoom, setZoom, panX, panY, setPan]);

  // Cursor style based on tool
  const cursorStyle = useCallback((): string => {
    switch (activeTool) {
      case 'hand': return 'grab';
      case 'brush': case 'pencil': case 'eraser': return 'crosshair';
      case 'eyedropper': return 'crosshair';
      case 'bucket': return 'crosshair';
      case 'marquee-rect': case 'marquee-ellipse': case 'lasso': case 'polygonal-lasso': case 'magnetic-lasso': case 'magic-wand': return 'crosshair';
      case 'text': return 'text';
      case 'move': return 'move';
      case 'zoom': return 'zoom-in';
      case 'crop': return 'crosshair';
      case 'shape-rect': case 'shape-ellipse': case 'shape-line': return 'crosshair';
      case 'gradient': return 'crosshair';
      default: return 'default';
    }
  }, [activeTool]);

  // Initialize a default document on mount if no layers
  useEffect(() => {
    if (layers.length === 0) {
      useEditorStore.getState().newDocument(1280, 720, '#ffffff');
    }
  }, [layers.length]);

  // Keyboard shortcuts
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      // Don't intercept when typing in inputs
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA') return;
      if ((e.target as HTMLElement)?.isContentEditable) return;

      if (e.ctrlKey || e.metaKey) {
        if (e.key === 'z' && !e.shiftKey) { e.preventDefault(); useEditorStore.getState().undo(); }
        else if ((e.key === 'y') || (e.key === 'z' && e.shiftKey)) { e.preventDefault(); useEditorStore.getState().redo(); }
        else if (e.key === 'a') { e.preventDefault(); useEditorStore.getState().selectAll(); }
        else if (e.key === 'd') { e.preventDefault(); useEditorStore.getState().clearSelection(); }
        else if (e.key === 's') { e.preventDefault(); toast.info('Use File menu to export'); }
        else if (e.key === '+' || e.key === '=') { e.preventDefault(); setZoom(zoom * 1.25); }
        else if (e.key === '-') { e.preventDefault(); setZoom(zoom / 1.25); }
        else if (e.key === '0') { e.preventDefault(); setZoom(1); }
        return;
      }

      const map: Record<string, ToolType> = {
        v: 'move', m: 'marquee-rect', l: 'lasso', w: 'magic-wand', c: 'crop',
        i: 'eyedropper', b: 'brush', e: 'eraser', g: 'bucket', t: 'text',
        u: 'shape-rect', h: 'hand', z: 'zoom',
      };
      if (e.key === ' ' && !e.repeat) {
        spacePressed.current = true;
        return;
      }
      if (map[e.key.toLowerCase()]) {
        setTool(map[e.key.toLowerCase()]);
      } else if (e.key === 'x') {
        useEditorStore.getState().swapColors();
      } else if (e.key === 'd' && !e.ctrlKey && !e.metaKey) {
        useEditorStore.getState().resetColors();
      } else if (e.key === '[') {
        setToolOptions({ brushSize: Math.max(1, toolOptions.brushSize - 5) });
      } else if (e.key === ']') {
        setToolOptions({ brushSize: Math.min(500, toolOptions.brushSize + 5) });
      }
    };
    window.addEventListener('keydown', handler);
    const upHandler = (e: KeyboardEvent) => {
      if (e.key === ' ') spacePressed.current = false;
    };
    window.addEventListener('keyup', upHandler);
    return () => {
      window.removeEventListener('keydown', handler);
      window.removeEventListener('keyup', upHandler);
    };
  }, [zoom, setZoom, setTool, setToolOptions, toolOptions.brushSize]);

  // Auto-fit zoom to container on mount (when container first measured)
  const hasAutoFitRef = useRef(false);
  useEffect(() => {
    if (hasAutoFitRef.current) return;
    if (containerSize.w < 50 || containerSize.h < 50 || docWidth === 0) return;
    const fitZoom = Math.min(
      (containerSize.w - 60) / docWidth,
      (containerSize.h - 60) / docHeight,
      1,
    );
    if (fitZoom > 0) {
      setZoom(fitZoom);
      hasAutoFitRef.current = true;
    }
  }, [containerSize.w, containerSize.h, docWidth, docHeight, setZoom]);

  const displayWidth = docWidth * zoom;
  const displayHeight = docHeight * zoom;
  // Center the canvas if panX/panY are 0
  const centerX = containerSize.w > 0 ? (containerSize.w - displayWidth) / 2 : 0;
  const centerY = containerSize.h > 0 ? (containerSize.h - displayHeight) / 2 : 0;
  const offsetX = panX || centerX;
  const offsetY = panY || centerY;

  // Track container size for centering
  useEffect(() => {
    if (!containerRef.current) return;
    const el = containerRef.current;
    const update = () => {
      const r = el.getBoundingClientRect();
      setContainerSize({ w: r.width, h: r.height });
    };
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  return (
    <div
      ref={containerRef}
      className="relative flex-1 overflow-hidden bg-zinc-800"
      onWheel={onWheel}
      style={{ cursor: cursorStyle() }}
    >
      {/* Canvas wrapper - positioned absolutely */}
      <div
        className="absolute shadow-2xl"
        style={{
          left: offsetX,
          top: offsetY,
          width: displayWidth,
          height: displayHeight,
        }}
      >
        {/* Checkerboard background to show transparency */}
        <div
          className="absolute inset-0"
          style={{
            backgroundImage: 'linear-gradient(45deg, #6b7280 25%, transparent 25%), linear-gradient(-45deg, #6b7280 25%, transparent 25%), linear-gradient(45deg, transparent 75%, #6b7280 75%), linear-gradient(-45deg, transparent 75%, #6b7280 75%)',
            backgroundSize: '20px 20px',
            backgroundPosition: '0 0, 0 10px, 10px -10px, -10px 0px',
            backgroundColor: '#9ca3af',
          }}
        />
        <canvas
          ref={compositeCanvasRef}
          className="absolute inset-0"
          style={{ width: '100%', height: '100%' }}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerLeave={onPointerUp}
        />
        <canvas
          ref={overlayCanvasRef}
          className="absolute inset-0 pointer-events-none"
          style={{ width: '100%', height: '100%' }}
        />
      </div>

      {/* Status overlays */}
      <div className="absolute bottom-2 left-2 bg-zinc-900/80 backdrop-blur px-2 py-1 rounded text-[10px] text-zinc-300 font-mono pointer-events-none">
        {docWidth} × {docHeight}px · {Math.round(zoom * 100)}%
        {cursorPos && ` · ${Math.round(cursorPos.x)}, ${Math.round(cursorPos.y)}`}
      </div>
    </div>
  );
}
