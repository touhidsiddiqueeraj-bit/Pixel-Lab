'use client';

import { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { useEditorStore } from '@/lib/editor-store';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import {
  Brush,
  Layers,
  MousePointer2,
  Wand2,
  Spline,
  Palette,
  Undo2,
  Download,
  Sparkles,
  ChevronRight,
  ChevronLeft,
  X,
  Smartphone,
  Sun,
  Gauge,
  GraduationCap,
} from 'lucide-react';
import { cn } from '@/lib/utils';

interface OnboardingStep {
  title: string;
  description: string;
  icon: React.ReactNode;
  tips?: string[];
}

const STEPS: OnboardingStep[] = [
  {
    title: 'Welcome to Pixel Lab!',
    description: 'A professional, browser-based image editor with layers, masks, filters, vectorization, and more. Let\'s take a quick tour.',
    icon: <Sparkles size={48} className="text-sky-400" />,
    tips: [
      'No installation needed — everything runs in your browser',
      'Works on desktop and mobile',
      'Auto-detects light/dark mode from your system',
    ],
  },
  {
    title: 'Tools & Shortcuts',
    description: 'The left toolbar has 28 tools across 5 categories. Each tool has a keyboard shortcut shown in its tooltip.',
    icon: <Brush size={48} className="text-sky-400" />,
    tips: [
      'B = Brush, E = Eraser, V = Move, M = Marquee',
      'L = Lasso, W = Magic Wand, S = Clone Stamp',
      'P = Pen, T = Text, U = Shapes, R = Liquify',
      'Press [ or ] to change brush size',
    ],
  },
  {
    title: 'Layers & Non-Destructive Editing',
    description: 'Work non-destructively with layers. Each layer is independent — you can reorder, hide, lock, or mask them without affecting others.',
    icon: <Layers size={48} className="text-sky-400" />,
    tips: [
      'Ctrl+Shift+N = New layer',
      'Use Layer Masks to hide parts without erasing',
      '16 blend modes for creative compositing',
      'Drag layers to reorder',
    ],
  },
  {
    title: 'Selection & Filters',
    description: 'Select areas with Marquee, Lasso, or Magic Wand, then apply filters. Filters only affect the active layer (or selection if active).',
    icon: <Wand2 size={48} className="text-sky-400" />,
    tips: [
      'Ctrl+A = Select All, Ctrl+D = Deselect',
      'Adjust tab: Brightness, Curves, Levels, HDR, and more',
      'Filter menu: Blur, Sharpen, Edge Detect, Emboss',
      'Auto Background Remove and Auto Unblur powered by smart algorithms',
    ],
  },
  {
    title: 'Vectorize & Export',
    description: 'Convert raster images to scalable SVG paths, or export your work in multiple formats.',
    icon: <Spline size={48} className="text-sky-400" />,
    tips: [
      'Vector menu → Vectorize Image (Ctrl+Shift+V)',
      'Export as PNG, JPEG, WebP, or SVG',
      '24 document templates for social media, print, and more',
    ],
  },
  {
    title: 'Pro Tips',
    description: 'Powerful features to enhance your workflow:',
    icon: <Palette size={48} className="text-sky-400" />,
    tips: [
      'Symmetry Mode: Draw mandala patterns (OptionsBar)',
      'Brush Stabilizer: Smoother strokes for drawing tablets',
      'Healing Brush: Remove blemishes (Alt+Click source)',
      'Pen Tool: Bezier curves, Enter to commit',
      'Space+drag to pan, Ctrl+scroll to zoom',
    ],
  },
  {
    title: 'Performance & Themes',
    description: 'Pixel Lab adapts to your device for the best experience.',
    icon: <Gauge size={48} className="text-sky-400" />,
    tips: [
      'Auto-detects device performance tier (Low/Medium/High)',
      'Click the FPS counter to adjust performance settings',
      'Theme toggle in title bar: Light / Dark / System',
      'Mobile: tap hamburger menu and floating panel button',
    ],
  },
];

const ONBOARDING_KEY = 'pixel-lab-onboarding-completed';

export function Onboarding() {
  const [open, setOpen] = useState(false);
  const [step, setStep] = useState(0);

  useEffect(() => {
    // Show onboarding if not completed
    try {
      const completed = localStorage.getItem(ONBOARDING_KEY);
      if (!completed) {
        // Small delay so the app loads first
        const timer = setTimeout(() => setOpen(true), 800);
        return () => clearTimeout(timer);
      }
    } catch {
      // localStorage might not be available
    }
  }, []);

  // Listen for "Show Tour" from menu
  useEffect(() => {
    const handler = () => {
      setStep(0);
      setOpen(true);
    };
    window.addEventListener('reopen-onboarding', handler);
    return () => window.removeEventListener('reopen-onboarding', handler);
  }, []);

  const handleClose = () => {
    setOpen(false);
    try {
      localStorage.setItem(ONBOARDING_KEY, 'true');
    } catch {
      // ignore
    }
  };

  const handleSkip = () => {
    handleClose();
  };

  const handleNext = () => {
    if (step < STEPS.length - 1) {
      setStep(step + 1);
    } else {
      handleClose();
    }
  };

  const handlePrev = () => {
    if (step > 0) setStep(step - 1);
  };

  const current = STEPS[step];
  const isLast = step === STEPS.length - 1;

  return (
    <Dialog open={open} onOpenChange={(v) => !v && handleClose()}>
      <DialogContent className="editor-surface editor-border editor-text max-w-md mx-4 p-0 overflow-hidden">
        {/* Header with gradient */}
        <div className="relative bg-gradient-to-br from-sky-600 to-purple-600 p-6 text-center">
          <button
            onClick={handleSkip}
            className="absolute top-3 right-3 p-1.5 rounded-full text-white/70 hover:text-white hover:bg-white/10 transition-colors"
            title="Skip tour"
          >
            <X size={18} />
          </button>
          <div className="flex justify-center mb-3">
            {current.icon}
          </div>
          <DialogTitle className="text-xl font-bold text-white">{current.title}</DialogTitle>
          {/* Step indicator */}
          <div className="flex justify-center gap-1.5 mt-3">
            {STEPS.map((_, i) => (
              <div
                key={i}
                className={cn(
                  'h-1.5 rounded-full transition-all',
                  i === step ? 'w-6 bg-white' : 'w-1.5 bg-white/40',
                )}
              />
            ))}
          </div>
        </div>

        {/* Body */}
        <div className="p-6 space-y-4">
          <DialogDescription className="editor-text-muted text-sm leading-relaxed">
            {current.description}
          </DialogDescription>

          {current.tips && current.tips.length > 0 && (
            <div className="space-y-2">
              {current.tips.map((tip, i) => (
                <div key={i} className="flex items-start gap-2 text-sm editor-text">
                  <span className="text-sky-400 mt-0.5 shrink-0">•</span>
                  <span>{tip}</span>
                </div>
              ))}
            </div>
          )}

          {/* Navigation */}
          <div className="flex items-center justify-between pt-2 border-t editor-border">
            <Button
              variant="ghost"
              onClick={handlePrev}
              disabled={step === 0}
              className="editor-text-muted hover:editor-surface-3 disabled:opacity-30"
              size="sm"
            >
              <ChevronLeft size={16} className="mr-1" /> Back
            </Button>

            <span className="text-xs editor-text-dim">
              {step + 1} / {STEPS.length}
            </span>

            <div className="flex gap-2">
              <Button
                variant="ghost"
                onClick={handleSkip}
                className="editor-text-muted hover:editor-surface-3 text-xs"
                size="sm"
              >
                Skip tour
              </Button>
              {isLast && (
                <Button
                  variant="ghost"
                  onClick={() => {
                    handleClose();
                    // Start tutorial after onboarding closes
                    setTimeout(() => {
                      useEditorStore.getState().startTutorial();
                    }, 500);
                  }}
                  className="bg-purple-600 hover:bg-purple-500 text-white text-xs"
                  size="sm"
                >
                  <GraduationCap size={14} className="mr-1" /> Try Tutorial
                </Button>
              )}
              <Button
                onClick={handleNext}
                className="bg-sky-600 hover:bg-sky-500 text-white"
                size="sm"
              >
                {isLast ? (
                  <>
                    Start Editing <Sparkles size={14} className="ml-1" />
                  </>
                ) : (
                  <>
                    Next <ChevronRight size={16} className="ml-1" />
                  </>
                )}
              </Button>
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
