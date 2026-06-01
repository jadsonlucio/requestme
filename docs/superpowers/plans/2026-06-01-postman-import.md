# Postman Collection Import Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an Import button to the sidebar that accepts a Postman v2.x collection JSON file and creates a project with all its requests (and optionally an environment) in a single atomic transaction.

**Architecture:** A new `POST /api/projects/import` route on the Express server receives the file via `multipart/form-data` (using `multer`), parses it with a private helper function, and inserts the project + requests + environment inside a `db.transaction()` call. The client adds a single `importCollection(file)` function that calls `fetch` directly (bypassing the existing `apiFetch` wrapper which always sets `Content-Type: application/json`). The Sidebar gains an Import button that opens a hidden file input.

**Tech Stack:** Express, multer, better-sqlite3 (transactions), React, TanStack Query (useMutation), Tailwind CSS.

---

## File Map

| File | Change |
|---|---|
| `server/package.json` | Add `multer` dependency |
| `server/src/routes/projects.js` | Add `parsePostmanCollection` helper + `POST /api/projects/import` route |
| `client/src/api/projects.js` | Add `importCollection(file)` export |
| `client/src/components/Sidebar/Sidebar.jsx` | Add Import button, hidden file input, import mutation |

No new files. No changes to `server/src/index.js` (multer is applied per-route).

---

## Task 1: Install multer

**Files:**
- Modify: `server/package.json`

- [ ] **Step 1: Install multer in the server package**

```bash
cd /path/to/requestme && npm install multer --prefix server
```

Expected: `server/node_modules/multer` exists, `server/package.json` now has `"multer"` under `dependencies`.

- [ ] **Step 2: Verify**

```bash
cat server/package.json
```

Expected output includes:
```json
"dependencies": {
  "better-sqlite3": "^11.0.0",
  "cors": "^2.8.5",
  "express": "^4.18.2",
  "multer": "^1.x.x"
}
```

- [ ] **Step 3: Commit**

```bash
git add server/package.json server/package-lock.json
git commit -m "chore: add multer for multipart file uploads"
```

---

## Task 2: Add the import route to the server

**Files:**
- Modify: `server/src/routes/projects.js`

The complete updated file — replace the entire contents:

- [ ] **Step 1: Replace `server/src/routes/projects.js` with the following**

```js
const express = require('express');
const multer = require('multer');
const db = require('../db/database');

const router = express.Router();
const upload = multer({ storage: multer.memoryStorage() });

// ---------------------------------------------------------------------------
// Postman collection parser
// ---------------------------------------------------------------------------

function extractRequests(items, prefix) {
  const out = [];
  for (const item of items) {
    if (Array.isArray(item.item)) {
      const folderPrefix = prefix ? `${prefix} / ${item.name}` : item.name;
      out.push(...extractRequests(item.item, folderPrefix));
    } else if (item.request) {
      out.push({ item, prefix });
    }
  }
  return out;
}

function parsePostmanCollection(json) {
  if (!json.info || !json.info.schema || !json.info.schema.includes('collection/v2')) {
    const err = new Error('Not a Postman collection');
    err.status = 400;
    throw err;
  }

  const raw = extractRequests(json.item || [], '');

  if (raw.length === 0) {
    const err = new Error('Collection has no requests');
    err.status = 400;
    throw err;
  }

  const requests = raw.map(({ item, prefix }) => {
    const req = item.request;
    const name = prefix ? `${prefix} / ${item.name}` : item.name;
    const method = req.method || 'GET';
    const url = typeof req.url === 'string' ? req.url : (req.url && req.url.raw) || '';

    const headers = (req.header || [])
      .filter(h => !h.disabled)
      .map(h => ({ key: h.key, value: h.value, enabled: true }));

    let body_type = 'none';
    let body = '';
    if (req.body) {
      if (req.body.mode === 'raw') {
        body_type = 'raw';
        body = req.body.raw || '';
      } else if (req.body.mode === 'urlencoded') {
        body_type = 'form';
        body = JSON.stringify(req.body.urlencoded || []);
      } else if (req.body.mode === 'formdata') {
        body_type = 'form';
        body = JSON.stringify(req.body.formdata || []);
      }
    }

    let auth_type = 'none';
    let auth_config = {};
    if (req.auth) {
      const a = req.auth;
      if (a.type === 'bearer') {
        auth_type = 'bearer';
        auth_config = { token: (a.bearer || [])[0]?.value || '' };
      } else if (a.type === 'basic') {
        auth_type = 'basic';
        auth_config = {
          username: (a.basic || []).find(p => p.key === 'username')?.value || '',
          password: (a.basic || []).find(p => p.key === 'password')?.value || '',
        };
      } else if (a.type === 'apikey') {
        auth_type = 'apikey';
        auth_config = {
          key: (a.apikey || []).find(p => p.key === 'key')?.value || '',
          value: (a.apikey || []).find(p => p.key === 'value')?.value || '',
          in: 'header',
        };
      }
    }

    return { name, method, url, headers, body_type, body, auth_type, auth_config };
  });

  const variables = (json.variable || []).map(v => ({ key: v.key, value: v.value || '' }));

  return { projectName: json.info.name, requests, variables };
}

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------

router.get('/projects', (req, res) => {
  const projects = db.prepare('SELECT * FROM projects ORDER BY created_at DESC').all();
  res.json(projects);
});

router.post('/projects', (req, res) => {
  const { name } = req.body;
  if (!name || !name.trim()) {
    return res.status(400).json({ error: 'name is required' });
  }
  const result = db.prepare('INSERT INTO projects (name) VALUES (?)').run(name.trim());
  const project = db.prepare('SELECT * FROM projects WHERE id = ?').get(result.lastInsertRowid);
  res.status(201).json(project);
});

router.put('/projects/:id', (req, res) => {
  const { name } = req.body;
  if (!name || !name.trim()) {
    return res.status(400).json({ error: 'name is required' });
  }
  const result = db.prepare('UPDATE projects SET name = ? WHERE id = ?').run(name.trim(), req.params.id);
  if (result.changes === 0) return res.status(404).json({ error: 'project not found' });
  const project = db.prepare('SELECT * FROM projects WHERE id = ?').get(req.params.id);
  res.json(project);
});

router.delete('/projects/:id', (req, res) => {
  const result = db.prepare('DELETE FROM projects WHERE id = ?').run(req.params.id);
  if (result.changes === 0) return res.status(404).json({ error: 'project not found' });
  res.status(204).send();
});

router.post('/projects/import', upload.single('file'), (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: 'No file uploaded' });
  }

  let json;
  try {
    json = JSON.parse(req.file.buffer.toString('utf8'));
  } catch {
    return res.status(400).json({ error: 'Invalid JSON' });
  }

  let parsed;
  try {
    parsed = parsePostmanCollection(json);
  } catch (e) {
    return res.status(e.status || 400).json({ error: e.message });
  }

  const { projectName, requests, variables } = parsed;

  const doImport = db.transaction(() => {
    const projectResult = db.prepare('INSERT INTO projects (name) VALUES (?)').run(projectName);
    const projectId = projectResult.lastInsertRowid;

    const insertRequest = db.prepare(
      `INSERT INTO requests (project_id, name, method, url, headers, body_type, body, auth_type, auth_config)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    );
    for (const r of requests) {
      insertRequest.run(
        projectId, r.name, r.method, r.url,
        JSON.stringify(r.headers), r.body_type, r.body,
        r.auth_type, JSON.stringify(r.auth_config)
      );
    }

    let environmentCreated = false;
    if (variables.length > 0) {
      db.prepare('INSERT INTO environments (project_id, name, variables) VALUES (?, ?, ?)')
        .run(projectId, 'Imported', JSON.stringify(variables));
      environmentCreated = true;
    }

    const project = db.prepare('SELECT * FROM projects WHERE id = ?').get(projectId);
    return { project, requestCount: requests.length, environmentCreated };
  });

  try {
    const result = doImport();
    res.status(201).json(result);
  } catch {
    res.status(500).json({ error: 'Import failed' });
  }
});

module.exports = router;
```

- [ ] **Step 2: Verify the server starts without errors**

Start just the server:
```bash
npm run dev:server
```

Expected: `Server running on http://localhost:3001` with no crash.

- [ ] **Step 3: Test — happy path with the example collection**

In a second terminal, from the repo root:
```bash
curl -s -X POST http://localhost:3001/api/projects/import \
  -F "file=@OnSwitchJava.postman_collection.json" | jq '{project: .project.name, requestCount: .requestCount, environmentCreated: .environmentCreated}'
```

Expected output:
```json
{
  "project": "OnSwitchJava",
  "requestCount": 12,
  "environmentCreated": false
}
```

(The example collection has no top-level `variable[]` array, so `environmentCreated` is false. `requestCount` depends on the actual items in the file — adjust the expected value if it differs.)

- [ ] **Step 4: Test — invalid JSON**

```bash
curl -s -X POST http://localhost:3001/api/projects/import \
  -F "file=@package.json" | jq .
```

Expected:
```json
{ "error": "Not a Postman collection" }
```

- [ ] **Step 5: Test — no file**

```bash
curl -s -X POST http://localhost:3001/api/projects/import | jq .
```

Expected:
```json
{ "error": "No file uploaded" }
```

- [ ] **Step 6: Commit**

```bash
git add server/src/routes/projects.js
git commit -m "feat: add POST /api/projects/import with Postman v2 parser"
```

---

## Task 3: Add `importCollection` to the client API

**Files:**
- Modify: `client/src/api/projects.js`

- [ ] **Step 1: Replace `client/src/api/projects.js` with the following**

```js
import { apiFetch } from './client';

export const getProjects = () => apiFetch('/projects');
export const createProject = (name) => apiFetch('/projects', { method: 'POST', body: { name } });
export const updateProject = (id, name) => apiFetch(`/projects/${id}`, { method: 'PUT', body: { name } });
export const deleteProject = (id) => apiFetch(`/projects/${id}`, { method: 'DELETE' });

export const importCollection = async (file) => {
  const form = new FormData();
  form.append('file', file);
  const res = await fetch('/api/projects/import', { method: 'POST', body: form });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || res.statusText);
  return data;
};
```

Note: `importCollection` uses `fetch` directly (not `apiFetch`) because `apiFetch` always sets `Content-Type: application/json` and JSON-stringifies the body. Using `fetch` with `FormData` lets the browser set the correct `multipart/form-data` content type with boundary automatically.

- [ ] **Step 2: Commit**

```bash
git add client/src/api/projects.js
git commit -m "feat: add importCollection client API function"
```

---

## Task 4: Update the Sidebar UI

**Files:**
- Modify: `client/src/components/Sidebar/Sidebar.jsx`

- [ ] **Step 1: Replace `client/src/components/Sidebar/Sidebar.jsx` with the following**

```jsx
import { useRef, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { getProjects, createProject, deleteProject, importCollection } from '../../api/projects';
import ProjectItem from './ProjectItem';
import EnvironmentSelector from './EnvironmentSelector';

export default function Sidebar() {
  const queryClient = useQueryClient();
  const [newProjectName, setNewProjectName] = useState('');
  const [isAdding, setIsAdding] = useState(false);
  const [importError, setImportError] = useState('');
  const fileInputRef = useRef(null);

  const { data: projects = [] } = useQuery({
    queryKey: ['projects'],
    queryFn: getProjects,
  });

  const createMutation = useMutation({
    mutationFn: (name) => createProject(name),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['projects'] });
      setNewProjectName('');
      setIsAdding(false);
    },
  });

  const deleteMutation = useMutation({
    mutationFn: deleteProject,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['projects'] }),
  });

  const importMutation = useMutation({
    mutationFn: importCollection,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['projects'] });
      setImportError('');
      fileInputRef.current.value = '';
    },
    onError: (err) => {
      setImportError(err.message);
      fileInputRef.current.value = '';
    },
  });

  function handleAddProject(e) {
    e.preventDefault();
    if (!newProjectName.trim()) return;
    createMutation.mutate(newProjectName.trim());
  }

  function handleImportClick() {
    setImportError('');
    fileInputRef.current.click();
  }

  function handleFileChange(e) {
    const file = e.target.files[0];
    if (file) importMutation.mutate(file);
  }

  return (
    <div className="w-60 shrink-0 bg-gray-800 flex flex-col border-r border-gray-700">
      <div className="p-3 border-b border-gray-700 flex items-center justify-between">
        <span className="font-semibold text-gray-200">Projects</span>
        <div className="flex gap-2">
          <button
            onClick={handleImportClick}
            disabled={importMutation.isPending}
            className="text-xs text-gray-400 hover:text-gray-200 disabled:opacity-50"
          >
            {importMutation.isPending ? 'Importing...' : 'Import'}
          </button>
          <button
            onClick={() => setIsAdding(true)}
            className="text-xs text-blue-400 hover:text-blue-300"
          >
            + New
          </button>
        </div>
      </div>

      <input
        ref={fileInputRef}
        type="file"
        accept=".json"
        className="hidden"
        onChange={handleFileChange}
      />

      {importError && (
        <p className="px-3 py-1 text-xs text-red-400 border-b border-gray-700">{importError}</p>
      )}

      {isAdding && (
        <form onSubmit={handleAddProject} className="p-2 border-b border-gray-700">
          <input
            autoFocus
            value={newProjectName}
            onChange={(e) => setNewProjectName(e.target.value)}
            placeholder="Project name"
            className="w-full bg-gray-700 text-gray-100 rounded px-2 py-1 text-xs outline-none"
            onKeyDown={(e) => e.key === 'Escape' && setIsAdding(false)}
          />
          <div className="flex gap-1 mt-1">
            <button type="submit" className="text-xs text-blue-400 hover:text-blue-300">
              Save
            </button>
            <button
              type="button"
              onClick={() => setIsAdding(false)}
              className="text-xs text-gray-500 hover:text-gray-300"
            >
              Cancel
            </button>
          </div>
        </form>
      )}

      <div className="flex-1 overflow-y-auto">
        {projects.map((project) => (
          <ProjectItem
            key={project.id}
            project={project}
            onDelete={() => deleteMutation.mutate(project.id)}
          />
        ))}
      </div>

      <EnvironmentSelector />
    </div>
  );
}
```

- [ ] **Step 2: Start the full dev server and verify the UI**

```bash
npm run dev
```

Open `http://localhost:5173` in your browser. Verify:
- The sidebar Projects header shows **Import** and **+ New** buttons side by side.
- Clicking **Import** opens the system file picker.
- Selecting `OnSwitchJava.postman_collection.json` from the repo root triggers the import.
- The button shows **Importing...** briefly, then the new project **OnSwitchJava** appears in the sidebar.
- Expanding the project shows the imported requests with their names and methods.

- [ ] **Step 3: Verify error state**

Create a file `bad.json` with content `not valid json`. Select it via the Import button. Verify the red error message **"Invalid JSON"** appears below the header.

- [ ] **Step 4: Verify same-file re-import works**

Import `OnSwitchJava.postman_collection.json` a second time. Because the file input is reset on success (`fileInputRef.current.value = ''`), clicking Import and selecting the same file again should work — a second **OnSwitchJava** project is created (no dedup by design).

- [ ] **Step 5: Commit**

```bash
git add client/src/components/Sidebar/Sidebar.jsx
git commit -m "feat: add Postman collection import button to sidebar"
```
