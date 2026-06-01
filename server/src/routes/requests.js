const express = require('express');
const db = require('../db/database');
const router = express.Router();

router.get('/requests/search', (req, res) => {
  const q = req.query.q;
  if (!q || !q.trim()) {
    return res.status(400).json({ error: 'q is required' });
  }
  const escaped = q.trim().replace(/\\/g, '\\\\').replace(/%/g, '\\%').replace(/_/g, '\\_');
  const like = `%${escaped}%`;
  const requests = db
    .prepare(
      `SELECT * FROM requests
       WHERE (name LIKE ? ESCAPE '\\' OR url LIKE ? ESCAPE '\\')
       ORDER BY project_id, created_at ASC
       LIMIT 200`
    )
    .all(like, like);
  res.json(requests);
});

router.get('/projects/:projectId/requests', (req, res) => {
  const requests = db
    .prepare('SELECT * FROM requests WHERE project_id = ? ORDER BY created_at ASC')
    .all(req.params.projectId);
  res.json(requests);
});

router.post('/projects/:projectId/requests', (req, res) => {
  const { name } = req.body;
  if (!name || !name.trim()) {
    return res.status(400).json({ error: 'name is required' });
  }
  const result = db
    .prepare(
      `INSERT INTO requests (project_id, name, method, url, headers, body_type, body, auth_type, auth_config)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      req.params.projectId,
      name.trim(),
      req.body.method || 'GET',
      req.body.url || '',
      JSON.stringify(req.body.headers || []),
      req.body.body_type || 'none',
      req.body.body || '',
      req.body.auth_type || 'none',
      JSON.stringify(req.body.auth_config || {})
    );
  const request = db.prepare('SELECT * FROM requests WHERE id = ?').get(result.lastInsertRowid);
  res.status(201).json(request);
});

router.put('/requests/:id', (req, res) => {
  const existing = db.prepare('SELECT * FROM requests WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'request not found' });

  const { name, method, url, headers, body_type, body, auth_type, auth_config } = req.body;

  db.prepare(
    `UPDATE requests
     SET name=?, method=?, url=?, headers=?, body_type=?, body=?, auth_type=?, auth_config=?,
         updated_at=CURRENT_TIMESTAMP
     WHERE id=?`
  ).run(
    name !== undefined ? name : existing.name,
    method !== undefined ? method : existing.method,
    url !== undefined ? url : existing.url,
    headers !== undefined ? JSON.stringify(headers) : existing.headers,
    body_type !== undefined ? body_type : existing.body_type,
    body !== undefined ? body : existing.body,
    auth_type !== undefined ? auth_type : existing.auth_type,
    auth_config !== undefined ? JSON.stringify(auth_config) : existing.auth_config,
    req.params.id
  );

  const request = db.prepare('SELECT * FROM requests WHERE id = ?').get(req.params.id);
  res.json(request);
});

router.delete('/requests/:id', (req, res) => {
  const result = db.prepare('DELETE FROM requests WHERE id = ?').run(req.params.id);
  if (result.changes === 0) return res.status(404).json({ error: 'request not found' });
  res.status(204).send();
});

module.exports = router;
