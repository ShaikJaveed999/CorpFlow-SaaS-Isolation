# CorpFlow SaaS API

CorpFlow is a Node.js/Express workforce API backed by PostgreSQL. It provides
tenant-isolated user, project, assignment, and billing data with database-backed
ADMIN, MANAGER, and USER authorization.

## Technologies

- Node.js 18.11 or later
- Express 4
- PostgreSQL 14 or later
- `pg` for database access
- HS256 JWT verification (`jsonwebtoken`)
- Node's built-in test runner

## Installation

Install Node.js and PostgreSQL, create a database, then install dependencies:

```powershell
createdb corpflow
npm ci
Copy-Item .env.example .env
```

Edit `.env` and set `DATABASE_URL`. Generate a strong signing secret with:

```powershell
node -e "console.log(require('node:crypto').randomBytes(32).toString('base64url'))"
```

Set that value as `JWT_SECRET`. The same secret must be configured only in the
trusted token issuer and API. Set matching `JWT_ISSUER` and `JWT_AUDIENCE`
values in the issuer and API. Never commit `.env` or production secrets.

## Database setup

For a **new, empty database**, load the schema and demonstration data:

```powershell
npm run seed
```

The seed command uses `DATABASE_URL` from `.env` and does not drop tables.
Sample password-hash values are legacy demonstration data; this API has no
password-login endpoint and does not use them to authenticate requests.

For an existing database created from the original schema:

1. Take and verify a database backup.
2. Review the tenant mapping. The included migration is for the starter data's
   `pouch.io` and `velocity.com` users; it stops if it encounters an unmapped
   user rather than assigning that user to a shared tenant.
3. Run the one-time migration:

   ```powershell
   psql "$env:DATABASE_URL" -v ON_ERROR_STOP=1 -f migrations\001_tenant_isolation.sql
   ```

4. Existing projects are placed in `legacy-unassigned`, because the original
   schema has no project-ownership data. Review ownership with the data owner,
   then update each confirmed project's `tenant_id` to its tenant. Do not infer
   ownership from a project name or description.
5. Verify tenant assignments and the composite constraints before deploying
   the application.

Do not run the fresh-install seed script as a substitute for this migration.

## Authentication and authorization

There is no local login or token-issuance endpoint. An external trusted identity
provider must issue HS256 JWTs with:

- a numeric database user ID in `sub`;
- the configured issuer and audience;
- a valid expiry time.

The API verifies the signature and standard claims, then reloads the user's
tenant, role, and manager relationship from PostgreSQL on every request.
`role` or `tenant_id` claims supplied by a client are not used for access
decisions. Use `Authorization: Bearer <token>` for `/users`, `/projects`, and
`/billing`.

## Run and test

Start the API (startup checks the database connection and required JWT secret):

```powershell
npm start
```

For development with file watching:

```powershell
npm run dev
```

Run automated tests:

```powershell
npm test
```

Tenant authorization and response filtering are tested with a deterministic
database double. Set `TEST_DATABASE_URL` to a disposable PostgreSQL database to
also run the composite-foreign-key integration test. That test creates its own
temporary schema and rolls back its work.

## API endpoints

| Method | Endpoint | Access |
|---|---|---|
| GET | `/` | Public health/status |
| GET | `/users` | Tenant users filtered by role |
| GET | `/users/:id` | Tenant- and role-scoped profile |
| GET | `/projects` | Tenant projects filtered by role/assignment |
| GET | `/projects/:id` | Tenant- and assignment-scoped project |
| GET | `/billing` | Tenant ADMIN only |
| GET | `/billing/:id` | Tenant ADMIN only |

## Security and operations

See [SECURITY.md](./SECURITY.md) for sensitive fields, role permissions,
tenant enforcement, indexes, migration considerations, and threat scenarios.
Production database TLS certificate verification is enabled. Configure a
PostgreSQL endpoint with a certificate trusted by the host runtime.

No live deployment has been created; there is no deployment URL yet. For a
deployment, configure `DATABASE_URL`, `JWT_SECRET`, `JWT_ISSUER`,
`JWT_AUDIENCE`, `NODE_ENV=production`, and the platform-provided `PORT`, run the
reviewed database migration, then use `npm start`.
