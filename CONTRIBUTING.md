# Contributing to Pixel Lab

Thank you for your interest in contributing to Pixel Lab! This document provides guidelines and information for contributors.

## Table of Contents

- [Code of Conduct](#code-of-conduct)
- [Getting Started](#getting-started)
- [Development Setup](#development-setup)
- [Project Structure](#project-structure)
- [Coding Standards](#coding-standards)
- [Adding New Features](#adding-new-features)
- [Testing](#testing)
- [Submitting Changes](#submitting-changes)
- [Reporting Bugs](#reporting-bugs)
- [Feature Requests](#feature-requests)

---

## Code of Conduct

Be respectful, constructive, and welcoming. We're all here to build something great together. Harassment or exclusionary behavior will not be tolerated.

---

## Getting Started

### Prerequisites

- **Node.js 18+** or **Bun** (recommended)
- **Git**
- A modern browser (Chrome, Firefox, Safari, Edge)
- Basic knowledge of TypeScript, React, and Canvas API

### Development Setup

1. **Fork and clone the repository**
   ```bash
   git clone https://github.com/yourusername/pixel-lab.git
   cd pixel-lab
   ```

2. **Install dependencies**
   ```bash
   bun install
   # or
   npm install
   ```

3. **Start the development server**
   ```bash
   bun run dev
   ```

4. **Open the app**
   Navigate to [http://localhost:3000](http://localhost:3000)

5. **Verify linting passes**
   ```bash
   bun run lint
   ```

---

## Project Structure

```
src/
├── app/                        # Next.js App Router
│   ├── layout.tsx              # Root layout (ThemeProvider, metadata)
│   ├── page.tsx                # Main page (renders PhotoEditor)
│   └── globals.css             # Global styles + theme variables
├── lib/                        # Core libraries (framework-agnostic)
│   ├── editor-types.ts         # TypeScript type definitions (40 tools, 16+ options)
│   ├── editor-store.ts         # Zustand store (state, clipboard, adjustment layers, tutorial, etc.)
│   ├── image-processing.ts     # Filter algorithms, Lightroom adjustments, LUT, content-aware fill (~1950 lines)
│   ├── vectorize.ts            # Raster-to-SVG vectorization
│   ├── vector-shapes.ts        # Illustrator-style shapes (star, polygon, arrow, heart, spiral, etc.)
│   └── perf.ts                 # Performance utilities, device detection
└── components/
    ├── ui/                     # shadcn/ui primitive components
    └── editor/                 # Editor-specific components
        ├── PhotoEditor.tsx     # Main container (responsive layout)
        ├── EditorCanvas.tsx    # Canvas + tool implementations
        ├── Toolbar.tsx         # Left toolbar
        ├── OptionsBar.tsx      # Context tool options
        ├── MenuBar.tsx         # Top menu bar
        ├── LayersPanel.tsx     # Layer management
        ├── AdjustmentsPanel.tsx # Filters & adjustments
        ├── ColorPanel.tsx      # Color picker
        ├── HistoryPanel.tsx    # Undo/redo history
        ├── NavigatorPanel.tsx  # Minimap & brush presets
        ├── VectorizeDialog.tsx # Vectorization dialog
        ├── NewDocumentDialog.tsx # New document presets
        ├── ThemeToggle.tsx     # Light/dark toggle
        ├── PerformanceControls.tsx # FPS & perf settings
        └── tool-presets.tsx    # Tool metadata
```

### Key Files to Understand

| File | What to know |
|------|-------------|
| `editor-store.ts` | Central state. All actions live here (clipboard, adjustment layers, tutorial, recent files, shortcuts). Read this first. |
| `editor-types.ts` | Type definitions. Update when adding tools/options. 40 tool types, 16+ tool options. |
| `EditorCanvas.tsx` | Largest file (~1800 lines). All 40 tool implementations, pointer capture, auto-fit zoom. |
| `image-processing.ts` | All filter algorithms (~1950 lines). Filters, Lightroom adjustments, LUT, content-aware fill, pattern maker. |
| `vector-shapes.ts` | Illustrator-style shapes. Star, polygon, arrow, heart, speech bubble, spiral, calligraphy, scatter. |
| `vectorize.ts` | Raster-to-SVG pipeline. Color quantization, boundary tracing, path simplification. |
| `perf.ts` | Performance utilities. Device tier detection, RAF throttle, canvas pool, memory manager. |
| `MenuBar.tsx` | All menu items (100+). File, Edit, Image, Layer, Filter, Vector, View menus. |

---

## Coding Standards

### TypeScript

- **Strict typing** — No `any` types unless absolutely necessary. Use `unknown` and narrow.
- **Interfaces for data structures** — Use `interface` for object shapes, `type` for unions.
- **Export types** — Always export types that consumers might need.

```typescript
// Good
interface BrushOptions {
  size: number;
  hardness: number;
  opacity: number;
}

// Bad
const brushOptions: any = { size: 20 };
```

### React

- **Functional components only** — No class components.
- **Hooks** — Use `useState`, `useCallback`, `useRef`, `useEffect` appropriately.
- **Memoization** — Use `useCallback` for functions passed as props, `useMemo` for expensive computations.
- **Selective Zustand subscriptions** — Subscribe to only what you need to avoid unnecessary re-renders.

```typescript
// Good — only re-renders when activeTool changes
const activeTool = useEditorStore((s) => s.activeTool);

// Bad — re-renders on ANY store change
const store = useEditorStore();
const activeTool = store.activeTool;
```

### Canvas & Performance

- **Use `willReadFrequently: true`** when getting context for read-heavy operations:
  ```typescript
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
  ```

- **Avoid `queue.shift()`** — It's O(n). Use `stack.pop()` (O(1)) for flood fills.

- **Use LUTs for per-pixel operations** — 256-entry lookup tables are much faster than math per pixel:
  ```typescript
  // Good — build LUT once, lookup per pixel
  const lut = new Uint8Array(256);
  for (let i = 0; i < 256; i++) lut[i] = transform(i);
  for (let i = 0; i < data.length; i += 4) {
    data[i] = lut[data[i]];
  }

  // Bad — math per pixel
  for (let i = 0; i < data.length; i += 4) {
    data[i] = Math.max(0, Math.min(255, data[i] * factor + offset));
  }
  ```

- **Use integer math** where possible (`>> 8` instead of `/ 256`).

- **Avoid creating canvases in hot loops** — Reuse from a pool or cache.

- **Always use `setPointerCapture`** on pointer-down for drawing tools:
  ```typescript
  // Good — pointer capture ensures smooth strokes even outside canvas
  (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  ```

- **Never use `onPointerLeave` to end strokes** — This causes premature stroke ending on mobile where the canvas is small. Use `onPointerUp` and `onPointerCancel` only.

- **Add `touch-action: none`** to canvas elements to prevent browser gesture interference:
  ```tsx
  <canvas className="touch-none" ... />
  ```

- **Use the `vector-shapes.ts` library** for new shape tools — Don't reimplement star/polygon/heart drawing.

### Styling

- **Tailwind CSS 4** — Use utility classes. Avoid custom CSS unless necessary.
- **Editor theme variables** — Use `editor-surface`, `editor-text`, `editor-border`, etc. (defined in `globals.css`). These adapt to light/dark mode automatically.
- **Responsive** — Use `sm:`, `md:` prefixes. Mobile-first approach.
- **Touch targets** — Minimum 44×44px for interactive elements on mobile (`touch-target` class).

```tsx
// Good — theme-aware classes
<div className="editor-surface editor-text p-4 rounded-lg border editor-border">

// Bad — hardcoded colors
<div className="bg-zinc-900 text-white p-4 rounded-lg border border-zinc-700">
```

### ESLint

The project uses ESLint with Next.js rules. **All code must pass `bun run lint` with zero errors and zero warnings.**

Common rules:
- No unused variables
- No `any` types
- React hooks rules (dependencies, no conditional hooks)
- No `setState` directly in `useEffect` (use eslint-disable if necessary)

---

## Adding New Features

### Adding a New Tool

1. **Add the tool type** in `src/lib/editor-types.ts`:
   ```typescript
   export type ToolType = '...' | 'my-new-tool';
   ```

2. **Add tool options** if needed in `ToolOptions` interface:
   ```typescript
   export interface ToolOptions {
     // ...
     myToolStrength: number;
   }
   ```

3. **Add default value** in `DEFAULT_TOOL_OPTIONS` in `editor-store.ts`:
   ```typescript
   const DEFAULT_TOOL_OPTIONS: ToolOptions = {
     // ...
     myToolStrength: 50,
   };
   ```

4. **Add tool preset** in `src/components/editor/tool-presets.tsx`:
   ```typescript
   'my-new-tool': {
     icon: <MyIcon size={16} />,
     label: 'My Tool',
     hint: 'Description shown in tooltip',
   },
   ```

5. **Add to toolbar** in `src/components/editor/Toolbar.tsx`:
   ```typescript
   { type: 'my-new-tool', icon: <MyIcon size={18} />, label: 'My Tool', shortcut: 'N' },
   ```

6. **Implement tool logic** in `src/components/editor/EditorCanvas.tsx`:
   - Add handler in `onPointerDown`
   - Add handler in `onPointerMove`
   - Add handler in `onPointerUp`
   - Add to `cursorStyle()` function
   - Add keyboard shortcut to the keyboard handler

7. **Add options** in `src/components/editor/OptionsBar.tsx` if the tool has adjustable parameters.

8. **Test** — Verify the tool works, lint passes, no console errors.

### Adding a New Filter

1. **Implement the filter** in `src/lib/image-processing.ts`:
   ```typescript
   export function applyMyFilter(
     ctx: CanvasRenderingContext2D,
     w: number,
     h: number,
     param: number,
   ) {
     // Build LUT for fast per-pixel operation
     const lut = new Uint8Array(256);
     for (let i = 0; i < 256; i++) {
       lut[i] = /* transform */;
     }

     const imageData = ctx.getImageData(0, 0, w, h);
     const data = imageData.data;
     for (let i = 0; i < data.length; i += 4) {
       data[i] = lut[data[i]];
       data[i + 1] = lut[data[i + 1]];
       data[i + 2] = lut[data[i + 2]];
     }
     ctx.putImageData(imageData, 0, 0);
   }
   ```

2. **Add UI** in `src/components/editor/AdjustmentsPanel.tsx`:
   ```tsx
   <div className="space-y-2">
     <div className="text-xs font-semibold editor-text">My Filter</div>
     <Slider
       value={[myParam]}
       min={0}
       max={100}
       onValueChange={setMyParam}
     />
     <Button onClick={() => applyAdjustment('My Filter', (ctx, w, h) =>
       applyMyFilter(ctx, w, h, myParam)
     )}>Apply</Button>
   </div>
   ```

3. **Or add to menu** in `src/components/editor/MenuBar.tsx`:
   ```tsx
   <MenubarItem className={itemClass} onClick={() => {
     const val = prompt('Parameter:', '50');
     if (val === null) return;
     runFilter('My Filter', (ctx, w, h) => applyMyFilter(ctx, w, h, parseFloat(val)));
   }}>
     <span>My Filter...</span>
   </MenubarItem>
   ```

### Adding a Blend Mode

1. Add to `BlendMode` type in `editor-types.ts`
2. Add to `BLEND_MODES` array with label
3. The composite function uses `globalCompositeOperation` which supports standard modes automatically

---

## Testing

### Manual Testing

Since this is a canvas-based app, most testing is manual. Use the Agent Browser or a real browser to verify:

1. **Tool functionality** — Each tool performs its expected action
2. **History** — Undo/redo works correctly
3. **Layers** — Add, delete, reorder, merge, mask
4. **Filters** — Apply and verify result
5. **Export** — PNG, JPEG, WebP, SVG export correctly
6. **Responsive** — Test on mobile (390px) and desktop (1440px) viewports
7. **Themes** — Light, dark, and system modes work
8. **Performance** — FPS counter stays green during operations

### Test Checklist for PRs

- [ ] `bun run lint` passes with 0 errors/warnings
- [ ] No console errors in browser
- [ ] Feature works on desktop (1440px)
- [ ] Feature works on mobile (390px)
- [ ] Feature works in light and dark mode
- [ ] Undo/redo works after the feature
- [ ] No memory leaks (check FPS over time)

---

## Submitting Changes

### Pull Request Process

1. **Create a feature branch**
   ```bash
   git checkout -b feature/my-new-feature
   ```

2. **Make your changes** following the coding standards above.

3. **Test thoroughly** using the checklist above.

4. **Commit with clear messages**
   ```bash
   git commit -m "feat: add mesh warp transform tool"
   git commit -m "fix: magic wand crashes on transparent pixels"
   git commit -m "perf: optimize median denoise with typed arrays"
   ```

   Use conventional commits:
   - `feat:` — New feature
   - `fix:` — Bug fix
   - `perf:` — Performance improvement
   - `refactor:` — Code refactoring
   - `docs:` — Documentation
   - `style:` — Styling/UI changes
   - `test:` — Tests

5. **Push to your fork**
   ```bash
   git push origin feature/my-new-feature
   ```

6. **Open a Pull Request** with:
   - Clear title describing the change
   - Description of what changed and why
   - Screenshots if UI is affected
   - Reference to any related issues

### PR Review Criteria

- Code follows style guidelines
- Lint passes
- No console errors
- Feature works as described
- No performance regressions
- Code is documented where complex
- No breaking changes (or clearly documented)

---

## Reporting Bugs

When reporting bugs, please include:

1. **Description** — What happened vs what you expected
2. **Steps to reproduce** — Exact steps to trigger the bug
3. **Environment**:
   - Browser and version
   - OS
   - Device (desktop/mobile)
   - Screen resolution
4. **Screenshots** — If applicable
5. **Console errors** — Copy any error messages from the browser console
6. **Performance** — FPS counter reading if performance-related

### Bug Report Template

```markdown
## Bug Description
[Clear description of the bug]

## Steps to Reproduce
1. Open Pixel Lab
2. Select Brush tool
3. Draw on canvas
4. ...

## Expected Behavior
[What should happen]

## Actual Behavior
[What actually happens]

## Environment
- Browser: Chrome 120
- OS: macOS 14
- Device: Desktop
- Resolution: 1920x1080

## Screenshots
[If applicable]

## Console Output
```
[Error messages]
```
```

---

## Feature Requests

We welcome feature requests! Please:

1. Check existing issues to avoid duplicates
2. Describe the feature and its use case
3. Explain why it would be valuable
4. If possible, suggest how it might be implemented

---

## Performance Guidelines

When contributing performance-sensitive code:

1. **Profile before optimizing** — Use the FPS counter and browser DevTools
2. **Use LUTs** for per-pixel operations
3. **Use scanline algorithms** for flood fills
4. **Avoid allocations in hot loops** — Reuse arrays and canvases
5. **Throttle expensive operations** — Use `rafThrottle` from `perf.ts`
6. **Consider device tier** — Use `perfSettings` to adjust behavior
7. **Test on mobile** — What's fast on desktop may be slow on phones

---

## Questions?

- Open an issue with the `question` label
- Check the [Architecture](ARCHITECTURE.md) document for technical details
- Review existing code for patterns and conventions

Thank you for contributing to Pixel Lab! 🎨
