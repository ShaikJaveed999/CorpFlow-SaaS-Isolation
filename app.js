const express = require('express');
const db = require('./db');
const { createAuthentication } = require('./middleware/auth');
const createUsersRouter = require('./routes/users');
const createProjectsRouter = require('./routes/projects');
const createBillingRouter = require('./routes/billing');

function createApp({
  database = db,
  jwtSecret = process.env.JWT_SECRET,
  jwtIssuer = process.env.JWT_ISSUER || 'corpflow-auth',
  jwtAudience = process.env.JWT_AUDIENCE || 'corpflow-api'
} = {}) {
  const app = express();
  const authenticate = createAuthentication({
    db: database,
    secret: jwtSecret,
    issuer: jwtIssuer,
    audience: jwtAudience
  });

  app.use(express.json());

  app.get('/', (req, res) => {
    res.json({
      name: 'CorpFlow SaaS API',
      version: '1.0.0-beta',
      status: 'online',
      message: 'Welcome to the CorpFlow internal workforce management API.'
    });
  });

  app.use('/users', authenticate, createUsersRouter(database));
  app.use('/projects', authenticate, createProjectsRouter(database));
  app.use('/billing', authenticate, createBillingRouter(database));

  app.use((req, res) => {
    res.status(404).json({ error: 'Endpoint not found.' });
  });

  return app;
}

async function start() {
  if (!process.env.DATABASE_URL) {
    throw new Error('DATABASE_URL must be configured before starting the API.');
  }
  if (!process.env.JWT_SECRET || Buffer.byteLength(process.env.JWT_SECRET) < 32) {
    throw new Error('JWT_SECRET must contain at least 32 bytes.');
  }

  await db.query('SELECT 1');
  const app = createApp();
  const port = Number(process.env.PORT) || 3000;

  return app.listen(port, () => {
    console.log(`CorpFlow SaaS API running on port ${port}`);
  });
}

if (require.main === module) {
  start().catch((error) => {
    console.error('Failed to start CorpFlow SaaS API:', error);
    process.exitCode = 1;
  });
}

module.exports = { createApp, start };
