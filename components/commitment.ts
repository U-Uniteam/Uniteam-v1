/**
 * تقرير الالتزام — الحساب.
 *
 * نفس أوزان ورقة «Summary Report» الأولى في ملف المتابعة اليدوي:
 *   الالتزام = (١×الخطة + ٠٫٩×N + ٠٫١×O + ٠٫٩×P + ٠٫١×Q + ١×R) ÷ ٤
 *
 * الأعداد المعروضة (أيام التأخير، ساعات الانصراف المبكر…) لا تتغير؛ الذي تغيّر
 * هو حساب النسب: العبرة بساعات العمل لا بلحظة الحضور.
 * - رصيد التعويض في الفترة = دقائق الحضور المبكر + دقائق البقاء بعد الموعد.
 * - يغطي الرصيد أيام التأخير والانصراف المبكر الأصغر أولاً؛ اليوم المغطّى لا يُعدّ في O وQ.
 * - R: صافي الوقت في الفترة (تأخير + انصراف مبكر − بقاء بعد الموعد − حضور مبكر).
 *   كل ٥ ساعات صافية تُخصم يوماً، والفائض يُضاف، بين ٠ و١٠٠٪.
 * - O وQ تقسمان كلتاهما على أيام الحضور الفعلي (كانت Q تقسم على أيام العمل المتاحة).
 * - الالتزام بالخطة: يوم ملتزم إن كان فرع الحضور أو الانصراف هو فرع الخطة.
 * - من ليس له أيام عمل معتمدة في الفترة: نسبه null وتظهر «—».
 */

export interface DayDetail {
  lateIn: number;    // دقائق الحضور المتأخر
  earlyIn: number;   // دقائق الحضور المبكر
  earlyOut: number;  // دقائق الانصراف المبكر
  overtime: number;  // دقائق البقاء بعد الموعد
  inBranch: string;
  outBranch: string;
  plans: string[];   // فروع الخطة لهذا اليوم (بلا الإجازات)
}

export interface CommitmentInput {
  workingDays: number; // C
  attDays: number;     // D
  depDays: number;     // E
  absDays: number;     // F
  days: DayDetail[];   // أيام العمل المعتمدة التي فيها تسجيل
}

export interface CommitmentResult {
  commitment: number | null;
  adherence: number | null;
  N: number; O: number; P: number; Q: number; R: number;
  lateDays: number; earlyDays: number;          // كما في التقرير
  effLateDays: number; effEarlyDays: number;    // بعد التعويض
  coveredDays: number;
  compensationMin: number; deficitMin: number; netMin: number;
  planDays: number;
}

export const WEIGHTS = { plan: 1, N: 0.9, O: 0.1, P: 0.9, Q: 0.1, R: 1, divisor: 4 };

const norm = (s: string) => (s || '').toString().trim().toLowerCase();
const clamp01 = (x: number) => (x < 0 ? 0 : x > 1 ? 1 : x);

export function computeCommitment(i: CommitmentInput): CommitmentResult {
  const C = i.workingDays, D = i.attDays, E = i.depDays, F = i.absDays;
  const present = C - F;

  const compensationMin = i.days.reduce((a, d) => a + d.earlyIn + d.overtime, 0);
  const lateItems = i.days.filter(d => d.lateIn > 0).map(d => ({ kind: 'late', min: d.lateIn }));
  const earlyItems = i.days.filter(d => d.earlyOut > 0).map(d => ({ kind: 'early', min: d.earlyOut }));
  const deficitMin = [...lateItems, ...earlyItems].reduce((a, x) => a + x.min, 0);

  // الرصيد يغطي الأصغر أولاً
  let pool = compensationMin, effLate = lateItems.length, effEarly = earlyItems.length, covered = 0;
  [...lateItems, ...earlyItems].sort((a, b) => a.min - b.min).forEach(x => {
    if (pool >= x.min) {
      pool -= x.min; covered++;
      if (x.kind === 'late') effLate--; else effEarly--;
    }
  });

  const planDays = i.days.filter(d => d.plans.length > 0 &&
    (d.plans.indexOf(norm(d.inBranch)) !== -1 || d.plans.indexOf(norm(d.outBranch)) !== -1)).length;

  const netMin = deficitMin - compensationMin;

  if (C <= 0) {
    return { commitment: null, adherence: null, N: 0, O: 0, P: 0, Q: 0, R: 0,
      lateDays: lateItems.length, earlyDays: earlyItems.length, effLateDays: effLate, effEarlyDays: effEarly,
      coveredDays: covered, compensationMin, deficitMin, netMin, planDays };
  }

  const N = D / C;
  const P = E / C;
  const O = present > 0 ? clamp01(1 - effLate / present) * N : 0;
  const Q = present > 0 ? clamp01(1 - effEarly / present) * N : 0;
  const netH = netMin / 60;
  let R = 0;
  if (present > 0) {
    R = netH >= 0 ? (1 - netH / (5 * present)) * N : ((-netH) / 5 + D) / C;
  }
  R = clamp01(R);
  const adherence = planDays / C;
  const w = WEIGHTS;
  const commitment = (w.plan * adherence + w.N * N + w.O * O + w.P * P + w.Q * Q + w.R * R) / w.divisor;

  return { commitment, adherence, N, O, P, Q, R,
    lateDays: lateItems.length, earlyDays: earlyItems.length, effLateDays: effLate, effEarlyDays: effEarly,
    coveredDays: covered, compensationMin, deficitMin, netMin, planDays };
}
