// server/config/supabase.js
// Three Supabase clients, used for three different purposes:
//  - supabaseAdmin: service-role key, bypasses RLS. Only for server-side
//    logic that must act with elevated privilege (reward engine, admin
//    actions). Never expose this client or its key to the frontend.
//  - supabaseAnon: anon key, no user context. Only for the pre-auth
//    flows (register/login/password-reset-request) where there is no
//    access token yet.
//  - getClientForUser: builds a request-scoped client authenticated as the
//    calling user's own access token, so normal Postgres RLS policies
//    apply. Use this for anything an already-authenticated user does on
//    their own behalf (this is also the client every RPC call in
//    services/*.service.js goes through, so auth.uid() inside the
//    database functions resolves to the real caller).

const { createClient } = require('@supabase/supabase-js');
const { config } = require('./env');

const supabaseAdmin = createClient(config.supabaseUrl, config.supabaseServiceRoleKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});

const supabaseAnon = createClient(config.supabaseUrl, config.supabaseAnonKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});

function getClientForUser(accessToken) {
  return createClient(config.supabaseUrl, config.supabaseAnonKey, {
    global: { headers: { Authorization: `Bearer ${accessToken}` } },
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

module.exports = { supabaseAdmin, supabaseAnon, getClientForUser };
