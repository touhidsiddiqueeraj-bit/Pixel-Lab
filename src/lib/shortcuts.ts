/**
 * Centralized keyboard shortcuts — Photoshop-style.
 *
 * This is the SINGLE SOURCE OF TRUTH for keyboard shortcuts in Pixel Lab.
 * Both the keydown handler in EditorCanvas.tsx and the ShortcutsDialog
 * component read from this module, so they can never get out of sync.
 *
 * Conventions (matching Adobe Photoshop where possible):
 *   - Single-letter shortcuts select tools (V=Move, B=Brush, etc.)
 *   - Ctrl/Cmd+letter is for editing actions (Ctrl+Z=Undo, Ctrl+C=Copy, etc.)
 *   - Ctrl+Shift+letter for variants (Ctrl+Shift+Z=Redo, Ctrl+Shift+V=Paste in Place)
 *   - [ and ] decrease/increase brush size
 *   - Shift+[ and Shift+] decrease/increase brush hardness
 *   - Number keys 1-9 set layer opacity (10%, 20%, ... 90%)
 *   - 0 sets layer opacity to 100%
 *
 * Platform note: we use Ctrl on Windows/Linux and Cmd on macOS. The keydown
 * handler checks `e.metaKey || e.ctrlKey` so both work.
 */

import type { ToolType } from './editor-types';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type ShortcutCategory =
  | 'Tools'
  | 'Edit'
  | 'Layer'
  | 'Selection'
  | 'View'
  | 'File'
  | 'Brush'
  | 'Color';

export interface Shortcut {
  /** The keys to press, displayed to the user. e.g. "Ctrl+Z", "B", "Ctrl+Shift+I" */
  keys: string;
  /** What the shortcut does. */
  action: string;
  /** Category for grouping in the dialog. */
  category: ShortcutCategory;
  /** Optional longer description. */
  description?: string;
}

// ---------------------------------------------------------------------------
// The canonical shortcut list
// ---------------------------------------------------------------------------

export const SHORTCUTS: Shortcut[] = [
  // --- Tools (single-letter) ---
  { keys: 'V', action: 'Move tool', category: 'Tools' },
  { keys: 'M', action: 'Rectangular Marquee', category: 'Tools' },
  { keys: 'L', action: 'Lasso', category: 'Tools' },
  { keys: 'W', action: 'Magic Wand', category: 'Tools' },
  { keys: 'C', action: 'Crop', category: 'Tools' },
  { keys: 'I', action: 'Eyedropper', category: 'Tools' },
  { keys: 'B', action: 'Brush', category: 'Tools' },
  { keys: 'E', action: 'Eraser', category: 'Tools' },
  { keys: 'G', action: 'Paint Bucket', category: 'Tools' },
  { keys: 'T', action: 'Text', category: 'Tools' },
  { keys: 'U', action: 'Rectangle Shape', category: 'Tools' },
  { keys: 'P', action: 'Pen Tool', category: 'Tools' },
  { keys: 'S', action: 'Clone Stamp', category: 'Tools' },
  { keys: 'J', action: 'Healing Brush', category: 'Tools' },
  { keys: 'R', action: 'Liquify Push', category: 'Tools' },
  { keys: 'H', action: 'Hand (pan)', category: 'Tools' },
  { keys: 'Z', action: 'Zoom tool', category: 'Tools' },

  // --- Edit (Ctrl+key) ---
  { keys: 'Ctrl+Z', action: 'Undo', category: 'Edit' },
  { keys: 'Ctrl+Shift+Z', action: 'Redo', category: 'Edit', description: 'Also Ctrl+Y' },
  { keys: 'Ctrl+Y', action: 'Redo', category: 'Edit', description: 'Also Ctrl+Shift+Z' },
  { keys: 'Ctrl+C', action: 'Copy selection / layer', category: 'Edit' },
  { keys: 'Ctrl+V', action: 'Paste as new layer', category: 'Edit' },
  { keys: 'Ctrl+Shift+V', action: 'Paste in Place', category: 'Edit', description: 'Paste at same position as copied' },
  { keys: 'Ctrl+A', action: 'Select All', category: 'Edit' },
  { keys: 'Ctrl+D', action: 'Deselect', category: 'Edit' },
  { keys: 'Ctrl+Shift+I', action: 'Inverse Selection', category: 'Edit' },
  { keys: 'Ctrl+X', action: 'Cut selection to clipboard', category: 'Edit' },
  { keys: 'Ctrl+Shift+J', action: 'Cut to new layer', category: 'Edit', description: 'Cut selection and paste as new layer' },

  // --- Layer (Ctrl+key) ---
  { keys: 'Ctrl+Shift+N', action: 'New Layer', category: 'Layer' },
  { keys: 'Ctrl+J', action: 'Duplicate Layer', category: 'Layer', description: 'Duplicate active layer or selection' },
  { keys: 'Ctrl+E', action: 'Merge Down', category: 'Layer' },
  { keys: 'Ctrl+Shift+E', action: 'Merge Visible', category: 'Layer' },
  { keys: 'Ctrl+]', action: 'Bring layer forward', category: 'Layer' },
  { keys: 'Ctrl+[', action: 'Send layer backward', category: 'Layer' },
  { keys: 'Ctrl+Shift+]', action: 'Bring to Front', category: 'Layer' },
  { keys: 'Ctrl+Shift+[', action: 'Send to Back', category: 'Layer' },
  { keys: 'Ctrl+G', action: 'Group Layers', category: 'Layer' },
  { keys: 'Ctrl+Shift+G', action: 'Ungroup', category: 'Layer' },

  // --- Selection ---
  { keys: 'Ctrl+A', action: 'Select All', category: 'Selection' },
  { keys: 'Ctrl+D', action: 'Deselect', category: 'Selection' },
  { keys: 'Ctrl+Shift+I', action: 'Select Inverse', category: 'Selection' },
  { keys: 'Ctrl+Alt+D', action: 'Feather Selection', category: 'Selection', description: 'Opens feather dialog' },

  // --- View ---
  { keys: 'Ctrl++', action: 'Zoom In', category: 'View' },
  { keys: 'Ctrl+-', action: 'Zoom Out', category: 'View' },
  { keys: 'Ctrl+0', action: 'Fit on Screen', category: 'View' },
  { keys: 'Ctrl+1', action: 'Actual Size (100%)', category: 'View' },
  { keys: 'Ctrl+2', action: 'Show / hide panels', category: 'View', description: 'Toggle right panel' },
  { keys: 'Space', action: 'Pan (hold + drag)', category: 'View' },
  { keys: 'Ctrl+;', action: 'Toggle Rulers', category: 'View' },
  { keys: 'Ctrl+\'', action: 'Toggle Grid', category: 'View' },
  { keys: 'Ctrl+;', action: 'Toggle Guides', category: 'View' },
  { keys: 'Ctrl+H', action: 'Toggle Extras (selection/marching ants)', category: 'View' },
  { keys: 'Ctrl+/', action: 'Show Keyboard Shortcuts', category: 'View', description: 'Open this dialog' },

  // --- File ---
  { keys: 'Ctrl+N', action: 'New Document', category: 'File' },
  { keys: 'Ctrl+O', action: 'Open File', category: 'File' },
  { keys: 'Ctrl+S', action: 'Quick Export PNG', category: 'File' },
  { keys: 'Ctrl+Shift+S', action: 'Export as JPEG', category: 'File' },
  { keys: 'Ctrl+Shift+Alt+S', action: 'Export as WebP', category: 'File' },
  { keys: 'Ctrl+P', action: 'Print', category: 'File', description: 'Open browser print dialog' },

  // --- Brush ---
  { keys: '[', action: 'Decrease brush size', category: 'Brush', description: 'By 5px' },
  { keys: ']', action: 'Increase brush size', category: 'Brush', description: 'By 5px' },
  { keys: 'Shift+[', action: 'Decrease brush hardness', category: 'Brush', description: 'By 10%' },
  { keys: 'Shift+]', action: 'Increase brush hardness', category: 'Brush', description: 'By 10%' },
  { keys: 'Shift+[', action: 'Softer brush', category: 'Brush' },
  { keys: 'Shift+]', action: 'Harder brush', category: 'Brush' },

  // --- Color ---
  { keys: 'X', action: 'Swap foreground/background colors', category: 'Color' },
  { keys: 'D', action: 'Reset colors to black/white', category: 'Color' },
  { keys: 'Alt+Click', action: 'Set clone/heal source', category: 'Color', description: 'With Clone Stamp or Healing Brush active' },

  // --- Layer opacity (number keys) ---
  { keys: '1', action: 'Layer opacity 10%', category: 'Layer', description: 'Press 1-9 for 10%-90%' },
  { keys: '5', action: 'Layer opacity 50%', category: 'Layer' },
  { keys: '0', action: 'Layer opacity 100%', category: 'Layer' },

  // --- Pen tool ---
  { keys: 'Enter', action: 'Commit pen path', category: 'Tools', description: 'When pen tool is active' },
  { keys: 'Escape', action: 'Cancel pen path', category: 'Tools', description: 'When pen tool is active' },
];

// ---------------------------------------------------------------------------
// Tool shortcut map (single-letter → ToolType)
// ---------------------------------------------------------------------------

export const TOOL_SHORTCUTS: Record<string, ToolType> = {
  v: 'move',
  m: 'marquee-rect',
  l: 'lasso',
  w: 'magic-wand',
  c: 'crop',
  i: 'eyedropper',
  b: 'brush',
  e: 'eraser',
  g: 'bucket',
  t: 'text',
  u: 'shape-rect',
  p: 'pen',
  s: 'clone-stamp',
  j: 'heal-brush',
  r: 'liquify-push',
  h: 'hand',
  z: 'zoom',
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Format a key combination for display, using the platform's modifier key.
 * On macOS, "Ctrl" is shown as "⌘"; on Windows/Linux, "Ctrl" is shown as "Ctrl".
 */
export function formatShortcut(keys: string, isMac: boolean = false): string {
  if (isMac) {
    return keys
      .replace(/Ctrl\+/g, '⌘')
      .replace(/Shift\+/g, '⇧')
      .replace(/Alt\+/g, '⌥');
  }
  return keys;
}

/**
 * Get all shortcuts grouped by category. Used by the ShortcutsDialog.
 */
export function getShortcutsByCategory(): Record<ShortcutCategory, Shortcut[]> {
  const grouped: Record<ShortcutCategory, Shortcut[]> = {
    Tools: [],
    Edit: [],
    Layer: [],
    Selection: [],
    View: [],
    File: [],
    Brush: [],
    Color: [],
  };
  for (const s of SHORTCUTS) {
    grouped[s.category].push(s);
  }
  return grouped;
}

/**
 * Detect macOS for platform-correct display.
 */
export function isMacOS(): boolean {
  if (typeof navigator === 'undefined') return false;
  return /Mac|iPod|iPhone|iPad/.test(navigator.platform);
}
