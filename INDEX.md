# Pixel Lab — Documentation Bundle

**Bundle date:** 2026-07-19
**Pixel Lab version:** 0.3.0
**Bundle contents:** All project documentation, updated to reflect the
magnetic lasso fix, mobile layout redesign, and Luna self-evaluation +
preference memory features.

## What's in this bundle

| File | Purpose |
|---|---|
| `README.md` | Project overview, features, getting started, usage. Start here. |
| `ARCHITECTURE.md` | System design, data flow diagrams, canvas rendering engine, Luna loop (incl. self-eval + preference memory), performance system, extension points. |
| `EXTENSIONS.md` | How to create automation recipes, connect external AI agents via MCP, add new tools, and extend Pixel Lab programmatically. |
| `CONTRIBUTING.md` | Dev setup, coding standards, how to add new tools / filters / agent tools, PR process, test scripts. |
| `SECURITY_NOTES.md` | Honest disclosure of Luna API key handling + preference memory storage — what's safe, what isn't, what you can do. |
| `CHANGELOG.md` | Notable changes per release. This bundle's version (0.3.0) covers the magnetic lasso fix, mobile redesign, and Luna self-eval + preference memory. |
| `worklog.md` | Append-only development log — three most recent entries cover the bugfixes and new features in this bundle. |

## What changed in this update (v0.3.0)

### 🐛 Fixed
- **Magnetic Lasso** — root cause was a combination of: Sobel edge threshold
  too high (1000 → 50), green-channel-only luminance (now proper BT.601),
  per-move `setSelection()` allocation (removed — mask only created on
  pointerup), and self-snapping to the overlay trail (fixed via snapshot).
  Added click-to-add manual anchors, double-click / Enter to close,
  Escape to cancel, and pulsing start-anchor + snapped-point visual feedback.
- **Mobile Lasso** — the mobile toolbar only had a single "lasso" button.
  Now all 3 lasso variants (Lasso, Poly, Magnet) are distinct, labelled
  buttons under a "Select" category.

### 🚀 Added
- **Luna Vision Self-Evaluation** — after tool calls, a vision model
  reviews BEFORE/AFTER images and scores the edit 1–10. Scores below 7
  trigger an automatic retry with feedback (up to 2 retries). Bad edits
  are caught before the user sees them.
- **Luna Preference Memory** — Accept/Reject decisions are recorded to
  `localStorage` and summarized into the system prompt on subsequent runs.
  Luna adapts to your taste over time.
- **Mobile Layout Redesign** — 2-row bottom toolbar (category strip + tool
  strip) with sticky color swatches and integrated Panels/Luna buttons
  (no more floating overlap). 44px+ touch targets throughout.

## How to read these docs (suggested order)

1. **README.md** — get the big picture and try the app
2. **CHANGELOG.md** — see what's new in this version
3. **ARCHITECTURE.md** — understand how it works under the hood
4. **EXTENSIONS.md** — if you want to extend Pixel Lab programmatically
5. **CONTRIBUTING.md** — if you want to contribute code
6. **SECURITY_NOTES.md** — if you're using the Luna AI agent (read before
   entering your API key)
7. **worklog.md** — for the full development history

## Quick links

- **Live demo:** https://pixel-lab-jade.vercel.app/
- **Repository:** https://github.com/touhidsiddiqueeraj-bit/Pixel-Lab
- **License:** MIT (see `LICENSE` in the repo)
