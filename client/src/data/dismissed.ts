// Client-side dismissal store (this device only — persisted in localStorage).
//
// Two scopes:
//   - 'day'  : dismissal lasts only for the calendar day it was made. Used for
//              "Needs Attention" items so an unresolved condition reappears the
//              next day.
//   - 'forever': permanent dismissal. Used for one-off Recent Cancellations.

const STORAGE_KEY = 'mrt:dismissed:v1';

type DismissScope = 'day' | 'forever';

interface DismissEntry {
  scope: DismissScope;
  date: string; // YYYY-MM-DD the dismissal was made
}

type DismissMap = Record<string, DismissEntry>;

function today(): string {
  return new Date().toISOString().split('T')[0];
}

function read(): DismissMap {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as DismissMap) : {};
  } catch {
    return {};
  }
}

function write(map: DismissMap): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(map));
  } catch {
    /* storage unavailable — dismissals just won't persist */
  }
}

// Prune expired 'day' dismissals (from a previous day) so the store stays small
// and date-scoped items reappear. Returns the cleaned map.
function prune(map: DismissMap): DismissMap {
  const t = today();
  let changed = false;
  for (const [key, entry] of Object.entries(map)) {
    if (entry.scope === 'day' && entry.date !== t) {
      delete map[key];
      changed = true;
    }
  }
  if (changed) write(map);
  return map;
}

// Returns the set of keys currently considered dismissed (after pruning).
export function getDismissed(): Set<string> {
  return new Set(Object.keys(prune(read())));
}

// Dismiss an item by key. Scope controls how long it stays hidden.
export function dismiss(key: string, scope: DismissScope): void {
  const map = prune(read());
  map[key] = { scope, date: today() };
  write(map);
}

// Filter helper: keep only items whose key is not dismissed.
export function filterDismissed<T>(items: T[], keyOf: (item: T) => string): T[] {
  const dismissed = getDismissed();
  return items.filter((item) => !dismissed.has(keyOf(item)));
}
