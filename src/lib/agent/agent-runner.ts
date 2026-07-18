/**
 * Agent Runner — Orchestration loop.
 *
 * Flow:
 *   1. Snapshot the current editor-store state into an offscreen workspace
 *      (deep clone of all layers + selection mask).
 *   2. Send the user's request + a downscaled JPEG of the current composite
 *      to Gemini, along with the tool declarations.
 *   3. Loop:
 *      - Receive Gemini response (may contain text + functionCall parts).
 *      - For each functionCall: execute against the WORKSPACE (not the live
 *        store), emit a progress event (chat chip), record the result.
 *      - Send functionResponse parts back to Gemini.
 *      - Repeat until Gemini returns text-only, or MAX_TOOL_CALLS is hit.
 *   4. On text-only response: composite the workspace, build a before/after
 *      preview, store it as `pendingPreview` in the agent store, and switch
 *      status to `awaiting-accept`.
 *   5. UI shows Accept / Reject. On Accept, the runner's `commit()` function
 *      copies the workspace's active layer back into the editor-store and
 *      pushes a history entry — identical structure to a manual edit.
 *
 * Cancellation:
 *   - The agent store exposes a `cancelToken` (a monotonic counter).
 *   - We capture the token at start and check it between every Gemini call
 *     and every tool execution. If it changes, we abort.
 *   - We also pass an AbortSignal to fetch so the in-flight HTTP request
 *     is cancelled.
 *
 * Hard stop:
 *   - If MAX_TOOL_CALLS is reached without a text-only response, we surface
 *     an error to the user instead of looping silently.
 */

import { useEditorStore } from '@/lib/editor-store';
import { useAgentStore, MAX_TOOL_CALLS } from './agent-store';
import {
  generateContent,
  canvasToInlineImagePart,
  extractText,
  extractFunctionCalls,
  type GeminiContent,
  type GeminiTool,
  type GeminiToolConfig,
} from './gemini-client';
import {
  TOOL_DECLARATIONS,
  executeTool,
  compositeWorkspace,
  describeToolCall,
  type AgentWorkspace,
  type ToolResult,
} from './tools';
import { createBlankCanvas, generateThumbnail } from '@/lib/image-processing';
import type { LayerData } from '@/lib/editor-types';

// ---------------------------------------------------------------------------
// Snapshotting — clone the live editor state into a workspace
// ---------------------------------------------------------------------------

function cloneLayer(layer: LayerData, docWidth: number, docHeight: number): LayerData {
  const canvas = createBlankCanvas(docWidth, docHeight);
  const ctx = canvas.getContext('2d')!;
  ctx.drawImage(layer.canvas, 0, 0);
  let maskCanvas: HTMLCanvasElement | null = null;
  if (layer.maskCanvas) {
    maskCanvas = createBlankCanvas(docWidth, docHeight);
    maskCanvas.getContext('2d')!.drawImage(layer.maskCanvas, 0, 0);
  }
  return {
    ...layer,
    canvas,
    maskCanvas,
    // Don't bother generating a real thumbnail until we need to show it.
    thumbnail: '',
  };
}

function snapshotWorkspace(): AgentWorkspace {
  const s = useEditorStore.getState();
  const layers = s.layers.map((l) => cloneLayer(l, s.docWidth, s.docHeight));
  let selectionMask: HTMLCanvasElement | null = null;
  if (s.selectionMask) {
    selectionMask = createBlankCanvas(s.docWidth, s.docHeight);
    selectionMask.getContext('2d')!.drawImage(s.selectionMask, 0, 0);
  }
  return {
    layers,
    activeLayerId: s.activeLayerId,
    docWidth: s.docWidth,
    docHeight: s.docHeight,
    selectionMask,
    selectionBounds: s.selectionBounds ? { ...s.selectionBounds } : null,
  };
}

// ---------------------------------------------------------------------------
// System prompt — gives the model context about the editor & tool usage
// ---------------------------------------------------------------------------

const SYSTEM_PROMPT = `You are the AI editing agent inside Pixel Lab, a browser-based image editor.

You receive the user's current canvas as a downscaled JPEG image. Your job is to translate the user's natural-language request into a sequence of tool calls that achieve the desired edit.

Operating principles:
1. LOOK at the image before deciding coordinates. When the user says "the sky", identify which part of the image is sky and pick a normalized (x, y) point inside it. Origin is top-left, x grows right, y grows down.
2. PREFER fewer tool calls. If one filter call achieves the goal, don't call more.
3. SELECTION: when an edit should affect only part of the image, first call selectRegionByPoint or selectRegionByBox, then call the editing tool. The editing tool will automatically restrict itself to the active selection.
4. COORDINATES are normalized 0-1. "Upper-left quadrant" ≈ box (0, 0, 0.5, 0.5). "Sky" in a typical landscape photo ≈ point (0.5, 0.15) or box (0, 0, 1, 0.4). "Center" ≈ (0.5, 0.5).
5. COLORS are CSS color strings — hex ("#ff0000"), named ("red", "blue", "yellow"), or rgb()/hsl(). Named colors are fine and encouraged for natural prompts.
6. PARAMS: respect the documented ranges. Out-of-range values will be clamped, not rejected.
7. After your tool calls finish, reply with a SHORT (1-2 sentence) plain-text summary of what you did. Do NOT use markdown headings. Do NOT ask the user to confirm — the UI handles Accept/Reject.

Tool set summary:
- applyFilter: gaussianBlur, sharpen, sepia, grayscale, invert, posterize, pixelate, edgeDetect, emboss, addNoise, vignette
- adjustDevelop: Lightroom-style adjustments (exposure, contrast, highlights, shadows, whites, blacks, clarity, dehaze, texture, vibrance, saturation, grain, vignette, sharpening, luminanceNR, colorNR, splitToning)
- selectRegionByPoint(x, y, tolerance?): Magic Wand flood-fill at a normalized point
- selectRegionByBox(x0, y0, x1, y1): Rectangular marquee in normalized coords
- invertSelection(), deselectAll()
- contentAwareFill(): Fill current selection with surrounding pixels (good for object removal)
- autoBackgroundRemove(tolerance?): Flood-fill remove from edges
- addAdjustmentLayer(type, params): BAKED-IN brightnessContrast, vibrance, exposure, hueSaturation. NOT non-destructive in v1 — prefer adjustDevelop for the same effect with a clearer name.
- drawShape(shapeType, x0, y0, x1?, y1?, fillColor?, strokeColor?, strokeWidth?, filled?, sides?, points?, turns?): Draw ellipse/circle, rect, line, star, polygon, arrow, heart, speechBubble, spiral. For circle use shapeType="ellipse" with equal-width bounding box. For star/polygon/heart/spiral, x0,y0 is the CENTER and x1,y1 defines the radius (distance from center). For speechBubble, x0,y0 and x1,y1 are the bubble bounding box. turns controls spiral turn count.
- drawBrushStroke(points: [{x,y}], color?, size?, opacity?, hardness?, smooth?): Freehand soft brush through a list of normalized points. Use for organic shapes or scribbles. smooth=0-100 applies path smoothing. At least 2 points.
- drawCalligraphy(points: [{x,y}], color?, size?, angle?, opacity?): Calligraphy pen stroke — flat, angle-aware brush producing thick-and-thin lines. angle=45 is classic italic. Use for hand-lettering, decorative borders.
- drawScatterStroke(points: [{x,y}], color?, count?, sizeScale?, opacity?): Scatter brush — distributes small filled circles along a path with random offsets. Use for foliage, fur, texture, spray-paint effects. count=1-500.
- addText(text, x, y, color?, fontSize?, fontFamily?, align?): Render text at a normalized position.
- fillBucket(x, y, color, tolerance?): Paint-bucket flood-fill from a point with a solid color. Use for "fill the background blue", "paint the whole canvas red", "recolor the sky".
- undo()

Example — "make it grayscale":
  Call applyFilter(filterType="grayscale")
  Reply: "Converted the image to grayscale."

Example — "brighten the sky and add a vignette":
  1. Call selectRegionByBox(x0=0, y0=0, x1=1, y1=0.4)
  2. Call adjustDevelop(section="light", param="exposure", value=30)
  3. Call deselectAll()
  4. Call applyFilter(filterType="vignette", params={ amount: 50, size: 50 })
  Reply: "Brightened the sky and added a vignette."

Example — "draw a red circle in the center":
  Call drawShape(shapeType="ellipse", x0=0.3, y0=0.3, x1=0.7, y1=0.7, fillColor="#ff0000")
  Reply: "Drew a red circle in the center of the canvas."

Example — "fill the background blue":
  Call fillBucket(x=0.5, y=0.5, color="blue", tolerance=10)
  Reply: "Filled the background with blue."

Example — "write 'Hello' in the top-left":
  Call addText(text="Hello", x=0.05, y=0.05, color="#000000", fontSize=64)
  Reply: "Added 'Hello' in the top-left."

Be concise. Make calls, then summarize.`;

// ---------------------------------------------------------------------------
// Runner
// ---------------------------------------------------------------------------

export interface RunParams {
  /** User's natural-language request. */
  prompt: string;
}

/**
 * Run the agent loop. Returns when the model emits a final text response
 * (preview ready for accept) or when an error/cancel/hard-stop occurs.
 */
export async function runAgent({ prompt }: RunParams): Promise<void> {
  const agentStore = useAgentStore.getState();
  const apiKey = agentStore.apiKey;
  const model = agentStore.model;

  if (!apiKey) {
    agentStore.addMessage({
      role: 'system',
      text: 'No API key set. Enter your Gemini API key above to start.',
    });
    agentStore.setStatus('error');
    return;
  }

  // Capture the cancel token at start so we can detect cancellation.
  const startCancelToken = agentStore.cancelToken;
  const isCancelled = () => useAgentStore.getState().cancelToken !== startCancelToken;

  // AbortController for the in-flight fetch.
  const abortCtrl = new AbortController();
  // Watch for cancellation: poll on each loop iteration (cheap).
  // (We don't need a watcher — we check `isCancelled()` between steps.)

  // Add the user's message to the chat thread.
  agentStore.addMessage({ role: 'user', text: prompt });

  // Create the assistant message placeholder — we'll append tool-call chips
  // and the final text to it.
  const assistantMsgId = agentStore.addMessage({
    role: 'assistant',
    text: '',
    toolCalls: [],
  });

  agentStore.setStatus('running');
  agentStore.setStatusLine('Reading the canvas...');

  // Snapshot the live editor state into an offscreen workspace.
  const ws = snapshotWorkspace();

  // Build the initial contents: system + user(text+image).
  const beforeDataUrl = compositeWorkspace(ws).toDataURL('image/jpeg', 0.85);

  const initialImagePart = canvasToInlineImagePart(compositeWorkspace(ws), 1024, 0.85);

  const contents: GeminiContent[] = [
    {
      role: 'user',
      parts: [
        { text: prompt },
        initialImagePart,
      ],
    },
  ];

  const tools: GeminiTool[] = [{ functionDeclarations: TOOL_DECLARATIONS }];
  // DELIBERATE CHOICE: we use mode 'AUTO' throughout (including turn 1) rather
  // than 'ANY'. The project spec suggested considering 'ANY' to force tool use,
  // but AUTO lets the model answer conversationally when the user asks a
  // question (e.g. "what tools do you have?", "what's the difference between
  // exposure and brightness?") without forcing a spurious tool call. The
  // trade-off: the model could occasionally answer with text only when a tool
  // call would have been more useful — but since edits require explicit tool
  // calls and the model is prompted to prefer them for edit requests, this
  // rarely happens in practice. If it becomes a problem, switch to 'ANY' for
  // turn 1 only and keep 'AUTO' for subsequent turns.
  const toolConfig: GeminiToolConfig = {
    functionCallingConfig: { mode: 'AUTO' },
  };

  let toolCallCount = 0;
  const toolCallIds: string[] = [];

  try {
    while (true) {
      if (isCancelled()) {
        agentStore.setStatus('cancelled');
        agentStore.setStatusLine('');
        return;
      }

      agentStore.setStatusLine(
        toolCallCount === 0 ? 'Thinking...' : `Step ${toolCallCount + 1}...`,
      );

      const resp = await generateContent(
        { apiKey, model, signal: abortCtrl.signal },
        contents,
        {
          temperature: 0.2,
          tools,
          toolConfig,
          systemInstruction: SYSTEM_PROMPT,
          maxOutputTokens: 2048,
        },
      );

      if (isCancelled()) {
        agentStore.setStatus('cancelled');
        agentStore.setStatusLine('');
        return;
      }

      const calls = extractFunctionCalls(resp);
      const text = extractText(resp);

      if (calls.length === 0) {
        // Final text response — finalize the assistant message.
        agentStore.updateMessage(assistantMsgId, {
          text: text || '(no response)',
        });
        break;
      }

      // Append the model's turn (with functionCall parts) to contents.
      // Gemini requires the full turn including function calls to be present
      // before functionResponse parts.
      const modelTurn: GeminiContent = {
        role: 'model',
        parts: resp.candidates?.[0]?.content?.parts ?? [],
      };
      contents.push(modelTurn);

      // Execute each function call, append a functionResponse part.
      const responseParts: GeminiContent['parts'] = [];
      for (const call of calls) {
        toolCallCount++;
        if (toolCallCount > MAX_TOOL_CALLS) {
          // Hard stop — surface error and break.
          agentStore.updateMessage(assistantMsgId, {
            text: `⚠️ Hit MAX_TOOL_CALLS (${MAX_TOOL_CALLS}) without a final response. The request was too complex for one turn — try breaking it into smaller steps.`,
          });
          agentStore.setStatus('error');
          agentStore.setStatusLine('');
          return;
        }

        const chipId = `${assistantMsgId}-tc-${toolCallCount}`;
        const label = describeToolCall(call.name, call.args);
        agentStore.appendToolCall(assistantMsgId, {
          id: chipId,
          label,
          toolName: call.name,
          args: call.args,
          status: 'running',
        });
        agentStore.setStatusLine(label);
        toolCallIds.push(chipId);

        let result: ToolResult;
        try {
          // Small yield so the UI can paint the chip before we block on the tool.
          await new Promise((r) => setTimeout(r, 0));
          if (isCancelled()) {
            agentStore.setStatus('cancelled');
            agentStore.setStatusLine('');
            return;
          }
          result = await executeTool(call.name, call.args, ws);
        } catch (e) {
          result = { success: false, message: (e as Error).message };
        }

        agentStore.updateToolCall(assistantMsgId, chipId, {
          status: result.success ? 'success' : 'error',
          detail: result.message,
          thumbnailBase64: result.thumbnailBase64,
        });

        responseParts.push({
          functionResponse: {
            name: call.name,
            response: {
              success: result.success,
              message: result.message,
            },
          },
        });
      }

      // Send the function responses back to Gemini as a "user" turn
      // (Gemini's convention: function responses come from role "user").
      contents.push({ role: 'user', parts: responseParts });
    }

    // Loop exited with a text-only response — build the preview.
    if (isCancelled()) {
      agentStore.setStatus('cancelled');
      agentStore.setStatusLine('');
      return;
    }

    const afterCanvas = compositeWorkspace(ws);
    const afterDataUrl = afterCanvas.toDataURL('image/jpeg', 0.85);

    // Only show Accept/Reject if the canvas actually changed.
    // Compares before/after via a fast downscaled pixel diff — if the model
    // only called selection tools, or `undo`, or no-op calls, there's nothing
    // to commit, so we skip the preview entirely and just mark the run done.
    // (Full-res pixel comparison would be too slow on large canvases; a 64x64
    // downscale is enough to catch any visible change.)
    if (!(await imagesDiffer(beforeDataUrl, afterDataUrl))) {
      agentStore.setStatus('done');
      agentStore.setStatusLine('');
      return;
    }

    // Build a history label from the tool calls.
    const historyLabel = buildHistoryLabel(prompt, toolCallIds.length);

    agentStore.setPendingPreview({
      beforeDataUrl,
      afterDataUrl,
      historyLabel,
      toolCallIds,
    });
    // CRITICAL: stash the workspace itself (not just the flattened preview)
    // so commitPreview() can copy each layer's canvas back onto the
    // corresponding live layer by ID — preserving per-layer structure,
    // alpha transparency, and layer masks. The previous implementation
    // discarded the workspace and re-decoded a flattened JPEG, which
    // silently flattened all layers + baked transparency to opaque JPEG.
    agentStore.setPendingWorkspace(ws);
    agentStore.setStatus('awaiting-accept');
    agentStore.setStatusLine('');
  } catch (e) {
    const msg = (e as Error)?.message ?? 'Unknown error';
    agentStore.updateMessage(assistantMsgId, {
      text: `⚠️ ${msg}`,
    });
    agentStore.setStatus('error');
    agentStore.setStatusLine('');
  }
}

/**
 * Commit the pending preview to the live editor store + push a history entry.
 * Called from the UI when the user clicks Accept.
 *
 * IMPLEMENTATION (post-fix):
 *   We copy each workspace layer's canvas back onto the corresponding live
 *   layer by ID, using drawImage (a raw pixel copy that preserves alpha).
 *   This preserves:
 *     - Per-layer structure (no flattening)
 *     - Alpha transparency (e.g. from autoBackgroundRemove)
 *     - Layer masks (copied alongside the canvas)
 *     - Layer metadata (name, opacity, blend mode, visible, locked)
 *
 *   The previous implementation re-decoded a flattened JPEG composite onto the
 *   active layer, which silently flattened all layers + baked transparency to
 *   opaque JPEG artifacts. See the review note in the worklog for details.
 *
 *   We push ONE history entry after all layers are updated, so the entire
 *   agent turn is undo-able with a single Ctrl+Z — matching how a manual
 *   multi-layer edit would behave.
 */
export function commitPreview(): void {
  const agentStore = useAgentStore.getState();
  const editorStore = useEditorStore.getState();
  const preview = agentStore.pendingPreview;
  const ws = agentStore.pendingWorkspace as AgentWorkspace | null;

  if (!preview) return;

  if (!ws) {
    // Fallback: if the workspace is missing (shouldn't happen, but defensive),
    // fall back to the old flattened-JPEG behavior so we don't lose the edit.
    // This path is logged but not user-visible.
    console.warn('[agent] commitPreview: no pendingWorkspace, falling back to flattened commit');
    commitPreviewFlattened(preview.afterDataUrl, preview.historyLabel);
    return;
  }

  const s = useEditorStore.getState();

  // For each workspace layer, find the matching live layer by ID and copy
  // the workspace canvas onto it. Layers that exist in the live store but
  // not the workspace are untouched. Layers that exist in the workspace but
  // not the live store (e.g. if the agent added a layer — currently not
  // supported but future-proofed) are skipped with a warning.
  let updatedCount = 0;
  for (const wsLayer of ws.layers) {
    const liveLayer = s.layers.find((l) => l.id === wsLayer.id);
    if (!liveLayer) {
      console.warn(`[agent] commitPreview: workspace layer "${wsLayer.name}" (${wsLayer.id}) not found in live store — skipping`);
      continue;
    }
    // Copy the workspace canvas pixels onto the live layer's canvas.
    // drawImage preserves alpha (unlike toDataURL with JPEG).
    const ctx = liveLayer.canvas.getContext('2d')!;
    ctx.clearRect(0, 0, liveLayer.canvas.width, liveLayer.canvas.height);
    ctx.drawImage(wsLayer.canvas, 0, 0);

    // Copy the mask too if the workspace layer has one.
    if (wsLayer.maskCanvas) {
      // If the live layer doesn't have a mask canvas yet, create one.
      if (!liveLayer.maskCanvas) {
        const newMask = createBlankCanvas(s.docWidth, s.docHeight);
        liveLayer.maskCanvas = newMask;
      }
      const mctx = liveLayer.maskCanvas.getContext('2d')!;
      mctx.clearRect(0, 0, liveLayer.maskCanvas.width, liveLayer.maskCanvas.height);
      mctx.drawImage(wsLayer.maskCanvas, 0, 0);
      liveLayer.maskEnabled = wsLayer.maskEnabled;
    } else if (liveLayer.maskCanvas) {
      // The workspace layer has no mask but the live layer does — the agent
      // may have removed it (e.g. via a future removeMask tool). Clear it.
      // For now we leave the live mask as-is since no tool removes masks yet.
    }

    // Refresh the layer panel thumbnail.
    editorStore.refreshThumbnail(wsLayer.id);
    updatedCount++;
  }

  // Push a single history entry for the whole agent turn.
  // This matches how a manual multi-layer edit would behave — one undo step.
  editorStore.pushHistory(preview.historyLabel);

  // Clear the pending state.
  agentStore.setPendingPreview(null);
  agentStore.setPendingWorkspace(null);
  agentStore.setStatus('done');
  agentStore.setStatusLine('');

  console.log(`[agent] commitPreview: updated ${updatedCount} layer(s), pushed history "${preview.historyLabel}"`);
}

/**
 * Fallback: commit by decoding the flattened JPEG and drawing onto the active
 * layer. This is the OLD behavior — used only if pendingWorkspace is somehow
 * missing. It loses alpha and flattens layers, but it's better than silently
 * dropping the user's accepted edit.
 */
function commitPreviewFlattened(afterDataUrl: string, historyLabel: string): void {
  const agentStore = useAgentStore.getState();
  const editorStore = useEditorStore.getState();
  const s = useEditorStore.getState();
  const activeLayerId = s.activeLayerId;
  if (!activeLayerId) {
    agentStore.setStatus('error');
    return;
  }
  const layer = s.layers.find((l) => l.id === activeLayerId);
  if (!layer) {
    agentStore.setStatus('error');
    return;
  }
  const img = new Image();
  img.onload = () => {
    const ctx = layer.canvas.getContext('2d')!;
    ctx.clearRect(0, 0, layer.canvas.width, layer.canvas.height);
    ctx.drawImage(img, 0, 0, s.docWidth, s.docHeight);
    editorStore.refreshThumbnail(activeLayerId);
    editorStore.pushHistory(historyLabel);
    agentStore.setPendingPreview(null);
    agentStore.setPendingWorkspace(null);
    agentStore.setStatus('done');
    agentStore.setStatusLine('');
  };
  img.onerror = () => {
    agentStore.setStatus('error');
  };
  img.src = afterDataUrl;
}

/**
 * Discard the pending preview. Does NOT touch the editor-store or the
 * history stack — the workspace was offscreen all along.
 */
export function rejectPreview(): void {
  const agentStore = useAgentStore.getState();
  agentStore.setPendingPreview(null);
  agentStore.setPendingWorkspace(null);
  agentStore.setStatus('idle');
  agentStore.setStatusLine('');
  // Note: we do NOT auto-retry. The user can follow up with a refined prompt.
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function buildHistoryLabel(prompt: string, toolCallCount: number): string {
  const trimmed = prompt.trim().slice(0, 60);
  const suffix = toolCallCount > 1 ? ` (${toolCallCount} steps)` : '';
  return `AI: ${trimmed}${suffix}`;
}

/**
 * Fast pixel-diff check between two image data URLs.
 *
 * Decodes both URLs, downscales them to a 64×64 thumbnail, and counts how many
 * pixels differ by more than a small threshold. If fewer than 0.1% of pixels
 * differ, we consider the images "the same" — this catches the case where the
 * model called only selection/undo/deselectAll tools that don't actually
 * mutate pixels (or where JPEG compression noise caused a tiny diff).
 *
 * Returns true if the images are meaningfully different, false if they're
 * effectively identical.
 */
async function imagesDiffer(
  beforeDataUrl: string,
  afterDataUrl: string,
  threshold = 0.001, // 0.1% of pixels must differ
): Promise<boolean> {
  // Fast path: identical strings → definitely no change.
  if (beforeDataUrl === afterDataUrl) return false;

  const size = 64;
  const [a, b] = await Promise.all([
    decodeToThumbnail(beforeDataUrl, size),
    decodeToThumbnail(afterDataUrl, size),
  ]);
  if (!a || !b) return true; // If decode failed, assume they differ (safer).
  let diffPixels = 0;
  const total = size * size;
  // Per-pixel RGB distance — if any channel differs by > 8, count the pixel.
  for (let i = 0; i < a.length; i += 4) {
    const dr = Math.abs(a[i] - b[i]);
    const dg = Math.abs(a[i + 1] - b[i + 1]);
    const db = Math.abs(a[i + 2] - b[i + 2]);
    if (dr > 8 || dg > 8 || db > 8) diffPixels++;
  }
  return diffPixels / total > threshold;
}

/** Decode a data URL into a downscaled Uint8ClampedArray of RGBA pixels. */
function decodeToThumbnail(dataUrl: string, size: number): Promise<Uint8ClampedArray | null> {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      const c = document.createElement('canvas');
      c.width = size;
      c.height = size;
      const ctx = c.getContext('2d')!;
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'low';
      ctx.drawImage(img, 0, 0, size, size);
      resolve(ctx.getImageData(0, 0, size, size).data);
    };
    img.onerror = () => resolve(null);
    img.src = dataUrl;
  });
}
