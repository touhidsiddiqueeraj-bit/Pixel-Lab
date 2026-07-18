'use client';

import { useState, useEffect } from 'react';
import { MenuBar } from './MenuBar';
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
import { Layers, History, Palette, SlidersHorizontal, Menu, PanelRight, Spline, Compass, Sun, Brush, Image as ImageIcon, Download, Upload, Clipboard, Grid as GridIcon, Wand2, Film, Keyboard, AlignLeft, Sparkles, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

type PanelTab = 'layers' | 'adjust' | 'develop' | 'color' | 'history' | 'nav' | 'agent' | 'automations';

export function PhotoEditor() {
  const [newDocOpen, setNewDocOpen] = useState(false);
  const [vectorizeOpen, setVectorizeOpen] = useState(false);
  const [panelOpen, setPanelOpen] = useState(true);
  const [activeTab, setActiveTab] = useState<PanelTab>('layers');
  const [isMobile, setIsMobile] = useState(false);
  const [menuSheetOpen, setMenuSheetOpen] = useState(false);
  const [toolbarCollapsed, setToolbarCollapsed] = useState(false);
  const [agentSheetOpen, setAgentSheetOpen] = useState(false);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);

  const docName = useEditorStore((s) => s.docName);
  const setDocName = useEditorStore((s) => s.setDocName);
  const layers = useEditorStore((s) => s.layers);
  const zoom = useEditorStore((s) => s.zoom);
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

  // Detect mobile viewport
  useEffect(() => {
    const check = () => {
      const mobile = window.innerWidth < 768;
      setIsMobile(mobile);
      if (mobile) {
        setPanelOpen(false);
        setToolbarCollapsed(false);
      } else {
        setPanelOpen(true);
      }
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

  // Listen for the "open file" event (dispatched by Ctrl+O) — trigger a file input click
  useEffect(() => {
    const handler = () => {
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = 'image/*';
      input.onchange = () => {
        const file = input.files?.[0];
        if (!file) return;
        const url = URL.createObjectURL(file);
        const img = new Image();
        img.onload = () => {
          const state = useEditorStore.getState();
          state.newDocument(img.naturalWidth, img.naturalHeight, '#ffffff');
          setTimeout(() => {
            const layerId = state.addLayer(file.name.replace(/\.[^/.]+$/, ''));
            const newState = useEditorStore.getState();
            const layer = newState.layers.find((l) => l.id === layerId);
            if (layer) {
              const ctx = layer.canvas.getContext('2d')!;
              ctx.drawImage(img, 0, 0);
              newState.refreshThumbnail(layerId);
              newState.pushHistory('Open ' + file.name);
            }
            URL.revokeObjectURL(url);
          }, 100);
        };
        img.src = url;
      };
      input.click();
    };
    window.addEventListener('pixel-lab-open-file', handler);
    return () => window.removeEventListener('pixel-lab-open-file', handler);
  }, []);

  // Listen for quick export events (Ctrl+S, Ctrl+Shift+S)
  useEffect(() => {
    const quickExport = () => {
      const state = useEditorStore.getState();
      const flat = document.createElement('canvas');
      flat.width = state.docWidth;
      flat.height = state.docHeight;
      const ctx = flat.getContext('2d')!;
      for (const layer of state.layers) {
        if (!layer.visible) continue;
        ctx.save();
        ctx.globalAlpha = layer.opacity;
        ctx.globalCompositeOperation = layer.blendMode as GlobalCompositeOperation;
        ctx.drawImage(layer.canvas, 0, 0);
        ctx.restore();
      }
      const link = document.createElement('a');
      link.href = flat.toDataURL('image/png');
      link.download = `${state.docName.replace(/\.[^/.]+$/, '')}.png`;
      link.click();
    };
    const exportJpeg = () => {
      const state = useEditorStore.getState();
      const flat = document.createElement('canvas');
      flat.width = state.docWidth;
      flat.height = state.docHeight;
      const ctx = flat.getContext('2d')!;
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, flat.width, flat.height);
      for (const layer of state.layers) {
        if (!layer.visible) continue;
        ctx.save();
        ctx.globalAlpha = layer.opacity;
        ctx.globalCompositeOperation = layer.blendMode as GlobalCompositeOperation;
        ctx.drawImage(layer.canvas, 0, 0);
        ctx.restore();
      }
      const link = document.createElement('a');
      link.href = flat.toDataURL('image/jpeg', 0.9);
      link.download = `${state.docName.replace(/\.[^/.]+$/, '')}.jpg`;
      link.click();
    };
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
        <TabsTrigger value="layers" className="rounded-none data-[state=active]:editor-surface-3 data-[state=active]:editor-accent gap-1 px-2 sm:px-3 text-xs shrink-0">
          <Layers size={12} /> <span className="hidden sm:inline">Layers</span>
        </TabsTrigger>
        <TabsTrigger value="adjust" className="rounded-none data-[state=active]:editor-surface-3 data-[state=active]:editor-accent gap-1 px-2 sm:px-3 text-xs shrink-0">
          <SlidersHorizontal size={12} /> <span className="hidden sm:inline">Adjust</span>
        </TabsTrigger>
        <TabsTrigger value="develop" className="rounded-none data-[state=active]:editor-surface-3 data-[state=active]:editor-accent gap-1 px-2 sm:px-3 text-xs shrink-0">
          <Sun size={12} /> <span className="hidden sm:inline">Develop</span>
        </TabsTrigger>
        <TabsTrigger value="color" className="rounded-none data-[state=active]:editor-surface-3 data-[state=active]:editor-accent gap-1 px-2 sm:px-3 text-xs shrink-0">
          <Palette size={12} /> <span className="hidden sm:inline">Color</span>
        </TabsTrigger>
        <TabsTrigger value="nav" className="rounded-none data-[state=active]:editor-surface-3 data-[state=active]:editor-accent gap-1 px-2 sm:px-3 text-xs shrink-0">
          <Compass size={12} /> <span className="hidden sm:inline">Nav</span>
        </TabsTrigger>
        <TabsTrigger value="history" className="rounded-none data-[state=active]:editor-surface-3 data-[state=active]:editor-accent gap-1 px-2 sm:px-3 text-xs shrink-0">
          <History size={12} /> <span className="hidden sm:inline">History</span>
        </TabsTrigger>
        <TabsTrigger value="agent" className="rounded-none data-[state=active]:editor-surface-3 data-[state=active]:editor-accent gap-1 px-2 sm:px-3 text-xs shrink-0">
          <Sparkles size={12} className="text-sky-400" /> <span className="hidden sm:inline">Luna</span>
        </TabsTrigger>
        <TabsTrigger value="automations" className="rounded-none data-[state=active]:editor-surface-3 data-[state=active]:editor-accent gap-1 px-2 sm:px-3 text-xs shrink-0">
          <Layers size={12} className="text-amber-400" /> <span className="hidden sm:inline">Recipes</span>
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
          const state = useEditorStore.getState();
          state.newDocument(img.naturalWidth, img.naturalHeight, '#ffffff');
          setTimeout(() => {
            const layerId = state.addLayer(file.name.replace(/\.[^/.]+$/, ''));
            const newState = useEditorStore.getState();
            const layer = newState.layers.find((l) => l.id === layerId);
            if (layer) {
              const ctx = layer.canvas.getContext('2d')!;
              ctx.drawImage(img, 0, 0);
              newState.refreshThumbnail(layerId);
              newState.pushHistory('Drag & Drop Import');
              newState.addRecentFile(file.name, layer.canvas.toDataURL('image/jpeg', 0.7));
            }
            URL.revokeObjectURL(url);
          }, 100);
        };
        img.src = url;
      }}
    >
      <HiddenColorInputs />

      {/* Compact title bar */}
      <div className="flex items-center px-2 h-8 editor-surface border-b editor-border text-xs editor-text-muted shrink-0 no-select gap-1">
        {isMobile && (
          <Sheet open={menuSheetOpen} onOpenChange={setMenuSheetOpen}>
            <SheetTrigger asChild>
              <Button variant="ghost" size="icon" className="h-7 w-7 touch-target shrink-0">
                <Menu size={16} />
              </Button>
            </SheetTrigger>
            <SheetContent side="left" className="editor-surface editor-text border-r editor-border w-[280px] p-0">
              <SheetHeader className="p-3 border-b editor-border">
                <SheetTitle className="editor-text">Menu</SheetTitle>
              </SheetHeader>
              <div className="p-2 overflow-y-auto custom-scroll">
                <MenuBar onOpenNewDoc={() => { setNewDocOpen(true); setMenuSheetOpen(false); }} />
              </div>
            </SheetContent>
          </Sheet>
        )}

        <span className="font-medium editor-accent shrink-0">⚡ Pixel Lab</span>
        <span className="editor-text-dim hidden sm:inline shrink-0">·</span>
        <input
          value={docName}
          onChange={(e) => setDocName(e.target.value)}
          className="bg-transparent outline-none focus:editor-surface-3 px-1 rounded editor-text w-20 sm:w-auto min-w-0"
        />
        <span className="editor-text-dim hidden lg:inline shrink-0 ml-2">
          {layers.length} layers · {Math.round(zoom * 100)}%
        </span>

        <div className="ml-auto flex items-center gap-0.5 sm:gap-1 shrink-0">
          {/* Quick export */}
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              // Quick PNG export
              const state = useEditorStore.getState();
              const flat = document.createElement('canvas');
              flat.width = state.docWidth;
              flat.height = state.docHeight;
              const ctx = flat.getContext('2d')!;
              for (const layer of state.layers) {
                if (!layer.visible) continue;
                ctx.save();
                ctx.globalAlpha = layer.opacity;
                ctx.globalCompositeOperation = layer.blendMode as GlobalCompositeOperation;
                if (layer.maskCanvas && layer.maskEnabled) {
                  const tmp = document.createElement('canvas');
                  tmp.width = state.docWidth; tmp.height = state.docHeight;
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
              const link = document.createElement('a');
              link.href = flat.toDataURL('image/png');
              link.download = `${state.docName.replace(/\.[^/.]+$/, '')}.png`;
              link.click();
            }}
            className="h-7 px-2 editor-text-muted hover:editor-surface-3 gap-1"
            title="Quick Export PNG"
          >
            <Download size={14} />
            <span className="hidden lg:inline text-xs">Export</span>
          </Button>

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

          <PerformanceControls />
          <ThemeToggle />

          {/* MCP connection status indicator */}
          <div
            className="flex items-center gap-1 px-1.5 h-7 rounded shrink-0"
            title={mcpState.connected
              ? 'MCP bridge connected — external clients can call Pixel Lab tools'
              : mcpState.connecting
                ? 'MCP bridge connecting…'
                : 'MCP bridge offline — run `bun run mcp/server.ts` to enable external tool calls'}
          >
            <span
              className={cn(
                'inline-block w-2 h-2 rounded-full shrink-0',
                mcpState.connected ? 'bg-emerald-500' : mcpState.connecting ? 'bg-amber-500 animate-pulse' : 'bg-zinc-500',
              )}
            />
            <span className="hidden xl:inline text-[10px] editor-text-muted">MCP</span>
          </div>

          {/* Keyboard shortcuts "?" button */}
          <Button
            variant="ghost"
            size="icon"
            onClick={() => setShortcutsOpen(true)}
            className="h-7 w-7 editor-text-muted hover:editor-surface-3"
            title="Keyboard Shortcuts (Ctrl+/)"
          >
            <Keyboard size={14} />
          </Button>

          {/* Toggle panels button */}
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

      {/* Desktop: menu bar inline */}
      {!isMobile && (
        <MenuBar onOpenNewDoc={() => setNewDocOpen(true)} />
      )}
      <OptionsBar />

      <div className="flex flex-1 min-h-0 flex-col">
        <div className="flex flex-1 min-h-0">
          {/* Desktop: full toolbar */}
          {!isMobile && <Toolbar />}

          <div className="flex-1 flex min-w-0">
            {/* Canvas area */}
            <EditorCanvas />

            {/* Desktop: right panels */}
            {!isMobile && panelOpen && (
              <div className="w-[320px] lg:w-[360px] border-l editor-border shrink-0 flex flex-col">
                {panels}
              </div>
            )}

            {/* Mobile: panels in a bottom sheet */}
            {isMobile && (
              <Sheet open={panelOpen} onOpenChange={setPanelOpen}>
                <SheetContent side="right" className="editor-surface editor-text border-l editor-border w-[300px] p-0">
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

        {/* Mobile: toolbar at bottom (below canvas) */}
        {isMobile && (
          <MobileToolbar
            collapsed={toolbarCollapsed}
            onToggle={() => setToolbarCollapsed(!toolbarCollapsed)}
          />
        )}
      </div>

      {/* Mobile: floating action buttons */}
      {isMobile && (
        <div className="fixed bottom-4 right-4 z-50 flex flex-col gap-2">
          <Button
            variant="default"
            size="icon"
            onClick={() => setPanelOpen(true)}
            className="h-12 w-12 rounded-full shadow-lg editor-accent-bg touch-target"
            title="Open Panels"
          >
            <PanelRight size={20} className="text-white" />
          </Button>
        </div>
      )}

      {/* Luna (AI agent) floating bubble — bottom-right on desktop, stacked above
          the mobile panels button on mobile.
          Shows a pulse when no API key is set, a spinner when running, and a
          badge dot when a preview is awaiting Accept/Reject. */}
      <Button
        onClick={() => setAgentSheetOpen(true)}
        className={cn(
          'fixed z-50 h-12 w-12 rounded-full shadow-lg touch-target',
          // Desktop: bottom-right. Mobile: stack above the panels button.
          isMobile ? 'bottom-20 right-4' : 'bottom-4 right-4',
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
      <ShortcutsDialog open={shortcutsOpen} onOpenChange={setShortcutsOpen} />
      <Onboarding />
      <TutorialPanel />
    </div>
  );
}

// Mobile toolbar: horizontal scrollable bar at bottom
function MobileToolbar({ collapsed, onToggle }: { collapsed: boolean; onToggle: () => void }) {
  const activeTool = useEditorStore((s) => s.activeTool);
  const setTool = useEditorStore((s) => s.setTool);
  const foreground = useEditorStore((s) => s.foregroundColor);
  const background = useEditorStore((s) => s.backgroundColor);
  const swapColors = useEditorStore((s) => s.swapColors);

  // Most-used tools for mobile (compact set)
  const quickTools: { type: import('@/lib/editor-types').ToolType; icon: React.ReactNode; label: string }[] = [
    { type: 'move', icon: <span className="text-base">↖</span>, label: 'Move' },
    { type: 'brush', icon: <Brush size={18} />, label: 'Brush' },
    { type: 'eraser', icon: <span className="text-base">⌫</span>, label: 'Eraser' },
    { type: 'bucket', icon: <span className="text-base">🪣</span>, label: 'Fill' },
    { type: 'shape-rect', icon: <span className="text-base">▭</span>, label: 'Rect' },
    { type: 'shape-ellipse', icon: <span className="text-base">◯</span>, label: 'Ellipse' },
    { type: 'text', icon: <span className="text-base font-bold">T</span>, label: 'Text' },
    { type: 'eyedropper', icon: <span className="text-base">💧</span>, label: 'Pick' },
    { type: 'crop', icon: <span className="text-base">⬜</span>, label: 'Crop' },
    { type: 'magic-wand', icon: <span className="text-base">✨</span>, label: 'Wand' },
  ];

  // Full tool set (when expanded)
  const allTools = [
    ...quickTools,
    { type: 'lasso' as const, icon: <span className="text-base">✏️</span>, label: 'Lasso' },
    { type: 'pen' as const, icon: <span className="text-base">🖊️</span>, label: 'Pen' },
    { type: 'clone-stamp' as const, icon: <span className="text-base">📇</span>, label: 'Clone' },
    { type: 'heal-brush' as const, icon: <span className="text-base">🩹</span>, label: 'Heal' },
    { type: 'gradient' as const, icon: <span className="text-base">🎨</span>, label: 'Grad' },
    { type: 'shape-star' as const, icon: <span className="text-base">⭐</span>, label: 'Star' },
    { type: 'shape-arrow' as const, icon: <span className="text-base">➜</span>, label: 'Arrow' },
    { type: 'blob-brush' as const, icon: <span className="text-base">🫧</span>, label: 'Blob' },
    { type: 'liquify-push' as const, icon: <span className="text-base">🌀</span>, label: 'Push' },
    { type: 'hand' as const, icon: <span className="text-base">✋</span>, label: 'Pan' },
    { type: 'zoom' as const, icon: <span className="text-base">🔍</span>, label: 'Zoom' },
  ];

  const tools = collapsed ? quickTools : allTools;

  return (
    <div className="shrink-0 editor-surface border-t editor-border">
      {/* Color swatches row */}
      <div className="flex items-center justify-center gap-3 py-1.5 border-b editor-border">
        <button
          onClick={() => document.getElementById('fg-color-input')?.click()}
          className="w-7 h-7 rounded-full border-2 border-white/60 shadow shrink-0"
          style={{ backgroundColor: foreground }}
          title="Foreground color"
        />
        <button
          onClick={swapColors}
          className="editor-text-dim hover:editor-text text-xs"
          title="Swap colors"
        >⇄</button>
        <button
          onClick={() => document.getElementById('bg-color-input')?.click()}
          className="w-7 h-7 rounded-full border-2 border-white/60 shadow shrink-0"
          style={{ backgroundColor: background }}
          title="Background color"
        />
      </div>
      {/* Tools row */}
      <div className="flex items-center gap-0.5 px-1 py-1 overflow-x-auto custom-scroll">
        {tools.map((tool) => (
          <button
            key={tool.type}
            onClick={() => setTool(tool.type)}
            className={cn(
              'flex flex-col items-center justify-center gap-0.5 w-12 h-12 rounded-lg transition-colors shrink-0',
              activeTool === tool.type
                ? 'editor-accent-bg text-white'
                : 'editor-text-muted hover:editor-surface-3',
            )}
          >
            {tool.icon}
            <span className="text-[8px] leading-none">{tool.label}</span>
          </button>
        ))}
        <button
          onClick={onToggle}
          className="flex items-center justify-center w-10 h-12 rounded-lg editor-text-muted hover:editor-surface-3 shrink-0"
          title={collapsed ? 'Show all tools' : 'Show fewer tools'}
        >
          <span className="text-xs">{collapsed ? '⋯' : '⋯'}</span>
        </button>
      </div>
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
