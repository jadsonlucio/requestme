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
