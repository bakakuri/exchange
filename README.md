# Exchange

A social engagement and promotion marketplace: users complete each other's
tasks to earn credits, then spend credits running their own promotion
campaigns. Built as one integrated platform, kept modular internally.

This repository is being built in stages (see Roadmap below). Nothing here
is a mockup - every piece that exists is real and wired end to end;
features that don't exist yet simply aren't here.

## Architecture

- **Frontend** - plain HTML, CSS and vanilla JavaScript. No framework, no
  bundler. Pages are HTML fragments served from `public/pages/` and
  swapped into the shell (`public/index.html`) by a small client-side
  router (`public/js/core/router.js`) using native ES modules - the
  browser loads modules directly, nothing is compiled.
- **Backend** - Node.js + Express, `route -> controller -> service ->
  database`. No business logic lives in route files.
- **Database** - Supabase (PostgreSQL, Auth, Row Level Security). Critical
  economic operations (rewards, budget changes) run as atomic PostgreSQL
  functions, not application-level multi-step writes.
- **One responsibility per file.** If a file grows to cover more than one
  concern, it gets split rather than grown.

## Folder structure (current)

```
exchange/
  public/                  Frontend - static, served by Express
    index.html              App shell (persistent header/nav/footer)
    pages/                   HTML fragments injected into the shell
    css/                     variables.css, base.css, layout.css
    js/
      core/                  app bootstrap, config, state, events, router
      shared/                 http, api, dom, error helpers
    js/
      auth/                    session persistence, auth state manager, nav, pages
      home/                    "/" route
      profile/                 "/profile" (edit own + linked accounts) and "/u/:username" (view) routes
      credits/                 "/credits" route - balance + transaction history
      tasks/                   "/tasks" (browse) and "/tasks/:id" (detail) routes
  server/                  Backend - Express
    server.js                App entry
    config/                   env.js, supabase.js
    constants/                profile-fields.js - the one canonical "user"/"profile" shape
    middleware/                security, rate-limit, error-handler, auth, admin, validation
    routes/ controllers/ services/ validators/
                              one auth.*.js and profile.*.js per layer so far
    utils/                     errors.js (canonical error codes), logger.js, async-handler.js
  supabase/
    migrations/               001-017: full schema, RLS, business-logic functions, browse view
  scripts/
    test/                     Local Postgres validation harness (see below)
```

Routes, controllers, services and validators (the Express layer that
calls the database functions below over Supabase RPC) are added stage by
stage as each feature lands.

## Database (Stage 2)

The full schema lives in `supabase/migrations/001` through `016`, applied
in order. Highlights:

- **campaigns** is the economic container (budget, state machine);
  **tasks** is the action a completer performs, one per campaign in v1,
  linked by `campaign_id`. Browsing "tasks" and managing "campaigns" are
  two API surfaces over this same data, not two economies.
- **credit_ledger** is the append-only source of truth for every balance
  change; `profiles.credits` is a cache kept in sync only by the
  functions in `015_functions.sql`. The ledger triggers physically
  forbid `UPDATE`/`DELETE` - a correction is a new `reversal` row, never
  an edit to history. `audit_logs` is immutable the same way.
- **Every economically or structurally significant write goes through a
  SECURITY DEFINER function** (`create_campaign`, `cancel_campaign`,
  `submit_task_verification`, `review_task_verification`,
  `admin_update_user`, `admin_credit_adjustment`, `admin_resolve_report`,
  `claim_referral`). Each one resolves the acting user from `auth.uid()`
  itself rather than trusting a caller-supplied id, so a client can never
  act as someone else. `reward_task_completion` (the atomic reward
  engine) and other internal helpers have their client `EXECUTE` grant
  revoked entirely - reachable only by being called from inside another
  trusted function, never directly over RPC.
- **RLS** (`014_rls.sql`) is deny-by-default per table, plus column-level
  `GRANT`/`REVOKE` so a user can update their own `display_name` but not
  their own `credits`, `xp`, `role`, or a campaign's `status` - even if
  an RLS row policy would otherwise allow the row.
- Concurrency: `reward_task_completion` locks the campaign row
  (`SELECT ... FOR UPDATE`) before checking `remaining_budget`, so two
  simultaneous approvals against the last budget slot serialize - the
  second fails safely with `INSUFFICIENT_BUDGET` rather than ever taking
  the budget negative.

### Local validation

Nothing above has been applied to a live Supabase project yet (pending
the project being provisioned). It has been validated against a real
local PostgreSQL 16 instance, stubbing only what a real Supabase project
provides for free (the `auth` schema and `auth.uid()`):

```bash
sudo -u postgres psql -c "create database exchange_test"
sudo -u postgres psql -d exchange_test -f scripts/test/000_supabase_stub.sql
for f in supabase/migrations/*.sql; do sudo -u postgres psql -d exchange_test -v ON_ERROR_STOP=1 -f "$f"; done
sudo -u postgres psql -d exchange_test -f scripts/test/001_functional_test.sql
sudo -u postgres psql -d exchange_test -f scripts/test/002_open_tasks_view_test.sql
sudo -u postgres psql -d exchange_test -f scripts/test/003_completion_details_view_test.sql
sudo -u postgres psql -d exchange_test -f scripts/test/004_credit_summary_test.sql
sudo -u postgres psql -d exchange_test -f scripts/test/005_notifications_activity_test.sql
sudo -u postgres psql -d exchange_test -f scripts/test/006_achievements_levels_test.sql
```

`001_functional_test.sql` exercises the full loop - signup, admin
bootstrap, campaign creation and its budget reservation, self-task and
duplicate-submission guards, review by a non-owner, approval (reward,
budget decrement, XP, ledger, notification, achievement unlock all in
one transaction), re-review protection, cancellation and refund, the
referral loop, last-administrator protection, and RLS/column-grant
enforcement under the `authenticated` role - 21 assertions, all passing.

## Authentication (Stage 3)

Auth is Supabase Auth (GoTrue) end to end - there is no separate password
table or session store of our own. `handle_new_user()` (Stage 2) already
creates a matching `profiles` row the moment Supabase creates an
`auth.users` row, so from the very first request after signup a user has
both an identity and a profile.

**Backend** (`server/{routes,controllers,services,validators}/auth.*.js`,
`server/middleware/{auth,admin}.js`):
- `POST /api/auth/register`, `/login`, `/refresh`, `/logout`,
  `/password-reset/request`, `/password-reset/confirm`, `GET /session`.
- `auth.service.js` is the only module that calls `supabase-js`'s auth
  methods. Every function that returns a "user" returns the same
  profile-enriched shape (`buildUserPayload`: Supabase auth identity +
  `profiles` row) - register, login, refresh and `/session` never
  disagree about what a user object looks like.
- `password-reset/request` always answers with the same message whether
  or not the email is registered (anti-enumeration).
- `middleware/auth.js` (`requireAuth`) re-verifies the bearer token with
  Supabase and re-reads the profile from the database on every protected
  request - it never trusts a client-supplied role or a cached claim,
  and it rejects a suspended account (`status !== 'active'`) even with a
  valid token. `middleware/admin.js` (`requireAdmin`) layers an
  admin-role check on top for Stage 14.
- `/register`, `/login`, and the password-reset endpoints sit behind a
  stricter rate limiter (10 requests / 15 min) than the general API
  limiter, per the spec's rate-limiting requirements for sensitive
  endpoints.

**Frontend** (`public/js/auth/`, `public/js/core/{router,route-guards,
routes-manifest}.js`):
- `router.js` is now feature-agnostic: pages register themselves with
  `registerRoute(path, { fragment, module, protected, guestOnly })` from
  their own `routes.js` (see `home/routes.js`, `auth/routes.js`), listed
  once in `core/routes-manifest.js`. A single guard function
  (`core/route-guards.js`, wired in via `setRouteGuard()`) redirects
  `protected` routes to `/login` when signed out and `guestOnly` routes
  (login/register) to `/` when already signed in - the router core
  itself has no idea authentication exists.
- `auth/auth.js` is the one authentication state manager: register,
  login, logout, `refreshSession`, password reset, and session hydration
  all go through it, and it's the only code that writes
  `core/state.js`'s `user`/`session`. `auth/session.js` persists the
  session to `localStorage` so a refresh doesn't sign anyone out;
  `auth.js` schedules a proactive token refresh ~60s before
  `session.expires_at`.
- `auth/auth-nav.js` keeps the header's sign-in/sign-up vs.
  username/sign-out slot in sync by re-rendering on every store change.
- Pages: `/login`, `/register`, `/password-reset` (one page handling
  both "send me a reset link" and, when Supabase's recovery link lands
  back with `#access_token=...&type=recovery`, "set a new password").

Nothing here has been tested against a live Supabase project yet (see
"Known gaps" below) - the code is written to be correct once credentials
exist, following the same request/response contract the Stage 2 database
functions were validated against locally.

## Profiles (Stage 4)

Plain CRUD over `public.profiles`, deliberately thin - the database
(014_rls.sql) is the actual authority, not this layer:

- `GET /api/profile/me`, `PATCH /api/profile/me`, `GET
  /api/profile/:username` (`server/{routes,controllers,services,
  validators}/profile.*.js`). `GET /me` reuses `req.user` rather than
  querying again - `middleware/auth.js` already re-reads the full
  profile from the database on every request, so there'd be nothing to
  gain from a second round trip.
- `server/constants/profile-fields.js` is now the one place the
  `profiles` column list lives; `auth.service.js` and
  `profile.service.js` both select exactly that, so `/auth/session`,
  `/auth/login` and `/profile/me` can never disagree about what a
  "user" object contains.
- `profile.validator.js` mirrors the database's own format rules
  (username pattern, a practical length cap on `display_name`/`bio`
  the schema itself doesn't enforce, `https://` avatar URLs) so a bad
  value comes back as one readable `VALIDATION_ERROR` instead of a raw
  Postgres constraint violation; the actual authorization boundary is
  still 014_rls.sql's column-level grant, not this file.
- All authenticated users can read all profiles (`profiles_select_all`
  RLS policy) - there's no `anon` grant at all, so profiles aren't
  publicly visible without a session; that's a product choice this
  stage keeps rather than changes.

Frontend: `router.js` now supports `:param` route segments (used by
`/u/:username`), still resolved through the same guard mechanism as
Stage 3. `auth.js` gained `updateCachedUser()` so a profile edit updates
the signed-in session's cached copy (and its `localStorage` persistence)
without any other module writing to `core/state.js` directly - it
remains the one thing that does.

## Social profiles (Stage 5)

CRUD over `public.social_profiles` - the accounts a user links from
other platforms (Instagram, TikTok, etc.) as public proof for task
verification later (Stage 8):

- `GET/POST /api/social`, `PATCH/DELETE /api/social/:id`
  (`server/{routes,controllers,services,validators}/social.*.js`) for
  the signed-in user's own links; `GET /api/profile/:username/social`
  (added to `profile.controller.js`, since it composes
  `profileService.getProfileByUsername` with
  `socialService.listForUser` rather than duplicating either) for
  anyone else's.
- `server/constants/social-platforms.js` mirrors the `social_platform`
  enum in `002_social_profiles.sql`; `public/js/shared/
  social-platforms.js` is the frontend's copy for the same list plus
  display labels - three copies (SQL enum, server validator, frontend)
  that have to be kept in sync by hand, called out with a comment in
  each.
- `verification_state` is select-only everywhere (014_rls.sql grants no
  client INSERT/UPDATE on it) and no function sets it yet - nothing
  before Stage 8 needs it, so it just sits at `unverified`.
- Update (`PATCH /api/social/:id`) exists in the API for a later stage's
  use but has no UI yet - the current page only supports add/remove,
  which covers the flows the spec calls for so far.

Frontend: linked accounts live on the existing `/profile` page
(`public/js/profile/social.js`, a separate module from
`profile-edit.js` so each file keeps one concern) rather than a new
route, and render read-only on `/u/:username`
(`profile-view.js`) when a user has any.

## Credit ledger (Stage 6)

Read-only, deliberately: every way a balance actually changes - campaign
budget reservation/refund, task rewards, referral bonuses, admin
adjustments - lives inside its own SECURITY DEFINER function in
`015_functions.sql`, reached through `write_ledger_entry`, which has no
client `EXECUTE` grant at all. Nothing before Stage 14 (or after) gets a
way to write a ledger row directly; this stage only gives the signed-in
user a way to *see* the economy those later stages will drive.

- `GET /api/credits/balance` (`req.user.credits` - the same cache
  `write_ledger_entry` keeps in sync, so no extra query),
  `GET /api/credits/ledger?before=<cursor>&limit=<n>`
  (`server/{routes,controllers,services}/credit*.js`) - cursor-paginated
  on `created_at` rather than offset, since the ledger is append-only
  and can grow without bound while someone's paging through it.
- An admin credit-adjustment endpoint is deliberately not here even
  though `admin_credit_adjustment()` already exists in the database -
  that belongs to Stage 14 once there's an admin panel to put it in.

Frontend: `/credits` (`public/js/credits/`) shows the balance and a
"load more"-paginated transaction list, with a plain-language label per
`ledger_transaction_type`. The header nav (`auth-nav.js`) now also shows
the signed-in user's balance as a link to this page.

## Tasks (Stage 7)

The browse/discover side of the marketplace - creating campaigns
(Stage 9) and submitting/reviewing proof (Stage 8) come later; this
stage is read-only.

- **`017_open_tasks_view.sql`** (new migration): `public.open_tasks`, a
  plain view joining `tasks`+`campaigns` and filtering to exactly the
  tasks whose campaign can still pay out (active, under its completion
  target, enough remaining budget). A view rather than app-layer
  filtering, so "is this task open" is defined once, in the database,
  instead of every caller re-deriving three columns' worth of logic by
  hand. It's a plain view (no `security definer`), created `with
  (security_invoker = true)` so it carries no privilege of its own - it
  runs as the querying role, meaning the existing RLS on
  `tasks`/`campaigns` still applies exactly as if the join were written
  out directly; `grant select ... to authenticated` mirrors the grant
  those tables already have, with no `anon` access. (The
  `security_invoker` option was added retroactively in Stage 8, once a
  second view's test caught that it was missing here too - see Stage 8
  below for why it matters and why this view's own tests never noticed.)
- **Bug found and fixed while validating the view**:
  `set_campaign_pause_state()` (`015_functions.sql`, written in Stage 2)
  has been broken since it was written - `set status = case when
  p_paused then 'paused' else 'active' end` resolves the `case`
  expression to `text`, which has no implicit cast to the
  `campaign_status` enum, so every call failed. Nothing before this
  stage ever exercised the function, so it went uncaught until
  `scripts/test/002_open_tasks_view_test.sql` called it directly. Fixed
  with an explicit `::campaign_status` cast.
- `GET /api/tasks` (cursor-paginated, optional `platform`/`task_type`
  filters - an unrecognized filter value is ignored rather than
  rejected, since this is a browse GET, not a form submission) and
  `GET /api/tasks/:id` (works for a closed task too, and includes the
  viewer's own completion status when there is one)
  (`server/{routes,controllers,services}/task*.js`).
- Excluding the viewer's own tasks from the browse list is a
  `task.service.js` choice, not a security boundary - the database
  independently refuses to let anyone complete their own task
  regardless of what the browse list shows them.
- `server/constants/task-platforms.js` / `task-types.js` mirror the
  `task_platform`/`task_type` enums in `004_tasks.sql`, same pattern as
  Stage 5's platform list (and again duplicated once more, deliberately,
  for the frontend's filter dropdowns and labels).

### Local validation

`scripts/test/002_open_tasks_view_test.sql` runs against the same
freshly migrated database as `001_functional_test.sql` (see "Local
validation" above - apply `000_supabase_stub.sql` then every migration,
then both test scripts in order); it uses its own fixture ids so it
doesn't depend on or disturb the first script's data. It checks: a
fresh active campaign with room is open; a campaign that fills up,
gets paused, or gets cancelled is excluded; the view has no notion of
"viewer" (self-exclusion is confirmed to be `task.service.js`'s job,
not the database's); `authenticated` can select from it and `anon`
cannot; and RLS on the underlying tables really does apply through the
view for an unrelated authenticated user, not just via a static
privilege check.

## Verification (Stage 8)

Submitting proof of completion, and the campaign creator (or an admin)
approving or rejecting it. The state machine and every authorization
rule live in `submit_task_verification()` / `review_task_verification()`
(`015_functions.sql`, written in Stage 2): self-task protection,
duplicate-submission protection, campaign-still-payable checks, only the
campaign owner or an admin may review, no re-reviewing an already-decided
completion. This stage is the API and UI in front of those functions -
it adds no new business rules of its own.

- **`018_completion_details_view.sql`** (new migration):
  `public.completion_details`, a plain view joining
  `task_completions`+`tasks`+`campaigns`+`task_verifications` once, so
  "my submissions" and "submissions to review" - the same four-table
  join, filtered by a different column each time (`completer_id` vs.
  `campaign_creator_id`) - don't become two hand-written joins that can
  drift apart. `task_completions_select_participant` (`014_rls.sql`) -
  visible only to the completer, the campaign creator, or an admin -
  decides which rows actually come back; `review_notes` is included
  deliberately, since the same policy already lets a rejected completer
  see why, through `task_verifications_select_participant`.
- **A real, previously-undiscovered RLS bypass, found and fixed while
  validating this view.** A plain Postgres view, by default
  (`security_invoker = false`, the only option before Postgres 15),
  checks access to its underlying tables - including row-level security
  - using the *view owner's* privileges, not the querying role's. Every
  view in this schema is created by whichever role runs the migrations
  - here, the Postgres superuser - and superusers bypass row security
  entirely (`rolbypassrls`). Without `security_invoker = true`, querying
  either view meant RLS was silently bypassed *for every caller*,
  regardless of who they were. `017_open_tasks_view.sql` (Stage 7) had
  exactly the same bug from the day it was written, and its own test
  (`002_open_tasks_view_test.sql`) didn't catch it, because
  `tasks_select_all`/`campaigns_select_all` (`014_rls.sql`) already
  grant `using (true)` to any authenticated user - there was no
  restriction left to bypass, so bypassing RLS and enforcing it looked
  identical from outside. `completion_details` is the first view over a
  genuinely participant-restricted table, and the very first version of
  `scripts/test/003_completion_details_view_test.sql` - checking that an
  unrelated third party sees nothing - failed immediately: any
  authenticated user could read every user's submitted proof
  (`proof_url`/`proof_text`) and every reviewer's private
  `review_notes`, platform-wide. Fixed by adding `with (security_invoker
  = true)` to both views (`017_open_tasks_view.sql` retroactively,
  `018_completion_details_view.sql` from the start), confirmed by
  re-running all three local test scripts against a freshly rebuilt
  database. No live Supabase project has ever existed for this repo, so
  nothing was ever exposed outside this local test harness - but this is
  exactly the kind of bug "no client-facing surface bypasses RLS" is
  supposed to rule out, and it's a standing reminder for Stage 9 onward:
  any future `create view` needs `with (security_invoker = true)` from
  the start, not discovered later by a test that happens to be strict
  enough to notice.
- `server/services/verification.service.js` calls
  `submit_task_verification()`/`review_task_verification()` through the
  caller's own access token (never a service-role client), so
  `auth.uid()` inside those functions resolves to the real signed-in
  user - the same pattern every other stage's writes use. Their
  structured `'CODE: message'` exceptions (the convention established in
  Stage 2: a Postgres `raise exception` with `errcode = 'P0001'`) are
  parsed back into this codebase's `AppError`/`ErrorCodes` by a small
  `mapRpcError()` helper, the same idea as every other service's RPC
  error handling, just factored out since this file calls two RPCs
  instead of one.
- `POST /api/verification/tasks/:taskId` (submit proof - `proof_url`
  and/or `proof_text`, at least one required) and `POST
  /api/verification/:id/review` (`decision`: `approved`/`rejected`,
  `review_notes` required when rejecting) both sit behind a stricter
  rate limiter, same rationale as Stage 3's auth endpoints (spec section
  40): both have direct economic consequences. `GET
  /api/verification/mine` and `GET /api/verification/to-review` are
  cursor-paginated reads over `completion_details`, filtered server-side
  by `completer_id`/`campaign_creator_id` respectively, with an optional
  `status` filter (`server/{routes,controllers,services}/verification*.js`).
- Frontend: the `/tasks/:id` page's Stage 7 placeholder ("Submitting
  proof of completion will be available soon") is now a real form when
  a task is open, isn't the viewer's own, and hasn't been submitted for
  already (`public/js/tasks/task-detail.js`). Two new pages read from
  the new endpoints: `/submissions` (the signed-in user's own
  submissions, with reviewer notes on a rejection) and
  `/submissions/review` (submissions against the user's own campaigns,
  with approve/reject actions - reject reveals a required notes field
  before confirming) (`public/js/submissions/`,
  `public/pages/submissions.html`, `public/pages/review-queue.html`,
  `public/css/verification.css`). Both share a small
  `submissions/status.js` for consistent status labels rather than each
  page defining its own.
- In passing: `.btn--ghost`, used since Stage 6 for "Load more" buttons,
  was never actually defined in CSS - those buttons had been rendering
  as unstyled browser defaults. Defined now, alongside the new
  `.btn--danger` the reject action uses, in `forms.css` with the rest of
  the button variants.

### Local validation

`scripts/test/003_completion_details_view_test.sql` runs after
`001_functional_test.sql` and `002_open_tasks_view_test.sql` against the
same freshly migrated database (own fixture ids, no shared state). It
submits proof, has the campaign creator reject it with notes, then
checks: the completer sees their own completion enriched with the
joined campaign fields and the reviewer's notes; the campaign creator
sees it too; an unrelated third authenticated user sees nothing for it,
through the view, exactly as RLS on the underlying tables would enforce
directly (the check that originally failed - see above); and the view
is grant-restricted to `authenticated`, not `anon`. The Node-side
service/controller/route files are syntax-checked with `node --check` /
`node --input-type=module --check`, same as every prior stage - there is
still no live Supabase project, so the actual RPC calls are exercised
only indirectly, through the database-level tests above.

## Campaigns (Stage 9)

The creator's side of the marketplace: create a campaign (spending
credits), edit its presentation, pause/resume it, cancel it (refunding
whatever budget is left). No new migration - `create_campaign()`,
`set_campaign_pause_state()`, and `cancel_campaign()` were all written
and locally validated back in Stage 2 (`015_functions.sql`,
`001_functional_test.sql`); this stage is entirely the API and UI in
front of them, the same relationship Stage 8 has to its own functions.

- `server/services/campaign.service.js` calls all three functions
  through the caller's own access token, same pattern as every other
  stage's writes, with the same `mapRpcError()`-style parsing of their
  `'CODE: message'` exceptions into `AppError`/`ErrorCodes`. Editing a
  campaign's title/description is the one exception - no function for
  that, since RLS already grants a column-scoped direct `UPDATE`
  (`campaigns_update_own_presentation`, `014_rls.sql`) for exactly those
  two fields, the same shape as Stage 4/5's profile and social-profile
  edits.
- Reading back a campaign after creating/pausing/resuming/cancelling it
  uses the unscoped `campaigns_select_all` policy (any authenticated
  user can read any campaign - the same policy that already lets
  `GET /api/tasks/:id` show a campaign's public-facing fields). The "my
  campaigns" list and the single-campaign management read
  (`GET /api/campaigns/:id`) are additionally scoped to
  `creator_id = <caller>` in the query itself - not an RLS boundary,
  just this endpoint's purpose, the same "app-layer filter, not a
  security boundary" reasoning `task.service.js` already documents for
  excluding the viewer's own tasks from browse. A campaign that exists
  but isn't the caller's own reports `NOT_FOUND`, not `FORBIDDEN`, so
  this endpoint never confirms whose a given campaign id is.
- `POST /api/campaigns` (create), `GET /api/campaigns/mine`
  (cursor-paginated, optional `status` filter), `GET /api/campaigns/:id`,
  `PATCH /api/campaigns/:id` (title/description), `POST
  /api/campaigns/:id/pause`, `POST /api/campaigns/:id/resume`, `POST
  /api/campaigns/:id/cancel` (optional `reason`) - all behind the same
  kind of rate limiter as Stage 3's auth endpoints and Stage 8's
  verification writes, since every one of these has a direct economic
  consequence (`server/{routes,controllers,services,validators}/campaign*.js`).
- `server/validators/campaign.validator.js` mirrors the
  `campaigns`/`tasks` table constraints (`target_url_format` in
  particular: `http://` or `https://`, not the stricter HTTPS-only
  pattern other validators use for profile/social links, since this one
  mirrors a different constraint than those do) - the database still
  re-checks everything itself regardless of what passes here.
- Frontend: `/campaigns` (list, status filter, load-more), `/campaigns/new`
  (create form - a live total and the caller's current balance are shown
  for orientation only; `create_campaign()` is the only thing that
  actually checks and reserves the budget), and `/campaigns/:id` (stats,
  the one task's definition, an edit form, and pause/resume/cancel
  actions - cancel reveals an optional reason field before confirming,
  the same reveal-before-confirm shape as Stage 8's reject action)
  (`public/js/campaigns/`, `public/pages/campaign*.html`,
  `public/css/campaigns.css`).

### Local validation

No new SQL in this stage, so no new test script - `create_campaign()`,
`set_campaign_pause_state()`, and `cancel_campaign()` are already
exercised by `001_functional_test.sql` (budget reservation, atomic
rollback on insufficient credits, the pause/resume cast bug fixed in
Stage 7, cancellation and refund, ownership/admin checks). The new
Node-side files are syntax-checked with `node --check` /
`node --input-type=module --check`, same as every prior stage.

## Reward engine (Stage 10)

The atomic mechanics - `write_ledger_entry()`'s guarded balance update,
`reward_task_completion()`'s locked, all-or-nothing payout - were built
and locally validated back in Stage 2; both remain internal-only, with
no client EXECUTE grant at all, reachable only from inside
`review_task_verification()` (confirmed by `001_functional_test.sql`).
There is nothing left in the engine itself for this stage to add. What
was missing was visibility into what the engine has actually done - the
raw paginated ledger Stage 6 exposes doesn't add up to a picture of
"how much have I earned from tasks, from referrals, spent reserving
campaigns" without paging through everything by hand.

- **`019_credit_summary_function.sql`** (new migration):
  `get_credit_summary()`, returning per-`ledger_transaction_type` totals
  and counts for the caller's own rows. PostgREST/supabase-js has no
  `GROUP BY` in its query builder, so this needed a function rather than
  a view - the first genuinely aggregate read in this codebase.
  Deliberately **not** `security definer`: `credit_ledger` already
  grants `authenticated` `SELECT` and already carries
  `credit_ledger_select_own` (`014_rls.sql`), so there's no privilege
  here the caller doesn't already have directly, unlike every
  `security definer` function in `015_functions.sql`, each of which
  exists specifically because the caller has no direct grant to do what
  it does. The explicit `where user_id = auth.uid()` is still required
  despite that RLS policy and isn't redundant with it:
  `credit_ledger_select_own` also lets an admin see every user's rows,
  and without that filter an admin calling this function would get a
  platform-wide aggregate instead of their own summary - confirmed by
  `scripts/test/004_credit_summary_test.sql`, whose most important
  assertion is exactly that: an admin with no ledger activity of their
  own gets an empty summary back, not everyone else's.
- **Two real, previously-undiscovered bugs, both found validating this
  one function, both fixed in the stub/migration rather than the
  function's design:**
  1. **`scripts/test/000_supabase_stub.sql` never granted `USAGE` on
     schema `auth` or `EXECUTE` on `auth.uid()` to `anon`/`authenticated`**
     - a real Supabase project grants both by default, precisely so
     `auth.uid()` can be called directly, not just from inside a
     `security definer` function or a pre-resolved RLS policy
     expression. That gap went unnoticed from Stage 2 through Stage 9
     because every function here that calls `auth.uid()` has been
     `security definer` (runs as the function owner, `postgres`, who
     needs no grant) and every RLS policy's use of `auth.uid()` is
     resolved once, under `postgres`'s privileges, at `CREATE POLICY`
     time. `get_credit_summary()` is the first plain function whose
     body calls `auth.uid()` directly, and calling it as `authenticated`
     failed outright with `permission denied for schema auth` - not a
     bug in the function, a gap in the stub. Fixed by granting both in
     the stub, right after the `authenticated`/`anon` roles are created.
  2. **The new function's own migration forgot to revoke PostgreSQL's
     implicit `EXECUTE ... TO PUBLIC`** default for newly created
     functions (unlike tables, which start with no privileges for
     anyone but the owner). Every function in `015_functions.sql` that
     isn't meant to be internal-only revokes that implicit grant before
     selectively re-granting; `019`'s first version only added a grant
     for `authenticated`, leaving `anon` still holding its default
     `EXECUTE` - caught by `004_credit_summary_test.sql`, the first
     local test in this codebase to check `anon`'s privilege on a
     *function* rather than just `authenticated`'s. Low actual impact
     here (`auth.uid()` resolves to `null` with no session, so the
     `where` clause matches nothing regardless), but fixed properly with
     an explicit `revoke ... from public;` before the grant, matching
     the pattern every other function in this codebase already follows.
- `GET /api/credits/summary` (`server/{routes,controllers,services}/credit*.js`
  - extends Stage 6's files rather than adding new ones, since this is
  the same domain) calls the RPC through the caller's own access token.
  Frontend: the `/credits` page now shows a totals-by-type breakdown
  above the transaction history, reusing the same type labels
  `credits.js` already had for individual ledger entries
  (`public/js/credits/credits.js`, `public/css/credits.css`).

### Local validation

`scripts/test/004_credit_summary_test.sql` runs after 001/002/003
against the same freshly migrated database. It seeds one user with an
admin adjustment, has them create a campaign (a reservation) and have
another user complete and get paid for its task (a task reward), then
checks: both users' summaries match their own actual activity exactly,
in total and in count; an admin with no ledger rows of their own gets an
empty summary rather than everyone else's; and the function is
grant-restricted to `authenticated`, not `anon` (the second bug above).

## Notifications & activity (Stage 11)

Two separate, already-existing tables from Stage 2
(`008_notifications.sql`, `009_activity.sql`) get their first API and UI
in this stage. No new migration - nothing here creates a notification or
activity row; every one is already written as a side effect inside the
functions in `015_functions.sql` (a review, a cancellation, a referral
payout, and so on). This stage is purely reading them back, and, for
notifications, marking them read.

- **Notifications are private** (`notifications_select_own`,
  `014_rls.sql`): visible only to the user they belong to.
  `server/services/notification.service.js` marks one read with a direct
  `UPDATE` - RLS already grants a column-scoped `UPDATE(read_at)` for the
  caller's own rows (`notifications_mark_read_own`), the same shape as
  every other stage's presentation-field edits - and marks all unread
  read with the same `UPDATE`, just matching more rows; neither needs an
  RPC. `GET /api/notifications` (cursor-paginated, optional
  `?unread=true`), `GET /api/notifications/unread-count`, `PATCH
  /api/notifications/:id/read`, `POST /api/notifications/read-all`
  (`server/{routes,controllers,services}/notification*.js`). Frontend:
  `/notifications` (list, unread filter, mark one or all read)
  (`public/js/notifications/`, `public/css/notifications.css`).
- **Activity is deliberately public** (`activity_select_all`,
  `014_rls.sql`: `using (true)`) - a display feed, explicitly never the
  source of truth for credits (`credit_ledger` is). `GET
  /api/activity/mine` and `GET /api/activity/:username` both read
  through `server/services/activity.service.js`, which only knows "list
  activity for a user id"; the `:username` route composes it with
  `profile.service.js`'s existing username-to-id lookup, the same
  composition `profile.controller.js`'s `getSocialByUsername` already
  uses for the same reason - not a new authorization boundary, since
  RLS already makes any user's feed readable to any authenticated
  caller. Frontend: the `/u/:username` profile page now renders an
  "Activity" section, the same non-critical, fetch-after-render pattern
  `renderSocial` already uses there (`public/js/profile/profile-view.js`,
  `public/css/profile.css`).
- Neither surface got a live badge or counter in the header - every
  other stage's nav links (Tasks, Campaigns, Submissions, To review) are
  plain links with no live count either, and adding polling just for
  notifications would be new, disproportionate machinery for one link;
  the notifications page itself is where the unread state actually
  lives.

### Local validation

Both tables' RLS was written in Stage 2 but never directly exercised
under `set role authenticated` until now - `001_functional_test.sql`
confirms a notification gets *created* on approval, but not who can
*read* it. `scripts/test/005_notifications_activity_test.sql` (own
fixtures, no new migration) checks: a user reads and marks read their
own notification; an unrelated user sees nothing for it, and an `UPDATE`
against it as that unrelated user matches zero rows under RLS rather
than erroring (the same "not found, not forbidden" shape
`notification.service.js`'s `markRead` already assumes); an unrelated
user *can* read another user's activity row, confirming
`activity_select_all` is working exactly as designed, not a policy that
was meant to be restrictive and accidentally isn't; and both tables
still require `authenticated`, `anon` gets nothing from either one.

## XP, levels, achievements (Stage 12)

Same relationship to Stage 2 as Stages 10 and 11: `calculate_level()`,
`award_xp()`, and `check_achievements()` (`015_functions.sql`) were
written back then and remain internal-only (no client `EXECUTE` grant -
reachable only from inside `reward_task_completion()`). No new
migration. This stage is the first read/UI layer for `profiles.xp`/
`profiles.level` (which have been visible inline in profile pages since
Stage 4) and for the `achievements`/`user_achievements` tables
(Stage 2, `010_achievements.sql`), which had no API at all before this.

- Both achievement tables are deliberately public
  (`achievements_select_all`, `user_achievements_select_all`,
  `014_rls.sql`: `using (true)`) - the same "display feed, not private
  data" shape as `activity`. Unlike every other list in this codebase,
  neither gets cursor pagination: the catalog is a short, fixed list,
  and `unique(user_id, achievement_id)` means a user can unlock each one
  at most once, so "all of a user's unlocks" is inherently small.
  `GET /api/achievements` (the catalog), `GET /api/achievements/mine`,
  and `GET /api/achievements/:username` (same
  username-to-id-then-list composition as Stage 11's activity
  endpoint) (`server/{routes,controllers,services}/achievement*.js`).
- **A real, previously-untested gap closed, not a bug**:
  `001_functional_test.sql` confirms `profiles.xp` after one award, but
  never checks that `award_xp()` actually recalculates and stores
  `profiles.level` alongside it - it happens to never cross a level
  boundary in that test (10 XP, level 1 the whole time), so a broken
  `calculate_level()` call inside `award_xp()` could have shipped
  unnoticed. `scripts/test/006_achievements_levels_test.sql` seeds a
  user 5 XP below the level 1→2 boundary (1000 XP) and confirms one real
  `award_xp()` call updates both columns correctly, plus `calculate_level()`'s
  boundary values directly (999 is level 1, 1000 is level 2).
- Frontend: `/achievements` - the full catalog merged with the caller's
  own unlocks into an unlocked/locked wall, plus an XP-to-next-level
  figure computed from the session's own already-authoritative
  `xp`/`level` fields (display only, mirroring `calculate_level()`'s
  1000-XP-per-level formula, never treated as an input to anything)
  (`public/js/achievements/`, `public/css/achievements.css`). The
  `/u/:username` profile page gains an "Achievements" section showing
  only what that person has actually unlocked - a wall of fame, not a
  hint list of what a stranger hasn't earned yet - using the same
  fetch-after-render pattern as its existing linked-accounts and
  activity sections.

### Local validation

`scripts/test/006_achievements_levels_test.sql` runs after 001-005
against the same freshly migrated database. Covers `calculate_level()`'s
boundaries directly (as `postgres`, since it's internal-only - the same
reasoning `001_functional_test.sql` uses to confirm
`reward_task_completion` has no client grant), `award_xp()` updating
`xp` and `level` together across a real boundary crossing, an unrelated
authenticated user reading both the catalog and another user's unlocks
(confirming the "public" policies are working as designed, not
accidentally permissive), and `anon` having no access to either table.

## Referrals (Stage 13)

Same relationship to Stage 2 as Stages 10–12: `claim_referral()` and
`try_reward_referral()` (`015_functions.sql`) were written in Stage 2 and
`handle_new_user()` has always assigned each new user a unique 8-character
alphanumeric `referral_code`. This stage is the first API/UI layer on top
of that machinery, plus one intentional design choice: `referral_code` is
added to the canonical `PROFILE_FIELDS` constant so it flows to clients
through `/auth/session`, `/auth/login`, and `/profile/me` without any
per-endpoint change — users now see their own shareable code.

Architecture choices:

- **`referral_code` in profile, `referred_by` not**: `referral_code` was
  always stored (`011_referrals.sql`) but never reached a client. `referred_by`
  (the raw FK) is excluded — derivable from `GET /api/referrals/mine` without
  cluttering every profile response with a second raw foreign key.
- **Two-query approach in `listMine()`**: the `referrals` table has two FK
  columns into `profiles` (`referrer_id`, `referred_id`). Disambiguating them
  in a PostgREST nested embed requires FK-hint syntax that can't be exercised
  against the local Postgres stub. A plain second `.in()` query for the
  "other party's" profiles is simpler and testable.
- **Admin-scope guard**: `referrals_select_participant` RLS lets admins see
  all referrals. `listMine()` adds an explicit `.or()` filter so an admin's
  "my referrals" call returns only their own rows — same pattern as
  Stage 10's `get_credit_summary()` `WHERE user_id = auth.uid()` guard.
- **`claim_referral` has client EXECUTE; `try_reward_referral` is
  internal-only**: the grant setup from Stage 2 is left untouched. The
  reward is issued inside `reward_task_completion()` (internal-only),
  never callable by the client.
- **Rate limit**: `POST /api/referrals/claim` is limited to 10 req/15 min
  (tighter than verification's 30) because brute-forcing referral codes
  has direct economic consequences.

### API endpoints

| Method | Path                     | Auth | Description                             |
|--------|--------------------------|------|-----------------------------------------|
| `GET`  | `/api/referrals/mine`    | ✓    | Paginated list of the caller's referrals |
| `POST` | `/api/referrals/claim`   | ✓    | Claim a referral code (10 req/15 min)   |

`GET /api/referrals/mine` supports `?before=<ISO-timestamp>` cursor
pagination. Each item includes `direction` (`"referrer"` / `"referred"`),
`other_user` (username + display_name), `status`, `reward_issued_at`, and
`created_at`.

### Frontend

`/referrals` — three sections:

1. **Share** — user's own 8-character referral code rendered in a monospace
   chip, plus a copy-to-clipboard button that generates the full
   `https://…/register?ref=CODE` link. Reads `store.getState().user.referral_code`
   (now available from the updated `PROFILE_FIELDS`).
2. **Claim** — form to enter a friend's code. Hidden once the loaded
   referral list reveals the user already has a referrer (UX only; the API
   enforces the one-referrer rule independently).
3. **History** — cursor-paginated list of all referrals (both directions)
   with pending / rewarded status badges.

(`public/js/referrals/`, `public/css/referrals.css`,
`public/pages/referrals.html`)

### Local validation

`scripts/test/007_referrals_rls_test.sql` runs after 001–006 against the
same freshly migrated database. Covers:

- `claim_referral()` happy path: referrals row inserted, `profiles.referred_by`
  set on the referred user.
- Duplicate claim guard: second call by the same user is blocked.
- Self-referral guard: blocked.
- Bad / non-existent code: blocked with `VALIDATION_ERROR`.
- RLS (`referrals_select_participant`): participant (referrer or referred)
  sees their own rows; outsider sees zero rows; admin sees all rows.
- `try_reward_referral()` is internal-only: `EXECUTE` revoked from public.

```bash
psql "$DATABASE_URL" \
  -f scripts/test/000_supabase_stub.sql \
  -f supabase/migrations/001_auth_schema.sql \
  ... (all migrations in order) \
  -f scripts/test/001_functional_test.sql \
  -f scripts/test/002_open_tasks_view_test.sql \
  -f scripts/test/003_completion_details_view_test.sql \
  -f scripts/test/004_credit_summary_test.sql \
  -f scripts/test/005_notifications_activity_test.sql \
  -f scripts/test/006_achievements_levels_test.sql \
  -f scripts/test/007_referrals_rls_test.sql
```

## Admin panel (Stage 14)

A read/write admin panel for platform operations: platform-wide stats,
user search and management (role + status changes, credit adjustments), and
an append-only audit log.

Architecture choices:

- **`requireAdmin` at the router level**: `server/routes/admin.routes.js`
  calls `router.use(requireAuth, requireAdmin)` once so every route in the
  file inherits both guards. The `requireAdmin` middleware checks
  `req.user.role === 'admin'` and returns `403` for anything else.
- **`getClientForUser()` for write RPCs, `supabaseAdmin` for reads**:
  `admin_update_user` and `admin_credit_adjustment` must run with the
  acting admin's identity so `auth.uid()` resolves to them inside the
  `SECURITY DEFINER` function — that's how `is_admin()` works and how the
  audit log records the correct actor. `supabaseAdmin` (service role) is
  appropriate for pure aggregate reads (stats, user list, audit log) where
  route-level `requireAdmin` is already the authorization boundary.
- **`adminOnly` route flag (frontend UX guard)**: `public/js/core/route-guards.js`
  now supports `adminOnly: true`. Non-admin authenticated users are
  redirected to `/` on the client. The redirect is UX only — the real
  enforcement is `requireAdmin` on the server. The Admin link in the nav
  (`public/js/auth/auth-nav.js`) is injected only for `user.role === 'admin'`
  so it never appears for regular users.
- **Cursor-based pagination throughout**: both the user list and the audit
  log use `?before=<ISO-timestamp>` cursors with `DEFAULT_PAGE_SIZE = 20`
  and `MAX_PAGE_SIZE = 50`.
- **Debounced search (300 ms)**: admin user search debounces input at the
  frontend so the API isn't hammered while the admin is mid-keystroke.
- **`admin_resolve_report` prepared for Stage 15**: the function already
  exists in `015_functions.sql` with EXECUTE granted to authenticated users;
  this stage's `admin.routes.js` does not expose it yet — Stage 15 adds the
  full moderation API.

### API endpoints

| Method   | Path                             | Auth + Role | Description                             |
|----------|----------------------------------|-------------|-----------------------------------------|
| `GET`    | `/api/admin/stats`               | admin       | Platform stats (6 aggregate counts)     |
| `GET`    | `/api/admin/users`               | admin       | Paginated user list with optional search |
| `GET`    | `/api/admin/users/:id`           | admin       | Single user profile + stats             |
| `PATCH`  | `/api/admin/users/:id`           | admin       | Update role and/or status (with reason) |
| `POST`   | `/api/admin/users/:id/credits`   | admin       | Adjust credit balance (with reason)     |
| `GET`    | `/api/admin/audit`               | admin       | Paginated audit log                     |

`GET /api/admin/users` accepts `?search=<text>`, `?before=<ISO>`, `?limit=<n>`.
`GET /api/admin/audit` accepts `?before=<ISO>`.

### Frontend

`/admin` — two sections:

1. **Stats tiles** — 6 at-a-glance platform counts (users, campaigns, active
   campaigns, completions, pending verifications, open reports). Rendered
   in a responsive auto-fill grid.
2. **User list** — debounced search, cursor-paginated list of users with role
   and status badges; each row links to `/admin/users/:id`.

`/admin/users/:id` — two sections:

1. **Profile view** — name, username, role/status badges, credits, XP/level,
   join date, referral code, completion stats.
2. **Action forms** — update role/status (pre-filled from current values)
   and credit adjustment (positive to add, negative to deduct), each with a
   required reason field and clear success/error feedback.

(`public/js/admin/`, `public/css/admin.css`, `public/pages/admin.html`,
`public/pages/admin-user.html`)

### Local validation

`scripts/test/008_admin_rls_test.sql` covers:

- `admin_update_user` happy path: status/role updated, audit_log row written.
- `admin_update_user` blocks non-admin caller (`UNAUTHORIZED`).
- `admin_credit_adjustment` happy path: credits updated, credit_ledger row written.
- `admin_credit_adjustment` blocks non-admin caller.
- `admin_credit_adjustment` rejects zero amount (`INVALID_AMOUNT`).
- RLS on `audit_logs`: admin sees rows; regular user sees zero rows.
- RLS on `credit_ledger`: owner sees own rows; outsider sees zero; admin sees all.
- `admin_resolve_report` function exists (Stage 15 readiness check).

```bash
psql "$DATABASE_URL" \
  -f scripts/test/000_supabase_stub.sql \
  -f supabase/migrations/001_auth_schema.sql \
  ... (all migrations in order) \
  -f scripts/test/001_functional_test.sql \
  -f scripts/test/002_open_tasks_view_test.sql \
  -f scripts/test/003_completion_details_view_test.sql \
  -f scripts/test/004_credit_summary_test.sql \
  -f scripts/test/005_notifications_activity_test.sql \
  -f scripts/test/006_achievements_levels_test.sql \
  -f scripts/test/007_referrals_rls_test.sql \
  -f scripts/test/008_admin_rls_test.sql
```

## Moderation / reporting (Stage 15)

Users can flag content (tasks, campaigns, other users) for review by admins.
Admins review the queue and resolve or dismiss each report. All state
transitions go through a `SECURITY DEFINER` function.

Architecture choices:

- **`supabaseAdmin` INSERT with server-side `reporter_id`**: the `reports`
  table RLS grants `INSERT (report_type, description, related_task_id,
  related_campaign_id, related_user_id)` — `reporter_id` is deliberately
  absent from the INSERT grant so a client can never impersonate another
  reporter. The server uses the service-role client with an explicit
  `reporter_id = req.user.id` (where `req.user.id` is set by `requireAuth`
  from the verified JWT). Security is enforced by `requireAuth`, not by RLS
  on this particular column.
- **`getClientForUser()` for `admin_resolve_report`**: the RPC is
  `SECURITY DEFINER` and calls `auth.uid()` internally for both the
  `is_admin()` guard and the audit log actor. Using `supabaseAdmin` here
  would leave `auth.uid()` as `null` inside the function. The same pattern
  as `admin_update_user` / `admin_credit_adjustment`.
- **Rate limiter on report submission**: `POST /api/reports` sits behind a
  dedicated `express-rate-limit` window of 10 requests / 15 minutes to
  prevent spam flooding.
- **`at_least_one_target` constraint (schema)**: every `reports` row must
  have at least one of `related_task_id`, `related_campaign_id`, or
  `related_user_id` non-null. Both the server validator and the SQL check
  constraint enforce this independently.
- **Reporter sees own rows; admin sees all**: RLS on `reports` has two
  SELECT policies — one for the reporter (`reporter_id = auth.uid()`),
  one for admins (`is_admin()`). Nothing else gets through.
- **`admin_resolve_report` validates decision**: accepts only `'resolved'`
  or `'dismissed'` — any other value raises `VALIDATION_ERROR`. The server
  validator mirrors this before the RPC call reaches the database.
- **Clickable stat tile**: the "Open reports" tile on the admin dashboard
  (`/admin`) is made focusable and keyboard-navigable (role=button,
  tabindex=0, Enter/Space) and navigates to `/admin/reports`. The tile
  grows a `--link` modifier class that adds a hover highlight.

### API endpoints

| Method  | Path                              | Auth + Role  | Description                                  |
|---------|-----------------------------------|--------------|----------------------------------------------|
| `POST`  | `/api/reports`                    | user         | Submit a new report (rate limited: 10/15 min)|
| `GET`   | `/api/reports/mine`               | user         | List the caller's own reports (paginated)    |
| `GET`   | `/api/admin/reports`              | admin        | List reports by status (paginated)           |
| `POST`  | `/api/admin/reports/:id/resolve`  | admin        | Resolve or dismiss a report                  |

`GET /api/reports/mine` and `GET /api/admin/reports` accept `?before=<ISO>` cursor.
`GET /api/admin/reports` also accepts `?status=open|resolved|dismissed` (default: `open`).

### Frontend

`/reports` — two sections:

1. **Submit form** — report type (enum select), target type (task / campaign / user),
   target UUID, and description (≥ 10 chars). On success the form resets and the
   history list updates.
2. **My reports** — cursor-paginated list of the current user's submitted reports
   with type, status badge (open / resolved / dismissed), description excerpt, and
   date.

`/admin/reports` — admin queue (admin-only route):

1. **Status filter** — dropdown: open / resolved / dismissed (reloads list on change).
2. **Reports list** — each row shows reporter name, target info, description, and
   (when open) inline Resolve / Dismiss buttons that update the row in place on
   success, replacing the action buttons with the new status badge.

(`public/js/reports/`, `public/js/admin/admin-reports.js`,
`public/css/reports.css`, `public/pages/reports.html`,
`public/pages/admin-reports.html`)

### Local validation

`scripts/test/009_reports_rls_test.sql` covers 9 assertions:

1. User can INSERT a report (server-side write path).
2. Reporter sees own report via RLS.
3. Non-reporter sees zero reports via RLS.
4. Admin sees all reports via RLS.
5. `admin_resolve_report` resolves an open report → `status = 'resolved'`.
6. `admin_resolve_report` dismisses an open report → `status = 'dismissed'`.
7. `admin_resolve_report` blocks non-admin caller (`FORBIDDEN`).
8. `admin_resolve_report` raises `NOT_FOUND` for an unknown report id.
9. `admin_resolve_report` raises `VALIDATION_ERROR` for an invalid decision string.

```bash
psql "$DATABASE_URL" \
  -f scripts/test/000_supabase_stub.sql \
  -f supabase/migrations/001_auth_schema.sql \
  ... (all migrations in order) \
  -f scripts/test/001_functional_test.sql \
  -f scripts/test/002_open_tasks_view_test.sql \
  -f scripts/test/003_completion_details_view_test.sql \
  -f scripts/test/004_credit_summary_test.sql \
  -f scripts/test/005_notifications_activity_test.sql \
  -f scripts/test/006_achievements_levels_test.sql \
  -f scripts/test/007_referrals_rls_test.sql \
  -f scripts/test/008_admin_rls_test.sql \
  -f scripts/test/009_reports_rls_test.sql
```

## Security hardening (Stage 16)

Defensive layers added across the Express middleware stack and deployment
configuration. No new user-facing features; everything here makes the
existing API safer and more observable.

### Changes

**`server/middleware/request-id.js`** (new)  
Attaches a UUID v4 to `req.requestId` and echoes it in the `X-Request-Id`
response header on every request. Honours an upstream `X-Request-Id` header
(e.g. from Vercel's edge) so the ID chain is preserved. Every error response
and every `logger.error()` call now includes `requestId`, making cross-layer
correlation possible without personal data.

**`server/middleware/require-json.js`** (new)  
Globally enforces `Content-Type: application/json` for POST, PUT and PATCH
requests that carry a body. Without this, a form-encoded body would silently
pass `express.json()` as `undefined`, making required-field validators report
the wrong error. Returns HTTP 415 (Unsupported Media Type) via
`VALIDATION_ERROR`.

**`server/middleware/validate-uuid-param.js`** (new)  
Middleware factory: `validateUuidParam('id')` returns a middleware that
rejects the request with HTTP 400 if `req.params.id` is not a well-formed
UUID. Applied to every route that uses a UUID path parameter:
`admin.routes.js` (`/users/:id`, `/reports/:id/resolve`),
`campaigns.routes.js` (`/:id` and sub-paths),
`social.routes.js` (`/:id`), `notifications.routes.js` (`/:id/read`),
`verification.routes.js` (`/tasks/:taskId`, `/:id/review`).
Prevents malformed IDs from ever reaching the database (which would produce
a type error at the Postgres layer anyway, but this gives a cleaner message
and saves the round-trip).

**`server/middleware/security.js`** (updated)  
Adds `app.set('trust proxy', 1)` so Express reads the real client IP from
`X-Forwarded-For` when running behind Vercel's edge (rate limiting was
previously bucketing all traffic under the proxy's single IP).  
Sets a `Permissions-Policy` header to explicitly disable browser features the
app never uses: camera, microphone, geolocation, payment, USB. (Helmet has no
option for this header, so a small middleware sets it directly; the same value
is applied to static files through `vercel.json`.)  
Adds `strictTransportSecurity` with a 1-year `max-age`, `includeSubDomains`,
and `preload` so browsers enforce HTTPS after the first visit.  
Adds `upgradeInsecureRequests` CSP directive.

**`server/config/env.js`** (updated)  
In `NODE_ENV=production`, missing required environment variables now throw
immediately at startup (previously only warned). A production server with
no credentials would silently error on every authenticated request, which
is worse than a clean crash.

**`server/middleware/error-handler.js`** (updated)  
`requestId` is now included in every JSON error response body so a client
can include it in a support report.

**`server/server.js`** (updated)  
- Wires `requestId` middleware before everything else.
- Wires `requireJson` after `express.json()` and before the route tree.
- Removes a stale commented-out duplicate `/api/reports` mount left over
  from Stage 15.
- `/api/health` now reports `stage: 'stage-15'` reflecting completion.

### What was already in place

- CORS restricted to `config.appUrl` origin (server.js, Stage 1).
- Helmet CSP with `script-src: 'self'` and no `unsafe-eval` (security.js, Stage 1).
- `requireAuth` re-verifies the bearer token and re-reads the profile from
  the database on every request — never caches claims (auth.js, Stage 3).
- `requireAdmin` layers a role check on top for admin routes (admin.js, Stage 14).
- `express.json({ limit: '1mb' })` body-size cap (server.js, Stage 1).
- Per-route rate limiters on auth, campaign writes, verification writes, and
  report submission (Stages 3, 9, 8, 15 respectively).
- General API limiter (`generalLimiter`) applied globally (server.js, Stage 1).
- `SECURITY DEFINER` functions with `is_admin()` guard, revoked EXECUTE
  grants on internal helpers, append-only ledger/audit tables (Stage 2).

### Local validation (database side)

`scripts/test/010_security_hardening_test.sql` verifies:

- `reward_task_completion`, `update_xp_and_level`, and
  `grant_achievement_if_not_exists` have no EXECUTE grant for the
  `authenticated` role (internal-only, as required by spec section 30).
- `handle_new_user` is a trigger function (not callable directly over RPC).
- All public-facing admin and economic RPCs still have their EXECUTE grants
  intact (sanity check that the revocations above didn't accidentally remove
  the wrong grants).

The Express-layer hardening (request ID, require-json, UUID param
validation, trust proxy) is validated by manual curl/httpie requests against
the development server, as it requires a running Express process.

## Getting started

```bash
npm install
cp .env.example .env   # fill in Supabase project values
npm run dev
```

The server serves the frontend and exposes `GET /api/health` for now.

## Environment variables

See `.env.example`. Required: `SUPABASE_URL`, `SUPABASE_ANON_KEY`,
`SUPABASE_SERVICE_ROLE_KEY`. The service-role key is used only on the
server (`server/config/supabase.js`) and must never reach the frontend.

## Known gaps

- **No live Supabase project yet.** Migrations (Stage 2) and auth
  (Stage 3) are written and locally validated but not yet exercised
  against real Supabase infrastructure - `npm install` also hasn't been
  run in the current build environment. Once a project exists: apply
  `supabase/migrations/*.sql` in order, fill in `.env`, `npm install`,
  and re-check the auth flows for real (Supabase's actual email-
  confirmation setting in particular changes what `/register` returns -
  see `auth/register.js`).

## Testing (Stage 17)

Automated test suite using Node's built-in `node:test` runner — no Jest,
no Mocha, no additional test dependencies. `npm test` runs 105 tests across
two layers.

### Test layers

| Layer | Runner | What is tested |
|---|---|---|
| `tests/unit/` | `node:test` + `node:assert/strict` | Pure functions and middleware in isolation: mock req/res/next objects, no HTTP |
| `tests/integration/` | `node:test` + built-in `fetch` | Full middleware stack at HTTP level against a minimal `node:http` test server |

### Unit tests (63 assertions)

- **`errors.test.js`** — `AppError` constructor, status-code mapping, default message, all `ErrorCodes` constants
- **`validators.test.js`** — All auth, admin and reports validators: valid-body happy paths + every error condition (missing field, wrong type, out-of-range, UUID format, enum values)
- **`middleware.test.js`** — `requestId`, `requireJson`, `validateUuidParam` using mock req/res/next objects; covers GET/DELETE passthrough, bodyless POST, upstream ID honour, uppercase UUID, SQL-injection-shaped params

### Integration tests (42 assertions)

Integration tests run against a minimal `node:http` server built in
`tests/integration/server.helper.js`. It wires up the three pure middleware
modules (`request-id`, `require-json`, `validate-uuid-param`) and a synchronous
auth stub — no Express, no Supabase, no npm packages required.

- **`health.test.js`** — `GET /api/health` returns 200 `{status:'ok', stage:'stage-…'}`; unknown API routes return 404 `NOT_FOUND`
- **`request-id.test.js`** — Every response (200, 401, 404) carries `X-Request-Id`; error bodies include `requestId` matching the header; upstream `X-Request-Id` is honoured; IDs are unique per request
- **`auth-guards.test.js`** — 13 protected routes (auth, profile, credits, tasks, campaigns, notifications, achievements, referrals, reports, admin) return 401 `UNAUTHORIZED` with no `Authorization` header; error body has `{error:{code,message}, requestId}`
- **`content-type.test.js`** — `POST` with `application/x-www-form-urlencoded`, `text/plain`, `multipart/form-data` or no Content-Type all return 415 `VALIDATION_ERROR`; `application/json` and `application/json; charset=utf-8` pass the gate; `GET` is exempt
- **`uuid-params.test.js`** — Bad UUID path params (non-UUID strings, SQL injection, bare integers) return 400 `VALIDATION_ERROR`; valid UUIDs pass the gate and reach the auth guard (401); routes are confirmed registered (not 404)

### Running the tests

```bash
# Full suite (105 tests, ~2.5 s, no npm install needed)
npm test
# or: node --test tests/unit/*.test.js tests/integration/*.test.js

# Unit tests only (63 tests, ~0.3 s)
npm run test:unit

# Integration tests only (42 tests, ~2.2 s)
npm run test:integration
```

> The integration tests deliberately avoid starting the real Express app
> (which needs `npm install` + Supabase credentials). They test the middleware
> modules at HTTP level using only built-in Node.js APIs. Full end-to-end API
> testing (with a live Supabase project) is covered by the SQL harness in
> `scripts/test/`.

---

## CI/CD (Stage 18)

### GitHub Actions — `.github/workflows/ci.yml`

Runs on every push and pull request to `main`/`master`. Two jobs:

| Job | What it does |
|---|---|
| **syntax** | `node --check` on every `.js` in `server/`, `api/` and `tests/`; ES-module check on every `.js` in `public/js/` |
| **test** | `node --test tests/unit/*.test.js tests/integration/*.test.js` — no `npm install` needed |

The test job depends on the syntax job passing first.

### Vercel — `vercel.json` + `api/index.js`

Two halves, served differently:

| Path | Served by | How |
|---|---|---|
| `public/**` (HTML, CSS, browser JS, page fragments) | Vercel CDN | `"outputDirectory": "public"` |
| `/api/*` | One Vercel Function: `api/index.js` → the Express app in `server/server.js` | rewrite `/api/(.*)` → `/api` (the original URL is kept in `req.url`) |
| any other path without a file extension (`/tasks`, `/u/nino`, …) | `public/index.html` | SPA rewrite, so deep links survive a refresh |

Real files always win over rewrites, so `/js/core/app.js` is served as-is.
`vercel.json` also applies the same security headers Helmet sends from
Express (CSP, HSTS, `nosniff`, frame and referrer policy, Permissions-Policy)
to every non-API response, since static files never pass through Express.

> **Never bundle `public/` into the function** (the old `builds` +
> `includeFiles: ["public/**"]` setup). The Node builder transpiles every
> bundled `.js` file to CommonJS, so the browser received
> `exports.init = …` instead of ES modules, `app.js` threw on load and every
> page rendered blank. `tests/unit/config.test.js` guards against this.

Locally nothing changes: `npm start` runs `server/server.js`, which serves
`public/` itself via `express.static` and the same SPA fallback.

**Deployment workflow:**
1. Push to `main` → CI runs (syntax + tests)
2. If CI passes, Vercel automatically deploys to production
3. Pull requests get an automatic preview deployment

**Vercel environment variables** (set in project settings):
```
SUPABASE_URL                ← required
SUPABASE_ANON_KEY           ← required: publishable key (sb_publishable_…) or legacy anon JWT
SUPABASE_SERVICE_ROLE_KEY   ← required: secret key (sb_secret_…) or legacy service_role JWT — never commit it
APP_URL                     ← recommended: your production URL, e.g. https://exchange-ivory-one.vercel.app
```
`APP_URL` is used for CORS and for the links in sign-up confirmation and
password-reset emails. If it is not set, the server falls back to Vercel's
own `VERCEL_PROJECT_PRODUCTION_URL` (production) or `VERCEL_URL` (previews),
and only then to `http://localhost:3000`.

**Supabase → Authentication → URL Configuration** must allow the email links:
Site URL = your production URL, and Redirect URLs include
`https://<your-domain>/**` (plus `http://localhost:3000/**` for local work).

### Node version

`.nvmrc` pins Node 22 for local work and GitHub Actions; `package.json`
`"engines": { "node": "22.x" }` pins it for Vercel (Vercel reads `engines`,
not `.nvmrc`).

---

## Design system (Mono Minimal)

Black and white, hairline borders, one quiet blue (`--color-accent`) used only
for links, focus rings and the current page. All values live in
`public/css/variables.css`; no other stylesheet hard-codes a color.

| | Light | Dark |
|---|---|---|
| Canvas / surface | `#FFFFFF` / `#FAFAFA` | `#000000` / `#0A0A0A` |
| Hairline / form-field border | `#EAEAEA` / `#8F8F8F` (3:1) | `#262626` / `#616161` (3:1) |
| Text / muted | `#000000` / `#666666` | `#EDEDED` / `#A1A1A1` |
| Accent | `#2563EB` (5.2:1) | `#3B82F6` (5.7:1) |

- **Type:** FiraGO (SIL OFL, `public/fonts/`), self-hosted and subset to
  Latin + Georgian (about 30 KB per weight; 400/500/600) so Georgian names
  and titles render in the same voice as Latin. Tabular figures for credits.
- **Themes:** `js/core/theme-init.js` (a classic script at the top of
  `<head>`, since the CSP forbids inline scripts) sets `<html data-theme>`
  before first paint: the stored choice, else the device setting.
  `js/core/theme.js` runs the header ☀/☾ button. A choice is stored only
  while it differs from the device, so switching back follows the device
  again.
- **Shared patterns (`base.css`):** record lists are one hairline-bordered
  container with divided rows; summaries (`<dl>`) are label/value rows;
  statuses are neutral pills with a colored dot (modifiers only set `--dot`).
- **Header:** two rows on screens wider than 820px (brand + account +
  theme, then page tabs); below that, a single row with a drop-down menu.
- **Home:** visitors see the explainer (hero, ledger "ticket", how it
  works, platforms); signed-in people see a dashboard (credits, level,
  unread, open tasks).

---

## Post-deploy fixes

Found after the first real deployment (Vercel + a fresh Supabase project):

| Area | Problem | Fix |
|---|---|---|
| Vercel | `public/**` was bundled into the function and transpiled to CommonJS, so the browser's ES modules threw and every page was blank | CDN serves `public/`; `api/index.js` runs Express for `/api/*` (see "Vercel") |
| Server start | `reports.controller.js` imported `asyncHandler` without destructuring → `TypeError` at boot (500 on every request) | `const { asyncHandler } = …` |
| Logging | `logger.js` destructured a non-existent `isProduction` export, so production never logged JSON | read `config.isProduction` |
| Sign-up | With email confirmation on (Supabase's default) the chosen username and referral code were silently dropped | username set with the admin client; referral code parked in user metadata and claimed on first sign-in |
| Password reset | Emailed link went to the site root (no `redirectTo`), and the confirm step called `auth.updateUser()` on a session-less client ("Auth session missing") | `redirectTo: <APP_URL>/password-reset`; token verified, then `admin.updateUserById` |
| Logout | `auth.signOut()` on a session-less client never revoked the refresh token | `auth.admin.signOut(token, 'global')` |
| Sessions | One shared anon client served sign-in/refresh for all requests; supabase-js keeps the last session in memory and merges concurrent refreshes, so users could receive each other's sessions | `createAuthClient()` — a fresh client per auth call |
| Config | `APP_URL` unset → CORS origin and email links pointed at `http://localhost:3000` | falls back to Vercel's system URL variables |
| Security headers | Helmet ignored the `permissionsPolicy` option — the header was never sent | set directly in `security.js` and `vercel.json` |
| Admin | Audit log selected non-existent columns (`entity_type`, `before`, …); "pending verifications" counted a non-existent `task_verifications.status` | real columns (`target_type`, `before_data`, …); count pending `task_completions` |
| Errors | `DB_ERROR` was not a defined code (responses had no `code`), and 5xx responses echoed raw database messages | `DB_ERROR` added; 5xx messages are generic, details only in logs |
| New campaign | Balance hint read `balance` from a `{ credits }` response → "undefined credits" | reads `credits` |
| Mobile | Header nav overflowed the viewport (page scrolled sideways ~560–700 px) | nav collapses into a menu below 1240px (`js/core/nav-menu.js`) |

---

## Production readiness (Stage 19)

Process-level hardening added to prepare for a live Vercel deployment. No
new user-facing features.

### Structured logging — `server/utils/logger.js`

The logger now switches output format based on `NODE_ENV`:

| Environment | Format | Rationale |
|---|---|---|
| `development` | `[ISO-8601] LEVEL  message {meta}` | Human-readable for local `node server/server.js` |
| `production` | `{"level":"info","time":"…","msg":"…",...meta}` | JSON lines — Vercel's log viewer and any log-shipper can parse structured fields without regexes |

All `meta` keys are spread directly into the JSON object so structured
fields (requestId, method, url) are first-class properties, not a
nested `meta` blob.

### Request timeout — `server/middleware/request-timeout.js`

A per-request timer (default 30 s, overridable via `REQUEST_TIMEOUT_MS` env
var) returns `503 TIMEOUT` if no response has been sent when it fires.

- Arms on every request after `requestId` runs (so timeout logs include the
  correlation ID).
- Disarmed by the `res.finish` / `res.close` events on normal completion.
- Protected by a `done` flag: if the timer fires after the response has
  already committed bytes (streaming), the socket is destroyed instead of
  attempting to set headers.
- Default 30 s is well below Vercel Hobby's 60 s forced-kill limit;
  overriding it up to 300 s (Vercel Pro's limit) is safe.
- Added `TIMEOUT: 503` and `INTERNAL: 500` to `server/utils/errors.js`'s
  `ErrorCodes`/`STATUS_BY_CODE` — the first new error codes since Stage 15.

### Graceful shutdown — `server/server.js`

When the process receives `SIGTERM` (Vercel / Docker / k8s sends this before
a forced kill) or `SIGINT` (Ctrl-C in local dev):

1. `server.close()` stops accepting new connections immediately.
2. In-flight requests are allowed to complete (the close callback fires once
   they all finish).
3. The process exits 0 so the process manager records a clean shutdown, not
   a crash.
4. A 10 s hard-kill timer (`.unref()` so it doesn't hold the event loop open
   by itself) forces exit 1 if a stray long-running request refuses to finish.

`uncaughtException` and `unhandledRejection` handlers log the error
(structured JSON in production) and exit 1 so the process manager restarts
rather than letting the process limp along in a broken state.

### Health check update — `GET /api/health`

Returns `{ status, stage, node, uptime }`:

- `stage: 'stage-19'` tracks deployment version.
- `node` — the Node.js version in use, for quick environment confirmation.
- `uptime` — seconds the process has been running (floor integer); useful for
  detecting silent restarts in monitoring dashboards.

The endpoint remains synchronous (no DB call). Supabase's own
`/rest/v1/` health endpoint is the right place to check DB connectivity; a
DB error should not make the load-balancer pull the instance before the
error handler has a chance to log it.

### Environment variable

`.env.example` now documents `REQUEST_TIMEOUT_MS` (default `30000`).

---

## Roadmap

- [x] 1. Project architecture
- [x] 2. Database schema (written and locally validated; not yet applied to a live Supabase project)
- [x] 3. Authentication (written; not yet tested end to end - no live Supabase project yet)
- [x] 4. Profiles (written; not yet tested end to end - no live Supabase project yet)
- [x] 5. Social profiles (written; not yet tested end to end - no live Supabase project yet)
- [x] 6. Credit ledger (written; not yet tested end to end - no live Supabase project yet)
- [x] 7. Tasks (written; the new view is locally validated, same caveat as Stages 2-6 for everything else)
- [x] 8. Verification (written and locally validated; also fixed a real RLS-bypass bug in both Stage 7's and this stage's views - see "Verification (Stage 8)")
- [x] 9. Campaigns (written; built entirely on Stage 2's already-validated functions, same live-Supabase caveat as everything else)
- [x] 10. Reward engine (mechanics were Stage 2's; this stage added a summary read and fixed two bugs in the local stub/grant hygiene - see "Reward engine (Stage 10)")
- [x] 11. Notifications / activity (written and locally validated; both tables were Stage 2's, this stage is their first API/UI - see "Notifications & activity (Stage 11)")
- [x] 12. XP / levels / achievements (mechanics were Stage 2's; this stage added their first API/UI and closed a real test gap - see "XP, levels, achievements (Stage 12)")
- [x] 13. Referrals (written and locally validated; mechanics were Stage 2's, this stage added their first API/UI and exposed referral_code in the profile shape - see "Referrals (Stage 13)")
- [x] 14. Admin (written and locally validated; stats, user management, credit adjustment, audit log — see "Admin panel (Stage 14)")
- [x] 15. Moderation (written and locally validated; report submission, my-reports history, admin queue with inline resolve/dismiss — see "Moderation / reporting (Stage 15)")
- [x] 16. Security hardening (request ID tracing, Content-Type enforcement, UUID param validation, trust proxy, Permissions-Policy, HSTS, production env hard fail — see "Security hardening (Stage 16)")
- [x] 17. Testing (105 tests — unit: AppError, validators, middleware; integration: health, request-id, auth guards, Content-Type enforcement, UUID param validation — see "Testing (Stage 17)")
- [x] 18. CI/CD (GitHub Actions: syntax check + node:test on every push/PR; Vercel: CDN serves public/, api/index.js runs Express for /api/*; Node 22 pinned — see "CI/CD (Stage 18)")
- [x] 19. Production readiness (structured JSON logging, request timeout middleware, graceful SIGTERM/SIGINT shutdown, uncaughtException/unhandledRejection handlers, health check enriched with node version + uptime — see "Production readiness (Stage 19)")
- [x] Post-deploy fixes (blank page on Vercel, auth email flows, admin queries, mobile nav — see "Post-deploy fixes")
- [x] Design system: Mono Minimal light/dark themes, FiraGO (Latin + Georgian), new home page — see "Design system (Mono Minimal)"
