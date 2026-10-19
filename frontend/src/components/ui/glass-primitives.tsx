import React from 'react';
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export const GlassCard = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement> & {
    variant?: 'default' | 'free' | 'booked' | 'done' | 'selected';
  }
>(({ className, variant = 'default', ...props }, ref) => {
  const variantClasses = {
    default: 'liquid-glass rounded-3xl',
    free: 'juz-glass-free',
    booked: 'juz-glass-booked',
    done: 'juz-glass-done',
    selected: 'juz-glass-selected',
  }[variant];

  return <div ref={ref} className={cn(variantClasses, className)} {...props} />;
});
GlassCard.displayName = 'GlassCard';

export const GlassBadge: React.FC<
  React.HTMLAttributes<HTMLSpanElement> & {
    tone?: 'gold' | 'emerald' | 'sky' | 'rose' | 'neutral';
  }
> = ({ className, tone = 'neutral', ...props }) => {
  const tones = {
    gold: 'bg-amber-400/20 text-amber-200 border-amber-300/40',
    emerald: 'bg-emerald-400/20 text-emerald-200 border-emerald-300/40',
    sky: 'bg-sky-400/20 text-sky-200 border-sky-300/40',
    rose: 'bg-rose-500/25 text-rose-200 border-rose-400/50',
    neutral: 'bg-white/10 text-white/80 border-white/15',
  }[tone];

  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-semibold border backdrop-blur-xl',
        tones,
        className
      )}
      {...props}
    />
  );
};
