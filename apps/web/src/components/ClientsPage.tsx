// =============================================================================
// Clients Page — Search + Filtered Browse
// =============================================================================

import { useState, useEffect, useCallback } from "react";
import { listClientsFiltered } from "../api";
import type { SearchResult, TypedSearchResult, SearchType } from "../api";
import { SearchBar } from "./SearchBar";
import { SearchResults, TypedSearchResults } from "./SearchResults";
import { FilterBar } from "./FilterBar";
import { useUrlFilters } from "../hooks/useUrlFilters";
import { navigate } from "../router";

const FILTER_DEFAULTS = {
  status: "",
  priority: "",
  attorney: "",
  board_type: "",
  date_from: "",
  date_to: "",
};

type FilterKeys = keyof typeof FILTER_DEFAULTS;

export function ClientsPage() {
  const { filters, setFilter, resetFilters, hasActiveFilters } = useUrlFilters({
    defaults: FILTER_DEFAULTS,
    storagePrefix: "clients",
    persistKeys: ["priority", "attorney"],
    clearValues: FILTER_DEFAULTS,
  });

  const [searchResults, setSearchResults] = useState<SearchResult[]>([]);
  const [typedResults, setTypedResults] = useState<TypedSearchResult[]>([]);
  const [typedType, setTypedType] = useState<SearchType>("profiles");
  const [filteredProfiles, setFilteredProfiles] = useState<SearchResult[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [isSearching, setIsSearching] = useState(false);

  // Load filtered profiles
  const loadFiltered = useCallback(async () => {
    setLoading(true);
    try {
      const result = await listClientsFiltered({
        limit: 50,
        offset: 0,
        status: filters.status || undefined,
        priority: filters.priority || undefined,
        attorney: filters.attorney || undefined,
        boardType: filters.board_type || undefined,
        dateFrom: filters.date_from || undefined,
        dateTo: filters.date_to || undefined,
      });
      setFilteredProfiles(result?.profiles ?? []);
      setTotal(result?.total ?? 0);
    } catch {
      setFilteredProfiles([]);
      setTotal(0);
    } finally {
      setLoading(false);
    }
  }, [filters]);

  useEffect(() => {
    loadFiltered();
  }, [loadFiltered]);

  const handleSearchResults = useCallback((results: SearchResult[]) => {
    setSearchResults(results);
    setIsSearching(results.length > 0);
  }, []);

  const handleTypedResults = useCallback((results: TypedSearchResult[], type: SearchType) => {
    setTypedResults(results);
    setTypedType(type);
    setIsSearching(results.length > 0);
  }, []);

  const handleSelect = (localId: string) => {
    navigate(`/clients/${encodeURIComponent(localId)}`);
  };

  const showSearch = isSearching || searchResults.length > 0 || typedResults.length > 0;

  return (
    <div className="animate-in">
      {/* Search bar in page body (not header) */}
      <div className="mb-5">
        <SearchBar
          onResults={handleSearchResults}
          onTypedResults={handleTypedResults}
        />
      </div>

      {/* Search results take priority over browse */}
      {showSearch && typedType !== "profiles" && typedResults.length > 0 && (
        <TypedSearchResults results={typedResults} onSelect={handleSelect} />
      )}
      {showSearch && (typedType === "profiles" || searchResults.length > 0) && (
        <SearchResults results={searchResults} onSelect={handleSelect} />
      )}

      {/* Filter bar + browse when not searching */}
      {!showSearch && (
        <>
          <FilterBar
            filters={filters}
            onFilterChange={(key: FilterKeys, value: string) => setFilter(key, value)}
            onClear={resetFilters}
            hasActiveFilters={hasActiveFilters}
            total={total}
          />

          {loading && (
            <div className="py-12 flex flex-col items-center gap-3">
              <div className="flex gap-1">
                <div
                  className="w-2 h-2 rounded-full"
                  style={{ backgroundColor: "var(--color-amber)", animation: "pulse-subtle 1s ease-in-out infinite" }}
                />
                <div
                  className="w-2 h-2 rounded-full"
                  style={{ backgroundColor: "var(--color-amber)", animation: "pulse-subtle 1s ease-in-out 0.2s infinite" }}
                />
                <div
                  className="w-2 h-2 rounded-full"
                  style={{ backgroundColor: "var(--color-amber)", animation: "pulse-subtle 1s ease-in-out 0.4s infinite" }}
                />
              </div>
            </div>
          )}

          {!loading && filteredProfiles.length === 0 && (
            <div className="py-16 flex flex-col items-center gap-4 animate-in">
              <div
                className="w-14 h-14 rounded-2xl flex items-center justify-center"
                style={{ backgroundColor: "var(--color-surface-warm)" }}
              >
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="var(--color-ink-faint)" strokeWidth="1.5">
                  <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
                  <circle cx="9" cy="7" r="4" />
                  <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
                  <path d="M16 3.13a4 4 0 0 1 0 7.75" />
                </svg>
              </div>
              <p className="text-sm" style={{ color: "var(--color-ink-faint)", fontFamily: "var(--font-body)" }}>
                No clients match the current filters.
              </p>
            </div>
          )}

          {!loading && filteredProfiles.length > 0 && (
            <div className="animate-in">
              <SearchResults results={filteredProfiles} onSelect={handleSelect} />
            </div>
          )}
        </>
      )}
    </div>
  );
}
