'use client';

import { useEffect } from 'react';
import { PhotoEditor } from '@/components/editor/PhotoEditor';
import { useEditorStore } from '@/lib/editor-store';
import { useAgentStore } from '@/lib/agent/agent-store';
import { useAutomationsStore } from '@/lib/automations/automations-store';
import { runAutomationOnCurrentDoc, runAutomationBatch } from '@/lib/automations/automation-runner';

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
