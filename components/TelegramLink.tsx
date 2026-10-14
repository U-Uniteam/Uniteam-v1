import React, { useCallback, useEffect, useState } from 'react';
import { Send, Loader2, CheckCircle, Unlink } from 'lucide-react';
import { postRequestAction } from './requestsApi';

/**
 * ربط حساب المسؤول أو المشرف ببوت تليجرام الشركة لتصله رسائل طلبات الموظفين.
 *
 * يظهر فقط إن كان البوت مضبوطاً على الخادم وكان للحساب صلاحية «رسائل تليجرام»
 * (المسؤول دائماً). الخطوات: «ربط تليجرام» يفتح البوت برمز لمرة واحدة ←
 * Start في تليجرام ← «تأكيد الربط». الخادم: handleTelegramAction في google-apps-script.js
 */

interface Props { syncUrl: string; approverToken: string }

interface Status { configured: boolean; allowed: boolean; linked: boolean; telegramName?: string; bot?: string }

export default function TelegramLink({ syncUrl, approverToken }: Props) {
  const [status, setStatus] = useState<Status | null>(null);
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState<'' | 'start' | 'confirm' | 'unlink'>('');
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const auth = { approverToken };

  const load = useCallback(async () => {
    if (!syncUrl || !approverToken) return;
    const res: any = await postRequestAction(syncUrl, { action: 'telegramStatus', ...auth });
    if (res.ok) setStatus(res as Status);
  }, [syncUrl, approverToken]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { load(); }, [load]);

  if (!status || !status.configured || !status.allowed) return null;

  const start = async () => {
    setMsg(null); setBusy('start');
    const res: any = await postRequestAction(syncUrl, { action: 'telegramStartLink', ...auth });
    setBusy('');
    if (!res.ok || !res.url) { setMsg({ ok: false, text: res.error || 'تعذّر بدء الربط.' }); return; }
    setCode(res.code);
    window.open(res.url, '_blank', 'noopener');
  };

  const confirm = async () => {
    setMsg(null); setBusy('confirm');
    const res: any = await postRequestAction(syncUrl, { action: 'telegramConfirmLink', code, ...auth });
    setBusy('');
    if (!res.ok) { setMsg({ ok: false, text: res.error || 'تعذّر تأكيد الربط.' }); return; }
    setCode('');
    setMsg({ ok: true, text: 'تم الربط. وصلتك رسالة تأكيد على تليجرام.' });
    setStatus({ ...status, linked: true, telegramName: res.telegramName || '' });
  };

  const unlink = async () => {
    setMsg(null); setBusy('unlink');
    const res: any = await postRequestAction(syncUrl, { action: 'telegramUnlink', ...auth });
    setBusy('');
    if (!res.ok) { setMsg({ ok: false, text: res.error || 'تعذّر إلغاء الربط.' }); return; }
    setStatus({ ...status, linked: false, telegramName: '' });
  };

  const btn = 'min-h-[44px] px-4 rounded-xl text-sm font-black flex items-center justify-center gap-2 transition-all disabled:opacity-50';

  return (
    <div className="bg-slate-900/60 border border-slate-700 rounded-2xl p-4 space-y-3">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-2 text-sm font-black text-white">
          <Send size={18} className="text-sky-400" /> رسائل تليجرام
          {status.linked && (
            <span className="ut-chip ut-chip--ok" style={{ height: 24 }}>
              <CheckCircle size={12} /> مربوط{status.telegramName ? ` · ${status.telegramName}` : ''}
            </span>
          )}
        </div>
        {status.linked ? (
          <button type="button" onClick={unlink} disabled={!!busy}
            className={`${btn} text-slate-300 bg-slate-800 border border-slate-600 hover:text-red-300`}>
            {busy === 'unlink' ? <Loader2 size={16} className="animate-spin" /> : <Unlink size={16} />} إلغاء الربط
          </button>
        ) : !code ? (
          <button type="button" onClick={start} disabled={!!busy}
            className={`${btn} text-white`} style={{ background: '#0284c7' }}>
            {busy === 'start' ? <Loader2 size={16} className="animate-spin" /> : <Send size={16} />} ربط تليجرام
          </button>
        ) : null}
      </div>

      {!status.linked && !code && (
        <p className="text-xs text-slate-400 leading-relaxed">تصلك على تليجرام رسالة فور إرسال موظف خطة أو إجازة أو تعديلها.</p>
      )}

      {code && !status.linked && (
        <div className="space-y-2">
          <p className="text-xs text-slate-300 leading-relaxed">
            ١) في تليجرام اضغط <b>Start</b> (أو «ابدأ») في محادثة البوت{status.bot ? ` @${status.bot}` : ''}.<br />
            ٢) ارجع هنا واضغط «تأكيد الربط».
          </p>
          <div className="flex gap-2 flex-wrap">
            <button type="button" onClick={confirm} disabled={!!busy} className={`${btn} text-white`} style={{ background: '#047857' }}>
              {busy === 'confirm' ? <Loader2 size={16} className="animate-spin" /> : <CheckCircle size={16} />} تأكيد الربط
            </button>
            <button type="button" onClick={start} disabled={!!busy} className={`${btn} text-slate-300 bg-slate-800 border border-slate-600`}>
              فتح البوت مرة أخرى
            </button>
          </div>
        </div>
      )}

      {msg && (
        <div className={`p-3 rounded-xl text-xs font-bold ${msg.ok ? 'bg-emerald-900/20 text-emerald-300 border border-emerald-800/50' : 'bg-red-900/20 text-red-300 border border-red-800/50'}`}>
          {msg.text}
        </div>
      )}
    </div>
  );
}
