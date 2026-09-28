// =============================================================================
// useScreenCodes — whether the small screen codes (P4, M5, D6…) are shown
// =============================================================================
// A user preference (`showScreenCodes`, Settings → Preferences), but read by
// dozens of labels at once. usePreferences keeps its state per call site, so a
// toggle in Settings would not reach the labels already on screen; this module
// is the one shared value they all subscribe to. usePreferences writes it
// whenever the preference loads or changes.
// =============================================================================

import { useSyncExternalStore } from "react";

function initial(): boolean {
  try {
    const raw = localStorage.getItem("user-preferences");
    const cached = raw ? (JSON.parse(raw) as { showScreenCodes?: unknown }) : null;
    return typeof cached?.showScreenCodes === "boolean" ? cached.showScreenCodes : true;
  } catch {
    return true;
  }
}

let visible = initial();
const listeners = new Set<() => void>();

export function setScreenCodesVisible(next: boolean) {
  if (next === visible) return;
  visible = next;
  listeners.forEach((l) => l());
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useScreenCodesVisible(): boolean {
  return useSyncExternalStore(subscribe, () => visible);
}
