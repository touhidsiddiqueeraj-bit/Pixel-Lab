'use client';

import { useEditorStore } from '@/lib/editor-store';
import { perf, detectPerfTier, getPerfSettings, type PerfSettings, type PerfTier } from '@/lib/perf';
import { useEffect, useState } from 'react';
import { Gauge, Zap, Settings2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Slider } from '@/components/ui/slider';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';

export function PerformanceControls() {
  const perfSettings = useEditorStore((s) => s.perfSettings);
  const setPerfSettings = useEditorStore((s) => s.setPerfSettings);
  const [fps, setFps] = useState(0);
  const [tier, setTier] = useState<PerfTier>('medium');
  const [stats, setStats] = useState<Record<string, { avg: number; max: number; count: number }>>({});
  const [cores, setCores] = useState<string>('?');

  // Detect device tier on mount
  useEffect(() => {
    setTier(detectPerfTier());
    setCores(String(navigator.hardwareConcurrency || '?'));
    perf.enable();
  }, []);

  // FPS monitor
  useEffect(() => {
    let raf: number;
    let frames = 0;
    let lastTime = performance.now();
    const tick = () => {
      frames++;
      const now = performance.now();
      if (now - lastTime >= 1000) {
        setFps(frames);
        setStats(perf.getStats());
        frames = 0;
        lastTime = now;
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);

  const applyTier = (t: PerfTier) => {
    setTier(t);
    const settings = getPerfSettings(t);
    setPerfSettings(settings);
  };

  const fpsColor = fps >= 50 ? 'text-green-400' : fps >= 30 ? 'text-yellow-400' : 'text-red-400';

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          className="h-7 px-2 editor-text-muted hover:editor-surface-3 gap-1.5"
          title="Performance settings"
        >
          <Gauge size={14} />
          <span className={`text-xs font-mono ${fpsColor}`}>{fps}</span>
          <span className="text-[10px] editor-text-dim hidden sm:inline">fps</span>
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80 editor-surface editor-border editor-text p-4">
        <div className="space-y-4">
          <div className="flex items-center gap-2">
            <Zap size={14} className="editor-accent" />
            <span className="text-sm font-semibold editor-text">Performance</span>
          </div>

          {/* Device tier */}
          <div className="space-y-2">
            <Label className="text-xs editor-text-muted">Device Performance Tier</Label>
            <div className="grid grid-cols-3 gap-1">
              {(['low', 'medium', 'high'] as PerfTier[]).map((t) => (
                <button
                  key={t}
                  onClick={() => applyTier(t)}
                  className={`px-2 py-1.5 rounded text-xs border transition-colors ${
                    tier === t
                      ? 'editor-accent-bg border-[var(--editor-accent)] text-white'
                      : 'editor-surface-2 editor-border editor-text hover:editor-surface-3'
                  }`}
                >
                  {t.charAt(0).toUpperCase() + t.slice(1)}
                </button>
              ))}
            </div>
            <p className="text-[10px] editor-text-dim">
              Detected: {tier} · {cores} cores
            </p>
          </div>

          {/* Settings */}
          <div className="space-y-3 pt-2 border-t editor-border">
            <div className="flex items-center justify-between">
              <Label className="text-xs editor-text">Real-time Preview</Label>
              <Switch
                checked={perfSettings.realTimePreview}
                onCheckedChange={(v) => setPerfSettings({ realTimePreview: v })}
              />
            </div>
            <div className="flex items-center justify-between">
              <Label className="text-xs editor-text">Offscreen Canvas</Label>
              <Switch
                checked={perfSettings.useOffscreenCanvas}
                onCheckedChange={(v) => setPerfSettings({ useOffscreenCanvas: v })}
              />
            </div>

            <div className="space-y-1">
              <div className="flex items-center justify-between text-xs">
                <Label className="editor-text-muted">Max History States</Label>
                <span className="editor-text">{perfSettings.maxHistoryStates}</span>
              </div>
              <Slider
                value={[perfSettings.maxHistoryStates]}
                min={5}
                max={100}
                step={5}
                onValueChange={(v) => setPerfSettings({ maxHistoryStates: v[0] })}
              />
            </div>

            <div className="space-y-1">
              <div className="flex items-center justify-between text-xs">
                <Label className="editor-text-muted">Thumbnail Size</Label>
                <span className="editor-text">{perfSettings.thumbnailSize}px</span>
              </div>
              <Slider
                value={[perfSettings.thumbnailSize]}
                min={24}
                max={96}
                step={8}
                onValueChange={(v) => setPerfSettings({ thumbnailSize: v[0] })}
              />
            </div>

            <div className="space-y-1">
              <div className="flex items-center justify-between text-xs">
                <Label className="editor-text-muted">History Quality</Label>
                <span className="editor-text">{Math.round(perfSettings.historyImageQuality * 100)}%</span>
              </div>
              <Slider
                value={[perfSettings.historyImageQuality * 100]}
                min={30}
                max={100}
                step={5}
                onValueChange={(v) => setPerfSettings({ historyImageQuality: v[0] / 100 })}
              />
            </div>
          </div>

          {/* Stats */}
          <div className="pt-2 border-t editor-border space-y-1">
            <div className="text-[10px] editor-text-dim uppercase">Operation Times</div>
            {Object.keys(stats).length === 0 ? (
              <div className="text-[10px] editor-text-dim">No operations recorded yet</div>
            ) : (
              Object.entries(stats).slice(0, 5).map(([name, s]) => (
                <div key={name} className="flex justify-between text-[10px] editor-text-muted">
                  <span>{name}</span>
                  <span>{s.avg.toFixed(1)}ms avg, {s.max.toFixed(1)}ms max</span>
                </div>
              ))
            )}
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}
