const recentKey = (branchId: string, salesPointId: string) =>
  `pos-recent-variants-${branchId}-${salesPointId}`;

const legacySingleDraftKey = (branchId: string, salesPointId: string) =>
  `pos-draft-${branchId}-${salesPointId}`;
const heldDraftsKey = (branchId: string, salesPointId: string) =>
  `pos-held-drafts-${branchId}-${salesPointId}`;
const workingDraftKey = (branchId: string, salesPointId: string) =>
  `pos-working-draft-${branchId}-${salesPointId}`;

export interface PosRecentEntry {
  variantId: string;
  label: string;
}

export function pushRecentVariant(
  branchId: string,
  salesPointId: string,
  entry: PosRecentEntry
): void {
  try {
    const k = recentKey(branchId, salesPointId);
    const raw = localStorage.getItem(k);
    const list: PosRecentEntry[] = raw ? JSON.parse(raw) : [];
    const next = [entry, ...list.filter((e) => e.variantId !== entry.variantId)].slice(0, 15);
    localStorage.setItem(k, JSON.stringify(next));
  } catch {
    /* ignore quota / private mode */
  }
}

export function getRecentVariants(branchId: string, salesPointId: string): PosRecentEntry[] {
  try {
    const raw = localStorage.getItem(recentKey(branchId, salesPointId));
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed
      .map((e) =>
        typeof e === 'string'
          ? { variantId: e, label: e }
          : (e as PosRecentEntry)
      )
      .filter((e) => e.variantId);
  } catch {
    return [];
  }
}

export interface PosDraftPayload {
  lines: unknown[];
  savedAt: number;
}

export interface PosHeldDraft extends PosDraftPayload {
  id: string;
}

function safeParse<T>(raw: string | null): T | null {
  if (!raw) return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

function readHeldDrafts(branchId: string, salesPointId: string): PosHeldDraft[] {
  const parsed = safeParse<unknown>(localStorage.getItem(heldDraftsKey(branchId, salesPointId)));
  if (!Array.isArray(parsed)) return [];
  return parsed
    .map((d) => d as Partial<PosHeldDraft>)
    .filter((d) => typeof d.id === 'string' && Array.isArray(d.lines) && typeof d.savedAt === 'number')
    .map((d) => ({ id: d.id!, lines: d.lines!, savedAt: d.savedAt! }));
}

function writeHeldDrafts(branchId: string, salesPointId: string, drafts: PosHeldDraft[]): void {
  localStorage.setItem(heldDraftsKey(branchId, salesPointId), JSON.stringify(drafts));
}

function migrateLegacySingleDraft(branchId: string, salesPointId: string): void {
  const legacy = safeParse<PosDraftPayload>(localStorage.getItem(legacySingleDraftKey(branchId, salesPointId)));
  if (!legacy?.lines || !Array.isArray(legacy.lines) || legacy.lines.length === 0) return;
  const existing = readHeldDrafts(branchId, salesPointId);
  const id = `d_${legacy.savedAt}_${Math.random().toString(16).slice(2)}`;
  const next: PosHeldDraft[] = [{ id, lines: legacy.lines, savedAt: legacy.savedAt }, ...existing];
  writeHeldDrafts(branchId, salesPointId, next);
  try {
    localStorage.removeItem(legacySingleDraftKey(branchId, salesPointId));
  } catch {
    /* ignore */
  }
}

/** Save the in-progress cart (single working slot, not the held drafts list). */
export function savePosDraft(branchId: string, salesPointId: string, lines: unknown[]): void {
  try {
    localStorage.setItem(
      workingDraftKey(branchId, salesPointId),
      JSON.stringify({ lines, savedAt: Date.now() } satisfies PosDraftPayload)
    );
  } catch {
    /* ignore */
  }
}

/** Load the in-progress cart (single working slot). */
export function loadPosDraft(branchId: string, salesPointId: string): PosDraftPayload | null {
  try {
    const raw = localStorage.getItem(workingDraftKey(branchId, salesPointId));
    const parsed = safeParse<PosDraftPayload>(raw);
    if (!parsed?.lines || !Array.isArray(parsed.lines)) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function clearPosDraft(branchId: string, salesPointId: string): void {
  try {
    localStorage.removeItem(workingDraftKey(branchId, salesPointId));
  } catch {
    /* ignore */
  }
}

/** List all held drafts (multi-draft). */
export function listHeldPosDrafts(branchId: string, salesPointId: string): PosHeldDraft[] {
  try {
    migrateLegacySingleDraft(branchId, salesPointId);
    return readHeldDrafts(branchId, salesPointId).sort((a, b) => b.savedAt - a.savedAt);
  } catch {
    return [];
  }
}

/** Add a new held draft (creates Draft #n). */
export function holdPosDraft(branchId: string, salesPointId: string, lines: unknown[]): PosHeldDraft | null {
  try {
    migrateLegacySingleDraft(branchId, salesPointId);
    const existing = readHeldDrafts(branchId, salesPointId);
    const savedAt = Date.now();
    const id = `d_${savedAt}_${Math.random().toString(16).slice(2)}`;
    const draft: PosHeldDraft = { id, lines, savedAt };
    const next = [draft, ...existing];
    writeHeldDrafts(branchId, salesPointId, next);
    return draft;
  } catch {
    return null;
  }
}

export function discardHeldPosDraft(branchId: string, salesPointId: string, draftId: string): void {
  try {
    const existing = readHeldDrafts(branchId, salesPointId);
    writeHeldDrafts(
      branchId,
      salesPointId,
      existing.filter((d) => d.id !== draftId)
    );
  } catch {
    /* ignore */
  }
}
