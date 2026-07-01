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
