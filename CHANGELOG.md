# Changelog

All notable changes to Pixel Lab are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

---

## [Unreleased]

### 📱 Mobile UI

#### Compact horizontal command bar replaces the broken menu sheet
- The slide-out menu sheet embedded the desktop Radix Menubar, whose dropdowns never open on touch — users got an empty panel behind a dimming scrim with an ugly scrolling tab strip. It is replaced by a **floating horizontal chip bar** docked under the title bar: category chips (File / Image / Layer / Filter / Enhance / Vector / View) expand in place into one-tap action chips, the canvas stays interactive (no scrim), the scrollbar is hidden, and the bar auto-closes after an action.
- Actions run with sensible defaults — no `prompt()` chains on a phone (Blur = 5px, Sharpen = 1.0, Pixelate = 8, Vignette = 50/50, Posterize = 4, BG removal tolerance = 30). Resize still asks for width/height.
- Header decluttered from 7 items to 5 (menu, doc name, undo, redo, export); the theme toggle moved into the View group of the command bar.

#### "Squashed bars" artifact above the mobile header (Android WebView)
- Root-cause chain: the static export prerendered the **desktop** layout (`isMobile` initialized `false`), so the WebView's first paint was desktop chrome; the edge-to-edge inset strip above the app then showed the window background — which was still the Capacitor default **splash bitmap**, its logo squashed into the strip next to remnants of that first frame.
- Fixes: PhotoEditor now mounts **client-only** (`ssr: false`) so the first paint on any device is the correct layout; `isMobile` initializes from the real viewport on first client render; the Android launch theme background is a solid theme-matched color instead of the Capacitor splash bitmap.

### 🚀 CI/CD & Distribution

#### Android APK releases (Capacitor 7)
- The web editor is now packaged as a native Android app: `BUILD_TARGET=apk` switches Next.js to a fully-static export (`out/`), which `npx cap sync android` copies into a Capacitor WebView shell (`android/`, appId `com.pixellab.editor`, minSdk 23).
- Tag-driven workflow (`.github/workflows/release.yml`): pushes of `v*` tags build the export, stamp `versionName` from the tag and `versionCode` from the CI run number, run Gradle `assembleRelease` on JDK 21 with a committed PKCS12 keystore, and publish a GitHub Release with `PixelLab-<tag>.apk` + SHA-256 + install notes.
- The committed `android/keystore.p12` (alias `pixel-lab`) is an intentionally public demo keystore so releases are consistently signed and upgrade-installable; production builds can override via `APK_STORE_PASSWORD` / `APK_KEY_ALIAS` / `APK_KEY_PASSWORD`.

#### CI workflow (`.github/workflows/ci.yml`)
- Pushes to `main` and PRs now gate on `tsc --noEmit` (zero errors), `eslint src/` (zero problems) and a production web build.

### 🐛 Fixed

#### Status bar clipped app content on Android 15+ (Android shell)
- With `targetSdk 35`, Android 15+ enforces edge-to-edge drawing and Capacitor 7's default `adjustMarginsForEdgeToEdge: "disable"` meant the WebView rendered underneath the status bar — the top of the UI was hidden behind the notification bar.
- Set `adjustMarginsForEdgeToEdge: "force"` in `capacitor.config.ts`: the WebView is now padded with the real system-bar and display-cutout insets (status bar, navigation bar / gesture pill, and notches) on every Android version — zero insets are a no-op where the window doesn't extend under bars.
- The strip behind the system bars uses a window background matching the app theme (`#ffffff` light / `#0a0a0a` dark via `values-night` resources), with matching status-bar icon contrast (`windowLightStatusBar` light/night).

#### TypeScript baseline errors (CI type gate could not pass)
- `vectorize.ts`: `ImageData.data` (typed `ImageDataArray` in newer DOM libs) was passed to/assigned from `Uint8Array`-typed pipeline helpers — now copied once into a plain `Uint8Array` at the entry point.
- `src/hooks/use-toast.ts` and `src/hooks/use-mobile.ts` deleted — dead shadcn-template code referencing a non-existent component (the app uses Sonner) with zero consumers.
- `examples/` excluded from `tsconfig` (standalone demos with their own uninstalled `socket.io` dependencies, not part of the build).

#### React Hooks lint errors (`eslint-config-next` 16 rule `react-hooks/set-state-in-effect`)
- Intentional synchronous mount-time initializations are now documented and disabled per-line (`PerformanceControls.tsx` device-tier detection, `TutorialPanel.tsx` step-completion tracking, `VectorizeDialog.tsx` result reset on close); two stale disable directives removed (`NavigatorPanel.tsx`, `TutorialPanel.tsx`).

### 🔒 Security

#### MCP WebSocket bridge was reachable by any website and the whole LAN (`mcp/server.ts`)
- The WebSocket server (`new WebSocketServer({ port: 3004 })`) bound to **all interfaces** and performed **no Origin validation**. WebSocket connections are not subject to the same-origin policy: any page open in the user's browser could connect to `ws://localhost:3004`, silently displace the real Pixel Lab tab (`browserSocket` was last-one-wins), invoke any editing tool against the open document, spoof tool results, and receive canvas snapshots. Any machine on the local network could connect directly.
- The server now binds to **127.0.0.1 only**, and every connection's `Origin` header is validated: only `http(s)://localhost` / `127.0.0.1` / `[::1]` origins (plus one explicit opt-in via the `PIXEL_LAB_ALLOWED_ORIGIN` env var) are accepted; header-less and foreign-origin connections are closed with `1008`. A stale tab is closed (`4000`) when a new tab connects, instead of lingering as a hidden tool-call receiver.
- Verified with an automated 4-case test (evil origin rejected / no-origin rejected / loopback accepted / supersession closes the stale tab with 4000).

#### Image "dimension bomb" → tab freeze / OOM (`image-processing.ts`, `editor-store.ts`, `MenuBar.tsx`)
- `createBlankCanvas` accepted any dimensions: a crafted ~2KB PNG declaring 65535×65535 (or `parseInt(prompt(...))` = 999999) attempted a multi-GB canvas allocation → frozen/killed tab, with no error shown. Negative values silently wrapped via WebIDL (`-5` → 4294967291) and made every subsequent `getImageData` throw.
- Canvas dimensions are now validated (`MAX_CANVAS_EDGE = 16384`, `MAX_CANVAS_AREA = 256 MP`) with a fast-fail `RangeError`; `newDocument` and the new `openImage` action clamp oversized documents/images (preserving aspect ratio, with a toast); batch processing and Image Size… clamp inputs the same way.

#### API key input invited the browser password manager (`AgentPanel.tsx`)
- The Gemini key field was `autoComplete="current-password"` on a real form — Chrome/Firefox offered "Save password?", persisting (and account-syncing) the key, directly contradicting the on-screen "JS memory only" promise. Now `autoComplete="off"`.

#### Ctrl+S export ignored layer masks — silent content leak (`PhotoEditor.tsx`)
- The keyboard export paths composited layers without their masks, so the exported PNG contained the pixels the user had masked out — while the menu and title-bar exports honored masks (three export buttons, three different results). All paths now share one mask-aware compositor; failures (huge-document `toDataURL` OOM) surface as an error toast instead of silence.

#### Unvalidated `localStorage` parsing + oversized in-memory payloads
- Brush presets and saved recipes were `JSON.parse`-ed and cast with no shape validation — a corrupted/tampered value fed NaN geometry into the brush and malformed steps into the executor. Both loaders now validate shape (and cap recipe count).
- `getCanvasSnapshot` allowed `maxDimension` up to 4096 / quality 1.0 — a multi-MB data URL per call stored permanently in the unbounded chat message list. Capped at 512px / 0.9; chat history is capped at 200 messages.
- Download filenames built from user-typed doc names are sanitized (`\ / : * ? " < > |` and control chars).

### 🐛 Fixed

#### Marching-ants rendering (`EditorCanvas.tsx`)
- The marching-squares `CASE` table had rows 2↔4 and 3↔5 **transposed** (with the `tl<<3|tr<<2|bl<<1|br` packing): every boundary cell whose inside lay right or below emitted a segment perpendicular to the true boundary — the ants on the left/top arcs of an ellipse or lasso appeared as disconnected dash stacks. Corrected to the complement-symmetric table.
- The contour trace window covered exactly the selection bounds, so the inside/outside transition ring just **outside** the bounds was never visited — contours had gaps wherever a region touched its bounding box, and a solid rectangular wand region traced *nothing* (silently falling back to `strokeRect`). The window is now expanded 1px on each side, clamped to the mask canvas.

#### Undo/redo race conditions (`editor-store.ts`)
- `undo`/`redo` fired the async restore as fire-and-forget while committing `historyIndex` synchronously: rapid Ctrl+Z ran concurrent restores where the last `Image` to decode won (displayed state ≠ index), and a paint committed mid-restore snapshotted pre-restore pixels into a terminal entry that was then overwritten — silent data loss. Restores now run through a serialized queue; a new `isRestoring` flag makes `pushHistory` skip during the window.
- `loadIntoCanvas` never rejected: one corrupt snapshot data URL left the restore promise pending forever (undo silently did nothing, index permanently desynced). It now rejects with an error toast.

#### Selection semantics (`editor-store.ts`, `agent/tools.ts`)
- The agent-side `invertSelection` inverted RGB and kept alpha — a functional no-op (masks are alpha-encoded): "select the sky, invert, edit the subject" edited the **sky**. It now inverts alpha, and inverting an empty selection selects everything (Photoshop semantics) in both the editor store and the agent tools — the old empty-invert created a truthy-but-empty mask that blocked **all** painting until Esc.
- Selection ops (`invert`/`expand`/`contract`, history restore across a crop, document resize) read/wrote the mask at document dimensions — a stale-dimensioned mask (after crop/resize) made `getImageData` throw `IndexSizeError`. All now operate at the mask's own dimensions; stale masks are cleared when document geometry changes; resize also rescales layer masks.
- `expandSelection`/`contractSelection` had no radius cap: radius 200 on a 12 MP document was ~2.4 trillion inner iterations (minutes of frozen tab). Radius capped at 64.
- `mergeDown`/`mergeVisible`/`flattenImage` drew layers without their masks — merging resurrected pixels the user believed deleted. All now composite mask-aware.

#### AI agent correctness (`agent-runner.ts`, `agent/tools.ts`)
- Self-eval retries **compounded on the mutated original**: attempt 0 received the pristine workspace object itself and `executeTool` mutates canvases in place, so attempt 1 cloned an already-ruined canvas and stacked a second edit on top. Every attempt now clones from the pristine original.
- The "no visible change" check diffed 64×64 JPEG thumbnails: a small text label or thin line on a large canvas vanished in the downscale and the run silently exited with no preview, no commit, and no error — the user's request was dropped. Now a raw full-resolution pixel diff.
- Self-eval sent **full-resolution** before/after JPEGs (~10–20 MB on a 4K document) that Gemini rejected; the permissive fallback silently rubber-stamped the edit. Both images are downscaled to 1024px before the eval.
- `AbortController` was created but never aborted — after clicking Stop, in-flight Gemini/self-eval fetches ran to completion (spent tokens). A new abort registry lets `cancelRun`/`clearApiKey`/`clearChat` abort the in-flight request.
- Retry feedback quoted the best-so-far score, not the previous attempt's — misleading when a retry scored worse. Now quotes the immediately preceding attempt.
- `runRecipe` could recurse into itself (`RangeError: Maximum call stack`), and because recipes persist to `localStorage` the crash reproduced from the chat, the Automations panel, and the MCP bridge on every future run. `saveRecipe` now whitelists known tools, forbids `runRecipe`/`saveRecipe` steps, and caps at 32 steps; `runRecipe` enforces a nesting-depth and total-execution cap.
- `adjustDevelop` and `fillBucket` ignored the active selection, contradicting the system prompt's promise ("the editing tool will automatically restrict itself to the active selection") and its own worked example — a model that followed the documented example brightened the entire image instead of the sky. Both are now selection-masked.

#### Input handling (`EditorCanvas.tsx`)
- Wheel/pinch: React attaches root wheel listeners **passively**, so the missing `preventDefault` let the browser page-zoom on top of app zoom for every pinch (ctrl+wheel). Now a native non-passive listener with `preventDefault`, and zoom is anchored at the cursor (previously the canvas drifted toward the top-left).
- Brush stabilizer seed survived stroke end: with stabilizer > 0, every stroke after the first began with a stray line back to where the previous stroke ended. Reset on pointerdown.
- Tool-switch mid-drag: pressing `E` while still dragging a brush stroke flipped the commit to `destination-out` — the stroke **erased** the layer. The gesture's starting tool is captured at pointerdown and used for the commit; single-letter tool shortcuts are ignored while a stroke is in flight.
- `pointercancel` committed with stale/(0,0) coordinates, creating a marquee selection from the document origin. Cancel now aborts the gesture (refs reset, no commit).
- Right-click fell through to the tool branches and painted/dragged while the context menu opened. Non-primary buttons are ignored; `contextmenu` prevented on the canvas.
- Keyboard shortcuts fired while Radix Select listboxes, sliders, dialogs, and menus had focus — letters switched tools behind an open dialog, number keys retargeted layer opacity while a slider was focused. Guarded via `closest('[role=…]')`.
- `Shift+[` / `Shift+]` hardness shortcuts were unreachable (with Shift held, `e.key` is `{`/`}`): now matched on `e.code`.
- `Ctrl+0` aliased `Ctrl+1` (zoom 1:1) although the shortcuts dialog documents it as Fit on Screen. Implemented.
- Space (hold-to-pan) stuck `true` if the window lost focus while held — the next canvas click panned instead of drawing. Reset on `blur`/`visibilitychange`.
- Polygonal-lasso path preview never rendered (a `forceRender` tick can't re-run the overlay draw); it now calls `drawOverlay()` directly.
- Stale-closure: `selectionMask`/`selectionBounds` were missing from `onPointerDown`'s dependency array (the move-tool branch read them), capturing stale values when the user selected and immediately moved.
- Crop: fractional drag offsets made `drawImage` resample (subtly blurring the whole document); offsets are now rounded, and layer **masks** are cropped identically (they previously kept their old full-size geometry and pointed at the wrong region).
- Brush opacity was applied twice in the live preview (0.5 × 0.5) but once at commit — the stroke visibly darkened on pointer-up.

#### Cut/duplicate shortcuts were copies (`EditorCanvas.tsx`)
- `Ctrl+X` (advertised "Cut selection to clipboard") and `Ctrl+Shift+J` (cut to new layer) copied without deleting — Ctrl+V after Ctrl+X duplicated the region. Both now erase the selected pixels (`destination-out` through the selection mask) and push a proper history entry.

#### File open/place/drop robustness (`editor-store.ts`, `MenuBar.tsx`, `PhotoEditor.tsx`)
- A new `openImage` store action replaces the four copies of `newDocument() + setTimeout(() => addLayer(…) + drawImage)`: the 50–100ms timer raced any concurrent open/new and could attach the image to the **wrong document**; corrupt files never fired an error (no `onerror`) and leaked their object URL; non-image files were accepted on the Ctrl+O and menu paths. All four entry points (menu open, Ctrl+O, drag & drop, open recent) now validate type, surface decode errors, revoke URLs, and commit synchronously.
- Open Recent is now populated by every open path (previously only drag & drop ever added entries) and stores a 512px thumbnail instead of a full-resolution JPEG data URL per file.
- Batch Process Files hung forever on the first undecodable file (promise only resolved on `img.onload`); it now rejects per file, continues the batch, clamps image dimensions, sanitizes the output filename, and reports `processed/total`.

#### Filter math (`image-processing.ts`)
- `applyPosterize` with `levels < 2` → `step = ±Infinity` → `NaN` → solid black image; guarded.
- `applyVignette` with `size = 100` → `innerRadius == outerRadius` → `0/0 = NaN` → black/white image; denominator guarded. Same for `applyLensVignette` with `midpoint = 100` (±Infinity white blowout).
- `applyEdgeDetect` / `applyEmboss` left a 1px fully-transparent border (their loops never visit the outer ring); output now initializes from the source copy.
- `hexToRgb` returned NaN channels for short (`#f00`) or malformed strings (NaN → 0 → near-black fills); it now returns `null` and all call sites fall back.
- `generateThumbnail` divided by zero for degenerate canvases (ratio `Infinity` wrapped the temp canvas to 0×0); guarded.
- `contentAwareFill` only filled within 20px of the selection boundary — anything wider kept its original pixels while reporting success. Now an iterative boundary-inward fill (up to 12 passes).
- `newDocument(bg='transparent')` produced a **black** background (invalid CSS color silently ignored → default fillStyle); transparent backgrounds now skip the fill.

#### UI state (`PhotoEditor.tsx`, `MenuBar.tsx`, `NavigatorPanel.tsx`, `AutomationsPanel.tsx`, `VectorizeDialog.tsx`, `figma-import.ts`)
- Auto-fit zoom re-fit on **every** container resize (panel toggle, mobile keyboard) destroying the user's zoom/pan mid-edit; now only on first measurement or document-dimension change.
- Mobile Undo/Redo buttons read `getState()` in `disabled` — stale right after an edit (strokes mutate canvases without replacing `layers`). Now reactively subscribed to `historyIndex`/`history.length`.
- Window resize re-applied the default panel state on every event (destroying the user's explicit toggle); applied only when the mobile/desktop breakpoint is crossed.
- "Snap to Pixel Grid" toast reported the pre-toggle state (render-time snapshot); reads post-toggle state.
- Gaussian Blur… / Image Size… prompts accepted unbounded values (radius 1e9, 999999×999999); clamped (radius ≤ 50, canvas limits).
- The Recipes JSON textareas reverted the user's in-progress typing to the last valid serialization on any sibling re-render; they now hold local raw text (React's adjust-state-during-render pattern).
- Figma import decoded each frame image twice (once for the data URL, once for dimensions); loads once.
- SVG export revoked its object URL synchronously after `click()` (can cancel the download in Firefox); revoke deferred.
- `reorderLayers` spliced `undefined` into the layers array on out-of-range indices (stale drag racing a deletion); indices validated.

#### Selection Performance Cliff (`EditorCanvas.tsx`)
- **Root cause**: with a selection active, every pointermove re-rendered the whole component and re-ran the full overlay redraw; drags called `setSelection` per move (full-document canvas allocation + store update + contour re-trace per event); the overlay canvas backing store was reallocated on every redraw; and each marching-ants redraw issued one `stroke()` call per contour segment × 2 passes at 15fps.
- Measured on a 1280×720 doc with a drag at ~1250 events/s: average frame time **84ms → 16.6ms (≈12fps → 60fps)**, worst frame **200ms → 16.8ms**, long frames 29/30 → 0/151.
- Marching-ants contour is now cached as a single `Path2D` (rebuilt only when the mask reference or bounds change) — a redraw costs two `stroke()` calls instead of one per segment.
- `drawOverlay` reads the cursor through a ref (cursorPos no longer in its deps), so mouse movement no longer recreates the callback, re-runs the redraw effect, or tears down the animation loop.
- Status-bar cursor readout is throttled to ~12/s (drawn from a ref), so the component no longer re-renders on every pointermove.
- Overlay canvas dimensions are only reassigned when they actually change (assigning `width`/`height` — even the same value — reallocates and clears the backing store).
- Marquee and crop drags draw a live dashed preview directly on the overlay; the selection mask is committed once on pointer-up instead of per pointermove.
- Move tool: the marching ants follow the drag via a translate of the cached contour; the translated mask is committed once on pointer-up.
- Clicking a marquee tool without dragging now clears the selection (matches standard editor behaviour).

#### Marching-Squares Trace Corrupted by Float Bounds (`EditorCanvas.tsx`)
- `marchSquaresContour` indexed its typed array with `(j * w + i)` where `w` came from float pointer coordinates: fractional indices read `undefined`, so only rows/columns whose arithmetic happened to land on integers were traced — a garbled (often invisible) contour for any float-bounds selection.
- The trace window is now integer-aligned (`floor` origin, `ceil` extent), producing correct contours for marquee/lasso selections; the function was also moved to module scope (fixes `no-use-before-define`).

#### Selection Mask Actions Never Refreshed the UI (`editor-store.ts`)
- `invertSelection`, `featherSelection`, `expandSelection`, `contractSelection` mutated the mask canvas in place and stored the same reference — zustand subscribers (and the contour cache) compare by reference, so the marching ants never updated after these operations.
- All four now write into a fresh canvas and swap the reference; bounds widen to the full document where the operation can extend beyond the old bounds (invert/feather/expand).
- `invertSelection` previously inverted the RGB channels and kept alpha — a functional no-op, since selection semantics (clipping and contour tracing) are driven purely by the alpha channel. It now inverts alpha.

#### Pre-existing Type Errors (`editor-store.ts`, `AdjustmentsPanel.tsx`)
- `mergeVisibleLayers` / `flattenImage`: new layers were missing required `maskCanvas` / `maskEnabled` fields.
- `pushHistory`: removed stray `timestamp` property not present on `HistoryEntry`.
- 19 `Slider` `onValueChange` handlers passed a `Dispatch<SetStateAction<number>>` where `(value: number[]) => void` is expected — wrapped with `(v) => setter(v[0])`.

#### Lasso Overlay Rendering (`EditorCanvas.tsx`)
- Marching-squares contour trace in `drawOverlay()` replaces bounding-box `strokeRect` for lasso, polygonal lasso, magnetic lasso, and magic wand selection paths
- `strokeRect` preserved for marquee-rect and marquee-ellipse (correct for those tools)

#### Move Tool (`EditorCanvas.tsx`)
- Snapshots active layer pixels on pointerdown
- Live offset redraw on pointermove
- Commits with `pushHistory('Move')` on pointerup
- Selection bounds translate with content

### 🚀 Added

#### Canvas Snapshot MCP Tool (`mcp/server.ts`, `src/lib/agent/tools.ts`)
- `getCanvasSnapshot` — returns current workspace composite as base64 JPEG + metadata (docWidth, docHeight, zoom, activeLayerId, layerCount)
- MCP response includes an image content block for compatible clients (Claude Desktop, Claude Code)
- Reuses `compositeWorkspace` + `scaleCanvasToMax` helpers

#### Recipe MCP Tools (`mcp/server.ts`, `src/lib/agent/tools.ts`)
- `saveRecipe(name, steps)` — persist automation recipe to `useAutomationsStore`
- `listRecipes` — return all saved recipes with step count and timestamps
- `runRecipe(name)` — execute recipe steps via `executeTool` loop
- `deleteRecipe(name)` — remove a saved recipe
- All four skip the browser WebSocket — handled entirely server-side

#### Figma Import Dialog (`src/lib/figma/figma-import.ts`, `src/components/editor/FigmaImportDialog.tsx`)
- **`figma-import.ts`** — API client with two endpoints: `fetchFigmaFileInfo(fileKey, token)` (nodes + metadata) and `importFigmaFrames(fileKey, token, frameIds)` (downloads frame PNGs via Figma image renders)
- **`FigmaImportDialog.tsx`** — PAT v1 authentication, file key input, live frame selector with thumbnails, progress bar, result summary
- Wired into **MenuBar.tsx** (File → Import from Figma...) and **PhotoEditor.tsx** (state + dialog mount)

---

## [0.3.0] — 2026-07-19

Three big changes in this release: a long-standing **magnetic lasso bug** is
fixed, the **mobile layout is redesigned from scratch**, and the **Luna AI
agent** gets two new capabilities — **vision self-evaluation** (the agent
reviews its own work before showing it to you) and **preference memory** (the
agent learns your taste from accept/reject decisions).

### 🐛 Fixed

#### Magnetic Lasso (`EditorCanvas.tsx`)

The magnetic lasso was effectively broken — it behaved almost identically to
the regular lasso and would freeze the UI on large documents.

- **Root cause 1: Sobel edge threshold too high.** The threshold was 1000
  (squared gradient), which required a gradient magnitude of ~32 per channel
  to trigger snapping. Most real photographic edges have a gradient of ~7–15,
  so the lasso almost never snapped. Lowered to **50** so soft edges trigger
  snapping.
- **Root cause 2: Green-channel-only luminance.** The Sobel operator was run
  on the green channel alone, missing red-dominant and blue-dominant edges.
  Rewrote to use proper **BT.601 luminance** (`0.299R + 0.587G + 0.114B`)
  via an integer-math pre-compute pass.
- **Root cause 3: Per-move `setSelection()` allocation.** Every pointermove
  event was calling `setSelection()`, which allocated a full-document canvas
  each time. On a 4000×3000 document that's ~48MB per move event × ~60 events
  per second = guaranteed UI freeze. Removed — the selection mask is now
  created **only on pointerup**. The overlay (cheap) is redrawn on every
  move for live feedback.
- **Root cause 4: Self-snapping.** `snapToEdge` was reading from the live
  composite canvas, which included the overlay preview line — so the lasso
  could snap to its own trail. Fixed by snapshotting the composite canvas at
  gesture start (`magneticSampleRef`) and reading from the snapshot.
- **Added click-to-add manual anchor points** (Photoshop's standard UX).
  Click without dragging adds a manual anchor at the snapped position; drag
  to use auto-snap as before.
- **Added close-on-click-near-start** (within 14px of the start anchor, with
  ≥4 points) — same UX as the polygonal lasso.
- **Added double-click anywhere** to close the path.
- **Added `Enter` key** to commit the path; **`Escape`** to cancel (same UX
  as the pen tool).
- **Added visual feedback**: pulsing green start-anchor square with a
  transparent halo showing the close-zone, plus small green dots at every
  snapped anchor so the user can see where the lasso has locked onto edges.
- **Animation loop** now also runs when the magnetic lasso is in-progress
  (so the pulsing anchor animates) — previously it only ran when there was
  a selection mask.

#### Mobile Lasso (`PhotoEditor.tsx`)

The mobile toolbar only had a single "lasso" button that selected the
regular lasso. Users had no way to access the polygonal or magnetic variants
from mobile — this is what was meant by "overlaps with normal lasso and is
just broken".

- **All 3 lasso variants are now distinct, labelled buttons** under a
  "Select" category in the mobile toolbar: **Lasso** (lasso icon), **Poly**
  (spline icon), **Magnet** (pen-tool icon).
- Each tool button is **56×48px** (well above the 44px touch-target
  minimum) with a readable **10px label**.

### 🚀 Added

#### Luna Vision Self-Evaluation (`gemini-client.ts`, `agent-runner.ts`)

The agent's tool-calling model only gets text back from the tools — it can't
natively "see" whether its edit accomplished what the user asked. The
self-evaluation step bridges this gap.

- **`evaluateEditQuality()` in `gemini-client.ts`** sends the BEFORE + AFTER
  images to Gemini Vision with a strict QA prompt asking for a **1–10
  quality score + reasoning**.
- Uses **JSON mode** (`responseMimeType: 'application/json'`) for reliable
  parsing. The `parseSelfEvalResponse()` helper is defensive — handles
  malformed JSON, extra prose, missing fields, always returns a valid
  `SelfEvalResult`.
- **Model selection**: the user's selected model might be Flash-Lite
  (chosen for cost during the tool-calling loop), but for self-eval we want
  the best vision quality we can get. `pickVisionModel()` upgrades
  Flash-Lite → Flash, keeps Pro as Pro. Falls back to the user's selected
  model if the vision model is unavailable, and to a permissive default
  (score 8) on network error so the preview is never blocked.
- **Retry loop**: if the self-eval score is below `SELF_EVAL_THRESHOLD` (7),
  the runner **resets the workspace to the original snapshot** and re-runs
  the tool-calling loop with feedback (the score + reasoning prepended to
  the prompt). Up to `MAX_SELF_EVAL_RETRIES` (2) retries.
- **Best-attempt tracking**: across retries, the runner tracks the
  highest-scoring attempt (its text, after-image, workspace, score,
  reasoning, attempt number). If all retries fail to clear the threshold,
  the **best** attempt is shown to the user — never the last attempt, which
  might be worse than the first.
- **New `AgentRunStatus`**: `'self-evaluating'` — the UI shows a pulsing
  brain icon + "Reviewing my edit..." during the vision call.
- **System prompt update**: warns the model that its edit will be
  self-reviewed, with guidance on how to avoid retries (visible edit, right
  region, don't overshoot).

#### Luna Preference Memory (`agent-store.ts`, `agent-runner.ts`)

Every Accept and Reject now records a `PreferenceEntry` to `localStorage`
so the agent can adapt to the user's taste over time.

- **`PreferenceEntry`** fields: `id`, `ts`, `userRequest`, `agentAction`,
  `toolCalls[]`, `decision` (`accepted`/`rejected`), `selfScore`, 
  `selfReasoning`.
- **Persisted** to `localStorage` under `pixel-lab-agent-preferences` key,
  capped at **50 entries** (~100KB max). Older entries are pruned on
  append.
- **`buildPreferenceSummary()`** derives a short textual profile from the
  entry history (3–8 lines): overall accept rate, most-accepted/most-
  rejected tool types (with counts), self-eval agreement rate, and the
  last 3 accepted + last 2 rejected examples verbatim.
- **Injected into the system prompt** on every `runAgent()` call as
  "USER PREFERENCE MEMORY" — the agent adapts its tool selection and
  parameters to what the user has accepted in the past.
- **Self-eval agreement rate**: the summary also reports how often the
  agent's self-eval score agreed with the user's decision (self-score ≥7 →
  predicted accept; <7 → predicted reject). This is a **calibration
  signal** — if the agreement rate drops, the self-eval prompt needs
  tuning.
- **`commitPreview()`** records `'accepted'` entries; **`rejectPreview()`**
  records `'rejected'` entries. Both include the self-eval score/reasoning
  from the current run.
- **`PendingPreview` interface** extended with `userRequest` and
  `toolCallLabels` so commit/reject handlers can record a preference entry
  with full context.

#### Luna UI Updates (`AgentPanel.tsx`)

- **Brain icon in the Luna header** showing the accept count / total (e.g.
  "2/3"). Click to expand the new **`PreferenceMemoryPanel`**.
- **`PreferenceMemoryPanel`** shows: accept rate %, accepted count,
  rejected count, self-eval agreement %, last 3 recent examples (with ✓/✗
  and self-score), and a "Clear memory" button.
- **During self-eval**, the status line shows a **pulsing Brain icon** +
  "Reviewing my edit..." (instead of the spinning loader).
- **`PreviewDiff` now displays the self-eval result** above the Accept/Reject
  buttons: the agent's self-score (color-coded: green ≥7, amber 5–6, red
  <5), the reasoning, an "(after N retries)" indicator if retries happened,
  and a "⚠ Below quality threshold" badge if applicable.
- **Empty state** updated to describe both new features: "Self-reviewing"
  (vision model reviews work before showing) and "Learns your taste"
  (remembers Accept/Reject and adapts).
- **PreviewDiff footer** updated to teach the user: "Your Accept/Reject
  teaches the agent what you like. It remembers and adapts."

#### Mobile Layout Redesign (`PhotoEditor.tsx`)

The old mobile layout had a cramped title bar, tiny 48px tool buttons with
8px labels, and floating Panels + Luna buttons that overlapped each other
and the canvas zoom controls. **Redesigned from scratch:**

- **Title bar**: mobile now shows only Menu, Brand+DocName (centered),
  Undo, Redo, Export, Theme. Vectorize/Perf/MCP/Shortcuts/Panels buttons
  are desktop-only on the title bar (still accessible via the menu sheet).
  Title bar height increased to **40px** on mobile (from 32px) for better
  touch ergonomics.
- **New 2-row bottom toolbar** (`MobileToolbar`):
  - **Row 1**: horizontal-scrollable category strip (Select / Paint /
    Shapes / Pen / Liquify / View) + sticky right-end with **Panels** and
    **Luna** buttons (no more floating buttons that overlap).
  - **Row 2**: sticky color swatches (foreground, swap, background) on
    the left + horizontally-scrollable tool buttons for the active
    category.
- **`MOBILE_TOOL_GROUPS`** constant: 6 categories with all 40 tools
  organized into them. The Select category exposes all 3 lasso variants
  as distinct buttons.
- **Removed** the floating "Open Panels" button (now in the toolbar's
  right-end).
- **Removed** the mobile Luna floating bubble (now in the toolbar's
  right-end). Desktop Luna bubble unchanged.
- **All mobile buttons are 36–48px** in their smaller dimension,
  satisfying the 44px touch-target guideline.
- **Removed `toolbarCollapsed` state** (replaced by `mobileCategory` state
  for the category strip).

### 📚 Documentation

- **README.md**: updated Luna section with self-eval + preference memory
  description; updated roadmap (marked new features as shipped); updated
  project structure to reflect new module descriptions; added CHANGELOG to
  the documentation table.
- **ARCHITECTURE.md**: rewrote the AI Editing Agent section with the new
  self-eval + retry mermaid diagram, added "Self-Evaluation" and
  "Preference Memory" subsections, updated the security model table to
  include preference memory storage, updated extension points.
- **EXTENSIONS.md**: expanded the Luna section with self-eval + preference
  memory descriptions; added new future extension points (tunable
  self-eval threshold, per-tool preference breakdown UI).
- **SECURITY_NOTES.md**: added a new "Preference memory (localStorage)"
  section with a field-by-field breakdown of what's stored, what's NOT
  stored, capacity, clearing instructions, and an explanation of why
  preference memory is in localStorage but the API key isn't. Updated
  network calls section to mention the self-eval call. Updated
  limitations, "what you can do", and future extension points.
- **CONTRIBUTING.md**: updated the agent file descriptions in the project
  structure; added security considerations for self-eval + preference
  memory; added a new "Testing Self-Evaluation + Preference Memory"
  subsection with 7 test steps; added 5 new items to the PR test
  checklist.
- **worklog.md**: appended three new entries — `bugfix-lasso-mobile-v1`,
  `agent-self-eval-and-preference-memory-v1`, and `docs-update-v1`.

### 🧪 Verification

- **Lint passes** with 0 errors, 0 warnings.
- **Dev server** compiles and serves HTTP 200.
- **Magnetic lasso verified** via `agent-browser` + vision model: green
  snapped path with anchor dots visible during drag; marching-ants
  selection appears on release; confirmed on both desktop (1280×800) and
  mobile (390×844) viewports.
- **Polygonal lasso verified**: 4-corner click-then-close-to-start
  produces a clean rectangular selection.
- **Mobile layout verified**: all 3 lasso variants visible after
  horizontal scroll; no overlapping UI; 44px+ touch targets throughout.
- **Preference memory panel verified**: seeded 3 test entries via
  localStorage; the panel rendered correctly with 67% accept rate, 2
  accepted, 1 rejected, 100% self-eval agreement (3/3), and the 3 recent
  examples with ✓/✗ indicators and self-scores. Confirmed by vision
  model.
- **Empty state verified**: shows both new feature descriptions
  ("Self-reviewing" and "Learns your taste").
- **No runtime errors** in the browser console.

### ⚠️ Notes

- The self-eval + retry loop adds **1 extra vision API call per attempt**
  (so 1–3 calls per agent run depending on retry behavior). This is a
  deliberate trade-off — the extra cost only happens when the edit is bad,
  and the user sees fewer garbage results. Users on the free Gemini tier
  should be aware of the increased quota usage.
- Preference memory is **always-on** but clearable via the "Clear memory"
  button. An opt-out toggle is a future extension point.
- The self-eval threshold is **fixed at 7/10**. A user-tunable setting is
  a future extension point.

---

## [0.2.0] — earlier

- Luna with 16 tools (filters, develop, selection, drawing, text, bucket
  fill)
- Offscreen workspace preview with Accept/Reject
- 4 drawing tools (`drawShape`, `drawBrushStroke`, `addText`, `fillBucket`)
  accepting any CSS color
- Vectorization (raster → SVG)
- Auto light/dark mode detection
- Mobile-responsive layout (v1 — replaced in 0.3.0)
- MCP server for external AI agent integration
- Automation recipes

---

## [0.1.0] — initial release

- 40 tools across 6 categories (Selection, Painting, Pen & Vector, Shapes,
  Liquify, View)
- Layers with non-destructive masks, 16 blend modes, adjustment layers
- Lightroom-style develop panel (5 sections, 17 parameters)
- 25+ filters (blur, sharpen, denoise, artistic, edge, texture, smart)
- LUT color grading (.cube file import)
- Content-aware fill, auto background remove, auto unblur
- Symmetry mode (none/horizontal/vertical/quad/mandala)
- Rulers, guides, grid, navigator panel
- Performance optimization (scanline flood fill, LUT filters, shadow-blur
  soft brush, JPEG history snapshots, throttled marching ants)
- 7-step onboarding tour + 12-step interactive tutorial
- 24 document templates
- Export to PNG, JPEG, WebP, GIF, SVG
- 100% client-side — no cloud dependency
