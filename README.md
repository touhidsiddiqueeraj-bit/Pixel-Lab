# ⚡ Pixel Lab

<p align="center">
  <img src="public/pixel-lab-logo.svg" width="120" height="120" alt="Pixel Lab Logo" />
</p>

<p align="center">
  A professional, web-based image editor built with Next.js, TypeScript, and Canvas API. 100% client-side — no cloud dependency. Features 40 tools, layers, masks, Lightroom-style develop panel, vectorization, LUT color grading, content-aware fill, and a fully responsive mobile-friendly interface.
</p>

<p align="center">
  <a href="https://pixel-lab-jade.vercel.app/" target="_blank">🚀 Live Demo</a> •
  <a href="#features">Features</a> •
  <a href="#screenshots">Screenshots</a> •
  <a href="#getting-started">Getting Started</a> •
  <a href="#usage">Usage</a> •
  <a href="ARCHITECTURE.md">Architecture</a> •
  <a href="CONTRIBUTING.md">Contributing</a>
</p>

---

## Features

### 🎨 Tools (40 tools across 6 categories)

**Selection**
- Move, Rectangular/Elliptical Marquee, Lasso (freehand/polygonal/magnetic), Magic Wand, Crop

**Painting**
- Brush (soft/hard), Pencil, **Blob Brush** (fills that merge), **Calligraphy Brush** (angle-aware), **Scatter Brush** (random shapes), Eraser, Clone Stamp, Healing Brush, **Smooth Tool**, Paint Bucket, Gradient

**Pen & Vector**
- Pen Tool (Bezier curves), **Curvature Pen** (auto-smooth), Text

**Shapes**
- Rectangle, Ellipse, Line, **Star** (adjustable points + inner radius), **Polygon** (3-12 sides), **Arrow** (adjustable head), **Heart**, **Speech Bubble**, **Spiral** (adjustable turns)

**Liquify**
- Push, Pucker, Bloat, Twirl

**View**
- Hand (pan), Zoom

### 🖼️ Layers & Non-Destructive Editing
- Unlimited layers with drag-to-reorder
- **Layer Masks** (non-destructive) — Add, Toggle, Remove, Invert
- **Adjustment Layers** — Non-destructive filter layers with re-editable settings
- 16 blend modes (Normal, Multiply, Screen, Overlay, etc.)
- Per-layer opacity, visibility, lock
- Merge Down, Merge Visible, Flatten Image
- **Align Layers** — Align Left/Center/Right, Top/Middle/Bottom
- Duplicate, rename, delete
- **Copy/Paste** between layers (Ctrl+C / Ctrl+V)

### 📷 Lightroom-Style Develop Panel
A full photo development panel with 5 sections:
- **Light**: Exposure, Contrast, Highlights, Shadows, Whites, Blacks, Clarity, Dehaze, Texture
- **Color**: Vibrance (selective saturation), Saturation
- **Effects**: Film Grain (amount + size), Lens Vignette (amount, midpoint, roundness, feather)
- **Detail**: Sharpening (amount, radius, detail), Luminance Noise Reduction, Color Noise Reduction
- **Split Toning**: Highlight hue/saturation, Shadow hue/saturation, Balance

### 🎭 Drawing Aids
- **Symmetry Mode** — None, Horizontal, Vertical, Quad, Mandala (2-12 segments)
- **Brush Stabilizer** — Weighted moving average for smoother strokes
- **Brush Presets** — 8 defaults + save your own (persists in localStorage)
- **Eyedropper** — Sample colors from canvas
- **Color Picker** — SV picker, hue slider, hex/RGB inputs, swatches

### 📊 Pro Color Tools
- **Curves** — S-curve with adjustable mid-point
- **Levels** — Black/White/Gamma adjustment
- **Channel Mixer** — Mix R/G/B channels
- **HDR Toning** — Local contrast enhancement (CLAHE-lite)
- **LUT Color Grading** — Import and apply .cube LUT files with intensity control
- Brightness/Contrast, Hue/Saturation, Color Temperature

### 🎬 Filters (25+)
- **Blur**: Gaussian Blur, Fast Blur
- **Sharpen**: Unsharp Mask, Auto Unblur (deconvolution)
- **Denoise**: Median filter
- **Artistic**: Vignette, Add Noise (grain), Sepia, Grayscale, Invert, Threshold, Posterize, Pixelate
- **Edge**: Edge Detect (Sobel), Emboss
- **Texture**: Seamless Pattern Maker, Offset (Wrap)
- **Smart**: Auto Background Remove (edge flood-fill), Auto Unblur, Content-Aware Fill

### 🔄 Vectorization
- Convert raster images to SVG paths
- Median cut color quantization (2-32 colors)
- Moore neighborhood boundary tracing
- Ramer-Douglas-Peucker path simplification
- Quadratic Bezier curve smoothing
- Live preview with adjustable settings
- Export as `.svg` or apply as new layer

### 📐 Precision & Layout
- **Rulers & Guides** — Add/clear guides, snap toggle
- **Grid** — 50px grid overlay, Snap to Pixel Grid
- **Navigator Panel** — Live minimap with click-to-recenter
- **Transform** — Rotate 90/180/270, Flip H/V, Skew, Image Size resize
- **Align Layers** — 6 alignment options for multi-layer composition

### 🎭 Layer Effects
- Drop Shadow (color, offset, blur, opacity)
- Stroke (color, width)
- Outer Glow (color, size, opacity)

### 💾 Import & Export
- **Drag-and-drop** import — Drop any image file anywhere on the page
- **Recent Files** — Quick access to last 5 edited images
- **Batch Processing** — Process multiple files at once
- **Export formats**: PNG, JPEG, WebP, GIF, SVG
- **Export Presets** — Save format/quality/resize settings
- **Quick Export** button in title bar for one-click PNG
- **24 Document Templates**: Social media, Print, Digital, Mobile, Icons

### 📱 Responsive & Themeable
- **Mobile bottom toolbar** — 10 quick tools + expandable to 20+, color swatches
- **Canvas zoom controls** — Fit, 1:1, +, − buttons on canvas
- **Auto-fit zoom** — Re-fits on viewport resize/rotation
- **Auto light/dark mode** — Detects OS preference via `next-themes`
- **Manual theme toggle**: Light/Dark/System
- **Performance tiers**: Auto-detects Low/Medium/High and adjusts settings

### 🎓 Learning
- **Onboarding Tour** — 7-step interactive tour for new users
- **Interactive Tutorial** — 12-step guided photo editing walkthrough with auto-detection
- **Keyboard Shortcut Editor** — Customize shortcuts, persisted to localStorage

### ⚡ Performance Optimized
- **Scanline flood fill** — 10-100x faster Magic Wand, Bucket Fill, Auto BG Remove
- **LUT-based filters** — 3-5x faster Brightness/Contrast, Invert, Grayscale, etc.
- **Shadow-blur soft brush** — 8x fewer draw calls for soft brushes
- **JPEG history snapshots** — 5-10x memory reduction for opaque layers
- **Configurable history cap** — 15/30/60 states based on device tier
- **Throttled marching ants** — 15fps instead of 60fps
- **Pointer capture** — Smooth strokes even when pointer leaves canvas
- **Live FPS counter** with performance settings popover
- **100% client-side** — No cloud dependency, no server roundtrips

---

## Screenshots

### Dark Mode Editor
![Editor - Dark Mode](public/screenshots/editor-dark.png)

### Light Mode Editor
![Editor - Light Mode](public/screenshots/editor-light.png)

### Adjustments Panel
![Adjustments Panel](public/screenshots/adjustments-panel.png)

### Vectorize Dialog
![Vectorize Dialog](public/screenshots/vectorize-dialog.png)

### Layers Panel
![Layers Panel](public/screenshots/layers-panel.png)

### Mobile View
![Mobile View](public/screenshots/mobile-view.png)

---

## Getting Started

### Prerequisites
- Node.js 18+ or Bun
- A modern browser with Canvas API support

### Installation

```bash
# Clone the repository
git clone https://github.com/touhidsiddiqueeraj-bit/Pixel-Lab.git
cd pixel-lab

# Install dependencies (using bun recommended)
bun install
# or
npm install

# Start the development server
bun run dev
# or
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) in your browser.

### Build for Production

```bash
bun run build
bun run start
```

---

## Usage

### Keyboard Shortcuts

| Shortcut | Action |
|----------|--------|
| `V` | Move tool |
| `M` | Rectangular Marquee |
| `L` | Lasso |
| `W` | Magic Wand |
| `C` | Crop |
| `I` | Eyedropper |
| `B` | Brush |
| `E` | Eraser |
| `S` | Clone Stamp |
| `J` | Healing Brush |
| `Y` | Smooth Tool |
| `P` | Pen Tool |
| `T` | Text |
| `U` | Rectangle Shape |
| `R` | Liquify Push |
| `H` | Hand (pan) |
| `Z` | Zoom |
| `X` | Swap foreground/background colors |
| `D` | Reset colors to black/white |
| `[` / `]` | Decrease/increase brush size |
| `Space` + drag | Pan canvas |
| `Ctrl+Z` | Undo |
| `Ctrl+Y` / `Ctrl+Shift+Z` | Redo |
| `Ctrl+A` | Select All |
| `Ctrl+D` | Deselect |
| `Ctrl+Shift+I` | Inverse Selection |
| `Ctrl+C` | Copy selection/layer |
| `Ctrl+V` | Paste as new layer |
| `Ctrl+S` | Quick Export PNG |
| `Ctrl+Shift+V` | Open Vectorize dialog |
| `Ctrl+Shift+U` | Auto Unblur (quick) |
| `Ctrl++` / `Ctrl+-` | Zoom in/out |
| `Ctrl+0` | Actual size (100%) |
| `Enter` (Pen tool) | Commit path |
| `Esc` (Pen tool) | Cancel path |
| `Alt+Click` (Clone/Heal) | Set source |

### Quick Start Guide

1. **Import an image**: Drag-and-drop a file onto the page, or File → Open
2. **Draw**: Select the Brush tool (`B`), pick a color, and draw on the canvas
3. **Add layers**: Layer → New Layer (`Ctrl+Shift+N`) to work non-destructively
4. **Develop photo**: Open the Develop tab for Lightroom-style adjustments
5. **Apply filters**: Adjust tab or Filter menu for effects
6. **Content-Aware Fill**: Select an area → Edit → Content-Aware Fill
7. **Color grade**: Filter → Apply LUT (.cube file) for cinematic looks
8. **Vectorize**: Vector → Vectorize Image (`Ctrl+Shift+V`) to convert to SVG
9. **Export**: Click the Export button in the title bar, or File → Export

### Pro Tips

- **Non-destructive workflow**: Use layer masks instead of erasing. Select area → Layer → Layer Mask → Add
- **Symmetry drawing**: Enable Mandala mode in OptionsBar for mesmerizing symmetric patterns
- **Healing brush**: Alt+Click on clean skin, then paint over blemishes for content-aware removal
- **Auto Unblur**: Filter → Auto Unblur to restore sharpness to slightly blurred photos
- **Auto Background Remove**: Develop tab → Remove Background for quick cutouts
- **Seamless patterns**: Filter → Make Seamless Pattern for tileable game textures
- **Performance**: Click the FPS counter in the title bar to adjust settings for your device
- **Drag & drop**: Just drop an image file anywhere on the page to open it

---

## Tech Stack

- **Framework**: Next.js 16 with App Router
- **Language**: TypeScript 5
- **Styling**: Tailwind CSS 4 with shadcn/ui
- **State Management**: Zustand
- **Theme**: next-themes (system/light/dark)
- **Canvas**: HTML5 Canvas API with custom rendering engine
- **Icons**: Lucide React
- **Toasts**: Sonner
- **No cloud dependency**: 100% client-side processing

---

## Project Structure

```
pixel-lab/
├── src/
│   ├── app/                    # Next.js app router
│   │   ├── layout.tsx          # Root layout with ThemeProvider
│   │   ├── page.tsx            # Main page (renders PhotoEditor)
│   │   └── globals.css         # Global styles + theme variables
│   ├── lib/                    # Core libraries
│   │   ├── editor-types.ts     # TypeScript types
│   │   ├── editor-store.ts     # Zustand store
│   │   ├── image-processing.ts # Filter algorithms, Lightroom adjustments, LUT, content-aware fill
│   │   ├── vectorize.ts        # Raster-to-SVG vectorization
│   │   ├── vector-shapes.ts    # Illustrator-style shape drawing (star, polygon, arrow, heart, etc.)
│   │   └── perf.ts             # Performance utilities
│   └── components/
│       ├── ui/                 # shadcn/ui components
│       └── editor/             # Editor components
│           ├── PhotoEditor.tsx         # Main container (responsive layout)
│           ├── EditorCanvas.tsx        # Canvas & tool implementations
│           ├── Toolbar.tsx             # Left toolbar (desktop) / bottom toolbar (mobile)
│           ├── OptionsBar.tsx          # Context tool options
│           ├── MenuBar.tsx             # Top menu bar
│           ├── LayersPanel.tsx         # Layers management
│           ├── AdjustmentsPanel.tsx    # Filters & adjustments
│           ├── DevelopPanel.tsx        # Lightroom-style develop panel
│           ├── ColorPanel.tsx          # Color picker
│           ├── HistoryPanel.tsx        # Undo/redo history
│           ├── NavigatorPanel.tsx      # Minimap & brush presets
│           ├── VectorizeDialog.tsx     # Vectorization dialog
│           ├── NewDocumentDialog.tsx   # New document presets
│           ├── Onboarding.tsx          # 7-step onboarding tour
│           ├── TutorialPanel.tsx       # 12-step interactive tutorial
│           ├── ThemeToggle.tsx         # Light/dark toggle
│           ├── PerformanceControls.tsx # FPS & perf settings
│           └── tool-presets.tsx        # Tool metadata
├── public/
│   ├── pixel-lab-logo.svg      # Logo
│   └── screenshots/            # App screenshots
├── ARCHITECTURE.md             # System architecture
├── CONTRIBUTING.md             # Contribution guide
└── README.md                   # This file
```

---

## Documentation

- [Architecture](ARCHITECTURE.md) — System design, data flow, and technical details
- [Contributing](CONTRIBUTING.md) — Development setup, coding standards, and PR process

---

## License

MIT License — feel free to use this project for learning, personal, or commercial purposes.

---

## Acknowledgments

- Built with [Next.js](https://nextjs.org/), [Tailwind CSS](https://tailwindcss.com/), and [shadcn/ui](https://ui.shadcn.com/)
- Icons by [Lucide](https://lucide.dev/)
- Inspired by Adobe Photoshop and Lightroom workflows
