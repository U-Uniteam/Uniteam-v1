/**
 * جلسات الدخول الموقّعة من الخادم.
 *
 * بعد التحديث الأمني لم يعد التطبيق يحمل كلمات مرور ولا قائمة الموظفين:
 * الدخول يتمّ في الخادم (loginEmployee / loginApprover) فيُرجع «جلسة» —
 * نصّاً موقّعاً لا يمكن تزويره — تُرسل مع كل طلب بدل كلمة المرور.
 *
 *   جلسة الموظف   : تبقى ١٨٠ يوماً وتتجدّد تلقائياً. تسقط إن صفّر المسؤول أجهزته أو حذفه.
 *   جلسة المسؤول/المشرف: ٣٠ يوماً وتتجدّد مع الاستعمال. تسقط بتغيير كلمة المرور.
 */

const EMP_KEY = 'uniteam_emp_token';
const APPROVER_KEY = 'uniteam_approver_session';

const read = (k: string): string => { try { return localStorage.getItem(k) || ''; } catch (e) { return ''; } };
const write = (k: string, v: string) => { try { if (v) localStorage.setItem(k, v); else localStorage.removeItem(k); } catch (e) { /* التخزين محجوب */ } };

// ---------------- الموظف ----------------

export const getEmployeeToken = (): string => read(EMP_KEY);
export const setEmployeeToken = (t: string): void => write(EMP_KEY, t || '');
export const clearEmployeeToken = (): void => write(EMP_KEY, '');

// ---------------- المسؤول / المشرف (الجلسة المفتوحة الآن) ----------------

export interface ApproverSession { token: string; user: string; isAdmin: boolean }

export const getApproverSession = (): ApproverSession | null => {
  try {
    const v = JSON.parse(read(APPROVER_KEY) || 'null');
    return v && typeof v.token === 'string' && v.token ? v : null;
  } catch (e) { return null; }
};
export const getApproverToken = (): string => getApproverSession()?.token || '';
export const setApproverSession = (s: ApproverSession | null): void => write(APPROVER_KEY, s && s.token ? JSON.stringify(s) : '');
/** تحديث الجلسة المفتوحة بجلسة مجدَّدة أرسلها الخادم */
export const renewApproverToken = (token?: string): void => {
  const cur = getApproverSession();
  if (cur && token && token !== cur.token) setApproverSession({ ...cur, token });
};

// ---------------- مصدر التسجيل ----------------

/** يظهر في التقارير فقط (أندرويد · ويندوز · متصفح) ولا يمنع شيئاً */
export const getClientSource = (): 'android' | 'windows' | 'browser' => {
  const w = window as any;
  if (w.AndroidBridge && typeof w.AndroidBridge.getAndroidId === 'function') return 'android';
  if (w.UniteamDesktop && typeof w.UniteamDesktop.getDeviceId === 'function') return 'windows';
  return 'browser';
};

// ---------------- اتصال الخادم ----------------

/** POST نصّي بلا preflight وقراءة JSON — يرمي عند الشبكة أو ردّ غير مفهوم */
export async function postJson(url: string, payload: Record<string, any>, timeoutMs = 20000): Promise<any> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify(payload),
      signal: controller.signal
    });
    if (res.status === 404) throw new Error('SERVER_404');
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const text = (await res.text()).trim();
    if (!text || text.startsWith('<')) throw new Error('INVALID_RESPONSE');
    if (text.startsWith('Error: Unknown action')) throw new Error('OLD_SERVER');
    try { return JSON.parse(text); } catch { throw new Error('INVALID_RESPONSE'); }
  } finally {
    clearTimeout(timer);
  }
}

/** رسالة عربية موحّدة لأخطاء الاتصال */
export const describeNetError = (err: any): string => {
  if (err?.name === 'AbortError') return 'الشبكة بطيئة ولم يصل الردّ. حاول مجدداً.';
  if (err?.message === 'SERVER_404') return 'رابط الشركة غير صحيح أو تم حذفه من السيرفر (404). راجع المسؤول.';
  if (err?.message === 'INVALID_RESPONSE') return 'الرابط المسجل لا يؤدي إلى كود النظام. راجع المسؤول.';
  if (err?.message === 'OLD_SERVER') return 'كود الخادم لم يُحدَّث بعد. انشر آخر نسخة من كود Apps Script.';
  return 'تعذّر الاتصال بالخادم. تأكد من الإنترنت وحاول مجدداً.';
};

/** دخول المسؤول/المشرف بكلمة المرور أو بجلسة محفوظة — يُرجع ردّ الخادم كما هو */
export async function loginApprover(url: string, creds: { user?: string; pass?: string; token?: string }):
  Promise<{ ok: boolean; token?: string; isAdmin?: boolean; name?: string; error?: string; authExpired?: boolean; network?: boolean }> {
  try {
    return await postJson(url, creds.token
      ? { action: 'loginApprover', approverToken: creds.token }
      : { action: 'loginApprover', approverUser: creds.user, approverPass: creds.pass });
  } catch (e) {
    return { ok: false, network: true, error: describeNetError(e) };
  }
}
