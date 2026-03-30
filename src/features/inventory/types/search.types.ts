/**
 * Global Search Types - Frontend
 */

export type SearchEntityType = 'serial' | 'item' | 'movement' | 'location' | 'page';

export interface SearchFilters {
  types?: SearchEntityType[];
  locationId?: string;
  status?: string;
  dateFrom?: string;
  dateTo?: string;
}

export interface SearchResult {
  id: string;
  type: SearchEntityType;
  title: string;
  subtitle?: string;
  metadata?: Record<string, any>;
  route: string;
  rank: number;
}

export interface SerialSearchResult extends SearchResult {
  type: 'serial';
  serialNumber: string;
  item?: {
    id: string;
    sku: string;
    name: string;
  };
  variant?: {
    id: string;
    code: string;
    name: string;
  };
  location?: {
    id: string;
    code: string;
    name: string;
  };
  status: string;
}

export interface ItemSearchResult extends SearchResult {
  type: 'item';
  sku: string;
  name: string;
  hasVariants: boolean;
  category?: string;
}

export interface MovementSearchResult extends SearchResult {
  type: 'movement';
  movementNumber: string;
  movementType: string;
  status: string;
  date: string;
  itemCount?: number;
}

export interface LocationSearchResult extends SearchResult {
  type: 'location';
  code: string;
  name: string;
  locationType: string; // Location type (WAREHOUSE, ZONE, etc.)
  path?: string;
}

export interface PageSearchResult {
  type: 'page';
  id: string;
  title: string;
  subtitle?: string;
  route: string;
  rank: number;
}

export interface SearchResponse {
  serials: SerialSearchResult[];
  items: ItemSearchResult[];
  movements: MovementSearchResult[];
  locations: LocationSearchResult[];
  total: number;
}
