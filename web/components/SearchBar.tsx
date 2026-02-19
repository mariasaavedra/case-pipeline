import { useState, useRef, useCallback } from "react";
import { searchClients } from "../api";
import type { SearchResult } from "../api";

interface Props {
  onResults: (results: SearchResult[]) => void;
}

export function SearchBar({ onResults }: Props) {
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const controllerRef = useRef<AbortController | null>(null);

  const handleChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const value = e.target.value;
      setQuery(value);

      if (timerRef.current) clearTimeout(timerRef.current);
      if (controllerRef.current) controllerRef.current.abort();

      if (value.trim().length < 2) {
        onResults([]);
        return;
      }

      timerRef.current = setTimeout(async () => {
        const controller = new AbortController();
        controllerRef.current = controller;
        setLoading(true);
        try {
          const results = await searchClients(value.trim(), controller.signal);
          onResults(results);
        } catch (err) {
          if ((err as Error).name === "AbortError") return;
          onResults([]);
        } finally {
          setLoading(false);
        }
      }, 300);
    },
    [onResults]
  );

  return (
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
        placeholder="Search by name, email, or phone..."
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
  );
}
