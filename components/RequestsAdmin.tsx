import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Inbox, CalendarDays, Plane, RefreshCw, Loader2, Check, X, Plus, Trash2, Lock, AlertCircle, ChevronDown } from 'lucide-react';
import type { Branch, StaffRequest } from '../types';
import PlanReport from './PlanReport';
import { refreshDesktopNotifier } from './desktopNotify';
import {
  postRequestAction, todayIso, lastDayOfMonth, formatDay, formatShort, formatMonth, daysBetween,
  STATUS_META, asPlan, asLeave, dayCount
} from './requestsApi';

/**
 * طلبات الموظفين للمدير: المسؤول يرى الجميع، وحساب التقارير يرى موظفيه فقط
 * (الخادم هو من يصفّي ويتحقق من الصلاحية — لا يُعتمد على الواجهة).
 *
 * الموافقة مع تعديل: يغيّر المدير فرع يوم أو يضيف أو يحذف أياماً قادمة،
 * أو يعدّل تواريخ الإجازة، ثم يوافق؛ فيظهر للموظف «موافقة مع تعديل».
 */

interface Props {
  syncUrl: string;
  /** جلسة المدير/المشرف الموقّعة */
  approverToken: string;
  branches: Branch[];
  onPendingCount?: (n: number) => void;
  /** يُستدعى بعد كل قرار — لوحة الإدارة تحدّث به بياناتها */
  onChanged?: () => void;
  logAction?: (action: string, details?: string) => void;
}

const field = 'w-full min-h-[44px] px-3 rounded-xl border border-slate-600 bg-slate-900 text-white text-sm font-bold outline-none focus:border-blue-500';

const StatusChip: React.FC<{ r: StaffRequest }> = ({ r }) => (
  <span className={STATUS_META[r.status]?.chip || 'ut-chip'} style={{ height: 26, fontSize: 12 }}>{STATUS_META[r.status]?.label || r.status}</span>
);

export default function RequestsAdmin({ syncUrl, approverToken, branches, onPendingCount, onChanged, logAction }: Props) {
  const [requests, setRequests] = useState<StaffRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [statusFilter, setStatusFilter] = useState<'pending' | 'all'>('pending');
  const [typeFilter, setTypeFilter] = useState<'all' | 'plan' | 'leave'>('all');
  const [openId, setOpenId] = useState<string | null>(null);
  const [view, setView] = useState<'requests' | 'report'>('requests');

  const load = useCallback(async () => {
    setLoading(true); setError('');
    const res = await postRequestAction(syncUrl, { action: 'getApproverRequests', approverToken });
    setLoading(false);
    if (!res.ok) { setError(res.error || 'تعذّر تحميل الطلبات'); return; }
    setRequests(res.requests || []);
  }, [syncUrl, approverToken]);

  useEffect(() => { load(); }, [load]);

  const pendingCount = requests.filter(r => r.status === 'pending').length;
  useEffect(() => { onPendingCount?.(pendingCount); }, [pendingCount, onPendingCount]);
  // تطبيق ويندوز: تحديث العلامة الحمراء فور تغيّر عدد المعلّق (بعد موافقة أو رفض)
  useEffect(() => { refreshDesktopNotifier(); }, [pendingCount]);

  const visible = requests.filter(r =>
    (statusFilter === 'all' || r.status === 'pending') && (typeFilter === 'all' || r.type === typeFilter));

  const replace = (updated: StaffRequest) => setRequests(prev => prev.map(r => (r.id === updated.id ? updated : r)));

  return (
    <div className="space-y-4 text-white">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3 bg-slate-900/50 p-3 md:p-4 rounded-2xl border border-slate-700">
        <div className="flex items-center gap-2.5">
          <Inbox size={18} className="text-blue-400 shrink-0" />
          <h3 className="text-sm font-black">طلبات الموظفين</h3>
          {pendingCount > 0 && <span className="ut-chip ut-chip--warn" style={{ height: 24 }}>{pendingCount} معلّق</span>}
        </div>
        <button type="button" onClick={load} disabled={loading} className="ut-btn ut-btn--glass" style={{ minHeight: 40 }}>
          <RefreshCw size={14} className={loading ? 'animate-spin' : ''} /> تحديث
        </button>
      </div>

      <div className="grid grid-cols-2 gap-2 bg-slate-900/50 p-1.5 rounded-2xl border border-slate-700">
        {([['requests', 'الطلبات'], ['report', 'تقرير الخطط']] as const).map(([k, l]) => (
          <button key={k} type="button" onClick={() => setView(k)}
            className={`min-h-[42px] rounded-xl text-sm font-black ${view === k ? 'bg-blue-600 text-white' : 'text-slate-300'}`}>{l}</button>
        ))}
      </div>

      {view === 'report' ? (
        <PlanReport syncUrl={syncUrl} approverToken={approverToken} />
      ) : (<>
      <div className="flex flex-wrap gap-2">
        {([['pending', 'المعلّقة'], ['all', 'الكل']] as const).map(([k, l]) => (
          <button key={k} type="button" onClick={() => setStatusFilter(k)}
            className={`min-h-[40px] px-4 rounded-xl text-sm font-bold border ${statusFilter === k ? 'bg-blue-600 border-blue-500' : 'bg-slate-900 border-slate-700 text-slate-300'}`}>{l}</button>
        ))}
        <span className="w-px bg-slate-700 mx-1" />
        {([['all', 'كل الأنواع'], ['plan', 'الخطط'], ['leave', 'الإجازات']] as const).map(([k, l]) => (
          <button key={k} type="button" onClick={() => setTypeFilter(k)}
            className={`min-h-[40px] px-4 rounded-xl text-sm font-bold border ${typeFilter === k ? 'bg-slate-600 border-slate-500' : 'bg-slate-900 border-slate-700 text-slate-300'}`}>{l}</button>
        ))}
      </div>

      {error && (
        <div className="p-4 rounded-2xl text-sm font-bold border bg-red-900/20 text-red-400 border-red-800/50 flex items-center gap-3">
          <AlertCircle size={18} className="shrink-0" /> {error}
        </div>
      )}

      {loading && requests.length === 0 ? (
        <div className="py-12 flex flex-col items-center gap-3 text-slate-400">
          <Loader2 className="animate-spin text-blue-400" size={26} /> <span className="text-sm font-bold">جارٍ تحميل الطلبات…</span>
        </div>
      ) : visible.length === 0 ? (
        <div className="py-12 text-center text-sm text-slate-400 font-bold">
          {statusFilter === 'pending' ? 'لا توجد طلبات بانتظار الموافقة' : 'لا توجد طلبات'}
        </div>
      ) : (
        <div className="space-y-3">
          {visible.map(r => (
            <RequestCard key={r.id} r={r} open={openId === r.id} onToggle={() => setOpenId(openId === r.id ? null : r.id)}
              branches={branches} syncUrl={syncUrl} approverToken={approverToken}
              onDecided={u => { replace(u); setOpenId(null); }} onStale={load} onChanged={onChanged} logAction={logAction} />
          ))}
        </div>
      )}
      </>)}
    </div>
  );
}

/* ====================== بطاقة طلب ====================== */

interface CardProps {
  r: StaffRequest; open: boolean; onToggle: () => void; branches: Branch[];
  syncUrl: string; approverToken: string;
  onDecided: (r: StaffRequest) => void; onStale: () => void; onChanged?: () => void;
  logAction?: (action: string, details?: string) => void;
}

interface Row { key: string; date: string; branchId: string; reason?: string }
let seq = 0;

const RequestCard: React.FC<CardProps> = ({ r, open, onToggle, branches, syncUrl, approverToken, onDecided, onStale, onChanged, logAction }) => {
  const today = todayIso();
  // الطلب المقرَّر سابقاً يُفتح على آخر ما اعتمده المدير، لا على ما أرسله الموظف
  const decided = r.status === 'approved' || r.status === 'modified';
  const sentPlan = r.type === 'plan' ? asPlan(r.items) : [];
  const sentLeave = r.type === 'leave' ? asLeave(r.items) : null;
  const plan = r.type === 'plan' ? asPlan(decided ? r.approvedItems : r.items) : [];
  const leave = r.type === 'leave' ? asLeave(decided ? r.approvedItems : r.items) : null;

  const initialRows = (): Row[] => plan.filter(d => d.date >= today).map(d => ({ key: `a${++seq}`, date: d.date, branchId: d.branchId, reason: d.reason || '' }));
  const isOutDoor = (id: string) => (branches.find(b => b.id === id)?.name || '').trim().toLowerCase() === 'out door';
  const [rows, setRows] = useState<Row[]>(initialRows);
  const [lvFrom, setLvFrom] = useState(leave?.from || '');
  const [lvTo, setLvTo] = useState(leave?.to || '');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState<'' | 'approve' | 'reject'>('');
  const [err, setErr] = useState('');

  useEffect(() => { setRows(initialRows()); setLvFrom(leave?.from || ''); setLvTo(leave?.to || ''); setNote(''); setErr(''); }, [r.submittedAt, r.decidedAt, r.status]); // eslint-disable-line react-hooks/exhaustive-deps

  const pastDays = plan.filter(d => d.date < today);

  // تعديل من الموظف على خطة معتمدة: مقارنة ما أرسله الآن بالمعتمد، يوماً بيوم (من اليوم فصاعداً)
  const planDiff = useMemo(() => {
    if (r.type !== 'plan' || r.status !== 'pending' || !r.approvedItems) return null;
    const before: Record<string, { branchId: string; branchName?: string; reason?: string }> = {};
    asPlan(r.approvedItems).forEach(d => { if (d.date >= today) before[d.date] = d; });
    const after: Record<string, boolean> = {};
    const changed: Record<string, string> = {};
    const added: Record<string, boolean> = {};
    sentPlan.forEach(d => {
      if (d.date < today) return;
      after[d.date] = true;
      const b = before[d.date];
      if (!b) added[d.date] = true;
      else if (b.branchId !== d.branchId || (b.reason || '') !== (d.reason || '')) {
        changed[d.date] = (b.branchName || b.branchId) + (b.reason ? ` («${b.reason}»)` : '');
      }
    });
    const removed = Object.keys(before).filter(d => !after[d]).sort().map(d => ({ date: d, ...before[d] }));
    return { changed, added, removed, count: Object.keys(changed).length + Object.keys(added).length + removed.length };
  }, [r]); // eslint-disable-line react-hooks/exhaustive-deps
  // «موافقة بالتعديل» حين يختلف ما على الشاشة عمّا أرسله الموظف
  const edited = useMemo(() => {
    if (r.type === 'plan') {
      const a = JSON.stringify(sentPlan.filter(d => d.date >= today).map(d => [d.date, d.branchId, d.reason || '']));
      const b = JSON.stringify(rows.filter(x => x.branchId).map(x => [x.date, x.branchId, isOutDoor(x.branchId) ? (x.reason || '').trim() : '']).sort());
      return a !== b;
    }
    return !!sentLeave && (lvFrom !== sentLeave.from || lvTo !== sentLeave.to);
  }, [rows, lvFrom, lvTo, r]); // eslint-disable-line react-hooks/exhaustive-deps

  const decide = async (decision: 'approve' | 'reject') => {
    setErr('');
    const payload: Record<string, any> = {
      action: 'decideRequest', approverToken, requestId: r.id, decision, note: note.trim(), submittedAt: r.submittedAt
    };
    if (decision === 'approve' && r.type === 'plan') {
      const dates = rows.map(x => x.date);
      if (rows.some(x => !x.date || !x.branchId)) return setErr('أكمل التاريخ والفرع لكل يوم، أو احذف السطر.');
      if (rows.some(x => x.date < today)) return setErr('لا يمكن إضافة يوم منقضٍ.');
      if (dates.some((d, i) => dates.indexOf(d) !== i)) return setErr('يوجد يوم مكرّر.');
      payload.items = rows.map(x => ({ date: x.date, branchId: x.branchId, reason: isOutDoor(x.branchId) ? (x.reason || '').trim() : undefined }));
    }
    if (decision === 'approve' && r.type === 'leave') {
      if (!lvFrom || !lvTo || lvTo < lvFrom) return setErr('تواريخ الإجازة غير صحيحة.');
      payload.leave = { from: lvFrom, to: lvTo };
    }
    setBusy(decision);
    const res = await postRequestAction(syncUrl, payload);
    setBusy('');
    if (!res.ok || !res.request) {
      setErr(res.error || 'تعذّر حفظ القرار');
      if ((res.error || '').includes('عدّل الموظف')) onStale();
      return;
    }
    logAction?.(decision === 'reject' ? 'رفض طلب' : edited ? 'موافقة مع تعديل على طلب' : 'موافقة على طلب',
      `${r.userName} | ${r.type === 'plan' ? 'خطة ' + r.month : 'إجازة'}`);
    onDecided(res.request);
    onChanged?.();
  };

  const monthEnd = r.type === 'plan' ? lastDayOfMonth(r.month) : '';
  const monthStart = r.type === 'plan' ? (r.month + '-01' > today ? r.month + '-01' : today) : today;

  return (
    <div className={`rounded-2xl border ${open ? 'border-blue-500/60 bg-slate-900' : 'border-slate-700 bg-slate-900/60'}`}>
      <button type="button" onClick={onToggle} className="w-full text-right p-4 flex items-center justify-between gap-3">
        <div className="min-w-0">
          <div className="font-black text-sm flex items-center gap-2 flex-wrap">
            {r.type === 'plan' ? <CalendarDays size={16} className="text-blue-400" /> : <Plane size={16} className="text-amber-400" />}
            {r.userName}
            <span className="text-xs text-slate-500 font-bold">{[r.serialNumber, r.jobTitle, (r as StaffRequest & { defaultBranch?: string }).defaultBranch].filter(Boolean).join(' · ')}</span>
          </div>
          <div className="text-xs text-slate-400 mt-1.5">
            {r.type === 'plan'
              ? `خطة ${formatMonth(r.month)} · ${dayCount(plan.length)}`
              : leave ? `إجازة ${leave.leaveType} · ${formatShort(leave.from)}${leave.to !== leave.from ? ' ← ' + formatShort(leave.to) : ''} · ${dayCount(daysBetween(leave.from, leave.to))}` : ''}
            {' · أُرسل '}{formatShort((r.submittedAt || '').slice(0, 10))}
          </div>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <StatusChip r={r} />
          <ChevronDown size={18} className={`text-slate-400 transition-transform ${open ? 'rotate-180' : ''}`} />
        </div>
      </button>

      {open && (
        <div className="px-4 pb-4 space-y-3 border-t border-slate-700/60 pt-3">
          {r.status === 'pending' && r.approvedItems && (
            <div className="text-xs text-slate-400">هذا تعديل من الموظف على طلب معتمد سابقاً — المعتمد يبقى سارياً حتى تقرّر.</div>
          )}
          {decided && (
            <div className="text-xs text-slate-400">الرفض الآن يلغي الموافقة السابقة وتُحذف أيامها من شاشة الموظف والتقارير.</div>
          )}
          {r.decidedAt && r.status !== 'pending' && (
            <div className="text-xs text-slate-400">القرار: {STATUS_META[r.status]?.label} — {r.decidedBy}{r.managerNote ? ` · «${r.managerNote}»` : ''}</div>
          )}

          {r.type === 'plan' && (
            <>
              {pastDays.length > 0 && (
                <div className="space-y-1.5">
                  {pastDays.map(d => (
                    <div key={d.date} className="flex justify-between items-center px-3 min-h-[38px] rounded-xl bg-slate-800/60 text-xs text-slate-500">
                      <span className="flex items-center gap-1.5"><Lock size={12} /> {formatDay(d.date)}</span><span>{d.branchName}{d.reason ? ` — ${d.reason}` : ''}</span>
                    </div>
                  ))}
                </div>
              )}
              {planDiff && (
                <div className="p-3 rounded-xl bg-slate-800/70 border border-slate-700 space-y-2">
                  <div className="text-xs font-black text-white">
                    {planDiff.count === 0 ? 'أعاد الموظف الإرسال بلا تغيير عن الخطة المعتمدة.' : `التغييرات عن الخطة المعتمدة: ${planDiff.count}`}
                  </div>
                  {planDiff.count > 0 && (
                    <div className="flex flex-wrap gap-3 text-[11px] font-bold text-slate-300">
                      <span className="flex items-center gap-1.5"><span className="w-3 h-3 rounded-sm border-2 border-amber-400" /> فرع تغيّر</span>
                      <span className="flex items-center gap-1.5"><span className="w-3 h-3 rounded-sm border-2 border-emerald-400" /> يوم جديد</span>
                      <span className="flex items-center gap-1.5"><span className="w-3 h-3 rounded-sm border-2 border-red-400" /> يوم محذوف</span>
                    </div>
                  )}
                  {planDiff.removed.map(d => (
                    <div key={d.date} className="flex justify-between items-center px-3 min-h-[36px] rounded-lg border border-red-500/60 bg-red-500/5 text-xs text-red-300">
                      <span className="line-through">{formatDay(d.date)}</span>
                      <span><span className="line-through">{d.branchName || d.branchId}</span> · محذوف</span>
                    </div>
                  ))}
                </div>
              )}
              <div className="space-y-2">
                {rows.map(x => {
                  const mark = planDiff ? (planDiff.changed[x.date] !== undefined ? 'changed' : planDiff.added[x.date] ? 'added' : '') : '';
                  return (
                  <div key={x.key} className={`grid grid-cols-1 sm:grid-cols-[1fr_1fr_auto] gap-2 items-center ${mark ? 'p-2 rounded-xl border-2 ' + (mark === 'changed' ? 'border-amber-400/80 bg-amber-500/5' : 'border-emerald-400/80 bg-emerald-500/5') : ''}`}>
                    <input type="date" value={x.date} min={monthStart} max={monthEnd}
                      onChange={e => setRows(p => p.map(y => (y.key === x.key ? { ...y, date: e.target.value } : y)))}
                      className={field} style={{ direction: 'ltr', textAlign: 'right' }} />
                    <select value={x.branchId} onChange={e => setRows(p => p.map(y => (y.key === x.key ? { ...y, branchId: e.target.value } : y)))}
                      className={field + ' appearance-none text-right'}>
                      <option value="">اختر الفرع</option>
                      {branches.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
                    </select>
                    <button type="button" onClick={() => setRows(p => p.filter(y => y.key !== x.key))}
                      className="w-11 h-11 rounded-xl flex items-center justify-center text-slate-400 hover:text-red-400 bg-slate-800 border border-slate-700" aria-label="حذف اليوم">
                      <Trash2 size={16} />
                    </button>
                    {isOutDoor(x.branchId) && (
                      <input type="text" value={x.reason || ''} maxLength={200} placeholder="سبب اختيار Out Door"
                        onChange={e => setRows(p => p.map(y => (y.key === x.key ? { ...y, reason: e.target.value } : y)))}
                        className={field + ' sm:col-span-3 text-amber-200'} aria-label="سبب اختيار Out Door" />
                    )}
                    {mark && (
                      <div className={`sm:col-span-3 text-[11px] font-bold ${mark === 'changed' ? 'text-amber-300' : 'text-emerald-300'}`}>
                        {mark === 'changed' ? `كان: ${planDiff!.changed[x.date]}` : 'يوم جديد لم يكن في الخطة المعتمدة'}
                      </div>
                    )}
                  </div>
                  );
                })}
              </div>
              <button type="button" onClick={() => setRows(p => [...p, { key: `a${++seq}`, date: '', branchId: '' }])}
                className="ut-btn ut-btn--glass" style={{ minHeight: 40 }}><Plus size={15} /> إضافة يوم</button>
            </>
          )}

          {r.type === 'leave' && leave && (
            <div className="space-y-2">
              <div className="grid grid-cols-2 gap-2">
                <label className="space-y-1"><span className="text-xs text-slate-400 font-bold">من</span>
                  <input type="date" value={lvFrom} onChange={e => setLvFrom(e.target.value)} className={field} style={{ direction: 'ltr', textAlign: 'right' }} /></label>
                <label className="space-y-1"><span className="text-xs text-slate-400 font-bold">إلى</span>
                  <input type="date" value={lvTo} min={lvFrom} onChange={e => setLvTo(e.target.value)} className={field} style={{ direction: 'ltr', textAlign: 'right' }} /></label>
              </div>
              {leave.reason && <div className="text-sm text-slate-300">السبب: {leave.reason}</div>}
            </div>
          )}

          {r.status !== 'cancelled' && (
            <>
              <textarea value={note} onChange={e => setNote(e.target.value)} maxLength={300} placeholder="ملاحظة للموظف (اختياري)"
                className="w-full h-20 px-3 py-2.5 rounded-xl border border-slate-600 bg-slate-900 text-white text-sm outline-none focus:border-blue-500 resize-none placeholder:text-slate-500" />
              {err && <div className="p-3 rounded-xl text-sm font-bold bg-red-900/20 text-red-400 border border-red-800/50">{err}</div>}
              <div className="grid grid-cols-2 gap-2">
                <button type="button" onClick={() => decide('approve')} disabled={!!busy}
                  className="min-h-[46px] rounded-xl font-black text-sm text-white flex items-center justify-center gap-2 disabled:opacity-50" style={{ background: '#047857' }}>
                  {busy === 'approve' ? <Loader2 size={16} className="animate-spin" /> : <Check size={16} />}
                  {edited ? 'موافقة بالتعديل' : 'موافقة'}
                </button>
                <button type="button" onClick={() => decide('reject')} disabled={!!busy}
                  className="min-h-[46px] rounded-xl font-black text-sm text-red-300 border border-red-700/60 bg-red-900/10 flex items-center justify-center gap-2 disabled:opacity-50">
                  {busy === 'reject' ? <Loader2 size={16} className="animate-spin" /> : <X size={16} />} رفض
                </button>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
};

