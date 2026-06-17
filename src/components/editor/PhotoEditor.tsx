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
import { NewDocumentDialog } from './NewDocumentDialog';
import { useEditorStore } from '@/lib/editor-store';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Layers, History, Palette, SlidersHorizontal } from 'lucide-react';

export function PhotoEditor() {
  const [newDocOpen, setNewDocOpen] = useState(false);
  const docName = useEditorStore((s) => s.docName);
  const setDocName = useEditorStore((s) => s.setDocName);
  const layers = useEditorStore((s) => s.layers);
  const zoom = useEditorStore((s) => s.zoom);

  // Track dark mode
  useEffect(() => {
    document.documentElement.classList.add('dark');
  }, []);

  return (
    <div className="flex flex-col h-screen w-screen bg-zinc-950 text-zinc-100 overflow-hidden">
      {/* Hidden color inputs used by Toolbar */}
      <HiddenColorInputs />

      {/* Top: title bar */}
      <div className="flex items-center px-3 h-7 bg-zinc-900 border-b border-zinc-800 text-xs text-zinc-300 shrink-0">
        <span className="font-medium text-sky-400">⚡ PhotoLab Studio</span>
        <span className="mx-2 text-zinc-600">·</span>
        <input
          value={docName}
          onChange={(e) => setDocName(e.target.value)}
          className="bg-transparent outline-none focus:bg-zinc-800 px-1 rounded text-zinc-200"
        />
        <span className="mx-2 text-zinc-600">·</span>
        <span className="text-zinc-500">{layers.length} layers · {Math.round(zoom * 100)}%</span>
        <div className="ml-auto flex items-center gap-2">
          <span className="text-zinc-600 text-[10px]">Photoshop-clone web editor</span>
        </div>
      </div>

      <MenuBar onOpenNewDoc={() => setNewDocOpen(true)} />
      <OptionsBar />

      <div className="flex flex-1 min-h-0">
        <Toolbar />

        <div className="flex-1 flex min-w-0">
          {/* Canvas area */}
          <EditorCanvas />

          {/* Right panels */}
          <div className="w-[340px] border-l border-zinc-800 shrink-0 flex flex-col">
              <Tabs defaultValue="layers" className="h-full flex flex-col">
                <TabsList className="bg-zinc-900 border-b border-zinc-800 rounded-none w-full justify-start h-9 p-0">
                  <TabsTrigger value="layers" className="rounded-none data-[state=active]:bg-zinc-800 data-[state=active]:text-sky-400 gap-1 px-3 text-xs">
                    <Layers size={12} /> Layers
                  </TabsTrigger>
                  <TabsTrigger value="adjust" className="rounded-none data-[state=active]:bg-zinc-800 data-[state=active]:text-sky-400 gap-1 px-3 text-xs">
                    <SlidersHorizontal size={12} /> Adjust
                  </TabsTrigger>
                  <TabsTrigger value="color" className="rounded-none data-[state=active]:bg-zinc-800 data-[state=active]:text-sky-400 gap-1 px-3 text-xs">
                    <Palette size={12} /> Color
                  </TabsTrigger>
                  <TabsTrigger value="history" className="rounded-none data-[state=active]:bg-zinc-800 data-[state=active]:text-sky-400 gap-1 px-3 text-xs">
                    <History size={12} /> History
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
                <TabsContent value="history" className="flex-1 min-h-0 m-0">
                  <HistoryPanel />
                </TabsContent>
              </Tabs>
          </div>
        </div>
      </div>

      <NewDocumentDialog open={newDocOpen} onClose={() => setNewDocOpen(false)} />
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
