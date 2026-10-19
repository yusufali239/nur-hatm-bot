import React from 'react';
import { motion } from 'framer-motion';
import { Award, BookOpen, Crown, Flame, Sparkles, Trophy } from 'lucide-react';
import { LeaderboardData } from '../types';

interface RatingBoardProps {
  leaderboard: LeaderboardData;
  currentUserId: number;
}

/**
 * `RatingBoard.tsx` — Top-10 "Жаннат боғининг энг фаоллари"
 * Displays user name + total Hatms + completed Juzs + Rating Points
 * with Liquid Gold / Silver / Bronze glass podium cards.
 */
export const RatingBoard: React.FC<RatingBoardProps> = ({
  leaderboard,
  currentUserId,
}) => {
  const { top_users, total_participants, total_completed_juzs, total_completed_hatms } =
    leaderboard;

  const topOne = top_users[0];

  return (
    <div className="space-y-4 pb-28">
      {/* Header Banner */}
      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        className="liquid-glass rounded-3xl p-5 relative overflow-hidden"
      >
        <div className="pointer-events-none absolute -right-10 -top-10 w-40 h-40 rounded-full bg-amber-400/15 blur-3xl" />
        <div className="pointer-events-none absolute -left-10 -bottom-10 w-36 h-36 rounded-full bg-emerald-400/15 blur-3xl" />

        <div className="relative z-10 flex items-center gap-3">
          <div className="w-12 h-12 rounded-2xl juz-glass-done flex items-center justify-center shrink-0">
            <Trophy className="w-6 h-6 text-amber-300" />
          </div>
          <div>
            <div className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full bg-amber-400/15 border border-amber-300/30 text-amber-200 text-[11px] font-semibold mb-1">
              <Sparkles className="w-3 h-3" />
              <span>ТОП-10 ПЕШҚАДАМЛАР</span>
            </div>
            <h2 className="text-lg font-bold tracking-tight text-white">
              Жаннат боғининг энг фаоллари
            </h2>
            <p className="text-xs text-white/60">
              Ўқилган пора учун: <span className="text-emerald-300 font-semibold">+10 балл</span>
            </p>
          </div>
        </div>

        {/* Global Stats Pill Row */}
        <div className="relative z-10 grid grid-cols-3 gap-2.5 mt-4">
          <div className="rounded-2xl bg-white/5 border border-white/10 p-2.5 text-center backdrop-blur-md">
            <div className="text-lg font-extrabold text-amber-300 tabular-nums">
              {total_completed_juzs}
            </div>
            <div className="text-[10px] text-white/55 font-medium">Жами ўқилган пора</div>
          </div>
          <div className="rounded-2xl bg-white/5 border border-white/10 p-2.5 text-center backdrop-blur-md">
            <div className="text-lg font-extrabold text-emerald-300 tabular-nums">
              {total_completed_hatms}
            </div>
            <div className="text-[10px] text-white/55 font-medium">Тугалланган хатм</div>
          </div>
          <div className="rounded-2xl bg-white/5 border border-white/10 p-2.5 text-center backdrop-blur-md">
            <div className="text-lg font-extrabold text-sky-300 tabular-nums">
              {total_participants}
            </div>
            <div className="text-[10px] text-white/55 font-medium">Фаол қорилар</div>
          </div>
        </div>

        {/* Channel Badge Preview */}
        {topOne && (
          <div className="mt-3.5 px-3.5 py-2 rounded-2xl bg-gradient-to-r from-amber-500/20 via-amber-400/10 to-transparent border border-amber-400/30 flex items-center justify-between text-xs">
            <span className="text-amber-100 font-medium flex items-center gap-1.5">
              <span>🏆</span>
              <span>
                Top: <strong className="text-white">{topOne.name}</strong> — {topOne.total_juz} пора
              </span>
            </span>
            <span className="text-[11px] font-bold text-amber-300">
              {topOne.rating_points} балл
            </span>
          </div>
        )}
      </motion.div>

      {/* Top 10 List */}
      <div className="space-y-2.5">
        {top_users.map((u, idx) => {
          const isMe = u.id === currentUserId;
          const isFirst = u.rank === 1;
          const isSecond = u.rank === 2;
          const isThird = u.rank === 3;

          let cardStyle = 'liquid-glass border-white/10';
          if (isFirst) {
            cardStyle = 'juz-glass-done border-amber-300/60';
          } else if (isSecond) {
            cardStyle =
              'liquid-glass border-slate-300/40 bg-gradient-to-r from-slate-200/15 to-white/5';
          } else if (isThird) {
            cardStyle =
              'liquid-glass border-amber-600/45 bg-gradient-to-r from-amber-700/20 to-white/5';
          }

          return (
            <motion.div
              key={u.id}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: idx * 0.04 }}
              className={`rounded-2xl p-3.5 flex items-center justify-between gap-3 transition-all ${cardStyle} ${
                isMe ? 'ring-2 ring-sky-400/70' : ''
              }`}
            >
              <div className="flex items-center gap-3 min-w-0">
                {/* Rank Badge */}
                <div
                  className={`w-10 h-10 rounded-xl flex items-center justify-center font-extrabold text-sm shrink-0 ${
                    isFirst
                      ? 'bg-gradient-to-br from-amber-300 to-amber-500 text-slate-950 shadow-[0_0_16px_rgba(245,196,81,0.6)]'
                      : isSecond
                      ? 'bg-gradient-to-br from-slate-200 to-slate-400 text-slate-950'
                      : isThird
                      ? 'bg-gradient-to-br from-amber-500 to-amber-700 text-white'
                      : 'bg-white/10 text-white/80 border border-white/15'
                  }`}
                >
                  {isFirst ? (
                    <Crown className="w-5 h-5 stroke-[2.5]" />
                  ) : isSecond ? (
                    '🥈'
                  ) : isThird ? (
                    '🥉'
                  ) : (
                    `#${u.rank}`
                  )}
                </div>

                {/* User Details */}
                <div className="min-w-0">
                  <div className="flex items-center gap-1.5">
                    <span className="font-bold text-sm text-white truncate">
                      {u.name}
                    </span>
                    {isMe && (
                      <span className="px-1.5 py-0.5 rounded-md bg-sky-400/25 border border-sky-300/40 text-sky-200 text-[10px] font-semibold">
                        Сиз
                      </span>
                    )}
                  </div>
                  <div className="flex flex-wrap items-center gap-x-2.5 gap-y-0.5 text-[11px] text-white/65 mt-0.5">
                    <span className="inline-flex items-center gap-1 text-emerald-300 font-medium">
                      <BookOpen className="w-3 h-3" />
                      {u.total_juz} пора
                    </span>
                    <span>•</span>
                    <span className="inline-flex items-center gap-1 text-amber-200/90 font-medium">
                      <Award className="w-3 h-3" />
                      {u.total_hatm} хатм
                    </span>
                  </div>
                </div>
              </div>

              {/* Points Pill */}
              <div className="flex flex-col items-end shrink-0">
                <div className="inline-flex items-center gap-1 px-2.5 py-1 rounded-xl bg-white/10 border border-white/15 backdrop-blur-md">
                  <Flame className="w-3.5 h-3.5 text-amber-400" />
                  <span className="text-xs font-extrabold text-white tabular-nums">
                    {u.rating_points}
                  </span>
                  <span className="text-[10px] text-white/60">балл</span>
                </div>
                <span className="text-[10px] text-white/45 mt-1">{u.badge}</span>
              </div>
            </motion.div>
          );
        })}
      </div>
    </div>
  );
};
