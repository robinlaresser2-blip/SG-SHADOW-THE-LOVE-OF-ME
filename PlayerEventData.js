'use strict';

// /game-events/me is PlayerEventDataResponse, not a catalog of event definitions.
// This backend has no persisted event progression implementation. Report none;
// do not invent progress or expose catalog rows with missing EventId fields.
function getPlayerEventData(_req, res) {
  return res.status(200).json({
    GameEvents: [],
    UpdatedUser: null,
    AutoClaimedEventIds: []
  });
}

module.exports = { getPlayerEventData };
