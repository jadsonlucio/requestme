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
