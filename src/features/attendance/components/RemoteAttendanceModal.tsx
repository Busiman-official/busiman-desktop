/**
 * Modal for remote attendance justification (off approved office network)
 */

import React, { useState, useEffect } from 'react';
import { Modal } from '@/shared/components/modals/Modal';
import { Button, Select } from '@/shared/components/ui';
import { AttendanceMarkingFrom, RemoteJustification } from '@/types';
import './RemoteAttendanceModal.css';

const MARKING_OPTIONS = [
  { value: AttendanceMarkingFrom.HOME, label: 'Home' },
  { value: AttendanceMarkingFrom.CLIENT_SITE, label: 'Client site' },
  { value: AttendanceMarkingFrom.TRAVEL, label: 'Travel' },
  { value: AttendanceMarkingFrom.OTHER, label: 'Other' },
];

interface RemoteAttendanceModalProps {
  isOpen: boolean;
  onClose: () => void;
  action: 'check-in' | 'check-out';
  onSubmit: (justification: RemoteJustification) => Promise<void>;
  loading?: boolean;
}

export const RemoteAttendanceModal: React.FC<RemoteAttendanceModalProps> = ({
  isOpen,
  onClose,
  action,
  onSubmit,
  loading = false,
}) => {
  const [remoteNote, setRemoteNote] = useState('');
  const [markingFrom, setMarkingFrom] = useState<AttendanceMarkingFrom>(AttendanceMarkingFrom.HOME);
  const [markingFromOther, setMarkingFromOther] = useState('');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (isOpen) {
      setRemoteNote('');
      setMarkingFrom(AttendanceMarkingFrom.HOME);
      setMarkingFromOther('');
      setError(null);
    }
  }, [isOpen]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    const note = remoteNote.trim();
    if (note.length < 20) {
      setError('Please provide an explanation of at least 20 characters.');
      return;
    }
    if (markingFrom === AttendanceMarkingFrom.OTHER && markingFromOther.trim().length < 3) {
      setError('Please specify where you are marking from.');
      return;
    }

    let location: RemoteJustification['location'];
    if (navigator.geolocation) {
      try {
        const pos = await new Promise<GeolocationPosition>((resolve, reject) => {
          navigator.geolocation.getCurrentPosition(resolve, reject, { timeout: 5000 });
        });
        location = {
          latitude: pos.coords.latitude,
          longitude: pos.coords.longitude,
        };
      } catch {
        // optional geo
      }
    }

    await onSubmit({
      remoteNote: note,
      markingFrom,
      markingFromOther:
        markingFrom === AttendanceMarkingFrom.OTHER ? markingFromOther.trim() : undefined,
      location,
    });
  };

  const title = action === 'check-in' ? 'Remote check-in' : 'Remote check-out';

  return (
    <Modal isOpen={isOpen} onClose={onClose} title={title} size="md">
      <form className="remote-attendance-modal" onSubmit={(e) => void handleSubmit(e)}>
        <p className="remote-attendance-modal-intro">
          You are not on an approved office network. Explain why you are not on-site and where you
          are marking attendance from. Your request will be sent for manager approval.
        </p>

        <label className="remote-attendance-modal-label">
          Explanation <span className="required">*</span>
          <textarea
            className="remote-attendance-modal-textarea"
            value={remoteNote}
            onChange={(e) => setRemoteNote(e.target.value)}
            rows={4}
            maxLength={500}
            placeholder="Why are you not on-site? Include relevant details (min. 20 characters)."
            disabled={loading}
          />
          <span className="remote-attendance-modal-hint">{remoteNote.trim().length}/500</span>
        </label>

        <label className="remote-attendance-modal-label">
          Marking from <span className="required">*</span>
          <Select
            value={markingFrom}
            onChange={(e) => setMarkingFrom(e.target.value as AttendanceMarkingFrom)}
            options={MARKING_OPTIONS}
            disabled={loading}
          />
        </label>

        {markingFrom === AttendanceMarkingFrom.OTHER && (
          <label className="remote-attendance-modal-label">
            Specify location <span className="required">*</span>
            <input
              type="text"
              className="remote-attendance-modal-input"
              value={markingFromOther}
              onChange={(e) => setMarkingFromOther(e.target.value)}
              disabled={loading}
              maxLength={200}
            />
          </label>
        )}

        {error ? <div className="remote-attendance-modal-error">{error}</div> : null}

        <div className="remote-attendance-modal-actions">
          <Button type="button" variant="secondary" onClick={onClose} disabled={loading}>
            Cancel
          </Button>
          <Button type="submit" variant="primary" disabled={loading}>
            {loading ? 'Submitting…' : 'Submit for approval'}
          </Button>
        </div>
      </form>
    </Modal>
  );
};
