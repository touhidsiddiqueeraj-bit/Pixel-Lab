'use client';

import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useState } from 'react';
import { useEditorStore } from '@/lib/editor-store';

const PRESETS = [
  { label: 'Default 1280×720', w: 1280, h: 720 },
  { label: 'HD 1920×1080', w: 1920, h: 1080 },
  { label: 'Square 1080×1080', w: 1080, h: 1080 },
  { label: 'Instagram Post 1080×1080', w: 1080, h: 1080 },
  { label: 'Instagram Story 1080×1920', w: 1080, h: 1920 },
  { label: 'Twitter Header 1500×500', w: 1500, h: 500 },
  { label: 'A4 @ 300 DPI 2480×3508', w: 2480, h: 3508 },
  { label: 'Web Banner 728×90', w: 728, h: 90 },
];

const BACKGROUNDS = [
  { label: 'White', value: '#ffffff' },
  { label: 'Black', value: '#000000' },
  { label: 'Transparent', value: 'transparent' },
  { label: 'Gray', value: '#808080' },
];

export function NewDocumentDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const newDocument = useEditorStore((s) => s.newDocument);
  const [width, setWidth] = useState(1280);
  const [height, setHeight] = useState(720);
  const [bg, setBg] = useState('#ffffff');
  const [name, setName] = useState('Untitled-1');

  const handleCreate = () => {
    newDocument(width, height, bg);
    onClose();
  };

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="editor-surface editor-border editor-text max-w-md">
        <DialogHeader>
          <DialogTitle className="editor-text">New Document</DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          <div>
            <Label className="editor-text-muted text-xs uppercase mb-2 block">Presets</Label>
            <Select onValueChange={(v) => {
              const p = PRESETS.find((p) => p.label === v);
              if (p) { setWidth(p.w); setHeight(p.h); }
            }}>
              <SelectTrigger className="editor-surface-2 editor-border">
                <SelectValue placeholder="Choose a preset..." />
              </SelectTrigger>
              <SelectContent className="editor-surface editor-border">
                {PRESETS.map((p) => (
                  <SelectItem key={p.label} value={p.label} className="hover:editor-accent-bg hover:text-white">
                    {p.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label className="editor-text-muted text-xs">Width (px)</Label>
              <Input
                type="number"
                value={width}
                min={1}
                max={8000}
                onChange={(e) => setWidth(Math.max(1, parseInt(e.target.value) || 1))}
                className="editor-surface-2 editor-border"
              />
            </div>
            <div>
              <Label className="editor-text-muted text-xs">Height (px)</Label>
              <Input
                type="number"
                value={height}
                min={1}
                max={8000}
                onChange={(e) => setHeight(Math.max(1, parseInt(e.target.value) || 1))}
                className="editor-surface-2 editor-border"
              />
            </div>
          </div>

          <div>
            <Label className="editor-text-muted text-xs">Background</Label>
            <Select value={bg} onValueChange={setBg}>
              <SelectTrigger className="editor-surface-2 editor-border">
                <SelectValue />
              </SelectTrigger>
              <SelectContent className="editor-surface editor-border">
                {BACKGROUNDS.map((b) => (
                  <SelectItem key={b.label} value={b.value} className="hover:editor-accent-bg hover:text-white">
                    {b.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div>
            <Label className="editor-text-muted text-xs">Document Name</Label>
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="editor-surface-2 editor-border"
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={onClose} className="editor-text hover:editor-surface-2">
            Cancel
          </Button>
          <Button onClick={handleCreate} className="editor-accent-bg hover:editor-accent-bg text-white">
            Create
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
