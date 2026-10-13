import React, { useEffect, useMemo, useState } from 'react';
import { CalendarDays, Plane, ArrowRight, Plus, Trash2, Send, Loader2, AlertCircle, CheckCircle, Lock, RefreshCw, Edit2, X, MessageSquare } from 'lucide-react';
import type { User, Branch, Job, StaffRequest, PlanDay } from '../types';
import {
  postRequestAction, employeeAuth, todayIso, monthOf, addMonths, lastDayOfMonth, nextWorkingDay,
  workingDaysFor, jobCanPlan, isWorkingDay, formatDay, formatShort, formatMonth, daysBetween,
  STATUS_META, LEAVE_TYPES, asPlan, asLeave, markDecisionsSeen, dayCount
} from './requestsApi';

/**
 * تبويب «طلباتي» في شاشة الموظف: الخطة الشهرية (لوظائف التنقل فقط) وطلب الإجازة.
 *
 * القواعد التي يفرضها الخادم أيضاً — الواجهة تمنعها مسبقاً فقط لتوفير المحاولة:
 *   - لا يوم ماضٍ في خطة جديدة، ولا تعديل لأيام انقضت (تُعرض مقفلة).
 *   - الخطة طلب واحد لكل شهر؛ إرسالها مجدداً يعيدها «معلّقة» والمعتمد السابق ساري.
 */

interface Props {
  user: User;
  branches: Branch[];
  jobs: Job[];
  holidays: string[];
  syncUrl: string;
  requests: StaffRequest[];
  loading: boolean;
  error: string;
  reload: () => Promise<void>;
  onSeen: () => void;
  logAction: (action: string, details?: string) => void;
}

type View = { kind: 'home' } | { kind: 'plan'; month: string } | { kind: 'leave'; editId?: string };

const card = 'bg-slate-800 rounded-3xl border border-slate-700 p-4 md:p-6 text-white';
const field = 'w-full min-h-[48px] px-3 rounded-2xl border border-slate-600 bg-slate-900 text-white text-sm font-bold outline-none focus:border-blue-500';
// خارج البطاقات الخلفية فاتحة — الأزرار هناك بأرضية داكنة صلبة لا شفافة
const backBtn = 'min-h-[44px] px-4 rounded-2xl bg-slate-800 border border-slate-700 text-white text-sm font-bold inline-flex items-center gap-2';
const primaryBtn = 'w-full min-h-[52px] rounded-2xl font-black text-base text-white flex items-center justify-center gap-2 transition-all active:scale-[.98] disabled:opacity-50';

const StatusChip: React.FC<{ r: StaffRequest }> = ({ r }) => (
  <span className={STATUS_META[r.status]?.chip || 'ut-chip'} style={{ height: 26, fontSize: 12 }}>
    {STATUS_META[r.status]?.label || r.status}
  </span>
);

const Banner: React.FC<{ type: 'error' | 'success'; msg: string }> = ({ type, msg }) => (
  <div className={`p-4 rounded-2xl text-sm font-bold border flex items-start gap-3 ${type === 'success'
    ? 'bg-green-900/20 text-green-400 border-green-800/50' : 'bg-red-900/20 text-red-400 border-red-800/50'}`}>
    {type === 'success' ? <CheckCircle size={20} className="shrink-0" /> : <AlertCircle size={20} className="shrink-0" />}
    <span className="leading-relaxed">{msg}</span>
  </div>
);

/** قرار المدير وملاحظته — يظهر أعلى الخطة والإجازة */
const DecisionNote: React.FC<{ r: StaffRequest }> = ({ r }) => {
  if (!r.decidedAt || r.decidedBy === 'الموظف') return null;
  return (
    <div className="p-3 rounded-2xl bg-slate-900 border border-slate-700 text-sm text-slate-300 leading-relaxed">
      <div className="flex items-center gap-2 text-xs text-slate-400 mb-1">
        <MessageSquare size={14} /> {r.decidedBy} · {formatShort(r.decidedAt.slice(0, 10))}
      </div>
      {r.managerNote ? r.managerNote : <span className="text-slate-500">بلا ملاحظة</span>}
    </div>
  );
};

export default function RequestsPanel(props: Props) {
  const { user, jobs, requests, loading, error, reload, onSeen } = props;
  const [view, setView] = useState<View>({ kind: 'home' });
  const canPlan = jobCanPlan(jobs, user.jobTitle);

  // فتح التبويب = رؤية قرارات المدير
  useEffect(() => { markDecisionsSeen(user.id); onSeen(); }, [requests]); // eslint-disable-line react-hooks/exhaustive-deps

  if (view.kind === 'plan') return <PlanEditor {...props} month={view.month} onBack={() => setView({ kind: 'home' })} />;
  if (view.kind === 'leave') return <LeaveForm {...props} editId={view.editId} onBack={() => setView({ kind: 'home' })} />;

  const thisMonth = monthOf(todayIso());
  const plans = requests.filter(r => r.type === 'plan');
  const leaves = requests.filter(r => r.type === 'leave');

  return (
    <div className="space-y-4">
      <div className={`grid gap-3 ${canPlan ? 'grid-cols-2' : 'grid-cols-1'}`}>
        {canPlan && (
          <button type="button" onClick={() => setView({ kind: 'plan', month: thisMonth })}
            className="min-h-[96px] rounded-3xl bg-slate-800 border-2 border-blue-500/60 text-white flex flex-col items-center justify-center gap-2 active:scale-[.98] transition-all shadow-lg">
            <CalendarDays size={28} className="text-blue-400" />
            <span className="font-black text-base">الخطة الشهرية</span>
          </button>
        )}
        <button type="button" onClick={() => setView({ kind: 'leave' })}
          className="min-h-[96px] rounded-3xl bg-slate-800 border-2 border-amber-500/60 text-white flex flex-col items-center justify-center gap-2 active:scale-[.98] transition-all shadow-lg">
          <Plane size={28} className="text-amber-400" />
          <span className="font-black text-base">طلب إجازة</span>
        </button>
      </div>

      <div className={card}>
        <div className="flex items-center justify-between mb-4">
          <h3 className="font-black text-base">طلباتي</h3>
          <button type="button" onClick={() => reload()} disabled={loading} className="ut-btn ut-btn--glass" style={{ minHeight: 40 }}>
            <RefreshCw size={15} className={loading ? 'animate-spin' : ''} /> تحديث
          </button>
        </div>

        {error && <div className="mb-3"><Banner type="error" msg={error} /></div>}

        {loading && requests.length === 0 ? (
          <div className="py-10 flex flex-col items-center gap-3 text-slate-400">
            <Loader2 className="animate-spin text-blue-400" size={26} />
            <span className="text-sm font-bold">جارٍ تحميل طلباتك…</span>
          </div>
        ) : requests.length === 0 ? (
          <div className="py-10 text-center">
            <div className="text-sm font-bold text-slate-300">لا توجد طلبات بعد</div>
            <div className="text-xs text-slate-500 mt-1">{canPlan ? 'أرسل خطتك الشهرية أو اطلب إجازة من الأزرار بالأعلى' : 'اطلب إجازة من الزر بالأعلى'}</div>
          </div>
        ) : (
          <div className="space-y-3">
            {plans.map(r => {
              const days = asPlan(r.approvedItems || r.items).length;
              return (
                <button key={r.id} type="button" onClick={() => setView({ kind: 'plan', month: r.month })}
                  className="w-full text-right p-4 rounded-2xl bg-slate-900 border border-slate-700 hover:border-blue-500 transition-all">
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-black text-sm flex items-center gap-2"><CalendarDays size={16} className="text-blue-400" /> خطة {formatMonth(r.month)}</span>
                    <StatusChip r={r} />
                  </div>
                  <div className="text-xs text-slate-400 mt-2">{dayCount(days)} زيارة{r.managerNote ? ` · ملاحظة المدير: ${r.managerNote}` : ''}</div>
                </button>
              );
            })}
            {leaves.map(r => <LeaveCard key={r.id} r={r} {...props} onEdit={() => setView({ kind: 'leave', editId: r.id })} />)}
          </div>
        )}
      </div>
    </div>
  );
}

/* ====================== بطاقة الإجازة ====================== */

const LeaveCard: React.FC<Props & { r: StaffRequest; onEdit: () => void }> = ({ r, user, syncUrl, reload, logAction, onEdit }) => {
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const lv = asLeave(r.approvedItems || r.items);
  const today = todayIso();
  const editable = !!lv && lv.from >= today && r.status !== 'cancelled';

  const cancel = async () => {
    setBusy(true); setErr('');
    const res = await postRequestAction(syncUrl, { action: 'cancelLeaveRequest', ...employeeAuth(user.nationalId), requestId: r.id });
    setBusy(false); setConfirming(false);
    if (!res.ok) { setErr(res.error || 'تعذّر الإلغاء'); return; }
    logAction('إلغاء طلب إجازة', `من ${lv?.from} إلى ${lv?.to}`);
    reload();
  };

  if (!lv) return null;
  return (
    <div className="p-4 rounded-2xl bg-slate-900 border border-slate-700 space-y-2">
      <div className="flex items-center justify-between gap-2">
        <span className="font-black text-sm flex items-center gap-2"><Plane size={16} className="text-amber-400" /> إجازة {lv.leaveType}</span>
        <StatusChip r={r} />
      </div>
      <div className="text-sm text-slate-300">
        {formatShort(lv.from)}{lv.to !== lv.from ? ` ← ${formatShort(lv.to)}` : ''} · {dayCount(daysBetween(lv.from, lv.to))}
      </div>
      {r.status === 'modified' && <div className="text-xs text-blue-300">عدّل المدير التواريخ — المعتمد: {formatShort(lv.from)} ← {formatShort(lv.to)}</div>}
      {r.managerNote && <div className="text-xs text-slate-400">ملاحظة المدير: {r.managerNote}</div>}
      {err && <Banner type="error" msg={err} />}
      {editable && (
        <div className="flex gap-2 pt-1">
          <button type="button" onClick={onEdit} className="ut-btn ut-btn--glass flex-1" style={{ minHeight: 44 }}><Edit2 size={15} /> تعديل</button>
          {confirming ? (
            <button type="button" onClick={cancel} disabled={busy} className="ut-btn flex-1 text-white" style={{ minHeight: 44, background: '#B91C1C' }}>
              {busy ? <Loader2 size={15} className="animate-spin" /> : <X size={15} />} تأكيد الإلغاء
            </button>
          ) : (
            <button type="button" onClick={() => setConfirming(true)} className="ut-btn ut-btn--glass flex-1" style={{ minHeight: 44 }}><X size={15} /> إلغاء الطلب</button>
          )}
        </div>
      )}
    </div>
  );
};

/* ====================== محرّر الخطة الشهرية ====================== */

interface Row { key: string; date: string; branchId: string; reason?: string }
let rowSeq = 0;
const newKey = () => `r${++rowSeq}`;

const PlanEditor: React.FC<Props & { month: string; onBack: () => void }> = ({
  user, branches, jobs, holidays, syncUrl, requests, reload, logAction, month: initialMonth, onBack
}) => {
  const today = todayIso();
  const thisMonth = monthOf(today);
  const [month, setMonth] = useState(initialMonth < thisMonth ? thisMonth : initialMonth);
  const workingDays = workingDaysFor(jobs, user.jobTitle);
  const existing = requests.find(r => r.type === 'plan' && r.month === month);
  const effective = existing
    ? asPlan(existing.status === 'approved' || existing.status === 'modified' ? existing.approvedItems : existing.items)
    : [];

  const monthStart = month === thisMonth ? today : `${month}-01`;
  const monthEnd = lastDayOfMonth(month);
  const pastDays = effective.filter(d => d.date < today);

  const buildRows = (): Row[] => {
    const future = effective.filter(d => d.date >= today).map(d => ({ key: newKey(), date: d.date, branchId: d.branchId, reason: d.reason || '' }));
    if (future.length) return future;
    const first = nextWorkingDay(monthStart, workingDays, holidays, true);
    return first ? [{ key: newKey(), date: first, branchId: '' }] : [];
  };

  const [rows, setRows] = useState<Row[]>(buildRows);
  const [sending, setSending] = useState(false);
  const [msg, setMsg] = useState<{ type: 'error' | 'success'; text: string } | null>(null);

  // تبديل الشهر يعيد بناء الأسطر من طلب ذلك الشهر
  useEffect(() => { setRows(buildRows()); setMsg(null); }, [month]); // eslint-disable-line react-hooks/exhaustive-deps
  // بعد الإرسال يُعاد بناء الأسطر من النسخة المحفوظة، مع إبقاء رسالة النجاح
  useEffect(() => { setRows(buildRows()); }, [existing?.submittedAt]); // eslint-disable-line react-hooks/exhaustive-deps

  /** أيام عدّلها المدير: موجودة في المعتمد بفرع مختلف أو أضافها هو */
  const changedByManager = useMemo(() => {
    const set = new Set<string>();
    if (!existing || existing.status !== 'modified') return set;
    const sent = new Map(asPlan(existing.items).map(d => [d.date, d.branchId]));
    asPlan(existing.approvedItems).forEach(d => { if (sent.get(d.date) !== d.branchId) set.add(d.date); });
    return set;
  }, [existing]);
  const removedByManager = useMemo(() => {
    if (!existing || existing.status !== 'modified') return [] as PlanDay[];
    const kept = new Set(asPlan(existing.approvedItems).map(d => d.date));
    return asPlan(existing.items).filter(d => !kept.has(d.date) && d.date >= today);
  }, [existing, today]);

  const maxDate = (list: Row[]) => list.reduce((m, r) => (r.date > m ? r.date : m), '');

  const updateRow = (key: string, patch: Partial<Row>) => {
    setRows(prev => {
      const next = prev.map(r => (r.key === key ? { ...r, ...patch } : r));
      // اكتمال آخر سطر (تاريخ + فرع) يضيف تلقائياً سطر يوم العمل التالي
      const last = next[next.length - 1];
      if (patch.branchId && last && last.key === key && last.date && last.branchId) {
        const nd = nextWorkingDay(maxDate(next), workingDays, holidays);
        if (nd && !next.some(r => r.date === nd)) next.push({ key: newKey(), date: nd, branchId: '' });
      }
      return next;
    });
    setMsg(null);
  };

  const addRow = () => {
    const base = maxDate(rows) || '';
    const nd = base ? nextWorkingDay(base, workingDays, holidays) : nextWorkingDay(monthStart, workingDays, holidays, true);
    if (!nd) { setMsg({ type: 'error', text: 'لا توجد أيام عمل متبقية في هذا الشهر.' }); return; }
    setRows(prev => [...prev, { key: newKey(), date: nd, branchId: '' }]);
  };

  const submit = async () => {
    setMsg(null);
    // السطر الأخير الفارغ (المضاف تلقائياً) يُتجاهل؛ أي سطر آخر بلا فرع خطأ
    const filled = rows.filter((r, i) => !(i === rows.length - 1 && !r.branchId));
    for (const r of filled) {
      if (!r.date) return setMsg({ type: 'error', text: 'يوجد سطر بلا تاريخ.' });
      if (r.date < today) return setMsg({ type: 'error', text: `لا يمكن اختيار يوم منقضٍ (${formatShort(r.date)}).` });
      if (monthOf(r.date) !== month) return setMsg({ type: 'error', text: `يوم ${formatShort(r.date)} خارج شهر الخطة.` });
      if (!r.branchId) return setMsg({ type: 'error', text: `اختر الفرع ليوم ${formatShort(r.date)}.` });
      if (isOutDoor(r.branchId) && !(r.reason || '').trim()) return setMsg({ type: 'error', text: `اكتب سبب اختيار Out Door ليوم ${formatShort(r.date)}.` });
    }
    const dates = filled.map(r => r.date);
    const dup = dates.find((d, i) => dates.indexOf(d) !== i);
    if (dup) return setMsg({ type: 'error', text: `يوم ${formatShort(dup)} مكرّر في الخطة.` });
    if (!filled.length) return setMsg({ type: 'error', text: 'أضف يوماً واحداً على الأقل.' });

    setSending(true);
    const res = await postRequestAction(syncUrl, {
      action: 'submitPlanRequest', ...employeeAuth(user.nationalId), month,
      items: filled.map(r => ({ date: r.date, branchId: r.branchId, reason: isOutDoor(r.branchId) ? (r.reason || '').trim() : undefined }))
    });
    setSending(false);
    if (!res.ok) { setMsg({ type: 'error', text: res.error || 'تعذّر الإرسال' }); return; }
    logAction(existing ? 'تعديل الخطة الشهرية' : 'إرسال الخطة الشهرية', `الشهر: ${month} | ${filled.length} يوم`);
    setMsg({ type: 'success', text: 'أُرسلت الخطة إلى المدير، وهي الآن بانتظار الموافقة.' });
    await reload();
  };

  const branchName = (id: string) => branches.find(b => b.id === id)?.name || id;
  // Out Door: الموظف يكتب سبب اختياره — نفس قاعدة تسجيل الحضور
  const isOutDoor = (id: string) => (branches.find(b => b.id === id)?.name || '').trim().toLowerCase() === 'out door';

  return (
    <div className="space-y-4">
      <button type="button" onClick={onBack} className={backBtn}>
        <ArrowRight size={16} /> رجوع لطلباتي
      </button>

      <div className={card + ' space-y-4'}>
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <h3 className="font-black text-lg flex items-center gap-2"><CalendarDays size={20} className="text-blue-400" /> الخطة الشهرية</h3>
          {existing && <StatusChip r={existing} />}
        </div>

        {/* الشهر الحالي أو القادم */}
        <div className="grid grid-cols-2 gap-2">
          {[thisMonth, addMonths(thisMonth, 1)].map(m => (
            <button key={m} type="button" onClick={() => setMonth(m)}
              className={`min-h-[44px] rounded-2xl text-sm font-black border transition-all ${m === month
                ? 'bg-blue-600 border-blue-500 text-white' : 'bg-slate-900 border-slate-700 text-slate-300'}`}>
              {formatMonth(m)}
            </button>
          ))}
        </div>

        {existing && <DecisionNote r={existing} />}

        {existing && existing.status === 'pending' && existing.approvedItems && (
          <div className="text-xs text-slate-400 leading-relaxed">تعديلك بانتظار موافقة المدير، والخطة المعتمدة السابقة سارية حتى يردّ.</div>
        )}
        {existing && existing.status === 'rejected' && existing.approvedItems && (
          <div className="text-xs text-slate-400 leading-relaxed">رُفض آخر تعديل، والخطة المعتمدة السابقة ما زالت سارية.</div>
        )}

        {removedByManager.length > 0 && (
          <div className="p-3 rounded-2xl bg-red-900/10 border border-red-800/40 text-xs text-red-300 leading-relaxed">
            حذف المدير هذه الأيام: {removedByManager.map(d => `${formatShort(d.date)} (${d.branchName})`).join('، ')}
          </div>
        )}

        {/* الأيام المنقضية — مقفلة */}
        {pastDays.length > 0 && (
          <div className="space-y-2">
            <div className="text-xs font-bold text-slate-500">أيام انقضت (لا تُعدَّل)</div>
            {pastDays.map(d => (
              <div key={d.date} className="flex items-center justify-between gap-2 px-3 min-h-[44px] rounded-2xl bg-slate-900/60 border border-slate-800 text-sm text-slate-500">
                <span className="flex items-center gap-2"><Lock size={13} /> {formatDay(d.date)}</span>
                <span>{d.branchName}</span>
              </div>
            ))}
          </div>
        )}

        {/* أيام قابلة للتعديل */}
        <div className="space-y-3">
          {rows.map((r, i) => {
            const offDay = r.date && !isWorkingDay(r.date, workingDays, holidays);
            const changed = changedByManager.has(r.date);
            return (
              <div key={r.key} className={`p-3 rounded-2xl border space-y-2 ${changed ? 'bg-blue-900/15 border-blue-500/50' : 'bg-slate-900 border-slate-700'}`}>
                <div className="flex items-center justify-between text-xs">
                  <span className="font-bold text-slate-300">{r.date ? formatDay(r.date) : `اليوم ${i + 1}`}</span>
                  <span className="flex items-center gap-2">
                    {changed && <span className="text-blue-300 font-bold">عدّله المدير</span>}
                    {offDay && <span className="text-amber-400 font-bold">يوم عطلة</span>}
                  </span>
                </div>
                <div className="grid grid-cols-[1fr_auto] gap-2 items-center">
                  <input type="date" value={r.date} min={monthStart} max={monthEnd}
                    onChange={e => updateRow(r.key, { date: e.target.value })}
                    className={field} style={{ direction: 'ltr', textAlign: 'right' }} aria-label="التاريخ" />
                  <button type="button" onClick={() => setRows(prev => prev.filter(x => x.key !== r.key))}
                    className="w-12 h-12 rounded-2xl flex items-center justify-center text-slate-400 hover:text-red-400 bg-slate-800 border border-slate-700" aria-label="حذف اليوم">
                    <Trash2 size={18} />
                  </button>
                </div>
                <select value={r.branchId} onChange={e => updateRow(r.key, { branchId: e.target.value })}
                  className={field + ' appearance-none cursor-pointer text-right'} aria-label="الفرع">
                  <option value="">اختر الفرع</option>
                  {branches.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
                </select>
                {isOutDoor(r.branchId) && (
                  <input type="text" value={r.reason || ''} maxLength={200}
                    onChange={e => setRows(prev => prev.map(x => (x.key === r.key ? { ...x, reason: e.target.value } : x)))}
                    placeholder="سبب اختيار Out Door (إلزامي)"
                    className={field + (!(r.reason || '').trim() ? ' border-amber-500/70' : '')} aria-label="سبب اختيار Out Door" />
                )}
              </div>
            );
          })}
        </div>

        <button type="button" onClick={addRow} className="ut-btn ut-btn--glass w-full" style={{ minHeight: 48 }}>
          <Plus size={17} /> إضافة يوم
        </button>

        {msg && <Banner type={msg.type} msg={msg.text} />}

        <button type="button" onClick={submit} disabled={sending} className={primaryBtn} style={{ backgroundImage: 'var(--grad-brand)' }}>
          {sending ? <Loader2 size={20} className="animate-spin" /> : <Send size={20} />}
          {sending ? 'جارٍ الإرسال…' : existing ? 'إرسال التعديل للمدير' : 'إرسال الخطة للمدير'}
        </button>

        {existing && (existing.status === 'approved' || existing.status === 'modified') && (
          <div className="text-xs text-slate-500 text-center leading-relaxed">
            المعتمد حالياً: {asPlan(existing.approvedItems).filter(d => d.date >= today).map(d => `${formatShort(d.date)} ${branchName(d.branchId)}`).join(' · ') || 'لا أيام قادمة'}
          </div>
        )}
      </div>
    </div>
  );
};

/* ====================== طلب الإجازة ====================== */

interface LeaveRange { key: number; from: string; to: string }
let rangeSeq = 0;
const nextDay = (iso: string) =>
  new Date(Date.UTC(+iso.slice(0, 4), +iso.slice(5, 7) - 1, +iso.slice(8, 10) + 1)).toISOString().slice(0, 10);

const LeaveForm: React.FC<Props & { editId?: string; onBack: () => void }> = ({
  user, jobs, holidays, syncUrl, requests, reload, logAction, editId, onBack
}) => {
  const today = todayIso();
  const editing = editId ? requests.find(r => r.id === editId) : undefined;
  const base = editing ? asLeave(editing.status === 'approved' || editing.status === 'modified' ? editing.approvedItems : editing.items) : null;

  // فترة أو أكثر (حتى ٦) في نفس الطلب — الخادم ينشئ طلباً مستقلاً لكل فترة.
  // التعديل لفترة واحدة فقط (الطلب القائم).
  const [ranges, setRanges] = useState<LeaveRange[]>(() => [{ key: ++rangeSeq, from: base?.from || today, to: base?.to || today }]);
  const setRange = (key: number, patch: Partial<LeaveRange>) =>
    setRanges(p => p.map(r => {
      if (r.key !== key) return r;
      const n = { ...r, ...patch };
      if (patch.from && n.to < patch.from) n.to = patch.from;
      return n;
    }));
  const addRange = () => setRanges(p => {
    const last = p[p.length - 1];
    const start = last && last.to >= today ? nextDay(last.to) : today;
    return [...p, { key: ++rangeSeq, from: start, to: start }];
  });
  const [leaveType, setLeaveType] = useState(base?.leaveType || LEAVE_TYPES[0]);
  const [reason, setReason] = useState(base?.reason || '');
  const [sending, setSending] = useState(false);
  const [msg, setMsg] = useState<{ type: 'error' | 'success'; text: string } | null>(null);

  const workingDays = workingDaysFor(jobs, user.jobTitle);
  const workCountOf = (from: string, to: string) => {
    let n = 0;
    if (!from || !to || to < from || daysBetween(from, to) > 60) return 0;
    for (let d = from; d <= to; d = nextDay(d)) if (isWorkingDay(d, workingDays, holidays)) n++;
    return n;
  };

  const submit = async () => {
    setMsg(null);
    const many = ranges.length > 1;
    for (let i = 0; i < ranges.length; i++) {
      const { from, to } = ranges[i];
      const lbl = many ? ` (الفترة ${i + 1})` : '';
      if (!from || !to) return setMsg({ type: 'error', text: 'حدّد تاريخ البداية والنهاية' + lbl + '.' });
      if (from < today) return setMsg({ type: 'error', text: 'لا يمكن طلب إجازة تبدأ في يوم منقضٍ' + lbl + '.' });
      if (to < from) return setMsg({ type: 'error', text: 'تاريخ النهاية قبل تاريخ البداية' + lbl + '.' });
      if (daysBetween(from, to) > 60) return setMsg({ type: 'error', text: 'الحد الأقصى للفترة الواحدة ٦٠ يوماً' + lbl + '.' });
    }
    const sorted = [...ranges].sort((a, b) => (a.from < b.from ? -1 : 1));
    for (let i = 1; i < sorted.length; i++) {
      if (sorted[i].from <= sorted[i - 1].to) return setMsg({ type: 'error', text: 'الفترات متداخلة — راجع التواريخ.' });
    }

    setSending(true);
    const res = await postRequestAction(syncUrl, {
      action: 'submitLeaveRequest', ...employeeAuth(user.nationalId),
      requestId: editing?.id,
      ranges: sorted.map(r => ({ from: r.from, to: r.to })),
      from: sorted[0].from, to: sorted[0].to, // للخادم القديم قبل دعم أكثر من فترة
      leaveType, reason: reason.trim()
    });
    setSending(false);
    if (!res.ok) { setMsg({ type: 'error', text: res.error || 'تعذّر الإرسال' }); return; }
    logAction(editing ? 'تعديل طلب إجازة' : 'طلب إجازة',
      `${leaveType} | ${sorted.map(r => `من ${r.from} إلى ${r.to}`).join(' ، ')}`);
    setMsg({ type: 'success', text: many
      ? `أُرسلت ${sorted.length === 2 ? 'الفترتان' : sorted.length + ' فترات'} إلى المدير (طلب لكل فترة)، وهي بانتظار الموافقة.`
      : 'أُرسل الطلب إلى المدير، وهو الآن بانتظار الموافقة.' });
    await reload();
  };

  return (
    <div className="space-y-4">
      <button type="button" onClick={onBack} className={backBtn}>
        <ArrowRight size={16} /> رجوع لطلباتي
      </button>
      <div className={card + ' space-y-4'}>
        <div className="flex items-center justify-between gap-2">
          <h3 className="font-black text-lg flex items-center gap-2"><Plane size={20} className="text-amber-400" /> {editing ? 'تعديل طلب الإجازة' : 'طلب إجازة'}</h3>
          {editing && <StatusChip r={editing} />}
        </div>
        {editing && <DecisionNote r={editing} />}

        <div className="space-y-3">
          {ranges.map((r, i) => (
            <div key={r.key} className={ranges.length > 1 ? 'p-3 rounded-2xl border border-slate-700 bg-slate-900/50 space-y-2' : 'space-y-2'}>
              {ranges.length > 1 && (
                <div className="flex items-center justify-between">
                  <span className="text-xs font-black text-amber-300">الفترة {i + 1}</span>
                  <button type="button" onClick={() => setRanges(p => p.filter(x => x.key !== r.key))}
                    className="w-10 h-10 rounded-xl flex items-center justify-center text-slate-400 hover:text-red-400" aria-label="حذف الفترة">
                    <Trash2 size={16} />
                  </button>
                </div>
              )}
              <div className="grid grid-cols-2 gap-3">
                <label className="space-y-1.5">
                  <span className="text-xs font-bold text-slate-400">من</span>
                  <input type="date" value={r.from} min={today} onChange={e => setRange(r.key, { from: e.target.value })}
                    className={field} style={{ direction: 'ltr', textAlign: 'right' }} />
                </label>
                <label className="space-y-1.5">
                  <span className="text-xs font-bold text-slate-400">إلى</span>
                  <input type="date" value={r.to} min={r.from || today} onChange={e => setRange(r.key, { to: e.target.value })}
                    className={field} style={{ direction: 'ltr', textAlign: 'right' }} />
                </label>
              </div>
              {r.from && r.to && r.to >= r.from && (
                <div className="text-xs text-slate-400">{dayCount(daysBetween(r.from, r.to))}، منها {workCountOf(r.from, r.to)} من أيام العمل</div>
              )}
            </div>
          ))}
          {!editing && ranges.length < 6 && (
            <button type="button" onClick={addRange}
              className="w-full min-h-[44px] rounded-2xl border border-dashed border-slate-600 text-sm font-black text-slate-300 hover:text-white hover:border-amber-400 flex items-center justify-center gap-2">
              <Plus size={16} /> إضافة فترة أخرى
            </button>
          )}
        </div>

        <div className="space-y-1.5">
          <span className="text-xs font-bold text-slate-400">نوع الإجازة</span>
          <div className="grid grid-cols-4 gap-2">
            {LEAVE_TYPES.map(t => (
              <button key={t} type="button" onClick={() => setLeaveType(t)}
                className={`min-h-[44px] rounded-2xl text-sm font-black border transition-all ${t === leaveType
                  ? 'bg-amber-500 border-amber-400 text-slate-900' : 'bg-slate-900 border-slate-700 text-slate-300'}`}>
                {t}
              </button>
            ))}
          </div>
        </div>

        <label className="block space-y-1.5">
          <span className="text-xs font-bold text-slate-400">السبب (اختياري)</span>
          <textarea value={reason} onChange={e => setReason(e.target.value)} maxLength={300}
            className="w-full h-24 px-3 py-3 rounded-2xl border border-slate-600 bg-slate-900 text-white text-sm outline-none focus:border-blue-500 resize-none leading-relaxed" />
        </label>

        {msg && <Banner type={msg.type} msg={msg.text} />}

        <button type="button" onClick={submit} disabled={sending} className={primaryBtn} style={{ background: '#F59E0B', color: '#1F1300' }}>
          {sending ? <Loader2 size={20} className="animate-spin" /> : <Send size={20} />}
          {sending ? 'جارٍ الإرسال…' : editing ? 'إرسال التعديل للمدير' : 'إرسال الطلب للمدير'}
        </button>
      </div>
    </div>
  );
};
