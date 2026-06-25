import React from 'react';
import { Button } from '@/shared/components/ui';

export interface CounterHeldDraftItem {
  id: string;
}

export interface CounterHeldDraftsBannerProps<T extends CounterHeldDraftItem> {
  drafts: T[];
  maxVisible?: number;
  labelForIndex?: (draft: T, indexFromEnd: number) => string;
  onResume: (draft: T) => void;
  onDiscard: (draftId: string) => void;
}

export function CounterHeldDraftsBanner<T extends CounterHeldDraftItem>({
  drafts,
  maxVisible = 6,
  labelForIndex = (_d, idx) => `Draft ${idx}`,
  onResume,
  onDiscard,
}: CounterHeldDraftsBannerProps<T>) {
  if (drafts.length === 0) return null;

  return (
    <div className="pos-draft-banner" role="status" aria-label="Drafts">
      <span className="pos-draft-banner__text">Drafts ({drafts.length})</span>
      <div className="pos-draft-banner__actions" style={{ gap: 8, flexWrap: 'wrap' }}>
        {drafts.slice(0, maxVisible).map((d, idx) => (
          <div key={d.id} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <span className="pos-muted" style={{ fontSize: 12 }}>
              {labelForIndex(d, drafts.length - idx)}
            </span>
            <Button type="button" variant="primary" onClick={() => onResume(d)}>
              Resume
            </Button>
            <Button type="button" variant="secondary" onClick={() => onDiscard(d.id)}>
              Discard
            </Button>
          </div>
        ))}
      </div>
    </div>
  );
}
