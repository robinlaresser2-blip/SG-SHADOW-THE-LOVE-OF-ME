const crypto = require('node:crypto');
const invalid = (message, status = 400) => Object.assign(new Error(message), { status });

// Authenticated client-reported results, not authoritative match-server proof.
function score(user, finish, shared, now = Date.now()) {
  const season = shared.RankedPlaySettings.Seasons.find(s => s.IsEnabled && Date.parse(s.StartDateTime) <= now && now < Date.parse(s.EndDateTime));
  if (!season) throw invalid('No active ranked season.', 409);
  const placement = finish.ClientViewPlacements?.[String(user.id)];
  if (!Number.isInteger(placement) || placement < 1 || placement > season.MaxPlayers) throw invalid('Invalid player placement.');
  const ranked = user.userProfile?.ranked || {};
  if (ranked.currentSeasonId && ranked.currentSeasonId !== season.Id) throw invalid('Ranked profile requires season migration.', 409);
  const previous = ranked.currentRankPoints ?? 0;
  if (!Number.isSafeInteger(previous) || previous < 0) throw invalid('Invalid stored rank points.', 409);
  const tiers = season.Ranks.flatMap(rank => rank.Tiers.map((tier, index) => ({ rank, index, threshold: tier.RankPointThreshold }))).sort((a,b) => a.threshold-b.threshold);
  const tierAt = points => tiers.filter(t => t.threshold <= points).at(-1);
  const before = tierAt(previous);
  const band = before?.rank.RankPointChangeBands.find(b => placement >= b.GamePositionFrom && placement <= b.GamePositionTo);
  if (!band || !Number.isSafeInteger(band.RankPointChange)) throw invalid('Missing scoring configuration.', 503);
  const current = Math.max(0, previous + band.RankPointChange), after = tierAt(current);
  const rewards = season.GameRewardBands?.find(b => placement >= b.GamePositionFrom && placement <= b.GamePositionTo)?.Rewards;
  if (!rewards) throw invalid('Missing reward configuration.', 503);
  let xp = 0, passTokens = 0;
  for (const r of rewards) {
    if (!Number.isSafeInteger(r.min) || r.min < 0 || r.min !== r.max || !['XP','PASSTOKENS'].includes(r.type)) throw invalid('Unsupported reward configuration.', 503);
    if (r.type === 'XP') xp += r.min; else passTokens += r.min;
  }
  const experience = Number(user.userProfile?.experience ?? user.experience ?? 0) + xp;
  const tokens = Number(user.battlePass?.passTokens ?? user.passTokens ?? 0) + passTokens;
  if (![experience,tokens,current].every(n => Number.isSafeInteger(n) && n >= 0)) throw invalid('Invalid reward balance.', 409);
  return { set: {
    'userProfile.ranked.currentSeasonId': season.Id,
    'userProfile.ranked.currentRankPoints': current,
    'userProfile.ranked.currentRankId': after.rank.RankId,
    'userProfile.ranked.currentTierIndex': after.index,
    'userProfile.experience': experience, experience,
    'battlePass.passTokens': tokens, passTokens: tokens
  }, response: {
    PreviousRankPoints: previous, CurrentRankPoints: current, StandardRankPointsEarned: current-previous,
    SeasonBoostRankPointsEarned: 0, FriendBoostRankPointsEarned: 0,
    PreviousRankId: before.rank.RankId, CurrentRankId: after.rank.RankId,
    PreviousTierIndex: before.index, CurrentTierIndex: after.index,
    PreviousLeaderboardPosition: ranked.currentLeaderboardPosition ?? 0,
    CurrentLeaderboardPosition: ranked.currentLeaderboardPosition ?? 0,
    HasRankCeremonyPending: after.rank.RankId > (ranked.lastSeenRankId || 1), HasTierRewardsPending: false,
    ExperienceEarned: xp, PassTokensEarned: passTokens
  }};
}
async function finishRankedGame({client, users, receipts, shared}, stumbleId, finish) {
  if (typeof finish.GameId !== 'string' || !finish.GameId.trim() || finish.GameId.length > 256) throw invalid('Invalid game ID.');
  const receiptId = crypto.createHash('sha256').update(JSON.stringify([stumbleId,finish.GameId])).digest('hex');
  const session = client.startSession();
  let response;
  try {
    await session.withTransaction(async () => {
      const cached = await receipts.findOne({_id:receiptId}, {session});
      if (cached) { response = cached.response; return; }
      const user = await users.findOne({stumbleId}, {session});
      if (!user) throw invalid('User not found.',404);
      const result = score(user,finish,shared);
      await users.updateOne({_id:user._id}, {$set:result.set}, {session});
      await receipts.insertOne({_id:receiptId,response:result.response,createdAt:new Date()}, {session});
      response = result.response;
    }, {readConcern:{level:'snapshot'},writeConcern:{w:'majority'},timeoutMS:15000,maxCommitTimeMS:10000});
    return response;
  } catch (error) {
    if (error.code === 11000) {
      const cached = await receipts.findOne({_id:receiptId}, {timeoutMS:5000});
      if (cached) return cached.response;
    }
    throw error;
  } finally { await session.endSession(); }
}
module.exports = {score, finishRankedGame};
