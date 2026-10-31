const express = require('express');

function mapUser(row, includeSalary) {
  const user = {
    id: row.id,
    full_name: row.full_name,
    email: row.email,
    role: row.role,
    manager_id: row.manager_id
  };
  if (includeSalary) {
    user.salary = row.salary;
  }
  return user;
}

function createUsersRouter(db) {
  const router = express.Router();

  router.get('/', async (req, res) => {
    const { userId, tenantId, role } = req.auth;
    let query;
    let params;
    let includeSalary = false;

    if (role === 'ADMIN') {
      query = `SELECT id, full_name, email, role, manager_id, salary
               FROM users WHERE tenant_id = $1 ORDER BY id`;
      params = [tenantId];
      includeSalary = true;
    } else if (role === 'MANAGER') {
      query = `SELECT id, full_name, email, role, manager_id
               FROM users
               WHERE tenant_id = $1 AND manager_id = $2
               ORDER BY id`;
      params = [tenantId, userId];
    } else {
      query = `SELECT id, full_name, email, role, manager_id
               FROM users WHERE tenant_id = $1 AND id = $2`;
      params = [tenantId, userId];
    }

    try {
      const { rows } = await db.query(query, params);
      return res.json(rows.map((row) => mapUser(row, includeSalary)));
    } catch (error) {
      console.error('User list query failed:', error);
      return res.status(500).json({ error: 'Failed to retrieve users.' });
    }
  });

  router.get('/:id', async (req, res) => {
    const requestedId = Number(req.params.id);
    if (!Number.isSafeInteger(requestedId) || requestedId < 1) {
      return res.status(400).json({ error: 'User ID must be a positive integer.' });
    }

    const { userId, tenantId, role } = req.auth;
    let query;
    let params;
    let includeSalary = false;

    if (role === 'ADMIN') {
      query = `SELECT id, full_name, email, role, manager_id, salary
               FROM users WHERE tenant_id = $1 AND id = $2`;
      params = [tenantId, requestedId];
      includeSalary = true;
    } else if (role === 'MANAGER') {
      query = `SELECT id, full_name, email, role, manager_id
               FROM users
               WHERE tenant_id = $1 AND id = $2
                 AND (id = $3 OR manager_id = $3)`;
      params = [tenantId, requestedId, userId];
    } else {
      query = `SELECT id, full_name, email, role, manager_id
               FROM users WHERE tenant_id = $1 AND id = $2 AND id = $3`;
      params = [tenantId, requestedId, userId];
    }

    try {
      const { rows } = await db.query(query, params);
      if (rows.length === 0) {
        return res.status(404).json({ error: 'User not found.' });
      }
      return res.json(mapUser(rows[0], includeSalary));
    } catch (error) {
      console.error('User profile query failed:', error);
      return res.status(500).json({ error: 'Failed to find user.' });
    }
  });

  return router;
}

module.exports = createUsersRouter;
