const express = require('express');
const { MongoClient, ObjectId } = require('mongodb');
const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const Console = require("./ConsoleUtils");
const dotenv = require('dotenv');
dotenv.config();
const CryptoUtils = require("./CryptoUtils");
const axios = require('axios');
const zlib = require('zlib');
const fs = require('fs');
const path = require('path');

function getSharedData() {
  try {
    return require('./SharedCatalog').read();
  } catch (e) {
    return SharedData;
  }
}

const PRIVATE_ABILITY_SHOP_ITEMS = [
  {
    Name: 'ultimate_free_ability_keys',
    prices: [{ currency: 'gems', amount: 0 }],
    analyticsPrices: [],
    rewards: [{ min: 300, max: 300, type: 'CURRENCY', typeInfo: 'aes' }],
    Source: 'Offer'
  },
  {
    Name: 'ultimate_free_ability_tokens',
    prices: [{ currency: 'gems', amount: 0 }],
    analyticsPrices: [],
    rewards: [{ min: 60000, max: 60000, type: 'CURRENCY', typeInfo: 'aec' }],
    Source: 'Offer'
  }
];

// Compatibility list supplied for this 0.75 client. Newer action-emote IDs
// outside this list are not exposed because they do not have matching data.
const SUPPORTED_ACTION_EMOTE_IDS = new Set([
  'AE001_Hug',
  'AE002_Punch',
  'AE003_Slide',
  'AE004_Banana',
  'AE005_Briefcase',
  'AE006_DiceRoll',
  'AE007_Bolt',
  'AE008_Snowball',
  'AE009_Spit',
  'AE011_Chop',
  'AE012_Slap',
  'AE013_Shield',
  'AE014_Invisibility',
  'AE016_BouncingBall',
  'AE017_PowerJump',
  'AE018_Rake',
  'AE019_StickyBomb',
  'AE020_SpeedGel',
]);

function isSupportedActionEmote(ability) {
  return ability && SUPPORTED_ACTION_EMOTE_IDS.has(ability.Id);
}

const PRIVATE_ABILITY_SHOP_OFFERS = [
  {
    StartDateTime: '2020-01-01T00:00:00Z',
    EndDateTime: '2099-12-31T23:59:59Z',
    Popup: false,
    PurchasableItem: 'ultimate_free_ability_tokens',
    Version: '0.75',
    BackgroundColor: '#A75CFF',
    Description: '60,000 Ability Tokens',
    Header: 'FREE ABILITY TOKENS',
    IsOneTimeOffer: false,
    ShowDiscount: false,
    MaxBuyCount: 0,
    IterationMaxBuyCount: 0,
    IsSequentialOffer: false,
    Category: 'OFFERS',
    Priority: 1,
    Platforms: ['ios', 'android', 'web', 'steam']
  }
];

function getSharedDataWithPrivateAbilityOffers() {
  const shared = getSharedData();
  const existingItemNames = new Set((shared.PurchasableItems || []).map((item) => item.Name));
  const existingOfferItems = new Set((shared.ShopDef?.Offers_v2 || []).map((offer) => offer.PurchasableItem));

  return {
    ...shared,
    PurchasableItems: [
      ...(shared.PurchasableItems || []),
      ...PRIVATE_ABILITY_SHOP_ITEMS.filter((item) => !existingItemNames.has(item.Name))
    ],
    ShopDef: {
      ...(shared.ShopDef || {}),
      Offers_v2: [
        ...(shared.ShopDef?.Offers_v2 || []),
        ...PRIVATE_ABILITY_SHOP_OFFERS.filter((offer) => !existingOfferItems.has(offer.PurchasableItem))
      ]
    },
    ActionEmotes: {
      ...(shared.ActionEmotes || {}),
      ActionEmotes: (shared.ActionEmotes?.ActionEmotes || [])
        .filter(isSupportedActionEmote)
        .map((ability) => ({
        ...ability,
        Hidden: false,
        // The 0.75 skin UI requires a valid EmoteTier condition to build its
        // unlock buttons.  Maxed accounts satisfy these original conditions;
        // stripping them causes the client to disable skin selection.
        Skins: ability.Skins || []
      }))
    }
  };
}

const SharedUtils = require("./SharedUtils.js");
const SharedData = require("./shared.json");

class Database {
  constructor() {
    this.mongoUri = process.env.mongoUri;
    this.dbName = "StumbleGuys";
    this.client = null;
    this.db = null;
    this.collections = {
      Users: null,
      Analytics: null,
      News: null,
      Events: null,
      BattlePasses: null,
      Skins: null,
      Missions: null,
      PurchasableItems: null,
      Animations: null,
      Emotes: null,
      Footsteps: null,
      TournamentsX: null,
      Anticheat: null,
      Parties: null,
      CreatorCodes: null
    };
  }

  async connect() {
    this.client = new MongoClient(this.mongoUri);
    await this.client.connect();
    this.db = this.client.db(this.dbName);

    this.collections.Users = this.db.collection("Users");
    this.collections.DiscordLogins = this.db.collection('DiscordLogins');
    await this.collections.DiscordLogins.createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 });
    await this.collections.Users.createIndex({ discordId: 1 }, { unique: true,
      partialFilterExpression: { discordId: { $type: 'string' } } });
    if (process.env.MOD_REQUEST_PROOF_REQUIRED === '1') {
      this.collections.SecurityNonces = this.db.collection('ModSecurityNonces');
      await this.collections.SecurityNonces.createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 });
    }
    this.collections.Analytics = this.db.collection("Analytics");
    this.collections.News = this.db.collection("News");
    this.collections.Events = this.db.collection("Events");
    this.collections.BattlePasses = this.db.collection("BattlePasses");
    this.collections.Skins = this.db.collection("Skins");
    this.collections.Missions = this.db.collection("Missions");
    this.collections.PurchasableItems = this.db.collection("PurchasableItems");
    this.collections.Animations = this.db.collection("Animations");
    this.collections.Emotes = this.db.collection("Emotes");
    this.collections.Footsteps = this.db.collection("Footsteps");
    this.collections.TournamentsX = this.db.collection("TournamentsX");
    this.collections.Anticheat = this.db.collection("Anticheat");
    this.collections.Parties = this.db.collection("Parties");
    this.collections.CreatorCodes = this.db.collection("CreatorCodes");
    
    await this.checkOnlineUsers()
    await this.createIndexes();
    await this.autoPopulateSharedData();


    

    Console.log("Database", "Connected to database");
  }

  async createIndexes() {
    await this.collections.Users.createIndexes([
      { key: { deviceId: 1 }, unique: true, sparse: true },
      { key: { stumbleId: 1 }, unique: true, sparse: true },
      { key: { username: 1 }, unique: true, sparse: true },
      { key: { friends: 1 } },
      { key: { sentFriendRequests: 1 } },
      { key: { receivedFriendRequests: 1 } },
      { key: { "balances.name": 1 } }
    ]);

    await this.collections.Events.createIndex({ StartDateTime: 1, EndDateTime: 1 });
    await this.collections.BattlePasses.createIndex({ PassID: 1 });
    await this.collections.Skins.createIndex({ SkinID: 1 });
  }

  async autoPopulateSharedData() {
    try {
      if (SharedData.Skins_v4?.length > 0) {
        await this.collections.Skins.deleteMany({});
        for (const skin of SharedData.Skins_v4) {
          await this.collections.Skins.insertOne({ ...skin });
        }
      }

      if (SharedData.Animations_v2?.length > 0) {
        await this.collections.Animations.deleteMany({});
        for (const anim of SharedData.Animations_v2) {
          await this.collections.Animations.insertOne({ ...anim });
        }
      }

      if (SharedData.Emotes_v2?.length > 0) {
        await this.collections.Emotes.deleteMany({});
        for (const emote of SharedData.Emotes_v2) {
          await this.collections.Emotes.insertOne({ ...emote });
        }
      }

      if (SharedData.Footsteps?.length > 0) {
        await this.collections.Footsteps.deleteMany({});
        for (const footstep of SharedData.Footsteps_v2) {
          await this.collections.Footsteps.insertOne({ ...footstep });
        }
      }
    } catch (error) {
      Console.error("Populate", "Erro ao popular coleções:", error);
    }
  }

  async autoPopulateTournaments() {
    try {
      const exists = await this.collections.TournamentsX.findOne({ id: 400 });
      if (!exists) {
        await this.collections.TournamentsX.insertOne({
          id: 1,
          type: 1,
          isEnabled: true,
          minVersion: "0.56",
          startTime: new Date("2025-07-24T10:00:00Z"),
          endTime: new Date("2025-08-07T10:00:00Z"),
          nameKey: "Ranked 1x1",
          descriptionKey: "RANKED_TOURNAMENT_DESC",
          listItemBackgroundImage: "Ranked_Background_Image_Tournaments_Card",
          detailsPanelBackgroundImage: "Ranked_Background_Image_Tournaments",
          prizeBannerColour: "#00FFCC",
          headerColour: "#00FFCC",
          mapListGradientColourTop: "#00FFCC",
          mapListGradientColourBottom: "#006666",
          listPriority: 0,
          minPlayers: 2,
          maxPlayers: 2,
          maxRounds: 1,
          minMatchmakingSeconds: 0,
          entryCurrencyType: "gems",
          entryCurrencyCost: 30,
          entryCurrencyType2: "tournament_ticket_rare",
          entryCurrencyCost2: 0,
          areEmotesRestricted: false,
          prohibitedEmotes: [],
          detailsPanelBorderColourTop: "#00FFCC",
          detailsPanelBorderColourBottom: "#006666",
          colourData: {
            detailsPanelMainColour: "#00CC99",
            detailsPanelBorderColour: "#00FFCC",
            headerGradientRight: "#00CC99",
            headerGradientLeft: "#00FFCC",
            infoWidgetsGradientRight: "#00CC99",
            infoWidgetsGradientLeft: "#009977",
            infoWidgetsBorderColour: "#00FFCC"
          },
          rounds: [
            {
              roundOrder: 1,
              maxPlayersToProgress: 1,
              minPlayersPerMatch: 2,
              maxPlayersPerMatch: 2,
              areLevelsRestricted: true,
              permittedLevels: ["level19_block"]
            }
          ],
          awards: [
            { placementRangeLowest: 1, placementRangeHighest: 1, awardId: 1, type: "XP", amount: 200 },
            { placementRangeLowest: 1, placementRangeHighest: 1, awardId: 2, type: "TROPHIES", amount: 15 },
            { placementRangeLowest: 1, placementRangeHighest: 1, awardId: 3, type: "TOURNAMENTXP", amount: 50 },
            { placementRangeLowest: 1, placementRangeHighest: 1, awardId: 4, type: "CROWNS", amount: 1 }
          ],
          players: []
        });
      }
    } catch (err) {
      Console.error("TournamentX", "Erro ao criar torneio padrão:", err);
    }
  }

  async checkOnlineUsers() {
  const minuto = 15 * 60 * 1000
  const now = new Date()

  try {
    const onlineUsers = await this.collections.Users.find({
      lastLogin: { $gte: new Date(now - minuto) }
    }).toArray()

    if (!onlineUsers.length) return

    const userCount = onlineUsers.length

    const webhookUrl = process.env.WebhookUrl
    if (!webhookUrl) return

    const embed = {
      title: "🟢 Usuários Online",
      description: `Há **${userCount}** usuarios online nos últimos 15 minutos.`,
      color: 0x00ff00,
      footer: { text: "SGPIT - Status Online" },
      timestamp: new Date().toISOString()
    }

    await axios.post(webhookUrl, {
      embeds: [embed]
    })

  } catch (err) {
    console.error("Erro ao enviar webhook de usuários online:", err)
  }
}


  async getUserByQuery(query, options = {}) {
    return await this.collections.Users.findOne(query, options);
  }

  

  async updateUser(query, updates) {
    await this.collections.Users.updateOne(query, { $set: updates });
    return await this.getUserByQuery(query);
  }

  async addToUserArray(query, arrayField, value) {
    return await this.collections.Users.updateOne(query, { $addToSet: { [arrayField]: value } });
  }

  async incrementUserBalance(query, currency, amount) {
    const user = await this.getUserByQuery(query);
    if (!user) {
        throw new Error("User not found");
    }

    const currentBalance = user.balances.find(b => b.name === currency);
    const currentAmount = currentBalance ? currentBalance.amount : 0;
    
    const newAmount = currentAmount + amount;
    const finalAmount = Math.max(0, newAmount);

    if (currentBalance) {
        const result = await this.collections.Users.updateOne(
            { ...query, "balances.name": currency },
            { $set: { "balances.$.amount": finalAmount } }
        );

        return result;
    } else if (amount > 0) {
        await this.collections.Users.updateOne(query, {
            $push: { balances: { name: currency, amount: finalAmount } }
        });
        
        return { matchedCount: 1, modifiedCount: 1 };
    } else {
        return { matchedCount: 0, modifiedCount: 0 };
    }
}

  async createUser(userData) {
    const result = await this.collections.Users.insertOne(userData);
    return { ...userData, _id: result.insertedId };
  }

  async getActiveEvents() {
    const now = new Date();
    return await this.collections.Events.find({
      StartDateTime: { $lte: now },
      EndDateTime: { $gte: now }
    }).toArray();
  }

  async getBattlePass(passId) {
    return await this.collections.BattlePasses.findOne({ PassID: passId });
  }

  async getSkinInfo(skinId) {
    return await this.collections.Skins.findOne({ SkinID: skinId });
  }

  async getMissionInfo(missionId) {
    return await this.collections.Missions.findOne({ Id: missionId });
  }

  async getPurchasableItem(itemId) {
    return await this.collections.PurchasableItems.findOne({ Name: itemId });
  }
}


const database = new Database();
database.connect().catch(err => {
  console.error('Database connection error:', err);
  process.exit(1);
});

class UserModel {
  static discordLogins() { return database.collections.DiscordLogins; }
  static async findByDiscordId(discordId) {
    return database.collections.Users.findOne({ discordId });
  }
  static async linkDiscord(user, discordId, token) {
    if (!require('./SessionIdentity')({ Token: token, DeviceId: user.deviceId }, user)) return null;
    return database.collections.Users.findOneAndUpdate({ _id: user._id, token,
      discordId: { $exists: false } }, { $set: { discordId } }, { returnDocument: 'after' });
  }
  static async claimJourney(stumbleId) {
    return require('./JourneyClaim').claim({client:database.client,
      users:database.collections.Users, shared:getSharedData()},stumbleId);
  }
  static async acknowledgeRankedCeremony(stumbleId) {
    return require('./RankedCeremony').acknowledge(database.collections.Users, stumbleId);
  }
  static async finishRankedGame(stumbleId, finish) {
    return require('./RankedFinish').finishRankedGame({
      client: database.client, users: database.collections.Users,
      receipts: database.db.collection('RankedGameReceipts'), shared: getSharedData()
    }, stumbleId, finish);
  }
  static async create(ip, deviceId, platformData = {}) {
  const now = new Date();
  const userId = Math.floor(Math.random() * 999);
  const username = 'StumbleUltimate ' + CryptoUtils.GenCaracters(10).toUpperCase();
  
  let ipCountry = 'US';
  let ipRegion = 'NA';
  
  try {
    const response = await axios.get(`https://ipapi.co/${ip}/json/`);
    if (response.data && response.data.country_code) {
      ipCountry = response.data.country_code;
      ipRegion = response.data.continent_code || 'NA';
    }
  } catch (error) {
    console.error('Erro ao detectar localização do IP:', error);
    ipCountry = 'US';
    ipRegion = 'NA';
  }

  const user = {
    ...(platformData.discordId ? { discordId: platformData.discordId } : {}),
    id: userId,
    deviceId,
    stumbleId: CryptoUtils.GenerateId().toUpperCase(),
    username,
    country: ipCountry,
    region: ipRegion,
    token: CryptoUtils.SessionToken(),
    version: platformData.Version || "0.1",
    ip,
    creationDate: now,
    last: now,
    newsVersion: 0,
    skillRating: 0,
    experience: 0,
    crowns: 0,
    hiddenRating: 0,
    isBanned: false,
    inventory: [{
      userId,
      itemId: 803,
      itemType: "DUPLICATE_BANK",
      item: "CONFIG_VERSION",
      amount: 3
    }],
    skins: ["SKIN1", "SKIN2"],
    emotes: ["emote_cry", "emote_hi", "emote_gg", "emote_haha", "emote_happy"],
    animations: ["animation1"],
    footsteps: ["footsteps_smoke"],
    friends: [],
    sentFriendRequests: [],
    receivedFriendRequests: [],
    hasBattlePass: false,
    passTokens: 0,
    freePassRewards: [],
    premiumPassRewards: [],
    balances: [
      { name: "coins", amount: 101, secondsSince: 0, secondsPerUnit: 0, maxAmount: 0, lastGiven: now },
      { name: "remove_ads", amount: 0, secondsSince: 0, secondsPerUnit: 0, maxAmount: 2, lastGiven: now },
      { name: "video", amount: 50, secondsSince: 0, secondsPerUnit: 0, maxAmount: 5000, lastGiven: now },
      { name: "gems", amount: 20000, secondsSince: 0, secondsPerUnit: 0, maxAmount: 0, lastGiven: now },
      { name: "video_gems", amount: 10, secondsSince: 0, secondsPerUnit: 5400, maxAmount: 10, lastGiven: now },
      { name: "video_coins", amount: 8, secondsSince: 0, secondsPerUnit: 10800, maxAmount: 8, lastGiven: now },
      { name: "special_video", amount: 3, secondsSince: 0, secondsPerUnit: 28800, maxAmount: 3, lastGiven: now },
      { name: "skin_charge", amount: 0, secondsSince: 0, secondsPerUnit: 0, maxAmount: 5, lastGiven: now },
      { name: "skin_purchase", amount: 7, secondsSince: 0, secondsPerUnit: 86400, maxAmount: 7, lastGiven: now },
      { name: "gem_charge", amount: 0, secondsSince: 0, secondsPerUnit: 0, maxAmount: 3, lastGiven: now },
      { name: "gem_purchase", amount: 1, secondsSince: 0, secondsPerUnit: 86400, maxAmount: 1, lastGiven: now },
      { name: "dust", amount: 5000, secondsSince: 0, secondsPerUnit: 0, maxAmount: 0, lastGiven: now },
      { name: "default_free_spins", amount: 1, secondsSince: 0, secondsPerUnit: 0, maxAmount: 1, lastGiven: new Date(Date.now() - 86400000) },
      { name: "default_free_ad_spins", amount: 16, secondsSince: 0, secondsPerUnit: 0, maxAmount: 16, lastGiven: new Date(Date.now() - 86400000) },
      { name: "remove_interstitial_ads", amount: 0, secondsSince: 0, secondsPerUnit: 0, maxAmount: 2, lastGiven: now },
      { name: "end_of_match", amount: 0, secondsSince: 0, secondsPerUnit: 0, maxAmount: 1, lastGiven: now },
      { name: "end_of_match_event", amount: 0, secondsSince: 0, secondsPerUnit: 0, maxAmount: 1, lastGiven: now },
      { name: "tournament_ticket_rare", amount: 0, secondsSince: 0, secondsPerUnit: 0, maxAmount: 0, lastGiven: now },
      { name: "tournament_ticket_legendary", amount: 0, secondsSince: 0, secondsPerUnit: 0, maxAmount: 0, lastGiven: now },
      { name: "video_coins_02", amount: 5, secondsSince: 0, secondsPerUnit: 28800, maxAmount: 5, lastGiven: now },
      { name: "aes", amount: 0, secondsSince: 0, secondsPerUnit: 0, maxAmount: 0, lastGiven: now },
      { name: "aec", amount: 60000, secondsSince: 0, secondsPerUnit: 0, maxAmount: 0, lastGiven: now },
      { name: "ranked_friend_boost", amount: 3, secondsSince: 0, secondsPerUnit: 86400, maxAmount: 3, lastGiven: now },
      { name: "stumble_coins", amount: 0, secondsSince: 0, secondsPerUnit: 0, maxAmount: 0, lastGiven: now },
      { name: "dust_backup", amount: 0, secondsSince: 0, secondsPerUnit: 0, maxAmount: 0, lastGiven: now }
    ],
    Rewards: [],
    availableNewsVersion: 0,
    latestNewsIdBackend: 11698,
    battlePass: {
      freePassRewards: [],
      premiumPassRewards: [],
      passTokens: 0,
      hasPurchased: false,
      passID: 72,
      secondsToEnd: 904064,
      experience: 0,
      slotsClaimed: [],
      hasUsedDiscount: false,
      xpBooster: 0,
      coins: 0,
      hasUsedBonusDiscount: false,
      passDateId: 0
    },
    secondsSinceCreated: 0,
    age: 0,
    kidFriendlyMode: 0,
    termsOfServiceVersion: 0,
    xpRoad: {
      userId,
      xpRoadId: 0,
      lastClaimedLevel: 1,
      isVeteran: true,
      claimedRewardsIds: [],
      hasBeenEnabled: true,
      currentLevelCap: 70,
      isOnboarding: false,
      onboardingFeaturesUnlocked: []
    },
    userFlags: {
      hasUsedFreeNameChange: false,
      hasCoinConversionPopupShown: false,
      hasCoinConversionCompleted: false
    },
    offerSequenceState: [],
    userProfile: {
      userId,
      userName: username,
      country: ipCountry,
      trophies: 0,
      crowns: 0,
      experience: 0,
      hiddenRating: 0,
      isOnline: true,
      lastSeenDate: now.toISOString(),
      skin: "SKIN1",
      nativePlatformName: "android",
      ranked: {
        currentSeasonId: "LIVE_RANKED_SEASON_12",
        currentRankId: 1,
        currentTierIndex: 0
      },
      flags: 0
    },
    featureFlags: [
      'TournamentsX',
      'TournamentsXMeta',
      'Events',
      'FriendsList',
      'GraphicsQualitySettings'
    ],
    googleId: platformData.googleId || '',
    facebookId: platformData.facebookId || '',
    appleId: platformData.appleId || '',
    scopelyId: platformData.scopelyId || '',
    steamTicket: platformData.steamTicket || '',
    equippedCosmetics: {
      skin: 'SKIN1',
      color: 'COLOR1',
      animation: 'animation1',
      footsteps: 'footsteps_smoke',
      emote1: 'emote_cry',
      emote2: 'emote_hi',
      emote3: 'emote_gg',
      emote4: 'emote_haha',
      actionEmote1: 'AE016_BouncingBall',
      actionEmote2: null,
      actionEmote3: null,
      actionEmote4: null
    },
    tournamentSeasons: [
      {
        seasonId: 67,
        xp: 0,
        claimedAwards: []
      }
    ]
  };

  return await database.createUser(user);
}
 

  static async findByDeviceId(deviceId) {
    return await database.getUserByQuery({ deviceId });
  }

  static async findByStumbleId(stumbleId, options = {}) {
    return await database.getUserByQuery({ stumbleId }, options);
  }

  static async findById(id) {
    return await database.getUserByQuery({ id: parseInt(id) });
  }

  static async getRankedLeaderboard(seasonId, userId) {
    const users = database.collections.Users;
    const filter = { isBanned: { $ne: true }, id: { $type: 'number' },
      'userProfile.ranked.currentSeasonId': seasonId,
      'userProfile.ranked.currentRankPoints': { $gte: 0 } };
    const projection = { _id: 0, id: 1, username: 1, country: 1, 'equippedCosmetics.skin': 1,
      'userProfile.skin': 1, 'userProfile.trophies': 1, 'userProfile.crowns': 1,
      'userProfile.experience': 1, 'userProfile.nativePlatformName': 1, 'userProfile.ranked': 1 };
    const [top, total, me] = await Promise.all([
      users.find(filter, { projection }).sort({ 'userProfile.ranked.currentRankPoints': -1, id: 1 }).limit(100).maxTimeMS(5000).toArray(),
      users.countDocuments(filter, { maxTimeMS: 5000 }),
      users.findOne({ ...filter, id: Number(userId) }, { projection, maxTimeMS: 5000 })
    ]);
    let myRank = 0;
    if (me) myRank = 1 + await users.countDocuments({ ...filter, $or: [
      { 'userProfile.ranked.currentRankPoints': { $gt: me.userProfile.ranked.currentRankPoints } },
      { 'userProfile.ranked.currentRankPoints': me.userProfile.ranked.currentRankPoints, id: { $lt: me.id } }
    ] }, { maxTimeMS: 5000 });
    return { users: top, total, me, myRank };
  }

  static async update(stumbleId, updates) {
    return await database.updateUser({ stumbleId }, updates);
  }

  static async addBalance(deviceId, currency, amount) {
    return await database.incrementUserBalance({ deviceId }, currency, amount);
  }

  static async removeBalance(deviceId, currency, amount) {
    return await database.incrementUserBalance({ deviceId }, currency, -amount);
  }

  static async addSkin(stumbleId, skinId) {
    return await database.addToUserArray({ stumbleId }, 'skins', skinId);
  }

  static async addActionEmote(stumbleId, emoteId) {
    return await database.addToUserArray({ stumbleId }, 'actionEmotes', emoteId);
  }

  static buildActionEmoteDto(definition, savedAbility = {}) {
    const maxTier = Math.max(
      0,
      ...(definition.Tiers || []).map((tier) => Number(tier.Tier) || 0)
    );
    const currentTier = Math.min(Math.max(Number(savedAbility.CurrentTier) || 0, 0), maxTier);
    const scalingUpgrades = definition.ScalingUpgrades || [];
    return {
      Id: definition.Id,
      CurrentTier: currentTier,
      PendingAbilityUpgrades: savedAbility.PendingAbilityUpgrades || 0,
      MaxTierReached: maxTier > 0 && currentTier >= maxTier,
      // Ability skins unlock at higher tiers. A newly owned ability must use
      // its base visual, not the first tier-5 skin from the catalog.
      EquippedSkin: savedAbility.EquippedSkin || null,
      Variables: (definition.Variables || []).map((variable) => {
        const scalingUpgrade = scalingUpgrades.find((upgrade) => upgrade.Id === variable.Id);
        const savedVariable = (savedAbility.Variables || []).find((candidate) => candidate?.Id === variable.Id);
        const variableTier = Math.min(
          // A player chooses the stat to improve. Do not manufacture equal
          // progress on every stat from the overall emote level.
          Number(savedVariable?.CurrentTier) || 0,
          scalingUpgrade?.Tiers?.length || 0
        );
        const tierValue = scalingUpgrade?.Tiers?.find((tier) => tier.Tier === variableTier);
        return {
          Id: variable.Id,
          CurrentTier: variableTier,
          ValueFixedPoint: tierValue?.ValueAsInt ?? variable.ValueAsInt ?? Math.round((variable.Value || 0) * 100)
        };
      })
    };
  }

  // Keeps private-server test accounts in sync with the cosmetics configured
  // in shared.json.  The client receives real ownership records instead of a
  // visual-only unlock, so items can be selected and equipped normally.
  static async grantConfiguredCatalogItems(user) {
    const shared = getSharedData();
    const unique = (items) => [...new Set(items.filter(Boolean))];
    const actionEmoteDefinitions = shared.ActionEmotes?.ActionEmotes || [];
    const actionEmoteIds = actionEmoteDefinitions
      .filter(isSupportedActionEmote)
      .map((ability) => ability.Id);
    const existingAbilityIds = new Set((user.actionEmotes || []).map((ability) =>
      typeof ability === 'string' ? ability : ability?.Id
    ));
    // Do not rebuild an established account every time it logs in or opens
    // Abilities.  Rebuilding can replace in-progress tiers with stale client
    // values. It is only needed once for a fresh/legacy account missing an
    // ability from the configured catalog.
    if (actionEmoteIds.length > 0 && actionEmoteIds.every((id) => existingAbilityIds.has(id))) {
      // Validate equipped slots even when the account already owns the catalog.
      // Legacy numeric slots and deleted IDs cannot produce an ability card.
      const equippedCosmetics = { ...(user.equippedCosmetics || {}) };
      let changed = false;
      for (let slot = 1; slot <= 4; slot++) {
        const key = `actionEmote${slot}`;
        const alias = `ActionEmote${slot}`;
        const value = equippedCosmetics[alias] ?? equippedCosmetics[key] ?? null;
        const valid = typeof value === 'string' && actionEmoteIds.includes(value) && existingAbilityIds.has(value)
          ? value : null;
        if (equippedCosmetics[key] !== valid) changed = true;
        equippedCosmetics[key] = valid;
        if (Object.prototype.hasOwnProperty.call(equippedCosmetics, alias)) {
          if (equippedCosmetics[alias] !== valid) changed = true;
          equippedCosmetics[alias] = valid;
        }
      }
      return changed ? await this.update(user.stumbleId, { equippedCosmetics }) : user;
    }
    const existingActionEmotes = new Map((user.actionEmotes || []).map((ability) => {
      const id = typeof ability === 'string' ? ability : ability?.Id;
      return [id, typeof ability === 'string' ? { Id: id } : ability];
    }));
    const validEquippedAbility = (id) => typeof id === 'string' && actionEmoteIds.includes(id)
      ? id
      : null;
    const equippedCosmetics = {
      ...(user.equippedCosmetics || {}),
      // Old account records stored slot indexes (2, 3 and 4). The 0.75 client
      // treats them as cosmetic IDs, causing the ACTION_EMOTE_SKIN errors and
      // preventing the ability tab from refreshing.
      actionEmote1: validEquippedAbility(user.equippedCosmetics?.actionEmote1) || 'AE016_BouncingBall',
      actionEmote2: validEquippedAbility(user.equippedCosmetics?.actionEmote2),
      actionEmote3: validEquippedAbility(user.equippedCosmetics?.actionEmote3),
      actionEmote4: validEquippedAbility(user.equippedCosmetics?.actionEmote4)
    };

    const updates = {
      skins: unique([...(user.skins || []), ...(shared.Skins_v4 || [])
        .filter((skin) => skin && !skin.Hidden)
        .map((skin) => skin.SkinID)]),
      emotes: unique([...(user.emotes || []), ...(shared.Emotes_v2 || [])
        .filter((emote) => emote && !emote.Hidden)
        .map((emote) => emote.ID)]),
      animations: unique([...(user.animations || []), ...(shared.Animations_v2 || [])
        .filter((animation) => animation && !animation.Hidden)
        .map((animation) => animation.ID)]),
      footsteps: unique([...(user.footsteps || []), ...(shared.Footsteps_v2 || [])
        .filter((footstep) => footstep && !footstep.Hidden)
        .map((footstep) => footstep.ID)]),
      actionEmotes: actionEmoteDefinitions
        .filter((ability) => isSupportedActionEmote(ability) && actionEmoteIds.includes(ability.Id))
        .map((ability) => this.buildActionEmoteDto(
          ability,
          existingActionEmotes.get(ability.Id) || {}
        )),
      equippedCosmetics
    };

    return await this.update(user.stumbleId, updates);
  }

  static async levelUpActionEmote(stumbleId, abilityId, requestedTier = null) {
    const trace = (stage) => console.log('[AbilityLevelUp v2] ' + stage);
    trace('catalog-start');
    const shared = getSharedData();
    trace('catalog-ready');
    const definition = (shared.ActionEmotes?.ActionEmotes || [])
      .find((ability) => isSupportedActionEmote(ability) && ability.Id === abilityId);
    if (!definition) throw new Error('Unknown action emote');

    trace('read-start');
    const user = await database.collections.Users.findOne({ stumbleId }, { timeoutMS: 10000 });
    trace('read-ready');
    if (!user) throw new Error('User not found');

    const abilities = (user.actionEmotes || []).map((ability) =>
      typeof ability === 'string' ? { Id: ability } : ability
    );
    const index = abilities.findIndex((ability) => ability?.Id === abilityId);
    const savedAbility = index >= 0 ? abilities[index] : { Id: abilityId };
    const maxTier = Math.max(0, ...(definition.Tiers || []).map((tier) => Number(tier.Tier) || 0));
    const parsedRequestedTier = Number.parseInt(requestedTier, 10);
    // The 0.75 client submits the target ability tier. If it is missing or
    // stale, advance by one internal tier as a safe fallback.
    const previousTier = Math.min(Math.max(Number(savedAbility.CurrentTier) || 0, 0), maxTier);
    savedAbility.CurrentTier = Number.isInteger(parsedRequestedTier) && parsedRequestedTier > previousTier
      ? Math.min(parsedRequestedTier, maxTier)
      : Math.min(previousTier + 1, maxTier);
    // Each overall level grants one pending choice for the player to spend on
    // exactly one scaling stat through /action-emotes/upgrade.
    savedAbility.PendingAbilityUpgrades = Math.max(0, Number(savedAbility.PendingAbilityUpgrades) || 0)
      + (savedAbility.CurrentTier - previousTier);
    abilities[index >= 0 ? index : abilities.length] = this.buildActionEmoteDto(definition, savedAbility);

    trace('write-start');
    const updatedUser = await database.collections.Users.findOneAndUpdate(
      { stumbleId }, { $set: { actionEmotes: abilities } },
      { returnDocument: 'after', includeResultMetadata: false, timeoutMS: 10000 }
    );
    trace('write-ready');
    if (!updatedUser) throw new Error('User not found');
    return updatedUser.actionEmotes.find((ability) => ability?.Id === abilityId);
  }

  static async upgradeActionEmoteVariable(stumbleId, abilityId, variableId, requestedTier = null) {
    const shared = getSharedData();
    const definition = (shared.ActionEmotes?.ActionEmotes || [])
      .find((ability) => isSupportedActionEmote(ability) && ability.Id === abilityId);
    const scalingUpgrade = definition?.ScalingUpgrades?.find((upgrade) => upgrade.Id === variableId);
    if (!definition || !scalingUpgrade) throw new Error('Unknown ability upgrade');

    const user = await this.findByStumbleId(stumbleId);
    if (!user) throw new Error('User not found');

    const abilities = (user.actionEmotes || []).map((ability) =>
      typeof ability === 'string' ? { Id: ability } : ability
    );
    const index = abilities.findIndex((ability) => ability?.Id === abilityId);
    const savedAbility = index >= 0 ? abilities[index] : { Id: abilityId };
    const variables = (definition.Variables || []).map((variable) => {
      const savedVariable = (savedAbility.Variables || []).find((candidate) => candidate.Id === variable.Id);
      return {
        Id: variable.Id,
        CurrentTier: Number(savedVariable?.CurrentTier) || 0
      };
    });
    const variable = variables.find((candidate) => candidate.Id === variableId);
    const targetTier = Number.parseInt(requestedTier, 10);
    const previousVariableTier = variable.CurrentTier;
    variable.CurrentTier = Number.isInteger(targetTier) && targetTier > previousVariableTier
      ? Math.min(targetTier, scalingUpgrade.Tiers?.length || 0)
      : Math.min(previousVariableTier + 1, scalingUpgrade.Tiers?.length || 0);

    savedAbility.Variables = variables;
    // CurrentTier is the overall ability level (1-15); it must never be
    // recomputed from the three independent stat tracks.
    savedAbility.PendingAbilityUpgrades = Math.max(
      0,
      (Number(savedAbility.PendingAbilityUpgrades) || 0) - (variable.CurrentTier - previousVariableTier)
    );
    abilities[index >= 0 ? index : abilities.length] = this.buildActionEmoteDto(definition, savedAbility);
    const updatedUser = await this.update(stumbleId, { actionEmotes: abilities });
    return updatedUser.actionEmotes.find((ability) => ability?.Id === abilityId);
  }

  static async equipActionEmoteSkin(stumbleId, abilityId, skinId) {
    const shared = getSharedData();
    const definition = (shared.ActionEmotes?.ActionEmotes || [])
      .find((ability) => isSupportedActionEmote(ability) && ability.Id === abilityId);
    if (!definition) throw new Error('Unknown action emote');

    const user = await this.findByStumbleId(stumbleId);
    if (!user) throw new Error('User not found');

    const abilities = (user.actionEmotes || []).map((ability) =>
      typeof ability === 'string' ? { Id: ability } : ability
    );
    const index = abilities.findIndex((ability) => ability?.Id === abilityId);
    const savedAbility = index >= 0 ? abilities[index] : { Id: abilityId };
    const requestedSkin = skinId || null;
    if (requestedSkin) {
      const skin = (definition.Skins || []).find((candidate) => candidate.Id === requestedSkin);
      if (!skin) throw new Error('Unknown ability skin');
    }

    savedAbility.EquippedSkin = requestedSkin;
    abilities[index >= 0 ? index : abilities.length] = this.buildActionEmoteDto(definition, savedAbility);
    const updatedUser = await this.update(stumbleId, { actionEmotes: abilities });
    return updatedUser.actionEmotes.find((ability) => ability?.Id === abilityId);
  }

  static async setEquippedCosmetic(stumbleId, cosmeticType, cosmeticId) {
    const user = await this.findByStumbleId(stumbleId);
    if (!user) throw new Error("User not found");

    const updatedCosmetics = { ...user.equippedCosmetics, [cosmeticType]: cosmeticId };
    return await this.update(stumbleId, { equippedCosmetics: updatedCosmetics });
  }

  static async claimBattlePassSlot(deviceId, slotKey) {
    const user = await this.findByDeviceId(deviceId);
    if (user.battlePass.slotsClaimed.includes(slotKey)) {
      throw new Error("Slot already claimed");
    }

    await database.collections.Users.updateOne(
      { deviceId },
      { $push: { 'battlePass.slotsClaimed': slotKey } }
    );
    return await this.findByDeviceId(deviceId);
  }

  static async addBattlePassExperience(deviceId, xpToAdd) {
    const user = await this.findByDeviceId(deviceId);
    const newXP = (user.battlePass.experience || 0) + xpToAdd;

    await database.collections.Users.updateOne(
      { deviceId },
      { $set: { 'battlePass.experience': newXP } }
    );

    return await this.findByDeviceId(deviceId);
  }

  static async GetHighscore(type, country, start = 0, count = 50) {
    const filter = {};
    const projection = { username: 1, country: 1, _id: 0 };
    let sortField;
    let valueField;

    if (type === "crowns") {
      filter.crowns = { $gt: 0 };
      projection.crowns = 1;
      sortField = "crowns";
      valueField = "Crowns";
    } else if (type === "rank") {
      filter.skillRating = { $gt: 0 };
      projection.skillRating = 1;
      sortField = "skillRating";
      valueField = "SkillRating";
    }

    if (country && country.toLowerCase() !== "") {
      filter.country = country;
    }

    const users = await database.collections.Users
      .find(filter)
      .sort({ [sortField]: -1 })
      .project(projection)
      .skip(parseInt(start))
      .limit(parseInt(count))
      .toArray();


    const scores = users.map(user => {
      const value = type === "crowns" ? user.crowns : user.skillRating;
      return {
        User: {
          Username: user.username,
          Country: user.country || "Unknown",
          [valueField]: value
        }
      };
    });

    return { scores };
  }

  static async getBalanceAmount(user, currency) {
    const balance = user.balances.find(b => b.name === currency);
    return balance ? balance.amount : 0;
  }

  static async getLevel(xp) {
    return Math.floor((xp + 1032700) / 30000) - 9;
  }
}



  async function authenticate(req, res, next) {
  try {
    const authHeader = req.headers.authorization;
    req.user = null;

    // Express routes accept an optional trailing slash. Apply the same rule
    // to public-route authentication checks (the client sends /user/login/).
    const authPath = req.path.endsWith('/') ? req.path.slice(0, -1) : req.path;
    if (authPath == "/user/login" || authPath == "/user/config" || authPath == "/photon/get") {
      return next();
    }
   
     if (!authHeader)
    {
      return res.status(401).json("naocara");
    } 
 
    let authData = {};
    try {
      authData = JSON.parse(authHeader);
      if (authData && authData.Encrypted) {
        const decrypted = CryptoUtils.Decrypt(authData.Encrypted);
        authData = JSON.parse(decrypted);
      }
    } catch (e) { 
      try {
        const decrypted = CryptoUtils.Decrypt(authHeader);
        authData = JSON.parse(decrypted);
      } catch (err) {
        Console.error("Auth", "Malformed authorization header rejected.");
        return res.status(401).json("UNAUTHORIZED");
      }
    }

    const deviceId = authData.DeviceId || "";
    const stumbleId = authData.StumbleId || "";
    const token = authData.Token || "";
    const hash = authData.Hash || "";
    const username = authData.Username || "";
    const id = authData.Id || "";


    const expectedHash = CryptoUtils.CreateRegularHash(
      username,
      id,
      deviceId,
      token,
      stumbleId,
      req.path,
      JSON.stringify(req.body)
    );

     /* if (hash !== expectedHash) {
      console.log("hash errada hahaha q otaro " + expectedHash);
      return res.status(401).json("UNAUTHORIZED");
     } */

    let user = stumbleId 
      ? await UserModel.findByStumbleId(stumbleId)
      : await UserModel.findByDeviceId(deviceId);

     if (!user) {
      return res.status(401).json("UNAUTHORIZED");
    }

    if (user.isBanned)
    {
        return res.status(403).json("BANNED");
    }
    if (process.env.DISCORD_LOGIN_REQUIRED === '1' && !user.discordId)
      return res.status(401).json({ code: 'discord_login_required' });

    if (!require('./SessionIdentity')(authData, user)) {
      require('./SecurityTelemetry').record('identity_rejected');
      return res.status(401).json("UNAUTHORIZED");
    }
    if (process.env.MOD_REQUEST_PROOF_REQUIRED === '1') {
      const nonceKey = require('./RequestProof')(authData, user.token, req.originalUrl, req.securityRawBody);
      if (!nonceKey) {
        require('./SecurityTelemetry').record('proof_rejected');
        return res.status(401).json({ code: 'request_proof_invalid' });
      }
      try {
        await database.collections.SecurityNonces.insertOne({ _id: nonceKey,
          expiresAt: new Date(Date.now() + 180000) }, { timeoutMS: 5000 });
      } catch (error) {
        if (error.code === 11000) {
          require('./SecurityTelemetry').record('replay_rejected');
          return res.status(409).json({ code: 'request_replayed' });
        }
        return res.status(503).json({ code: 'request_verification_unavailable' });
      }
    }
    if (process.env.MOD_LICENSE_REQUIRED === '1') {
      const policy = require('./ModAccessPolicy');
      const builds = new Set((process.env.MOD_ALLOWED_BUILDS || '').split(',').filter(Boolean));
      const denial = policy.authorize(user, authData.BuildId, builds, policy.featureForPath(req.path));
      if (denial) {
        require('./SecurityTelemetry').record('license_rejected');
        return res.status(403).json({ code: denial });
      }
    }
    req.user = user;
    req.modBuildId = authData.BuildId;
    if (process.env.MOD_SESSION_REQUIRED === '1' && authPath !== '/mod/session'
      && !require('./ModSession').verify(authData.ModAccessToken, user, authData.BuildId)) {
      require('./SecurityTelemetry').record('session_rejected');
      return res.status(401).json({ code: 'mod_session_required' });
    }

    Console.log("Auth", `Authenticated user: ${user.username}`);
    next();
  } catch (err) {
    Console.error("Auth", "Error:", err);
    res.status(401).json("UNAUTHORIZED");
  }
}



async function generatePhotonJwt(user) {
  const payload = {
    stumbleId: user.stumbleId,
    deviceId: user.deviceId,
    username: user.username
  };

  const secret = process.env.Salt;
  const options = { expiresIn: '30d', issuer: 'JWTPhoton' };

  return new Promise((resolve, reject) => {
    jwt.sign(payload, secret, options, (err, token) => {
      if (err) reject(err);
      else resolve(token);
    });
  });
}



async function VerifyPhoton(req, res, user) {
  try {
    const tokenFromHeader = req.headers.authorization;
    if (!tokenFromHeader) {
      return res.json({ ResultCode: -1, Message: "Authorization header missing" });
    }

    try {
      const secret = process.env.Salt;
      const decoded = jwt.verify(tokenFromHeader, secret);
      
      if (decoded.stumbleId !== user.stumbleId || 
          decoded.deviceId !== user.deviceId || 
          decoded.username !== user.username) {
        return res.json({ ResultCode: -1, Message: "Token validation failed" });
      }

      return res.json({ ResultCode: 1, UserId: tokenFromHeader });
    } catch (err) {
      return res.json({ ResultCode: -1, Message: "Invalid token" });
    }
  } catch (err) {
    Console.error("VerifyPhoon", "Error:", err);
    return res.status(500).json({ ResultCode: -1, Message: "Internal server error" });
  }
}



class UserController {
  static loginAttempts = new Map();
  static bannedIPs = new Map();
  static bannedDevices = new Map();


static async login(req, res) {
    try {
      const body = req.body || {};
      const DeviceId = body.DeviceId ?? body.DeviceID ?? body.deviceId ?? body.deviceid;
      const StumbleId = body.StumbleId ?? body.StumbleID ?? body.stumbleId ?? body.stumbleid;
      const Version = body.Version ?? body.version;
      if (typeof DeviceId !== 'string' || !DeviceId.trim())
        return res.status(400).json({ error: 'deviceid required' });


      // Express resolves req.ip using the application's trusted-proxy policy.
      // req.header is a function, so indexing it grouped all clients as undefined.
      const clientIp = req.ip || req.socket?.remoteAddress;
      
      if (UserController.bannedIPs.has(clientIp)) {
        const banInfo = UserController.bannedIPs.get(clientIp);
        if (Date.now() < banInfo.until) {
          return res.status(429).json({ error: 'a' });
        }
        UserController.bannedIPs.delete(clientIp);
      }

      if (UserController.bannedDevices.has(DeviceId)) {
        const banInfo = UserController.bannedDevices.get(DeviceId);
        if (Date.now() < banInfo.until) {
          return res.status(429).json({ error: 'a' });
        }
        UserController.bannedDevices.delete(DeviceId);
      }

      let discordId = null;
      if (process.env.DISCORD_LOGIN_REQUIRED === '1' || req.headers['x-ultimate-discord'] !== undefined) {
        discordId = await req.app.locals.discordLogin.consume(req.headers['x-ultimate-discord']);
        if (!discordId) return res.status(401).json({ error: 'discord_login_required' });
      }
      let user = discordId ? await UserModel.findByDiscordId(discordId) : typeof StumbleId === 'string' && StumbleId.trim()
        ? await UserModel.findByStumbleId(StumbleId) : null;
      if (!user && !discordId) user = await UserModel.findByDeviceId(DeviceId);
      if (!user && discordId) {
        const existing = await UserModel.findByDeviceId(DeviceId);
        if (existing) {
          user = await UserModel.linkDiscord(existing, discordId, req.headers['x-ultimate-previous-token']);
          if (!user) return res.status(409).json({ error: 'Existing account requires verified linking. Contact the server owner.' });
        }
      }

      if (!user) {
        const now = Date.now();
        const attempts = UserController.loginAttempts.get(clientIp) || { count: 0, lastAttempt: now, deviceAttempts: {} };
        
        if (now - attempts.lastAttempt > 60000) {
          attempts.count = 0;
          attempts.deviceAttempts = {};
        }
        
        attempts.count++;
        attempts.lastAttempt = now;
        
        if (!attempts.deviceAttempts[DeviceId]) {
          attempts.deviceAttempts[DeviceId] = 1;
        } else {
          attempts.deviceAttempts[DeviceId]++;
        }
        
        UserController.loginAttempts.set(clientIp, attempts);
        
        if (attempts.count > 5 || attempts.deviceAttempts[DeviceId] > 3) {
          UserController.bannedIPs.set(clientIp, {
            until: now + 15 * 60 * 1000,
            bannedAt: now
          });
          
          UserController.bannedDevices.set(DeviceId, {
            until: now + 15 * 60 * 1000,
            bannedAt: now
          });
          
          return res.status(429).json({ error: 'a' });
        }
        
        user = await UserModel.create(req.ip, DeviceId, { Version, discordId });
      } else {
        if (user.isBanned) return res.status(403).json("BANNED");
        
        UserController.loginAttempts.delete(clientIp);
        
        user = await UserModel.update(user.stumbleId, {
          lastLogin: new Date(),
          // Discord authenticates the selected account; the connecting device
          // may already belong to another account. Preserve this account's
          // device identity, which is returned in User and used with its token.
          version: Version
        });
      }

      const token = CryptoUtils.SessionToken();
      const photonJwt = await generatePhotonJwt(user);

      user = await UserModel.update(user.stumbleId, { token, photonJwt });
      user = await UserModel.grantConfiguredCatalogItems(user);

const featureFlags = require('./LoginFeatureFlags');
      Console.log("Login", "User Logged: " + user.username);
      // Version 0.75 expects ActionEmoteDto objects in the login payload.
      // Build them from the same catalog used for ownership above.
      const actionEmoteDefinitions = getSharedData().ActionEmotes?.ActionEmotes || [];
      const actionEmoteDtos = actionEmoteDefinitions
          .filter(isSupportedActionEmote)
          .map((ability) => UserModel.buildActionEmoteDto(
            ability,
            (user.actionEmotes || []).find((ownedAbility) =>
              (typeof ownedAbility === 'string' ? ownedAbility : ownedAbility?.Id) === ability.Id
            )
          ));
      const clientUser = {
        ...user,
        // The login User model uses the legacy array representation. The
        // dedicated /action-emotes endpoint converts it to the keyed DTO
        // map required by the abilities screen.
        actionEmotes: actionEmoteDtos
      };
      return res.status(200).json({
        User: clientUser,
        PhotonJwt: photonJwt,
        featureFlags: featureFlags
      });

    } catch (err) {
      Console.error('Login', 'Error:', err);
      return res.status(500).json({ error: 'internal server error' });
    }
  }

  static async getConfig(req, res) {
    try {
      const config = {
        _SharedVersion: 2,
        Versions: {
          AndroidLastVersionAvailable: 0.59
        },
        BattlePassRotation: SharedData.BattlePassRotation || [],
        BattlePassesV3: SharedData.BattlePasses || [],
        RoundLevels_v2: SharedData.RoundLevels_v2 || [],
        Skins_v4: SharedData.Skins_v4 || [],
        MissionObjectives: SharedData.MissionObjectives || [],
        PurchasableItems: SharedData.PurchasableItems || [],
        GameEvents: SharedData.GameEvents || [],
        Animations: SharedData.Animations || [],
        Animations_v2: SharedData.Animations_v2 || [],
        AdSettings: SharedData.AdSettings || {},
        AnalyticsSettings: SharedData.AnalyticsSettings || {},
        BackendUrl: SharedData.BackendUrl || "",
        BattlePass: SharedData.BattlePass || {},
        ActionEmotes: getSharedDataWithPrivateAbilityOffers().ActionEmotes,
        RankedPlaySettings: SharedData.RankedPlaySettings || {}
      };

      res.json(config);
    } catch (err) {
      Console.error('Config', 'Error:', err);
      res.status(500).json({ message: 'Internal server error' });
    }
  }
   
    static async updateUsername(req, res) {
  try {
    const { Username } = req.body;
    const { user } = req;

    if (!Username || Username.length < 3 || Username.length > 12) {
      return res.status(401).json({ message: 'so pode ter de 3 a 12 carater' });
    }

    if (/[<>{}\[\]()"'\`~#$%^&*=+\\\/|:;,?!]/.test(Username)) {
      return res.status(403).json({ message: 'caracteres invalidos' });
    }

    const existingUser = await database.getUserByQuery({ username: Username });
    if (existingUser) {
      return res.status(409).json({ message: 'Username already taken' });
    }

    const tagItems = user.inventory
      ? user.inventory.filter(i => i.itemType === "TAG" && typeof i.item === "string")
      : [];

    const tagsToAdd = tagItems.map(t => {
      let tag = t.item.replace(/^tag_/, '');
      if (t.amount > 1) tag += `+${t.amount}`;
      return tag;
    });

    let finalUsername = Username;

    if (tagsToAdd.length > 0) {
      finalUsername += " " + tagsToAdd.join(" ");
    }

    const oldNames = Array.isArray(user.oldNames) ? user.oldNames : [];
    oldNames.push({
      name: user.username,
      changedAt: new Date()
    });

    const updates = {
      username: finalUsername,
      "userProfile.userName": finalUsername,
      oldNames: oldNames
    };

    const updatedUser = await UserModel.update(user.stumbleId, updates);
    await UserModel.removeBalance(user.deviceId, "gems", 100);

    console.log(`${user.username} changed username to ${finalUsername}`);

    res.status(200).json({ User: updatedUser });

  } catch (err) {
    console.error("error updating username:", err);
    res.status(500).json({ message: "internal server error" });
  }
}




  static async getSettings(req, res) {
    try {
        const settings = {
            friendIsOnlinePush: true,
            invitedToPartyPush: true,
            partyInviteToastNotification: true,
            partyInviteInGameToastNotification: true
        };
        
        res.json(settings);
    } catch (err) {
        Console.error('Settings', 'Error:', err);
        res.status(500).json({ message: 'Internal server error' });
    }
}

  static async getProfile(req, res) {
    try {
      const { userID } = req.body;
      let user = null;

      if (userID) {
        user = await UserModel.findById(userID);
      }

      if (!user) {
        return res.status(404).json({ message: 'User not found' });
      }

      const ranked = user.userProfile?.ranked || {};
      res.json({
        User: {
          ...user.userProfile,
          ranked: {
            ...ranked,
            currentSeasonId: ranked.currentSeasonId || 'LIVE_RANKED_SEASON_12',
            currentRankId: ranked.currentRankId || 1,
            currentTierIndex: ranked.currentTierIndex || 0
          }
        }
      });
    } catch (err) {
      Console.error('Profile', 'Get error:', err);
      res.status(500).json({ message: 'Internal server error' });
    }
  }

  static async addSkin(req, res) {
    try {
      const { user } = req;
      const { skinId } = req.body;

     console.log("skin", req.body);

      if (!skinId) {
        return res.status(400).json({ message: 'skinId is required' });
      }

      await UserModel.addSkin(user.stumbleId, skinId);
      const updatedUser = await UserModel.findByStumbleId(user.stumbleId);
      res.json({ User: updatedUser });
    } catch (err) {
      Console.error('Cosmetics', 'Add skin error:', err);
      res.status(500).json({ message: 'Internal server error' });
    }
  }

  static async setEquippedCosmetic(req, res) {
    try {
        const { user } = req;
        const { Category, ItemId } = req.body;

        if (!Category || !ItemId) {
            return res.status(400).json({ message: 'falta algo' });
        }

        const updates = {
            equippedCosmetics: {
                ...user.equippedCosmetics,
                [Category]: ItemId
            }
        };

        if (Category === 'Skin') {
            updates['userProfile.skin'] = ItemId;
        }

        const updatedUser = await database.updateUser({ stumbleId: user.stumbleId }, updates);
        res.json({ User: updatedUser });
    } catch (err) {
        Console.error('Cosmetics', 'erro ao setar cosméticos:', err);
        res.status(500).json({ message: 'erro' });
    }
}
   
   
 static async getHighscore(req, res, next) {
  try {
    const { type } = req.params;
    const { start = 0, count = 100, country = 'global' } = req.query;

    const startNum = parseInt(start, 10);
    const countNum = parseInt(count, 10);

    if (!type) {
      return res.status(400).json({ error: "O tipo é necessário" });
    }

    if (isNaN(startNum) || isNaN(countNum)) {
      return res.status(400).json({ error: "Os parâmetros start e count devem ser números" });
    }

    const result = await UserModel.GetHighscore(type, country, startNum, countNum);

    res.json(result);
  } catch (err) {
    next(err);
  }
   }

  static async updateCosmetics(req, res) {
    try {
      const { user } = req;
      const body = req.body || {};
      const current = user.equippedCosmetics || {};
      const value = (camelCase, pascalCase) => body[camelCase] ?? body[pascalCase] ?? current[camelCase];

      const updates = {
        equippedCosmetics: {
          skin: value('skin', 'Skin'),
          color: value('color', 'Color'),
          animation: value('animation', 'Animation'),
          footsteps: value('footsteps', 'Footsteps'),
          emote1: value('emote1', 'Emote1'),
          emote2: value('emote2', 'Emote2'),
          emote3: value('emote3', 'Emote3'),
          emote4: value('emote4', 'Emote4'),
          actionEmote1: value('actionEmote1', 'ActionEmote1'),
          actionEmote2: value('actionEmote2', 'ActionEmote2'),
          actionEmote3: value('actionEmote3', 'ActionEmote3'),
          actionEmote4: value('actionEmote4', 'ActionEmote4')
        }
      };

      const updatedUser = await UserModel.update(user.stumbleId, updates);
      res.json({
        EquippedCosmetics: updatedUser.equippedCosmetics,
        PhotonJwt: updatedUser.photonJwt || null
      });
    } catch (err) {
      Console.error('Cosmetics', 'Update error:', err);
      res.status(500).json({ message: 'Internal server error' });
    }
  }

  static async deleteAccount(req, res) {
    try {
      const { user } = req;
      const newUsername = `#${CryptoUtils.GenCaracters(11)}`;
      
      await UserModel.update(user.deviceId, { username: newUsername });
      await database.collections.Users.deleteOne({ deviceId: user.deviceId });
      
      res.json({ message: 'tchauuuuuuu brigado' });
    } catch (err) {
      Console.error('Account', 'Delete error:', err);
      res.status(500).json({ message: 'Internal server error' });
    }
  }

  static async linkPlatform(req, res) {
    try {
      const { platform, platformId } = req.body;
      const { user } = req;
      
      const validPlatforms = ['google', 'apple', 'facebook', 'scopely'];
      if (!validPlatforms.includes(platform)) {
        return res.status(400).json({ message: 'Invalid platform' });
      }

      const platformIdMD5 = CryptoUtils.Hash('md5', platformId || `${platform}-${user.username}-${process.env.Salt}`);
      const updateField = `${platform}Id`;

      const updatedUser = await UserModel.update(user.deviceId, { [updateField]: platformIdMD5 });
      res.json({ User: updatedUser, message: `Successfully linked ${platform} account` });
    } catch (err) {
      Console.error('Platform', 'Link error:', err);
      res.status(500).json({ message: 'Internal server error' });
    }
  }

  static async unlinkPlatform(req, res) {
    try {
      const { platform } = req.body;
      const { user } = req;
      
      const validPlatforms = ['google', 'apple', 'facebook', 'scopely'];
      if (!validPlatforms.includes(platform)) {
        return res.status(400).json({ message: 'Invalid platform' });
      }

      const updateField = `${platform}Id`;
      const updatedUser = await UserModel.update(user.deviceId, { [updateField]: '' });
      
      res.json({ User: updatedUser, message: `Successfully unlinked ${platform} account` });
    } catch (err) {
      Console.error('Platform', 'Unlink error:', err);
      res.status(500).json({ message: 'Internal server error' });
    }
  }
}

class RoundController {
  static async finishRound(req, res) {
    try {
      const { user } = req;
      const { Round } = req.body;


      const rewards = {
        crowns: Round === '3' ? 1 : Round === '2' ? 0 : 0,
        skillRating: Round === '3' ? 20 : Round === '2' ? 10 : 0,
        experience: 100
      };

      const updatedUser = await UserModel.update(user.deviceId, {
        crowns: user.crowns + rewards.crowns,
        skillRating: user.skillRating + rewards.skillRating,
        experience: user.experience + rewards.experience
      });

      res.status(200).json({
        Rewards: rewards
      });
    } catch (err) {
      Console.error('Round', 'Finish error:', err);
      res.status(500).json({ message: 'Internal server error' });
    }
  }

  static async finishCustomRound(req, res) {
    try {
      const { user } = req;
      const { round } = req.params;
Console.log('Round', `Finishing custom round: ${round} for user: ${user.username}`);
      res.json({
        User: user,
        message: 'Custom round finished successfully'
      });
    } catch (err) {
      Console.error('Round', 'Custom finish error:', err);
      res.status(500).json({ message: 'Internal server error' });
    }
  }

  static async finishRoundV4(req, res) {
    try {
      const { user } = req;
      const { round } = req.params;
      const { gameType, variantId } = req.body;

      const gameId = CryptoUtils.CreateGameId(gameType === 'event' ? 'event' : 'regular');
      const levelIds = SharedData.RoundLevels_v2.map(level => level.LevelID).slice(0, 3);

      const roundPayloads = {};
      const placements = {};
      const eliminatedPlayers = [];
      const usersLastRound = {};

      if (round === '1') {
        placements[user.id] = 16;
        usersLastRound[user.id] = 1;
        roundPayloads[1] = {
          EliminatedPlayers: [user.id, ...Array(15).fill(0).map((_, i) => 1000 + i)],
          LevelId: levelIds[0],
          Placements: placements,
          RoundMissionProgression: null,
          Type: "SoloRound"
        };
      } else if (round === '2') {
        placements[user.id] = 8;
        usersLastRound[user.id] = 2;
        roundPayloads[1] = {
          EliminatedPlayers: [],
          LevelId: levelIds[0],
          Placements: placements,
          RoundMissionProgression: null,
          Type: "SoloRound"
        };
        roundPayloads[2] = {
          EliminatedPlayers: [user.id, ...Array(7).fill(0).map((_, i) => 1000 + i)],
          LevelId: levelIds[1],
          Placements: placements,
          RoundMissionProgression: null,
          Type: "SoloRound"
        };
      } else if (round === '3') {
        placements[user.id] = 1;
        usersLastRound[user.id] = 3;
        roundPayloads[1] = {
          EliminatedPlayers: [],
          LevelId: levelIds[0],
          Placements: placements,
          RoundMissionProgression: null,
          Type: "SoloRound"
        };
        roundPayloads[2] = {
          EliminatedPlayers: [],
          LevelId: levelIds[1],
          Placements: placements,
          RoundMissionProgression: null,
          Type: "SoloRound"
        };
        roundPayloads[3] = {
          EliminatedPlayers: [],
          LevelId: levelIds[2],
          Placements: placements,
          RoundMissionProgression: null,
          Type: "SoloRound"
        };
      }

      const clientViewPayload = {
        AverageMmr: null,
        CurrentRound: parseInt(round),
        ExpectedRounds: 3,
        FrameNumber: 7814,
        GameId: gameId,
        GameType: gameType === 'event' ? "Event" : "Regular",
        Placements: null,
        RoundPayloads: roundPayloads,
        StartingUsers: 32,
        UsersLastRound: usersLastRound,
        VariantId: variantId || null
      };

      const rewards = {
        crowns: round === '3' ? 1 : round === '2' ? 0 : 0,
        skillRating: round === '3' ? 20 : round === '2' ? 10 : 0,
        experience: 100
      };

      const updatedUser = await UserModel.update(user.deviceId, {
        crowns: user.crowns + rewards.crowns,
        skillRating: user.skillRating + rewards.skillRating,
        experience: user.experience + rewards.experience
      });

      res.status(200).json({
        ClientViewPayload: clientViewPayload,
        ClientViewPlacements: null,
        FriendsCount: 0,
        LevelIds: levelIds,
        MissionsProgression: {},
        SignedPayload: "",
        User: updatedUser,
        Rewards: rewards
      });
    } catch (err) {
      Console.error('Round', 'FinishV4 error:', err);
      res.status(500).json({ message: 'Internal server error' });
    }
  }

  static async finishEventRoundV3(req, res) {
    try {
      const { user } = req;
      const { region, appid, jwt, eventId } = req.params;
      const finishReq = req.body || {};

      if (!eventId) {
        return res.status(400).json({ message: "eventId requerido" });
      }

      const events = SharedData.GameEvents || [];
      const event = events.find(e => e.Id === eventId);
      if (!event) {
        return res.status(404).json({ message: "evento nao encontrado" });
      }

      const now = new Date();
      const start = new Date(event.StartDateTime);
      const end = new Date(event.EndDateTime);
      if (!(start <= now && now <= end)) {
        return res.status(400).json({ message: "evento nao esta ativo" });
      }

      const roundNumber = parseInt(finishReq.Round ?? finishReq.round);
      if (isNaN(roundNumber)) {
        return res.status(400).json({ message: "round invalido" });
      }

      const roundDef = Array.isArray(event.EventRounds)
        ? event.EventRounds.find(r => r.RoundNumber === roundNumber) || event.EventRounds[0]
        : null;

      if (!roundDef) {
        return res.status(400).json({ message: "round nao configurado para evento" });
      }

      let xp = 0;
      let passTokens = 0;
      let trophies = 0;
      let crowns = 0;
      let hiddenRatingDelta = 0;

      const rewardsList = Array.isArray(roundDef.RoundRewards) ? roundDef.RoundRewards : [];
      for (const r of rewardsList) {
        const amount = typeof r.max === "number" ? r.max : (typeof r.min === "number" ? r.min : 0);
        if (r.type === "XP") xp += amount;
        else if (r.type === "PASSTOKENS") passTokens += amount;
        else if (r.type === "TROPHIES") trophies += amount;
        else if (r.type === "CROWNS") crowns += amount;
      }

      const winnerRewardsList = Array.isArray(event.WinnerRewards?.Rewards) ? event.WinnerRewards.Rewards : [];
      for (const r of winnerRewardsList) {
        const amount = typeof r.max === "number" ? r.max : (typeof r.min === "number" ? r.min : 0);
        if (r.type === "XP") xp += amount;
        else if (r.type === "PASSTOKENS") passTokens += amount;
        else if (r.type === "TROPHIES") trophies += amount;
        else if (r.type === "CROWNS") crowns += amount;
      }
      if (typeof event.WinnerHiddenRating === "number") {
        hiddenRatingDelta += event.WinnerHiddenRating;
      }

      const currentCrowns = parseInt(user.userProfile?.crowns ?? user.crowns ?? 0) || 0;
      const currentExperience = parseInt(user.userProfile?.experience ?? user.experience ?? 0) || 0;
      const currentTrophies = parseInt(user.userProfile?.trophies ?? 0) || 0;
      const currentSkill = parseInt(user.skillRating ?? 0) || 0;
      const currentPassTokens = parseInt(user.battlePass?.passTokens ?? user.passTokens ?? 0) || 0;

      const updatedUserProfile = {
        ...(user.userProfile || {}),
        crowns: Math.max(0, currentCrowns + crowns),
        experience: Math.max(0, currentExperience + xp),
        trophies: Math.max(0, currentTrophies + trophies)
      };

      const updatedBattlePass = {
        ...(user.battlePass || {}),
        passTokens: Math.max(0, currentPassTokens + passTokens)
      };

      const updatedUser = await UserModel.update(user.stumbleId, {
        crowns: Math.max(0, (user.crowns || 0) + crowns),
        experience: Math.max(0, (user.experience || 0) + xp),
        skillRating: Math.max(0, currentSkill + trophies + hiddenRatingDelta),
        passTokens: Math.max(0, (user.passTokens || 0) + passTokens),
        battlePass: updatedBattlePass,
        userProfile: updatedUserProfile
      });

      return res.status(200).json({
        EventId: eventId,
        Region: region,
        Rewards: {
          XP: xp,
          PASSTOKENS: passTokens,
          TROPHIES: trophies,
          CROWNS: crowns
        },
        UpdatedUser: updatedUser,
        SignedPayload: finishReq.SignedPayload || ""
      });
    } catch (err) {
      Console.error("GameEvents", "FinishV3 error:", err);
      return res.status(500).json({ message: "erro interno" });
    }
  }
}

class BattlePassController {
  static async getBattlePass(req, res) {
    try {
      const now = new Date();
      const activePass = SharedData.BattlePassRotation.find(pass => {
        const startDate = new Date(pass.StartDate);
        const endDate = new Date(pass.EndDate);
        return startDate <= now && now <= endDate;
      });

      if (!activePass) {
        Console.log("BattlePass", `No active battle pass found`);
        return res.status(404).json({ message: 'No active battle pass found' });
      }

      const battlePass = SharedData.BattlePasses.find(bp => bp.PassID === activePass.PassID);
      if (!battlePass) {
        Console.log("BattlePass", `Battle pass data not found for PassID: ${activePass.PassID}`);
        return res.status(404).json({ message: 'Battle pass data not found' });
      }

      res.json([battlePass]);
    } catch (err) {
      Console.error('BattlePass', 'Get error:', err);
      res.status(500).json({ message: 'Internal server error' });
    }
  }

  static async claimReward(req, res) {
    try {
      const { user } = req;
      const { Page, Section, Slot, IsPremium } = req.body;
      
      if (Page === undefined || Section === undefined || Slot === undefined) {
        Console.log("BattlePass", `Invalid claim request: ${JSON.stringify(req.body)}`);
        return res.status(400).json({ message: 'Page, Section and Slot are required' });
      }

      const slotKey = `${Page},${Section},${Slot}`;
      if (user.battlePass.slotsClaimed.includes(slotKey)) {
        Console.log("BattlePass", `Slot already claimed: ${slotKey}`);
        return res.status(400).json({ message: 'Slot already claimed' });
      }

      await database.collections.Users.updateOne(
        { deviceId: user.deviceId },
        { $push: { 'battlePass.slotsClaimed': slotKey } }  
      );

      const updatedUser = await UserModel.findByDeviceId(user.deviceId);
      res.json({ User: updatedUser });
    } catch (err) {
      Console.error('BattlePass', 'Claim error:', err);
      res.status(500).json({ message: 'Internal server error' });
    }
  }

  static async purchaseBattlePass(req, res) {
    try {
      const { user } = req;

      if (user.battlePass.hasPurchased) {
        Console.log("BattlePass", `User already purchased battle pass: ${user.deviceId}`);
        return res.status(400).json({ message: 'Battle pass already purchased' });
      }

      const gemsBalance = UserModel.getBalanceAmount(user, 'gems');
      if (gemsBalance < 1200) {
        Console.log("BattlePass", `Not enough gems to purchase battle pass: ${user.deviceId}`);
        return res.status(400).json({ message: 'Not enough gems' });
      }

      await UserModel.removeBalance(user.deviceId, 'gems', 1200);
      await UserModel.update(user.deviceId, { 'battlePass.hasPurchased': true });

      const updatedUser = await UserModel.findByDeviceId(user.deviceId);
      res.json({ User: updatedUser });
    } catch (err) {
      Console.error('BattlePass', 'Purchase error:', err);
      res.status(500).json({ message: 'Internal server error' });
    }
  }

  static async completeBattlePass(req, res) {
    try {
      const { user } = req;
      const battlePass = SharedData.BattlePasses[0];

      if (!battlePass) {
        Console.log("BattlePass", `No battle pass data available`);
        return res.status(404).json({ message: 'No battle pass data available' });
      }

      const claimedSlots = user.battlePass.slotsClaimed || [];
      const userCoins = user.battlePass.coins || 0;
      const userExperience = user.battlePass.experience || 0;
      const xpToLevelUp = battlePass.XPToLevelUp || 1000;

      const calculateLevel = (experience) => {
        return Math.floor(experience / xpToLevelUp);
      };

      const playerLevel = calculateLevel(userExperience);

      for (const [pageIndex, page] of battlePass.Content.Pages.entries()) {
        for (const [sectionIndex, section] of page.Sections.entries()) {
          const sectionUnlockLevel = section.UnlockLevel || 0;
          if (playerLevel >= sectionUnlockLevel) {
            for (const [slotIndex, slot] of section.Slots.entries()) {
              const slotKey = `${pageIndex},${sectionIndex},${slotIndex}`;
              if (!claimedSlots.includes(slotKey)) {
                if (userCoins >= slot.UnlockCost && (!slot.IsPremium || user.battlePass.hasPurchased)) {
                  await database.collections.Users.updateOne(
                    { deviceId: user.deviceId },
                    { $push: { 'battlePass.slotsClaimed': slotKey } }
                  );
                }
              }
            }
          }
        }
      }

      const updatedUser = await UserModel.findByDeviceId(user.deviceId);
      res.json({ User: updatedUser });
    } catch (err) {
      Console.error('BattlePass', 'Complete error:', err);
      res.status(500).json({ message: 'Internal server error' });
    }
  }
}

class EconomyController {
  static async purchase(req, res) {
    try {
      const { user } = req;
      const itemId = req.params.item;

      Console.log('Economy', `purchase start: user=${user.stumbleId} item=${itemId}`);

      const item = getSharedDataWithPrivateAbilityOffers().PurchasableItems.find(i => i.Name === itemId);
      if (!item) {
        Console.error('Economy', `purchase item not found: ${itemId}`);
        return res.status(404).json({ error: 'ITEM_NOT_FOUND' });
      }

      const price = (item.prices && item.prices[0]) || (item.Prices && item.Prices[0]) || null;
      if (!price) {
        Console.error('Economy', `purchase invalid price for item=${itemId}`);
        return res.status(400).json({ error: 'INVALID_PRICE' });
      }

      const currency = price.currency || price.Currency;
      const amount = price.amount || price.Amount || 0;

      if (currency === 'iap') {
        return res.status(400).json({ error: 'IAP_RECEIPT_VALIDATION_REQUIRED' });
      }

      if (currency && currency !== 'iap') {
        const balance = await UserModel.getBalanceAmount(user, currency);
        Console.log('Economy', `purchase price: currency=${currency} amount=${amount} balance=${balance}`);
        if (balance < amount) return res.status(402).json({ error: 'INSUFFICIENT_FUNDS' });
        await UserModel.removeBalance(user.deviceId, currency, amount);
      } else {
        Console.log('Economy', `purchase via IAP or free: currency=${currency} amount=${amount}`);
      }

      const rewards = [];
      const itemRewards = item.rewards || item.Rewards || [];
      for (const reward of itemRewards) {
        const type = (reward.type || reward.Type || '').toUpperCase();
        const typeInfo = reward.typeInfo || reward.CosmeticId || reward.CurrencyType || reward.CosmeticType || '';
        const rewardAmount = reward.amount || reward.Amount || reward.min || 1;

        if (type === 'CURRENCY') {
          await UserModel.addBalance(user.deviceId, typeInfo, rewardAmount);
          rewards.push({ type: 'CURRENCY', typeInfo, amount: rewardAmount });
        } else if (type === 'SKIN') {
          await UserModel.addSkin(user.stumbleId, typeInfo);
          rewards.push({ type: 'SKIN', typeInfo });
        } else if (type === 'ACTION_EMOTE') {
          await database.addToUserArray({ stumbleId: user.stumbleId }, 'actionEmotes', typeInfo);
          rewards.push({ type: 'ACTION_EMOTE', typeInfo });
        } else if (type === 'EMOTE') {
          await database.addToUserArray({ stumbleId: user.stumbleId }, 'emotes', typeInfo);
          rewards.push({ type: 'EMOTE', typeInfo });
        } else if (type === 'COSMETIC') {
          await UserModel.addSkin(user.stumbleId, typeInfo);
          rewards.push({ type: 'COSMETIC', typeInfo });
        }
      }
    
      const updatedUser = await UserModel.findByStumbleId(user.stumbleId);

      
      const featureFlagsWorking = [
        'age-request',
        'Consensus',
        'CustomParty',
        'EndOfMatchRewardedVideo',
        'GamePlayInGameNotifications',
        'HelpshiftConversation',
        'LocalNotifications',
        'MatchmakingFilter',
        'NewMatchmaking',
        'Pusher',
        'TournamentsX',
        'TournamentsXMeta',
        'QuantumSystemManagement',
        'RemoteLocalizations',
        'RoomManagementConsole',
        'TransferAppleIdAuthorization'
      ];

      const response = {
        FeatureFlags: featureFlagsWorking,
        PhotonJwt: "",
        TermsOfServiceAccepted: true,
        Timestamp: new Date().toISOString(),
        User: updatedUser
      }
     
      Console.log('Economy', `purchase done: user=${user.stumbleId} rewards=${JSON.stringify(rewards)}`);
      res.json({ User: updatedUser });
    } catch (err) {
      Console.error('Economy', 'Purchase error:', err);
      res.status(500).json({ error: 'INTERNAL_SERVER_ERROR' });
    }
  }

  static async purchaseGasha(req, res) {
    try {
      const { user } = req;
      const { itemId } = req.params;
      const countParam = parseInt(req.params.count);
      const drawCount = isNaN(countParam) ? 1 : Math.max(1, countParam);
      Console.log('Economy', `purchaseGasha start: user=${user.stumbleId} itemId=${itemId} count=${drawCount}`);
      const hadSkins = new Set((user.skins || []));
      const rewards = [];
      const allSkins = SharedData.Skins_v4 || [];

      const gems = UserModel.getBalanceAmount(user, 'gems');
      const totalCost = 50 * drawCount;
      if (gems < totalCost) return res.status(402).json({ error: 'NOT_ENOUGH_GEMS' });

      await UserModel.removeBalance(user.deviceId, 'gems', totalCost);

      const gachaDef = (SharedData.Gachas || []).find(g => g.PurchasableItem === itemId || g.Id === itemId);
      const rotationList = gachaDef?.RotationItemList || [];
      if (rotationList.length === 0) {
        Console.warn('Economy', `purchaseGasha missing rotation list for itemId=${itemId}, falling back to Skins_v4`);
        if (allSkins.length === 0) return res.status(500).json({ error: 'NO_SKINS_AVAILABLE' });
        // Fallback: use any skin ids
        for (let i = 0; i < drawCount; i++) {
          const randomIndex = Math.floor(Math.random() * allSkins.length);
          const selectedSkin = allSkins[randomIndex];
          const skinId = selectedSkin.SkinID;
          let duplicateCurrency = null;
          let duplicateCurrencyAmount = 0;
          if (hadSkins.has(skinId)) {
            duplicateCurrency = 'dust';
            duplicateCurrencyAmount = 5;
          } else {
            await UserModel.addSkin(user.stumbleId, skinId);
            hadSkins.add(skinId);
          }
          await database.collections.Users.updateOne(
            { stumbleId: user.stumbleId },
            { $push: { Rewards: {
              Amount: 1,
              DuplicateCurrency: duplicateCurrency,
              DuplicateCurrencyAmount: duplicateCurrencyAmount,
              NestedRewards: [],
              Type: 'SKIN',
              TypeInfo: skinId
            } } }
          );
          rewards.push({ type: 'Cosmetic', cosmeticId: skinId });
        }
      } else {
        for (let i = 0; i < drawCount; i++) {
          const randomIndex = Math.floor(Math.random() * rotationList.length);
          const skinId = rotationList[randomIndex];
          let duplicateCurrency = null;
          let duplicateCurrencyAmount = 0;
          if (hadSkins.has(skinId)) {
            duplicateCurrency = 'dust';
            duplicateCurrencyAmount = 5;
          } else {
            await UserModel.addSkin(user.stumbleId, skinId);
            hadSkins.add(skinId);
          }
          await database.collections.Users.updateOne(
            { stumbleId: user.stumbleId },
            { $push: { Rewards: {
              Amount: 1,
              DuplicateCurrency: duplicateCurrency,
              DuplicateCurrencyAmount: duplicateCurrencyAmount,
              NestedRewards: [],
              Type: 'SKIN',
              TypeInfo: skinId
            } } }
          );
          rewards.push({ type: 'Cosmetic', cosmeticId: skinId });
        }
      }

      for (let i = 0; i < drawCount; i++) {
        const randomIndex = Math.floor(Math.random() * allSkins.length);
        const selectedSkin = allSkins[randomIndex];
        const skinId = selectedSkin.SkinID;
        let duplicateCurrency = null;
        let duplicateCurrencyAmount = 0;
        if (hadSkins.has(skinId)) {
          duplicateCurrency = 'dust';
          duplicateCurrencyAmount = 5;
        } else {
          await UserModel.addSkin(user.stumbleId, skinId);
          hadSkins.add(skinId);
        }
        await database.collections.Users.updateOne(
          { stumbleId: user.stumbleId },
          { $push: { Rewards: {
            Amount: 1,
            DuplicateCurrency: duplicateCurrency,
            DuplicateCurrencyAmount: duplicateCurrencyAmount,
            NestedRewards: [],
            Type: 'SKIN',
            TypeInfo: skinId
          } } }
        );
        rewards.push({ type: 'Cosmetic', cosmeticId: skinId });
      }

      const updatedUser = await UserModel.findByStumbleId(user.stumbleId);
      const battlePassEnd = updatedUser.battlePass?.secondsToEnd
        ? new Date(Date.now() + (updatedUser.battlePass.secondsToEnd * 1000))
        : new Date();

      const mapBalances = (balances = []) => balances.map(b => ({
        Amount: b.amount || 0,
        LastGiven: (b.lastGiven instanceof Date ? b.lastGiven.toISOString() : new Date(b.lastGiven || Date.now()).toISOString()),
        MaxAmount: b.maxAmount || 0,
        Name: b.name,
        SecondsPerUnit: b.secondsPerUnit || 0,
        SecondsSince: b.secondsSince || 0
      }));

      const settings = {
        FriendIsOnlinePush: true,
        InvitedToPartyPush: true,
        PartyInviteInGameToastNotification: true,
        PartyInviteToastNotification: true
      };

      const userPayload = {
        Age: updatedUser.age || 0,
        Animations: updatedUser.animations || [],
        AvailableNewsVersion: updatedUser.availableNewsVersion || 0,
        Balances: mapBalances(updatedUser.balances || []),
        BanReason: '',
        BattlePass: {
          FreePassRewards: updatedUser.battlePass?.freePassRewards || [],
          HasPurchased: !!updatedUser.battlePass?.hasPurchased,
          PassID: updatedUser.battlePass?.passID || 0,
          PassTokens: updatedUser.battlePass?.passTokens || 0,
          PremiumPassRewards: updatedUser.battlePass?.premiumPassRewards || [],
          SecondsToEnd: updatedUser.battlePass?.secondsToEnd || 0,
          endTime: battlePassEnd.toISOString()
        },
        Country: updatedUser.country || 'BR',
        Created: updatedUser.creationDate ? updatedUser.creationDate.toISOString() : new Date().toISOString(),
        Crowns: updatedUser.crowns || 0,
        DeviceId: updatedUser.deviceId,
        Emotes: updatedUser.emotes || [],
        Experience: updatedUser.experience || 0,
        Footsteps: updatedUser.footsteps || [],
        FreePassRewards: updatedUser.freePassRewards || [],
        HasBattlePass: !!updatedUser.hasBattlePass,
        HiddenRating: updatedUser.hiddenRating || 0,
        Id: updatedUser.id || 0,
        Inventory: (updatedUser.inventory || []).map(i => ({ Amount: i.amount || 0, Item: i.item, ItemType: i.itemType })),
        IsBanned: !!updatedUser.isBanned,
        KidFriendlyMode: updatedUser.kidFriendlyMode || 0,
        LastLogin: updatedUser.lastLogin ? updatedUser.lastLogin.toISOString() : new Date().toISOString(),
        LastLuckySpin: updatedUser.lastLuckySpin ? updatedUser.lastLuckySpin.toISOString() : new Date(Date.now() - 86400000).toISOString(),
        LatestNewsIdBackend: updatedUser.latestNewsIdBackend || 0,
        MyOwnCode: updatedUser.MyOwnCode || '',
        NewsVersion: updatedUser.newsVersion || 0,
        PassTokens: updatedUser.passTokens || 0,
        PremiumPassRewards: updatedUser.premiumPassRewards || [],
        Region: updatedUser.region || 'SA',
        RewardID: 'deprecated',
        Rewards: updatedUser.Rewards || [],
        SecondsSinceCreated: updatedUser.secondsSinceCreated || 0,
        SelectedSkin: updatedUser.equippedCosmetics?.skin || 'SKIN1',
        Settings: settings,
        SkillRating: updatedUser.skillRating || 0,
        Skins: updatedUser.skins || [],
        StumbleId: updatedUser.stumbleId,
        Token: updatedUser.token,
        Username: updatedUser.username,
        Version: updatedUser.version || '0'
      };

      const featureFlagsWorking = [
        'age-request',
        'Consensus',
        'CustomParty',
        'EndOfMatchRewardedVideo',
        'GamePlayInGameNotifications',
        'HelpshiftConversation',
        'LocalNotifications',
        'MatchmakingFilter',
        'NewMatchmaking',
        'Pusher',
        'TournamentsX',
        'TournamentsXMeta',
        'QuantumSystemManagement',
        'RemoteLocalizations',
        'RoomManagementConsole',
        'TransferAppleIdAuthorization'
      ];

      const response = {
        FeatureFlags: featureFlagsWorking,
        PhotonJwt: "",
        TermsOfServiceAccepted: true,
        Timestamp: new Date().toISOString(),
        User: userPayload
      };

      Console.log('Economy', `purchaseGasha done: user=${user.stumbleId} rewardsCount=${rewards.length}`);
      return res.status(200).json({ User: userPayload });
    } catch (err) {
      Console.error('Economy', 'Gasha error:', err);
      res.status(500).json({ error: 'INTERNAL_SERVER_ERROR' });
    }
  }

  static async purchaseLuckySpin(req, res) {
    try {
      const { user } = req;
      Console.log('Economy', `purchaseLuckySpin start: user=${user.stumbleId}`);

      const gems = UserModel.getBalanceAmount(user, 'gems');
      if (gems < 50) return res.status(402).json({ error: 'NOT_ENOUGH_GEMS' });

      await UserModel.removeBalance(user.deviceId, 'gems', 50);

      const allSkins = SharedData.Skins_v4 || [];
      if (allSkins.length === 0) return res.status(500).json({ error: 'NO_SKINS_AVAILABLE' });

      const randomIndex = Math.floor(Math.random() * allSkins.length);
      const selectedSkin = allSkins[randomIndex];

      const skinId = selectedSkin.SkinID;
      let duplicateCurrency = null;
      let duplicateCurrencyAmount = 0;
      const hadSkins = new Set((user.skins || []).map(s => s));
      if (hadSkins.has(skinId)) {
        duplicateCurrency = 'dust';
        duplicateCurrencyAmount = 5;
      } else {
        await UserModel.addSkin(user.stumbleId, skinId);
      }

      await database.collections.Users.updateOne(
        { stumbleId: user.stumbleId },
        { $push: { Rewards: {
          Amount: 1,
          DuplicateCurrency: duplicateCurrency,
          DuplicateCurrencyAmount: duplicateCurrencyAmount,
          NestedRewards: [],
          Type: 'SKIN',
          TypeInfo: skinId
        } } }
      );

      const updatedUser = await UserModel.findByStumbleId(user.stumbleId);

      const battlePassEnd = updatedUser.battlePass?.secondsToEnd
        ? new Date(Date.now() + (updatedUser.battlePass.secondsToEnd * 1000))
        : new Date();

      const mapBalances = (balances = []) => balances.map(b => ({
        Amount: b.amount || 0,
        LastGiven: (b.lastGiven instanceof Date ? b.lastGiven.toISOString() : new Date(b.lastGiven || Date.now()).toISOString()),
        MaxAmount: b.maxAmount || 0,
        Name: b.name,
        SecondsPerUnit: b.secondsPerUnit || 0,
        SecondsSince: b.secondsSince || 0
      }));

      const settings = {
        FriendIsOnlinePush: true,
        InvitedToPartyPush: true,
        PartyInviteInGameToastNotification: true,
        PartyInviteToastNotification: true
      };

      const userPayload = {
        Age: updatedUser.age || 0,
        Animations: updatedUser.animations || [],
        AvailableNewsVersion: updatedUser.availableNewsVersion || 0,
        Balances: mapBalances(updatedUser.balances || []),
        BanReason: '',
        BattlePass: {
          FreePassRewards: updatedUser.battlePass?.freePassRewards || [],
          HasPurchased: !!updatedUser.battlePass?.hasPurchased,
          PassID: updatedUser.battlePass?.passID || 0,
          PassTokens: updatedUser.battlePass?.passTokens || 0,
          PremiumPassRewards: updatedUser.battlePass?.premiumPassRewards || [],
          SecondsToEnd: updatedUser.battlePass?.secondsToEnd || 0,
          endTime: battlePassEnd.toISOString()
        },
        Country: updatedUser.country || 'BR',
        Created: updatedUser.creationDate ? updatedUser.creationDate.toISOString() : new Date().toISOString(),
        Crowns: updatedUser.crowns || 0,
        DeviceId: updatedUser.deviceId,
        Emotes: updatedUser.emotes || [],
        Experience: updatedUser.experience || 0,
        Footsteps: updatedUser.footsteps || [],
        FreePassRewards: updatedUser.freePassRewards || [],
        HasBattlePass: !!updatedUser.hasBattlePass,
        HiddenRating: updatedUser.hiddenRating || 0,
        Id: updatedUser.id || 0,
        Inventory: (updatedUser.inventory || []).map(i => ({ Amount: i.amount || 0, Item: i.item, ItemType: i.itemType })),
        IsBanned: !!updatedUser.isBanned,
        KidFriendlyMode: updatedUser.kidFriendlyMode || 0,
        LastLogin: updatedUser.lastLogin ? updatedUser.lastLogin.toISOString() : new Date().toISOString(),
        LastLuckySpin: updatedUser.lastLuckySpin ? updatedUser.lastLuckySpin.toISOString() : new Date().toISOString(),
        LatestNewsIdBackend: updatedUser.latestNewsIdBackend || 0,
        MyOwnCode: updatedUser.MyOwnCode || '',
        NewsVersion: updatedUser.newsVersion || 0,
        PassTokens: updatedUser.passTokens || 0,
        PremiumPassRewards: updatedUser.premiumPassRewards || [],
        Region: updatedUser.region || 'SA',
        RewardID: 'deprecated',
        Rewards: updatedUser.Rewards || [],
        SecondsSinceCreated: updatedUser.secondsSinceCreated || 0,
        SelectedSkin: updatedUser.equippedCosmetics?.skin || 'SKIN1',
        Settings: settings,
        SkillRating: updatedUser.skillRating || 0,
        Skins: updatedUser.skins || [],
        StumbleId: updatedUser.stumbleId,
        Token: updatedUser.token,
        Username: updatedUser.username,
        Version: updatedUser.version || '0'
      };

      const response = {
        FeatureFlags: updatedUser.featureFlags || [],
        PhotonJwt: "",
        TermsOfServiceAccepted: true,
        Timestamp: new Date().toISOString(),
        User: userPayload
      };

      Console.log('Economy', `purchaseLuckySpin done: user=${user.stumbleId} skin=${skinId}`);
      return res.status(200).json({ User: userPayload });
    } catch (err) {
      Console.error('Economy', 'LuckySpin error:', err);
      res.status(500).json({ error: 'INTERNAL_SERVER_ERROR' });
    }
  }

  static async purchaseLuckySpinWheel(req, res) {
    try {
      const { user } = req;
      Console.log('Economy', `purchaseLuckySpinWheel start: user=${user.stumbleId}`);

      const now = new Date();
      await UserModel.addBalance(user.deviceId, 'gems', 10);
      await database.collections.Users.updateOne(
        { stumbleId: user.stumbleId },
        { $set: { lastLuckySpin: now } }
      );

      await database.collections.Users.updateOne(
        { stumbleId: user.stumbleId, "balances.name": "gems" },
        { $set: { "balances.$.lastGiven": now } }
      );

      await database.collections.Users.updateOne(
        { stumbleId: user.stumbleId },
        { $push: { Rewards: {
          Amount: 10,
          DuplicateCurrency: null,
          DuplicateCurrencyAmount: 0,
          NestedRewards: [],
          Type: 'CURRENCY',
          TypeInfo: 'gems'
        } } }
      );

      const updatedUser = await UserModel.findByStumbleId(user.stumbleId);

      const mapBalances = (balances = []) => balances.map(b => ({
        Amount: b.amount || 0,
        LastGiven: (b.lastGiven instanceof Date ? b.lastGiven.toISOString() : new Date(b.lastGiven || Date.now()).toISOString()),
        MaxAmount: b.maxAmount || 0,
        Name: b.name,
        SecondsPerUnit: b.secondsPerUnit || 0,
        SecondsSince: b.secondsSince || 0
      }));

      const settings = {
        FriendIsOnlinePush: true,
        InvitedToPartyPush: true,
        PartyInviteInGameToastNotification: true,
        PartyInviteToastNotification: true
      };

      const battlePassEnd = updatedUser.battlePass?.secondsToEnd
        ? new Date(Date.now() + (updatedUser.battlePass.secondsToEnd * 1000))
        : new Date();

      const userPayload = {
        Age: updatedUser.age || 0,
        Animations: updatedUser.animations || [],
        AvailableNewsVersion: updatedUser.availableNewsVersion || 0,
        Balances: mapBalances(updatedUser.balances || []),
        BanReason: '',
        BattlePass: {
          FreePassRewards: updatedUser.battlePass?.freePassRewards || [],
          HasPurchased: !!updatedUser.battlePass?.hasPurchased,
          PassID: updatedUser.battlePass?.passID || 0,
          PassTokens: updatedUser.battlePass?.passTokens || 0,
          PremiumPassRewards: updatedUser.battlePass?.premiumPassRewards || [],
          SecondsToEnd: updatedUser.battlePass?.secondsToEnd || 0,
          endTime: battlePassEnd.toISOString()
        },
        Country: updatedUser.country || 'BR',
        Created: updatedUser.creationDate ? updatedUser.creationDate.toISOString() : new Date().toISOString(),
        Crowns: updatedUser.crowns || 0,
        DeviceId: updatedUser.deviceId,
        Emotes: updatedUser.emotes || [],
        Experience: updatedUser.experience || 0,
        Footsteps: updatedUser.footsteps || [],
        FreePassRewards: updatedUser.freePassRewards || [],
        HasBattlePass: !!updatedUser.hasBattlePass,
        HiddenRating: updatedUser.hiddenRating || 0,
        Id: updatedUser.id || 0,
        Inventory: (updatedUser.inventory || []).map(i => ({ Amount: i.amount || 0, Item: i.item, ItemType: i.itemType })),
        IsBanned: !!updatedUser.isBanned,
        KidFriendlyMode: updatedUser.kidFriendlyMode || 0,
        LastLogin: updatedUser.lastLogin ? updatedUser.lastLogin.toISOString() : new Date().toISOString(),
        LastLuckySpin: updatedUser.lastLuckySpin ? updatedUser.lastLuckySpin.toISOString() : now.toISOString(),
        LatestNewsIdBackend: updatedUser.latestNewsIdBackend || 0,
        MyOwnCode: updatedUser.MyOwnCode || '',
        NewsVersion: updatedUser.newsVersion || 0,
        PassTokens: updatedUser.passTokens || 0,
        PremiumPassRewards: updatedUser.premiumPassRewards || [],
        Region: updatedUser.region || 'SA',
        RewardID: 'deprecated',
        Rewards: [{
          amount: 10,
          duplicateCurrencyAmount: 0,
          nestedRewards: [],
          sourceType: 'UNKNOWN',
          type: 'CURRENCY',
          typeInfo: 'gems'
        }],
        SecondsSinceCreated: updatedUser.secondsSinceCreated || 0,
        SelectedSkin: updatedUser.equippedCosmetics?.skin || 'SKIN1',
        Settings: settings,
        SkillRating: updatedUser.skillRating || 0,
        Skins: updatedUser.skins || [],
        StumbleId: updatedUser.stumbleId,
        Token: updatedUser.token,
        Username: updatedUser.username,
        Version: updatedUser.version || '0'
      };

      
      Console.log('Economy', `purchaseLuckySpinWheel done: user=${user.stumbleId}`);
      return res.status(200).json({ User: userPayload });
    } catch (err) {
      Console.error('Economy', 'LuckySpinWheel error:', err);
      res.status(500).json({ error: 'INTERNAL_SERVER_ERROR' });
    }
  }

  static async purchaseDrop(req, res) {
    try {
      const { user } = req;
      const { itemId, count } = req.params;
      Console.log('Economy', `purchaseDrop start: user=${user.stumbleId} rarity=${itemId} count=${count}`);

      const photonJwt = "";

      const rarity = String(itemId || '').toUpperCase();
      const totalCount = Math.max(1, parseInt(count || '1', 10) || 1);

      const allSkins = Array.isArray(SharedData.Skins_v4) ? SharedData.Skins_v4 : [];
      const byRarity = allSkins.filter(s => String(s.Rarity).toUpperCase() === rarity);

      function findMobileLuckySpinOffer(shared) {
        if (Array.isArray(shared.LuckySpinWheels)) {
          for (const wheel of shared.LuckySpinWheels) {
            const platforms = Array.isArray(wheel.Platforms) ? wheel.Platforms : [];
            if (Array.isArray(wheel.SpinVisualDropsList) && (platforms.includes('android') || platforms.includes('ios'))) {
              return wheel;
            }
          }
        }
        for (const key of Object.keys(shared)) {
          const val = shared[key];
          if (Array.isArray(val)) {
            for (const el of val) {
              if (el && typeof el === 'object') {
                const platforms = Array.isArray(el.Platforms) ? el.Platforms : [];
                if (Array.isArray(el.SpinVisualDropsList) && (platforms.includes('android') || platforms.includes('ios'))) {
                  return el;
                }
              }
            }
          } else if (val && typeof val === 'object') {
            const platforms = Array.isArray(val.Platforms) ? val.Platforms : [];
            if (Array.isArray(val.SpinVisualDropsList) && (platforms.includes('android') || platforms.includes('ios'))) {
              return val;
            }
          }
        }
        return null;
      }

      const spinOffer = findMobileLuckySpinOffer(SharedData);
      const visualSkinIdsRaw = spinOffer
        ? (spinOffer.SpinVisualDropsList || []).filter(x => typeof x === 'string' && x.startsWith('SKIN'))
        : [];
      const skinById = new Map(allSkins.map(s => [s.SkinID, s]));
      let visualSkinIds = visualSkinIdsRaw.filter(id => (skinById.get(id)?.Rarity || '').toUpperCase() === rarity);
      if (visualSkinIds.length === 0) {
        visualSkinIds = visualSkinIdsRaw; // fallback: allow any SKIN in visual list
      }
      Console.log('Economy', `purchaseDrop spinOffer=${spinOffer?.Id || 'unknown'} rarity=${rarity} visualCount=${visualSkinIds.length}`);

      const existingSkins = new Set((user.skins || []).map(s => s));

      const picks = [];
      let pool = [];
      if (visualSkinIds.length > 0) {
        pool = visualSkinIds.filter(id => !existingSkins.has(id));
      } else {
        pool = [...byRarity.map(s => s.SkinID).filter(id => !existingSkins.has(id))];
      }

      function pickUniqueFromPool(n) {
        const chosen = [];
        const tempPool = [...pool];
        for (let i = 0; i < n && tempPool.length > 0; i++) {
          const idx = Math.floor(Math.random() * tempPool.length);
          const id = tempPool.splice(idx, 1)[0];
          chosen.push(id);
        }
        return chosen;
      }

      // Fill with unique picks first
      picks.push(...pickUniqueFromPool(totalCount));
      let remaining = totalCount - picks.length;
      // If need more, fill with random from visual list (with replacement) or byRarity
      while (remaining > 0) {
        if (visualSkinIds.length > 0) {
          const idx = Math.floor(Math.random() * visualSkinIds.length);
          picks.push(visualSkinIds[idx]);
        } else if (byRarity.length > 0) {
          const idx = Math.floor(Math.random() * byRarity.length);
          picks.push(byRarity[idx].SkinID);
        } else {
          break;
        }
        remaining--;
      }

      if (picks.length === 0) {
        if (visualSkinIds.length > 0) {
          for (let i = 0; i < totalCount; i++) {
            const idx = Math.floor(Math.random() * visualSkinIds.length);
            picks.push(visualSkinIds[idx]);
          }
        } else if (byRarity.length > 0) {
          for (let i = 0; i < totalCount; i++) {
            const idx = Math.floor(Math.random() * byRarity.length);
            picks.push(byRarity[idx].SkinID);
          }
        }
      }

      const hadSkins = new Set((user.skins || []).map(s => s));
      for (const skinId of picks) {
        let duplicateCurrency = null;
        let duplicateCurrencyAmount = 0;
        if (hadSkins.has(skinId)) {
          duplicateCurrency = 'dust';
          duplicateCurrencyAmount = 5;
        } else {
          await UserModel.addSkin(user.stumbleId, skinId);
          hadSkins.add(skinId);
        }
        const noVisual = !(spinOffer && visualSkinIds.length > 0);
        const typeInfoForSpin = noVisual ? rarity.toUpperCase() : skinId;
        const rewardDoc = noVisual ? {
          Amount: 1,
          DuplicateCurrency: null,
          DuplicateCurrencyAmount: 0,
          NestedRewards: [{
            Amount: 1,
            DuplicateCurrency: duplicateCurrency,
            DuplicateCurrencyAmount: duplicateCurrencyAmount,
            NestedRewards: [],
            Type: 'SKIN',
            TypeInfo: skinId
          }],
          Type: 'LOOTBOX',
          TypeInfo: typeInfoForSpin
        } : {
          Amount: 1,
          DuplicateCurrency: duplicateCurrency,
          DuplicateCurrencyAmount: duplicateCurrencyAmount,
          NestedRewards: [],
          Type: 'SKIN',
          TypeInfo: typeInfoForSpin
        };
        await database.collections.Users.updateOne(
          { stumbleId: user.stumbleId },
          { $push: { Rewards: rewardDoc } }
        );
        Console.log('Economy', `purchaseDrop reward pushed type=${noVisual ? 'LOOTBOX' : 'SKIN'} typeInfo=${typeInfoForSpin} nested=${noVisual ? skinId : 'none'}`);
      }

      const updatedUser = await UserModel.findByStumbleId(user.stumbleId);

      const battlePassEnd = updatedUser.battlePass?.secondsToEnd
        ? new Date(Date.now() + (updatedUser.battlePass.secondsToEnd * 1000))
        : new Date();

      const mapBalances = (balances = []) => balances.map(b => ({
        Amount: b.amount || 0,
        LastGiven: (b.lastGiven instanceof Date ? b.lastGiven.toISOString() : new Date(b.lastGiven || Date.now()).toISOString()),
        MaxAmount: b.maxAmount || 0,
        Name: b.name,
        SecondsPerUnit: b.secondsPerUnit || 0,
        SecondsSince: b.secondsSince || 0
      }));

      const settings = {
        FriendIsOnlinePush: true,
        InvitedToPartyPush: true,
        PartyInviteInGameToastNotification: true,
        PartyInviteToastNotification: true
      };

      const userPayload = {
        Age: updatedUser.age || 0,
        Animations: updatedUser.animations || [],
        AvailableNewsVersion: updatedUser.availableNewsVersion || 0,
        Balances: mapBalances(updatedUser.balances || []),
        BanReason: '',
        BattlePass: {
          FreePassRewards: updatedUser.battlePass?.freePassRewards || [],
          HasPurchased: !!updatedUser.battlePass?.hasPurchased,
          PassID: updatedUser.battlePass?.passID || 0,
          PassTokens: updatedUser.battlePass?.passTokens || 0,
          PremiumPassRewards: updatedUser.battlePass?.premiumPassRewards || [],
          SecondsToEnd: updatedUser.battlePass?.secondsToEnd || 0,
          endTime: battlePassEnd.toISOString()
        },
        Country: updatedUser.country || 'BR',
        Created: updatedUser.creationDate ? updatedUser.creationDate.toISOString() : new Date().toISOString(),
        Crowns: updatedUser.crowns || 0,
        DeviceId: updatedUser.deviceId,
        Emotes: updatedUser.emotes || [],
        Experience: updatedUser.experience || 0,
        Footsteps: updatedUser.footsteps || [],
        FreePassRewards: updatedUser.freePassRewards || [],
        HasBattlePass: !!updatedUser.hasBattlePass,
        HiddenRating: updatedUser.hiddenRating || 0,
        Id: updatedUser.id || 0,
        Inventory: (updatedUser.inventory || []).map(i => ({ Amount: i.amount || 0, Item: i.item, ItemType: i.itemType })),
        IsBanned: !!updatedUser.isBanned,
        KidFriendlyMode: updatedUser.kidFriendlyMode || 0,
        LastLogin: updatedUser.lastLogin ? updatedUser.lastLogin.toISOString() : new Date().toISOString(),
        LastLuckySpin: updatedUser.lastLuckySpin ? updatedUser.lastLuckySpin.toISOString() : new Date(Date.now() - 86400000).toISOString(),
        LatestNewsIdBackend: updatedUser.latestNewsIdBackend || 0,
        MyOwnCode: updatedUser.MyOwnCode || '',
        NewsVersion: updatedUser.newsVersion || 0,
        PassTokens: updatedUser.passTokens || 0,
        PremiumPassRewards: updatedUser.premiumPassRewards || [],
        Region: updatedUser.region || 'SA',
        RewardID: 'deprecated',
        Rewards: updatedUser.Rewards || [],
        SecondsSinceCreated: updatedUser.secondsSinceCreated || 0,
        SelectedSkin: updatedUser.equippedCosmetics?.skin || 'SKIN1',
        Settings: settings,
        SkillRating: updatedUser.skillRating || 0,
        Skins: updatedUser.skins || [],
        StumbleId: updatedUser.stumbleId,
        Token: updatedUser.token,
        Username: updatedUser.username,
        Version: updatedUser.version || '0'
      };

      const featureFlagsWorking = [
        'age-request',
        'Consensus',
        'CustomParty',
        'EndOfMatchRewardedVideo',
        'GamePlayInGameNotifications',
        'HelpshiftConversation',
        'LocalNotifications',
        'MatchmakingFilter',
        'NewMatchmaking',
        'Pusher',
        'TournamentsX',
        'TournamentsXMeta',
        'QuantumSystemManagement',
        'RemoteLocalizations',
        'RoomManagementConsole',
        'TransferAppleIdAuthorization'
      ];

      const response = {
        FeatureFlags: featureFlagsWorking,
        PhotonJwt: photonJwt,
        TermsOfServiceAccepted: true,
        Timestamp: new Date().toISOString(),
        User: userPayload
      };

      Console.log('Economy', `purchaseDrop done: user=${user.stumbleId} picks=${picks.length}`);
      const wantsCompression = String(req.headers['use_response_compression'] || '').toLowerCase() === 'true' && String(req.headers['accept-encoding'] || '').includes('gzip');
      if (wantsCompression) {
        const buf = zlib.gzipSync(Buffer.from(JSON.stringify(response)));
        res.set('Content-Encoding', 'gzip');
        res.set('Content-Type', 'application/json');
        return res.status(200).send(buf);
      }
      return res.status(200).json({ User: userPayload });
    } catch (err) {
      Console.error('Economy', 'PurchaseDrop error:', err);
      res.status(500).json({ error: 'INTERNAL_SERVER_ERROR' });
    }
  }

  static async giveCurrency(req, res) {
    try {
      const { currencyType, amount } = req.params;
      const { user } = req;
      Console.log('Economy', `giveCurrency start: user=${user.stumbleId} type=${currencyType} amount=${amount}`);

      const currencyMap = {
        Gems: 'gems',
        Gold: 'coins',
        Dust: 'dust',
        FreeSpins: 'default_free_spins',
        AdSpins: 'default_free_ad_spins'
      };

      const resolvedCurrency = currencyMap[currencyType] || currencyType;
      const userBalanceNames = (user.balances || []).map(b => b.name);
      const isKnownCurrency = userBalanceNames.includes(resolvedCurrency);
      if (!isKnownCurrency) {
        return res.status(400).json({ error: 'INVALID_CURRENCY' });
      }

      const parsedAmount = parseInt(amount);
      if (isNaN(parsedAmount)) {
        return res.status(400).json({ error: 'INVALID_AMOUNT' });
      }

      await UserModel.addBalance(user.deviceId, resolvedCurrency, parsedAmount);
      const updatedUser = await UserModel.findByStumbleId(user.stumbleId);

      Console.log('Economy', `giveCurrency done: user=${user.stumbleId} type=${resolvedCurrency} amount=${parsedAmount}`);
      res.json({
        success: true,
        user: updatedUser,
        currencyAdded: { type: resolvedCurrency, amount: parsedAmount }
      });
    } catch (err) {
      Console.error('Economy', 'GiveCurrency error:', err);
      res.status(500).json({ error: 'INTERNAL_SERVER_ERROR' });
    }
  }
}


class AnalyticsController {
  static async analytic(req, res) {
    try {
      const { user } = req;
      const { type, message } = req.body;

      if (!type || !message) {
        return res.status(400).json({ message: 'Type and message are required' });
      }

      await database.collections.Analytics.insertOne({
        DeviceId: user.deviceId,
        type,
        message,
        timestamp: new Date()
      });
      Console.log("Analytics", `Received analytic from user ${user.username}: [${type}] ${message}`);
      res.status(200).json("OK");
    } catch (err) {
      Console.error("Analytics", "Error:", err);
      res.status(500).json("Error");
    }
  }
}

class FriendsController {
  static async add(req, res) {
    try {
      const { UserId } = req.body;
      const { user } = req;

      if (!UserId) return res.status(400).json({ message: 'UserId is required' });

      const friend = await UserModel.findById(UserId);
      if (!friend) return res.status(404).json({ message: 'User not found' });

      if (user.friends.includes(friend.stumbleId)) {
        return res.status(409).json({ message: 'Already friends' });
      }

      await database.collections.Users.updateOne(
        { stumbleId: user.stumbleId },
        { $addToSet: { friends: friend.stumbleId } }
      );

      await database.collections.Users.updateOne(
        { stumbleId: friend.stumbleId },
        { $addToSet: { friends: user.stumbleId } }
      );

      const updatedUser = await UserModel.findByStumbleId(user.stumbleId);
      return res.status(200).json(updatedUser.userProfile);
    } catch (err) {
      console.error('Friends Add error:', err);
      return res.status(500).json({ message: 'Internal server error' });
    }
  }

  static async request(req, res) {
    try {
      const { UserId } = req.body;
      const { user } = req;

      if (!UserId) return res.status(400).json({ message: 'UserId is required' });

      const toUser = await UserModel.findById(UserId);
      if (!toUser) return res.status(404).json({ message: 'User not found' });

      if (user.sentFriendRequests.includes(toUser.stumbleId)) {
        return res.status(409).json({ message: 'Request already sent' });
      }

      await database.collections.Users.updateOne(
        { stumbleId: user.stumbleId },
        { $addToSet: { sentFriendRequests: toUser.stumbleId } }
      );

      await database.collections.Users.updateOne(
        { stumbleId: toUser.stumbleId },
        { $addToSet: { receivedFriendRequests: user.stumbleId } }
      );

      const updatedUser = await UserModel.findByStumbleId(user.stumbleId);
      return res.status(200).json(updatedUser.userProfile);
    } catch (err) {
      console.error('Friends Request error:', err);
      return res.status(500).json({ message: 'Internal server error' });
    }
  }

  static async accept(req, res) {
    try {
      const { UserId } = req.body;
      const { user } = req;

      if (!UserId) return res.status(400).json({ message: 'UserId is required' });

      const fromUser = await UserModel.findById(UserId);
      if (!fromUser) return res.status(404).json({ message: 'User not found' });

      if (!user.receivedFriendRequests.includes(fromUser.stumbleId)) {
        return res.status(404).json({ message: 'No friend request found' });
      }

      await database.collections.Users.updateOne(
        { stumbleId: user.stumbleId },
        {
          $pull: { receivedFriendRequests: fromUser.stumbleId },
          $addToSet: { friends: fromUser.stumbleId }
        }
      );

      await database.collections.Users.updateOne(
        { stumbleId: fromUser.stumbleId },
        {
          $pull: { sentFriendRequests: user.stumbleId },
          $addToSet: { friends: user.stumbleId }
        }
      );

      const updatedUser = await UserModel.findByStumbleId(user.stumbleId);
      return res.status(200).json(updatedUser.userProfile);
    } catch (err) {
      console.error('Friends Accept error:', err);
      return res.status(500).json({ message: 'Internal server error' });
    }
  }

  static async reject(req, res) {
    try {
      const { UserId } = req.body;
      const { user } = req;

      if (!UserId) return res.status(400).json({ message: 'UserId is required' });

      const fromUser = await UserModel.findById(UserId);
      if (!fromUser) return res.status(404).json({ message: 'User not found' });

      if (!user.receivedFriendRequests.includes(fromUser.stumbleId)) {
        return res.status(404).json({ message: 'No friend request found' });
      }

      await database.collections.Users.updateOne(
        { stumbleId: user.stumbleId },
        { $pull: { receivedFriendRequests: fromUser.stumbleId } }
      );

      await database.collections.Users.updateOne(
        { stumbleId: fromUser.stumbleId },
        { $pull: { sentFriendRequests: user.stumbleId } }
      );

      const updatedUser = await UserModel.findByStumbleId(user.stumbleId);
      return res.status(200).json(updatedUser.userProfile);
    } catch (err) {
      console.error('Friends Reject error:', err);
      return res.status(500).json({ message: 'Internal server error' });
    }
  }

  static async cancel(req, res) {
    try {
      const { UserId } = req.body;
      const { user } = req;

      if (!UserId) return res.status(400).json({ message: 'UserId is required' });

      const toUser = await UserModel.findById(UserId);
      if (!toUser) return res.status(404).json({ message: 'User not found' });

      if (!user.sentFriendRequests.includes(toUser.stumbleId)) {
        return res.status(404).json({ message: 'No friend request found' });
      }

      await database.collections.Users.updateOne(
        { stumbleId: user.stumbleId },
        { $pull: { sentFriendRequests: toUser.stumbleId } }
      );

      await database.collections.Users.updateOne(
        { stumbleId: toUser.stumbleId },
        { $pull: { receivedFriendRequests: user.stumbleId } }
      );

      const updatedUser = await UserModel.findByStumbleId(user.stumbleId);
      return res.status(200).json(updatedUser.userProfile);
    } catch (err) {
      console.error('Friends Cancel error:', err);
      return res.status(500).json({ message: 'Internal server error' });
    }
  }

static async list(req, res) {
    try {
      const { user } = req;
      const ONLINE_THRESHOLD = 15 * 60 * 1000; // 15 minutos
      const now = new Date();

      const friends = await database.collections.Users.find({
        stumbleId: { $in: user.friends || [] }
      }).project({
        userProfile: 1,
        lastLogin: 1
      }).toArray();

      const friendsWithOnlineStatus = friends.map(f => {
        const lastLogin = f.lastLogin ? new Date(f.lastLogin) : null;
        const isOnline = lastLogin && (now - lastLogin) < ONLINE_THRESHOLD;
        
        return {
          ...f.userProfile,
          isOnline: isOnline
        };
      });

      return res.status(200).json({friends: friendsWithOnlineStatus});
    } catch (err) {
      console.error('Friends List error:', err);
      return res.status(500).json({ message: 'Internal server error' });
    }
  }

  static async pending(req, res) {
    try {
      const { user } = req;

      const pendingUsers = await database.collections.Users.find({
        stumbleId: { $in: user.receivedFriendRequests || [] }
      }).project({
        userProfile: 1
      }).toArray();

      return res.status(200).json(pendingUsers.map(u => u.userProfile));
    } catch (err) {
      Console.error('Friends', 'Friends Pending error:', err);
      return res.status(500).json({ message: 'Internal server error' });
    }
  }

  static async remove(req, res) {
    try {
      const { UserId } = req.params;
      const { user } = req;

      if (!UserId) return res.status(400).json({ message: 'UserId is required' });

      const friend = await UserModel.findById(UserId);
      if (!friend) return res.status(404).json({ message: 'User not found' });

      if (!user.friends.includes(friend.stumbleId)) {
        return res.status(404).json({ message: 'Not friends' });
      }

      await database.collections.Users.updateOne(
        { stumbleId: user.stumbleId },
        { $pull: { friends: friend.stumbleId } }
      );

      await database.collections.Users.updateOne(
        { stumbleId: friend.stumbleId },
        { $pull: { friends: user.stumbleId } }
      );

      const updatedUser = await UserModel.findByStumbleId(user.stumbleId);
      return res.status(200).json(updatedUser.userProfile);
    } catch (err) {
      Console.error('Friends', 'Friends Remove error:', err);
      return res.status(500).json({ message: 'Internal server error' });
    }
  }

  static async search(req, res) {
    try {
      const { UserName } = req.body;

      if (!UserName || UserName.length < 3) {
        Console.log("Friends", `Invalid UserName: ${UserName}`);
        return res.status(400).json({ message: 'UserName must be at least 3 characters' });
      }

      const user = await database.collections.Users.findOne(
        { username: { $regex: UserName, $options: 'i' } },
        { projection: { userProfile: 1 } }
      );

      if (!user) {
        Console.log("Friends", `User not found: ${UserName}`);
        return res.status(404).json({ message: 'User not found' });
      }

      return res.status(200).json(user.userProfile);
    } catch (err) {
      Console.error('Friends', 'Friends Search error:', err);
      return res.status(500).json({ message: 'Internal server error' });
    }
  }
}

class NewsController {

  // GET /news
  static async GetNews(req, res) {
    try {
      const newsList = await database.collections.News
        .find()
        .sort({ timestamp: -1 })
        .toArray();

      const news = newsList.map(news => {
        const ts = news.timestamp;
        const isMs = ts > 9999999999;
        const date = new Date(isMs ? ts : ts * 1000);

        return {
          Header: news.header,
          Message: news.message,
          Date: date.toLocaleString('en-US', {
            timeZone: 'UTC',
            year: 'numeric',
            month: '2-digit',
            day: '2-digit',
            hour: '2-digit',
            minute: '2-digit'
          })
        };
      });

      res.json(news);
    } catch (err) {
      console.error('News Get error:', err);
      res.status(500).json({ message: 'Error fetching news' });
    }
  }

  // POST /news
  static async CreateNews(req, res) {
    try {
      const { header, message } = req.body;

      if (!header || !message) {
        return res.status(400).json({ message: "Header and message required" });
      }

      const news = {
        header,
        message,
        timestamp: Date.now()
      };

      await database.collections.News.insertOne(news);

      res.json({ success: true, news });
    } catch (err) {
      console.error('News Create error:', err);
      res.status(500).json({ message: 'Error creating news' });
    }
  }

}

module.exports = NewsController;

class MissionsController {
  static async getMissions(req, res) {
    try {
      const { user } = req;

      const missions = SharedData.MissionObjectives.map(mission => ({
        missionId: mission.Id,
        missionActive: true,
        rewardsClaimed: false,
        requirementProgressions: mission.Requirements.map(req => ({
          requirementId: req.Id,
          completed: Math.random() > 0.5,
          current: Math.floor(Math.random() * req.Target),
          target: req.Target
        }))
      }));

      res.json({
        missionObjectiveProgressionUpdated: {
          missionObjectiveId: "daily",
          currentPoints: Math.floor(Math.random() * 100),
          milestoneProgressions: SharedData.MissionObjectives
            .find(m => m.Id === "daily")?.Milestones.map(milestone => ({
              milestoneId: milestone.MilestoneId,
              claimed: false
            })) || []
        },
        missionsProgressionsUpdated: missions
      });
    } catch (err) {
      console.error('Missions', 'Get error:', err);
      res.status(500).json({ message: 'Internal server error' });
    }
  }

  static async claimMissionReward(req, res) {
    try {
      const { user } = req;
      const { missionId } = req.params;

      const mission = SharedData.MissionObjectives
        .flatMap(m => m.Requirements.map(r => ({ ...r, missionId: m.Id })))
        .find(m => m.missionId === missionId);

      if (!mission) {
        return res.status(404).json({ message: 'Mission not found' });
      }

      const rewards = mission.Rewards || [];
      for (const reward of rewards) {
        if (reward.type === 'CURRENCY') {
          await UserModel.addBalance(user.deviceId, reward.typeInfo, reward.amount);
        }
      }

      const updatedUser = await UserModel.findByDeviceId(user.deviceId);
      res.json({
        User: updatedUser,
        Rewards: rewards,
        message: 'Rewards claimed successfully'
      });
    } catch (err) {
      console.error('Missions', 'Claim error:', err);
      res.status(500).json({ message: 'Internal server error' });
    }
  }

  static async claimMilestoneReward(req, res) {
    try {
      const { user } = req;
      const { objectiveId, milestoneId } = req.params;

      const objective = SharedData.MissionObjectives.find(m => m.Id === objectiveId);
      if (!objective) {
        return res.status(404).json({ message: 'Objective not found' });
      }

      const milestone = objective.Milestones.find(m => m.MilestoneId === milestoneId);
      if (!milestone) {
        return res.status(404).json({ message: 'Milestone not found' });
      }

      const rewards = milestone.Rewards || [];
      for (const reward of rewards) {
        if (reward.type === 'CURRENCY') {
          await UserModel.addBalance(user.deviceId, reward.typeInfo, reward.amount);
        }
      }

      const updatedUser = await UserModel.findByDeviceId(user.deviceId);
      res.json({
        User: updatedUser,
        Rewards: rewards,
        message: 'Milestone rewards claimed successfully'
      });
    } catch (err) {
      console.error('Missions', 'Claim milestone error:', err);
      res.status(500).json({ message: 'Internal server error' });
    }
  }
}

class TournamentXController {
  static tournaments = [
    {
      id: 1,
      type: 1,
      isEnabled: true,
      minVersion: "0.64",
      startTime: new Date(),
      endTime: new Date(Date.now() + 5 * 365 * 24 * 60 * 60 * 1000),
      nameKey: "StumbleLuna BDL 1x1",
      descriptionKey: "Compete in free-for-all matches, be the last one standing to win!",
      listItemBackgroundImage: "STPBlockDash_Background_Image_Tournaments_Card",
      detailsPanelBackgroundImage: "STPBlockDash_Background_Image_Tournaments",
prizeBannerColour: "#4FC3FF",
headerColour: "#6FD0FF",
mapListGradientColourTop: "#8BDFFF",
mapListGradientColourBottom: "#3BA8FF",
      listPriority: 1,
      minPlayers: 2,
      maxPlayers: 2,
      maxRounds: 1,
      minMatchmakingSeconds: 5,
      entryCurrencyType: "gems",
      entryCurrencyCost: 50,
      entryCurrencyType2: "dust",
      entryCurrencyCost2: 1,
      areEmotesRestricted: true,
      prohibitedEmotes: [2, 4, 5, 6],
detailsPanelBorderColourTop: "#6FD0FF",
detailsPanelBorderColourBottom: "#3BA8FF",
colourData: {
  detailsPanelMainColour: "#4FC3FF",
  detailsPanelBorderColour: "#6FD0FF",
  headerGradientRight: "#4FC3FF",
  headerGradientLeft: "#6FD0FF",
  infoWidgetsGradientRight: "#4FC3FF",
  infoWidgetsGradientLeft: "#3BA8FF",
  infoWidgetsBorderColour: "#6FD0FF"
},

      rounds: [
        {
          roundOrder: 1,
          maxPlayersToProgress: 1,
          minPlayersPerMatch: 2,
          maxPlayersPerMatch: 5,
          areLevelsRestricted: true,
          permittedLevels: ["eventlevel13_block_legendary"]
        }
      ],
      awards: [
        {
          placementRangeLowest: 1,
          placementRangeHighest: 1,
          awardId: 4,
          type: "CURRENCY",
          amount: 500,
          awardJson: { name: "gems" }
        },
        {
          placementRangeLowest: 1,
          placementRangeHighest: 1,
          awardId: 2,
          type: "CURRENCY", 
          amount: 15,
          awardJson: { name: "trophies" }
        }
      ]
    },
    {
      id: 2,
      type: 1,
      isEnabled: true,
      minVersion: "0.56",
      startTime: new Date(),
      endTime: new Date(Date.now() + 5 * 365 * 24 * 60 * 60 * 1000),
      nameKey: "StumbleLuna Block Dash 1x1",
      descriptionKey: "Fast 1v1 duels. Pure skill. Only victory.",
      listItemBackgroundImage: "Punchapalooza_Background_Image_Tournaments_Card",
      detailsPanelBackgroundImage: "Punchapalooza_Background_Image_Tournaments",
prizeBannerColour: "#328bffff",
headerColour: "#328bffff",
mapListGradientColourTop: "#328bffff",
mapListGradientColourBottom: "#328bffff",
      listPriority: 2,
      minPlayers: 2,
      maxPlayers: 2,
      maxRounds: 1,
      minMatchmakingSeconds: 10,
      entryCurrencyType: "gems",
      entryCurrencyCost: 50,
      entryCurrencyType2: "tournament_ticket_legendary",
      entryCurrencyCost2: 1,
      areEmotesRestricted: true,
      prohibitedEmotes: [2, 4, 5, 6],
detailsPanelBorderColourTop: "#328bffff",
detailsPanelBorderColourBottom: "#328bffff",
colourData: {
  detailsPanelMainColour: "#328bffff",
  detailsPanelBorderColour: "#328bffff",
  headerGradientRight: "#328bffff",
  headerGradientLeft: "#328bffff",
  infoWidgetsGradientRight: "#328bfffff",
  infoWidgetsGradientLeft: "#328bffff",
  infoWidgetsBorderColour: "#328bffff"
},

      rounds: [
        {
          roundOrder: 1,
          maxPlayersToProgress: 1,
          minPlayersPerMatch: 2,
          maxPlayersPerMatch: 5,
          areLevelsRestricted: true,
          permittedLevels: ["level19_block"]
        }
      ],
      awards: [
        {
          placementRangeLowest: 1,
          placementRangeHighest: 1,
          awardId: 4,
          type: "CURRENCY",
          amount: 450,
          awardJson: { name: "gems" }
        },
        {
          placementRangeLowest: 1,
          placementRangeHighest: 1,
          awardId: 2,
          type: "CURRENCY",
          amount: 50,
          awardJson: { name: "trophies" }
        },
        {
          placementRangeLowest: 1,
          placementRangeHighest: 1,
          awardId: 3,
          type: "CURRENCY",
          amount: 5,
          awardJson: { name: "crowns" }
        }
      ]
    },
    {
      id: 54,
      type: 1,
      isEnabled: true,
      minVersion: "0.56",
      startTime: new Date(),
      endTime: new Date(Date.now() + 5 * 365 * 24 * 60 * 60 * 1000),
      nameKey: "StumbleLuna Rush Hour 1x1",
      descriptionKey: "Win, Farps and be the best",
      listItemBackgroundImage: "IceSki_Background_Image_Tournaments_Card",
      detailsPanelBackgroundImage: "IceSki_Background_Image_Tournaments",
prizeBannerColour: "#29ffdb3b",
headerColour: "#32ffd3ff",
mapListGradientColourTop: "#5bffb2ff",
mapListGradientColourBottom: "#3cffffff",
      listPriority: 2,
      minPlayers: 2,
      maxPlayers: 2,
      maxRounds: 1,
      minMatchmakingSeconds: 10,
      entryCurrencyType: "gems",
      entryCurrencyCost: 50,
      entryCurrencyType2: "tournament_ticket_legendary",
      entryCurrencyCost2: 1,
      areEmotesRestricted: true,
      prohibitedEmotes: [1, 2, 3, 4, 6, 7, 8, 9, 10],
detailsPanelBorderColourTop: "#6EC9FF",
detailsPanelBorderColourBottom: "#3DA6FF",
colourData: {
  detailsPanelMainColour: "#55BFFF",
  detailsPanelBorderColour: "#66CCFF",
  headerGradientRight: "#3DA6FF",
  headerGradientLeft: "#8ED8FF",
  infoWidgetsGradientRight: "#4BB7FF",
  infoWidgetsGradientLeft: "#9BE1FF",
  infoWidgetsBorderColour: "#8ED8FF"
},
      rounds: [
        {
          roundOrder: 1,
          maxPlayersToProgress: 1,
          minPlayersPerMatch: 2,
          maxPlayersPerMatch: 2,
          areLevelsRestricted: true,
          permittedLevels: ["level24_streamtiles"]
        }
      ],
      awards: [
        {
          placementRangeLowest: 1,
          placementRangeHighest: 1,
          awardId: 4,
          type: "CURRENCY",
          amount: 400,
          awardJson: { name: "gems" }
        },
        {
          placementRangeLowest: 1,
          placementRangeHighest: 1,
          awardId: 2,
          type: "CURRENCY",
          amount: 50,
          awardJson: { name: "trophies" }
        },
        {
          placementRangeLowest: 1,
          placementRangeHighest: 1,
          awardId: 3,
          type: "CURRENCY",
          amount: 5,
          awardJson: { name: "crowns" }
        }
      ]
    }
  ];

  static seasons = [
    {
      awards: [
        { amount: 1, awardId: 1, awardJson: { id: "SKIN330" }, type: "SKIN", xp: 5 },
        { amount: 100, awardId: 2, awardJson: { name: "gems" }, type: "CURRENCY", xp: 10 },
        { amount: 1, awardId: 3, awardJson: { id: "SKIN438" }, type: "SKIN", xp: 15 },
        { amount: 1, awardId: 4, awardJson: { id: "Emote047_XmasSkull" }, type: "EMOTE", xp: 20 },
        { amount: 50, awardId: 5, awardJson: { name: "dust" }, type: "CURRENCY", xp: 25 },
        { amount: 1, awardId: 6, awardJson: { id: "emote_thumb" }, type: "EMOTE", xp: 30 },
        { amount: 50, awardId: 7, awardJson: { name: "dusy" }, type: "CURRENCY", xp: 35 },
        { amount: 1, awardId: 8, awardJson: { id: "SKIN210" }, type: "SKIN", xp: 40 },
        { amount: 1, awardId: 9, awardJson: { id: "Emote060_HoldingTears" }, type: "EMOTE", xp: 45 },
        { amount: 1, awardId: 10, awardJson: { id: "SKIN123" }, type: "SKIN", xp: 50 },
        { amount: 20, awardId: 11, awardJson: { name: "gems" }, type: "CURRENCY", xp: 55 },
        { amount: 1, awardId: 12, awardJson: { id: "Emote032_RedCard" }, type: "EMOTE", xp: 60 },
        { amount: 50, awardId: 13, awardJson: { name: "dust" }, type: "CURRENCY", xp: 65 },
        { amount: 1, awardId: 14, awardJson: { id: "SKIN148" }, type: "SKIN", xp: 70 },
        { amount: 1, awardId: 15, awardJson: { id: "emote_dab" }, type: "EMOTE", xp: 75 },
        { amount: 75, awardId: 16, awardJson: { name: "dust" }, type: "CURRENCY", xp: 80 },
        { amount: 20, awardId: 17, awardJson: { name: "gems" }, type: "CURRENCY", xp: 85 },
        { amount: 1, awardId: 18, awardJson: { id: "emote_go" }, type: "EMOTE", xp: 90 },
        { amount: 50, awardId: 19, awardJson: { name: "dust" }, type: "CURRENCY", xp: 95 },
        { amount: 1, awardId: 20, awardJson: { id: "SKIN365" }, type: "SKIN", xp: 100 },
        { amount: 10, awardId: 21, awardJson: { name: "gems" }, type: "CURRENCY", xp: 105 },
        { amount: 50, awardId: 22, awardJson: { name: "gems" }, type: "CURRENCY", xp: 110 },
        { amount: 1, awardId: 23, awardJson: { id: "emote_skull" }, type: "EMOTE", xp: 115 },
        { amount: 1, awardId: 24, awardJson: { id: "SKIN195" }, type: "SKIN", xp: 120 },
        { amount: 50, awardId: 25, awardJson: { name: "dust" }, type: "CURRENCY", xp: 125 },
        { amount: 20, awardId: 26, awardJson: { name: "gems" }, type: "CURRENCY", xp: 130 },
        { amount: 1, awardId: 27, awardJson: { id: "SKIN51" }, type: "SKIN", xp: 135 },
        { amount: 1, awardId: 28, awardJson: { id: "Emote057_PartyPop" }, type: "EMOTE", xp: 140 },
        { amount: 50, awardId: 29, awardJson: { name: "dust" }, type: "CURRENCY", xp: 145 },
        { amount: 1, awardId: 30, awardJson: { id: "SKIN444" }, type: "SKIN", xp: 150 },
        { amount: 1, awardId: 999, awardJson: { id: "SKIN375" }, type: "SKIN", xp: 999 }
      ],
      backgroundImageKey: "",
      descriptionKey: "",
      endTime: "2026-04-03T10:00:00",
      id: 1,
      isEnabled: true,
      nameKey: "TOURNAMENTS",
      claimSeasonReward: true,
      startTime: "2024-03-06T10:00:00"
    }
  ];

  static getSeasons(req, res) {
    try {
      res.status(200).json(TournamentXController.seasons);
    } catch (err) {
      res.status(500).json({ message: "erro interno" });
    }
  }

  static generateEncryptedEntry(partyData, userData) {
    const dataToEncrypt = {
      partyId: partyData.partyId,
      tournamentId: partyData.tournamentId,
      userId: userData.id,
      stumbleId: userData.stumbleId,
      username: userData.username,
      timestamp: Date.now(),
      players: partyData.players.map(p => ({
        stumbleId: p.stumbleId,
        username: p.username
      }))
    };

    const jsonString = JSON.stringify(dataToEncrypt);
    return CryptoUtils.Encrypt(jsonString);
  }

  static  getActive(req, res) {
    try {
      const now = new Date();
      res.status(200).json({ AreAdditionalTournamentsVersionRestricted: false, UserActiveTournaments: TournamentXController.tournaments });
    } catch (err) {
      console.error("erro:", err);
      res.status(500).json({ message: "erro interno" });
    }
  }

  static async join(req, res) {
    try {
      const { user } = req;
      const tournamentId = parseInt(req.params.tournamentId);
      const tournament = TournamentXController.tournaments.find(t => t.id === tournamentId);

      if (!tournament) {
        Console.log("CoreArena", `Tournament not found: ${tournamentId}`);
        return res.status(404).json({ message: "torneio nao encontrado" });
      }
      if (!tournament.isEnabled) {
        Console.log("CoreArena", `Tournament disabled: ${tournamentId}`);
        return res.status(400).json({ message: "torneio desativado" });
      }

      const now = new Date();
      if (now < tournament.startTime || now > tournament.endTime) {
        Console.log("CoreArena", `Tournament not active: ${tournamentId}`);
        return res.status(400).json({ message: "torneio nao esta ativo no momento" });
      }

      if (tournament.entryCurrencyCost > 0) {
        const userBalance = UserModel.getBalanceAmount(user, tournament.entryCurrencyType);
        if (userBalance < tournament.entryCurrencyCost) {
          Console.log("CoreArena", `Insufficient balance for user ${user.username} to join tournament ${tournamentId}`);
          return res.status(400).json({
            message: `saldo insuficiente de ${tournament.entryCurrencyType}`
          });
        }
        await UserModel.removeBalance(user.deviceId, tournament.entryCurrencyType, tournament.entryCurrencyCost);
      }

      const existingParty = await database.collections.Parties.findOne({
        tournamentId: tournament.id,
        "players.stumbleId": user.stumbleId
      });

      if (existingParty) {
        await database.collections.Parties.deleteOne({ partyId: existingParty.partyId });
      }

      let availableParty = await database.collections.Parties.findOne({
        tournamentId: tournament.id,
        $expr: { $lt: [{ $size: "$players" }, 5] },
        status: "waiting"
      });

      if (!availableParty) {
        availableParty = {
          partyId: Math.floor(111, 999),
          tournamentId: tournament.id,
          tournamentName: tournament.nameKey,
          players: [],
          status: "waiting",
          createdAt: new Date(),
          maxPlayers: 5
        };
        await database.collections.Parties.insertOne(availableParty);
      }

      const playerData = {
        stumbleId: user.stumbleId,
        userId: user.id,
        username: user.username,
        joinedAt: new Date()
      };

      await database.collections.Parties.updateOne(
        { partyId: availableParty.partyId },
        { $push: { players: playerData } }
      );

      const updatedParty = await database.collections.Parties.findOne({ partyId: availableParty.partyId });

      if (updatedParty.players.length >= 2) {
        await database.collections.Parties.updateOne(
          { partyId: availableParty.partyId },
          { $set: { status: "full" } }
        );
      }

      const encryptedEntry = TournamentXController.generateEncryptedEntry(updatedParty, user);

      Console.log("PitArena", `User ${user.username} is joining tournament ${tournamentId} in party ${availableParty.partyId}`);
      const response = {
        entryToken: tournamentId + Date.now().toString() + Math.floor(1000, 9999).toString(),
        MatchmakerTag: availableParty.partyId,
        requestId: user.stumbleId
      };
     Console.log("PitArena", `User ${user.username} joined tournament ${tournamentId} in party ${availableParty.partyId}`);
      res.status(200).json(response);
    } catch (err) {
      console.error(err);
      res.status(500).json({ message: "erro interno do servidor" });
    }
  }

  static async leave(req, res) {
    try {
      const { user } = req;
      const tournamentId = parseInt(req.params.tournamentId);

      const party = await database.collections.Parties.findOne({
        tournamentId: tournamentId,
        "players.stumbleId": user.stumbleId
      });

      if (party) {
        await database.collections.Parties.deleteOne({ partyId: party.partyId });
      }

      const tournament = TournamentXController.tournaments.find(t => t.id === tournamentId);
      if (tournament && tournament.entryCurrencyCost > 0) {
        await UserModel.addBalance(user.deviceId, tournament.entryCurrencyType, tournament.entryCurrencyCost);
      }
      Console.log("PitArena", `User ${user.username} left tournament ${tournamentId}`);
      res.status(200).json({ message: "left" });
    } catch (err) {
      Console.error(err);
      res.status(500).json({ message: "internal server error" });
    }
  }

  static async finish(req, res) {
  try {
    const { Round, TournamentId, EntryToken, SignedPayload } = req.body;
    const { user } = req;

    if (typeof Round === 'undefined') {
      return res.status(400).json({ mensagem: "precisa do round" });
    }

    if (!user || !user.stumbleId || !user.userProfile) {
      return res.status(400).json({ mensagem: "user invalido" });
    }

    const roundResult = parseInt(Round);
    if (isNaN(roundResult)) {
      return res.status(400).json({ mensagem: "round invalido" });
    }

    let gemsChange = 0;
    let crownsChange = 0;
    let pointsChange = 0;

    if (roundResult === 1) {
      gemsChange = 100;
      crownsChange = 1;
      pointsChange = 10;
    } else if (roundResult === 0) {
      crownsChange = -1;
      pointsChange = -10;
    }

    const currentCrowns = parseInt(user.userProfile.crowns) || 0;
    const currentTrophies = parseInt(user.userProfile.trophies) || 0;
    const currentSkill = parseInt(user.skillRating) || 0;

    const updatedUserProfile = {
      ...user.userProfile,
      crowns: Math.max(0, currentCrowns + crownsChange),
      trophies: Math.max(0, currentTrophies + pointsChange)
    };

    await UserModel.update(user.stumbleId, {
      crowns: Math.max(0, currentCrowns + crownsChange),
      skillRating: Math.max(0, currentSkill + pointsChange),
      userProfile: updatedUserProfile
    });

    if (gemsChange > 0) {
      await UserModel.addBalance(user.deviceId, "gems", gemsChange);
    }

    // ⭐ XP DA SEASON (SÓ SE GANHAR)
    if (roundResult === 1) {
      const seasonId = 1;

      const foundUser = await UserModel.findByStumbleId(user.stumbleId);

      let userSeasonData = foundUser.tournamentSeasons?.find(
        s => s.seasonId === seasonId
      );

      if (!userSeasonData) {
        userSeasonData = {
          seasonId: seasonId,
          xp: 0,
          claimedAwards: []
        };

        if (!foundUser.tournamentSeasons) {
          foundUser.tournamentSeasons = [userSeasonData];
        } else {
          foundUser.tournamentSeasons.push(userSeasonData);
        }
      }

      userSeasonData.xp += 1;

      await UserModel.update(user.stumbleId, {
        tournamentSeasons: foundUser.tournamentSeasons.map(s =>
          s.seasonId === seasonId ? userSeasonData : s
        )
      });
    }

    const updatedUser = await UserModel.findByStumbleId(user.stumbleId);

    console.log("Finalizei o round do " + user.username);

    res.status(200).json({
      TournamentId,
      Round: roundResult,
      EntryToken,
      SignedPayload,
      CollectedCurrencies: gemsChange > 0 ? ["gems", gemsChange] : [],
      User: updatedUser
    });

  } catch (err) {
    console.error("erro ao finalizar round de tourx:", err);
    res.status(500).json({ mensagem: "erro interno do servidor" });
  }
}

static async getSeasonProgress(req, res) {
    try {
      const { seasonId } = req.params;
      const { user } = req;

      const foundUser = await UserModel.findByStumbleId(user.stumbleId);

      if (!foundUser) {
        return res.status(404).json("putz vc n existe");
      }

      let userSeasonData = foundUser.tournamentSeasons?.find(season =>
        season.seasonId === parseInt(seasonId)
      );

      if (!userSeasonData) {
        userSeasonData = {
          seasonId: parseInt(seasonId),
          xp: 0,
          claimedAwards: []
        };

        if (!foundUser.tournamentSeasons) {
          foundUser.tournamentSeasons = [userSeasonData];
        } else {
          foundUser.tournamentSeasons.push(userSeasonData);
        }

        await UserModel.update(user.stumbleId, {
          tournamentSeasons: foundUser.tournamentSeasons
        });
      }

      const seasonProgress = {
        seasonId: parseInt(seasonId),
        userId: foundUser.id,
        xp: userSeasonData.xp,
        claimedAwards: userSeasonData.claimedAwards
      };

      res.status(200).json(seasonProgress);

    } catch (err) {
      Console.error('Tournament', 'Get season progress error:', err);
      res.status(500).json({ message: 'Internal server error' });
    }
  }

  static async claimSeasonReward(req, res) {
    try {
      const { seasonId, awardId } = req.params;
      const { user } = req;

      const foundUser = await UserModel.findByStumbleId(user.stumbleId);
      if (!foundUser) {
        return res.status(404).json({ message: "User not found" });
      }

      const season = TournamentXController.seasons.find(s => s.id === parseInt(seasonId));
      if (!season) {
        return res.status(404).json({ message: "Season not found" });
      }

      const award = season.awards.find(a => a.awardId === parseInt(awardId));
      if (!award) {
        return res.status(404).json({ message: "Award not found" });
      }

      let userSeasonData = foundUser.tournamentSeasons?.find(s => s.seasonId === parseInt(seasonId));

      if (!userSeasonData) {
        userSeasonData = {
          seasonId: parseInt(seasonId),
          xp: 0,
          claimedAwards: []
        };

        if (!foundUser.tournamentSeasons) {
          foundUser.tournamentSeasons = [userSeasonData];
        } else {
          foundUser.tournamentSeasons.push(userSeasonData);
        }

        await UserModel.update(user.stumbleId, {
          tournamentSeasons: foundUser.tournamentSeasons
        });
      }

      if (userSeasonData.xp < award.xp) {
        return res.status(400).json({ message: "Insufficient XP to claim this award" });
      }

      if (userSeasonData.claimedAwards.includes(parseInt(awardId))) {
        return res.status(400).json({ message: "Award already claimed" });
      }

      let rewards = [];

      if (award.type === "CURRENCY") {
        const currencyName = award.awardJson.name;
        const currencyReward = {
          amount: award.amount,
          duplicateCurrencyAmount: 0,
          nestedRewards: [],
          sourceType: "TOURNAMENT_SEASON",
          type: "CURRENCY",
          typeInfo: currencyName
        };
        rewards.push(currencyReward);
        await UserModel.addBalance(foundUser.deviceId, currencyName, award.amount);
      } else if (award.type === "SKIN") {
        const skinId = award.awardJson.id;
        const wheelReward = {
          amount: 1,
          duplicateCurrencyAmount: 0,
          nestedRewards: [
            {
              amount: 1,
              duplicateCurrencyAmount: 0,
              nestedRewards: [],
              sourceType: "UNKNOWN",
              type: "SKIN",
              typeInfo: skinId
            }
          ],
          sourceType: "TOURNAMENT_SEASON",
          type: "WHEEL",
          typeInfo: "TOURNAMENT_SEASON_WHEEL"
        };
        rewards.push(wheelReward);
        await UserModel.addSkin(user.stumbleId, skinId);
      } else if (award.type === "EMOTE") {
        const emoteId = award.awardJson.id;
        const wheelReward = {
          amount: 1,
          duplicateCurrencyAmount: 0,
          nestedRewards: [
            {
              amount: 1,
              duplicateCurrencyAmount: 0,
              nestedRewards: [],
              sourceType: "UNKNOWN",
              type: "EMOTE",
              typeInfo: emoteId
            }
          ],
          sourceType: "TOURNAMENT_SEASON",
          type: "WHEEL",
          typeInfo: "TOURNAMENT_SEASON_WHEEL"
        };
        rewards.push(wheelReward);
        await database.addToUserArray({ stumbleId: user.stumbleId }, 'emotes', emoteId);
      } else if (award.type === "FOOTSTEPS") {
        const footstepId = award.awardJson.id;
        const wheelReward = {
          amount: 1,
          duplicateCurrencyAmount: 0,
          nestedRewards: [
            {
              amount: 1,
              duplicateCurrencyAmount: 0,
              nestedRewards: [],
              sourceType: "UNKNOWN",
              type: "FOOTSTEPS",
              typeInfo: footstepId
            }
          ],
          sourceType: "TOURNAMENT_SEASON",
          type: "WHEEL",
          typeInfo: "TOURNAMENT_SEASON_WHEEL"
        };
        rewards.push(wheelReward);
        await database.addToUserArray({ stumbleId: user.stumbleId }, 'footsteps', footstepId);
      }

      userSeasonData.claimedAwards.push(parseInt(awardId));
      await UserModel.update(user.stumbleId, {
        tournamentSeasons: foundUser.tournamentSeasons.map(s =>
          s.seasonId === parseInt(seasonId) ? userSeasonData : s
        )
      });

      const updatedUser = await UserModel.findByStumbleId(user.stumbleId);
      res.status(200).json({
        User: updatedUser,
        Rewards: rewards
      });

    } catch (err) {
      Console.error("TournamentX", "Error claiming season reward:", err);
      res.status(500).json({ message: "Internal server error" });
    }
  }
  

  static async getPartyInfo(req, res) {
    try {
      const { user } = req;
      const tournamentId = parseInt(req.params.tournamentId);

      const party = await database.collections.Parties.findOne({
        tournamentId: tournamentId,
        "players.stumbleId": user.stumbleId
      });

      if (!party) {
        Console.log("PitArena", `User ${user.username} is not in any party for tournament ${tournamentId}`);
        return res.status(404).json({ message: "nao esta em nenhuma partida" });
      }

      res.status(200).json({
        partyId: party.partyId,
        tournamentId: party.tournamentId,
        players: party.players,
        status: party.status,
        createdAt: party.createdAt
      });
    } catch (err) {
      Console.error("ForeArena", "Error fetching party info:", err);
      res.status(500).json({ message: "erro interno do servidor" });
    }
  }

  static async cleanupParties() {
    try {
      const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);
      
      await database.collections.Parties.deleteMany({
        createdAt: { $lt: oneHourAgo },
        status: { $in: ["waiting", "finished"] }
      });
Console.log("PitArena", "Cleaning up old parties");
    } catch (err) {
      Console.error("PitArena", "Error cleaning up parties:", err);
    }
  }
}

setInterval(() => {
  TournamentXController.cleanupParties();
}, 30 * 60 * 1000);

class MatchmakingController {
  // This queue belongs to the private backend.  It intentionally does not
  // validate or emulate the retired remote matchmaker's request-id checksum.
  // The client and this backend share the locally-created request id.
  static rankedTickets = new Map();
  static rankedRooms = new Map();

  static assignLocalRankedRoom(ticket) {
    const now = Date.now();
    for (const [code, room] of MatchmakingController.rankedRooms) {
      if (room.expiresAt <= now) MatchmakingController.rankedRooms.delete(code);
    }

    const p = ticket.parameters;
    const region = String(p.Region || 'EU').toUpperCase();
    const rankId = ticket.rankId || 1;
    let room = [...MatchmakingController.rankedRooms.values()].find((candidate) =>
      candidate.region === region &&
      candidate.rankId === rankId &&
      require('./RankedMaps').sameMaps(candidate.maps, p.Maps) &&
      candidate.members.length < candidate.maxPlayers);

    if (!room) {
      room = {
        code: String(Math.floor(10000 + Math.random() * 90000)),
        region,
        rankId,
        maxPlayers: Math.max(2, Number(p.MaxPlayers) || 12),
        maps: p.Maps,
        members: [],
        expiresAt: now + 10 * 60_000
      };
      MatchmakingController.rankedRooms.set(room.code, room);
    }

    if (!room.members.some((member) => member.UserId === p.UserId)) {
      room.members.push({ UserId: p.UserId, UserName: p.UserName, UserSkin: p.UserSkin });
    }
    room.expiresAt = now + 10 * 60_000;
    // The client already received p.Maps in its ticket. Never silently replace
    // it with a different room's map: previews and the master's load use it.
    return room;
  }

  static async createRankedTicket(req, res) {
    try {
      const user = req.user;
      const request = req.body || {};
      const gameMode = String(request.GameMode || request.gameMode || '').toUpperCase();

      if (gameMode !== 'RANKED') {
        return res.status(400).json({ message: 'Only Ranked matchmaking is configured.' });
      }

      const rankedSettings = getSharedData().RankedPlaySettings;
      const now = new Date();
      const season = rankedSettings?.Seasons?.find((item) =>
        item.IsEnabled && new Date(item.StartDateTime) <= now && now < new Date(item.EndDateTime));

      if (!season) {
        return res.status(503).json({ message: 'No active ranked season is available.' });
      }

      const rankId = user.userProfile?.ranked?.currentRankId || 1;
      const map = require('./RankedMaps').selectMap(season, rankId);

      if (!map?.MapId) {
        return res.status(503).json({ message: 'The active ranked season has no playable maps.' });
      }

      const requestId = crypto.randomUUID();
      const expiresAt = new Date(Date.now() + 60_000).toISOString();
      const skin = user.equippedCosmetics?.skin || user.userProfile?.skin || 'SKIN1';
      const parameters = {
        RequestId: requestId,
        UserId: user.id,
        UserName: user.username,
        UserSkin: skin,
        UserMMR: user.userProfile?.ranked?.currentRankPoints || 0,
        Region: request.Region || request.region || user.region || 'EU',
        Platform: user.userProfile?.nativePlatformName || 'steam',
        Version: user.version || '0.75',
        GameMode: 'RANKED',
        Variant: request.Variant || request.variant || '',
        IsCrossPlatform: true,
        MaxPlayers: season.MaxPlayers,
        InclusionList: {
          [user.id]: {
            InvitationId: null,
            UserName: user.username,
            UserSkin: skin
          }
        },
        ExclusionList: Array.isArray(request.ExclusionList) ? request.ExclusionList : [],
        ExpiryDate: expiresAt,
        Maps: [{ Id: map.MapId }]
      };

      MatchmakingController.rankedTickets.set(requestId, {
        createdAt: Date.now(),
        expiresAt: Date.parse(expiresAt),
        parameters,
        signature: crypto.randomBytes(32).toString('base64url'),
        // The local Photon room implementation accepts the same compact room
        // codes used by custom parties.  Do not use a UUID here: ranked room
        // creation prefixes it internally and exceeds the protocol limit.
        roomCode: String(Math.floor(10000 + Math.random() * 90000)),
        rankId,
        submitted: false,
        cancelled: false
      });

      return res.status(200).json({
        Parameters: parameters,
        Signature: MatchmakingController.rankedTickets.get(requestId).signature
      });
    } catch (err) {
      Console.error('Matchmaking', 'Create ticket error:', err);
      return res.status(500).json({ message: 'Unable to create a ranked matchmaking ticket.' });
    }
  }

  static async submitRankedRequest(req, res) {
    const requestId = req.params.requestId || req.body?.Parameters?.RequestId || req.body?.parameters?.requestId;
    const ticket = MatchmakingController.rankedTickets.get(requestId);
    if (!ticket || ticket.cancelled || ticket.expiresAt <= Date.now()) {
      return res.status(200).json({ Status: 3, Room: '', Users: [], Ticket: '' });
    }

    ticket.submitted = true;
    ticket.submittedAt = Date.now();
    return res.status(200).json({ Status: 1, Room: '', Users: [] });
  }

  static async getRankedRequestStatus(req, res) {
    const ticket = MatchmakingController.rankedTickets.get(req.params.requestId);
    if (!ticket || ticket.cancelled) {
      return res.status(200).json({ Status: 3, Room: '', Users: [], Ticket: '' });
    }
    if (ticket.expiresAt <= Date.now()) {
      MatchmakingController.rankedTickets.delete(req.params.requestId);
      return res.status(200).json({ Status: 4, Room: '', Users: [], Ticket: '' });
    }
    if (!ticket.submitted || Date.now() - ticket.submittedAt < 750) {
      return res.status(200).json({ Status: 1, Room: '', Users: [] });
    }

    const p = ticket.parameters;
    const room = MatchmakingController.assignLocalRankedRoom(ticket);
    return res.status(200).json({
      Status: 2,
      Room: room.code,
      Users: room.members,
      // The 0.75 ranked UI requires a value here.  The client patch removes
      // this private marker before sending Photon room properties.
      Ticket: 'local'
    });
  }

  static async cancelRankedRequest(req, res) {
    const ticket = MatchmakingController.rankedTickets.get(req.params.requestId);
    if (ticket) ticket.cancelled = true;
    return res.status(200).json({ Success: true, Error: '' });
  }

  static async getMatchmakingFilter(req, res) {
    try {
      const { deviceId } = req.query;
      
      if (!deviceId) {
        Console.error('Matchmaking', 'Missing deviceId in request');
        return res.status(400).json({ 
          error: "Bad Request",
          message: "deviceId query parameter is required" 
        });
      }

      const user = await UserModel.findByDeviceId(deviceId);
      
      if (!user) {
        Console.error('Matchmaking', `User not found for deviceId: ${deviceId}`);
        return res.status(404).json({ 
          error: "Not Found",
          message: "User not found" 
        });
      }

      const sharedType = process.env.sharedType || 'NULL';
      const version = user.version;

      const matchmakingFilter = `$StumblePit_${version}_${sharedType}`;

      return res.status(200).json({ matchmakingFilter });
      
    } catch (err) {
      Console.error('Matchmaking', 'Filter error:', err);
      return res.status(500).json({ 
        error: "Internal Server Error",
        message: "An error occurred while generating matchmaking filter" 
      });
    }
  }
}


class SocialController {
  static async getInteractions(req, res) {
    try {
      const { user } = req;

      const friendIds = Array.isArray(user.friends) ? user.friends : [];
      const receivedRequests = Array.isArray(user.receivedFriendRequests) ? user.receivedFriendRequests : [];
      const receivedPartyInvites = Array.isArray(user.receivedPartyInvites) ? user.receivedPartyInvites : [];

      const friends = await database.collections.Users.find({ 
        stumbleId: { $in: friendIds } 
      }).project({ 
        id: 1,
        username: 1, 
        stumbleId: 1, 
        country: 1, 
        skillRating: 1,
        crowns: 1,
        experience: 1,
        equippedCosmetics: 1,
        lastLogin: 1
      }).toArray();

      const friendProfiles = friends.map(friend => ({
        userId: friend.id || 0,
        userName: friend.username || 'Unknown',
        title: "",
        country: friend.country || 'Unknown',
        trophies: friend.skillRating || 0,
        crowns: friend.crowns || 0,
        experience: friend.experience || 0,
        hiddenRating: Math.floor((friend.skillRating || 0) / 10),
        isOnline: true,
        lastSeenDate: friend.lastLogin ? friend.lastLogin.toISOString() : new Date().toISOString(),
        skin: friend.equippedCosmetics?.skin || 'SKIN1',
        nativePlatformName: "android",
        ranked: {
          currentSeasonId: "LIVE_RANKED_SEASON_12",
          currentRankId: 0,
          currentTierIndex: 0
        },
        flags: 0
      }));

      const pendingUsers = await database.collections.Users.find({
        stumbleId: { $in: receivedRequests }
      }).project({
        id: 1,
        username: 1,
        country: 1,
        skillRating: 1,
        crowns: 1,
        experience: 1,
        equippedCosmetics: 1,
        lastLogin: 1
      }).toArray();

      const friendRequestProfiles = pendingUsers.map(u => ({
        userId: u.id || 0,
        userName: u.username || 'Unknown',
        title: "",
        country: u.country || 'Unknown',
        trophies: u.skillRating || 0,
        crowns: u.crowns || 0,
        experience: u.experience || 0,
        hiddenRating: Math.floor((u.skillRating || 0) / 10),
        isOnline: true,
        lastSeenDate: u.lastLogin ? u.lastLogin.toISOString() : new Date().toISOString(),
        skin: u.equippedCosmetics?.skin || 'SKIN1',
        nativePlatformName: "android",
        ranked: {
          currentSeasonId: "LIVE_RANKED_SEASON_12",
          currentRankId: 0,
          currentTierIndex: 0
        },
        flags: 0
      }));

      const excludeIds = [...friendIds, ...receivedRequests, user.stumbleId].filter(id => id);

      const recommendedUsers = await database.collections.Users.aggregate([
        { 
          $match: { 
            stumbleId: { 
              $exists: true,
              $nin: excludeIds.length > 0 ? excludeIds : ['non-existent-id'] 
            },
            country: { $exists: true }
          }
        },
        { $sample: { size: 5 } },
        { $project: {
          id: 1,
          username: 1,
          country: 1,
          skillRating: 1,
          crowns: 1,
          experience: 1,
          equippedCosmetics: 1,
          lastLogin: 1
        }}
      ]).toArray();

      const recommendedProfiles = recommendedUsers.map(u => {
        const tags = [];
        if (u.country === user.country) tags.push("SAME_COUNTRY");
        if (Math.abs((u.skillRating || 0) - (user.skillRating || 0)) < 200) {
          tags.push("SIMILAR_SKILL");
        }

        return {
          tags: tags.length > 0 ? tags : ["SIMILAR_SKILL"],
          userProfile: {
            userId: u.id || 0,
            userName: u.username || 'Unknown',
            title: "",
            country: u.country || 'Unknown',
            trophies: u.skillRating || 0,
            crowns: u.crowns || 0,
            experience: u.experience || 0,
            hiddenRating: Math.floor((u.skillRating || 0) / 10),
            isOnline: true,
            lastSeenDate: u.lastLogin ? u.lastLogin.toISOString() : new Date().toISOString(),
            skin: u.equippedCosmetics?.skin || 'SKIN1',
            nativePlatformName: "android",
            ranked: {
              currentSeasonId: "LIVE_RANKED_SEASON_12",
              currentRankId: 0,
              currentTierIndex: 0
            },
            flags: 0
          }
        };
      });

      const partyInviteDetails = await Promise.all(
        receivedPartyInvites.map(async (invite) => {
          const fromUser = await database.collections.Users.findOne({ stumbleId: invite.fromStumbleId });
          return {
            fromUserId: invite.fromUserId,
            fromUsername: invite.fromUsername,
            fromStumbleId: invite.fromStumbleId,
            sentAt: invite.sentAt,
            fromUserProfile: fromUser ? {
              userId: fromUser.id || 0,
              userName: fromUser.username || 'Unknown',
              title: "",
              country: fromUser.country || 'Unknown',
              trophies: fromUser.skillRating || 0,
              crowns: fromUser.crowns || 0,
              experience: fromUser.experience || 0,
              hiddenRating: Math.floor((fromUser.skillRating || 0) / 10),
              isOnline: true,
              lastSeenDate: fromUser.lastLogin ? fromUser.lastLogin.toISOString() : new Date().toISOString(),
              skin: fromUser.equippedCosmetics?.skin || 'SKIN1',
              nativePlatformName: "android",
              ranked: {
                currentSeasonId: "LIVE_RANKED_SEASON_12",
                currentRankId: 0,
                currentTierIndex: 0
              },
              flags: 0
            } : null
          };
        })
      );

      res.status(200).json({
        friends: friendProfiles,
        friendRequests: friendRequestProfiles,
        partyInvites: partyInviteDetails,
        recommendedFriends: recommendedProfiles
      });

    } catch (err) {
      Console.error('Social', 'Get interactions error:', err);
      Console.log('Social', 'Error details:', err);
      res.status(500).json({
        message: 'erro interno',
        error: err.message 
      });
    }
  }
}

class TournamentController {
    static async login(req, res) {
        try {
            const user = await UserModel.findByDeviceId(req.user.deviceId);
            
            return res.status(200).json({
                userId: user.id,
                clientToken: user.token,
                photonJwt: user.photonJwt
            });

        } catch (error) {
            Console.error('TournamentLogin', error);
            return res.status(500).json({ message: 'Internal server error' });
        }
    }

    static async createTournament(req, res) {
        try {
            const { name, description, startTime, endTime, entryFee, maxPlayers, rewards } = req.body;
            
            if (!name || !startTime || !endTime) {
                return res.status(400).json({ message: 'Name, startTime and endTime are required' });
            }

            const tournament = {
                id: uuidv4(),
                name,
                description: description || "",
                startTime: new Date(startTime),
                endTime: new Date(endTime),
                entryFee: entryFee || 0,
                maxPlayers: maxPlayers || 1000,
                currentPlayers: 0,
                rewards: rewards || [],
                createdAt: new Date(),
                updatedAt: new Date(),
                isActive: true
            };

            const result = await database.collections.Tournaments.insertOne(tournament);
            
            if (result.acknowledged) {
                res.status(201).json({
                    message: 'Tournament created successfully',
                    tournament
                });
            } else {
                throw new Error('Failed to create tournament');
            }
        } catch (err) {
            Console.error('Tournament', 'Create error:', err);
            res.status(500).json({ message: 'Internal server error' });
        }
    }

    static async getActive(req, res) {
        try {
            const now = new Date();
            const activeTournaments = await database.collections.Tournaments.find({
                startTime: { $lte: now },
                endTime: { $gte: now },
                isActive: true
            }).sort({ startTime: 1 }).toArray();

            res.json(activeTournaments);
        } catch (err) {
            Console.error('Tournament', 'Get active error:', err);
            res.status(500).json({ message: 'Internal server error' });
        }
    }

    static async getTournamentById(req, res) {
        try {
            const { id } = req.params;
            
            if (!id) {
                return res.status(400).json({ message: 'Tournament ID is required' });
            }

            const tournament = await database.collections.Tournaments.findOne({ id });
            
            if (!tournament) {
                return res.status(404).json({ message: 'Tournament not found' });
            }

            res.json(tournament);
        } catch (err) {
            Console.error('Tournament', 'Get by ID error:', err);
            res.status(500).json({ message: 'Internal server error' });
        }
    }

    static async joinTournament(req, res) {
        try {
            const { user } = req;
            const { tournamentId } = req.params;

            if (!tournamentId) {
                return res.status(400).json({ message: 'Tournament ID is required' });
            }

            const tournament = await database.collections.Tournaments.findOne({ 
                id: tournamentId,
                isActive: true
            });

            if (!tournament) {
                return res.status(404).json({ message: 'Tournament not found or inactive' });
            }

            const now = new Date();
            if (now < tournament.startTime) {
                return res.status(400).json({ message: 'Tournament has not started yet' });
            }

            if (tournament.currentPlayers >= tournament.maxPlayers) {
                return res.status(400).json({ message: 'Tournament is full' });
            }

            const existingParticipation = await database.collections.TournamentParticipants.findOne({
                tournamentId,
                userId: user.id
            });

            if (existingParticipation) {
                return res.status(400).json({ message: 'You have already joined this tournament' });
            }

            if (tournament.entryFee > 0) {
                const userBalance = UserModel.getBalanceAmount(user, 'gems');
                if (userBalance < tournament.entryFee) {
                    return res.status(400).json({ message: 'Not enough gems to join tournament' });
                }
                
                await UserModel.removeBalance(user.stumbleId, 'gems', tournament.entryFee);
            }

            await database.collections.TournamentParticipants.insertOne({
                id: uuidv4(),
                tournamentId,
                userId: user.id,
                username: user.username,
                joinTime: new Date(),
                score: 0,
                position: 0,
                rewardsClaimed: false
            });

            await database.collections.Tournaments.updateOne(
                { id: tournamentId },
                { $inc: { currentPlayers: 1 } }
            );

            res.json({
                message: 'Successfully joined tournament',
                tournamentId,
                entryFeePaid: tournament.entryFee
            });

        } catch (err) {
            Console.error('Tournament', 'Join error:', err);
            res.status(500).json({ message: 'Internal server error' });
        }
    }

    static async submitTournamentScore(req, res) {
        try {
            const { user } = req;
            const { tournamentId } = req.params;
            const { score } = req.body;

            if (!tournamentId) {
                return res.status(400).json({ message: 'Tournament ID is required' });
            }

            if (typeof score !== 'number' || score < 0) {
                return res.status(400).json({ message: 'Invalid score' });
            }

            const tournament = await database.collections.Tournaments.findOne({ 
                id: tournamentId,
                isActive: true
            });

            if (!tournament) {
                return res.status(404).json({ message: 'Tournament not found or inactive' });
            }

            const participation = await database.collections.TournamentParticipants.findOne({
                tournamentId,
                userId: user.id
            });

            if (!participation) {
                return res.status(400).json({ message: 'You have not joined this tournament' });
            }

            await database.collections.TournamentParticipants.updateOne(
                { id: participation.id },
                { $set: { score: Math.max(participation.score, score) } }
            );

            res.json({
                message: 'Score submitted successfully',
                tournamentId,
                newScore: score,
                previousScore: participation.score
            });

        } catch (err) {
            Console.error('Tournament', 'Submit score error:', err);
            res.status(500).json({ message: 'Internal server error' });
        }
    }

    static async getTournamentLeaderboard(req, res) {
        try {
            const { tournamentId } = req.params;
            const { limit = 50 } = req.query;

            if (!tournamentId) {
                return res.status(400).json({ message: 'Tournament ID is required' });
            }

            const tournament = await database.collections.Tournaments.findOne({ 
                id: tournamentId
            });

            if (!tournament) {
                return res.status(404).json({ message: 'Tournament not found' });
            }

            const leaderboard = await database.collections.TournamentParticipants
                .find({ tournamentId })
                .sort({ score: -1 })
                .limit(parseInt(limit))
                .project({
                    id: 1,
                    userId: 1,
                    username: 1,
                    score: 1,
                    position: 1
                })
                .toArray();

            if (leaderboard.length > 0) {
                let currentPosition = 1;
                let previousScore = leaderboard[0].score;

                for (let i = 0; i < leaderboard.length; i++) {
                    if (leaderboard[i].score < previousScore) {
                        currentPosition = i + 1;
                        previousScore = leaderboard[i].score;
                    }
                    leaderboard[i].position = currentPosition;
                }

                await Promise.all(leaderboard.map(async (entry, index) => {
                    await database.collections.TournamentParticipants.updateOne(
                        { 
                            tournamentId,
                            userId: entry.userId
                        },
                        { $set: { position: entry.position } }
                    );
                }));
            }

            res.json({
                tournamentId,
                tournamentName: tournament.name,
                leaderboard
            });

        } catch (err) {
            Console.error('Tournament', 'Leaderboard error:', err);
            res.status(500).json({ message: 'Internal server error' });
        }
    }

    static async claimTournamentRewards(req, res) {
        try {
            const { user } = req;
            const { tournamentId } = req.params;

            if (!tournamentId) {
                return res.status(400).json({ message: 'Tournament ID is required' });
            }

            const tournament = await database.collections.Tournaments.findOne({ 
                id: tournamentId
            });

            if (!tournament) {
                return res.status(404).json({ message: 'Tournament not found' });
            }

            const now = new Date();
            if (now < tournament.endTime) {
                return res.status(400).json({ message: 'Tournament has not ended yet' });
            }

            const participation = await database.collections.TournamentParticipants.findOne({
                tournamentId,
                userId: user.id
            });

            if (!participation) {
                return res.status(400).json({ message: 'You did not participate in this tournament' });
            }

            if (participation.rewardsClaimed) {
                return res.status(400).json({ message: 'You have already claimed your rewards' });
            }

            const reward = tournament.rewards.find(r => 
                participation.position >= r.positionRangeLowest && 
                participation.position <= r.positionRangeHighest
            );

            if (!reward) {
                return res.status(400).json({ message: 'No rewards available for your position' });
            }

            switch (reward.type) {
                case 'crowns':
                    await UserModel.addBalance(user.stumbleId, 'crowns', reward.amount);
                    break;
                case 'gems':
                    await UserModel.addBalance(user.stumbleId, 'gems', reward.amount);
                    break;
                case 'skins':
                    await UserModel.addSkin(user.stumbleId, reward.skinId);
                    break;
            }

            await database.collections.TournamentParticipants.updateOne(
                { id: participation.id },
                { $set: { rewardsClaimed: true } }
            );

            res.json({
                message: 'Rewards claimed successfully',
                rewards: reward
            });

        } catch (err) {
            Console.error('Tournament', 'Claim rewards error:', err);
            res.status(500).json({ message: 'Internal server error' });
        }
    }

    static async updateTournament(req, res) {
        try {
            const { id } = req.params;
            const updates = req.body;

            if (!id) {
                Console.error('Tournament', 'Tournament ID is required');
                return res.status(400).json({ message: 'Tournament ID is required' });
            }

            if (Object.keys(updates).length === 0) {
                Console.error('Tournament', 'No updates provided');
                return res.status(400).json({ message: 'No updates provided' });
            }

            updates.updatedAt = new Date();

            const result = await database.collections.Tournaments.updateOne(
                { id },
                { $set: updates }
            );

            if (result.matchedCount === 0) {
                return res.status(404).json({ message: 'Tournament not found' });
            }

            const updatedTournament = await database.collections.Tournaments.findOne({ id });

            res.json({
                message: 'Tournament updated successfully',
                tournament: updatedTournament
            });

        } catch (err) {
            Console.error('Tournament', 'Update error:', err);
            res.status(500).json({ message: 'Internal server error' });
        }
    }

    static async endTournament(req, res) {
        try {
            const { id } = req.params;

            if (!id) {
                Console.error('Tournament', 'Tournament ID is required');
                return res.status(400).json({ message: 'Tournament ID is required' });
            }

            const result = await database.collections.Tournaments.updateOne(
                { id },
                { 
                    $set: { 
                        isActive: false,
                        endTime: new Date(),
                        updatedAt: new Date()
                    } 
                }
            );

            if (result.matchedCount === 0) {
                Console.error('Tournament', 'Tournament not found:', id);
                return res.status(404).json({ message: 'Tournament not found' });
            }

            res.json({ message: 'Tournament ended successfully' });

        } catch (err) {
            Console.error('Tournament', 'End error:', err);
            res.status(500).json({ message: 'Internal server error' });
        }
    }
}

class EventsController {
  static async getActive(req, res) {
    try {
      const now = new Date();
      const past = new Date(now.getTime() - 86400000);
      const future = new Date(now.getTime() + 86400000 * 30);

      const customEvent = {
        Id: "disco_fever_event",
        Name: "Disco Fever: MrBeast",
        Description: "Dance for your life in Disco Drop! Be the last one standing!",
        DescriptionTitle: "Disco Fever",
        StartDateTime: past.toISOString(),
        EndDateTime: future.toISOString(),
        CollectRewardsEndDateTime: future.toISOString(),
        PreviewDateTime: past.toISOString(),
        Visible: true,
        Type: "PLAYABLE",
        BotsDisabled: true,
        CustomPartyAllowed: true,
        Players: 1,
        TeamPlayers: 1,
        MinMatchmakingSeconds: 15,
        MinVersion: "0.1",
        Platforms: ["ios", "android", "web", "steam"]
      };

      const baseEvents = Array.isArray(SharedData.GameEvents) ? SharedData.GameEvents : [];
      const events = baseEvents.map(e => ({
        ...e,
        StartDateTime: past.toISOString(),
        EndDateTime: future.toISOString(),
        Platforms: ["ios", "android", "web", "steam"],
        Visible: true
      }));

      if (!events.find(e => e.Id === customEvent.Id)) {
        events.unshift(customEvent);
      }

      const response = { 
        gameEvents: events,
        events: events,
        GameEvents: events,
        Events: events
      };

      return res.status(200).json(response); // <-- FALTAVA ISSO

    } catch (err) {
      Console.error("GameEvents", "Error:", err);
      return res.status(500).json({ message: "internal error" });
    }
  } // <-- FECHA getActive

  static async join(req, res) {
    try {
      const { user } = req;
      const { EventId } = req.body || {};

      if (!EventId) {
        Console.log("GameEvents", `User ${user?.username || "Unknown"} missing EventId`);
        return res.status(400).json({ message: "eventid required" });
      }

      const liveData = getSharedData();
      const events = liveData.GameEvents || [];
      const event = events.find(e => e.Id === EventId);

      if (!event) {
        return res.status(404).json({ message: "evento nao encontrado" });
      }

      const now = new Date();
      const start = new Date(event.StartDateTime);
      const end = new Date(event.EndDateTime);

      if (!(start <= now && now <= end)) {
        return res.status(400).json({ message: "evento nao esta ativo" });
      }

      return res.status(200).json({
        EventId,
        status: "joined"
      });

    } catch (err) {
      Console.error("GameEvents", "Error:", err);
      return res.status(500).json({ message: "internal error" });
    }
  }
}
class CheatController {
  static async reportCheat(req, res) {
    try {
      const { user } = req;
      const { reason } = req.body;

      if (!reason) {
        return res.status(400).json({ 
          success: false, 
          message: 'Reason is required' 
        });
      }

      const cheatReport = {
        id: CryptoUtils.GenerateId(),
        deviceId: user.deviceId,
        reason: reason.trim(),
        timestamp: new Date()
      };

      await database.collections.Anticheat.insertOne(cheatReport);

      Console.log('Anticheat', `cheat report from ${user.username}: ${reason}`);

      return res.status(200).json({ 
        success: true, 
        message: 'Cheat report submitted successfully',
        reportId: cheatReport.id
      });

    } catch (err) {
      Console.error('Anticheat', 'Report error:', err);
      return res.status(500).json({ 
        success: false, 
        message: 'Internal server error' 
      });
    }
  }
}

class InventoryController {
  static async addTag(req, res) {
    try {
      const { identifier, tagName } = req.body;
      
      if (!identifier || !tagName) {
        Console.error('Inventory', 'Missing identifier or tagName in request body');
        return res.status(400).json({ message: 'Identifier and tagName are required' });
      }

      const finalTag = tagName;

      let user;
      if (!isNaN(identifier)) {
        user = await UserModel.findById(parseInt(identifier));
      } else {
        user = await database.getUserByQuery({ 
          username: { $regex: new RegExp(`^${identifier}$`, 'i') } 
        });
      }

      if (!user) {
        Console.error('Inventory', 'User not found:', identifier);
        return res.status(404).json({ message: 'User not found' });
      }

      const existingTag = user.inventory.find(item => 
        item.itemType === "TAG" && item.item === finalTag
      );

      if (existingTag) {
        Console.error('Inventory', 'User already has this tag:', user.id);
        return res.status(409).json({ message: 'User already has this tag' });
      }

      const newTagItem = {
        userId: user.id,
        itemId: Math.floor(Math.random() * 10000) + 8000,
        itemType: "TAG",
        item: finalTag,
        amount: 1,
        acquiredDate: new Date()
      };

      await database.collections.Users.updateOne(
        { id: user.id },
        { $push: { inventory: newTagItem } }
      );

      const updatedUser = await UserModel.findById(user.id);
      
      res.status(200).json({ 
        message: 'Tag added successfully',
        tag: finalTag,
        user: {
          id: updatedUser.id,
          username: updatedUser.username,
          stumbleId: updatedUser.stumbleId
        }
      });

    } catch (err) {
      Console.error('Inventory', 'Error adding tag:', err);
      res.status(500).json({ message: 'Internal server error' });
    }
  }

  static async removeTag(req, res) {
    try {
      const { identifier, tagName } = req.body;
      
      if (!identifier || !tagName) {
        return res.status(400).json({ message: 'Identificador e nome da tag sao obrigatorios' });
      }

      const tagToFind = tagName;

      let user;
      if (!isNaN(identifier)) {
        user = await UserModel.findById(parseInt(identifier));
      } else {
        user = await database.getUserByQuery({ 
          username: { $regex: new RegExp(`^${identifier}$`, 'i') } 
        });
      }

      if (!user) {
        Console.error('Inventory', 'User not found:', identifier);
        return res.status(404).json({ message: 'User not found' });
      }

      const tagToRemove = user.inventory.find(item => 
        item.itemType === "TAG" && item.item === tagToFind
      );

      if (!tagToRemove) {
        Console.error('Inventory', 'User does not have this tag:', user.id);
        return res.status(404).json({ message: 'Este usuario nao possui esta tag' });
      }

      await database.collections.Users.updateOne(
        { id: user.id },
        { $pull: { inventory: { itemId: tagToRemove.itemId } } }
      );

      const updatedUser = await UserModel.findById(user.id);
      
      res.status(200).json({ 
        message: 'Tag removed successfully',
        removedTag: tagToRemove.item,
        user: {
          id: updatedUser.id,
          username: updatedUser.username,
          stumbleId: updatedUser.stumbleId
        }
      });

    } catch (err) {
      Console.error('Inventory', 'Error removing tag:', err);
      res.status(500).json({ message: 'Internal server error' });
    }
  }

  static async listTags(req, res) {
    try {
      const { identifier } = req.body;
      
      if (!identifier) {
        Console.error('Inventory', 'Missing identifier in request body');
        return res.status(400).json({ message: 'Identificador do usuaril e obrigatorio' });
      }

      let user;
      if (!isNaN(identifier)) {
        user = await UserModel.findById(parseInt(identifier));
      } else {
        user = await database.getUserByQuery({ 
          username: { $regex: new RegExp(`^${identifier}$`, 'i') } 
        });
      }

      if (!user) {
        Console.error('Inventory', `User not found: ${identifier}`);
        return res.status(404).json({ message: 'User not found' });
      }

      const tags = user.inventory.filter(item => item.itemType === "TAG");
      
      res.status(200).json({ 
        userId: user.id,
        userName: user.username,
        tags: tags.map(tag => ({
          itemId: tag.itemId,
          tag: tag.item,
          amount: tag.amount,
          acquiredDate: tag.acquiredDate
        }))
      });

    } catch (err) {
      Console.error('Inventory', 'Error listing tags:', err);
      res.status(500).json({ message: 'Erro interno do servidor' });
    }
  }
}



class CreatorCodeController {
  static creatorCodes = [
    { creatorCode: "muichiros", creatorName: "muichiros", reward: 1000 },
    { creatorCode: "Crazzy", creatorName: "Crazzy", reward: 1000 },
  ];

  static async support(req, res) {
    try {
      const { Code } = req.body;
      const { user } = req;

      if (!Code) {
        Console.error('CreatorCode', 'Missing Code in request body');
        return res.status(400).json({ message: 'code e obrigatorio' });
      }

      const creator = CreatorCodeController.creatorCodes.find(c => c.creatorCode === Code);
      if (!creator) {
        Console.error('CreatorCode', 'Invalid creator code:', Code);
        return res.status(404).json({ message: 'creator code invalido' });
      }

      const expirationDate = new Date();
      expirationDate.setDate(expirationDate.getDate() + 7);

      const foundUser = await UserModel.findByStumbleId(user.stumbleId);
      if (!foundUser) {
        Console.error('CreatorCode', 'User not found for stumbleId:', user.stumbleId);
        return res.status(404).json({ message: 'usuario nao encontrado' });
      }

      await UserModel.update(user.stumbleId, {
        "userProfile.creatorCode.code": Code,
        "userProfile.creatorCode.expirationDate": expirationDate,
      });

      res.json({ code: Code, expirationDate, reward: creator.reward });
    } catch (err) {
      Console.error('CreatorCode', 'Error:', err);
      res.status(500).json({ message: 'erro interno' });
    }
  }

  static async stopSupport(req, res) {
    try {
      const { user } = req;

      const foundUser = await UserModel.findByStumbleId(user.stumbleId);
      if (!foundUser) {
        Console.error('CreatorCode', 'User not found for stumbleId:', user.stumbleId);
        return res.status(404).json({ message: 'usuario nao encontrado' });
      }

      await UserModel.update(user.stumbleId, {
        "userProfile.creatorCode.code": "NOSUPORT"
      });

      res.json({ code: "" });
    } catch {
      res.status(500).json({ message: 'erro interno' });
    }
  }

  static async getCreator(req, res) {
    try {
      const { user } = req;

      const foundUser = await UserModel.findByStumbleId(user.stumbleId);
      if (!foundUser || !foundUser.userProfile || !foundUser.userProfile.creatorCode || foundUser.userProfile.creatorCode.code === "NOSUPORT") {
        Console.error('CreatorCode', 'No creator code found for user:', user.stumbleId);
        return res.json({ code: '', expirationDate: '1970-01-01T00:00:00Z' });
      }

      const { code, expirationDate } = foundUser.userProfile.creatorCode;
      if (!expirationDate || new Date(expirationDate) <= new Date())
        return res.json({ code: '', expirationDate: '1970-01-01T00:00:00Z' });
      res.json({ code, expirationDate });
    } catch {
      res.status(500).json({ message: 'erro interno' });
    }
  }
}










function errorControll(err, req, res, next) {
  Console.error('Unhandled', 'Error:', err);
  res.status(500).json({ message: 'Internal server error' });
}

async function sendShared(req, res) {
  try {
    Console.log("Shared", "Sending shared to someone player");
    return res.json(getSharedDataWithPrivateAbilityOffers());
  } catch (error) {
    Console.error("Shared", "Error sending shared:", error);
    return res.status(500).json({ error: "Error generating payload" });
  }
}

async function sendADM(req, res) {
  const admins = [1];
  const id = parseInt(req.query.id);

  if (!id) {
    return res.status(400).json("ERROR");
  }

  if (admins.includes(id)) {
    return res.status(200).json("OK");
  } else {
    return res.status(403).json("FORBIDDEN");
  }
}


async function OnlineCheck(req, res) {
  res.status(200).send("OK");
}
async function getAppId(req, res) {
  const appId = "3e8a970f-12be-41fc-b8d0-93c657234f85";
  const encryptionKey = crypto.createHash('sha256').update("Qz8gC5xK1nVZpb3AeTf6wDqMb2JLhY9R").digest();
  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv('aes-256-cbc', encryptionKey, iv);
  let encrypted = cipher.update(appId, 'utf8', 'base64');
  encrypted += cipher.final('base64');

  res.status(200).json({
    iv: iv.toString('base64'),
    content: encrypted
  });
}


module.exports = {
  Database,
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
  CheatController,
  CreatorCodeController,
  authenticate,
  errorControll,
  sendShared,
  OnlineCheck,
  VerifyPhoton,
  generatePhotonJwt,
  getAppId,
  sendADM
};
