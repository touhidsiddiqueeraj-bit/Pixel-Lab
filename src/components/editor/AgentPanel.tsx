'use client';

/**
 * AgentPanel — Copilot-Chat-style UI for the AI editing agent.
 *
 * Layout reference: VS Code GitHub Copilot Chat (interaction pattern only —
 * no copied assets/icons/code). Panel docked to a side, with:
 *   - Model picker (top of input row)
 *   - API key input (collapses once set; "Clear" button)
 *   - Chat thread (user / assistant / tool-call chips)
 *   - Accept / Reject inline diff when a preview is pending
 *   - Stop button while running
 *
 * Wire-up: this panel is mounted in PhotoEditor.tsx via a Tabs tab (see
 * `panels` const) following the same pattern as LayersPanel / AdjustmentsPanel.
 *
 * Responsive: on mobile the entire right panel (including AgentPanel) is
 * shown in a Sheet, so this component just needs to fill its container.
 */

import { useEffect, useRef, useState, useCallback } from 'react';
import { useAgentStore, MODEL_OPTIONS, DEFAULT_MODEL } from '@/lib/agent/agent-store';
import { runAgent, commitPreview, rejectPreview } from '@/lib/agent/agent-runner';
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
  Sparkles,
  Send,
  Square,
  Trash2,
  Eye,
  EyeOff,
  Check,
  X,
  Wrench,
  ChevronDown,
  ChevronUp,
  Loader2,
  AlertTriangle,
  Image as ImageIcon,
} from 'lucide-react';
import { cn } from '@/lib/utils';

// ---------------------------------------------------------------------------
// Main panel
// ---------------------------------------------------------------------------

export function AgentPanel() {
  const apiKey = useAgentStore((s) => s.apiKey);
  const setApiKey = useAgentStore((s) => s.setApiKey);
  const clearApiKey = useAgentStore((s) => s.clearApiKey);
  const model = useAgentStore((s) => s.model);
  const setModel = useAgentStore((s) => s.setModel);
  const messages = useAgentStore((s) => s.messages);
  const status = useAgentStore((s) => s.status);
  const statusLine = useAgentStore((s) => s.statusLine);
  const pendingPreview = useAgentStore((s) => s.pendingPreview);
  const clearChat = useAgentStore((s) => s.clearChat);
  const cancelRun = useAgentStore((s) => s.cancelRun);

  const [draftKey, setDraftKey] = useState('');
  const [keyVisible, setKeyVisible] = useState(false);
  const [prompt, setPrompt] = useState('');
  const [keySectionOpen, setKeySectionOpen] = useState(!apiKey);

  const scrollRef = useRef<HTMLDivElement>(null);
  const layers = useEditorStore((s) => s.layers);
  const activeLayerId = useEditorStore((s) => s.activeLayerId);

  // Auto-scroll to bottom when messages / status change.
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages, status, statusLine, pendingPreview]);

  const handleSetKey = useCallback(() => {
    const trimmed = draftKey.trim();
    if (!trimmed) {
      toast.error('API key cannot be empty.');
      return;
    }
    if (!trimmed.startsWith('AIza')) {
      toast.error('That does not look like a Gemini API key (should start with "AIza").');
      return;
    }
    setApiKey(trimmed);
    setDraftKey('');
    setKeySectionOpen(false);
    toast.success('API key set for this session.');
  }, [draftKey, setApiKey]);

  const handleClearKey = useCallback(() => {
    clearApiKey();
    setDraftKey('');
    setKeySectionOpen(true);
    toast.success('API key cleared from memory.');
  }, [clearApiKey]);

  const handleSend = useCallback(async () => {
    const trimmed = prompt.trim();
    if (!trimmed) return;
    if (!apiKey) {
      toast.error('Enter your Gemini API key first.');
      setKeySectionOpen(true);
      return;
    }
    if (!activeLayerId || layers.length === 0) {
      toast.error('Open or create a document first.');
      return;
    }
    if (status === 'running') {
      toast.error('Agent is already running. Click Stop to cancel.');
      return;
    }
    // If there's a pending preview (Accept/Reject showing) and the user sends
    // a new prompt, treat the pending preview as rejected — the undo stack is
    // not touched (the workspace was offscreen).
    if (status === 'awaiting-accept' && pendingPreview) {
      rejectPreview();
    }
    setPrompt('');
    // Run the loop. We don't await here so the UI keeps painting chips.
    runAgent({ prompt: trimmed }).catch((e) => {
      toast.error(`Agent error: ${(e as Error).message}`);
    });
  }, [prompt, apiKey, activeLayerId, layers.length, status, pendingPreview]);

  const handleStop = useCallback(() => {
    cancelRun();
    toast.message('Agent run cancelled.');
  }, [cancelRun]);

  const handleAccept = useCallback(() => {
    commitPreview();
    toast.success('Edit applied. Press Ctrl+Z to undo.');
  }, []);

  const handleReject = useCallback(() => {
    rejectPreview();
    toast.message('Preview rejected. The undo stack was not touched.');
  }, []);

  const isRunning = status === 'running';
  const isAwaitingAccept = status === 'awaiting-accept';

  return (
    <div className="flex flex-col h-full editor-surface editor-text overflow-hidden">
      {/* Header */}
      <div className="px-3 py-2 border-b editor-border flex items-center gap-2 shrink-0">
        <Sparkles size={14} className="editor-accent shrink-0" />
        <span className="text-xs font-semibold uppercase tracking-wide editor-text-muted">
          AI Agent
        </span>
        <span className="ml-auto flex items-center gap-1">
          <Button
            variant="ghost"
            size="sm"
            onClick={clearChat}
            disabled={isRunning || messages.length === 0}
            className="h-7 px-2 editor-text-muted hover:editor-surface-3 text-xs gap-1"
            title="Clear chat"
          >
            <Trash2 size={12} />
            <span className="hidden sm:inline">Clear</span>
          </Button>
        </span>
      </div>

      {/* Chat thread */}
      <div
        ref={scrollRef}
        className="flex-1 min-h-0 overflow-y-auto custom-scroll px-3 py-3 space-y-3"
      >
        {messages.length === 0 && !isRunning && (
          <EmptyState hasKey={!!apiKey} onOpenKey={() => setKeySectionOpen(true)} />
        )}

        {messages.map((msg) => (
          <MessageBubble key={msg.id} msg={msg} />
        ))}

        {/* Running status line */}
        {isRunning && statusLine && (
          <div className="flex items-center gap-2 text-xs editor-text-muted pl-1">
            <Loader2 size={12} className="animate-spin editor-accent" />
            <span>{statusLine}</span>
          </div>
        )}

        {/* Pending preview — Accept / Reject */}
        {isAwaitingAccept && pendingPreview && (
          <PreviewDiff
            before={pendingPreview.beforeDataUrl}
            after={pendingPreview.afterDataUrl}
            label={pendingPreview.historyLabel}
            onAccept={handleAccept}
            onReject={handleReject}
          />
        )}

        {/* Error state */}
        {status === 'error' && (
          <div className="text-xs text-red-500 flex items-start gap-2 p-2 rounded-md bg-red-500/10 border border-red-500/30">
            <AlertTriangle size={14} className="mt-0.5 shrink-0" />
            <span>
              Agent stopped with an error. Check your API key, model name, and network connection,
              then try again with a simpler request.
            </span>
          </div>
        )}

        {/* Cancelled state */}
        {status === 'cancelled' && (
          <div className="text-xs editor-text-muted italic pl-1">
            Run cancelled. The canvas was not modified.
          </div>
        )}
      </div>

      {/* API key section (collapsible) */}
      {keySectionOpen ? (
        <div className="border-t editor-border p-3 space-y-2 shrink-0 bg-gradient-to-br from-sky-900/20 to-purple-900/20">
          <div className="flex items-center justify-between">
            <Label className="text-xs editor-text-muted">Gemini API Key</Label>
            {apiKey && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setKeySectionOpen(false)}
                className="h-6 px-2 text-xs editor-text-dim hover:editor-surface-3"
              >
                <ChevronDown size={12} /> Hide
              </Button>
            )}
          </div>
          <form
            autoComplete="current-password"
            onSubmit={(e) => {
              e.preventDefault();
              handleSetKey();
            }}
            className="flex items-center gap-1"
          >
            <Input
              type={keyVisible ? 'text' : 'password'}
              autoComplete="current-password"
              placeholder="AIza…"
              value={draftKey}
              onChange={(e) => setDraftKey(e.target.value)}
              className="h-8 text-xs flex-1"
              aria-label="Gemini API key"
            />
            <Button
              type="button"
              variant="ghost"
              size="icon"
              onClick={() => setKeyVisible(!keyVisible)}
              className="h-8 w-8 editor-text-muted hover:editor-surface-3"
              title={keyVisible ? 'Hide key' : 'Show key'}
            >
              {keyVisible ? <EyeOff size={14} /> : <Eye size={14} />}
            </Button>
            <Button
              type="submit"
              size="sm"
              className="h-8 editor-accent-bg hover:editor-accent-bg text-white"
            >
              Set
            </Button>
          </form>
          <p className="text-[10px] editor-text-dim leading-snug">
            Your key is used only in your browser to call Google&apos;s Gemini API directly.
            It is not sent to or stored on our servers. It lives in JS memory only for this
            session — close the tab to clear it.
          </p>
          <a
            href="https://aistudio.google.com/apikey"
            target="_blank"
            rel="noopener noreferrer"
            className="text-[10px] editor-accent hover:underline inline-block"
          >
            Get a key from Google AI Studio →
          </a>
        </div>
      ) : (
        <div className="border-t editor-border px-3 py-1.5 flex items-center justify-between shrink-0">
          <span className="text-[10px] editor-text-muted flex items-center gap-1">
            <span className="inline-block w-1.5 h-1.5 rounded-full bg-emerald-500" />
            Key set for this session
          </span>
          <div className="flex items-center gap-1">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setKeySectionOpen(true)}
              className="h-6 px-2 text-[10px] editor-text-muted hover:editor-surface-3"
            >
              Edit
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={handleClearKey}
              className="h-6 px-2 text-[10px] text-red-500 hover:text-red-400 hover:bg-red-500/10"
            >
              Clear
            </Button>
          </div>
        </div>
      )}

      {/* Input row */}
      <div className="border-t editor-border p-2 shrink-0 space-y-2">
        {/* Model picker */}
        <div className="flex items-center gap-1">
          <Label className="text-[10px] editor-text-dim shrink-0 uppercase tracking-wide">
            Model
          </Label>
          <Select value={model} onValueChange={setModel} disabled={isRunning}>
            <SelectTrigger className="h-7 text-xs flex-1 editor-surface-2 editor-border">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {MODEL_OPTIONS.map((m) => (
                <SelectItem key={m.value} value={m.value} className="text-xs">
                  <div className="flex flex-col">
                    <span>{m.label}</span>
                    <span className="text-[10px] editor-text-dim">{m.hint}</span>
                  </div>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="flex items-end gap-1">
          <textarea
            value={prompt}
            onChange={(e) => {
              // If the user starts typing while a preview is pending
              // (Accept/Reject showing), auto-reject it. The undo stack is
              // not touched — the workspace was offscreen all along.
              if (status === 'awaiting-accept' && pendingPreview) {
                rejectPreview();
              }
              setPrompt(e.target.value);
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                handleSend();
              }
            }}
            // Disabled only when running or no API key. NOT disabled when
            // awaiting-accept — typing should auto-reject and let the user
            // immediately type a follow-up.
            disabled={isRunning || !apiKey}
            placeholder={
              !apiKey
                ? 'Enter your API key above first…'
                : isRunning
                  ? 'Agent is running…'
                  : isAwaitingAccept
                    ? 'Type to reject the preview and start a new request…'
                    : 'Describe an edit, e.g. "brighten the sky and add a vignette"'
            }
            rows={2}
            className="flex-1 min-h-[36px] max-h-[120px] resize-none rounded-md border editor-border bg-transparent editor-surface-2 px-2 py-1.5 text-xs editor-text placeholder:editor-text-dim outline-none focus-visible:ring-1 focus-visible:ring-editor-accent/40 custom-scroll disabled:opacity-50"
          />
          {isRunning ? (
            <Button
              variant="destructive"
              size="sm"
              onClick={handleStop}
              className="h-9 px-3 text-xs gap-1"
              title="Stop the agent run"
            >
              <Square size={14} />
              <span className="hidden sm:inline">Stop</span>
            </Button>
          ) : (
            <Button
              size="sm"
              onClick={handleSend}
              // Allow sending even when awaiting-accept — handleSend will
              // auto-reject first.
              disabled={!prompt.trim() || !apiKey}
              className="h-9 px-3 editor-accent-bg hover:editor-accent-bg text-white text-xs gap-1"
              title="Send (Enter)"
            >
              <Send size={14} />
            </Button>
          )}
        </div>
        <p className="text-[10px] editor-text-dim leading-snug">
          Agent calls Google&apos;s Gemini API directly from your browser. Edits appear as a
          preview you can accept or reject.
        </p>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Empty state
// ---------------------------------------------------------------------------

function EmptyState({ hasKey, onOpenKey }: { hasKey: boolean; onOpenKey: () => void }) {
  return (
    <div className="space-y-3">
      <div className="rounded-lg p-3 bg-gradient-to-br from-sky-900/20 to-purple-900/20 border border-sky-700/30">
        <div className="flex items-center gap-2 text-xs font-semibold editor-accent mb-1.5">
          <Sparkles size={14} />
          AI Editing Agent
        </div>
        <p className="text-[11px] editor-text-muted leading-snug">
          Describe an edit in plain English and the agent will translate it into the editor&apos;s
          existing tools. Try:
        </p>
        <ul className="mt-1.5 space-y-1 text-[11px] editor-text-muted">
          <li className="cursor-default">• &ldquo;make it grayscale&rdquo;</li>
          <li className="cursor-default">• &ldquo;brighten the sky and add a vignette&rdquo;</li>
          <li className="cursor-default">• &ldquo;remove the person in the corner&rdquo;</li>
          <li className="cursor-default">• &ldquo;boost the saturation slightly&rdquo;</li>
        </ul>
      </div>
      {!hasKey && (
        <div className="text-[11px] editor-text-muted p-2 rounded-md editor-surface-2 border editor-border">
          👆 Enter your Gemini API key below to start. The key stays in your browser&apos;s memory
          only.{' '}
          <button onClick={onOpenKey} className="editor-accent hover:underline">
            Open key input
          </button>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Message bubble
// ---------------------------------------------------------------------------

function MessageBubble({
  msg,
}: {
  msg: {
    role: 'user' | 'assistant' | 'system';
    text: string;
    toolCalls?: {
      id: string;
      label: string;
      toolName: string;
      status: 'pending' | 'running' | 'success' | 'error' | 'rejected';
      detail?: string;
      thumbnailBase64?: string;
    }[];
  };
}) {
  if (msg.role === 'user') {
    return (
      <div className="flex justify-end">
        <div className="max-w-[85%] rounded-lg rounded-br-sm px-2.5 py-1.5 text-xs editor-accent-bg text-white">
          {msg.text}
        </div>
      </div>
    );
  }
  if (msg.role === 'system') {
    return (
      <div className="text-[11px] editor-text-muted italic text-center px-2 py-1">
        {msg.text}
      </div>
    );
  }
  // assistant
  return (
    <div className="space-y-1.5">
      {/* Tool call chips (above the text) */}
      {msg.toolCalls?.map((chip) => (
        <ToolCallChip key={chip.id} chip={chip} />
      ))}
      {/* Final text */}
      {msg.text && (
        <div className="max-w-[90%] rounded-lg rounded-bl-sm px-2.5 py-1.5 text-xs editor-surface-2 border editor-border editor-text">
          {msg.text}
        </div>
      )}
    </div>
  );
}

function ToolCallChip({
  chip,
}: {
  chip: {
    id: string;
    label: string;
    toolName: string;
    status: 'pending' | 'running' | 'success' | 'error' | 'rejected';
    detail?: string;
    thumbnailBase64?: string;
  };
}) {
  const statusColor =
    chip.status === 'success'
      ? 'text-emerald-500'
      : chip.status === 'error'
        ? 'text-red-500'
        : chip.status === 'running'
          ? 'editor-accent'
          : 'editor-text-dim';
  return (
    <div className="flex items-center gap-2 text-[11px] editor-text-muted bg-editor-surface-2 border editor-border rounded-md px-2 py-1 max-w-[95%]">
      <Wrench size={11} className={cn('shrink-0', statusColor)} />
      <span className="flex-1 truncate">{chip.label}</span>
      {chip.status === 'running' && (
        <Loader2 size={11} className="animate-spin editor-accent shrink-0" />
      )}
      {chip.status === 'success' && <Check size={11} className="text-emerald-500 shrink-0" />}
      {chip.status === 'error' && <X size={11} className="text-red-500 shrink-0" />}
      {chip.thumbnailBase64 && (
        <img
          src={chip.thumbnailBase64}
          alt=""
          className="w-8 h-8 rounded object-cover border editor-border shrink-0"
        />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Preview diff — before / after with Accept / Reject
// ---------------------------------------------------------------------------

function PreviewDiff({
  before,
  after,
  label,
  onAccept,
  onReject,
}: {
  before: string;
  after: string;
  label: string;
  onAccept: () => void;
  onReject: () => void;
}) {
  const [showBefore, setShowBefore] = useState(false);
  return (
    <div className="rounded-lg border editor-border editor-surface-2 overflow-hidden">
      <div className="flex items-center gap-2 px-2 py-1.5 border-b editor-border">
        <ImageIcon size={12} className="editor-accent shrink-0" />
        <span className="text-[11px] editor-text font-medium truncate flex-1">{label}</span>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => setShowBefore(!showBefore)}
          className="h-6 px-2 text-[10px] editor-text-muted hover:editor-surface-3 gap-1"
          title="Toggle before/after"
        >
          {showBefore ? <Eye size={11} /> : <EyeOff size={11} />}
          {showBefore ? 'Before' : 'After'}
        </Button>
      </div>
      <div className="relative checkerboard">
        <img
          src={after}
          alt="after"
          className="w-full block"
          style={{ maxHeight: 240, objectFit: 'contain' }}
        />
        {showBefore && (
          <img
            src={before}
            alt="before"
            className="absolute inset-0 w-full block"
            style={{ maxHeight: 240, objectFit: 'contain' }}
          />
        )}
      </div>
      <div className="flex items-center gap-2 p-2 border-t editor-border">
        <Button
          size="sm"
          onClick={onAccept}
          className="flex-1 h-8 text-xs bg-emerald-600 hover:bg-emerald-500 text-white gap-1"
        >
          <Check size={14} /> Accept
        </Button>
        <Button
          size="sm"
          variant="outline"
          onClick={onReject}
          className="flex-1 h-8 text-xs gap-1 editor-border"
        >
          <X size={14} /> Reject
        </Button>
      </div>
      <p className="text-[10px] editor-text-dim px-2 pb-2 leading-snug">
        Accept commits to the layer + undo stack. Reject discards without touching history.
      </p>
    </div>
  );
}
