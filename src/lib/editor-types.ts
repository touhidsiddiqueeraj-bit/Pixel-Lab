// Type definitions for the Photoshop clone editor

export type ToolType =
  | 'move'
  | 'marquee-rect'
  | 'marquee-ellipse'
  | 'lasso'
  | 'polygonal-lasso'
  | 'magnetic-lasso'
  | 'magic-wand'
  | 'crop'
  | 'eyedropper'
  | 'brush'
  | 'pencil'
  | 'eraser'
  | 'bucket'
  | 'gradient'
  | 'text'
  | 'shape-rect'
  | 'shape-ellipse'
  | 'shape-line'
  | 'shape-star'
  | 'shape-polygon'
  | 'shape-arrow'
  | 'shape-heart'
  | 'shape-speech-bubble'
  | 'shape-spiral'
  | 'clone-stamp'
  | 'heal-brush'
  | 'blob-brush'
  | 'smooth-tool'
  | 'width-tool'
  | 'calligraphy-brush'
  | 'scatter-brush'
  | 'pen'
  | 'curvature-pen'
  | 'liquify-push'
  | 'liquify-pucker'
  | 'liquify-bloat'
  | 'liquify-twirl'
  | 'hand'
  | 'zoom';

export type BlendMode =
  | 'source-over'
  | 'multiply'
  | 'screen'
  | 'overlay'
  | 'darken'
  | 'lighten'
  | 'color-dodge'
  | 'color-burn'
  | 'hard-light'
  | 'soft-light'
  | 'difference'
  | 'exclusion'
  | 'hue'
  | 'saturation'
  | 'color'
  | 'luminosity';

export interface LayerData {
  id: string;
  name: string;
  visible: boolean;
  opacity: number; // 0 to 1
  blendMode: BlendMode;
  locked: boolean;
  // Offscreen canvas storing this layer's pixels (relative to document origin)
  canvas: HTMLCanvasElement;
  thumbnail: string; // data URL thumbnail for panel
  // Layer mask (white = visible, black = hidden). Null = no mask.
  maskCanvas: HTMLCanvasElement | null;
  maskEnabled: boolean;
}

export interface Selection {
  // Mask canvas (same size as document). White = selected, black = not selected.
  // If null, no selection (everything selected).
  mask: HTMLCanvasElement | null;
  bounds: { x: number; y: number; w: number; h: number } | null;
}

export interface HistoryEntry {
  id: string;
  label: string;
  // Snapshot of layers: array of { id, name, visible, opacity, blendMode, locked, dataUrl }
  layers: LayerSnapshot[];
  activeLayerId: string | null;
  // Document dimensions at the time this entry was created. Needed so that
  // undoing a Crop (which changes docWidth/docHeight) restores the original
  // dimensions and the layer canvases are created at the right size.
  docWidth?: number;
  docHeight?: number;
}

export interface ToolOptions {
  brushSize: number;
  brushHardness: number; // 0-100
  brushOpacity: number; // 0-100
  brushSpacing: number; // 0-100, distance between stamps
  brushStabilizer: number; // 0-100, stroke smoothing strength
  tolerance: number; // 0-255 for magic wand & bucket
  fontSize: number;
  fontFamily: string;
  shapeFilled: boolean;
  shapeStrokeWidth: number;
  shapeSides: number; // for polygon (3-12)
  shapeStarPoints: number; // for star (3-20)
  shapeStarInnerRatio: number; // 0-1, inner radius ratio
  shapeArrowHeadSize: number; // 0-1
  shapeSpiralTurns: number; // number of turns
  zoomLevel: number;
  liquifyStrength: number; // 0-100
  symmetryMode: 'none' | 'horizontal' | 'vertical' | 'quad' | 'mandala';
  symmetrySegments: number; // for mandala mode, 2-12
  calligraphyAngle: number; // 0-360 degrees
  scatterCount: number; // number of shapes per stroke
  scatterSize: number; // 0.1-3.0 scale
  smoothStrength: number; // 0-100
  blobMerge: boolean; // blob brush merges overlapping strokes
}

export interface LayerSnapshot {
  id: string;
  name: string;
  visible: boolean;
  opacity: number;
  blendMode: BlendMode;
  locked: boolean;
  dataUrl: string;
  maskDataUrl: string | null;
  maskEnabled: boolean;
}

export const BLEND_MODES: { value: BlendMode; label: string }[] = [
  { value: 'source-over', label: 'Normal' },
  { value: 'multiply', label: 'Multiply' },
  { value: 'screen', label: 'Screen' },
  { value: 'overlay', label: 'Overlay' },
  { value: 'darken', label: 'Darken' },
  { value: 'lighten', label: 'Lighten' },
  { value: 'color-dodge', label: 'Color Dodge' },
  { value: 'color-burn', label: 'Color Burn' },
  { value: 'hard-light', label: 'Hard Light' },
  { value: 'soft-light', label: 'Soft Light' },
  { value: 'difference', label: 'Difference' },
  { value: 'exclusion', label: 'Exclusion' },
  { value: 'hue', label: 'Hue' },
  { value: 'saturation', label: 'Saturation' },
  { value: 'color', label: 'Color' },
  { value: 'luminosity', label: 'Luminosity' },
];
