import type { SearchResult } from "../api";

interface Props {
  results: SearchResult[];
  onSelect: (localId: string) => void;
}

export function SearchResults({ results, onSelect }: Props) {
  if (results.length === 0) return null;

  return (
    <div className="bg-white rounded-lg shadow overflow-hidden">
      <table className="w-full">
        <thead>
          <tr className="bg-gray-50 border-b border-gray-200">
            <th className="text-left px-4 py-3 text-xs font-medium text-gray-500 uppercase tracking-wider">Name</th>
            <th className="text-left px-4 py-3 text-xs font-medium text-gray-500 uppercase tracking-wider">Email</th>
            <th className="text-left px-4 py-3 text-xs font-medium text-gray-500 uppercase tracking-wider">Phone</th>
          </tr>
        </thead>
        <tbody>
          {results.map((r) => (
            <tr
              key={r.localId}
              onClick={() => onSelect(r.localId)}
              className="border-b border-gray-100 hover:bg-blue-50 cursor-pointer transition-colors"
            >
              <td className="px-4 py-3 font-medium text-gray-900">{r.name}</td>
              <td className="px-4 py-3 text-gray-600">{r.email ?? "—"}</td>
              <td className="px-4 py-3 text-gray-600">{r.phone ?? "—"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
