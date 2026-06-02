# JSON Tree Viewer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the `<pre>` display in the pretty tab with an interactive JSON tree — collapsible nodes (VS Code style) and always-visible inline search with match highlighting and auto-expand (Firefox JSON viewer style).

**Architecture:** A new `JsonTree.jsx` component owns all state via a `TreeContext` that every sub-component reads from, eliminating prop drilling. The parent ObjectNode/ArrayNode renders the toggle arrow for each child before the key, controlling collapse. Search walks the parsed tree to build a match list; auto-expand removes ancestor paths from `collapsedPaths`. ResponsePanel uses `JSON.parse` to decide whether to render `JsonTree` or fall back to `<pre>`.

**Tech Stack:** React 18, Tailwind CSS, no new dependencies. No test infrastructure — verification is manual (browser).

---

## File Map

| File | Action | Purpose |
|---|---|---|
| `client/src/components/ResponsePanel/JsonTree.jsx` | Create | Entire JSON tree component — helpers, context, all sub-components, SearchBar, main export |
| `client/src/components/ResponsePanel/ResponsePanel.jsx` | Modify | Swap `<pre>` for `<JsonTree>` in pretty tab when body is valid JSON |

---

## Task 1: Pure helpers

Create `JsonTree.jsx` with the pure (non-React) helpers only. No components yet.

**Files:**
- Create: `client/src/components/ResponsePanel/JsonTree.jsx`

- [ ] **Step 1: Create the file with all helpers**

```javascript
// client/src/components/ResponsePanel/JsonTree.jsx
import { useState, useRef, useEffect, useMemo, createContext, useContext } from 'react';

// ─── pure helpers ─────────────────────────────────────────────────────────────

export function countNodes(val) {
  if (val === null || typeof val !== 'object') return 1;
  if (Array.isArray(val)) return 1 + val.reduce((s, v) => s + countNodes(v), 0);
  return 1 + Object.values(val).reduce((s, v) => s + countNodes(v), 0);
}

// Populates `result` Set with paths that should start collapsed (depth > 2 for large trees)
function collectDefaultCollapsed(val, path, depth, result) {
  if (val === null || typeof val !== 'object') return;
  if (depth > 2) { result.add(path); return; }
  if (Array.isArray(val)) {
    val.forEach((item, i) =>
      collectDefaultCollapsed(item, path ? `${path}.${i}` : String(i), depth + 1, result));
  } else {
    Object.entries(val).forEach(([k, v]) =>
      collectDefaultCollapsed(v, path ? `${path}.${k}` : k, depth + 1, result));
  }
}

// Returns [{ path, type: 'key'|'value' }] for all nodes matching query
export function buildMatches(val, query) {
  if (!query) return [];
  const q = query.toLowerCase();
  const results = [];

  function walk(v, path, key) {
    // Only string object keys are searchable (not array indices)
    if (typeof key === 'string' && key.toLowerCase().includes(q)) {
      results.push({ path, type: 'key' });
    }
    if (v === null) {
      if ('null'.includes(q)) results.push({ path, type: 'value' });
    } else if (typeof v !== 'object') {
      const s = typeof v === 'string' ? `"${v}"` : String(v);
      if (s.toLowerCase().includes(q)) results.push({ path, type: 'value' });
    } else if (Array.isArray(v)) {
      v.forEach((item, i) => walk(item, path ? `${path}.${i}` : String(i), i));
    } else {
      Object.entries(v).forEach(([k, child]) => walk(child, path ? `${path}.${k}` : k, k));
    }
  }

  if (val === null) {
    if ('null'.includes(q)) results.push({ path: '', type: 'value' });
  } else if (typeof val !== 'object') {
    const s = typeof val === 'string' ? `"${val}"` : String(val);
    if (s.toLowerCase().includes(q)) results.push({ path: '', type: 'value' });
  } else if (Array.isArray(val)) {
    val.forEach((item, i) => walk(item, String(i), i));
  } else {
    Object.entries(val).forEach(([k, v]) => walk(v, k, k));
  }

  return results;
}

// Returns all ancestor paths for a dot-notation path
// e.g. "a.b.c" -> ["a", "a.b"]
export function getAncestorPaths(path) {
  if (!path) return [];
  const parts = path.split('.');
  return parts.slice(0, -1).map((_, i) => parts.slice(0, i + 1).join('.'));
}

// Splits `text` around all case-insensitive occurrences of `query`,
// wrapping each in a highlighted <mark>. The first occurrence gets `activeRef` if isActive.
function highlightText(text, query, isActive, activeRef) {
  const lower = text.toLowerCase();
  const q = query.toLowerCase();
  const parts = [];
  let start = 0;
  let isFirst = true;
  let idx = lower.indexOf(q, start);
  while (idx !== -1) {
    if (idx > start) parts.push(text.slice(start, idx));
    parts.push(
      <mark
        key={idx}
        ref={isActive && isFirst ? activeRef : null}
        className={isActive ? 'bg-orange-400 text-gray-900 rounded-sm' : 'bg-yellow-300 text-gray-900 rounded-sm'}
      >
        {text.slice(idx, idx + query.length)}
      </mark>
    );
    isFirst = false;
    start = idx + query.length;
    idx = lower.indexOf(q, start);
  }
  if (start < text.length) parts.push(text.slice(start));
  return parts;
}
```

- [ ] **Step 2: Verify the file is valid JS (no syntax errors)**

```bash
node --input-type=module < /Users/jadsonlucio/Documents/dev/side-projects/requestme/client/src/components/ResponsePanel/JsonTree.jsx 2>&1 | head -5
```

Expected: error about missing JSX transform (that's fine — it means the JS syntax is valid up to where JSX starts). If you see a plain `SyntaxError` with a line number pointing inside the helpers, fix that first.

- [ ] **Step 3: Commit**

```bash
git -C /Users/jadsonlucio/Documents/dev/side-projects/requestme add client/src/components/ResponsePanel/JsonTree.jsx
git -C /Users/jadsonlucio/Documents/dev/side-projects/requestme commit -m "feat: add JsonTree pure helpers"
```

---

## Task 2: Static tree rendering + ResponsePanel integration

Add `TreeContext`, all render components, and the `JsonTree` export. Collapse and search state are stubbed (empty Set / no-ops) so the tree renders immediately for visual verification. Then wire it into ResponsePanel.

**Files:**
- Modify: `client/src/components/ResponsePanel/JsonTree.jsx`
- Modify: `client/src/components/ResponsePanel/ResponsePanel.jsx`

- [ ] **Step 1: Add TreeContext and render components to JsonTree.jsx**

Append everything below to the end of `JsonTree.jsx` (after the helpers from Task 1):

```javascript
// ─── context ──────────────────────────────────────────────────────────────────

const TreeContext = createContext(null);

// ─── render helpers ───────────────────────────────────────────────────────────

// Renders a quoted object key with optional search highlight
function RenderKey({ name, path }) {
  const { searchQuery, matchSet, activeMatchKey, activeRef } = useContext(TreeContext);
  const text = `"${name}"`;
  const mKey = `${path}::key`;
  const isMatch = matchSet.has(mKey);
  const isActive = activeMatchKey === mKey;
  if (!isMatch || !searchQuery) return <span className="text-blue-300">{text}</span>;
  return (
    <span className="text-blue-300">
      {highlightText(text, searchQuery, isActive, isActive ? activeRef : null)}
    </span>
  );
}

// Renders a primitive value (string/number/boolean/null) with syntax color + highlight
function PrimitiveValue({ value, path }) {
  const { searchQuery, matchSet, activeMatchKey, activeRef } = useContext(TreeContext);
  const display = value === null ? 'null'
    : typeof value === 'string' ? `"${value}"`
    : String(value);
  const colorClass = value === null ? 'text-gray-500'
    : typeof value === 'boolean' ? 'text-purple-400'
    : typeof value === 'number' ? 'text-yellow-300'
    : 'text-green-400';
  const mKey = `${path}::value`;
  const isMatch = matchSet.has(mKey);
  const isActive = activeMatchKey === mKey;
  if (!isMatch || !searchQuery) return <span className={colorClass}>{display}</span>;
  return (
    <span className={colorClass}>
      {highlightText(display, searchQuery, isActive, isActive ? activeRef : null)}
    </span>
  );
}

// ─── tree nodes ───────────────────────────────────────────────────────────────

function JsonNode({ data, path, depth, isLast }) {
  if (data === null || typeof data !== 'object') {
    return (
      <>
        <PrimitiveValue value={data} path={path} />
        {!isLast && <span className="text-gray-500">,</span>}
      </>
    );
  }
  if (Array.isArray(data)) {
    return <ArrayNode data={data} path={path} depth={depth} isLast={isLast} />;
  }
  return <ObjectNode data={data} path={path} depth={depth} isLast={isLast} />;
}

function ObjectNode({ data, path, depth, isLast }) {
  const { collapsedPaths, togglePath } = useContext(TreeContext);
  const entries = Object.entries(data);

  return (
    <>
      <span className="text-gray-400">{'{'}</span>
      {entries.length === 0 ? (
        <>
          <span className="text-gray-400">{'}'}</span>
          {!isLast && <span className="text-gray-500">,</span>}
        </>
      ) : (
        <>
          {entries.map(([k, v], i) => {
            const childPath = path ? `${path}.${k}` : k;
            const isNested = v !== null && typeof v === 'object';
            const isChildCollapsed = isNested && collapsedPaths.has(childPath);
            const isLastEntry = i === entries.length - 1;
            return (
              <div key={k} style={{ paddingLeft: `${(depth + 1) * 16}px` }}>
                {/* Toggle arrow before key — only for objects/arrays */}
                <span
                  onClick={isNested ? () => togglePath(childPath) : undefined}
                  className={isNested
                    ? 'text-gray-500 hover:text-gray-300 cursor-pointer select-none mr-1'
                    : 'inline-block w-3 mr-1'}
                >
                  {isNested ? (isChildCollapsed ? '▶' : '▼') : ''}
                </span>
                <RenderKey name={k} path={childPath} />
                <span className="text-gray-500">: </span>
                {isChildCollapsed ? (
                  <>
                    <span className="text-gray-500 italic">
                      {Array.isArray(v) ? `[… ${v.length} items]` : '{…}'}
                    </span>
                    {!isLastEntry && <span className="text-gray-500">,</span>}
                  </>
                ) : (
                  <JsonNode data={v} path={childPath} depth={depth + 1} isLast={isLastEntry} />
                )}
              </div>
            );
          })}
          <div style={{ paddingLeft: `${depth * 16}px` }}>
            <span className="text-gray-400">{'}'}</span>
            {!isLast && <span className="text-gray-500">,</span>}
          </div>
        </>
      )}
    </>
  );
}

function ArrayNode({ data, path, depth, isLast }) {
  const { collapsedPaths, togglePath } = useContext(TreeContext);

  return (
    <>
      <span className="text-gray-400">{'['}</span>
      {data.length === 0 ? (
        <>
          <span className="text-gray-400">{']'}</span>
          {!isLast && <span className="text-gray-500">,</span>}
        </>
      ) : (
        <>
          {data.map((item, i) => {
            const childPath = path ? `${path}.${i}` : String(i);
            const isNested = item !== null && typeof item === 'object';
            const isChildCollapsed = isNested && collapsedPaths.has(childPath);
            const isLastItem = i === data.length - 1;
            return (
              <div key={i} style={{ paddingLeft: `${(depth + 1) * 16}px` }}>
                <span
                  onClick={isNested ? () => togglePath(childPath) : undefined}
                  className={isNested
                    ? 'text-gray-500 hover:text-gray-300 cursor-pointer select-none mr-1'
                    : 'inline-block w-3 mr-1'}
                >
                  {isNested ? (isChildCollapsed ? '▶' : '▼') : ''}
                </span>
                {isChildCollapsed ? (
                  <>
                    <span className="text-gray-500 italic">
                      {Array.isArray(item) ? `[… ${item.length} items]` : '{…}'}
                    </span>
                    {!isLastItem && <span className="text-gray-500">,</span>}
                  </>
                ) : (
                  <JsonNode data={item} path={childPath} depth={depth + 1} isLast={isLastItem} />
                )}
              </div>
            );
          })}
          <div style={{ paddingLeft: `${depth * 16}px` }}>
            <span className="text-gray-400">{']'}</span>
            {!isLast && <span className="text-gray-500">,</span>}
          </div>
        </>
      )}
    </>
  );
}

// ─── main export (stubbed state — collapse and search added in Tasks 3–5) ─────

export default function JsonTree({ data, prettyBody, onCopy, copied }) {
  const activeRef = useRef(null);

  const ctx = {
    collapsedPaths: new Set(),
    togglePath: () => {},
    searchQuery: '',
    matchSet: new Set(),
    activeMatchKey: null,
    activeRef,
  };

  return (
    <TreeContext.Provider value={ctx}>
      <div className="flex flex-col overflow-hidden h-full">
        {/* Search bar placeholder — added in Task 5 */}
        <div className="flex items-center gap-2 px-3 py-1.5 border-b border-gray-700 shrink-0">
          <input
            disabled
            placeholder="Search keys and values…"
            className="flex-1 bg-gray-800 text-gray-600 text-xs rounded px-2 py-0.5 outline-none placeholder-gray-600"
          />
          <button
            onClick={onCopy}
            className="text-xs text-gray-400 hover:text-gray-200 px-1.5 py-0.5 rounded border border-gray-600 hover:border-gray-400 transition-colors shrink-0"
          >
            {copied ? 'Copied!' : 'Copy'}
          </button>
        </div>
        <div className="flex-1 overflow-y-auto p-3 font-mono text-xs">
          <JsonNode data={data} path="" depth={0} isLast={true} />
        </div>
      </div>
    </TreeContext.Provider>
  );
}
```

- [ ] **Step 2: Update ResponsePanel.jsx to use JsonTree for valid JSON**

In `ResponsePanel.jsx`, add the import at the top:

```javascript
import JsonTree from './JsonTree';
```

Add this `useMemo` inside the `ResponsePanel` function body, immediately after the existing hook calls and before the early returns — keeping it before `if (isSending)`:

```javascript
  const parsedBody = useMemo(() => {
    if (!response?.body) return undefined;
    try { return JSON.parse(response.body); } catch { return undefined; }
  }, [response?.body]);
```

Replace the pretty tab content:

```javascript
        {activeTab === 'pretty' && (
          parsedBody !== undefined ? (
            <JsonTree
              data={parsedBody}
              prettyBody={prettyBody}
              onCopy={() => handleCopy(prettyBody)}
              copied={copied}
            />
          ) : (
            <div className="relative">
              {prettyBody && (
                <button
                  onClick={() => handleCopy(prettyBody)}
                  className="absolute top-2 right-2 text-xs text-gray-500 hover:text-gray-300 px-1.5 py-0.5 rounded border border-gray-700 hover:border-gray-500 bg-gray-900/80 transition-colors"
                >
                  {copied ? 'Copied!' : 'Copy'}
                </button>
              )}
              <pre className="p-3 text-xs text-gray-200 whitespace-pre-wrap break-all font-mono">
                {prettyBody || <span className="text-gray-600">Empty response</span>}
              </pre>
            </div>
          )
        )}
```

- [ ] **Step 3: Build and verify**

```bash
cd /Users/jadsonlucio/Documents/dev/side-projects/requestme/client && npx vite build 2>&1 | tail -5
```

Expected: `✓ built in Xms` with no errors.

Start the dev server (`npm run dev` from project root), send `GET https://httpbin.org/json`, and verify:
- Pretty tab shows a color-coded JSON tree (keys blue, strings green, numbers yellow)
- Copy button works in the search bar area
- No collapse toggles yet (arrows missing — that's Task 3)

- [ ] **Step 4: Commit**

```bash
git -C /Users/jadsonlucio/Documents/dev/side-projects/requestme add client/src/components/ResponsePanel/JsonTree.jsx client/src/components/ResponsePanel/ResponsePanel.jsx
git -C /Users/jadsonlucio/Documents/dev/side-projects/requestme commit -m "feat: add static JSON tree rendering and wire into ResponsePanel"
```

---

## Task 3: Collapse state

Replace the stubbed state in `JsonTree` with real `collapsedPaths` state and default-collapse logic for large responses.

**Files:**
- Modify: `client/src/components/ResponsePanel/JsonTree.jsx`

- [ ] **Step 1: Replace the stubbed JsonTree export**

Replace the entire `export default function JsonTree` block (added in Task 2) with:

```javascript
export default function JsonTree({ data, prettyBody, onCopy, copied }) {
  const isLarge = useMemo(() => countNodes(data) > 500, [data]);

  const [collapsedPaths, setCollapsedPaths] = useState(() => {
    if (!isLarge) return new Set();
    const result = new Set();
    collectDefaultCollapsed(data, '', 0, result);
    return result;
  });

  const togglePath = (path) => {
    setCollapsedPaths(prev => {
      const next = new Set(prev);
      if (next.has(path)) { next.delete(path); } else { next.add(path); }
      return next;
    });
  };

  const activeRef = useRef(null);

  const ctx = {
    collapsedPaths,
    togglePath,
    searchQuery: '',
    matchSet: new Set(),
    activeMatchKey: null,
    activeRef,
  };

  return (
    <TreeContext.Provider value={ctx}>
      <div className="flex flex-col overflow-hidden h-full">
        <div className="flex items-center gap-2 px-3 py-1.5 border-b border-gray-700 shrink-0">
          <input
            disabled
            placeholder="Search keys and values…"
            className="flex-1 bg-gray-800 text-gray-600 text-xs rounded px-2 py-0.5 outline-none placeholder-gray-600"
          />
          <button
            onClick={onCopy}
            className="text-xs text-gray-400 hover:text-gray-200 px-1.5 py-0.5 rounded border border-gray-600 hover:border-gray-400 transition-colors shrink-0"
          >
            {copied ? 'Copied!' : 'Copy'}
          </button>
        </div>
        <div className="flex-1 overflow-y-auto p-3 font-mono text-xs">
          <JsonNode data={data} path="" depth={0} isLast={true} />
        </div>
      </div>
    </TreeContext.Provider>
  );
}
```

- [ ] **Step 2: Verify collapse works**

Rebuild (`npx vite build` in the client dir), start the dev server, and send `GET https://httpbin.org/json`. Verify:
- `▼` arrows appear before nested objects/arrays
- Clicking `▼` collapses the node and shows `{…}` or `[… N items]`
- Clicking `▶` expands it again
- Primitive values have no arrow (just the alignment spacer)

- [ ] **Step 3: Commit**

```bash
git -C /Users/jadsonlucio/Documents/dev/side-projects/requestme add client/src/components/ResponsePanel/JsonTree.jsx
git -C /Users/jadsonlucio/Documents/dev/side-projects/requestme commit -m "feat: add collapse state to JSON tree with large-response default"
```

---

## Task 4: Search state + matchSet + auto-expand

Add `searchQuery`, `matches`, `activeMatch` state. Wire `buildMatches`. Auto-expand ancestors of matching nodes when query changes.

**Files:**
- Modify: `client/src/components/ResponsePanel/JsonTree.jsx`

- [ ] **Step 1: Replace the JsonTree export again with search state added**

Replace the entire `export default function JsonTree` block with:

```javascript
export default function JsonTree({ data, prettyBody, onCopy, copied }) {
  const isLarge = useMemo(() => countNodes(data) > 500, [data]);

  const [collapsedPaths, setCollapsedPaths] = useState(() => {
    if (!isLarge) return new Set();
    const result = new Set();
    collectDefaultCollapsed(data, '', 0, result);
    return result;
  });

  const togglePath = (path) => {
    setCollapsedPaths(prev => {
      const next = new Set(prev);
      if (next.has(path)) { next.delete(path); } else { next.add(path); }
      return next;
    });
  };

  const [searchQuery, setSearchQuery] = useState('');
  const [activeMatch, setActiveMatch] = useState(0);

  const matches = useMemo(() => buildMatches(data, searchQuery), [data, searchQuery]);

  const matchSet = useMemo(
    () => new Set(matches.map(m => `${m.path}::${m.type}`)),
    [matches]
  );

  const activeMatchKey = matches[activeMatch]
    ? `${matches[activeMatch].path}::${matches[activeMatch].type}`
    : null;

  // When query changes: reset activeMatch and auto-expand ancestors of all matches
  useEffect(() => {
    setActiveMatch(0);
    if (!searchQuery) return;
    const toExpand = new Set();
    for (const m of matches) {
      for (const ancestor of getAncestorPaths(m.path)) {
        toExpand.add(ancestor);
      }
    }
    if (toExpand.size === 0) return;
    setCollapsedPaths(prev => {
      const next = new Set(prev);
      for (const p of toExpand) next.delete(p);
      return next;
    });
  }, [searchQuery, matches]);

  const activeRef = useRef(null);

  const ctx = {
    collapsedPaths,
    togglePath,
    searchQuery,
    matchSet,
    activeMatchKey,
    activeRef,
  };

  return (
    <TreeContext.Provider value={ctx}>
      <div className="flex flex-col overflow-hidden h-full">
        <div className="flex items-center gap-2 px-3 py-1.5 border-b border-gray-700 shrink-0">
          <input
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            placeholder="Search keys and values…"
            className="flex-1 bg-gray-800 text-gray-200 text-xs rounded px-2 py-0.5 outline-none placeholder-gray-600"
          />
          {searchQuery && (
            <span className="text-xs text-gray-500 shrink-0">
              {matches.length === 0 ? '0 / 0' : `${activeMatch + 1} / ${matches.length}`}
            </span>
          )}
          <button
            onClick={onCopy}
            className="text-xs text-gray-400 hover:text-gray-200 px-1.5 py-0.5 rounded border border-gray-600 hover:border-gray-400 transition-colors shrink-0"
          >
            {copied ? 'Copied!' : 'Copy'}
          </button>
        </div>
        <div className="flex-1 overflow-y-auto p-3 font-mono text-xs">
          <JsonNode data={data} path="" depth={0} isLast={true} />
        </div>
      </div>
    </TreeContext.Provider>
  );
}
```

- [ ] **Step 2: Verify search highlighting works**

Rebuild and start the dev server. Send `GET https://httpbin.org/json`. Type a search term (e.g. the word `"url"` or a value from the response):
- Matching keys and values should show yellow `<mark>` highlights
- The match counter should appear (e.g. `1 / 3`)
- Collapsed ancestors of matches should auto-expand

- [ ] **Step 3: Commit**

```bash
git -C /Users/jadsonlucio/Documents/dev/side-projects/requestme add client/src/components/ResponsePanel/JsonTree.jsx
git -C /Users/jadsonlucio/Documents/dev/side-projects/requestme commit -m "feat: add search state, match highlighting, and auto-expand to JSON tree"
```

---

## Task 5: Navigation buttons, keyboard shortcuts, and scroll to active match

Add prev/next buttons, Enter/Shift+Enter/Escape keyboard handling, and the `activeRef` scroll effect.

**Files:**
- Modify: `client/src/components/ResponsePanel/JsonTree.jsx`

- [ ] **Step 1: Replace the JsonTree export with navigation added**

Replace the entire `export default function JsonTree` block with the final version:

```javascript
export default function JsonTree({ data, prettyBody, onCopy, copied }) {
  const isLarge = useMemo(() => countNodes(data) > 500, [data]);

  const [collapsedPaths, setCollapsedPaths] = useState(() => {
    if (!isLarge) return new Set();
    const result = new Set();
    collectDefaultCollapsed(data, '', 0, result);
    return result;
  });

  const togglePath = (path) => {
    setCollapsedPaths(prev => {
      const next = new Set(prev);
      if (next.has(path)) { next.delete(path); } else { next.add(path); }
      return next;
    });
  };

  const [searchQuery, setSearchQuery] = useState('');
  const [activeMatch, setActiveMatch] = useState(0);

  const matches = useMemo(() => buildMatches(data, searchQuery), [data, searchQuery]);

  const matchSet = useMemo(
    () => new Set(matches.map(m => `${m.path}::${m.type}`)),
    [matches]
  );

  const activeMatchKey = matches[activeMatch]
    ? `${matches[activeMatch].path}::${matches[activeMatch].type}`
    : null;

  useEffect(() => {
    setActiveMatch(0);
    if (!searchQuery) return;
    const toExpand = new Set();
    for (const m of matches) {
      for (const ancestor of getAncestorPaths(m.path)) {
        toExpand.add(ancestor);
      }
    }
    if (toExpand.size === 0) return;
    setCollapsedPaths(prev => {
      const next = new Set(prev);
      for (const p of toExpand) next.delete(p);
      return next;
    });
  }, [searchQuery, matches]);

  const activeRef = useRef(null);

  // Scroll active match into view whenever it changes
  useEffect(() => {
    if (activeRef.current) {
      activeRef.current.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    }
  }, [activeMatch, activeMatchKey]);

  function goNext() {
    if (matches.length === 0) return;
    setActiveMatch(i => (i + 1) % matches.length);
  }

  function goPrev() {
    if (matches.length === 0) return;
    setActiveMatch(i => (i - 1 + matches.length) % matches.length);
  }

  function handleKeyDown(e) {
    if (e.key === 'Enter') {
      e.preventDefault();
      e.shiftKey ? goPrev() : goNext();
    } else if (e.key === 'Escape') {
      setSearchQuery('');
    }
  }

  const ctx = {
    collapsedPaths,
    togglePath,
    searchQuery,
    matchSet,
    activeMatchKey,
    activeRef,
  };

  return (
    <TreeContext.Provider value={ctx}>
      <div className="flex flex-col overflow-hidden h-full">
        {/* Search bar */}
        <div className="flex items-center gap-1.5 px-3 py-1.5 border-b border-gray-700 shrink-0">
          <input
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Search keys and values…"
            className="flex-1 bg-gray-800 text-gray-200 text-xs rounded px-2 py-0.5 outline-none placeholder-gray-600 min-w-0"
          />
          {searchQuery && (
            <>
              <span className="text-xs text-gray-500 shrink-0">
                {matches.length === 0 ? '0 / 0' : `${activeMatch + 1} / ${matches.length}`}
              </span>
              <button
                onClick={goPrev}
                title="Previous match (Shift+Enter)"
                className="text-gray-400 hover:text-gray-200 text-xs px-1 shrink-0"
              >
                ‹
              </button>
              <button
                onClick={goNext}
                title="Next match (Enter)"
                className="text-gray-400 hover:text-gray-200 text-xs px-1 shrink-0"
              >
                ›
              </button>
              <button
                onClick={() => setSearchQuery('')}
                title="Clear (Escape)"
                className="text-gray-400 hover:text-gray-200 text-xs px-1 shrink-0"
              >
                ×
              </button>
            </>
          )}
          <button
            onClick={onCopy}
            className="text-xs text-gray-400 hover:text-gray-200 px-1.5 py-0.5 rounded border border-gray-600 hover:border-gray-400 transition-colors shrink-0"
          >
            {copied ? 'Copied!' : 'Copy'}
          </button>
        </div>
        {/* Tree */}
        <div className="flex-1 overflow-y-auto p-3 font-mono text-xs">
          <JsonNode data={data} path="" depth={0} isLast={true} />
        </div>
      </div>
    </TreeContext.Provider>
  );
}
```

- [ ] **Step 2: Verify navigation and keyboard**

Rebuild and start the dev server. Send `GET https://httpbin.org/json` and search for a term that has multiple matches:
- `‹` and `›` buttons appear when there is a query
- Clicking `›` or pressing Enter advances to the next match (counter increments, active match turns orange, tree scrolls to it)
- Clicking `‹` or pressing Shift+Enter goes to the previous match
- Pressing Escape clears the search
- `×` button clears the search
- Searching a term inside a collapsed node: the node auto-expands and the match is visible

Also test edge cases:
- Empty body: shows `<pre>` fallback, no JsonTree
- JSON primitive root (e.g. `"hello"`): renders single green string, search finds it

- [ ] **Step 3: Commit**

```bash
git -C /Users/jadsonlucio/Documents/dev/side-projects/requestme add client/src/components/ResponsePanel/JsonTree.jsx
git -C /Users/jadsonlucio/Documents/dev/side-projects/requestme commit -m "feat: add search navigation, keyboard shortcuts, and scroll-to-active-match"
```

---

## Task 6: Push

- [ ] **Step 1: Push to origin**

```bash
git -C /Users/jadsonlucio/Documents/dev/side-projects/requestme push origin main
```
