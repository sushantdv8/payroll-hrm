// Run the built app on plain Node.js (no Cloudflare workerd / wrangler), for a server:
//   set DB_GATEWAY_URL=http://127.0.0.1:5790 and DB_GATEWAY_SECRET=<secret>   (see ..\..\..\db-gateway\README.md)
//   node --import ./deploy/node-runner/register.mjs node_modules/vinext/dist/cli.js start -p 3000 -H 127.0.0.1
// (npm run start:node does exactly this; the port comes from -p or the PORT variable.)
import { register } from 'node:module';
register('./hooks.mjs', import.meta.url);
