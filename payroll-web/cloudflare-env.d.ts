declare namespace Cloudflare {
  interface Env {
    DB?: D1Database;
    BUCKET?: R2Bucket;
    DB_GATEWAY_URL?: string;
    DB_GATEWAY_SECRET?: string;
    // Shared secret of the sign-in program: it alone may report sign-ins and sign-outs of any login to /api/activity.
    PAYROLL_INTERNAL_KEY?: string;
    // '1' on a server that reaches the Biometric Attendance app of the office through the office link (deploy/signin-layer/link.mjs).
    PAYROLL_BIO_LINK?: string;
    // '1' in the single-process hosting edition (deploy/hostinger/main.mjs): there is no Biometric Attendance app next to the server, so addresses that people type in are never called.
    PAYROLL_HOSTED?: string;
  }
}
