'use client';

import { useEditorStore } from '@/lib/editor-store';
import { ToolType, BlendMode } from '@/lib/editor-types';
import { useEffect, useRef, useState, useCallback } from 'react';
import {
  createBlankCanvas,
  hexToRgb,
  sampleColor,
  generateThumbnail,
  healSpot,
  liquify,
} from '@/lib/image-processing';
import {
  drawStar,
  drawPolygon,
  drawArrow,
  drawHeart,
  drawSpeechBubble,
  drawSpiral,
  drawCalligraphyStroke,
  drawScatterStroke,
  smoothPath,
  computeStarInnerR,
  makeShapeStyle,
} from '@/lib/vector-shapes';
import { rafThrottle, perf, detectPerfTier, getPerfSettings, type PerfSettings } from '@/lib/perf';
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
  const showGrid = useEditorStore((s) => s.showGrid);
  const guides = useEditorStore((s) => s.guides);
  const snapToGuides = useEditorStore((s) => s.snapToGuides);
  const addGuide = useEditorStore((s) => s.addGuide);
  const settingSource = useEditorStore((s) => s.settingSource);
  const setSettingSource = useEditorStore((s) => s.setSettingSource);

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
  // Clone stamp source position
  const cloneSourceRef = useRef<Point | null>(null);
  // Clone stamp last paint position (for tracking delta)
  const cloneLastRef = useRef<Point | null>(null);
  // Snapshot of all layers (composite) for clone sampling
  const cloneSampleCanvasRef = useRef<HTMLCanvasElement | null>(null);
  // Healing brush source (same Alt+Click workflow as clone stamp)
  const healSourceRef = useRef<Point | null>(null);
  const healSampleCanvasRef = useRef<HTMLCanvasElement | null>(null);
  // Pen tool: list of anchor points with optional control handles
  const penPointsRef = useRef<{ x: number; y: number; h1?: Point; h2?: Point }[]>([]);
  // Liquify last position
  const liquifyLastRef = useRef<Point | null>(null);
  // Brush stabilizer: smoothed position
  const stabilizerPosRef = useRef<Point | null>(null);
  // Collected points for blob/calligraphy/scatter brushes
  const strokePointsRef = useRef<Point[]>([]);

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

  // Composite all visible layers onto the visible canvas - optimized to avoid resetting dimensions
  const composite = useCallback(() => {
    const canvas = compositeCanvasRef.current;
    if (!canvas) return;
    // Only set dimensions if they changed (avoids clearing + reallocating)
    if (canvas.width !== docWidth) canvas.width = docWidth;
    if (canvas.height !== docHeight) canvas.height = docHeight;
    const ctx = canvas.getContext('2d')!;
    ctx.clearRect(0, 0, docWidth, docHeight);

    for (const layer of layers) {
      if (!layer.visible) continue;
      ctx.save();
      ctx.globalAlpha = layer.opacity;
      ctx.globalCompositeOperation = layer.blendMode as GlobalCompositeOperation;
      // If layer has a mask enabled, apply it via destination-in
      if (layer.maskCanvas && layer.maskEnabled) {
        // Draw the layer content to a temp canvas, then mask it, then composite
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
  }, [layers, docWidth, docHeight]);

  // Draw overlay (selection, lasso preview, etc.)
  const drawOverlay = useCallback(() => {
    const canvas = overlayCanvasRef.current;
    if (!canvas) return;
    canvas.width = docWidth;
    canvas.height = docHeight;
    const ctx = canvas.getContext('2d')!;
    ctx.clearRect(0, 0, docWidth, docHeight);

    // Grid
    if (showGrid) {
      ctx.save();
      ctx.strokeStyle = 'rgba(100, 150, 255, 0.25)';
      ctx.lineWidth = 1;
      const gridSize = 50;
      for (let x = 0; x <= docWidth; x += gridSize) {
        ctx.beginPath();
        ctx.moveTo(x + 0.5, 0);
        ctx.lineTo(x + 0.5, docHeight);
        ctx.stroke();
      }
      for (let y = 0; y <= docHeight; y += gridSize) {
        ctx.beginPath();
        ctx.moveTo(0, y + 0.5);
        ctx.lineTo(docWidth, y + 0.5);
        ctx.stroke();
      }
      ctx.restore();
    }

    // Guides
    if (guides.x.length > 0 || guides.y.length > 0) {
      ctx.save();
      ctx.strokeStyle = '#00ddff';
      ctx.lineWidth = 1;
      for (const gx of guides.x) {
        ctx.beginPath();
        ctx.moveTo(gx + 0.5, 0);
        ctx.lineTo(gx + 0.5, docHeight);
        ctx.stroke();
      }
      for (const gy of guides.y) {
        ctx.beginPath();
        ctx.moveTo(0, gy + 0.5);
        ctx.lineTo(docWidth, gy + 0.5);
        ctx.stroke();
      }
      ctx.restore();
    }

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
  }, [selectionMask, selectionBounds, activeTool, cursorPos, docWidth, docHeight, showGrid, guides]);

  // Animation loop for marching ants - throttled to 15fps to save CPU
  useEffect(() => {
    if (!selectionMask) return;
    let raf: number;
    let lastDraw = 0;
    const tick = (now: number) => {
      // Throttle to ~15fps for marching ants (still looks animated)
      if (now - lastDraw >= 66) {
        drawOverlay();
        lastDraw = now;
      }
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

  // Apply symmetry: mirror a point based on symmetry mode (defined early so other callbacks can use it)
  const applySymmetry = useCallback((p: Point): Point[] => {
    const mode = toolOptions.symmetryMode;
    if (mode === 'none') return [p];
    const cx = docWidth / 2;
    const cy = docHeight / 2;
    const points: Point[] = [p];
    if (mode === 'horizontal' || mode === 'quad') {
      points.push({ x: 2 * cx - p.x, y: p.y });
    }
    if (mode === 'vertical' || mode === 'quad') {
      points.push({ x: p.x, y: 2 * cy - p.y });
    }
    if (mode === 'quad') {
      points.push({ x: 2 * cx - p.x, y: 2 * cy - p.y });
    }
    if (mode === 'mandala') {
      const segments = Math.max(2, toolOptions.symmetrySegments);
      const dx = p.x - cx;
      const dy = p.y - cy;
      for (let i = 1; i < segments; i++) {
        const angle = (2 * Math.PI * i) / segments;
        const cos = Math.cos(angle);
        const sin = Math.sin(angle);
        points.push({
          x: cx + dx * cos - dy * sin,
          y: cy + dx * sin + dy * cos,
        });
      }
    }
    return points;
  }, [toolOptions.symmetryMode, toolOptions.symmetrySegments, docWidth, docHeight]);

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

    // If hardness is 100, just draw a solid line - fastest path
    if (hardness >= 99 || erase) {
      ctx.beginPath();
      ctx.moveTo(from.x, from.y);
      ctx.lineTo(to.x, to.y);
      ctx.stroke();
    } else {
      // Soft brush: use shadow blur trick for single-pass soft edge (much faster than 8 passes)
      // Set shadow with the brush color and offset 0 to create a soft glow around the line
      ctx.shadowColor = color;
      ctx.shadowBlur = radius * (1 - hardness / 100) * 2;
      ctx.beginPath();
      ctx.moveTo(from.x, from.y);
      ctx.lineTo(to.x, to.y);
      ctx.stroke();
    }
    ctx.restore();
  }, [ensureStrokeCanvas]);

  // Commit the stroke canvas onto the active layer (respecting selection)
  const commitStrokeToLayer = useCallback(() => {
    const layer = getActiveLayer();
    if (!layer || !strokeCanvasRef.current) return;
    const ctx = layer.canvas.getContext('2d')!;
    // Get symmetric offsets for the stroke
    const strokeCanvas = strokeCanvasRef.current;
    const symmetryPoints = applySymmetry({ x: 0, y: 0 });
    for (const offset of symmetryPoints) {
      // For non-zero offsets, mirror the stroke canvas
      ctx.save();
      // If there's a selection, clip to it
      if (selectionMask) {
        const clipCanvas = createBlankCanvas(docWidth, docHeight);
        const clipCtx = clipCanvas.getContext('2d')!;
        clipCtx.drawImage(selectionMask, 0, 0);
        const tmp = createBlankCanvas(docWidth, docHeight);
        const tmpCtx = tmp.getContext('2d')!;
        // Mirror if needed
        if (offset.x !== 0 || offset.y !== 0) {
          tmpCtx.save();
          tmpCtx.translate(offset.x === 0 ? 0 : docWidth, offset.y === 0 ? 0 : docHeight);
          tmpCtx.scale(offset.x === 0 ? 1 : -1, offset.y === 0 ? 1 : -1);
          tmpCtx.drawImage(strokeCanvas, 0, 0);
          tmpCtx.restore();
        } else {
          tmpCtx.drawImage(strokeCanvas, 0, 0);
        }
        tmpCtx.globalCompositeOperation = 'destination-in';
        tmpCtx.drawImage(clipCanvas, 0, 0);
        ctx.drawImage(tmp, 0, 0);
      } else {
        if (offset.x !== 0 || offset.y !== 0) {
          ctx.save();
          ctx.translate(offset.x === 0 ? 0 : docWidth, offset.y === 0 ? 0 : docHeight);
          ctx.scale(offset.x === 0 ? 1 : -1, offset.y === 0 ? 1 : -1);
          ctx.drawImage(strokeCanvas, 0, 0);
          ctx.restore();
        } else {
          ctx.drawImage(strokeCanvas, 0, 0);
        }
      }
      ctx.restore();
    }
    refreshThumbnail(layer.id);
  }, [getActiveLayer, selectionMask, docWidth, docHeight, refreshThumbnail, applySymmetry]);

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

  // Clone stamp: copies pixels from clone source (offset by delta from current pos) onto the active layer
  const drawCloneStamp = useCallback((from: Point, to: Point) => {
    const layer = getActiveLayer();
    if (!layer || !cloneSourceRef.current || !cloneSampleCanvasRef.current) return;
    const source = cloneSourceRef.current;
    const sample = cloneSampleCanvasRef.current;
    // Compute delta: when we move from `from` to `to`, we sample from source + (to - from)
    const dx = to.x - from.x;
    const dy = to.y - from.y;
    const srcX = source.x + dx;
    const srcY = source.y + dy;
    const radius = Math.max(0.5, toolOptions.brushSize / 2);
    const opacity = toolOptions.brushOpacity / 100;

    // Draw a soft circular stamp from sample onto layer
    const ctx = layer.canvas.getContext('2d')!;
    ctx.save();
    // Create a soft circular mask
    const stampCanvas = createBlankCanvas(toolOptions.brushSize, toolOptions.brushSize);
    const stampCtx = stampCanvas.getContext('2d')!;
    // Draw a soft circle gradient as the brush alpha mask
    const grad = stampCtx.createRadialGradient(
      radius, radius, 0,
      radius, radius, radius,
    );
    const hardness = toolOptions.brushHardness / 100;
    grad.addColorStop(0, 'rgba(255,255,255,1)');
    grad.addColorStop(Math.max(0, Math.min(1, hardness)), 'rgba(255,255,255,1)');
    grad.addColorStop(1, 'rgba(255,255,255,0)');
    stampCtx.fillStyle = grad;
    stampCtx.fillRect(0, 0, toolOptions.brushSize, toolOptions.brushSize);
    // Use the stamp as a clipping mask
    stampCtx.globalCompositeOperation = 'source-in';
    // Draw the sampled region onto the stamp canvas
    stampCtx.drawImage(
      sample,
      srcX - radius, srcY - radius, toolOptions.brushSize, toolOptions.brushSize,
      0, 0, toolOptions.brushSize, toolOptions.brushSize,
    );
    // Draw the stamp onto the layer with the brush opacity
    ctx.globalAlpha = opacity;
    // If there's a selection, clip to it
    if (selectionMask) {
      const tmp = createBlankCanvas(docWidth, docHeight);
      const tmpCtx = tmp.getContext('2d')!;
      tmpCtx.drawImage(stampCanvas, to.x - radius, to.y - radius);
      tmpCtx.globalCompositeOperation = 'destination-in';
      tmpCtx.drawImage(selectionMask, 0, 0);
      ctx.drawImage(tmp, to.x - radius, to.y - radius);
    } else {
      ctx.drawImage(stampCanvas, to.x - radius, to.y - radius);
    }
    ctx.restore();
    // Update the composite preview
    composite();
  }, [getActiveLayer, toolOptions.brushSize, toolOptions.brushHardness, toolOptions.brushOpacity, selectionMask, docWidth, docHeight, composite]);

  // Healing brush: similar to clone stamp but uses healSpot for content-aware blending
  const drawHealStroke = useCallback((from: Point, to: Point) => {
    const layer = getActiveLayer();
    if (!layer || !healSourceRef.current || !healSampleCanvasRef.current) return;
    const source = healSourceRef.current;
    const sample = healSampleCanvasRef.current;
    const dx = to.x - from.x;
    const dy = to.y - from.y;
    const srcX = source.x + dx;
    const srcY = source.y + dy;
    const radius = Math.max(2, toolOptions.brushSize / 2);
    const ctx = layer.canvas.getContext('2d', { willReadFrequently: true })!;
    // Use the healSpot function but with a temp approach: blend sample region into layer
    healSpot(ctx, layer.canvas.width, layer.canvas.height, to.x, to.y, radius, srcX, srcY);
    void sample;
    composite();
  }, [getActiveLayer, toolOptions.brushSize, composite]);

  // Liquify operation
  const applyLiquify = useCallback((center: Point, from: Point, to: Point) => {
    const layer = getActiveLayer();
    if (!layer || layer.locked) return;
    const ctx = layer.canvas.getContext('2d', { willReadFrequently: true })!;
    const direction = { x: to.x - from.x, y: to.y - from.y };
    const opMap = {
      'liquify-push': 'push' as const,
      'liquify-pucker': 'pucker' as const,
      'liquify-bloat': 'bloat' as const,
      'liquify-twirl': 'twirl' as const,
    };
    const op = opMap[activeTool as keyof typeof opMap];
    if (!op) return;
    liquify(ctx, layer.canvas.width, layer.canvas.height, center.x, center.y, toolOptions.brushSize / 2, toolOptions.liquifyStrength, op, direction);
    composite();
  }, [getActiveLayer, activeTool, toolOptions.brushSize, toolOptions.liquifyStrength, composite]);

  // Pen tool: render the current path being drawn
  const drawPenPath = useCallback(() => {
    const canvas = compositeCanvasRef.current;
    if (!canvas) return;
    composite();
    const ctx = canvas.getContext('2d')!;
    const pts = penPointsRef.current;
    if (pts.length === 0) return;
    ctx.save();
    ctx.strokeStyle = '#00aaff';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(pts[0].x, pts[0].y);
    for (let i = 1; i < pts.length; i++) {
      if (pts[i - 1].h2 && pts[i].h1) {
        ctx.bezierCurveTo(pts[i - 1].h2!.x, pts[i - 1].h2!.y, pts[i].h1!.x, pts[i].h1!.y, pts[i].x, pts[i].y);
      } else {
        ctx.lineTo(pts[i].x, pts[i].y);
      }
    }
    ctx.stroke();
    // Draw anchor points
    for (const p of pts) {
      ctx.fillStyle = '#ffffff';
      ctx.strokeStyle = '#00aaff';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.rect(p.x - 3, p.y - 3, 6, 6);
      ctx.fill();
      ctx.stroke();
    }
    ctx.restore();
  }, [composite]);

  // Commit pen path to layer as a stroke (or fill if closed)
  const commitPenPath = useCallback(() => {
    const layer = getActiveLayer();
    if (!layer || layer.locked) return;
    const pts = penPointsRef.current;
    if (pts.length < 2) {
      penPointsRef.current = [];
      return;
    }
    const ctx = layer.canvas.getContext('2d')!;
    ctx.save();
    ctx.strokeStyle = foreground;
    ctx.lineWidth = Math.max(1, toolOptions.shapeStrokeWidth);
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.beginPath();
    ctx.moveTo(pts[0].x, pts[0].y);
    for (let i = 1; i < pts.length; i++) {
      if (pts[i - 1].h2 && pts[i].h1) {
        ctx.bezierCurveTo(pts[i - 1].h2!.x, pts[i - 1].h2!.y, pts[i].h1!.x, pts[i].h1!.y, pts[i].x, pts[i].y);
      } else {
        ctx.lineTo(pts[i].x, pts[i].y);
      }
    }
    // Close path
    if (pts[0].h2 && pts[pts.length - 1].h1) {
      ctx.bezierCurveTo(pts[pts.length - 1].h2?.x || pts[pts.length - 1].x, pts[pts.length - 1].h2?.y || pts[pts.length - 1].y, pts[0].h1?.x || pts[0].x, pts[0].h1?.y || pts[0].y, pts[0].x, pts[0].y);
    } else {
      ctx.lineTo(pts[0].x, pts[0].y);
    }
    ctx.closePath();
    if (toolOptions.shapeFilled) {
      ctx.fillStyle = foreground;
      ctx.fill();
    }
    ctx.stroke();
    ctx.restore();
    refreshThumbnail(layer.id);
    pushHistory('Pen Path');
    penPointsRef.current = [];
    composite();
  }, [getActiveLayer, foreground, toolOptions.shapeStrokeWidth, toolOptions.shapeFilled, refreshThumbnail, pushHistory, composite])

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
    const W = docWidth, H = docHeight;
    const selected = new Uint8Array(W * H);
    // Scanline flood fill - much faster than BFS with shift()
    const matches = (idx: number) => {
      const i = idx * 4;
      const dr = data[i] - targetR;
      const dg = data[i + 1] - targetG;
      const db = data[i + 2] - targetB;
      return (dr * dr + dg * dg + db * db) <= threshold;
    };
    const stack: number[] = [startY * W + startX];
    let minX = W, minY = H, maxX = 0, maxY = 0;
    while (stack.length > 0) {
      const idx = stack.pop()!;
      if (selected[idx]) continue;
      if (!matches(idx)) continue;
      const x = idx % W;
      const y = (idx - x) / W;
      // Find left boundary
      let lx = x;
      while (lx > 0 && !selected[y * W + lx - 1] && matches(y * W + lx - 1)) lx--;
      // Find right boundary
      let rx = x;
      while (rx < W - 1 && !selected[y * W + rx + 1] && matches(y * W + rx + 1)) rx++;
      // Fill the span
      for (let fx = lx; fx <= rx; fx++) {
        const fidx = y * W + fx;
        selected[fidx] = 1;
        if (fx < minX) minX = fx;
        if (fx > maxX) maxX = fx;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
        // Check row above
        if (y > 0) {
          const aIdx = fidx - W;
          if (!selected[aIdx] && matches(aIdx)) stack.push(aIdx);
        }
        // Check row below
        if (y < H - 1) {
          const bIdx = fidx + W;
          if (!selected[bIdx] && matches(bIdx)) stack.push(bIdx);
        }
      }
    }
    // Build mask
    const mask = createBlankCanvas(docWidth, docHeight);
    const mctx = mask.getContext('2d')!;
    const maskData = mctx.createImageData(docWidth, docHeight);
    const md = maskData.data;
    for (let idx = 0; idx < selected.length; idx++) {
      if (selected[idx]) {
        const i = idx * 4;
        md[i] = 255; md[i + 1] = 255; md[i + 2] = 255; md[i + 3] = 255;
      }
    }
    mctx.putImageData(maskData, 0, 0);
    setSelection(mask, { x: minX, y: minY, w: maxX - minX + 1, h: maxY - minY + 1 });
  }, [getActiveLayer, docWidth, docHeight, setSelection]);

  // Paint bucket fill - optimized with scanline flood fill
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
    const fillR = rgb.r, fillG = rgb.g, fillB = rgb.b;
    const threshold = (tolerance / 100) * (150 * 150 * 3);
    const W = docWidth, H = docHeight;
    const filled = new Uint8Array(W * H);
    const matches = (idx: number) => {
      const i = idx * 4;
      const dr = data[i] - targetR;
      const dg = data[i + 1] - targetG;
      const db = data[i + 2] - targetB;
      const da = data[i + 3] - targetA;
      return (dr * dr + dg * dg + db * db + da * da) <= threshold;
    };
    const stack: number[] = [startY * W + startX];
    let count = 0;
    while (stack.length > 0) {
      const idx = stack.pop()!;
      if (filled[idx]) continue;
      if (!matches(idx)) continue;
      const x = idx % W;
      const y = (idx - x) / W;
      // Find left boundary
      let lx = x;
      while (lx > 0 && !filled[y * W + lx - 1] && matches(y * W + lx - 1)) lx--;
      // Find right boundary
      let rx = x;
      while (rx < W - 1 && !filled[y * W + rx + 1] && matches(y * W + rx + 1)) rx++;
      // Fill the span
      for (let fx = lx; fx <= rx; fx++) {
        const fidx = y * W + fx;
        filled[fidx] = 1;
        const i = fidx * 4;
        data[i] = fillR; data[i + 1] = fillG; data[i + 2] = fillB; data[i + 3] = 255;
        count++;
        // Check row above
        if (y > 0) {
          const aIdx = fidx - W;
          if (!filled[aIdx] && matches(aIdx)) stack.push(aIdx);
        }
        // Check row below
        if (y < H - 1) {
          const bIdx = fidx + W;
          if (!filled[bIdx] && matches(bIdx)) stack.push(bIdx);
        }
      }
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
  const drawShapeOnCtx = useCallback((ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, shape: string, from: Point, to: Point) => {
    const style = makeShapeStyle(foreground, toolOptions.shapeStrokeWidth);
    const cx = x + w / 2;
    const cy = y + h / 2;
    const radius = Math.min(w, h) / 2;
    if (shape === 'rect') {
      if (toolOptions.shapeFilled) ctx.fillRect(x, y, w, h);
      if (toolOptions.shapeStrokeWidth > 0) ctx.strokeRect(x, y, w, h);
    } else if (shape === 'ellipse') {
      ctx.beginPath();
      ctx.ellipse(cx, cy, w / 2, h / 2, 0, 0, Math.PI * 2);
      if (toolOptions.shapeFilled) ctx.fill();
      if (toolOptions.shapeStrokeWidth > 0) ctx.stroke();
    } else if (shape === 'line') {
      ctx.beginPath();
      ctx.moveTo(from.x, from.y);
      ctx.lineTo(to.x, to.y);
      ctx.lineWidth = Math.max(1, toolOptions.shapeStrokeWidth);
      ctx.stroke();
    } else if (shape === 'star') {
      const points = Math.max(3, toolOptions.shapeStarPoints);
      const outerR = Math.max(w, h) / 2;
      const innerR = computeStarInnerR(outerR, toolOptions.shapeStarInnerRatio);
      drawStar(ctx, cx, cy, outerR, innerR, points, style);
    } else if (shape === 'polygon') {
      const sides = Math.max(3, Math.min(12, toolOptions.shapeSides));
      drawPolygon(ctx, cx, cy, radius, sides, style);
    } else if (shape === 'arrow') {
      drawArrow(ctx, from.x, from.y, to.x, to.y, toolOptions.shapeArrowHeadSize, style);
    } else if (shape === 'heart') {
      drawHeart(ctx, cx, cy, Math.max(w, h), style);
    } else if (shape === 'speech-bubble') {
      drawSpeechBubble(ctx, x, y, w, h, style);
    } else if (shape === 'spiral') {
      drawSpiral(ctx, cx, cy, radius, toolOptions.shapeSpiralTurns, style);
    }
  }, [foreground, toolOptions]);

  const drawShape = useCallback((from: Point, to: Point, shape: string) => {
    const layer = getActiveLayer();
    if (!layer || layer.locked) return;
    const ctx = layer.canvas.getContext('2d')!;
    const x = Math.min(from.x, to.x);
    const y = Math.min(from.y, to.y);
    const w = Math.abs(to.x - from.x);
    const h = Math.abs(to.y - from.y);
    ctx.save();
    if (selectionMask) {
      const clipCanvas = createBlankCanvas(docWidth, docHeight);
      const clipCtx = clipCanvas.getContext('2d')!;
      clipCtx.drawImage(selectionMask, 0, 0);
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
    // Always capture pointer so we keep getting move/up events even outside canvas
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);

    if (e.button === 1 || (e.button === 0 && (activeTool === 'hand' || spacePressed.current || (e.altKey && activeTool !== 'eyedropper' && activeTool !== 'zoom')))) {
      // Pan with middle mouse or hand tool
      panStartRef.current = { x: e.clientX, y: e.clientY, panX, panY };
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

    if (activeTool.startsWith('shape-')) {
      drawingRef.current = true;
      startPointRef.current = pt;
      return;
    }

    // Brush / pencil / eraser / blob-brush / calligraphy / scatter
    if (activeTool === 'brush' || activeTool === 'pencil' || activeTool === 'eraser' ||
        activeTool === 'blob-brush' || activeTool === 'calligraphy-brush' || activeTool === 'scatter-brush' ||
        activeTool === 'smooth-tool') {
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
      strokePointsRef.current = [pt];
      // For blob/calligraphy/scatter/smooth tools, we draw directly on the layer
      // For brush/pencil/eraser, we use the stroke canvas approach
      if (activeTool === 'brush' || activeTool === 'pencil' || activeTool === 'eraser') {
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
      }
      lastPointRef.current = pt;
      return;
    }

    // Clone stamp
    if (activeTool === 'clone-stamp') {
      const layer = getActiveLayer();
      if (!layer) {
        toast.error('No active layer');
        return;
      }
      if (layer.locked) {
        toast.error('Layer is locked');
        return;
      }
      // Alt+Click or "Set Source" mode sets source
      if (e.altKey || settingSource) {
        cloneSourceRef.current = pt;
        // Take a snapshot of the composite for sampling
        const composite = compositeCanvasRef.current;
        if (composite) {
          const snap = createBlankCanvas(docWidth, docHeight);
          const snapCtx = snap.getContext('2d')!;
          snapCtx.drawImage(composite, 0, 0);
          cloneSampleCanvasRef.current = snap;
        }
        toast.success(`Clone source set: ${Math.round(pt.x)}, ${Math.round(pt.y)}`);
        setSettingSource(false);
        return;
      }
      // Otherwise paint
      if (!cloneSourceRef.current || !cloneSampleCanvasRef.current) {
        toast.error('Alt+Click or tap "Set Source" to set clone source first');
        return;
      }
      drawingRef.current = true;
      cloneLastRef.current = pt;
      // Draw initial stamp
      drawCloneStamp(pt, pt);
      return;
    }

    // Healing brush (similar Alt+Click workflow)
    if (activeTool === 'heal-brush') {
      const layer = getActiveLayer();
      if (!layer) {
        toast.error('No active layer');
        return;
      }
      if (layer.locked) {
        toast.error('Layer is locked');
        return;
      }
      if (e.altKey || settingSource) {
        healSourceRef.current = pt;
        const composite = compositeCanvasRef.current;
        if (composite) {
          const snap = createBlankCanvas(docWidth, docHeight);
          snap.getContext('2d')!.drawImage(composite, 0, 0);
          healSampleCanvasRef.current = snap;
        }
        toast.success(`Heal source set: ${Math.round(pt.x)}, ${Math.round(pt.y)}`);
        setSettingSource(false);
        return;
      }
      if (!healSourceRef.current || !healSampleCanvasRef.current) {
        toast.error('Alt+Click or tap "Set Source" to set heal source first');
        return;
      }
      drawingRef.current = true;
      liquifyLastRef.current = pt; // reuse for tracking last pos
      drawHealStroke(pt, pt);
      return;
    }

    // Pen tool / Curvature pen: add anchor point
    if (activeTool === 'pen' || activeTool === 'curvature-pen') {
      penPointsRef.current.push({ x: pt.x, y: pt.y });
      // For curvature pen, auto-generate smooth handles between points
      if (activeTool === 'curvature-pen' && penPointsRef.current.length >= 2) {
        const pts = penPointsRef.current;
        for (let i = 0; i < pts.length; i++) {
          const prev = pts[i - 1];
          const next = pts[i + 1];
          if (prev && next) {
            // Auto-handle: point in the direction of the tangent
            const dx = (next.x - prev.x) * 0.3;
            const dy = (next.y - prev.y) * 0.3;
            pts[i].h1 = { x: pts[i].x - dx, y: pts[i].y - dy };
            pts[i].h2 = { x: pts[i].x + dx, y: pts[i].y + dy };
          } else if (prev && !next) {
            // End point
            const dx = (pts[i].x - prev.x) * 0.3;
            const dy = (pts[i].y - prev.y) * 0.3;
            pts[i].h1 = { x: pts[i].x - dx, y: pts[i].y - dy };
          } else if (!prev && next) {
            // Start point
            const dx = (next.x - pts[i].x) * 0.3;
            const dy = (next.y - pts[i].y) * 0.3;
            pts[i].h2 = { x: pts[i].x + dx, y: pts[i].y + dy };
          }
        }
      }
      drawPenPath();
      forceRender((v) => v + 1);
      return;
    }

    // Liquify tools
    if (activeTool === 'liquify-push' || activeTool === 'liquify-pucker' || activeTool === 'liquify-bloat' || activeTool === 'liquify-twirl') {
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
      liquifyLastRef.current = pt;
      // Apply once for click without drag
      applyLiquify(pt, pt, { x: pt.x + 0.1, y: pt.y });
      return;
    }
  }, [
    activeTool, panX, panY, toCanvasCoords, setPan, setZoom, zoom,
    clearSelection, magicWand, toolOptions, foreground, bucketFill,
    addText, clearStrokeCanvas, drawStrokeSegment, previewStroke,
    setSelection, createLassoMask, setForeground, getActiveLayer,
    docWidth, docHeight, drawCloneStamp, drawHealStroke, drawPenPath, applyLiquify,
    settingSource, setSettingSource,
  ]);

  const onPointerMove = useCallback((e: React.PointerEvent) => {
    const pt = toCanvasCoords(e.clientX, e.clientY);
    // Only update cursor position display when not actively drawing
    // (during drawing, the cursor display is not needed and causes re-renders)
    if (!drawingRef.current) {
      setCursorPos(pt);
    }

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

    if (activeTool === 'gradient' || activeTool.startsWith('shape-')) {
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
        // Use drawShapeOnCtx for preview with alpha
        ctx.globalAlpha = 0.6;
        const shapeName = activeTool.replace('shape-', '');
        drawShapeOnCtx(ctx, Math.min(start.x, pt.x), Math.min(start.y, pt.y),
          Math.abs(pt.x - start.x), Math.abs(pt.y - start.y), shapeName, start, pt);
      }
      ctx.restore();
      return;
    }

    if (activeTool === 'brush' || activeTool === 'pencil' || activeTool === 'eraser') {
      // Brush stabilizer: weighted moving average for smoother strokes
      let targetPt = pt;
      if (toolOptions.brushStabilizer > 0) {
        if (!stabilizerPosRef.current) {
          stabilizerPosRef.current = pt;
        } else {
          const factor = 1 - (toolOptions.brushStabilizer / 100) * 0.7;
          stabilizerPosRef.current = {
            x: stabilizerPosRef.current.x + (pt.x - stabilizerPosRef.current.x) * factor,
            y: stabilizerPosRef.current.y + (pt.y - stabilizerPosRef.current.y) * factor,
          };
          targetPt = stabilizerPosRef.current;
        }
      } else {
        stabilizerPosRef.current = pt;
      }
      const last = lastPointRef.current ?? targetPt;
      const hardness = activeTool === 'pencil' ? 100 : toolOptions.brushHardness;
      drawStrokeSegment(last, targetPt, {
        color: foreground,
        size: toolOptions.brushSize,
        hardness,
        opacity: toolOptions.brushOpacity,
        erase: activeTool === 'eraser',
      });
      previewStroke();
      lastPointRef.current = targetPt;
      return;
    }

    // Blob brush / Calligraphy / Scatter — collect points and draw live
    if (activeTool === 'blob-brush' || activeTool === 'calligraphy-brush' || activeTool === 'scatter-brush') {
      const last = lastPointRef.current ?? pt;
      strokePointsRef.current.push(pt);
      const layer = getActiveLayer();
      if (layer && !layer.locked) {
        const ctx = layer.canvas.getContext('2d')!;
        if (activeTool === 'blob-brush') {
          // Draw filled circles along the path (merges automatically with existing paint)
          ctx.save();
          ctx.globalAlpha = toolOptions.brushOpacity / 100;
          ctx.fillStyle = foreground;
          const dist = Math.hypot(pt.x - last.x, pt.y - last.y);
          const step = Math.max(1, toolOptions.brushSize / 6);
          const steps = Math.max(1, Math.ceil(dist / step));
          for (let i = 0; i <= steps; i++) {
            const t = i / steps;
            const px = last.x + (pt.x - last.x) * t;
            const py = last.y + (pt.y - last.y) * t;
            ctx.beginPath();
            ctx.arc(px, py, toolOptions.brushSize / 2, 0, Math.PI * 2);
            ctx.fill();
          }
          ctx.restore();
        } else if (activeTool === 'calligraphy-brush') {
          // Draw using the calligraphy stroke function with accumulated points
          const recentPoints = strokePointsRef.current.slice(-20);
          if (recentPoints.length >= 2) {
            drawCalligraphyStroke(ctx, recentPoints, toolOptions.brushSize, toolOptions.calligraphyAngle, foreground, toolOptions.brushOpacity);
          }
        } else if (activeTool === 'scatter-brush') {
          // Scatter small shapes at the current point
          drawScatterStroke(ctx, [last, pt], toolOptions.scatterCount, toolOptions.scatterSize, foreground, toolOptions.brushOpacity);
        }
        composite();
      }
      lastPointRef.current = pt;
      return;
    }

    // Smooth tool — applies smoothing to the area under the cursor
    if (activeTool === 'smooth-tool') {
      // Smooth tool works on existing pixels: blur the area under the brush
      const layer = getActiveLayer();
      if (!layer || layer.locked) return;
      const ctx = layer.canvas.getContext('2d')!;
      const r = Math.max(2, toolOptions.brushSize / 2);
      // Simple: apply a small box blur at the cursor position
      const x = Math.max(0, Math.floor(pt.x - r));
      const y = Math.max(0, Math.floor(pt.y - r));
      const w = Math.min(layer.canvas.width - x, Math.floor(r * 2));
      const h = Math.min(layer.canvas.height - y, Math.floor(r * 2));
      if (w > 0 && h > 0) {
        const imageData = ctx.getImageData(x, y, w, h);
        const data = imageData.data;
        const tmp = new Uint8ClampedArray(data);
        const strength = toolOptions.smoothStrength / 100;
        // Simple 3x3 blur with strength mix
        for (let py = 1; py < h - 1; py++) {
          for (let px = 1; px < w - 1; px++) {
            const i = (py * w + px) * 4;
            for (let c = 0; c < 3; c++) {
              const avg = (tmp[i - 4 + c] + tmp[i + 4 + c] + tmp[i - w * 4 + c] + tmp[i + w * 4 + c]) / 4;
              data[i + c] = tmp[i + c] * (1 - strength) + avg * strength;
            }
          }
        }
        ctx.putImageData(imageData, x, y);
        composite();
      }
      lastPointRef.current = pt;
      return;
    }

    // Clone stamp continuous painting
    if (activeTool === 'clone-stamp') {
      const last = cloneLastRef.current ?? pt;
      // Paint along the line from last to pt
      const dist = Math.hypot(pt.x - last.x, pt.y - last.y);
      const step = Math.max(1, toolOptions.brushSize / 4);
      const steps = Math.max(1, Math.ceil(dist / step));
      for (let i = 1; i <= steps; i++) {
        const t = i / steps;
        const p = { x: last.x + (pt.x - last.x) * t, y: last.y + (pt.y - last.y) * t };
        drawCloneStamp(last, p);
      }
      cloneLastRef.current = pt;
      return;
    }

    // Healing brush continuous painting
    if (activeTool === 'heal-brush') {
      const last = liquifyLastRef.current ?? pt;
      const dist = Math.hypot(pt.x - last.x, pt.y - last.y);
      const step = Math.max(1, toolOptions.brushSize / 4);
      const steps = Math.max(1, Math.ceil(dist / step));
      for (let i = 1; i <= steps; i++) {
        const t = i / steps;
        const p = { x: last.x + (pt.x - last.x) * t, y: last.y + (pt.y - last.y) * t };
        drawHealStroke(last, p);
      }
      liquifyLastRef.current = pt;
      return;
    }

    // Liquify continuous painting
    if (activeTool === 'liquify-push' || activeTool === 'liquify-pucker' || activeTool === 'liquify-bloat' || activeTool === 'liquify-twirl') {
      const last = liquifyLastRef.current ?? pt;
      const dist = Math.hypot(pt.x - last.x, pt.y - last.y);
      const step = Math.max(2, toolOptions.brushSize / 4);
      const steps = Math.max(1, Math.ceil(dist / step));
      for (let i = 1; i <= steps; i++) {
        const t = i / steps;
        const p = { x: last.x + (pt.x - last.x) * t, y: last.y + (pt.y - last.y) * t };
        applyLiquify(p, last, p);
      }
      liquifyLastRef.current = pt;
      return;
    }
  }, [
    activeTool, toCanvasCoords, handlePan, createRectMask, setSelection,
    createLassoMask, docWidth, docHeight, composite, foreground, background,
    toolOptions, drawStrokeSegment, previewStroke, drawCloneStamp, drawHealStroke, applyLiquify,
    drawShapeOnCtx, getActiveLayer, refreshThumbnail,
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

    // Handle all shape tools
    if (activeTool.startsWith('shape-') && start) {
      const shapeName = activeTool.replace('shape-', '');
      drawShape(start, pt, shapeName);
      return;
    }

    // Handle new brush tools (blob, calligraphy, scatter, smooth)
    if (activeTool === 'blob-brush' || activeTool === 'calligraphy-brush' || activeTool === 'scatter-brush' || activeTool === 'smooth-tool') {
      const layer = getActiveLayer();
      if (layer) {
        refreshThumbnail(layer.id);
        pushHistory(activeTool.replace('-', ' '));
      }
      strokePointsRef.current = [];
      lastPointRef.current = null;
      composite();
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

    if (activeTool === 'clone-stamp') {
      const layer = getActiveLayer();
      if (layer) {
        refreshThumbnail(layer.id);
        pushHistory('Clone Stamp');
      }
      cloneLastRef.current = null;
      composite();
      return;
    }

    if (activeTool === 'heal-brush') {
      const layer = getActiveLayer();
      if (layer) {
        refreshThumbnail(layer.id);
        pushHistory('Heal Brush');
      }
      liquifyLastRef.current = null;
      composite();
      return;
    }

    if (activeTool === 'liquify-push' || activeTool === 'liquify-pucker' || activeTool === 'liquify-bloat' || activeTool === 'liquify-twirl') {
      const layer = getActiveLayer();
      if (layer) {
        refreshThumbnail(layer.id);
        pushHistory(`Liquify ${activeTool.split('-')[1]}`);
      }
      liquifyLastRef.current = null;
      composite();
      return;
    }
  }, [
    activeTool, toCanvasCoords, panStartRef, selectionBounds, createLassoMask,
    setSelection, pushHistory, clearSelection, gradientFill, drawShape,
    commitStrokeToLayer, clearStrokeCanvas, composite, getActiveLayer, refreshThumbnail,
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
      case 'brush': case 'pencil': case 'eraser': case 'clone-stamp': case 'heal-brush':
      case 'blob-brush': case 'calligraphy-brush': case 'scatter-brush': case 'smooth-tool':
        return 'crosshair';
      case 'eyedropper': return 'crosshair';
      case 'bucket': return 'crosshair';
      case 'marquee-rect': case 'marquee-ellipse': case 'lasso': case 'polygonal-lasso': case 'magnetic-lasso': case 'magic-wand': return 'crosshair';
      case 'text': return 'text';
      case 'move': return 'move';
      case 'zoom': return 'zoom-in';
      case 'crop': return 'crosshair';
      case 'shape-rect': case 'shape-ellipse': case 'shape-line': case 'pen': case 'curvature-pen':
      case 'shape-star': case 'shape-polygon': case 'shape-arrow': case 'shape-heart':
      case 'shape-speech-bubble': case 'shape-spiral':
        return 'crosshair';
      case 'gradient': return 'crosshair';
      case 'liquify-push': case 'liquify-pucker': case 'liquify-bloat': case 'liquify-twirl': return 'crosshair';
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
        else if (e.key === 'v' && e.shiftKey) { e.preventDefault(); window.dispatchEvent(new CustomEvent('open-vectorize-dialog')); }
        return;
      }

      const map: Record<string, ToolType> = {
        v: 'move', m: 'marquee-rect', l: 'lasso', w: 'magic-wand', c: 'crop',
        i: 'eyedropper', b: 'brush', e: 'eraser', g: 'bucket', t: 'text',
        u: 'shape-rect', h: 'hand', z: 'zoom', s: 'clone-stamp',
        j: 'heal-brush', p: 'pen', r: 'liquify-push',
      };
      if (e.key === ' ' && !e.repeat) {
        spacePressed.current = true;
        return;
      }
      // Pen tool: Enter commits the path, Escape cancels
      if (useEditorStore.getState().activeTool === 'pen' || useEditorStore.getState().activeTool === 'curvature-pen') {
        if (e.key === 'Enter') {
          e.preventDefault();
          commitPenPath();
          return;
        }
        if (e.key === 'Escape') {
          penPointsRef.current = [];
          composite();
          return;
        }
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
  }, [zoom, setZoom, setTool, setToolOptions, toolOptions.brushSize, commitPenPath, composite]);

  // Auto-fit zoom to container on mount (when container first measured)
  const hasAutoFitRef = useRef(false);
  useEffect(() => {
    if (hasAutoFitRef.current) return;
    if (containerSize.w < 50 || containerSize.h < 50 || docWidth === 0) return;
    // Use smaller margin on mobile to maximize canvas area
    const margin = containerSize.w < 500 ? 20 : 60;
    const fitZoom = Math.min(
      (containerSize.w - margin) / docWidth,
      (containerSize.h - margin) / docHeight,
    );
    // On mobile, allow zooming in up to 2x to fill the screen
    const maxZoom = containerSize.w < 500 ? 2 : 1;
    const finalZoom = Math.max(0.05, Math.min(maxZoom, fitZoom));
    if (finalZoom > 0) {
      setZoom(finalZoom);
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
      className="relative flex-1 overflow-hidden editor-canvas-bg touch-none"
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
          className="absolute inset-0 touch-none"
          style={{ width: '100%', height: '100%' }}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
        />
        <canvas
          ref={overlayCanvasRef}
          className="absolute inset-0 pointer-events-none"
          style={{ width: '100%', height: '100%' }}
        />
      </div>

      {/* Status overlays */}
      <div className="absolute bottom-2 left-2 editor-surface/80 backdrop-blur px-2 py-1 rounded text-[10px] editor-text font-mono pointer-events-none">
        {docWidth} × {docHeight}px · {Math.round(zoom * 100)}%
        {cursorPos && ` · ${Math.round(cursorPos.x)}, ${Math.round(cursorPos.y)}`}
      </div>
    </div>
  );
}
