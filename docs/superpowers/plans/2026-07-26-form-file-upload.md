# Form-Data File Upload Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a "form" body row hold an attached file instead of text, and send `multipart/form-data` (instead of urlencoded) whenever any row has a file.

**Architecture:** The row shape gains optional `type: 'text' | 'file'`, `fileName`, `mimeType` fields (default `type: 'text'`, fully backward compatible with existing saved rows). The client reads a picked file into a base64 string and stores it on the row. The server (`buildFetchArgs` in `server/src/proxy.js`) checks whether any enabled row has `type === 'file'`; if so it builds a native `FormData`/`Blob` multipart body instead of `URLSearchParams`. No DB schema change — everything rides inside the existing JSON-stringified `body` column.

**Tech Stack:** React (client, no test framework installed), Express + native `fetch`/`FormData`/`Blob` (server, Node's built-in `node:test` runner).

## Global Constraints

- One file per row (no multi-file rows) — spec: "Non-goals".
- Client-side cap: reject files over 5MB before reading them — spec: "UI" section.
- No schema/migration changes; files persist as base64 inside the existing `body` TEXT column — spec: "Persistence".
- When a multipart body is sent, no `Content-Type` header is set manually — `fetch` sets `multipart/form-data; boundary=...` itself — spec: "Sending".
- Rows without `type` (or with `type !== 'file'`) must behave byte-for-byte identically to today's urlencoded path — spec: "Data model", "Sending".

---

### Task 1: Multipart support in `buildFetchArgs` (server)

**Files:**
- Modify: `server/src/proxy.js:40-90` (`buildFetchArgs`), `server/src/proxy.js:163` (exports)
- Test: Create `server/src/proxy.test.js`

**Interfaces:**
- Consumes: nothing new — the existing `config` object shape (`method`, `url`, `headers`, `body_type`, `body`, `auth_type`, `auth_config`, `variables`) passed into `buildFetchArgs(config, rangeHeader)`.
- Produces: `buildFetchArgs` becomes a named export from `server/src/proxy.js` (`module.exports.buildFetchArgs = buildFetchArgs`), so Task 3's manual end-to-end check and any future server work can reuse it. Row shape consumed: `{ key, value, enabled, type, fileName, mimeType }` — `type` defaults to `'text'` when absent or anything other than `'file'`.

- [ ] **Step 1: Write the failing tests**

Create `server/src/proxy.test.js`:

```js
const test = require('node:test');
const assert = require('node:assert/strict');
const { buildFetchArgs } = require('./proxy');

test('form body with only text rows is sent as urlencoded (unchanged behavior)', () => {
  const config = {
    method: 'POST',
    url: 'https://example.com',
    body_type: 'form',
    body: JSON.stringify([
      { key: 'name', value: 'Ada', enabled: true, type: 'text' },
      { key: 'skip', value: 'nope', enabled: false, type: 'text' },
    ]),
  };

  const { fetchOptions } = buildFetchArgs(config);

  assert.equal(fetchOptions.headers['Content-Type'], 'application/x-www-form-urlencoded');
  assert.equal(fetchOptions.body, 'name=Ada');
});

test('form body with a file row is sent as multipart/form-data', async () => {
  const config = {
    method: 'POST',
    url: 'https://example.com',
    body_type: 'form',
    body: JSON.stringify([
      {
        key: 'avatar',
        value: Buffer.from('hello').toString('base64'),
        enabled: true,
        type: 'file',
        fileName: 'hi.txt',
        mimeType: 'text/plain',
      },
    ]),
  };

  const { fetchOptions } = buildFetchArgs(config);

  assert.ok(fetchOptions.body instanceof FormData);
  assert.equal(fetchOptions.headers['Content-Type'], undefined);

  const file = fetchOptions.body.get('avatar');
  assert.equal(file.name, 'hi.txt');
  assert.equal(file.type, 'text/plain');
  assert.equal(await file.text(), 'hello');
});

test('form body mixing text and file rows sends both as multipart/form-data, excluding disabled rows', async () => {
  const config = {
    method: 'POST',
    url: 'https://example.com',
    body_type: 'form',
    body: JSON.stringify([
      { key: 'title', value: 'My Upload', enabled: true, type: 'text' },
      {
        key: 'avatar',
        value: Buffer.from('hello').toString('base64'),
        enabled: true,
        type: 'file',
        fileName: 'hi.txt',
        mimeType: 'text/plain',
      },
      { key: 'ignored', value: 'x', enabled: false, type: 'text' },
    ]),
  };

  const { fetchOptions } = buildFetchArgs(config);

  assert.ok(fetchOptions.body instanceof FormData);
  assert.equal(fetchOptions.body.get('title'), 'My Upload');
  assert.equal(fetchOptions.body.get('ignored'), null);

  const file = fetchOptions.body.get('avatar');
  assert.equal(await file.text(), 'hello');
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd server && npm test`
Expected: FAIL — `buildFetchArgs` is `undefined` (not yet exported), so calling it throws a `TypeError`.

- [ ] **Step 3: Export `buildFetchArgs` and implement the multipart branch**

In `server/src/proxy.js`, find this exact block (currently lines 75-83):

```js
    } else if (body_type === 'form') {
      const params = new URLSearchParams();
      let formRows = [];
      try { formRows = JSON.parse(body); } catch {}
      for (const row of formRows) {
        if (row.enabled !== false && row.key) params.append(row.key, row.value || '');
      }
      resolvedHeaders['Content-Type'] = 'application/x-www-form-urlencoded';
      fetchOptions.body = params.toString();
```

and replace it with:

```js
    } else if (body_type === 'form') {
      let formRows = [];
      try { formRows = JSON.parse(body); } catch {}
      const enabledRows = formRows.filter((row) => row.enabled !== false && row.key);
      const hasFile = enabledRows.some((row) => row.type === 'file');

      if (hasFile) {
        const formData = new FormData();
        for (const row of enabledRows) {
          if (row.type === 'file') {
            const buffer = Buffer.from(row.value || '', 'base64');
            const blob = new Blob([buffer], { type: row.mimeType || 'application/octet-stream' });
            formData.append(row.key, blob, row.fileName || row.key);
          } else {
            formData.append(row.key, row.value || '');
          }
        }
        delete resolvedHeaders['Content-Type'];
        fetchOptions.body = formData;
      } else {
        const params = new URLSearchParams();
        for (const row of enabledRows) params.append(row.key, row.value || '');
        resolvedHeaders['Content-Type'] = 'application/x-www-form-urlencoded';
        fetchOptions.body = params.toString();
      }
```

Leave the surrounding `} else if (body_type === 'raw') {` line (currently line 84) and everything after it untouched — only the lines shown above change.

At the bottom of `server/src/proxy.js`, change line 163 from:

```js
module.exports = router;
```

to:

```js
module.exports = router;
module.exports.buildFetchArgs = buildFetchArgs;
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd server && npm test`
Expected: PASS for all three new tests, and all pre-existing tests under `server/src/parsers/` still pass (same command runs the whole suite).

- [ ] **Step 5: Commit**

```bash
git add server/src/proxy.js server/src/proxy.test.js
git commit -m "feat: send multipart/form-data when a form row has an attached file"
```

---

### Task 2: File-type form rows in the client (`BodyTab.jsx`)

**Files:**
- Modify: `client/src/components/RequestEditor/BodyTab.jsx` (full-file rewrite, ~180 lines after this change)

**Interfaces:**
- Consumes: `buildFetchArgs`'s row contract from Task 1 — rows must carry `{ key, value, enabled, type, fileName, mimeType }` with `type: 'file'` triggering the multipart path server-side. `BodyTab`'s own props are unchanged: `{ bodyType, body, onChangeType, onChangeBody }`.
- Produces: nothing consumed by later tasks — this is the last task in the plan.

- [ ] **Step 1: Replace the full contents of `client/src/components/RequestEditor/BodyTab.jsx`**

```jsx
import { useState } from 'react';

const BODY_TYPES = ['none', 'json', 'form', 'raw'];
const MAX_FILE_SIZE_BYTES = 5 * 1024 * 1024;

function parseFormBody(body) {
  try {
    const parsed = JSON.parse(body);
    if (Array.isArray(parsed)) return parsed;
    if (parsed && typeof parsed === 'object') {
      return Object.entries(parsed).map(([key, value]) => ({ key, value: String(value), enabled: true }));
    }
    return [];
  } catch { return []; }
}

function readFileAsBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result;
      resolve(result.slice(result.indexOf(',') + 1));
    };
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

export default function BodyTab({ bodyType, body, onChangeType, onChangeBody }) {
  const [fileErrors, setFileErrors] = useState({});

  function handleTypeChange(type) {
    onChangeType(type);
    if (type === 'form' && !body) onChangeBody(JSON.stringify([]));
  }

  function addFormRow() {
    const rows = parseFormBody(body);
    onChangeBody(JSON.stringify([...rows, { key: '', value: '', enabled: true, type: 'text' }]));
  }

  function updateFormRow(index, fields) {
    const rows = parseFormBody(body).map((r, i) => (i === index ? { ...r, ...fields } : r));
    onChangeBody(JSON.stringify(rows));
  }

  function removeFormRow(index) {
    const rows = parseFormBody(body).filter((_, i) => i !== index);
    onChangeBody(JSON.stringify(rows));
    setFileErrors((prev) => {
      const next = { ...prev };
      delete next[index];
      return next;
    });
  }

  function toggleFormRow(index) {
    const rows = parseFormBody(body);
    updateFormRow(index, { enabled: !rows[index].enabled });
  }

  function setRowType(index, type) {
    setFileErrors((prev) => {
      const next = { ...prev };
      delete next[index];
      return next;
    });
    updateFormRow(index, { type, value: '', fileName: undefined, mimeType: undefined });
  }

  async function handleFilePick(index, e) {
    const file = e.target.files[0];
    e.target.value = '';
    if (!file) return;

    if (file.size > MAX_FILE_SIZE_BYTES) {
      setFileErrors((prev) => ({ ...prev, [index]: 'File exceeds 5MB limit' }));
      return;
    }

    setFileErrors((prev) => {
      const next = { ...prev };
      delete next[index];
      return next;
    });

    const base64 = await readFileAsBase64(file);
    updateFormRow(index, { value: base64, fileName: file.name, mimeType: file.type || 'application/octet-stream' });
  }

  return (
    <div>
      <div className="flex gap-1 mb-3">
        {BODY_TYPES.map((t) => (
          <button
            key={t}
            onClick={() => handleTypeChange(t)}
            className={`px-2 py-0.5 text-xs rounded ${
              bodyType === t
                ? 'bg-gray-600 text-gray-100'
                : 'text-gray-500 hover:text-gray-300'
            }`}
          >
            {t}
          </button>
        ))}
      </div>

      {bodyType === 'none' && (
        <p className="text-gray-600 text-xs">This request has no body.</p>
      )}

      {bodyType === 'json' && (
        <textarea
          value={body}
          onChange={(e) => onChangeBody(e.target.value)}
          placeholder={'{\n  "key": "value"\n}'}
          spellCheck={false}
          className="w-full h-64 bg-gray-700 text-gray-100 rounded px-3 py-2 text-xs outline-none font-mono resize-none"
        />
      )}

      {bodyType === 'raw' && (
        <textarea
          value={body}
          onChange={(e) => onChangeBody(e.target.value)}
          placeholder="Raw body content"
          spellCheck={false}
          className="w-full h-64 bg-gray-700 text-gray-100 rounded px-3 py-2 text-xs outline-none font-mono resize-none"
        />
      )}

      {bodyType === 'form' && (
        <div className="space-y-1">
          {parseFormBody(body).map((row, i) => {
            const rowType = row.type === 'file' ? 'file' : 'text';
            return (
              <div key={i}>
                <div className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={row.enabled !== false}
                    onChange={() => toggleFormRow(i)}
                    className="accent-blue-500"
                  />
                  <input
                    value={row.key}
                    onChange={(e) => updateFormRow(i, { key: e.target.value })}
                    placeholder="Key"
                    className={`flex-1 bg-gray-700 rounded px-2 py-1 text-xs outline-none ${
                      row.enabled === false ? 'opacity-40 text-gray-500' : 'text-gray-100'
                    }`}
                  />
                  <div className="flex text-[10px] rounded overflow-hidden shrink-0">
                    <button
                      onClick={() => setRowType(i, 'text')}
                      className={`px-1.5 py-1 ${rowType === 'text' ? 'bg-gray-600 text-gray-100' : 'bg-gray-700 text-gray-500'}`}
                    >
                      Text
                    </button>
                    <button
                      onClick={() => setRowType(i, 'file')}
                      className={`px-1.5 py-1 ${rowType === 'file' ? 'bg-gray-600 text-gray-100' : 'bg-gray-700 text-gray-500'}`}
                    >
                      File
                    </button>
                  </div>
                  {rowType === 'text' ? (
                    <input
                      value={row.value}
                      onChange={(e) => updateFormRow(i, { value: e.target.value })}
                      placeholder="Value"
                      className={`flex-1 bg-gray-700 rounded px-2 py-1 text-xs outline-none ${
                        row.enabled === false ? 'opacity-40 text-gray-500' : 'text-gray-100'
                      }`}
                    />
                  ) : (
                    <div className="flex-1 flex items-center gap-1 min-w-0">
                      <label className="px-2 py-1 text-xs bg-gray-700 rounded text-gray-300 hover:text-gray-100 cursor-pointer shrink-0">
                        Choose File
                        <input type="file" onChange={(e) => handleFilePick(i, e)} className="hidden" />
                      </label>
                      {row.fileName && (
                        <span className="text-xs text-gray-400 truncate">{row.fileName}</span>
                      )}
                    </div>
                  )}
                  <button
                    onClick={() => removeFormRow(i)}
                    className="text-red-500 hover:text-red-400 text-xs shrink-0"
                  >
                    ×
                  </button>
                </div>
                {fileErrors[i] && (
                  <p className="text-red-500 text-[10px] ml-6 mt-0.5">{fileErrors[i]}</p>
                )}
              </div>
            );
          })}
          <button onClick={addFormRow} className="mt-2 text-xs text-blue-400 hover:text-blue-300">
            + Add Field
          </button>
        </div>
      )}
    </div>
  );
}
```

> **Note:** the code sample above is what this task started from; it is no longer
> what's shipped. Task 2's own review caught two bugs in it and the fixes landed
> in the actual file: `removeFormRow` now re-maps `fileErrors` keys above the
> removed index (not a naive `delete next[index]`), and `handleFilePick` now
> wraps the `await readFileAsBase64(file)` call in a try/catch that sets an
> inline error on failure. Treat `client/src/components/RequestEditor/BodyTab.jsx`
> as the source of truth, not this sample — don't copy-paste from here.

- [ ] **Step 2: Manual verification (no client test framework exists in this repo — see Note below)**

1. Start the app: `cd server && npm run dev` (in one terminal), `cd client && npm run dev` (in another).
2. Open the client, create/open a request, set method to `POST`, set URL to `https://httpbin.org/post`, switch the Body tab to `form`.
3. Add a row, type a key `title`, leave it as `Text`, type a value `My Upload`. Confirm it still looks/works exactly as before this change.
4. Add a second row, key `avatar`, click `File`, click `Choose File`, pick a small image (< 5MB). Confirm the filename appears next to the button.
5. Send the request. Confirm the response body (httpbin echoes the request) shows `avatar` under `"files"` with the correct filename, and `title` under `"form"` with value `My Upload`.
6. Try picking a file larger than 5MB. Confirm the row shows the red "File exceeds 5MB limit" message and the row's value/fileName do not change.
7. Reload the app (refresh the page) and reopen the same request. Confirm both rows (text and file) reload with their saved values/filename intact (file content round-trips through the base64-in-`body` persistence from Task 1's data model — the actual bytes aren't re-verified visually, but the filename label persisting confirms the row survived the save/reload cycle).
8. Toggle the `avatar` row's checkbox off (disabled) and resend; confirm httpbin's response no longer includes `avatar`.

**Note on no automated client tests:** this repo has no Jest/Vitest/RTL installed for `client/` (verified: no test script, no test devDependencies, no `*.test.jsx` files anywhere). Introducing a whole test framework is out of scope for this feature — the design spec's own "Testing" section already calls for a manual UI check here, matching Step 2 above. If client-side automated testing becomes a project-wide priority, that should be its own separate plan.

- [ ] **Step 3: Commit**

```bash
git add client/src/components/RequestEditor/BodyTab.jsx
git commit -m "feat: support attaching a file to a form-data row in the request body editor"
```
