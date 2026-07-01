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
