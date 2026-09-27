'use strict';

// Emulator-only entry point. Never imported by functions/index.js. No production
// feature switch, Auth override or App Check enforcement change is introduced.
const { prepareRunnerEmulators } = require('./environment');
prepareRunnerEmulators(process.env, { runtime: true });
const { installNetworkGuard } = require('../testSafety');
installNetworkGuard();
const { initializeRunnerAdmin } = require('./admin');
const { createRunnerConnectionCallables } = require('../../runnerConnectionService');

initializeRunnerAdmin();
module.exports = createRunnerConnectionCallables({ enabled: true });
