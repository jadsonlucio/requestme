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
