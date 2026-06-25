import type { LocationHierarchyResponse } from '@/services/inventory.service';
import { getAdjacentLocationId, resolveTreeFocusAnchor } from './locationHierarchyTree';

export interface HierarchyIndex {
  parentById: Map<string, string | null>;
  childrenById: Map<string, string[]>;
}

export function buildHierarchyIndex(nodes: LocationHierarchyResponse[]): HierarchyIndex {
  const parentById = new Map<string, string | null>();
  const childrenById = new Map<string, string[]>();

  const walk = (list: LocationHierarchyResponse[], parentId: string | null) => {
    for (const n of list) {
      parentById.set(n.id, parentId);
      const childIds = (n.children ?? []).map((c) => c.id);
      childrenById.set(n.id, childIds);
      if (n.children?.length) walk(n.children, n.id);
    }
  };

  walk(nodes, null);
  return { parentById, childrenById };
}

/** Flat list of rows visible in the tree (respects collapsed branches). */
export function collectVisibleHierarchyIds(
  nodes: LocationHierarchyResponse[],
  expandedNodes: ReadonlySet<string>
): string[] {
  const ids: string[] = [];
  const walk = (list: LocationHierarchyResponse[]) => {
    for (const n of list) {
      ids.push(n.id);
      const children = n.children ?? [];
      if (children.length > 0 && expandedNodes.has(n.id)) {
        walk(children);
      }
    }
  };
  walk(nodes);
  return ids;
}

export type TreeKeyboardResult =
  | { type: 'focus'; id: string }
  | { type: 'expand'; id: string }
  | { type: 'collapse'; id: string };

/**
 * WAI-ARIA treeview keyboard navigation (focus-only; does not select/load detail).
 * https://www.w3.org/WAI/ARIA/apg/patterns/treeview/
 */
export function resolveTreeKeyboardAction(
  key: string,
  ctx: {
    focusedId: string | null;
    visibleIds: readonly string[];
    expandedNodes: ReadonlySet<string>;
    index: HierarchyIndex;
  }
): TreeKeyboardResult | null {
  const { focusedId, visibleIds, expandedNodes, index } = ctx;
  if (!visibleIds.length) return null;

  const anchor = resolveTreeFocusAnchor(visibleIds, focusedId);

  if (key === 'ArrowDown') {
    const nextId = getAdjacentLocationId(visibleIds, anchor, 'down');
    return nextId ? { type: 'focus', id: nextId } : null;
  }

  if (key === 'ArrowUp') {
    const nextId = getAdjacentLocationId(visibleIds, anchor, 'up');
    return nextId ? { type: 'focus', id: nextId } : null;
  }

  if (key === 'Home') {
    return { type: 'focus', id: visibleIds[0] };
  }

  if (key === 'End') {
    return { type: 'focus', id: visibleIds[visibleIds.length - 1] };
  }

  const activeId = anchor ?? visibleIds[0];
  if (!activeId) return null;

  const childIds = index.childrenById.get(activeId) ?? [];
  const hasChildren = childIds.length > 0;
  const isExpanded = expandedNodes.has(activeId);
  const parentId = index.parentById.get(activeId) ?? null;

  if (key === 'ArrowRight') {
    if (hasChildren && !isExpanded) return { type: 'expand', id: activeId };
    if (hasChildren && isExpanded) return { type: 'focus', id: childIds[0] };
    return null;
  }

  if (key === 'ArrowLeft') {
    if (hasChildren && isExpanded) return { type: 'collapse', id: activeId };
    if (parentId) return { type: 'focus', id: parentId };
    return null;
  }

  return null;
}

/** When a branch collapses, snap focus to the nearest still-visible ancestor. */
export function snapFocusToVisibleTree(
  focusedId: string | null,
  visibleIds: readonly string[],
  index: HierarchyIndex
): string | null {
  if (!focusedId) return visibleIds[0] ?? null;
  if (visibleIds.includes(focusedId)) return focusedId;

  let id: string | null = focusedId;
  while (id && !visibleIds.includes(id)) {
    id = index.parentById.get(id) ?? null;
  }
  return id ?? visibleIds[0] ?? null;
}
