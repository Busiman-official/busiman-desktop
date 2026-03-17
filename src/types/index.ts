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
  branchId?: string;
  branchDepartments?: string[];
  phoneNumber?: string;
  address?: string;
  employeeId?: string;
  designation?: string;
  isActive?: boolean;
  canActAsProxy?: boolean;
  allowCheckoutWithoutWifi?: boolean;
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
}

export interface AttendanceStatusResponse {
  status: AttendanceSessionStatus;
  today?: AttendanceRecord;
  canCheckIn: boolean;
  canCheckOut: boolean;
  allowMultipleCheckIns?: boolean; // Whether multiple check-ins per day are allowed for the shift
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
  checkOutTime?: string; // ISO string - optional, for recovery check-outs at specific time
}

export interface AttendanceDashboardData {
  checkedIn: Array<{
    employeeId: string;
    employeeName: string;
    department?: string;
    role?: string;
    checkInTime: string;
    status: AttendanceSessionStatus;
  }>;
  checkedOut: Array<{
    employeeId: string;
    employeeName: string;
    department?: string;
    role?: string;
    checkInTime: string;
    checkOutTime: string;
    totalDuration: number;
    status: AttendanceSessionStatus;
  }>;
  notStarted: Array<{
    employeeId: string;
    employeeName: string;
    department?: string;
    role?: string;
  }>;
  summary: {
    totalEmployees: number;
    checkedInCount: number;
    checkedOutCount: number;
    notStartedCount: number;
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
  locationRestrictionOverride?: boolean;
  deviceRestrictionOverride?: boolean;
  allowCheckoutWithoutWifi?: boolean;
  
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
  locationRestrictionOverride?: boolean;
  deviceRestrictionOverride?: boolean;
  allowCheckoutWithoutWifi?: boolean;
  
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
  
  // Optional reason for audit
  reason?: string;
}
