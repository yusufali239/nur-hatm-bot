import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import {
  Award,
  BookOpen,
  CheckCircle2,
  Flame,
  Layers,
  RefreshCw,
  Shield,
  Sparkles,
  Trophy,
  XCircle,
} from 'lucide-react';
import { JuzCard } from './components/JuzCard';
import { RatingBoard } from './components/RatingBoard';
import { Timer } from './components/Timer';
import { AdminGlassPanel } from './components/AdminGlassPanel';
import {
  bookSelectedJuzs,
  completeBookedJuzs,
  fetchAppState,
  releaseBookedJuzs,
} from './lib/api';
import {
  getTelegramUserIdentity,
  initTelegramWebApp,
  triggerHaptic,
} from './lib/telegram';
import { FullStateResponse, HatmData, UserProfile } from './types';

type ActiveTab = 'hatm' | 'my' | 'rating' | 'admin';

export const App: React.FC = () => {
  const [identity] = useState(() => getTelegramUserIdentity());
  const [state, setState] = useState<FullStateResponse | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [submitting, setSubmitting] = useState<boolean>(false);

  // Multi-select state: NO LIMIT! Users can select 1, 5, 10, or all 30 free Juzs at once
  const [selectedJuzs, setSelectedJuzs] = useState<number[]>([]);
  const [activeTab, setActiveTab] = useState<ActiveTab>(() => {
    const params = new URLSearchParams(window.location.search);
    return (params.get('tab') as ActiveTab) || 'hatm';
  });
  const [filterMode, setFilterMode] = useState<'all' | 'free' | 'mine'>('all');
  const [toast, setToast] = useState<{ text: string; tone: 'success' | 'error' } | null>(
    null
  );

  const showToast = useCallback((text: string, tone: 'success' | 'error' = 'success') => {
    setToast({ text, tone });
    setTimeout(() => {
      setToast((prev) => (prev?.text === text ? null : prev));
    }, 3800);
  }, []);

  const loadState = useCallback(
    async (silent = false) => {
      if (!silent) setLoading(true);
      try {
        const data = await fetchAppState(
          identity.id,
          identity.name,
          identity.username
        );
        setState(data);
      } catch (err: any) {
        showToast(err.message || 'Сервер билан боғланишда хатолик', 'error');
      } finally {
        if (!silent) setLoading(false);
      }
    },
    [identity, showToast]
  );

  useEffect(() => {
    initTelegramWebApp();
    loadState();
    const poll = setInterval(() => loadState(true), 10000);
    return () => clearInterval(poll);
  }, [loadState]);

  const hatm: HatmData | null = state?.hatm || null;
  const user: UserProfile | null = state?.user || null;

  const freeJuzNumbers = useMemo(
    () => (hatm ? hatm.juzs.filter((j) => j.status === 'free').map((j) => j.number) : []),
    [hatm]
  );

  const myBookedJuzs = useMemo(
    () =>
      hatm
        ? hatm.juzs.filter((j) => j.user_id === identity.id && j.status === 'booked')
        : [],
    [hatm, identity.id]
  );

  const myDoneJuzs = useMemo(
    () =>
      hatm
        ? hatm.juzs.filter((j) => j.user_id === identity.id && j.status === 'done')
        : [],
    [hatm, identity.id]
  );

  const toggleSelectJuz = useCallback((juzNumber: number) => {
    setSelectedJuzs((prev) =>
      prev.includes(juzNumber)
        ? prev.filter((n) => n !== juzNumber)
        : [...prev, juzNumber].sort((a, b) => a - b)
    );
  }, []);

  const handleSelectPreset = (count: number | 'all') => {
    triggerHaptic('selection');
    if (count === 'all') {
      setSelectedJuzs(freeJuzNumbers);
      return;
    }
    setSelectedJuzs(freeJuzNumbers.slice(0, count));
  };

  const handleBookSelected = async () => {
    if (!hatm || selectedJuzs.length === 0 || submitting) return;
    triggerHaptic('heavy');
    setSubmitting(true);
    try {
      const res = await bookSelectedJuzs({
        user_id: identity.id,
        user_name: identity.name,
        username: identity.username,
        hatm_id: hatm.id,
        juz_numbers: selectedJuzs,
      });
      setState((prev) =>
        prev ? { ...prev, hatm: res.hatm, user: res.user } : prev
      );
      setSelectedJuzs([]);
      showToast(res.message, res.success ? 'success' : 'error');
      loadState(true);
    } catch (err: any) {
      showToast(err.message || 'Банд қилишда хатолик', 'error');
    } finally {
      setSubmitting(false);
    }
  };

  const handleCompleteJuzs = async (numbers: number[]) => {
    if (!hatm || numbers.length === 0 || submitting) return;
    const numsStr = numbers.map((n) => `${n}-пора`).join(', ');
    const confirmed = window.confirm(`Ҳақиқатан ҳам ${numsStr}ни тўлиқ ўқиб бўлдингизми?`);
    if (!confirmed) return;

    triggerHaptic('success');
    setSubmitting(true);
    try {
      const res = await completeBookedJuzs({
        user_id: identity.id,
        hatm_id: hatm.id,
        juz_numbers: numbers,
      });
      setState((prev) =>
        prev ? { ...prev, hatm: res.hatm, user: res.user } : prev
      );
      showToast(res.message, 'success');
      loadState(true);
    } catch (err: any) {
      showToast(err.message || 'Хатолик юз берди', 'error');
    } finally {
      setSubmitting(false);
    }
  };

  const handleUncompleteJuzs = async (numbers: number[]) => {
    if (!hatm || numbers.length === 0 || submitting) return;
    const numsStr = numbers.map((n) => `${n}-пора`).join(', ');
    const confirmed = window.confirm(`${numsStr}ни ҳали ўқиб бўлмаган ҳолатга қайтармоқчимисиз?`);
    if (!confirmed) return;

    triggerHaptic('warning');
    setSubmitting(true);
    try {
      const res = await (await import('./lib/api')).uncompleteBookedJuzs({
        user_id: identity.id,
        hatm_id: hatm.id,
        juz_numbers: numbers,
      });
      setState((prev) =>
        prev ? { ...prev, hatm: res.hatm, user: res.user } : prev
      );
      showToast(res.message, 'success');
      loadState(true);
    } catch (err: any) {
      showToast(err.message || 'Хатолик юз берди', 'error');
    } finally {
      setSubmitting(false);
    }
  };

  const handleReleaseJuzs = async (numbers: number[]) => {
    if (!hatm || numbers.length === 0 || submitting) return;
    const numsStr = numbers.map((n) => `${n}-пора`).join(', ');
    const confirmed = window.confirm(`Ҳақиқатан ҳам ${numsStr}ни бошқа ўқувчилар учун бўшатмоқчимисиз?`);
    if (!confirmed) return;

    triggerHaptic('warning');
    setSubmitting(true);
    try {
      const res = await releaseBookedJuzs({
        user_id: identity.id,
        hatm_id: hatm.id,
        juz_numbers: numbers,
      });
      setState((prev) =>
        prev ? { ...prev, hatm: res.hatm, user: res.user } : prev
      );
      showToast(res.message, 'success');
    } catch (err: any) {
      showToast(err.message || 'Хатолик юз берди', 'error');
    } finally {
      setSubmitting(false);
    }
  };

  const displayedJuzs = useMemo(() => {
    if (!hatm) return [];
    if (filterMode === 'free') return hatm.juzs.filter((j) => j.status === 'free');
    if (filterMode === 'mine')
      return hatm.juzs.filter((j) => j.user_id === identity.id);
    return hatm.juzs;
  }, [hatm, filterMode, identity.id]);

  const progressPct = hatm ? Math.round((hatm.done_count / 30) * 100) : 0;

  return (
    <div className="min-h-screen relative overflow-hidden bg-gradient-to-b from-[#0A0A0F] via-[#111324] to-[#1A1A2E] text-white">
      {/* Ambient iOS 26 Liquid Glass Orbs */}
      <div className="pointer-events-none fixed top-[-120px] left-[-80px] w-72 h-72 rounded-full bg-indigo-500/20 blur-[110px]" />
      <div className="pointer-events-none fixed top-[25%] right-[-90px] w-80 h-80 rounded-full bg-emerald-500/15 blur-[120px]" />
      <div className="pointer-events-none fixed bottom-[-100px] left-[20%] w-80 h-80 rounded-full bg-amber-500/15 blur-[120px]" />

      {/* Floating Notification Toast */}
      <AnimatePresence>
        {toast && (
          <motion.div
            initial={{ opacity: 0, y: -30, scale: 0.92 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -20, scale: 0.92 }}
            className="fixed top-3 inset-x-4 z-50 mx-auto max-w-md"
          >
            <div
              className={`rounded-2xl px-4 py-3 backdrop-blur-2xl border shadow-2xl flex items-center gap-2.5 text-xs font-semibold ${
                toast.tone === 'error'
                  ? 'bg-rose-500/30 border-rose-400/50 text-rose-100'
                  : 'bg-emerald-500/30 border-emerald-300/50 text-emerald-50'
              }`}
            >
              <Sparkles className="w-4 h-4 shrink-0 text-amber-300" />
              <span>{toast.text}</span>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Main Container */}
      <div className="relative z-10 max-w-md mx-auto px-3.5 pt-3.5">
        {/* Top User & Rating Bar */}
        <header className="liquid-glass rounded-3xl p-3.5 mb-3.5 flex items-center justify-between gap-2">
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="w-10 h-10 rounded-2xl bg-gradient-to-br from-amber-300/30 to-emerald-400/20 border border-white/20 flex items-center justify-center font-extrabold text-sm text-amber-200 shadow-inner shrink-0">
              🌙
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-1.5">
                <h1 className="text-sm font-extrabold tracking-tight text-white truncate">
                  NUR HATM
                </h1>
                <span className="px-1.5 py-0.5 rounded-full bg-white/10 border border-white/15 text-[9px] font-semibold uppercase tracking-wider text-amber-200">
                  Қуръон Хатми
                </span>
              </div>
              <p className="text-[11px] text-white/60 truncate">
                {user?.name || identity.name} • {user?.total_juz ?? 0} пора ({user?.total_hatm ?? 0} хатм)
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={() => {
                triggerHaptic('selection');
                setActiveTab('rating');
              }}
              className="inline-flex items-center gap-1 px-3 py-1.5 rounded-2xl bg-amber-400/15 border border-amber-300/35 text-amber-200 text-xs font-bold shadow-[0_0_15px_rgba(245,196,81,0.2)]"
            >
              <Flame className="w-3.5 h-3.5 text-amber-300" />
              <span className="tabular-nums">{user?.rating_points ?? 0}</span>
              <span className="text-[10px] opacity-80">балл</span>
            </button>
            <button
              type="button"
              onClick={() => {
                triggerHaptic('light');
                loadState();
              }}
              className="p-2 rounded-2xl bg-white/5 border border-white/10 text-white/70 hover:text-white active:scale-90 transition-all"
              title="Янгилаш"
            >
              <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin text-sky-300' : ''}`} />
            </button>
          </div>
        </header>

        {/* Active My Timers Banner (always visible if user has active booked Juzs!) */}
        {myBookedJuzs.length > 0 && activeTab === 'hatm' && (
          <motion.div
            initial={{ opacity: 0, y: -6 }}
            animate={{ opacity: 1, y: 0 }}
            className="juz-glass-booked p-3.5 mb-3.5 space-y-2.5"
          >
            <div className="flex items-center justify-between gap-2">
              <div className="text-xs font-bold text-emerald-100 flex items-center gap-1.5">
                <span>⏳ Сиз олган поралар ({myBookedJuzs.length} та):</span>
              </div>
              <button
                type="button"
                onClick={() => handleCompleteJuzs(myBookedJuzs.map((j) => j.number))}
                disabled={submitting}
                className="px-3 py-1 rounded-xl bg-gradient-to-r from-emerald-400 to-teal-300 text-slate-950 font-extrabold text-[11px] shadow-[0_0_16px_rgba(16,185,129,0.5)] active:scale-95 transition-all"
              >
                ✅ Барчасини ўқидим (+{myBookedJuzs.length * 10} балл)
              </button>
            </div>

            <div className="flex flex-wrap gap-1.5">
              {myBookedJuzs.map((j) => (
                <Timer
                  key={j.number}
                  juzNumber={j.number}
                  expiresAt={j.expires_at}
                  onExpire={() => loadState(true)}
                />
              ))}
            </div>
          </motion.div>
        )}

        {/* TAB 1: 30 JUZ LIQUID GLASS GRID */}
        {activeTab === 'hatm' && hatm && (
          <div className="space-y-3.5 pb-36">
            {/* Hatm Hero Progress Widget */}
            <div className="liquid-glass rounded-3xl p-4 relative overflow-hidden">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <span className="text-[10px] uppercase tracking-widest text-amber-300/90 font-bold">
                    ЖОРИЙ ХАТМИ ҚУРЪОН • ЛИМИТСИЗ ТАНЛАШ
                  </span>
                  <h2 className="text-base font-extrabold text-white mt-0.5">
                    {hatm.title}
                  </h2>
                  {hatm.dedication && (
                    <p className="text-[11px] text-white/60 mt-0.5 line-clamp-2">
                      «{hatm.dedication}»
                    </p>
                  )}
                </div>
                <div className="text-right shrink-0">
                  <div className="text-xl font-black text-amber-300 tabular-nums">
                    {hatm.done_count}/30
                  </div>
                  <div className="text-[10px] text-white/50 font-medium">
                    {progressPct}% якунланди
                  </div>
                </div>
              </div>

              {/* 30/30 Full Completion Celebration Banner */}
              {hatm.done_count === 30 && (
                <div className="mt-3 p-3 rounded-2xl bg-amber-500/20 border border-amber-300/40 text-amber-100 flex items-center justify-between gap-2 text-xs">
                  <div className="flex items-center gap-2">
                    <span className="text-lg">🎉</span>
                    <div>
                      <span className="font-extrabold text-white">Алҳамдулиллаҳ! 30 та пора тўлиқ ўқилди!</span>
                      <div className="text-[10px] opacity-80">
                        {hatm.dua_done
                          ? 'Ушбу хатм дуоси қилинди. Барча иштирокчиларга ташаккур!'
                          : 'Админ томонидан Хатм Дуоси ўқилиши кутилмоқда...'}
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {/* Liquid Progress Bar */}
              <div className="mt-3 h-2.5 w-full rounded-full bg-white/5 border border-white/10 overflow-hidden p-0.5">
                <motion.div
                  initial={{ width: 0 }}
                  animate={{ width: `${Math.max(progressPct, 4)}%` }}
                  transition={{ duration: 0.6, ease: 'easeOut' }}
                  className="h-full rounded-full bg-gradient-to-r from-emerald-400 via-amber-300 to-amber-500 shadow-[0_0_12px_rgba(245,196,81,0.7)]"
                />
              </div>

              {/* Status Legend + Multi-select Quick Chips */}
              <div className="mt-3 flex flex-wrap items-center justify-between gap-2 pt-2 border-t border-white/10">
                <div className="flex items-center gap-1.5">
                  {(['all', 'free', 'mine'] as const).map((mode) => (
                    <button
                      key={mode}
                      type="button"
                      onClick={() => {
                        triggerHaptic('selection');
                        setFilterMode(mode);
                      }}
                      className={`px-2.5 py-1 rounded-xl text-[11px] font-semibold transition-all ${
                        filterMode === mode
                          ? 'bg-white/20 text-white border border-white/30'
                          : 'bg-white/5 text-white/55 border border-transparent'
                      }`}
                    >
                      {mode === 'all'
                        ? `Барчаси (30)`
                        : mode === 'free'
                        ? `⚪ Бўш (${hatm.free_count})`
                        : `👤 Меники (${myBookedJuzs.length + myDoneJuzs.length})`}
                    </button>
                  ))}
                </div>

                {/* Quick Multi-Select Presets (1, 5, 10, All 30!) */}
                {freeJuzNumbers.length > 0 && (
                  <div className="flex items-center gap-1">
                    <span className="text-[10px] text-white/45 mr-0.5">Тез танлаш:</span>
                    {[1, 5, 10].map(
                      (cnt) =>
                        freeJuzNumbers.length >= cnt && (
                          <button
                            key={cnt}
                            type="button"
                            onClick={() => handleSelectPreset(cnt)}
                            className="px-2 py-0.5 rounded-lg bg-sky-400/15 border border-sky-300/30 text-sky-200 text-[10px] font-bold hover:bg-sky-400/25"
                          >
                            +{cnt}
                          </button>
                        )
                    )}
                    <button
                      type="button"
                      onClick={() => handleSelectPreset('all')}
                      className="px-2 py-0.5 rounded-lg bg-amber-400/15 border border-amber-300/30 text-amber-200 text-[10px] font-bold hover:bg-amber-400/25"
                    >
                      Ҳаммаси ({freeJuzNumbers.length})
                    </button>
                  </div>
                )}
              </div>
            </div>

            {/* 30 Juz Liquid Glass Grid */}
            <div className="grid grid-cols-3 gap-2.5">
              {displayedJuzs.map((juz) => (
                <JuzCard
                  key={juz.number}
                  juz={juz}
                  currentUserId={identity.id}
                  isSelected={selectedJuzs.includes(juz.number)}
                  onToggleSelect={toggleSelectJuz}
                  onQuickComplete={(num) => handleCompleteJuzs([num])}
                  onExpireRefresh={() => loadState(true)}
                />
              ))}
            </div>
          </div>
        )}

        {/* TAB 2: MY JUZS & ACTIVE TIMERS */}
        {activeTab === 'my' && hatm && (
          <div className="space-y-4 pb-28">
            <div className="liquid-glass rounded-3xl p-4 space-y-3">
              <h2 className="text-base font-bold text-white flex items-center gap-2">
                <BookOpen className="w-4 h-4 text-emerald-300" />
                <span>Менинг пораларим ва 24с таймерлар</span>
              </h2>
              <p className="text-xs text-white/60">
                Олинган ҳар бир пора учун {hatm.timer_hours} соат вақт берилади. Ўқиб бўлгач{' '}
                <strong className="text-emerald-300">[✅ Ўқидим]</strong> тугмасини босинг (+10 балл).
              </p>

              {myBookedJuzs.length === 0 ? (
                <div className="rounded-2xl bg-white/5 border border-white/10 p-6 text-center space-y-2">
                  <div className="text-2xl">🌙</div>
                  <div className="text-sm font-bold text-white">
                    Ҳозирда банд қилинган пораларингиз йўқ
                  </div>
                  <p className="text-xs text-white/55">
                    Хатм саҳифасидан исталганча (1, 5, 10 ёки 30 та) порани танлаб олишингиз мумкин.
                  </p>
                  <button
                    type="button"
                    onClick={() => setActiveTab('hatm')}
                    className="mt-2 px-4 py-2 rounded-xl bg-sky-400 text-slate-950 font-bold text-xs"
                  >
                    Пора танлашга ўтиш
                  </button>
                </div>
              ) : (
                <div className="space-y-2.5">
                  {myBookedJuzs.map((j) => (
                    <div
                      key={j.number}
                      className="juz-glass-booked p-3.5 flex flex-col gap-2.5"
                    >
                      <div className="flex items-center justify-between">
                        <span className="text-base font-extrabold text-white">
                          {j.number}-пора
                        </span>
                        <Timer
                          juzNumber={j.number}
                          expiresAt={j.expires_at}
                          onExpire={() => loadState(true)}
                        />
                      </div>
                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          disabled={submitting}
                          onClick={() => handleCompleteJuzs([j.number])}
                          className="flex-1 py-2 rounded-xl bg-gradient-to-r from-emerald-400 to-teal-300 text-slate-950 font-extrabold text-xs flex items-center justify-center gap-1.5 shadow-[0_0_15px_rgba(16,185,129,0.4)]"
                        >
                          <CheckCircle2 className="w-4 h-4" />
                          <span>Ўқидим (+10 балл)</span>
                        </button>
                        <button
                          type="button"
                          disabled={submitting}
                          onClick={() => handleReleaseJuzs([j.number])}
                          className="px-3 py-2 rounded-xl bg-white/10 border border-white/15 text-white/75 text-xs font-semibold flex items-center gap-1 hover:bg-rose-500/20 hover:text-rose-200"
                        >
                          <XCircle className="w-3.5 h-3.5" />
                          <span>Қайтариш</span>
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {myDoneJuzs.length > 0 && (
              <div className="liquid-glass rounded-3xl p-4 space-y-2.5">
                <h3 className="text-sm font-bold text-amber-200 flex items-center gap-1.5">
                  <Award className="w-4 h-4 text-amber-300" />
                  <span>Ушбу хатмда сиз ўқиган поралар ({myDoneJuzs.length} та)</span>
                </h3>
                <div className="flex flex-wrap gap-2">
                  {myDoneJuzs.map((j) => (
                    <div
                      key={j.number}
                      className="px-3 py-1.5 rounded-xl juz-glass-done text-xs font-bold text-amber-100 flex items-center gap-2"
                    >
                      <span>✅ {j.number}-пора</span>
                      <button
                        type="button"
                        onClick={() => handleUncompleteJuzs([j.number])}
                        className="text-[10px] text-amber-300/80 hover:text-white underline"
                        title="Агар хато босган бўлсангиз, орқага қайтариш"
                      >
                        (қайтариш)
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {/* TAB 3: TOP-10 LEADERBOARD */}
        {activeTab === 'rating' && state?.leaderboard && (
          <RatingBoard
            leaderboard={state.leaderboard}
            currentUserId={identity.id}
          />
        )}

        {/* TAB 4: LIQUID GLASS ADMIN PANEL */}
        {activeTab === 'admin' && hatm && user && (
          <AdminGlassPanel
            currentUser={user}
            hatm={hatm}
            onHatmUpdated={(updated) =>
              setState((prev) => (prev ? { ...prev, hatm: updated } : prev))
            }
            onNotify={showToast}
          />
        )}
      </div>

      {/* FLOATING MULTI-SELECT BOOKING DOCK (Shows when 1..30 free Juzs are checked) */}
      <AnimatePresence>
        {selectedJuzs.length > 0 && activeTab === 'hatm' && (
          <motion.div
            initial={{ opacity: 0, y: 80 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 80 }}
            className="fixed bottom-20 inset-x-3.5 z-40 max-w-md mx-auto"
          >
            <div className="juz-glass-selected p-3.5 backdrop-blur-2xl flex items-center justify-between gap-3">
              <div className="min-w-0">
                <div className="text-xs font-extrabold text-white">
                  Танланди: {selectedJuzs.length} та пора (лимитсиз)
                </div>
                <div className="text-[10px] text-sky-100/80 truncate">
                  {selectedJuzs.map((n) => `${n}-пора`).join(', ')}
                </div>
              </div>

              <div className="flex items-center gap-2 shrink-0">
                <button
                  type="button"
                  onClick={() => {
                    triggerHaptic('light');
                    setSelectedJuzs([]);
                  }}
                  className="px-2.5 py-2 rounded-xl bg-white/10 text-white/80 text-xs font-semibold"
                >
                  Тозалаш
                </button>
                <motion.button
                  whileTap={{ scale: 0.95 }}
                  disabled={submitting}
                  onClick={handleBookSelected}
                  className="px-4 py-2 rounded-xl bg-gradient-to-r from-sky-400 via-cyan-300 to-emerald-300 text-slate-950 font-black text-xs shadow-[0_0_20px_rgba(56,189,248,0.6)]"
                >
                  {submitting ? 'Юкланмоқда...' : `Банд қилиш (${selectedJuzs.length})`}
                </motion.button>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* BOTTOM TAB BAR */}
      <nav className="fixed bottom-3 inset-x-3.5 z-40 max-w-md mx-auto">
        {(() => {
          const tabs = [
            { id: 'hatm', label: '30 Пора', icon: Layers },
            {
              id: 'my',
              label: `Меники (${myBookedJuzs.length})`,
              icon: BookOpen,
            },
            { id: 'rating', label: 'Топ-10', icon: Trophy },
            ...(user?.is_admin
              ? [{ id: 'admin', label: 'Админ & Дуа', icon: Shield }]
              : []),
          ];

          return (
            <div
              className="liquid-glass rounded-3xl p-1.5 grid gap-1 backdrop-blur-2xl"
              style={{ gridTemplateColumns: `repeat(${tabs.length}, minmax(0, 1fr))` }}
            >
              {tabs.map((tab) => {
                const Icon = tab.icon;
                const active = activeTab === tab.id;
                return (
                  <button
                    key={tab.id}
                    type="button"
                    onClick={() => {
                      triggerHaptic('selection');
                      setActiveTab(tab.id as ActiveTab);
                    }}
                    className={`py-2 px-2 rounded-2xl flex flex-col items-center justify-center gap-0.5 transition-all ${
                      active
                        ? 'bg-white/15 text-white shadow-inner border border-white/20'
                        : 'text-white/55 hover:text-white/80'
                    }`}
                  >
                    <Icon
                      className={`w-4 h-4 ${
                        active ? 'text-amber-300' : 'text-white/55'
                      }`}
                    />
                    <span className="text-[10px] font-bold tracking-tight">
                      {tab.label}
                    </span>
                  </button>
                );
              })}
            </div>
          );
        })()}
      </nav>
    </div>
  );
};

export default App;
