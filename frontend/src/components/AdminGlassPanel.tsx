import React, { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import {
  BellRing,
  Clock,
  PlusCircle,
  RefreshCcw,
  ShieldCheck,
  Sparkles,
  Trash2,
  UserPlus,
} from 'lucide-react';
import { HatmData, UserProfile } from '../types';
import {
  createNewHatmAdmin,
  fetchAdminOverview,
  forceFreeJuzAdmin,
  manageAdminsRequest,
  triggerAdminDua,
  updateHatmSettingsAdmin,
} from '../lib/api';
import { triggerHaptic } from '../lib/telegram';

interface AdminGlassPanelProps {
  currentUser: UserProfile;
  hatm: HatmData;
  onHatmUpdated: (hatm: HatmData) => void;
  onNotify: (msg: string, tone?: 'success' | 'error') => void;
}

/**
 * Liquid Glass Admin Panel:
 * - Manual `[🔔 Хатм Дуа қилиш]` button that the admin can press AT WILL (even if 15/30 done!)
 * - Configure custom timer hours (default 24h)
 * - Open a new Hatm at any time
 * - Force-release any stuck Juz
 * - Multi-Admin management (add/remove admins)
 */
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
  const [timerHours, setTimerHours] = useState<number>(hatm.timer_hours || 24);
  const [hatmTitle, setHatmTitle] = useState<string>(hatm.title);
  const [hatmDedication, setHatmDedication] = useState<string>(hatm.dedication || '');

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
      const res = await updateHatmSettingsAdmin({
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

  const occupiedJuzs = hatm.juzs.filter((j) => j.status !== 'free');

  return (
    <div className="space-y-4 pb-28">
      {/* 1. Voluntary Manual Hatm Dua Card */}
      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        className="juz-glass-done p-5 relative overflow-hidden"
      >
        <div className="flex items-start justify-between gap-3">
          <div>
            <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full bg-amber-400/20 border border-amber-300/40 text-amber-200 text-[10px] font-bold uppercase tracking-wider">
              <Sparkles className="w-3 h-3" />
              Ихтиёрий Хатм Дуа
            </span>
            <h3 className="text-base font-bold text-white mt-1.5">
              Жорий хатм: {hatm.done_count}/30 ўқилди ({hatm.booked_count} банд)
            </h3>
            <p className="text-xs text-amber-100/80 mt-0.5">
              Админ исталган вақтда (ҳатто 15/30 бўлса ҳам) ўз ихтиёри билан Хатм Дуосини эълон қилиши мумкин.
            </p>
          </div>
        </div>

        <textarea
          value={duaMessage}
          onChange={(e) => setDuaMessage(e.target.value)}
          rows={3}
          placeholder="Хатм дуоси матни..."
          className="mt-3 w-full rounded-2xl bg-black/30 border border-white/15 p-3 text-xs text-white placeholder-white/40 focus:outline-none focus:border-amber-300/60"
        />

        <label className="mt-2.5 flex items-center gap-2 text-xs text-amber-100 cursor-pointer select-none">
          <input
            type="checkbox"
            checked={autoOpenNext}
            onChange={(e) => setAutoOpenNext(e.target.checked)}
            className="rounded border-white/30 bg-white/10 text-amber-400 focus:ring-0"
          />
          <span>Дуодан сўнг автоматик янги 30 поралик Хатм очилсин</span>
        </label>

        <motion.button
          whileTap={{ scale: 0.96 }}
          disabled={busy}
          onClick={handleManualDua}
          className="mt-3.5 w-full py-3 px-4 rounded-2xl bg-gradient-to-r from-amber-400 via-yellow-400 to-amber-500 text-slate-950 font-extrabold text-sm shadow-[0_10px_28px_rgba(245,196,81,0.45)] flex items-center justify-center gap-2 disabled:opacity-50"
        >
          <BellRing className="w-4 h-4 stroke-[2.5]" />
          <span>🔔 Хатм Дуа қилиш</span>
        </motion.button>
      </motion.div>

      {/* 2. Hatm Settings & Timer Configuration */}
      <div className="liquid-glass rounded-3xl p-4 space-y-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Clock className="w-4 h-4 text-sky-300" />
            <h4 className="text-sm font-bold text-white">Хатм ва Таймер созламалари</h4>
          </div>
          <button
            type="button"
            onClick={handleCreateNewHatm}
            disabled={busy}
            className="inline-flex items-center gap-1 px-3 py-1 rounded-xl bg-emerald-500/20 border border-emerald-400/40 text-emerald-200 text-xs font-semibold hover:bg-emerald-500/30"
          >
            <PlusCircle className="w-3.5 h-3.5" />
            <span>Янги Хатм очиш</span>
          </button>
        </div>

        <div className="grid grid-cols-1 gap-2.5">
          <div>
            <label className="text-[11px] text-white/60 font-medium">Хатм сарлавҳаси</label>
            <input
              type="text"
              value={hatmTitle}
              onChange={(e) => setHatmTitle(e.target.value)}
              className="mt-1 w-full rounded-xl bg-white/5 border border-white/15 px-3 py-2 text-xs text-white focus:outline-none focus:border-sky-400"
            />
          </div>
          <div>
            <label className="text-[11px] text-white/60 font-medium">Бағишлов (Ният)</label>
            <input
              type="text"
              value={hatmDedication}
              onChange={(e) => setHatmDedication(e.target.value)}
              className="mt-1 w-full rounded-xl bg-white/5 border border-white/15 px-3 py-2 text-xs text-white focus:outline-none focus:border-sky-400"
            />
          </div>
          <div className="flex items-center justify-between gap-3 pt-1">
            <div>
              <div className="text-xs font-semibold text-white">Авто-бўшатиш таймери (соат)</div>
              <div className="text-[10px] text-white/50">Стандарт: 24 соат (-5 балл просрочка)</div>
            </div>
            <input
              type="number"
              min={1}
              max={168}
              value={timerHours}
              onChange={(e) => setTimerHours(Number(e.target.value))}
              className="w-20 rounded-xl bg-white/10 border border-white/20 px-3 py-1.5 text-center text-sm font-bold text-sky-300"
            />
          </div>
        </div>

        <div className="flex items-center gap-2 pt-1">
          <button
            type="button"
            onClick={handleUpdateSettings}
            disabled={busy}
            className="flex-1 py-2.5 rounded-xl bg-white/10 hover:bg-white/15 border border-white/15 text-xs font-bold text-white transition-all"
          >
            💾 Созламаларни сақлаш
          </button>
          <button
            type="button"
            onClick={async () => {
              if (!window.confirm('Ҳақиқатан ҳам ушбу хатмдаги барча пораларни 0 дан бўшатиб, тозаламоқчимисиз?')) return;
              triggerHaptic('warning');
              setBusy(true);
              try {
                const res = await (await import('../lib/api')).resetHatmAdmin({
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
            className="px-3 py-2.5 rounded-xl bg-rose-500/20 hover:bg-rose-500/30 border border-rose-400/30 text-xs font-bold text-rose-200 transition-all flex items-center gap-1 shrink-0"
          >
            <RefreshCcw className="w-3.5 h-3.5" />
            <span>0 дан тозалаш</span>
          </button>
        </div>
      </div>

      {/* 3. Force-Free Occupied Juzs */}
      {occupiedJuzs.length > 0 && (
        <div className="liquid-glass rounded-3xl p-4 space-y-2.5">
          <div className="flex items-center gap-2">
            <RefreshCcw className="w-4 h-4 text-emerald-300" />
            <h4 className="text-sm font-bold text-white">Банд пораларни бошқариш</h4>
          </div>
          <div className="grid grid-cols-2 gap-2 max-h-48 overflow-y-auto pr-1">
            {occupiedJuzs.map((j) => (
              <div
                key={j.number}
                className="rounded-xl bg-white/5 border border-white/10 p-2 flex items-center justify-between gap-2 text-xs"
              >
                <div className="min-w-0">
                  <div className="font-bold text-white">{j.number}-пора</div>
                  <div className="text-[10px] text-white/55 truncate">
                    {j.user_name} ({j.status === 'done' ? '✅' : '⏳'})
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => handleForceFree(j.number)}
                  className="px-2 py-1 rounded-lg bg-rose-500/20 border border-rose-400/30 text-rose-200 text-[10px] font-semibold shrink-0 hover:bg-rose-500/30"
                >
                  Бўшатиш
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* 4. Multi-Admin Management (/admins equivalent in Mini App) */}
      <div className="liquid-glass rounded-3xl p-4 space-y-3">
        <div className="flex items-center gap-2">
          <ShieldCheck className="w-4 h-4 text-amber-300" />
          <h4 className="text-sm font-bold text-white">Мульти-Админлар бошқаруви</h4>
        </div>

        <form onSubmit={handleAddAdmin} className="flex gap-2">
          <input
            type="number"
            placeholder="Telegram ID (мас. 1234567)"
            value={newAdminId}
            onChange={(e) => setNewAdminId(e.target.value)}
            className="flex-1 rounded-xl bg-white/5 border border-white/15 px-3 py-2 text-xs text-white placeholder-white/40 focus:outline-none focus:border-amber-300"
          />
          <input
            type="text"
            placeholder="Исми"
            value={newAdminName}
            onChange={(e) => setNewAdminName(e.target.value)}
            className="w-28 rounded-xl bg-white/5 border border-white/15 px-3 py-2 text-xs text-white placeholder-white/40 focus:outline-none focus:border-amber-300"
          />
          <button
            type="submit"
            disabled={busy}
            className="px-3 py-2 rounded-xl bg-amber-400 text-slate-950 font-bold text-xs flex items-center gap-1 shrink-0"
          >
            <UserPlus className="w-3.5 h-3.5" />
            <span>Қўшиш</span>
          </button>
        </form>

        <div className="space-y-1.5">
          {admins.map((a) => (
            <div
              key={a.id}
              className="rounded-xl bg-white/5 border border-white/10 px-3 py-2 flex items-center justify-between text-xs"
            >
              <div className="flex items-center gap-2">
                <span>{a.is_super_admin ? '👑' : '🛡'}</span>
                <div>
                  <span className="font-semibold text-white">{a.name}</span>
                  <span className="ml-2 text-[10px] text-white/45">ID: {a.id}</span>
                </div>
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
    </div>
  );
};
