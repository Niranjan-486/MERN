import React, { useState, useEffect } from 'react';
import { Sun, Moon, Laptop } from 'lucide-react';
import { cn } from '../../lib/cn';

export function ThemeToggle({ className }) {
  const [theme, setTheme] = useState(() => {
    if (typeof window !== 'undefined') {
      return localStorage.getItem('theme') || 'system';
    }
    return 'system';
  });

  const applyTheme = (targetTheme) => {
    const isDark =
      targetTheme === 'dark' ||
      (targetTheme === 'system' &&
        window.matchMedia('(prefers-color-scheme: dark)').matches);

    if (isDark) {
      document.documentElement.classList.add('dark');
    } else {
      document.documentElement.classList.remove('dark');
    }
  };

  useEffect(() => {
    applyTheme(theme);

    const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
    const handleChange = () => {
      const current = localStorage.getItem('theme') || 'system';
      if (current === 'system') {
        applyTheme('system');
      }
    };

    mediaQuery.addEventListener('change', handleChange);
    return () => mediaQuery.removeEventListener('change', handleChange);
  }, [theme]);

  const cycleTheme = () => {
    const modes = ['system', 'light', 'dark'];
    const nextIndex = (modes.indexOf(theme) + 1) % modes.length;
    const next = modes[nextIndex];
    setTheme(next);
    localStorage.setItem('theme', next);
    applyTheme(next);
  };

  const icons = {
    system: Laptop,
    light: Sun,
    dark: Moon,
  };

  const labels = {
    system: 'System theme',
    light: 'Light theme',
    dark: 'Dark theme',
  };

  const IconComponent = icons[theme] || Laptop;

  return (
    <button
      type="button"
      onClick={cycleTheme}
      className={cn(
        'inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-control border border-line ' +
        'text-ink-secondary hover:text-ink hover:bg-line-subtle ' +
        'text-xs font-medium cursor-pointer transition-colors ' +
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-signal',
        className
      )}
      aria-label={`Theme: ${labels[theme]}. Click to change theme.`}
      title={`Theme: ${labels[theme]}`}
    >
      <IconComponent className="w-4 h-4 shrink-0" aria-hidden="true" />
      <span className="capitalize hidden sm:inline">{theme}</span>
    </button>
  );
}
