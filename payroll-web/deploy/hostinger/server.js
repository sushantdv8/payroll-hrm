// Entry file of the Node.js web app on the hosting (set "Entry file" to deploy/hostinger/server.js). The real work is in main.mjs.
import('./main.mjs').catch(error => { console.error('[payroll] cannot start:', error && error.stack || error); process.exit(1); });
