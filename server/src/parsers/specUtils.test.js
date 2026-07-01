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
