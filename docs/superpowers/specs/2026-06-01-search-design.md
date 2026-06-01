# Sidebar Search — Design Spec
Date: 2026-06-01

## Overview

Add a search box to the sidebar that filters requests across all projects. Typing a query sends it to a new server-side search endpoint; results are mapped back to the project tree for filter-in-place rendering — matching projects expand and show only matching requests, non-matching projects are hidden.

---

## Architecture

One new server route + one new client API function. No new files.

```
User types → searchQuery state (Sidebar)
           → 200ms debounce
           → GET /api/requests/search?q=term
           → flat array of matching requests (with project_id)
           → grouped by project_id into a Map
           → each ProjectItem receives filteredRequests prop
           → filter-in-place rendering
```

---

## Server: `GET /api/requests/search`

**File:** `server/src/routes/requests.js`

**Query parameter:** `q` (string, required, minimum 1 character)

**SQL:**
```sql
SELECT * FROM requests
WHERE (name LIKE ? OR url LIKE ?)
ORDER BY project_id, created_at ASC
LIMIT 200
```

Parameter value: `%q%` (both placeholders). SQLite `LIKE` is case-insensitive for ASCII by default, which is sufficient.

**Response:** JSON array of request rows (same shape as the existing `GET /api/projects/:id/requests` response — all columns including `project_id`).

**Validation:**
- Missing or empty `q` → 400 `{ error: "q is required" }`
- Valid query → 200 with array (may be empty)

**Hard cap:** 200 results maximum. Prevents accidental large responses on short queries (e.g. typing a single letter in a large collection).

---

## Client

### `client/src/api/requests.js`

New export:
```js
export const searchRequests = (q) => apiFetch(`/requests/search?q=${encodeURIComponent(q)}`);
```

### `client/src/components/Sidebar/Sidebar.jsx`

**New state:** `searchQuery` (string, default `''`)

**New search input:** Rendered below the Projects header, always visible:
```jsx
<div className="px-3 py-2 border-b border-gray-700">
  <input
    value={searchQuery}
    onChange={(e) => setSearchQuery(e.target.value)}
    placeholder="Search requests..."
    className="w-full bg-gray-700 text-gray-300 rounded px-2 py-1 text-xs outline-none placeholder-gray-500"
  />
</div>
```

**Search query (TanStack Query):**
```js
const { data: searchResults = [] } = useQuery({
  queryKey: ['search', debouncedQuery],
  queryFn: () => searchRequests(debouncedQuery),
  enabled: debouncedQuery.length > 0,
});
```

**Debounce:** 200ms, implemented with `useState` + `useEffect`:
```js
const [debouncedQuery, setDebouncedQuery] = useState('');
useEffect(() => {
  const t = setTimeout(() => setDebouncedQuery(searchQuery), 200);
  return () => clearTimeout(t);
}, [searchQuery]);
```

**Grouping results by project:** When `debouncedQuery` is non-empty, build a `Map<projectId, request[]>` from `searchResults`:
```js
const searchMap = debouncedQuery.length > 0
  ? searchResults.reduce((m, r) => {
      if (!m.has(r.project_id)) m.set(r.project_id, []);
      m.get(r.project_id).push(r);
      return m;
    }, new Map())
  : null;
```

**Rendering:** Each `ProjectItem` receives a `filteredRequests` prop derived from `searchMap`:
- `searchMap === null` → `filteredRequests={null}` (search inactive, normal behavior)
- `searchMap.has(project.id)` → `filteredRequests={searchMap.get(project.id)}` (matching requests)
- `!searchMap.has(project.id)` → project is not rendered at all (hidden, no matches)

### `client/src/components/Sidebar/ProjectItem.jsx`

New prop: `filteredRequests` (array | null, default null)

**Behavior changes when `filteredRequests !== null`:**
- Skip the existing `useQuery` fetch — use `filteredRequests` directly as the requests to display
- Force `expanded = true` — ignore the local toggle state
- The `+` (add request) button and `isAddingRequest` form are hidden (search mode is read-only)

**Behavior when `filteredRequests === null`:** unchanged — component fetches and renders exactly as before.

The `enabled` prop on the existing `useQuery` becomes:
```js
enabled: filteredRequests === null && expanded,
```

---

## UI Layout

```
┌─────────────────────────────┐
│ Projects        Import  +New │
├─────────────────────────────┤
│ 🔍 Search requests...        │
├─────────────────────────────┤
│ ▾ Project A                  │
│   GET  /users                │
│   POST /login                │
│ ▾ Project B                  │
│   GET  /v1/schedule/nfl      │
└─────────────────────────────┘
```

- Search box always visible, below the header
- During active search: only projects with matches are shown, force-expanded, displaying only matching requests
- Clearing the input instantly restores each project to its prior expanded/collapsed state (no loading state needed — `searchMap` becomes `null` synchronously)
- No loading spinner — local SQLite queries return fast enough that debounce + network latency is imperceptible

---

## Error Handling

| Scenario | Behavior |
|---|---|
| Empty query | `enabled: false` — no fetch, `searchMap` is `null`, sidebar renders normally |
| Server error on search | TanStack Query retries; `searchResults` stays as previous value — sidebar doesn't flash |
| No results for query | `searchMap` is an empty `Map` — all projects are hidden, sidebar shows empty list |

---

## Files Changed

| File | Change |
|---|---|
| `server/src/routes/requests.js` | Add `GET /api/requests/search` route |
| `client/src/api/requests.js` | Add `searchRequests(q)` export |
| `client/src/components/Sidebar/Sidebar.jsx` | Add search input, searchQuery state, debounce, useQuery, searchMap, pass filteredRequests to ProjectItem |
| `client/src/components/Sidebar/ProjectItem.jsx` | Accept filteredRequests prop; use it instead of own fetch when non-null; force-expand; hide add-request form |

---

## Out of Scope

- Highlighting matched text within request names/URLs
- Searching project names
- Searching headers, body, or auth fields
- Pagination beyond the 200-result hard cap
- Search history or saved searches
