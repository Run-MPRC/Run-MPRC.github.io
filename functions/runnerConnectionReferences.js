'use strict';

const { createHash } = require('node:crypto');

const ENTRY_COLLECTION = 'runnerConnectionEntries';
const WINDOW_COLLECTION = 'runnerConnectionWindows';
const EXCLUSION_COLLECTION = 'runnerConnectionExclusions';
const DAY_MS = 24 * 60 * 60 * 1000;
const digest = (...parts) => createHash('sha256').update(JSON.stringify(parts)).digest('hex');
const runnerEntryId = (uid) => `entry_${digest('runner_entry_v1', uid)}`;
const suggestionRef = (viewer, target) => `runner_${digest('runner_suggestion_v1', viewer, target)}`;
const exclusionId = (viewer, target) => `pair_${digest('runner_exclusion_v1', viewer, target)}`;
const windowPivot = (viewer, day) => `entry_${digest('runner_window_v1', viewer, day)}`;

// These are linkable private pseudonyms, not secrets or authorization tokens.
module.exports = {
  ENTRY_COLLECTION, WINDOW_COLLECTION, EXCLUSION_COLLECTION, DAY_MS,
  digest, runnerEntryId, suggestionRef, exclusionId, windowPivot,
};
