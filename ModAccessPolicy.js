'use strict';

// All grants are administrator-owned database fields. Never copy these from a login body.
function authorize(user, buildId, allowedBuilds, feature, now = Date.now()) {
  const grant = user?.modLicense;
  if (!grant || grant.revoked || grant.enabled !== true) return 'license_required';
  if (!Number.isFinite(grant.expiresAtMs) || grant.expiresAtMs <= now) return 'license_expired';
  if (typeof grant.deviceId !== 'string' || grant.deviceId !== user.deviceId) return 'device_not_licensed';
  if (typeof buildId !== 'string' || !allowedBuilds.has(buildId)) return 'build_not_allowed';
  if (!Array.isArray(grant.features) || !grant.features.includes(feature)) return 'feature_not_licensed';
  return null;
}

function featureForPath(path) {
  if (/^\/ranked(?:\/|$)/i.test(path) || /^\/matchmaking(?:\/|$)/i.test(path)) return 'ranked';
  if (/^\/action-emotes(?:\/|$)/i.test(path)) return 'abilities';
  return 'core';
}

module.exports = { authorize, featureForPath };
