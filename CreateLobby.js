'use strict';

// Private-server clients remove this marker before sending room options to
// Photon. It is not a signed ticket for the official matchmaking service.
module.exports = function createLobby(req, res) {
  if (!req.user) return res.status(401).json({ error: 'UNAUTHORIZED' });
  const body = req.body || {};
  const type = body.LobbyType ?? body.lobbyType;
  const variant = body.VariantId ?? body.variantId;
  if (typeof type !== 'string' || !type.trim() || type.length > 128 ||
      (variant != null && (typeof variant !== 'string' || variant.length > 256))) {
    return res.status(400).json({ error: 'INVALID_LOBBY_REQUEST' });
  }
  res.set('Cache-Control', 'no-store');
  return res.json({ Ticket: 'local' });
};
