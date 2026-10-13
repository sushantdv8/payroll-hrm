// The app reads its settings with `import {env} from 'cloudflare:workers'`. Node.js does not know that module, so here it is
// simply the process environment (DB_GATEWAY_URL, DB_GATEWAY_SECRET). With these two set the app stores everything in
// PostgreSQL through the gateway and needs no Cloudflare database or bucket.
export async function resolve(specifier, context, nextResolve) {
  if (specifier === 'cloudflare:workers') return { url: 'data:text/javascript,export const env = process.env;', shortCircuit: true };
  return nextResolve(specifier, context);
}
