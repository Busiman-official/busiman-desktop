/**
 * Local calendar date helpers for attendance (avoids UTC day shift on YYYY-MM-DD).
 */

export function localDateISO(d = new Date()): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export function attendanceDateYmd(date: string): string {
  if (/^\d{4}-\d{2}-\d{2}$/.test(date)) return date;
  const d = new Date(date);
  return Number.isNaN(d.getTime()) ? localDateISO() : localDateISO(d);
}

export function formatAttendanceDateLabel(iso: string): string {
  const ymd = attendanceDateYmd(iso);
  const [y, m, day] = ymd.split('-').map(Number);
  const local = new Date(y, m - 1, day);
  return local.toLocaleDateString('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}
