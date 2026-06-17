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
import { NewDocumentDialog } from './NewDocumentDialog';
import { VectorizeDialog } from './VectorizeDialog';
import { ThemeToggle } from './ThemeToggle';
import { useEditorStore } from '@/lib/editor-store';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from '@/components/ui/sheet';
import { Layers, History, Palette, SlidersHorizontal, Menu, PanelRight, Spline, Compass } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

type PanelTab = 'layers' | 'adjust' | 'color' | 'history' | 'nav';

export function PhotoEditor() {
  const [newDocOpen, setNewDocOpen] = useState(false);
  const [vectorizeOpen, setVectorizeOpen] = useState(false);
  const [panelOpen, setPanelOpen] = useState(false);
  const [activeTab, setActiveTab] = useState<PanelTab>('layers');
  const [isMobile, setIsMobile] = useState(false);
  const [menuSheetOpen, setMenuSheetOpen] = useState(false);

  const docName = useEditorStore((s) => s.docName);
  const setDocName = useEditorStore((s) => s.setDocName);
  const layers = useEditorStore((s) => s.layers);
  const zoom = useEditorStore((s) => s.zoom);

  // Detect mobile viewport
  useEffect(() => {
    const check = () => setIsMobile(window.innerWidth < 768);
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

  const panels = (
    <Tabs
      value={activeTab}
      onValueChange={(v) => setActiveTab(v as PanelTab)}
      className="h-full flex flex-col"
    >
      <TabsList className="editor-surface editor-border rounded-none w-full justify-start h-9 p-0 border-b">
        <TabsTrigger
          value="layers"
          className="rounded-none data-[state=active]:editor-surface-3 data-[state=active]:editor-accent gap-1 px-2 sm:px-3 text-xs"
        >
          <Layers size={12} /> <span className="hidden sm:inline">Layers</span>
        </TabsTrigger>
        <TabsTrigger
          value="adjust"
          className="rounded-none data-[state=active]:editor-surface-3 data-[state=active]:editor-accent gap-1 px-2 sm:px-3 text-xs"
        >
          <SlidersHorizontal size={12} /> <span className="hidden sm:inline">Adjust</span>
        </TabsTrigger>
        <TabsTrigger
          value="color"
          className="rounded-none data-[state=active]:editor-surface-3 data-[state=active]:editor-accent gap-1 px-2 sm:px-3 text-xs"
        >
          <Palette size={12} /> <span className="hidden sm:inline">Color</span>
        </TabsTrigger>
        <TabsTrigger
          value="nav"
          className="rounded-none data-[state=active]:editor-surface-3 data-[state=active]:editor-accent gap-1 px-2 sm:px-3 text-xs"
        >
          <Compass size={12} /> <span className="hidden sm:inline">Nav</span>
        </TabsTrigger>
        <TabsTrigger
          value="history"
          className="rounded-none data-[state=active]:editor-surface-3 data-[state=active]:editor-accent gap-1 px-2 sm:px-3 text-xs"
        >
          <History size={12} /> <span className="hidden sm:inline">History</span>
        </TabsTrigger>
      </TabsList>
      <TabsContent value="layers" className="flex-1 min-h-0 m-0">
        <LayersPanel />
      </TabsContent>
      <TabsContent value="adjust" className="flex-1 min-h-0 m-0">
        <AdjustmentsPanel />
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
    </Tabs>
  );

  return (
    <div className="flex flex-col h-[100dvh] w-screen editor-bg editor-text overflow-hidden">
      <HiddenColorInputs />

      {/* Title bar - responsive */}
      <div className="flex items-center px-2 sm:px-3 h-8 editor-surface border-b editor-border text-xs editor-text-muted shrink-0 no-select">
        {isMobile && (
          <Sheet open={menuSheetOpen} onOpenChange={setMenuSheetOpen}>
            <SheetTrigger asChild>
              <Button variant="ghost" size="icon" className="h-7 w-7 mr-1 touch-target">
                <Menu size={16} />
              </Button>
            </SheetTrigger>
            <SheetContent side="left" className="editor-surface editor-text border-r editor-border w-[280px] p-0">
              <SheetHeader className="p-3 border-b editor-border">
                <SheetTitle className="editor-text">Menu</SheetTitle>
              </SheetHeader>
              <div className="p-2">
                <MenuBar onOpenNewDoc={() => { setNewDocOpen(true); setMenuSheetOpen(false); }} />
              </div>
            </SheetContent>
          </Sheet>
        )}

        <span className="font-medium editor-accent">⚡ PhotoLab</span>
        <span className="mx-1.5 editor-text-dim hidden sm:inline">·</span>
        <input
          value={docName}
          onChange={(e) => setDocName(e.target.value)}
          className="bg-transparent outline-none focus:editor-surface-3 px-1 rounded editor-text w-24 sm:w-auto"
        />
        <span className="mx-1.5 editor-text-dim hidden md:inline">·</span>
        <span className="editor-text-dim hidden md:inline">
          {layers.length} layers · {Math.round(zoom * 100)}%
        </span>

        <div className="ml-auto flex items-center gap-1">
          {/* Vectorize quick button */}
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setVectorizeOpen(true)}
            className="h-7 px-2 editor-text-muted hover:editor-surface-3 gap-1"
            title="Vectorize Image"
          >
            <Spline size={14} className="text-purple-400" />
            <span className="hidden sm:inline text-xs">Vectorize</span>
          </Button>

          <ThemeToggle />

          {/* Toggle panels button (mobile & desktop) */}
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

      <div className="flex flex-1 min-h-0">
        <Toolbar />

        <div className="flex-1 flex min-w-0">
          {/* Canvas area */}
          <EditorCanvas />

          {/* Desktop: right panels */}
          {!isMobile && panelOpen && (
            <div className="w-[340px] border-l editor-border shrink-0 flex flex-col">
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

      {/* Mobile: floating panel toggle button */}
      {isMobile && (
        <Button
          variant="default"
          size="icon"
          onClick={() => setPanelOpen(true)}
          className="fixed bottom-4 right-4 h-12 w-12 rounded-full shadow-lg editor-accent-bg z-50 touch-target"
          title="Open Panels"
        >
          <PanelRight size={20} className="text-white" />
        </Button>
      )}

      <NewDocumentDialog open={newDocOpen} onClose={() => setNewDocOpen(false)} />
      <VectorizeDialog open={vectorizeOpen} onClose={() => setVectorizeOpen(false)} />
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
