CREATE TABLE IF NOT EXISTS hr_records(id TEXT PRIMARY KEY,owner TEXT NOT NULL,dataset TEXT NOT NULL,module TEXT NOT NULL,employee_id TEXT NOT NULL DEFAULT '',unit TEXT NOT NULL DEFAULT '',status TEXT NOT NULL DEFAULT 'draft',data TEXT NOT NULL,created_by TEXT NOT NULL,revision INTEGER NOT NULL DEFAULT 1,deleted INTEGER NOT NULL DEFAULT 0,updated_at TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS hr_records_scope ON hr_records(owner,dataset,module,deleted);
CREATE INDEX IF NOT EXISTS hr_records_employee ON hr_records(owner,employee_id,module,status);
CREATE TABLE IF NOT EXISTS hr_audit(id TEXT PRIMARY KEY,owner TEXT NOT NULL,dataset TEXT NOT NULL,record_id TEXT NOT NULL,module TEXT NOT NULL,actor TEXT NOT NULL,action TEXT NOT NULL,data TEXT NOT NULL,created_at TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS hr_audit_scope ON hr_audit(owner,dataset,created_at);
CREATE TABLE IF NOT EXISTS hr_settings(owner TEXT NOT NULL,dataset TEXT NOT NULL,data TEXT NOT NULL,revision INTEGER NOT NULL,PRIMARY KEY(owner,dataset));
CREATE TABLE IF NOT EXISTS hr_users(owner TEXT NOT NULL,username TEXT NOT NULL,password_hash TEXT NOT NULL,salt TEXT NOT NULL,data TEXT NOT NULL,revision INTEGER NOT NULL,active INTEGER NOT NULL DEFAULT 1,PRIMARY KEY(owner,username));
CREATE TABLE IF NOT EXISTS hr_write_guard(id TEXT PRIMARY KEY,ok INTEGER NOT NULL CHECK(ok=1));
