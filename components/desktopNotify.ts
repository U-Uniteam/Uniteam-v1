import { postRequestAction } from './requestsApi';
import { getSavedLogin, setSavedLogin, clearSavedLogin, isDesktopApp, desktopInvoke, SavedLoginKind } from '../utils';
import { loginApprover } from './session';
import type { StaffRequest, LeaveDetails } from '../types';

/**
 * إشعارات طلبات الموظفين — تطبيق ويندوز فقط.
 *
 * يفحص الطلبات كل دقيقتين بحسابات المدير/المشرف المتاحة على الجهاز:
 * الجلسة المفتوحة الآن، وبيانات «تذكرني» المحفوظة. كل حساب يرى موظفيه فقط
 * (نفس صلاحيات getApproverRequests في الخادم)، فلا يصل المشرف إلا ما يخصّه.
 *
 * يعمل ما دام التطبيق يعمل — مفتوحاً أو مصغّراً أو بجانب الساعة.
 * الإشعار نفسه يُعرض من غلاف ويندوز (أمر notify في native/windows/src/main.rs).
 */

const POLL_MS = 2 * 60 * 1000;
const FIRST_DELAY_MS = 15 * 1000;
const SEEN_KEY = 'uniteam_notified_requests';

interface ApproverCred { user: string; token: string }
let sessionApprover: ApproverCred | null = null;

/** يُستدعى عند دخول حساب تقارير/مسؤول وعند خروجه — الجلسة لا كلمة المرور */
export const setSessionApprover = (c: { user: string; token: string } | null): void => {
  sessionApprover = c && c.user && c.token ? { user: c.user, token: c.token } : null;
};

const RENEW_MS = 6 * 60 * 60 * 1000;
const lastRenew: Record<string, number> = {};

/**
 * جلسات «تذكرني» المحفوظة: القديمة التي تحمل كلمة مرور تُستبدل بجلسة مرة واحدة،
 * والجلسات تُجدَّد كل بضع ساعات حتى لا تنتهي ما دام التطبيق يعمل.
 */
const savedCred = async (url: string, kind: SavedLoginKind): Promise<ApproverCred | null> => {
  const saved = getSavedLogin(kind);
  if (!saved) return null;
  const due = !saved.token || Date.now() - (lastRenew[kind] || 0) > RENEW_MS;
  if (!due) return { user: saved.user, token: saved.token! };
  const r = await loginApprover(url, saved.token ? { token: saved.token } : { user: saved.user, pass: saved.pass });
  if (r.network) return saved.token ? { user: saved.user, token: saved.token } : null;
  if (!r.ok || !r.token) { clearSavedLogin(kind); return null; }
  lastRenew[kind] = Date.now();
  if (r.token !== saved.token) setSavedLogin(kind, saved.user, r.token);
  return { user: saved.user, token: r.token };
};

const credentials = async (url: string): Promise<ApproverCred[]> => {
  const all = [sessionApprover, await savedCred(url, 'reports'), await savedCred(url, 'admin')];
  const out: ApproverCred[] = [];
  all.forEach(c => { if (c && !out.some(x => x.token === c.token)) out.push(c); });
  return out;
};

const readSeen = (): Record<string, string> | null => {
  try {
    const raw = localStorage.getItem(SEEN_KEY);
    if (!raw) return null;
    const v = JSON.parse(raw);
    return v && typeof v === 'object' ? v : null;
  } catch (e) { return null; }
};

const writeSeen = (v: Record<string, string>) => {
  try { localStorage.setItem(SEEN_KEY, JSON.stringify(v)); } catch (e) { /* التخزين محجوب */ }
};

const describe = (r: StaffRequest): string => {
  if (r.type === 'leave') {
    const l = (r.items || {}) as LeaveDetails;
    return `إجازة${l.leaveType ? ' ' + l.leaveType : ''} من ${l.from || '—'} إلى ${l.to || '—'}`;
  }
  return `خطة شهر ${r.month}`;
};

const notify = (title: string, body: string) => desktopInvoke('notify', { title, body });

/** العلامة الحمراء على أيقونة الساعة وزر شريط المهام = عدد الطلبات المعلّقة (0 يُخفيها) */
const setBadge = (count: number) => desktopInvoke('set_badge', { count: Math.max(0, Math.floor(count)) });

let runNow: (() => void) | null = null;
// العلامة يملكها فحص المدير فقط إن وضعها هو — حتى لا يمسح علامة قرارات الموظف على نفس الجهاز
let managerOwnsBadge = false;

/** فحص فوري خارج الموعد — بعد موافقة المدير أو رفضه، لتختفي العلامة دون انتظار */
export const refreshDesktopNotifier = (): void => { if (runNow) runNow(); };

/** يبدأ الفحص الدوري ويعيد دالة الإيقاف. لا يفعل شيئاً خارج تطبيق ويندوز */
export function startDesktopNotifier(getSyncUrl: () => string): () => void {
  if (!isDesktopApp()) return () => {};

  let stopped = false;
  let running = false;

  const tick = async () => {
    if (stopped || running) return;
    running = true;
    try {
      const url = getSyncUrl();
      const creds = url && navigator.onLine ? await credentials(url) : [];
      if (!url || creds.length === 0) {
        if (managerOwnsBadge) { managerOwnsBadge = false; await setBadge(0); }
        return;
      }
      if (!navigator.onLine) return;

      const all = new Map<string, StaffRequest>();
      let anyOk = false;
      for (const c of creds) {
        const res = await postRequestAction(url, { action: 'getApproverRequests', approverToken: c.token });
        if (res.ok) {
          anyOk = true;
          (res.requests || []).forEach(r => all.set(r.id, r));
        }
      }
      if (!anyOk || stopped) return;

      const seen = readSeen();
      const next: Record<string, string> = {};
      all.forEach(r => { next[r.id] = r.submittedAt; });
      writeSeen(next);

      const pending = Array.from(all.values()).filter(r => r.status === 'pending');
      managerOwnsBadge = true;
      await setBadge(pending.length);

      // أول تشغيل على هذا الجهاز: ملخّص واحد بدل سيل إشعارات قديمة
      if (!seen) {
        if (pending.length > 0) {
          await notify('Uniteam — طلبات بانتظار المراجعة', `لديك ${pending.length} طلب معلّق من الموظفين.`);
        }
        return;
      }

      const fresh = pending.filter(r => seen[r.id] !== r.submittedAt);
      if (fresh.length === 0) return;

      if (fresh.length > 3) {
        await notify('Uniteam — طلبات جديدة', `وصل ${fresh.length} طلبات جديدة أو معدّلة من الموظفين.`);
        return;
      }
      for (const r of fresh) {
        const edited = seen[r.id] !== undefined;
        const title = edited ? `✏️ تعديل طلب — ${r.userName}` : `🆕 طلب جديد — ${r.userName}`;
        const who = [r.serialNumber, r.jobTitle].filter(Boolean).join(' · ');
        await notify(title, `${describe(r)}${who ? '\n' + who : ''}`);
      }
    } catch (e) {
      console.warn('desktop notifier tick failed', e);
    } finally {
      running = false;
    }
  };

  const first = setTimeout(tick, FIRST_DELAY_MS);
  const timer = setInterval(tick, POLL_MS);
  runNow = () => { void tick(); };
  return () => { stopped = true; runNow = null; clearTimeout(first); clearInterval(timer); };
}

// ---------------- قرارات المدير للموظف (تطبيق ويندوز) ----------------

const DECISION_LABEL: Record<string, string> = {
  approved: '✅ وافق المدير على',
  modified: '✏️ وافق المدير مع تعديل على',
  rejected: '❌ رفض المدير',
};

/**
 * يُستدعى من شاشة الموظف بعد كل فحص لطلباته. يُظهر إشعار ويندوز لكل قرار جديد
 * (موافقة · موافقة مع تعديل · رفض) ويضع العلامة الحمراء بعدد القرارات غير المقروءة.
 * أول تشغيل على الجهاز يُسجّل القرارات الموجودة دون سيل إشعارات قديمة.
 */
export async function notifyEmployeeDecisions(userId: string, requests: StaffRequest[], unseen: number): Promise<void> {
  if (!isDesktopApp()) return;
  const key = 'uniteam_notified_decisions_' + userId;
  let seen: Record<string, string> | null = null;
  try { const raw = localStorage.getItem(key); seen = raw ? JSON.parse(raw) : null; } catch (e) { seen = null; }

  const decided = requests.filter(r => r.decidedAt && r.decidedBy !== 'الموظف' && DECISION_LABEL[r.status]);
  const next: Record<string, string> = {};
  decided.forEach(r => { next[r.id] = r.decidedAt || ''; });
  try { localStorage.setItem(key, JSON.stringify(next)); } catch (e) { /* التخزين محجوب */ }

  await setBadge(unseen);
  if (!seen) return;

  const fresh = decided.filter(r => seen![r.id] !== r.decidedAt);
  if (fresh.length > 3) {
    await notify('Uniteam — قرارات جديدة', `وصلت ${fresh.length} قرارات جديدة على طلباتك. افتح «طلباتي».`);
    return;
  }
  for (const r of fresh) {
    const what = r.type === 'plan' ? `خطة شهر ${r.month}` : (() => {
      const l = (r.approvedItems || r.items || {}) as LeaveDetails;
      return `إجازتك من ${l.from || '—'} إلى ${l.to || '—'}`;
    })();
    const verb = DECISION_LABEL[r.status];
    const title = `${verb} ${r.type === 'plan' ? 'خطتك' : 'إجازتك'}`;
    await notify(title, `${what}${r.managerNote ? '\nملاحظة المدير: ' + r.managerNote : ''}`);
  }
}

/** إخفاء العلامة عند قراءة الموظف لطلباته */
export const clearDesktopBadge = (): void => { void setBadge(0); };
