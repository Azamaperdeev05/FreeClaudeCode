# Changelog

## 1.0.4 — 2026-08-12

### Security

- Reject requests from other origins. The local server is reachable from any page in
  the browser, so `Origin`/`Host` are now checked to stop CSRF and DNS rebinding.
- Validate model ids and API keys against an allowlist before they reach the generated
  `.bat` files. Previously a value containing `&` could run arbitrary commands on launch.
- Broaden `.gitignore` to `_*` and drop scratch files that had held live AWS OAuth
  device codes, a client secret and a session cookie.

### Fixes

- Shutdown / orphan OmniRoute processes
  - Startup cleanup kills any leftover OmniRoute from previous runs before starting a new one
  - Added detached PowerShell watchdog that kills OmniRoute when FreeClaude window is closed
  - More aggressive shutdown: port 20128 listeners, node/omniroute processes, image-name fallbacks
- Dynamic SQLite queries for OmniRoute schema differences, now also for `listApiKeys`
  (no more `no such column: quota_visible`)
- The packaged exe resolves Node the same way the app does (nvm, Scoop, any drive)
  instead of assuming `C:\Program Files\nodejs`
- SQLite calls no longer hang the server: 20s timeout on the bridge, 10s busy timeout
  on the database, and a clear error when Node is older than 22
- `ensureApiKey` runs its lookup and insert in one transaction, so two quick calls
  cannot create duplicate keys
- A corrupt `localStorage` entry no longer leaves the UI blank on start
- Kiro login: failed polling now clears its own state instead of claiming the login
  continues in the background, and the login button stays disabled while polling

### UI

- "Удалить" button for the saved OmniRoute API key in Settings
- Escape closes the Kiro modal; toast and search are exposed to screen readers

### Performance

- The model grid no longer rebuilds on every 20s quota poll, which kept resetting
  scroll position and focus
- Quota polling pauses while the window is hidden, the countdown ticker only runs
  during an actual limit, and search input is debounced

### Build

- `build-release.ps1` fails on non-zero exit codes, resolves Node from PATH, closes a
  running exe before cleaning, pins `better-sqlite3`, uses `npm ci`, and verifies the
  output contains every required file
- Removed ~200 lines of dead CSS and the duplicated `formatDuration` that made quota
  text differ between dev and the packaged build

## 1.0.3 — 2026-08-12

- Fix: detect Node on other drives (e.g. `E:\Program Files\Nodejs`)
- Fix: OmniRoute login tries multiple passwords + clearer Russian error (no raw JSON)
- Fix: always kill OmniRoute / port 20128 on FreeClaude exit (fewer orphan processes / lag)
- Fix: more reliable CSS inlining + JS cache bust after updates
- Release ships both `.zip` and standalone `.exe`

## 1.0.2 — 2026-08-11

- Fix: detect Node.js / npm from full user PATH (nvm, scoop, custom installs) — not only `C:\Program Files\nodejs`

## 1.0.1 — 2026-08-11

- Fix: after AWS “Request approved”, auth no longer drops if the modal is closed
- Fix: wait for Kiro connection + models before showing an empty list
- Heal inactive Kiro provider rows that already have tokens

## 1.0.0 — 2026-08-11

- First public Windows portable build
- Local dashboard for setup, Kiro auth, and model launch
- OmniRoute integration and API key helpers
- README + release package for GitHub
