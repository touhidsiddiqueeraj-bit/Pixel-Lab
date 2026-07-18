'use client';

/**
 * AutomationsPanel — step-list card for authoring and running automation recipes.
 *
 * Layout: recipe name at top, vertical drag-reorder list of steps, "Save recipe"
 * + "Run on current doc" + "Run on batch" buttons. Saved recipes appear in a
 * list below with run/edit/delete actions.
 *
 * The step builder uses a dropdown of tool names (sourced from
 * TOOL_DECLARATIONS) + a dynamic form generated from that tool's JSON schema.
 * No per-tool hand-building — the form reads the schema's property types.
 */

import { useState, useMemo, useCallback, useRef } from 'react';
import { useAutomationsStore, type AutomationStep, type BatchFile } from '@/lib/automations/automations-store';
import { runAutomationOnCurrentDoc, runAutomationBatch } from '@/lib/automations/automation-runner';
import { TOOL_DECLARATIONS } from '@/lib/agent/tools';
import type { GeminiFunctionDeclaration } from '@/lib/agent/gemini-client';
import { useEditorStore } from '@/lib/editor-store';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { toast } from 'sonner';
import {
  Play,
  Save,
  Trash2,
  Plus,
  Copy,
  Edit3,
  ChevronUp,
  ChevronDown,
  X,
  Layers,
  Loader2,
  CheckCircle2,
  AlertCircle,
  Clock,
  FileImage,
} from 'lucide-react';
import { cn } from '@/lib/utils';

// ---------------------------------------------------------------------------
// Main panel
// ---------------------------------------------------------------------------

export function AutomationsPanel() {
  const automations = useAutomationsStore((s) => s.automations);
  const draftName = useAutomationsStore((s) => s.draftName);
  const draftSteps = useAutomationsStore((s) => s.draftSteps);
  const setDraftName = useAutomationsStore((s) => s.setDraftName);
  const addDraftStep = useAutomationsStore((s) => s.addDraftStep);
  const removeDraftStep = useAutomationsStore((s) => s.removeDraftStep);
  const reorderDraftSteps = useAutomationsStore((s) => s.reorderDraftSteps);
  const clearDraft = useAutomationsStore((s) => s.clearDraft);
  const addAutomation = useAutomationsStore((s) => s.addAutomation);
  const deleteAutomation = useAutomationsStore((s) => s.deleteAutomation);
  const loadAutomationIntoDraft = useAutomationsStore((s) => s.loadAutomationIntoDraft);

  const [running, setRunning] = useState(false);
  const [batchOpen, setBatchOpen] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleAddStep = useCallback((step: AutomationStep) => {
    addDraftStep(step);
  }, [addDraftStep]);

  const handleSave = useCallback(() => {
    if (draftSteps.length === 0) {
      toast.error('Add at least one step before saving.');
      return;
    }
    addAutomation(draftName, draftSteps);
    toast.success(`Recipe "${draftName || 'Untitled'}" saved.`);
    clearDraft();
  }, [draftName, draftSteps, addAutomation, clearDraft]);

  const handleRunCurrent = useCallback(async () => {
    if (draftSteps.length === 0) {
      toast.error('Add at least one step before running.');
      return;
    }
    setRunning(true);
    const label = draftName || `Automation (${draftSteps.length} steps)`;
    try {
      const result = await runAutomationOnCurrentDoc(draftSteps, label);
      if (result.success) {
        toast.success(result.message);
      } else {
        toast.error(result.message);
      }
    } catch (e) {
      toast.error(`Run failed: ${(e as Error).message}`);
    } finally {
      setRunning(false);
    }
  }, [draftSteps, draftName]);

  const handleRunBatch = useCallback(async (files: File[]) => {
    if (files.length === 0) return;
    if (draftSteps.length === 0) {
      toast.error('Add at least one step before running batch.');
      return;
    }
    setRunning(true);
    setBatchOpen(true);
    const store = useAutomationsStore.getState();
    const batchFiles: BatchFile[] = files.map((f) => ({ name: f.name, status: 'queued' }));
    store.setBatchFiles(batchFiles);

    try {
      await runAutomationBatch(files, draftSteps, (index, result) => {
        useAutomationsStore.getState().updateBatchFile(index, {
          status: result.success ? 'done' : 'error',
          error: result.error,
        });
      });
      const successCount = useAutomationsStore.getState().batchFiles.filter(f => f.status === 'done').length;
      const failCount = useAutomationsStore.getState().batchFiles.filter(f => f.status === 'error').length;
      if (failCount === 0) {
        toast.success(`Batch complete: ${successCount} file(s) processed.`);
      } else {
        toast.message(`Batch complete: ${successCount} succeeded, ${failCount} failed.`);
      }
    } catch (e) {
      toast.error(`Batch failed: ${(e as Error).message}`);
    } finally {
      setRunning(false);
    }
  }, [draftSteps]);

  const handleRunSaved = useCallback(async (automationId: string) => {
    const a = automations.find((x) => x.id === automationId);
    if (!a) return;
    setRunning(true);
    try {
      const result = await runAutomationOnCurrentDoc(a.steps, a.name);
      if (result.success) {
        toast.success(result.message);
      } else {
        toast.error(result.message);
      }
    } catch (e) {
      toast.error(`Run failed: ${(e as Error).message}`);
    } finally {
      setRunning(false);
    }
  }, [automations]);

  return (
    <div className="flex flex-col h-full editor-surface editor-text overflow-hidden">
      {/* Header */}
      <div className="px-3 py-2 border-b editor-border flex items-center gap-2 shrink-0">
        <Layers size={14} className="editor-accent shrink-0" />
        <span className="text-xs font-semibold uppercase tracking-wide editor-text-muted">
          Automations
        </span>
        <span className="ml-auto text-[10px] editor-text-dim">
          {automations.length} saved
        </span>
      </div>

      {/* Scrollable content */}
      <div className="flex-1 min-h-0 overflow-y-auto custom-scroll p-3 space-y-3">
        {/* Recipe name input */}
        <div className="space-y-1">
          <Label className="text-[10px] editor-text-dim uppercase tracking-wide">Recipe Name</Label>
          <Input
            value={draftName}
            onChange={(e) => setDraftName(e.target.value)}
            placeholder="e.g. Warm Portrait Look"
            className="h-8 text-xs"
          />
        </div>

        {/* Steps list */}
        <div className="space-y-1.5">
          <Label className="text-[10px] editor-text-dim uppercase tracking-wide">
            Steps ({draftSteps.length})
          </Label>
          {draftSteps.length === 0 ? (
            <div className="text-[11px] editor-text-dim italic p-2 rounded-md editor-surface-2 border editor-border text-center">
              No steps yet. Add one below ↓
            </div>
          ) : (
            draftSteps.map((step, i) => (
              <StepCard
                key={i}
                index={i}
                step={step}
                onRemove={() => removeDraftStep(i)}
                onMoveUp={() => i > 0 && reorderDraftSteps(i, i - 1)}
                onMoveDown={() => i < draftSteps.length - 1 && reorderDraftSteps(i, i + 1)}
              />
            ))
          )}
        </div>

        {/* Add step builder */}
        <StepBuilder onAdd={handleAddStep} />

        {/* Action buttons */}
        <div className="space-y-1.5 pt-1">
          <Button
            onClick={handleRunCurrent}
            disabled={running || draftSteps.length === 0}
            className="w-full h-8 text-xs editor-accent-bg hover:editor-accent-bg text-white gap-1"
            title="Run on the current document"
          >
            {running ? <Loader2 size={12} className="animate-spin" /> : <Play size={12} />}
            Run on Current Doc
          </Button>
          <div className="flex gap-1.5">
            <Button
              onClick={() => fileInputRef.current?.click()}
              disabled={running || draftSteps.length === 0}
              variant="outline"
              className="flex-1 h-8 text-xs gap-1 editor-border"
              title="Run on multiple files"
            >
              <FileImage size={12} />
              Run on Batch
            </Button>
            <Button
              onClick={handleSave}
              disabled={draftSteps.length === 0}
              variant="outline"
              className="flex-1 h-8 text-xs gap-1 editor-border"
              title="Save as a named recipe"
            >
              <Save size={12} />
              Save Recipe
            </Button>
          </div>
          {(draftSteps.length > 0 || draftName) && (
            <Button
              onClick={clearDraft}
              variant="ghost"
              size="sm"
              className="w-full h-7 text-[10px] editor-text-muted hover:editor-surface-3"
            >
              Clear Draft
            </Button>
          )}
        </div>

        {/* Batch progress */}
        {batchOpen && <BatchProgress onClose={() => setBatchOpen(false)} />}

        {/* Saved recipes */}
        <div className="space-y-1.5 pt-2 border-t editor-border">
          <Label className="text-[10px] editor-text-dim uppercase tracking-wide">Saved Recipes</Label>
          {automations.length === 0 ? (
            <div className="text-[11px] editor-text-dim italic p-2 rounded-md editor-surface-2 border editor-border text-center">
              No saved recipes yet. Build one above and click Save.
            </div>
          ) : (
            <div className="space-y-1">
              {automations.map((a) => (
                <SavedRecipeRow
                  key={a.id}
                  automation={a}
                  onRun={() => handleRunSaved(a.id)}
                  onEdit={() => loadAutomationIntoDraft(a.id)}
                  onDelete={() => {
                    deleteAutomation(a.id);
                    toast.success(`Deleted "${a.name}"`);
                  }}
                  disabled={running}
                />
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Hidden file input for batch */}
      <input
        ref={fileInputRef}
        type="file"
        multiple
        accept="image/*"
        className="hidden"
        onChange={(e) => {
          const files = Array.from(e.target.files || []);
          if (files.length > 0) handleRunBatch(files);
          // Reset so the same files can be selected again
          e.target.value = '';
        }}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Step card (one row in the steps list)
// ---------------------------------------------------------------------------

function StepCard({
  index,
  step,
  onRemove,
  onMoveUp,
  onMoveDown,
}: {
  index: number;
  step: AutomationStep;
  onRemove: () => void;
  onMoveUp: () => void;
  onMoveDown: () => void;
}) {
  const argsPreview = useMemo(() => {
    const entries = Object.entries(step.args);
    if (entries.length === 0) return '';
    return entries
      .slice(0, 3)
      .map(([k, v]) => {
        const val = typeof v === 'object' ? JSON.stringify(v) : String(v);
        return `${k}: ${val.length > 20 ? val.slice(0, 20) + '…' : val}`;
      })
      .join(', ');
  }, [step.args]);

  return (
    <div className="flex items-center gap-1.5 p-1.5 rounded-md editor-surface-2 border editor-border group">
      <span className="text-[10px] editor-text-dim font-mono w-4 text-center shrink-0">{index + 1}</span>
      <div className="flex-1 min-w-0">
        <div className="text-xs editor-text font-medium truncate">{step.toolName}</div>
        {argsPreview && (
          <div className="text-[10px] editor-text-dim truncate font-mono">{argsPreview}</div>
        )}
      </div>
      <div className="flex items-center gap-0.5 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity">
        <button
          onClick={onMoveUp}
          className="p-0.5 editor-text-muted hover:editor-text hover:editor-surface-3 rounded"
          title="Move up"
        >
          <ChevronUp size={12} />
        </button>
        <button
          onClick={onMoveDown}
          className="p-0.5 editor-text-muted hover:editor-text hover:editor-surface-3 rounded"
          title="Move down"
        >
          <ChevronDown size={12} />
        </button>
        <button
          onClick={onRemove}
          className="p-0.5 text-red-500 hover:text-red-400 hover:bg-red-500/10 rounded"
          title="Remove step"
        >
          <X size={12} />
        </button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Step builder — dropdown of tool names + dynamic form from schema
// ---------------------------------------------------------------------------

function StepBuilder({ onAdd }: { onAdd: (step: AutomationStep) => void }) {
  const [selectedTool, setSelectedTool] = useState<string>('');
  const [args, setArgs] = useState<Record<string, unknown>>({});

  const toolDecl = useMemo(
    () => TOOL_DECLARATIONS.find((t) => t.name === selectedTool),
    [selectedTool],
  );

  const properties = useMemo(() => {
    if (!toolDecl?.parameters?.properties) return {};
    return toolDecl.parameters.properties as Record<string, { type: string; description?: string; enum?: string[]; items?: unknown }>;
  }, [toolDecl]);

  const requiredFields = useMemo(() => toolDecl?.parameters?.required ?? [], [toolDecl]);

  const handleToolChange = (name: string) => {
    setSelectedTool(name);
    // Initialize args with defaults for each property.
    const decl = TOOL_DECLARATIONS.find((t) => t.name === name);
    const props = (decl?.parameters?.properties ?? {}) as Record<string, { type: string }>;
    const initial: Record<string, unknown> = {};
    for (const [key, prop] of Object.entries(props)) {
      if (prop.type === 'number') initial[key] = 0;
      else if (prop.type === 'boolean') initial[key] = false;
      else if (prop.type === 'string') initial[key] = '';
      else if (prop.type === 'object') initial[key] = {};
      else if (prop.type === 'array') initial[key] = [];
      else initial[key] = null;
    }
    setArgs(initial);
  };

  const handleAdd = () => {
    if (!selectedTool) {
      toast.error('Select a tool first.');
      return;
    }
    // Check required fields
    for (const req of requiredFields) {
      const val = args[req];
      if (val === undefined || val === null || val === '') {
        toast.error(`Missing required field: ${req}`);
        return;
      }
    }
    onAdd({ toolName: selectedTool, args: { ...args } });
    toast.success(`Added step: ${selectedTool}`);
    // Reset the builder for the next step
    setSelectedTool('');
    setArgs({});
  };

  return (
    <div className="space-y-2 p-2.5 rounded-md editor-surface-2 border editor-border">
      <Label className="text-[10px] editor-text-dim uppercase tracking-wide">Add Step</Label>
      <Select value={selectedTool} onValueChange={handleToolChange}>
        <SelectTrigger className="h-8 text-xs editor-surface editor-border">
          <SelectValue placeholder="Choose a tool…" />
        </SelectTrigger>
        <SelectContent className="max-h-[300px]">
          {TOOL_DECLARATIONS.map((t) => (
            <SelectItem key={t.name} value={t.name} className="text-xs">
              <div className="flex flex-col">
                <span className="font-medium">{t.name}</span>
                <span className="text-[10px] editor-text-dim line-clamp-2">{t.description.slice(0, 80)}…</span>
              </div>
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      {/* Dynamic form generated from the tool's JSON schema */}
      {selectedTool && Object.keys(properties).length > 0 && (
        <div className="space-y-1.5 pt-1">
          {Object.entries(properties).map(([key, prop]) => (
            <PropertyInput
              key={key}
              name={key}
              prop={prop}
              value={args[key]}
              required={requiredFields.includes(key)}
              onChange={(val) => setArgs((a) => ({ ...a, [key]: val }))}
            />
          ))}
        </div>
      )}

      {selectedTool && (
        <Button
          onClick={handleAdd}
          size="sm"
          className="w-full h-7 text-xs editor-accent-bg hover:editor-accent-bg text-white gap-1"
        >
          <Plus size={12} />
          Add Step
        </Button>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Property input — generates the right input based on the JSON schema type
// ---------------------------------------------------------------------------

function PropertyInput({
  name,
  prop,
  value,
  required,
  onChange,
}: {
  name: string;
  prop: { type: string; description?: string; enum?: string[]; items?: unknown };
  value: unknown;
  required: boolean;
  onChange: (val: unknown) => void;
}) {
  const label = (
    <Label className="text-[10px] editor-text-dim flex items-center gap-1">
      {name}
      {required && <span className="text-red-500">*</span>}
      <span className="editor-text-dim font-normal">({prop.type})</span>
    </Label>
  );

  // Try to extract enum values from the description if not explicitly in enum.
  // The tool descriptions often list valid values like "One of: foo, bar, baz".
  const enumFromDesc = useMemo(() => {
    if (prop.enum) return prop.enum;
    if (prop.type === 'string' && prop.description) {
      const match = prop.description.match(/One of:\s*([^.)]+)/);
      if (match) {
        return match[1].split(',').map((s) => s.trim());
      }
    }
    return null;
  }, [prop]);

  if (prop.type === 'string' && enumFromDesc) {
    return (
      <div className="space-y-0.5">
        {label}
        <Select value={String(value ?? '')} onValueChange={onChange}>
          <SelectTrigger className="h-7 text-xs editor-surface editor-border">
            <SelectValue placeholder={`Select ${name}…`} />
          </SelectTrigger>
          <SelectContent>
            {enumFromDesc.map((v) => (
              <SelectItem key={v} value={v} className="text-xs">{v}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
    );
  }

  if (prop.type === 'string') {
    return (
      <div className="space-y-0.5">
        {label}
        <Input
          type="text"
          value={String(value ?? '')}
          onChange={(e) => onChange(e.target.value)}
          placeholder={prop.description?.slice(0, 40) ?? ''}
          className="h-7 text-xs"
        />
      </div>
    );
  }

  if (prop.type === 'number') {
    // Try to extract range from description, e.g. "0-100" or "-100..100"
    const rangeMatch = prop.description?.match(/(-?\d+(?:\.\d+)?)[.\-](-?\d+(?:\.\d+)?)/);
    const min = rangeMatch ? parseFloat(rangeMatch[1]) : undefined;
    const max = rangeMatch ? parseFloat(rangeMatch[2]) : undefined;
    return (
      <div className="space-y-0.5">
        {label}
        <Input
          type="number"
          value={value as number ?? 0}
          onChange={(e) => onChange(parseFloat(e.target.value) || 0)}
          min={min}
          max={max}
          step={max && min && (max - min) > 10 ? 1 : 0.1}
          placeholder={prop.description?.slice(0, 40) ?? ''}
          className="h-7 text-xs"
        />
      </div>
    );
  }

  if (prop.type === 'boolean') {
    return (
      <div className="flex items-center justify-between gap-2 py-0.5">
        {label}
        <button
          onClick={() => onChange(!value)}
          className={cn(
            'relative w-9 h-5 rounded-full transition-colors shrink-0',
            value ? 'editor-accent-bg' : 'editor-surface-3',
          )}
        >
          <span
            className={cn(
              'absolute top-0.5 w-4 h-4 rounded-full bg-white transition-transform',
              value ? 'translate-x-4' : 'translate-x-0.5',
            )}
          />
        </button>
      </div>
    );
  }

  if (prop.type === 'object') {
    // For object params (like applyFilter's `params`), use a JSON textarea.
    return (
      <div className="space-y-0.5">
        {label}
        <textarea
          value={typeof value === 'object' ? JSON.stringify(value, null, 0) : String(value ?? '{}')}
          onChange={(e) => {
            try {
              onChange(JSON.parse(e.target.value));
            } catch {
              // Keep the raw text — user is still typing
            }
          }}
          placeholder='{"radius": 4}'
          rows={2}
          className="w-full text-xs font-mono rounded-md border editor-border bg-transparent editor-surface px-2 py-1 editor-text outline-none focus-visible:ring-1 focus-visible:ring-editor-accent/40"
        />
      </div>
    );
  }

  if (prop.type === 'array') {
    // For array params (like drawBrushStroke's points), use a JSON textarea.
    return (
      <div className="space-y-0.5">
        {label}
        <textarea
          value={Array.isArray(value) ? JSON.stringify(value) : String(value ?? '[]')}
          onChange={(e) => {
            try {
              onChange(JSON.parse(e.target.value));
            } catch {
              // Keep the raw text
            }
          }}
          placeholder='[{"x":0.5,"y":0.5}]'
          rows={2}
          className="w-full text-xs font-mono rounded-md border editor-border bg-transparent editor-surface px-2 py-1 editor-text outline-none focus-visible:ring-1 focus-visible:ring-editor-accent/40"
        />
      </div>
    );
  }

  // Fallback: raw text
  return (
    <div className="space-y-0.5">
      {label}
      <Input
        type="text"
        value={String(value ?? '')}
        onChange={(e) => onChange(e.target.value)}
        className="h-7 text-xs"
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Saved recipe row
// ---------------------------------------------------------------------------

function SavedRecipeRow({
  automation,
  onRun,
  onEdit,
  onDelete,
  disabled,
}: {
  automation: { id: string; name: string; steps: AutomationStep[] };
  onRun: () => void;
  onEdit: () => void;
  onDelete: () => void;
  disabled: boolean;
}) {
  return (
    <div className="flex items-center gap-1.5 p-1.5 rounded-md editor-surface-2 border editor-border group">
      <div className="flex-1 min-w-0">
        <div className="text-xs editor-text font-medium truncate">{automation.name}</div>
        <div className="text-[10px] editor-text-dim truncate">
          {automation.steps.length} step{automation.steps.length === 1 ? '' : 's'}: {automation.steps.map(s => s.toolName).join(' → ')}
        </div>
      </div>
      <div className="flex items-center gap-0.5 shrink-0">
        <button
          onClick={onRun}
          disabled={disabled}
          className="p-1 editor-accent hover:editor-accent-bg hover:text-white rounded disabled:opacity-30"
          title="Run on current doc"
        >
          <Play size={12} />
        </button>
        <button
          onClick={onEdit}
          className="p-1 editor-text-muted hover:editor-text hover:editor-surface-3 rounded"
          title="Edit (load into draft)"
        >
          <Edit3 size={12} />
        </button>
        <button
          onClick={onDelete}
          className="p-1 text-red-500 hover:text-red-400 hover:bg-red-500/10 rounded"
          title="Delete recipe"
        >
          <Trash2 size={12} />
        </button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Batch progress — per-file status list
// ---------------------------------------------------------------------------

function BatchProgress({ onClose }: { onClose: () => void }) {
  const batchFiles = useAutomationsStore((s) => s.batchFiles);
  const done = batchFiles.filter(f => f.status === 'done').length;
  const error = batchFiles.filter(f => f.status === 'error').length;
  const processing = batchFiles.filter(f => f.status === 'processing').length;
  const queued = batchFiles.filter(f => f.status === 'queued').length;

  return (
    <div className="space-y-1.5 p-2 rounded-md editor-surface-2 border editor-border">
      <div className="flex items-center justify-between">
        <Label className="text-[10px] editor-text-dim uppercase tracking-wide">Batch Progress</Label>
        <button onClick={onClose} className="p-0.5 editor-text-muted hover:editor-text">
          <X size={12} />
        </button>
      </div>
      <div className="flex gap-2 text-[10px] editor-text-muted">
        <span className="flex items-center gap-0.5"><Clock size={10} /> {queued} queued</span>
        <span className="flex items-center gap-0.5"><Loader2 size={10} className="animate-spin" /> {processing} processing</span>
        <span className="flex items-center gap-0.5 text-emerald-500"><CheckCircle2 size={10} /> {done} done</span>
        {error > 0 && <span className="flex items-center gap-0.5 text-red-500"><AlertCircle size={10} /> {error} failed</span>}
      </div>
      <div className="space-y-0.5 max-h-[150px] overflow-y-auto custom-scroll">
        {batchFiles.map((f, i) => (
          <div key={i} className="flex items-center gap-1.5 text-[11px] py-0.5">
            {f.status === 'queued' && <Clock size={10} className="editor-text-dim shrink-0" />}
            {f.status === 'processing' && <Loader2 size={10} className="animate-spin editor-accent shrink-0" />}
            {f.status === 'done' && <CheckCircle2 size={10} className="text-emerald-500 shrink-0" />}
            {f.status === 'error' && <AlertCircle size={10} className="text-red-500 shrink-0" />}
            <span className="flex-1 truncate editor-text">{f.name}</span>
            {f.error && <span className="text-[9px] text-red-500 truncate max-w-[100px]" title={f.error}>{f.error}</span>}
          </div>
        ))}
      </div>
    </div>
  );
}
