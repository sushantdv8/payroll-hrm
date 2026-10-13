// The database the tests run on: PGlite (PostgreSQL inside Node.js) by default, or a real PostgreSQL server when
// TEST_DATABASE_URL is set, e.g.  set TEST_DATABASE_URL=postgres://payroll:<password>@127.0.0.1:5432/payroll_test
// That database is emptied first, so its name must contain "test".
import { pgDriver, pgliteDriver } from '../lib/drivers.mjs';

export async function testDriver() {
  const url = process.env.TEST_DATABASE_URL;
  if (!url) return pgliteDriver();
  if (!/test/i.test(new URL(url).pathname)) throw new Error('TEST_DATABASE_URL must point at a database whose name contains "test": it is emptied before the tests.');
  const driver = await pgDriver(url);
  await driver.exec('DROP SCHEMA public CASCADE; CREATE SCHEMA public;');
  return driver;
}
