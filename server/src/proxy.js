const express = require('express');
const router = express.Router();
const { Readable } = require('stream');

function substituteVariables(str, variables) {
  if (!str) return str;
  return str.replace(/\{\{(\w+)\}\}/g, (match, key) =>
    variables[key] !== undefined ? variables[key] : match
  );
}

function applyAuth(headers, authType, authConfig) {
  if (authType === 'bearer' && authConfig.token) {
    headers['Authorization'] = `Bearer ${authConfig.token}`;
  } else if (authType === 'basic') {
    const encoded = Buffer.from(`${authConfig.username || ''}:${authConfig.password || ''}`).toString('base64');
    headers['Authorization'] = `Basic ${encoded}`;
  } else if (authType === 'apikey' && authConfig.in === 'header' && authConfig.key) {
    headers[authConfig.key] = authConfig.value || '';
  }
}


function isTextLike(contentType) {
  if (!contentType) return false;
  const ct = contentType.split(';')[0].trim().toLowerCase();
  if (ct === 'image/svg+xml') return false;
  return (
    ct.startsWith('text/') ||
    ct === 'application/json' ||
    ct.includes('+json') ||
    ct === 'application/xml' ||
    ct.includes('+xml') ||
    ct === 'application/javascript' ||
    ct === 'application/x-javascript' ||
    ct === 'application/x-www-form-urlencoded'
  );
}

function buildFetchArgs(config, rangeHeader) {
  const {
    method = 'GET',
    url = '',
    headers: rawHeaders = [],
    body_type = 'none',
    body = '',
    auth_type = 'none',
    auth_config = {},
    variables = {},
  } = config;

  let resolvedUrl = substituteVariables(url, variables);

  if (auth_type === 'apikey' && auth_config.in === 'query' && auth_config.key) {
    const sep = resolvedUrl.includes('?') ? '&' : '?';
    resolvedUrl += `${sep}${encodeURIComponent(auth_config.key)}=${encodeURIComponent(auth_config.value || '')}`;
  }

  const resolvedHeaders = {};
  for (const h of rawHeaders) {
    if (h.enabled !== false && h.key) {
      resolvedHeaders[substituteVariables(h.key, variables)] = substituteVariables(h.value || '', variables);
    }
  }
  applyAuth(resolvedHeaders, auth_type, auth_config);

  if (rangeHeader) resolvedHeaders['range'] = rangeHeader;

  const fetchOptions = { method: method.toUpperCase(), headers: resolvedHeaders };

  if (!['GET', 'HEAD'].includes(fetchOptions.method) && body_type !== 'none') {
    if (body_type === 'json') {
      resolvedHeaders['Content-Type'] = resolvedHeaders['Content-Type'] || 'application/json';
      fetchOptions.body = body;
    } else if (body_type === 'form') {
      const params = new URLSearchParams();
      let formRows = [];
      try { formRows = JSON.parse(body); } catch {}
      for (const row of formRows) {
        if (row.enabled !== false && row.key) params.append(row.key, row.value || '');
      }
      resolvedHeaders['Content-Type'] = 'application/x-www-form-urlencoded';
      fetchOptions.body = params.toString();
    } else if (body_type === 'raw') {
      fetchOptions.body = body;
    }
  }

  return { resolvedUrl, fetchOptions };
}

const tokenStore = new Map(); // token -> { config, expiresAt }
setInterval(() => {
  const now = Date.now();
  for (const [token, entry] of tokenStore) {
    if (entry.expiresAt < now) tokenStore.delete(token);
  }
}, 60_000).unref();

router.post('/', async (req, res) => {
  const config = req.body;
  const start = Date.now();

  try {
    const { resolvedUrl, fetchOptions } = buildFetchArgs(config);
    const response = await fetch(resolvedUrl, fetchOptions);
    const time_ms = Date.now() - start;

    const responseHeaders = {};
    response.headers.forEach((value, key) => { responseHeaders[key] = value; });

    const contentType = response.headers.get('content-type') || '';

    if (isTextLike(contentType)) {
      const responseBody = await response.text();
      res.json({ status: response.status, statusText: response.statusText, headers: responseHeaders, body: responseBody, time_ms });
    } else {
      await response.body?.cancel();
      const token = crypto.randomUUID();
      tokenStore.set(token, { config, expiresAt: Date.now() + 5 * 60 * 1000 });
      res.json({ status: response.status, statusText: response.statusText, headers: responseHeaders, time_ms, previewToken: token, bodyType: 'binary' });
    }
  } catch (error) {
    res.json({ error: error.message, status: 0, statusText: 'Network Error', headers: {}, body: '', time_ms: Date.now() - start });
  }
});

router.get('/preview/:token', async (req, res) => {
  const entry = tokenStore.get(req.params.token);
  if (!entry || entry.expiresAt < Date.now()) {
    return res.status(404).json({ error: 'Token not found or expired' });
  }

  try {
    const { resolvedUrl, fetchOptions } = buildFetchArgs(entry.config, req.headers['range']);
    const response = await fetch(resolvedUrl, fetchOptions);

    res.status(response.status);

    for (const h of ['content-type', 'content-length', 'content-range', 'accept-ranges', 'cache-control']) {
      const val = response.headers.get(h);
      if (val) res.setHeader(h, val);
    }

    const readable = Readable.fromWeb(response.body);
    req.on('close', () => readable.destroy());
    readable.pipe(res);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;
