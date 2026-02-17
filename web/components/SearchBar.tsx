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

  const handleChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const value = e.target.value;
      setQuery(value);

      if (timerRef.current) clearTimeout(timerRef.current);

      if (value.trim().length < 2) {
        onResults([]);
        return;
      }

      timerRef.current = setTimeout(async () => {
        setLoading(true);
        try {
          const results = await searchClients(value.trim());
          onResults(results);
        } catch {
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
      <input
        type="text"
        value={query}
        onChange={handleChange}
        placeholder="Search clients by name, email, or phone..."
        className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
      />
      {loading && (
        <span className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 text-sm">
          Searching...
        </span>
      )}
    </div>
  );
}
