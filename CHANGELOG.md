# Changelog

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
