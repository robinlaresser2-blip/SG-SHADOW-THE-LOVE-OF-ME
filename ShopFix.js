const { EconomyController } = require('./BackendUtils');
const Console = require("./ConsoleUtils");

module.exports = function(app) {
    Console.log("System", "🛠️ Injecting Ultimate Shop & Workshop Fixes (DEBUG MODE)...");

    // --- 1. SHOP FIXES ---
    app.all('/economy/purchase/:item', EconomyController.purchase); 
    app.all('/economy/purchasegasha/:itemId/:count', EconomyController.purchaseGasha); 
    app.all('/economy/purchaseluckyspin', EconomyController.purchaseLuckySpin); 
    app.all('/economy/purchasedrop/:itemId/:count', EconomyController.purchaseDrop); 
    app.all('/economy/luckyspin', EconomyController.purchaseLuckySpinWheel);
    app.all('/economy/purchaseluckyspinwheel', EconomyController.purchaseLuckySpinWheel);

    // --- 2. WORKSHOP (UGC) FIXES ---
    const emptyUgc = (req, res) => {
        Console.log("Debug", "Hit empty list route: " + req.originalUrl);
        res.status(200).json([]);
    };
    
    app.get('/ugc/v1/user/maps', emptyUgc);
    app.get('/ugc/v1/user/favorites', emptyUgc);
    app.get('/ugc/v1/user/likes', emptyUgc);
    app.get('/ugc/v1/user/history', emptyUgc);
    app.get('/ugc/v1/user/recently-played', emptyUgc);
    
    const fakeSaveSuccess = (req, res) => {
        Console.log("Workshop", "🔥 MAP SAVE TRIGGERED! SUCCESS!");
        res.status(200).json({
            id: "stumble_legends_map_" + Math.floor(Math.random() * 9999),
            version: 1,
            status: "DRAFT",
            name: "Saved Map",
            isValid: true
        });
    };
    app.post('/ugc/v1/user/maps', fakeSaveSuccess);
    app.put('/ugc/v1/user/maps/:mapId', fakeSaveSuccess);
    app.post('/ugc/v1/user/maps/:mapId/publish', fakeSaveSuccess);

    app.all('/ugc/v1/config', (req, res) => res.status(200).json({
        isFeatureEnabled: true,
        maxSavedMaps: 50,
        maxPublishedMaps: 50
    }));

    // --- 2.5 LOG SILENCERS (NOW WITH TRACKING) ---
    
    // 👇 THE FINAL MODERATION FIX: The "Echo" Bypass!
    app.all('/custom-maps/moderation/check', (req, res) => {
        Console.log("Debug", "Echoing safe words back to the game!");
        res.status(200).json({
            Name: req.body.Name,
            Description: req.body.Description
        }); 
    }); 
    
    app.all('/custom-maps/my', emptyUgc);
    app.all('/custom-maps/code/:code', emptyUgc);
    app.all('/collection-events/me', emptyUgc);
    app.all('/tournamentx/seasons', emptyUgc);
    app.all('/user/inventory/selection', emptyUgc);
    app.all('/economy/offers/purchasedV2/', emptyUgc);
    app.all('/user/creator-codes', emptyUgc);
    
    app.all('/pusher/authenticate', (req, res) => {
        Console.log("Debug", "Pusher Auth triggered!");
        res.status(200).json({ auth: "fake_auth:fake_secret" });
    });
    app.all('/pusher/authorize', (req, res) => {
        Console.log("Debug", "Pusher Authorize triggered!");
        res.status(200).json({ auth: "fake_auth:fake_secret" });
    });

    // --- 3. THE HTML KILLER (MUST BE LAST) ---
    app.use((req, res, next) => {
        Console.error("404 ERROR", `Client tried to hit a missing route: [${req.method}] ${req.originalUrl}`);
        res.status(404).json({ error: "ROUTE_NOT_FOUND", path: req.originalUrl });
    });
};
