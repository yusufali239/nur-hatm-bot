import React, { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  BellRing,
  Clock,
  Edit3,
  PlusCircle,
  RefreshCcw,
  ShieldCheck,
  Sparkles,
  Trash2,
  UserPlus,
  X,
  Check,
} from 'lucide-react';
import { HatmData, JuzItem, UserProfile } from '../types';
import {
  adminDeleteHatm,
  adminSetJuz,
  adminUpdateHatm,
  createNewHatmAdmin,
  fetchAdminOverview,
  forceFreeJuzAdmin,
  manageAdminsRequest,
  resetHatmAdmin,
  triggerAdminDua,
} from '../lib/api';
import { triggerHaptic } from '../lib/telegram';

interface AdminGlassPanelProps {
  currentUser: UserProfile;
  hatm: HatmData;
  onHatmUpdated: (hatm: HatmData) => void;
  onNotify: (msg: string, tone?: 'success' | 'error') => void;
}

export const AdminGlassPanel: React.FC<AdminGlassPanelProps> = ({
  currentUser,
  hatm,
  onHatmUpdated,
  onNotify,
}) => {
  const [admins, setAdmins] = useState<UserProfile[]>([]);
  const [duaMessage, setDuaMessage] = useState<string>(
    hatm.dua_message ||
      '🤲 Аллоҳим! Ушбу ўқилган Қуръони Карим оятларининг нури ва савобини барча иштирокчиларимизга ва ўтган мўмин-мусулмонларга бағишладик! Омин!'
  );
  const [autoOpenNext, setAutoOpenNext] = useState<boolean>(true);
  const [timerHours, setTimerHours] = useState<number>(hatm.timer_hours || 72);
  const [hatmTitle, setHatmTitle] = useState<string>(hatm.title);
  const [hatmDedication, setHatmDedication] = useState<string>(hatm.dedication || '');

  // Juz Editor Modal State
  const [editingJuz, setEditingJuz] = useState<JuzItem | null>(null);
  const [editStatus, setEditStatus] = useState<'free' | 'booked' | 'done'>('free');
  const [editName, setEditName] = useState<string>('');

  const [newAdminId, setNewAdminId] = useState<string>('');
  const [newAdminName, setNewAdminName] = useState<string>('');
  const [busy, setBusy] = useState<boolean>(false);

  useEffect(() => {
    setTimerHours(hatm.timer_hours);
    setHatmTitle(hatm.title);
    setHatmDedication(hatm.dedication || '');
  }, [hatm]);

  useEffect(() => {
    fetchAdminOverview(currentUser.id)
      .then((res) => setAdmins(res.admins))
      .catch(() => {});
  }, [currentUser.id]);

  const handleManualDua = async () => {
    triggerHaptic('heavy');
    setBusy(true);
    try {
      const res = await triggerAdminDua({
        admin_id: currentUser.id,
        hatm_id: hatm.id,
        dua_message: duaMessage,
        StartNewHatmAfterDua: autoOpenNext,
      });
      onHatmUpdated(res.active_hatm);
      onNotify(res.message, 'success');
    } catch (err: any) {
      onNotify(err.message || 'Хатолик юз берди', 'error');
    } finally {
      setBusy(false);
    }
  };

  const handleUpdateSettings = async () => {
    triggerHaptic('medium');
    setBusy(true);
    try {
      const res = await adminUpdateHatm({
        admin_id: currentUser.id,
        hatm_id: hatm.id,
        title: hatmTitle,
        dedication: hatmDedication,
        timer_hours: timerHours,
      });
      onHatmUpdated(res.active_hatm);
      onNotify(res.message, 'success');
    } catch (err: any) {
      onNotify(err.message || 'Хатолик', 'error');
    } finally {
      setBusy(false);
    }
  };

  const handleCreateNewHatm = async () => {
    triggerHaptic('heavy');
    setBusy(true);
    try {
      const res = await createNewHatmAdmin({
        admin_id: currentUser.id,
        timer_hours: timerHours,
      });
      onHatmUpdated(res.active_hatm);
      onNotify(res.message, 'success');
    } catch (err: any) {
      onNotify(err.message || 'Хатолик', 'error');
    } finally {
      setBusy(false);
    }
  };

  const handleDeleteHatm = async () => {
    if (!window.confirm(`Ҳақиқатан ҳам «${hatm.title}»ни бутунлай ўчирмоқчимисиз?`)) return;
    triggerHaptic('warning');
    setBusy(true);
    try {
      const res = await adminDeleteHatm({
        admin_id: currentUser.id,
        hatm_id: hatm.id,
      });
      onHatmUpdated(res.active_hatm);
      onNotify(res.message, 'success');
    } catch (err: any) {
      onNotify(err.message || 'Хатолик', 'error');
    } finally {
      setBusy(false);
    }
  };

  const openJuzEditor = (j: JuzItem) => {
    triggerHaptic('selection');
    setEditingJuz(j);
    setEditStatus(j.status);
    setEditName(j.user_name || '');
  };

  const handleSaveJuzEdit = async () => {
    if (!editingJuz) return;
    triggerHaptic('medium');
    setBusy(true);
    try {
      const res = await adminSetJuz({
        admin_id: currentUser.id,
        hatm_id: hatm.id,
        juz_number: editingJuz.number,
        juz_status: editStatus,
        reader_name: editName.trim() || undefined,
      });
      onHatmUpdated(res.active_hatm);
      setEditingJuz(null);
      onNotify(res.message, 'success');
    } catch (err: any) {
      onNotify(err.message || 'Хатолик', 'error');
    } finally {
      setBusy(false);
    }
  };

  const handleForceFree = async (juzNum: number) => {
    triggerHaptic('warning');
    setBusy(true);
    try {
      const res = await forceFreeJuzAdmin({
        admin_id: currentUser.id,
        hatm_id: hatm.id,
        juz_number: juzNum,
      });
      onHatmUpdated(res.active_hatm);
      onNotify(res.message, 'success');
    } catch (err: any) {
      onNotify(err.message || 'Хатолик', 'error');
    } finally {
      setBusy(false);
    }
  };

  const handleAddAdmin = async (e: React.FormEvent) => {
    e.preventDefault();
    const parsedId = Number(newAdminId.trim());
    if (!parsedId) return;
    triggerHaptic('medium');
    setBusy(true);
    try {
      const res = await manageAdminsRequest('add', {
        admin_id: currentUser.id,
        target_user_id: parsedId,
        target_user_name: newAdminName.trim() || `Admin #${parsedId}`,
      });
      setAdmins(res.admins);
      setNewAdminId('');
      setNewAdminName('');
      onNotify(res.message, 'success');
    } catch (err: any) {
      onNotify(err.message || 'Хатолик', 'error');
    } finally {
      setBusy(false);
    }
  };

  const handleRemoveAdmin = async (targetId: number) => {
    triggerHaptic('warning');
    setBusy(true);
    try {
      const res = await manageAdminsRequest('remove', {
        admin_id: currentUser.id,
        target_user_id: targetId,
      });
      setAdmins(res.admins);
      onNotify(res.message, 'success');
    } catch (err: any) {
      onNotify(err.message || 'Хатолик', 'error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-4 pb-28">
      {/* 1. Хатм Дуоси */}
      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        className="juz-glass-done p-4 relative overflow-hidden"
      >
        <div className="flex items-center justify-between gap-2">
          <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full bg-amber-400/20 border border-amber-300/40 text-amber-200 text-[10px] font-bold">
            <Sparkles className="w-3 h-3" />
            Хатм Дуоси
          </span>
          <span className="text-xs font-bold text-amber-200">
            {hatm.done_count}/30 ўқилди
          </span>
        </div>

        <textarea
          value={duaMessage}
          onChange={(e) => setDuaMessage(e.target.value)}
          rows={2}
          placeholder="Дуо матни..."
          className="mt-2.5 w-full rounded-2xl bg-black/30 border border-white/15 p-2.5 text-xs text-white placeholder-white/40 focus:outline-none focus:border-amber-300/60"
        />

        <label className="mt-2 flex items-center gap-2 text-xs text-amber-100 cursor-pointer select-none">
          <input
            type="checkbox"
            checked={autoOpenNext}
            onChange={(e) => setAutoOpenNext(e.target.checked)}
            className="rounded border-white/30 bg-white/10 text-amber-400 focus:ring-0"
          />
          <span>Кейинги хатмни автоматик очиш</span>
        </label>

        <motion.button
          whileTap={{ scale: 0.96 }}
          disabled={busy}
          onClick={handleManualDua}
          className="mt-3 w-full py-2.5 px-4 rounded-xl bg-gradient-to-r from-amber-400 via-yellow-400 to-amber-500 text-slate-950 font-extrabold text-xs shadow-md flex items-center justify-center gap-2 disabled:opacity-50"
        >
          <BellRing className="w-4 h-4" />
          <span>Хатм Дуо қилиш</span>
        </motion.button>
      </motion.div>

      {/* 2. Созламалар ва Муддат (2-3 кун) */}
      <div className="liquid-glass rounded-3xl p-4 space-y-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Clock className="w-4 h-4 text-sky-300" />
            <h4 className="text-sm font-bold text-white">Созламалар ва Муддат</h4>
          </div>
          <button
            type="button"
            onClick={handleCreateNewHatm}
            disabled={busy}
            className="inline-flex items-center gap-1 px-2.5 py-1 rounded-xl bg-emerald-500/20 border border-emerald-400/40 text-emerald-200 text-xs font-semibold hover:bg-emerald-500/30"
          >
            <PlusCircle className="w-3.5 h-3.5" />
            <span>Янги Хатм</span>
          </button>
        </div>

        <div className="grid grid-cols-1 gap-2">
          <div>
            <label className="text-[10px] text-white/50 font-medium">Сарлавҳа</label>
            <input
              type="text"
              value={hatmTitle}
              onChange={(e) => setHatmTitle(e.target.value)}
              className="mt-0.5 w-full rounded-xl bg-white/5 border border-white/15 px-3 py-1.5 text-xs text-white focus:outline-none focus:border-sky-400"
            />
          </div>
          <div>
            <label className="text-[10px] text-white/50 font-medium">Бағишлов</label>
            <input
              type="text"
              value={hatmDedication}
              onChange={(e) => setHatmDedication(e.target.value)}
              className="mt-0.5 w-full rounded-xl bg-white/5 border border-white/15 px-3 py-1.5 text-xs text-white focus:outline-none focus:border-sky-400"
            />
          </div>

          <div className="pt-1">
            <label className="text-[10px] text-white/50 font-medium">Ўқиш муддати (соат)</label>
            <div className="flex items-center gap-1.5 mt-1">
              {[24, 48, 72, 120].map((h) => (
                <button
                  key={h}
                  type="button"
                  onClick={() => setTimerHours(h)}
                  className={`px-2.5 py-1 rounded-lg text-[11px] font-bold transition-all ${
                    timerHours === h
                      ? 'bg-sky-400 text-slate-950 shadow-sm'
                      : 'bg-white/5 border border-white/10 text-white/70 hover:text-white'
                  }`}
                >
                  {h === 24 ? '1 кун' : h === 48 ? '2 кун' : h === 72 ? '3 кун' : '5 кун'}
                </button>
              ))}
              <input
                type="number"
                min={1}
                max={720}
                value={timerHours}
                onChange={(e) => setTimerHours(Number(e.target.value))}
                className="w-16 rounded-lg bg-white/10 border border-white/20 px-2 py-1 text-center text-xs font-bold text-sky-300 ml-auto"
                title="Ихтиёрий соат"
              />
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2 pt-1">
          <button
            type="button"
            onClick={handleUpdateSettings}
            disabled={busy}
            className="flex-1 py-2 rounded-xl bg-white/10 hover:bg-white/15 border border-white/15 text-xs font-bold text-white transition-all"
          >
            Сақлаш
          </button>
          <button
            type="button"
            onClick={async () => {
              if (!window.confirm('Ушбу хатмдаги барча пораларни 0 дан бўшатмоқчимисиз?')) return;
              triggerHaptic('warning');
              setBusy(true);
              try {
                const res = await resetHatmAdmin({
                  admin_id: currentUser.id,
                  hatm_id: hatm.id,
                });
                onHatmUpdated(res.active_hatm);
                onNotify(res.message, 'success');
              } catch (err: any) {
                onNotify(err.message || 'Хатолик', 'error');
              } finally {
                setBusy(false);
              }
            }}
            disabled={busy}
            className="px-3 py-2 rounded-xl bg-amber-500/15 hover:bg-amber-500/25 border border-amber-400/25 text-xs font-bold text-amber-200 transition-all flex items-center gap-1 shrink-0"
            title="Барча пораларни бўшатиш"
          >
            <RefreshCcw className="w-3.5 h-3.5" />
            <span>Тозалаш</span>
          </button>
          <button
            type="button"
            onClick={handleDeleteHatm}
            disabled={busy}
            className="px-3 py-2 rounded-xl bg-rose-500/20 hover:bg-rose-500/30 border border-rose-400/30 text-xs font-bold text-rose-200 transition-all flex items-center gap-1 shrink-0"
            title="Хатмни ўчириш"
          >
            <Trash2 className="w-3.5 h-3.5" />
            <span>Ўчириш</span>
          </button>
        </div>
      </div>

      {/* 3. 30 та порани тўлиқ назорат қилиш (Қўлда ўзгартириш) */}
      <div className="liquid-glass rounded-3xl p-4 space-y-2.5">
        <div className="flex items-center justify-between">
          <h4 className="text-sm font-bold text-white flex items-center gap-1.5">
            <Edit3 className="w-4 h-4 text-amber-300" />
            <span>30 та пора назорати</span>
          </h4>
          <span className="text-[10px] text-white/50">
            Ўзгартириш учун пора устига босинг
          </span>
        </div>

        <div className="grid grid-cols-3 gap-2 max-h-72 overflow-y-auto pr-1">
          {hatm.juzs.map((j) => {
            const isFree = j.status === 'free';
            const isDone = j.status === 'done';
            return (
              <div
                key={j.number}
                onClick={() => openJuzEditor(j)}
                className={`p-2 rounded-xl border cursor-pointer transition-all active:scale-95 ${
                  isDone
                    ? 'bg-amber-400/15 border-amber-300/35 text-amber-100'
                    : isFree
                    ? 'bg-white/5 border-white/10 text-white/70 hover:bg-white/10'
                    : 'bg-emerald-500/15 border-emerald-400/35 text-emerald-100'
                }`}
              >
                <div className="flex items-center justify-between">
                  <span className="font-extrabold text-xs">{j.number}-пора</span>
                  <span className="text-[9px]">
                    {isDone ? '✅' : isFree ? '⚪' : '⏳'}
                  </span>
                </div>
                <div className="text-[10px] truncate mt-0.5 opacity-80">
                  {isFree ? 'Бўш' : j.user_name || 'Муслим'}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* 4. Мульти-Админлар */}
      <div className="liquid-glass rounded-3xl p-4 space-y-3">
        <div className="flex items-center gap-2">
          <ShieldCheck className="w-4 h-4 text-amber-300" />
          <h4 className="text-sm font-bold text-white">Админлар</h4>
        </div>

        <form onSubmit={handleAddAdmin} className="flex gap-2">
          <input
            type="number"
            placeholder="Telegram ID"
            value={newAdminId}
            onChange={(e) => setNewAdminId(e.target.value)}
            className="flex-1 rounded-xl bg-white/5 border border-white/15 px-3 py-1.5 text-xs text-white placeholder-white/40 focus:outline-none focus:border-amber-300"
          />
          <input
            type="text"
            placeholder="Исми"
            value={newAdminName}
            onChange={(e) => setNewAdminName(e.target.value)}
            className="w-24 rounded-xl bg-white/5 border border-white/15 px-2.5 py-1.5 text-xs text-white placeholder-white/40 focus:outline-none focus:border-amber-300"
          />
          <button
            type="submit"
            disabled={busy}
            className="px-3 py-1.5 rounded-xl bg-amber-400 text-slate-950 font-bold text-xs flex items-center gap-1 shrink-0"
          >
            <UserPlus className="w-3.5 h-3.5" />
            <span>Қўшиш</span>
          </button>
        </form>

        <div className="space-y-1.5">
          {admins.map((a) => (
            <div
              key={a.id}
              className="rounded-xl bg-white/5 border border-white/10 px-3 py-1.5 flex items-center justify-between text-xs"
            >
              <div className="flex items-center gap-2">
                <span>{a.is_super_admin ? '👑' : '🛡'}</span>
                <span className="font-semibold text-white">{a.name}</span>
                <span className="text-[10px] text-white/40">({a.id})</span>
              </div>
              {!a.is_super_admin && (
                <button
                  type="button"
                  onClick={() => handleRemoveAdmin(a.id)}
                  className="p-1 rounded-lg text-rose-300 hover:bg-rose-500/20"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              )}
            </div>
          ))}
        </div>
      </div>

      {/* JUZ EDIT MODAL */}
      <AnimatePresence>
        {editingJuz && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-md">
            <motion.div
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.9 }}
              className="w-full max-w-sm rounded-3xl liquid-glass p-5 space-y-4 border border-white/20 shadow-2xl"
            >
              <div className="flex items-center justify-between">
                <h3 className="text-base font-bold text-white flex items-center gap-2">
                  <Edit3 className="w-4 h-4 text-amber-300" />
                  <span>{editingJuz.number}-порани таҳрирлаш</span>
                </h3>
                <button
                  type="button"
                  onClick={() => setEditingJuz(null)}
                  className="p-1 rounded-xl text-white/60 hover:text-white"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              {/* Status Radio */}
              <div>
                <label className="text-[10px] text-white/50 font-medium">Ҳолат</label>
                <div className="grid grid-cols-3 gap-1.5 mt-1">
                  {(['free', 'booked', 'done'] as const).map((st) => (
                    <button
                      key={st}
                      type="button"
                      onClick={() => setEditStatus(st)}
                      className={`py-1.5 px-2 rounded-xl text-xs font-bold transition-all ${
                        editStatus === st
                          ? st === 'done'
                            ? 'bg-amber-400 text-slate-950 font-black'
                            : st === 'booked'
                            ? 'bg-emerald-400 text-slate-950 font-black'
                            : 'bg-white text-slate-950 font-black'
                          : 'bg-white/5 text-white/60 border border-white/10'
                      }`}
                    >
                      {st === 'free' ? '⚪ Бўш' : st === 'booked' ? '⏳ Банд' : '✅ Ўқилди'}
                    </button>
                  ))}
                </div>
              </div>

              {/* Reader Name */}
              {editStatus !== 'free' && (
                <div>
                  <label className="text-[10px] text-white/50 font-medium">Ўқувчи исми</label>
                  <input
                    type="text"
                    value={editName}
                    onChange={(e) => setEditName(e.target.value)}
                    placeholder="Исм ёзинг..."
                    className="mt-1 w-full rounded-xl bg-white/10 border border-white/20 px-3 py-2 text-xs text-white focus:outline-none focus:border-amber-300"
                  />
                </div>
              )}

              {/* Action Buttons */}
              <div className="flex items-center gap-2 pt-2">
                <button
                  type="button"
                  onClick={handleSaveJuzEdit}
                  disabled={busy}
                  className="flex-1 py-2.5 rounded-xl bg-amber-400 text-slate-950 font-bold text-xs flex items-center justify-center gap-1.5 shadow-md active:scale-95 transition-all"
                >
                  <Check className="w-4 h-4" />
                  <span>Сақлаш</span>
                </button>
                <button
                  type="button"
                  onClick={() => {
                    handleForceFree(editingJuz.number);
                    setEditingJuz(null);
                  }}
                  disabled={busy}
                  className="px-3 py-2.5 rounded-xl bg-rose-500/20 border border-rose-400/30 text-rose-200 text-xs font-bold"
                >
                  Бўшатиш
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
};
