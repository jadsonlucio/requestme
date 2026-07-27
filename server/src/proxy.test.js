const test = require('node:test');
const assert = require('node:assert/strict');
const { buildFetchArgs } = require('./proxy');

test('form body with only text rows is sent as urlencoded (unchanged behavior)', () => {
  const config = {
    method: 'POST',
    url: 'https://example.com',
    body_type: 'form',
    body: JSON.stringify([
      { key: 'name', value: 'Ada', enabled: true, type: 'text' },
      { key: 'skip', value: 'nope', enabled: false, type: 'text' },
    ]),
  };

  const { fetchOptions } = buildFetchArgs(config);

  assert.equal(fetchOptions.headers['Content-Type'], 'application/x-www-form-urlencoded');
  assert.equal(fetchOptions.body, 'name=Ada');
});

test('form body with a file row is sent as multipart/form-data', async () => {
  const config = {
    method: 'POST',
    url: 'https://example.com',
    body_type: 'form',
    body: JSON.stringify([
      {
        key: 'avatar',
        value: Buffer.from('hello').toString('base64'),
        enabled: true,
        type: 'file',
        fileName: 'hi.txt',
        mimeType: 'text/plain',
      },
    ]),
  };

  const { fetchOptions } = buildFetchArgs(config);

  assert.ok(fetchOptions.body instanceof FormData);
  assert.equal(fetchOptions.headers['Content-Type'], undefined);

  const file = fetchOptions.body.get('avatar');
  assert.equal(file.name, 'hi.txt');
  assert.equal(file.type, 'text/plain');
  assert.equal(await file.text(), 'hello');
});

test('form body mixing text and file rows sends both as multipart/form-data, excluding disabled rows', async () => {
  const config = {
    method: 'POST',
    url: 'https://example.com',
    body_type: 'form',
    body: JSON.stringify([
      { key: 'title', value: 'My Upload', enabled: true, type: 'text' },
      {
        key: 'avatar',
        value: Buffer.from('hello').toString('base64'),
        enabled: true,
        type: 'file',
        fileName: 'hi.txt',
        mimeType: 'text/plain',
      },
      { key: 'ignored', value: 'x', enabled: false, type: 'text' },
    ]),
  };

  const { fetchOptions } = buildFetchArgs(config);

  assert.ok(fetchOptions.body instanceof FormData);
  assert.equal(fetchOptions.body.get('title'), 'My Upload');
  assert.equal(fetchOptions.body.get('ignored'), null);

  const file = fetchOptions.body.get('avatar');
  assert.equal(await file.text(), 'hello');
});

test('form body with file row removes Content-Type header regardless of casing', async () => {
  const config = {
    method: 'POST',
    url: 'https://example.com',
    headers: [
      { key: 'content-type', value: 'text/plain', enabled: true },
    ],
    body_type: 'form',
    body: JSON.stringify([
      {
        key: 'avatar',
        value: Buffer.from('hello').toString('base64'),
        enabled: true,
        type: 'file',
        fileName: 'hi.txt',
        mimeType: 'text/plain',
      },
    ]),
  };

  const { fetchOptions } = buildFetchArgs(config);

  assert.ok(fetchOptions.body instanceof FormData);
  // Verify no Content-Type header exists, regardless of casing
  assert.equal(
    Object.keys(fetchOptions.headers).some(k => k.toLowerCase() === 'content-type'),
    false,
    'Content-Type header should be removed (case-insensitive)'
  );
});
