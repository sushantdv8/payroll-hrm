-- Run once as the PostgreSQL administrator, after replacing the password:
--     sudo -u postgres psql -f create-database.sql
-- (Plesk users can create the same user and database in Tools & Settings > Database Servers instead.)

CREATE USER payroll WITH PASSWORD 'CHANGE_ME_DB_PASSWORD';          -- letters and digits only: it goes into DATABASE_URL
CREATE DATABASE payroll OWNER payroll ENCODING 'UTF8' TEMPLATE template0;

-- The software keeps two workspaces with identical table names. If you also want the editable one, give it its own database
-- (and its own gateway + application instance, ports 5791 / 3001, with their own env files):
-- CREATE DATABASE payroll_editable OWNER payroll ENCODING 'UTF8' TEMPLATE template0;

-- Local password login must be allowed in pg_hba.conf (the default on Ubuntu already has this line):
--     host  all  all  127.0.0.1/32  scram-sha-256
