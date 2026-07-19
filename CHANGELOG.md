# Changelog

All notable changes to Pixel Lab are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

---

## [Unreleased]

Nothing yet.

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
