// server/config/env.js
// Loads and validates environment variables. In production, missing
// required Supabase credentials are a hard failure — there is no safe
// fallback. In development/test, a warning is printed so the server
// can still start (useful for tasks that don't touch the database, e.g.
// running the frontend standalone or running the local SQL test harness).

const REQUIRED = ['SUPABASE_URL', 'SUPABASE_ANON_KEY', 'SUPABASE_SERVICE_ROLE_KEY'];

// Public base URL of the site (CORS origin, auth email redirect links).
// APP_URL wins when set; on Vercel it falls back to the system variables
// Vercel injects at runtime, so a missing APP_URL no longer silently means
// "http://localhost:3000" in production.
function resolveAppUrl() {
  const strip = (url) => url.replace(/\/+$/, '');
  if (process.env.APP_URL) return strip(process.env.APP_URL);
  if (process.env.VERCEL_ENV === 'production' && process.env.VERCEL_PROJECT_PRODUCTION_URL) {
    return `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`;
  }
  if (process.env.VERCEL_URL) return `https://${process.env.VERCEL_URL}`;
  return 'http://localhost:3000';
}

function readConfig() {
  const env = process.env.NODE_ENV || 'development';
  const missing = REQUIRED.filter((key) => !process.env[key]);

  if (missing.length > 0) {
    const msg =
      `Missing required environment variables: ${missing.join(', ')}. ` +
      'Copy .env.example to .env and fill them in.';

    if (env === 'production') {
      // Hard failure — a production server with no credentials would
      // silently return errors on every authenticated request, which is
      // worse than a clean crash.
      throw new Error(`[config] ${msg}`);
    }

    // eslint-disable-next-line no-console
    console.warn(`[config] ${msg}`);
  }

  return {
    port: Number(process.env.PORT) || 3000,
    appUrl: resolveAppUrl(),
    nodeEnv: env,
    isProduction: env === 'production',
    supabaseUrl: process.env.SUPABASE_URL || '',
    supabaseAnonKey: process.env.SUPABASE_ANON_KEY || '',
    supabaseServiceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY || '',
    rateLimit: {
      windowMs: Number(process.env.RATE_LIMIT_WINDOW_MS) || 60_000,
      max: Number(process.env.RATE_LIMIT_MAX) || 100,
    },
  };
}

const config = readConfig();

module.exports = { config };
