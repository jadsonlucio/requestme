# Form-Data File Upload — Design

## Problem

The "form" body tab sends requests as `application/x-www-form-urlencoded` — plain
text key/value pairs. There is no way to attach a file to a form field, so users
can't test endpoints that expect `multipart/form-data` uploads.

## Goals

- Let a form row hold either a text value (today's behavior) or an attached file.
- Send a real `multipart/form-data` request when any row in the form has a file.
- Keep sending `x-www-form-urlencoded` (unchanged) when no row has a file.
- Persist attached files across save/reload by embedding them (base64) in the
  existing body storage — no schema change.

## Non-goals

- A dedicated Postman-style "form-data" tab separate from "form" — one tab
  handles both, switching serialization automatically based on row contents.
- Multiple files per row — one file per row; use multiple rows with the same
  key for multiple files under one field name.
- Importing actual file bytes from Postman/OpenAPI/Swagger collections —
  those formats don't embed file content, so imported `formdata` file entries
  keep importing as plain text rows (existing behavior, unchanged).

## Data model

Form rows (the JSON array stored in `body` when `body_type === 'form'`) gain
two optional fields:

```
{ key: string, value: string, enabled: boolean, type?: 'text' | 'file', fileName?: string, mimeType?: string }
```

- `type` defaults to `'text'` when absent, so existing saved requests keep
  working with no migration.
- For `type: 'file'` rows: `value` holds the file content as a base64 string
  (no `data:` URL prefix), `fileName` is the original filename, `mimeType` is
  the browser-reported content type.
- Text rows are unchanged from today.

## UI — `client/src/components/RequestEditor/BodyTab.jsx`

Each form row gets a small Text/File toggle next to the key input.

- **Text** (default): unchanged key/value text inputs.
- **File**: the value input is replaced by a "Choose File" button (hidden
  `<input type="file">`, same pattern as the collection-import file input in
  `client/src/components/Sidebar/Sidebar.jsx`). Once a file is picked, the
  filename is shown next to the "Choose File" button. Picking a new file
  replaces the current attachment; the row's own remove button clears the
  whole row, including any attached file.

On file selection:

1. Reject files over 5MB with an inline error message; do not read the file.
2. Otherwise read it via `FileReader.readAsDataURL`, strip the
   `data:...;base64,` prefix, and set `value` (base64), `fileName`, `mimeType`,
   `type: 'file'` on that row.

The outer body-type tab strip (`none/json/form/raw`) is unchanged.

## Sending — `server/src/proxy.js`, `buildFetchArgs`

When `body_type === 'form'`, after parsing the row array:

- If any enabled row has `type === 'file'`, build a multipart body:
  - Construct a native `FormData()`.
  - File rows: `formData.append(key, new Blob([Buffer.from(value, 'base64')], { type: mimeType }), fileName)`.
  - Text rows: `formData.append(key, value || '')` (same as today).
  - Set `fetchOptions.body = formData` and do **not** set a `Content-Type`
    header — `fetch` (Node's built-in `undici`) sets the correct
    `multipart/form-data; boundary=...` header automatically. Any
    user-supplied `Content-Type` header is dropped in this case, since a
    hand-set header without the real boundary would break the request.
- If no row has `type === 'file'`, behavior is unchanged: build
  `URLSearchParams`, set `Content-Type: application/x-www-form-urlencoded`.

## Persistence

No schema change. The `body` column already stores the form rows as a JSON
string; file rows just make that string larger (base64 adds ~33% overhead).
The 5MB per-file client-side cap keeps this bounded.

## Testing

- Unit test `buildFetchArgs` for: text-only form rows (unchanged urlencoded
  path), form rows with one file (multipart, correct field name/filename/
  mime type), form rows mixing text and file (both present in the multipart
  body), and disabled rows being excluded in both modes.
- Manual UI check: attach a file under 5MB, send to an endpoint that echoes
  multipart bodies (e.g. httpbin `/post`), confirm the file arrives with the
  right field name, filename, and content. Confirm oversized-file rejection
  message appears and no request is corrupted.
