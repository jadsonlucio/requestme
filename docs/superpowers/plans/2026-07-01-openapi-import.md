# OpenAPI / Swagger 2.0 Import Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extend `POST /api/projects/import` so it also accepts OpenAPI 3.x and Swagger 2.0 specs (JSON or YAML), in addition to the Postman collections it already handles.

**Architecture:** The route delegates all parsing to a new `server/src/parsers/` module. `parseImportFile(buffer)` parses JSON-or-YAML then dispatches by document shape to one of three format parsers (`parsePostmanCollection` — moved unchanged, `parseOpenApiSpec`, `parseSwaggerV2Spec`), all returning the same `{ projectName, requests, variables }` shape the route already inserts into SQLite. The two new parsers share a generic `$ref` resolver and JSON-schema stub generator.

**Tech Stack:** Node.js (CommonJS), Express, `better-sqlite3`, `multer` (existing); adding `js-yaml` (new) and Node's built-in `node:test`/`node:assert` runner (no new test dependency).

## Global Constraints

- Spec versions supported: OpenAPI `3.0.x`/`3.1.x` (top-level `openapi` field starting with `"3."`) and Swagger `2.0` (top-level `swagger === "2.0"`). No other versions.
- File is parsed as JSON first; on failure, as YAML via `js-yaml`. If both fail, reject.
- `$ref` resolution is same-document only (JSON pointer against the root document) — no external files or URLs.
- `oauth2` and `openIdConnect` security schemes always map to `auth_type: 'none'`, `auth_config: {}`.
- Every parser returns exactly: `{ projectName: string, requests: Array<{ name, method, url, headers: Array<{key,value,enabled}>, body_type, body, auth_type, auth_config }>, variables: Array<{ key, value }> }`.
- Exact error messages (all HTTP 400 unless noted):
  - `"Invalid JSON or YAML"` — file is neither valid JSON nor valid YAML
  - `"Unrecognized file format"` — parsed but matches none of the three known shapes
  - `"Not an OpenAPI 3.x document"` — thrown by `parseOpenApiSpec` if called on a non-matching doc directly
  - `"Not a Swagger 2.0 document"` — thrown by `parseSwaggerV2Spec` if called on a non-matching doc directly
  - `"Specification has no operations"` — OpenAPI/Swagger doc has zero operations under `paths`
  - `"Import failed"` (HTTP 500) — SQLite transaction failure (existing, unchanged)
- No client-side changes — the existing Import button and `importCollection()` in `client/src/api/projects.js` already POST any file and relay whatever error string the server returns.

---

### Task 1: Extract the Postman parser into its own module (behavior-preserving)

**Files:**
- Create: `server/src/parsers/postmanParser.js`
- Modify: `server/src/routes/projects.js`
- Modify: `server/package.json` (add `test` script)
- Test: `server/src/parsers/postmanParser.test.js`

**Interfaces:**
- Produces: `parsePostmanCollection(json) -> { projectName, requests, variables }` — identical behavior to the current inline implementation in `projects.js`. Later tasks' `importFile.js` dispatcher will `require('./postmanParser')`.

- [ ] **Step 1: Add a test runner script**

In `server/package.json`, add to `"scripts"`:

```json
"test": "node --test src/"
```

- [ ] **Step 2: Write the failing test**

Create `server/src/parsers/postmanParser.test.js`:

```js
const test = require('node:test');
const assert = require('node:assert/strict');
const { parsePostmanCollection } = require('./postmanParser');

const collection = {
  info: {
    name: 'My Collection',
    schema: 'https://schema.getpostman.com/json/collection/v2.1.0/collection.json',
  },
  item: [
    {
      name: 'Auth',
      item: [
        {
          name: 'Login',
          request: {
            method: 'POST',
            url: 'https://example.com/login',
            header: [{ key: 'X-Test', value: '1', disabled: false }],
            body: { mode: 'raw', options: { raw: { language: 'json' } }, raw: '{}' },
            auth: { type: 'bearer', bearer: [{ key: 'token', value: 'abc' }] },
          },
        },
      ],
    },
  ],
  variable: [{ key: 'baseUrl', value: 'https://example.com' }],
};

test('parsePostmanCollection maps a nested folder request with bearer auth', () => {
  const result = parsePostmanCollection(collection);
  assert.equal(result.projectName, 'My Collection');
  assert.equal(result.requests.length, 1);
  const req = result.requests[0];
  assert.equal(req.name, 'Auth / Login');
  assert.equal(req.method, 'POST');
  assert.equal(req.body_type, 'json');
  assert.equal(req.auth_type, 'bearer');
  assert.deepEqual(req.auth_config, { token: 'abc' });
  assert.deepEqual(result.variables, [{ key: 'baseUrl', value: 'https://example.com' }]);
});

test('parsePostmanCollection rejects a non-Postman document', () => {
  assert.throws(() => parsePostmanCollection({ info: {} }), /Not a Postman collection/);
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `cd server && node --test src/parsers/postmanParser.test.js`
Expected: FAIL with `Cannot find module './postmanParser'`

- [ ] **Step 4: Create the module by moving the existing logic verbatim**

Create `server/src/parsers/postmanParser.js` with exactly the current `extractRequests`/`parsePostmanCollection` logic from `server/src/routes/projects.js` (lines 12–96), unchanged:

```js
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
      .map(h => ({ key: h.key, value: h.value, enabled: !h.disabled }));

    let body_type = 'none';
    let body = '';
    if (req.body) {
      if (req.body.mode === 'raw') {
        const lang = req.body.options?.raw?.language;
        body_type = lang === 'json' ? 'json' : 'raw';
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
          in: (a.apikey || []).find(p => p.key === 'in')?.value || 'header',
        };
      }
    }

    return { name, method, url, headers, body_type, body, auth_type, auth_config };
  });

  const variables = (json.variable || []).map(v => ({ key: v.key, value: v.value || '' }));

  const projectName = json.info.name || 'Imported Collection';

  return { projectName, requests, variables };
}

module.exports = { parsePostmanCollection, extractRequests };
```

- [ ] **Step 5: Run test to verify it passes**

Run: `cd server && node --test src/parsers/postmanParser.test.js`
Expected: PASS (2 tests)

- [ ] **Step 6: Update `projects.js` to use the extracted module**

In `server/src/routes/projects.js`, delete the `extractRequests` and `parsePostmanCollection` function definitions and the `// --- Postman collection parser ---` comment block (current lines 8–96), and add near the top requires:

```js
const { parsePostmanCollection } = require('../parsers/postmanParser');
```

Leave the route handler's use of `parsePostmanCollection(json)` exactly as-is — this task changes only where the function comes from, not route behavior.

- [ ] **Step 7: Smoke-check the route module still loads cleanly**

Run: `cd server && node -e "require('./src/routes/projects.js'); console.log('ok')"`
Expected: prints `ok` with no errors (confirms the new `require` path resolves and no leftover reference to the deleted functions remains)

- [ ] **Step 8: Commit**

```bash
git add server/package.json server/src/parsers/postmanParser.js server/src/parsers/postmanParser.test.js server/src/routes/projects.js
git commit -m "refactor: extract Postman collection parser into its own module"
```

---

### Task 2: Shared spec-parsing helpers (`$ref` resolver, schema-stub generator, parameter merger)

**Files:**
- Create: `server/src/parsers/specUtils.js`
- Test: `server/src/parsers/specUtils.test.js`

**Interfaces:**
- Produces: `resolveRef(root, ref) -> any`, `stubFromSchema(schema, root, seen?) -> any`, `mergeParameters(pathLevelParams, operationParams) -> array`, `buildName(tags, summary, operationId, method, path) -> string`, and `resolveEffectiveSecurity(operation, document) -> string|null` — all consumed by `openApiParser.js` (Task 3) and `swaggerV2Parser.js` (Task 4). All five live here because OpenAPI 3.x and Swagger 2.0 share the identical `paths → path → method → operation` shape and the identical `security: [{ schemeName: [] }]` requirement-object format, so parameter merging, name-building, and security-requirement resolution are the same logic for both formats — only how a resolved scheme *name* maps to `auth_type`/`auth_config` differs per format (that stays in each parser).

- [ ] **Step 1: Write the failing tests**

Create `server/src/parsers/specUtils.test.js`:

```js
const test = require('node:test');
const assert = require('node:assert/strict');
const { resolveRef, stubFromSchema, mergeParameters, buildName, resolveEffectiveSecurity } = require('./specUtils');

test('resolveRef walks a JSON pointer against the root document (OpenAPI style)', () => {
  const root = { components: { schemas: { User: { type: 'object' } } } };
  assert.deepEqual(resolveRef(root, '#/components/schemas/User'), { type: 'object' });
});

test('resolveRef also resolves Swagger 2.0 style definitions pointers', () => {
  const root = { definitions: { User: { type: 'string' } } };
  assert.deepEqual(resolveRef(root, '#/definitions/User'), { type: 'string' });
});

test('resolveRef throws when a path segment is missing', () => {
  assert.throws(() => resolveRef({}, '#/components/schemas/User'), /Cannot resolve \$ref/);
});

test('stubFromSchema builds a placeholder object from an inline schema', () => {
  const schema = {
    type: 'object',
    properties: {
      name: { type: 'string' },
      age: { type: 'integer' },
      active: { type: 'boolean' },
    },
  };
  assert.deepEqual(stubFromSchema(schema, {}), { name: '', age: 0, active: false });
});

test('stubFromSchema resolves a $ref before stubbing', () => {
  const root = {
    components: { schemas: { User: { type: 'object', properties: { id: { type: 'integer' } } } } },
  };
  assert.deepEqual(stubFromSchema({ $ref: '#/components/schemas/User' }, root), { id: 0 });
});

test('stubFromSchema prefers example, then default, then enum[0], then a type default', () => {
  assert.equal(stubFromSchema({ type: 'string', example: 'hi' }, {}), 'hi');
  assert.equal(stubFromSchema({ type: 'string', default: 'yo' }, {}), 'yo');
  assert.equal(stubFromSchema({ type: 'string', enum: ['a', 'b'] }, {}), 'a');
  assert.equal(stubFromSchema({ type: 'string' }, {}), '');
  assert.equal(stubFromSchema({ type: 'integer', default: 7 }, {}), 7);
  assert.equal(stubFromSchema({ type: 'integer' }, {}), 0);
  assert.equal(stubFromSchema({ type: 'boolean', default: true }, {}), true);
  assert.equal(stubFromSchema({ type: 'boolean' }, {}), false);
});

test('stubFromSchema builds a single-element array from items', () => {
  assert.deepEqual(stubFromSchema({ type: 'array', items: { type: 'string' } }, {}), ['']);
});

test('stubFromSchema returns null instead of looping on a cyclic $ref', () => {
  const root = {
    components: {
      schemas: {
        Node: {
          type: 'object',
          properties: { child: { $ref: '#/components/schemas/Node' } },
        },
      },
    },
  };
  const result = stubFromSchema({ $ref: '#/components/schemas/Node' }, root);
  assert.deepEqual(result, { child: null });
});

test('stubFromSchema returns null for a missing schema', () => {
  assert.equal(stubFromSchema(undefined, {}), null);
});

test('mergeParameters keeps path-level parameters and lets operation-level parameters override by in+name', () => {
  const pathLevel = [
    { name: 'petId', in: 'path', schema: { type: 'string' } },
    { name: 'verbose', in: 'query', schema: { default: false } },
  ];
  const operationLevel = [{ name: 'verbose', in: 'query', schema: { default: true } }];
  const merged = mergeParameters(pathLevel, operationLevel);
  assert.equal(merged.length, 2);
  const verbose = merged.find((p) => p.in === 'query' && p.name === 'verbose');
  assert.equal(verbose.schema.default, true);
});

test('buildName prefixes with the first tag when tags are present', () => {
  assert.equal(buildName(['Pets'], 'Get a pet', undefined, 'get', '/pets/{petId}'), 'Pets / Get a pet');
});

test('buildName omits the prefix and falls back through summary, operationId, then METHOD path', () => {
  assert.equal(buildName([], 'Get a pet', undefined, 'get', '/pets/{petId}'), 'Get a pet');
  assert.equal(buildName(undefined, undefined, 'getPet', 'get', '/pets/{petId}'), 'getPet');
  assert.equal(buildName(undefined, undefined, undefined, 'get', '/pets/{petId}'), 'GET /pets/{petId}');
});

test('resolveEffectiveSecurity prefers operation-level security over document-level', () => {
  const operation = { security: [{ apiKeyAuth: [] }] };
  const document = { security: [{ bearerAuth: [] }] };
  assert.equal(resolveEffectiveSecurity(operation, document), 'apiKeyAuth');
});

test('resolveEffectiveSecurity falls back to document-level security, then null', () => {
  assert.equal(resolveEffectiveSecurity({}, { security: [{ bearerAuth: [] }] }), 'bearerAuth');
  assert.equal(resolveEffectiveSecurity({ security: [] }, { security: [{ bearerAuth: [] }] }), null);
  assert.equal(resolveEffectiveSecurity({}, {}), null);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd server && node --test src/parsers/specUtils.test.js`
Expected: FAIL with `Cannot find module './specUtils'`

- [ ] **Step 3: Write the implementation**

Create `server/src/parsers/specUtils.js`:

```js
function resolveRef(root, ref) {
  const path = ref.replace(/^#\//, '').split('/');
  let node = root;
  for (const segment of path) {
    node = node[segment];
    if (node === undefined) {
      throw new Error(`Cannot resolve $ref: ${ref}`);
    }
  }
  return node;
}

function stubFromSchema(schema, root, seen = new Set()) {
  if (!schema) return null;

  if (schema.$ref) {
    if (seen.has(schema.$ref)) return null;
    const nextSeen = new Set(seen);
    nextSeen.add(schema.$ref);
    return stubFromSchema(resolveRef(root, schema.$ref), root, nextSeen);
  }

  if (schema.type === 'object' || schema.properties) {
    const out = {};
    for (const [key, propSchema] of Object.entries(schema.properties || {})) {
      out[key] = stubFromSchema(propSchema, root, seen);
    }
    return out;
  }

  if (schema.type === 'array') {
    return [stubFromSchema(schema.items, root, seen)];
  }

  if (schema.type === 'string') {
    if (schema.example !== undefined) return schema.example;
    if (schema.default !== undefined) return schema.default;
    if (Array.isArray(schema.enum) && schema.enum.length > 0) return schema.enum[0];
    return '';
  }

  if (schema.type === 'integer' || schema.type === 'number') {
    if (schema.example !== undefined) return schema.example;
    if (schema.default !== undefined) return schema.default;
    return 0;
  }

  if (schema.type === 'boolean') {
    if (schema.example !== undefined) return schema.example;
    if (schema.default !== undefined) return schema.default;
    return false;
  }

  return null;
}

function mergeParameters(pathLevelParams, operationParams) {
  const merged = new Map();
  for (const p of pathLevelParams) merged.set(`${p.in}:${p.name}`, p);
  for (const p of operationParams) merged.set(`${p.in}:${p.name}`, p);
  return Array.from(merged.values());
}

function buildName(tags, summary, operationId, method, path) {
  const label = summary || operationId || `${method.toUpperCase()} ${path}`;
  if (tags && tags.length > 0) return `${tags[0]} / ${label}`;
  return label;
}

function resolveEffectiveSecurity(operation, document) {
  const security = operation.security ?? document.security ?? [];
  if (security.length === 0) return null;
  const names = Object.keys(security[0]);
  return names[0] || null;
}

module.exports = { resolveRef, stubFromSchema, mergeParameters, buildName, resolveEffectiveSecurity };
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd server && node --test src/parsers/specUtils.test.js`
Expected: PASS (14 tests)

- [ ] **Step 5: Commit**

```bash
git add server/src/parsers/specUtils.js server/src/parsers/specUtils.test.js
git commit -m "feat: add shared spec-parsing helpers (\$ref resolver, schema stub generator, parameter merger)"
```

---

### Task 3: OpenAPI 3.x parser

**Files:**
- Create: `server/src/parsers/openApiParser.js`
- Test: `server/src/parsers/openApiParser.test.js`

**Interfaces:**
- Consumes: `stubFromSchema(schema, root)`, `mergeParameters(pathLevelParams, operationParams)`, `buildName(tags, summary, operationId, method, path)`, and `resolveEffectiveSecurity(operation, document)` from `./specUtils` (Task 2).
- Produces: `parseOpenApiSpec(document) -> { projectName, requests, variables }`, consumed by `importFile.js` (Task 5).

- [ ] **Step 1: Write the failing tests**

Create `server/src/parsers/openApiParser.test.js`:

```js
const test = require('node:test');
const assert = require('node:assert/strict');
const { parseOpenApiSpec } = require('./openApiParser');

const document = {
  openapi: '3.0.3',
  info: { title: 'Pet Store' },
  servers: [{ url: 'https://{env}.example.com/v1', variables: { env: { default: 'api' } } }],
  security: [{ bearerAuth: [] }],
  components: {
    securitySchemes: {
      bearerAuth: { type: 'http', scheme: 'bearer' },
      apiKeyAuth: { type: 'apiKey', name: 'X-API-Key', in: 'header' },
    },
    schemas: {
      Pet: { type: 'object', properties: { name: { type: 'string' }, age: { type: 'integer' } } },
    },
  },
  paths: {
    '/pets/{petId}': {
      parameters: [{ name: 'petId', in: 'path', required: true, schema: { type: 'string' } }],
      get: {
        tags: ['Pets'],
        summary: 'Get a pet',
        parameters: [{ name: 'verbose', in: 'query', schema: { type: 'boolean', default: false } }],
      },
      put: {
        tags: ['Pets'],
        summary: 'Update a pet',
        security: [{ apiKeyAuth: [] }],
        requestBody: {
          content: { 'application/json': { schema: { $ref: '#/components/schemas/Pet' } } },
        },
      },
    },
    '/pets': {
      post: {
        summary: 'Create a pet',
        requestBody: {
          content: { 'application/json': { schema: { $ref: '#/components/schemas/Pet' } } },
        },
      },
    },
  },
};

test('parseOpenApiSpec resolves a templated server URL into a baseUrl variable', () => {
  const result = parseOpenApiSpec(document);
  assert.deepEqual(result.variables, [{ key: 'baseUrl', value: 'https://api.example.com/v1' }]);
  assert.equal(result.projectName, 'Pet Store');
  assert.equal(result.requests.length, 3);
});

test('parseOpenApiSpec builds a tag-prefixed name and query param, falling back to global security', () => {
  const result = parseOpenApiSpec(document);
  const getPet = result.requests.find((r) => r.method === 'GET');
  assert.equal(getPet.name, 'Pets / Get a pet');
  assert.equal(getPet.url, '{{baseUrl}}/pets/{petId}?verbose=false');
  assert.equal(getPet.auth_type, 'bearer');
  assert.deepEqual(getPet.auth_config, { token: '' });
});

test('parseOpenApiSpec generates a JSON body stub from a $ref schema and honors an operation-level security override', () => {
  const result = parseOpenApiSpec(document);
  const putPet = result.requests.find((r) => r.method === 'PUT');
  assert.equal(putPet.body_type, 'json');
  assert.deepEqual(JSON.parse(putPet.body), { name: '', age: 0 });
  assert.equal(putPet.auth_type, 'apikey');
  assert.deepEqual(putPet.auth_config, { key: 'X-API-Key', value: '', in: 'header' });
});

test('parseOpenApiSpec omits the tag prefix when an operation has no tags', () => {
  const result = parseOpenApiSpec(document);
  const createPet = result.requests.find((r) => r.method === 'POST');
  assert.equal(createPet.name, 'Create a pet');
  assert.equal(createPet.url, '{{baseUrl}}/pets');
});

test('parseOpenApiSpec rejects a document without an openapi 3.x field', () => {
  assert.throws(() => parseOpenApiSpec({ paths: {} }), /Not an OpenAPI 3\.x document/);
});

test('parseOpenApiSpec rejects a document with no operations', () => {
  assert.throws(() => parseOpenApiSpec({ openapi: '3.0.3', paths: {} }), /Specification has no operations/);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd server && node --test src/parsers/openApiParser.test.js`
Expected: FAIL with `Cannot find module './openApiParser'`

- [ ] **Step 3: Write the implementation**

Create `server/src/parsers/openApiParser.js`:

```js
const { stubFromSchema, mergeParameters, buildName, resolveEffectiveSecurity } = require('./specUtils');

const HTTP_METHODS = ['get', 'put', 'post', 'delete', 'options', 'head', 'patch'];

function resolveServerUrl(server) {
  if (!server) return '';
  let url = server.url || '';
  for (const [name, variable] of Object.entries(server.variables || {})) {
    url = url.split(`{${name}}`).join(variable.default ?? '');
  }
  return url;
}

function mapParameters(params) {
  const query = [];
  const headers = [];
  for (const param of params) {
    if (param.in === 'query') {
      const value = param.schema?.default ?? `{${param.name}}`;
      query.push(`${param.name}=${value}`);
    } else if (param.in === 'header') {
      headers.push({ key: param.name, value: param.schema?.default ?? '', enabled: true });
    }
  }
  return { query, headers };
}

function mapRequestBody(requestBody, document) {
  if (!requestBody || !requestBody.content) return { body_type: 'none', body: '' };
  const content = requestBody.content;
  if (content['application/json']) {
    const stub = stubFromSchema(content['application/json'].schema, document);
    return { body_type: 'json', body: JSON.stringify(stub, null, 2) };
  }
  if (content['application/x-www-form-urlencoded'] || content['multipart/form-data']) {
    const formContent = content['application/x-www-form-urlencoded'] || content['multipart/form-data'];
    const props = formContent.schema?.properties || {};
    const rows = Object.keys(props).map((key) => ({ key, value: '', enabled: true }));
    return { body_type: 'form', body: JSON.stringify(rows) };
  }
  const firstType = Object.keys(content)[0];
  if (firstType) return { body_type: 'raw', body: '' };
  return { body_type: 'none', body: '' };
}

function mapSecurityScheme(schemeName, securitySchemes) {
  if (!schemeName) return { auth_type: 'none', auth_config: {} };
  const scheme = securitySchemes[schemeName];
  if (!scheme) return { auth_type: 'none', auth_config: {} };
  if (scheme.type === 'http' && scheme.scheme === 'bearer') {
    return { auth_type: 'bearer', auth_config: { token: '' } };
  }
  if (scheme.type === 'http' && scheme.scheme === 'basic') {
    return { auth_type: 'basic', auth_config: { username: '', password: '' } };
  }
  if (scheme.type === 'apiKey') {
    return { auth_type: 'apikey', auth_config: { key: scheme.name || '', value: '', in: scheme.in || 'header' } };
  }
  return { auth_type: 'none', auth_config: {} };
}

function parseOpenApiSpec(document) {
  if (!document.openapi || !document.openapi.startsWith('3.')) {
    const err = new Error('Not an OpenAPI 3.x document');
    err.status = 400;
    throw err;
  }

  const paths = document.paths || {};
  const securitySchemes = document.components?.securitySchemes || {};
  const baseUrl = resolveServerUrl((document.servers || [])[0]);

  const requests = [];
  for (const [pathKey, pathItem] of Object.entries(paths)) {
    const pathLevelParams = pathItem.parameters || [];
    for (const method of HTTP_METHODS) {
      const operation = pathItem[method];
      if (!operation) continue;

      const mergedParams = mergeParameters(pathLevelParams, operation.parameters || []);
      const { query, headers } = mapParameters(mergedParams);

      let url = `{{baseUrl}}${pathKey}`;
      if (query.length > 0) url += `?${query.join('&')}`;

      const { body_type, body } = mapRequestBody(operation.requestBody, document);
      const schemeName = resolveEffectiveSecurity(operation, document);
      const { auth_type, auth_config } = mapSecurityScheme(schemeName, securitySchemes);
      const name = buildName(operation.tags, operation.summary, operation.operationId, method, pathKey);

      requests.push({ name, method: method.toUpperCase(), url, headers, body_type, body, auth_type, auth_config });
    }
  }

  if (requests.length === 0) {
    const err = new Error('Specification has no operations');
    err.status = 400;
    throw err;
  }

  const projectName = document.info?.title || 'Imported OpenAPI Spec';
  const variables = baseUrl ? [{ key: 'baseUrl', value: baseUrl }] : [];
  return { projectName, requests, variables };
}

module.exports = {
  parseOpenApiSpec,
  resolveServerUrl,
  mapParameters,
  mapRequestBody,
  mapSecurityScheme,
};
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd server && node --test src/parsers/openApiParser.test.js`
Expected: PASS (6 tests)

- [ ] **Step 5: Commit**

```bash
git add server/src/parsers/openApiParser.js server/src/parsers/openApiParser.test.js
git commit -m "feat: add OpenAPI 3.x spec parser"
```

---

### Task 4: Swagger 2.0 parser

**Files:**
- Create: `server/src/parsers/swaggerV2Parser.js`
- Test: `server/src/parsers/swaggerV2Parser.test.js`

**Interfaces:**
- Consumes: `stubFromSchema(schema, root)`, `mergeParameters(pathLevelParams, operationParams)`, `buildName(tags, summary, operationId, method, path)`, and `resolveEffectiveSecurity(operation, document)` from `./specUtils` (Task 2).
- Produces: `parseSwaggerV2Spec(document) -> { projectName, requests, variables }`, consumed by `importFile.js` (Task 5).

- [ ] **Step 1: Write the failing tests**

Create `server/src/parsers/swaggerV2Parser.test.js`:

```js
const test = require('node:test');
const assert = require('node:assert/strict');
const { parseSwaggerV2Spec } = require('./swaggerV2Parser');

const document = {
  swagger: '2.0',
  info: { title: 'Pet Store' },
  host: 'api.example.com',
  basePath: '/v1',
  schemes: ['https'],
  consumes: ['application/json'],
  securityDefinitions: {
    apiKeyAuth: { type: 'apiKey', name: 'X-API-Key', in: 'header' },
    basicAuth: { type: 'basic' },
  },
  security: [{ basicAuth: [] }],
  definitions: {
    Pet: { type: 'object', properties: { name: { type: 'string' }, age: { type: 'integer' } } },
  },
  paths: {
    '/pets/{petId}': {
      parameters: [{ name: 'petId', in: 'path', required: true, type: 'string' }],
      get: {
        tags: ['Pets'],
        summary: 'Get a pet',
        parameters: [{ name: 'verbose', in: 'query', type: 'boolean', default: false }],
      },
      put: {
        tags: ['Pets'],
        summary: 'Update a pet',
        security: [{ apiKeyAuth: [] }],
        parameters: [{ name: 'body', in: 'body', schema: { $ref: '#/definitions/Pet' } }],
      },
    },
    '/pets': {
      post: {
        summary: 'Create a pet',
        consumes: ['multipart/form-data'],
        parameters: [{ name: 'name', in: 'formData', type: 'string' }],
      },
    },
  },
};

test('parseSwaggerV2Spec builds baseUrl from host/basePath/schemes', () => {
  const result = parseSwaggerV2Spec(document);
  assert.deepEqual(result.variables, [{ key: 'baseUrl', value: 'https://api.example.com/v1' }]);
  assert.equal(result.projectName, 'Pet Store');
  assert.equal(result.requests.length, 3);
});

test('parseSwaggerV2Spec builds a tag-prefixed name and query param, falling back to global security', () => {
  const result = parseSwaggerV2Spec(document);
  const getPet = result.requests.find((r) => r.method === 'GET');
  assert.equal(getPet.name, 'Pets / Get a pet');
  assert.equal(getPet.url, '{{baseUrl}}/pets/{petId}?verbose=false');
  assert.equal(getPet.auth_type, 'basic');
  assert.deepEqual(getPet.auth_config, { username: '', password: '' });
});

test('parseSwaggerV2Spec generates a JSON body stub from an in:body $ref schema and honors a security override', () => {
  const result = parseSwaggerV2Spec(document);
  const putPet = result.requests.find((r) => r.method === 'PUT');
  assert.equal(putPet.body_type, 'json');
  assert.deepEqual(JSON.parse(putPet.body), { name: '', age: 0 });
  assert.equal(putPet.auth_type, 'apikey');
  assert.deepEqual(putPet.auth_config, { key: 'X-API-Key', value: '', in: 'header' });
});

test('parseSwaggerV2Spec maps formData parameters to a form body when consumes includes a form type', () => {
  const result = parseSwaggerV2Spec(document);
  const createPet = result.requests.find((r) => r.method === 'POST');
  assert.equal(createPet.name, 'Create a pet');
  assert.equal(createPet.body_type, 'form');
  assert.deepEqual(JSON.parse(createPet.body), [{ key: 'name', value: '', enabled: true }]);
});

test('parseSwaggerV2Spec rejects a document without swagger: "2.0"', () => {
  assert.throws(() => parseSwaggerV2Spec({ paths: {} }), /Not a Swagger 2\.0 document/);
});

test('parseSwaggerV2Spec rejects a document with no operations', () => {
  assert.throws(() => parseSwaggerV2Spec({ swagger: '2.0', paths: {} }), /Specification has no operations/);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd server && node --test src/parsers/swaggerV2Parser.test.js`
Expected: FAIL with `Cannot find module './swaggerV2Parser'`

- [ ] **Step 3: Write the implementation**

Create `server/src/parsers/swaggerV2Parser.js`:

```js
const { stubFromSchema, mergeParameters, buildName, resolveEffectiveSecurity } = require('./specUtils');

const HTTP_METHODS = ['get', 'put', 'post', 'delete', 'options', 'head', 'patch'];

function buildBaseUrl(document) {
  const scheme = (document.schemes || [])[0] || 'https';
  const host = document.host || '';
  const basePath = document.basePath || '';
  if (!host) return '';
  return `${scheme}://${host}${basePath}`;
}

function mapNonBodyParameters(params) {
  const query = [];
  const headers = [];
  for (const param of params) {
    if (param.in === 'query') {
      const value = param.default ?? `{${param.name}}`;
      query.push(`${param.name}=${value}`);
    } else if (param.in === 'header') {
      headers.push({ key: param.name, value: param.default ?? '', enabled: true });
    }
  }
  return { query, headers };
}

function mapBody(params, consumes, document) {
  const bodyParam = params.find((p) => p.in === 'body');
  if (bodyParam) {
    const stub = stubFromSchema(bodyParam.schema, document);
    return { body_type: 'json', body: JSON.stringify(stub, null, 2) };
  }
  const formParams = params.filter((p) => p.in === 'formData');
  const consumesForm = (consumes || []).some(
    (type) => type === 'application/x-www-form-urlencoded' || type === 'multipart/form-data'
  );
  if (formParams.length > 0 && consumesForm) {
    const rows = formParams.map((p) => ({ key: p.name, value: '', enabled: true }));
    return { body_type: 'form', body: JSON.stringify(rows) };
  }
  return { body_type: 'none', body: '' };
}

function mapSecurityDefinition(schemeName, securityDefinitions) {
  if (!schemeName) return { auth_type: 'none', auth_config: {} };
  const def = securityDefinitions[schemeName];
  if (!def) return { auth_type: 'none', auth_config: {} };
  if (def.type === 'basic') return { auth_type: 'basic', auth_config: { username: '', password: '' } };
  if (def.type === 'apiKey') {
    return { auth_type: 'apikey', auth_config: { key: def.name || '', value: '', in: def.in || 'header' } };
  }
  return { auth_type: 'none', auth_config: {} };
}

function parseSwaggerV2Spec(document) {
  if (document.swagger !== '2.0') {
    const err = new Error('Not a Swagger 2.0 document');
    err.status = 400;
    throw err;
  }

  const paths = document.paths || {};
  const securityDefinitions = document.securityDefinitions || {};
  const baseUrl = buildBaseUrl(document);

  const requests = [];
  for (const [pathKey, pathItem] of Object.entries(paths)) {
    const pathLevelParams = pathItem.parameters || [];
    for (const method of HTTP_METHODS) {
      const operation = pathItem[method];
      if (!operation) continue;

      const mergedParams = mergeParameters(pathLevelParams, operation.parameters || []);
      const { query, headers } = mapNonBodyParameters(mergedParams);
      const consumes = operation.consumes || document.consumes || [];
      const { body_type, body } = mapBody(mergedParams, consumes, document);

      let url = `{{baseUrl}}${pathKey}`;
      if (query.length > 0) url += `?${query.join('&')}`;

      const schemeName = resolveEffectiveSecurity(operation, document);
      const { auth_type, auth_config } = mapSecurityDefinition(schemeName, securityDefinitions);
      const name = buildName(operation.tags, operation.summary, operation.operationId, method, pathKey);

      requests.push({ name, method: method.toUpperCase(), url, headers, body_type, body, auth_type, auth_config });
    }
  }

  if (requests.length === 0) {
    const err = new Error('Specification has no operations');
    err.status = 400;
    throw err;
  }

  const projectName = document.info?.title || 'Imported Swagger Spec';
  const variables = baseUrl ? [{ key: 'baseUrl', value: baseUrl }] : [];
  return { projectName, requests, variables };
}

module.exports = {
  parseSwaggerV2Spec,
  buildBaseUrl,
  mapNonBodyParameters,
  mapBody,
  mapSecurityDefinition,
};
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd server && node --test src/parsers/swaggerV2Parser.test.js`
Expected: PASS (6 tests)

- [ ] **Step 5: Commit**

```bash
git add server/src/parsers/swaggerV2Parser.js server/src/parsers/swaggerV2Parser.test.js
git commit -m "feat: add Swagger 2.0 spec parser"
```

---

### Task 5: Format-detection dispatcher with YAML support

**Files:**
- Create: `server/src/parsers/importFile.js`
- Modify: `server/package.json` (add `js-yaml` dependency)
- Test: `server/src/parsers/importFile.test.js`

**Interfaces:**
- Consumes: `parsePostmanCollection` (Task 1), `parseOpenApiSpec` (Task 3), `parseSwaggerV2Spec` (Task 4).
- Produces: `parseImportFile(buffer) -> { projectName, requests, variables }`, consumed by the route in Task 6.

- [ ] **Step 1: Add the `js-yaml` dependency**

Run: `cd server && npm install js-yaml`
Expected: `server/package.json` dependencies gain `"js-yaml": "^4.x.x"`, and `server/package-lock.json` updates.

- [ ] **Step 2: Write the failing tests**

Create `server/src/parsers/importFile.test.js`:

```js
const test = require('node:test');
const assert = require('node:assert/strict');
const { parseImportFile } = require('./importFile');

test('parseImportFile detects and parses a Postman collection', () => {
  const doc = {
    info: { name: 'My Collection', schema: 'https://schema.getpostman.com/json/collection/v2.1.0/collection.json' },
    item: [{ name: 'Ping', request: { method: 'GET', url: 'https://example.com/ping' } }],
  };
  const result = parseImportFile(Buffer.from(JSON.stringify(doc)));
  assert.equal(result.projectName, 'My Collection');
  assert.equal(result.requests.length, 1);
});

test('parseImportFile detects and parses an OpenAPI 3.x document', () => {
  const doc = {
    openapi: '3.0.3',
    info: { title: 'Pet Store' },
    paths: { '/pets': { get: { summary: 'List pets' } } },
  };
  const result = parseImportFile(Buffer.from(JSON.stringify(doc)));
  assert.equal(result.projectName, 'Pet Store');
});

test('parseImportFile detects and parses a Swagger 2.0 document', () => {
  const doc = {
    swagger: '2.0',
    info: { title: 'Legacy API' },
    host: 'api.example.com',
    paths: { '/ping': { get: { summary: 'Ping' } } },
  };
  const result = parseImportFile(Buffer.from(JSON.stringify(doc)));
  assert.equal(result.projectName, 'Legacy API');
});

test('parseImportFile falls back to YAML when the file is not valid JSON', () => {
  const yamlDoc = [
    'openapi: 3.0.3',
    'info:',
    '  title: Pet Store',
    'paths:',
    '  /pets:',
    '    get:',
    '      summary: List pets',
    '',
  ].join('\n');
  const result = parseImportFile(Buffer.from(yamlDoc));
  assert.equal(result.projectName, 'Pet Store');
});

test('parseImportFile rejects an unrecognized document shape', () => {
  assert.throws(
    () => parseImportFile(Buffer.from(JSON.stringify({ foo: 'bar' }))),
    (err) => err.message === 'Unrecognized file format' && err.status === 400
  );
});

test('parseImportFile rejects content that is neither valid JSON nor YAML', () => {
  assert.throws(
    () => parseImportFile(Buffer.from('\tinvalid: [unclosed')),
    (err) => err.message === 'Invalid JSON or YAML' && err.status === 400
  );
});
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `cd server && node --test src/parsers/importFile.test.js`
Expected: FAIL with `Cannot find module './importFile'`

- [ ] **Step 4: Write the implementation**

Create `server/src/parsers/importFile.js`:

```js
const yaml = require('js-yaml');
const { parsePostmanCollection } = require('./postmanParser');
const { parseOpenApiSpec } = require('./openApiParser');
const { parseSwaggerV2Spec } = require('./swaggerV2Parser');

function parseFileBuffer(buffer) {
  const text = buffer.toString('utf8');
  try {
    return JSON.parse(text);
  } catch {
    try {
      return yaml.load(text);
    } catch {
      const err = new Error('Invalid JSON or YAML');
      err.status = 400;
      throw err;
    }
  }
}

function parseImportFile(buffer) {
  const document = parseFileBuffer(buffer);

  if (document && document.info && document.info.schema && document.info.schema.includes('collection/v2')) {
    return parsePostmanCollection(document);
  }
  if (document && typeof document.openapi === 'string' && document.openapi.startsWith('3.')) {
    return parseOpenApiSpec(document);
  }
  if (document && document.swagger === '2.0') {
    return parseSwaggerV2Spec(document);
  }

  const err = new Error('Unrecognized file format');
  err.status = 400;
  throw err;
}

module.exports = { parseImportFile, parseFileBuffer };
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd server && node --test src/parsers/importFile.test.js`
Expected: PASS (6 tests)

- [ ] **Step 6: Commit**

```bash
git add server/package.json server/package-lock.json server/src/parsers/importFile.js server/src/parsers/importFile.test.js
git commit -m "feat: add JSON/YAML format-detection dispatcher for project import"
```

---

### Task 6: Wire the dispatcher into the import route

**Files:**
- Modify: `server/src/routes/projects.js`

**Interfaces:**
- Consumes: `parseImportFile(buffer)` from `../parsers/importFile` (Task 5).

- [ ] **Step 1: Run the full test suite to confirm the baseline is green**

Run: `cd server && npm test`
Expected: PASS (all tests across `postmanParser`, `specUtils`, `openApiParser`, `swaggerV2Parser`, `importFile`)

- [ ] **Step 2: Replace the inline JSON parsing + Postman-only call in the route**

In `server/src/routes/projects.js`, change the top of the `router.post('/projects/import', ...)` handler from:

```js
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
```

to:

```js
  let parsed;
  try {
    parsed = parseImportFile(req.file.buffer);
  } catch (e) {
    return res.status(e.status || 400).json({ error: e.message });
  }
```

Then update the require at the top of the file from `const { parsePostmanCollection } = require('../parsers/postmanParser');` to:

```js
const { parseImportFile } = require('../parsers/importFile');
```

(`parsePostmanCollection` is no longer referenced directly in this file — it's used internally by `importFile.js`.)

- [ ] **Step 3: Smoke-check the route module still loads cleanly**

Run: `cd server && node -e "require('./src/routes/projects.js'); console.log('ok')"`
Expected: prints `ok` with no errors

- [ ] **Step 4: Re-run the full test suite**

Run: `cd server && npm test`
Expected: PASS (unchanged — this task only rewires the route, which has no automated coverage of its own since the project has no HTTP-level test setup; parser correctness is already covered by Tasks 1–5)

- [ ] **Step 5: Commit**

```bash
git add server/src/routes/projects.js
git commit -m "feat: dispatch project import to Postman/OpenAPI/Swagger parsers by format"
```

- [ ] **Step 6 (optional, needs your confirmation before running): manual end-to-end check**

This exercises the real HTTP route end-to-end, but — as with the Sidebar import-button fix earlier in this project — `server/data/requestme.db` is hardcoded with no test-mode override, so running the dev server and importing a file creates a real project in your local database (delete it afterward via the UI/`DELETE /api/projects/:id` to clean up). Skip this step if you'd rather rely on the unit test suite alone.

If you do want to run it:
```bash
npm run dev --prefix server   # in one terminal
curl -F "file=@OnSwitchJava.postman_collection.json" http://localhost:3001/api/projects/import   # Postman regression check
```

---

## Out of Scope (carried over from the design spec)

- External/remote `$ref` (URLs or other files)
- `oauth2` / `openIdConnect` auth — falls back to `auth_type: 'none'`
- YAML anchors/aliases beyond what `js-yaml` resolves by default
- Multiple servers / a server-selection UI
- Response schema import
- OA3 `callbacks`, `webhooks`, `links`
- Client-side changes of any kind
