# Pixel Lab — App Bundle Setup

This zip contains the **complete Pixel Lab source code** (v0.3.0) without
`node_modules`, `.next`, or `.git` (those are regeneratable and would have
made the zip 1.4GB instead of 4.3MB).

## What's included

- Full `src/` source (Next.js 16 + TypeScript + Tailwind 4)
- `public/` assets (logo, screenshots)
- `mcp/` server (for external AI agent integration)
- `examples/` (websocket server + frontend)
- `scripts/` (development screenshot artifacts — safe to delete)
- All documentation (README, ARCHITECTURE, EXTENSIONS, CONTRIBUTING,
  SECURITY_NOTES, CHANGELOG, INDEX, worklog)
- `package.json`, `bun.lock`, `package-lock.json`, tsconfig, next.config,
  tailwind.config, postcss.config, eslint.config, components.json
- `.github/` (issue templates, PR template, dependabot, code of conduct)
- `.zscripts/` (convenience shell scripts for dev/build/start)
- `Caddyfile` (sample reverse-proxy config for self-hosting)

## What's NOT included (regeneratable)

- `node_modules/` — install with `bun install` or `npm install`
- `.next/` — build with `bun run build`
- `.git/` — re-clone from https://github.com/touhidsiddiqueeraj-bit/Pixel-Lab
  if you need git history


## Quick start

```bash
# 1. Extract the zip
unzip pixel-lab-app.zip
cd Pixel-Lab

# 2. Install dependencies (bun recommended — faster)
bun install
# or: npm install

# 3. Start the dev server
bun run dev
# or: npm run dev

# 4. Open http://localhost:3000
```

The first compile takes ~5 seconds (Turbopack); subsequent hot-reloads are
<200ms.

## Production build

```bash
bun run build
bun run start
```

The app is a standard Next.js application with `output: "standalone"` and
can be deployed to Vercel, Netlify, or any Node.js host. All image
processing is 100% client-side — no server-side processing required.

## What's new in v0.3.0

See [CHANGELOG.md](CHANGELOG.md) for the full changelog. Highlights:

- **Magnetic Lasso fixed** — proper BT.601 luminance + lowered Sobel
  threshold for reliable edge snapping; click-to-add manual anchors;
  double-click / Enter to close; pulsing start-anchor + snapped-point
  visual feedback.
- **Mobile layout redesigned from scratch** — 2-row bottom toolbar
  (category strip + tool strip) with all 3 lasso variants as distinct
  buttons, sticky color swatches, integrated Panels + Luna buttons.
- **Luna vision self-evaluation** — after tool calls, a vision model
  reviews BEFORE/AFTER and scores the edit 1–10. Scores <7 trigger
  automatic retry with feedback (up to 2 retries).
- **Luna preference memory** — Accept/Reject decisions are recorded to
  `localStorage` and summarized into the system prompt on subsequent
  runs. Luna adapts to your taste over time.

## Documentation

Suggested reading order (see [INDEX.md](INDEX.md) for the full guide):

1. **README.md** — project overview, features, getting started
2. **CHANGELOG.md** — what's new in this version
3. **ARCHITECTURE.md** — system design, data flow, Luna loop
4. **EXTENSIONS.md** — programmatic extension (MCP, automations, new tools)
5. **CONTRIBUTING.md** — if you want to contribute code
6. **SECURITY_NOTES.md** — read before entering your Gemini API key

## License

MIT — see [LICENSE](LICENSE).

## Links

- **Live demo:** https://pixel-lab-jade.vercel.app/
- **Repository:** https://github.com/touhidsiddiqueeraj-bit/Pixel-Lab
