# Extensions & External Integration

This document covers how to extend Pixel Lab programmatically — both from
within the app (automation recipes) and from external clients (MCP server,
AI agents, third-party tools).

## Table of Contents

- [Overview](#overview)
- [Automation Recipes (Internal)](#automation-recipes-internal)
  - [Creating a Recipe via the UI](#creating-a-recipe-via-the-ui)
  - [Creating a Recipe Programmatically](#creating-a-recipe-programmatically)
  - [Running Recipes](#running-recipes)
  - [Batch Mode](#batch-mode)
- [MCP Server (External)](#mcp-server-external)
  - [Architecture](#architecture)
  - [Starting the MCP Server](#starting-the-mcp-server)
  - [Connecting an MCP Client](#connecting-an-mcp-client)
    - [Claude Desktop](#claude-desktop)
    - [Claude Code](#claude-code)
    - [Custom MCP Client](#custom-mcp-client)
  - [Available Tools](#available-tools)
  - [How Tool Calls Reach the Browser](#how-tool-calls-reach-the-browser)
- [The Tool Execution Layer (Shared)](#the-tool-execution-layer-shared)
  - [TOOL_DECLARATIONS](#tool_declarations)
  - [executeTool](#executetool)
  - [AgentWorkspace](#agentworkspace)
- [Adding a New Tool](#adding-a-new-tool)
- [Luna AI Agent (Gemini)](#luna-ai-agent-gemini)
- [Future Extension Points](#future-extension-points)

---

## Overview

Pixel Lab has three extension surfaces, all built on the same tool execution
layer:

| Surface | Who calls it | How | Transport |
|---|---|---|---|
| **Automation Recipes** | The user (inside Pixel Lab) | Save a fixed sequence of tool calls, run with one click | Direct JS call |
| **Luna AI Agent** | Google Gemini (model decides tool calls) | User types a natural-language prompt, Gemini translates to tool calls | Gemini API → browser |
| **MCP Server** | Any external MCP client (Claude Desktop, etc.) | Client sends `tools/call` JSON-RPC, server forwards to browser | stdio + WebSocket |

All three call the same `executeTool(toolName, args, workspace)` function from
`src/lib/agent/tools.ts`. No tool logic is duplicated.

---

## Automation Recipes (Internal)

Automation recipes are user-authored, deterministic sequences of editor
operations. No AI involved — the user picks tools and params manually, saves
the sequence, and runs it with one click.

### Creating a Recipe via the UI

1. Open the **Recipes** tab (right panel, amber icon).
2. Enter a recipe name (e.g. "Warm Portrait Look").
3. Click the **Add Step** dropdown and select a tool (e.g. `adjustDevelop`).
4. Fill in the tool's parameters in the auto-generated form.
5. Click **Add Step** to append it to the list.
6. Repeat for each step (e.g. `adjustDevelop(color, vibrance, 25)` →
   `applyFilter(vignette, {amount: 40, size: 50})`).
7. Click **Save Recipe** to persist to localStorage.

Steps can be reordered (chevron up/down) and individually deleted. Saved
recipes appear in the "Saved Recipes" list with Run / Edit / Delete actions.

### Creating a Recipe Programmatically

```typescript
import { useAutomationsStore } from '@/lib/automations/automations-store';

const store = useAutomationsStore.getState();
const id = store.addAutomation('Warm Portrait', [
  { toolName: 'adjustDevelop', args: { section: 'color', param: 'vibrance', value: 25 } },
  { toolName: 'applyFilter', args: { filterType: 'vignette', params: { amount: 40, size: 50 } } },
]);
```

Recipes are persisted to `localStorage` under the key `pixel-lab-automations`.

### Running Recipes

**On the current document:**

```typescript
import { runAutomationOnCurrentDoc } from '@/lib/automations/automation-runner';

const result = await runAutomationOnCurrentDoc(steps, 'Warm Portrait');
// → { success: true, message: 'Recipe "Warm Portrait" completed (2 steps).', stepResults: [...] }
```

This snapshots the live editor state into an offscreen workspace, runs each
step via `executeTool`, and commits the result back to the live store with
a single history entry (so Ctrl+Z undoes the whole recipe).

**From a saved recipe:**

Click the **Run** button (play icon) next to any saved recipe in the Recipes
panel.

### Batch Mode

Batch mode runs a recipe across multiple files without touching the live
document:

1. Click **Run on Batch** in the Recipes panel.
2. Select multiple image files.
3. Each file is loaded into a fresh workspace, all steps run, and the result
   is exported as a PNG download.

Per-file progress is shown in a list (queued → processing → done/error).
A step failure on one file does NOT abort the rest — failures are logged and
summarized at the end.

```typescript
import { runAutomationBatch } from '@/lib/automations/automation-runner';

const results = await runAutomationBatch(files, steps, (index, result) => {
  console.log(`File ${index}: ${result.success ? 'done' : 'failed'}`);
});
```

---

## MCP Server (External)

The MCP (Model Context Protocol) server exposes Pixel Lab's tool set to
external clients. Any MCP-compatible client can call Pixel Lab's editing
tools — Claude Desktop, Claude Code, Cursor, or custom agent frameworks.

### Architecture

```
┌─────────────────┐    stdio     ┌─────────────────┐    WebSocket    ┌─────────────────┐
│  MCP Client     │◄────────────►│  MCP Server     │◄───────────────►│  Pixel Lab      │
│  (Claude, etc.) │   JSON-RPC   │  (port 3004)    │   tool calls    │  browser tab    │
└─────────────────┘              │                 │   + responses   │  (executeTool)  │
                                 └─────────────────┘                  └─────────────────┘
```

- The **MCP server** (`mcp/server.ts`) is a local Node/Bun process that
  speaks JSON-RPC 2.0 over stdio with the MCP client, and raw JSON over a
  WebSocket (port 3004) with the browser.
- The **browser** auto-connects to `ws://localhost:3004` via the
  `useMcpBridge()` hook in `src/lib/automations/mcp-client.ts`. When a tool
  call arrives, it runs `executeTool` against the current document and sends
  the result back.
- The **MCP status indicator** (small dot in the title bar) shows connection
  state: green = connected, amber = connecting, gray = offline.

### Starting the MCP Server

```bash
# From the project root:
bun run mcp/server.ts

# Or with Node:
npx tsx mcp/server.ts
```

The server starts listening on:
- **stdio** — for the MCP client (JSON-RPC 2.0)
- **ws://localhost:3004** — for the browser tab

You should see:
```
[mcp] WebSocket server listening on ws://localhost:3004
[mcp] MCP server ready. Waiting for client on stdin...
```

Open Pixel Lab in a browser — the MCP status dot turns green.

### Connecting an MCP Client

#### Claude Desktop

Add this to your Claude Desktop config file:

**macOS:** `~/Library/Application Support/Claude/claude_desktop_config.json`
**Windows:** `%APPDATA%\Claude\claude_desktop_config.json`

```json
{
  "mcpServers": {
    "pixel-lab": {
      "command": "bun",
      "args": ["/absolute/path/to/Pixel-Lab/mcp/server.ts"]
    }
  }
}
```

Restart Claude Desktop. You can now ask Claude to edit images in Pixel Lab:
- "Apply a vignette to the image in Pixel Lab"
- "Make the background blue in Pixel Lab"
- "Draw a red circle in the center of the canvas"

Claude will call the appropriate MCP tool, which forwards to the browser.

#### Claude Code

```bash
# Register the MCP server with Claude Code:
claude mcp add pixel-lab -- bun /absolute/path/to/Pixel-Lab/mcp/server.ts
```

Then in a Claude Code session:
```
> Use the pixel-lab MCP server to apply a grayscale filter to the current document
```

#### Custom MCP Client

Any client that speaks MCP JSON-RPC 2.0 over stdio can connect. The server
responds to:

| Method | Description |
|---|---|
| `initialize` | Returns server capabilities + protocol version |
| `tools/list` | Returns the full tool manifest (15 tools) |
| `tools/call` | Executes a tool call against the browser's current document |

Example `tools/call` request:
```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "method": "tools/call",
  "params": {
    "name": "applyFilter",
    "arguments": {
      "filterType": "grayscale"
    }
  }
}
```

Response:
```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "result": {
    "content": [{ "type": "text", "text": "{\"success\":true,\"message\":\"Applied Grayscale\"}" }],
    "isError": false
  }
}
```

### Available Tools

The MCP server exposes the same 15+ tools as Luna and automation recipes:

| Tool | Description |
|---|---|
| `applyFilter` | gaussianBlur, sharpen, sepia, grayscale, invert, posterize, pixelate, edgeDetect, emboss, addNoise, vignette |
| `adjustDevelop` | Lightroom-style: exposure, contrast, highlights, shadows, vibrance, saturation, etc. |
| `selectRegionByPoint` | Magic Wand at a normalized (x,y) point |
| `selectRegionByBox` | Rectangular marquee in normalized coords |
| `invertSelection` / `deselectAll` | Selection management |
| `contentAwareFill` | Fill selection with surrounding pixels |
| `autoBackgroundRemove` | Edge flood-fill background removal |
| `drawShape` | ellipse, rect, line, star, polygon, arrow, heart, speechBubble, spiral |
| `drawBrushStroke` | Freehand soft brush |
| `drawCalligraphy` | Calligraphy pen (angle-aware) |
| `drawScatterStroke` | Scatter/spray brush |
| `addText` | Render text with font, size, color |
| `fillBucket` | Paint-bucket flood fill |

All coordinates are normalized 0-1 (origin top-left). Colors are any CSS
color string (hex, named, rgb(), hsl()).

### How Tool Calls Reach the Browser

1. The MCP client sends a `tools/call` request via stdio.
2. The MCP server generates a `callId` and forwards the call as a WebSocket
   message: `{ type: 'tool-call', callId, name, args }`.
3. The browser's `useMcpBridge()` hook receives the message, snapshots the
   current editor state into a workspace, runs `executeTool(name, args, ws)`,
   and commits the result back to the live store (per-layer, preserving alpha).
4. The browser sends the result back: `{ type: 'tool-result', callId, success, result }`.
5. The MCP server matches the `callId` to the pending request and writes the
   JSON-RPC response to stdout for the MCP client.

If no browser tab is connected, the server returns an error: "No browser tab
connected." If the browser tab disconnects mid-call, the call is rejected.

---

## The Tool Execution Layer (Shared)

All three extension surfaces (Luna, automations, MCP) share the same tool
layer in `src/lib/agent/tools.ts`:

### TOOL_DECLARATIONS

An array of `GeminiFunctionDeclaration` objects — JSON-schema definitions for
each tool. This is the single source of truth for:
- The Luna system prompt (tells Gemini what tools exist)
- The MCP server's `tools/list` response (tells external clients what tools exist)
- The automation step builder's dropdown (tells the user what tools they can add)

### executeTool

```typescript
async function executeTool(
  toolName: string,
  args: Record<string, unknown>,
  ws: AgentWorkspace,
): Promise<ToolResult>
```

Provider-agnostic — it doesn't know whether the caller is Gemini, a saved
recipe, or an MCP client. It takes a tool name + args + a workspace, mutates
the workspace in place, and returns `{ success, message, thumbnailBase64? }`.

Every tool:
- Validates and clamps all params (never trusts the caller blindly)
- Respects the active selection (draws to a temp canvas, composites through
  the mask via `destination-in`)
- Returns a structured result

### AgentWorkspace

```typescript
interface AgentWorkspace {
  layers: LayerData[];          // Cloned layers (offscreen canvases)
  activeLayerId: string | null;
  docWidth: number;
  docHeight: number;
  selectionMask: HTMLCanvasElement | null;
  selectionBounds: { x, y, w, h } | null;
}
```

The workspace is a deep clone of the live editor state. All tool mutations
happen on the workspace — the live editor-store is never touched during
execution. On commit (Accept in Luna, completion in automations/MCP), the
workspace's layer canvases are copied back onto the corresponding live layers
**by ID**, preserving per-layer structure and alpha transparency.

---

## Adding a New Tool

1. Add the tool declaration to `TOOL_DECLARATIONS` in
   `src/lib/agent/tools.ts`:
   ```typescript
   {
     name: 'myNewTool',
     description: 'What this tool does and when to use it.',
     parameters: {
       type: 'object',
       properties: {
         x: { type: 'number', description: 'Normalized X (0-1).' },
       },
       required: ['x'],
     },
   }
   ```

2. Add a `case 'myNewTool':` block to the `executeTool` switch. **Wrap an
   existing function** — don't reimplement logic:
   ```typescript
   case 'myNewTool': {
     const xn = clamp(num(args.x, 0.5), 0, 1);
     const px = Math.round(xn * ws.docWidth);
     const layer = getActiveLayer(ws);
     if (!layer) return { success: false, message: 'No active layer.' };
     const ctx = layer.canvas.getContext('2d')!;
     // Call existing function:
     applyMyExistingFilter(ctx, ws.docWidth, ws.docHeight, px);
     return { success: true, message: `My tool applied at x=${xn}`, thumbnailBase64: generateThumbnail(layer.canvas, 64) };
   }
   ```

3. Add a `case` to `describeToolCall()` for the chat chip label.

4. Update the Luna system prompt in `src/lib/agent/agent-runner.ts`.

5. Update the MCP server's `TOOLS` array in `mcp/server.ts` (static copy —
   the MCP server can't import from the Next.js bundle).

6. The automation step builder will automatically pick up the new tool from
   `TOOL_DECLARATIONS` — no UI changes needed.

See [CONTRIBUTING.md → Adding a New Agent Tool](CONTRIBUTING.md#adding-a-new-agent-tool)
for more details.

---

## Luna AI Agent (Gemini)

Luna is the built-in AI editing assistant — a Copilot-Chat-style panel that
translates natural-language prompts into tool calls via Google's Gemini API.

- **No backend**: Luna calls Google's Gemini API directly from the browser.
  The API key lives only in JS memory (never persisted to localStorage).
- **Offscreen preview**: Every edit runs on a cloned workspace. The user
  sees a before/after preview and must click Accept (commits to history) or
  Reject (discards without touching history).
- **Access**: Click the floating ✨ button at the bottom-right, or use the
  "Luna" tab in the right panel.

See [SECURITY_NOTES.md](SECURITY_NOTES.md) for API key handling details.

---

## Future Extension Points

- **Server-side execution (headless)**: Port the Canvas-based tool execution
  to run server-side (e.g. via `node-canvas`) so the MCP server can execute
  edits without any browser involved. Bigger lift, but means the editing
  engine becomes usable completely outside the browser.
- **Record while editing (v2 automations)**: Hook into the editor-store
  action dispatch so manual edits can optionally be captured as automation
  steps in real time. Lower friction than hand-writing params.
- **Per-step accept/reject for Luna**: Currently Luna produces a single
  combined preview per turn. A future config option could allow per-step
  review.
- **Sandboxed in-app plugins**: A plugin API for community-authored filters
  running inside Pixel Lab's UI. Considered and rejected for v1 (depends on
  a contributor community) — may revisit if the project grows.

---

For architecture details, see [ARCHITECTURE.md](ARCHITECTURE.md).
For contribution guidelines, see [CONTRIBUTING.md](CONTRIBUTING.md).
For security disclosure, see [SECURITY_NOTES.md](SECURITY_NOTES.md).
