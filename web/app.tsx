import { useState, useEffect, useCallback } from "react";
import { createRoot } from "react-dom/client";
import { SearchBar } from "./components/SearchBar";
import { SearchResults } from "./components/SearchResults";
import { ClientView } from "./components/ClientView";
import { getClient } from "./api";
import type { ClientCaseSummary, SearchResult } from "./api";

function App() {
  const [results, setResults] = useState<SearchResult[]>([]);
  const [client, setClient] = useState<ClientCaseSummary | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadFromHash = useCallback(async () => {
    const hash = window.location.hash;
    const match = hash.match(/^#client\/(.+)$/);
    if (match) {
      setLoading(true);
      setError(null);
      try {
        const data = await getClient(decodeURIComponent(match[1]));
        setClient(data);
      } catch (e) {
        setError((e as Error).message);
      } finally {
        setLoading(false);
      }
    } else {
      setClient(null);
    }
  }, []);

  useEffect(() => {
    loadFromHash();
    window.addEventListener("hashchange", loadFromHash);
    return () => window.removeEventListener("hashchange", loadFromHash);
  }, [loadFromHash]);

  const handleSelect = (localId: string) => {
    window.location.hash = `#client/${localId}`;
  };

  const handleBack = () => {
    window.location.hash = "";
  };

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="bg-white border-b border-gray-200 px-6 py-4">
        <div className="max-w-5xl mx-auto flex items-center gap-4">
          {client && (
            <button
              onClick={handleBack}
              className="text-gray-500 hover:text-gray-700 text-sm"
            >
              &larr; Back
            </button>
          )}
          <h1 className="text-lg font-semibold text-gray-900 whitespace-nowrap">Case Pipeline</h1>
          {!client && <SearchBar onResults={setResults} />}
        </div>
      </header>

      <main className="max-w-5xl mx-auto px-6 py-6">
        {error && (
          <div className="bg-red-50 text-red-700 p-4 rounded-lg mb-4">{error}</div>
        )}

        {loading && (
          <div className="text-gray-500 text-center py-12">Loading...</div>
        )}

        {!client && !loading && results.length === 0 && (
          <div className="text-gray-400 text-center py-12">
            Search for a client to view their 360 case summary.
          </div>
        )}

        {!client && !loading && <SearchResults results={results} onSelect={handleSelect} />}

        {client && !loading && <ClientView data={client} />}
      </main>
    </div>
  );
}

const root = createRoot(document.getElementById("root")!);
root.render(<App />);
