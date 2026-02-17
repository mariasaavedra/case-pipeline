import type { ProfileSummary } from "../api";
import { getPriorityColor } from "../config";

const PRIORITY_CLASSES: Record<string, string> = {
  red:    "bg-red-100 text-red-800",
  yellow: "bg-yellow-100 text-yellow-800",
  green:  "bg-green-100 text-green-800",
  gray:   "bg-gray-100 text-gray-600",
};

export function ProfileCard({ profile }: { profile: ProfileSummary }) {
  const priorityColor = getPriorityColor(profile.priority);
  const priorityClasses = PRIORITY_CLASSES[priorityColor] ?? PRIORITY_CLASSES.gray;

  return (
    <div className="bg-white rounded-lg shadow p-5 mb-4">
      <div className="flex items-center gap-3 mb-3">
        <h2 className="text-2xl font-bold text-gray-900">{profile.name}</h2>
        {profile.priority && (
          <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${priorityClasses}`}>
            {profile.priority}
          </span>
        )}
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 text-sm text-gray-600">
        {profile.email && (
          <div>
            <span className="text-gray-400">Email: </span>
            <span>{profile.email}</span>
          </div>
        )}
        {profile.phone && (
          <div>
            <span className="text-gray-400">Phone: </span>
            <span>{profile.phone}</span>
          </div>
        )}
        {profile.address && (
          <div>
            <span className="text-gray-400">Address: </span>
            <span>{profile.address}</span>
          </div>
        )}
      </div>
    </div>
  );
}
