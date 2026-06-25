import { LocationType, type Location } from '@/services/inventory.service';

export type LocationTreeNode = {
  location: Location;
  pathLabel: string;
  searchText: string;
  children: LocationTreeNode[];
};

export function filterReceivingLocations(locations: Location[]): Location[] {
  return locations.filter((l) => l.isActive !== false && l.allowReceiving !== false);
}

export function locationTypeBadge(type: LocationType): string {
  switch (type) {
    case LocationType.WAREHOUSE:
      return 'WH';
    case LocationType.ZONE:
      return 'ZONE';
    case LocationType.RACK:
      return 'RACK';
    case LocationType.BIN:
      return 'BIN';
    default:
      return String(type).slice(0, 4);
  }
}

export function buildLocationPathMap(locations: Location[]): Map<string, Location> {
  return new Map(locations.map((l) => [l.id, l]));
}

export function resolveLocationPathLabel(locations: Location[], locationId: string): string {
  const byId = buildLocationPathMap(locations);
  const parts: string[] = [];
  let cur = byId.get(locationId);
  let guard = 0;
  while (cur && guard < 8) {
    parts.unshift(cur.name.trim() || cur.code);
    cur = cur.parentLocationId ? byId.get(cur.parentLocationId) : undefined;
    guard += 1;
  }
  return parts.join(' › ') || locationId;
}

export function buildLocationTree(locations: Location[]): LocationTreeNode[] {
  const recv = filterReceivingLocations(locations);
  const byId = buildLocationPathMap(recv);
  const childrenByParent = new Map<string | null, Location[]>();
  for (const loc of recv) {
    const parentKey = loc.parentLocationId && byId.has(loc.parentLocationId) ? loc.parentLocationId : null;
    const list = childrenByParent.get(parentKey) || [];
    list.push(loc);
    childrenByParent.set(parentKey, list);
  }
  for (const list of childrenByParent.values()) {
    list.sort((a, b) => {
      if (a.level !== b.level) return a.level - b.level;
      return a.name.localeCompare(b.name);
    });
  }

  const build = (loc: Location, ancestors: string[]): LocationTreeNode => {
    const pathParts = [...ancestors, loc.name.trim() || loc.code];
    const pathLabel = pathParts.join(' › ');
    const searchText = `${pathLabel} ${loc.code} ${loc.name}`.toLowerCase();
    const childLocs = childrenByParent.get(loc.id) || [];
    return {
      location: loc,
      pathLabel,
      searchText,
      children: childLocs.map((c) => build(c, pathParts)),
    };
  };

  const roots = childrenByParent.get(null) || [];
  return roots.map((r) => build(r, []));
}

export function flattenLocationTree(nodes: LocationTreeNode[]): LocationTreeNode[] {
  const out: LocationTreeNode[] = [];
  const walk = (list: LocationTreeNode[]) => {
    for (const n of list) {
      out.push(n);
      if (n.children.length) walk(n.children);
    }
  };
  walk(nodes);
  return out;
}

export function pickDefaultReceivingLocationId(locations: Location[]): string | null {
  const recv = filterReceivingLocations(locations);
  if (recv.length === 0) return null;
  const warehouses = recv.filter((l) => l.type === LocationType.WAREHOUSE);
  return (warehouses[0] || recv[0]).id;
}

export function filterTreeNodes(nodes: LocationTreeNode[], query: string): LocationTreeNode[] {
  const q = query.trim().toLowerCase();
  if (!q) return nodes;
  return flattenLocationTree(nodes).filter((n) => n.searchText.includes(q));
}
