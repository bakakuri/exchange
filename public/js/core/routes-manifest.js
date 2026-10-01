// js/core/routes-manifest.js
// Imported once, purely for its side effects: each feature's routes.js
// module calls registerRoute() at load time. This file is the single
// place that lists which features exist - add one line here when a new
// feature gains its own routes, and nothing else needs to change.

import '../home/routes.js';
import '../auth/routes.js';
import '../profile/routes.js';
import '../credits/routes.js';
import '../tasks/routes.js';
import '../submissions/routes.js';
import '../campaigns/routes.js';
import '../notifications/routes.js';
import '../achievements/routes.js';
import '../referrals/routes.js';         // Stage 13
import '../admin/routes.js';             // Stage 14
import '../reports/routes.js';           // Stage 15
