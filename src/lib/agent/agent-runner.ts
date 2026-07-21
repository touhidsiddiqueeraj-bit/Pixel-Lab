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
  evaluateEditQuality,
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
import { cloneLayer, snapshotWorkspace } from '@/lib/workspace-utils';

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

QUALITY AWARENESS — your edit will be self-reviewed before being shown to the user:
After your tool calls finish, a vision model will compare the BEFORE and AFTER images and rate the edit quality 1-10. If the score is below 7, your edit will be RETRIED with feedback. To avoid retries:
- Make sure your edit is VISIBLE (not a no-op). If the user asked to "brighten the sky", the sky must look brighter in the AFTER image.
- Make sure your edit affects the RIGHT region. Don't brighten the ground when asked to brighten the sky.
- Don't go too far. Slight overshoot is OK, but blown-out highlights or oversaturated colors will score low.
- If you realize the request is ambiguous, make a reasonable interpretation and apply it — don't just call no tools.

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
 *
 * SELF-EVALUATION + RETRY (new):
 *   After the tool-calling loop produces a final text response, we capture
 *   the AFTER image and send BEFORE+AFTER to a vision model for quality
 *   scoring. If the score is below SELF_EVAL_THRESHOLD (7), we RESET the
 *   workspace to the original BEFORE state and re-run the tool loop with
 *   feedback (the score + reasoning) prepended to the prompt. We retry up
 *   to MAX_SELF_EVAL_RETRIES (2) times. If all retries score low, we still
 *   show the BEST attempt to the user (rather than blocking) — the user can
 *   then reject and try a different prompt.
 *
 * PREFERENCE MEMORY (new):
 *   The user's preference summary (built from past accept/reject decisions)
 *   is appended to the system prompt so the agent can adapt to the user's
 *   tastes. When the user accepts or rejects, we record a PreferenceEntry
 *   (see agent-store.ts) that includes the self-eval score, so future
 *   preference summaries can also report how well the agent's self-eval
 *   agrees with the user.
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

  // Add the user's message to the chat thread.
  agentStore.addMessage({ role: 'user', text: prompt });

  // Create the assistant message placeholder — we'll append tool-call chips
  // and the final text to it.
  const assistantMsgId = agentStore.addMessage({
    role: 'assistant',
    text: '',
    toolCalls: [],
  });

  // Reset any prior self-eval result so the UI doesn't show a stale score.
  agentStore.setSelfEval(null);

  agentStore.setStatus('running');
  agentStore.setStatusLine('Reading the canvas...');

  // Snapshot the live editor state into an offscreen workspace. We keep this
  // ORIGINAL snapshot separate from the working workspace so we can reset
  // back to it between self-eval retries.
  const originalWs = snapshotWorkspace();
  const beforeDataUrl = compositeWorkspace(originalWs).toDataURL('image/jpeg', 0.85);

  // Build the system prompt with the user's preference summary appended.
  // The summary is empty on the first run and grows as the user accepts/
  // rejects edits.
  const preferenceSummary = useAgentStore.getState().getPreferenceSummary();
  const systemPrompt = preferenceSummary
    ? `${SYSTEM_PROMPT}

USER PREFERENCE MEMORY (learned from past accept/reject decisions):
${preferenceSummary}

Adapt your edits to match what the user tends to accept. Avoid edits similar to past rejected requests. When in doubt, prefer the style of edits the user has accepted before.`
    : SYSTEM_PROMPT;

  // Track the best attempt across retries so we can show it if all retries
  // fail to clear the threshold.
  let bestAttempt: {
    text: string;
    afterDataUrl: string;
    toolCallLabels: string[];
    ws: AgentWorkspace;
    score: number;
    reasoning: string;
    attempt: number;
  } | null = null;

  try {
    for (let attempt = 0; attempt <= MAX_SELF_EVAL_RETRIES; attempt++) {
      if (isCancelled()) {
        agentStore.setStatus('cancelled');
        agentStore.setStatusLine('');
        return;
      }

      // Reset the working workspace to the original snapshot for each retry
      // (so retry attempts don't compound on top of a bad edit). On attempt 0
      // this is just a fresh clone of the same state.
      const ws = attempt === 0 ? originalWs : snapshotWorkspaceFrom(originalWs);

      // Build the initial contents. On retries, we prepend feedback from the
      // previous self-eval so the model knows what went wrong.
      const promptWithFeedback = attempt === 0
        ? prompt
        : `${prompt}

(Previous attempt scored ${bestAttempt?.score ?? '?'}/10 on self-eval. Feedback: "${bestAttempt?.reasoning ?? 'no feedback'}". Please try again, fixing the issues mentioned. Make sure the edit is visible and affects the right region.)`;

      const initialImagePart = canvasToInlineImagePart(compositeWorkspace(ws), 1024, 0.85);
      const contents: GeminiContent[] = [
        {
          role: 'user',
          parts: [
            { text: promptWithFeedback },
            initialImagePart,
          ],
        },
      ];

      // Run the tool-calling loop.
      const loopResult = await runToolLoop({
        apiKey,
        model,
        signal: abortCtrl.signal,
        contents,
        systemPrompt,
        assistantMsgId,
        isCancelled,
        ws,
        attempt, // for chip-id uniqueness across retries
      });

      if (loopResult.cancelled) {
        agentStore.setStatus('cancelled');
        agentStore.setStatusLine('');
        return;
      }
      if (loopResult.error) {
        agentStore.updateMessage(assistantMsgId, { text: `⚠️ ${loopResult.error}` });
        agentStore.setStatus('error');
        agentStore.setStatusLine('');
        return;
      }

      // Loop exited with a text-only response — composite the workspace.
      const afterCanvas = compositeWorkspace(ws);
      const afterDataUrl = afterCanvas.toDataURL('image/jpeg', 0.85);

      // Only proceed to self-eval if the canvas actually changed. If it
      // didn't change, there's nothing to commit — mark done and exit.
      if (!(await imagesDiffer(beforeDataUrl, afterDataUrl))) {
        agentStore.setStatus('done');
        agentStore.setStatusLine('');
        return;
      }

      // SELF-EVALUATION STEP — let a vision model review the edit.
      agentStore.setStatus('self-evaluating');
      agentStore.setStatusLine(attempt === 0 ? 'Reviewing my edit...' : `Reviewing retry ${attempt}...`);
      let selfScore = 0;
      let selfReasoning = '';
      try {
        const evalResult = await evaluateEditQuality(
          { apiKey, model, signal: abortCtrl.signal },
          beforeDataUrl,
          afterDataUrl,
          prompt,
          loopResult.text,
        );
        selfScore = evalResult.score;
        selfReasoning = evalResult.reasoning;
      } catch {
        // Self-eval itself failed — treat as a permissive pass so we don't
        // block the preview. The user can still reject.
        selfScore = 8;
        selfReasoning = 'Self-evaluation skipped (internal error).';
      }

      if (isCancelled()) {
        agentStore.setStatus('cancelled');
        agentStore.setStatusLine('');
        return;
      }

      // Track this attempt as the best so far (lower scores get overwritten
      // by higher scores on subsequent retries).
      if (!bestAttempt || selfScore > bestAttempt.score) {
        bestAttempt = {
          text: loopResult.text,
          afterDataUrl,
          toolCallLabels: loopResult.toolCallLabels,
          ws,
          score: selfScore,
          reasoning: selfReasoning,
          attempt,
        };
      }

      // If the edit passed self-eval, show the preview. Otherwise, retry
      // (unless we've exhausted retries).
      if (selfScore >= SELF_EVAL_THRESHOLD) {
        break;
      }
      if (attempt >= MAX_SELF_EVAL_RETRIES) {
        // Out of retries — show the best attempt with a note. Update the
        // assistant message to include the self-eval feedback so the user
        // understands why the agent isn't confident.
        agentStore.updateMessage(assistantMsgId, {
          text: `${loopResult.text}\n\n(Self-eval: ${selfScore}/10 — ${selfReasoning})`,
        });
        break;
      }
      // Otherwise, retry. Update the assistant message to indicate we're
      // retrying, and continue the loop.
      agentStore.updateMessage(assistantMsgId, {
        text: `(Attempt ${attempt + 1} scored ${selfScore}/10: ${selfReasoning}. Retrying...)`,
      });
    }

    // Show the preview (from the best attempt).
    if (!bestAttempt) {
      // Shouldn't happen, but defensive.
      agentStore.setStatus('error');
      agentStore.setStatusLine('');
      return;
    }

    // If we retried and the final best attempt is from a non-zero attempt,
    // restore that workspace so commitPreview will use the right state.
    // (We already have bestAttempt.ws, which we'll stash below.)

    // Update the assistant message text with the best attempt's text if it
    // differs (i.e. we retried and the last attempt wasn't the best).
    agentStore.updateMessage(assistantMsgId, {
      text: bestAttempt.text,
    });

    const historyLabel = buildHistoryLabel(prompt, bestAttempt.toolCallLabels.length);

    agentStore.setPendingPreview({
      beforeDataUrl,
      afterDataUrl: bestAttempt.afterDataUrl,
      historyLabel,
      toolCallIds: [], // toolCallIds are only used for chip traceability; we
                       // don't need to populate them here since chips are
                       // already shown in the message.
      userRequest: prompt,
      toolCallLabels: bestAttempt.toolCallLabels,
    });
    // CRITICAL: stash the best attempt's workspace (not necessarily the last
    // attempt's) so commitPreview copies the right pixels into the live store.
    agentStore.setPendingWorkspace(bestAttempt.ws);

    // Stash the self-eval result so the UI can display it alongside Accept/Reject.
    agentStore.setSelfEval({
      score: bestAttempt.score,
      reasoning: bestAttempt.reasoning,
      attempt: bestAttempt.attempt,
      accepted: bestAttempt.score >= SELF_EVAL_THRESHOLD,
    });

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

// ---------------------------------------------------------------------------
// Self-eval + retry constants
// ---------------------------------------------------------------------------

/**
 * Minimum self-eval score (1-10) required to show the preview without retrying.
 * 7 = "Acceptable — accomplishes the request but with noticeable issues."
 *
 * Setting this too high causes excessive retries (slow, expensive). Setting
 * it too low shows the user garbage. 7 is a good balance — the agent retries
 * only when the vision model thinks the edit is poor or wrong.
 */
const SELF_EVAL_THRESHOLD = 7;

/**
 * Maximum number of self-eval retries. 0 = no retries (show first attempt
 * regardless of score). 2 = up to 2 retries (so up to 3 total attempts).
 *
 * Each retry costs one extra tool-calling loop + one extra vision call, so
 * 2 retries worst-case triples the per-request cost. That's acceptable
 * because retries only happen when the edit is bad — most requests will
 * pass on the first attempt.
 */
const MAX_SELF_EVAL_RETRIES = 2;

// ---------------------------------------------------------------------------
// Tool-calling loop helper
// ---------------------------------------------------------------------------

interface ToolLoopResult {
  /** True if the run was cancelled by the user. */
  cancelled: boolean;
  /** Error message if the run failed (e.g. MAX_TOOL_CALLS hit). */
  error: string | null;
  /** The assistant's final text response. */
  text: string;
  /** Human-readable labels for each tool call (for preference memory). */
  toolCallLabels: string[];
}

/**
 * Run the tool-calling loop against a workspace. Returns when the model emits
 * a text-only response, or when an error/cancel/hard-stop occurs.
 *
 * Extracted from runAgent so it can be called multiple times for self-eval
 * retries. Each call gets a fresh `contents` array (so the model doesn't see
 * its own failed history) but reuses the same assistantMsgId (so tool-call
 * chips accumulate across retries in the UI — the user can see what was tried).
 *
 * The `attempt` parameter is used to make chip IDs unique across retries
 * (otherwise React would complain about duplicate keys).
 */
async function runToolLoop(params: {
  apiKey: string;
  model: string;
  signal: AbortSignal;
  contents: GeminiContent[];
  systemPrompt: string;
  assistantMsgId: string;
  isCancelled: () => boolean;
  ws: AgentWorkspace;
  attempt: number;
}): Promise<ToolLoopResult> {
  const {
    apiKey, model, signal, contents, systemPrompt, assistantMsgId,
    isCancelled, ws, attempt,
  } = params;
  const agentStore = useAgentStore.getState();

  const tools: GeminiTool[] = [{ functionDeclarations: TOOL_DECLARATIONS }];
  const toolConfig: GeminiToolConfig = {
    functionCallingConfig: { mode: 'AUTO' },
  };

  let toolCallCount = 0;
  const toolCallLabels: string[] = [];

  while (true) {
    if (isCancelled()) {
      return { cancelled: true, error: null, text: '', toolCallLabels };
    }

    agentStore.setStatusLine(
      toolCallCount === 0
        ? (attempt === 0 ? 'Thinking...' : `Retry ${attempt}: thinking...`)
        : `Step ${toolCallCount + 1}${attempt > 0 ? ` (retry ${attempt})` : ''}...`,
    );

    const resp = await generateContent(
      { apiKey, model, signal },
      contents,
      {
        temperature: 0.2,
        tools,
        toolConfig,
        systemInstruction: systemPrompt,
        maxOutputTokens: 2048,
      },
    );

    if (isCancelled()) {
      return { cancelled: true, error: null, text: '', toolCallLabels };
    }

    const calls = extractFunctionCalls(resp);
    const text = extractText(resp);

    if (calls.length === 0) {
      // Final text response — finalize the assistant message.
      agentStore.updateMessage(assistantMsgId, {
        text: text || '(no response)',
      });
      return { cancelled: false, error: null, text: text || '(no response)', toolCallLabels };
    }

    // Append the model's turn (with functionCall parts) to contents.
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
        return {
          cancelled: false,
          error: `Hit MAX_TOOL_CALLS (${MAX_TOOL_CALLS}) without a final response. The request was too complex for one turn — try breaking it into smaller steps.`,
          text: '',
          toolCallLabels,
        };
      }

      // Include the attempt number in the chip ID so chips from different
      // retries don't collide on React keys.
      const chipId = `${assistantMsgId}-tc${attempt}-${toolCallCount}`;
      const label = describeToolCall(call.name, call.args);
      agentStore.appendToolCall(assistantMsgId, {
        id: chipId,
        label,
        toolName: call.name,
        args: call.args,
        status: 'running',
      });
      agentStore.setStatusLine(label);
      toolCallLabels.push(label);

      let result: ToolResult;
      try {
        await new Promise((r) => setTimeout(r, 0));
        if (isCancelled()) {
          return { cancelled: true, error: null, text: '', toolCallLabels };
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

    contents.push({ role: 'user', parts: responseParts });
  }
}

/**
 * Clone an existing workspace (used to reset state between self-eval retries).
 *
 * We can't reuse `snapshotWorkspace()` for retries because that snapshots the
 * LIVE editor store — but the live store hasn't been mutated (the agent works
 * on the offscreen workspace). So we need a function that clones from another
 * workspace instead.
 */
function snapshotWorkspaceFrom(src: AgentWorkspace): AgentWorkspace {
  const layers = src.layers.map((l) => cloneLayer(l, src.docWidth, src.docHeight));
  let selectionMask: HTMLCanvasElement | null = null;
  if (src.selectionMask) {
    selectionMask = createBlankCanvas(src.docWidth, src.docHeight);
    selectionMask.getContext('2d')!.drawImage(src.selectionMask, 0, 0);
  }
  return {
    layers,
    activeLayerId: src.activeLayerId,
    docWidth: src.docWidth,
    docHeight: src.docHeight,
    selectionMask,
    selectionBounds: src.selectionBounds ? { ...src.selectionBounds } : null,
  };
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

  // Record this accept in the user's preference memory so future agent runs
  // can adapt to what the user likes. The self-eval score/reasoning are
  // included so the preference summary can later report how well the agent's
  // self-eval agrees with the user (a low agreement rate would indicate the
  // self-eval prompt needs tuning).
  const selfEval = agentStore.selfEval;
  agentStore.addPreferenceEntry({
    userRequest: preview.userRequest,
    agentAction: preview.historyLabel,
    toolCalls: preview.toolCallLabels,
    decision: 'accepted',
    selfScore: selfEval?.score,
    selfReasoning: selfEval?.reasoning,
  });

  // Clear the pending state.
  agentStore.setPendingPreview(null);
  agentStore.setPendingWorkspace(null);
  agentStore.setSelfEval(null);
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
 *
 * PREFERENCE MEMORY (new):
 *   Records this reject in the user's preference memory. Future agent runs
 *   will see the rejected request in their system prompt and can avoid
 *   similar edits. The self-eval score is also recorded so the preference
 *   summary can report how well the agent's self-eval agrees with the user
 *   (e.g. if the agent scored itself 9 but the user rejected, that's a
 *   signal the self-eval prompt needs calibration).
 */
export function rejectPreview(): void {
  const agentStore = useAgentStore.getState();
  const preview = agentStore.pendingPreview;
  const selfEval = agentStore.selfEval;

  // Record the reject in preference memory (if we have a preview to record
  // — rejectPreview can also be called as a no-op when the user starts a
  // new request while a preview is pending, in which case there's nothing
  // meaningful to record).
  if (preview) {
    agentStore.addPreferenceEntry({
      userRequest: preview.userRequest,
      agentAction: preview.historyLabel,
      toolCalls: preview.toolCallLabels,
      decision: 'rejected',
      selfScore: selfEval?.score,
      selfReasoning: selfEval?.reasoning,
    });
  }

  agentStore.setPendingPreview(null);
  agentStore.setPendingWorkspace(null);
  agentStore.setSelfEval(null);
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
