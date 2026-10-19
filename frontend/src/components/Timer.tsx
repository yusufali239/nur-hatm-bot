import React, { useEffect, useRef, useState } from 'react';
import { Clock, AlertTriangle } from 'lucide-react';

interface TimerProps {
  expiresAt: string | null;
  juzNumber?: number;
  compact?: boolean;
  onExpire?: () => void;
}

/**
 * iOS 26 Liquid Glass Countdown Pill (`Timer.tsx`)
 * - Shows live `HH:MM:SS қолди` or `10-пора: 23:41:12 қолди`
 * - Automatically turns glowing crimson red with pulse animation when < 1 hour (< 3600s) remains.
 */
export const Timer: React.FC<TimerProps> = ({
  expiresAt,
  juzNumber,
  compact = false,
  onExpire,
}) => {
  const [remainingSec, setRemainingSec] = useState<number>(() => {
    if (!expiresAt) return 0;
    const diff = Math.floor((new Date(expiresAt).getTime() - Date.now()) / 1000);
    return Math.max(0, diff);
  });

  // Keep the latest callback in a ref so the interval isn't recreated on every render,
  // and make sure onExpire fires once per expiry instead of every second.
  const onExpireRef = useRef(onExpire);
  useEffect(() => {
    onExpireRef.current = onExpire;
  }, [onExpire]);

  useEffect(() => {
    if (!expiresAt) return;
    let fired = false;

    const updateTimer = () => {
      const diff = Math.floor((new Date(expiresAt).getTime() - Date.now()) / 1000);
      if (diff <= 0) {
        setRemainingSec(0);
        if (!fired) {
          fired = true;
          onExpireRef.current?.();
        }
      } else {
        setRemainingSec(diff);
      }
    };

    updateTimer();
    const interval = setInterval(updateTimer, 1000);
    return () => clearInterval(interval);
  }, [expiresAt]);

  if (!expiresAt) return null;

  const hours = Math.floor(remainingSec / 3600);
  const minutes = Math.floor((remainingSec % 3600) / 60);
  const seconds = remainingSec % 60;

  const formattedTime = [
    String(hours).padStart(2, '0'),
    String(minutes).padStart(2, '0'),
    String(seconds).padStart(2, '0'),
  ].join(':');

  const isCritical = remainingSec < 3600; // < 1 hour left

  if (compact) {
    return (
      <div
        className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold tracking-tight backdrop-blur-xl transition-all duration-300 ${
          isCritical
            ? 'bg-rose-500/30 text-rose-200 border border-rose-400/60 shadow-[0_0_12px_rgba(244,63,94,0.5)] animate-pulse'
            : 'bg-black/35 text-emerald-200/95 border border-white/15'
        }`}
      >
        {isCritical ? (
          <AlertTriangle className="w-2.5 h-2.5 text-rose-300 shrink-0" />
        ) : (
          <Clock className="w-2.5 h-2.5 text-emerald-300 shrink-0" />
        )}
        <span className="tabular-nums">{formattedTime}</span>
      </div>
    );
  }

  return (
    <div
      className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-medium backdrop-blur-xl transition-all duration-300 ${
        isCritical
          ? 'bg-rose-500/25 text-rose-100 border border-rose-400/50 shadow-[0_0_18px_rgba(244,63,94,0.45)] animate-pulse'
          : 'bg-white/10 text-emerald-100 border border-white/15 shadow-sm'
      }`}
    >
      {isCritical ? (
        <AlertTriangle className="w-3.5 h-3.5 text-rose-300 shrink-0" />
      ) : (
        <Clock className="w-3.5 h-3.5 text-emerald-300 shrink-0" />
      )}
      <span className="tabular-nums">
        {juzNumber ? `${juzNumber}-пора: ` : ''}
        <strong className="font-semibold">{formattedTime}</strong> қолди
      </span>
    </div>
  );
};
