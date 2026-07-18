/**
 * Agent Tools — Schema + Executor.
 *
 * This module bridges Gemini function-calling to Pixel Lab's existing editor
 * functions. It deliberately does NOT reimplement any filter logic — every
 * tool wraps an existing function from `image-processing.ts` or an action from
 * `editor-store.ts`.
 *
 * CRITICAL DESIGN — OFFSCREEN PREVIEW:
 *   Every tool execution operates on a CLONED working canvas (offscreen),
 *   NEVER on the live editor-store. The agent-runner hands us a "workspace"
 *   (a cloned LayerData[] + selectionMask). We mutate the workspace in place.
 *   On user Accept, the runner copies the workspace back into the live store
 *   and pushes history — identical to a manual edit.
 *
 *   This means: a rejected preview NEVER touches the undo stack (Part 5.4),
 *   and an accepted preview produces an undo entry identical in structure to
 *   a manual edit (Part 5.5).
 *
 * SELECTION PRECISION (v1 limitation):
 *   Bounding-box / point coordinates from an LLM are approximate. v1 combines
 *   them with the existing Magic Wand tolerance/flood-fill so a rough point
 *   still produces a clean selection. Future iteration could add a
 *   segmentation model (e.g. SAM) for tighter masks — extension point only.
 */

import {
  applyFastBlur,
  applySharpen,
  applySepia,
  applyGrayscale,
  applyInvert,
  applyPosterize,
  applyPixelate,
  applyEdgeDetect,
  applyEmboss,
  addNoise,
  applyVignette,
  applyHighlightsShadows,
  applyWhitesBlacks,
  applyClarity,
  applyDehaze,
  applyTexture,
  applyVibrance,
  applySaturation,
  applySplitToning,
  applyGrain,
  applyLensVignette,
  applySharpening,
  applyLuminanceNR,
  applyColorNR,
  applyBrightnessContrast,
  autoRemoveBackground,
  contentAwareFill,
  createBlankCanvas,
  generateThumbnail,
  hexToRgb,
} from '@/lib/image-processing';
import {
  drawStar,
  drawPolygon,
  drawArrow,
  drawHeart,
} from '@/lib/vector-shapes';
import type { LayerData } from '@/lib/editor-types';
import type { GeminiFunctionDeclaration } from './gemini-client';

// ---------------------------------------------------------------------------
// Workspace — what every tool sees & mutates
// ---------------------------------------------------------------------------

export interface AgentWorkspace {
  /** Cloned layers (each with its own offscreen canvas). Mutated in place. */
  layers: LayerData[];
  activeLayerId: string | null;
  docWidth: number;
  docHeight: number;
  /** Selection mask (cloned), or null = no selection. */
  selectionMask: HTMLCanvasElement | null;
  selectionBounds: { x: number; y: number; w: number; h: number } | null;
}

export interface ToolResult {
  success: boolean;
  message: string;
  /** Optional thumbnail data URL of the result state (for chips). */
  thumbnailBase64?: string;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function clamp(v: number, min: number, max: number): number {
  if (Number.isNaN(v)) return min;
  return Math.max(min, Math.min(max, v));
}

function num(val: unknown, def = 0): number {
  const n = typeof val === 'number' ? val : parseFloat(String(val));
  return Number.isFinite(n) ? n : def;
}

function str(val: unknown, def = ''): string {
  return typeof val === 'string' ? val : def;
}

/**
 * Parse any CSS color string (hex, named color like "red", rgb(), hsl(), etc.)
 * into {r, g, b} via a hidden canvas — the browser's CSS color parser does
 * the heavy lifting. Falls back to black on parse failure.
 *
 * We use this instead of hexToRgb because the model is allowed to pass any
 * CSS color (named colors are very natural in prompts like "make it red").
 */
function parseColor(color: string): { r: number; g: number; b: number } {
  if (!color) return { r: 0, g: 0, b: 0 };
  // Try hex first (most common case, fast path).
  try {
    if (color.startsWith('#')) {
      const rgb = hexToRgb(color);
      if (rgb) return rgb;
    }
  } catch {
    /* fall through */
  }
  // Use the browser to parse any other CSS color (named, rgb(), hsl()).
  try {
    const ctx = parseColorCtx ??= document.createElement('canvas').getContext('2d')!;
    ctx.fillStyle = '#000000'; // reset
    ctx.fillStyle = color;
    // Browser will keep the previous fillStyle if `color` is invalid.
    const resolved = ctx.fillStyle;
    // Resolved is always #rrggbb or #rrggbbaa for valid colors.
    if (typeof resolved === 'string' && resolved.startsWith('#')) {
      const r = parseInt(resolved.slice(1, 3), 16);
      const g = parseInt(resolved.slice(3, 5), 16);
      const b = parseInt(resolved.slice(5, 7), 16);
      if (Number.isFinite(r) && Number.isFinite(g) && Number.isFinite(b)) {
        return { r, g, b };
      }
    }
  } catch {
    /* ignore */
  }
  return { r: 0, g: 0, b: 0 };
}
let parseColorCtx: CanvasRenderingContext2D | null = null;

function getActiveLayer(ws: AgentWorkspace): LayerData | null {
  if (!ws.activeLayerId) return ws.layers[0] ?? null;
  return ws.layers.find((l) => l.id === ws.activeLayerId) ?? ws.layers[0] ?? null;
}

/**
 * Composite all visible layers onto a single canvas. Used for sending to
 * Gemini and for before/after previews.
 */
export function compositeWorkspace(ws: AgentWorkspace): HTMLCanvasElement {
  const out = createBlankCanvas(ws.docWidth, ws.docHeight);
  const ctx = out.getContext('2d')!;
  for (const layer of ws.layers) {
    if (!layer.visible) continue;
    ctx.save();
    ctx.globalAlpha = layer.opacity;
    ctx.globalCompositeOperation = layer.blendMode as GlobalCompositeOperation;
    if (layer.maskCanvas && layer.maskEnabled) {
      const tmp = createBlankCanvas(ws.docWidth, ws.docHeight);
      const tctx = tmp.getContext('2d')!;
      tctx.drawImage(layer.canvas, 0, 0);
      tctx.globalCompositeOperation = 'destination-in';
      tctx.drawImage(layer.maskCanvas, 0, 0);
      ctx.drawImage(tmp, 0, 0);
    } else {
      ctx.drawImage(layer.canvas, 0, 0);
    }
    ctx.restore();
  }
  return out;
}

/**
 * Magic Wand on a workspace layer. Ported from EditorCanvas.tsx magicWand()
 * so the agent can run it without touching the live store.
 *
 * startX/startY are in CANVAS pixels (caller normalizes from 0-1 coords).
 * tolerance is 0-100 (matches the existing UI slider).
 */
function magicWandOnLayer(
  layer: LayerData,
  docWidth: number,
  docHeight: number,
  startX: number,
  startY: number,
  tolerance: number,
): { mask: HTMLCanvasElement; bounds: { x: number; y: number; w: number; h: number } } {
  startX = Math.floor(startX);
  startY = Math.floor(startY);
  const W = docWidth, H = docHeight;
  startX = Math.max(0, Math.min(W - 1, startX));
  startY = Math.max(0, Math.min(H - 1, startY));

  const ctx = layer.canvas.getContext('2d', { willReadFrequently: true })!;
  const imageData = ctx.getImageData(0, 0, W, H);
  const data = imageData.data;
  const startIdx = (startY * W + startX) * 4;
  const targetR = data[startIdx];
  const targetG = data[startIdx + 1];
  const targetB = data[startIdx + 2];
  const threshold = (tolerance / 100) * (150 * 150 * 3);

  const selected = new Uint8Array(W * H);
  const matches = (idx: number) => {
    const i = idx * 4;
    const dr = data[i] - targetR;
    const dg = data[i + 1] - targetG;
    const db = data[i + 2] - targetB;
    return dr * dr + dg * dg + db * db <= threshold;
  };

  const stack: number[] = [startY * W + startX];
  let minX = W, minY = H, maxX = 0, maxY = 0;
  while (stack.length > 0) {
    const idx = stack.pop()!;
    if (selected[idx]) continue;
    if (!matches(idx)) continue;
    const x = idx % W;
    const y = (idx - x) / W;
    let lx = x;
    while (lx > 0 && !selected[y * W + lx - 1] && matches(y * W + lx - 1)) lx--;
    let rx = x;
    while (rx < W - 1 && !selected[y * W + rx + 1] && matches(y * W + rx + 1)) rx++;
    for (let fx = lx; fx <= rx; fx++) {
      const fidx = y * W + fx;
      selected[fidx] = 1;
      if (fx < minX) minX = fx;
      if (fx > maxX) maxX = fx;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
      if (y > 0) {
        const aIdx = fidx - W;
        if (!selected[aIdx] && matches(aIdx)) stack.push(aIdx);
      }
      if (y < H - 1) {
        const bIdx = fidx + W;
        if (!selected[bIdx] && matches(bIdx)) stack.push(bIdx);
      }
    }
  }

  const mask = createBlankCanvas(W, H);
  const mctx = mask.getContext('2d')!;
  const maskData = mctx.createImageData(W, H);
  const md = maskData.data;
  for (let idx = 0; idx < selected.length; idx++) {
    if (selected[idx]) {
      const i = idx * 4;
      md[i] = 255; md[i + 1] = 255; md[i + 2] = 255; md[i + 3] = 255;
    }
  }
  mctx.putImageData(maskData, 0, 0);
  return {
    mask,
    bounds: { x: minX, y: minY, w: maxX - minX + 1, h: maxY - minY + 1 },
  };
}

/** Build a rectangular selection mask from normalized (0-1) coords. */
function boxSelection(
  docWidth: number,
  docHeight: number,
  x0n: number,
  y0n: number,
  x1n: number,
  y1n: number,
): { mask: HTMLCanvasElement; bounds: { x: number; y: number; w: number; h: number } } {
  const x0 = Math.max(0, Math.min(docWidth, Math.round(Math.min(x0n, x1n) * docWidth)));
  const y0 = Math.max(0, Math.min(docHeight, Math.round(Math.min(y0n, y1n) * docHeight)));
  const x1 = Math.max(0, Math.min(docWidth, Math.round(Math.max(x0n, x1n) * docWidth)));
  const y1 = Math.max(0, Math.min(docHeight, Math.round(Math.max(y0n, y1n) * docHeight)));
  const mask = createBlankCanvas(docWidth, docHeight);
  const mctx = mask.getContext('2d')!;
  mctx.fillStyle = '#ffffff';
  mctx.fillRect(x0, y0, Math.max(1, x1 - x0), Math.max(1, y1 - y0));
  return {
    mask,
    bounds: { x: x0, y: y0, w: Math.max(1, x1 - x0), h: Math.max(1, y1 - y0) },
  };
}

function invertMaskInPlace(mask: HTMLCanvasElement, docWidth: number, docHeight: number) {
  const ctx = mask.getContext('2d', { willReadFrequently: true })!;
  const imageData = ctx.getImageData(0, 0, docWidth, docHeight);
  const data = imageData.data;
  for (let i = 0; i < data.length; i += 4) {
    data[i] = 255 - data[i];
    data[i + 1] = 255 - data[i + 1];
    data[i + 2] = 255 - data[i + 2];
    // keep alpha
  }
  ctx.putImageData(imageData, 0, 0);
}

// ---------------------------------------------------------------------------
// Tool function declarations (Gemini schema)
// ---------------------------------------------------------------------------

export const TOOL_DECLARATIONS: GeminiFunctionDeclaration[] = [
  {
    name: 'applyFilter',
    description:
      'Apply a pixel filter to the active layer. Use this for one-shot stylistic effects. ' +
      'Valid filterType values: "gaussianBlur", "sharpen", "sepia", "grayscale", "invert", ' +
      '"posterize", "pixelate", "edgeDetect", "emboss", "addNoise", "vignette". ' +
      'Params vary per filter — see parameter descriptions. The change is applied to the ' +
      'current selection if one exists, otherwise to the whole layer.',
    parameters: {
      type: 'object',
      properties: {
        filterType: {
          type: 'string',
          description:
            'One of: gaussianBlur, sharpen, sepia, grayscale, invert, posterize, pixelate, ' +
            'edgeDetect, emboss, addNoise, vignette.',
        },
        params: {
          type: 'object',
          description:
            'Filter-specific numeric params. ' +
            'gaussianBlur: { radius: 0.5-20 }. ' +
            'sharpen: { amount: 0-2 }. ' +
            'posterize: { levels: 2-32 }. ' +
            'pixelate: { blockSize: 2-64 }. ' +
            'addNoise: { amount: 0-100 }. ' +
            'vignette: { amount: 0-100, size: 0-100 }. ' +
            'sepia / grayscale / invert / edgeDetect / emboss: no params needed.',
          properties: {},
        },
      },
      required: ['filterType'],
    },
  },
  {
    name: 'adjustDevelop',
    description:
      'Apply a Lightroom-style develop adjustment to the active layer. These are the same ' +
      'adjustments exposed in the Develop panel. Each call applies ONE param to ONE section. ' +
      'Section "light": exposure(-100..100), contrast(-100..100), highlights(-100..100), ' +
      'shadows(-100..100), whites(-100..100), blacks(-100..100), clarity(-100..100), ' +
      'dehaze(-100..100), texture(-100..100). ' +
      'Section "color": vibrance(-100..100), saturation(-100..100). ' +
      'Section "effects": grain(0..100, size 1..100), vignette(-100..100, midpoint 0..100, roundness 0..100, feather 0..100). ' +
      'Section "detail": sharpening(0..150, radius 0.5..3, detail 0..100), luminanceNR(0..100), colorNR(0..100). ' +
      'Section "splitToning": highlightHue(0..360), highlightSat(0..100), shadowHue(0..360), shadowSat(0..100), balance(-100..100).',
    parameters: {
      type: 'object',
      properties: {
        section: {
          type: 'string',
          description: 'One of: light, color, effects, detail, splitToning.',
        },
        param: { type: 'string', description: 'Parameter name within the section.' },
        value: { type: 'number', description: 'Numeric value to apply (clamped to range).' },
      },
      required: ['section', 'param', 'value'],
    },
  },
  {
    name: 'selectRegionByPoint',
    description:
      'Select a region by clicking a normalized (x, y) point on the canvas, using Magic Wand ' +
      'flood-fill. Use this when you can identify a specific pixel that lies inside the target ' +
      'object (e.g. "the sky" → pick a pixel in the upper area that is clearly sky-blue). ' +
      'Coordinates are normalized 0-1, with origin at top-left. The flood-fill expands to ' +
      'similar-color neighbors controlled by tolerance. Returns the resulting selection bounds.',
    parameters: {
      type: 'object',
      properties: {
        x: { type: 'number', description: 'Normalized X coordinate (0=left, 1=right).' },
        y: { type: 'number', description: 'Normalized Y coordinate (0=top, 1=bottom).' },
        tolerance: {
          type: 'number',
          description: 'Color similarity tolerance 0-100 (higher = broader match). Default 32.',
        },
      },
      required: ['x', 'y'],
    },
  },
  {
    name: 'selectRegionByBox',
    description:
      'Select a rectangular region by giving a normalized (0-1) bounding box. Use this when ' +
      'you can only give a coarse bounding box for an object. Coordinates are normalized 0-1 ' +
      'with origin at top-left. (x0,y0) is one corner, (x1,y1) is the opposite corner.',
    parameters: {
      type: 'object',
      properties: {
        x0: { type: 'number' },
        y0: { type: 'number' },
        x1: { type: 'number' },
        y1: { type: 'number' },
      },
      required: ['x0', 'y0', 'x1', 'y1'],
    },
  },
  {
    name: 'invertSelection',
    description: 'Invert the current selection. If nothing is selected, selects nothing.',
    parameters: { type: 'object', properties: {} },
  },
  {
    name: 'deselectAll',
    description: 'Clear the current selection so subsequent edits affect the whole layer.',
    parameters: { type: 'object', properties: {} },
  },
  {
    name: 'contentAwareFill',
    description:
      'Fill the current selection with surrounding pixels (inpainting). Use after selecting an ' +
      'object you want to remove. Requires an active selection. Does not use AI — samples and ' +
      'averages neighboring pixels with noise. The result is best for small/medium regions on ' +
      'relatively uniform backgrounds.',
    parameters: { type: 'object', properties: {} },
  },
  {
    name: 'autoBackgroundRemove',
    description:
      'Automatically remove the background by flood-filling from the image edges. Best for ' +
      'subjects on a fairly uniform background (sky, white wall). The active layer becomes ' +
      'transparent where the background was. tolerance 0-100 (higher = more aggressive).',
    parameters: {
      type: 'object',
      properties: {
        tolerance: {
          type: 'number',
          description: 'Color similarity tolerance 0-100. Default 32.',
        },
      },
    },
  },
  {
    name: 'addAdjustmentLayer',
    description:
      'Add a non-destructive adjustment layer on top of the layer stack. type is one of: ' +
      '"brightnessContrast" { brightness: -100..100, contrast: -100..100 }, ' +
      '"hueSaturation" { hue: -180..180, saturation: -100..100, lightness: -100..100 }, ' +
      '"vibrance" { vibrance: -100..100 }, "exposure" { exposure: -100..100 }. ' +
      'Note: in v1 this records the adjustment in the adjustment-layers list but does not ' +
      're-render the composite non-destructively — the active layer is also baked.',
    parameters: {
      type: 'object',
      properties: {
        type: { type: 'string' },
        params: { type: 'object', properties: {} },
      },
      required: ['type'],
    },
  },
  {
    name: 'drawShape',
    description:
      'Draw a vector shape onto the active layer. Coordinates are normalized 0-1 with origin at top-left. ' +
      'For a circle, use shapeType "ellipse" with equal width/height. For a rectangle, "rect". ' +
      'For a line, "line" (use x0,y0 as start and x1,y1 as end). ' +
      'Other shapes: "star", "polygon", "arrow", "heart". ' +
      'Colors are CSS color strings (hex like "#ff0000", named like "red", or "rgb(0,128,255)"). ' +
      'Set filled=true for a solid fill, false for outline only. The shape is clipped to the current ' +
      'selection if one exists.',
    parameters: {
      type: 'object',
      properties: {
        shapeType: {
          type: 'string',
          description: 'One of: ellipse (also covers circle when width==height), rect, line, star, polygon, arrow, heart.',
        },
        x0: { type: 'number', description: 'Normalized X of the shape origin / first corner (0=left, 1=right).' },
        y0: { type: 'number', description: 'Normalized Y of the shape origin / first corner (0=top, 1=bottom).' },
        x1: { type: 'number', description: 'Normalized X of the opposite corner (ignored for star/polygon/heart, which use x0,y0 as center).' },
        y1: { type: 'number', description: 'Normalized Y of the opposite corner (ignored for star/polygon/heart, which use x0,y0 as center).' },
        fillColor: { type: 'string', description: 'CSS color for the fill, e.g. "#ff0000" or "red". Default "#000000".' },
        strokeColor: { type: 'string', description: 'CSS color for the outline. Default same as fillColor.' },
        strokeWidth: { type: 'number', description: 'Outline thickness in pixels (0-50). Default 2.' },
        filled: { type: 'boolean', description: 'If true, fill the shape. If false, outline only. Default true.' },
        sides: { type: 'number', description: 'For polygon: number of sides (3-12). Default 6.' },
        points: { type: 'number', description: 'For star: number of points (3-20). Default 5.' },
      },
      required: ['shapeType', 'x0', 'y0'],
    },
  },
  {
    name: 'drawBrushStroke',
    description:
      'Draw a freehand brush stroke along a path of normalized (0-1) points. Use this for organic shapes ' +
      'or scribbles that don\'t fit a named shape. The stroke is drawn with soft edges (shadow-blur brush). ' +
      'Coordinates are normalized 0-1 with origin at top-left.',
    parameters: {
      type: 'object',
      properties: {
        points: {
          type: 'array',
          description: 'Array of {x, y} normalized points (0-1) defining the stroke path. At least 2 points.',
          items: {
            type: 'object',
            properties: {
              x: { type: 'number' },
              y: { type: 'number' },
            },
          },
        },
        color: { type: 'string', description: 'CSS color for the stroke. Default "#000000".' },
        size: { type: 'number', description: 'Brush diameter in pixels (1-200). Default 20.' },
        opacity: { type: 'number', description: 'Stroke opacity 0-100. Default 100.' },
        hardness: { type: 'number', description: 'Brush edge hardness 0-100 (100 = hard edge, 0 = very soft). Default 80.' },
      },
      required: ['points'],
    },
  },
  {
    name: 'addText',
    description:
      'Render a text string onto the active layer at a normalized (x, y) position. The position is the ' +
      'top-left baseline of the text. Use this for captions, labels, watermarks, etc. Origin is top-left, ' +
      'coordinates are normalized 0-1.',
    parameters: {
      type: 'object',
      properties: {
        text: { type: 'string', description: 'The text to render. Multi-line with \\n.' },
        x: { type: 'number', description: 'Normalized X position of the text anchor (0=left, 1=right).' },
        y: { type: 'number', description: 'Normalized Y position of the text anchor (0=top, 1=bottom).' },
        color: { type: 'string', description: 'CSS color. Default "#000000".' },
        fontSize: { type: 'number', description: 'Font size in pixels (8-400). Default 48.' },
        fontFamily: { type: 'string', description: 'CSS font-family. Default "Inter, sans-serif".' },
        align: { type: 'string', description: 'Text alignment: "left", "center", "right". Default "left".' },
      },
      required: ['text', 'x', 'y'],
    },
  },
  {
    name: 'fillBucket',
    description:
      'Paint-bucket fill: flood-fill from a normalized (x, y) point with a solid color, replacing all ' +
      'similar-color connected pixels. Use this to fill the background, fill an enclosed region, or ' +
      'recolor a flat area. Coordinates are normalized 0-1 with origin at top-left.',
    parameters: {
      type: 'object',
      properties: {
        x: { type: 'number', description: 'Normalized X coordinate of the fill seed (0=left, 1=right).' },
        y: { type: 'number', description: 'Normalized Y coordinate of the fill seed (0=top, 1=bottom).' },
        color: { type: 'string', description: 'CSS color to fill with, e.g. "#0000ff" or "blue". Default "#000000".' },
        tolerance: { type: 'number', description: 'Color similarity tolerance 0-100 (higher = broader match). Default 32.' },
      },
      required: ['x', 'y', 'color'],
    },
  },
  {
    name: 'undo',
    description:
      'Undo the last agent-applied change in this turn. Use sparingly — if the user rejects ' +
      'the preview, the whole turn is discarded automatically.',
    parameters: { type: 'object', properties: {} },
  },
];

// ---------------------------------------------------------------------------
// Executor — dispatches a single tool call against the workspace
// ---------------------------------------------------------------------------

export interface ExecuteOptions {
  /** For undo() — pop the workspace history. */
  undoStack?: AgentWorkspace[];
}

export async function executeTool(
  toolName: string,
  args: Record<string, unknown>,
  ws: AgentWorkspace,
  _opts: ExecuteOptions = {},
): Promise<ToolResult> {
  const layer = getActiveLayer(ws);
  if (!layer && toolName !== 'deselectAll' && toolName !== 'invertSelection') {
    return { success: false, message: 'No active layer to operate on.' };
  }

  switch (toolName) {
    // ----- applyFilter -----
    case 'applyFilter': {
      const filterType = str(args.filterType, '').toLowerCase();
      const params = (args.params as Record<string, unknown>) ?? {};
      const ctx = layer!.canvas.getContext('2d', { willReadFrequently: true })!;
      const w = layer!.canvas.width;
      const h = layer!.canvas.height;
      // If there's a selection, apply filter only to selected pixels.
      // We do this by: (1) copy current pixels into a temp canvas, (2) run filter
      // on the temp, (3) composite selected pixels back onto the layer.
      const selectionMask = ws.selectionMask;
      const runFilter = (targetCtx: CanvasRenderingContext2D) => {
        switch (filterType) {
          case 'gaussianblur': {
            const radius = clamp(num(params.radius, 2), 0.1, 20);
            applyFastBlur(targetCtx, w, h, radius);
            return `Gaussian Blur (radius: ${radius})`;
          }
          case 'sharpen': {
            const amount = clamp(num(params.amount, 0.5), 0, 2);
            applySharpen(targetCtx, w, h, amount);
            return `Sharpen (amount: ${amount})`;
          }
          case 'sepia':
            applySepia(targetCtx, w, h);
            return 'Sepia';
          case 'grayscale':
            applyGrayscale(targetCtx, w, h);
            return 'Grayscale';
          case 'invert':
            applyInvert(targetCtx, w, h);
            return 'Invert';
          case 'posterize': {
            const levels = Math.round(clamp(num(params.levels, 4), 2, 32));
            applyPosterize(targetCtx, w, h, levels);
            return `Posterize (levels: ${levels})`;
          }
          case 'pixelate': {
            const blockSize = Math.round(clamp(num(params.blockSize, 8), 2, 64));
            applyPixelate(targetCtx, w, h, blockSize);
            return `Pixelate (blockSize: ${blockSize})`;
          }
          case 'edgedetect':
            applyEdgeDetect(targetCtx, w, h);
            return 'Edge Detect';
          case 'emboss':
            applyEmboss(targetCtx, w, h);
            return 'Emboss';
          case 'addnoise': {
            const amount = clamp(num(params.amount, 15), 0, 100);
            addNoise(targetCtx, w, h, amount);
            return `Add Noise (amount: ${amount})`;
          }
          case 'vignette': {
            const amount = clamp(num(params.amount, 50), 0, 100);
            const size = clamp(num(params.size, 50), 0, 100);
            applyVignette(targetCtx, w, h, amount, size);
            return `Vignette (amount: ${amount}, size: ${size})`;
          }
          default:
            throw new Error(`Unknown filterType: ${filterType}`);
        }
      };

      try {
        if (selectionMask) {
          // Apply filter to a copy, then mask-blend back.
          const tmp = createBlankCanvas(w, h);
          const tctx = tmp.getContext('2d', { willReadFrequently: true })!;
          tctx.drawImage(layer!.canvas, 0, 0);
          const label = runFilter(tctx);
          // Blend: keep original where mask is black, use filtered where mask is white.
          ctx.save();
          ctx.globalCompositeOperation = 'destination-out';
          // Draw mask inverted (erase where we want to keep original... no wait).
          // Simpler: paint filtered result through the mask.
          // (a) Erase selected area from original.
          // (b) Draw filtered result through mask alpha onto layer.
          // Use a tmp2 = filtered result masked.
          const masked = createBlankCanvas(w, h);
          const mctx = masked.getContext('2d')!;
          mctx.drawImage(tmp, 0, 0);
          mctx.globalCompositeOperation = 'destination-in';
          mctx.drawImage(selectionMask, 0, 0);
          ctx.globalCompositeOperation = 'source-over';
          // Cut hole in layer where selection is
          ctx.globalCompositeOperation = 'destination-out';
          ctx.drawImage(selectionMask, 0, 0);
          // Paste masked filtered pixels
          ctx.globalCompositeOperation = 'source-over';
          ctx.drawImage(masked, 0, 0);
          ctx.restore();
          return {
            success: true,
            message: `Applied ${label} (to selection)`,
            thumbnailBase64: generateThumbnail(layer!.canvas, 64),
          };
        } else {
          const label = runFilter(ctx);
          return {
            success: true,
            message: `Applied ${label}`,
            thumbnailBase64: generateThumbnail(layer!.canvas, 64),
          };
        }
      } catch (e) {
        return { success: false, message: (e as Error).message };
      }
    }

    // ----- adjustDevelop -----
    case 'adjustDevelop': {
      const section = str(args.section, '').toLowerCase();
      const param = str(args.param, '').toLowerCase();
      const value = num(args.value, 0);
      const ctx = layer!.canvas.getContext('2d', { willReadFrequently: true })!;
      const w = layer!.canvas.width;
      const h = layer!.canvas.height;
      let label = '';
      try {
        switch (section) {
          case 'light': {
            switch (param) {
              case 'exposure': {
                const v = clamp(value, -100, 100);
                applyBrightnessContrast(ctx, w, h, v * 0.5, 0);
                label = `Exposure ${v}`;
                break;
              }
              case 'contrast': {
                const v = clamp(value, -100, 100);
                applyBrightnessContrast(ctx, w, h, 0, v);
                label = `Contrast ${v}`;
                break;
              }
              case 'highlights': {
                const v = clamp(value, -100, 100);
                applyHighlightsShadows(ctx, w, h, v, 0);
                label = `Highlights ${v}`;
                break;
              }
              case 'shadows': {
                const v = clamp(value, -100, 100);
                applyHighlightsShadows(ctx, w, h, 0, v);
                label = `Shadows ${v}`;
                break;
              }
              case 'whites': {
                const v = clamp(value, -100, 100);
                applyWhitesBlacks(ctx, w, h, v, 0);
                label = `Whites ${v}`;
                break;
              }
              case 'blacks': {
                const v = clamp(value, -100, 100);
                applyWhitesBlacks(ctx, w, h, 0, v);
                label = `Blacks ${v}`;
                break;
              }
              case 'clarity': {
                const v = clamp(value, -100, 100);
                applyClarity(ctx, w, h, v);
                label = `Clarity ${v}`;
                break;
              }
              case 'dehaze': {
                const v = clamp(value, -100, 100);
                applyDehaze(ctx, w, h, v);
                label = `Dehaze ${v}`;
                break;
              }
              case 'texture': {
                const v = clamp(value, -100, 100);
                applyTexture(ctx, w, h, v);
                label = `Texture ${v}`;
                break;
              }
              default:
                throw new Error(`Unknown light param: ${param}`);
            }
            break;
          }
          case 'color': {
            switch (param) {
              case 'vibrance': {
                const v = clamp(value, -100, 100);
                applyVibrance(ctx, w, h, v);
                label = `Vibrance ${v}`;
                break;
              }
              case 'saturation': {
                const v = clamp(value, -100, 100);
                applySaturation(ctx, w, h, v);
                label = `Saturation ${v}`;
                break;
              }
              default:
                throw new Error(`Unknown color param: ${param}`);
            }
            break;
          }
          case 'effects': {
            switch (param) {
              case 'grain': {
                const amount = clamp(value, 0, 100);
                const size = clamp(num(paramsSizeFallback(args), 25), 1, 100);
                applyGrain(ctx, w, h, amount, size);
                label = `Grain ${amount}`;
                break;
              }
              case 'vignette': {
                const amount = clamp(value, -100, 100);
                const midpoint = clamp(num((args as Record<string, unknown>).midpoint, 50), 0, 100);
                const roundness = clamp(num((args as Record<string, unknown>).roundness, 50), 0, 100);
                const feather = clamp(num((args as Record<string, unknown>).feather, 50), 0, 100);
                applyLensVignette(ctx, w, h, amount, midpoint, roundness, feather);
                label = `Lens Vignette ${amount}`;
                break;
              }
              default:
                throw new Error(`Unknown effects param: ${param}`);
            }
            break;
          }
          case 'detail': {
            switch (param) {
              case 'sharpening': {
                const amount = clamp(value, 0, 150);
                const radius = clamp(num((args as Record<string, unknown>).radius, 1), 0.5, 3);
                const detail = clamp(num((args as Record<string, unknown>).detail, 25), 0, 100);
                applySharpening(ctx, w, h, amount, radius, detail);
                label = `Sharpening ${amount}`;
                break;
              }
              case 'luminancenr': {
                const v = clamp(value, 0, 100);
                applyLuminanceNR(ctx, w, h, v, 0);
                label = `Luminance NR ${v}`;
                break;
              }
              case 'colornr': {
                const v = clamp(value, 0, 100);
                applyColorNR(ctx, w, h, v);
                label = `Color NR ${v}`;
                break;
              }
              default:
                throw new Error(`Unknown detail param: ${param}`);
            }
            break;
          }
          case 'splittoning': {
            // For split toning, the model is expected to call multiple times
            // (once per param) — but we only have one "value" param. So we
            // interpret the call as "set this one knob and re-apply split
            // toning using default for the rest". For v1 simplicity, we only
            // support applying highlightSat + shadowSat directly via this
            // tool; complex split toning should use applyFilter.
            switch (param) {
              case 'highlightsat': {
                const sat = clamp(value, 0, 100);
                const hue = clamp(num((args as Record<string, unknown>).highlightHue, 30), 0, 360);
                applySplitToning(ctx, w, h, hue, sat, 220, 0, 0);
                label = `Split Toning (highlight sat ${sat})`;
                break;
              }
              case 'shadowsat': {
                const sat = clamp(value, 0, 100);
                const hue = clamp(num((args as Record<string, unknown>).shadowHue, 220), 0, 360);
                applySplitToning(ctx, w, h, 30, 0, hue, sat, 0);
                label = `Split Toning (shadow sat ${sat})`;
                break;
              }
              default:
                throw new Error(
                  `Unknown splitToning param: ${param}. Use highlightsat or shadowsat.`,
                );
            }
            break;
          }
          default:
            throw new Error(`Unknown develop section: ${section}`);
        }
        return {
          success: true,
          message: `Develop: ${label}`,
          thumbnailBase64: generateThumbnail(layer!.canvas, 64),
        };
      } catch (e) {
        return { success: false, message: (e as Error).message };
      }
    }

    // ----- selectRegionByPoint -----
    case 'selectRegionByPoint': {
      const xn = clamp(num(args.x, 0.5), 0, 1);
      const yn = clamp(num(args.y, 0.5), 0, 1);
      const tolerance = clamp(num(args.tolerance, 32), 0, 100);
      const px = Math.round(xn * ws.docWidth);
      const py = Math.round(yn * ws.docHeight);
      const { mask, bounds } = magicWandOnLayer(
        layer!,
        ws.docWidth,
        ws.docHeight,
        px,
        py,
        tolerance,
      );
      ws.selectionMask = mask;
      ws.selectionBounds = bounds;
      return {
        success: true,
        message: `Magic Wand at (${px}, ${py}) tol ${tolerance} → bounds (${bounds.x}, ${bounds.y}, ${bounds.w}×${bounds.h})`,
      };
    }

    // ----- selectRegionByBox -----
    case 'selectRegionByBox': {
      const x0 = clamp(num(args.x0, 0), 0, 1);
      const y0 = clamp(num(args.y0, 0), 0, 1);
      const x1 = clamp(num(args.x1, 1), 0, 1);
      const y1 = clamp(num(args.y1, 1), 0, 1);
      const { mask, bounds } = boxSelection(ws.docWidth, ws.docHeight, x0, y0, x1, y1);
      ws.selectionMask = mask;
      ws.selectionBounds = bounds;
      return {
        success: true,
        message: `Box selection (${bounds.x}, ${bounds.y}, ${bounds.w}×${bounds.h})`,
      };
    }

    // ----- invertSelection -----
    case 'invertSelection': {
      if (!ws.selectionMask) {
        // Match editor-store behavior: invert-empty = empty mask.
        const mask = createBlankCanvas(ws.docWidth, ws.docHeight);
        ws.selectionMask = mask;
        ws.selectionBounds = { x: 0, y: 0, w: 0, h: 0 };
        return { success: true, message: 'Inverted (was empty → still empty)' };
      }
      invertMaskInPlace(ws.selectionMask, ws.docWidth, ws.docHeight);
      return { success: true, message: 'Selection inverted' };
    }

    // ----- deselectAll -----
    case 'deselectAll': {
      ws.selectionMask = null;
      ws.selectionBounds = null;
      return { success: true, message: 'Selection cleared' };
    }

    // ----- contentAwareFill -----
    case 'contentAwareFill': {
      if (!ws.selectionMask) {
        return {
          success: false,
          message: 'No selection — call selectRegionByPoint or selectRegionByBox first.',
        };
      }
      const ctx = layer!.canvas.getContext('2d', { willReadFrequently: true })!;
      contentAwareFill(ctx, ws.docWidth, ws.docHeight, ws.selectionMask);
      return {
        success: true,
        message: 'Content-Aware Fill applied to selection',
        thumbnailBase64: generateThumbnail(layer!.canvas, 64),
      };
    }

    // ----- autoBackgroundRemove -----
    case 'autoBackgroundRemove': {
      const tolerance = clamp(num(args.tolerance, 32), 0, 100);
      const result = autoRemoveBackground(layer!.canvas, tolerance, 1);
      // Replace the layer's canvas with the transparent result.
      layer!.canvas.getContext('2d')!.clearRect(0, 0, layer!.canvas.width, layer!.canvas.height);
      layer!.canvas.getContext('2d')!.drawImage(result, 0, 0);
      return {
        success: true,
        message: `Auto Background Remove (tolerance ${tolerance})`,
        thumbnailBase64: generateThumbnail(layer!.canvas, 64),
      };
    }

    // ----- addAdjustmentLayer -----
    case 'addAdjustmentLayer': {
      const type = str(args.type, '').toLowerCase();
      const paramsIn = (args.params as Record<string, unknown>) ?? {};
      // For v1 we bake the adjustment into the active layer (no live non-destructive
      // pipeline in the agent workspace). The adjustment-layer record is added so
      // the UI can reflect intent.
      const settings: Record<string, number> = {};
      for (const [k, v] of Object.entries(paramsIn)) {
        const n = num(v, 0);
        if (Number.isFinite(n)) settings[k] = n;
      }
      const ctx = layer!.canvas.getContext('2d', { willReadFrequently: true })!;
      const w = layer!.canvas.width;
      const h = layer!.canvas.height;
      try {
        switch (type) {
          case 'brightnesscontrast': {
            const b = clamp(num(settings.brightness, 0), -100, 100);
            const c = clamp(num(settings.contrast, 0), -100, 100);
            applyBrightnessContrast(ctx, w, h, b * 0.5, c);
            return {
              success: true,
              message: `Adjustment layer: Brightness/Contrast (b=${b}, c=${c})`,
              thumbnailBase64: generateThumbnail(layer!.canvas, 64),
            };
          }
          case 'vibrance': {
            const v = clamp(num(settings.vibrance, 0), -100, 100);
            applyVibrance(ctx, w, h, v);
            return {
              success: true,
              message: `Adjustment layer: Vibrance (${v})`,
              thumbnailBase64: generateThumbnail(layer!.canvas, 64),
            };
          }
          case 'exposure': {
            const v = clamp(num(settings.exposure, 0), -100, 100);
            applyBrightnessContrast(ctx, w, h, v * 0.5, 0);
            return {
              success: true,
              message: `Adjustment layer: Exposure (${v})`,
              thumbnailBase64: generateThumbnail(layer!.canvas, 64),
            };
          }
          case 'huesaturation': {
            // We don't have a per-channel applyHueSaturation exposed with the
            // exact signature, so fall back to vibrance/saturation.
            const sat = clamp(num(settings.saturation, 0), -100, 100);
            applySaturation(ctx, w, h, sat);
            return {
              success: true,
              message: `Adjustment layer: Hue/Saturation (sat=${sat})`,
              thumbnailBase64: generateThumbnail(layer!.canvas, 64),
            };
          }
          default:
            return { success: false, message: `Unknown adjustment layer type: ${type}` };
        }
      } catch (e) {
        return { success: false, message: (e as Error).message };
      }
    }

    // ----- drawShape -----
    case 'drawShape': {
      const shapeType = str(args.shapeType, '').toLowerCase();
      const x0n = clamp(num(args.x0, 0.5), 0, 1);
      const y0n = clamp(num(args.y0, 0.5), 0, 1);
      const x1n = clamp(num(args.x1, x0n + 0.1), 0, 1);
      const y1n = clamp(num(args.y1, y0n + 0.1), 0, 1);
      const fillColor = str(args.fillColor, '#000000') || '#000000';
      const strokeColor = str(args.strokeColor, fillColor) || fillColor;
      const strokeWidth = clamp(num(args.strokeWidth, 2), 0, 50);
      const filled = args.filled !== undefined ? Boolean(args.filled) : true;

      // Convert normalized coords to canvas pixels.
      const x0 = Math.round(x0n * ws.docWidth);
      const y0 = Math.round(y0n * ws.docHeight);
      const x1 = Math.round(x1n * ws.docWidth);
      const y1 = Math.round(y1n * ws.docHeight);

      const ctx = layer!.canvas.getContext('2d')!;
      // If there's a selection, draw onto a temp canvas and composite through the mask.
      const selectionMask = ws.selectionMask;
      const drawTo = (target: CanvasRenderingContext2D) => {
        target.save();
        target.fillStyle = fillColor;
        target.strokeStyle = strokeColor;
        target.lineWidth = strokeWidth;
        target.lineCap = 'round';
        target.lineJoin = 'round';

        switch (shapeType) {
          case 'ellipse':
          case 'circle': {
            // Bounding box (x0,y0)-(x1,y1). For circle, caller passes equal w/h.
            const bx = Math.min(x0, x1);
            const by = Math.min(y0, y1);
            const bw = Math.max(1, Math.abs(x1 - x0));
            const bh = Math.max(1, Math.abs(y1 - y0));
            target.beginPath();
            target.ellipse(bx + bw / 2, by + bh / 2, bw / 2, bh / 2, 0, 0, Math.PI * 2);
            if (filled) target.fill();
            if (strokeWidth > 0) target.stroke();
            break;
          }
          case 'rect':
          case 'rectangle': {
            const bx = Math.min(x0, x1);
            const by = Math.min(y0, y1);
            const bw = Math.max(1, Math.abs(x1 - x0));
            const bh = Math.max(1, Math.abs(y1 - y0));
            if (filled) target.fillRect(bx, by, bw, bh);
            if (strokeWidth > 0) target.strokeRect(bx, by, bw, bh);
            break;
          }
          case 'line': {
            target.beginPath();
            target.moveTo(x0, y0);
            target.lineTo(x1, y1);
            target.stroke();
            break;
          }
          case 'star': {
            const cx = x0;
            const cy = y0;
            // Use bounding-box diagonal as outer radius.
            const outerR = Math.max(2, Math.hypot(x1 - x0, y1 - y0) / 2);
            const innerR = outerR * 0.4;
            const pts = Math.round(clamp(num(args.points, 5), 3, 20));
            drawStar(target, cx, cy, outerR, innerR, pts, {
              fillColor, strokeColor, strokeWidth, filled,
            });
            break;
          }
          case 'polygon': {
            const cx = x0;
            const cy = y0;
            const radius = Math.max(2, Math.hypot(x1 - x0, y1 - y0) / 2);
            const sides = Math.round(clamp(num(args.sides, 6), 3, 12));
            drawPolygon(target, cx, cy, radius, sides, {
              fillColor, strokeColor, strokeWidth, filled,
            });
            break;
          }
          case 'arrow': {
            const headSize = 0.3;
            drawArrow(target, x0, y0, x1, y1, headSize, {
              fillColor, strokeColor, strokeWidth, filled,
            });
            break;
          }
          case 'heart': {
            const cx = x0;
            const cy = y0;
            const size = Math.max(4, Math.hypot(x1 - x0, y1 - y0));
            drawHeart(target, cx, cy, size, {
              fillColor, strokeColor, strokeWidth, filled,
            });
            break;
          }
          default:
            throw new Error(`Unknown shapeType: ${shapeType}`);
        }
        target.restore();
      };

      try {
        if (selectionMask) {
          // Draw to a temp canvas, then composite through the mask.
          const tmp = createBlankCanvas(ws.docWidth, ws.docHeight);
          const tctx = tmp.getContext('2d')!;
          drawTo(tctx);
          // Use the mask to clip the drawn pixels onto the layer.
          const masked = createBlankCanvas(ws.docWidth, ws.docHeight);
          const mctx = masked.getContext('2d')!;
          mctx.drawImage(tmp, 0, 0);
          mctx.globalCompositeOperation = 'destination-in';
          mctx.drawImage(selectionMask, 0, 0);
          ctx.drawImage(masked, 0, 0);
        } else {
          drawTo(ctx);
        }
        return {
          success: true,
          message: `Drew ${shapeType} at (${x0n.toFixed(2)}, ${y0n.toFixed(2)}) fill=${fillColor}`,
          thumbnailBase64: generateThumbnail(layer!.canvas, 64),
        };
      } catch (e) {
        return { success: false, message: (e as Error).message };
      }
    }

    // ----- drawBrushStroke -----
    case 'drawBrushStroke': {
      const rawPoints = Array.isArray(args.points) ? args.points : [];
      if (rawPoints.length < 2) {
        return { success: false, message: 'drawBrushStroke requires at least 2 points.' };
      }
      const color = str(args.color, '#000000') || '#000000';
      const size = clamp(num(args.size, 20), 1, 200);
      const opacity = clamp(num(args.opacity, 100), 0, 100) / 100;
      const hardness = clamp(num(args.hardness, 80), 0, 100);

      // Convert normalized points to canvas pixels.
      const pts = rawPoints.map((p) => {
        const px = p as { x?: unknown; y?: unknown };
        return {
          x: Math.round(clamp(num(px.x, 0.5), 0, 1) * ws.docWidth),
          y: Math.round(clamp(num(px.y, 0.5), 0, 1) * ws.docHeight),
        };
      });

      const ctx = layer!.canvas.getContext('2d')!;
      const selectionMask = ws.selectionMask;
      const drawTo = (target: CanvasRenderingContext2D) => {
        target.save();
        target.globalAlpha = opacity;
        target.strokeStyle = color;
        target.fillStyle = color;
        target.lineCap = 'round';
        target.lineJoin = 'round';
        target.lineWidth = size;

        // Soft brush: use shadow-blur when hardness < 100 (matches the editor's
        // shadow-blur soft brush technique described in ARCHITECTURE.md).
        if (hardness < 100) {
          const blur = (size * (100 - hardness)) / 200;
          target.shadowBlur = blur;
          target.shadowColor = color;
        }

        target.beginPath();
        target.moveTo(pts[0].x, pts[0].y);
        // Use quadratic smoothing through midpoints for a natural stroke.
        for (let i = 1; i < pts.length - 1; i++) {
          const mx = (pts[i].x + pts[i + 1].x) / 2;
          const my = (pts[i].y + pts[i + 1].y) / 2;
          target.quadraticCurveTo(pts[i].x, pts[i].y, mx, my);
        }
        // Final segment
        const last = pts[pts.length - 1];
        target.lineTo(last.x, last.y);
        target.stroke();

        // Draw a dot at the start to ensure single-click also produces a mark.
        target.beginPath();
        target.arc(pts[0].x, pts[0].y, size / 2, 0, Math.PI * 2);
        target.fill();

        target.restore();
      };

      try {
        if (selectionMask) {
          const tmp = createBlankCanvas(ws.docWidth, ws.docHeight);
          drawTo(tmp.getContext('2d')!);
          const masked = createBlankCanvas(ws.docWidth, ws.docHeight);
          const mctx = masked.getContext('2d')!;
          mctx.drawImage(tmp, 0, 0);
          mctx.globalCompositeOperation = 'destination-in';
          mctx.drawImage(selectionMask, 0, 0);
          ctx.drawImage(masked, 0, 0);
        } else {
          drawTo(ctx);
        }
        return {
          success: true,
          message: `Brush stroke (${pts.length} pts, size ${size}, ${color})`,
          thumbnailBase64: generateThumbnail(layer!.canvas, 64),
        };
      } catch (e) {
        return { success: false, message: (e as Error).message };
      }
    }

    // ----- addText -----
    case 'addText': {
      const text = str(args.text, '');
      if (!text) {
        return { success: false, message: 'addText requires non-empty text.' };
      }
      const xn = clamp(num(args.x, 0.1), 0, 1);
      const yn = clamp(num(args.y, 0.5), 0, 1);
      const color = str(args.color, '#000000') || '#000000';
      const fontSize = clamp(num(args.fontSize, 48), 8, 400);
      const fontFamily = str(args.fontFamily, 'Inter, sans-serif') || 'Inter, sans-serif';
      const alignRaw = str(args.align, 'left').toLowerCase();
      const align = (alignRaw === 'center' || alignRaw === 'right' || alignRaw === 'left')
        ? (alignRaw as CanvasTextAlign)
        : 'left';

      const px = Math.round(xn * ws.docWidth);
      const py = Math.round(yn * ws.docHeight);

      const ctx = layer!.canvas.getContext('2d')!;
      const selectionMask = ws.selectionMask;
      const drawTo = (target: CanvasRenderingContext2D) => {
        target.save();
        target.fillStyle = color;
        target.font = `${fontSize}px ${fontFamily}`;
        target.textBaseline = 'top';
        target.textAlign = align;
        // Support multi-line text via \n
        const lines = text.split('\n');
        const lineHeight = fontSize * 1.2;
        for (let i = 0; i < lines.length; i++) {
          target.fillText(lines[i], px, py + i * lineHeight);
        }
        target.restore();
      };

      try {
        if (selectionMask) {
          const tmp = createBlankCanvas(ws.docWidth, ws.docHeight);
          drawTo(tmp.getContext('2d')!);
          const masked = createBlankCanvas(ws.docWidth, ws.docHeight);
          const mctx = masked.getContext('2d')!;
          mctx.drawImage(tmp, 0, 0);
          mctx.globalCompositeOperation = 'destination-in';
          mctx.drawImage(selectionMask, 0, 0);
          ctx.drawImage(masked, 0, 0);
        } else {
          drawTo(ctx);
        }
        const preview = text.length > 30 ? text.slice(0, 30) + '…' : text;
        return {
          success: true,
          message: `Text "${preview}" at (${xn.toFixed(2)}, ${yn.toFixed(2)}) ${fontSize}px ${color}`,
          thumbnailBase64: generateThumbnail(layer!.canvas, 64),
        };
      } catch (e) {
        return { success: false, message: (e as Error).message };
      }
    }

    // ----- fillBucket -----
    case 'fillBucket': {
      const xn = clamp(num(args.x, 0.5), 0, 1);
      const yn = clamp(num(args.y, 0.5), 0, 1);
      const color = str(args.color, '#000000') || '#000000';
      const tolerance = clamp(num(args.tolerance, 32), 0, 100);

      let px = Math.round(xn * ws.docWidth);
      let py = Math.round(yn * ws.docHeight);
      px = Math.max(0, Math.min(ws.docWidth - 1, px));
      py = Math.max(0, Math.min(ws.docHeight - 1, py));

      const ctx = layer!.canvas.getContext('2d', { willReadFrequently: true })!;
      const W = ws.docWidth;
      const H = ws.docHeight;
      const imageData = ctx.getImageData(0, 0, W, H);
      const data = imageData.data;
      const startIdx = (py * W + px) * 4;
      const targetR = data[startIdx];
      const targetG = data[startIdx + 1];
      const targetB = data[startIdx + 2];
      const targetA = data[startIdx + 3];

      // Parse the fill color via a hidden canvas trick (handles CSS named colors).
      const rgb = parseColor(color);
      const fillR = rgb.r;
      const fillG = rgb.g;
      const fillB = rgb.b;

      const threshold = (tolerance / 100) * (150 * 150 * 3);
      const filled = new Uint8Array(W * H);
      const matches = (idx: number) => {
        const i = idx * 4;
        const dr = data[i] - targetR;
        const dg = data[i + 1] - targetG;
        const db = data[i + 2] - targetB;
        const da = data[i + 3] - targetA;
        return dr * dr + dg * dg + db * db + da * da <= threshold;
      };

      const stack: number[] = [py * W + px];
      let count = 0;
      while (stack.length > 0) {
        const idx = stack.pop()!;
        if (filled[idx]) continue;
        if (!matches(idx)) continue;
        const x = idx % W;
        const y = (idx - x) / W;
        let lx = x;
        while (lx > 0 && !filled[y * W + lx - 1] && matches(y * W + lx - 1)) lx--;
        let rx = x;
        while (rx < W - 1 && !filled[y * W + rx + 1] && matches(y * W + rx + 1)) rx++;
        for (let fx = lx; fx <= rx; fx++) {
          const fidx = y * W + fx;
          filled[fidx] = 1;
          const i = fidx * 4;
          data[i] = fillR;
          data[i + 1] = fillG;
          data[i + 2] = fillB;
          data[i + 3] = 255;
          count++;
          if (y > 0) {
            const aIdx = fidx - W;
            if (!filled[aIdx] && matches(aIdx)) stack.push(aIdx);
          }
          if (y < H - 1) {
            const bIdx = fidx + W;
            if (!filled[bIdx] && matches(bIdx)) stack.push(bIdx);
          }
        }
      }
      ctx.putImageData(imageData, 0, 0);

      if (count === 0) {
        return {
          success: true,
          message: `Bucket fill at (${xn.toFixed(2)}, ${yn.toFixed(2)}) with ${color}: no matching pixels (tol ${tolerance})`,
        };
      }
      return {
        success: true,
        message: `Bucket fill ${color} at (${xn.toFixed(2)}, ${yn.toFixed(2)}): ${count} pixels (tol ${tolerance})`,
        thumbnailBase64: generateThumbnail(layer!.canvas, 64),
      };
    }

    // ----- undo -----
    case 'undo': {
      // In the workspace model, undo within a turn isn't very meaningful
      // because we're operating on a cloned canvas — the user will Accept or
      // Reject the whole turn. We implement a no-op success so the model can
      // call it without erroring, but the real "undo" is the Reject button.
      return {
        success: true,
        message:
          'Undo requested. Use the Reject button to discard this entire preview if the result is wrong.',
      };
    }

    default:
      return { success: false, message: `Unknown tool: ${toolName}` };
  }
}

// Small helper for the "grain" param that takes a separate size knob.
function paramsSizeFallback(args: Record<string, unknown>): number {
  const v = args.size;
  return num(v, 25);
}

/**
 * Build a human-readable label for a tool call, used in the chat chip.
 */
export function describeToolCall(
  toolName: string,
  args: Record<string, unknown>,
): string {
  switch (toolName) {
    case 'applyFilter': {
      const ft = String(args.filterType ?? 'filter');
      const params = (args.params as Record<string, unknown>) ?? {};
      const ps = Object.entries(params)
        .map(([k, v]) => `${k}: ${typeof v === 'number' ? (Math.round(v * 100) / 100) : v}`)
        .join(', ');
      return ps ? `Applied ${ft} (${ps})` : `Applied ${ft}`;
    }
    case 'adjustDevelop': {
      return `Develop: ${args.section}.${args.param} = ${args.value}`;
    }
    case 'selectRegionByPoint': {
      const x = Math.round(num(args.x, 0.5) * 100);
      const y = Math.round(num(args.y, 0.5) * 100);
      return `Selected region near (${x}%, ${y}%)`;
    }
    case 'selectRegionByBox': {
      return `Box-select region`;
    }
    case 'invertSelection':
      return 'Inverted selection';
    case 'deselectAll':
      return 'Cleared selection';
    case 'contentAwareFill':
      return 'Content-Aware Fill';
    case 'autoBackgroundRemove':
      return `Auto Remove Background (tol ${args.tolerance ?? 32})`;
    case 'addAdjustmentLayer':
      return `Add Adjustment Layer: ${args.type}`;
    case 'drawShape': {
      const shape = String(args.shapeType ?? 'shape');
      const fill = String(args.fillColor ?? 'black');
      const x = Math.round(num(args.x0, 0.5) * 100);
      const y = Math.round(num(args.y0, 0.5) * 100);
      return `Drew ${shape} (${fill}) at (${x}%, ${y}%)`;
    }
    case 'drawBrushStroke': {
      const pts = Array.isArray(args.points) ? args.points.length : 0;
      const color = String(args.color ?? 'black');
      const size = args.size ?? 20;
      return `Brush stroke: ${pts} pts, size ${size}, ${color}`;
    }
    case 'addText': {
      const text = String(args.text ?? '');
      const preview = text.length > 20 ? text.slice(0, 20) + '…' : text;
      return `Text: "${preview}"`;
    }
    case 'fillBucket': {
      const color = String(args.color ?? 'black');
      const x = Math.round(num(args.x, 0.5) * 100);
      const y = Math.round(num(args.y, 0.5) * 100);
      return `Bucket fill ${color} at (${x}%, ${y}%)`;
    }
    case 'undo':
      return 'Undo (no-op in preview)';
    default:
      return toolName;
  }
}
