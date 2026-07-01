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
