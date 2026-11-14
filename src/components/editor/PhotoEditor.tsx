'use client';

import { useState, useEffect } from 'react';
import { MenuBar } from './MenuBar';
import { MobileMenuBar } from './MobileMenuBar';
import { Toolbar } from './Toolbar';
import { OptionsBar } from './OptionsBar';
import { EditorCanvas } from './EditorCanvas';
import { LayersPanel } from './LayersPanel';
import { HistoryPanel } from './HistoryPanel';
import { ColorPanel } from './ColorPanel';
import { AdjustmentsPanel } from './AdjustmentsPanel';
import { NavigatorPanel } from './NavigatorPanel';
import { DevelopPanel } from './DevelopPanel';
import { AgentPanel } from './AgentPanel';
import { AutomationsPanel } from './AutomationsPanel';
import { useMcpBridge } from '@/lib/automations/mcp-client';
import { NewDocumentDialog } from './NewDocumentDialog';
import { VectorizeDialog } from './VectorizeDialog';
import { FigmaImportDialog } from './FigmaImportDialog';
import { ThemeToggle } from './ThemeToggle';
import { PerformanceControls } from './PerformanceControls';
import { Onboarding } from './Onboarding';
import { TutorialPanel } from './TutorialPanel';
import { ShortcutsDialog } from './ShortcutsDialog';
import { useEditorStore } from '@/lib/editor-store';
import { useAgentStore } from '@/lib/agent/agent-store';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from '@/components/ui/sheet';
import { Layers, History, Palette, SlidersHorizontal, Menu, PanelRight, Spline, Compass, Sun, Download, Keyboard, Sparkles, X, Undo2, Redo2 } from 'lucide-react';
import { ToolType } from '@/lib/editor-types';
import { MobileToolDock, MobilePanelTarget } from './MobileUI';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';
import { describeFileError, isNativeApp, pickImageFromLibrary, saveCanvasImage } from '@/lib/file-io';

type PanelTab = 'layers' | 'adjust' | 'develop' | 'color' | 'history' | 'nav' | 'agent' | 'automations';

// ---------------------------------------------------------------------------
// Document export — shared by the Ctrl+S / Ctrl+Shift+S shortcuts and the
// title-bar Export button.
//
// Mask-aware compositor: the keyboard export path previously ignored layer
// masks, so Ctrl+S exported the MASKED-OUT pixels — a silent content leak in
// the output file (the menu/title-bar exports did honor masks, so the three
// export buttons disagreed with each other).
//
// Saving itself goes through file-io: the Android WebView registers no
// DownloadListener, so `a.download` clicks (data:/blob: URLs) are silently
// dropped — in the native shell the Filesystem plugin writes the file into
// the public Documents/PixelLab folder instead.
// ---------------------------------------------------------------------------

function flattenDocument(
  state: ReturnType<typeof useEditorStore.getState>,
  background: string | null,
): HTMLCanvasElement {
  const flat = document.createElement('canvas');
  flat.width = state.docWidth;
  flat.height = state.docHeight;
  const ctx = flat.getContext('2d')!;
  if (background) {
    ctx.fillStyle = background;
    ctx.fillRect(0, 0, flat.width, flat.height);
  }
  for (const layer of state.layers) {
    if (!layer.visible) continue;
    ctx.save();
    ctx.globalAlpha = layer.opacity;
    ctx.globalCompositeOperation = layer.blendMode as GlobalCompositeOperation;
    if (layer.maskCanvas && layer.maskEnabled) {
      const tmp = document.createElement('canvas');
      tmp.width = state.docWidth;
      tmp.height = state.docHeight;
      const tctx = tmp.getContext('2d')!;
      tctx.drawImage(layer.canvas, 0, 0);
      tctx.globalCompositeOperation = 'destination-in';
      tctx.drawImage(layer.maskCanvas, 0, 0);
      ctx.drawImage(tmp, 0, 0);
    } else {
      ctx.drawImage(layer.canvas, 0, 0);
    }
    ctx.restore();
  }
  return flat;
}

async function exportDocument(
  background: string | null,
  mime: string,
  quality: number,
  ext: string,
): Promise<void> {
  const state = useEditorStore.getState();
  const fileName = `${state.docName.replace(/\.[^/.]+$/, '')}.${ext}`;
  try {
    const result = await saveCanvasImage(flattenDocument(state, background), mime, quality, fileName);
    toast.success(
      isNativeApp()
        ? `Saved to ${result.where}`
        : `Exported as ${ext.toUpperCase()}`,
    );
  } catch (e) {
    toast.error(describeFileError(e));
  }
}

export function PhotoEditor() {
  const [newDocOpen, setNewDocOpen] = useState(false);
  const [vectorizeOpen, setVectorizeOpen] = useState(false);
  const [figmaImportOpen, setFigmaImportOpen] = useState(false);
  const [panelOpen, setPanelOpen] = useState(true);
  const [activeTab, setActiveTab] = useState<PanelTab>('layers');
  const [isMobile, setIsMobile] = useState(
    () => typeof window !== 'undefined' && window.innerWidth < 768,
  );
  const [menuBarOpen, setMenuBarOpen] = useState(false);
  const [agentSheetOpen, setAgentSheetOpen] = useState(false);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);

  const docName = useEditorStore((s) => s.docName);
  const setDocName = useEditorStore((s) => s.setDocName);
  const layers = useEditorStore((s) => s.layers);
  const zoom = useEditorStore((s) => s.zoom);
  // Subscribe to history reactively: the mobile Undo/Redo buttons used
  // `getState()` in their `disabled` prop, which only re-evaluates when this
  // component re-renders — pushHistory doesn't touch `layers` (strokes mutate
  // canvases in place), so the buttons stayed stale right after an edit.
  const historyIndex = useEditorStore((s) => s.historyIndex);
  const historyLength = useEditorStore((s) => s.history.length);
  // Subscribe to agent state so the floating bubble can reflect:
  //  - whether the API key is set (pulse to draw attention if not)
  //  - whether a run is in progress (show spinner)
  //  - whether a preview is awaiting Accept/Reject (show a badge dot)
  const agentApiKey = useAgentStore((s) => s.apiKey);
  const agentStatus = useAgentStore((s) => s.status);
  const agentPendingPreview = useAgentStore((s) => s.pendingPreview);
  // MCP bridge — connects to the local MCP server (mcp/server.ts) so external
  // clients (Claude Desktop, etc.) can call Pixel Lab's tools. Auto-reconnects.
  const mcpState = useMcpBridge();

  // Initialize from the real viewport on the first CLIENT render. The old
  // `useState(false)` always painted the desktop layout first; on the Android
  // WebView that first paint lingered above the real UI as a stale composited
  // frame (the "squashed bars" artifact), because the effect-based flip ran
  // only after hydration. SSR still prerenders desktop (window undefined).
  //
  // The resize listener applies the default panel state only when the
  // breakpoint is CROSSED, not on every resize event (mobile URL-bar
  // show/hide fires resize; re-applying the default destroyed the user's
  // explicit panel toggle every time). The FIRST measurement on a phone
  // (initial load) also closes the panels: a minimal phone layout should
  // land on a clean canvas, not with the panels sheet already open.
  useEffect(() => {
    let wasMobile: boolean | null = null;
    const check = () => {
      const first = wasMobile === null;
      const mobile = window.innerWidth < 768;
      const crossed = !first && mobile !== wasMobile;
      wasMobile = mobile;
      setIsMobile(mobile);
      if (crossed) setPanelOpen(!mobile);
      else if (first && mobile) setPanelOpen(false);
    };
    check();
    window.addEventListener('resize', check);
    return () => window.removeEventListener('resize', check);
  }, []);

  // Listen for vectorize event from menu
  useEffect(() => {
    const handler = () => setVectorizeOpen(true);
    window.addEventListener('open-vectorize-dialog', handler);
    return () => window.removeEventListener('open-vectorize-dialog', handler);
  }, []);

  // Listen for the "show shortcuts" event (dispatched by Ctrl+/ and the View menu)
  useEffect(() => {
    const handler = () => setShortcutsOpen(true);
    window.addEventListener('pixel-lab-show-shortcuts', handler);
    return () => window.removeEventListener('pixel-lab-show-shortcuts', handler);
  }, []);

  // Listen for the "toggle panels" event (dispatched by Ctrl+2)
  useEffect(() => {
    const handler = () => setPanelOpen((p) => !p);
    window.addEventListener('pixel-lab-toggle-panels', handler);
    return () => window.removeEventListener('pixel-lab-toggle-panels', handler);
  }, []);

  // Listen for the "new document" event (dispatched by Ctrl+N)
  useEffect(() => {
    const handler = () => setNewDocOpen(true);
    window.addEventListener('pixel-lab-new-document', handler);
    return () => window.removeEventListener('pixel-lab-new-document', handler);
  }, []);

  // Listen for the "open file" event (dispatched by Ctrl+O). In the native
  // shell this launches the Android Photo Picker (no permission required,
  // works on every Android version); on the web file-io falls back to a
  // transient file input created synchronously so the browser keeps the
  // user-activation gesture.
  useEffect(() => {
    const handler = () => {
      void pickImageFromLibrary()
        .then((res) => {
          if (!res) return;
          // openImage validates/clamps dimensions, commits synchronously
          // (no setTimeout race with another open/new), and pushes history.
          useEditorStore.getState().openImage(res.img, res.name, `Open ${res.name}`);
        })
        .catch((e) => toast.error(describeFileError(e)));
    };
    window.addEventListener('pixel-lab-open-file', handler);
    return () => window.removeEventListener('pixel-lab-open-file', handler);
  }, []);

  // Listen for quick export events (Ctrl+S, Ctrl+Shift+S) — both route
  // through the shared exportDocument helper above.
  useEffect(() => {
    const quickExport = () => { void exportDocument(null, 'image/png', 1, 'png'); };
    const exportJpeg = () => { void exportDocument('#ffffff', 'image/jpeg', 0.9, 'jpg'); };
    window.addEventListener('pixel-lab-quick-export', quickExport);
    window.addEventListener('pixel-lab-export-jpeg', exportJpeg);
    return () => {
      window.removeEventListener('pixel-lab-quick-export', quickExport);
      window.removeEventListener('pixel-lab-export-jpeg', exportJpeg);
    };
  }, []);

  const panels = (
    <Tabs
      value={activeTab}
      onValueChange={(v) => setActiveTab(v as PanelTab)}
      className="h-full flex flex-col"
    >
      <TabsList className="editor-surface editor-border rounded-none w-full justify-start h-9 p-0 border-b overflow-x-auto custom-scroll">
        {/* Labels always visible (even below sm): on the mobile panels sheet
            icon-only tabs were cryptic. The strip scrolls horizontally, so
            narrow screens still reach every tab. */}
        <TabsTrigger value="layers" className="rounded-none data-[state=active]:editor-surface-3 data-[state=active]:editor-accent gap-1 px-2 sm:px-3 text-xs shrink-0">
          <Layers size={12} /> <span>Layers</span>
        </TabsTrigger>
        <TabsTrigger value="adjust" className="rounded-none data-[state=active]:editor-surface-3 data-[state=active]:editor-accent gap-1 px-2 sm:px-3 text-xs shrink-0">
          <SlidersHorizontal size={12} /> <span>Adjust</span>
        </TabsTrigger>
        <TabsTrigger value="develop" className="rounded-none data-[state=active]:editor-surface-3 data-[state=active]:editor-accent gap-1 px-2 sm:px-3 text-xs shrink-0">
          <Sun size={12} /> <span>Develop</span>
        </TabsTrigger>
        <TabsTrigger value="color" className="rounded-none data-[state=active]:editor-surface-3 data-[state=active]:editor-accent gap-1 px-2 sm:px-3 text-xs shrink-0">
          <Palette size={12} /> <span>Color</span>
        </TabsTrigger>
        <TabsTrigger value="nav" className="rounded-none data-[state=active]:editor-surface-3 data-[state=active]:editor-accent gap-1 px-2 sm:px-3 text-xs shrink-0">
          <Compass size={12} /> <span>Nav</span>
        </TabsTrigger>
        <TabsTrigger value="history" className="rounded-none data-[state=active]:editor-surface-3 data-[state=active]:editor-accent gap-1 px-2 sm:px-3 text-xs shrink-0">
          <History size={12} /> <span>History</span>
        </TabsTrigger>
        <TabsTrigger value="agent" className="rounded-none data-[state=active]:editor-surface-3 data-[state=active]:editor-accent gap-1 px-2 sm:px-3 text-xs shrink-0">
          <Sparkles size={12} className="text-sky-400" /> <span>Luna</span>
        </TabsTrigger>
        <TabsTrigger value="automations" className="rounded-none data-[state=active]:editor-surface-3 data-[state=active]:editor-accent gap-1 px-2 sm:px-3 text-xs shrink-0">
          <Layers size={12} className="text-amber-400" /> <span>Recipes</span>
        </TabsTrigger>
      </TabsList>
      <TabsContent value="layers" className="flex-1 min-h-0 m-0">
        <LayersPanel />
      </TabsContent>
      <TabsContent value="adjust" className="flex-1 min-h-0 m-0">
        <AdjustmentsPanel />
      </TabsContent>
      <TabsContent value="develop" className="flex-1 min-h-0 m-0">
        <DevelopPanel />
      </TabsContent>
      <TabsContent value="color" className="flex-1 min-h-0 m-0">
        <ColorPanel />
      </TabsContent>
      <TabsContent value="nav" className="flex-1 min-h-0 m-0">
        <NavigatorPanel />
      </TabsContent>
      <TabsContent value="history" className="flex-1 min-h-0 m-0">
        <HistoryPanel />
      </TabsContent>
      <TabsContent value="agent" className="flex-1 min-h-0 m-0">
        <AgentPanel />
      </TabsContent>
      <TabsContent value="automations" className="flex-1 min-h-0 m-0">
        <AutomationsPanel />
      </TabsContent>
    </Tabs>
  );

  return (
    <div
      className="flex flex-col h-[100dvh] w-screen editor-bg editor-text overflow-hidden"
      onDragOver={(e) => { e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; }}
      onDrop={(e) => {
        e.preventDefault();
        const file = e.dataTransfer.files?.[0];
        if (!file || !file.type.startsWith('image/')) return;
        const url = URL.createObjectURL(file);
        const img = new Image();
        img.onload = () => {
          // openImage: dimension validation/clamping, synchronous commit,
          // one history entry, and a downscaled recent-file thumbnail
          // (the old path stored a full-resolution JPEG data URL of every
          // dropped file in the recent list — multi-MB strings each).
          useEditorStore.getState().openImage(img, file.name.replace(/\.[^/.]+$/, ''), 'Drag & Drop Import');
          URL.revokeObjectURL(url);
        };
        img.onerror = () => {
          URL.revokeObjectURL(url);
          toast.error(`Could not read "${file.name}" — the file may be corrupt`);
        };
        img.src = url;
      }}
    >
      <HiddenColorInputs />

      {/* Title bar — desktop: full menubar inline; mobile: compact with only
          the essentials (menu, doc name, undo/redo, export, theme). Mobile is
          intentionally minimal so the canvas gets maximum vertical space. */}
      <div className={cn(
        'flex items-center px-2 editor-surface border-b editor-border text-xs editor-text-muted shrink-0 no-select gap-1',
        isMobile ? 'h-10' : 'h-8',
      )}>
        {isMobile && (
          // Toggle for the compact horizontal command bar (MobileMenuBar).
          // The old slide-out sheet embedded the desktop Radix Menubar, whose
          // dropdowns never opened on touch — an empty panel behind a scrim.
          <Button
            variant="ghost"
            size="icon"
            onClick={() => setMenuBarOpen((o) => !o)}
            aria-expanded={menuBarOpen}
            className={cn('h-9 w-9 touch-target shrink-0', menuBarOpen && 'editor-accent')}
          >
            {menuBarOpen ? <X size={18} /> : <Menu size={18} />}
          </Button>
        )}

        {isMobile ? (
          // Mobile: brand + doc name compact, centered
          <div className="flex items-center gap-1 min-w-0 flex-1 justify-center">
            <span className="font-medium editor-accent shrink-0">⚡</span>
            <input
              value={docName}
              onChange={(e) => setDocName(e.target.value)}
              className="bg-transparent outline-none focus:editor-surface-3 px-1 rounded editor-text min-w-0 flex-1 max-w-[140px] text-center"
            />
          </div>
        ) : (
          // Desktop: brand + doc name on the left
          <>
            <span className="font-medium editor-accent shrink-0">⚡ Pixel Lab</span>
            <span className="editor-text-dim hidden sm:inline shrink-0">·</span>
            <input
              value={docName}
              onChange={(e) => setDocName(e.target.value)}
              className="bg-transparent outline-none focus:editor-surface-3 px-1 rounded editor-text w-20 sm:w-auto min-w-0"
            />
          </>
        )}

        {/* Mobile: Undo/Redo buttons in the title bar (always visible, larger
            touch targets) */}
        {isMobile && (
          <div className="flex items-center gap-0.5 shrink-0">
            <Button
              variant="ghost"
              size="icon"
              onClick={() => useEditorStore.getState().undo()}
              disabled={historyIndex <= 0}
              className="h-9 w-9 editor-text-muted hover:editor-surface-3"
              title="Undo (Ctrl+Z)"
            >
              <Undo2 size={16} />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              onClick={() => useEditorStore.getState().redo()}
              disabled={historyIndex >= historyLength - 1}
              className="h-9 w-9 editor-text-muted hover:editor-surface-3"
              title="Redo (Ctrl+Y)"
            >
              <Redo2 size={16} />
            </Button>
          </div>
        )}

        <span className="editor-text-dim hidden lg:inline shrink-0 ml-2">
          {layers.length} layers · {Math.round(zoom * 100)}%
        </span>

        <div className="ml-auto flex items-center gap-0.5 sm:gap-1 shrink-0">
          {/* Quick export */}
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              // Quick PNG export via the shared helper (native shell: writes
              // to Documents/PixelLab — a.download is dropped by the WebView).
              void exportDocument(null, 'image/png', 1, 'png');
            }}
            className={cn('editor-text-muted hover:editor-surface-3 gap-1', isMobile ? 'h-9 w-9 p-0' : 'h-7 px-2')}
            title="Quick Export PNG"
          >
            <Download size={isMobile ? 16 : 14} />
            {!isMobile && <span className="hidden lg:inline text-xs">Export</span>}
          </Button>

          {/* Vectorize button (desktop only — accessible via mobile menu) */}
          {!isMobile && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setVectorizeOpen(true)}
              className="h-7 px-2 editor-text-muted hover:editor-surface-3 gap-1"
              title="Vectorize Image"
            >
              <Spline size={14} className="text-purple-400" />
              <span className="hidden lg:inline text-xs">Vectorize</span>
            </Button>
          )}

          {/* Performance controls — desktop only on the title bar (mobile
              hides it to save space; users can still access via menu) */}
          {!isMobile && <PerformanceControls />}

          {!isMobile && <ThemeToggle />}

          {/* MCP connection status indicator — click to toggle (desktop only) */}
          {!isMobile && (
            <button
              onClick={mcpState.toggle}
              className="flex items-center gap-1 px-1.5 h-7 rounded shrink-0 hover:editor-surface-3 cursor-pointer"
              title={
                !mcpState.enabled
                  ? 'MCP bridge disabled — click to enable'
                  : mcpState.connected
                    ? 'MCP bridge connected — click to disable'
                    : mcpState.connecting
                      ? 'MCP bridge connecting…'
                      : 'MCP bridge offline — click to disable'
              }
            >
              <span
                className={cn(
                  'inline-block w-2 h-2 rounded-full shrink-0',
                  !mcpState.enabled
                    ? 'bg-zinc-500'
                    : mcpState.connected
                      ? 'bg-emerald-500'
                      : mcpState.connecting
                        ? 'bg-amber-500 animate-pulse'
                        : 'bg-zinc-500',
                )}
              />
              <span className="hidden xl:inline text-[10px] editor-text-muted">
                {mcpState.enabled ? 'MCP' : 'MCP off'}
              </span>
            </button>
          )}

          {/* Keyboard shortcuts "?" button (desktop only) */}
          {!isMobile && (
            <Button
              variant="ghost"
              size="icon"
              onClick={() => setShortcutsOpen(true)}
              className="h-7 w-7 editor-text-muted hover:editor-surface-3"
              title="Keyboard Shortcuts (Ctrl+/)"
            >
              <Keyboard size={14} />
            </Button>
          )}

          {/* Toggle panels button (desktop only — mobile uses the bottom
              toolbar's panels button) */}
          {!isMobile && (
            <Button
              variant="ghost"
              size="icon"
              onClick={() => setPanelOpen(!panelOpen)}
              className={cn('h-7 w-7 editor-text-muted hover:editor-surface-3', panelOpen && 'editor-accent')}
              title="Toggle Panels"
            >
              <PanelRight size={14} />
            </Button>
          )}
        </div>
      </div>

      {/* Desktop: menu bar inline. Mobile keeps the compact top bar — the
          hamburger menu sheet carries the full MenuBar. */}
      {!isMobile && (
        <MenuBar onOpenNewDoc={() => setNewDocOpen(true)} onOpenFigmaImport={() => setFigmaImportOpen(true)} />
      )}
      {/* Desktop: contextual tool options strip. Mobile hides it entirely —
          the MobileToolDock's options drawer carries the same controls in a
          thumb-friendly vertical layout, and hiding this strip returns the
          whole screen width/height budget to the canvas. */}
      {!isMobile && <OptionsBar />}

      <div className="flex flex-1 min-h-0 flex-col">
        <div className="flex flex-1 min-h-0">
          {/* Desktop: full toolbar */}
          {!isMobile && <Toolbar />}

          {/* Canvas area. On mobile, reserve a bottom padding lane where the
              floating tool dock lives — EditorCanvas's own zoom cluster and
              status bar sit at ITS container bottom, which now ends above the
              dock, so nothing overlaps and no EditorCanvas changes needed. */}
          <div className={cn(
            'flex-1 flex min-w-0 relative',
            isMobile && 'pb-[72px]',
          )}>
            <EditorCanvas />

            {/* Mobile: compact horizontal command bar (toggled from the ☰
                button) + floating minimal dock + edge buttons. */}
            {isMobile && menuBarOpen && (
              <MobileMenuBar
                onClose={() => setMenuBarOpen(false)}
                onOpenNewDoc={() => { setNewDocOpen(true); setMenuBarOpen(false); }}
                onOpenFigmaImport={() => { setFigmaImportOpen(true); setMenuBarOpen(false); }}
                onOpenShortcuts={() => { setShortcutsOpen(true); setMenuBarOpen(false); }}
              />
            )}
            {isMobile && (
              <MobileToolDock
                onOpenPanel={(tab: MobilePanelTarget) => {
                  setActiveTab(tab);
                  setPanelOpen(true);
                }}
                onOpenAgent={() => setAgentSheetOpen(true)}
              />
            )}

            {/* Desktop: right panels */}
            {!isMobile && panelOpen && (
              <div className="w-[320px] lg:w-[360px] border-l editor-border shrink-0 flex flex-col">
                {panels}
              </div>
            )}

            {/* Mobile: panels in a side sheet — opened from the floating edge
                buttons or the drawer. Width covers most of the screen so panel
                controls get real estate without going full-screen. */}
            {isMobile && (
              <Sheet open={panelOpen} onOpenChange={setPanelOpen}>
                <SheetContent side="right" className="editor-surface editor-text border-l editor-border w-[86vw] max-w-[340px] p-0">
                  <SheetHeader className="p-3 border-b editor-border">
                    <SheetTitle className="editor-text">Panels</SheetTitle>
                  </SheetHeader>
                  <div className="flex-1 min-h-0">
                    {panels}
                  </div>
                </SheetContent>
              </Sheet>
            )}
          </div>
        </div>
      </div>

      {/* Luna (AI agent) floating bubble — bottom-right on desktop only.
          On mobile, the Luna button lives in the floating edge stack next to
          Layers/Adjust so it doesn't overlap the tool dock.
          Shows a pulse when no API key is set, a spinner when running, and a
          badge dot when a preview is awaiting Accept/Reject. */}
      {!isMobile && (
        <Button
          onClick={() => setAgentSheetOpen(true)}
          className={cn(
            'fixed z-50 h-12 w-12 rounded-full shadow-lg touch-target',
            'bottom-4 right-4',
            'bg-gradient-to-br from-sky-500 to-purple-600 hover:from-sky-400 hover:to-purple-500',
          'text-white border border-white/20',
          !agentApiKey && 'animate-pulse',
        )}
        title="Open Luna (AI Agent)"
        aria-label="Open Luna"
      >
        {agentStatus === 'running' ? (
          <svg className="animate-spin h-5 w-5" viewBox="0 0 24 24" fill="none">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
          </svg>
        ) : (
          <Sparkles size={22} />
        )}
        {agentStatus === 'awaiting-accept' && (
          <span className="absolute -top-0.5 -right-0.5 h-3.5 w-3.5 rounded-full bg-emerald-400 border-2 border-white" />
        )}
        {agentStatus === 'error' && (
          <span className="absolute -top-0.5 -right-0.5 h-3.5 w-3.5 rounded-full bg-red-500 border-2 border-white" />
        )}
      </Button>
      )}

      {/* Luna (AI agent) panel — opened as a non-modal Sheet from the floating
          bubble. Does NOT darken the rest of the UI (no overlay/scrim) so users
          can interact with the canvas while Luna is open. */}
      <Sheet open={agentSheetOpen} onOpenChange={setAgentSheetOpen}>
        <SheetContent
          side="right"
          noOverlay
          className="editor-surface editor-text border-l editor-border p-0 w-full sm:w-[380px] flex flex-col shadow-2xl"
        >
          <SheetHeader className="p-2 border-b editor-border flex-row items-center justify-between space-y-0">
            <SheetTitle className="editor-text text-sm flex items-center gap-2">
              <Sparkles size={14} className="text-sky-400" />
              Luna
            </SheetTitle>
            <Button
              variant="ghost"
              size="icon"
              onClick={() => setAgentSheetOpen(false)}
              className="h-7 w-7 editor-text-muted hover:editor-surface-3"
              title="Close"
            >
              <X size={14} />
            </Button>
          </SheetHeader>
          <div className="flex-1 min-h-0">
            <AgentPanel />
          </div>
        </SheetContent>
      </Sheet>

      <NewDocumentDialog open={newDocOpen} onClose={() => setNewDocOpen(false)} />
      <VectorizeDialog open={vectorizeOpen} onClose={() => setVectorizeOpen(false)} />
      <FigmaImportDialog open={figmaImportOpen} onClose={() => setFigmaImportOpen(false)} />
      <ShortcutsDialog open={shortcutsOpen} onOpenChange={setShortcutsOpen} />
      <Onboarding />
      <TutorialPanel />
    </div>
  );
}

function HiddenColorInputs() {
  const foreground = useEditorStore((s) => s.foregroundColor);
  const background = useEditorStore((s) => s.backgroundColor);
  const setForeground = useEditorStore((s) => s.setForeground);
  const setBackground = useEditorStore((s) => s.setBackground);
  return (
    <>
      <input
        id="fg-color-input"
        type="color"
        value={foreground}
        onChange={(e) => setForeground(e.target.value)}
        className="absolute opacity-0 pointer-events-none w-0 h-0"
        style={{ left: -9999 }}
      />
      <input
        id="bg-color-input"
        type="color"
        value={background}
        onChange={(e) => setBackground(e.target.value)}
        className="absolute opacity-0 pointer-events-none w-0 h-0"
        style={{ left: -9999 }}
      />
    </>
  );
}
