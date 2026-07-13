'use strict';

// Netlify's ignore command uses 0 to stop a build and 1 to continue it.
// Keep public, read-only Deploy Previews available, but do not let a main
// branch merge silently publish runmprc.com before the protected host gate.
const { CONTEXT: context } = process.env;

if (!context || context === 'production') {
  console.log('Git-triggered Netlify production builds are paused.');
  process.exitCode = 0;
} else {
  console.log('Non-production Netlify build may continue for public review.');
  process.exitCode = 1;
}
