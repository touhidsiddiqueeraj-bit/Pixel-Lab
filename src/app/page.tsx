'use client';

import { useEffect } from 'react';
import { PhotoEditor } from '@/components/editor/PhotoEditor';
import { useEditorStore } from '@/lib/editor-store';
import { useAgentStore } from '@/lib/agent/agent-store';

export default function Home() {
  // Expose stores on window in dev mode for testing / debugging.
  // This lets test scripts (and the browser console) access store state
  // directly: window.__editorStore.getState(), window.__agentStore.getState().
  // Gated on NODE_ENV === 'development' so it's stripped in production builds.
  useEffect(() => {
    if (process.env.NODE_ENV === 'development') {
      (window as unknown as { __editorStore: typeof useEditorStore }).__editorStore = useEditorStore;
      (window as unknown as { __agentStore: typeof useAgentStore }).__agentStore = useAgentStore;
    }
  }, []);

  return <PhotoEditor />;
}
