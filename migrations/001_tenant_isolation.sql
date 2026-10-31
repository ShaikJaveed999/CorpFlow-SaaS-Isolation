-- One-time migration from the original schema.sql.
-- Run only after taking a database backup. Existing projects are quarantined
-- under legacy-unassigned because the old schema contains no ownership data.
BEGIN;

CREATE TABLE tenants (
    id BIGSERIAL PRIMARY KEY,
    name VARCHAR(100) NOT NULL,
    slug VARCHAR(150) NOT NULL UNIQUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

INSERT INTO tenants (name, slug) VALUES
    ('Pouch.io', 'pouch.io'),
    ('Velocity', 'velocity.com'),
    ('Unassigned legacy projects', 'legacy-unassigned');

DO $$
BEGIN
    IF EXISTS (
        SELECT 1
        FROM users
        WHERE email IS NULL
           OR lower(email) !~ '^[^@]+@(pouch\.io|velocity\.com)$'
    ) THEN
        RAISE EXCEPTION
            'User tenant mapping is incomplete. Add a reviewed tenant mapping before migrating.';
    END IF;
END;
$$;

ALTER TABLE users ADD COLUMN tenant_id BIGINT;
ALTER TABLE users ADD COLUMN manager_id BIGINT;

UPDATE users
SET tenant_id = (
    SELECT tenants.id
    FROM tenants
    WHERE tenants.slug = lower(split_part(users.email, '@', 2))
);

UPDATE users
SET role = CASE lower(COALESCE(role, ''))
    WHEN 'admin' THEN 'ADMIN'
    WHEN 'manager' THEN 'MANAGER'
    ELSE 'USER'
END;

ALTER TABLE users ALTER COLUMN tenant_id SET NOT NULL;
ALTER TABLE users ALTER COLUMN role SET NOT NULL;
ALTER TABLE users ALTER COLUMN role SET DEFAULT 'USER';
ALTER TABLE users
    ADD CONSTRAINT users_role_check
    CHECK (role IN ('ADMIN', 'MANAGER', 'USER'));
ALTER TABLE users
    ADD CONSTRAINT users_tenant_id_fkey
    FOREIGN KEY (tenant_id) REFERENCES tenants(id);
ALTER TABLE users
    ADD CONSTRAINT users_tenant_id_id_key UNIQUE (tenant_id, id);
ALTER TABLE users
    ADD CONSTRAINT users_tenant_email_key UNIQUE (tenant_id, email);
ALTER TABLE users
    ADD CONSTRAINT users_tenant_manager_fkey
    FOREIGN KEY (tenant_id, manager_id) REFERENCES users(tenant_id, id);

ALTER TABLE projects ADD COLUMN tenant_id BIGINT;
UPDATE projects
SET tenant_id = (SELECT id FROM tenants WHERE slug = 'legacy-unassigned');
ALTER TABLE projects ALTER COLUMN tenant_id SET NOT NULL;
ALTER TABLE projects
    ADD CONSTRAINT projects_tenant_id_fkey
    FOREIGN KEY (tenant_id) REFERENCES tenants(id);
ALTER TABLE projects
    ADD CONSTRAINT projects_tenant_id_id_key UNIQUE (tenant_id, id);

ALTER TABLE billing_details ADD COLUMN tenant_id BIGINT;
UPDATE billing_details
SET tenant_id = COALESCE(
    (SELECT users.tenant_id FROM users WHERE users.id = billing_details.user_id),
    (SELECT tenants.id FROM tenants WHERE tenants.slug = 'legacy-unassigned')
);
ALTER TABLE billing_details ALTER COLUMN tenant_id SET NOT NULL;
ALTER TABLE billing_details
    DROP CONSTRAINT IF EXISTS billing_details_user_id_fkey;
ALTER TABLE billing_details
    ADD CONSTRAINT billing_details_tenant_id_fkey
    FOREIGN KEY (tenant_id) REFERENCES tenants(id);
ALTER TABLE billing_details
    ADD CONSTRAINT billing_details_tenant_user_fkey
    FOREIGN KEY (tenant_id, user_id) REFERENCES users(tenant_id, id);

CREATE TABLE project_assignments (
    tenant_id BIGINT NOT NULL REFERENCES tenants(id),
    project_id INTEGER NOT NULL,
    user_id INTEGER NOT NULL,
    assigned_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (tenant_id, project_id, user_id),
    FOREIGN KEY (tenant_id, project_id) REFERENCES projects(tenant_id, id),
    FOREIGN KEY (tenant_id, user_id) REFERENCES users(tenant_id, id)
);

CREATE INDEX users_tenant_manager_idx ON users (tenant_id, manager_id);
CREATE INDEX projects_tenant_idx ON projects (tenant_id);
CREATE INDEX billing_details_tenant_user_idx
    ON billing_details (tenant_id, user_id);
CREATE INDEX project_assignments_tenant_user_project_idx
    ON project_assignments (tenant_id, user_id, project_id);

COMMIT;

-- After reviewing ownership records, move each legacy project from
-- 'legacy-unassigned' to its confirmed tenant. Do not infer ownership from
-- project names or descriptions. For example:
-- UPDATE projects
-- SET tenant_id = (SELECT id FROM tenants WHERE slug = 'confirmed-customer')
-- WHERE id = <confirmed-project-id>;
