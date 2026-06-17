'use client';

import { useEditorStore } from '@/lib/editor-store';
import { hexToRgb, rgbToHex, rgbToHsl, hslToRgb } from '@/lib/image-processing';
import { Pipette, RefreshCw, ArrowLeftRight } from 'lucide-react';
import { useState, useCallback, useRef, useEffect } from 'react';

const PRESET_SWATCHES = [
  '#000000', '#444444', '#888888', '#cccccc', '#ffffff',
  '#ff0000', '#ff8800', '#ffff00', '#00ff00', '#00ffff',
  '#0088ff', '#0000ff', '#8800ff', '#ff00ff', '#ff0088',
  '#8b4513', '#a0522d', '#d2691e', '#cd5c5c', '#f4a460',
  '#bdb76b', '#556b2f', '#008080', '#4682b4', '#5f9ea0',
];

export function ColorPanel() {
  const foreground = useEditorStore((s) => s.foregroundColor);
  const background = useEditorStore((s) => s.backgroundColor);
  const setForeground = useEditorStore((s) => s.setForeground);
  const setBackground = useEditorStore((s) => s.setBackground);
  const swapColors = useEditorStore((s) => s.swapColors);
  const resetColors = useEditorStore((s) => s.resetColors);

  const [editingTarget, setEditingTarget] = useState<'fg' | 'bg'>('fg');
  const [hexInput, setHexInput] = useState(foreground);

  const currentColor = editingTarget === 'fg' ? foreground : background;
  // Sync hexInput when target/external color changes (best-effort sync)
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setHexInput(editingTarget === 'fg' ? foreground : background);
  }, [foreground, background, editingTarget]);
  const setCurrentColor = editingTarget === 'fg' ? setForeground : setBackground;

  const rgb = hexToRgb(currentColor);
  const [h, s, l] = rgbToHsl(rgb.r, rgb.g, rgb.b);

  const updateFromHsl = useCallback((newH: number, newS: number, newL: number) => {
    const newRgb = hslToRgb(newH, newS, newL);
    setCurrentColor(rgbToHex(newRgb.r, newRgb.g, newRgb.b));
  }, [setCurrentColor]);

  const updateFromRgb = useCallback((r: number, g: number, b: number) => {
    setCurrentColor(rgbToHex(r, g, b));
  }, [setCurrentColor]);

  // SV picker refs
  const svRef = useRef<HTMLDivElement>(null);
  const draggingSV = useRef(false);

  const handleSVPointer = useCallback((e: React.PointerEvent) => {
    if (!svRef.current) return;
    const rect = svRef.current.getBoundingClientRect();
    const x = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    const y = Math.max(0, Math.min(1, (e.clientY - rect.top) / rect.height));
    // x = saturation (0-100), y = lightness inverted (0 = 100%, 1 = 0%) but in HSL space it's tricky
    // We'll use HSV-ish: use H and treat picker as Saturation vs Value
    // Convert HSV to HSL: l = v(1 - s/2), s_hsl = (v - l) / min(l, 1-l) if l in (0,1) else 0
    const hue = h;
    const sat = x * 100;
    const val = (1 - y) * 100;
    const l_hsl = val * (1 - sat / 200);
    const s_hsl = l_hsl === 0 || l_hsl === 100 ? 0 : (val - l_hsl) / Math.min(l_hsl, 100 - l_hsl) * 100;
    updateFromHsl(hue, s_hsl, l_hsl);
  }, [h, updateFromHsl]);

  const hueRef = useRef<HTMLDivElement>(null);
  const draggingHue = useRef(false);
  const handleHuePointer = useCallback((e: React.PointerEvent) => {
    if (!hueRef.current) return;
    const rect = hueRef.current.getBoundingClientRect();
    const x = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    updateFromHsl(x * 360, s, l);
  }, [s, l, updateFromHsl]);

  // Compute SV position from current HSL
  // Reverse: HSV from HSL
  const v = l + s * Math.min(l, 100 - l) / 100;
  const s_hsv = v === 0 ? 0 : 200 * (1 - l / v);
  const svX = s_hsv / 100;
  const svY = 1 - v / 100;

  return (
    <div className="flex flex-col h-full editor-surface editor-text">
      <div className="px-3 py-2 border-b editor-border text-xs font-semibold uppercase tracking-wide editor-text-muted">
        Color
      </div>

      <div className="p-3 space-y-3">
        {/* FG / BG swatches */}
        <div className="flex items-center gap-3">
          <div className="relative w-20 h-14">
            <button
              onClick={() => setEditingTarget('fg')}
              className={`absolute top-0 left-0 w-12 h-12 rounded border-2 shadow-md ${editingTarget === 'fg' ? 'border-[var(--editor-accent)]' : 'editor-border'}`}
              style={{ backgroundColor: foreground }}
              title="Foreground"
            />
            <button
              onClick={() => setEditingTarget('bg')}
              className={`absolute bottom-0 right-0 w-12 h-12 rounded border-2 shadow-md ${editingTarget === 'bg' ? 'border-[var(--editor-accent)]' : 'editor-border'}`}
              style={{ backgroundColor: background }}
              title="Background"
            />
          </div>
          <div className="flex flex-col gap-1">
            <button
              onClick={swapColors}
              className="p-1.5 rounded hover:editor-surface-2 editor-text"
              title="Swap colors (X)"
            >
              <ArrowLeftRight size={14} />
            </button>
            <button
              onClick={resetColors}
              className="p-1.5 rounded hover:editor-surface-2 editor-text"
              title="Reset colors (D)"
            >
              <RefreshCw size={14} />
            </button>
          </div>
        </div>

        {/* SV picker */}
        <div
          ref={svRef}
          onPointerDown={(e) => {
            draggingSV.current = true;
            (e.target as HTMLElement).setPointerCapture(e.pointerId);
            handleSVPointer(e);
          }}
          onPointerMove={(e) => draggingSV.current && handleSVPointer(e)}
          onPointerUp={() => { draggingSV.current = false; }}
          className="relative w-full h-32 rounded cursor-crosshair overflow-hidden"
          style={{
            background: `linear-gradient(to top, #000 0%, transparent 100%), linear-gradient(to right, #fff 0%, hsl(${h}, 100%, 50%) 100%)`,
          }}
        >
          <div
            className="absolute w-3 h-3 rounded-full border-2 border-white shadow-md pointer-events-none"
            style={{
              left: `${svX * 100}%`,
              top: `${svY * 100}%`,
              transform: 'translate(-50%, -50%)',
            }}
          />
        </div>

        {/* Hue slider */}
        <div
          ref={hueRef}
          onPointerDown={(e) => {
            draggingHue.current = true;
            (e.target as HTMLElement).setPointerCapture(e.pointerId);
            handleHuePointer(e);
          }}
          onPointerMove={(e) => draggingHue.current && handleHuePointer(e)}
          onPointerUp={() => { draggingHue.current = false; }}
          className="relative w-full h-4 rounded cursor-pointer"
          style={{
            background: 'linear-gradient(to right, #f00 0%, #ff0 17%, #0f0 33%, #0ff 50%, #00f 67%, #f0f 83%, #f00 100%)',
          }}
        >
          <div
            className="absolute w-1.5 h-full bg-white border editor-border shadow pointer-events-none"
            style={{
              left: `${(h / 360) * 100}%`,
              transform: 'translateX(-50%)',
            }}
          />
        </div>

        {/* Hex input */}
        <div className="flex items-center gap-2">
          <span className="text-xs editor-text-muted w-8">Hex</span>
          <input
            type="text"
            value={hexInput}
            onChange={(e) => {
              const v = e.target.value;
              setHexInput(v);
              if (/^#[0-9a-fA-F]{6}$/.test(v)) {
                setCurrentColor(v);
              }
            }}
            onBlur={() => {
              if (!/^#[0-9a-fA-F]{6}$/.test(hexInput)) {
                setHexInput(currentColor);
              }
            }}
            className="flex-1 editor-surface-2 border editor-border rounded px-2 py-1 text-xs font-mono"
          />
          <label className="relative cursor-pointer">
            <Pipette size={14} className="editor-text-muted" />
            <input
              type="color"
              value={currentColor}
              onChange={(e) => setCurrentColor(e.target.value)}
              className="absolute inset-0 opacity-0 cursor-pointer"
            />
          </label>
        </div>

        {/* RGB inputs */}
        <div className="grid grid-cols-3 gap-2">
          {(['r', 'g', 'b'] as const).map((ch) => (
            <div key={ch} className="flex flex-col items-center">
              <span className="text-[10px] editor-text-dim uppercase">{ch}</span>
              <input
                type="number"
                min={0}
                max={255}
                value={Math.round(rgb[ch])}
                onChange={(e) => {
                  const v = Math.max(0, Math.min(255, parseInt(e.target.value) || 0));
                  const newRgb = { ...rgb, [ch]: v };
                  updateFromRgb(newRgb.r, newRgb.g, newRgb.b);
                }}
                className="w-full editor-surface-2 border editor-border rounded px-1 py-0.5 text-xs text-center"
              />
            </div>
          ))}
        </div>
      </div>

      {/* Swatches */}
      <div className="px-3 py-2 border-t editor-border text-xs font-semibold uppercase tracking-wide editor-text-muted">
        Swatches
      </div>
      <div className="p-2 grid grid-cols-5 gap-1 overflow-y-auto custom-scroll">
        {PRESET_SWATCHES.map((c) => (
          <button
            key={c}
            onClick={() => setCurrentColor(c)}
            className="w-full aspect-square rounded border editor-border hover:editor-accent transition-colors"
            style={{ backgroundColor: c }}
            title={c}
          />
        ))}
      </div>
    </div>
  );
}
