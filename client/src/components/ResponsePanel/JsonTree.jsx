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
    Object.entries(val).forEach(([k, v]) => {
      const ek = k.replace(/\./g, '\x1f');
      collectDefaultCollapsed(v, path ? `${path}.${ek}` : ek, depth + 1, result);
    });
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
      Object.entries(v).forEach(([k, child]) => {
        const ek = k.replace(/\./g, '\x1f');
        walk(child, path ? `${path}.${ek}` : ek, k);
      });
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
    Object.entries(val).forEach(([k, v]) => {
      const ek = k.replace(/\./g, '\x1f');
      walk(v, ek, k);
    });
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
        {text.slice(idx, idx + q.length)}
      </mark>
    );
    isFirst = false;
    start = idx + query.length;
    idx = lower.indexOf(q, start);
  }
  if (start < text.length) parts.push(text.slice(start));
  return parts;
}

// ─── context ──────────────────────────────────────────────────────────────────

const TreeContext = createContext(null);

// ─── render helpers ───────────────────────────────────────────────────────────

// Renders a quoted object key with optional search highlight
function RenderKey({ name, path }) {
  const { searchQuery, matchSet, activeMatchKey, activeRef } = useContext(TreeContext);
  const text = `"${name.replace(//g, '.')}"`;

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
  const { collapsedPaths, togglePath, recentlyCopied, copyNode } = useContext(TreeContext);
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
            const ek = k.replace(/\./g, ''); // escape dots with unit separator
            const childPath = path ? `${path}.${ek}` : ek;
            const isNested = v !== null && typeof v === 'object';
            const isChildCollapsed = isNested && collapsedPaths.has(childPath);
            const isLastEntry = i === entries.length - 1;
            return (
              <div key={k} style={{ paddingLeft: `${(depth + 1) * 16}px` }} className="group relative">
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
                {isNested && (
                  <button
                    onClick={e => { e.stopPropagation(); copyNode(childPath, v); }}
                    className="absolute right-2 top-0 opacity-0 group-hover:opacity-100 text-gray-600 hover:text-gray-300 text-xs select-none transition-opacity"
                    title="Copy value"
                  >
                    {recentlyCopied === childPath ? '✓' : '⎘'}
                  </button>
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
  const { collapsedPaths, togglePath, recentlyCopied, copyNode } = useContext(TreeContext);

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
              <div key={i} style={{ paddingLeft: `${(depth + 1) * 16}px` }} className="group relative">
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
                {isNested && (
                  <button
                    onClick={e => { e.stopPropagation(); copyNode(childPath, item); }}
                    className="absolute right-2 top-0 opacity-0 group-hover:opacity-100 text-gray-600 hover:text-gray-300 text-xs select-none transition-opacity"
                    title="Copy value"
                  >
                    {recentlyCopied === childPath ? '✓' : '⎘'}
                  </button>
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

export default function JsonTree({ data, onCopy, copied }) {
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

  // Reset collapse and search state when a new response loads
  useEffect(() => {
    setSearchQuery('');
    setActiveMatch(0);
    const result = new Set();
    if (countNodes(data) > 500) {
      collectDefaultCollapsed(data, '', 0, result);
    }
    setCollapsedPaths(result);
  }, [data]);

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

  const [recentlyCopied, setRecentlyCopied] = useState(null);

  function copyNode(path, value) {
    navigator.clipboard.writeText(JSON.stringify(value, null, 2));
    setRecentlyCopied(path);
    setTimeout(() => setRecentlyCopied(null), 1500);
  }

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
    recentlyCopied,
    copyNode,
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
