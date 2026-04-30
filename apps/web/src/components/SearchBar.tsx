import { useState, useRef, useCallback } from "react";
import { searchClients, typedSearch } from "../api";
import type { SearchResult, TypedSearchResult, SearchType } from "../api";
import { BOARD_DISPLAY_NAMES } from "../../../../lib/query/types";

const SEARCH_TYPE_OPTIONS: { value: SearchType; label: string }[] = [
  { value: "profiles", label: "Clients" },
  { value: "contracts", label: "Contracts" },
  { value: "court_cases", label: BOARD_DISPLAY_NAMES.court_cases! },
  { value: "open_forms", label: BOARD_DISPLAY_NAMES._cd_open_forms! },
  { value: "motions", label: BOARD_DISPLAY_NAMES.motions! },
  { value: "appeals", label: BOARD_DISPLAY_NAMES.appeals! },
  { value: "foias", label: BOARD_DISPLAY_NAMES.foias! },
  { value: "rfes", label: BOARD_DISPLAY_NAMES.rfes_all! },
  { value: "litigation", label: BOARD_DISPLAY_NAMES.litigation! },
  { value: "i918bs", label: BOARD_DISPLAY_NAMES._lt_i918b_s! },
];

interface Props {
  onResults: (results: SearchResult[]) => void;
  onTypedResults?: (results: TypedSearchResult[], type: SearchType) => void;
}

export function SearchBar({ onResults, onTypedResults }: Props) {
  const [query, setQuery] = useState("");
  const [searchType, setSearchType] = useState<SearchType>("profiles");
  const [loading, setLoading] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const controllerRef = useRef<AbortController | null>(null);

  const doSearch = useCallback(
    (value: string, type: SearchType) => {
      if (timerRef.current) clearTimeout(timerRef.current);
      if (controllerRef.current) controllerRef.current.abort();

      if (value.trim().length < 2) {
        onResults([]);
        onTypedResults?.([], type);
        return;
      }

      timerRef.current = setTimeout(async () => {
        const controller = new AbortController();
        controllerRef.current = controller;
        setLoading(true);
        try {
          if (type === "profiles") {
            const results = await searchClients(value.trim(), controller.signal);
            onResults(results);
            onTypedResults?.([], type);
          } else {
            const results = await typedSearch(value.trim(), type, controller.signal);
            onResults([]);
            onTypedResults?.(results, type);
          }
        } catch (err) {
          if ((err as Error).name === "AbortError") return;
          onResults([]);
          onTypedResults?.([], type);
        } finally {
          setLoading(false);
        }
      }, 300);
    },
    [onResults, onTypedResults]
  );

  const handleChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const value = e.target.value;
      setQuery(value);
      doSearch(value, searchType);
    },
    [doSearch, searchType]
  );

  const handleTypeChange = useCallback(
    (e: React.ChangeEvent<HTMLSelectElement>) => {
      const type = e.target.value as SearchType;
      setSearchType(type);
      if (query.trim().length >= 2) {
        doSearch(query, type);
      } else {
        onResults([]);
        onTypedResults?.([], type);
      }
    },
    [query, doSearch, onResults, onTypedResults]
  );

  const placeholderText = searchType === "profiles"
    ? "Search by name, email, phone, or address..."
    : `Search ${SEARCH_TYPE_OPTIONS.find((o) => o.value === searchType)?.label ?? ""}...`;

  return (
    <div className="flex-1 flex gap-2 items-center">
      <select
        value={searchType}
        onChange={handleTypeChange}
        className="text-sm rounded-lg px-3 py-2"
        style={{
          backgroundColor: "rgba(255,255,255,0.08)",
          border: "1px solid rgba(255,255,255,0.1)",
          color: "rgba(255,255,255,0.8)",
          fontFamily: "var(--font-body)",
          fontWeight: 400,
          outline: "none",
          cursor: "pointer",
          minWidth: 110,
        }}
      >
        {SEARCH_TYPE_OPTIONS.map((opt) => (
          <option key={opt.value} value={opt.value} style={{ backgroundColor: "#1a1a2e", color: "#fff" }}>
            {opt.label}
          </option>
        ))}
      </select>

      <div className="flex-1 relative">
        <div className="absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none">
          <svg
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            stroke="rgba(255,255,255,0.35)"
            strokeWidth="2"
          >
            <circle cx="11" cy="11" r="8" />
            <path d="M21 21l-4.35-4.35" />
          </svg>
        </div>
        <input
          type="text"
          value={query}
          onChange={handleChange}
          placeholder={placeholderText}
          className="w-full pl-10 pr-4 py-2 text-sm rounded-lg"
          style={{
            backgroundColor: "rgba(255,255,255,0.08)",
            border: "1px solid rgba(255,255,255,0.1)",
            color: "#fff",
            fontFamily: "var(--font-body)",
            fontWeight: 300,
            outline: "none",
            transition: "all 0.2s ease",
          }}
          onFocus={(e) => {
            e.currentTarget.style.backgroundColor = "rgba(255,255,255,0.12)";
            e.currentTarget.style.borderColor = "rgba(180,83,9,0.5)";
            e.currentTarget.style.boxShadow = "0 0 0 3px rgba(180,83,9,0.1)";
          }}
          onBlur={(e) => {
            e.currentTarget.style.backgroundColor = "rgba(255,255,255,0.08)";
            e.currentTarget.style.borderColor = "rgba(255,255,255,0.1)";
            e.currentTarget.style.boxShadow = "none";
          }}
        />
        {loading && (
          <span
            className="absolute right-3 top-1/2 -translate-y-1/2 text-xs"
            style={{ color: "rgba(255,255,255,0.4)", fontFamily: "var(--font-body)" }}
          >
            Searching...
          </span>
        )}
      </div>
    </div>
  );
}
