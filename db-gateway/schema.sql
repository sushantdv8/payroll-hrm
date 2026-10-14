-- PostgreSQL schema of Payroll Workspace (the final state of the SQLite migrations 0000-0005 plus the object store that
-- replaces Cloudflare R2). Safe to run again: everything is CREATE ... IF NOT EXISTS.
-- JSON documents stay in TEXT columns exactly as in SQLite; the gateway reads them with the json type.

CREATE TABLE IF NOT EXISTS employees (
  id TEXT COLLATE "C" PRIMARY KEY, owner TEXT COLLATE "C" NOT NULL, paycode TEXT COLLATE "C" NOT NULL, dataset TEXT COLLATE "C" NOT NULL DEFAULT 'manual', import_id TEXT COLLATE "C",
  data TEXT COLLATE "C" NOT NULL, revision INTEGER NOT NULL DEFAULT 1, deleted INTEGER NOT NULL DEFAULT 0, updated_at TEXT COLLATE "C" NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_employees_owner_dataset_paycode ON employees (owner, dataset, paycode);
CREATE INDEX IF NOT EXISTS idx_employees_owner_deleted ON employees (owner, deleted);

CREATE TABLE IF NOT EXISTS holidays (
  id TEXT COLLATE "C" PRIMARY KEY, owner TEXT COLLATE "C" NOT NULL, dataset TEXT COLLATE "C" NOT NULL DEFAULT 'manual', data TEXT COLLATE "C" NOT NULL,
  revision INTEGER NOT NULL DEFAULT 1, deleted INTEGER NOT NULL DEFAULT 0, updated_at TEXT COLLATE "C" NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_holidays_owner_deleted ON holidays (owner, deleted);

CREATE TABLE IF NOT EXISTS attendance (
  id TEXT COLLATE "C" PRIMARY KEY, owner TEXT COLLATE "C" NOT NULL, employee_id TEXT COLLATE "C" NOT NULL REFERENCES employees (id), month TEXT COLLATE "C" NOT NULL,
  import_id TEXT COLLATE "C", data TEXT COLLATE "C" NOT NULL, revision INTEGER NOT NULL DEFAULT 1, updated_at TEXT COLLATE "C" NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_attendance_owner_employee_month ON attendance (owner, employee_id, month);
CREATE INDEX IF NOT EXISTS idx_attendance_owner_month ON attendance (owner, month);

CREATE TABLE IF NOT EXISTS backup_settings (
  owner TEXT COLLATE "C" PRIMARY KEY, import_id TEXT COLLATE "C" NOT NULL, data TEXT COLLATE "C" NOT NULL, updated_at TEXT COLLATE "C" NOT NULL
);

CREATE TABLE IF NOT EXISTS salary_snapshots (
  id TEXT COLLATE "C" PRIMARY KEY, owner TEXT COLLATE "C" NOT NULL, employee_id TEXT COLLATE "C" NOT NULL REFERENCES employees (id), month TEXT COLLATE "C" NOT NULL,
  import_id TEXT COLLATE "C", data TEXT COLLATE "C" NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_salary_owner_employee_month ON salary_snapshots (owner, employee_id, month);
CREATE INDEX IF NOT EXISTS idx_salary_owner_month ON salary_snapshots (owner, month);

CREATE TABLE IF NOT EXISTS source_datasets (
  id TEXT COLLATE "C" PRIMARY KEY, owner TEXT COLLATE "C" NOT NULL, dataset_key TEXT COLLATE "C" NOT NULL, manifest TEXT COLLATE "C" NOT NULL, manifest_hash TEXT COLLATE "C" NOT NULL,
  status TEXT COLLATE "C" NOT NULL DEFAULT 'staging', next_sequence INTEGER NOT NULL DEFAULT 0, updated_at TEXT COLLATE "C" NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_source_owner_key ON source_datasets (owner, dataset_key);

CREATE TABLE IF NOT EXISTS source_employee_links (
  id TEXT COLLATE "C" PRIMARY KEY, owner TEXT COLLATE "C" NOT NULL, dataset TEXT COLLATE "C" NOT NULL, source_key TEXT COLLATE "C" NOT NULL,
  employee_id TEXT COLLATE "C" NOT NULL REFERENCES employees (id), profile TEXT COLLATE "C" NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_source_employee_key ON source_employee_links (owner, dataset, source_key);
CREATE UNIQUE INDEX IF NOT EXISTS idx_source_employee_id ON source_employee_links (owner, dataset, employee_id);

CREATE TABLE IF NOT EXISTS source_packets (
  id TEXT COLLATE "C" PRIMARY KEY, owner TEXT COLLATE "C" NOT NULL, session_id TEXT COLLATE "C" NOT NULL, sequence INTEGER NOT NULL, hash TEXT COLLATE "C" NOT NULL,
  kind TEXT COLLATE "C" NOT NULL, row_count INTEGER NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_source_packet ON source_packets (owner, session_id, sequence);

CREATE TABLE IF NOT EXISTS source_parts (
  id TEXT COLLATE "C" PRIMARY KEY, owner TEXT COLLATE "C" NOT NULL, session_id TEXT COLLATE "C" NOT NULL, table_name TEXT COLLATE "C" NOT NULL, part INTEGER NOT NULL,
  hash TEXT COLLATE "C" NOT NULL, row_count INTEGER NOT NULL, object_key TEXT COLLATE "C" NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_source_part ON source_parts (owner, session_id, table_name, part);

CREATE TABLE IF NOT EXISTS master_records (
  id TEXT COLLATE "C" PRIMARY KEY, owner TEXT COLLATE "C" NOT NULL, dataset TEXT COLLATE "C" NOT NULL, table_name TEXT COLLATE "C" NOT NULL, record_key TEXT COLLATE "C" NOT NULL,
  data TEXT COLLATE "C" NOT NULL, origin TEXT COLLATE "C" NOT NULL, revision INTEGER NOT NULL DEFAULT 1, deleted INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT COLLATE "C" NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_master_record ON master_records (owner, dataset, table_name, record_key);

-- HR module (created by the app on first use in SQLite; created here up front)
CREATE TABLE IF NOT EXISTS hr_records (
  id TEXT COLLATE "C" PRIMARY KEY, owner TEXT COLLATE "C" NOT NULL, dataset TEXT COLLATE "C" NOT NULL, module TEXT COLLATE "C" NOT NULL, employee_id TEXT COLLATE "C" NOT NULL DEFAULT '',
  unit TEXT COLLATE "C" NOT NULL DEFAULT '', status TEXT COLLATE "C" NOT NULL DEFAULT 'draft', data TEXT COLLATE "C" NOT NULL, created_by TEXT COLLATE "C" NOT NULL,
  revision INTEGER NOT NULL DEFAULT 1, deleted INTEGER NOT NULL DEFAULT 0, updated_at TEXT COLLATE "C" NOT NULL
);
CREATE INDEX IF NOT EXISTS hr_records_scope ON hr_records (owner, dataset, module, deleted);
CREATE INDEX IF NOT EXISTS hr_records_employee ON hr_records (owner, employee_id, module, status);
CREATE TABLE IF NOT EXISTS hr_audit (
  id TEXT COLLATE "C" PRIMARY KEY, owner TEXT COLLATE "C" NOT NULL, dataset TEXT COLLATE "C" NOT NULL, record_id TEXT COLLATE "C" NOT NULL, module TEXT COLLATE "C" NOT NULL,
  actor TEXT COLLATE "C" NOT NULL, action TEXT COLLATE "C" NOT NULL, data TEXT COLLATE "C" NOT NULL, created_at TEXT COLLATE "C" NOT NULL
);
CREATE INDEX IF NOT EXISTS hr_audit_scope ON hr_audit (owner, dataset, created_at);
CREATE TABLE IF NOT EXISTS hr_settings (
  owner TEXT COLLATE "C" NOT NULL, dataset TEXT COLLATE "C" NOT NULL, data TEXT COLLATE "C" NOT NULL, revision INTEGER NOT NULL, PRIMARY KEY (owner, dataset)
);
CREATE TABLE IF NOT EXISTS hr_users (
  owner TEXT COLLATE "C" NOT NULL, username TEXT COLLATE "C" NOT NULL, password_hash TEXT COLLATE "C" NOT NULL, salt TEXT COLLATE "C" NOT NULL, data TEXT COLLATE "C" NOT NULL,
  revision INTEGER NOT NULL, active INTEGER NOT NULL DEFAULT 1, PRIMARY KEY (owner, username)
);
CREATE TABLE IF NOT EXISTS hr_write_guard (id TEXT COLLATE "C" PRIMARY KEY, ok INTEGER NOT NULL CHECK (ok = 1));
-- Activity log of every login (sign-ins, screens opened, records changed, prints, refused attempts); rows are only ever added.
CREATE TABLE IF NOT EXISTS activity_log (
  id TEXT COLLATE "C" PRIMARY KEY, owner TEXT COLLATE "C" NOT NULL, ts TEXT COLLATE "C" NOT NULL, actor TEXT COLLATE "C" NOT NULL, role TEXT COLLATE "C" NOT NULL DEFAULT '',
  dataset TEXT COLLATE "C" NOT NULL DEFAULT '', kind TEXT COLLATE "C" NOT NULL, screen TEXT COLLATE "C" NOT NULL DEFAULT '', summary TEXT COLLATE "C" NOT NULL,
  detail TEXT COLLATE "C" NOT NULL DEFAULT '', ok INTEGER NOT NULL DEFAULT 1
);
CREATE INDEX IF NOT EXISTS activity_log_actor ON activity_log (owner, actor, ts);
CREATE INDEX IF NOT EXISTS activity_log_ts ON activity_log (owner, ts);

-- Object store (what Cloudflare R2 held): source archive parts, month indexes, employee photos, HR documents.
CREATE TABLE IF NOT EXISTS objects (
  key TEXT COLLATE "C" PRIMARY KEY, body BYTEA NOT NULL, content_type TEXT COLLATE "C" NOT NULL DEFAULT 'application/octet-stream',
  size BIGINT NOT NULL, updated_at TEXT COLLATE "C" NOT NULL
);
