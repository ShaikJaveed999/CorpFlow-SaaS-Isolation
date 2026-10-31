const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { after, before, test } = require('node:test');
const jwt = require('jsonwebtoken');
const { createApp } = require('../app');

const SECRET = 'unit-test-secret-with-at-least-32-bytes';
const ISSUER = 'corpflow-auth';
const AUDIENCE = 'corpflow-api';

const users = [
  { id: 1, tenant_id: 10, role: 'ADMIN', manager_id: null, full_name: 'Admin A', email: 'admin-a@example.test', salary: '120000.00', password_hash: 'secret-a' },
  { id: 2, tenant_id: 10, role: 'MANAGER', manager_id: null, full_name: 'Manager A', email: 'manager-a@example.test', salary: '90000.00', password_hash: 'secret-b' },
  { id: 3, tenant_id: 10, role: 'USER', manager_id: 2, full_name: 'User A', email: 'user-a@example.test', salary: '70000.00', password_hash: 'secret-c' },
  { id: 4, tenant_id: 20, role: 'ADMIN', manager_id: null, full_name: 'Admin B', email: 'admin-b@example.test', salary: '130000.00', password_hash: 'secret-d' },
  { id: 5, tenant_id: 20, role: 'USER', manager_id: 4, full_name: 'User B', email: 'user-b@example.test', salary: '80000.00', password_hash: 'secret-e' }
];

const projects = [
  { id: 101, tenant_id: 10, name: 'Manager project', description: 'Team work', status: 'active', budget: '50000.00', assigned: [2] },
  { id: 102, tenant_id: 10, name: 'Assigned project', description: 'User work', status: 'active', budget: '60000.00', assigned: [3] },
  { id: 103, tenant_id: 10, name: 'Unassigned project', description: 'Private work', status: 'inactive', budget: '70000.00', assigned: [] },
  { id: 201, tenant_id: 20, name: 'Other tenant project', description: 'Tenant B work', status: 'active', budget: '90000.00', assigned: [5] }
];

const billing = [
  { id: 301, tenant_id: 10, user_id: 1, card_holder_name: 'Admin A', card_last4: '1234', expiry_date: '12/29', billing_address: 'A address' },
  { id: 401, tenant_id: 20, user_id: 4, card_holder_name: 'Admin B', card_last4: '5678', expiry_date: '10/30', billing_address: 'B address' }
];

function fakeDatabase() {
  return {
    async query(text, params) {
      if (text.startsWith('SELECT id, tenant_id, role, manager_id FROM users')) {
        return { rows: users.filter((user) => user.id === params[0]).map(({ id, tenant_id, role, manager_id }) => ({ id, tenant_id, role, manager_id })) };
      }

      if (text.includes('FROM billing_details')) {
        return {
          rows: billing.filter((row) => row.tenant_id === params[0]
            && (params.length === 1 || row.id === params[1]))
        };
      }

      if (text.includes('FROM projects p')) {
        const isAdminQuery = !text.includes('project_assignments');
        const tenantId = params[0];
        const callerId = isAdminQuery ? null : params[1];
        const requestedProjectId = params.length === (isAdminQuery ? 2 : 3)
          ? params[isAdminQuery ? 1 : 2]
          : null;
        const rows = projects.filter((project) => {
          if (project.tenant_id !== tenantId) return false;
          if (requestedProjectId !== null && project.id !== requestedProjectId) return false;
          if (isAdminQuery) return true;
          const assignedUsers = users.filter((user) => project.assigned.includes(user.id));
          if (text.includes('assigned.manager_id = $2')) {
            return assignedUsers.some((user) => user.id === callerId || user.manager_id === callerId);
          }
          return project.assigned.includes(callerId);
        });
        return { rows };
      }

      if (text.includes('FROM users')) {
        const tenantId = params[0];
        let rows = users.filter((user) => user.tenant_id === tenantId);
        if (text.includes('manager_id = $2')) {
          rows = rows.filter((user) => user.manager_id === params[1]);
        } else if (text.includes('id = $2 AND id = $3')) {
          rows = rows.filter((user) => user.id === params[1] && user.id === params[2]);
        } else if (text.includes('(id = $3 OR manager_id = $3)')) {
          rows = rows.filter((user) => user.id === params[1]
            && (user.id === params[2] || user.manager_id === params[2]));
        } else if (text.includes('id = $2')) {
          rows = rows.filter((user) => user.id === params[1]);
        }
        return { rows };
      }

      throw new Error(`Unexpected SQL in test: ${text}`);
    }
  };
}

function tokenFor(userId, extraClaims = {}) {
  return jwt.sign(extraClaims, SECRET, {
    algorithm: 'HS256',
    subject: String(userId),
    issuer: ISSUER,
    audience: AUDIENCE,
    expiresIn: '1h'
  });
}

let server;
let baseUrl;

before(async () => {
  const app = createApp({
    database: fakeDatabase(),
    jwtSecret: SECRET,
    jwtIssuer: ISSUER,
    jwtAudience: AUDIENCE
  });
  server = app.listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  if (server) {
    await new Promise((resolve, reject) => {
      server.close((error) => error ? reject(error) : resolve());
    });
  }
});

async function request(pathname, { userId, claims, token } = {}) {
  const headers = {};
  const bearer = token || (userId ? tokenFor(userId, claims) : null);
  if (bearer) headers.authorization = `Bearer ${bearer}`;
  const response = await fetch(`${baseUrl}${pathname}`, { headers });
  return { status: response.status, body: await response.json() };
}

test('unauthenticated requests are rejected and the public health route remains available', async () => {
  assert.equal((await request('/users')).status, 401);
  assert.equal((await request('/projects')).status, 401);
  assert.equal((await request('/billing')).status, 401);
  const noExpiryToken = jwt.sign({}, SECRET, {
    algorithm: 'HS256',
    subject: '1',
    issuer: ISSUER,
    audience: AUDIENCE
  });
  assert.equal((await request('/users', { token: noExpiryToken })).status, 401);
  assert.equal((await request('/')).body.status, 'online');
});

test('tenant admins see only tenant users and permitted sensitive salary data', async () => {
  const result = await request('/users', { userId: 1 });
  assert.equal(result.status, 200);
  assert.deepEqual(result.body.map((user) => user.id), [1, 2, 3]);
  assert.equal(result.body[0].salary, '120000.00');
  assert.equal('password_hash' in result.body[0], false);
  assert.equal((await request('/users/4', { userId: 1 })).status, 404);
});

test('managers see direct reports and team projects without financial fields', async () => {
  const memberList = await request('/users', { userId: 2 });
  assert.deepEqual(memberList.body.map((user) => user.id), [3]);
  assert.equal('salary' in memberList.body[0], false);

  const projectList = await request('/projects', { userId: 2 });
  assert.deepEqual(projectList.body.map((project) => project.id), [101, 102]);
  assert.equal('budget' in projectList.body[0], false);
  assert.equal((await request('/billing', { userId: 2 })).status, 403);
});

test('users can see only their own profile and assigned projects', async () => {
  const ownProfile = await request('/users/3', { userId: 3 });
  assert.equal(ownProfile.status, 200);
  assert.equal(ownProfile.body.id, 3);
  assert.equal('salary' in ownProfile.body, false);
  assert.equal('password_hash' in ownProfile.body, false);
  assert.equal((await request('/users/2', { userId: 3 })).status, 404);

  const projectList = await request('/projects', { userId: 3 });
  assert.deepEqual(projectList.body.map((project) => project.id), [102]);
  assert.equal('budget' in projectList.body[0], false);
  assert.equal((await request('/projects/103', { userId: 3 })).status, 404);
});

test('tenant admins cannot access another tenant project or billing record', async () => {
  const projectList = await request('/projects', { userId: 1 });
  assert.deepEqual(projectList.body.map((project) => project.id), [101, 102, 103]);
  assert.equal(projectList.body[0].budget, '50000.00');
  assert.equal((await request('/projects/101', { userId: 1 })).body.budget, '50000.00');
  assert.equal((await request('/projects/201', { userId: 1 })).status, 404);

  const billingList = await request('/billing', { userId: 1 });
  assert.equal(billingList.status, 200);
  assert.deepEqual(billingList.body.map((record) => record.id), [301]);
  assert.equal('tenant_id' in billingList.body[0], false);
  assert.equal((await request('/billing/401', { userId: 1 })).status, 404);
});

test('client-supplied role and tenant claims cannot elevate database permissions', async () => {
  const forged = await request('/users', {
    userId: 3,
    claims: { role: 'ADMIN', tenant_id: 20 }
  });
  assert.deepEqual(forged.body.map((user) => user.id), [3]);
  assert.equal((await request('/billing', {
    userId: 3,
    claims: { role: 'ADMIN', tenant_id: 20 }
  })).status, 403);
});

test('composite foreign keys reject cross-tenant references when TEST_DATABASE_URL is set', {
  skip: !process.env.TEST_DATABASE_URL
}, async () => {
  const { Pool } = require('pg');
  const crypto = require('node:crypto');
  const pool = new Pool({ connectionString: process.env.TEST_DATABASE_URL });
  const client = await pool.connect();
  const schemaName = `isolation_test_${crypto.randomBytes(8).toString('hex')}`;

  try {
    await client.query('BEGIN');
    await client.query(`CREATE SCHEMA "${schemaName}"`);
    await client.query(`SET LOCAL search_path TO "${schemaName}"`);
    const schema = fs.readFileSync(path.join(__dirname, '..', 'schema.sql'), 'utf8');
    await client.query(schema);

    const pouch = await client.query("SELECT id FROM tenants WHERE slug = 'pouch.io'");
    const velocity = await client.query("SELECT id FROM tenants WHERE slug = 'velocity.com'");
    const pouchProject = await client.query(
      "SELECT id FROM projects WHERE tenant_id = $1 AND name = 'Pouch Portal'",
      [pouch.rows[0].id]
    );
    const david = await client.query(
      "SELECT id FROM users WHERE tenant_id = $1 AND email = 'david@velocity.com'",
      [velocity.rows[0].id]
    );

    await client.query('SAVEPOINT project_fk');
    await assert.rejects(
      client.query(
        'INSERT INTO project_assignments (tenant_id, project_id, user_id) VALUES ($1, $2, $3)',
        [pouch.rows[0].id, pouchProject.rows[0].id, david.rows[0].id]
      ),
      (error) => error.code === '23503'
    );
    await client.query('ROLLBACK TO SAVEPOINT project_fk');

    await client.query('SAVEPOINT billing_fk');
    await assert.rejects(
      client.query(
        `INSERT INTO billing_details
         (tenant_id, user_id, card_holder_name)
         VALUES ($1, $2, 'Cross-tenant test')`,
        [pouch.rows[0].id, david.rows[0].id]
      ),
      (error) => error.code === '23503'
    );
    await client.query('ROLLBACK TO SAVEPOINT billing_fk');
  } finally {
    await client.query('ROLLBACK');
    client.release();
    await pool.end();
  }
});
