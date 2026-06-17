'use client';

import { useEffect, useRef, useState } from 'react';
import { useEditorStore } from '@/lib/editor-store';
import { Button } from '@/components/ui/button';
import {
  Crop,
  SlidersHorizontal,
  Brush,
  Type,
  Sparkles,
  Download,
  Check,
  X,
  ChevronRight,
  GraduationCap,
  Image as ImageIcon,
} from 'lucide-react';
import { cn } from '@/lib/utils';

interface TutorialStep {
  title: string;
  instruction: string;
  icon: React.ReactNode;
  hint?: string;
  check: (state: ReturnType<typeof useEditorStore.getState>) => boolean;
}

const STEPS: TutorialStep[] = [
  {
    title: 'Welcome to the Tutorial!',
    instruction: 'A sample landscape photo has been loaded for you. We\'ll walk you through editing it step by step. Click "Next" when you\'re ready to start.',
    icon: <GraduationCap size={24} className="text-sky-400" />,
    hint: 'Take a moment to look at the editor layout — toolbar on the left, canvas in the center, panels on the right.',
    check: () => true, // Always passes - user clicks Next
  },
  {
    title: 'Step 1: Select the Crop Tool',
    instruction: 'The Crop tool lets you remove unwanted edges from your photo. Find the Crop tool in the left toolbar (it looks like cropping corners) and click it. You can also press "C" on your keyboard.',
    icon: <Crop size={24} className="text-amber-400" />,
    hint: 'The Crop tool is in the "Selection" section of the toolbar, near the top.',
    check: (state) => state.activeTool === 'crop',
  },
  {
    title: 'Step 2: Crop the Image',
    instruction: 'Now click and drag on the canvas to select the area you want to keep. Then release the mouse. The image will be cropped to your selection.',
    icon: <Crop size={24} className="text-amber-400" />,
    hint: 'Try cropping out some of the sky or ground to focus on the mountains.',
    check: (state) => {
      // Check if the document dimensions changed (cropped) or if history has a Crop entry
      const lastHist = state.history[state.historyIndex];
      return lastHist?.label === 'Crop';
    },
  },
  {
    title: 'Step 3: Open the Adjust Panel',
    instruction: 'The Adjust panel has filters and color adjustments. Find the "Adjust" tab on the right side panel and click it. If you\'re on mobile, tap the floating button in the bottom-right corner first.',
    icon: <SlidersHorizontal size={24} className="text-purple-400" />,
    hint: 'The panel tabs are: Layers, Adjust, Color, Nav, History. Click "Adjust".',
    check: () => {
      // Check if the Adjust tab is active by looking at the DOM
      const adjustTab = document.querySelector('[role="tab"][data-state="active"]');
      if (adjustTab && adjustTab.textContent?.includes('Adjust')) return true;
      // Also check if any adjustment panel content is visible
      const adjustPanel = document.querySelector('[data-state="active"][role="tabpanel"]');
      return adjustPanel?.textContent?.includes('Brightness') === true;
    },
  },
  {
    title: 'Step 4: Adjust Brightness',
    instruction: 'In the Adjust panel, find the "Brightness" slider. Move it to the right to make the image brighter, or left to darken it. Then click the "Apply" button below it.',
    icon: <SlidersHorizontal size={24} className="text-purple-400" />,
    hint: 'The Apply button is right below the Brightness and Contrast sliders.',
    check: (state) => {
      const lastHist = state.history[state.historyIndex];
      return lastHist?.label === 'Brightness/Contrast';
    },
  },
  {
    title: 'Step 5: Select the Brush Tool',
    instruction: 'Let\'s add some creative touches! Select the Brush tool from the left toolbar. It\'s the paintbrush icon. You can also press "B".',
    icon: <Brush size={24} className="text-sky-400" />,
    hint: 'The Brush tool is in the "Painting" section of the toolbar.',
    check: (state) => state.activeTool === 'brush',
  },
  {
    title: 'Step 6: Draw on the Canvas',
    instruction: 'Click and drag on the canvas to paint with the brush. Try drawing a sun, clouds, or anything you like! The color is set in the Color panel (foreground color).',
    icon: <Brush size={24} className="text-sky-400" />,
    hint: 'You can change the brush size with the [ and ] keys, or use the Size slider in the top options bar.',
    check: (state) => {
      const lastHist = state.history[state.historyIndex];
      return lastHist?.label === 'Brush Stroke';
    },
  },
  {
    title: 'Step 7: Add Text',
    instruction: 'Now let\'s add a title to your image. Select the Text tool (press "T") and click on the canvas where you want the text. Type your text in the prompt that appears.',
    icon: <Type size={24} className="text-green-400" />,
    hint: 'The Text tool is in the "Pen & Vector" section of the toolbar.',
    check: (state) => {
      const lastHist = state.history[state.historyIndex];
      return lastHist?.label === 'Add Text';
    },
  },
  {
    title: 'Step 8: Apply a Filter',
    instruction: 'Let\'s add an artistic filter! Go to the Adjust panel and click "Sepia" in the Quick Filters section. This will give your photo a warm, vintage look.',
    icon: <Sparkles size={24} className="text-orange-400" />,
    hint: 'Scroll down in the Adjust panel to find the "Quick Filters" section with Sepia, Invert, Edge Detect, and more.',
    check: (state) => {
      const lastHist = state.history[state.historyIndex];
      return lastHist?.label === 'Sepia';
    },
  },
  {
    title: 'Step 9: Export Your Work',
    instruction: 'You\'ve edited a photo! Now let\'s save it. Go to File → Export as PNG (or press Ctrl+S). Your edited image will download to your computer.',
    icon: <Download size={24} className="text-emerald-400" />,
    hint: 'The File menu is in the top-left corner of the screen.',
    check: () => false, // Can't detect download programmatically; user clicks "Complete"
  },
  {
    title: '🎉 Tutorial Complete!',
    instruction: 'Congratulations! You\'ve learned the basics of Pixel Lab: cropping, adjusting colors, painting, adding text, applying filters, and exporting. Explore the other 40 tools and features on your own!',
    icon: <Check size={24} className="text-emerald-400" />,
    hint: 'Check out the Vectorize feature, Layer Masks, Symmetry drawing, and more pro tools!',
    check: () => true,
  },
];

export function TutorialPanel() {
  const tutorialActive = useEditorStore((s) => s.tutorialActive);
  const tutorialStep = useEditorStore((s) => s.tutorialStep);
  const setTutorialStep = useEditorStore((s) => s.setTutorialStep);
  const endTutorial = useEditorStore((s) => s.endTutorial);
  const stepCompletedRef = useRef(false);
  const [stepCompleted, setStepCompleted] = useState(false);
  const lastStepRef = useRef(0);

  const currentStep = STEPS[tutorialStep];
  const isLastStep = tutorialStep === STEPS.length - 1;

  // Monitor store for step completion
  useEffect(() => {
    if (!tutorialActive) return;

    // Reset completion flag when step changes
    if (lastStepRef.current !== tutorialStep) {
      stepCompletedRef.current = false;
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setStepCompleted(false);
      lastStepRef.current = tutorialStep;
    }

    // Check if current step is completed
    if (!stepCompletedRef.current && currentStep) {
      const state = useEditorStore.getState();
      if (currentStep.check(state)) {
        stepCompletedRef.current = true; setStepCompleted(true);
        // Auto-advance after a short delay (except for the last step)
        if (!isLastStep) {
          setTimeout(() => {
            setTutorialStep(tutorialStep + 1);
          }, 600);
        }
      }
    }
  });

  // Subscribe to store changes for detection
  useEffect(() => {
    if (!tutorialActive) return;
    const unsub = useEditorStore.subscribe(() => {
      const state = useEditorStore.getState();
      if (currentStep && !stepCompletedRef.current && currentStep.check(state)) {
        stepCompletedRef.current = true; setStepCompleted(true);
        if (!isLastStep) {
          setTimeout(() => setTutorialStep(tutorialStep + 1), 600);
        }
      }
    });
    return unsub;
  }, [tutorialActive, tutorialStep, currentStep, isLastStep, setTutorialStep]);

  if (!tutorialActive || !currentStep) return null;

  const handleNext = () => {
    if (isLastStep) {
      endTutorial();
    } else {
      setTutorialStep(tutorialStep + 1);
    }
  };

  const handleSkip = () => {
    endTutorial();
  };

  const progress = ((tutorialStep + 1) / STEPS.length) * 100;

  return (
    <div className="fixed bottom-4 left-1/2 -translate-x-1/2 z-50 w-[min(440px,calc(100vw-2rem))] editor-surface editor-border editor-text rounded-xl shadow-2xl border overflow-hidden">
      {/* Progress bar */}
      <div className="h-1 bg-zinc-700/50">
        <div
          className="h-full bg-gradient-to-r from-sky-500 to-purple-500 transition-all duration-300"
          style={{ width: `${progress}%` }}
        />
      </div>

      {/* Header */}
      <div className="flex items-center justify-between px-4 pt-3 pb-2">
        <div className="flex items-center gap-2">
          <GraduationCap size={16} className="editor-accent" />
          <span className="text-xs font-semibold editor-text">
            Tutorial {tutorialStep + 1} / {STEPS.length}
          </span>
        </div>
        <button
          onClick={handleSkip}
          className="editor-text-dim hover:editor-text transition-colors"
          title="Exit tutorial"
        >
          <X size={16} />
        </button>
      </div>

      {/* Content */}
      <div className="px-4 pb-3 space-y-2">
        <div className="flex items-start gap-3">
          <div className="shrink-0 mt-0.5">
            {currentStep.icon}
          </div>
          <div className="flex-1 min-w-0">
            <h3 className="text-sm font-bold editor-text mb-1">{currentStep.title}</h3>
            <p className="text-xs editor-text-muted leading-relaxed">{currentStep.instruction}</p>
          </div>
        </div>

        {/* Hint */}
        {currentStep.hint && (
          <div className="flex items-start gap-1.5 text-[11px] editor-text-dim bg-editor-surface-2 rounded-md p-2">
            <span className="shrink-0">💡</span>
            <span>{currentStep.hint}</span>
          </div>
        )}

        {/* Status indicator */}
        <div className="flex items-center gap-2">
          {stepCompleted && !isLastStep && (
            <div className="flex items-center gap-1 text-xs text-emerald-400">
              <Check size={14} />
              <span>Completed! Moving to next step...</span>
            </div>
          )}
        </div>
      </div>

      {/* Footer */}
      <div className="flex items-center justify-between px-4 py-2.5 border-t editor-border bg-editor-surface-2">
        {/* Step dots */}
        <div className="flex gap-1">
          {STEPS.map((_, i) => (
            <div
              key={i}
              className={cn(
                'h-1.5 rounded-full transition-all',
                i === tutorialStep ? 'w-4 bg-sky-500' :
                i < tutorialStep ? 'w-1.5 bg-emerald-500' :
                'w-1.5 bg-zinc-600',
              )}
            />
          ))}
        </div>

        <div className="flex gap-2">
          {tutorialStep > 0 && !isLastStep && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setTutorialStep(tutorialStep - 1)}
              className="h-7 text-xs editor-text-muted hover:editor-surface-3"
            >
              Back
            </Button>
          )}
          {!isLastStep && (
            <Button
              onClick={handleNext}
              size="sm"
              className="h-7 text-xs bg-sky-600 hover:bg-sky-500 text-white gap-1"
            >
              Skip Step <ChevronRight size={14} />
            </Button>
          )}
          {isLastStep && (
            <Button
              onClick={handleNext}
              size="sm"
              className="h-7 text-xs bg-emerald-600 hover:bg-emerald-500 text-white gap-1"
            >
              Finish <Check size={14} />
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
