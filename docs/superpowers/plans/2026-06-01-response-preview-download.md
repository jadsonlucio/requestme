# Response Preview & Download Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a download button and binary-aware content preview to the response panel — images, SVG, video, and audio render natively; unknown binary shows a file icon; text responses are unchanged.

**Architecture:** The server proxy gains a `GET /api/proxy/preview/:token` streaming endpoint that re-executes the original request and pipes bytes directly, enabling native browser media playback. Binary detection happens in `POST /api/proxy` via a content-type check; text responses continue unchanged. The client ResponsePanel switches to `Preview | Headers` tabs for binary and adds a download button to the header bar for all responses.

**Tech Stack:** Node.js 24 (native fetch, `crypto.randomUUID`, `Readable.fromWeb`), Express, React 18, Tailwind CSS. No test infrastructure exists — verification is manual (browser).

---

## File Map

| File | Action | Purpose |
|---|---|---|
| `server/src/proxy.js` | Modify | Add `isTextLike`, `buildFetchArgs`, token store, binary branch in POST handler, new GET `/preview/:token` route |
| `client/src/utils/contentType.js` | Create | `classifyContentType(contentType)` pure function |
| `client/src/utils/filename.js` | Create | `resolveFilename(headers, requestUrl, contentType)` + MIME extension map |
| `client/src/components/RequestEditor/RequestEditor.jsx` | Modify | Attach `requestUrl` to response object before calling `onResponse` |
| `client/src/components/ResponsePanel/ResponsePanel.jsx` | Modify | Download button, binary tabs, `PreviewContent` component |

---

## Task 1: Server — extract `buildFetchArgs` and add `isTextLike`

Refactor `server/src/proxy.js` to extract the request-building logic into a reusable helper so both the POST handler and the new streaming endpoint can call it without duplication. Also add `isTextLike`.

**Files:**
- Modify: `server/src/proxy.js`

- [ ] **Step 1: Add `isTextLike` and `buildFetchArgs` to proxy.js**

Replace the top of `server/src/proxy.js` (after `const router = require('express').Router()`) — keep `substituteVariables` and `applyAuth` exactly as they are, then add these two functions below them:

```javascript
function isTextLike(contentType) {
  if (!contentType) return false;
  const ct = contentType.split(';')[0].trim().toLowerCase();
  if (ct === 'image/svg+xml') return false;
  return (
    ct.startsWith('text/') ||
    ct === 'application/json' ||
    ct.includes('+json') ||
    ct === 'application/xml' ||
    ct.includes('+xml') ||
    ct === 'application/javascript' ||
    ct === 'application/x-www-form-urlencoded'
  );
}

function buildFetchArgs(config, rangeHeader) {
  const {
    method = 'GET',
    url = '',
    headers: rawHeaders = [],
    body_type = 'none',
    body = '',
    auth_type = 'none',
    auth_config = {},
    variables = {},
  } = config;

  let resolvedUrl = substituteVariables(url, variables);

  if (auth_type === 'apikey' && auth_config.in === 'query' && auth_config.key) {
    const sep = resolvedUrl.includes('?') ? '&' : '?';
    resolvedUrl += `${sep}${encodeURIComponent(auth_config.key)}=${encodeURIComponent(auth_config.value || '')}`;
  }

  const resolvedHeaders = {};
  for (const h of rawHeaders) {
    if (h.enabled !== false && h.key) {
      resolvedHeaders[substituteVariables(h.key, variables)] = substituteVariables(h.value || '', variables);
    }
  }
  applyAuth(resolvedHeaders, auth_type, auth_config);

  if (rangeHeader) resolvedHeaders['Range'] = rangeHeader;

  const fetchOptions = { method: method.toUpperCase(), headers: resolvedHeaders };

  if (!['GET', 'HEAD'].includes(fetchOptions.method) && body_type !== 'none') {
    if (body_type === 'json') {
      resolvedHeaders['Content-Type'] = resolvedHeaders['Content-Type'] || 'application/json';
      fetchOptions.body = body;
    } else if (body_type === 'form') {
      const params = new URLSearchParams();
      let formRows = [];
      try { formRows = JSON.parse(body); } catch {}
      for (const row of formRows) {
        if (row.enabled !== false && row.key) params.append(row.key, row.value || '');
      }
      resolvedHeaders['Content-Type'] = 'application/x-www-form-urlencoded';
      fetchOptions.body = params.toString();
    } else if (body_type === 'raw') {
      fetchOptions.body = body;
    }
  }

  return { resolvedUrl, fetchOptions };
}
```

- [ ] **Step 2: Commit**

```bash
git add server/src/proxy.js
git commit -m "refactor: extract buildFetchArgs and isTextLike helpers in proxy"
```

---

## Task 2: Server — token store + binary branch in POST /api/proxy

Modify the POST handler to use `buildFetchArgs` and return a `previewToken` for binary responses instead of a body string.

**Files:**
- Modify: `server/src/proxy.js`

- [ ] **Step 1: Add token store and cleanup interval**

Add this block immediately after the `buildFetchArgs` function (before `router.post`):

```javascript
const { Readable } = require('stream');

const tokenStore = new Map(); // token -> { config, expiresAt }
setInterval(() => {
  const now = Date.now();
  for (const [token, entry] of tokenStore) {
    if (entry.expiresAt < now) tokenStore.delete(token);
  }
}, 60_000);
```

- [ ] **Step 2: Rewrite the POST handler**

Replace the entire `router.post('/', async (req, res) => { ... })` block with:

```javascript
router.post('/', async (req, res) => {
  const config = req.body;
  const start = Date.now();

  try {
    const { resolvedUrl, fetchOptions } = buildFetchArgs(config);
    const response = await fetch(resolvedUrl, fetchOptions);
    const time_ms = Date.now() - start;

    const responseHeaders = {};
    response.headers.forEach((value, key) => { responseHeaders[key] = value; });

    const contentType = response.headers.get('content-type') || '';

    if (isTextLike(contentType)) {
      const responseBody = await response.text();
      res.json({ status: response.status, statusText: response.statusText, headers: responseHeaders, body: responseBody, time_ms });
    } else {
      await response.body?.cancel();
      const token = crypto.randomUUID();
      tokenStore.set(token, { config, expiresAt: Date.now() + 5 * 60 * 1000 });
      res.json({ status: response.status, statusText: response.statusText, headers: responseHeaders, time_ms, previewToken: token, bodyType: 'binary' });
    }
  } catch (error) {
    res.json({ error: error.message, status: 0, statusText: 'Network Error', headers: {}, body: '', time_ms: Date.now() - start });
  }
});
```

- [ ] **Step 3: Verify server starts without errors**

```bash
cd /Users/jadsonlucio/Documents/dev/side-projects/requestme
npm run dev
```

Expected: both client (port 5173) and server (port 3001) start without errors.

Send a text request (e.g., GET https://httpbin.org/json) and confirm the response still shows in the UI with Pretty/Raw/Headers tabs.

- [ ] **Step 4: Commit**

```bash
git add server/src/proxy.js
git commit -m "feat: detect binary responses and issue preview tokens in proxy"
```

---

## Task 3: Server — GET /api/proxy/preview/:token streaming endpoint

Add the new route that replays the stored request config and pipes bytes directly to the browser.

**Files:**
- Modify: `server/src/proxy.js`

- [ ] **Step 1: Add the preview route**

Add this block immediately after the `router.post` block and before `module.exports = router`:

```javascript
router.get('/preview/:token', async (req, res) => {
  const entry = tokenStore.get(req.params.token);
  if (!entry || entry.expiresAt < Date.now()) {
    return res.status(404).json({ error: 'Token not found or expired' });
  }

  try {
    const { resolvedUrl, fetchOptions } = buildFetchArgs(entry.config, req.headers['range']);
    const response = await fetch(resolvedUrl, fetchOptions);

    res.status(response.status);

    for (const h of ['content-type', 'content-length', 'content-range', 'accept-ranges', 'cache-control']) {
      const val = response.headers.get(h);
      if (val) res.setHeader(h, val);
    }

    const readable = Readable.fromWeb(response.body);
    req.on('close', () => readable.destroy());
    readable.pipe(res);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});
```

- [ ] **Step 2: Manual verification**

Restart the server. Open a terminal and test directly:

```bash
# First get a token by sending a binary request (e.g., a PNG image)
curl -s -X POST http://localhost:3001/api/proxy \
  -H 'Content-Type: application/json' \
  -d '{"method":"GET","url":"https://httpbin.org/image/png","headers":[],"body_type":"none","body":"","auth_type":"none","auth_config":{},"variables":{}}' \
  | grep -o '"previewToken":"[^"]*"'
```

Copy the token, then:

```bash
curl -I http://localhost:3001/api/proxy/preview/<TOKEN>
```

Expected: `HTTP/1.1 200 OK` with `content-type: image/png`.

- [ ] **Step 3: Commit**

```bash
git add server/src/proxy.js
git commit -m "feat: add GET /api/proxy/preview/:token streaming endpoint"
```

---

## Task 4: Client utilities — classifyContentType and resolveFilename

Two small pure modules with no dependencies.

**Files:**
- Create: `client/src/utils/contentType.js`
- Create: `client/src/utils/filename.js`

- [ ] **Step 1: Create contentType.js**

```javascript
// client/src/utils/contentType.js

// Returns: 'json' | 'text' | 'svg' | 'image' | 'video' | 'audio' | 'binary'
export function classifyContentType(contentType) {
  if (!contentType) return 'binary';
  const ct = contentType.split(';')[0].trim().toLowerCase();
  if (ct === 'application/json' || ct.includes('+json')) return 'json';
  if (ct === 'image/svg+xml') return 'svg';
  if (
    ct.startsWith('text/') ||
    ct === 'application/xml' ||
    ct.includes('+xml') ||
    ct === 'application/javascript'
  ) return 'text';
  if (ct.startsWith('image/')) return 'image';
  if (ct.startsWith('video/')) return 'video';
  if (ct.startsWith('audio/')) return 'audio';
  return 'binary';
}
```

- [ ] **Step 2: Create filename.js**

```javascript
// client/src/utils/filename.js

const MIME_TO_EXT = {
  'application/json': 'json',
  'application/xml': 'xml',
  'application/javascript': 'js',
  'application/pdf': 'pdf',
  'application/zip': 'zip',
  'application/octet-stream': 'bin',
  'text/html': 'html',
  'text/plain': 'txt',
  'text/csv': 'csv',
  'text/xml': 'xml',
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/gif': 'gif',
  'image/webp': 'webp',
  'image/svg+xml': 'svg',
  'video/mp4': 'mp4',
  'video/webm': 'webm',
  'video/ogg': 'ogv',
  'audio/mpeg': 'mp3',
  'audio/wav': 'wav',
  'audio/ogg': 'ogg',
  'audio/webm': 'weba',
};

export function resolveFilename(responseHeaders, requestUrl, contentType) {
  // 1. Content-Disposition header
  const disposition = responseHeaders['content-disposition'];
  if (disposition) {
    const match = disposition.match(/filename\*?=(?:UTF-8'')?["']?([^"';\r\n]+)["']?/i);
    if (match) {
      const name = match[1].trim().split(/[/\\]/).pop();
      if (name) return name;
    }
  }

  // 2. Last path segment of request URL if it has an extension
  try {
    const pathname = new URL(requestUrl).pathname;
    const segment = pathname.split('/').pop();
    if (segment && segment.includes('.')) return segment;
  } catch {}

  // 3. Fallback: "response.<ext>" or "response"
  const ct = (contentType || '').split(';')[0].trim().toLowerCase();
  const ext = MIME_TO_EXT[ct];
  return ext ? `response.${ext}` : 'response';
}
```

- [ ] **Step 3: Commit**

```bash
git add client/src/utils/contentType.js client/src/utils/filename.js
git commit -m "feat: add classifyContentType and resolveFilename client utilities"
```

---

## Task 5: Attach requestUrl to response object in RequestEditor

The `resolveFilename` utility needs the original request URL to extract a filename from the path. The simplest way to make it available in ResponsePanel is to include it in the response object when `onResponse` is called.

**Files:**
- Modify: `client/src/components/RequestEditor/RequestEditor.jsx:68-80`

- [ ] **Step 1: Add requestUrl to the result before calling onResponse**

In `handleSend`, find this block:

```javascript
    const result = await sendRequest({
      method: localRequest.method,
      url: localRequest.url,
      headers: localRequest.headers || [],
      body_type: localRequest.body_type,
      body: localRequest.body,
      auth_type: localRequest.auth_type,
      auth_config: localRequest.auth_config || {},
      variables,
    });

    setIsSending(false);
    onResponse(result);
```

Replace `onResponse(result)` with:

```javascript
    setIsSending(false);
    onResponse({ ...result, requestUrl: localRequest.url });
```

- [ ] **Step 2: Commit**

```bash
git add client/src/components/RequestEditor/RequestEditor.jsx
git commit -m "feat: include requestUrl in response object for filename resolution"
```

---

## Task 6: Add download button to ResponsePanel

A small button in the header bar. Text responses create a Blob and trigger a programmatic click; binary responses use a plain anchor tag pointing at the preview endpoint.

**Files:**
- Modify: `client/src/components/ResponsePanel/ResponsePanel.jsx`

- [ ] **Step 1: Add imports and the DownloadButton component**

At the top of `ResponsePanel.jsx`, add the imports:

```javascript
import { resolveFilename } from '../../utils/filename';
```

Add this component above the `ResponsePanel` function:

```javascript
function DownloadButton({ response }) {
  const headers = response.headers || {};
  const contentType = headers['content-type'] || '';
  const filename = resolveFilename(headers, response.requestUrl || '', contentType);

  function handleTextDownload() {
    const blob = new Blob([response.body], { type: contentType || 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  const btnClass = 'ml-auto text-xs text-gray-400 hover:text-gray-200 px-2 py-0.5 rounded border border-gray-600 hover:border-gray-400 transition-colors';

  if (response.previewToken) {
    return (
      <a
        href={`/api/proxy/preview/${response.previewToken}`}
        download={filename}
        className={btnClass}
      >
        Download
      </a>
    );
  }

  return (
    <button onClick={handleTextDownload} className={btnClass}>
      Download
    </button>
  );
}
```

- [ ] **Step 2: Add the button to the response header bar**

In the `ResponsePanel` component, find the header bar div:

```javascript
      <div className="flex items-center gap-3 px-3 py-2 border-b border-gray-700 shrink-0">
        <span className={`text-xs font-bold ${STATUS_COLOR(response.status)}`}>
          {response.status} {response.statusText}
        </span>
        <span className="text-gray-500 text-xs">{response.time_ms}ms</span>
        <span className="text-gray-600 text-xs">
          {responseHeaders['content-length']
            ? `${responseHeaders['content-length']} B`
            : `${(response.body || '').length} B`}
        </span>
      </div>
```

Replace it with:

```javascript
      <div className="flex items-center gap-3 px-3 py-2 border-b border-gray-700 shrink-0">
        <span className={`text-xs font-bold ${STATUS_COLOR(response.status)}`}>
          {response.status} {response.statusText}
        </span>
        <span className="text-gray-500 text-xs">{response.time_ms}ms</span>
        <span className="text-gray-600 text-xs">
          {responseHeaders['content-length']
            ? `${responseHeaders['content-length']} B`
            : response.body != null ? `${response.body.length} B` : ''}
        </span>
        <DownloadButton response={response} />
      </div>
```

- [ ] **Step 3: Manual verification**

Run the app (`npm run dev`). Send a GET request to `https://httpbin.org/json`.
- Confirm a "Download" button appears in the response header bar.
- Click it — a file named `response.json` should download with the JSON body.

- [ ] **Step 4: Commit**

```bash
git add client/src/components/ResponsePanel/ResponsePanel.jsx
git commit -m "feat: add download button to response panel header bar"
```

---

## Task 7: Add binary Preview tab to ResponsePanel

Replace Pretty/Raw tabs with a Preview tab when the response is binary. Render image, SVG, video, audio, or a file icon based on content-type.

**Files:**
- Modify: `client/src/components/ResponsePanel/ResponsePanel.jsx`

- [ ] **Step 1: Add classifyContentType import**

Add to the imports at the top:

```javascript
import { classifyContentType } from '../../utils/contentType';
```

- [ ] **Step 2: Add PreviewContent component**

Add this component above `ResponsePanel`:

```javascript
function FileIcon() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" className="w-12 h-12 text-gray-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
    </svg>
  );
}

function PreviewContent({ contentType, previewToken }) {
  const src = `/api/proxy/preview/${previewToken}`;
  const kind = classifyContentType(contentType);

  if (kind === 'image' || kind === 'svg') {
    return (
      <img
        src={src}
        alt="response preview"
        className="max-w-full max-h-full object-contain"
      />
    );
  }
  if (kind === 'video') {
    return (
      <video controls src={src} className="max-w-full max-h-full">
        Your browser does not support video playback.
      </video>
    );
  }
  if (kind === 'audio') {
    return <audio controls src={src} className="w-full" />;
  }

  // Unknown binary — show file icon + extension
  const ext = contentType
    ? contentType.split(';')[0].trim().split('/')[1] || null
    : null;

  return (
    <div className="flex flex-col items-center gap-2 text-gray-400">
      <FileIcon />
      <span className="text-xs">{ext ? `.${ext}` : contentType || 'unknown'}</span>
    </div>
  );
}
```

- [ ] **Step 3: Update tab logic in ResponsePanel**

Inside the `ResponsePanel` component (after the header declarations), add:

```javascript
  const isBinary = !!response.previewToken;
  const tabs = isBinary ? ['preview', 'headers'] : ['pretty', 'raw', 'headers'];
```

Replace the current tab rendering:

```javascript
      <div className="flex border-b border-gray-700 px-3 shrink-0">
        {['pretty', 'raw', 'headers'].map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`px-3 py-2 text-xs capitalize ${
              tab === t ? 'text-blue-400 border-b-2 border-blue-400' : 'text-gray-500 hover:text-gray-300'
            }`}
          >
            {t}
          </button>
        ))}
      </div>
```

With:

```javascript
      <div className="flex border-b border-gray-700 px-3 shrink-0">
        {tabs.map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`px-3 py-2 text-xs capitalize ${
              tab === t ? 'text-blue-400 border-b-2 border-blue-400' : 'text-gray-500 hover:text-gray-300'
            }`}
          >
            {t}
          </button>
        ))}
      </div>
```

- [ ] **Step 4: Replace tab state with activeTab derived value**

Replace:

```javascript
  const [tab, setTab] = useState('pretty');
```

With:

```javascript
  const [tab, setTab] = useState('pretty');
  const isBinary = !!(response && response.previewToken);
  const tabs = isBinary ? ['preview', 'headers'] : ['pretty', 'raw', 'headers'];
  const activeTab = tabs.includes(tab) ? tab : tabs[0];
```

`activeTab` clamps the stored `tab` value to the valid tab set for the current response. When the user switches between a binary and a text response, the active tab falls back gracefully to the first valid option. `setTab` continues to update `tab` directly — no `useEffect` needed.

Also remove the standalone `const isBinary` and `const tabs` lines added in Step 3 — they are now declared here instead.

Replace every `tab ===` comparison in the render with `activeTab ===`. The `onClick={() => setTab(t)}` calls and the `{tabs.map(...)}` call stay as-is.

- [ ] **Step 5: Add Preview tab body content**

In the scrollable body div, add the preview tab after the other tab renders:

```javascript
      <div className="flex-1 overflow-y-auto">
        {activeTab === 'pretty' && (
          <pre className="p-3 text-xs text-gray-200 whitespace-pre-wrap break-all font-mono">
            {prettyBody || <span className="text-gray-600">Empty response</span>}
          </pre>
        )}
        {activeTab === 'raw' && (
          <pre className="p-3 text-xs text-gray-200 whitespace-pre-wrap break-all font-mono">
            {response.body || <span className="text-gray-600">Empty response</span>}
          </pre>
        )}
        {activeTab === 'preview' && (
          <div className="flex-1 flex items-center justify-center p-4 min-h-48">
            <PreviewContent
              contentType={responseHeaders['content-type']}
              previewToken={response.previewToken}
            />
          </div>
        )}
        {activeTab === 'headers' && (
          <div className="p-3 space-y-1">
            {Object.entries(responseHeaders).map(([key, value]) => (
              <div key={key} className="flex gap-2 text-xs">
                <span className="text-gray-400 shrink-0">{key}:</span>
                <span className="text-gray-200 break-all">{value}</span>
              </div>
            ))}
            {Object.keys(responseHeaders).length === 0 && (
              <span className="text-gray-600">No headers</span>
            )}
          </div>
        )}
      </div>
```

- [ ] **Step 6: Manual verification — image**

With the dev server running, send: `GET https://httpbin.org/image/png`

Expected:
- Response header bar shows status `200 OK`, time, and a "Download" button
- Tabs show: `preview` | `headers`
- Preview tab shows the PNG image rendered inline
- Clicking Download saves a file named `png` (httpbin path is `/image/png` — no extension in path, content-type is `image/png` → falls back to `response.png`)

- [ ] **Step 7: Manual verification — audio**

Send: `GET https://www.soundhelix.com/examples/mp3/SoundHelix-Song-1.mp3`

Expected:
- Preview tab shows an `<audio>` player
- Playback starts without waiting for full download
- Download button saves the `.mp3` file

- [ ] **Step 8: Manual verification — unknown binary**

Send: `GET https://httpbin.org/bytes/64`

Expected:
- Preview tab shows a file icon with `.octet-stream` label (content-type is `application/octet-stream`)
- Download button saves `response.bin`

- [ ] **Step 9: Manual verification — text responses unchanged**

Send: `GET https://httpbin.org/json`

Expected:
- Tabs show: `pretty` | `raw` | `headers` (unchanged)
- Download button saves `response.json` with JSON content

- [ ] **Step 10: Commit**

```bash
git add client/src/components/ResponsePanel/ResponsePanel.jsx
git commit -m "feat: add binary preview tab with image/video/audio/file-icon rendering"
```
