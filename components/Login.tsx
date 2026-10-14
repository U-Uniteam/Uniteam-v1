
import React, { useState, useRef } from 'react';
import { User, AppConfig, Job, Branch } from '../types';
import { UserPlus, LogIn, LogOut, ShieldAlert, Briefcase, Loader2, Link as LinkIcon, Smartphone, AlertCircle, WifiOff, MapPin, Eye, EyeOff, FileSpreadsheet, ArrowRight, KeyRound } from 'lucide-react';
import { getDeviceFingerprint, getSavedLogin, setSavedLogin, clearSavedLogin } from '../utils';
import { postJson, describeNetError, setEmployeeToken, setApproverSession, loginApprover } from './session';
import { LogoMark } from './Logo';
// التقارير تُحمَّل عند فتح تبويبها فقط — انظر LazyScreens.tsx
import { LazyReportsView, ScreenLoader } from './LazyScreens';

/** مهلة انتظار ردّ الخادم: أول تشغيل لخادم جوجل بعد فترة خمول قد يأخذ ثوانيَ طويلة */
const REGISTER_TIMEOUT_MS = 45000;
const LOGIN_TIMEOUT_MS = 30000;

interface LoginProps {
  onLogin: (user: User) => void;
  adminConfig: AppConfig;
  availableJobs: Job[];
  branches: Branch[];
  setAdminConfig: (cfg: Partial<AppConfig>) => void;
  logAction: (action: string, details?: string) => void;
  /** الرابط معامل إلزامي — تمرير undefined كان يُخرج الدالة فوراً بلا أثر */
  onSync?: (url: string, force?: boolean, timeoutMs?: number) => Promise<any | null>;
  /** يفتح شاشة التقارير كصفحة مستقلة أو داخلية */
  onOpenReports?: () => void;
  /** رسالة تظهر أعلى الشاشة — مثل «انتهت جلسة الدخول» */
  notice?: string;
}

export default function Login({ 
  onLogin, 
  adminConfig, 
  availableJobs, 
  branches, 
  setAdminConfig,
  logAction,
  onSync,
  onOpenReports,
  notice
}: LoginProps) {
  const [mode, setMode] = useState<'register' | 'login' | 'admin' | 'reports'>('login');
  const [isReportsLoggedIn, setIsReportsLoggedIn] = useState(false);
  const reportsLogoutRef = useRef<(() => void) | null>(null);
  const [fullName, setFullName] = useState('');
  const [nationalId, setNationalId] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [selectedJob, setSelectedJob] = useState('');
  const [defaultBranch, setDefaultBranch] = useState('');
  // «تذكرني»: تُملأ بيانات المسؤول المحفوظة على هذا الجهاز تلقائياً
  const [savedAdmin] = useState(() => getSavedLogin('admin'));
  const [adminUsername, setAdminUsername] = useState(savedAdmin?.user || '');
  // كلمة المرور لا تُحفظ — المحفوظ جلسة. خانة فارغة + جلسة محفوظة = دخول بالجلسة
  const [adminPassword, setAdminPassword] = useState('');
  const [rememberAdmin, setRememberAdmin] = useState(!!savedAdmin);
  const [error, setError] = useState('');
  const [info, setInfo] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [showRegPassword, setShowRegPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [showLoginPassword, setShowLoginPassword] = useState(false);
  const [showAdminPassword, setShowAdminPassword] = useState(false);

  // ---------- استعادة كلمة المرور ----------
  // شاشة من خطوتين: تحقّق من الهوية والجهاز، ثم تعيين كلمة جديدة.
  // التحقق كله في الخادم — القائمة المحلية لا يُعتمد عليها هنا.
  const [showRecovery, setShowRecovery] = useState(false);
  const [recStep, setRecStep] = useState<1 | 2>(1);
  const [recNationalId, setRecNationalId] = useState('');
  const [recNewPass, setRecNewPass] = useState('');
  const [recConfirmPass, setRecConfirmPass] = useState('');
  const [recShowPass, setRecShowPass] = useState(false);
  const [recVerifiedName, setRecVerifiedName] = useState('');
  const [recError, setRecError] = useState('');
  const [recSuccess, setRecSuccess] = useState('');
  const [recLoading, setRecLoading] = useState(false);

  const closeRecovery = () => {
    setShowRecovery(false);
    setRecStep(1);
    setRecNationalId('');
    setRecNewPass('');
    setRecConfirmPass('');
    setRecVerifiedName('');
    setRecError('');
    setRecSuccess('');
  };

  /** نداء الخادم لإجراء الاستعادة الذاتية — بلا no-cors ليُقرأ الردّ فعلاً */
  const callRecovery = async (newPassword?: string) => {
    const response = await fetch(adminConfig.syncUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({
        action: 'resetPasswordSelf',
        nationalId: recNationalId.trim(),
        deviceId: getDeviceFingerprint(),
        newPassword: newPassword
      })
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const text = await response.text();
    if (!text || text.trim().startsWith('<')) throw new Error('INVALID_RESPONSE');
    return text.trim();
  };

  /** الخطوة الأولى: التحقق من الهوية والجهاز بلا كتابة أي شيء */
  const handleRecoveryVerify = async (e: React.FormEvent) => {
    e.preventDefault();
    setRecError('');

    if (!navigator.onLine) {
      setRecError('لا يمكن استعادة كلمة المرور والجهاز غير متصل بالإنترنت.');
      return;
    }
    if (!adminConfig.syncUrl) {
      setRecError('التطبيق غير مربوط بالسحابة. راجع المسؤول.');
      return;
    }
    if (!recNationalId.trim()) {
      setRecError('يرجى إدخال الرقم القومي.');
      return;
    }

    setRecLoading(true);
    try {
      const text = await callRecovery();
      if (text.startsWith('Verified:')) {
        setRecVerifiedName(text.replace('Verified:', '').trim());
        setRecStep(2);
        logAction('طلب استعادة كلمة مرور', `الرقم القومي: ${recNationalId.trim()}`);
      } else {
        setRecError(text.replace(/^Error:\s*/, ''));
        logAction('فشل التحقق لاستعادة كلمة المرور', `الرقم القومي: ${recNationalId.trim()} | ${text}`);
      }
    } catch (err: any) {
      setRecError(
        err.message === 'INVALID_RESPONSE'
          ? 'رابط الشركة لا يؤدي إلى كود النظام. راجع المسؤول.'
          : 'تعذر الاتصال بالخادم. تأكد من الإنترنت وحاول مجدداً.'
      );
    } finally {
      setRecLoading(false);
    }
  };

  /** الخطوة الثانية: تعيين كلمة المرور الجديدة */
  const handleRecoverySubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setRecError('');

    const pass = recNewPass.trim();
    if (pass.length < 6) { setRecError('كلمة المرور يجب ألا تقل عن ٦ خانات.'); return; }
    if (pass.startsWith('0')) { setRecError('كلمة المرور لا يمكن أن تبدأ بصفر.'); return; }
    if (pass !== recConfirmPass.trim()) { setRecError('كلمتا المرور غير متطابقتين.'); return; }

    setRecLoading(true);
    try {
      const text = await callRecovery(pass);
      if (text.includes('Password Reset Successfully')) {
        setRecSuccess('تم تغيير كلمة المرور بنجاح. يمكنك الدخول بها الآن.');
        logAction('نجاح استعادة كلمة المرور', `الموظف: ${recVerifiedName}`);
        setNationalId(recNationalId.trim());
        setTimeout(closeRecovery, 2200);
      } else {
        setRecError(text.replace(/^Error:\s*/, ''));
      }
    } catch (err: any) {
      setRecError(
        err.message === 'INVALID_RESPONSE'
          ? 'رابط الشركة لا يؤدي إلى كود النظام. راجع المسؤول.'
          : 'تعذر الاتصال بالخادم. تأكد من الإنترنت وحاول مجدداً.'
      );
    } finally {
      setRecLoading(false);
    }
  };

  const handleRegister = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    
    if (!navigator.onLine) {
      setError('عذراً، لا يمكن إتمام عملية التسجيل والجهاز غير متصل بالإنترنت.');
      logAction('فشل تسجيل مستخدم جديد', 'السبب: الجهاز غير متصل بالإنترنت');
      return;
    }

    if (!fullName || !nationalId || !password || !confirmPassword || !selectedJob || !defaultBranch) {
      setError('يرجى إكمال جميع البيانات واختيار الوظيفة والفرع الأساسي');
      return;
    }
    if (password !== confirmPassword) {
      setError('كلمة المرور وتأكيد كلمة المرور غير متطابقين');
      return;
    }
    if (nationalId.length !== 14) {
      setError('الرقم القومي يجب أن يكون 14 رقماً');
      return;
    }
    if (password.length < 6) {
      setError('كلمة المرور يجب ألا تقل عن 6 أرقام/حروف');
      return;
    }
    if (password.startsWith('0')) {
      setError('كلمة المرور لا يمكن أن تبدأ بالرقم صفر (0) أو تكون أصفاراً فقط .');
      return;
    }

    // بلا رابط سحابة لا وجود لحساب أصلاً
    const url = adminConfig.googleSheetLink || adminConfig.syncUrl;
    if (!url) {
      setError('التطبيق غير مربوط بالسحابة، ولا يمكن إنشاء حساب الآن. راجع المسؤول.');
      return;
    }

    // كل الشروط (تكرار الرقم القومي، الجهاز المربوط بموظف آخر، الوظيفة والفرع)
    // يفحصها الخادم — التطبيق لم يعد يملك قائمة الموظفين.
    const branchObj = branches.find(b => b.id === defaultBranch);
    setIsLoading(true);
    let res: any;
    try {
      res = await postJson(url, {
        action: 'registerUser',
        fullName: fullName.trim(),
        nationalId,
        password,
        jobTitle: selectedJob,
        defaultBranchId: branchObj ? branchObj.name : defaultBranch,
        deviceId: getDeviceFingerprint()
      }, REGISTER_TIMEOUT_MS);
    } catch (err: any) {
      // انقطع الردّ — لكن الخادم ربما أنشأ الحساب فعلاً (يحدث مع بطء الشبكة أو أول
      // تشغيل للخادم). نتحقّق بالدخول بنفس البيانات بدل إعلان فشل قد يكون غير صحيح.
      try {
        res = await postJson(url, {
          action: 'loginEmployee', nationalId, password, deviceId: getDeviceFingerprint()
        }, LOGIN_TIMEOUT_MS);
        if (res && !res.ok && !res.pending) res = null; // لم يُنشأ الحساب فعلاً
      } catch { res = null; }
      if (!res) {
        setIsLoading(false);
        const msg = describeNetError(err);
        setError('لم يصل تأكيد من الخادم. ' + msg + ' إن ضغطت «تسجيل» مرة أخرى بنفس البيانات فلن يتكرر الحساب.');
        logAction('تسجيل مستخدم جديد بلا تأكيد', `السبب: ${msg}`);
        return;
      }
    }
    setIsLoading(false);

    if (!res || (!res.ok && !res.pending)) {
      setError('لم يُنشأ الحساب: ' + ((res && res.error) || 'ردّ غير متوقع من الخادم.'));
      logAction('فشل تسجيل مستخدم جديد', `رفض الخادم: ${(res && res.error) || ''}`);
      return;
    }

    logAction('تسجيل مستخدم جديد', `الموظف: ${fullName}, الوظيفة: ${selectedJob}${res.pending ? ' (بانتظار الموافقة)' : ''}`);

    if (res.pending) {
      // وضع «التسجيل بموافقة المسؤول»: الحساب أُنشئ ولا يعمل حتى يقبله
      setPassword(''); setConfirmPassword('');
      setMode('login');
      setInfo('تم إنشاء حسابك وهو بانتظار موافقة المسؤول. ادخل بعد قبوله بنفس الرقم القومي وكلمة المرور.');
      return;
    }

    setEmployeeToken(res.token);
    onLogin({ ...res.user, role: 'employee' });
  };

  const handleEmployeeLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(''); setInfo('');

    if (!navigator.onLine) {
      setError('عذراً، لا يمكن تسجيل الدخول والجهاز غير متصل بالإنترنت.');
      return;
    }
    const url = adminConfig.syncUrl || adminConfig.googleSheetLink;
    if (!url) {
      setError('التطبيق غير مربوط بالسحابة. راجع المسؤول.');
      return;
    }
    const trimmedNId = nationalId.trim();
    if (!trimmedNId || !password.trim()) {
      setError('اكتب الرقم القومي وكلمة المرور.');
      return;
    }

    // التحقق كله في الخادم: كلمة المرور، الجهاز المربوط بموظف آخر، حدّ الأجهزة،
    // وربط هذا الجهاز إن كان في حصّة الموظف مكان.
    setIsLoading(true);
    let res: any;
    try {
      res = await postJson(url, {
        action: 'loginEmployee',
        nationalId: trimmedNId,
        password: password.trim(),
        deviceId: getDeviceFingerprint()
      }, LOGIN_TIMEOUT_MS);
    } catch (err: any) {
      setIsLoading(false);
      setError(describeNetError(err));
      logAction('فشل تسجيل دخول موظف', `الرقم القومي: ${trimmedNId} | ${err?.message || ''}`);
      return;
    }
    setIsLoading(false);

    if (!res || !res.ok || !res.token) {
      setError((res && res.error) || 'بيانات الدخول غير صحيحة، تأكد من الرقم القومي وكلمة المرور.');
      logAction('فشل تسجيل دخول موظف', `الرقم القومي: ${trimmedNId} | ${(res && res.error) || ''}`);
      return;
    }

    setEmployeeToken(res.token);
    const user: User = { ...res.user, role: 'employee' };
    logAction(res.newDevice ? 'تسجيل دخول موظف (ربط جهاز جديد)' : 'تسجيل دخول موظف',
      `الموظف: ${user.fullName}${res.newDevice ? ', الجهاز: ' + getDeviceFingerprint() : ''}`);
    onLogin(user);
  };

  const handleAdminSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    const user = adminUsername.trim();
    const pass = adminPassword.trim();
    const url = adminConfig.syncUrl || adminConfig.googleSheetLink;
    if (!url) { setError('التطبيق غير مربوط بالسحابة. راجع المسؤول.'); return; }
    // بلا كلمة مرور: الدخول بالجلسة المحفوظة («تذكرني») إن كانت لنفس الاسم
    const useSaved = !pass && savedAdmin?.token && savedAdmin.user === user;
    if (!user || (!pass && !useSaved)) { setError('اكتب اسم المستخدم وكلمة المرور.'); return; }

    setIsLoading(true);
    const res = await loginApprover(url, useSaved ? { token: savedAdmin!.token } : { user, pass });
    setIsLoading(false);

    if (!res.ok || !res.token || !res.isAdmin) {
      if (useSaved && !res.network) clearSavedLogin('admin');
      logAction('فشل تسجيل دخول مسؤول', `الحساب: ${user}`);
      setError(res.network ? (res.error || 'تعذّر الاتصال بالخادم.')
        : res.ok ? 'هذا الحساب ليس حساب المسؤول.'
        : useSaved ? 'انتهت الجلسة المحفوظة. اكتب كلمة المرور.'
        : (res.error || 'بيانات دخول المسؤول غير صحيحة.'));
      return;
    }

    setApproverSession({ token: res.token, user, isAdmin: true });
    if (rememberAdmin) setSavedLogin('admin', user, res.token);
    else clearSavedLogin('admin');
    setAdminPassword('');
    logAction('تسجيل دخول مسؤول', `المسؤول: ${user}`);
    onLogin({ id: 'admin-id', fullName: 'المسؤول', nationalId: '000', role: 'admin' });
  };

  const inputClasses = "w-full px-4 py-3.5 rounded-2xl border border-slate-600 bg-slate-900 text-white placeholder:text-slate-500 font-bold outline-none focus:border-blue-500 transition-all shadow-inner";

  const TABS: { id: 'login' | 'register' | 'admin' | 'reports'; label: string; icon: any; desc: string }[] = [
    { id: 'login',    label: 'دخول الموظف', icon: LogIn,       desc: 'سجّل حضورك وانصرافك' },
    { id: 'register', label: 'حساب جديد',   icon: UserPlus,    desc: 'أنشئ حسابك لأول مرة' },
    { id: 'admin',    label: 'الإدارة',      icon: ShieldAlert, desc: 'لوحة تحكم المسؤول' },
    { id: 'reports',  label: 'التقارير',    icon: FileSpreadsheet, desc: 'عرض وتصدير سجلات الحضور والانصراف' }
  ];

  const showSidebar = !(mode === 'reports' && isReportsLoggedIn);

  return (
    <div className={`login-shell login-shell--reports-full ${mode === 'reports' ? (isReportsLoggedIn ? '!max-w-none !w-full !grid-cols-1' : 'max-w-6xl') : ''}`}>

      {/* ===================== القائمة الجانبية ===================== */}
      {showSidebar && (
        <aside className="login-side">
          <div className="login-side__head">
            <div className="flex justify-center mb-3">
              <LogoMark size={132} variant="full" />
            </div>
            <div className="login-side__sub">نظام الحضور والانصراف</div>
          </div>

          <nav className="login-side__nav">
            {TABS.filter(t => t.id !== 'reports').map(t => (
              <button
                key={t.id}
                type="button"
                onClick={() => { setMode(t.id); setError(''); }}
                className={`login-tab${mode === t.id ? ' login-tab--active' : ''}`}
              >
                <t.icon size={17} className="login-tab__icon" />
                <span>{t.label}</span>
              </button>
            ))}

            {/* فاصل وسُمة مميزة لبند التقارير */}
            <div className="my-2 border-t border-slate-700/80 pt-2 col-span-full sm:col-span-1">
              <div className="text-[10px] font-black text-slate-400 mb-1.5 flex items-center gap-1 hidden sm:flex px-1">
                <FileSpreadsheet size={12} className="text-emerald-400" />
                <span>قسم التقارير والنتائج</span>
              </div>
              {/* أصناف bg-emerald-* من Tailwind كانت تخسر أمام .login-tab في
                  theme.css لتساوي النوعية وتأخّر استيراد theme، فلا يظهر
                  التفعيل الأخضر إطلاقاً. الحالة الآن من نظام الرموز. */}
              <button
                type="button"
                onClick={() => { setMode('reports'); setError(''); }}
                className={`login-tab login-tab--reports w-full flex items-center justify-between gap-2 px-3 py-2.5 transition-all cursor-pointer ${
                  mode === 'reports' ? 'login-tab--active' : ''
                }`}
              >
                <div className="flex items-center gap-2">
                  {/* لا text-emerald-400 هنا: skin.css يعرّفها بـ !important
                      فتبقى الأيقونة خضراء فوق الخلفية الخضراء عند التفعيل.
                      لونها في الحالتين يأتي من .login-tab--reports. */}
                  <FileSpreadsheet size={17} className="login-tab__icon" />
                  <span className="font-black text-xs">التقارير</span>
                </div>
              </button>
            </div>
          </nav>

        </aside>
      )}

      {/* ===================== البطاقة الرئيسية ===================== */}
      <div className={`bg-slate-800 rounded-3xl border border-slate-700 shadow-2xl overflow-hidden ${!showSidebar ? 'w-full' : ''}`}>
        <div className="ut-accent-bar" />

        <div className="p-4 md:p-8">
          <div className="mb-6 flex items-center justify-between border-b border-slate-700/60 pb-4">
            <div>
              <h2 className="text-white text-lg font-black flex items-center gap-2">
                {mode === 'reports' && <FileSpreadsheet className="text-emerald-400" size={20} />}
                {TABS.find(t => t.id === mode)?.label}
              </h2>
              <p className="text-slate-400 text-[11px] font-bold mt-1">
                {TABS.find(t => t.id === mode)?.desc}
              </p>
            </div>
            {mode === 'reports' && isReportsLoggedIn && (
              <button 
                type="button" 
                onClick={() => reportsLogoutRef.current?.()} 
                className="bg-red-950/60 hover:bg-red-900/80 text-red-300 border border-red-800/80 text-xs font-bold px-3.5 py-2 rounded-xl transition-all flex items-center gap-1.5 cursor-pointer shadow-sm hover:border-red-500/80 shrink-0"
              >
                <LogOut size={15} className="text-red-400" />
                <span>تسجيل خروج</span>
              </button>
            )}
          </div>

          {mode === 'reports' ? (
            <div className="pt-2">
              <ScreenLoader>
                <LazyReportsView 
                  syncUrl={adminConfig.syncUrl} 
                  adminConfig={adminConfig} 
                  onUpdateConfig={setAdminConfig} 
                  logAction={logAction} 
                  onLoginStateChange={setIsReportsLoggedIn}
                  onLogoutRef={reportsLogoutRef}
                />
              </ScreenLoader>
            </div>
          ) : (
            <>
              {!adminConfig.syncUrl && mode !== 'admin' && (
                <div className="mb-5 p-4 bg-blue-900/20 border-r-4 border-blue-500 rounded-xl">
                  <p className="text-blue-400 text-xs font-bold">جارٍ الاتصال بالخادم…</p>
                </div>
              )}

          {!navigator.onLine && (
            <div className="mb-4 p-3 bg-red-900/30 border border-red-500/50 rounded-2xl flex items-center gap-3 text-red-400 text-[11px] font-black">
              <WifiOff size={16} /> الهاتف غير متصل بالإنترنت
            </div>
          )}

          {(info || (notice && !error)) && (
            <div className="mb-4 p-4 bg-amber-900/20 border-r-4 border-amber-500 rounded-xl text-amber-300 text-xs font-bold flex gap-2 items-start">
              <AlertCircle size={16} className="shrink-0 mt-0.5" />
              <span>{info || notice}</span>
            </div>
          )}

          {error && (
            <div className="mb-4 p-4 bg-red-900/20 border-r-4 border-red-500 rounded-xl text-red-400 text-xs font-bold flex gap-2 items-start">
              <AlertCircle size={16} className="shrink-0 mt-0.5" />
              <span>{error}</span>
            </div>
          )}

          {isLoading && (
            <div className="mb-4 p-3 bg-blue-900/20 border border-blue-500/50 rounded-2xl flex items-center justify-center gap-2 text-blue-400 text-xs font-bold">
              <Loader2 className="animate-spin" size={16} /> جارٍ المعالجة والتحقق…
            </div>
          )}

          {/* ===== حساب جديد ===== */}
          {mode === 'register' && (
            <form onSubmit={handleRegister} className="space-y-4">
              <input type="text" placeholder="الاسم الرباعي" value={fullName} onChange={e => setFullName(e.target.value)} className={inputClasses} />
              <input type="text" placeholder="الرقم القومي (14 رقم)" maxLength={14} inputMode="numeric" value={nationalId} onChange={e => setNationalId(e.target.value.replace(/\D/g, ''))} className={inputClasses} />

              <div className="relative">
                <select value={selectedJob} onChange={e => setSelectedJob(e.target.value)} className={`${inputClasses} appearance-none cursor-pointer text-right`}>
                  <option value="">-- اختر الوظيفة --</option>
                  {availableJobs.map(job => <option key={job.id} value={job.title}>{job.title}</option>)}
                </select>
                <Briefcase size={18} className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-500 pointer-events-none" />
              </div>

              <div className="relative">
                <select value={defaultBranch} onChange={e => setDefaultBranch(e.target.value)} className={`${inputClasses} appearance-none cursor-pointer text-right`}>
                  <option value="">-- اختر فرع العمل الأساسي --</option>
                  {branches.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
                </select>
                <MapPin size={18} className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-500 pointer-events-none" />
              </div>

              <div className="relative">
                <input type={showRegPassword ? 'text' : 'password'} placeholder="تعيين كلمة مرور" minLength={6} value={password} onChange={e => setPassword(e.target.value)} className={`${inputClasses} pl-12`} />
                <button type="button" onClick={() => setShowRegPassword(!showRegPassword)} className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400 hover:text-white transition-colors">
                  {showRegPassword ? <EyeOff size={18} /> : <Eye size={18} />}
                </button>
              </div>

              <div className="relative">
                <input type={showConfirmPassword ? 'text' : 'password'} placeholder="تأكيد كلمة المرور" minLength={6} value={confirmPassword} onChange={e => setConfirmPassword(e.target.value)} className={`${inputClasses} pl-12`} />
                <button type="button" onClick={() => setShowConfirmPassword(!showConfirmPassword)} className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400 hover:text-white transition-colors">
                  {showConfirmPassword ? <EyeOff size={18} /> : <Eye size={18} />}
                </button>
              </div>

              <button type="submit" disabled={isLoading} className="w-full bg-blue-600 text-white font-black py-4 rounded-2xl flex items-center justify-center gap-2">
                {isLoading ? <Loader2 className="animate-spin" size={20} /> : <UserPlus size={20} />}
                {isLoading ? 'جارٍ الحفظ…' : 'تسجيل وتأمين الجهاز'}
              </button>
            </form>
          )}

          {/* ===== دخول الموظف ===== */}
          {mode === 'login' && (
            <form onSubmit={handleEmployeeLogin} className="space-y-4">
              <input type="text" placeholder="الرقم القومي" maxLength={14} inputMode="numeric" value={nationalId} onChange={e => setNationalId(e.target.value.replace(/\D/g, ''))} className={inputClasses} />
              <div className="relative">
                <input type={showLoginPassword ? 'text' : 'password'} placeholder="كلمة المرور" value={password} onChange={e => setPassword(e.target.value)} className={`${inputClasses} pl-12`} />
                <button type="button" onClick={() => setShowLoginPassword(!showLoginPassword)} className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400 hover:text-white transition-colors">
                  {showLoginPassword ? <EyeOff size={18} /> : <Eye size={18} />}
                </button>
              </div>
              <button type="submit" disabled={isLoading} className="w-full bg-blue-600 text-white font-black py-4 rounded-2xl flex items-center justify-center gap-2 text-sm">
                <LogIn size={20} /> دخول
              </button>

              <button
                type="button"
                onClick={() => { setShowRecovery(true); setRecNationalId(nationalId.trim()); }}
                className="w-full text-center text-[11px] font-bold text-blue-400 py-2 rounded-xl cursor-pointer"
              >
                نسيت كلمة المرور؟
              </button>
            </form>
          )}

          {/* ===== استعادة كلمة المرور ===== */}
          {mode === 'login' && showRecovery && (
            <div className="mt-4 p-4 rounded-2xl border border-blue-500/40 bg-blue-950/25 space-y-4">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <div className="text-white text-sm font-black flex items-center gap-2">
                    <KeyRound size={17} className="text-blue-400" />
                    استعادة كلمة المرور
                  </div>
                  <p className="text-[11px] text-slate-400 font-bold mt-1 leading-relaxed">
                    {recStep === 1
                      ? 'الاستعادة متاحة من هاتفك المسجّل فقط. إن كنت غيّرت هاتفك راجع المسؤول.'
                      : `تم التحقق من هويتك: ${recVerifiedName}`}
                  </p>
                </div>
                <button type="button" onClick={closeRecovery} className="text-slate-400 text-xs font-black px-2 py-1 rounded-lg cursor-pointer shrink-0">
                  إغلاق
                </button>
              </div>

              {recSuccess ? (
                <div className="p-3 rounded-xl bg-emerald-950/40 border border-emerald-500/40 text-emerald-300 text-xs font-bold">
                  {recSuccess}
                </div>
              ) : recStep === 1 ? (
                <form onSubmit={handleRecoveryVerify} className="space-y-3">
                  <input
                    type="text" placeholder="الرقم القومي" maxLength={14} inputMode="numeric"
                    value={recNationalId}
                    onChange={e => setRecNationalId(e.target.value.replace(/\D/g, ''))}
                    className={inputClasses}
                  />
                  {recError && (
                    <div className="p-3 rounded-xl bg-red-950/40 border border-red-500/40 text-red-300 text-[11px] font-bold flex gap-2 items-start">
                      <AlertCircle size={15} className="shrink-0 mt-0.5" /><span>{recError}</span>
                    </div>
                  )}
                  <button type="submit" disabled={recLoading} className="w-full bg-blue-600 text-white font-black py-3 rounded-2xl flex items-center justify-center gap-2 text-xs">
                    {recLoading ? <Loader2 className="animate-spin" size={17} /> : <Smartphone size={17} />}
                    {recLoading ? 'جارٍ التحقق…' : 'تحقّق من هويتي'}
                  </button>
                </form>
              ) : (
                <form onSubmit={handleRecoverySubmit} className="space-y-3">
                  <div className="relative">
                    <input
                      type={recShowPass ? 'text' : 'password'} placeholder="كلمة المرور الجديدة" minLength={6}
                      value={recNewPass} onChange={e => setRecNewPass(e.target.value)}
                      className={`${inputClasses} pl-12`}
                    />
                    <button type="button" onClick={() => setRecShowPass(!recShowPass)} className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400 transition-colors">
                      {recShowPass ? <EyeOff size={18} /> : <Eye size={18} />}
                    </button>
                  </div>
                  <input
                    type={recShowPass ? 'text' : 'password'} placeholder="تأكيد كلمة المرور الجديدة" minLength={6}
                    value={recConfirmPass} onChange={e => setRecConfirmPass(e.target.value)}
                    className={inputClasses}
                  />
                  {recError && (
                    <div className="p-3 rounded-xl bg-red-950/40 border border-red-500/40 text-red-300 text-[11px] font-bold flex gap-2 items-start">
                      <AlertCircle size={15} className="shrink-0 mt-0.5" /><span>{recError}</span>
                    </div>
                  )}
                  {/* emerald-700: الأبيض على 600 يعطي 3.77:1 دون حدّ WCAG */}
                  <button type="submit" disabled={recLoading} className="w-full bg-emerald-700 text-white font-black py-3 rounded-2xl flex items-center justify-center gap-2 text-xs">
                    {recLoading ? <Loader2 className="animate-spin" size={17} /> : <KeyRound size={17} />}
                    {recLoading ? 'جارٍ الحفظ…' : 'تعيين كلمة المرور'}
                  </button>
                </form>
              )}
            </div>
          )}

          {/* ===== دخول المسؤول ===== */}
          {mode === 'admin' && (
            <form onSubmit={handleAdminSubmit} className="space-y-4">
              <input type="text" placeholder="اسم مستخدم المسؤول" value={adminUsername} onChange={e => setAdminUsername(e.target.value)} className={inputClasses} />
              <div className="relative">
                <input type={showAdminPassword ? 'text' : 'password'} placeholder={savedAdmin?.token && savedAdmin.user === adminUsername.trim() ? 'محفوظة على هذا الجهاز — اضغط دخول' : 'كلمة مرور المسؤول'} value={adminPassword} onChange={e => setAdminPassword(e.target.value)} className={`${inputClasses} pl-12`} />
                <button type="button" onClick={() => setShowAdminPassword(!showAdminPassword)} className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400 hover:text-white transition-colors">
                  {showAdminPassword ? <EyeOff size={18} /> : <Eye size={18} />}
                </button>
              </div>
              <label className="flex items-center gap-3 min-h-[44px] px-1 text-sm text-slate-300 cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={rememberAdmin}
                  onChange={e => { setRememberAdmin(e.target.checked); if (!e.target.checked) clearSavedLogin('admin'); }}
                  className="w-5 h-5 accent-blue-600 shrink-0"
                />
                تذكرني على هذا الجهاز
              </label>
              <button type="submit" disabled={isLoading} className="w-full bg-blue-600 text-white font-black py-4 rounded-2xl flex items-center justify-center gap-2">
                <ShieldAlert size={20} /> دخول لوحة التحكم
              </button>
            </form>
          )}
          </>
          )}
        </div>
      </div>
    </div>
  );
}
