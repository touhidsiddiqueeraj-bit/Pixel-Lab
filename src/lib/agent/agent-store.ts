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
  /**
   * The user's original natural-language request. Tracked here so that
   * commitPreview/rejectPreview can record a PreferenceEntry with the request
   * text (the runner doesn't otherwise have a way to pass this through to
   * the commit/reject handlers).
   */
  userRequest: string;
  /**
   * Human-readable labels for each tool call (e.g. "Applied Gaussian Blur").
   * Tracked here for the same reason as userRequest — so the preference
   * entry can include which tools were used.
   */
  toolCallLabels: string[];
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
  | 'self-evaluating'
  | 'awaiting-accept'
  | 'cancelled'
  | 'error'
  | 'done';

// ---------------------------------------------------------------------------
// User preference memory
// ---------------------------------------------------------------------------

/**
 * A single accept/reject event — one row in the user's preference history.
 *
 * The agent records one of these every time the user accepts or rejects a
 * pending preview. Over time, this builds up a profile of what the user
 * likes and dislikes, which is fed back into the agent's system prompt on
 * subsequent runs (see `getPreferenceSummaryForPrompt`).
 *
 * Stored in localStorage (non-secret — it's just edit preferences, no API
 * keys, no images). The before/after thumbnails are downscaled to ~256px to
 * keep storage small.
 */
export interface PreferenceEntry {
  /** Stable id. */
  id: string;
  /** ISO timestamp. */
  ts: number;
  /** The user's original natural-language request. */
  userRequest: string;
  /** Short label of what the agent did (the history label). */
  agentAction: string;
  /** List of tool-call labels the agent made. */
  toolCalls: string[];
  /** 'accepted' or 'rejected'. */
  decision: 'accepted' | 'rejected';
  /** Optional short reason if the user provided one (future: UI could add a
   * "why are you rejecting?" prompt). Empty for now. */
  reason?: string;
  /** Self-evaluation score the agent gave itself (1-10), if available. */
  selfScore?: number;
  /** Self-evaluation reasoning the agent gave itself, if available. */
  selfReasoning?: string;
}

/**
 * The maximum number of preference entries we keep in localStorage.
 * Older entries are pruned on append. 50 is enough to capture a session's
 * worth of preferences without bloating storage (each entry is ~1-2KB
 * without images, so 50 entries ≈ 100KB max).
 */
export const MAX_PREFERENCE_ENTRIES = 50;

const PREFERENCES_LS_KEY = 'pixel-lab-agent-preferences';

/**
 * Load preference entries from localStorage. Returns [] on any error
 * (corrupt JSON, disabled storage, SSR).
 *
 * NOTE: this is called lazily from the store initializer (not at module
 * load) so SSR doesn't trip on `window` being undefined.
 */
function loadPreferences(): PreferenceEntry[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = window.localStorage.getItem(PREFERENCES_LS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    // Basic shape validation — discard entries that don't match.
    return parsed.filter((e: unknown): e is PreferenceEntry =>
      typeof e === 'object' && e !== null
      && 'id' in e && 'ts' in e && 'userRequest' in e
      && 'agentAction' in e && 'toolCalls' in e && 'decision' in e
      && (e.decision === 'accepted' || e.decision === 'rejected')
    );
  } catch {
    return [];
  }
}

/**
 * Persist preference entries to localStorage. Silently no-ops on error.
 */
function savePreferences(entries: PreferenceEntry[]): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(PREFERENCES_LS_KEY, JSON.stringify(entries));
  } catch {
    /* ignore — private mode / disabled storage / quota exceeded */
  }
}

/**
 * Build a textual summary of the user's preferences from the entry history,
 * suitable for inclusion in the agent's system prompt.
 *
 * Strategy: extract patterns from the accept/reject history.
 *   - Count which tool types are most-accepted vs most-rejected.
 *   - Count which user-request keywords correlate with accept vs reject.
 *   - Surface the most recent few accepted/rejected examples verbatim.
 *
 * The output is a short paragraph (3-8 lines) that the agent can read and
 * adapt to. We deliberately keep it short so it doesn't bloat the system
 * prompt — the goal is to nudge the agent, not to give it a textbook.
 */
export function buildPreferenceSummary(entries: PreferenceEntry[]): string {
  if (entries.length === 0) return '';

  const accepted = entries.filter(e => e.decision === 'accepted');
  const rejected = entries.filter(e => e.decision === 'rejected');

  if (accepted.length === 0 && rejected.length === 0) return '';

  const lines: string[] = [];

  // Overall accept rate.
  const acceptRate = entries.length > 0
    ? Math.round((accepted.length / entries.length) * 100)
    : 0;
  lines.push(`User acceptance rate so far: ${acceptRate}% (${accepted.length} accepted, ${rejected.length} rejected out of ${entries.length} edits).`);

  // Most-accepted tool types.
  const toolAcceptCounts: Record<string, { accept: number; reject: number }> = {};
  for (const e of entries) {
    for (const tc of e.toolCalls) {
      // Extract the tool verb from the chip label (e.g. "Applied Gaussian Blur"
      // → "Gaussian Blur"; "Selected region by point" → "selectRegionByPoint").
      // We use the raw label lowercased for grouping.
      const key = tc.toLowerCase().split(' ').slice(0, 3).join(' ');
      if (!toolAcceptCounts[key]) toolAcceptCounts[key] = { accept: 0, reject: 0 };
      toolAcceptCounts[key][e.decision === 'accepted' ? 'accept' : 'reject']++;
    }
  }
  // Find tools with a strong skew (≥2 occurrences, ≥67% one direction).
  const loved: string[] = [];
  const disliked: string[] = [];
  for (const [key, counts] of Object.entries(toolAcceptCounts)) {
    const total = counts.accept + counts.reject;
    if (total < 2) continue;
    if (counts.accept / total >= 0.67) loved.push(`${key} (${counts.accept}/${total} accepted)`);
    else if (counts.reject / total >= 0.67) disliked.push(`${key} (${counts.reject}/${total} rejected)`);
  }
  if (loved.length > 0) {
    lines.push(`User tends to ACCEPT edits involving: ${loved.slice(0, 4).join(', ')}.`);
  }
  if (disliked.length > 0) {
    lines.push(`User tends to REJECT edits involving: ${disliked.slice(0, 4).join(', ')}.`);
  }

  // Self-eval accuracy: how often did the agent's own self-score agree with
  // the user's decision? (Self-score ≥7 → predicted accept; <7 → predicted reject.)
  const scored = entries.filter(e => typeof e.selfScore === 'number');
  if (scored.length >= 3) {
    let agreed = 0;
    for (const e of scored) {
      const predicted = (e.selfScore ?? 0) >= 7 ? 'accepted' : 'rejected';
      if (predicted === e.decision) agreed++;
    }
    const agreementRate = Math.round((agreed / scored.length) * 100);
    lines.push(`Self-evaluation agrees with user ${agreementRate}% of the time (${agreed}/${scored.length}).`);
  }

  // Most recent few examples (last 3 accepted + last 2 rejected).
  const recentAccepted = accepted.slice(-3).reverse();
  const recentRejected = rejected.slice(-2).reverse();
  if (recentAccepted.length > 0) {
    lines.push('Recent ACCEPTED requests:');
    for (const e of recentAccepted) {
      lines.push(`  ✓ "${e.userRequest}" → ${e.agentAction}`);
    }
  }
  if (recentRejected.length > 0) {
    lines.push('Recent REJECTED requests (avoid similar):');
    for (const e of recentRejected) {
      lines.push(`  ✗ "${e.userRequest}" → ${e.agentAction}`);
    }
  }

  return lines.join('\n');
}

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

  // --- Self-evaluation (vision-based quality review before showing preview) ---
  /**
   * The most recent self-evaluation result. Set by the runner after the agent
   * finishes its tool calls but BEFORE the preview is shown to the user.
   * Read by the UI to display the agent's self-score and reasoning alongside
   * the Accept/Reject buttons.
   *
   * Null when no self-eval has run for the current preview (e.g. self-eval is
   * disabled, or the run was cancelled before reaching the eval step).
   */
  selfEval: SelfEvalResult | null;
  setSelfEval: (r: SelfEvalResult | null) => void;

  // --- User preference memory (persisted to localStorage; non-secret) ---
  /**
   * Append-only history of accept/reject decisions. Used by
   * `buildPreferenceSummary` to derive a textual preference profile that gets
   * injected into the agent's system prompt on subsequent runs.
   */
  preferenceEntries: PreferenceEntry[];
  /** Append a preference entry and persist to localStorage. */
  addPreferenceEntry: (entry: Omit<PreferenceEntry, 'id' | 'ts'>) => void;
  /** Clear all preference entries (and localStorage). */
  clearPreferences: () => void;
  /**
   * Get the current textual preference summary. Computed on demand from
   * `preferenceEntries`. Returns '' if no entries.
   */
  getPreferenceSummary: () => string;
}

/**
 * Result of the agent's self-evaluation step.
 *
 * The runner captures a before/after image pair after the agent's tool calls
 * finish, sends them to Gemini Vision with a prompt asking it to rate the
 * quality of the edit, and stores the result here. The UI shows the score
 * and reasoning alongside the Accept/Reject buttons.
 *
 * If the score is below the retry threshold, the runner retries the edit
 * (with feedback) up to MAX_RETRIES times before showing the preview.
 */
export interface SelfEvalResult {
  /** Quality score 1-10 (10 = perfect). */
  score: number;
  /** Short reasoning (1-2 sentences) explaining the score. */
  reasoning: string;
  /** Which retry attempt this is (0 = first try, 1 = first retry, etc.). */
  attempt: number;
  /** True if the agent decided this attempt is good enough to show the user. */
  accepted: boolean;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/**
 * Default Gemini model. Uses the `-latest` alias so it auto-updates to the
 * newest Flash-Lite release without code changes.
 *
 * Google's latest alias strings (as of 2025-2026):
 *   - "gemini-flash-lite-latest"  → latest Flash-Lite (currently gemini-3.1-flash-lite)
 *   - "gemini-flash-latest"       → latest Flash (currently gemini-3.5-flash)
 *   - "gemini-pro-latest"         → latest Pro (currently gemini-3-pro-preview)
 *
 * Using `-latest` aliases means we NEVER need to update this code when Google
 * ships a new model generation — the alias auto-points to the new version.
 * See: https://ai.google.dev/gemini-api/docs/models
 */
export const DEFAULT_MODEL = 'gemini-flash-lite-latest';

/**
 * Model picker options. Uses Google's `-latest` aliases so the picker never
 * goes out of date — Google updates these aliases when they ship new models.
 *
 * If a user needs a pinned version (e.g. for reproducibility), they can type
 * a specific model string like "gemini-3.1-flash-lite" in the model field.
 *
 * Docs: https://ai.google.dev/gemini-api/docs/models
 */
export const MODEL_OPTIONS: { value: string; label: string; hint: string }[] = [
  { value: 'gemini-flash-lite-latest', label: 'Flash-Lite (Latest)', hint: 'Fastest · cheapest · currently 3.1 Flash-Lite' },
  { value: 'gemini-flash-latest', label: 'Flash (Latest)', hint: 'Balanced speed & quality · currently 3.5 Flash' },
  { value: 'gemini-pro-latest', label: 'Pro (Latest)', hint: 'Slowest · best for complex multi-step edits' },
];

/** Hard cap on tool calls per agent turn. See agent-runner.ts. */
export const MAX_TOOL_CALLS = 8;

const MODEL_LS_KEY = 'pixel-lab-agent-model';

function generateId(): string {
  return Math.random().toString(36).substring(2, 11) + Date.now().toString(36);
}

// Load model preference from localStorage (NON-SECRET — just a preference).
// We deliberately do NOT load any API key from localStorage here.
// Also migrates old pinned model strings (e.g. "gemini-2.5-flash-lite") to
// the new `-latest` aliases so users don't get stuck on a deprecated model.
function loadInitialModel(): string {
  if (typeof window === 'undefined') return DEFAULT_MODEL;
  try {
    const stored = window.localStorage.getItem(MODEL_LS_KEY);
    if (!stored) return DEFAULT_MODEL;
    // If it's already a valid option, use it.
    if (MODEL_OPTIONS.some((m) => m.value === stored)) return stored;
    // Migrate old pinned model strings to their -latest equivalents.
    const migrations: Record<string, string> = {
      'gemini-2.5-flash-lite': 'gemini-flash-lite-latest',
      'gemini-2.5-flash': 'gemini-flash-latest',
      'gemini-2.5-pro': 'gemini-pro-latest',
    };
    if (migrations[stored]) {
      window.localStorage.setItem(MODEL_LS_KEY, migrations[stored]);
      return migrations[stored];
    }
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
    selfEval: null,
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

  // Self-evaluation result (cleared on each new run)
  selfEval: null,
  setSelfEval: (r) => set({ selfEval: r }),

  // User preference memory — loaded lazily (SSR-safe)
  preferenceEntries: loadPreferences(),
  addPreferenceEntry: (entry) => {
    const full: PreferenceEntry = {
      ...entry,
      id: generateId(),
      ts: Date.now(),
    };
    const next = [...get().preferenceEntries, full].slice(-MAX_PREFERENCE_ENTRIES);
    savePreferences(next);
    set({ preferenceEntries: next });
  },
  clearPreferences: () => {
    savePreferences([]);
    set({ preferenceEntries: [] });
  },
  getPreferenceSummary: () => buildPreferenceSummary(get().preferenceEntries),
}));
