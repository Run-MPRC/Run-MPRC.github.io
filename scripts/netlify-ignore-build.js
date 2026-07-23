'use strict';

// Netlify's ignore command uses 0 to stop a build and 1 to continue it.
// Keep public, read-only Deploy Previews available. Production continues only
// for the exact merge authorized by the reviewed release manifest. Retiring the
// pinned source ref after verification prevents later retries of that merge.
// Every missing, malformed, stale, or otherwise uncertain state stops the build.
const {
  authorizeProductionRelease,
} = require('./netlify-release-policy');

const { CONTEXT: context } = process.env;

if (context === 'deploy-preview' || context === 'branch-deploy') {
  console.log('Non-production Netlify build may continue for public review.');
  process.exitCode = 1;
} else if (context === 'production') {
  const authorization = authorizeProductionRelease();
  if (authorization.ok) {
    console.log(
      `Authorized exact production release ${authorization.manifest.releaseId}.`,
    );
    process.exitCode = 1;
  } else {
    console.log(
      `Git-triggered Netlify production build is paused (${authorization.reason}).`,
    );
    process.exitCode = 0;
  }
} else {
  console.log('Git-triggered Netlify production builds are paused.');
  process.exitCode = 0;
}
