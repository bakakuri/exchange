# Exchange Stage 4

Run after `20260913_exchange_stage2_ux.sql` and after Stage 1 security/economy migrations.

Stage 4 adds:

- campaign owner pause/resume RPC with audit logging
- fast indexes for tasks, completions and notifications
- client notification INSERT protection
- localized campaign status notifications
- mobile-first product UI polish for dashboard, tasks, campaigns, wallet and profile
- account security status panel
- read-only Stage 4 smoke tests in `../tests/stage4_product.sql`

Run these SQL migrations in filename order. The UI files are loaded automatically by `server.js`.
