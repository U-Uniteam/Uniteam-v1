
export interface Branch {
  id: string;
  code?: string;
  name: string;
  latitude: number;
  longitude: number;
  radius: number;
}

export interface Job {
  id: string;
  title: string;
  workingDays?: number[];
  canVisitMultipleBranches?: boolean; // New: Allow this job to have visit plans
}

export interface VisitPlan {
  id: string;
  userId: string;
  userName: string;
  userSerial?: string; // New: Serial number for easier matching
  branchId: string;
  branchName: string;
  date: string; // ISO date string (YYYY-MM-DD)
}

export interface User {
  id: string;
  fullName: string;
  nationalId: string;
  serialNumber?: string; // الرقم التسلسلي الجديد (السنة + الترتيب)
  password?: string;
  employeeId?: string;
  role: 'employee' | 'admin';
  deviceId?: string; // Legacy support
  deviceIds?: string[]; // New: Array of linked device IDs
  allowedDeviceCount?: number; // New: Limit of devices per user
  jobTitle?: string;
  defaultBranchId?: string; 
  defaultBranch?: string;
  assignedBranch?: string;
  branch?: string;
  registrationDate?: string; 
  checkInTime?: string; 
  checkOutTime?: string; 
}

export interface ReportAccount {
  id: string;
  username: string;
  password?: string;
  allowedJobs: string[];
  allowedEmployees?: string[]; // New: Allow specific employees access
  telegram?: boolean;           // صلاحية رسائل تليجرام لطلبات موظفيه
}

export interface AttendanceRecord {
  id: string;
  userId: string;
  userName: string;
  userJob?: string;
  serialNumber?: string; // الرقم التسلسلي للسجل
  branchId: string;
  branchName: string;
  type: 'check-in' | 'check-out';
  timestamp: string;
  latitude: number;
  longitude: number;
  reason?: string; 
  timeDiff?: string; 
}

export interface AppConfig {
  googleSheetLink: string;
  syncUrl: string;
  auditLogUrl?: string; // New: URL for the audit log sheet (optional if same as syncUrl)
  adminUsername: string;
  adminPassword?: string;
  lastUpdated?: string;
  holidays?: string[];
}

// ---------- الطلبات: الخطة الشهرية وطلب الإجازة ----------

export type RequestStatus = 'pending' | 'approved' | 'modified' | 'rejected' | 'cancelled';

/** يوم في الخطة الشهرية */
export interface PlanDay {
  date: string;       // YYYY-MM-DD
  branchId: string;
  branchName: string;
  /** سبب اختيار Out Door — إلزامي لهذا الفرع وحده */
  reason?: string;
}

/** تفاصيل طلب الإجازة */
export interface LeaveDetails {
  from: string;       // YYYY-MM-DD
  to: string;         // YYYY-MM-DD
  leaveType: string;  // اعتيادية · عارضة · مرضية · أخرى
  reason?: string;
}

/**
 * طلب موظف كما يخزّنه شيت Requests.
 * items: آخر ما أرسله الموظف. approvedItems: آخر ما اعتمده المدير (الساري).
 */
export interface StaffRequest {
  id: string;
  type: 'plan' | 'leave';
  userId: string;
  userName: string;
  serialNumber?: string;
  jobTitle?: string;
  month: string;      // YYYY-MM
  items: PlanDay[] | LeaveDetails;
  status: RequestStatus;
  approvedItems: PlanDay[] | LeaveDetails | null;
  managerNote?: string;
  submittedAt: string;
  decidedAt?: string;
  decidedBy?: string;
}
