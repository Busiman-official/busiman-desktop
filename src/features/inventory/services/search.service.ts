/**
 * Global Search Service - Frontend API client
 */

import { api } from '@/services/api';
import { extractApiData } from '@/utils/api';
import { SearchResponse, SearchFilters } from '../types/search.types';

class SearchService {
  private abortController: AbortController | null = null;

  /**
   * Search across all inventory entities
   * Automatically cancels previous requests on new search
   */
  async search(
    query: string,
    filters?: SearchFilters,
    limit: number = 15
  ): Promise<SearchResponse> {
    // Cancel previous request if exists
    if (this.abortController) {
      this.abortController.abort();
    }

    // Create new abort controller for this request
    this.abortController = new AbortController();

    if (!query || query.trim().length === 0) {
      return {
        serials: [],
        items: [],
        movements: [],
        locations: [],
        total: 0,
      };
    }

    const params = new URLSearchParams();
    params.append('q', query.trim());
    params.append('limit', limit.toString());

    if (filters?.types && filters.types.length > 0) {
      filters.types.forEach((type) => {
        params.append('types[]', type);
      });
    }

    if (filters?.locationId) {
      params.append('locationId', filters.locationId);
    }

    if (filters?.status) {
      params.append('status', filters.status);
    }

    if (filters?.dateFrom) {
      params.append('dateFrom', filters.dateFrom);
    }

    if (filters?.dateTo) {
      params.append('dateTo', filters.dateTo);
    }

    if (filters?.branchId) {
      params.append('branchId', filters.branchId);
    }
    if (filters?.excludeMisc) {
      params.append('excludeMisc', 'true');
    }

    try {
      const response = await api.get(`/inventory/search?${params.toString()}`, {
        signal: this.abortController.signal,
      });
      return extractApiData<SearchResponse>(response);
    } catch (error: any) {
      // Ignore abort errors
      if (error.name === 'AbortError' || error.name === 'CanceledError') {
        throw new Error('Search canceled');
      }
      throw error;
    }
  }

  /**
   * Cancel current search request
   */
  cancel(): void {
    if (this.abortController) {
      this.abortController.abort();
      this.abortController = null;
    }
  }
}

export const searchService = new SearchService();
