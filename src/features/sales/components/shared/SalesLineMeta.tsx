import React from 'react';
import './SalesLineMeta.css';

/** Order line, quotation line, or any object with overlapping optional fields. */
export type SalesLineMetaSource = Record<string, unknown>;

function num(v: unknown): number | undefined {
  if (v == null) return undefined;
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
}

function str(v: unknown): string | undefined {
  if (typeof v !== 'string') return undefined;
  const t = v.trim();
  return t || undefined;
}

/**
 * Secondary line: HSN, GST %, list vs unit price, line discount, notes (POS / quotation / order API).
 */
export const SalesLineMeta: React.FC<{ line: SalesLineMetaSource; className?: string }> = ({
  line,
  className = '',
}) => {
  const hsn = str(line.posHsn) || str(line.hsn);
  const notes = str(line.posLineNotes) || str(line.lineNotes);
  const gst = num(line.posGstRatePercent) ?? num(line.taxRatePercent);
  const lineDisc = num(line.posLineDiscountAmount) ?? num(line.discountAmount);
  const listUnit = num(line.posListUnitPrice);
  const unit = num(line.unitPrice);
  const parts: React.ReactNode[] = [];
  if (line.posGstInclusive === false || line.priceIncludesGst === false) {
    parts.push(<span key="mode">GST extra</span>);
  } else if (line.posGstInclusive === true || line.priceIncludesGst === true) {
    parts.push(<span key="mode">GST inclusive</span>);
  }
  if (hsn) parts.push(<span key="hsn">HSN {hsn}</span>);
  if (gst != null) parts.push(<span key="gst">GST {gst}%</span>);
  if (lineDisc != null && lineDisc > 0) {
    parts.push(
      <span key="disc">Line disc −₹{lineDisc.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
    );
  }
  if (listUnit != null && unit != null && Math.abs(listUnit - unit) > 0.0001) {
    parts.push(
      <span key="list">
        List ₹{listUnit.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
      </span>
    );
  }
  if (notes) {
    parts.push(
      <span key="note" className="sales-line-meta__note" title={notes}>
        Note: {notes.length > 80 ? `${notes.slice(0, 80)}…` : notes}
      </span>
    );
  }
  if (parts.length === 0) return null;
  return (
    <div className={`sales-line-meta ${className}`.trim()}>
      {parts.map((p, i) => (
        <React.Fragment key={i}>
          {i > 0 ? <span className="sales-line-meta__sep" aria-hidden> · </span> : null}
          {p}
        </React.Fragment>
      ))}
    </div>
  );
};
