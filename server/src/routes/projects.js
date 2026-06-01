const express = require('express');
const multer = require('multer');
const db = require('../db/database');

const router = express.Router();
const upload = multer({ storage: multer.memoryStorage() });

// ---------------------------------------------------------------------------
// Postman collection parser
// ---------------------------------------------------------------------------

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
        body = JSON.stringify(req.body.formdata || []);
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

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------

router.post('/projects/import', upload.single('file'), (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: 'No file uploaded' });
  }

  let json;
  try {
    json = JSON.parse(req.file.buffer.toString('utf8'));
  } catch {
    return res.status(400).json({ error: 'Invalid JSON' });
  }

  let parsed;
  try {
    parsed = parsePostmanCollection(json);
  } catch (e) {
    return res.status(e.status || 400).json({ error: e.message });
  }

  const { projectName, requests, variables } = parsed;

  const doImport = db.transaction(() => {
    const projectResult = db.prepare('INSERT INTO projects (name) VALUES (?)').run(projectName);
    const projectId = projectResult.lastInsertRowid;

    const insertRequest = db.prepare(
      `INSERT INTO requests (project_id, name, method, url, headers, body_type, body, auth_type, auth_config)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    );
    for (const r of requests) {
      insertRequest.run(
        projectId, r.name, r.method, r.url,
        JSON.stringify(r.headers), r.body_type, r.body,
        r.auth_type, JSON.stringify(r.auth_config)
      );
    }

    let environmentCreated = false;
    if (variables.length > 0) {
      db.prepare('INSERT INTO environments (project_id, name, variables) VALUES (?, ?, ?)')
        .run(projectId, 'Imported', JSON.stringify(variables));
      environmentCreated = true;
    }

    const project = db.prepare('SELECT * FROM projects WHERE id = ?').get(projectId);
    return { project, requestCount: requests.length, environmentCreated };
  });

  try {
    const result = doImport();
    res.status(201).json(result);
  } catch (e) {
    console.error('Import transaction failed:', e);
    res.status(500).json({ error: 'Import failed' });
  }
});

router.get('/projects', (req, res) => {
  const projects = db.prepare('SELECT * FROM projects ORDER BY created_at DESC').all();
  res.json(projects);
});

router.post('/projects', (req, res) => {
  const { name } = req.body;
  if (!name || !name.trim()) {
    return res.status(400).json({ error: 'name is required' });
  }
  const result = db.prepare('INSERT INTO projects (name) VALUES (?)').run(name.trim());
  const project = db.prepare('SELECT * FROM projects WHERE id = ?').get(result.lastInsertRowid);
  res.status(201).json(project);
});

router.put('/projects/:id', (req, res) => {
  const { name } = req.body;
  if (!name || !name.trim()) {
    return res.status(400).json({ error: 'name is required' });
  }
  const result = db.prepare('UPDATE projects SET name = ? WHERE id = ?').run(name.trim(), req.params.id);
  if (result.changes === 0) return res.status(404).json({ error: 'project not found' });
  const project = db.prepare('SELECT * FROM projects WHERE id = ?').get(req.params.id);
  res.json(project);
});

router.delete('/projects/:id', (req, res) => {
  const result = db.prepare('DELETE FROM projects WHERE id = ?').run(req.params.id);
  if (result.changes === 0) return res.status(404).json({ error: 'project not found' });
  res.status(204).send();
});

module.exports = router;
