'use strict';
// Local aggregate counters only: no credentials, device IDs, account IDs or request bodies.
const allowed = new Set(['identity_rejected', 'license_rejected', 'session_rejected', 'proof_rejected', 'replay_rejected']);
let counts = Object.create(null);
const timer = setInterval(() => {
  if (Object.keys(counts).length) console.warn('[ModSecurity]', JSON.stringify(counts));
  counts = Object.create(null);
}, 60000);
timer.unref();
exports.record = event => {
  if (allowed.has(event)) counts[event] = Math.min((counts[event] || 0) + 1, Number.MAX_SAFE_INTEGER);
};
