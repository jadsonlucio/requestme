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
