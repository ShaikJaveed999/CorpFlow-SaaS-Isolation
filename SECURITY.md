# Security and Tenant Isolation

## Sensitive fields and access

| Table | Field(s) | Reason | Access |
|---|---|---|---|
| `users` | `password_hash` | Credential verifier that must not be disclosed. | Never included in API responses, including for ADMIN. |
| `users` | `salary` | Employee compensation information. | ADMIN within the same tenant only. |
| `projects` | `budget` | Project financial information. | ADMIN within the same tenant only. |
| `billing_details` | `card_holder_name`, `card_last4`, `expiry_date`, `billing_address` | Payment metadata and personal billing information. | ADMIN within the same tenant only. |

The database retains the existing legacy password-hash column, but this API
does not implement password login and never returns that column.

## Role permissions

| Role | Users | Projects | Billing and financial fields |
|---|---|---|---|
| ADMIN | All users in the authenticated user's tenant. | All projects in that tenant. | May read salary, project budget, and billing records in that tenant. |
| MANAGER | Direct team members; may view their own profile. | Projects assigned to the manager or a direct report. | No salary, project budget, or billing records. |
| USER | Own profile only. | Projects assigned to that user only. | No salary, project budget, or billing records. |

Unauthorized or out-of-scope user/project IDs return 404 to avoid confirming
whether another tenant's record exists. Missing or invalid authentication
returns 401; an authenticated user lacking a role permission receives 403.

## Authentication context

`middleware/auth.js` verifies HS256 signatures, issuer, audience, and token
validity. The only identity claim used is the numeric `sub`; every request
reloads `tenant_id`, `role`, and `manager_id` from the `users` table. Client
claims such as `role` and `tenant_id` are ignored, preventing role and tenant
spoofing. The API has no token-issuance endpoint; only the configured trusted
issuer may sign tokens using the shared secret.

## Tenant isolation and query boundaries

`tenants` is the tenant registry. `users`, `projects`, `billing_details`, and
`project_assignments` each have a non-null `tenant_id`. Requests use the tenant
ID loaded from the authenticated user's database row:

- `routes/users.js` constrains list and profile queries with `tenant_id`; role
  predicates further limit managers to direct reports and users to themselves.
- `routes/projects.js` constrains every query with `projects.tenant_id`.
  Manager and user queries additionally require a matching
  `project_assignments` row in the same tenant.
- `routes/billing.js` checks ADMIN permission before querying and constrains
  list/detail reads by `tenant_id`.
- The authentication lookup is by token subject, then fetches the trusted role
  and tenant from PostgreSQL; no request parameter selects a tenant.

No route returns raw PostgreSQL rows. User, project, and billing response
mappers explicitly select permitted fields. Salary and project budget are
selected only for ADMIN queries; `password_hash` is never selected by a route.

## Composite relationship constraints

The schema creates `UNIQUE (tenant_id, id)` keys and composite foreign keys:

- `users (tenant_id, manager_id)` references `users (tenant_id, id)`.
- `billing_details (tenant_id, user_id)` references `users (tenant_id, id)`.
- `project_assignments (tenant_id, project_id)` references
  `projects (tenant_id, id)`.
- `project_assignments (tenant_id, user_id)` references
  `users (tenant_id, id)`.

These constraints reject cross-tenant manager, billing, and project assignment
references even if an application query is accidentally weakened.

## Threat scenarios addressed

- **Tenant A requests a Tenant B user or project ID:** route predicates bind
  the ID to the DB-derived tenant; the result is not found.
- **A user supplies `role=ADMIN` or another `tenant_id` in a token:** those
  claims do not influence authorization; the database row is authoritative.
- **An assignment or billing row points at another tenant's user/project:**
  PostgreSQL rejects the composite foreign-key reference.
- **A manager or user requests salary, budget, or billing data:** restricted
  routes and explicit query/response mappings do not return those fields.
- **A caller enumerates IDs without authentication:** protected routers reject
  requests without a verified bearer token.
- **A database connection is intercepted in production:** PostgreSQL TLS
  certificate verification is enabled; invalid/untrusted certificates fail
  the connection.

## Indexing

- `users (tenant_id, email)` supports tenant-local identity uniqueness and
  lookup; `users (tenant_id, manager_id)` supports manager team queries.
- `projects (tenant_id)` supports tenant project lists.
- `billing_details (tenant_id, user_id)` supports tenant billing reads and
  user relationships.
- `project_assignments` primary key `(tenant_id, project_id, user_id)` supports
  project membership checks; `(tenant_id, user_id, project_id)` supports
  assigned-project lookups.
- The tenant primary key and unique tenant slug support tenant resolution.

## Migration and deployment

For new databases, run `npm run seed`; it creates the schema and sample data
without dropping tables. For the original schema, take a verified backup and
run `migrations/001_tenant_isolation.sql` once. The migration only maps the
starter data's reviewed `pouch.io` and `velocity.com` domains; it aborts when
it encounters an unmapped user. For real customer data, review/replace that
mapping with an operator-verified mapping before applying the migration.

Legacy projects have no ownership relationship in the old schema and are
quarantined in `legacy-unassigned`. An operator must confirm their tenant
before assigning them. Keep them quarantined until that review is complete.
Run the app only after validating the data mapping and composite constraints.

Production requires `DATABASE_URL`, a 32-byte-or-stronger `JWT_SECRET`,
`JWT_ISSUER`, `JWT_AUDIENCE`, `NODE_ENV=production`, and the platform `PORT`.
The server checks database connectivity before listening. The API does not
enable cross-origin access by default; if browser access is added, configure
an explicit origin allowlist rather than wildcard CORS.
