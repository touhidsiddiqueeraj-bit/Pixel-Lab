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
import { Layers, History, Palette, SlidersHorizontal, Menu, PanelRight, Spline, Compass, Sun, Brush, Image as ImageIcon, Download, Upload, Clipboard, Grid as GridIcon, Wand2, Film, Keyboard, AlignLeft, Sparkles, X, Undo2, Redo2, Lasso, MousePointer2, Square, Circle, Pipette, Pencil, Eraser, PaintBucket, Type, Hand, ZoomIn, Crop, Pen, Stamp, Bandage, Droplet, PenTool, Wind, Star, Hexagon, MoveRight, Heart, MessageCircle, RefreshCw, Scissors, Shrink, Expand, RotateCw, Minus, Triangle } from 'lucide-react';
import { ToolType } from '@/lib/editor-types';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

type PanelTab = 'layers' | 'adjust' | 'develop' | 'color' | 'history' | 'nav' | 'agent' | 'automations';

// Mobile toolbar tool definitions. Each entry maps a tool type to an icon
// (Lucide) and a short label. Tools are grouped into categories so the mobile
// toolbar can render a horizontal category strip and a horizontal tool strip.
//
// IMPORTANT: All three lasso variants (lasso, polygonal-lasso, magnetic-lasso)
// are present as separate, clearly-labelled buttons. The previous mobile
// toolbar only had a single "lasso" button which selected the regular lasso —
// users had no way to access the polygonal or magnetic variants from mobile,
// and the single button's behaviour overlapped confusingly with the desktop
// toolbar's three-button lasso group.
interface MobileToolDef {
  type: ToolType;
  icon: React.ReactNode;
  label: string;
}

const MOBILE_TOOL_GROUPS: { category: string; icon: React.ReactNode; tools: MobileToolDef[] }[] = [
  {
    category: 'Select',
    icon: <MousePointer2 size={16} />,
    tools: [
      { type: 'move', icon: <MousePointer2 size={20} />, label: 'Move' },
      { type: 'marquee-rect', icon: <Square size={20} />, label: 'Rect' },
      { type: 'marquee-ellipse', icon: <Circle size={20} />, label: 'Ellipse' },
      { type: 'lasso', icon: <Lasso size={20} />, label: 'Lasso' },
      { type: 'polygonal-lasso', icon: <Spline size={20} />, label: 'Poly' },
      { type: 'magnetic-lasso', icon: <PenTool size={20} />, label: 'Magnet' },
      { type: 'magic-wand', icon: <Wand2 size={20} />, label: 'Wand' },
      { type: 'crop', icon: <Crop size={20} />, label: 'Crop' },
    ],
  },
  {
    category: 'Paint',
    icon: <Brush size={16} />,
    tools: [
      { type: 'brush', icon: <Brush size={20} />, label: 'Brush' },
      { type: 'pencil', icon: <Pencil size={20} />, label: 'Pencil' },
      { type: 'eraser', icon: <Eraser size={20} />, label: 'Erase' },
      { type: 'bucket', icon: <PaintBucket size={20} />, label: 'Fill' },
      { type: 'gradient', icon: <Palette size={20} />, label: 'Grad' },
      { type: 'eyedropper', icon: <Pipette size={20} />, label: 'Pick' },
      { type: 'clone-stamp', icon: <Stamp size={20} />, label: 'Clone' },
      { type: 'heal-brush', icon: <Bandage size={20} />, label: 'Heal' },
      { type: 'blob-brush', icon: <Droplet size={20} />, label: 'Blob' },
      { type: 'smooth-tool', icon: <Sparkles size={20} />, label: 'Smooth' },
    ],
  },
  {
    category: 'Shapes',
    icon: <Square size={16} />,
    tools: [
      { type: 'shape-rect', icon: <Square size={20} />, label: 'Rect' },
      { type: 'shape-ellipse', icon: <Circle size={20} />, label: 'Ellipse' },
      { type: 'shape-line', icon: <Minus size={20} />, label: 'Line' },
      { type: 'shape-star', icon: <Star size={20} />, label: 'Star' },
      { type: 'shape-polygon', icon: <Hexagon size={20} />, label: 'Poly' },
      { type: 'shape-arrow', icon: <MoveRight size={20} />, label: 'Arrow' },
      { type: 'shape-heart', icon: <Heart size={20} />, label: 'Heart' },
      { type: 'shape-speech-bubble', icon: <MessageCircle size={20} />, label: 'Bubble' },
      { type: 'shape-spiral', icon: <RefreshCw size={20} />, label: 'Spiral' },
      { type: 'text', icon: <Type size={20} />, label: 'Text' },
    ],
  },
  {
    category: 'Pen',
    icon: <Pen size={16} />,
    tools: [
      { type: 'pen', icon: <Pen size={20} />, label: 'Pen' },
      { type: 'curvature-pen', icon: <Spline size={20} />, label: 'Curve' },
      { type: 'calligraphy-brush', icon: <PenTool size={20} />, label: 'Calig' },
      { type: 'scatter-brush', icon: <Scissors size={20} />, label: 'Scatter' },
    ],
  },
  {
    category: 'Liquify',
    icon: <Wind size={16} />,
    tools: [
      { type: 'liquify-push', icon: <Wind size={20} />, label: 'Push' },
      { type: 'liquify-pucker', icon: <Shrink size={20} />, label: 'Pucker' },
      { type: 'liquify-bloat', icon: <Expand size={20} />, label: 'Bloat' },
      { type: 'liquify-twirl', icon: <RotateCw size={20} />, label: 'Twirl' },
    ],
  },
  {
    category: 'View',
    icon: <Hand size={16} />,
    tools: [
      { type: 'hand', icon: <Hand size={20} />, label: 'Pan' },
      { type: 'zoom', icon: <ZoomIn size={20} />, label: 'Zoom' },
    ],
  },
];

// Flatten for quick lookups
const ALL_MOBILE_TOOLS: MobileToolDef[] = MOBILE_TOOL_GROUPS.flatMap(g => g.tools);

export function PhotoEditor() {
  const [newDocOpen, setNewDocOpen] = useState(false);
  const [vectorizeOpen, setVectorizeOpen] = useState(false);
  const [figmaImportOpen, setFigmaImportOpen] = useState(false);
  const [panelOpen, setPanelOpen] = useState(true);
  const [activeTab, setActiveTab] = useState<PanelTab>('layers');
  const [isMobile, setIsMobile] = useState(false);
  const [menuSheetOpen, setMenuSheetOpen] = useState(false);
  // Mobile: which tool category is currently shown in the bottom toolbar.
  // Defaults to 'Select' so the lasso variants are immediately visible — this
  // is the category users were complaining about (the old mobile toolbar only
  // exposed the regular lasso).
  const [mobileCategory, setMobileCategory] = useState<string>('Select');
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

      {/* Title bar — desktop: full menubar inline; mobile: compact with only
          the essentials (menu, doc name, undo/redo, export, theme). Mobile is
          intentionally minimal so the canvas gets maximum vertical space. */}
      <div className={cn(
        'flex items-center px-2 editor-surface border-b editor-border text-xs editor-text-muted shrink-0 no-select gap-1',
        isMobile ? 'h-10' : 'h-8',
      )}>
        {isMobile && (
          <Sheet open={menuSheetOpen} onOpenChange={setMenuSheetOpen}>
            <SheetTrigger asChild>
              <Button variant="ghost" size="icon" className="h-9 w-9 touch-target shrink-0">
                <Menu size={18} />
              </Button>
            </SheetTrigger>
            <SheetContent side="left" className="editor-surface editor-text border-r editor-border w-[280px] p-0">
              <SheetHeader className="p-3 border-b editor-border">
                <SheetTitle className="editor-text">Menu</SheetTitle>
              </SheetHeader>
              <div className="p-2 overflow-y-auto custom-scroll">
                <MenuBar onOpenNewDoc={() => { setNewDocOpen(true); setMenuSheetOpen(false); }} onOpenFigmaImport={() => { setFigmaImportOpen(true); setMenuSheetOpen(false); }} />
              </div>
            </SheetContent>
          </Sheet>
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
              disabled={!useEditorStore.getState().canUndo()}
              className="h-9 w-9 editor-text-muted hover:editor-surface-3"
              title="Undo (Ctrl+Z)"
            >
              <Undo2 size={16} />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              onClick={() => useEditorStore.getState().redo()}
              disabled={!useEditorStore.getState().canRedo()}
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

          <ThemeToggle />

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

      {/* Desktop: menu bar inline */}
      {!isMobile && (
        <MenuBar onOpenNewDoc={() => setNewDocOpen(true)} onOpenFigmaImport={() => setFigmaImportOpen(true)} />
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

        {/* Mobile: bottom toolbar with categories + tools + colors. The
            toolbar's right end has buttons for Panels and Luna (AI) so we
            no longer need separate floating buttons that overlapped each
            other and the canvas zoom controls. */}
        {isMobile && (
          <MobileToolbar
            activeCategory={mobileCategory}
            onCategoryChange={setMobileCategory}
            onOpenPanels={() => setPanelOpen(true)}
            onOpenAgent={() => setAgentSheetOpen(true)}
          />
        )}
      </div>

      {/* Mobile: no more floating panels button — it's now in the bottom
          toolbar (right end) to avoid overlapping the canvas zoom controls
          and the Luna bubble. */}

      {/* Luna (AI agent) floating bubble — bottom-right on desktop only.
          On mobile, the Luna button is integrated into the bottom toolbar
          so it doesn't overlap with anything.
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

// Mobile toolbar — redesigned from scratch.
//
// Problems with the old design:
//   1. Only a single "lasso" button → users couldn't access the polygonal or
//      magnetic lasso variants from mobile, and the single button's behaviour
//      "overlapped" with the desktop toolbar's three-button lasso group.
//   2. Buttons were 12×12 (48px) which is borderline for thumb use, and the
//      labels were 8px — barely legible.
//   3. The toolbar used a "collapsed/expanded" toggle that swapped between a
//      short list and a long flat list — confusing because tools changed
//      position when expanding.
//   4. Floating panels + Luna buttons stacked at bottom-right collided with
//      the canvas zoom controls and each other.
//
// New design:
//   • Two-row bottom toolbar.
//   • Row 1: horizontal scrollable category strip (Select / Paint / Shapes /
//     Pen / Liquify / View) + sticky right-end with Panels and Luna buttons.
//   • Row 2: horizontal scrollable tool buttons for the active category, with
//     large 56×48px touch targets and readable labels. All three lasso
//     variants appear as distinct buttons under the "Select" category.
//   • Color swatches live in the OptionsBar area on mobile (they were
//     already there in the desktop Toolbar; we now expose them on mobile too
//     via a compact color row at the left of the tool row).
function MobileToolbar({
  activeCategory,
  onCategoryChange,
  onOpenPanels,
  onOpenAgent,
}: {
  activeCategory: string;
  onCategoryChange: (cat: string) => void;
  onOpenPanels: () => void;
  onOpenAgent: () => void;
}) {
  const activeTool = useEditorStore((s) => s.activeTool);
  const setTool = useEditorStore((s) => s.setTool);
  const foreground = useEditorStore((s) => s.foregroundColor);
  const background = useEditorStore((s) => s.backgroundColor);
  const swapColors = useEditorStore((s) => s.swapColors);
  const agentApiKey = useAgentStore((s) => s.apiKey);
  const agentStatus = useAgentStore((s) => s.status);

  const activeGroup = MOBILE_TOOL_GROUPS.find(g => g.category === activeCategory) ?? MOBILE_TOOL_GROUPS[0];

  return (
    <div className="shrink-0 editor-surface border-t editor-border no-select">
      {/* Row 1: category strip + sticky right-end actions (panels, Luna).
          Categories scroll horizontally; the right-end buttons are sticky
          so they're always reachable. */}
      <div className="flex items-stretch border-b editor-border">
        <div className="flex items-center gap-1 px-2 py-1.5 overflow-x-auto custom-scroll flex-1 min-w-0">
          {MOBILE_TOOL_GROUPS.map((group) => {
            // A category is "active" if it's the selected category OR if the
            // currently-active tool belongs to it. This keeps the category
            // highlighted when the user picks a tool then switches category
            // and back.
            const isActive = group.category === activeCategory
              || group.tools.some(t => t.type === activeTool);
            return (
              <button
                key={group.category}
                onClick={() => onCategoryChange(group.category)}
                className={cn(
                  'flex items-center gap-1.5 px-3 h-9 rounded-md transition-colors shrink-0 text-xs font-medium',
                  isActive
                    ? 'editor-accent-bg text-white'
                    : 'editor-text-muted hover:editor-surface-3',
                )}
              >
                {group.icon}
                <span>{group.category}</span>
              </button>
            );
          })}
        </div>
        {/* Sticky right-end: Panels + Luna buttons. These are part of the
            toolbar (not floating) so they can't overlap the canvas zoom
            controls or each other. */}
        <div className="flex items-center gap-1 px-2 border-l editor-border shrink-0">
          <button
            onClick={onOpenPanels}
            className="flex items-center justify-center h-9 w-9 rounded-md editor-text-muted hover:editor-surface-3 shrink-0"
            title="Open Panels"
            aria-label="Open Panels"
          >
            <PanelRight size={18} />
          </button>
          <button
            onClick={onOpenAgent}
            className={cn(
              'relative flex items-center justify-center h-9 w-9 rounded-md shrink-0 text-white',
              'bg-gradient-to-br from-sky-500 to-purple-600 hover:from-sky-400 hover:to-purple-500',
              !agentApiKey && 'animate-pulse',
            )}
            title="Open Luna (AI Agent)"
            aria-label="Open Luna"
          >
            {agentStatus === 'running' ? (
              <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24" fill="none">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
              </svg>
            ) : (
              <Sparkles size={18} />
            )}
            {agentStatus === 'awaiting-accept' && (
              <span className="absolute -top-0.5 -right-0.5 h-2.5 w-2.5 rounded-full bg-emerald-400 border-2 border-white" />
            )}
            {agentStatus === 'error' && (
              <span className="absolute -top-0.5 -right-0.5 h-2.5 w-2.5 rounded-full bg-red-500 border-2 border-white" />
            )}
          </button>
        </div>
      </div>

      {/* Row 2: color swatches (left, sticky) + tool buttons (scrollable). */}
      <div className="flex items-stretch">
        {/* Color swatches — sticky on the left so they're always visible
            regardless of which category is selected. The swatches are 32×32
            (just above the 44px touch-target minimum when combined with
            padding) and the swap arrow is a separate button. */}
        <div className="flex items-center gap-1.5 px-2 border-r editor-border shrink-0">
          <button
            onClick={() => document.getElementById('fg-color-input')?.click()}
            className="w-8 h-8 rounded-md border-2 border-white/70 shadow shrink-0"
            style={{ backgroundColor: foreground }}
            title="Foreground color"
            aria-label="Foreground color"
          />
          <button
            onClick={swapColors}
            className="flex items-center justify-center w-7 h-7 rounded editor-text-dim hover:editor-text hover:editor-surface-3 shrink-0"
            title="Swap colors"
            aria-label="Swap colors"
          >
            <Triangle size={10} className="rotate-90 fill-current" />
          </button>
          <button
            onClick={() => document.getElementById('bg-color-input')?.click()}
            className="w-8 h-8 rounded-md border-2 border-white/70 shadow shrink-0"
            style={{ backgroundColor: background }}
            title="Background color"
            aria-label="Background color"
          />
        </div>

        {/* Tool buttons — horizontally scrollable. Each button is 56×48px
            (well above the 44px touch target minimum) with a 10px label. */}
        <div className="flex items-center gap-1 px-2 py-1.5 overflow-x-auto custom-scroll flex-1 min-w-0">
          {activeGroup.tools.map((tool) => {
            const isActive = activeTool === tool.type;
            return (
              <button
                key={tool.type}
                onClick={() => setTool(tool.type)}
                className={cn(
                  'flex flex-col items-center justify-center gap-0.5 w-14 h-12 rounded-lg transition-colors shrink-0',
                  isActive
                    ? 'editor-accent-bg text-white shadow-inner'
                    : 'editor-text-muted hover:editor-surface-3 hover:editor-text',
                )}
                title={tool.label}
                aria-label={tool.label}
                aria-pressed={isActive}
              >
                {tool.icon}
                <span className="text-[10px] leading-none font-medium">{tool.label}</span>
              </button>
            );
          })}
        </div>
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
