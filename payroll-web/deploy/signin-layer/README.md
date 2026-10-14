# Sign-in layer for a server

The application has no login of its own. It trusts identity headers (`oai-authenticated-user-*`) that a sign-in layer adds after a successful
login, and refuses every request without them. The Windows edition has its own layer (`installer/launcher.mjs`); **this is the one for a server**.
Plain Node.js (22.13 or newer, tested on 24), no packages.

```
browser --HTTPS--> nginx --> sign-in layer (127.0.0.1:8080) --> application (127.0.0.1:3000) --> db-gateway --> PostgreSQL
```

Nothing of the application is reachable before a login. The layer is the only thing that may talk to port 3000 from outside the server's own
processes, so port 3000 (and 5790, 5432) must never be opened in the firewall.

## What it does

* **Sign-in page** (served for every page request without a session): Login ID and password, then the company / year and (optionally) the location to open.
  `admin01` (the Super Admin) is checked against `ADMIN_PASSWORD_HASH` (scrypt); every other login is checked by the application (`POST /api/hr-login`), which keeps salted PBKDF2 hashes.
  One message for every mistake ("Wrong ID or password."); the list of companies is shown only after the password was accepted, and only the companies the login has.
* **Session**: a random 256-bit token in a cookie (`__Host-pw_sid`: `Secure`, `HttpOnly`, `SameSite=Strict`, `Path=/`), kept in this process's memory.
  Idle limit 120 minutes, absolute limit 12 hours, at most 10 sessions per login. **A restart of the layer signs everybody out.** One session per browser: to work in two companies at the same time use two browsers.
* **Every request to the application** gets the identity headers (`id=local_seedy`, `username`, `mode=editable`, request path and method). Any `oai-authenticated-user-*`, `x-payroll-internal`,
  `x-forwarded-*`, `x-real-ip`, `forwarded` header sent by a browser is dropped, and so is the layer's own session cookie. Changing requests (`POST` ...) need `Origin` = `PUBLIC_ORIGIN`
  (the application then sees its own origin, which is what its own check wants).
* **Limits**: 5 wrong passwords for one address + login lock that pair for 1 minute (doubling up to 15 minutes); 25 wrong attempts from one address lock the address for 10 minutes (up to an hour).
  An IPv6 address counts as its whole /64. A locked address is refused before its request body is read; sign-in bodies are at most 4 KB and must arrive within 10 seconds.
  Two sign-in attempts at a time per address; the expensive part waits in a line (admin01's scrypt: 3 at a time, other logins: 8 at a time, the rest wait up to 8 seconds), and the two lines do not block each other.
  Locks are never dropped to make room (only idle entries are). nginx adds a request limit on `/__login` in front of it (`docs/deploy-kit/nginx`).
  A flood of guesses from very many addresses can still delay new sign-ins (people who are already signed in are not affected): the firewall of the hosting provider and fail2ban are the next line.
* **Activity log**: sign-ins, failed sign-ins (only for logins that exist, so bots cannot fill the database; one per address and login a minute, at most 30 a minute - 300 real events a minute have a budget of their own)
  and sign-outs are written through `POST /api/activity` with `PAYROLL_INTERNAL_KEY`.
* **The application cannot stop the layer**: whatever the application answers (wrong shapes, errors, out-of-range status codes) is checked; a route that cannot answer says 503 / 502. Stray errors are logged, not fatal.
* **What is forwarded**: the path of the identity header and the path sent to the application are the same normalized string (dots resolved, a backslash is refused); an `Origin` other than `PUBLIC_ORIGIN` is refused on every method;
  a redirect of the application is kept on this site (its own address becomes `PUBLIC_ORIGIN`, anything foreign becomes `/`).
* `GET /__ping` answers `ok` (health check). `GET /signout-with-chatgpt` signs out (the application's Exit link uses this address). `GET /__workspace` tells the screens the company and location chosen at sign-in.

## Settings (environment variables, see `docs/deploy-kit/env/layer.env.example`)

| Variable | Meaning |
|---|---|
| `PUBLIC_ORIGIN` | The address people type, e.g. `https://hrm.example.com` (no path). **Required.** Requests for any other host name get 421. |
| `ADMIN_PASSWORD_HASH` | scrypt hash of the Super Admin password. **Required**, the layer does not start without it. Make it with `node make-admin-hash.mjs --write-to /etc/payroll/layer.env` (or `--clipboard` on Windows / macOS, to paste the hash into a hosting panel). |
| `PAYROLL_INTERNAL_KEY` | Same value as in the application's environment: lets the layer write sign-ins and sign-outs to the activity log. Without it those entries are not written. |
| `UPSTREAM` | The application, default `http://127.0.0.1:3000`. |
| `HOST`, `PORT` | Where the layer listens, default `127.0.0.1:8080`. Keep the host on 127.0.0.1 (nginx is in front). |
| `IDLE_MINUTES`, `ABSOLUTE_HOURS` | Session limits, defaults 120 and 12. |
| `COOKIE_SECURE` | Default: on when `PUBLIC_ORIGIN` is https. `0` only for tests over http. |
| `TRUST_PROXY` | Default on: the visitor's address is taken from `X-Real-IP` when the connection comes from this server (nginx). `0` to use the socket address. |

## Run and test

```bash
PUBLIC_ORIGIN=https://hrm.example.com ADMIN_PASSWORD_HASH='scrypt$...' PAYROLL_INTERNAL_KEY=... node server.mjs
node --test deploy/signin-layer/layer.test.mjs        # 23 tests against a stand-in for the application (from payroll-web/)
```

The unit tests start the layer in the same process with a small stand-in for the application that checks what the real one checks (origin, identity headers, internal key), and also misbehaves on purpose
(wrong shapes, errors, an invalid status code, slow answers); one test starts the real process and checks that it survives. An independent security review (a second reader that tried to break the layer with raw sockets) found
9 points - the process crash on a malformed answer, sign-in capacity, lock eviction, the shared audit budget, raw versus normalized path, GET without an Origin check, noisy logs, the `--env-file` name clash, redirect rewriting - all fixed and covered by tests.
It was also tested end to end in a browser against the real application on Node with PostgreSQL (sign-in page, company choice, large lists, changing requests, sign-out, a limited login with hidden menus, activity log).

## Not covered

* No two-factor authentication, no password reset, no change of the Super Admin password except by running `make-admin-hash.mjs` again (and restarting the layer).
* Sessions are in memory (a restart signs everybody out); several layer processes behind a load balancer are not supported.
* The Windows edition's "original workspace" (a second, read-only copy of the data) is not offered: the server runs the editable workspace only.
