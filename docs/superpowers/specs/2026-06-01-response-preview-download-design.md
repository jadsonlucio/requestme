# Response Preview & Download — Design Spec
Date: 2026-06-01

## Overview

Add a download button to the response panel and replace raw binary display with content-appropriate previews: images render as images, video/audio render with native browser players, unknown binary shows a file icon. Text responses (JSON, XML, plain text) are unaffected.

---

## Architecture

The core constraint: the proxy currently calls `response.text()` which corrupts binary data. Binary responses must never be buffered and base64-encoded through the JSON envelope — that wastes memory and prevents progressive media playback.

**Chosen approach: token-based streaming endpoint.**

1. `POST /api/proxy` collects response headers/status only for binary content, stores the request config in an in-memory token store, and returns the token.
2. `GET /api/proxy/preview/:token` re-executes the request and pipes bytes directly to the browser — enabling native `<video>` / `<audio>` streaming with `Range` support.
3. Text responses follow the existing path (unchanged).

This makes two requests to the target for binary content, which is acceptable for a local dev tool.

---

## Server Changes

### `POST /api/proxy` (modified)

After receiving the target response, detect content type:

**Text-like** (`text/*`, `application/json`, `application/xml`, `application/javascript`, `application/x-www-form-urlencoded`):
- Read body with `.text()` (current behavior)
- Return existing envelope: `{ status, statusText, headers, body, time_ms }`

**Binary** (everything else):
- Do NOT read the body
- Generate a UUID `previewToken`
- Store the original request config (method, url, headers, auth, body, variables) in an in-memory Map keyed by the token
- Set TTL: auto-delete token after 5 minutes
- Return: `{ status, statusText, headers, time_ms, previewToken, bodyType: 'binary' }` (no `body` field)

### `GET /api/proxy/preview/:token` (new)

- Look up stored request config by token → 404 if missing/expired
- Re-execute the request to the target with the same config
- Pipe response stream directly to Express response
- Pass through `Content-Type` and `Content-Length` headers from target
- Handle `Range` request headers so browser media elements can seek

### In-memory token store

Simple `Map<token, { config, expiresAt }>` in `proxy.js`. A `setInterval` every 60 seconds cleans expired entries. No persistence needed — tokens are ephemeral session artifacts.

---

## Client Changes

### Content-type classification

New pure function `classifyContentType(contentType: string)` returns one of:

| Return value | Matched content-types |
|---|---|
| `'json'` | `application/json`, `application/*+json` |
| `'text'` | `text/*`, `application/xml`, `application/javascript` |
| `'svg'` | `image/svg+xml` |
| `'image'` | `image/*` (excluding svg) |
| `'video'` | `video/*` |
| `'audio'` | `audio/*` |
| `'binary'` | anything else |

### ResponsePanel tab logic

| Response type | Tabs shown |
|---|---|
| Text (`body` field present) | Pretty \| Raw \| Headers (unchanged) |
| Binary (`previewToken` present) | Preview \| Headers |

Default tab for binary responses: Preview.

### Preview tab rendering

| Classified type | Element |
|---|---|
| `image`, `svg` | `<img src="/api/proxy/preview/:token" alt="response">` |
| `video` | `<video controls src="/api/proxy/preview/:token">` |
| `audio` | `<audio controls src="/api/proxy/preview/:token">` |
| `binary` (unknown) | File icon + extension label |

For `binary` (unknown): derive extension from content-type (e.g. `application/pdf` → `.pdf`). If unrecognised, show the raw mime type. Use a generic file icon SVG from Tailwind/Heroicons.

### Download button

Added to the response header bar (alongside status code, time, size). Always visible when a response exists.

**Text responses:**
- Create a `Blob` from the body string with the correct MIME type
- Create an object URL, click a hidden `<a download>`, then revoke

**Binary responses:**
- Render `<a href="/api/proxy/preview/:token" download="<filename>">` — browser handles download natively

### Filename resolution (shared helper `resolveFilename`)

Priority order:
1. `Content-Disposition: attachment; filename="foo.png"` — parse filename from header
2. Last path segment of the request URL (e.g. `/files/report.pdf` → `report.pdf`), only if it has a file extension
3. Fallback: `response` + extension derived from content-type (e.g. `response.mp4`, `response.json`)

Extension-from-content-type map covers the common cases: json, xml, html, txt, png, jpg, gif, webp, svg, pdf, mp4, webm, mp3, wav, ogg, zip, csv.

---

## Data Flow

```
User clicks Send
  → POST /api/proxy (existing client call)
  → Server detects binary content-type
  → Stores request config with token (TTL 5m)
  → Returns { status, headers, time_ms, previewToken, bodyType: 'binary' }
  → ResponsePanel shows Preview | Headers tabs
  → <img src="/api/proxy/preview/:token"> or <video src="..."> renders inline
  → Download button: <a href="/api/proxy/preview/:token" download="filename">
```

---

## Error Handling

| Scenario | Behavior |
|---|---|
| Token expired before preview loads | `GET /api/proxy/preview/:token` returns 404; browser shows broken image / media error |
| Target unreachable on second request | Pipe error → browser media element shows error state |
| Unknown binary type with no extension | Show generic file icon + raw MIME type string |
| `Content-Disposition` filename contains path traversal | Strip to basename only before using as download filename |

---

## Out of Scope

- Caching binary content server-side (tokens store config only, not the fetched bytes)
- PDF in-browser rendering (treated as unknown binary — file icon)
- Syntax highlighting for HTML/XML responses
- Response size limit warnings
