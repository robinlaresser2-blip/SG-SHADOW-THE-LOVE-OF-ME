'use strict';
module.exports = function rankedLeaderboard(UserModel, getSharedData) {
  return async (req, res) => {
    if (!req.user) return res.status(401).json({ message: 'Authentication required.' });
    const type = req.query.IncludeType;
    if (type !== undefined && type !== 'RANKED_SEASON' && type !== '4')
      return res.status(400).json({ message: 'Unsupported leaderboard type.' });
    try {
      const now = new Date();
      const season = getSharedData().RankedPlaySettings?.Seasons?.find(s => s.IsEnabled
        && new Date(s.StartDateTime) <= now && now < new Date(s.EndDateTime));
      if (!season) return res.status(503).json({ message: 'No active ranked season.' });
      const result = await UserModel.getRankedLeaderboard(season.Id, req.user.id);
      const mapping = {};
      const userMapping = {};
      const entry = (u, rank) => ({ UserId: u.id, Rank: rank, Score: u.userProfile.ranked.currentRankPoints });
      for (const u of result.users) {
        const p = u.userProfile || {};
        mapping[u.id] = { UserId: u.id, UserName: u.username || p.username || '', Country: u.country || p.country || '',
          Skin: u.equippedCosmetics?.skin || p.skin || 'SKIN1', Trophies: p.trophies || 0,
          Crowns: p.crowns || 0, Experience: p.experience || 0, HiddenRating: 0, IsOnline: false,
          NativePlatformName: p.nativePlatformName || 'steam', NativePlatformId: '',
          Ranked: { CurrentSeasonId: season.Id, CurrentRankId: p.ranked?.currentRankId || 1,
            CurrentTierIndex: p.ranked?.currentTierIndex || 0 }, Flags: 0 };
        userMapping[u.id] = { Username: mapping[u.id].UserName, Country: mapping[u.id].Country,
          SelectedSkin: mapping[u.id].Skin, NativePlatformName: mapping[u.id].NativePlatformName, NativePlatformId: '' };
      }
      res.set('Cache-Control', 'no-store');
      if (req.path.replace(/\/$/, '').endsWith('/me')) {
        const own = result.me ? entry(result.me, result.myRank) : null;
        return res.json({ Leaderboards: [{ Type: 'RANKED_SEASON', Id: season.Id, MyEntry: own, Entry: own }] });
      }
      return res.json({ UserMapping: userMapping, UserProfileMapping: mapping,
        Leaderboards: [{ LeaderboardInfo: { Id: season.Id, Type: 'RANKED_SEASON',
          EntryCount: result.total, LastUpdateTime: now.toISOString() },
          LeaderboardTopPercentileValues: [], LeaderboardEntries: result.users.map((u, i) => entry(u, i + 1)) }] });
    } catch (error) {
      console.warn('[RankedLeaderboard] Query failed:', error.name);
      return res.status(503).json({ message: 'Leaderboard temporarily unavailable.' });
    }
  };
};
