// Acknowledge the rank shown by the client, without granting tier rewards or
// accepting a client-provided rank. $max keeps concurrent acknowledgements monotonic.
async function acknowledge(users, stumbleId) {
  const user = await users.findOne({ stumbleId }, { timeoutMS: 5000 });
  if (!user) throw Object.assign(new Error('User not found.'), { status: 404 });
  const ranked = user.userProfile?.ranked || {};
  const current = ranked.currentRankId || 1;
  const before = await users.findOneAndUpdate(
    { _id: user._id, 'userProfile.ranked.currentSeasonId': ranked.currentSeasonId },
    { $max: { 'userProfile.ranked.lastSeenRankId': current } },
    { returnDocument: 'before', includeResultMetadata: false, timeoutMS: 5000 }
  );
  if (!before) throw Object.assign(new Error('Ranked season changed. Please retry.'), { status: 409 });
  return {
    PreviouslySeenRankId: before.userProfile?.ranked?.lastSeenRankId || 1,
    CurrentRankId: current
  };
}
module.exports = { acknowledge };
