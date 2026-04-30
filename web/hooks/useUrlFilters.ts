// =============================================================================
// Reusable URL ↔ localStorage Filter Sync Hook
// =============================================================================
//
// Priority: URL params → localStorage → defaults
// On change: replaceState + persist to localStorage

import { useState, useCallback, useRef } from "react";

interface UseUrlFiltersOptions<T extends Record<string, string>> {
  /** Default values for each filter key */
  defaults: T;
  /** localStorage key prefix (e.g., "clients" → "clients-status") */
  storagePrefix: string;
  /** Keys whose values should be persisted to localStorage */
  persistKeys?: (keyof T)[];
  /** Values that mean "clear from URL" (e.g., { status: "all" }) */
  clearValues?: Partial<T>;
}

function getUrlParams(): URLSearchParams {
  return new URL(window.location.href).searchParams;
}

function loadFromStorage(prefix: string, key: string, fallback: string): string {
  try {
    return localStorage.getItem(`${prefix}-${key}`) ?? fallback;
  } catch {
    return fallback;
  }
}

function saveToStorage(prefix: string, key: string, value: string) {
  try {
    localStorage.setItem(`${prefix}-${key}`, value);
  } catch {}
}

function initializeFilters<T extends Record<string, string>>(
  opts: UseUrlFiltersOptions<T>
): T {
  const urlParams = getUrlParams();
  const result = { ...opts.defaults };

  for (const key of Object.keys(opts.defaults) as (keyof T & string)[]) {
    const urlVal = urlParams.get(key);
    if (urlVal) {
      (result as Record<string, string>)[key] = urlVal;
    } else if (opts.persistKeys?.includes(key)) {
      (result as Record<string, string>)[key] = loadFromStorage(
        opts.storagePrefix,
        key,
        opts.defaults[key]!
      );
    }
  }

  return result;
}

function syncUrl<T extends Record<string, string>>(
  filters: T,
  clearValues: Partial<T>
) {
  const url = new URL(window.location.href);
  for (const [key, value] of Object.entries(filters)) {
    const clearVal = (clearValues as Record<string, string>)[key];
    if (value && value !== clearVal) {
      url.searchParams.set(key, value);
    } else {
      url.searchParams.delete(key);
    }
  }
  const newUrl = url.pathname + url.search;
  if (window.location.pathname + window.location.search !== newUrl) {
    window.history.replaceState(null, "", newUrl);
  }
}

export function useUrlFilters<T extends Record<string, string>>(
  opts: UseUrlFiltersOptions<T>
) {
  const optsRef = useRef(opts);
  optsRef.current = opts;

  const [filters, setFiltersState] = useState<T>(() =>
    initializeFilters(opts)
  );

  const setFilter = useCallback((key: keyof T & string, value: string) => {
    setFiltersState((prev) => {
      const next = { ...prev, [key]: value };
      const { persistKeys = [], clearValues = {}, storagePrefix } = optsRef.current;

      if (persistKeys.includes(key)) {
        saveToStorage(storagePrefix, key, value);
      }
      syncUrl(next, clearValues);
      return next;
    });
  }, []);

  const setFilters = useCallback((updates: Partial<T>) => {
    setFiltersState((prev) => {
      const next = { ...prev, ...updates };
      const { persistKeys = [], clearValues = {}, storagePrefix } = optsRef.current;

      for (const key of Object.keys(updates) as (keyof T & string)[]) {
        if (persistKeys.includes(key)) {
          saveToStorage(storagePrefix, key, next[key]);
        }
      }
      syncUrl(next, clearValues);
      return next;
    });
  }, []);

  const resetFilters = useCallback(() => {
    const defaults = optsRef.current.defaults;
    setFiltersState(defaults);
    syncUrl(defaults, optsRef.current.clearValues ?? {});
  }, []);

  /** Check if any filter differs from its default */
  const hasActiveFilters = Object.keys(opts.defaults).some(
    (key) => filters[key as keyof T] !== opts.defaults[key as keyof T]
  );

  return { filters, setFilter, setFilters, resetFilters, hasActiveFilters };
}
