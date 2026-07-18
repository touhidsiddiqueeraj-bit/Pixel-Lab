'use client';

import { useTheme } from 'next-themes';
import { Sun, Moon, Monitor } from 'lucide-react';
import { useEffect, useState } from 'react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

export function ThemeToggle({ className }: { className?: string }) {
  const { theme, setTheme, resolvedTheme } = useTheme();
  const [mounted, setMounted] = useState(false);

  // Avoid hydration mismatch
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setMounted(true);
  }, []);

  if (!mounted) {
    return <div className={cn('w-9 h-9', className)} />;
  }

  const isDark = resolvedTheme === 'dark';

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className={cn('h-8 w-8 rounded-md', className)}
          title={`Theme: ${theme}`}
        >
          {isDark ? <Moon size={14} /> : <Sun size={14} />}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="editor-surface editor-border editor-text min-w-[140px]">
        <DropdownMenuItem
          onClick={() => setTheme('light')}
          className={cn('cursor-pointer hover:editor-accent-bg hover:text-white flex items-center gap-2', theme === 'light' && 'bg-sky-600/20')}
        >
          <Sun size={14} /> Light
        </DropdownMenuItem>
        <DropdownMenuItem
          onClick={() => setTheme('dark')}
          className={cn('cursor-pointer hover:editor-accent-bg hover:text-white flex items-center gap-2', theme === 'dark' && 'bg-sky-600/20')}
        >
          <Moon size={14} /> Dark
        </DropdownMenuItem>
        <DropdownMenuItem
          onClick={() => setTheme('system')}
          className={cn('cursor-pointer hover:editor-accent-bg hover:text-white flex items-center gap-2', theme === 'system' && 'bg-sky-600/20')}
        >
          <Monitor size={14} /> System
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
