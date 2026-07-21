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
import { rafThrottle, detectPerfTier, getPerfSettings, type PerfSettings } from '@/lib/perf';
import { TOOL_SHORTCUTS } from '@/lib/shortcuts';
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
  const settingSource = useEditorStore((s) => s.settingSource);
  const setSettingSource = useEditorStore((s) => s.setSettingSource);

  const containerRef = useRef<HTMLDivElement>(null);
  const compositeCanvasRef = useRef<HTMLCanvasElement>(null);
  const overlayCanvasRef = useRef<HTMLCanvasElement>(null);

  // Cache for marching-ants contour segments — only recompute when mask
  // reference changes, not every animation frame.
  const contourSegmentsRef = useRef<number[][]>([]);
  const lastMaskRef = useRef<HTMLCanvasElement | null>(null);

  // Tool state
  const drawingRef = useRef(false);
  const lastPointRef = useRef<Point | null>(null);
  const startPointRef = useRef<Point | null>(null);
  const lassoPointsRef = useRef<Point[]>([]);
  const polygonPointsRef = useRef<Point[]>([]);
  const panStartRef = useRef<{ x: number; y: number; panX: number; panY: number } | null>(null);
  // Magnetic lasso: tracks whether the current gesture is a drag (vs. a click).
  // If the user just clicks without dragging, we add a manual anchor point at
  // the click position — this lets the user override the auto-snap when it
  // picks the wrong edge, exactly like Photoshop's magnetic lasso.
  const magneticDragStartedRef = useRef(false);
  // Magnetic lasso: snapshot of the composite canvas taken when the gesture
  // starts. We snapshot once so that the Sobel search doesn't see pixels from
  // the live preview line drawn on the overlay canvas (which would create
  // false edges along the lasso path itself).
  const magneticSampleRef = useRef<HTMLCanvasElement | null>(null);

  // For brush stroke compositing - we draw into a temp canvas, then composite to layer
  const strokeCanvasRef = useRef<HTMLCanvasElement | null>(null);
  // Spacebar state for pan mode
  const spacePressed = useRef(false);
  // Move tool: snapshot of the active layer when a move gesture starts
  const moveSourceRef = useRef<HTMLCanvasElement | null>(null);
  // Move tool: saved original selectionBounds so we can compute offset deltas
  const moveStartBoundsRef = useRef<typeof selectionBounds>(null);
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
        // Cache contour segments — only trace when mask reference changes.
        if (selectionMask !== lastMaskRef.current) {
          lastMaskRef.current = selectionMask;
          if (activeTool === 'marquee-rect' || activeTool === 'marquee-ellipse') {
            contourSegmentsRef.current = [];
          } else {
            contourSegmentsRef.current = marchSquaresContour(selectionMask, { x, y, w, h });
          }
        }
        const segs = contourSegmentsRef.current;
        const antOffset = -(Date.now() / 80) % 8;

        ctx.save();
        // Black dash pass
        ctx.strokeStyle = '#000000';
        ctx.lineWidth = 1;
        ctx.setLineDash([4, 4]);
        ctx.lineDashOffset = antOffset;
        if (activeTool === 'marquee-rect' || activeTool === 'marquee-ellipse') {
          ctx.strokeRect(x + 0.5, y + 0.5, w, h);
        } else {
          for (const seg of segs) {
            ctx.beginPath();
            ctx.moveTo(seg[0], seg[1]);
            ctx.lineTo(seg[2], seg[3]);
            ctx.stroke();
          }
        }
        // White dash pass (offset by 4px for the marching effect)
        ctx.strokeStyle = '#ffffff';
        ctx.lineDashOffset = antOffset + 4;
        if (activeTool === 'marquee-rect' || activeTool === 'marquee-ellipse') {
          ctx.strokeRect(x + 0.5, y + 0.5, w, h);
        } else {
          for (const seg of segs) {
            ctx.beginPath();
            ctx.moveTo(seg[0], seg[1]);
            ctx.lineTo(seg[2], seg[3]);
            ctx.stroke();
          }
        }
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

    // Regular lasso + magnetic lasso in-progress: show the actual path being
    // drawn (not just the selection bounding box). This gives the user visual
    // feedback of where the lasso is going, which is critical for the magnetic
    // lasso so they can see if it's snapping to edges correctly.
    if ((activeTool === 'lasso' || activeTool === 'magnetic-lasso') && lassoPointsRef.current.length > 1) {
      const pts = lassoPointsRef.current;
      ctx.save();
      ctx.strokeStyle = activeTool === 'magnetic-lasso' ? '#00ff88' : '#ffffff';
      ctx.lineWidth = 1.5;
      ctx.setLineDash([4, 4]);
      ctx.lineDashOffset = -(Date.now() / 80) % 8;
      ctx.beginPath();
      ctx.moveTo(pts[0].x, pts[0].y);
      for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
      // Don't close the path yet — the user is still drawing
      ctx.stroke();
      // Draw a line from the last point to the cursor to show where the next
      // segment will go
      if (cursorPos) {
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.4)';
        ctx.setLineDash([2, 4]);
        ctx.beginPath();
        ctx.moveTo(pts[pts.length - 1].x, pts[pts.length - 1].y);
        ctx.lineTo(cursorPos.x, cursorPos.y);
        ctx.stroke();
      }
      ctx.restore();

      // Magnetic lasso: draw the start anchor as a small green square so the
      // user knows where to click to close the path. Also draw small dots at
      // each snapped anchor so the user can see exactly where the lasso has
      // locked onto edges.
      if (activeTool === 'magnetic-lasso') {
        ctx.save();
        // Start anchor: pulsing green square with a larger hit-zone hint
        const first = pts[0];
        const pulse = (Math.sin(Date.now() / 250) + 1) / 2; // 0..1
        ctx.fillStyle = '#00ff88';
        ctx.strokeStyle = '#003322';
        ctx.lineWidth = 1;
        const sq = 6 + pulse * 2;
        ctx.fillRect(first.x - sq / 2, first.y - sq / 2, sq, sq);
        ctx.strokeRect(first.x - sq / 2, first.y - sq / 2, sq, sq);
        // Larger transparent halo around the start anchor to indicate the
        // close-zone (where clicking will close the path).
        ctx.fillStyle = 'rgba(0, 255, 136, 0.15)';
        ctx.beginPath();
        ctx.arc(first.x, first.y, 14, 0, Math.PI * 2);
        ctx.fill();
        // Snapped anchor points: small green dots so the user can see where
        // the lasso has snapped (vs. freehand points).
        ctx.fillStyle = '#00ff88';
        for (let i = 1; i < pts.length; i++) {
          ctx.beginPath();
          ctx.arc(pts[i].x, pts[i].y, 1.5, 0, Math.PI * 2);
          ctx.fill();
        }
        ctx.restore();
      }
    } else if (activeTool === 'magnetic-lasso' && lassoPointsRef.current.length === 1) {
      // Single starting point — draw the start anchor prominently so the user
      // sees where the path began.
      const first = lassoPointsRef.current[0];
      ctx.save();
      ctx.fillStyle = '#00ff88';
      ctx.strokeStyle = '#003322';
      ctx.lineWidth = 1;
      const sq = 7;
      ctx.fillRect(first.x - sq / 2, first.y - sq / 2, sq, sq);
      ctx.strokeRect(first.x - sq / 2, first.y - sq / 2, sq, sq);
      ctx.fillStyle = 'rgba(0, 255, 136, 0.15)';
      ctx.beginPath();
      ctx.arc(first.x, first.y, 14, 0, Math.PI * 2);
      ctx.fill();
      if (cursorPos) {
        ctx.strokeStyle = 'rgba(0, 255, 136, 0.6)';
        ctx.setLineDash([3, 3]);
        ctx.beginPath();
        ctx.moveTo(first.x, first.y);
        ctx.lineTo(cursorPos.x, cursorPos.y);
        ctx.stroke();
      }
      ctx.restore();
    }
  }, [selectionMask, selectionBounds, activeTool, cursorPos, docWidth, docHeight, showGrid, guides]);

  /**
   * Marching-squares contour trace of a selection mask alpha channel.
   * Returns an array of path segment pairs (x1,y1)-(x2,y2) in canvas coords.
   * Each segment is [x1, y1, x2, y2].
   */
  function marchSquaresContour(
    maskCanvas: HTMLCanvasElement,
    bounds: { x: number; y: number; w: number; h: number },
  ): number[][] {
    const { x: bx, y: by, w, h } = bounds;
    if (w < 1 || h < 1) return [];
    const ctx = maskCanvas.getContext('2d', { willReadFrequently: true })!;
    const imgData = ctx.getImageData(bx, by, w, h);
    const data = imgData.data;
    const segments: number[][] = [];

    // Corner alpha > 128 → inside (1). Each cell produces 0, 1, or 2 segments.
    // Edge midpoint lookup: 1=T, 2=B, 3=L, 4=R
    // Tables: [s1_e1, s1_e2, s2_e1, s2_e2] (0 = none)
    const CASE: [number, number, number, number][] = [
      [0,0,0,0],[2,4,0,0],[1,4,0,0],[1,2,0,0],
      [2,3,0,0],[3,4,0,0],[1,4,3,2],[1,3,0,0],
      [1,3,0,0],[1,4,3,2],[1,2,0,0],[1,4,0,0],
      [3,4,0,0],[2,3,0,0],[2,4,0,0],[0,0,0,0],
    ];

    for (let j = 0; j < h - 1; j++) {
      for (let i = 0; i < w - 1; i++) {
        const tl = data[(j * w + i) * 4 + 3] > 128 ? 1 : 0;
        const tr = data[(j * w + i + 1) * 4 + 3] > 128 ? 1 : 0;
        const bl = data[((j + 1) * w + i) * 4 + 3] > 128 ? 1 : 0;
        const br = data[((j + 1) * w + i + 1) * 4 + 3] > 128 ? 1 : 0;
        const code = (tl << 3) | (tr << 2) | (bl << 1) | br;
        const [e1, e2, e3, e4] = CASE[code];
        if (e1) {
          const mid = (e: number) => {
            switch (e) {
              case 1: return [bx + i + 0.5, by + j];       // T
              case 2: return [bx + i + 0.5, by + j + 1];   // B
              case 3: return [bx + i, by + j + 0.5];       // L
              case 4: return [bx + i + 1, by + j + 0.5];   // R
              default: return [0, 0];
            }
          };
          const [x1, y1] = mid(e1);
          const [x2, y2] = mid(e2);
          segments.push([x1, y1, x2, y2]);
          if (e3) {
            const [x3, y3] = mid(e3);
            const [x4, y4] = mid(e4);
            segments.push([x3, y3, x4, y4]);
          }
        }
      }
    }
    return segments;
  }

  // Animation loop for marching ants - throttled to 15fps to save CPU.
  // Also runs when the magnetic lasso is in progress so the pulsing start
  // anchor and dashed preview line animate smoothly.
  useEffect(() => {
    const magneticActive = activeTool === 'magnetic-lasso' && lassoPointsRef.current.length > 0;
    if (!selectionMask && !magneticActive) return;
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
  }, [selectionMask, activeTool, drawOverlay]);

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

    // For eraser: draw with source-over (normal) on the stroke canvas using opaque color.
    // The actual erasing happens in commitStrokeToLayer which uses destination-out.
    ctx.save();
    ctx.globalAlpha = opacity / 100;
    ctx.globalCompositeOperation = 'source-over';
    ctx.strokeStyle = erase ? 'rgba(0,0,0,1)' : color;
    ctx.lineWidth = size;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    // If hardness is 100 or eraser, just draw a solid line - fastest path
    if (hardness >= 99 || erase) {
      ctx.beginPath();
      ctx.moveTo(from.x, from.y);
      ctx.lineTo(to.x, to.y);
      ctx.stroke();
    } else {
      // Soft brush: use shadow blur trick for single-pass soft edge
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
    const strokeCanvas = strokeCanvasRef.current;
    // Check if eraser is active — use destination-out to erase
    const isEraser = useEditorStore.getState().activeTool === 'eraser';
    const symmetryPoints = applySymmetry({ x: 0, y: 0 });
    for (const offset of symmetryPoints) {
      ctx.save();
      if (isEraser) {
        ctx.globalCompositeOperation = 'destination-out';
      }
      if (selectionMask) {
        const clipCanvas = createBlankCanvas(docWidth, docHeight);
        const clipCtx = clipCanvas.getContext('2d')!;
        clipCtx.drawImage(selectionMask, 0, 0);
        const tmp = createBlankCanvas(docWidth, docHeight);
        const tmpCtx = tmp.getContext('2d')!;
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

  /**
   * Magnetic lasso edge snapping.
   *
   * Given a point and a search radius, finds the strongest edge pixel within
   * that radius and returns it. Uses a Sobel gradient magnitude on the composite
   * canvas (using proper ITU-R BT.601 luminance, not just the green channel).
   * If no strong edge is found, returns the original point (no snapping).
   *
   * PERFORMANCE: This is called on every pointer-move, but only when the mouse
   * has moved more than MIN_POINT_DISTANCE from the last snapped point. The
   * search area is small (radius × radius pixels) so the Sobel loop is fast.
   *
   * The threshold is intentionally low (50 squared-gradient) so that even soft
   * edges in photographs are detected. The previous value of 1000 was too high
   * and meant the magnetic lasso almost never snapped, making it behave
   * identically to the regular lasso.
   */
  const snapToEdge = useCallback((pt: Point, radius: number): Point => {
    // Prefer the snapshot taken at gesture start. Falls back to the live
    // composite canvas if no snapshot exists (e.g. snapToEdge is called from
    // a context that didn't take a snapshot).
    const canvas = magneticSampleRef.current ?? compositeCanvasRef.current;
    if (!canvas) return pt;
    const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
    // Clamp the search region to canvas bounds. Leave a 1px margin for the
    // Sobel 3×3 kernel (it needs neighbors on all sides).
    const x0 = Math.max(1, Math.floor(pt.x - radius));
    const y0 = Math.max(1, Math.floor(pt.y - radius));
    const x1 = Math.min(docWidth - 2, Math.ceil(pt.x + radius));
    const y1 = Math.min(docHeight - 2, Math.ceil(pt.y + radius));
    const rw = x1 - x0 + 1;
    const rh = y1 - y0 + 1;
    if (rw < 3 || rh < 3) return pt;
    try {
      const imageData = ctx.getImageData(x0, y0, rw, rh);
      const data = imageData.data;
      // Pre-compute a luminance buffer (0-255) using BT.601 weights. This is
      // more accurate than using just the green channel and works correctly
      // for red/blue dominant edges that the green-only approach would miss.
      const lum = new Uint8Array(rw * rh);
      for (let i = 0; i < lum.length; i++) {
        const o = i * 4;
        // Luminance = 0.299R + 0.587G + 0.114B (BT.601). Integer math for speed.
        lum[i] = (data[o] * 77 + data[o + 1] * 150 + data[o + 2] * 29) >> 8;
      }
      let bestX = pt.x;
      let bestY = pt.y;
      let bestGrad = 0;
      // Sobel edge detection on the luminance buffer.
      for (let y = 1; y < rh - 1; y++) {
        for (let x = 1; x < rw - 1; x++) {
          const tl = lum[(y - 1) * rw + (x - 1)];
          const tc = lum[(y - 1) * rw + x];
          const tr = lum[(y - 1) * rw + (x + 1)];
          const ml = lum[y * rw + (x - 1)];
          const mr = lum[y * rw + (x + 1)];
          const bl = lum[(y + 1) * rw + (x - 1)];
          const bc = lum[(y + 1) * rw + x];
          const br = lum[(y + 1) * rw + (x + 1)];
          const gx = -tl + tr - 2 * ml + 2 * mr - bl + br;
          const gy = -tl - 2 * tc - tr + bl + 2 * bc + br;
          const grad = gx * gx + gy * gy;
          if (grad > bestGrad) {
            bestGrad = grad;
            bestX = x0 + x;
            bestY = y0 + y;
          }
        }
      }
      // Lower threshold (50 = gradient magnitude ~7) so we snap to soft edges
      // too. The previous threshold of 1000 (~32) was too aggressive and
      // caused the magnetic lasso to behave identically to the regular lasso
      // for most photographic content.
      if (bestGrad > 50) {
        return { x: bestX, y: bestY };
      }
    } catch {
      // getImageData might fail if the canvas is tainted (cross-origin) or
      // not yet ready. Silently fall back to no snapping.
    }
    return pt;
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

    if (e.button === 1 || (e.button === 0 && (activeTool === 'hand' || spacePressed.current || (e.altKey && activeTool !== 'eyedropper' && activeTool !== 'zoom' && activeTool !== 'clone-stamp' && activeTool !== 'heal-brush')))) {
      // Pan with middle mouse or hand tool or Alt+click (but NOT for eyedropper,
      // zoom, clone-stamp, or heal-brush — those tools use Alt+Click for their
      // own purposes: eyedropper samples, zoom zooms out, clone/heal set source).
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

    // Move tool: snapshot the active layer so we can restore/offset during preview
    if (activeTool === 'move') {
      drawingRef.current = true;
      startPointRef.current = pt;
      const layer = getActiveLayer();
      if (layer && !layer.locked) {
        const snap = createBlankCanvas(docWidth, docHeight);
        snap.getContext('2d')!.drawImage(layer.canvas, 0, 0);
        moveSourceRef.current = snap;
        // Save original selection bounds so we can track the delta on each move
        moveStartBoundsRef.current = selectionBounds
          ? { x: selectionBounds.x, y: selectionBounds.y, w: selectionBounds.w, h: selectionBounds.h }
          : null;
      }
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
      // If the user already has a path going and clicks near the start point,
      // close the lasso (same UX as the polygonal lasso). This lets the user
      // explicitly finish the selection instead of having to drag back to the
      // start.
      const pts = lassoPointsRef.current;
      if (pts.length >= 4) {
        const first = pts[0];
        const dx = pt.x - first.x;
        const dy = pt.y - first.y;
        // Use a slightly larger threshold than polygonal-lasso (10px) because
        // the snapped points are not exactly where the user clicked.
        if (Math.sqrt(dx * dx + dy * dy) < 14) {
          const result = createLassoMask(pts);
          if (result) setSelection(result.mask, result.bounds);
          lassoPointsRef.current = [];
          magneticSampleRef.current = null;
          magneticDragStartedRef.current = false;
          drawingRef.current = false;
          drawOverlay();
          return;
        }
      }
      // Start (or continue) a gesture. Take a snapshot of the composite canvas
      // so the Sobel search doesn't see pixels from the live preview overlay
      // line. Without this, the magnetic lasso would snap to its own trail.
      composite();
      const live = compositeCanvasRef.current;
      if (live) {
        const snap = createBlankCanvas(docWidth, docHeight);
        snap.getContext('2d')!.drawImage(live, 0, 0);
        magneticSampleRef.current = snap;
      }
      // Snap the new point to the nearest edge so anchors sit on real
      // boundaries (matches Photoshop behaviour).
      const newPt = snapToEdge(pt, 10);
      // If we already had an in-progress path (and the previous gesture ended
      // — i.e. the user released the mouse and is now clicking to add a manual
      // anchor), append to it. Otherwise start fresh.
      if (pts.length > 0 && !magneticDragStartedRef.current) {
        lassoPointsRef.current.push(newPt);
      } else {
        lassoPointsRef.current = [newPt];
      }
      magneticDragStartedRef.current = false;
      drawingRef.current = true;
      drawOverlay();
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
    // Magnetic lasso additions: composite + snapToEdge + drawOverlay are now
    // called from onPointerDown (to snapshot the canvas, snap the start point,
    // and refresh the overlay after adding/closing a point).
    composite, snapToEdge, drawOverlay,
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
      const layer = getActiveLayer();
      if (!layer || layer.locked || !moveSourceRef.current) return;
      const ctx = layer.canvas.getContext('2d')!;
      const start = startPointRef.current!;
      const dx = Math.round(pt.x - start.x);
      const dy = Math.round(pt.y - start.y);
      // Clear and redraw the snapshot at the current offset
      ctx.clearRect(0, 0, docWidth, docHeight);
      ctx.drawImage(moveSourceRef.current, dx, dy);
      // Translate selection bounds so the marching ants follow the content
      if (moveStartBoundsRef.current) {
        const sb = moveStartBoundsRef.current;
        setSelection(selectionMask, {
          x: sb.x + dx,
          y: sb.y + dy,
          w: sb.w,
          h: sb.h,
        });
      }
      composite();
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
      // For the regular lasso, add points every 2px. For the magnetic lasso,
      // use a larger threshold (6px) because each point requires an expensive
      // Sobel edge-detection call — adding points too frequently would freeze
      // the UI.
      const minDist = activeTool === 'magnetic-lasso' ? 6 : 2;
      if (!last || Math.hypot(pt.x - last.x, pt.y - last.y) > minDist) {
        if (activeTool === 'magnetic-lasso') {
          // Magnetic lasso: snap the point to the nearest strong edge within
          // a small search radius. Uses Sobel gradient on the composite canvas
          // snapshot taken at gesture start.
          magneticDragStartedRef.current = true;
          const snapped = snapToEdge(pt, 8);
          // Only add the snapped point if it's different from the last point
          // (avoid duplicate points that would make the mask jagged).
          if (!last || Math.hypot(snapped.x - last.x, snapped.y - last.y) > 1) {
            lassoPointsRef.current.push(snapped);
          }
        } else {
          lassoPointsRef.current.push(pt);
        }
      }
      // Live preview: only redraw the overlay (cheap). The actual selection
      // mask is created on pointer-up, NOT on every move — calling
      // setSelection() here would allocate a full-document canvas on every
      // pointermove and freeze the UI on large documents.
      setCursorPos(pt);
      drawOverlay();
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
    createLassoMask, snapToEdge, drawOverlay, docWidth, docHeight, composite, foreground, background,
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
      if (activeTool === 'lasso') {
        const result = createLassoMask(lassoPointsRef.current);
        if (result) setSelection(result.mask, result.bounds);
        lassoPointsRef.current = [];
      } else if (activeTool === 'magnetic-lasso') {
        // Magnetic lasso: if the user actually dragged (vs. just clicking to
        // add a manual anchor), close the path back to the start point and
        // create the selection. If they only clicked (no drag), leave the
        // path open so they can continue clicking to add manual anchors or
        // click near the start to close.
        if (magneticDragStartedRef.current && lassoPointsRef.current.length >= 3) {
          // Auto-close: connect last point back to the first point, then
          // create the mask. This is the standard magnetic-lasso UX — the
          // user drags around the object and releases, and the lasso closes
          // itself.
          const result = createLassoMask(lassoPointsRef.current);
          if (result) setSelection(result.mask, result.bounds);
          lassoPointsRef.current = [];
          magneticSampleRef.current = null;
          magneticDragStartedRef.current = false;
        } else {
          // Just a click (no drag) — leave the path open for the user to
          // continue. The drawing flag is reset so the next click is treated
          // as a new gesture (either closing near start, or adding another
          // manual anchor).
          magneticDragStartedRef.current = false;
        }
      }
      // Always redraw the overlay so the in-progress path (if any) is shown
      // correctly.
      drawOverlay();
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

    // Move tool: the live preview already painted the final state into the
    // layer canvas. We just need to push a history entry and clean up.
    if (activeTool === 'move') {
      const layer = getActiveLayer();
      if (layer && !layer.locked) {
        if (moveSourceRef.current) {
          // The layer already has the moved content from onPointerMove.
          // If the user didn't actually move (click without drag), the
          // layer is unchanged — still push a lightweight entry so undo
          // works if they did drag.
          refreshThumbnail(layer.id);
          pushHistory('Move');
        }
      }
      moveSourceRef.current = null;
      moveStartBoundsRef.current = null;
      composite();
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
    // Magnetic lasso: drawOverlay is now called at the end of onPointerUp to
    // refresh the in-progress path (or clear it) after the gesture ends.
    drawOverlay,
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

  // Double-click handler: close the in-progress magnetic or polygonal lasso.
  // This matches Photoshop's UX where double-clicking anywhere closes the path
  // back to the start point and commits the selection.
  const onDoubleClick = useCallback((e: React.MouseEvent) => {
    if (activeTool === 'magnetic-lasso' && lassoPointsRef.current.length >= 3) {
      const result = createLassoMask(lassoPointsRef.current);
      if (result) setSelection(result.mask, result.bounds);
      lassoPointsRef.current = [];
      magneticSampleRef.current = null;
      magneticDragStartedRef.current = false;
      drawingRef.current = false;
      drawOverlay();
    } else if (activeTool === 'polygonal-lasso' && polygonPointsRef.current.length >= 3) {
      const result = createLassoMask(polygonPointsRef.current);
      if (result) setSelection(result.mask, result.bounds);
      polygonPointsRef.current = [];
      forceRender(v => v + 1);
    }
  }, [activeTool, createLassoMask, setSelection, drawOverlay]);

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

  // Keyboard shortcuts — uses the centralized shortcuts module (src/lib/shortcuts.ts)
  // so the ShortcutsDialog stays in sync with this handler.
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      // Don't intercept when typing in inputs
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA') return;
      if ((e.target as HTMLElement)?.isContentEditable) return;

      const store = useEditorStore.getState();
      const mod = e.ctrlKey || e.metaKey; // Ctrl on Win/Linux, Cmd on macOS

      // --- Ctrl/Cmd+key shortcuts (editing actions) ---
      if (mod) {
        if (e.key === 'z' && !e.shiftKey) { e.preventDefault(); store.undo(); }
        else if (e.key === 'z' && e.shiftKey) { e.preventDefault(); store.redo(); }
        else if (e.key === 'y') { e.preventDefault(); store.redo(); }
        else if (e.key === 'a' && !e.shiftKey) { e.preventDefault(); store.selectAll(); }
        else if (e.key === 'a' && e.shiftKey) { e.preventDefault(); store.selectAll(); }
        else if (e.key === 'd' && !e.shiftKey) { e.preventDefault(); store.clearSelection(); }
        else if (e.key === 'd' && e.shiftKey) { e.preventDefault(); store.clearSelection(); }
        else if (e.key === 'i' && e.shiftKey) { e.preventDefault(); store.invertSelection(); }
        else if (e.key === 's' && !e.shiftKey) { e.preventDefault(); window.dispatchEvent(new CustomEvent('pixel-lab-quick-export')); }
        else if (e.key === 's' && e.shiftKey) { e.preventDefault(); window.dispatchEvent(new CustomEvent('pixel-lab-export-jpeg')); }
        else if (e.key === 'c' && !e.shiftKey) { e.preventDefault(); store.copySelection(); }
        else if (e.key === 'x' && !e.shiftKey) { e.preventDefault(); store.copySelection(); /* cut = copy + delete selection */ }
        else if (e.key === 'v' && !e.shiftKey) { e.preventDefault(); store.pasteAsNewLayer(); }
        else if (e.key === 'v' && e.shiftKey) { e.preventDefault(); window.dispatchEvent(new CustomEvent('open-vectorize-dialog')); }
        else if (e.key === 'j' && !e.shiftKey) {
          // Duplicate layer (Photoshop: Ctrl+J)
          e.preventDefault();
          if (store.activeLayerId) store.duplicateLayer(store.activeLayerId);
        }
        else if (e.key === 'j' && e.shiftKey) {
          // Cut to new layer (Photoshop: Ctrl+Shift+J)
          e.preventDefault();
          store.copySelection();
          store.pasteAsNewLayer();
        }
        else if (e.key === 'n' && e.shiftKey) {
          // New layer (Photoshop: Ctrl+Shift+N)
          e.preventDefault();
          store.addLayer();
        }
        else if (e.key === 'n' && !e.shiftKey) {
          // New document — let the menu handle it
          e.preventDefault();
          window.dispatchEvent(new CustomEvent('pixel-lab-new-document'));
        }
        else if (e.key === 'o' && !e.shiftKey) {
          e.preventDefault();
          window.dispatchEvent(new CustomEvent('pixel-lab-open-file'));
        }
        else if (e.key === 'e' && !e.shiftKey) {
          // Merge down (Photoshop: Ctrl+E)
          e.preventDefault();
          if (store.activeLayerId) store.mergeDown(store.activeLayerId);
        }
        else if (e.key === 'e' && e.shiftKey) {
          // Merge visible (Photoshop: Ctrl+Shift+E)
          e.preventDefault();
          store.mergeVisible();
        }
        else if (e.key === ']' && !e.shiftKey) {
          // Bring layer forward
          e.preventDefault();
          const idx = store.layers.findIndex(l => l.id === store.activeLayerId);
          if (idx >= 0 && idx < store.layers.length - 1) store.reorderLayers(idx, idx + 1);
        }
        else if (e.key === '[' && !e.shiftKey) {
          // Send layer backward
          e.preventDefault();
          const idx = store.layers.findIndex(l => l.id === store.activeLayerId);
          if (idx > 0) store.reorderLayers(idx, idx - 1);
        }
        else if (e.key === ']' && e.shiftKey) {
          // Bring to front
          e.preventDefault();
          const idx = store.layers.findIndex(l => l.id === store.activeLayerId);
          if (idx >= 0 && idx < store.layers.length - 1) store.reorderLayers(idx, store.layers.length - 1);
        }
        else if (e.key === '[' && e.shiftKey) {
          // Send to back
          e.preventDefault();
          const idx = store.layers.findIndex(l => l.id === store.activeLayerId);
          if (idx > 0) store.reorderLayers(idx, 0);
        }
        else if (e.key === '+' || e.key === '=') { e.preventDefault(); setZoom(zoom * 1.25); }
        else if (e.key === '-' || e.key === '_') { e.preventDefault(); setZoom(zoom / 1.25); }
        else if (e.key === '0') { e.preventDefault(); setZoom(1); }
        else if (e.key === '1') { e.preventDefault(); setZoom(1); }
        else if (e.key === '2') { e.preventDefault(); window.dispatchEvent(new CustomEvent('pixel-lab-toggle-panels')); }
        else if (e.key === ';') { e.preventDefault(); store.toggleRulers(); }
        else if (e.key === "'") { e.preventDefault(); store.toggleGrid(); }
        else if (e.key === 'h' && !e.shiftKey) {
          // Toggle extras (selection marching ants visibility)
          e.preventDefault();
          // We don't have a direct toggle for just selection visibility, so we
          // toggle the grid as a proxy. TODO: add a dedicated extras toggle.
          store.toggleGrid();
        }
        else if (e.key === '/') {
          // Show keyboard shortcuts dialog
          e.preventDefault();
          window.dispatchEvent(new CustomEvent('pixel-lab-show-shortcuts'));
        }
        else if (e.key === 'p') {
          // Print
          e.preventDefault();
          window.print();
        }
        return;
      }

      // --- Space (hold to pan) ---
      if (e.key === ' ' && !e.repeat) {
        spacePressed.current = true;
        return;
      }

      // --- Pen tool: Enter commits, Escape cancels ---
      if (store.activeTool === 'pen' || store.activeTool === 'curvature-pen') {
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

      // --- Magnetic lasso: Escape cancels the in-progress path; Enter
      //     closes it (commits the selection). ---
      if (store.activeTool === 'magnetic-lasso') {
        if (e.key === 'Escape') {
          lassoPointsRef.current = [];
          magneticSampleRef.current = null;
          magneticDragStartedRef.current = false;
          drawingRef.current = false;
          drawOverlay();
          return;
        }
        if (e.key === 'Enter' && lassoPointsRef.current.length >= 3) {
          const result = createLassoMask(lassoPointsRef.current);
          if (result) setSelection(result.mask, result.bounds);
          lassoPointsRef.current = [];
          magneticSampleRef.current = null;
          magneticDragStartedRef.current = false;
          drawingRef.current = false;
          drawOverlay();
          return;
        }
      }

      // --- Polygonal lasso: Escape cancels, Enter closes ---
      if (store.activeTool === 'polygonal-lasso') {
        if (e.key === 'Escape') {
          polygonPointsRef.current = [];
          forceRender(v => v + 1);
          return;
        }
        if (e.key === 'Enter' && polygonPointsRef.current.length >= 3) {
          const result = createLassoMask(polygonPointsRef.current);
          if (result) setSelection(result.mask, result.bounds);
          polygonPointsRef.current = [];
          forceRender(v => v + 1);
          return;
        }
      }

      // --- Single-letter tool shortcuts ---
      const key = e.key.toLowerCase();
      if (TOOL_SHORTCUTS[key]) {
        setTool(TOOL_SHORTCUTS[key]);
        return;
      }

      // --- Color shortcuts ---
      if (key === 'x') {
        store.swapColors();
        return;
      }
      if (key === 'd' && !e.ctrlKey && !e.metaKey) {
        store.resetColors();
        return;
      }

      // --- Brush size / hardness ---
      if (e.key === '[') {
        setToolOptions({ brushSize: Math.max(1, toolOptions.brushSize - 5) });
        return;
      }
      if (e.key === ']') {
        setToolOptions({ brushSize: Math.min(500, toolOptions.brushSize + 5) });
        return;
      }
      if (e.shiftKey && e.key === '[') {
        setToolOptions({ brushHardness: Math.max(0, toolOptions.brushHardness - 10) });
        return;
      }
      if (e.shiftKey && e.key === ']') {
        setToolOptions({ brushHardness: Math.min(100, toolOptions.brushHardness + 10) });
        return;
      }

      // --- Layer opacity (number keys 0-9) ---
      if (/^[0-9]$/.test(e.key)) {
        const num = parseInt(e.key, 10);
        const opacity = num === 0 ? 1 : num / 10;
        if (store.activeLayerId) {
          store.updateLayer(store.activeLayerId, { opacity });
        }
        return;
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
  }, [zoom, setZoom, setTool, setToolOptions, toolOptions.brushSize, toolOptions.brushHardness, commitPenPath, composite]);

  // Auto-fit zoom to container
  const lastFitW = useRef(0);
  const lastFitH = useRef(0);
  useEffect(() => {
    if (containerSize.w < 50 || containerSize.h < 50 || docWidth === 0) return;
    // Re-fit if container dimensions changed (covers initial load, viewport resize, mobile/desktop switch)
    if (containerSize.w === lastFitW.current && containerSize.h === lastFitH.current) return;
    lastFitW.current = containerSize.w;
    lastFitH.current = containerSize.h;
    // Use smaller margin on mobile to maximize canvas area
    const margin = containerSize.w < 500 ? 20 : 60;
    const fitZoom = Math.min(
      (containerSize.w - margin) / docWidth,
      (containerSize.h - margin) / docHeight,
    );
    // On mobile, allow zooming in up to 2x to fill the screen
    const maxZoom = containerSize.w < 500 ? 2 : 1;
    const finalZoom = Math.max(0.05, Math.min(maxZoom, fitZoom));
    setZoom(finalZoom);
    // Reset pan to center
    useEditorStore.getState().setPan(0, 0);
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
        className="absolute shadow-xl rounded-sm overflow-hidden"
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
          onDoubleClick={onDoubleClick}
        />
        <canvas
          ref={overlayCanvasRef}
          className="absolute inset-0 pointer-events-none"
          style={{ width: '100%', height: '100%' }}
        />
      </div>

      {/* Status bar */}
      <div className="absolute bottom-2 left-2 editor-surface/90 backdrop-blur px-2.5 py-1 rounded-md text-[10px] editor-text font-mono pointer-events-none shadow-md">
        {docWidth} × {docHeight}px · {Math.round(zoom * 100)}%
        {cursorPos && ` · ${Math.round(cursorPos.x)}, ${Math.round(cursorPos.y)}`}
      </div>

      {/* Zoom controls (bottom-right, non-intrusive) */}
      <div className="absolute bottom-2 right-2 flex items-center gap-1 editor-surface/90 backdrop-blur rounded-md shadow-md p-0.5">
        <button
          onClick={() => setZoom(zoom / 1.25)}
          className="w-7 h-7 flex items-center justify-center rounded editor-text-muted hover:editor-surface-3 transition-colors"
          title="Zoom out"
        >−</button>
        <button
          onClick={() => {
            // Fit to screen
            if (containerSize.w > 0 && containerSize.h > 0) {
              const margin = 40;
              const fitZoom = Math.min(
                (containerSize.w - margin) / docWidth,
                (containerSize.h - margin) / docHeight,
              );
              setZoom(Math.max(0.05, fitZoom));
              useEditorStore.getState().setPan(0, 0);
            }
          }}
          className="px-2 h-7 flex items-center justify-center rounded editor-text-muted hover:editor-surface-3 text-[10px] transition-colors"
          title="Fit to screen"
        >Fit</button>
        <button
          onClick={() => setZoom(zoom * 1.25)}
          className="w-7 h-7 flex items-center justify-center rounded editor-text-muted hover:editor-surface-3 transition-colors"
          title="Zoom in"
        >+</button>
        <button
          onClick={() => { setZoom(1); useEditorStore.getState().setPan(0, 0); }}
          className="px-2 h-7 flex items-center justify-center rounded editor-text-muted hover:editor-surface-3 text-[10px] transition-colors"
          title="100%"
        >1:1</button>
      </div>
    </div>
  );
}
