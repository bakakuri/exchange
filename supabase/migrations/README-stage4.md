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

Final production hardening adds `20260913_exchange_api_lockdown.sql`:

- removes direct client task creation/update
- removes direct client promotion creation
- moves profile edits to a protected RPC
- fixes strict platform URL validation
- keeps economic mutations behind server-side RPCs

Run the SQL migrations in filename order. The UI files are loaded automatically by `server.js`.
