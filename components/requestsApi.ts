import { getEgyptTime, getDeviceFingerprint, getRealNetworkTime } from '../utils';
import { getEmployeeToken } from './session';
import type { StaffRequest, RequestStatus, PlanDay, LeaveDetails, Job } from '../types';

/**
 * الاتصال بالخادم لإجراءات الطلبات + دوال التاريخ المشتركة بين شاشة الموظف
 * وشاشة المدير. ملف صغير بلا واجهة، فيبقى في الملف الرئيسي دون أن يثقله.
 */

const REQUEST_TIMEOUT_MS = 25000;

export interface ApiResult {
  ok: boolean;
  error?: string;
  requests?: StaffRequest[];
  request?: StaffRequest;
  today?: string;
  canPlan?: boolean;
  approver?: string;
  /** الجلسة انتهت أو أُلغيت — يلزم الدخول مجدداً */
  authExpired?: boolean;
}

/** إرسال إجراء طلبات وقراءة ردّ JSON — الأخطاء تعود رسالة عربية جاهزة للعرض */
export async function postRequestAction(url: string, payload: Record<string, any>): Promise<ApiResult> {
  if (!url) return { ok: false, error: 'التطبيق غير مربوط بالسحابة. راجع المسؤول.' };
  if (!navigator.onLine) return { ok: false, error: 'لا يوجد اتصال بالإنترنت.' };

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify(payload),
      signal: controller.signal
    });
    const text = (await res.text()).trim();
    if (!res.ok || text.startsWith('<')) {
      return { ok: false, error: 'الخادم ردّ بخطأ مؤقت. حاول مرة أخرى بعد قليل.' };
    }
    if (text.startsWith('Error: Unknown action')) {
      return { ok: false, error: 'كود الخادم لم يُحدَّث بعد لدعم هذه الميزة. انشر آخر نسخة من كود Apps Script.' };
    }
    try {
      return JSON.parse(text) as ApiResult;
    } catch {
      return { ok: false, error: 'ردّ غير متوقع من الخادم.' };
    }
  } catch (e: any) {
    return {
      ok: false,
      error: e?.name === 'AbortError'
        ? 'الشبكة بطيئة ولم يصل الردّ. حاول مجدداً — لن يتكرر الطلب.'
        : 'تعذّر الاتصال بالخادم. تأكد من الإنترنت.'
    };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * هوية الموظف الحالي لطلبات الخادم: الجلسة الموقّعة. الرقم القومي والجهاز
 * يرافقانها احتياطاً فقط — يقبلهما الخادم خلال فترة الانتقال وحدها.
 */
export function employeeAuth(nationalId: string) {
  return { token: getEmployeeToken(), nationalId, deviceId: getDeviceFingerprint() };
}

/** الجلسة المفتوحة على التطبيق انتهت — App.tsx يُخرج المستخدم إلى شاشة الدخول */
export function signalSessionExpired(message?: string) {
  try { window.dispatchEvent(new CustomEvent('uniteam:session-expired', { detail: message || '' })); } catch (e) { /* بيئة بلا نوافذ */ }
}

// ---------------- التاريخ ----------------
// كل التواريخ نصوص YYYY-MM-DD، والحساب بـ UTC حتى لا تزيح المنطقة الزمنية يوماً.

export function todayIso(): string {
  const d = getEgyptTime();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export function addDaysIso(iso: string, n: number): string {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}

/** 0 = الأحد … 6 = السبت — نفس ترقيم أيام العمل في إعدادات الوظائف */
export function weekdayOf(iso: string): number {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

export function monthOf(iso: string): string {
  return iso.slice(0, 7);
}

export function lastDayOfMonth(month: string): string {
  const [y, m] = month.split('-').map(Number);
  return new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
}

export function addMonths(month: string, n: number): string {
  const [y, m] = month.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1 + n, 1)).toISOString().slice(0, 7);
}

const DEFAULT_WORKING_DAYS = [0, 1, 2, 3, 4, 6]; // الجمعة عطلة — نفس افتراض لوحة الإدارة

export function workingDaysFor(jobs: Job[], jobTitle?: string): number[] {
  const job = jobs.find(j => j.title === jobTitle);
  return job?.workingDays && job.workingDays.length ? job.workingDays : DEFAULT_WORKING_DAYS;
}

export function jobCanPlan(jobs: Job[], jobTitle?: string): boolean {
  return !!jobs.find(j => j.title === jobTitle)?.canVisitMultipleBranches;
}

export function isWorkingDay(iso: string, workingDays: number[], holidays: string[]): boolean {
  return workingDays.includes(weekdayOf(iso)) && !holidays.includes(iso);
}

/**
 * أول يوم عمل بعد التاريخ المعطى (أو هو نفسه إن inclusive) داخل الشهر.
 * يتخطى العطلة الأسبوعية للوظيفة والإجازات الرسمية. يعيد null عند نهاية الشهر.
 */
export function nextWorkingDay(iso: string, workingDays: number[], holidays: string[], inclusive = false): string | null {
  const month = monthOf(iso);
  let d = inclusive ? iso : addDaysIso(iso, 1);
  for (let i = 0; i < 40; i++) {
    if (monthOf(d) !== month) return null;
    if (isWorkingDay(d, workingDays, holidays)) return d;
    d = addDaysIso(d, 1);
  }
  return null;
}

const DAY_FMT = new Intl.DateTimeFormat('ar-EG-u-nu-latn', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' });
const MONTH_FMT = new Intl.DateTimeFormat('ar-EG-u-nu-latn', { month: 'long', year: 'numeric', timeZone: 'UTC' });
const SHORT_FMT = new Intl.DateTimeFormat('ar-EG-u-nu-latn', { day: 'numeric', month: 'short', timeZone: 'UTC' });

const toUtc = (iso: string) => { const [y, m, d] = iso.split('-').map(Number); return new Date(Date.UTC(y, m - 1, d || 1)); };

export const formatDay = (iso: string) => (iso ? DAY_FMT.format(toUtc(iso)) : '');
export const formatShort = (iso: string) => (iso ? SHORT_FMT.format(toUtc(iso)) : '');
export const formatMonth = (month: string) => (month ? MONTH_FMT.format(toUtc(month + '-01')) : '');

export function daysBetween(from: string, to: string): number {
  return Math.round((toUtc(to).getTime() - toUtc(from).getTime()) / 86400000) + 1;
}

// ---------------- الحالة ----------------

export const STATUS_META: Record<RequestStatus, { label: string; chip: string }> = {
  pending:   { label: 'بانتظار الموافقة', chip: 'ut-chip ut-chip--warn' },
  approved:  { label: 'تمت الموافقة',     chip: 'ut-chip ut-chip--ok' },
  modified:  { label: 'موافقة مع تعديل',  chip: 'ut-chip ut-chip--brand' },
  rejected:  { label: 'مرفوض',            chip: 'ut-chip ut-chip--bad' },
  cancelled: { label: 'ملغى',              chip: 'ut-chip' }
};

export const LEAVE_TYPES = ['اعتيادية', 'عارضة', 'مرضية', 'أخرى'];

export const asPlan = (v: StaffRequest['items'] | null | undefined): PlanDay[] => (Array.isArray(v) ? v : []);
export const asLeave = (v: StaffRequest['items'] | null | undefined): LeaveDetails | null =>
  v && !Array.isArray(v) ? (v as LeaveDetails) : null;

/** قرارات المدير التي لم يرها الموظف بعد — لشارة التبويب */
const seenKey = (userId: string) => `uniteam_req_seen_${userId}`;

export function unseenDecisions(userId: string, requests: StaffRequest[]): number {
  let seen = '';
  try { seen = localStorage.getItem(seenKey(userId)) || ''; } catch { /* التخزين محجوب */ }
  return requests.filter(r => r.decidedAt && r.decidedBy !== 'الموظف' && r.decidedAt > seen).length;
}

export function markDecisionsSeen(userId: string) {
  try { localStorage.setItem(seenKey(userId), getRealNetworkTime().toISOString()); } catch { /* التخزين محجوب */ }
}

/** «يوم» بالعدد الصحيح: يوم واحد · يومان · ٣ أيام · ١١ يوماً */
export function dayCount(n: number): string {
  if (n === 1) return 'يوم واحد';
  if (n === 2) return 'يومان';
  if (n >= 3 && n <= 10) return `${n} أيام`;
  return `${n} يوماً`;
}
