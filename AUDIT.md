# Pre-Refactor Security Audit

**Scope:** The complete project snapshot before application or schema changes.
The repository currently contains an Express API, PostgreSQL access through
`pg`, and a single SQL schema/seed file. This audit records only issues
observable in that snapshot.

## Findings

| ID | Area | Evidence | Finding and security consequence |
|---|---|---|---|
| A1 | Tenant model | `schema.sql:8-31` | There is no `tenants` table and no `tenant_id` on `users`, `projects`, or `billing_details`. The seed data contains users from `pouch.io` and `velocity.com`, but the database has no organization boundary. Queries therefore cannot reliably enforce customer isolation, and adding a tenant filter at the API layer alone would have no trusted tenant key to use. |
| A2 | User endpoints / authorization | `app.js:20-21`; `routes/users.js:6-27` | The user router is mounted without authentication or authorization. `GET /users` returns every user to any caller; `GET /users/:id` accepts an arbitrary ID and likewise has no caller ownership, role, or organization check. This permits unauthenticated enumeration and IDOR-style access. |
| A3 | User response fields | `routes/users.js:9,21`; `schema.sql:8-14` | Both user queries use `SELECT *`, returning `password_hash` and `salary` as well as profile data. Because the routes have no authentication, every caller can retrieve these sensitive values; even authenticated non-admin roles would receive them if authentication were added without changing the response mapping. |
| A4 | Project endpoints / authorization | `app.js:20-21`; `routes/projects.js:6-27` | Project routes are unauthenticated. `GET /projects` lists all projects and `GET /projects/:id` retrieves arbitrary IDs without a tenant, role, or assignment predicate. Callers can enumerate projects across customer organizations and access projects they should not see. |
| A5 | Project response fields | `routes/projects.js:9,21`; `schema.sql:17-22` | Both project queries use `SELECT *`, exposing project descriptions and `budget` to every caller. `budget` is financial information and no role-aware response filtering exists. |
| A6 | Billing relationship integrity | `schema.sql:25-31` | `billing_details.user_id` references only `users(id)`. There is no tenant key or composite foreign key, so after tenants are introduced this relationship alone cannot prove that a billing record and its user belong to the same tenant. The billing table has no current API route, so the snapshot does not expose it through the shown HTTP routes. |
| A7 | Role enforcement and project assignments | `schema.sql:8-22`; `routes/users.js`; `routes/projects.js` | `users.role` is an unconstrained string with a default of `employee`; there is no authentication middleware, role check, manager/team relationship, or project-assignment table. The requested ADMIN/MANAGER/USER policies cannot be represented or enforced by the current application. |
| A8 | Tenant-scoped indexes | `schema.sql:8-31` | No tenant columns or tenant-scoped indexes exist. The primary keys provide ID indexes only; they cannot support efficient tenant-scoped user, project, billing, or assignment lookups after isolation is added. |
| A9 | Production database TLS | `db.js:4-7` | In production, PostgreSQL TLS is configured with `rejectUnauthorized: false`. The client does not validate the server certificate, allowing a network attacker able to intercept the connection to impersonate the database and observe or alter database traffic. |
| A10 | Destructive schema setup | `schema.sql:4-6` | Running the documented seed command executes unconditional `DROP TABLE` statements for billing, projects, and users. Re-running it against a populated database deletes application data and relationships rather than applying a safe migration. |

## Sensitive fields present in the schema

| Table | Field | Why sensitive | Access in the pre-refactor application |
|---|---|---|---|
| `users` | `password_hash` | Credential verifier that can enable offline password-guessing attacks if disclosed. | Returned to any caller by both user routes. |
| `users` | `salary` | Employee compensation data. | Returned to any caller by both user routes. |
| `projects` | `budget` | Project financial information. | Returned to any caller by both project routes. |
| `billing_details` | `card_holder_name` | Identifies a payment-card holder. | No billing route exists in the inspected application. |
| `billing_details` | `card_last4` | Partial payment-card identifier; sensitive in combination with other data. | No billing route exists in the inspected application. |
| `billing_details` | `expiry_date` | Payment-card metadata. | No billing route exists in the inspected application. |
| `billing_details` | `billing_address` | Personal/address information associated with billing. | No billing route exists in the inspected application. |

## Audit limits

The project snapshot has no test files, migration framework, authentication
provider configuration, or deployment configuration. No claims are made about
components outside the files present in this workspace.
