'use client';

/**
 * MCP Browser Client — connects to the local MCP server (mcp/server.ts) and
 * handles incoming tool calls by running them against the current document.
 *
 * This is the browser-side half of the MCP WebSocket bridge. When an external
 * MCP client (Claude Desktop, etc.) calls a tool, the MCP server forwards it
 * here via WebSocket, and this client:
 *   1. Snapshots the current editor-store into a workspace (same pattern as
 *      the agent runner + automation runner).
 *   2. Runs the tool via `executeTool` against the workspace.
 *   3. Commits the workspace back to the live store (per-layer, preserving alpha).
 *   4. Sends the result back to the MCP server, which forwards it to the MCP client.
 *
 * The client auto-connects to ws://localhost:3004 and reconnects on disconnect.
 * It's mounted in AutomationsPanel so it only runs when that panel is visible
 * (or always — we mount it at the PhotoEditor level so external MCP clients
 * can call tools even when the user isn't looking at the Automations tab).
 */

import { useEffect, useRef, useState, useCallback } from 'react';
import { useEditorStore } from '@/lib/editor-store';
import { useShallow } from 'zustand/react/shallow';
import { executeTool, compositeWorkspace, type AgentWorkspace } from '@/lib/agent/tools';
import { createBlankCanvas } from '@/lib/image-processing';
import type { LayerData } from '@/lib/editor-types';

const MCP_WS_URL = 'ws://localhost:3004';

export interface McpConnectionState {
  connected: boolean;
  connecting: boolean;
  error: string | null;
  lastCall: { tool: string; success: boolean; message: string; ts: number } | null;
}

/**
 * Hook that manages the MCP WebSocket connection.
 * Call this once at the app root (PhotoEditor) so the connection is always live.
 */
export function useMcpBridge(): McpConnectionState & { enabled: boolean; toggle: () => void } {
  const [state, setState] = useState<McpConnectionState>({
    connected: false,
    connecting: false,
    error: null,
    lastCall: null,
  });
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const { mcpEnabled, setMcpEnabled } = useEditorStore(useShallow((s) => ({
    mcpEnabled: s.mcpEnabled,
    setMcpEnabled: s.setMcpEnabled,
  })));
  const toggle = useCallback(() => setMcpEnabled(!mcpEnabled), [mcpEnabled, setMcpEnabled]);

  useEffect(() => {
    if (!mcpEnabled) {
      // Tear down any existing connection
      if (reconnectTimer.current) { clearTimeout(reconnectTimer.current); reconnectTimer.current = null; }
      if (wsRef.current) { wsRef.current.onclose = null; wsRef.current.close(); wsRef.current = null; }
      setState({ connected: false, connecting: false, error: null, lastCall: null });
      return;
    }

    let cancelled = false;

    const connect = () => {
      if (cancelled) return;
      setState((s) => ({ ...s, connecting: true, error: null }));

      let ws: WebSocket;
      try {
        ws = new WebSocket(MCP_WS_URL);
      } catch (e) {
        setState((s) => ({ ...s, connecting: false, error: `Cannot connect: ${(e as Error).message}` }));
        // Retry in 5 seconds
        reconnectTimer.current = setTimeout(connect, 5000);
        return;
      }
      wsRef.current = ws;

      ws.onopen = () => {
        if (cancelled) return;
        setState((s) => ({ ...s, connected: true, connecting: false, error: null }));
        // Send a hello with the tool count so the server knows we're ready
        ws.send(JSON.stringify({
          type: 'hello',
          url: window.location.href,
        }));
      };

      ws.onclose = () => {
        if (cancelled) return;
        setState((s) => ({ ...s, connected: false, connecting: false }));
        // Auto-reconnect after 3 seconds
        reconnectTimer.current = setTimeout(connect, 3000);
      };

      ws.onerror = () => {
        if (cancelled) return;
        setState((s) => ({ ...s, error: 'WebSocket error — is the MCP server running? (bun run mcp/server.ts)' }));
      };

      ws.onmessage = async (event) => {
        if (cancelled) return;
        try {
          const msg = JSON.parse(event.data);
          if (msg.type === 'tool-call' && msg.callId) {
            // Run the tool call against the current document
            const result = await runToolCall(msg.name, msg.args);
            // Send the result back
            ws.send(JSON.stringify({
              type: 'tool-result',
              callId: msg.callId,
              success: result.success,
              result: result,
              error: result.success ? undefined : result.message,
            }));
            setState((s) => ({
              ...s,
              lastCall: {
                tool: msg.name,
                success: result.success,
                message: result.message,
                ts: Date.now(),
              },
            }));
          }
        } catch (e) {
          console.error('[mcp-client] Failed to handle message:', e);
        }
      };
    };

    connect();

    return () => {
      cancelled = true;
      if (reconnectTimer.current) clearTimeout(reconnectTimer.current);
      if (wsRef.current) {
        wsRef.current.onclose = null; // prevent reconnect on intentional close
        wsRef.current.close();
      }
    };
  }, [mcpEnabled]);

  return { ...state, enabled: mcpEnabled, toggle };
}

// ---------------------------------------------------------------------------
// Tool call execution — snapshots the workspace, runs the tool, commits
// ---------------------------------------------------------------------------

async function runToolCall(
  toolName: string,
  args: Record<string, unknown>,
): Promise<{ success: boolean; message: string }> {
  const s = useEditorStore.getState();
  if (s.layers.length === 0) {
    return { success: false, message: 'No document open in Pixel Lab.' };
  }

  // Snapshot the current editor state into a workspace
  const ws = snapshotWorkspace();
  try {
    const result = await executeTool(toolName, args, ws);
    if (!result.success) {
      return result;
    }
    // Commit the workspace back to the live store (per-layer, preserving alpha)
    commitWorkspace(ws, `MCP: ${toolName}`);
    return result;
  } catch (e) {
    return { success: false, message: (e as Error)?.message ?? 'Unknown error' };
  }
}

// Ported from automation-runner.ts (kept here to avoid circular imports)
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
