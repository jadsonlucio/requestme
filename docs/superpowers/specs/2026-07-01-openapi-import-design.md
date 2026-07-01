# OpenAPI / Swagger Import — Design Spec
Date: 2026-07-01

## Overview

Extend the existing Postman collection import (`POST /api/projects/import`) to also accept OpenAPI 3.x and Swagger 2.0 specifications, in JSON or YAML. Same button, same endpoint — the server detects the format and dispatches to the right parser. Output shape (`{ projectName, requests, variables }`) matches what the Postman parser already produces, so the transaction/insert code and the client are unchanged.

---

## Architecture

`POST /api/projects/import` parses the uploaded file, then dispatches by top-level shape:

1. Parse: try `JSON.parse(buffer)`; on failure, try `yaml.load(buffer)` (new `js-yaml` dependency — OpenAPI specs are commonly `.yaml`/`.yml`, unlike Postman collections which are always JSON). If both fail → 400 `"Invalid JSON or YAML"`.
2. Detect format from the parsed object:
   - `info.schema` contains `"collection/v2"` → Postman → `parsePostmanCollection(json)` (unchanged, existing).
   - `openapi` starts with `"3."` → OpenAPI 3.x → `parseOpenApiSpec(json)` (new).
   - `swagger === "2.0"` → Swagger 2.0 → `parseSwaggerV2Spec(json)` (new).
   - none match → 400 `"Unrecognized file format"`.
3. Both new parsers share two helpers:
   - **`resolveRef(root, ref)`** — generic JSON-pointer walk against the root document. Works for both `#/components/schemas/X` (OA3) and `#/definitions/X` (Swagger 2.0) without special-casing. No external/remote `$ref` support.
   - **`stubFromSchema(schema, root, seen)`** — recursively builds placeholder JSON from a (possibly `$ref`'d) schema, used to populate JSON request bodies.
4. Both parsers return `{ projectName, requests, variables }`, so the route's existing transaction (insert project → insert requests → optionally insert an "Imported" environment) is reused unchanged.

Key structural differences each parser handles on its own:

| Concern | OpenAPI 3.x | Swagger 2.0 |
|---|---|---|
| Base URL | `servers[0].url` (with `servers[0].variables[*].default` substituted if templated) | `(schemes[0] \|\| 'https') + '://' + host + basePath` |
| Request body | `requestBody.content['application/json'].schema` (or first available content type) | a `parameters[]` entry with `in: 'body'` → its `.schema` |
| Form body | `requestBody.content` has `x-www-form-urlencoded` or `multipart/form-data` | `parameters[]` entries with `in: 'formData'`, when `consumes` includes a form media type |
| `$ref` target root | `components.schemas` | `definitions` |
| Auth scheme source | `components.securitySchemes` | `securityDefinitions` |
| Auth scheme types | `http` (bearer/basic sub-type), `apiKey`, `oauth2`/`openIdConnect` → `none` | `basic`, `apiKey`, `oauth2` → `none` |

---

## Shared operation mapping

Both formats share the same `paths → path → method → operation` shape, so the following logic is not duplicated per-format:

**Traversal:** for each path, for each HTTP-verb key (`get/post/put/patch/delete/head/options`); skip non-verb keys such as a path-item-level `parameters` array. Path-level `parameters` are merged into every operation under that path; an operation-level parameter with the same `name`+`in` overrides the path-level one.

**Naming:** `"<firstTag> / <summary || operationId || 'METHOD path'>"`. If the operation has no tags, just `summary || operationId || 'METHOD path'` with no prefix.

**Method:** the uppercased verb key.

**Parameters:**

| `in` | Handling |
|---|---|
| `path` | Left as-is. OpenAPI path templates already use `{id}` syntax matching `/users/{id}`, so no transformation is needed — it's a visible placeholder the user edits before sending. |
| `query` | Appended to the URL as `?key={key}` (or the param's schema `default` if declared), joined with `&`. |
| `header` | Added to the headers list with the schema `default` if present, else empty string; `enabled: true`. |

All parameters — required and optional — are included; it's easier for the user to delete an unwanted one than to guess it existed.

**Body:**
- OA3: from `requestBody.content`, prefer `application/json` → `body_type: 'json'`; else a form media type → `'form'`; else the first available content type → `'raw'`; missing `requestBody` → `'none'`.
- Swagger 2.0: an `in: 'body'` parameter's `.schema` → `'json'`; else `in: 'formData'` parameters (when `consumes` includes a form type) → `'form'`, body = `JSON.stringify` of `{ key, value }` pairs; neither → `'none'`.
- `'json'` bodies get `body: JSON.stringify(stubFromSchema(schema, root), null, 2)`.

**Auth:** effective security = `operation.security ?? document.security ?? []`. Take the first scheme name in the first requirement object, look it up in `securitySchemes`/`securityDefinitions`, and map:

| Scheme | `auth_type` | `auth_config` |
|---|---|---|
| OA3 `http` + `scheme: bearer` | `bearer` | `{ token: '' }` |
| OA3 `http` + `scheme: basic`, or Swagger2 `basic` | `basic` | `{ username: '', password: '' }` |
| OA3/Swagger2 `apiKey` | `apikey` | `{ key: def.name, value: '', in: def.in }` |
| `oauth2` / `openIdConnect` | `none` | `{}` |
| no security requirement | `none` | `{}` |

## `$ref` resolver + schema-stub generator

**`resolveRef(root, ref)`:** splits `ref` (e.g. `"#/components/schemas/User"`) on `/`, drops the leading `#`, walks the remaining segments against `root`.

**`stubFromSchema(schema, root, seen = new Set())`:**
- `$ref` → resolve via `resolveRef`; if already in `seen` (cycle), return `null`; else add to `seen` and recurse.
- `type: 'object'` → object with one key per entry in `properties`, each stubbed recursively (both required and optional properties included).
- `type: 'array'` → single-element array, item stubbed from `items`.
- `type: 'string'` → `example`/`default` if present, else `enum[0]` if present, else `""`.
- `type: 'integer' | 'number'` → `example`/`default` if present, else `0`.
- `type: 'boolean'` → `example`/`default` if present, else `false`.
- missing/unrecognized `type` → `null`.

---

## YAML handling

Add `js-yaml` to `server/package.json`. In the route handler, `JSON.parse` is tried first; on failure `yaml.load` is tried; if both fail, respond 400.

---

## Error Handling

| Scenario | HTTP | Message |
|---|---|---|
| Neither valid JSON nor YAML | 400 | `"Invalid JSON or YAML"` |
| No recognized `info.schema` / `openapi` / `swagger` key | 400 | `"Unrecognized file format"` |
| OpenAPI/Swagger doc has no operations under `paths` | 400 | `"Specification has no operations"` |
| SQLite failure | 500 | `"Import failed"` (unchanged) |

Errors surface the same way as Postman import errors: inline message under the Import button in the sidebar.

---

## Files Changed

| File | Change |
|---|---|
| `server/package.json` | add `js-yaml` dependency |
| `server/src/routes/projects.js` | add format detection dispatch, `parseOpenApiSpec`, `parseSwaggerV2Spec`, `resolveRef`, `stubFromSchema` |
| `docs/superpowers/specs/2026-07-01-openapi-import-design.md` | this spec |

No client changes — the existing Import button and `importCollection()` already accept any file and relay whatever error the server returns.

---

## Out of Scope

- External/remote `$ref` (URLs or other files) — refs must resolve within the same document
- `oauth2` / `openIdConnect` auth — falls back to `auth_type: 'none'`
- YAML anchors/aliases beyond what `js-yaml` resolves by default
- Multiple servers / a server-selection UI — always uses `servers[0]` (OA3) or `schemes[0]+host+basePath` (Swagger 2.0)
- Response schema import — requestme has no concept of expected responses
- OA3 `callbacks`, `webhooks`, `links`
