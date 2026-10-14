declare namespace Cloudflare {
  interface Env {
    DB?: D1Database;
    BUCKET?: R2Bucket;
    DB_GATEWAY_URL?: string;
    DB_GATEWAY_SECRET?: string;
    // Shared secret of the sign-in program: it alone may report sign-ins and sign-outs of any login to /api/activity.
    PAYROLL_INTERNAL_KEY?: string;
  }
}
