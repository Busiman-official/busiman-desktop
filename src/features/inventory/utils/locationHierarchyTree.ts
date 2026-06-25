import type { Location, LocationHierarchyResponse } from '@/services/inventory.service';

export function locationMatchesQuery(loc: Pick<Location, 'code' | 'name'>, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  return loc.code.toLowerCase().includes(q) || loc.name.toLowerCase().includes(q);
}

export function collectHierarchyIds(nodes: LocationHierarchyResponse[]): string[] {
  const ids: string[] = [];
  const walk = (list: LocationHierarchyResponse[]) => {
    for (const n of list) {
      ids.push(n.id);
      if (n.children?.length) walk(n.children);
    }
  };
  walk(nodes);
  return ids;
}

/** Keep nodes that match the query or contain a matching descendant. */
export function filterHierarchyByQuery(
  nodes: LocationHierarchyResponse[],
  query: string
): LocationHierarchyResponse[] {
  const q = query.trim().toLowerCase();
  if (!q) return nodes;

  const filterNode = (node: LocationHierarchyResponse): LocationHierarchyResponse | null => {
    const children = (node.children || [])
      .map(filterNode)
      .filter((n): n is LocationHierarchyResponse => n !== null);
    if (locationMatchesQuery(node, q) || children.length > 0) {
      return { ...node, children };
    }
    return null;
  };

  return nodes.map(filterNode).filter((n): n is LocationHierarchyResponse => n !== null);
}

export function flattenHierarchy(nodes: LocationHierarchyResponse[]): Location[] {
  const out: Location[] = [];
  const walk = (list: LocationHierarchyResponse[]) => {
    for (const n of list) {
      const { children, ...loc } = n;
      out.push(loc as Location);
      if (children?.length) walk(children);
    }
  };
  walk(nodes);
  return out;
}

export function countHierarchyNodes(nodes: LocationHierarchyResponse[]): number {
  let count = 0;
  const walk = (list: LocationHierarchyResponse[]) => {
    for (const n of list) {
      count += 1;
      if (n.children?.length) walk(n.children);
    }
  };
  walk(nodes);
  return count;
}

/** Ancestor ids from root to parent of target (empty if target is root). */
export function findAncestorIdsInHierarchy(
  nodes: LocationHierarchyResponse[],
  targetId: string
): string[] {
  const walk = (list: LocationHierarchyResponse[], path: string[]): string[] | null => {
    for (const n of list) {
      if (n.id === targetId) return path;
      if (n.children?.length) {
        const found = walk(n.children, [...path, n.id]);
        if (found) return found;
      }
    }
    return null;
  };
  return walk(nodes, []) ?? [];
}

export function getAdjacentLocationId(
  ids: readonly string[],
  currentId: string | null | undefined,
  direction: 'up' | 'down'
): string | null {
  if (!ids.length) return null;
  const idx = currentId ? ids.indexOf(currentId) : -1;
  if (direction === 'down') {
    if (idx < 0) return ids[0];
    return idx < ids.length - 1 ? ids[idx + 1] : null;
  }
  if (idx <= 0) return null;
  return ids[idx - 1];
}

export function resolveTreeFocusAnchor(
  ids: readonly string[],
  focusedId: string | null | undefined
): string | null {
  if (focusedId && ids.includes(focusedId)) return focusedId;
  return null;
}
