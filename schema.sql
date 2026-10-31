-- Fresh-install schema and repeatable demonstration seed data.
-- Existing installations should use migrations/001_tenant_isolation.sql.

CREATE TABLE IF NOT EXISTS tenants (
    id BIGSERIAL PRIMARY KEY,
    name VARCHAR(100) NOT NULL,
    slug VARCHAR(150) NOT NULL UNIQUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS users (
    id BIGSERIAL PRIMARY KEY,
    tenant_id BIGINT NOT NULL REFERENCES tenants(id),
    full_name VARCHAR(100) NOT NULL,
    email VARCHAR(150),
    password_hash VARCHAR(255) NOT NULL,
    role VARCHAR(20) NOT NULL DEFAULT 'USER'
        CHECK (role IN ('ADMIN', 'MANAGER', 'USER')),
    salary DECIMAL(10,2),
    manager_id BIGINT,
    UNIQUE (tenant_id, id),
    UNIQUE (tenant_id, email),
    FOREIGN KEY (tenant_id, manager_id) REFERENCES users(tenant_id, id)
);

CREATE TABLE IF NOT EXISTS projects (
    id BIGSERIAL PRIMARY KEY,
    tenant_id BIGINT NOT NULL REFERENCES tenants(id),
    name VARCHAR(100) NOT NULL,
    description TEXT,
    status VARCHAR(20) NOT NULL DEFAULT 'active',
    budget DECIMAL(12,2),
    UNIQUE (tenant_id, id)
);

CREATE TABLE IF NOT EXISTS billing_details (
    id BIGSERIAL PRIMARY KEY,
    tenant_id BIGINT NOT NULL REFERENCES tenants(id),
    user_id BIGINT NOT NULL,
    card_holder_name VARCHAR(100),
    card_last4 VARCHAR(4),
    expiry_date VARCHAR(5),
    billing_address TEXT,
    FOREIGN KEY (tenant_id, user_id) REFERENCES users(tenant_id, id)
);

CREATE TABLE IF NOT EXISTS project_assignments (
    tenant_id BIGINT NOT NULL REFERENCES tenants(id),
    project_id BIGINT NOT NULL,
    user_id BIGINT NOT NULL,
    assigned_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (tenant_id, project_id, user_id),
    FOREIGN KEY (tenant_id, project_id) REFERENCES projects(tenant_id, id),
    FOREIGN KEY (tenant_id, user_id) REFERENCES users(tenant_id, id)
);

CREATE INDEX IF NOT EXISTS users_tenant_manager_idx
    ON users (tenant_id, manager_id);
CREATE INDEX IF NOT EXISTS projects_tenant_idx
    ON projects (tenant_id);
CREATE INDEX IF NOT EXISTS billing_details_tenant_user_idx
    ON billing_details (tenant_id, user_id);
CREATE INDEX IF NOT EXISTS project_assignments_tenant_user_project_idx
    ON project_assignments (tenant_id, user_id, project_id);

INSERT INTO tenants (name, slug) VALUES
    ('Pouch.io', 'pouch.io'),
    ('Velocity', 'velocity.com'),
    ('Unassigned legacy projects', 'legacy-unassigned')
ON CONFLICT (slug) DO NOTHING;

INSERT INTO users (tenant_id, full_name, email, password_hash, role, salary)
SELECT tenants.id, seed.full_name, seed.email, seed.password_hash, seed.role, seed.salary
FROM (VALUES
    ('pouch.io', 'Alice Johnson', 'alice@pouch.io', 'pbkdf2:sha256:600000$hasher$81726a', 'ADMIN', 125000.00::DECIMAL),
    ('pouch.io', 'Bob Smith', 'bob@pouch.io', 'pbkdf2:sha256:600000$hasher$81726b', 'MANAGER', 95000.00::DECIMAL),
    ('velocity.com', 'Charlie Davis', 'charlie@velocity.com', 'pbkdf2:sha256:600000$hasher$81726c', 'ADMIN', 140000.00::DECIMAL),
    ('velocity.com', 'David Miller', 'david@velocity.com', 'pbkdf2:sha256:600000$hasher$81726d', 'USER', 75000.00::DECIMAL)
) AS seed(tenant_slug, full_name, email, password_hash, role, salary)
JOIN tenants ON tenants.slug = seed.tenant_slug
WHERE true
ON CONFLICT (tenant_id, email) DO NOTHING;

INSERT INTO projects (tenant_id, name, description, status, budget)
SELECT tenants.id, seed.name, seed.description, seed.status, seed.budget
FROM (VALUES
    ('pouch.io', 'Pouch Portal', 'Customer portal for Pouch.io', 'active', 50000.00::DECIMAL),
    ('velocity.com', 'Velocity Engine', 'Back-end engine for Velocity', 'active', 120000.00::DECIMAL),
    ('legacy-unassigned', 'Secret R&D', NULL, 'inactive', 250000.00::DECIMAL)
) AS seed(tenant_slug, name, description, status, budget)
JOIN tenants ON tenants.slug = seed.tenant_slug
WHERE NOT EXISTS (
    SELECT 1 FROM projects existing
    WHERE existing.tenant_id = tenants.id AND existing.name = seed.name
);

INSERT INTO project_assignments (tenant_id, project_id, user_id)
SELECT projects.tenant_id, projects.id, users.id
FROM projects
JOIN users ON users.tenant_id = projects.tenant_id
WHERE (projects.name = 'Pouch Portal' AND users.email = 'bob@pouch.io')
   OR (projects.name = 'Velocity Engine' AND users.email = 'david@velocity.com')
ON CONFLICT DO NOTHING;

INSERT INTO billing_details
    (tenant_id, user_id, card_holder_name, card_last4, expiry_date, billing_address)
SELECT users.tenant_id, users.id, seed.card_holder_name, seed.card_last4,
       seed.expiry_date, seed.billing_address
FROM (VALUES
    ('alice@pouch.io', 'Alice Johnson', '4242', '12/28', '123 Tech Lane, SF'),
    ('charlie@velocity.com', 'Charlie Davis', '9182', '08/26', '789 Velocity Rd, NY')
) AS seed(email, card_holder_name, card_last4, expiry_date, billing_address)
JOIN users ON users.email = seed.email
WHERE NOT EXISTS (
    SELECT 1 FROM billing_details existing
    WHERE existing.tenant_id = users.tenant_id AND existing.user_id = users.id
);
