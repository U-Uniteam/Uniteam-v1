import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { FileSpreadsheet, Loader2, Search, AlertCircle, ChevronDown, Check } from 'lucide-react';
import { postRequestAction, todayIso, monthOf, lastDayOfMonth, addDaysIso, weekdayOf } from './requestsApi';

/**
 * تقرير الخطط المجمّع: صف لكل يوم، وعمود لكل موظف، وفي الخلية الفرع الذي
 * سيزوره. يجمع الخطط الشهرية والإجازات من الطلبات + الزيارات اليدوية من
 * «خطط الزيارات». الخادم يقصر الموظفين على صلاحيات المدير.
 */

interface Entry { userId: string; date: string; branchName: string; source: 'plan' | 'leave' | 'manual'; status: 'approved' | 'pending'; reason?: string }
interface Emp { id: string; userName: string; jobTitle: string; serialNumber: string; defaultBranch?: string }
interface Props { syncUrl: string; approverToken: string }

interface Cell { text: string; kind: 'plan' | 'manual' | 'leave' | 'pending' | 'mixed' }

const DATE_FMT = new Intl.DateTimeFormat('en-GB', { day: '2-digit', month: 'short', timeZone: 'UTC' });
const shortDate = (iso: string) => {
  const [y, m, d] = iso.split('-').map(Number);
  return DATE_FMT.format(new Date(Date.UTC(y, m - 1, d))).replace(' ', '-'); // 04-Oct
};

/** أسماء الأيام بترقيم getUTCDay (٠ = الأحد) */
const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
/** ترتيب القائمة: الأسبوع يبدأ بالسبت */
const DAY_ORDER = [6, 0, 1, 2, 3, 4, 5];
const DAYS_KEY = 'uniteam_plan_report_days';

/** اسم الفرع، ومعه سبب Out Door في سطر ثانٍ إن وُجد */
const withReason = (e: Entry) => (e.reason ? `${e.branchName}\n${e.reason}` : e.branchName);

/** ألوان الخلايا — نفسها في الشاشة وفي ملف Excel */
const KIND_STYLE: Record<Cell['kind'], { bg: string; fg: string; xl: string; label: string }> = {
  plan:    { bg: '#FCE9D2', fg: '#3B2A14', xl: 'FFFCE9D2', label: 'خطة شهرية معتمدة' },
  manual:  { bg: '#DCEBFB', fg: '#123A63', xl: 'FFDCEBFB', label: 'زيارة يدوية' },
  leave:   { bg: '#DDF3E4', fg: '#14532D', xl: 'FFDDF3E4', label: 'إجازة' },
  pending: { bg: '#FFF6C7', fg: '#5B4A00', xl: 'FFFFF6C7', label: 'معلّق — بانتظار الموافقة' },
  mixed:   { bg: '#EDE4FA', fg: '#3B1F66', xl: 'FFEDE4FA', label: 'أكثر من مصدر لنفس اليوم' }
};

function buildCell(list: Entry[]): Cell | null {
  if (!list.length) return null;
  // المعتمد يسبق المعلّق، والإجازة تسبق الزيارة
  const approved = list.filter(e => e.status === 'approved');
  const leave = approved.find(e => e.source === 'leave');
  if (leave) return { text: 'إجازة', kind: 'leave' };
  if (approved.length) {
    const names = Array.from(new Set(approved.map(withReason)));
    const sources = new Set(approved.map(e => e.source));
    const kind: Cell['kind'] = sources.size > 1 ? 'mixed' : sources.has('manual') ? 'manual' : 'plan';
    return { text: names.join(' / '), kind };
  }
  const names = Array.from(new Set(list.map(withReason)));
  return { text: names.join(' / ') + ' (معلّق)', kind: 'pending' };
}

export default function PlanReport({ syncUrl, approverToken }: Props) {
  const today = todayIso();
  const [from, setFrom] = useState(`${monthOf(today)}-01`);
  const [to, setTo] = useState(lastDayOfMonth(monthOf(today)));
  const [withPending, setWithPending] = useState(true);
  // أيام الأسبوع المختارة — تُحفظ على هذا الجهاز للمرة التالية
  const [days, setDays] = useState<number[]>(() => {
    try { const v = JSON.parse(localStorage.getItem(DAYS_KEY) || 'null'); if (Array.isArray(v) && v.length) return v; } catch { /* محجوب */ }
    return [0, 1, 2, 3, 4, 5, 6];
  });
  useEffect(() => { try { localStorage.setItem(DAYS_KEY, JSON.stringify(days)); } catch { /* محجوب */ } }, [days]);
  const [daysOpen, setDaysOpen] = useState(false);
  const daysRef = useRef<HTMLDivElement>(null);
  const daysBtnRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  // القائمة تُرسم خارج إطار اللوحة (الإطار يقصّ ما يتجاوز حدوده)
  const [menuPos, setMenuPos] = useState<{ top: number; right: number } | null>(null);
  useLayoutEffect(() => {
    if (!daysOpen) { setMenuPos(null); return; }
    const place = () => {
      const b = daysBtnRef.current?.getBoundingClientRect();
      if (b) setMenuPos({ top: b.bottom + 4, right: Math.max(8, window.innerWidth - b.right) });
    };
    place();
    window.addEventListener('resize', place);
    window.addEventListener('scroll', place, true);
    return () => { window.removeEventListener('resize', place); window.removeEventListener('scroll', place, true); };
  }, [daysOpen]);
  useEffect(() => {
    if (!daysOpen) return;
    const close = (ev: MouseEvent) => {
      const t = ev.target as Node;
      if (daysRef.current?.contains(t) || menuRef.current?.contains(t)) return;
      setDaysOpen(false);
    };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [daysOpen]);
  const toggleDay = (d: number) => setDays(prev => (prev.includes(d) ? (prev.length > 1 ? prev.filter(x => x !== d) : prev) : [...prev, d]));
  const daysLabel = days.length === 7 ? 'كل الأيام' : DAY_ORDER.filter(d => days.includes(d)).map(d => DAY_NAMES[d]).join('، ');
  const [loading, setLoading] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [error, setError] = useState('');
  const [data, setData] = useState<{ entries: Entry[]; employees: Emp[]; from: string; to: string } | null>(null);

  const load = async () => {
    setError(''); setLoading(true);
    const res: any = await postRequestAction(syncUrl, { action: 'getPlanReport', approverToken, from, to });
    setLoading(false);
    if (!res.ok) { setError(res.error || 'تعذّر إنشاء التقرير'); return; }
    setData({ entries: res.entries || [], employees: res.employees || [], from: res.from, to: res.to });
  };

  const matrix = useMemo(() => {
    if (!data) return null;
    const entries = withPending ? data.entries : data.entries.filter(e => e.status === 'approved');
    const users = data.employees.filter(u => entries.some(e => e.userId === u.id))
      .sort((a, b) => a.userName.localeCompare(b.userName, 'ar'));
    const dates: string[] = [];
    for (let d = data.from; d <= data.to; d = addDaysIso(d, 1)) if (days.includes(weekdayOf(d))) dates.push(d);
    const byKey = new Map<string, Entry[]>();
    entries.forEach(e => { const k = e.userId + '|' + e.date; byKey.set(k, [...(byKey.get(k) || []), e]); });
    const cells = dates.map(d => users.map(u => buildCell(byKey.get(u.id + '|' + d) || [])));
    return { users, dates, cells };
  }, [data, withPending, days]);

  const download = async () => {
    if (!matrix) return;
    setDownloading(true);
    try {
      // المكتبة تُنزَّل عند الضغط فقط — لا تثقل التطبيق
      const ExcelJS: any = (await import('exceljs')).default || (await import('exceljs'));
      const wb = new ExcelJS.Workbook();
      const ws = wb.addWorksheet('خطط الزيارات', { views: [{ state: 'frozen', xSplit: 2, ySplit: 2 }] });
      const border = { top: { style: 'thin', color: { argb: 'FF9CA3AF' } }, left: { style: 'thin', color: { argb: 'FF9CA3AF' } },
                       bottom: { style: 'thin', color: { argb: 'FF9CA3AF' } }, right: { style: 'thin', color: { argb: 'FF9CA3AF' } } };

      // صفّا العناوين: اسم الموظف ثم فرعه الافتراضي
      const header = ws.addRow(['Day', 'Date', ...matrix.users.map(u => u.userName)]);
      const header2 = ws.addRow(['', '', ...matrix.users.map(u => u.defaultBranch || '')]);
      [header, header2].forEach((h, hi) => {
        h.height = 22;
        h.eachCell({ includeEmpty: true }, (c: any) => {
          c.font = { bold: true, size: hi === 0 ? 11 : 10, color: { argb: 'FF1F2937' } };
          c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFC6E0B4' } };
          c.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
          c.border = border;
        });
      });
      ws.mergeCells('A1:A2');
      ws.mergeCells('B1:B2');

      matrix.dates.forEach((d, i) => {
        const [y, m, day] = d.split('-').map(Number);
        const row = ws.addRow([DAY_NAMES[weekdayOf(d)], new Date(Date.UTC(y, m - 1, day)), ...matrix.cells[i].map(c => (c ? c.text : ''))]);
        const friday = weekdayOf(d) === 5;
        row.eachCell({ includeEmpty: true }, (c: any, col: number) => {
          c.border = border;
          c.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
          if (col <= 2) {
            if (col === 2) c.numFmt = 'dd-mmm';
            c.font = { bold: true, color: { argb: 'FF1F2937' } };
            c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFC000' } };
            return;
          }
          const cell = matrix.cells[i][col - 3];
          c.font = { bold: true, color: { argb: cell ? 'FF' + KIND_STYLE[cell.kind].fg.slice(1) : 'FF1F2937' } };
          const fill = cell ? KIND_STYLE[cell.kind].xl : friday ? 'FFE5E7EB' : null;
          if (fill) c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: fill } };
        });
      });

      ws.getColumn(1).width = 13;
      ws.getColumn(2).width = 11;
      matrix.users.forEach((_, i) => { ws.getColumn(i + 3).width = 26; });

      // مفتاح الألوان أسفل الجدول
      ws.addRow([]);
      (Object.keys(KIND_STYLE) as Cell['kind'][]).forEach(k => {
        const r = ws.addRow(['', '', KIND_STYLE[k].label]);
        r.getCell(3).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: KIND_STYLE[k].xl } };
        r.getCell(3).font = { color: { argb: 'FF' + KIND_STYLE[k].fg.slice(1) } };
      });

      const buf = await wb.xlsx.writeBuffer();
      const blob = new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `Visit-Plans_${data!.from}_${data!.to}.xlsx`;
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(a.href), 4000);
    } catch (e) {
      setError('تعذّر إنشاء ملف Excel. تأكد من الإنترنت وحاول مجدداً.');
    } finally {
      setDownloading(false);
    }
  };

  const field = 'min-h-[42px] px-3 rounded-xl border border-slate-600 bg-slate-900 text-white text-sm font-bold outline-none focus:border-blue-500';

  return (
    <div className="space-y-4 text-white">
      <div className="flex flex-wrap items-end gap-2 bg-slate-900/50 p-3 rounded-2xl border border-slate-700">
        <label className="space-y-1"><span className="block text-xs text-slate-400 font-bold">من</span>
          <input type="date" value={from} onChange={e => setFrom(e.target.value)} className={field} style={{ direction: 'ltr' }} /></label>
        <label className="space-y-1"><span className="block text-xs text-slate-400 font-bold">إلى</span>
          <input type="date" value={to} min={from} onChange={e => setTo(e.target.value)} className={field} style={{ direction: 'ltr' }} /></label>
        <div className="relative space-y-1" ref={daysRef}>
          <span className="block text-xs text-slate-400 font-bold">أيام الأسبوع</span>
          <button type="button" ref={daysBtnRef} onClick={() => setDaysOpen(o => !o)}
            className={field + ' flex items-center justify-between gap-2 min-w-[180px] max-w-[280px]'}>
            <span className="truncate">{daysLabel}</span>
            <ChevronDown size={15} className={`shrink-0 transition-transform ${daysOpen ? 'rotate-180' : ''}`} />
          </button>
          {daysOpen && menuPos && createPortal(
            <div ref={menuRef} dir="rtl" className="fixed z-[1000] w-56 p-1.5 rounded-xl bg-slate-800 border border-slate-600 shadow-2xl text-white"
              style={{ top: menuPos.top, right: menuPos.right }}>
              {DAY_ORDER.map(d => (
                <button key={d} type="button" onClick={() => toggleDay(d)}
                  className="w-full min-h-[38px] px-3 rounded-lg flex items-center justify-between text-sm font-bold hover:bg-slate-700">
                  <span>{DAY_NAMES[d]}</span>
                  <span className={`w-5 h-5 rounded border flex items-center justify-center ${days.includes(d) ? 'bg-blue-600 border-blue-500' : 'border-slate-500'}`}>
                    {days.includes(d) && <Check size={13} />}
                  </span>
                </button>
              ))}
              <div className="grid grid-cols-2 gap-1.5 pt-1.5 mt-1 border-t border-slate-700">
                <button type="button" onClick={() => setDays([0, 1, 2, 3, 4, 5, 6])} className="min-h-[34px] rounded-lg text-xs font-bold bg-slate-900 hover:bg-slate-700">كل الأيام</button>
                <button type="button" onClick={() => setDays([0, 1, 2, 3, 4])} className="min-h-[34px] rounded-lg text-xs font-bold bg-slate-900 hover:bg-slate-700">بلا جمعة وسبت</button>
              </div>
            </div>,
            document.body
          )}
        </div>
        <label className="flex items-center gap-2 min-h-[42px] px-3 rounded-xl bg-slate-900 border border-slate-700 text-sm font-bold cursor-pointer">
          <input type="checkbox" checked={withPending} onChange={e => setWithPending(e.target.checked)} className="w-4 h-4" />
          إظهار المعلّق
        </label>
        <button type="button" onClick={load} disabled={loading} className="ut-btn ut-btn--brand" style={{ minHeight: 42 }}>
          {loading ? <Loader2 size={15} className="animate-spin" /> : <Search size={15} />} عرض التقرير
        </button>
        {matrix && matrix.users.length > 0 && (
          <button type="button" onClick={download} disabled={downloading}
            className="ut-btn text-white" style={{ minHeight: 42, background: '#047857' }}>
            {downloading ? <Loader2 size={15} className="animate-spin" /> : <FileSpreadsheet size={15} />} تنزيل Excel
          </button>
        )}
      </div>

      {error && (
        <div className="p-3 rounded-xl text-sm font-bold border bg-red-900/20 text-red-400 border-red-800/50 flex items-center gap-2">
          <AlertCircle size={16} /> {error}
        </div>
      )}

      {matrix && (matrix.users.length === 0 ? (
        <div className="py-10 text-center text-sm font-bold text-slate-400">لا توجد خطط أو زيارات في هذه الفترة</div>
      ) : (
        <>
          <div className="overflow-auto rounded-2xl border border-slate-700 bg-white" style={{ maxHeight: '65vh' }}>
            <table className="text-sm border-collapse" style={{ minWidth: '100%' }}>
              <thead className="sticky top-0 z-20">
                <tr>
                  <th rowSpan={2} className="sticky right-0 z-30 px-3 py-2 border border-slate-300 font-black text-slate-800" style={{ background: '#C6E0B4' }}>Day</th>
                  <th rowSpan={2} className="px-3 py-2 border border-slate-300 font-black text-slate-800" style={{ background: '#C6E0B4' }}>Date</th>
                  {matrix.users.map(u => (
                    <th key={u.id} className="px-3 py-1.5 border border-slate-300 font-black text-slate-800 whitespace-nowrap" style={{ background: '#C6E0B4' }} title={`${u.serialNumber} · ${u.jobTitle}`}>{u.userName}</th>
                  ))}
                </tr>
                <tr>
                  {matrix.users.map(u => (
                    <th key={u.id} className="px-3 py-1 border border-slate-300 font-bold text-xs text-slate-700 whitespace-nowrap" style={{ background: '#C6E0B4' }}>{u.defaultBranch || '—'}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {matrix.dates.map((d, i) => {
                  const friday = weekdayOf(d) === 5;
                  return (
                    <tr key={d}>
                      <td className="sticky right-0 z-10 px-3 py-1.5 border border-slate-300 font-black text-slate-800 whitespace-nowrap text-center" style={{ background: '#FFC000' }}>{DAY_NAMES[weekdayOf(d)]}</td>
                      <td className="px-3 py-1.5 border border-slate-300 font-black text-slate-800 whitespace-nowrap text-center" style={{ background: '#FFC000' }}>{shortDate(d)}</td>
                      {matrix.cells[i].map((c, j) => (
                        <td key={j} className="px-3 py-1.5 border border-slate-300 font-bold text-center whitespace-pre-line"
                          style={{ background: c ? KIND_STYLE[c.kind].bg : friday ? '#E5E7EB' : '#FFFFFF', color: c ? KIND_STYLE[c.kind].fg : '#1F2937' }}>
                          {c ? c.text : ''}
                        </td>
                      ))}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <div className="flex flex-wrap gap-3 text-xs font-bold text-slate-300">
            {(Object.keys(KIND_STYLE) as Cell['kind'][]).map(k => (
              <span key={k} className="flex items-center gap-1.5">
                <span className="w-4 h-4 rounded border border-slate-500" style={{ background: KIND_STYLE[k].bg }} /> {KIND_STYLE[k].label}
              </span>
            ))}
            <span className="flex items-center gap-1.5"><span className="w-4 h-4 rounded border border-slate-500" style={{ background: '#E5E7EB' }} /> يوم جمعة</span>
          </div>
        </>
      ))}
    </div>
  );
}
