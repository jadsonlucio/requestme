const express = require('express');
const router = express.Router();

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

  if (rangeHeader) resolvedHeaders['Range'] = rangeHeader;

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

router.post('/', async (req, res) => {
  const {
    method = 'GET',
    url = '',
    headers: rawHeaders = [],
    body_type = 'none',
    body = '',
    auth_type = 'none',
    auth_config = {},
    variables = {},
  } = req.body;

  const start = Date.now();

  try {
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

    const response = await fetch(resolvedUrl, fetchOptions);
    const time_ms = Date.now() - start;
    const responseBody = await response.text();

    const responseHeaders = {};
    response.headers.forEach((value, key) => { responseHeaders[key] = value; });

    res.json({ status: response.status, statusText: response.statusText, headers: responseHeaders, body: responseBody, time_ms });
  } catch (error) {
    res.json({ error: error.message, status: 0, statusText: 'Network Error', headers: {}, body: '', time_ms: Date.now() - start });
  }
});

module.exports = router;
