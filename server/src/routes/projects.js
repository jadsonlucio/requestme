const express = require('express');
const multer = require('multer');
const db = require('../db/database');
const { parseImportFile } = require('../parsers/importFile');

const router = express.Router();
const upload = multer({ storage: multer.memoryStorage() });

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------

router.post('/projects/import', upload.single('file'), (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: 'No file uploaded' });
  }

  let parsed;
  try {
    parsed = parseImportFile(req.file.buffer);
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
