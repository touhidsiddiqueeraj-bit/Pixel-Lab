# Architecture

This document describes the system design, data flow, and technical implementation of Pixel Lab.

## Overview

Pixel Lab is a client-side image editor built on Next.js 16 with TypeScript. All image processing happens in the browser using the HTML5 Canvas API — there is no server-side image processing. The application uses a Zustand store for state management and a custom canvas rendering engine for the editor.

```
┌─────────────────────────────────────────────────────────────┐
│                    Browser (Client-side)                     │
│  ┌───────────────────────────────────────────────────────┐  │
│  │              React Component Tree                      │  │
│  │  ┌─────────────┐  ┌──────────────┐  ┌──────────────┐ │  │
│  │  │  Toolbar    │  │ EditorCanvas │  │   Panels     │ │  │
│  │  │  (tools)    │  │  (rendering) │  │ (Layers etc) │ │  │
│  │  └──────┬──────┘  └──────┬───────┘  └──────┬───────┘ │  │
│  │         │                │                  │         │  │
│  │         └────────────────┼──────────────────┘         │  │
│  │                          ▼                             │  │
│  │              ┌───────────────────────┐                 │  │
│  │              │   Zustand Store       │                 │  │
│  │              │   (editor-store.ts)   │                 │  │
│  │              └───────────┬───────────┘                 │  │
│  │                          │                             │  │
│  │  ┌───────────────────────▼──────────────────────────┐  │  │
│  │  │          Canvas Rendering Engine                  │  │  │
│  │  │  ┌─────────────┐  ┌─────────────┐  ┌──────────┐  │  │  │
│  │  │  │ Composite   │  │  Overlay    │  │  Layer   │  │  │  │
│  │  │  │ Canvas      │  │  Canvas     │  │  Canvases│  │  │  │
│  │  │  │ (visible)   │  │  (UI)       │  │  (data)  │  │  │  │
│  │  │  └─────────────┘  └─────────────┘  └──────────┘  │  │  │
│  │  └──────────────────────────────────────────────────┘  │  │
│  └───────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────┘
```

## Core Design Principles

1. **Client-side only** — All processing happens in the browser. No server roundtrips for editing operations.
2. **Canvas-based** — Each layer is an offscreen `<canvas>` element. The visible canvas is a composite of all layers.
3. **Non-destructive** — Layer masks, history snapshots, and adjustment layers preserve original data.
4. **Performance-first** — LUTs, scanline algorithms, and throttling keep operations fast.
5. **Responsive** — Mobile and desktop share the same codebase with adaptive UI.

## State Management

### Zustand Store (`editor-store.ts`)

The entire editor state lives in a single Zustand store. This avoids prop drilling and allows any component to read or update state.

```typescript
interface EditorState {
  // Document
  docWidth: number;
  docHeight: number;
  docName: string;

  // Layers (each layer has its own canvas)
  layers: LayerData[];
  activeLayerId: string | null;

  // Tool state
  activeTool: ToolType;
  toolOptions: ToolOptions;

  // Colors
  foregroundColor: string;
  backgroundColor: string;

  // Selection (mask canvas)
  selectionMask: HTMLCanvasElement | null;
  selectionBounds: { x, y, w, h } | null;

  // History (undo/redo)
  history: HistoryEntry[];
  historyIndex: number;

  // View
  zoom: number;
  panX: number;
  panY: number;

  // Guides & rulers
  guides: { x: number[]; y: number[] };
  showRulers: boolean;
  showGrid: boolean;

  // Performance
  perfSettings: PerfSettings;

  // Actions (95+ methods)
  // ...
}
```

### Layer Data Model

Each layer is represented by:

```typescript
interface LayerData {
  id: string;
  name: string;
  visible: boolean;
  opacity: number;          // 0 to 1
  blendMode: BlendMode;     // 16 modes
  locked: boolean;
  canvas: HTMLCanvasElement; // Offscreen canvas with pixel data
  thumbnail: string;         // Data URL for panel preview
  maskCanvas: HTMLCanvasElement | null; // Non-destructive mask
  maskEnabled: boolean;
}
```

### History System

History entries store serialized snapshots of all layers:

```typescript
interface HistoryEntry {
  id: string;
  label: string;
  timestamp: number;
  layers: LayerSnapshot[];
  activeLayerId: string | null;
}

interface LayerSnapshot {
  id: string;
  name: string;
  visible: boolean;
  opacity: number;
  blendMode: BlendMode;
  locked: boolean;
  dataUrl: string;        // JPEG (opaque) or PNG (transparent)
  maskDataUrl: string | null;
  maskEnabled: boolean;
}
```

**Memory optimization**: History snapshots use JPEG for opaque layers (5-10x smaller than PNG) and PNG only when alpha transparency is present. The history cap is configurable based on device performance tier (15/30/60 states).

## Canvas Rendering Engine

### Three-Canvas Architecture

```
┌─────────────────────────────────────────┐
│         Container (div)                  │
│  ┌───────────────────────────────────┐  │
│  │  Composite Canvas (visible)       │  │  ← User sees this
│  │  - Renders all visible layers     │  │
│  │  - Updated on every change        │  │
│  ├───────────────────────────────────┤  │
│  │  Overlay Canvas (UI)              │  │  ← Selection, guides, grid
│  │  - Marching ants, lasso preview   │  │
│  │  - Pen tool path, guides          │  │
│  │  - pointer-events: none           │  │
│  └───────────────────────────────────┘  │
│  ┌───────────────────────────────────┐  │
│  │  Layer Canvases (offscreen)       │  │  ← One per layer
│  │  - layer[0].canvas                │  │
│  │  - layer[1].canvas                │  │
│  │  - ...                            │  │
│  └───────────────────────────────────┘  │
└─────────────────────────────────────────┘
```

### Composite Rendering

The `composite()` function renders all visible layers onto the composite canvas:

```typescript
function composite() {
  // Only resize if dimensions changed (avoids GPU reallocation)
  if (canvas.width !== docWidth) canvas.width = docWidth;
  if (canvas.height !== docHeight) canvas.height = docHeight;
  ctx.clearRect(0, 0, docWidth, docHeight);

  for (const layer of layers) {
    if (!layer.visible) continue;
    ctx.globalAlpha = layer.opacity;
    ctx.globalCompositeOperation = layer.blendMode;

    if (layer.maskCanvas && layer.maskEnabled) {
      // Apply mask via destination-in compositing
      const tmp = createBlankCanvas(docWidth, docHeight);
      tmpCtx.drawImage(layer.canvas, 0, 0);
      tmpCtx.globalCompositeOperation = 'destination-in';
      tmpCtx.drawImage(layer.maskCanvas, 0, 0);
      ctx.drawImage(tmp, 0, 0);
    } else {
      ctx.drawImage(layer.canvas, 0, 0);
    }
  }
}
```

### Stroke Canvas (Brush/Pencil/Eraser)

Brush strokes use a temporary "stroke canvas" that accumulates the current stroke. This allows:
- Live preview during drawing
- Committing the stroke to the layer only on pointer-up
- Selection-aware clipping

```
Pointer Down → Clear stroke canvas → Draw segment
Pointer Move → Draw segment on stroke canvas → Preview on composite
Pointer Up   → Composite stroke canvas onto layer → Clear stroke canvas
```

## Tool Implementation

### Tool Categories

| Category | Tools | Implementation |
|----------|-------|----------------|
| Selection | Marquee, Lasso, Magic Wand | Creates `selectionMask` canvas |
| Painting | Brush, Pencil, Eraser | Stroke canvas + commit on pointer-up |
| Sampling | Clone Stamp, Healing Brush | Alt+Click sets source, then paint |
| Vector | Pen, Shapes, Text | Bezier paths, shape drawing, text rendering |
| Liquify | Push, Pucker, Bloat, Twirl | Pixel displacement with bilinear sampling |
| View | Hand, Zoom | Pan and zoom controls |

### Magic Wand / Bucket Fill (Scanline Flood Fill)

Both use an optimized scanline flood fill algorithm:

```typescript
// O(n) scanline fill — much faster than BFS with queue.shift()
const stack = [startIdx];
while (stack.length > 0) {
  const idx = stack.pop();
  if (filled[idx] || !matches(idx)) continue;

  // Find horizontal span [lx, rx]
  let lx = x; while (lx > 0 && !filled[...] && matches(...)) lx--;
  let rx = x; while (rx < W-1 && !filled[...] && matches(...)) rx++;

  // Fill span and push neighbors above/below
  for (let fx = lx; fx <= rx; fx++) {
    filled[y * W + fx] = 1;
    if (y > 0 && matches(idx - W)) stack.push(idx - W);
    if (y < H-1 && matches(idx + W)) stack.push(idx + W);
  }
}
```

### Symmetry Mode

Symmetry is implemented by mirroring the stroke canvas when committing:

```typescript
function commitStrokeToLayer() {
  const symmetryPoints = applySymmetry({ x: 0, y: 0 });
  for (const offset of symmetryPoints) {
    ctx.save();
    if (offset.x !== 0) {
      ctx.translate(docWidth, 0);
      ctx.scale(-1, 1);  // Mirror horizontally
    }
    ctx.drawImage(strokeCanvas, 0, 0);
    ctx.restore();
  }
}
```

Modes: None, Horizontal, Vertical, Quad (4-way), Mandala (rotational, 2-12 segments).

## Image Processing

### Filter Architecture

Filters operate directly on a layer's canvas context:

```typescript
function applyFilter(ctx: CanvasRenderingContext2D, w: number, h: number, ...) {
  const imageData = ctx.getImageData(0, 0, w, h);
  const data = imageData.data;
  // Process data...
  ctx.putImageData(imageData, 0, 0);
}
```

### LUT-Based Filters (Optimized)

Many filters use 256-entry lookup tables (LUTs) for O(1) per-pixel operations:

```typescript
function applyBrightnessContrast(ctx, w, h, brightness, contrast) {
  const lut = new Uint8Array(256);
  for (let i = 0; i < 256; i++) {
    lut[i] = clamp(i * contrastFactor + intercept + brightness);
  }
  // Single pass through pixels — no math, just array lookup
  for (let i = 0; i < data.length; i += 4) {
    data[i] = lut[data[i]];
    data[i + 1] = lut[data[i + 1]];
    data[i + 2] = lut[data[i + 2]];
  }
}
```

**Optimized filters**: Brightness/Contrast, Invert, Grayscale, Sepia, Threshold, Levels, Curves.

### Lightroom-Style Develop Adjustments

The Develop panel (`DevelopPanel.tsx`) provides Lightroom-style photo development controls via functions in `image-processing.ts`:

| Section | Functions | Description |
|---------|-----------|-------------|
| Light | `applyHighlightsShadows`, `applyWhitesBlacks`, `applyClarity`, `applyDehaze`, `applyTexture` | Selective tone adjustments targeting bright/dark/mid-tone pixels |
| Color | `applyVibrance`, `applySaturation` | Vibrance boosts less-saturated colors more; Saturation is uniform |
| Effects | `applyGrain`, `applyLensVignette` | Film grain with size control; lens vignette with midpoint/roundness/feather |
| Detail | `applySharpening`, `applyLuminanceNR`, `applyColorNR` | Sharpening with radius/detail; luminance & color noise reduction |
| Split Toning | `applySplitToning` | Different color tints for highlights vs shadows with balance control |

Key algorithms:
- **Highlights/Shadows**: Uses luminance-based masks — highlights only affect pixels above 50% brightness, shadows only affect pixels below 50%
- **Clarity**: Large-radius local contrast enhancement (blurred image deviation boost)
- **Texture**: Small-radius local contrast (fine detail enhancement)
- **Dehaze**: Combined contrast + saturation boost with slight darkening
- **Vibrance**: Saturation boost weighted by inverse of current saturation (less-saturated colors get more boost)
- **Split Toning**: Hue/saturation tinting with luminance-based masks for highlights and shadows

### Vectorization Pipeline

The vectorization process (`vectorize.ts`):

```
1. Color Quantization (Median Cut)
   ├── Sample pixels (5-bit per channel for performance)
   ├── Build color buckets
   └── Median cut to N colors (2-32)

2. Label Map Creation
   └── Map each pixel to nearest palette color

3. Connected Component Analysis
   ├── Flood fill to find regions
   └── Filter by minimum area (detail setting)

4. Boundary Tracing (Moore Neighborhood)
   └── Trace edge of each region

5. Path Simplification (Ramer-Douglas-Peucker)
   ├── Adaptive tolerance based on path size
   └── Handle closed paths (start ≈ end)

6. SVG Generation
   ├── Quadratic Bezier curves (smoothing > 30)
   └── Output as SVG string
```

## Performance System

### Device Tier Detection

```typescript
function detectPerfTier(): PerfTier {
  const cores = navigator.hardwareConcurrency || 4;
  const mem = navigator.deviceMemory || 4;
  const isMobile = /Android|iPhone|iPad/i.test(navigator.userAgent);

  if (isMobile || cores <= 2 || mem <= 2) return 'low';
  if (cores >= 8 && mem >= 8) return 'high';
  return 'medium';
}
```

### Performance Settings

| Setting | Low | Medium | High |
|---------|-----|--------|------|
| Max History States | 15 | 30 | 60 |
| Thumbnail Size | 32px | 48px | 64px |
| History JPEG Quality | 60% | 70% | 85% |
| Real-time Preview | Off | On | On |
| Offscreen Canvas | Off | On | On |
| Slider Debounce | 150ms | 50ms | 0ms |

### Optimizations Applied

1. **Scanline flood fill** — O(n) vs O(n²) for Magic Wand, Bucket Fill, Auto BG Remove
2. **LUT-based filters** — 256-entry tables for O(1) per-pixel operations
3. **Shadow-blur soft brush** — Single GPU-accelerated pass vs 8 alpha layers
4. **JPEG history snapshots** — 5-10x memory reduction for opaque layers
5. **Throttled marching ants** — 15fps instead of 60fps
6. **Cursor position optimization** — Only updates state when not drawing
7. **Composite canvas reuse** — Only resizes when dimensions change

## Responsive Design

### Breakpoint Strategy

- **Mobile** (< 768px): Hamburger menu, floating panel button, compact options bar
- **Desktop** (≥ 768px): Inline menu bar, side panels, full options bar

### Mobile Layout

```
┌─────────────────────────┐
│ ☰  ⚡ Pixel Lab  🎨 ⚙ │  ← Title bar with hamburger
├─────────────────────────┤
│ [Tool] [Options...]     │  ← Compact options bar
├─────────────────────────┤
│                         │
│      Canvas Area        │
│                         │
│                 ┌────┐  │
│                 │ 📊 │  │  ← Floating panel button
│                 └────┘  │
└─────────────────────────┘
```

## Theme System

### CSS Variables

Editor-specific CSS variables adapt to light/dark mode:

```css
:root {
  --editor-bg: oklch(0.98 0 0);
  --editor-surface: oklch(1 0 0);
  --editor-text: oklch(0.2 0 0);
  --editor-accent: oklch(0.55 0.18 240);
}

.dark {
  --editor-bg: oklch(0.145 0 0);
  --editor-surface: oklch(0.185 0 0);
  --editor-text: oklch(0.95 0 0);
  --editor-accent: oklch(0.65 0.18 240);
}
```

### Theme Detection

Uses `next-themes` with `defaultTheme="system"` to auto-detect OS preference. Users can override with the theme toggle (Light/Dark/System).

## File Organization

### Core Libraries (`src/lib/`)

| File | Responsibility |
|------|---------------|
| `editor-types.ts` | TypeScript type definitions (40 tool types, 16+ tool options) |
| `editor-store.ts` | Zustand store with all state and actions (clipboard, adjustment layers, recent files, export presets, custom shortcuts, tutorial, guides) |
| `image-processing.ts` | Filter algorithms, Lightroom develop adjustments, LUT color grading, content-aware fill, seamless pattern maker, offset filter, align layers (~1950 lines) |
| `vectorize.ts` | Raster-to-SVG vectorization pipeline |
| `vector-shapes.ts` | Illustrator-style vector shapes (star, polygon, arrow, heart, speech bubble, spiral, calligraphy stroke, scatter brush, path smoothing) |
| `perf.ts` | Performance utilities, device detection, RAF throttle, canvas pool, memory manager |

### Components (`src/components/editor/`)

| Component | Responsibility |
|-----------|---------------|
| `PhotoEditor.tsx` | Main container, responsive layout, drag-and-drop import, mobile bottom toolbar |
| `EditorCanvas.tsx` | Canvas rendering, 40 tool implementations, pointer capture, auto-fit zoom (~1800 lines) |
| `Toolbar.tsx` | Left tool buttons (desktop), 40 tools across 6 sections |
| `OptionsBar.tsx` | Context-sensitive tool options with mobile-compact layout |
| `MenuBar.tsx` | Top menu (File, Edit, Image, Layer, Filter, Vector, View) with 100+ menu items |
| `LayersPanel.tsx` | Layer list, masks, blend modes, align, copy/paste |
| `AdjustmentsPanel.tsx` | Filters and adjustments UI with Pro Color Tools |
| `DevelopPanel.tsx` | Lightroom-style develop panel (Light, Color, Effects, Detail, Split Toning) |
| `ColorPanel.tsx` | Color picker, swatches |
| `HistoryPanel.tsx` | Undo/redo history |
| `NavigatorPanel.tsx` | Minimap, brush presets |
| `VectorizeDialog.tsx` | Vectorization dialog with live preview |
| `NewDocumentDialog.tsx` | 24 document templates |
| `Onboarding.tsx` | 7-step onboarding tour for new users |
| `TutorialPanel.tsx` | 12-step interactive tutorial with auto-detection |
| `ThemeToggle.tsx` | Light/dark/system toggle |
| `PerformanceControls.tsx` | FPS counter, performance settings popover |

## Data Flow

### Drawing a Brush Stroke

```
1. User clicks canvas (PointerDown)
   → onPointerDown() creates stroke canvas, draws initial dot

2. User drags (PointerMove)
   → onPointerMove() draws line segment on stroke canvas
   → previewStroke() composites stroke onto visible canvas
   → (cursor position NOT updated to avoid re-renders)

3. User releases (PointerUp)
   → commitStrokeToLayer() composites stroke canvas onto layer
   → Applies symmetry (mirror/mandala) if enabled
   → Applies selection mask if active
   → refreshThumbnail() updates layer panel preview
   → pushHistory() saves snapshot
   → clearStrokeCanvas() resets for next stroke
```

### Applying a Filter

```
1. User clicks "Apply" in Adjustments panel
   → applyAdjustment() gets active layer
   → Checks layer is not locked
   → Calls filter function (e.g., applyBrightnessContrast)
   → Filter uses LUT for fast per-pixel operation
   → refreshThumbnail() updates preview
   → pushHistory() records "Brightness/Contrast"
```

### Undo/Redo

```
1. User presses Ctrl+Z
   → undo() decrements historyIndex
   → restoreFromHistory() loads snapshots
   → For each layer snapshot:
     - Create new canvas
     - Load dataUrl (JPEG/PNG) into canvas
     - Restore mask if present
   → Update store with new layers array
```

## Extension Points

### Adding a New Tool

1. Add tool type to `editor-types.ts`:
   ```typescript
   export type ToolType = '...' | 'new-tool';
   ```

2. Add tool options if needed in `ToolOptions` interface

3. Add default value in `DEFAULT_TOOL_OPTIONS` in `editor-store.ts`

4. Add tool preset in `tool-presets.tsx`:
   ```typescript
   'new-tool': { icon: <Icon />, label: 'New Tool', hint: '...' },
   ```

5. Add to `TOOLS` array in `Toolbar.tsx` (choose the right section)

6. Implement tool logic in `EditorCanvas.tsx`:
   - Handle `onPointerDown` for tool
   - Handle `onPointerMove` for tool
   - Handle `onPointerUp` for tool
   - Add to `cursorStyle()` function
   - Add keyboard shortcut to the keyboard handler

7. Add options in `OptionsBar.tsx` if needed

### Adding a New Filter

1. Implement filter function in `image-processing.ts`:
   ```typescript
   export function applyNewFilter(ctx, w, h, param) {
     const lut = new Uint8Array(256);
     // Build LUT...
     applyLUTAll(ctx, w, h, lut);
   }
   ```

2. Add UI control in `AdjustmentsPanel.tsx` or menu item in `MenuBar.tsx`

3. Use `applyAdjustment()` helper to apply with history recording

## Build & Deployment

### Adding a New Store Feature

1. Add state and action types to the `EditorState` interface in `editor-store.ts`
2. Add initial state value
3. Implement the action function
4. Subscribe to the state in components using `useEditorStore((s) => s.feature)`
5. For persisted state, use `localStorage` (see `exportPresets` or `customShortcuts` for examples)

## Pointer Capture System

The editor uses `setPointerCapture()` on every pointer-down event to ensure smooth drawing:

```typescript
const onPointerDown = useCallback((e: React.PointerEvent) => {
  // Always capture pointer so we keep getting move/up events even outside canvas
  (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  // ... tool-specific logic
}, [...]);
```

- `onPointerLeave` is NOT used to end strokes (removed to fix mobile drawing bug)
- `onPointerCancel` handles touch cancellation (system notifications, etc.)
- `touch-action: none` on canvas and container prevents browser gesture interference
- This ensures strokes continue even when the pointer leaves the canvas bounds

## Mobile Layout Architecture

### Responsive Detection
```typescript
const check = () => {
  const mobile = window.innerWidth < 768;
  setIsMobile(mobile);
  if (mobile) { setPanelOpen(false); }
  else { setPanelOpen(true); }
};
```

### Mobile Bottom Toolbar
On mobile, the left sidebar toolbar is replaced with a horizontal scrollable bottom bar:
- Color swatches row (foreground, swap, background)
- 10 quick-access tools (Move, Brush, Eraser, Fill, Rect, Ellipse, Text, Pick, Crop, Wand)
- Expandable to 20+ tools via "⋯" button
- Each tool shows icon + text label

### Auto-Fit Zoom
The auto-fit system re-fits when container dimensions change:
```typescript
// Re-fit when container size changes (viewport resize, mobile/desktop switch)
if (containerSize.w === lastFitW.current && containerSize.h === lastFitH.current) return;
// Mobile: 20px margin, allow 2x zoom to fill screen
// Desktop: 60px margin, cap at 1x
```

## New Algorithms

### Content-Aware Fill (No AI)
Samples surrounding non-masked pixels and averages them with noise:
```typescript
for each masked pixel:
  sample radius=20 neighborhood
  skip other masked pixels
  average RGB values
  add random noise (±5)
  fill pixel with averaged+noised value
```

### LUT Color Grading (.cube file)
Parses standard .cube LUT files and applies them with intensity control:
- `parseCubeLUT()` reads the text format, extracts 3D LUT entries
- Simplifies to 256-entry per-channel LUTs (R, G, B)
- `applyCubeLUT()` blends original and LUT-graded pixels by intensity factor

### Seamless Pattern Maker
Offsets image by half in both dimensions and reassembles 4 quadrants:
```
Original:     Result:
[A][B]   →   [D][C]
[C][D]       [B][A]
```

### Align Layers
Finds each layer's content bounds (non-transparent pixels) and computes alignment offsets:
- Scans each layer's alpha channel for min/max X/Y
- Computes offset based on alignment type (left, center, right, top, middle, bottom)
- Creates new canvas with offset content drawn at new position

### Drag-and-Drop Import
The main container has `onDragOver` and `onDrop` handlers:
```typescript
onDrop={(e) => {
  const file = e.dataTransfer.files?.[0];
  // Create new document sized to image
  // Add layer with image content
  // Add to recent files
}}
```

## Tutorial System

### Onboarding Tour (7 steps)
- Shows on first visit (localStorage check)
- Can be replayed via View → Show Onboarding Tour
- Pure presentation (no action detection)

### Interactive Tutorial (12 steps)
- Loads a procedurally-generated landscape image
- Monitors Zustand store for step completion
- Auto-advances when user performs the required action (tool selection, filter application, etc.)
- Manual "Skip Step" button for stuck users
- Step detection checks history labels and active tool state

## Build & Deployment

### Development
```bash
bun run dev    # Start dev server on port 3000
bun run lint   # Run ESLint
```

### Production
```bash
bun run build  # Build for production
bun run start  # Start production server
```

The app is a standard Next.js application and can be deployed to Vercel, Netlify, or any Node.js host. All image processing is 100% client-side — no server-side processing required.
