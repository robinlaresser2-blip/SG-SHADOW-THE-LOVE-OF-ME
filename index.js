require("dotenv").config();
require('./ValidateSecurityConfig')();
const express = require("express");
const Console = require("./ConsoleUtils");
const CryptoUtils = require("./CryptoUtils");
const SharedUtils = require("./SharedUtils");

const {
  BackendUtils,
  UserModel,
  UserController,
  RoundController,
  BattlePassController,
  EconomyController,
  AnalyticsController,
  FriendsController,
  NewsController,
  MissionsController,
  TournamentXController,
  MatchmakingController,
  TournamentController,
  SocialController,
  EventsController,
  CreatorCodeController,
  authenticate,
  errorControll,
  sendShared,
  OnlineCheck,
  VerifyPhoton
} = require("./BackendUtils");

const app = express();
// Render terminates public traffic at its reverse proxy. Trust the nearest
// hop there, while keeping direct local deployments untrusted by default.
app.set('trust proxy', process.env.RENDER === 'true' ? 1 : false);
const Title = "Stumble Core Backend " + process.env.version;
const PORT = process.env.PORT || 5000;

// 0.75 serializes owned abilities as a dictionary keyed by ability ID.  The
// DTO value itself only carries progression fields, so returning an array
// makes the client silently fall back to its default level-3 state.
function toActionEmoteMap(actionEmotes) {
  return Object.fromEntries((actionEmotes || [])
    .filter((emote) => emote && emote.Id)
    .map((emote) => {
      const { Id, ...dto } = emote;
      const variables = Object.fromEntries((emote.Variables || [])
        .filter((variable) => variable && variable.Id)
        .map((variable) => {
          const { Id: variableId, ...variableDto } = variable;
          return [variableId, variableDto];
        }));
      return [Id, { ...dto, Variables: variables }];
    }));
}

app.use(require('./RequestDiagnostics')());
console.log('[RequestDiagnostics v1] enabled');
console.log('[RankedDiagnostics v4] configured ranked scoring enabled');
app.get('/health/diagnostics', (_req, res) => res.json({
  requestDiagnostics: 'v1', rankedDiagnostics: 'v4', rankedScoring: true,
  rankedCeremony: true,
  profileCountry: true,
  journeyClaims: 'v2',
  modSecurity: 'preview-1'
}));
app.use(express.json({ verify: (req, _res, bytes) => { req.securityRawBody = Buffer.from(bytes); } }));
app.use('/user/login', express.urlencoded({ extended: false }));
app.locals.discordLogin = require('./DiscordLogin')({ collection: () => UserModel.discordLogins(), findUserByDevice: id => UserModel.findByDeviceId(id) });
app.use('/auth/discord', app.locals.discordLogin.router);
const reportDiscordLogin = require('./DiscordLoginWebhook')();
app.use('/user/login', (req, res, next) => {
  const started = process.hrtime.bigint();
  if (req.headers['x-ultimate-discord']) res.once('finish', () => reportDiscordLogin(res.statusCode >= 200 && res.statusCode < 300 ? 'game_success' : 'game_failure', { httpStatus: res.statusCode, durationMs: Number(process.hrtime.bigint() - started) / 1e6 }));
  next();
});


app.get("/bots", (_req, res) => res.json([]));
// The 0.75 client refreshes feature availability independently of login.
// RankedPlay reads this endpoint before it enables the native Ranked tile.
app.get("/feature-flags", (_req, res) => res.json([
  "Ranked",
  "RankedPlayWithFriends",
  "TournamentsX",
  "TournamentsXMeta"
]));
// These endpoints deserialize into response DTOs in the 0.75 client, not raw
// arrays. Keep their empty state as an object with the expected collection.
app.get("/action-emotes/", authenticate, async (req, res) => {
  try {
    const user = await UserModel.grantConfiguredCatalogItems(req.user);
    const storedUser = await UserModel.findByStumbleId(user.stumbleId);
    const ownedEmotes = storedUser.actionEmotes || [];
    const updatedUser = await getActionEmoteUserResponse(user.stumbleId);
    return res.json({
      // Different 0.75 UI flows read different aliases. Keep each one in
      // sync with the current database record, rather than a cached profile.
      OwnedEmotes: ownedEmotes,
      PhotonJwt: storedUser.photonJwt || '',
      UpdatedUser: updatedUser
    });
  } catch (err) {
    Console.error('ActionEmotes', 'Unable to get owned abilities:', err);
    return res.status(500).json({ message: 'Unable to load abilities.' });
  }
});
app.get("/collection-events/me", (_req, res) => res.json({ collectionEvents: [] }));
// The 0.75 client deserializes this endpoint as a list, even when no custom
// cosmetic sources are configured.
app.get("/cosmetic-sources-config", (_req, res) => res.json([]));
app.get("/discoverability/interactions", (_req, res) => res.json({ ThumbnailIds: [] }));
app.get("/game-events/me", require('./PlayerEventData').getPlayerEventData);
app.get("/playcount", (_req, res) => res.json({}));
app.get("/rewarded-videos", (_req, res) => res.json({ rewardedVideos: [] }));
app.get("/user/steampricesv2", (_req, res) => res.json([]));
app.get("/usersettings", UserController.getSettings);

app.use(authenticate);
app.use(require('./AccountRateLimit')());
app.post('/matchmaking/create-lobby', require('./CreateLobby'));
// Account-specific routes must remain after authentication and rate limiting.
app.get('/user/creator-codes', CreatorCodeController.getCreator);
app.post('/user/creator-codes', CreatorCodeController.support);
app.delete('/user/creator-codes/:code?', CreatorCodeController.stopSupport);
app.get('/economy/offers/purchasedV2', (req, res) => {
  // Legacy accounts have no recorded offer history. Do not infer purchases
  // from cosmetic ownership (the private catalog grants cosmetics for free).
  res.json(req.user.offerPurchasedInfo || {});
});
app.get('/tournamentx/seasons', TournamentXController.getSeasons);
app.get('/tournamentx/season/:seasonId/progress', TournamentXController.getSeasonProgress);
app.post('/tournamentx/season/:seasonId/claim/:awardId', TournamentXController.claimSeasonReward);

const rankedLeaderboard = require('./RankedLeaderboard')(UserModel, () => require('./SharedCatalog').read());
app.get(['/leaderboards', '/leaderboards/me'], rankedLeaderboard);
app.post(['/leaderboards', '/leaderboards/me'], rankedLeaderboard);
app.post('/mod/session', (req, res) => {
  if (!req.user || typeof req.modBuildId !== 'string') return res.status(401).json({ code: 'unauthorized' });
  if (!process.env.MOD_SESSION_SIGNING_KEY) return res.status(503).json({ code: 'mod_sessions_not_configured' });
  res.set('Cache-Control', 'no-store');
  return res.json({ token: require('./ModSession').issue(req.user, req.modBuildId), expiresIn: 300 });
});
app.get('/user-equipped-cosmetics/:userId/action_emotes', require('./EquippedAbilities')(UserModel));

// Keep the existing authentication middleware on this client content route.
app.get('/custom-maps/bundles/client', require('./ClientMapBundles').getClientMapBundles);

app.post('/user/inventory/selection', (req, res) => {
  // The 0.75 client posts this while changing inventory tabs. It only needs
  // a valid refreshed-user response; cosmetic selection is saved separately.
  return res.json({ User: req.user, UpdatedUser: req.user });
});

async function getActionEmoteUserResponse(stumbleId) {
  const storedUser = await UserModel.findByStumbleId(stumbleId, { timeoutMS: 10000 });
  if (!storedUser) throw new Error('User not found');
  const user = {
    ...storedUser,
    // The 0.75 `User` DTO uses PascalCase.  The database uses camelCase, but
    // the immediate UpdatedUser refresh is applied directly by the client and
    // must contain this exact ownership field or it temporarily clears the
    // ability collection until the next full `/action-emotes/` load.
    ActionEmotes: storedUser.actionEmotes || [],
    // Keep the storage alias too; other existing backend handlers use it.
    actionEmotes: storedUser.actionEmotes || [],
    Friends: storedUser.friends || [],
    Skins: storedUser.skins || [],
    SkinVariants: storedUser.skinVariants || [],
    Emotes: storedUser.emotes || [],
    Animations: storedUser.animations || [],
    Footsteps: storedUser.footsteps || []
  };
  // The action-emote controller passes UpdatedUser into
  // Backend.UpdateBackendUser(), so it must be a full BackendUserResponse
  // envelope. Its User object contains the ActionEmotes collection above.
  const equipped = user.equippedCosmetics || {};
  return {
    User: user,
    TermsOfServiceAccepted: true,
    PhotonJwt: user.photonJwt || '',
    ScopelyId: user.scopelyId || '',
    FeatureFlags: require('./LoginFeatureFlags'),
    EquippedCosmetics: {
      Skin: equipped.Skin ?? equipped.skin ?? null,
      Color: equipped.Color ?? equipped.color ?? null,
      Animation: equipped.Animation ?? equipped.animation ?? null,
      Footsteps: equipped.Footsteps ?? equipped.footsteps ?? null,
      Emote1: equipped.Emote1 ?? equipped.emote1 ?? null,
      Emote2: equipped.Emote2 ?? equipped.emote2 ?? null,
      Emote3: equipped.Emote3 ?? equipped.emote3 ?? null,
      Emote4: equipped.Emote4 ?? equipped.emote4 ?? null,
      ActionEmote1: equipped.ActionEmote1 ?? equipped.actionEmote1 ?? null,
      ActionEmote2: equipped.ActionEmote2 ?? equipped.actionEmote2 ?? null,
      ActionEmote3: equipped.ActionEmote3 ?? equipped.actionEmote3 ?? null,
      ActionEmote4: equipped.ActionEmote4 ?? equipped.actionEmote4 ?? null
    }
  };
}

app.post('/action-emotes/level-up/:abilityId', async (req, res) => {
  console.log('[AbilityLevelUp v2] handler-start');
  try {
    const requestedTier = req.query.tier || req.body?.tier || req.body?.Tier || req.query.levelsToUpgrade || req.body?.levelsToUpgrade;
    const actionEmote = await UserModel.levelUpActionEmote(
      req.user.stumbleId,
      req.params.abilityId,
      requestedTier
    );
    console.log('[AbilityLevelUp v2] response-user-start');
    const updatedUser = await getActionEmoteUserResponse(req.user.stumbleId);
    console.log('[AbilityLevelUp v2] response-user-ready');
    return res.json({
      PendingAbilityUpgrades: actionEmote.PendingAbilityUpgrades || 0,
      UpgradedEmote: actionEmote,
      UpdatedUser: updatedUser
    });
  } catch (err) {
    Console.error('ActionEmotes', 'Unable to level up ability:', err);
    return res.status(400).json({ message: err.message });
  }
});

app.post('/action-emotes/upgrade/:abilityId', async (req, res) => {
  try {
    const requestedTier = req.query.tier || req.body?.tier || req.body?.Tier || req.query.levelsToUpgrade || req.body?.levelsToUpgrade;
    const variableId = req.body?.VariableId || req.body?.variableId || req.query.variableId;
    const actionEmote = variableId
      ? await UserModel.upgradeActionEmoteVariable(req.user.stumbleId, req.params.abilityId, variableId, requestedTier)
      : await UserModel.levelUpActionEmote(req.user.stumbleId, req.params.abilityId, requestedTier);
    const updatedUser = await getActionEmoteUserResponse(req.user.stumbleId);
    return res.json({
      UpgradedEmote: actionEmote,
      PhotonJwt: updatedUser.PhotonJwt,
      UpdatedUser: updatedUser
    });
  } catch (err) {
    Console.error('ActionEmotes', 'Unable to upgrade ability:', err);
    return res.status(400).json({ message: err.message });
  }
});

app.post('/action-emotes/upgrade/:abilityId/:variableId', async (req, res) => {
  try {
    const requestedTier = req.query.tier || req.body?.tier || req.body?.Tier;
    const actionEmote = await UserModel.upgradeActionEmoteVariable(
      req.user.stumbleId,
      req.params.abilityId,
      req.params.variableId,
      requestedTier
    );
    const updatedUser = await getActionEmoteUserResponse(req.user.stumbleId);
    return res.json({
      UpgradedEmote: actionEmote,
      PhotonJwt: updatedUser.PhotonJwt,
      UpdatedUser: updatedUser
    });
  } catch (err) {
    Console.error('ActionEmotes', 'Unable to upgrade ability stat:', err);
    return res.status(400).json({ message: err.message });
  }
});

app.post('/action-emotes/equip-skin/:abilityId/:skinId?', async (req, res) => {
  try {
    const skinId = req.params.skinId || req.body?.SkinId || req.body?.skinId || req.body?.EquippedSkin || req.query.skinId || null;
    await UserModel.equipActionEmoteSkin(
      req.user.stumbleId,
      req.params.abilityId,
      skinId
    );
    const updatedUser = await getActionEmoteUserResponse(req.user.stumbleId);
    return res.json({
      OwnedEmotes: (await UserModel.findByStumbleId(req.user.stumbleId)).actionEmotes || [],
      PhotonJwt: updatedUser.PhotonJwt,
      UpdatedUser: updatedUser
    });
  } catch (err) {
    Console.error('ActionEmotes', 'Unable to equip ability skin:', err);
    return res.status(400).json({ message: err.message });
  }
});

app.post("/photon/auth", VerifyPhoton);
app.get("/onlinecheck", OnlineCheck);

app.get("/matchmaking/filter", MatchmakingController.getMatchmakingFilter);
// 0.79.2 requests the latest signature route; keep the legacy route compatible.
app.post(["/matchmaking/create", "/matchmaking/create/signature/latest"], MatchmakingController.createRankedTicket);
app.post('/request', MatchmakingController.submitRankedRequest);
app.put('/request/:requestId', MatchmakingController.getRankedRequestStatus);
app.get('/request/:requestId', MatchmakingController.getRankedRequestStatus);
app.delete('/request/:requestId', MatchmakingController.cancelRankedRequest);

app.post('/user/login', UserController.login);
app.get('/user/config', sendShared);
app.post('/user/config', sendShared);
app.get('/usersettings', UserController.getSettings);
app.post('/user/updateusername', UserController.updateUsername);
app.get('/user/deleteaccount', UserController.deleteAccount);
app.post('/user/linkplatform', UserController.linkPlatform);
app.post('/user/unlinkplatform', UserController.unlinkPlatform);
app.get("/shared/:version/:type", sendShared);
app.post('/user/profile', UserController.getProfile);
// The client may omit the claim suffix; eligibility is calculated from saved XP.
app.post('/xp-road/rewards/claim/:claimId?', async (req, res) => {
  if (!req.user?.stumbleId) return res.status(401).json({message:'Authentication required.'});
  try {
    const result=await UserModel.claimJourney(req.user.stumbleId);
    const updated=await getActionEmoteUserResponse(req.user.stumbleId);
    updated.User.Rewards=result.rewards;
    console.log('[JourneyClaim v2] completed level='+result.level+' rewards='+result.rewards.length);
    return res.json({UpdatedUser:updated});
  } catch(error) {
    console.error('[JourneyClaim v2] failed',error.status || 503);
    return res.status(error.status || 503).json({message:error.status ? error.message : 'Unable to save Journey rewards. Please retry.'});
  }
});
app.post('/user/profile/country', require('./ProfileCountry')(UserModel));
app.post('/user-equipped-cosmetics/update', UserController.updateCosmetics);
app.put('/user-equipped-cosmetics/update', UserController.updateCosmetics);
// 0.79.2 uses a ranked-specific finish DTO, not the regular round rewards DTO.
app.post('/ranked/game/finish', async (req, res) => {
  if (!req.user?.stumbleId) return res.status(401).json({ message: 'Authentication required.' });
  // Log result shape without exposing authentication or signed payload contents.
  const finish = req.body || {};
  const placements = finish.ClientViewPlacements;
  console.log('[RankedFinish v2]', JSON.stringify({
    hasGameId: typeof finish.GameId === 'string' && finish.GameId.length > 0,
    round: Number.isInteger(finish.Round) ? finish.Round : null,
    placement: Number.isInteger(placements?.[String(req.user.id)])
      ? placements[String(req.user.id)] : null,
    placementCount: placements && typeof placements === 'object' ? Object.keys(placements).length : 0,
    hasSignedPayload: typeof finish.SignedPayload === 'string' && finish.SignedPayload.length > 0,
    scoringImplemented: true
  }));
  try {
    const result = await UserModel.finishRankedGame(req.user.stumbleId, finish);
    const updatedUser = await getActionEmoteUserResponse(req.user.stumbleId);
    console.log('[RankedFinish v4] committed', JSON.stringify({
      rp: result.StandardRankPointsEarned, xp: result.ExperienceEarned,
      passTokens: result.PassTokensEarned
    }));
    return res.json({ ...result, UpdatedUser: updatedUser });
  } catch (err) {
    Console.error('Ranked', 'Unable to load finish result:', err);
    return res.status(err.status || 503).json({ message: err.status ? err.message : 'Unable to save ranked result. Please retry.' });
  }
});
app.post('/ranked/ceremony', async (req, res) => {
  if (!req.user?.stumbleId) return res.status(401).json({ message: 'Authentication required.' });
  try {
    const result = await UserModel.acknowledgeRankedCeremony(req.user.stumbleId);
    return res.json({ ...result, UpdatedUser: await getActionEmoteUserResponse(req.user.stumbleId) });
  } catch (error) {
    return res.status(error.status || 503).json({ message: error.status ? error.message : 'Unable to acknowledge rank. Please retry.' });
  }
});
app.get('/ranked/me', (req, res) => {
  const ranked = req.user?.userProfile?.ranked || {};
  res.json({
    CurrentSeasonId: ranked.currentSeasonId || 'LIVE_RANKED_SEASON_12',
    CurrentRankPoints: ranked.currentRankPoints || 0,
    CurrentRankId: ranked.currentRankId || 1,
    CurrentTierIndex: ranked.currentTierIndex || 0,
    CurrentLeaderboardPosition: ranked.currentLeaderboardPosition || 0,
    HighestRankIdClaimed: ranked.highestRankIdClaimed || 0,
    HighestTierIndexClaimed: ranked.highestTierIndexClaimed || 0,
    BoostUntilRankId: ranked.boostUntilRankId || 0,
    PreviousSeasonId: null,
    PreviousSeasonRankId: 0,
    PreviousSeasonTierIndex: 0,
    HasSeasonChangeoverCeremonyPending: false,
    HasRankCeremonyPending: (ranked.currentRankId || 1) > (ranked.lastSeenRankId || 1),
    HasTierRewardsPending: false
  });
});
app.get('/ranked/profile/:userId', async (req, res) => {
  const profileUser = await UserModel.findById(req.params.userId);
  if (!profileUser) return res.status(404).json({ message: 'User not found' });

  const ranked = profileUser.userProfile?.ranked || {};
  res.json({
    BestSeasonRankId: ranked.currentRankId || 1,
    BestSeasonTierIndex: ranked.currentTierIndex || 0,
    BestSeasonLeaderboardPosition: ranked.currentLeaderboardPosition || null,
    PreviousSeasonsRankTotals: {}
  });
});
app.post('/user/cosmetics/addskin', UserController.addSkin);
app.post('/user/cosmetics/setequipped', UserController.setEquippedCosmetic);
app.post('/friends/request/accept', FriendsController.accept);
app.delete('/friends/:UserId', FriendsController.remove);
app.get('/friends', FriendsController.list);
app.post('/friends/search', FriendsController.search);
app.post('/friends/request', FriendsController.request);
app.post('/friends/accept', FriendsController.accept);
app.post('/friends/request/decline', FriendsController.reject);
app.post('/friends/cancel', FriendsController.cancel);
app.get('/friends/request', FriendsController.pending);
app.get('/social/interactions', SocialController.getInteractions);
app.get('//social/interactions', SocialController.getInteractions);
app.get('/round/finish/:round', RoundController.finishRound);
app.get('/round/finishv2/:round', RoundController.finishRound);
app.post('/round/finish/v4/:round', RoundController.finishRoundV4);
app.post('/round/eventfinish/v4/:round', RoundController.finishRoundV4);

app.get('/battlepass', BattlePassController.getBattlePass);
app.post('/battlepass/claimv3', BattlePassController.claimReward);
app.post('/battlepass/purchase', BattlePassController.purchaseBattlePass);
app.post('/battlepass/complete', BattlePassController.completeBattlePass);

app.get('/economy/purchase/:item', EconomyController.purchase); 
app.post('/economy/purchaseV2', require('./PurchaseV2')(EconomyController.purchase));
app.get('/economy/purchasegasha/:itemId/:count', EconomyController.purchaseGasha); 
app.get('/economy/purchaseluckyspin', EconomyController.purchaseLuckySpin); 
app.get('/economy/purchasedrop/:itemId/:count', EconomyController.purchaseDrop);
app.post('/economy/:currencyType/give/:amount', EconomyController.giveCurrency); 

app.get('/missions', MissionsController.getMissions);
app.post('/missions/:missionId/rewards/claim/v2', MissionsController.claimMissionReward);
app.post('/missions/objective/:objectiveId/:milestoneId/rewards/claim/v2', MissionsController.claimMilestoneReward);

app.post('/friends/request/accept', FriendsController.accept);
app.delete('/friends/:UserId', FriendsController.remove);
app.get('/friends', FriendsController.list);
app.post('/friends/search', FriendsController.search);
app.post('/friends/request', FriendsController.request);
app.post('/friends/accept', FriendsController.accept);
app.post('/friends/request/decline', FriendsController.reject);
app.post('/friends/cancel', FriendsController.cancel);
app.get('/friends/request', FriendsController.pending);

app.get("/game-events/me", require('./PlayerEventData').getPlayerEventData);

app.get("/news/getall", NewsController.GetNews);

app.post('/analytics', AnalyticsController.analytic);

app.get('/highscore/:type/list/', async (req, res, next) => {
  try {
    const { type } = req.params;
    const { start = 0, count = 100, country = 'global' } = req.query;

    const startNum = parseInt(start, 10);
    const countNum = parseInt(count, 10);

    if (!type) {
      return res.status(400).json({ error: "O tipo Ã© necessÃ¡rio" });
    }

    if (isNaN(startNum) || isNaN(countNum)) {
      return res.status(400).json({ error: "Os parÃ¢metros start e count devem ser nÃºmeros" });
    }

    const result = await UserModel.GetHighscore(type, country, startNum, countNum);

    res.json(result);
  } catch (err) {
    next(err);
  }
});

app.get("/social/interactions", SocialController.getInteractions);

app.get("/tournamentx/active", TournamentXController.getActive);
app.get("/tournamentx/active/v2", TournamentXController.getActive);
app.post("/tournamentx/:tournamentId/join", TournamentXController.join);
app.post("/tournamentx/:tournamentId/join/v2", TournamentXController.join);
app.post("/tournamentx/:tournamentId/leave", TournamentXController.leave);
app.post("/tournamentx/:tournamentId/leave/v2", TournamentXController.leave);
app.post("/round/tournament/finish/v2", TournamentXController.finish);

app.get("/api/v1/ping", async (req, res) => {
  res.status(200).send("OK");
});
app.post("/api/v1/userLoginExternal", TournamentController.login);
app.get("/api/v1/tournaments", TournamentController.getActive);

app.get('/round/finish/:round', RoundController.finishRound);

module.exports = app;
app.get('/round/finishv2/:round', RoundController.finishRound);
app.post('/round/finish/v4/:round?', RoundController.finishRoundV4);
app.post('/round/eventfinish/v4/:round?', RoundController.finishRoundV4);

// Handle the v3 route pattern that the client is calling
app.post('/round/finish/v3/:country/:gameId/:userId', (req, res) => {
  // Extract round from request body and add it to params for compatibility
  req.params.round = req.body.Round;
  RoundController.finishRoundV4(req, res);
});

app.get('/economy/luckyspin', (req, res) =>
  EconomyController.getLuckySpin(req, res)
);

// Handle custom round finish for custom parties
app.post('/round/customroundfinish/:country/:gameId/:userId', RoundController.finishCustomRound);
app.post('//round/customroundfinish/:country/:gameId/:userId', RoundController.finishCustomRound);

app.use(errorControll);
