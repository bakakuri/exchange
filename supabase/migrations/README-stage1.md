# Exchange Stage 1

Run migrations in this order, after the existing Exchange migrations:

1. `20260913_exchange_security_economy.sql`
2. `../tests/security_economy.sql` for the read-only smoke test

Stage 1 adds:

- credit ledger reason/admin/promotion/balance fields
- atomic, row-locked promotion spending
- distinct `cancelled` campaign status and refunds
- completion rate limits
- platform-aware HTTPS URL validation
- task verification foundation
- admin audit trail
- credit ledger reconciliation
- refund-safe admin campaign deletion
- read-only smoke tests

The verification layer is intentionally a foundation: current task completion still awards through the existing trusted RPC flow. Verification review is recorded separately so a later UI/API step can require approval without breaking the current task flow.
