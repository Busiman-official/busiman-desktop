/** Normalize Mongo/API documents that use `_id` or `id`. */

export function docId(doc: { _id?: string; id?: string } | null | undefined): string | undefined {
  if (!doc) return undefined;
  const v = doc._id ?? doc.id;
  return typeof v === 'string' ? v : String(v);
}

/** Same as docId but accepts plain API records and returns '' when missing. */
export function entityId(row: unknown): string {
  if (row == null || typeof row !== 'object') return '';
  const o = row as { _id?: unknown; id?: unknown };
  const v = o.id ?? o._id;
  if (v == null) return '';
  if (typeof v === 'string') return v;
  return String(v);
}

/** API fields that may be an id string or a populated `{ _id }` ref. */
export function idStr(v: unknown): string {
  if (!v) return '';
  if (typeof v === 'string') return v;
  if (typeof v === 'object' && v !== null && '_id' in (v as object)) return String((v as { _id?: unknown })._id);
  return String(v);
}
