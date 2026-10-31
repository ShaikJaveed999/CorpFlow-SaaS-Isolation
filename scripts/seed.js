const fs = require('node:fs/promises');
const path = require('node:path');
const db = require('../db');

async function seed() {
  if (!process.env.DATABASE_URL) {
    throw new Error('DATABASE_URL must be configured before seeding the database.');
  }

  const schema = await fs.readFile(path.join(__dirname, '..', 'schema.sql'), 'utf8');
  await db.query(schema);
}

seed()
  .catch((error) => {
    console.error('Database setup failed:', error);
    process.exitCode = 1;
  })
  .finally(() => db.close());
