'use client';

import dynamic from 'next/dynamic';
import { useEffect } from 'react';
import { useEditorStore } from '@/lib/editor-store';
import { useAgentStore } from '@/lib/agent/agent-store';
import { useAutomationsStore } from '@/lib/automations/automations-store';
import { runAutomationOnCurrentDoc, runAutomationBatch } from '@/lib/automations/automation-runner';

// Client-only mount: the editor reads window dimensions on the first render
// (mobile vs desktop layout), so prerendering its HTML baked a DESKTOP frame
// into the static export. On the Android WebView that frame painted before
// hydration and lingered as a stale composited band above the real UI (the
// "squashed bars" bug). With ssr:false the first paint on any device is the
// correct layout; the fallback matches the app background so cold start is
// seamless (and identical to the native splash color).
const PhotoEditor = dynamic(
  () => import('@/components/editor/PhotoEditor').then((m) => ({ default: m.PhotoEditor })),
  {
    ssr: false,
    loading: () => <div className="h-[100dvh] w-screen editor-bg" />,
  },
);

export default function Home() {
  // Expose stores + runner functions on window in dev mode for testing/debugging.
  // This lets test scripts (and the browser console) access store state directly
  // and run automations programmatically:
  //   window.__editorStore.getState()
  //   window.__automationsStore.getState()
  //   await window.__runAutomation(steps, label)
  // Gated on NODE_ENV === 'development' so it's stripped in production builds.
  useEffect(() => {
    if (process.env.NODE_ENV === 'development') {
      (window as any).__editorStore = useEditorStore;
      (window as any).__agentStore = useAgentStore;
      (window as any).__automationsStore = useAutomationsStore;
      (window as any).__runAutomation = runAutomationOnCurrentDoc;
      (window as any).__runAutomationBatch = runAutomationBatch;
    }
  }, []);

  return <PhotoEditor />;
}
