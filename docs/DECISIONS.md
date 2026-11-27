# Decisions log

This file records the context and decisions behind the portal so they don't get lost between sessions. Add new entries at the top.

## 2026-11-27 — Phase 1 build
- **Stack:** Vite + React 19 + TypeScript, plain CSS tokens ("Ledger" design), react-router (hash routes, so it works as a static page). The accounting core in `src/core` is framework-free and unit-tested.
- **Storage:** IndexedDB on one device for Phase 1. Swapping in a hosted back end (multi-user, 2FA, encryption, backups) is a prerequisite before real data goes in.
- **Intercompany is automatic.** Each store has its own entity, and Corporate is the hub. When a transaction's lines span entities, the ledger adds `2900 Due to related entities` / `1900 Due from related entities` lines so each entity balances. Example: the shared Trustmark account (CORP) pays an HM11 bill.
- **Owner withdrawals:** the default policy is *Corporate · Miscellaneous expense* (CFO decision, 2026-11-02). It can be switched to equity draws in Settings, and the policy fills in when an owner is picked on an entry.
- **Rent pass-throughs:** each one debits the store's rent and credits Corporate's *Due to related parties* (Dhunna / SKD). The demo uses round illustrative amounts. Real amounts stay out of the repo and are entered as data.
- **HM17** opened Nov 2026 per the build spec (the house notes say Oct 2026; this is configurable on the store record). **HM14** is leased out and appears only through rent income.
- **Materiality:** $5.00.
- **"Payments with no document"** is a review queue, not a to-do. It covers the last 30 days, $1,000 and over, and leaves out payroll until the Gusto import ships.
- **Demo data** is illustrative. None of it is real company figures, owner names or account numbers; those are never committed.
