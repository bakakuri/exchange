# Exchange 🚀

Supabase-connected social promotion marketplace starter.

## What is included

- Supabase Auth client integration
- User profile and credit wallet
- Social profile management
- Public active task feed
- Secure task completion through a PostgreSQL RPC
- Credit transaction ledger
- Row Level Security policies
- Campaign budget protection and cancellation refunds
- Admin controls
- Mobile-first UI

Exchange does not create fake accounts, automate follows/subscriptions, bypass platform security, or use bots to inflate metrics.

## Setup

### 1. Supabase

Open **SQL Editor** in your Supabase project and run:

1. `supabase/schema.sql`
2. The files in `supabase/migrations/` in filename order

The migrations add campaign fields, budget protection, starter tasks, analytics, admin controls, and campaign refund safeguards.

Then enable the authentication method you want under Supabase Auth.

### 2. Local environment

Copy `.env.example` to `.env` and set:

- `SUPABASE_URL`
- `SUPABASE_ANON_KEY`

Never put a `service_role` or secret key in the browser or GitHub.

### 3. Run

```bash
npm install
npm start
```

Open `http://localhost:3000`.

### 4. Vercel

Add the same two environment variables to the Vercel project:

`SUPABASE_URL`
`SUPABASE_ANON_KEY`

Redeploy after saving them.

## Important

The browser uses only the Supabase anonymous/publishable key. Credits are not awarded by client-side JavaScript. Completion and credit accounting happen in database RPCs.
