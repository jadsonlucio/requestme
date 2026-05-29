const express = require('express');
const db = require('../db/database');
const router = express.Router();

router.get('/projects/:projectId/environments', (req, res) => {
  const envs = db
    .prepare('SELECT * FROM environments WHERE project_id = ? ORDER BY created_at ASC')
    .all(req.params.projectId);
  res.json(envs);
});

router.post('/projects/:projectId/environments', (req, res) => {
  const { name, variables = [] } = req.body;
  if (!name || !name.trim()) {
    return res.status(400).json({ error: 'name is required' });
  }
  const result = db
    .prepare('INSERT INTO environments (project_id, name, variables) VALUES (?, ?, ?)')
    .run(req.params.projectId, name.trim(), JSON.stringify(variables));
  const env = db.prepare('SELECT * FROM environments WHERE id = ?').get(result.lastInsertRowid);
  res.status(201).json(env);
});

router.put('/environments/:id', (req, res) => {
  const existing = db.prepare('SELECT * FROM environments WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'environment not found' });

  const { name, variables } = req.body;
  db.prepare('UPDATE environments SET name=?, variables=? WHERE id=?').run(
    name !== undefined ? name : existing.name,
    variables !== undefined ? JSON.stringify(variables) : existing.variables,
    req.params.id
  );
  const env = db.prepare('SELECT * FROM environments WHERE id = ?').get(req.params.id);
  res.json(env);
});

router.delete('/environments/:id', (req, res) => {
  const result = db.prepare('DELETE FROM environments WHERE id = ?').run(req.params.id);
  if (result.changes === 0) return res.status(404).json({ error: 'environment not found' });
  res.status(204).send();
});

module.exports = router;
