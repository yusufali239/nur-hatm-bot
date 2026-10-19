import React from 'react';
import { motion } from 'framer-motion';
import { Check, Sparkles, UserCheck } from 'lucide-react';
import { JuzItem } from '../types';
import { Timer } from './Timer';
import { triggerHaptic } from '../lib/telegram';

interface JuzCardProps {
  juz: JuzItem;
  currentUserId: number;
  isSelected: boolean;
  onToggleSelect: (juzNumber: number) => void;
  onQuickComplete: (juzNumber: number) => void;
  onExpireRefresh?: () => void;
}

/**
 * `JuzCard.tsx` — iOS 26 Liquid Glass Widget
 * - Semi-transparent `backdrop-filter: blur(20px)`, `border: 1px rgba(255,255,255,0.1)`, `border-radius: 16px`
 * - Free (`free`): Frosted slate glass, crisp Juz number inside, multi-select checkmark badge when tapped
 * - Booked (`booked`): Emerald liquid glow + reader name + live countdown pill (`Timer.tsx`). If owned by current user, displays one-tap `[✅ Ўқидим]` button!
 * - Done (`done`): Liquid Gold Glass with `✅` icon and radiant shimmer glow
 * - iOS spring animation (`whileTap={{ scale: 0.95 }}`) + Telegram Haptic Feedback API
 */
export const JuzCard: React.FC<JuzCardProps> = ({
  juz,
  currentUserId,
  isSelected,
  onToggleSelect,
  onQuickComplete,
  onExpireRefresh,
}) => {
  const isMine = juz.user_id === currentUserId;
  const isFree = juz.status === 'free';
  const isBooked = juz.status === 'booked';
  const isDone = juz.status === 'done';

  const handleCardClick = () => {
    if (isFree) {
      triggerHaptic('selection');
      onToggleSelect(juz.number);
    } else if (isBooked && isMine) {
      triggerHaptic('medium');
      onQuickComplete(juz.number);
    } else {
      triggerHaptic('light');
    }
  };

  let glassClass = 'juz-glass-free hover:border-white/25';
  if (isFree && isSelected) {
    glassClass = 'juz-glass-selected';
  } else if (isBooked) {
    glassClass = 'juz-glass-booked';
  } else if (isDone) {
    glassClass = 'juz-glass-done';
  }

  return (
    <motion.div
      layout
      whileTap={{ scale: 0.95 }}
      transition={{ type: 'spring', stiffness: 420, damping: 26 }}
      onClick={handleCardClick}
      role="button"
      tabIndex={0}
      className={`relative overflow-hidden p-3 flex flex-col justify-between min-h-[112px] select-none cursor-pointer transition-colors duration-200 ${glassClass}`}
    >
      {/* Subtle top-left specular highlight like iOS 26 visionOS glass */}
      <div className="pointer-events-none absolute -top-10 -left-10 w-24 h-24 rounded-full bg-white/10 blur-xl" />

      {/* Top Row: Juz Number + Status/Checkbox Badge */}
      <div className="relative z-10 flex items-start justify-between gap-1">
        <div className="flex flex-col">
          <span
            className={`text-xl font-bold leading-none tracking-tight ${
              isDone
                ? 'text-amber-200 drop-shadow-[0_0_8px_rgba(251,191,36,0.5)]'
                : isBooked
                ? 'text-emerald-200'
                : isSelected
                ? 'text-sky-200'
                : 'text-white/90'
            }`}
          >
            {juz.number}
          </span>
          <span className="text-[10px] font-medium uppercase tracking-wider text-white/45 mt-0.5">
            пора
          </span>
        </div>

        {/* Multi-select checkbox or status icon */}
        {isFree && (
          <div
            className={`w-5 h-5 rounded-full flex items-center justify-center transition-all duration-200 ${
              isSelected
                ? 'bg-sky-400 text-slate-950 shadow-[0_0_12px_rgba(56,189,248,0.8)] scale-105'
                : 'bg-white/5 border border-white/20 text-transparent'
            }`}
          >
            <Check className="w-3.5 h-3.5 stroke-[3]" />
          </div>
        )}

        {isBooked && (
          <span
            className={`px-1.5 py-0.5 rounded-full text-[9px] font-semibold tracking-wide uppercase backdrop-blur-md ${
              isMine
                ? 'bg-emerald-400/30 text-emerald-100 border border-emerald-300/50'
                : 'bg-emerald-500/20 text-emerald-200/90 border border-emerald-400/30'
            }`}
          >
            {isMine ? 'Сизда' : 'Банд'}
          </span>
        )}

        {isDone && (
          <div className="w-6 h-6 rounded-full bg-amber-400/25 border border-amber-300/60 flex items-center justify-center shadow-[0_0_15px_rgba(245,196,81,0.65)]">
            <span className="text-xs leading-none">✅</span>
          </div>
        )}
      </div>

      {/* Middle / Bottom Content */}
      <div className="relative z-10 mt-2 flex flex-col gap-1.5">
        {isFree && (
          <div className="flex items-center justify-between">
            <span
              className={`text-[11px] font-medium ${
                isSelected ? 'text-sky-200 font-semibold' : 'text-white/45'
              }`}
            >
              {isSelected ? '✓ Танланди' : 'Бўш • Танлаш'}
            </span>
          </div>
        )}

        {isBooked && (
          <>
            <div className="flex items-center gap-1 text-[11px] text-emerald-100/90 font-medium truncate">
              <UserCheck className="w-3 h-3 text-emerald-300 shrink-0" />
              <span className="truncate">{juz.user_name || 'Муслим'}</span>
            </div>

            <div className="flex items-center justify-between gap-1">
              <Timer
                expiresAt={juz.expires_at}
                compact
                onExpire={onExpireRefresh}
              />
            </div>

            {isMine && (
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  triggerHaptic('success');
                  onQuickComplete(juz.number);
                }}
                className="mt-0.5 w-full py-1 px-2 rounded-lg bg-gradient-to-r from-emerald-400 to-teal-400 text-slate-950 font-bold text-[11px] shadow-[0_0_14px_rgba(16,185,129,0.5)] hover:brightness-110 active:scale-95 transition-all flex items-center justify-center gap-1"
              >
                <span>✅ Ўқидим</span>
                <span className="text-[9px] opacity-80">(+10)</span>
              </button>
            )}
          </>
        )}

        {isDone && (
          <div className="flex flex-col gap-0.5">
            <div className="flex items-center gap-1 text-[11px] font-semibold text-amber-100 truncate">
              <Sparkles className="w-3 h-3 text-amber-300 shrink-0" />
              <span className="truncate">{juz.user_name || 'Муслим'}</span>
            </div>
            <span className="text-[10px] text-amber-200/75 font-medium">
              Ўқилди • Аллоҳ қабул қилсин
            </span>
          </div>
        )}
      </div>
    </motion.div>
  );
};
