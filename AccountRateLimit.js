'use strict';
const crypto = require('node:crypto');
module.exports = function accountRateLimit({ limit = 600, windowMs = 60000, maxAccounts = 10000,
  now = Date.now, report = console.warn } = {}) {
  const buckets = new Map();
  let nextSweep = 0;
  return function (req, res, next) {
    if (!req.user?.stumbleId) return next();
    const time = now();
    if (time >= nextSweep) {
      for (const [key, value] of buckets) if (value.until <= time) buckets.delete(key);
      nextSweep = time + windowMs;
    }
    const key = crypto.createHash('sha256').update(String(req.user.stumbleId)).digest('hex');
    let bucket = buckets.get(key);
    if (!bucket || bucket.until <= time) {
      if (!bucket && buckets.size >= maxAccounts) return res.status(503).json({ code: 'security_capacity' });
      bucket = { count: 0, until: time + windowMs };
      buckets.set(key, bucket);
    }
    if (++bucket.count > limit) {
      if (bucket.count === limit + 1) report('[ModSecurity] account_rate_limit');
      res.set('Retry-After', String(Math.max(1, Math.ceil((bucket.until - time) / 1000))));
      return res.status(429).json({ code: 'rate_limited' });
    }
    next();
  };
};
