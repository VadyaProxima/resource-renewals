CREATE TABLE workspaces (id text PRIMARY KEY, name text NOT NULL UNIQUE);
CREATE TABLE users (
  id uuid PRIMARY KEY, login text NOT NULL UNIQUE, name text NOT NULL, password_hash text NOT NULL,
  workspace_id text NOT NULL REFERENCES workspaces(id), can_create boolean NOT NULL, can_approve boolean NOT NULL
);
CREATE TABLE sessions (token_hash text PRIMARY KEY, user_id uuid NOT NULL REFERENCES users(id), expires_at timestamptz NOT NULL);
CREATE INDEX sessions_expiry ON sessions(expires_at);
CREATE TABLE resources (
  id text PRIMARY KEY, workspace_id text NOT NULL REFERENCES workspaces(id), name text NOT NULL,
  expires_on date NOT NULL, amount_minor integer NOT NULL CHECK(amount_minor >= 0), currency text NOT NULL CHECK(currency = 'RUB'),
  UNIQUE(id, workspace_id)
);
CREATE TYPE renewal_status AS ENUM ('pending','rejected','processing','completed','attention');
CREATE TABLE renewals (
  id uuid PRIMARY KEY, resource_id text NOT NULL, workspace_id text NOT NULL,
  created_by uuid NOT NULL REFERENCES users(id), approved_by uuid REFERENCES users(id),
  status renewal_status NOT NULL DEFAULT 'pending', old_expires_on date NOT NULL, new_expires_on date NOT NULL,
  amount_minor integer NOT NULL CHECK(amount_minor >= 0), currency text NOT NULL CHECK(currency = 'RUB'),
  operation_key text NOT NULL UNIQUE, provider_operation_id text UNIQUE, created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY(resource_id,workspace_id) REFERENCES resources(id,workspace_id),
  CHECK(new_expires_on = old_expires_on + 30), CHECK(approved_by IS NULL OR approved_by <> created_by),
  CHECK(status <> 'completed' OR provider_operation_id IS NOT NULL)
);
CREATE UNIQUE INDEX one_active_renewal ON renewals(resource_id) WHERE status IN ('pending','processing','attention');
CREATE INDEX renewals_workspace_created ON renewals(workspace_id,created_at DESC);
CREATE TABLE renewal_history (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY, renewal_id uuid NOT NULL REFERENCES renewals(id),
  actor_id uuid REFERENCES users(id), from_status renewal_status, to_status renewal_status NOT NULL,
  message text NOT NULL, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX renewal_history_request ON renewal_history(renewal_id,id);
CREATE TABLE renewal_jobs (
  renewal_id uuid PRIMARY KEY REFERENCES renewals(id), post_attempts integer NOT NULL DEFAULT 0 CHECK(post_attempts >= 0),
  cycle_attempts integer NOT NULL DEFAULT 0 CHECK(cycle_attempts BETWEEN 0 AND 3),
  next_attempt_at timestamptz, done boolean NOT NULL DEFAULT false
);
CREATE INDEX jobs_due ON renewal_jobs(next_attempt_at) WHERE NOT done;
