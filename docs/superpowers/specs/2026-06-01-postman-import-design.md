# Postman Collection Import — Design Spec
Date: 2026-06-01

## Overview

Add a "Import" button to the sidebar that lets the user select a Postman collection JSON file. The server parses the file and creates a project, all its requests, and (optionally) an environment in a single atomic SQLite transaction.

---

## Architecture

The feature follows the existing client/server split without adding new abstractions:

- **One new server route**: `POST /api/projects/import` — receives the file via `multipart/form-data`, parses and validates it, runs all inserts in a transaction, returns the created project.
- **One new client API function**: `importCollection(file)` in `client/src/api/projects.js` — builds a `FormData` and posts to the new endpoint.
- **Sidebar update**: adds an "Import" text button next to "+ New"; triggers a hidden file input on click.
- **`multer`** added to the server as middleware for the single import route (parses the uploaded file into memory; no disk writes).

---

## Data Flow

1. User clicks **Import** in the sidebar Projects header.
2. Browser opens a file picker (`accept=".json"`).
3. On file selection, `importCollection(file)` posts the file to `POST /api/projects/import`.
4. Server parses JSON → validates schema → inserts project + requests + environment in one transaction.
5. Server returns `{ project, requestCount, environmentCreated }`.
6. Client invalidates the `projects` query; new project appears in the sidebar and auto-expands.

---

## Server: `POST /api/projects/import`

**File:** `server/src/routes/projects.js` (new route added to existing router)

**Middleware:** `multer({ storage: multer.memoryStorage() })` — file available as `req.file.buffer`.

### Validation (400 on failure)
- Must be valid JSON.
- `info.schema` must contain `"collection/v2"` (covers v2.0 and v2.1).
- Must have at least one request (after recursive traversal of `item[]`).

### Parsing

**Project name:** `info.name`

**Request traversal:** Walk `item[]` recursively. When an item has a nested `item` array, it is a folder — recurse, prepending `"<folderName> / "` to each child's name. Leaf items (those with a `request` property) are requests.

**Field mapping per request:**

| Postman field | RequestMe field | Notes |
|---|---|---|
| `item.name` (+ folder prefix) | `name` | e.g. `"Auth / Login"` |
| `request.method` | `method` | Default `"GET"` |
| `request.url.raw` or `request.url` | `url` | Use `.raw` when `url` is an object |
| `request.header[]` | `headers` | `[{ key, value, enabled: !header.disabled }]`; skip items where `disabled === true` |
| `request.body` | `body_type` + `body` | See body mapping below |
| `request.auth` | `auth_type` + `auth_config` | See auth mapping below |

**Body mapping:**
- `mode: "raw"` → `body_type: "raw"`, `body: body.raw`
- `mode: "urlencoded"` → `body_type: "form"`, `body: JSON.stringify(body.urlencoded)`
- `mode: "formdata"` → `body_type: "form"`, `body: JSON.stringify(body.formdata)`
- anything else or missing → `body_type: "none"`, `body: ""`

**Auth mapping** (from `request.auth`):
- `type: "bearer"` → `auth_type: "bearer"`, `auth_config: { token: bearer[0].value }`
- `type: "basic"` → `auth_type: "basic"`, `auth_config: { username: basic.find(p => p.key==='username')?.value, password: basic.find(p => p.key==='password')?.value }`
- `type: "apikey"` → `auth_type: "apikey"`, `auth_config: { key: apikey.find(p => p.key==='key')?.value, value: apikey.find(p => p.key==='value')?.value, in: "header" }`
- missing or unsupported → `auth_type: "none"`, `auth_config: {}`

**Environment:** If the collection has a top-level `variable[]` array with at least one entry, create an environment named `"Imported"` with `variables: [{ key, value }]` for each variable.

### Transaction

All inserts (project, requests, environment) run inside a single `db.transaction(fn)()` call. On any failure the entire import rolls back and the endpoint returns 500.

### Response

```json
{
  "project": { "id": 1, "name": "OnSwitchJava", "created_at": "..." },
  "requestCount": 12,
  "environmentCreated": true
}
```

---

## Client

### `client/src/api/projects.js`

New export:
```js
export const importCollection = async (file) => {
  const form = new FormData();
  form.append('file', file);
  const res = await fetch('/api/projects/import', { method: 'POST', body: form });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || res.statusText);
  return data;
};
```

`apiFetch` always sets `Content-Type: application/json` and JSON-stringifies the body, so `importCollection` calls `fetch` directly. This lets the browser set the correct `multipart/form-data` content type with boundary automatically.

### `client/src/components/Sidebar/Sidebar.jsx`

- Add a hidden `<input type="file" accept=".json" ref={fileInputRef}>` outside the visible tree.
- Add an **Import** text button in the projects header, next to "+ New".
- On button click: `fileInputRef.current.click()`.
- On `onChange`: call `importCollection(e.target.files[0])` via a mutation.
  - While pending: button shows "Importing..." and is disabled.
  - On success: invalidate `['projects']` query; reset file input value so the same file can be re-imported.
  - On error: show an inline error message below the button (e.g. `"Import failed: Not a Postman collection"`).

---

## Error Handling

| Scenario | HTTP | Error message |
|---|---|---|
| Invalid JSON | 400 | `"Invalid JSON"` |
| Not a Postman collection | 400 | `"Not a Postman collection"` |
| No requests found | 400 | `"Collection has no requests"` |
| SQLite failure | 500 | `"Import failed"` |

Errors surface as an inline message under the Import button in the sidebar. No toast, no modal.

---

## Files Changed

| File | Change |
|---|---|
| `server/package.json` | Add `multer` dependency |
| `server/src/index.js` | No change needed — `multer` is applied per-route |
| `server/src/routes/projects.js` | Add `POST /api/projects/import` route |
| `client/src/api/projects.js` | Add `importCollection(file)` |
| `client/src/api/client.js` | No change — `importCollection` calls `fetch` directly |
| `client/src/components/Sidebar/Sidebar.jsx` | Add Import button + file input + mutation |

---

## Out of Scope

- Preview/confirmation modal before importing
- Duplicate detection (importing the same collection twice creates two projects)
- Postman environment files (`.postman_environment.json`) — only collection-level variables are imported
- GraphQL body mode
- WebSocket or gRPC items in the collection
