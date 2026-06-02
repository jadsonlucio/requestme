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
