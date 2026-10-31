const express = require('express');

function mapProject(row, includeBudget) {
  const project = {
    id: row.id,
    name: row.name,
    description: row.description,
    status: row.status
  };
  if (includeBudget) {
    project.budget = row.budget;
  }
  return project;
}

function projectQuery(role, single) {
  const predicate = single ? 'AND p.id = $2' : '';
  if (role === 'ADMIN') {
    return {
      text: `SELECT p.id, p.name, p.description, p.status, p.budget
             FROM projects p
             WHERE p.tenant_id = $1 ${predicate}
             ORDER BY p.id`,
      includeBudget: true
    };
  }

  const assignmentPredicate = role === 'MANAGER'
    ? `EXISTS (
         SELECT 1
         FROM project_assignments pa
         JOIN users assigned
           ON assigned.tenant_id = pa.tenant_id AND assigned.id = pa.user_id
         WHERE pa.tenant_id = p.tenant_id
           AND pa.project_id = p.id
           AND (assigned.id = $2 OR assigned.manager_id = $2)
       )`
    : `EXISTS (
         SELECT 1 FROM project_assignments pa
         WHERE pa.tenant_id = p.tenant_id
           AND pa.project_id = p.id
           AND pa.user_id = $2
       )`;

  return {
    text: `SELECT p.id, p.name, p.description, p.status
           FROM projects p
           WHERE p.tenant_id = $1 AND ${assignmentPredicate}
             ${single ? 'AND p.id = $3' : ''}
           ORDER BY p.id`,
    includeBudget: false
  };
}

function createProjectsRouter(db) {
  const router = express.Router();

  router.get('/', async (req, res) => {
    const { userId, tenantId, role } = req.auth;
    const query = projectQuery(role, false);
    const params = role === 'ADMIN' ? [tenantId] : [tenantId, userId];

    try {
      const { rows } = await db.query(query.text, params);
      return res.json(rows.map((row) => mapProject(row, query.includeBudget)));
    } catch (error) {
      console.error('Project list query failed:', error);
      return res.status(500).json({ error: 'Failed to find projects.' });
    }
  });

  router.get('/:id', async (req, res) => {
    const projectId = Number(req.params.id);
    if (!Number.isSafeInteger(projectId) || projectId < 1) {
      return res.status(400).json({ error: 'Project ID must be a positive integer.' });
    }

    const { userId, tenantId, role } = req.auth;
    const query = projectQuery(role, true);
    const params = role === 'ADMIN'
      ? [tenantId, projectId]
      : [tenantId, userId, projectId];

    try {
      const { rows } = await db.query(query.text, params);
      if (rows.length === 0) {
        return res.status(404).json({ error: 'Project not found.' });
      }
      return res.json(mapProject(rows[0], query.includeBudget));
    } catch (error) {
      console.error('Project lookup query failed:', error);
      return res.status(500).json({ error: 'Failed to retrieve project info.' });
    }
  });

  return router;
}

module.exports = createProjectsRouter;
