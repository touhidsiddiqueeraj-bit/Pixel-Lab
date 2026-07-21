'use client';

/**
 * Automations Store — user-authored, deterministic sequences of editor operations.
 *
 * This is SEPARATE from the AI agent (Gemini) feature. Automations are fixed
 * sequences of tool calls that get saved as named "recipes" and run with one
 * click — no AI involved. They reuse the same `executeTool` layer as the agent.
 *
 * Persistence: localStorage (same pattern as Brush Presets). Keyed separately
 * from agent chat state so clearing agent state doesn't touch recipes.
 */

import { create } from 'zustand';
import { generateId } from '@/lib/utils';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface AutomationStep {
  /** Tool name — must match a name in TOOL_DECLARATIONS (src/lib/agent/tools.ts). */
  toolName: string;
  /** Args for that tool, matching its param schema. */
  args: Record<string, unknown>;
}

export interface Automation {
  id: string;
  name: string;
  steps: AutomationStep[];
  createdAt: number;
}

export type BatchFileStatus = 'queued' | 'processing' | 'done' | 'error';

export interface BatchFile {
  name: string;
  status: BatchFileStatus;
  error?: string;
}

interface AutomationsState {
  // --- Saved recipes (persisted to localStorage) ---
  automations: Automation[];
  addAutomation: (name: string, steps: AutomationStep[]) => string;
  deleteAutomation: (id: string) => void;
  renameAutomation: (id: string, name: string) => void;

  // --- Current draft (the recipe being edited in the panel, not yet saved) ---
  draftName: string;
  draftSteps: AutomationStep[];
  setDraftName: (name: string) => void;
  addDraftStep: (step: AutomationStep) => void;
  updateDraftStep: (index: number, patch: Partial<AutomationStep>) => void;
  removeDraftStep: (index: number) => void;
  reorderDraftSteps: (from: number, to: number) => void;
  clearDraft: () => void;
  loadAutomationIntoDraft: (id: string) => void;

  // --- Batch progress (not persisted) ---
  batchFiles: BatchFile[];
  setBatchFiles: (files: BatchFile[]) => void;
  updateBatchFile: (index: number, patch: Partial<BatchFile>) => void;
  clearBatch: () => void;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const LS_KEY = 'pixel-lab-automations';

// Load saved automations from localStorage.
function loadInitialAutomations(): Automation[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = window.localStorage.getItem(LS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) return parsed as Automation[];
  } catch {
    /* ignore — corrupt storage */
  }
  return [];
}

function persist(automations: Automation[]) {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(LS_KEY, JSON.stringify(automations));
  } catch {
    /* ignore — quota exceeded / private mode */
  }
}

// ---------------------------------------------------------------------------
// Store
// ---------------------------------------------------------------------------

export const useAutomationsStore = create<AutomationsState>((set, get) => ({
  // --- Saved recipes ---
  automations: loadInitialAutomations(),
  addAutomation: (name, steps) => {
    const id = generateId();
    const automation: Automation = {
      id,
      name: name.trim() || `Recipe ${get().automations.length + 1}`,
      steps: [...steps],
      createdAt: Date.now(),
    };
    set((s) => {
      const next = [...s.automations, automation];
      persist(next);
      return { automations: next };
    });
    return id;
  },
  deleteAutomation: (id) =>
    set((s) => {
      const next = s.automations.filter((a) => a.id !== id);
      persist(next);
      return { automations: next };
    }),
  renameAutomation: (id, name) =>
    set((s) => {
      const next = s.automations.map((a) =>
        a.id === id ? { ...a, name: name.trim() || a.name } : a,
      );
      persist(next);
      return { automations: next };
    }),

  // --- Draft (the recipe being edited) ---
  draftName: '',
  draftSteps: [],
  setDraftName: (name) => set({ draftName: name }),
  addDraftStep: (step) => set((s) => ({ draftSteps: [...s.draftSteps, step] })),
  updateDraftStep: (index, patch) =>
    set((s) => ({
      draftSteps: s.draftSteps.map((step, i) =>
        i === index ? { ...step, ...patch, args: patch.args ?? step.args } : step,
      ),
    })),
  removeDraftStep: (index) =>
    set((s) => ({
      draftSteps: s.draftSteps.filter((_, i) => i !== index),
    })),
  reorderDraftSteps: (from, to) =>
    set((s) => {
      const next = [...s.draftSteps];
      const [moved] = next.splice(from, 1);
      next.splice(to, 0, moved);
      return { draftSteps: next };
    }),
  clearDraft: () => set({ draftName: '', draftSteps: [] }),
  loadAutomationIntoDraft: (id) => {
    const a = get().automations.find((x) => x.id === id);
    if (a) {
      set({ draftName: a.name, draftSteps: a.steps.map((s) => ({ ...s, args: { ...s.args } })) });
    }
  },

  // --- Batch progress ---
  batchFiles: [],
  setBatchFiles: (files) => set({ batchFiles: files }),
  updateBatchFile: (index, patch) =>
    set((s) => ({
      batchFiles: s.batchFiles.map((f, i) => (i === index ? { ...f, ...patch } : f)),
    })),
  clearBatch: () => set({ batchFiles: [] }),
}));
