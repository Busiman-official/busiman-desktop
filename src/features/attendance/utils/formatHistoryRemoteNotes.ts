import { AttendanceMarkingFrom, RemoteApprovalLegResponse } from '@/types';

const FROM_LABEL: Record<AttendanceMarkingFrom, string> = {
  [AttendanceMarkingFrom.HOME]: 'Home',
  [AttendanceMarkingFrom.CLIENT_SITE]: 'Client site',
  [AttendanceMarkingFrom.TRAVEL]: 'Travel',
  [AttendanceMarkingFrom.OTHER]: 'Other',
};

function formatMarkingFrom(
  markingFrom?: AttendanceMarkingFrom,
  other?: string
): string | null {
  if (!markingFrom) return null;
  if (markingFrom === AttendanceMarkingFrom.OTHER && other?.trim()) {
    return other.trim();
  }
  return FROM_LABEL[markingFrom] ?? markingFrom;
}

export interface HistoryRemoteNoteEntry {
  legLabel: string;
  remoteNote: string;
  markingFromLabel: string | null;
}

type RecordWithApprovals = {
  checkInApproval?: RemoteApprovalLegResponse;
  checkOutApproval?: RemoteApprovalLegResponse;
};

export function getHistoryRemoteNoteEntries(record: RecordWithApprovals): HistoryRemoteNoteEntry[] {
  const entries: HistoryRemoteNoteEntry[] = [];

  const checkInNote = record.checkInApproval?.remoteNote?.trim();
  if (checkInNote) {
    entries.push({
      legLabel: 'Check-in',
      remoteNote: checkInNote,
      markingFromLabel: formatMarkingFrom(
        record.checkInApproval?.markingFrom,
        record.checkInApproval?.markingFromOther
      ),
    });
  }

  const checkOutNote = record.checkOutApproval?.remoteNote?.trim();
  if (checkOutNote) {
    entries.push({
      legLabel: 'Check-out',
      remoteNote: checkOutNote,
      markingFromLabel: formatMarkingFrom(
        record.checkOutApproval?.markingFrom,
        record.checkOutApproval?.markingFromOther
      ),
    });
  }

  return entries;
}
