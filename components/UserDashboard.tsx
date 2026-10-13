
import React, { useState, useEffect, useRef } from 'react';
import { User, Branch, AttendanceRecord, VisitPlan, Job, StaffRequest } from '../types';
import { MapPin, Clock, CheckCircle, AlertCircle, RotateCcw, RefreshCw, Cloud, FileText, Navigation, Calendar, Inbox, Fingerprint } from 'lucide-react';
import { LazyRequestsPanel, ScreenLoader } from './LazyScreens';
import { postRequestAction, employeeAuth, unseenDecisions } from './requestsApi';
import { notifyEmployeeDecisions, clearDesktopBadge } from './desktopNotify';
import { calculateDistance, getDeviceFingerprint, getEgyptTime, getRealNetworkTime, checkDeveloperOptionsStatus, checkMockLocationStatus } from '../utils';

interface UserDashboardProps {
  user: User;
  branches: Branch[];
  records: AttendanceRecord[];
  setRecords: React.Dispatch<React.SetStateAction<AttendanceRecord[]>>;
  googleSheetLink: string;
  onRefresh: () => void;
  isSyncing: boolean;
  lastUpdated?: string;
  logAction: (action: string, details?: string) => void;
  visitPlans: VisitPlan[];
  /** الوظائف — تحدد صلاحية الخطة الشهرية وأيام العمل */
  jobs?: Job[];
  /** الإجازات الرسمية YYYY-MM-DD — تُتخطّى في اقتراح أيام الخطة */
  holidays?: string[];
}

/**
 * مهلة إرسال تسجيل الحضور.
 *
 * خمس وأربعون ثانية: الخادم ينتظر قفل الكتابة حتى ١٥ ثانية ثم يقرأ ثلاثة
 * شيتات ويكتب، وفي ذروة الصباح يتجاوز ذلك ٢٠ ثانية. كانت المهلة ٢٠ ثانية
 * فيُلغى الطلب بينما الخادم يُكمل الكتابة، وتظهر للموظف رسالة تؤكد كذباً
 * أن شيئاً لم يُسجَّل، فيعيد المحاولة ويتكرر الصف في الشيت.
 *
 * عند تجاوزها تُعاد المحاولة تلقائياً مرة واحدة؛ والخادم يتجاهل أي تسجيل
 * مكرّر لنفس الموظف ونفس النوع خلال عشر دقائق، فالإعادة آمنة.
 */
const ATTENDANCE_TIMEOUT_MS = 45000;

/** مهلة جلب server-config.json قبل التسجيل — لا يجوز أن تعلّق التسجيل */
const CONFIG_FETCH_TIMEOUT_MS = 6000;

/** عدد المحاولات الإضافية التلقائية بعد انتهاء المهلة */
const ATTENDANCE_AUTO_RETRIES = 1;

const UserDashboard: React.FC<UserDashboardProps> = ({
  user, 
  branches, 
  records, 
  setRecords, 
  googleSheetLink, 
  onRefresh, 
  isSyncing, 
  lastUpdated,
  logAction,
  visitPlans,
  jobs = [],
  holidays = []
}) => {
  // ---------- تبويب «طلباتي» ----------
  const [tab, setTab] = useState<'attendance' | 'requests'>('attendance');
  const [myRequests, setMyRequests] = useState<StaffRequest[]>([]);
  const [reqLoading, setReqLoading] = useState(false);
  const [reqError, setReqError] = useState('');
  const [unseen, setUnseen] = useState(0);

  const loadRequests = async () => {
    if (!googleSheetLink) return;
    setReqLoading(true); setReqError('');
    const res = await postRequestAction(googleSheetLink, { action: 'getMyRequests', ...employeeAuth(user.nationalId) });
    setReqLoading(false);
    if (!res.ok) { setReqError(res.error || 'تعذّر تحميل الطلبات'); return; }
    const list = res.requests || [];
    setMyRequests(list);
    const n = unseenDecisions(user.id, list);
    setUnseen(n);
    void notifyEmployeeDecisions(user.id, list, n);
  };

  // فحص صامت كل دقيقتين ما دام التطبيق مفتوحاً: يظهر الرقم الأحمر على «طلباتي» فور قرار المدير
  // (وإشعار ويندوز في تطبيق الويندوز) دون إعادة فتح التطبيق. لا مؤشر تحميل ولا رسالة خطأ.
  const silentCheckRef = useRef<() => void>(() => {});
  silentCheckRef.current = async () => {
    if (!googleSheetLink || !navigator.onLine) return;
    const res = await postRequestAction(googleSheetLink, { action: 'getMyRequests', ...employeeAuth(user.nationalId) });
    if (!res.ok) return;
    const list = res.requests || [];
    setMyRequests(list);
    const n = unseenDecisions(user.id, list);
    setUnseen(n);
    void notifyEmployeeDecisions(user.id, list, n);
  };
  useEffect(() => {
    const t = setInterval(() => silentCheckRef.current(), 2 * 60 * 1000);
    return () => clearInterval(t);
  }, []);

  // جلب واحد متأخر عند الفتح لشارة التبويب — بعد مزامنة البداية لا معها
  useEffect(() => {
    const t = setTimeout(() => { loadRequests(); }, 4000);
    return () => clearTimeout(t);
  }, [user.id, googleSheetLink]); // eslint-disable-line react-hooks/exhaustive-deps

  const isUserDefaultBranch = (branch: Branch, u: User): boolean => {
    const defaultVal = (
      u.defaultBranchId || 
      u.defaultBranch || 
      u.assignedBranch || 
      u.branch || 
      ''
    ).toString().trim();
    if (!defaultVal) return false;

    const bId = String(branch.id).trim();
    const bName = String(branch.name).trim();

    if (bId === defaultVal || bName === defaultVal) return true;
    if (bName.toLowerCase() === defaultVal.toLowerCase()) return true;
    return false;
  };

  const findInitialBranchId = () => {
    const rawBranchValue = (
      user.defaultBranchId || 
      user.defaultBranch || 
      user.assignedBranch || 
      user.branch || 
      ''
    ).toString().trim();

    if (!rawBranchValue) {
      return branches.length > 0 ? branches[0].id : '';
    }

    // 1. Direct match by branch ID
    const branchById = branches.find(b => String(b.id).trim() === rawBranchValue);
    if (branchById) return branchById.id;

    // 2. Direct match by branch Name (trimmed)
    const branchByName = branches.find(b => b.name.trim() === rawBranchValue);
    if (branchByName) return branchByName.id;

    // 3. Case-insensitive match by branch Name
    const branchByNameCaseInsensitive = branches.find(b => b.name.trim().toLowerCase() === rawBranchValue.toLowerCase());
    if (branchByNameCaseInsensitive) return branchByNameCaseInsensitive.id;

    // 4. Substring / Partial match
    const branchByPartial = branches.find(b => 
      b.name.trim().toLowerCase().includes(rawBranchValue.toLowerCase()) || 
      rawBranchValue.toLowerCase().includes(b.name.trim().toLowerCase())
    );
    if (branchByPartial) return branchByPartial.id;

    // Default fallback to first available branch
    return branches.length > 0 ? branches[0].id : '';
  };

  const [selectedBranchId, setSelectedBranchId] = useState(findInitialBranchId());
  
  // Continuous Location State (Working in background)
  const [liveLocation, setLiveLocation] = useState<{ lat: number, lng: number, accuracy: number, timestamp: number } | null>(null);
  const watchIdRef = useRef<number | null>(null);
  // يُسند داخل تأثير المتابعة أدناه، ويستعمله زر «تحديث الموقع» لإعادة تشغيلها
  const startWatchingRef = useRef<() => void>(() => {});
  const [isRefreshingLocation, setIsRefreshingLocation] = useState(false);

  /**
   * سبب تعذّر تتبّع الموقع في الخلفية.
   *
   * كان خطأ watchPosition يُكتب في console وحده، فتبقى liveLocation فارغة
   * وتعرض إشارة المسافة «تحديد الموقع…» بلا نهاية. والموظف واقف ينتظر رقماً
   * لن يأتي، ولا يعلم أن الإذن مرفوض إلا إن ضغط زر التسجيل.
   */
  const [geoError, setGeoError] = useState<{ label: string; help: string } | null>(null);

  const [isVerifying, setIsVerifying] = useState(false);
  const [status, setStatus] = useState<{ type: 'success' | 'error' | 'info' | 'none', msg: string }>({ type: 'none', msg: '' });

  // ثوانٍ الانتظار منذ الضغط — تُعرض داخل الزر ليعلم الموظف أن الطلب ما زال يعمل
  const [waitSeconds, setWaitSeconds] = useState(0);
  useEffect(() => {
    if (!isVerifying) { setWaitSeconds(0); return; }
    const t = setInterval(() => setWaitSeconds(s => s + 1), 1000);
    return () => clearInterval(t);
  }, [isVerifying]);
  const [reasonText, setReasonText] = useState('');

  const [currentTime, setCurrentTime] = useState(getEgyptTime());

  // Clock Interval
  useEffect(() => {
    const timer = setInterval(() => setCurrentTime(getEgyptTime()), 1000);
    return () => clearInterval(timer);
  }, []);

  // Continuous Location Watching (Hidden Background Process)
  useEffect(() => {
    if (!navigator.geolocation) {
      setGeoError({
        label: 'الموقع غير مدعوم',
        help: 'هذا المتصفح لا يدعم تحديد الموقع. استخدم تطبيق Uniteam من هاتفك.'
      });
      return;
    }

    const startWatching = () => {
      watchIdRef.current = navigator.geolocation.watchPosition(
        (pos) => {
          setGeoError(null);
          setLiveLocation({
            lat: pos.coords.latitude,
            lng: pos.coords.longitude,
            accuracy: pos.coords.accuracy,
            timestamp: pos.timestamp
          });
        },
        (err) => {
          console.debug("Background GPS Error", err);
          // نفس تصنيف الأخطاء المستعمل في handleAttendance، ليقرأ الموظف
          // السبب فور فتح الشاشة بدل أن ينتظر ضغطة الزر
          if (err && err.code === 1) {
            setGeoError({
              label: 'إذن الموقع مرفوض',
              help: 'افتح إعدادات الهاتف ← التطبيقات ← Uniteam ← الأذونات ← الموقع، واختر "السماح أثناء استخدام التطبيق".'
            });
          } else if (err && err.code === 2) {
            setGeoError({
              label: 'GPS متوقّف',
              help: 'فعّل خدمة الموقع (GPS) في الهاتف، وتأكد أنك لست في مكان مغلق تماماً.'
            });
          } else {
            setGeoError({
              label: 'تعذّر تحديد الموقع',
              help: 'اخرج لمكان مكشوف قليلاً وانتظر ثوانٍ.'
            });
          }
        },
        { enableHighAccuracy: true, timeout: 20000, maximumAge: 5000 }
      );
    };

    startWatchingRef.current = startWatching;
    startWatching();

    return () => {
      if (watchIdRef.current !== null) {
        navigator.geolocation.clearWatch(watchIdRef.current);
      }
    };
  }, []);

  useEffect(() => {
    if (branches.length > 0) {
      const initialId = findInitialBranchId();
      if (initialId && (!selectedBranchId || !branches.some(b => b.id === selectedBranchId))) {
        setSelectedBranchId(initialId);
      }
    }
  }, [branches, user.defaultBranchId, user.defaultBranch, user.assignedBranch, user.branch]);

  /**
   * زر «تحديث الموقع»: يتخلّص من القراءة العالقة أو غير الدقيقة.
   * يوقف المتابعة، يمسح الموقع الحالي، يطلب قراءة جديدة بلا ذاكرة مؤقتة
   * (maximumAge: 0)، ثم يعيد تشغيل المتابعة. أخطاء القراءة تظهر عبر المتابعة نفسها.
   */
  const refreshLocation = () => {
    if (!navigator.geolocation || isRefreshingLocation) return;
    setIsRefreshingLocation(true);
    if (watchIdRef.current !== null) {
      navigator.geolocation.clearWatch(watchIdRef.current);
      watchIdRef.current = null;
    }
    setLiveLocation(null);
    setGeoError(null);
    const restart = () => {
      setIsRefreshingLocation(false);
      if (watchIdRef.current === null) startWatchingRef.current();
    };
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setLiveLocation({
          lat: pos.coords.latitude,
          lng: pos.coords.longitude,
          accuracy: pos.coords.accuracy,
          timestamp: pos.timestamp
        });
        restart();
      },
      () => restart(),
      { enableHighAccuracy: true, timeout: 20000, maximumAge: 0 }
    );
  };

  const formatTimeDisplay = (timeStr: string | undefined) => {
    if (!timeStr) return '--:--';
    if (timeStr.includes('GMT') || timeStr.includes('1899')) {
      try {
        const d = new Date(timeStr);
        if (!isNaN(d.getTime())) {
          return d.toLocaleTimeString('en-US', { timeZone: 'Africa/Cairo', hour: '2-digit', minute: '2-digit', hour12: true });
        }
      } catch(e) {}
    }
    if (/^\d{2}:\d{2}$/.test(timeStr)) {
      const [h, m] = timeStr.split(':').map(Number);
      const suffix = h >= 12 ? 'PM' : 'AM';
      const displayH = h % 12 || 12;
      return `${displayH.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')} ${suffix}`;
    }
    return timeStr;
  };

  const calculateTimeDiffDetails = (type: 'check-in' | 'check-out') => {
    let scheduledTimeStr = type === 'check-in' ? (user.checkInTime || "09:00") : (user.checkOutTime || "17:00");
    let schedH = 9, schedM = 0;

    if (scheduledTimeStr.includes('GMT') || scheduledTimeStr.includes('1899')) {
       const d = getEgyptTime(scheduledTimeStr);
       if (!isNaN(d.getTime())) {
          schedH = d.getHours();
          schedM = d.getMinutes();
       }
    } else {
       const parts = scheduledTimeStr.split(':').map(Number);
       schedH = parts[0] || 0;
       schedM = parts[1] || 0;
    }

    const now = getEgyptTime();
    const schedDate = new Date(now);
    schedDate.setHours(schedH, schedM, 0, 0);

    const diffMs = now.getTime() - schedDate.getTime();
    const diffMinsTotal = Math.floor(diffMs / 60000);
    const absMins = Math.abs(diffMinsTotal);
    const h = Math.floor(absMins / 60);
    const m = absMins % 60;
    
    let timeStr = `${h > 0 ? h + ' ساعة و ' : ''}${m} دقيقة`;
    let isLate = false;
    let resultString = "";

    if (type === 'check-in') {
      isLate = diffMinsTotal > 0;
      resultString = isLate ? `حضور متأخر ${timeStr}` : `حضور مبكر ${timeStr}`;
    } else {
      isLate = diffMinsTotal < 0; 
      resultString = diffMinsTotal < 0 ? `انصراف مبكر ${timeStr}` : `انصراف متأخر ${timeStr}`;
    }

    return { resultString, isLate, diffMinsTotal };
  };

  const handleAttendance = async (type: 'check-in' | 'check-out') => {
    // 0. Security Verification: Developer Mode Check
    const devCheck = checkDeveloperOptionsStatus();
    if (devCheck.enabled) {
      const msg = 'تنبيه أمني محظور: وضع المطور (Developer Options) مفعّل على هاتفك. لا يُسمح بتسجيل الحضور أو الانصراف. يرجى تعطيل وضع المطور وإعادة المحاولة.';
      setStatus({ type: 'error', msg });
      logAction(`محاولة تسجيل ${type === 'check-in' ? 'حضور' : 'انصراف'} مرفوضة (وضع المطور)`, `السبب: ${msg} | المصدر: ${devCheck.source}`);
      setIsVerifying(false);
      return;
    }

    // 1. Connectivity Check
    if (!navigator.onLine) { 
      const msg = 'عذراً، يجب أن يكون الهاتف متصلاً بالإنترنت لإرسال التسجيل.';
      setStatus({ type: 'error', msg }); 
      logAction(`فشل تسجيل ${type === 'check-in' ? 'حضور' : 'انصراف'}`, `السبب: ${msg}`);
      return; 
    }

    if (!selectedBranchId) { 
      const msg = 'يرجى اختيار الفرع أولاً';
      setStatus({ type: 'error', msg }); 
      logAction(`فشل تسجيل ${type === 'check-in' ? 'حضور' : 'انصراف'}`, `السبب: ${msg}`);
      return; 
    }

    setIsVerifying(true);
    setStatus({ type: 'none', msg: '' });

    // 2. Location Confirmation Logic
    let lat = 0;
    let lng = 0;
    let rawPosObj: GeolocationPosition | undefined = undefined;

    // Check if we have a fresh background location (less than 60 seconds old)
    const isBackgroundLocationFresh = liveLocation && (Date.now() - liveLocation.timestamp < 60000);

    if (isBackgroundLocationFresh && liveLocation) {
        lat = liveLocation.lat;
        lng = liveLocation.lng;
    } else {
        try {
            const position = await new Promise<GeolocationPosition>((resolve, reject) => {
                navigator.geolocation.getCurrentPosition(resolve, reject, {
                    enableHighAccuracy: true,
                    timeout: 10000,
                    maximumAge: 0
                });
            });
            rawPosObj = position;
            lat = position.coords.latitude;
            lng = position.coords.longitude;
            setLiveLocation({
                lat, lng, accuracy: position.coords.accuracy, timestamp: position.timestamp
            });
        } catch (error) {
            setIsVerifying(false);
            const geoErr = error as GeolocationPositionError;
            let msg = 'تعذر تحديد الموقع الحالي بدقة. تأكد من تفعيل GPS والمحاولة مرة أخرى.';
            if (geoErr && geoErr.code === 1) {
              msg = 'إذن الوصول للموقع مرفوض. افتح إعدادات الهاتف ← التطبيقات ← Uniteam ← الأذونات ← الموقع، واختر "السماح أثناء استخدام التطبيق"، ثم أعد المحاولة.';
            } else if (geoErr && geoErr.code === 2) {
              msg = 'تعذر الوصول لخدمة الموقع. تأكد من تفعيل GPS في الهاتف ومن أنك لست في مكان مغلق تماماً.';
            } else if (geoErr && geoErr.code === 3) {
              msg = 'انتهت مهلة تحديد الموقع. اخرج لمكان مكشوف قليلاً وأعد المحاولة.';
            }
            setStatus({ type: 'error', msg });
            logAction(`فشل تسجيل ${type === 'check-in' ? 'حضور' : 'انصراف'}`, `السبب: ${msg}`);
            return;
        }
    }

    // 2.b Security Verification: Fake Location / Mock GPS Check
    const mockCheck = checkMockLocationStatus(rawPosObj);
    if (mockCheck.isFake) {
      const msg = `تنبيه أمني محظور: تم الكشف عن استخدام برنامج موقع وهمي (Fake GPS / Mock Location). ${mockCheck.reason || ''}`;
      setStatus({ type: 'error', msg });
      logAction(`محاولة تسجيل ${type === 'check-in' ? 'حضور' : 'انصراف'} مرفوضة (موقع وهمي)`, `السبب: ${msg} | الإحداثيات: ${lat}, ${lng}`);
      setIsVerifying(false);
      return;
    }

    // 3. Client-Side Checks
    const branch = branches.find(b => b.id === selectedBranchId);
    if (!branch) {
      // بلا هذه الرسالة كان الزر يعود عاملاً ولا يظهر شيء إطلاقاً.
      // يقع حين تتغيّر قائمة الفروع في المزامنة الدورية بينما الفرع
      // القديم ما زال محدّداً — فيضغط الموظف ولا يحدث شيء.
      const msg = 'الفرع المختار لم يعد متاحاً. أعد اختياره من القائمة ثم حاول مجدداً.';
      setStatus({ type: 'error', msg });
      logAction(`فشل تسجيل ${type === 'check-in' ? 'حضور' : 'انصراف'}`, `السبب: ${msg} | الإحداثيات: ${lat}, ${lng}`);
      setIsVerifying(false);
      return;
    }

    if (branch.name.trim().toLowerCase() === 'out door' && reasonText.trim() === "") {
        const msg = 'تنبيه: عند اختيار Out Door يجب كتابة تفاصيل المكان أو السبب في خانة الملاحظات.';
        setStatus({ type: 'error', msg });
        logAction(`فشل تسجيل ${type === 'check-in' ? 'حضور' : 'انصراف'}`, `السبب: ${msg} | الإحداثيات: ${lat}, ${lng}`);
        setIsVerifying(false);
        return;
    }

    const distance = calculateDistance(lat, lng, branch.latitude, branch.longitude);
    if (distance > branch.radius) { 
        const msg = `بعيد عن الفرع بمسافة ${Math.round(distance)}م. الحد المسموح ${branch.radius}م.`;
        setStatus({ type: 'error', msg }); 
        logAction(`فشل تسجيل ${type === 'check-in' ? 'حضور' : 'انصراف'}`, `السبب: ${msg} | الإحداثيات: ${lat}, ${lng}`);
        setIsVerifying(false);
        return; 
    }

    const timeInfo = calculateTimeDiffDetails(type);

    if (type === 'check-in' && timeInfo.isLate && reasonText.trim() === "") {
        const msg = 'تنبيه: أنت متأخر عن الموعد الافتراضي، يجب كتابة سبب التأخير في خانة الملاحظات قبل الإرسال.';
        setStatus({ type: 'error', msg });
        logAction(`فشل تسجيل ${type === 'check-in' ? 'حضور' : 'انصراف'}`, `السبب: ${msg} | الإحداثيات: ${lat}, ${lng}`);
        setIsVerifying(false);
        return;
    }

    const newRecord: AttendanceRecord = {
        id: Math.random().toString(36).substr(2, 9),
        userId: user.id, 
        userName: user.fullName, 
        userJob: user.jobTitle,
        serialNumber: user.serialNumber, 
        branchId: branch.id, 
        branchName: branch.name, 
        type: type,
        timestamp: getRealNetworkTime().toISOString(), 
        latitude: lat, 
        longitude: lng,
        reason: reasonText.trim(), 
        timeDiff: timeInfo.resultString
    };

    try {
        let activeLink = googleSheetLink;
        let maintenanceActive = false;
        let maintenanceTitle = '';
        let maintenanceMessage = '';

        // جلب أحدث رابط من السيرفر قبل التسجيل مباشرة لضمان عدم استخدام رابط قديم
        try {
            // مهلة قصيرة: على شبكة ضعيفة كان هذا الطلب يعلق بلا حدّ قبل أن
            // يبدأ إرسال التسجيل أصلاً. عند تجاوزها نُكمل بالرابط المحفوظ
            // (نفس مسار catch أدناه)، وفحص الصيانة الدوري في App.tsx يبقى قائماً.
            const cfgController = new AbortController();
            const cfgTimer = setTimeout(() => cfgController.abort(), CONFIG_FETCH_TIMEOUT_MS);
            // المؤقت يبقى حتى قراءة المحتوى كاملاً — الشبكة الضعيفة قد تعلق أثناءه أيضاً
            const configRes = await fetch('./server-config.json?t=' + Date.now(), { signal: cfgController.signal });
            if (configRes.ok) {
                const configData = await configRes.json();
                clearTimeout(cfgTimer);

                // فحص وضع الصيانة من نفس الاستجابة قبل إرسال أي بيانات.
                // الفحص الدوري في App.tsx يعمل كل بضع دقائق، وهذه الفجوة
                // كانت تسمح بتسجيل الحضور بعد تفعيل الصيانة مباشرة.
                if (configData && configData.maintenance === true) {
                    maintenanceActive  = true;
                    maintenanceTitle   = configData.maintenanceTitle || '';
                    maintenanceMessage = configData.maintenanceMessage || '';
                }

                if (configData && configData.googleSheetLink && configData.googleSheetLink.startsWith('http')) {
                    activeLink = configData.googleSheetLink;
                    // تحديث التخزين المحلي بصمت
                    const savedConfig = localStorage.getItem('attendance_config');
                    if (savedConfig) {
                        const parsed = JSON.parse(savedConfig);
                        let changed = false;
                        if (parsed.googleSheetLink !== activeLink) {
                            parsed.googleSheetLink = activeLink;
                            parsed.syncUrl = activeLink;
                            changed = true;
                        }
                        if (configData.auditLogUrl !== undefined && parsed.auditLogUrl !== configData.auditLogUrl) {
                            parsed.auditLogUrl = configData.auditLogUrl;
                            changed = true;
                        }
                        if (changed) {
                            localStorage.setItem('attendance_config', JSON.stringify(parsed));
                        }
                    }
                }
            }
        } catch (e) {
            console.warn("Could not verify latest link, proceeding with current.");
        }

        // وضع الصيانة يوقف التسجيل قبل إرسال أي شيء للخادم،
        // ويُبلغ App.tsx ليعرض شاشة الصيانة فوراً دون انتظار الفحص الدوري.
        if (maintenanceActive) {
            const msg = 'التطبيق تحت الصيانة حالياً، لا يمكن تسجيل الحضور أو الانصراف. '
                      + (maintenanceMessage || 'حاول مرة أخرى بعد قليل.');
            setStatus({ type: 'error', msg });
            logAction(
                `فشل تسجيل ${type === 'check-in' ? 'حضور' : 'انصراف'} (وضع الصيانة)`,
                `السبب: وضع الصيانة مفعّل من الإدارة | الإحداثيات: ${lat}, ${lng}`
            );

            try {
                window.dispatchEvent(new CustomEvent('uniteam:maintenance', {
                    detail: { title: maintenanceTitle, message: maintenanceMessage }
                }));
            } catch (e) {}

            setIsVerifying(false);
            return;
        }

        if (!activeLink) {
            logAction(`فشل تسجيل ${type === 'check-in' ? 'حضور' : 'انصراف'}`, `السبب: NO_LINK (التطبيق غير مربوط بالسحابة) | الإحداثيات: ${lat}, ${lng}`);
            throw new Error("NO_LINK");
        }

        // STRICT Server Check - Ensure Code Exists & Valid
        //
        // المهلة ليست ترفاً: الشبكة **الضعيفة** — لا المنقطعة — لا تُطلق
        // خطأً أبداً، فيبقى الطلب معلّقاً وزر التسجيل معطّلاً بلا نهاية،
        // والموظف واقف في الشارع لا يدري أنجح تسجيله أم لا.
        const payload = JSON.stringify({
          action: 'saveAttendance',
          ...newRecord,
          nationalId: user.nationalId,
          serialNumber: user.serialNumber,
          deviceId: getDeviceFingerprint()
        });

        const postOnce = async (): Promise<Response> => {
          const controller = new AbortController();
          const timeoutId = setTimeout(() => controller.abort(), ATTENDANCE_TIMEOUT_MS);
          try {
            return await fetch(activeLink, {
              method: 'POST',
              headers: { 'Content-Type': 'text/plain;charset=utf-8' },
              body: payload,
              signal: controller.signal
            });
          } finally {
            clearTimeout(timeoutId);
          }
        };

        // إعادة المحاولة التلقائية بعد انتهاء المهلة أو ردّ مؤقت غير مكتمل.
        // آمنة لأن الخادم يردّ «مسجَّل» على أي تكرار خلال عشر دقائق دون صف جديد.
        //
        // 404 ليس دليلاً على حذف الرابط: خادم Apps Script يعيد التوجيه إلى
        // صفحة وسيطة (script.googleusercontent.com) تحمل الردّ، وعند الضغط
        // تعيد جوجل 404 على هذه الصفحة رغم أن الكود نُفّذ وكتب الصف.
        // فتُعامَل 404 و5xx مثل انتهاء المهلة: إعادة، ثم رسالة صادقة.
        const isTransientStatus = (st: number) => st === 404 || st >= 500;
        let response: Response;
        let attempt = 0;
        while (true) {
          try {
            response = await postOnce();
            if (isTransientStatus(response.status)) {
              const transient: any = new Error(`TRANSIENT_${response.status}`);
              transient.name = 'TransientServerError';
              transient.status = response.status;
              throw transient;
            }
            break;
          } catch (e: any) {
            const retryable = e?.name === 'AbortError' || e?.name === 'TransientServerError';
            if (!retryable || attempt >= ATTENDANCE_AUTO_RETRIES) throw e;
            attempt++;
            setWaitSeconds(0);
            setStatus({ type: 'info', msg: 'لم يصل تأكيد الخادم بعد. جارٍ إعادة المحاولة تلقائياً — لا تغلق التطبيق.' });
            const why = e?.name === 'AbortError' ? 'انتهت المهلة' : `ردّ مؤقت ${e.status}`;
            logAction(`تسجيل ${type === 'check-in' ? 'حضور' : 'انصراف'} بلا تأكيد (${why})`, `إعادة محاولة تلقائية رقم ${attempt} | الإحداثيات: ${lat}, ${lng}`);
          }
        }

        if (!response.ok) {
          throw new Error(`HTTP Error: ${response.status}`);
        }

        const responseText = await response.text();
        
        // B) Check content validity (Avoid HTML/Google Login pages)
        if (!responseText || responseText.trim().startsWith("<")) {
           throw new Error("INVALID_RESPONSE_FORMAT");
        }

        // C) Logic Validation
        if (responseText.includes("Error") || responseText.includes("Security Alert")) {
           logAction(`فشل تسجيل ${type === 'check-in' ? 'حضور' : 'انصراف'} (خطأ منطقي)`, `السبب: ${responseText} | الإحداثيات: ${lat}, ${lng}`);
           setStatus({ type: 'error', msg: responseText });
           setIsVerifying(false);
           return;
        }

        // D) Code Freshness Check
        if (!responseText.includes("Attendance Recorded")) {
           throw new Error("OLD_OR_INVALID_CODE");
        }
        
        logAction(`تسجيل ${type === 'check-in' ? 'حضور' : 'انصراف'}`, `الفرع: ${branch.name}, المسافة: ${Math.round(distance)}م, الحالة: ${timeInfo.resultString}`);
        setRecords(prev => [...prev, newRecord]);
        setStatus({ type: 'success', msg: `تم تسجيل ${type === 'check-in' ? 'الحضور' : 'الانصراف'} بنجاح. (${timeInfo.resultString})` });
        setReasonText('');
        onRefresh();
    } catch (err: any) {
        console.error("Attendance Error:", err);
        
        let errorMsg = 'فشل الاتصال بالنظام. تأكد من الإنترنت.';
        
        if (err.message === "NO_LINK") {
            errorMsg = 'التطبيق غير مربوط بالسحابة - يرجى تحديث الصفحة أو مراجعة الإدارة.';
        } else if (err.name === "TransientServerError") {
            errorMsg = `الخادم ردّ بخطأ مؤقت (${err.status}) بعد محاولتين. قد يكون تسجيلك وصل فعلاً — اضغط الزر مرة أخرى بأمان، فلن يتكرر التسجيل.`;
        } else if (err.message === "INVALID_RESPONSE_FORMAT") {
            errorMsg = 'الرابط المسجل لا يؤدي إلى كود النظام. يرجى مراجعة المسؤول.';
        } else if (err.message === "OLD_OR_INVALID_CODE") {
            errorMsg = 'كود السيرفر قديم أو غير متوافق. لن يتم تسجيل الحضور أو الانصراف.';
        } else if (err.name === "AbortError") {
            // لا نزعم أن شيئاً لم يُسجَّل — الخادم قد يكون أكمل الكتابة بعد
            // الإلغاء. الإعادة آمنة لأن الخادم يتجاهل التكرار خلال عشر دقائق.
            errorMsg = 'لم يصل تأكيد من الخادم بعد محاولتين. قد يكون تسجيلك وصل فعلاً — عند تحسّن الشبكة اضغط الزر مرة أخرى بأمان، فلن يتكرر التسجيل.';
        } else if (err.message === "Failed to fetch") {
            errorMsg = 'تعذر الوصول للسيرفر. تأكد من اتصال الإنترنت أو صحة الرابط.';
        } else if (err.message) {
            errorMsg = `خطأ: ${err.message}`;
        }

        const unconfirmed = err.name === "AbortError" || err.name === "TransientServerError";
        const auditTitle = unconfirmed
          ? `تسجيل ${type === 'check-in' ? 'حضور' : 'انصراف'} بلا تأكيد (قد يكون سُجّل)`
          : `فشل تسجيل ${type === 'check-in' ? 'حضور' : 'انصراف'}`;
        logAction(auditTitle, `السبب: ${errorMsg}${err.message ? ' | تفاصيل: ' + err.message : ''} | الإحداثيات: ${lat}, ${lng}`);
        setStatus({ type: 'error', msg: errorMsg });
    } finally {
        setIsVerifying(false);
    }
  };

  const myRecords = records.filter(r => r.userId === user.id).slice(-5).reverse();

  // Find today's plan for this user
  const getTodayStr = () => {
    const d = getEgyptTime();
    const year = d.getFullYear();
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  };
  
  const todayStr = getTodayStr();
  const todayPlan = visitPlans.find(p => {
    if (!p.userId || !user.id) return false;
    if (p.userId !== user.id) return false;
    
    let planDate = (p.date || "").toString().trim();
    if (!planDate) return false;

    // If planDate is in long format, normalize it
    if (planDate.includes('GMT') || planDate.length > 15) {
      const d = getEgyptTime(planDate);
      if (!isNaN(d.getTime())) {
        const year = d.getFullYear();
        const month = String(d.getMonth() + 1).padStart(2, '0');
        const day = String(d.getDate()).padStart(2, '0');
        planDate = `${year}-${month}-${day}`;
      }
    }

    // Direct match after normalization
    if (planDate === todayStr) return true;

    // Flexible match (contains today's components)
    const d = getEgyptTime();
    const y = d.getFullYear().toString();
    const m = (d.getMonth() + 1).toString().padStart(2, '0');
    const day = d.getDate().toString().padStart(2, '0');
    
    // Check for common formats: YYYY-MM-DD, DD-MM-YYYY, YYYY/MM/DD, DD/MM/YYYY
    const formats = [
      `${y}-${m}-${day}`,
      `${day}-${m}-${y}`,
      `${y}/${m}/${day}`,
      `${day}/${m}/${y}`,
      `${d.getDate()}/${d.getMonth() + 1}/${d.getFullYear()}`,
      `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`
    ];
    
    return formats.some(f => planDate.includes(f));
  });

  // Find tomorrow's plan for this user
  const getTomorrowStr = () => {
    const d = getEgyptTime();
    d.setDate(d.getDate() + 1);
    const year = d.getFullYear();
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  };
  
  const tomorrowStr = getTomorrowStr();
  const tomorrowPlan = visitPlans.find(p => {
    if (!p.userId || !user.id) return false;
    if (p.userId !== user.id) return false;
    
    let planDate = (p.date || "").toString().trim();
    if (!planDate) return false;

    if (planDate.includes('GMT') || planDate.length > 15) {
      const d = getEgyptTime(planDate);
      if (!isNaN(d.getTime())) {
        const year = d.getFullYear();
        const month = String(d.getMonth() + 1).padStart(2, '0');
        const day = String(d.getDate()).padStart(2, '0');
        planDate = `${year}-${month}-${day}`;
      }
    }

    if (planDate === tomorrowStr) return true;

    const d = getEgyptTime();
    d.setDate(d.getDate() + 1);
    const y = d.getFullYear().toString();
    const m = (d.getMonth() + 1).toString().padStart(2, '0');
    const day = d.getDate().toString().padStart(2, '0');
    
    const formats = [
      `${y}-${m}-${day}`,
      `${day}-${m}-${y}`,
      `${y}/${m}/${day}`,
      `${day}/${m}/${y}`,
      `${d.getDate()}/${d.getMonth() + 1}/${d.getFullYear()}`,
      `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`
    ];
    
    return formats.some(f => planDate.includes(f));
  });

  const tabBar = (
    <div className="grid grid-cols-2 gap-2 bg-slate-800 p-1.5 rounded-2xl border border-slate-700">
      <button type="button" onClick={() => setTab('attendance')}
        className={`min-h-[46px] rounded-xl text-sm font-black flex items-center justify-center gap-2 transition-all ${tab === 'attendance' ? 'bg-blue-600 text-white' : 'text-slate-300'}`}>
        <Fingerprint size={17} /> الحضور والانصراف
      </button>
      <button type="button" onClick={() => { setTab('requests'); loadRequests(); }}
        className={`min-h-[46px] rounded-xl text-sm font-black flex items-center justify-center gap-2 transition-all relative ${tab === 'requests' ? 'bg-blue-600 text-white' : 'text-slate-300'}`}>
        <Inbox size={17} /> طلباتي
        {unseen > 0 && (
          <span className="min-w-[22px] h-[22px] px-1.5 rounded-full bg-red-500 text-white text-xs font-black flex items-center justify-center" aria-label={`${unseen} قرار جديد`}>{unseen}</span>
        )}
      </button>
    </div>
  );

  if (tab === 'requests') {
    return (
      <div className="space-y-4 max-w-2xl mx-auto">
        {tabBar}
        <ScreenLoader>
          <LazyRequestsPanel
            user={user} branches={branches} jobs={jobs} holidays={holidays} syncUrl={googleSheetLink}
            requests={myRequests} loading={reqLoading} error={reqError} reload={loadRequests}
            onSeen={() => { setUnseen(0); clearDesktopBadge(); }} logAction={logAction}
          />
        </ScreenLoader>
      </div>
    );
  }

  return (
    <div className="space-y-4">
    {tabBar}
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
      <div className="lg:col-span-2 space-y-6">
        <div className="bg-slate-800 rounded-3xl shadow-xl border border-slate-700 p-5 md:p-8 text-white relative overflow-hidden">
          {lastUpdated && (
            <div className="absolute left-4 top-6 flex flex-col items-end gap-2">
              <div className="flex items-center gap-1 text-[8px] font-black text-slate-500 bg-slate-900 px-2.5 py-1 rounded-lg border border-slate-800 uppercase">
                <Cloud size={8} /> Updated: {new Date(lastUpdated).toLocaleTimeString('en-US')}
              </div>
            </div>
          )}
          <div className="text-center mb-8 pt-4">
             <h2 className="text-2xl md:text-3xl font-black text-white mb-2 tracking-tighter">أهلاً، {user.fullName.split(' ')[0]}</h2>
             <div className="bg-blue-900/30 px-5 py-1.5 rounded-xl text-blue-400 border border-blue-800/40 font-black text-[10px] inline-block uppercase tracking-widest">{user.jobTitle || 'موظف'} | SN: {user.serialNumber || '---'}</div>
             <div className="text-4xl md:text-5xl font-black text-white mt-10 mb-2 tracking-tighter drop-shadow-2xl">{currentTime.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })}</div>
             <div className="text-slate-500 font-bold text-xs uppercase tracking-widest">{currentTime.toLocaleDateString('en-US', { weekday: 'long', day: 'numeric', month: 'long' })}</div>
             
             {(todayPlan || tomorrowPlan) && (
                <div className="mt-6 bg-slate-900/50 border border-slate-700/50 rounded-3xl overflow-hidden max-w-4xl mx-auto shadow-2xl">
                  <div className="grid grid-cols-1 md:grid-cols-2 divide-y md:divide-y-0 md:divide-x md:divide-x-reverse divide-slate-700/30">
                    {/* Today's Plan */}
                    <div 
                      onClick={() => {
                        if (!todayPlan || todayPlan.branchName === 'Holiday') return;
                        // Robust branch finding: check by ID first, then by name
                        const targetBranch = branches.find(b => b.id === todayPlan.branchId || b.name === todayPlan.branchName);
                        if (targetBranch) {
                          setSelectedBranchId(targetBranch.id);
                          logAction('اختيار فرع الخطة', `تم اختيار فرع ${targetBranch.name} من خطة اليوم عبر الرسالة التنبيهية`);
                        }
                      }}
                      className={`p-5 flex items-center justify-between gap-4 transition-all group ${!todayPlan ? 'opacity-40 cursor-default' : todayPlan.branchName === 'Holiday' ? 'bg-orange-600/5 cursor-default' : 'bg-blue-600/5 cursor-pointer hover:bg-blue-600/10'}`}
                    >
                      <div className="flex items-center gap-4">
                        <div className={`p-3 rounded-2xl shadow-lg transition-transform ${!todayPlan ? 'bg-slate-800' : todayPlan.branchName === 'Holiday' ? 'bg-orange-600' : 'bg-blue-600 group-hover:scale-105'}`}>
                          {!todayPlan ? <Clock size={20} className="text-slate-500" /> : todayPlan.branchName === 'Holiday' ? <FileText size={20} className="text-white" /> : <Navigation size={20} className="text-white" />}
                        </div>
                        <div className="text-right">
                          <div className="flex items-center gap-2 mb-1">
                            <span className="relative flex h-2 w-2">
                              <span className={`animate-ping absolute inline-flex h-full w-full rounded-full opacity-75 ${!todayPlan ? 'bg-slate-500' : todayPlan.branchName === 'Holiday' ? 'bg-orange-400' : 'bg-blue-400'}`}></span>
                              <span className={`relative inline-flex rounded-full h-2 w-2 ${!todayPlan ? 'bg-slate-600' : todayPlan.branchName === 'Holiday' ? 'bg-orange-500' : 'bg-blue-500'}`}></span>
                            </span>
                            <div className={`text-[9px] font-black uppercase tracking-widest ${!todayPlan ? 'text-slate-500' : todayPlan.branchName === 'Holiday' ? 'text-orange-400' : 'text-blue-400'}`}>الفرع المطلوب زيارته اليوم</div>
                          </div>
                          <div className="text-xs font-black text-white leading-tight">
                            {!todayPlan ? 'لا توجد خطة مسجلة' : todayPlan.branchName === 'Holiday' ? 'إجازة (Holiday) - نتمنى لك وقتاً ممتعاً' : todayPlan.branchName}
                          </div>
                        </div>
                      </div>
                      {todayPlan && todayPlan.branchName !== 'Holiday' && (
                        <div className="px-3 py-1.5 bg-blue-600 group-hover:bg-blue-500 text-white rounded-lg text-[9px] font-black transition-all shadow-md whitespace-nowrap">تحديد الفرع</div>
                      )}
                    </div>

                    {/* Tomorrow's Plan */}
                    <div 
                      className={`p-5 flex items-center gap-4 transition-all ${!tomorrowPlan ? 'opacity-40 cursor-default' : tomorrowPlan.branchName === 'Holiday' ? 'bg-orange-600/5 cursor-default' : 'bg-indigo-600/5 cursor-default'}`}
                    >
                      <div className={`p-3 rounded-2xl shadow-lg ${!tomorrowPlan ? 'bg-slate-800' : tomorrowPlan.branchName === 'Holiday' ? 'bg-orange-600' : 'bg-indigo-600'}`}>
                        {!tomorrowPlan ? <Clock size={20} className="text-slate-500" /> : tomorrowPlan.branchName === 'Holiday' ? <FileText size={20} className="text-white" /> : <Calendar size={20} className="text-white" />}
                      </div>
                      <div className="text-right">
                        <div className="flex items-center gap-2 mb-1">
                          <div className={`text-[9px] font-black uppercase tracking-widest ${!tomorrowPlan ? 'text-slate-500' : tomorrowPlan.branchName === 'Holiday' ? 'text-orange-400' : 'text-indigo-400'}`}>الفرع المطلوب زيارته غداً</div>
                        </div>
                        <div className="text-xs font-black text-white leading-tight">{!tomorrowPlan ? 'لا توجد خطة مسجلة' : tomorrowPlan.branchName === 'Holiday' ? 'إجازة (Holiday)' : tomorrowPlan.branchName}</div>
                      </div>
                    </div>
                  </div>
                </div>
              )}
             <div className="mt-4 flex justify-center gap-4 text-[10px] font-black text-slate-400 uppercase tracking-widest">
                <span className="bg-slate-900 px-3 py-1 rounded-lg border border-slate-700">موعد الحضور: {formatTimeDisplay(user.checkInTime || '09:00')}</span>
                <span className="bg-slate-900 px-3 py-1 rounded-lg border border-slate-700">موعد الانصراف: {formatTimeDisplay(user.checkOutTime || '17:00')}</span>
             </div>
          </div>
          
          <div className="space-y-6 max-w-md mx-auto">
            {!googleSheetLink && (
              <div className="p-4 bg-red-900/40 border border-red-500/50 rounded-2xl flex items-center gap-3 text-red-200 text-sm font-bold leading-relaxed">
                <Cloud size={16} /> التطبيق غير مربوط بالسحابة - لن يتم الإرسال
              </div>
            )}
            <div className="space-y-2">
              <div className="flex items-center justify-between gap-2 flex-wrap">
                <div className="flex items-center gap-1">
                  <label className="text-xs font-bold text-slate-400 me-1">موقع التسجيل</label>
                  <button
                    type="button"
                    onClick={refreshLocation}
                    disabled={isRefreshingLocation}
                    className="inline-flex items-center justify-center w-10 h-10 rounded-full text-slate-400 hover:text-white hover:bg-slate-700/60 transition-colors disabled:opacity-60"
                    title="تحديث الموقع"
                    aria-label="تحديث الموقع"
                  >
                    <RefreshCw size={16} className={isRefreshingLocation ? 'animate-spin' : ''} />
                  </button>
                </div>

                {/* إشارة المسافة — بسيطة كإشارة «متصل» في الترويسة:
                    نقطة خضراء داخل النطاق، صفراء خارجه، والرقم وحده بلا تفاصيل. */}
                {(() => {
                  // خطأ الموقع يسبق كل شيء: يظهر ولو لم يُختر فرع بعد،
                  // لأنه يمنع التسجيل مهما اختار الموظف.
                  if (geoError) {
                    return (
                      <button
                        type="button"
                        onClick={() => setStatus({ type: 'error', msg: geoError.help })}
                        className="ut-chip ut-chip--bad"
                        style={{ cursor: 'pointer', minHeight: 24 }}
                        title={geoError.help}
                      >
                        <AlertCircle size={11} /> {geoError.label} — اضغط للتفاصيل
                      </button>
                    );
                  }

                  const br = branches.find(b => b.id === selectedBranchId);
                  if (!br) return null;
                  if (!liveLocation) {
                    return (
                      <span className="ut-chip">
                        <MapPin size={11} /> تحديد الموقع…
                      </span>
                    );
                  }
                  const dist = Math.round(calculateDistance(liveLocation.lat, liveLocation.lng, br.latitude, br.longitude));
                  const inside = dist <= br.radius;
                  return (
                    <span
                      className={`ut-chip ${inside ? 'ut-chip--ok' : 'ut-chip--warn'}`}
                      title={inside ? `داخل نطاق ${br.name}` : `خارج نطاق ${br.name} — الحد المسموح ${br.radius} م`}
                    >
                      <span className="ut-pulse" />
                      <span style={{ direction: 'ltr', fontWeight: 800 }}>{dist}</span> م
                    </span>
                  );
                })()}
              </div>
              <div className="relative">
                <select value={selectedBranchId} onChange={e => setSelectedBranchId(e.target.value)} className="w-full bg-slate-900 border border-slate-700 text-white px-4 md:px-6 py-4 rounded-2xl font-bold outline-none cursor-pointer appearance-none shadow-inner focus:border-blue-500 transition-all text-right">
                  <option value="">-- اختر الفرع للتسجيل --</option>
                  {branches.map(b => (
                    <option key={b.id} value={b.id}>
                      {b.name} {isUserDefaultBranch(b, user) ? '(الفرع الأساسي)' : ''}
                    </option>
                  ))}
                </select>
                <MapPin size={18} className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-600 pointer-events-none" />
              </div>

            </div>
            <div className="space-y-2">
              <label className="text-xs font-bold text-slate-400 me-2 flex items-center gap-1"><FileText size={13} /> ملاحظات / سبب التأخير (إلزامي عند التأخير)</label>
              <textarea value={reasonText} onChange={e => setReasonText(e.target.value)} placeholder="اكتب السبب هنا في حال وجود تأخير أو انصراف مبكر..." className="w-full bg-slate-900 border border-slate-700 text-white px-4 py-3 rounded-2xl font-bold outline-none focus:border-blue-500 transition-all text-right h-24 resize-none shadow-inner text-sm leading-relaxed placeholder:text-slate-500" />
            </div>
            
            {status.type !== 'none' && (<div className={`p-4 rounded-2xl text-sm font-bold border flex items-center gap-3 ${status.type === 'success' ? 'bg-green-900/20 text-green-400 border-green-800/50' : status.type === 'info' ? 'bg-blue-900/20 text-blue-300 border-blue-800/50' : 'bg-red-900/20 text-red-400 border-red-800/50'}`}>{status.type === 'error' ? <AlertCircle size={20} className="shrink-0" /> : status.type === 'info' ? <Cloud size={20} className="shrink-0 animate-pulse" /> : <CheckCircle size={20} className="shrink-0" />}<span className="leading-relaxed">{status.msg}</span></div>)}
            
            <div className="grid grid-cols-2 gap-4">
              <button
                disabled={isVerifying}
                onClick={() => handleAttendance('check-in')}
                className="py-6 rounded-2xl font-black text-lg text-white flex flex-col items-center justify-center gap-1 transition-all active:scale-95 disabled:opacity-50"
                style={{ backgroundImage: 'var(--grad-ok)', boxShadow: '0 8px 26px rgba(16,185,129,.38)' }}
              >
                <span className="flex items-center gap-2"><CheckCircle size={22} /> حضور</span>
                {isVerifying && <span className="text-xs font-medium animate-pulse">جارٍ التحقق مع السيرفر… {waitSeconds} ث</span>}
              </button>
              <button
                disabled={isVerifying}
                onClick={() => handleAttendance('check-out')}
                className="py-6 rounded-2xl font-black text-lg text-white flex flex-col items-center justify-center gap-1 transition-all active:scale-95 disabled:opacity-50"
                style={{ backgroundImage: 'var(--grad-warn)', boxShadow: '0 8px 26px rgba(245,158,11,.35)' }}
              >
                <span className="flex items-center gap-2"><RotateCcw size={22} /> انصراف</span>
                {isVerifying && <span className="text-xs font-medium animate-pulse">جارٍ التحقق مع السيرفر… {waitSeconds} ث</span>}
              </button>
            </div>
          </div>
        </div>
      </div>
      <div className="bg-slate-800 rounded-3xl p-5 md:p-6 border border-slate-700 shadow-xl text-white">
        <h3 className="font-black mb-6 border-b border-slate-700 pb-4 flex items-center gap-2 text-blue-400 text-sm">السجل الأخير</h3>
        <div className="space-y-4">
          {myRecords.length === 0 ? (
            <div className="text-center py-10">
              <Clock size={40} className="mx-auto opacity-20 mb-3" />
              <div className="text-sm font-bold text-slate-300">لا توجد تسجيلات بعد</div>
              <div className="text-xs text-slate-500 mt-1">سيظهر هنا سجلّ حضورك وانصرافك أولاً بأول</div>
            </div>
          ) : (
            myRecords.map(r => (
              <div key={r.id} className="p-4 bg-slate-900 rounded-2xl border border-slate-700/50 group hover:border-blue-500 transition-all text-right">
                {/* الأحجام كانت 8–10px: غير مقروءة على هاتف تحت شمس الإسكندرية.
                    الحد الأدنى الآن 12px للثانوي و14px للسطر الرئيسي.
                    حُذفت uppercase وitalic — لا أثر لهما في العربية، والمائل
                    يُصطنع اصطناعاً فيشوّه اتصال الحروف. */}
                <div className="flex justify-between font-black text-sm mb-1.5"><span className="text-slate-300">{r.branchName}</span><span className={r.type === 'check-in' ? 'text-green-400' : 'text-orange-400'}>{r.type === 'check-in' ? 'حضور' : 'انصراف'}</span></div>
                <div className="text-xs text-slate-500 font-bold mb-1" style={{ direction: 'ltr', textAlign: 'right' }}>{new Date(r.timestamp).toLocaleTimeString('en-US')}</div>
                <div className="text-xs text-blue-400 font-black mb-1.5">{r.timeDiff}</div>
                {r.reason && (<div className="text-xs text-slate-400 font-bold bg-slate-800 p-2.5 rounded-lg border border-slate-700 leading-relaxed">السبب: {r.reason}</div>)}
              </div>
            ))
          )}
        </div>
      </div>
    </div>
    </div>
  );
};

export default UserDashboard;