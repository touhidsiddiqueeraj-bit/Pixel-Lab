/**
 * Automation Runner — executes a saved recipe (sequence of tool calls) against
 * either the current document or a batch of files.
 *
 * This reuses the SAME commit-safety pattern as the agent runner:
 *   1. Snapshot the editor-store into a workspace (clone all layers + mask).
 *   2. Run each step's `executeTool` against the workspace in order.
 *   3. On completion, copy the workspace's layer canvases back onto the
 *      corresponding live layers BY ID, preserving alpha (drawImage, not a
 *      flattened JPEG). Push one history entry for the whole run.
 *
 * For batch mode, each file gets a fresh workspace (single layer), runs all
 * steps, then composites + exports directly — the live editor-store is never
 * touched during batch runs.
 */

import { useEditorStore } from '@/lib/editor-store';
import { useAutomationsStore, type AutomationStep } from './automations-store';
import {
  executeTool,
  compositeWorkspace,
  type AgentWorkspace,
} from '@/lib/agent/tools';
import { createBlankCanvas, generateThumbnail } from '@/lib/image-processing';
import type { LayerData } from '@/lib/editor-types';

// ---------------------------------------------------------------------------
// Workspace snapshot + commit (ported from agent-runner.ts to keep automations
// independent of the agent store — automations don't need chat state etc.)
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
  return { ...layer, canvas, maskCanvas, thumbnail: '' };
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

/**
 * Copy each workspace layer's canvas back onto the corresponding live layer by ID.
 * Preserves per-layer structure, alpha, and masks (same as commitPreview).
 * Pushes ONE history entry for the whole run.
 */
function commitWorkspace(ws: AgentWorkspace, historyLabel: string): void {
  const editorStore = useEditorStore.getState();
  const s = useEditorStore.getState();

  for (const wsLayer of ws.layers) {
    const liveLayer = s.layers.find((l) => l.id === wsLayer.id);
    if (!liveLayer) continue;
    const ctx = liveLayer.canvas.getContext('2d')!;
    ctx.clearRect(0, 0, liveLayer.canvas.width, liveLayer.canvas.height);
    ctx.drawImage(wsLayer.canvas, 0, 0);
    if (wsLayer.maskCanvas) {
      if (!liveLayer.maskCanvas) {
        liveLayer.maskCanvas = createBlankCanvas(s.docWidth, s.docHeight);
      }
      const mctx = liveLayer.maskCanvas.getContext('2d')!;
      mctx.clearRect(0, 0, liveLayer.maskCanvas.width, liveLayer.maskCanvas.height);
      mctx.drawImage(wsLayer.maskCanvas, 0, 0);
      liveLayer.maskEnabled = wsLayer.maskEnabled;
    }
    editorStore.refreshThumbnail(wsLayer.id);
  }
  editorStore.pushHistory(historyLabel);
}

// ---------------------------------------------------------------------------
// Run on the current document
// ---------------------------------------------------------------------------

export interface RunResult {
  success: boolean;
  message: string;
  stepResults: { toolName: string; success: boolean; message: string }[];
}

/**
 * Run an automation recipe against the current document.
 * Snapshots the live state, runs each step via executeTool, commits on success.
 * On any step failure, the workspace is discarded (no partial commit).
 */
export async function runAutomationOnCurrentDoc(
  steps: AutomationStep[],
  label: string,
): Promise<RunResult> {
  if (steps.length === 0) {
    return { success: false, message: 'No steps to run.', stepResults: [] };
  }

  const ws = snapshotWorkspace();
  const stepResults: RunResult['stepResults'] = [];

  for (let i = 0; i < steps.length; i++) {
    const step = steps[i];
    try {
      const result = await executeTool(step.toolName, step.args, ws);
      stepResults.push({
        toolName: step.toolName,
        success: result.success,
        message: result.message,
      });
      if (!result.success) {
        // A step failed — discard the workspace, don't commit a partial result.
        return {
          success: false,
          message: `Step ${i + 1} (${step.toolName}) failed: ${result.message}`,
          stepResults,
        };
      }
    } catch (e) {
      const msg = (e as Error)?.message ?? 'Unknown error';
      stepResults.push({ toolName: step.toolName, success: false, message: msg });
      return {
        success: false,
        message: `Step ${i + 1} (${step.toolName}) threw: ${msg}`,
        stepResults,
      };
    }
    // Yield to the event loop so the UI can paint progress.
    await new Promise((r) => setTimeout(r, 0));
  }

  // All steps succeeded — commit the workspace to the live store.
  commitWorkspace(ws, label);
  return {
    success: true,
    message: `Recipe "${label}" completed (${steps.length} steps).`,
    stepResults,
  };
}

// ---------------------------------------------------------------------------
// Batch mode — run on multiple files without touching the live document
// ---------------------------------------------------------------------------

export interface BatchResult {
  fileName: string;
  success: boolean;
  error?: string;
  outputDataUrl?: string;
}

/**
 * Run an automation recipe against a batch of image files.
 *
 * For each file:
 *   1. Load the image into a fresh workspace (single layer sized to the image).
 *   2. Run all steps via executeTool against that workspace.
 *   3. Composite the workspace and export as a data URL.
 *   4. Trigger a download of the result.
 *
 * The live editor-store is NEVER touched during batch runs.
 * A step failure on one file does NOT abort the rest — we log it and continue,
 * then summarize failures at the end.
 *
 * @param onProgress called after each file completes (success or failure) so
 *                   the UI can update its per-file progress list.
 */
export async function runAutomationBatch(
  files: File[],
  steps: AutomationStep[],
  onProgress?: (index: number, result: BatchResult) => void,
): Promise<BatchResult[]> {
  const results: BatchResult[] = [];

  for (let i = 0; i < files.length; i++) {
    const file = files[i];
    try {
      // Load the image file into an HTMLImageElement.
      const img = await loadImage(file);
      const w = img.naturalWidth;
      const h = img.naturalHeight;

      // Create a fresh workspace with a single layer containing the image.
      const canvas = createBlankCanvas(w, h);
      canvas.getContext('2d')!.drawImage(img, 0, 0);
      const layer: LayerData = {
        id: `batch-${i}-${Date.now()}`,
        name: file.name,
        visible: true,
        opacity: 1,
        blendMode: 'source-over',
        locked: false,
        canvas,
        thumbnail: '',
        maskCanvas: null,
        maskEnabled: true,
      };
      const ws: AgentWorkspace = {
        layers: [layer],
        activeLayerId: layer.id,
        docWidth: w,
        docHeight: h,
        selectionMask: null,
        selectionBounds: null,
      };

      // Run each step. On step failure, mark the file as errored and continue
      // to the next file (don't abort the whole batch).
      let stepError: string | null = null;
      for (let s = 0; s < steps.length; s++) {
        const step = steps[s];
        try {
          const result = await executeTool(step.toolName, step.args, ws);
          if (!result.success) {
            stepError = `Step ${s + 1} (${step.toolName}): ${result.message}`;
            break;
          }
        } catch (e) {
          stepError = `Step ${s + 1} (${step.toolName}) threw: ${(e as Error)?.message}`;
          break;
        }
      }

      if (stepError) {
        const result: BatchResult = { fileName: file.name, success: false, error: stepError };
        results.push(result);
        onProgress?.(i, result);
        continue;
      }

      // Composite the workspace and export.
      const composite = compositeWorkspace(ws);
      const outputDataUrl = composite.toDataURL('image/png');
      const result: BatchResult = {
        fileName: file.name,
        success: true,
        outputDataUrl,
      };
      results.push(result);
      onProgress?.(i, result);

      // Trigger download.
      const link = document.createElement('a');
      link.href = outputDataUrl;
      const baseName = file.name.replace(/\.[^/.]+$/, '');
      link.download = `${baseName}-edited.png`;
      link.click();
    } catch (e) {
      const result: BatchResult = {
        fileName: file.name,
        success: false,
        error: (e as Error)?.message ?? 'Failed to load file',
      };
      results.push(result);
      onProgress?.(i, result);
    }
  }

  return results;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function loadImage(file: File): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(img);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error(`Failed to load image: ${file.name}`));
    };
    img.src = url;
  });
}
