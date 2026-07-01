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
