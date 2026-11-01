const { Client, GatewayIntentBits, EmbedBuilder, REST, Routes, ActivityType, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const { MongoClient } = require('mongodb');
require('dotenv').config();

// Initialize Discord Bot
const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent
    ]
});

// Database Setup
const mongoUri = process.env.mongoUri;
const dbName = "StumbleGuys";
let db, usersCollection, tournamentsCollection, systemCollection;
let isMaintenanceMode = false;

async function connectDB() {
    try {
        const mongoClient = new MongoClient(mongoUri);
        await mongoClient.connect();
        db = mongoClient.db(dbName);
        usersCollection = db.collection("Users");
        tournamentsCollection = db.collection("Tournaments");
        systemCollection = db.collection("SystemConfig"); 
        console.log("🟢 Discord Bot connected to MongoDB!");

        const config = await systemCollection.findOne({ id: "server_status" });
        if (config && config.maintenance) {
            isMaintenanceMode = true;
        }
    } catch (error) {
        console.error("🔴 MongoDB Connection Error:", error);
    }
}

// 1. Define Slash Commands
const commands = [
    { name: 'ping', description: 'Check if the backend engine is running smoothly!' },
    {
        name: 'stats',
        description: 'Check a player\'s in-game stats',
        options: [{ name: 'username', description: 'The exact username of the player', type: 3, required: true }]
    },
    {
        name: 'claimname',
        description: 'Change your in-game name (Max 3/month, No # or < > allowed)',
        options: [
            { name: 'playerid', description: 'Your current 3-digit ID or Stumble ID', type: 3, required: true },
            { name: 'newname', description: 'Your new clean username', type: 3, required: true }
        ]
    },
    {
        name: 'maintenance',
        description: '🔒 STAFF: Turn Server Maintenance Mode ON or OFF',
        options: [
            { 
                name: 'state', 
                description: 'Turn maintenance ON to lock the server, OFF to open it', 
                type: 3, 
                required: true,
                choices: [
                    { name: 'ON (Lock Server)', value: 'on' },
                    { name: 'OFF (Open Server)', value: 'off' }
                ]
            }
        ]
    },
    {
        name: 'resetlimit',
        description: '🔒 STAFF: Reset a player\'s monthly name change limit',
        options: [
            { name: 'playerid', description: 'The 3-digit ID or Stumble ID', type: 3, required: true }
        ]
    },
    {
        name: 'changename',
        description: '🔒 STAFF: Change a player\'s name in the database',
        options: [
            { name: 'playerid', description: 'The 3-digit ID or Stumble ID', type: 3, required: true },
            { name: 'newname', description: 'The brand new name for the player', type: 3, required: true }
        ]
    },
    {
        name: 'ban',
        description: '🔒 STAFF: Ban a player',
        options: [
            { name: 'playerid', description: 'The 3-digit ID or Stumble ID', type: 3, required: true },
            { name: 'reason', description: 'The reason for the ban', type: 3, required: true }
        ]
    },
    {
        name: 'unban',
        description: '🔒 STAFF: Unban a player',
        options: [
            { name: 'playerid', description: 'The 3-digit ID or Stumble ID', type: 3, required: true }
        ]
    },
    {
        name: 'ccname',
        description: 'Claim your PRO, BOSS, or GOAT colored name in-game!',
        options: [
            { name: 'playerid', description: 'Your 3-digit ID or Stumble ID', type: 3, required: true },
            { name: 'newname', description: 'The new username you want to apply the color to', type: 3, required: true }
        ]
    },
    {
        name: 'addtag',
        description: '🔒 STAFF: Add a temporary tag to a player\'s name',
        options: [
            { name: 'playerid', description: 'The 3-digit ID or Stumble ID', type: 3, required: true },
            { name: 'tag', description: 'The tag to add (e.g. [VIP], [DEV])', type: 3, required: true },
            { name: 'days', description: 'How many days until the tag expires', type: 4, required: true } 
        ]
    },
    {
        name: 'setstats',
        description: '🔒 STAFF: Change a player\'s crowns, trophies, or gems',
        options: [
            { name: 'playerid', description: 'The 3-digit ID or Stumble ID', type: 3, required: true },
            { name: 'crowns', description: 'Set new crown amount', type: 4, required: false },
            { name: 'trophies', description: 'Set new trophy amount', type: 4, required: false },
            { name: 'gems', description: 'Set new gem amount', type: 4, required: false }
        ]
    },
    {
        name: 'changeid',
        description: 'Change your 3-digit player ID!',
        options: [
            { name: 'currentid', description: 'Your current 3-digit ID or Stumble ID', type: 3, required: true },
            { name: 'newid', description: 'The new 3-digit ID you want (0 - 999)', type: 4, required: true }
        ]
    },
    {
        name: 'download',
        description: '🔒 STAFF: Generate the Game Download Panel',
        options: [
            { name: 'folder_link', description: '', type: 3, required: true },
            { name: 'dll_link', description: 'StumbleLuna Dll', type: 3, required: true },
            { name: 'sg_version', description: '**:**´´', type: 3, required: false },
            { name: 'core_version', description: '**Client Version:**`1.0`', type: 3, required: false }
        ]
    },
    {
        name: 'createtourney',
        description: '🔒 STAFF: Launch a live global tournament',
        options: [
            { name: 'name', description: 'Name of the tournament', type: 3, required: true },
            { name: 'hours', description: 'How many hours will it last?', type: 4, required: true },
            { name: 'fee', description: 'Entry fee in gems (0 for free)', type: 4, required: true },
            { name: 'max_players', description: 'Maximum amount of players', type: 4, required: true }
        ]
    }
];

// 2. Bot Online & Register Commands
client.once('clientReady', async (c) => {
    console.log(`🤖 Bot is online! Logged in as ${c.user.tag}`);
    await connectDB();

    async function updateBotStatus() {
        if (!usersCollection) return;
        try {
            if (isMaintenanceMode) {
                c.user.setActivity(`🚧 MAINTENANCE MODE 🚧`, { type: ActivityType.Watching });
                c.user.setStatus('dnd');
            } else {
                const totalPlayers = await usersCollection.countDocuments();
                c.user.setActivity(`${totalPlayers} Players in Database`, { type: ActivityType.Watching });
                c.user.setStatus('online'); 
            }
        } catch (error) {
            console.error("🔴 Failed to update bot status:", error);
        }
    }

    updateBotStatus();
    setInterval(updateBotStatus, 2 * 60 * 1000); 

    try {
        console.log('⏳ Registering slash (/) commands...');
        const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN);
        await rest.put(Routes.applicationCommands(c.user.id), { body: commands });
        console.log('✅ Successfully registered slash (/) commands!');
    } catch (error) {
        console.error('🔴 Error registering commands:', error);
    }
});

// 3. Listen for and Execute Slash Commands
client.on('interactionCreate', async (interaction) => {
    if (!interaction.isChatInputCommand()) return;
    const { commandName } = interaction;

    if (!interaction.member) {
        return interaction.reply({ content: '❌ You must use this command inside the Discord server!', ephemeral: true });
    }

    const isStaff = interaction.member.permissions.has('Administrator') || interaction.member.roles.cache.some(r => r.name.toLowerCase() === 'perms');

    // --- PING COMMAND ---
    if (commandName === 'ping') {
        const pingEmbed = new EmbedBuilder()
            .setColor('#0099ff')
            .setTitle('⚙️ SYSTEM PING (PC)')
            .setDescription(
                `**Network Status :satellite:**\n• \`Backend is running smoothly\`\n\n` +
                `**Latency :stopwatch:**\n• \`${client.ws.ping}ms\`\n\n` +
                `**Discord :news2:**\n• \`@${interaction.user.username}\`\n\n` +
                `**Status :leaderboard:**\n• ✅ \`Online & Synced\``
            )
            .setFooter({ text: 'Stumble Core • PC System' })
            .setTimestamp();
        await interaction.reply({ embeds: [pingEmbed] });
    }

    // --- MAINTENANCE COMMAND (Staff Only) ---
    if (commandName === 'maintenance') {
        if (!isStaff) return interaction.reply({ content: '❌ **Access Denied:** You need the **perms** role to use this command!', ephemeral: true });

        const state = interaction.options.getString('state');
        const turningOn = state === 'on';

        try {
            await systemCollection.updateOne(
                { id: "server_status" }, 
                { $set: { maintenance: turningOn, lastUpdatedBy: interaction.user.id, lastUpdatedAt: new Date() } },
                { upsert: true }
            );

            isMaintenanceMode = turningOn;

            if (turningOn) {
                client.user.setActivity(`🚧 MAINTENANCE MODE 🚧`, { type: ActivityType.Watching });
                client.user.setStatus('dnd');
            } else {
                const totalPlayers = await usersCollection.countDocuments();
                client.user.setActivity(`${totalPlayers} Players in Database`, { type: ActivityType.Watching });
                client.user.setStatus('online');
            }

            const logEmbed = new EmbedBuilder()
                .setColor(turningOn ? '#ff0000' : '#00ff00')
                .setTitle(`🚨 SERVER MAINTENANCE (PC)`)
                .setDescription(
                    `**Maintenance Mode :construction:**\n• \`${turningOn ? 'LOCKED (ON)' : 'OPEN (OFF)'}\`\n\n` +
                    `**Admin Discord :news2:**\n• \`@${interaction.user.username}\`\n\n` +
                    `**Status :leaderboard:**\n• ${turningOn ? '❌ `Backend Rejecting Logins`' : '✅ `Backend Accepting Logins`'}`
                )
                .setFooter({ text: 'Stumble Core • PC Staff System' })
                .setTimestamp();

            await interaction.reply({ embeds: [logEmbed] });
        } catch (error) {
            console.error(error);
            await interaction.reply({ content: '⚠️ Database error while updating maintenance mode.', ephemeral: true });
        }
    }

    // --- CLAIMNAME COMMAND ---
    if (commandName === 'claimname') {
        const playerId = interaction.options.getString('playerid');
        const newName = interaction.options.getString('newname');

        if (newName.includes('#') || newName.includes('<') || newName.includes('>')) {
            return interaction.reply({ content: '❌ **Error:** You cannot use `#`, `<`, or `>` symbols in your new name!', ephemeral: true });
        }

        try {
            const user = await usersCollection.findOne({ $or: [{ stumbleId: playerId }, { id: parseInt(playerId) || -1 }] });
            if (!user) return interaction.reply({ content: `❌ **Error:** Could not find player ID **${playerId}** in the database.`, ephemeral: true });

            const oldName = user.username;
            const now = new Date();
            const currentMonth = now.getMonth();
            const currentYear = now.getFullYear();
            
            let limitData = user.nameChangeData || { count: 0, month: currentMonth, year: currentYear };

            if (limitData.month !== currentMonth || limitData.year !== currentYear) {
                limitData = { count: 0, month: currentMonth, year: currentYear };
            }

            if (limitData.count >= 3) {
                return interaction.reply({ content: '❌ **Limit Reached:** You have used all 3 name changes for this month. Please try again next month or ask an Admin to reset your limit!', ephemeral: true });
            }

            limitData.count += 1;
            const remaining = 3 - limitData.count;

            await usersCollection.updateOne(
                { _id: user._id },
                {
                    $set: { username: newName, "userProfile.userName": newName, nameChangeData: limitData },
                    $push: { oldNames: { name: oldName, changedAt: new Date() } }
                }
            );

            const logEmbed = new EmbedBuilder()
                .setColor('#0099ff')
                .setTitle('⚙️ USERNAME UPDATED (PC)')
                .setDescription(
                    `**Previous Name :news2:**\n• \`${oldName.replace(/<[^>]*>/g, '')}\`\n\n` +
                    `**New Name :news2:**\n• \`${newName}\`\n\n` +
                    `**UserId :sblush:**\n• \`${user.id || playerId}\`\n\n` +
                    `**Discord :news2:**\n• \`@${interaction.user.username}\`\n\n` +
                    `**Changes Available :leaderboard:**\n• \`${remaining} remaining\`\n\n` +
                    `**Status :leaderboard:**\n• ✅ \`Database Synced\``
                )
                .setFooter({ text: 'Stumble Core • PC Name System' })
                .setTimestamp();

            await interaction.reply({ embeds: [logEmbed] });
        } catch (error) {
            console.error(error);
            await interaction.reply({ content: '⚠️ Database check error.', ephemeral: true });
        }
    }

    // --- RESET LIMIT COMMAND (Staff Only) ---
    if (commandName === 'resetlimit') {
        if (!isStaff) return interaction.reply({ content: '❌ **Access Denied:** You need the **perms** role to use this command!', ephemeral: true });
        const playerId = interaction.options.getString('playerid');
        try {
            const user = await usersCollection.findOne({ $or: [{ stumbleId: playerId }, { id: parseInt(playerId) || -1 }] });
            if (!user) return interaction.reply(`❌ **Error:** Could not find player ID **${playerId}**.`);

            const now = new Date();
            const resetData = { count: 0, month: now.getMonth(), year: now.getFullYear() };

            await usersCollection.updateOne({ _id: user._id }, { $set: { nameChangeData: resetData } });

            const logEmbed = new EmbedBuilder()
                .setColor('#00ff00')
                .setTitle('♻️ LIMIT RESET (PC)')
                .setDescription(
                    `**Player Name :news2:**\n• \`${user.username.replace(/<[^>]*>/g, '')}\`\n\n` +
                    `**UserId :sblush:**\n• \`${user.id || playerId}\`\n\n` +
                    `**Admin Discord :news2:**\n• \`@${interaction.user.username}\`\n\n` +
                    `**Status :leaderboard:**\n• ✅ \`Monthly limit reset to 3\``
                )
                .setFooter({ text: 'Stumble Core • PC Staff System' })
                .setTimestamp();
            await interaction.reply({ embeds: [logEmbed] });
        } catch (error) {
            console.error(error);
            await interaction.reply({ content: '⚠️ Database error.', ephemeral: true });
        }
    }

    // --- CHANGENAME COMMAND (Staff) ---
    if (commandName === 'changename') {
        if (!isStaff) return interaction.reply({ content: '❌ **Access Denied:** You need the **perms** role to use this command!', ephemeral: true });
        const playerId = interaction.options.getString('playerid');
        const newName = interaction.options.getString('newname');
        try {
            const user = await usersCollection.findOne({ $or: [{ stumbleId: playerId }, { id: parseInt(playerId) || -1 }] });
            if (!user) return interaction.reply(`❌ **Error:** Could not find player ID **${playerId}**.`);

            const oldName = user.username;
            await usersCollection.updateOne(
                { _id: user._id },
                {
                    $set: { username: newName, "userProfile.userName": newName },
                    $push: { oldNames: { name: oldName, changedAt: new Date() } }
                }
            );
            
            const logEmbed = new EmbedBuilder()
                .setColor('#0099ff')
                .setTitle('⚙️ STAFF: USERNAME UPDATED (PC)')
                .setDescription(
                    `**Previous Name :news2:**\n• \`${oldName.replace(/<[^>]*>/g, '')}\`\n\n` +
                    `**New Name :news2:**\n• \`${newName}\`\n\n` +
                    `**UserId :sblush:**\n• \`${user.id || playerId}\`\n\n` +
                    `**Admin Discord :news2:**\n• \`@${interaction.user.username}\`\n\n` +
                    `**Status :leaderboard:**\n• ✅ \`Database Synced (Forced)\``
                )
                .setFooter({ text: 'Stumble Core • PC Staff System' })
                .setTimestamp();
            await interaction.reply({ embeds: [logEmbed] });
        } catch (error) {
            console.error(error);
            await interaction.reply({ content: '⚠️ Database error.', ephemeral: true });
        }
    }

    // --- CCNAME COMMAND ---
    if (commandName === 'ccname') {
        const playerId = interaction.options.getString('playerid');
        const requestedName = interaction.options.getString('newname');
        const memberRoles = interaction.member.roles.cache;
        let roleTag = "", mainColor = "";

        if (requestedName.includes('#') || requestedName.includes('<') || requestedName.includes('>')) {
            return interaction.reply({ content: '❌ **Error:** You cannot use `#`, `<`, or `>` symbols in your name!', ephemeral: true });
        }

        if (memberRoles.some(r => r.name.toLowerCase() === 'goat')) { roleTag = "GOAT"; mainColor = "cyan"; }
        else if (memberRoles.some(r => r.name.toLowerCase() === 'boss')) { roleTag = "BOSS"; mainColor = "orange"; }
        else if (memberRoles.some(r => r.name.toLowerCase() === 'pro')) { roleTag = "PRO"; mainColor = "blue"; }
        else { return interaction.reply({ content: '❌ **Access Denied:** You must have the **PRO**, **BOSS**, or **GOAT** Discord role to claim a colored name!', ephemeral: true }); }

        try {
            const user = await usersCollection.findOne({ $or: [{ stumbleId: playerId }, { id: parseInt(playerId) || -1 }] });
            if (!user) return interaction.reply({ content: `❌ **Error:** Could not find player ID **${playerId}**.`, ephemeral: true });

            let newNameWithColors = "";
            if (roleTag === "GOAT") {
                newNameWithColors = `<#00FFFF>${requestedName}<color=yellow><sup>GOAT`;
            } else {
                newNameWithColors = `<color=${mainColor}>${requestedName}<color=yellow><sup>${roleTag}`;
            }

            const oldName = user.username;
            await usersCollection.updateOne({ _id: user._id }, {
                $set: { username: newNameWithColors, "userProfile.userName": newNameWithColors },
                $push: { oldNames: { name: oldName, changedAt: new Date() } }
            });

            const logEmbed = new EmbedBuilder()
                .setColor('#0099ff')
                .setTitle('🎨 COLOR CLAIMED (PC)')
                .setDescription(
                    `**Previous Name :news2:**\n• \`${oldName.replace(/<[^>]*>/g, '')}\`\n\n` +
                    `**New Name :news2:**\n• \`${requestedName} [${roleTag}]\`\n\n` +
                    `**UserId :sblush:**\n• \`${user.id || playerId}\`\n\n` +
                    `**Discord :news2:**\n• \`@${interaction.user.username}\`\n\n` +
                    `**Status :leaderboard:**\n• ✅ \`Custom Color Applied\``
                )
                .setFooter({ text: 'Stumble Core • PC Name System' })
                .setTimestamp();
            await interaction.reply({ embeds: [logEmbed] });
        } catch (error) {
            console.error(error);
            await interaction.reply({ content: '⚠️ Database error.', ephemeral: true });
        }
    }

    // --- BAN COMMAND (Staff) ---
    if (commandName === 'ban') {
        if (!isStaff) return interaction.reply({ content: '❌ **Access Denied:** You need the **perms** role to use this command!', ephemeral: true });
        const playerId = interaction.options.getString('playerid');
        const reason = interaction.options.getString('reason');
        try {
            const user = await usersCollection.findOne({ $or: [{ stumbleId: playerId }, { id: parseInt(playerId) || -1 }] });
            if (!user) return interaction.reply(`❌ **Error:** Could not find player ID **${playerId}**.`);
            await usersCollection.updateOne({ _id: user._id }, { $set: { isBanned: true, banReason: reason } });
            
            const logEmbed = new EmbedBuilder()
                .setColor('#ff0000')
                .setTitle('🔨 PLAYER BANNED (PC)')
                .setDescription(
                    `**Player Name :news2:**\n• \`${user.username.replace(/<[^>]*>/g, '')}\`\n\n` +
                    `**Reason :warning:**\n• \`${reason}\`\n\n` +
                    `**UserId :sblush:**\n• \`${user.id || playerId}\`\n\n` +
                    `**Admin Discord :news2:**\n• \`@${interaction.user.username}\`\n\n` +
                    `**Status :leaderboard:**\n• ❌ \`Access Revoked\``
                )
                .setFooter({ text: 'Stumble Core • PC Staff System' })
                .setTimestamp();
            await interaction.reply({ embeds: [logEmbed] });
        } catch (error) { console.error(error); await interaction.reply({ content: '⚠️ Database error.', ephemeral: true }); }
    }

    // --- UNBAN COMMAND (Staff) ---
    if (commandName === 'unban') {
        if (!isStaff) return interaction.reply({ content: '❌ **Access Denied:** You need the **perms** role to use this command!', ephemeral: true });
        const playerId = interaction.options.getString('playerid');
        try {
            const user = await usersCollection.findOne({ $or: [{ stumbleId: playerId }, { id: parseInt(playerId) || -1 }] });
            if (!user) return interaction.reply(`❌ **Error:** Could not find player ID **${playerId}**.`);
            await usersCollection.updateOne({ _id: user._id }, { $set: { isBanned: false }, $unset: { banReason: "" } });
            
            const logEmbed = new EmbedBuilder()
                .setColor('#00ff00')
                .setTitle('🔓 PLAYER UNBANNED (PC)')
                .setDescription(
                    `**Player Name :news2:**\n• \`${user.username.replace(/<[^>]*>/g, '')}\`\n\n` +
                    `**UserId :sblush:**\n• \`${user.id || playerId}\`\n\n` +
                    `**Admin Discord :news2:**\n• \`@${interaction.user.username}\`\n\n` +
                    `**Status :leaderboard:**\n• ✅ \`Access Restored\``
                )
                .setFooter({ text: 'Stumble Core • PC Staff System' })
                .setTimestamp();
            await interaction.reply({ embeds: [logEmbed] });
        } catch (error) { console.error(error); await interaction.reply({ content: '⚠️ Database error.', ephemeral: true }); }
    }

    // --- SET STATS COMMAND (Staff) ---
    if (commandName === 'setstats') {
        if (!isStaff) return interaction.reply({ content: '❌ **Access Denied:** You need the **perms** role to use this command!', ephemeral: true });
        const playerId = interaction.options.getString('playerid');
        const crowns = interaction.options.getInteger('crowns');
        const trophies = interaction.options.getInteger('trophies');
        const gems = interaction.options.getInteger('gems');
        try {
            const user = await usersCollection.findOne({ $or: [{ stumbleId: playerId }, { id: parseInt(playerId) || -1 }] });
            if (!user) return interaction.reply(`❌ **Error:** Could not find player ID **${playerId}**.`);
            const updates = {}; let statsText = "";
            if (crowns !== null) { updates.crowns = crowns; statsText += `• Crowns: \`${crowns}\`\n`; }
            if (trophies !== null) { updates.skillRating = trophies; statsText += `• Trophies: \`${trophies}\`\n`; }
            if (gems !== null) {
                let balances = user.balances || [];
                let gemIndex = balances.findIndex(b => b.name === 'gems');
                if (gemIndex !== -1) balances[gemIndex].amount = gems; else balances.push({ name: 'gems', amount: gems }); 
                updates.balances = balances; statsText += `• Gems: \`${gems}\`\n`;
            }
            if (Object.keys(updates).length === 0) return interaction.reply({ content: '⚠️ You didn\'t provide any stats to change!', ephemeral: true });
            await usersCollection.updateOne({ _id: user._id }, { $set: updates });
            
            const logEmbed = new EmbedBuilder()
                .setColor('#0099ff')
                .setTitle('⚙️ STATS UPDATED (PC)')
                .setDescription(
                    `**Player Name :news2:**\n• \`${user.username.replace(/<[^>]*>/g, '')}\`\n\n` +
                    `**Updated Stats :gem:**\n${statsText}\n` +
                    `**UserId :sblush:**\n• \`${user.id || playerId}\`\n\n` +
                    `**Admin Discord :news2:**\n• \`@${interaction.user.username}\`\n\n` +
                    `**Status :leaderboard:**\n• ✅ \`Database Synced\``
                )
                .setFooter({ text: 'Stumble Core • PC Staff System' })
                .setTimestamp();
            await interaction.reply({ embeds: [logEmbed] });
        } catch (error) { console.error(error); await interaction.reply({ content: '⚠️ Database error.', ephemeral: true }); }
    }

    // --- ADD TAG COMMAND (Staff) ---
    if (commandName === 'addtag') {
        if (!isStaff) return interaction.reply({ content: '❌ **Access Denied:** You need the **perms** role to use this command!', ephemeral: true });
        const playerId = interaction.options.getString('playerid');
        const tag = interaction.options.getString('tag');
        const days = interaction.options.getInteger('days');
        try {
            const user = await usersCollection.findOne({ $or: [{ stumbleId: playerId }, { id: parseInt(playerId) || -1 }] });
            if (!user) return interaction.reply(`❌ **Error:** Could not find player ID **${playerId}**.`);
            const originalName = user.username;
            const newNameWithTag = `${tag} ${originalName}`;
            const expirationDate = new Date(); expirationDate.setDate(expirationDate.getDate() + days);
            await usersCollection.updateOne({ _id: user._id }, {
                $set: { username: newNameWithTag, "userProfile.userName": newNameWithTag, tempTag: { originalName: originalName, expiresAt: expirationDate } }
            });
            
            const logEmbed = new EmbedBuilder()
                .setColor('#0099ff')
                .setTitle('🏷️ TAG ADDED (PC)')
                .setDescription(
                    `**New Name :news2:**\n• \`${newNameWithTag}\`\n\n` +
                    `**Duration :stopwatch:**\n• \`Expires in ${days} days\`\n\n` +
                    `**UserId :sblush:**\n• \`${user.id || playerId}\`\n\n` +
                    `**Admin Discord :news2:**\n• \`@${interaction.user.username}\`\n\n` +
                    `**Status :leaderboard:**\n• ✅ \`Database Synced\``
                )
                .setFooter({ text: 'Stumble Core • PC Staff System' })
                .setTimestamp();
            await interaction.reply({ embeds: [logEmbed] });
        } catch (error) { console.error(error); await interaction.reply({ content: '⚠️ Database error.', ephemeral: true }); }
    }

    // --- CHANGE ID COMMAND ---
    if (commandName === 'changeid') {
        const currentId = interaction.options.getString('currentid');
        const newId = interaction.options.getInteger('newid');
        if (newId < 0 || newId > 999) return interaction.reply({ content: '⚠️ The new ID must be a number between **0 and 999**.', ephemeral: true });
        try {
            const existingUser = await usersCollection.findOne({ id: newId });
            if (existingUser) return interaction.reply({ content: `❌ **Error:** The ID **${newId}** is already taken by another player! Try a different number.`, ephemeral: true });
            const user = await usersCollection.findOne({ $or: [{ stumbleId: currentId }, { id: parseInt(currentId) || -1 }] });
            if (!user) return interaction.reply({ content: `❌ **Error:** Could not find your current player ID **${currentId}**.`, ephemeral: true });
            const oldId = user.id;
            await usersCollection.updateOne({ _id: user._id }, { $set: { id: newId } });
            
            const logEmbed = new EmbedBuilder()
                .setColor('#0099ff')
                .setTitle('⚙️ ID UPDATED (PC)')
                .setDescription(
                    `**Old ID :news2:**\n• \`${oldId}\`\n\n` +
                    `**New ID :news2:**\n• \`${newId}\`\n\n` +
                    `**Player Name :sblush:**\n• \`${user.username.replace(/<[^>]*>/g, '')}\`\n\n` +
                    `**Discord :news2:**\n• \`@${interaction.user.username}\`\n\n` +
                    `**Status :leaderboard:**\n• ✅ \`Database Synced\``
                )
                .setFooter({ text: 'Stumble Core • PC System' })
                .setTimestamp();
            await interaction.reply({ embeds: [logEmbed] });
        } catch (error) { console.error(error); await interaction.reply({ content: '⚠️ Database error.', ephemeral: true }); }
    }

    // --- STATS COMMAND ---
    if (commandName === 'stats') {
        const username = interaction.options.getString('username');
        try {
            const user = await usersCollection.findOne({ username: new RegExp(`^${username}$`, 'i') });
            if (!user) return interaction.reply(`❌ Could not find a player named **${username}**.`);
            const crowns = user.crowns || 0;
            const trophies = user.skillRating || 0;
            const gemBalance = user.balances?.find(b => b.name === 'gems');
            const gems = gemBalance ? gemBalance.amount : 0;
            
            const statsEmbed = new EmbedBuilder()
                .setColor('#0099ff')
                .setTitle(`📊 PLAYER STATS (PC)`)
                .setDescription(
                    `**Player Name :news2:**\n• \`${user.username.replace(/<[^>]*>/g, '')}\`\n\n` +
                    `**Stats :gem:**\n• Crowns: \`${crowns}\`\n• Trophies: \`${trophies}\`\n• Gems: \`${gems}\`\n\n` +
                    `**UserId (Stumble/3-Digit) :sblush:**\n• \`${user.stumbleId || 'Unknown'} / ${user.id ? user.id : 'Unknown'}\`\n\n` +
                    `**Discord :news2:**\n• \`@${interaction.user.username}\`\n\n` +
                    `**Status :leaderboard:**\n• ✅ \`Data Fetched Successfully\``
                )
                .setFooter({ text: 'Stumble Core • PC System' })
                .setTimestamp();
            await interaction.reply({ embeds: [statsEmbed] });
        } catch (error) { console.error(error); await interaction.reply({ content: '⚠️ Database error.', ephemeral: true }); }
    }

    // --- CREATETOURNEY COMMAND (Staff) ---
    if (commandName === 'createtourney') {
        if (!isStaff) return interaction.reply({ content: '❌ **Access Denied:** You need the **perms** role to use this command!', ephemeral: true });
        const name = interaction.options.getString('name');
        const hours = interaction.options.getInteger('hours');
        const fee = interaction.options.getInteger('fee');
        const maxPlayers = interaction.options.getInteger('max_players');
        try {
            const now = new Date(); const endDate = new Date(now.getTime() + (hours * 60 * 60 * 1000)); const tourneyId = "T_" + Date.now();
            const newTournament = { id: tourneyId, name: name, entryFee: fee, maxPlayers: maxPlayers, currentPlayers: 0, startDate: now, endDate: endDate, regions: ["US", "EU", "SA", "AS", "IN"], isActive: true, rewards: [{ rankMin: 1, rankMax: 1, type: "CURRENCY", typeInfo: "gems", amount: 10000 }, { rankMin: 2, rankMax: 10, type: "CURRENCY", typeInfo: "gems", amount: 1000 }, { rankMin: 11, rankMax: 50, type: "CURRENCY", typeInfo: "tokens", amount: 50 }] };
            await tournamentsCollection.insertOne(newTournament);
            
            const tourneyEmbed = new EmbedBuilder()
                .setColor('#0099ff')
                .setTitle(`🏆 TOURNAMENT LAUNCHED (PC)`)
                .setDescription(
                    `**Name :news2:**\n• \`${name}\`\n\n` +
                    `**Details :video_game:**\n• Fee: \`${fee} Gems\`\n• Max Players: \`${maxPlayers}\`\n• Duration: \`${hours} Hours\`\n\n` +
                    `**Regions :earth_americas:**\n• \`Global (All)\`\n\n` +
                    `**Admin Discord :news2:**\n• \`@${interaction.user.username}\`\n\n` +
                    `**Status :leaderboard:**\n• ✅ \`Database Synced\``
                )
                .setFooter({ text: 'Stumble Core • PC Staff System' })
                .setTimestamp();
            await interaction.reply({ embeds: [tourneyEmbed] });
        } catch (error) { console.error(error); await interaction.reply({ content: '⚠️ Database error while creating the tournament.', ephemeral: true }); }
    }

    // --- DOWNLOAD COMMAND (Staff) ---
    if (commandName === 'download') {
        if (!isStaff) return interaction.reply({ content: '❌ **Access Denied:** You need the **perms** role to use this command!', ephemeral: true });
        const folderLinkInput = interaction.options.getString('folder_link');
        const dllLinkInput = interaction.options.getString('dll_link');
        const sgVersion = interaction.options.getString('sg_version') || '0.56';
        const mlVersion = interaction.options.getString('ml_version') || '0.6.1';
        const coreVersion = interaction.options.getString('core_version') || 'v1.0';
        const isValidUrl = urlString => { try { return Boolean(new URL(urlString)); } catch(e){ return false; } }
        const finalFolderLink = isValidUrl(folderLinkInput) ? folderLinkInput : 'https://discord.com';
        const finalDllLink = isValidUrl(dllLinkInput) ? dllLinkInput : 'https://discord.com';
        
        const embed = new EmbedBuilder().setColor('#FFA500').setDescription(`⚠️ **Stumble Core - Warning**\n➔ We value your safety, so only download files from the official **Stumble Core** server.\n\nWhen You download Stumble Core you automatically download these apps:\n\n**• Melon Loader** v${mlVersion} 🍉 **(Only PC)**\n➔ Open-Source loader used to inject C# mods into Unity Il2cpp games.\n\n**• Stumble Guys** v${sgVersion} 🏃\n\n**• Stumble Core** ${coreVersion} ⚙️\n➔ Custom modification of Stumble Guys focused on delivering a **Core** of new features, enhanced gameplay and exclusive content.\n\n━━━━━━━━━━━━━━━━━━━━━━\n💻 **Stumble Core - Windows (PC) Download**\n\n**• Game Folder (Required)**\n➔ Stumble Guys Folder including **MelonLoader** 🍉 and StumbleCore ⚙️.\n\n**• Stumble Core .dll**\n➔ A Dll is required because it provides essential libraries and functions necessary for the application to execute correctly.`);
        const folderButton = new ButtonBuilder().setLabel('Game Folder ( Download Here )').setURL(finalFolderLink).setStyle(ButtonStyle.Link).setEmoji('🔗');
        const dllButton = new ButtonBuilder().setLabel('.DLL ( Download Here )').setURL(finalDllLink).setStyle(ButtonStyle.Link).setEmoji('🔗');
        const row = new ActionRowBuilder().addComponents(folderButton, dllButton);
        await interaction.reply({ embeds: [embed], components: [row] });
    }
});

// Log in the bot
if (!process.env.DISCORD_TOKEN) {
    console.error("🔴 DISCORD_TOKEN is missing!");
} else {
    client.login(process.env.DISCORD_TOKEN);
}
