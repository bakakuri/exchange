# Exchange database tests

`security_economy.sql` is a read-only smoke test for Stage 1.

It verifies required tables, ledger columns, RPC presence, URL validation and the refund-safe admin promotion function. It also prints any non-zero credit-ledger differences.

The tests do not simulate authenticated user actions. Those require an integration test runner with Supabase Auth sessions and should be added before production launch.
