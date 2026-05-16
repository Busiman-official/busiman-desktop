/**
 * Attendance Dashboard Component
 * Shows real-time attendance data for HR/Manager/Admin
 */

import React, { useState, useEffect } from 'react';
import { attendanceService } from '@/services/attendance.service';
import { socketService } from '@/services/socket.service';
import { AttendanceDashboardData, AttendanceSessionStatus } from '@/types';
import './AttendanceDashboard.css';

interface AttendanceDashboardProps {
  role: 'hr' | 'manager' | 'admin';
}

export const AttendanceDashboard: React.FC<AttendanceDashboardProps> = ({ role }) => {
  const [dashboardData, setDashboardData] = useState<AttendanceDashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedDate, setSelectedDate] = useState<string>(
    new Date().toISOString().split('T')[0]
  );
  const [selectedDepartment, setSelectedDepartment] = useState<string>('');

  useEffect(() => {
    loadDashboard();
    
    // Connect to Socket.IO
    socketService.connect();

    // Subscribe to real-time updates
    socketService.onAttendanceUpdate(() => {
      loadDashboard();
    });

    socketService.onDashboardRefresh(() => {
      loadDashboard();
    });

    return () => {
      socketService.offAttendanceUpdate();
      socketService.offDashboardRefresh();
    };
  }, [selectedDate, selectedDepartment]);

  const loadDashboard = async () => {
    setLoading(true);
    setError(null);

    try {
      const data = await attendanceService.getDashboard({
        date: selectedDate,
        department: selectedDepartment || undefined,
      });
      setDashboardData(data);
    } catch (err: any) {
      setError(err.response?.data?.message || 'Failed to load attendance dashboard');
    } finally {
      setLoading(false);
    }
  };

  const formatTime = (isoString?: string): string => {
    if (!isoString) return '—';
    const date = new Date(isoString);
    return date.toLocaleTimeString('en-US', {
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  const formatDuration = (minutes?: number): string => {
    if (minutes == null || minutes <= 0) return '—';
    const hours = Math.floor(minutes / 60);
    const mins = minutes % 60;
    return `${hours}h ${mins}m`;
  };

  if (loading && !dashboardData) {
    return (
      <div className="attendance-dashboard">
        <div className="dashboard-loading">Loading attendance data...</div>
      </div>
    );
  }

  if (error && !dashboardData) {
    return (
      <div className="attendance-dashboard">
        <div className="dashboard-error">{error}</div>
      </div>
    );
  }

  if (!dashboardData) {
    return null;
  }

  const checkedIn = dashboardData.rows.filter(
    (r) => r.status === AttendanceSessionStatus.CHECKED_IN
  );
  const checkedOut = dashboardData.rows.filter(
    (r) => r.status === AttendanceSessionStatus.CHECKED_OUT
  );
  const notStarted = dashboardData.rows.filter(
    (r) => r.status === AttendanceSessionStatus.NOT_STARTED
  );

  return (
    <div className="attendance-dashboard">
      <div className="dashboard-header">
        <h2>Attendance Dashboard</h2>
        <div className="dashboard-filters">
          <input
            type="date"
            value={selectedDate}
            onChange={(e) => setSelectedDate(e.target.value)}
            className="filter-input"
          />
          <input
            type="text"
            placeholder="Filter by department..."
            value={selectedDepartment}
            onChange={(e) => setSelectedDepartment(e.target.value)}
            className="filter-input"
          />
          <button onClick={loadDashboard} className="btn-refresh">
            Refresh
          </button>
        </div>
      </div>

      {error && <div className="dashboard-error">{error}</div>}

      <div className="dashboard-summary">
        <div className="summary-card total">
          <div className="summary-label">Total Employees</div>
          <div className="summary-value">{dashboardData.summary.totalEmployees}</div>
        </div>
        <div className="summary-card checked-in">
          <div className="summary-label">Checked In</div>
          <div className="summary-value">{dashboardData.summary.checkedInCount}</div>
        </div>
        <div className="summary-card checked-out">
          <div className="summary-label">Checked Out</div>
          <div className="summary-value">{dashboardData.summary.checkedOutCount}</div>
        </div>
        <div className="summary-card not-started">
          <div className="summary-label">Not Started</div>
          <div className="summary-value">{dashboardData.summary.notStartedCount}</div>
        </div>
      </div>

      <div className="dashboard-sections">
        {/* Checked In Section */}
        <div className="dashboard-section">
          <h3 className="section-title checked-in-title">
            Checked In ({dashboardData.summary.checkedInCount})
          </h3>
          <div className="employee-list">
            {checkedIn.length === 0 ? (
              <div className="empty-state">No employees checked in</div>
            ) : (
              checkedIn.map((emp) => (
                <div key={emp.employeeId} className="employee-item checked-in-item">
                  <div className="employee-info">
                    <div className="employee-name">{emp.employeeName}</div>
                    {emp.department && (
                      <div className="employee-department">{emp.department}</div>
                    )}
                  </div>
                  <div className="employee-time">
                    <div className="time-label">Checked in at</div>
                    <div className="time-value">{formatTime(emp.checkInTime)}</div>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>

        {/* Checked Out Section */}
        <div className="dashboard-section">
          <h3 className="section-title checked-out-title">
            Checked Out ({dashboardData.summary.checkedOutCount})
          </h3>
          <div className="employee-list">
            {checkedOut.length === 0 ? (
              <div className="empty-state">No employees checked out</div>
            ) : (
              checkedOut.map((emp) => (
                <div key={emp.employeeId} className="employee-item checked-out-item">
                  <div className="employee-info">
                    <div className="employee-name">{emp.employeeName}</div>
                    {emp.department && (
                      <div className="employee-department">{emp.department}</div>
                    )}
                  </div>
                  <div className="employee-times">
                    <div className="time-group">
                      <div className="time-label">In</div>
                      <div className="time-value">{formatTime(emp.checkInTime)}</div>
                    </div>
                    <div className="time-group">
                      <div className="time-label">Out</div>
                      <div className="time-value">{formatTime(emp.checkOutTime)}</div>
                    </div>
                    <div className="time-group">
                      <div className="time-label">Duration</div>
                      <div className="time-value">{formatDuration(emp.totalDuration)}</div>
                    </div>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>

        {/* Not Started Section */}
        <div className="dashboard-section">
          <h3 className="section-title not-started-title">
            Not Started ({dashboardData.summary.notStartedCount})
          </h3>
          <div className="employee-list">
            {notStarted.length === 0 ? (
              <div className="empty-state">All employees have started</div>
            ) : (
              notStarted.map((emp) => (
                <div key={emp.employeeId} className="employee-item not-started-item">
                  <div className="employee-info">
                    <div className="employee-name">{emp.employeeName}</div>
                    {emp.department && (
                      <div className="employee-department">{emp.department}</div>
                    )}
                  </div>
                  <div className="employee-status">Not checked in</div>
                </div>
              ))
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

