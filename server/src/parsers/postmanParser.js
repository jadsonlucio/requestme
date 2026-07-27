function extractRequests(items, prefix) {
  const out = [];
  for (const item of items) {
    if (Array.isArray(item.item)) {
      const folderPrefix = prefix ? `${prefix} / ${item.name}` : item.name;
      out.push(...extractRequests(item.item, folderPrefix));
    } else if (item.request) {
      out.push({ item, prefix });
    }
  }
  return out;
}

function parsePostmanCollection(json) {
  if (!json.info || !json.info.schema || !json.info.schema.includes('collection/v2')) {
    const err = new Error('Not a Postman collection');
    err.status = 400;
    throw err;
  }

  const raw = extractRequests(json.item || [], '');

  if (raw.length === 0) {
    const err = new Error('Collection has no requests');
    err.status = 400;
    throw err;
  }

  const requests = raw.map(({ item, prefix }) => {
    const req = item.request;
    const name = prefix ? `${prefix} / ${item.name}` : item.name;
    const method = req.method || 'GET';
    const url = typeof req.url === 'string' ? req.url : (req.url && req.url.raw) || '';

    const headers = (req.header || [])
      .map(h => ({ key: h.key, value: h.value, enabled: !h.disabled }));

    let body_type = 'none';
    let body = '';
    if (req.body) {
      if (req.body.mode === 'raw') {
        const lang = req.body.options?.raw?.language;
        body_type = lang === 'json' ? 'json' : 'raw';
        body = req.body.raw || '';
      } else if (req.body.mode === 'urlencoded') {
        body_type = 'form';
        body = JSON.stringify(req.body.urlencoded || []);
      } else if (req.body.mode === 'formdata') {
        body_type = 'form';
        // Postman's own formdata file entries look like { key, type: 'file', src: '/local/path' }
        // and never embed the file's bytes. Since this app's row contract now gives real
        // meaning to type: 'file' (server-side: build a real file part from row.value as
        // base64), leaving those entries verbatim would silently send a 0-byte file. Normalize
        // them to plain text rows instead (existing behavior for imported file fields),
        // matching the enabled derivation already used for headers above (`!h.disabled`).
        const formdataRows = (req.body.formdata || []).map((f) => {
          if (f.type === 'file') {
            return { key: f.key, value: '', enabled: !f.disabled, type: 'text' };
          }
          return f;
        });
        body = JSON.stringify(formdataRows);
      }
    }

    let auth_type = 'none';
    let auth_config = {};
    if (req.auth) {
      const a = req.auth;
      if (a.type === 'bearer') {
        auth_type = 'bearer';
        auth_config = { token: (a.bearer || [])[0]?.value || '' };
      } else if (a.type === 'basic') {
        auth_type = 'basic';
        auth_config = {
          username: (a.basic || []).find(p => p.key === 'username')?.value || '',
          password: (a.basic || []).find(p => p.key === 'password')?.value || '',
        };
      } else if (a.type === 'apikey') {
        auth_type = 'apikey';
        auth_config = {
          key: (a.apikey || []).find(p => p.key === 'key')?.value || '',
          value: (a.apikey || []).find(p => p.key === 'value')?.value || '',
          in: (a.apikey || []).find(p => p.key === 'in')?.value || 'header',
        };
      }
    }

    return { name, method, url, headers, body_type, body, auth_type, auth_config };
  });

  const variables = (json.variable || []).map(v => ({ key: v.key, value: v.value || '' }));

  const projectName = json.info.name || 'Imported Collection';

  return { projectName, requests, variables };
}

module.exports = { parsePostmanCollection, extractRequests };
