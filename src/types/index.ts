/**
 * Application Types
 */

export enum UserRole {
  EMPLOYEE = 'employee',
  MANAGER = 'manager',
  HR = 'hr',
  ADMIN = 'admin',
  INVENTORY_APPROVER = 'inventory_approver',
}

// User interface
export interface User {
  id: string;
  email: string;
  name: string;
  role: UserRole;
  department?: string;
  /** Stored module slugs (subset of branch); omitted on legacy accounts. */
  visibleDepartments?: string[];
  branchId?: string;
  branchDepartments?: string[];
  phoneNumber?: string;
  address?: string;
  employeeId?: string;
  designation?: string;
  isActive?: boolean;
  canActAsProxy?: boolean;
  allowCheckoutWithoutWifi?: boolean;
  allowCheckinWithoutWifi?: boolean;
  sipExtension?: string;
  voipEnabled?: boolean;
  sipPasswordGenerated?: string;
}

// Auth types
export interface AuthState {
  user: User | null;
  accessToken: string | null;
  refreshToken: string | null;
  isAuthenticated: boolean;
}

export interface LoginRequest {
  email?: string;
  phoneNumber?: string;
  password: string;
}

export interface LoginResponse {
  user: User;
  accessToken: string;
  refreshToken: string;
}

export interface RefreshTokenResponse {
  accessToken: string;
  refreshToken: string;
  sessionId?: string;
}

// Proxy types
export interface ProxyPermission {
  canActAsProxy: boolean;
}

export interface ProxyServerStatus {
  isRunning: boolean;
  port: number;
  ipAddress: string | null;
  connectedClients: number;
  isRegistered?: boolean;
  lastRegistrationAttempt?: string | null;
  lastRegistrationError?: string | null;
  mainServerUrl?: string;
}

export interface NodeMCUProxy {
  id: string;
  nodeMCUId: string;
  displayName?: string;
  ipAddress?: string;
  port: number;
  lastHeartbeat?: string;
  isActive: boolean;
}

export interface GateDevice {
  id: string;
  gateId: string;
  displayName?: string;
  lastSeen?: string;
  isActive: boolean;
}

export interface EdgeDeviceCapabilities {
  proxy: boolean;
  gateBeacon: boolean;
  gateAudio: boolean;
}

export interface EdgeDevice {
  id: string;
  deviceId: string;
  displayName?: string;
  deviceType?: string;
  capabilities: EdgeDeviceCapabilities;
  isActive: boolean;
  lastSeen?: string;
  ipAddress?: string;
  port?: number;
  wifiRssi?: number;
  meta?: {
    branchId?: string;
    locationId?: string;
  };
}

// Attendance enums
export enum AttendanceSessionStatus {
  NOT_STARTED = 'NOT_STARTED',
  CHECKED_IN = 'CHECKED_IN',
  CHECKED_OUT = 'CHECKED_OUT',
}

export enum AttendanceSource {
  MOBILE = 'mobile',
  WEB = 'web',
  DESKTOP = 'desktop',
}

export enum AttendanceApprovalStatus {
  NONE = 'none',
  PENDING = 'pending',
  APPROVED = 'approved',
  REJECTED = 'rejected',
  CANCELLED = 'cancelled',
}

export enum AttendanceMarkingFrom {
  HOME = 'HOME',
  CLIENT_SITE = 'CLIENT_SITE',
  TRAVEL = 'TRAVEL',
  OTHER = 'OTHER',
}

export type AttendanceApprovalLeg = 'check_in' | 'check_out';

export interface RemoteJustification {
  remoteNote: string;
  markingFrom: AttendanceMarkingFrom;
  markingFromOther?: string;
  location?: {
    latitude?: number;
    longitude?: number;
    address?: string;
  };
}

export interface RemoteApprovalLegResponse {
  status: AttendanceApprovalStatus;
  networkVerified: boolean;
  remoteNote?: string;
  markingFrom?: AttendanceMarkingFrom;
  markingFromOther?: string;
  submittedAt?: string;
  rejectReason?: string;
}

// Attendance interfaces
export interface AttendanceRecord {
  id: string;
  employeeId: string;
  date: string;
  checkInTime: string;
  checkOutTime?: string;
  status: AttendanceSessionStatus;
  source: AttendanceSource;
  totalDuration?: number;
  createdAt: string;
  updatedAt: string;
  checkInApproval?: RemoteApprovalLegResponse;
  checkOutApproval?: RemoteApprovalLegResponse;
  isOfficiallyPresent?: boolean;
  isDurationOfficial?: boolean;
}

export interface AttendanceStatusResponse {
  status: AttendanceSessionStatus;
  today?: AttendanceRecord;
  canCheckIn: boolean;
  canCheckOut: boolean;
  allowMultipleCheckIns?: boolean;
  pendingCheckIn?: boolean;
  pendingCheckOut?: boolean;
}

export interface CheckInRequest {
  source: AttendanceSource;
  location?: {
    latitude?: number;
    longitude?: number;
    address?: string;
  };
  wifi?: {
    ssid: string;
    bssid?: string;
  };
  ethernet?: {
    macAddress: string;
  };
  systemFingerprint?: string;
  remoteJustification?: RemoteJustification;
}

export interface CheckOutRequest {
  source: AttendanceSource;
  location?: {
    latitude?: number;
    longitude?: number;
    address?: string;
  };
  wifi?: {
    ssid: string;
    bssid?: string;
  };
  ethernet?: {
    macAddress: string;
  };
  systemFingerprint?: string;
  checkOutTime?: string;
  remoteJustification?: RemoteJustification;
}

export interface PendingApprovalRow {
  attendanceId: string;
  employeeId: string;
  employeeName: string;
  department?: string;
  date: string;
  leg: AttendanceApprovalLeg;
  checkInTime?: string;
  checkOutTime?: string;
  remoteNote?: string;
  markingFrom?: AttendanceMarkingFrom;
  markingFromOther?: string;
  submittedAt?: string;
  status: AttendanceSessionStatus;
}

export interface AttendanceDashboardRow {
  employeeId: string;
  employeeName: string;
  department?: string;
  role?: string;
  status: AttendanceSessionStatus;
  checkInTime?: string;
  checkOutTime?: string;
  totalDuration?: number;
  allowManualAttendanceOverride?: boolean;
  manualAttendanceOverrideAllowedUserIds?: string[];
  checkInApprovalStatus?: AttendanceApprovalStatus;
  checkOutApprovalStatus?: AttendanceApprovalStatus;
  isOfficiallyPresent?: boolean;
}

export interface AttendanceDashboardData {
  rows: AttendanceDashboardRow[];
  total: number;
  page: number;
  limit: number;
  departments: string[];
  summary: {
    totalEmployees: number;
    checkedInCount: number;
    checkedOutCount: number;
    notStartedCount: number;
    pendingCount?: number;
  };
}

// Re-export shift types
export * from './shift';

// Branch types
export interface Branch {
  id: string;
  name: string;
  code: string;
  address?: string;
  phone?: string;
  email?: string;
  branchManager?: {
    id: string;
    name: string;
    email: string;
  };
  departments: string[];
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface CreateBranchRequest {
  name: string;
  code: string;
  address?: string;
  phone?: string;
  email?: string;
  branchManager?: string; // User ID
  departments?: string[];
}

export interface UpdateBranchRequest {
  name?: string;
  code?: string;
  address?: string;
  phone?: string;
  email?: string;
  branchManager?: string; // User ID
  departments?: string[];
  isActive?: boolean;
}

// Employee Details enums and types
export enum EmploymentType {
  FULL_TIME = 'full_time',
  PART_TIME = 'part_time',
  CONTRACT = 'contract',
}

export enum AttendanceMode {
  STRICT = 'strict',
  FLEXIBLE = 'flexible',
}

export enum TaskVisibility {
  PRIVATE = 'private',
  TEAM = 'team',
}

export interface EmployeeDetails {
  // Profile Summary
  id: string;
  employeeId?: string;
  name: string;
  email: string;
  phoneNumber?: string;
  profilePhoto?: string;
  isActive: boolean;
  
  // Employment & Role
  role: UserRole;
  designation?: string;
  department?: string;
  visibleDepartments?: string[];
  branchId?: string;
  reportingManager?: {
    id: string;
    name: string;
    email: string;
  };
  employmentType?: EmploymentType;
  dateOfJoining?: string;
  
  // Shift & Attendance
  assignedShift?: {
    id: string;
    name: string;
    code: string;
    startTime: string;
    endTime: string;
  };
  shiftAssignmentType?: 'permanent' | 'temporary' | 'rotational' | 'override';
  shiftEffectiveFrom?: string;
  shiftEffectiveTo?: string;
  attendanceMode?: AttendanceMode;
  allowManualAttendanceOverride?: boolean;
  manualAttendanceOverrideAllowedUserIds?: string[];
  locationRestrictionOverride?: boolean;
  deviceRestrictionOverride?: boolean;
  allowCheckoutWithoutWifi?: boolean;
  allowCheckinWithoutWifi?: boolean;
  
  // Task & Work Preferences
  defaultTaskVisibility?: TaskVisibility;
  canReceiveTasksFrom?: UserRole[];
  allowedTaskCreation?: 'self_only' | 'disabled';
  preferredWorkingHours?: {
    start?: string;
    end?: string;
  };
  calendarVisibilityScope?: 'own_only' | 'team_view';
  
  // Permissions & Overrides
  attendanceOverridePermission?: 'none' | 'manager' | 'hr_admin';
  taskStatusOverridePermission?: boolean;
  overtimeEligibilityOverride?: boolean;
  breakRuleOverride?: boolean;
  holidayWorkingPermission?: boolean;
  canActAsProxy?: boolean;

  // VoIP
  sipExtension?: string;
  voipEnabled?: boolean;
  /** Returned once when an extension is provisioned in this response */
  sipPasswordGenerated?: string;
  
  // System & Audit (read-only)
  createdAt: string;
  updatedAt: string;
  lastLogin?: string;
  lastAttendanceAction?: string;
  lastTaskUpdate?: string;
}

export interface UpdateEmployeeDetailsRequest {
  // Profile Summary
  name?: string;
  phoneNumber?: string;
  profilePhoto?: string;
  isActive?: boolean;
  
  // Employment & Role
  role?: UserRole;
  designation?: string;
  department?: string;
  visibleDepartments?: string[];
  branchId?: string;
  reportingManagerId?: string;
  employmentType?: EmploymentType;
  dateOfJoining?: string;
  
  // Shift & Attendance
  assignedShiftId?: string;
  shiftAssignmentType?: 'permanent' | 'temporary' | 'rotational' | 'override';
  shiftEffectiveFrom?: string;
  shiftEffectiveTo?: string;
  attendanceMode?: AttendanceMode;
  allowManualAttendanceOverride?: boolean;
  manualAttendanceOverrideAllowedUserIds?: string[];
  locationRestrictionOverride?: boolean;
  deviceRestrictionOverride?: boolean;
  allowCheckoutWithoutWifi?: boolean;
  allowCheckinWithoutWifi?: boolean;
  
  // Task & Work Preferences
  defaultTaskVisibility?: TaskVisibility;
  canReceiveTasksFrom?: UserRole[];
  allowedTaskCreation?: 'self_only' | 'disabled';
  preferredWorkingHours?: {
    start?: string;
    end?: string;
  };
  calendarVisibilityScope?: 'own_only' | 'team_view';
  
  // Permissions & Overrides
  attendanceOverridePermission?: 'none' | 'manager' | 'hr_admin';
  taskStatusOverridePermission?: boolean;
  overtimeEligibilityOverride?: boolean;
  breakRuleOverride?: boolean;
  holidayWorkingPermission?: boolean;
  canActAsProxy?: boolean;

  // VoIP (HR/Admin)
  enableVoip?: boolean;
  sipExtension?: string;
  resetVoipPassword?: boolean;
  
  // Optional reason for audit
  reason?: string;
}
