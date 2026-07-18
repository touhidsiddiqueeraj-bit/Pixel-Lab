'use client';

/**
 * Agent Store — In-memory AI Agent state for Pixel Lab.
 *
 * SECURITY MODEL (Part 1):
 * - The Gemini API key lives ONLY in this Zustand store slice (in-memory).
 * - It is NEVER written to localStorage, sessionStorage, or any persistent store.
 * - It is NEVER sent to any backend of ours — the Gemini client calls Google's
 *   API endpoint directly from the browser.
 * - "Clear API key" wipes the in-memory value immediately and cancels any
 *   in-flight agent run.
 *
 * The key is only as safe as this page is free of injected scripts. If a
 * third-party script ever runs in this origin, it can read the key from JS
 * memory at call time. This is a fundamental limitation of client-side API
 * keys; see `SECURITY_NOTES.md` for the honest disclosure.
 *
 * Model preference IS persisted to localStorage — it is a non-secret user
 * preference, identical in sensitivity to a UI theme choice.
 */

import { create } from 'zustand';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type AgentRole = 'user' | 'assistant' | 'system';

export interface ToolCallChip {
  /** Stable id within the message */
  id: string;
  /** Human-readable label, e.g. "Applied Gaussian Blur (radius: 4)" */
  label: string;
  /** Tool name, e.g. "applyFilter" */
  toolName: string;
  /** Raw args from the model */
  args: Record<string, unknown>;
  /** Status of the tool call */
  status: 'pending' | 'running' | 'success' | 'error' | 'rejected';
  /** Optional short status / error message */
  detail?: string;
  /** Optional thumbnail of the result (base64 data URL) */
  thumbnailBase64?: string;
}

export interface ChatMessage {
  id: string;
  role: AgentRole;
  text: string;
  /** Tool call chips attached to this assistant turn */
  toolCalls?: ToolCallChip[];
  /** ISO timestamp */
  ts: number;
}

export interface PendingPreview {
  /** Composite data URL of the canvas BEFORE the agent's edits (for diff) */
  beforeDataUrl: string;
  /** Composite data URL of the canvas AFTER applying the agent's edits */
  afterDataUrl: string;
  /** Label for the history entry if user accepts, e.g. "AI: brighten sky + vignette" */
  historyLabel: string;
  /** The list of tool-call ids that produced this preview (for traceability) */
  toolCallIds: string[];
}

/**
 * The offscreen workspace that produced the pending preview.
 *
 * CRITICAL: this is held in the store (not as a local in runAgent) so that
 * `commitPreview()` can copy each workspace layer's canvas back onto the
 * corresponding live layer by ID — preserving per-layer structure, alpha
 * transparency, and layer masks. The previous implementation discarded the
 * workspace and re-decoded a flattened JPEG composite, which silently:
 *   - flattened all layers into the active layer
 *   - baked transparency to opaque JPEG artifacts (e.g. autoBackgroundRemove)
 *
 * The type is `unknown` here because the store file doesn't import the
 * AgentWorkspace type (to avoid a circular import with tools.ts). The runner
 * and commitPreview both cast it to AgentWorkspace.
 */
export type PendingWorkspace = unknown;

export type AgentRunStatus =
  | 'idle'
  | 'running'
  | 'awaiting-accept'
  | 'cancelled'
  | 'error'
  | 'done';

interface AgentState {
  // --- API key (in-memory ONLY) ---
  apiKey: string | null;
  setApiKey: (key: string | null) => void;
  clearApiKey: () => void;

  // --- Model preference (persisted to localStorage; non-secret) ---
  model: string;
  setModel: (m: string) => void;

  // --- Chat thread ---
  messages: ChatMessage[];
  addMessage: (msg: Omit<ChatMessage, 'id' | 'ts'>) => string;
  updateMessage: (id: string, patch: Partial<ChatMessage>) => void;
  appendToolCall: (messageId: string, chip: ToolCallChip) => void;
  updateToolCall: (messageId: string, chipId: string, patch: Partial<ToolCallChip>) => void;
  clearChat: () => void;

  // --- Pending preview (Accept / Reject) ---
  pendingPreview: PendingPreview | null;
  setPendingPreview: (p: PendingPreview | null) => void;
  /**
   * The offscreen workspace that produced the pending preview. Held until the
   * user clicks Accept (commit copies layers back into the live store) or
   * Reject (workspace is discarded). See PendingWorkspace docs for why this
   * lives in the store rather than as a local in runAgent.
   */
  pendingWorkspace: PendingWorkspace | null;
  setPendingWorkspace: (ws: PendingWorkspace | null) => void;

  // --- Run state ---
  status: AgentRunStatus;
  setStatus: (s: AgentRunStatus) => void;
  /** Human-readable status line shown while running, e.g. "Calling Magic Wand at (412, 88)..." */
  statusLine: string;
  setStatusLine: (s: string) => void;

  /** Cancellation token — bumped on cancel/clear. The runner checks this between turns. */
  cancelToken: number;
  cancelRun: () => void;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/**
 * Default Gemini model. Per the project brief, prefer the current
 * "Flash-Lite" latest-alias model string so we don't pin a dated version.
 *
 * As of writing, Google exposes these alias strings:
 *   - "gemini-flash-latest"      (latest Flash, any generation)
 *   - "gemini-2.5-flash"         (pinned 2.5 Flash)
 *   - "gemini-2.5-flash-lite"    (pinned 2.5 Flash-Lite)
 *   - "gemini-2.5-pro"           (pinned 2.5 Pro)
 *
 * When Google ships a new generation, the alias strings update. We use the
 * explicit 2.5-flash-lite as default for stability, but expose all three in
 * the model picker. TODO: refresh this list when Gemini docs change.
 */
export const DEFAULT_MODEL = 'gemini-2.5-flash-lite';

/**
 * Model picker options. Verify current names/aliases from the Gemini API docs
 * before adding new entries here. Each entry must be a valid `model` path
 * segment for the generateContent endpoint.
 */
export const MODEL_OPTIONS: { value: string; label: string; hint: string }[] = [
  { value: 'gemini-2.5-flash-lite', label: 'Flash-Lite', hint: 'Fastest · cheapest · good for simple edits' },
  { value: 'gemini-2.5-flash', label: 'Flash', hint: 'Balanced speed & quality' },
  { value: 'gemini-2.5-pro', label: 'Pro', hint: 'Slowest · best for complex multi-step edits' },
];

/** Hard cap on tool calls per agent turn. See agent-runner.ts. */
export const MAX_TOOL_CALLS = 8;

const MODEL_LS_KEY = 'pixel-lab-agent-model';

function generateId(): string {
  return Math.random().toString(36).substring(2, 11) + Date.now().toString(36);
}

// Load model preference from localStorage (NON-SECRET — just a preference).
// We deliberately do NOT load any API key from localStorage here.
function loadInitialModel(): string {
  if (typeof window === 'undefined') return DEFAULT_MODEL;
  try {
    const stored = window.localStorage.getItem(MODEL_LS_KEY);
    if (stored && MODEL_OPTIONS.some((m) => m.value === stored)) return stored;
  } catch {
    /* ignore — private mode / disabled storage */
  }
  return DEFAULT_MODEL;
}

// ---------------------------------------------------------------------------
// Store
// ---------------------------------------------------------------------------

export const useAgentStore = create<AgentState>((set, get) => ({
  // API key — in-memory only
  apiKey: null,
  setApiKey: (key) => set({ apiKey: key ? key.trim() || null : null }),
  clearApiKey: () =>
    set({
      apiKey: null,
      status: 'idle',
      statusLine: '',
      pendingPreview: null,
      pendingWorkspace: null,
      // Cancel any in-flight run
      cancelToken: get().cancelToken + 1,
    }),

  // Model preference — persisted (non-secret)
  model: loadInitialModel(),
  setModel: (m) => {
    set({ model: m });
    if (typeof window !== 'undefined') {
      try {
        window.localStorage.setItem(MODEL_LS_KEY, m);
      } catch {
        /* ignore */
      }
    }
  },

  // Chat thread
  messages: [],
  addMessage: (msg) => {
    const id = generateId();
    set((s) => ({
      messages: [...s.messages, { ...msg, id, ts: Date.now() }],
    }));
    return id;
  },
  updateMessage: (id, patch) =>
    set((s) => ({
      messages: s.messages.map((m) => (m.id === id ? { ...m, ...patch } : m)),
    })),
  appendToolCall: (messageId, chip) =>
    set((s) => ({
      messages: s.messages.map((m) =>
        m.id === messageId
          ? { ...m, toolCalls: [...(m.toolCalls ?? []), chip] }
          : m,
      ),
    })),
  updateToolCall: (messageId, chipId, patch) =>
    set((s) => ({
      messages: s.messages.map((m) =>
        m.id === messageId
          ? {
              ...m,
              toolCalls: (m.toolCalls ?? []).map((c) =>
                c.id === chipId ? { ...c, ...patch } : c,
              ),
            }
          : m,
      ),
    })),
  clearChat: () => set({
    messages: [],
    pendingPreview: null,
    pendingWorkspace: null,
    status: 'idle',
    statusLine: '',
  }),

  // Pending preview + workspace (held together until Accept/Reject)
  pendingPreview: null,
  setPendingPreview: (p) => set({ pendingPreview: p }),
  pendingWorkspace: null,
  setPendingWorkspace: (ws) => set({ pendingWorkspace: ws }),

  // Run state
  status: 'idle',
  setStatus: (s) => set({ status: s }),
  statusLine: '',
  setStatusLine: (s) => set({ statusLine: s }),

  // Cancellation
  cancelToken: 0,
  cancelRun: () =>
    set((s) => ({
      status: 'cancelled',
      statusLine: '',
      cancelToken: s.cancelToken + 1,
    })),
}));
