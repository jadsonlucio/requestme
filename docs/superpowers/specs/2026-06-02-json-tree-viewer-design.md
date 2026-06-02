# JSON Tree Viewer — Design Spec
Date: 2026-06-02

## Overview

Replace the `<pre>` display in the ResponsePanel pretty tab with an interactive JSON tree viewer. Supports collapsible nodes (VS Code style) and always-visible inline search with match highlighting and auto-expand (Firefox JSON viewer style). Falls back to `<pre>` for non-JSON text responses.

---

## Architecture

### File structure

| File | Action | Purpose |
|---|---|---|
| `client/src/components/ResponsePanel/JsonTree.jsx` | Create | Self-contained JSON tree component with all state |
| `client/src/components/ResponsePanel/ResponsePanel.jsx` | Modify | Swap `<pre>` for `<JsonTree>` in pretty tab when body is valid JSON |

### State ownership

All interactive state lives in `JsonTree` (top-level component):

| State | Type | Purpose |
|---|---|---|
| `collapsedPaths` | `Set<string>` | Dot-notation paths currently collapsed, e.g. `"users.0.address"` |
| `searchQuery` | `string` | Current search input value |
| `matches` | `Array<{ path: string, type: 'key'\|'value' }>` | All matching nodes for the current query |
| `activeMatch` | `number` | Index into `matches` for the focused (orange) match |

### Internal sub-components (not exported)

- **`JsonNode`** — dispatcher: inspects value type and routes to `ObjectNode`, `ArrayNode`, or `PrimitiveValue`
- **`ObjectNode`** — renders `▶/▼` toggle, key label, `{…}` collapsed preview or children
- **`ArrayNode`** — same as `ObjectNode` but for arrays; collapsed preview shows `[… N items]`
- **`PrimitiveValue`** — renders string/number/boolean/null with syntax color and highlight spans

### Path format

Dot-notation: `"users"`, `"users.0"`, `"users.0.address"`. Array indices are numeric segments. Root-level keys have no parent prefix.

---

## Collapse Behavior

- **Toggle:** `▶` (collapsed) / `▼` (expanded) character before every object and array node. Clicking it adds/removes the path from `collapsedPaths`.
- **Initial state:** all nodes expanded. Exception: for large responses (> 500 total nodes), nodes deeper than depth 2 start collapsed.
- **Collapsed preview:**
  - Objects: `{…}` shown inline after the key
  - Arrays: `[… N items]` shown inline after the key
- **Primitives** at any depth have no toggle.

---

## Search Behavior

### UI

A slim bar between the tab strip and the JSON tree (always visible when the pretty tab is active and the body is valid JSON):

```
[ search input                    ] [ 3 / 12 ] [ ‹ ] [ › ] [ × ]
```

- Input takes most of the bar width
- Match counter shows `activeMatch+1 / total` or `0 / 0` when no matches
- `‹` / `›` navigate prev/next; `×` clears the query
- Keyboard: Enter = next, Shift+Enter = prev, Escape = clear

### Matching rules

- Case-insensitive substring match
- Matches both **keys** (object property names) and **values** (string, number, boolean, null)
- `null` is matched as the string `"null"`, booleans as `"true"` / `"false"`, numbers as their string representation
- Empty query = no matches, no highlights

### Highlighting

- All matches: yellow background `bg-yellow-300 text-gray-900` inline span wrapping only the matching substring
- Active match: orange background `bg-orange-400 text-gray-900`
- Highlights rendered via splitting the key/value string around the match and wrapping the matching segment in a `<span>`

### Auto-expand on search

When `searchQuery` changes to a non-empty value:
1. Walk the entire JSON tree, collect all matching `{ path, type }` pairs
2. For each match, collect all ancestor paths (e.g. match at `"users.0.name"` → ancestors `"users"`, `"users.0"`)
3. Remove those ancestor paths from `collapsedPaths` so matches are visible
4. Nodes with no descendants matching are left in their current state (not re-collapsed)

### Navigation

`activeMatch` cycles through `matches`. Advancing past the last match wraps to 0. The active match node scrolls into view via `scrollIntoView({ block: 'nearest' })` using a ref attached to each match span.

---

## Visual Design

### Syntax colors (Tailwind, dark theme)

| Token | Class |
|---|---|
| Keys | `text-blue-300` |
| Strings | `text-green-400` |
| Numbers | `text-yellow-300` |
| Booleans | `text-purple-400` |
| Null | `text-gray-500` |
| Brackets `{}` `[]` | `text-gray-400` |
| Collapsed preview `{…}` / `[… N]` | `text-gray-500 italic` |
| Commas, colons | `text-gray-500` |

### Layout

- Font: `font-mono text-xs` (matches existing pretty tab)
- Indentation: 16px left padding per depth level (`pl-4` per level)
- Toggle arrow: `▶` / `▼`, `text-gray-500 hover:text-gray-300 cursor-pointer select-none`
- Search bar: `flex items-center gap-2 px-3 py-1.5 border-b border-gray-700 shrink-0`
- Input: `flex-1 bg-gray-800 text-gray-200 text-xs rounded px-2 py-0.5 outline-none placeholder-gray-600`
- Match counter: `text-xs text-gray-500 shrink-0`
- Nav buttons: `text-gray-400 hover:text-gray-200 text-xs px-1`

---

## ResponsePanel Integration

In the pretty tab:

```
if body is valid JSON:
  render <SearchBar> + <JsonTree>
else:
  render <pre> (existing fallback)
```

The copy button (existing) copies `prettyBody` (the formatted JSON string) regardless — it sits in the header bar, not inside the tree, so no change needed.

The `tryPrettyPrint` function already attempts `JSON.parse`. If it throws, body is not JSON — keep `<pre>`.

---

## Error Handling

| Scenario | Behavior |
|---|---|
| Body is not valid JSON | Fall back to `<pre>` display, no search bar |
| JSON is a primitive (e.g. `"hello"`, `42`) | Render as a single `PrimitiveValue` with no toggle, search still works |
| JSON is `null` | Render as `PrimitiveValue`, no toggle |
| Very large JSON (> 500 nodes) | Collapse nodes beyond depth 2 by default |
| Search query with regex special chars | Treat as literal string (no regex) |

---

## Out of Scope

- Editing JSON values in place
- Copy subtree (copy a single node's value)
- Expanding/collapsing all nodes at once
- JSON path display in status bar on hover
