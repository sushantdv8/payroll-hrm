declare namespace Cloudflare {
  interface Env {
    DB?: D1Database;
    BUCKET?: R2Bucket;
    DB_GATEWAY_URL?: string;
    DB_GATEWAY_SECRET?: string;
  }
}
