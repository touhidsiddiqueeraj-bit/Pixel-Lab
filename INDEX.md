# Pixel Lab — Documentation Bundle

**Bundle date:** 2026-07-20
**Pixel Lab version:** 0.4.0
**Bundle contents:** All project documentation, updated to reflect the
lasso overlay fix, move tool fix, canvas snapshot MCP tool, recipe MCP
tools, and Figma import dialog.

## What's in this bundle

| File | Purpose |
|---|---|
| `README.md` | Project overview, features, getting started, usage. Start here. |
| `ARCHITECTURE.md` | System design, data flow diagrams, canvas rendering engine, Luna loop (incl. self-eval + preference memory), performance system, extension points. |
| `EXTENSIONS.md` | How to create automation recipes, connect external AI agents via MCP, add new tools, and extend Pixel Lab programmatically. |
| `CONTRIBUTING.md` | Dev setup, coding standards, how to add new tools / filters / agent tools, PR process, test scripts. |
| `SECURITY_NOTES.md` | Honest disclosure of Luna API key handling + preference memory storage — what's safe, what isn't, what you can do. |
| `CHANGELOG.md` | Notable changes per release. This bundle's version (0.4.0) covers the lasso overlay fix, move tool fix, canvas snapshot MCP tool, recipe MCP tools, and Figma import dialog. |
| `worklog.md` | Append-only development log — three most recent entries cover the bugfixes and new features in this bundle. |

## What changed in this update (v0.4.0)

### 🐛 Fixed
- **Lasso Overlay** — marching-squares contour trace replaces bounding-box
  `strokeRect` for lasso, polygonal lasso, magnetic lasso, and magic wand
  selection paths. `strokeRect` preserved for marquee-rect and marquee-ellipse.
- **Move Tool** — snapshots active layer pixels on pointerdown, live offset
  redraw on pointermove, commits with `pushHistory('Move')` on pointerup.
  Selection bounds translate with content.

### 🚀 Added
- **Canvas Snapshot MCP Tool** — `getCanvasSnapshot` returns the workspace
  composite as base64 JPEG + doc metadata (docWidth, docHeight, zoom,
  activeLayerId, layerCount). MCP image content block for compatible clients.
- **Recipe MCP Tools** — `saveRecipe`, `listRecipes`, `runRecipe`,
  `deleteRecipe` for headless automation management. All four handled
  entirely server-side (no WebSocket).
- **Figma Import** — File → Import from Figma with PAT v1 authentication,
  file key input, live frame selector with thumbnails, progress bar, and
  result summary. Imports selected frame as a new layer.

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
