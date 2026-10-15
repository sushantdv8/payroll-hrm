# Biometric machines on a server: the office link

The attendance machines (eSSL KE1, KE2, b4 ...) and the **Biometric Attendance** app that downloads them are in the office, on the office network.
A web server (a hosting, a VPS) cannot reach `192.168.11.x`, so on a server **Utilities › Biometric Machine Setup** would show no machines and
**Time Updation › Biometric Fetch** / **Multi Punch Report** would find no punches. The **office link** fixes that without a VPN and without opening
anything in the office router:

```
Payroll Workspace (server)  <--HTTPS (outgoing calls of the office PC only)--  Server Link  -->  Biometric Attendance app  -->  machines
  Machine Setup, Biometric Fetch,                                              (office PC)        http://127.0.0.1:5180       192.168.11.x:4370
  Multi Punch report ask the link                                              keeps its window open
```

* The **Server Link** (`biometric-web/link/server-link.mjs`, 2 small files, no packages) runs on the office PC next to the Biometric Attendance app.
  It calls the server over HTTPS, asks "is there work for me?" (a long poll, about every 20 seconds), does the work against the local app and sends the answer back.
* The server keeps a small queue in memory. The screens ask it exactly like they ask the app on a Windows PC; they do not know the difference.
* The Windows edition and a server that has the app on the same computer need nothing of this: the link is off unless `BIOMETRIC_LINK_KEY` is set.

## What the screens show

* **Biometric Machine Setup** has an **Office link** box instead of the address box: *Connected to the office computer (Server Link 1.0 on PC-NAME) - last contact 12 seconds ago* (green) or
  *The office computer is not connected* (red, with what to do). The box checks itself every 10 to 15 seconds; **Check again** does it at once. The machine list, ticks per company, Download, Auto download,
  Employee Match and the fetch history work as before.
* When the office computer is away, every screen that needs it says so in one sentence instead of waiting. If a Server Link did reach the server but with a refused key, the box says so too
  (who, from which address, how long the key was), so the first mistake at the office is found at once.
* **Download** of a machine goes through the link. A hosting cuts a request after about a minute; a machine that takes longer goes on downloading in the office and the screen says
  *still downloading at the office - press Refresh in a minute*.

## Set it up

**1. On the server** (once). Make the key and put it into the settings file; the key is not shown, and nothing else is changed:

```bash
node deploy/signin-layer/make-link-key.mjs --write-to ~/payroll-data/app.env      # BIOMETRIC_LINK_KEY=... (file mode 600)
```

Restart the web app (see `payroll-web/deploy/hostinger/README.md`: stop the process, the hosting starts it again). The log then says *office link is switched on*.
The key is 32 to 128 characters of `A-Z a-z 0-9 - _`; it may also be a real environment variable of the web app (`BIOMETRIC_LINK_KEY`).
The office link is part of the **single-process edition** (`payroll-web/deploy/hostinger/main.mjs`: sign-in layer, application and database in one Node process). The multi-process layout of a VPS
(layer and application as separate services) does not use it: there link the office to the VPS with a VPN, or run the Biometric Attendance app where the application can reach it (`docs/DEPLOYMENT-GUIDE.md`, section 9).
To read the key again (to type it on the office PC) run `node deploy/signin-layer/make-link-key.mjs --show ~/payroll-data/app.env` in your own terminal; do not send it by e-mail or chat.

**2. On the office PC** (the one that is on the machines' network and runs the Biometric Attendance app):

1. The Biometric Attendance app must be running there (`Start Biometric.cmd`, or Payroll Workspace / BiometricAttendance_Setup, which start it). Check `http://127.0.0.1:5180` in a browser.
2. Copy the folder `biometric-web/link` (`server-link.mjs`, `Start Server Link.cmd`) anywhere on that PC and double-click **Start Server Link.cmd**.
3. **Without any typing:** put a file `server-link.json` next to `server-link.mjs` with `{"server": "https://hrm.example.com", "key": "<the key>"}` (a package made for this office, for example a ZIP of the folder:
   unpack it and double-click `Start Server Link.cmd`). It is used as it is, wins over older saved settings and nothing is saved on top of it; a wrong key inside it is reported ("ask for a new package").
   It holds the secret: keep the folder private. (`--settings <file>` names another file.) Otherwise the first time it asks for the **server address** (`https://hrm.example.com`, no path; plain `http://`
   is accepted only for this very PC) and the **key** (paste it with a right-click; it is shown, because a hidden prompt switches the Windows console's paste off). It then asks the server
   once: *The server accepted the key.* - or says why not (wrong key: it asks for the key again, up to three times; no internet / wrong address: the reason). The address and key are saved in
   `%LOCALAPPDATA%\BiometricAttendance\server-link.json` (the profile folder of this Windows user). The window then says *Connected to https://...*; keep it open.
   A key that is saved but wrong stays saved: start again with `Start Server Link.cmd --key <key>` to replace it (double-clicking again would use the saved one).
4. To have it start by itself when this Windows user signs in: `Start Server Link.cmd --install-startup` (undo: `--remove-startup`). It then runs minimised; the log is
   `%LOCALAPPDATA%\BiometricAttendance\server-link.log` (it starts a new file at 1 MB).
5. Other options: `--test` (asks the server once whether it is reachable and accepts the key; saves nothing, exit code 0 / 1), `--status` (shows the saved server and the length of the saved key, not the key), `--server`, `--key`, `--app http://127.0.0.1:5180`, `--data <folder>`, `--quiet`. `--key` on the command line stays in the command history: prefer the prompt.

Node.js 22.13 or newer is needed; `Start Server Link.cmd` uses the Node of Payroll Workspace / Biometric Attendance if it is installed, else the one on PATH.

## What the link can do (and nothing else)

Only four requests exist, checked on the server **and again** by the Server Link, so even a hacked server cannot make the office PC call anything else:

| Request to the Biometric Attendance app | Used for |
|---|---|
| `GET /api/state` | the machine list and totals |
| `GET /api/export/logs?from=YYYY-MM-DD&to=YYYY-MM-DD` (real dates, `from` not after `to`, at most 70 days) | punches for Biometric Fetch, Employee Match, Multi Punch |
| `POST /api/devices/<number>/download` | download one machine (it only reads the machine) |
| `PUT /api/settings` with exactly `{"autoMinutes": 0 / 15 / 30 / 60 / 120}` | the automatic download interval |

## Safety

* **The key** is the shared secret (`BIOMETRIC_LINK_KEY`, 256 random bits). Every call of the link carries it (`Authorization: Bearer`); the server compares it in constant time and checks it **first**:
  a call with the right key is never held back by wrong keys that came from the same (shared) address. Wrong keys are answered only with `401 Not allowed.` (no reason), counted per address and locked out
  like wrong passwords (separately from the sign-in, so wrong keys never lock a person out), their connection is closed without reading the body, calls that carry an `Origin` (a browser) are refused and the key is never logged.
  `/__link/*` is the only part of the server that is open without a sign-in; everything else still needs one. (Without a key `/__link/*` answers 404, so the Server Link can tell the person that the link is not switched on.)
* **Only outgoing calls** leave the office; no port is opened. The office PC trusts only the server address it was given (https; plain http only to the same computer) and **never follows a redirect**
  (neither of the server nor of the local app), so a hacked server cannot point it at anything else. What the server sends is checked (a job is a few hundred bytes at most, its id has the shape this server makes) and
  never written to the log as it is.
* **A copy of the key is as strong as a password**: whoever has it could pose as the office computer and feed the server a false machine list or false punches (it can reach nothing else; what comes back is
  reduced to the fields the screens show, numbers are numbers, and odd machine user IDs such as `__proto__` are skipped). The server log says *office link: connected from <address> (<name>)* and
  *now connected from ... - before: ...* when another address starts using the key, so a copy used elsewhere shows up. If the key leaks, make a new one (`make-link-key.mjs --write-to ...` again, restart the web app,
  give the new key to the Server Link); the old one stops working at once.
* **Limits**: answers are limited to 16 MB (gzip) and 64 MB after unpacking, only one answer per request is read at a time, the queue holds at most 20 requests (at most 4 machine lists, 3 punch exports, 2 settings changes
  and 1 download per machine at the same time - a login that keeps asking cannot fill it or hammer the office app), a request waits at most 40 seconds for the office PC, a punch export covers at most 70 days.
* **The machine list shown on the screen** carries only what the screen needs (not the machines' Comm Keys or the network cards of the office PC).
* A key of the wrong shape in the settings does **not** stop payroll: the link stays off and the log says *office link is NOT switched on: ...*.
* On a hosting **without** the key, the machine screens say that the office link is not switched on; the server never calls an address that somebody types into Biometric Machine Setup
  (`PAYROLL_HOSTED`, default on in `deploy/hostinger/main.mjs`).

## If it does not work

| You see | Cause and fix |
|---|---|
| *The office computer is not connected* | The Server Link is not running (start it), the office PC is off or offline, or the key is wrong. The Server Link window / `server-link.log` says which. |
| `The server refused the key` (Server Link window), or on the website under the red line: *A Server Link (name) from <address> reached this server N seconds ago, but the key it sent was refused (N characters; a key made by this server has 43)* | The key is not the one of the server (a typo, a cut-off paste, an old key). Run `Start Server Link.cmd --key <key>` with the key shown by `make-link-key.mjs --show`; `--status` shows how long the saved key is, `--test` checks it. The notice goes away by itself when the right key connects. |
| `The server does not have the office link switched on` | `BIOMETRIC_LINK_KEY` is not set on the server, or the web app was not restarted after setting it. |
| `The server asks to wait` | Too many wrong keys came from this address; wait ten minutes, then correct the key. |
| *The Biometric Attendance app is not running at http://127.0.0.1:5180* | The link is fine but the app on the office PC is not running: start it (keep its window open). |
| *did not pick up the request in time* | The office PC is slow or just reconnecting; press **Check again** / **Refresh**. |
| *The office computer is already working on this request* | The same request (for example a download of that machine) is still running; wait a moment. |
| *This server has no Biometric Attendance app and the office link is not switched on* | `BIOMETRIC_LINK_KEY` is not set (or the web app was not restarted after setting it): see "Set it up". |
| `Another Server Link seems to use the same key` (Server Link window) | Two copies run with one key (for example one at startup and one by hand): close one. |
| *still downloading at the office* | A machine takes longer than a hosting waits for one request; it goes on. Press **Refresh** in a minute. |
| Machines show *Not connected ... (other network)* | The office PC itself cannot reach that machine: ping it from the office PC (see `biometric-web/README.md`). |

## Protocol (for maintainers)

All three calls need `Authorization: Bearer <key>` and are served by `payroll-web/deploy/signin-layer/link.mjs` (the layer hands every `/__link/*` request to it before the sign-in check):

* `GET /__link/hello` - `200 {"ok":true}`. `X-Link-Agent: <name>` on any call is shown on the screen.
* `GET /__link/next` - long poll: `200 {"id","method","path","body"(base64 or null)}` as soon as a request is queued, `204` after about 20 seconds without work. A new poll takes over from an older one.
* `POST /__link/reply/<id>` - the answer: the body is the app's answer (optionally `Content-Encoding: gzip`), `X-Link-Status` its status (200-599), `X-Link-Type` its type (`application/json` or `text/csv`).
  An answer for an unknown, finished or timed-out request is answered `404` and dropped.
* The application's own `fetch('http://relay.local/...')` is routed to the link in `deploy/hostinger/main.mjs` (`relayFetch` in `link.mjs`); `env.PAYROLL_BIO_LINK=1` switches `app/api/biometric/route.ts` to this mode
  (the stored address of the Biometric Attendance app is then ignored).

## Tests

* `node --no-warnings --test deploy/signin-layer/link.test.mjs` (from `payroll-web/`, 25 tests): the allowlist is identical in the server and in the Server Link (including the 70-day cap), key checks and the lock
  (the right key passes while wrong keys are locked), the round trip with gzip, timeouts and late answers, size limits, one answer at a time per request, per-kind limits, the connection log, the layer integration
  (`/__link` never reaches the application and needs no session; a key of the wrong shape switches the link off), and the Server Link against stand-ins: all four requests, a hostile server (it must not follow
  redirects of the poll, of the answer or of the local app; huge or forged jobs; forged log lines), the app being down, a wrong key, reconnecting, still being seen while busy with downloads, two copies with one key, the key check and `--test`,
  the command line, and a package with its settings inside (it wins over a wrong key saved earlier and saves nothing).
* An independent review (a second reader that tried to break the relay and the Server Link) found: the Server Link followed redirects, concurrent / oversized answers could stall the one process, a machine user ID
  `__proto__` poisoned the punches view, the lock could shut the office out when an address is shared, the machine list leaked Comm Keys, and smaller points (log forging, no cap on the job size, `--key` parsing,
  no date-range cap, polling stopped when 4 downloads ran) - all fixed and covered by tests.
* End to end in a browser (headless Chrome against the single-process server with the real data copy, the demo Biometric Attendance app with simulated machines and the Server Link): before it connects the screen
  says so, connected it lists the machines, Download fills the punch counts, the auto-download choice reaches the app, Employee Match and the punch export work through the link, the app being down and the link being closed are shown.
  A second run uses a misbehaving fake office app (odd machine user IDs, extra fields, numbers as text, wide date ranges); a third and fourth start the same build without the key (hosted: the screens say so and no typed-in address is called;
  `PAYROLL_HOSTED=0`: the Windows-style address box works as before).
