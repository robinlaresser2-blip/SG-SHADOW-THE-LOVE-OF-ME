require('dotenv').config();

const fs = require('fs');
const path = require('path');
const { MongoClient } = require('mongodb');

// Use the StumbleId currently sent by the game, not the device ID: this
// database contains older records that share the same device ID.
const stumbleId = 'AC434A648252A6D9D65D3CD3A47A53FC';
const supportedIds = new Set([
  'AE001_Hug', 'AE002_Punch', 'AE003_Slide', 'AE004_Banana',
  'AE005_Briefcase', 'AE006_DiceRoll', 'AE007_Bolt', 'AE008_Snowball',
  'AE009_Spit', 'AE011_Chop', 'AE012_Slap', 'AE013_Shield',
  'AE014_Invisibility', 'AE016_BouncingBall', 'AE017_PowerJump', 'AE018_Rake'
]);

(async () => {
  const shared = JSON.parse(fs.readFileSync(path.join(__dirname, 'shared.json'), 'utf8'));
  const actionEmotes = (shared.ActionEmotes?.ActionEmotes || [])
    .filter((ability) => supportedIds.has(ability.Id))
    .map((ability) => ({
      Id: ability.Id,
      CurrentTier: 0,
      PendingAbilityUpgrades: 0,
      MaxTierReached: false,
      EquippedSkin: null,
      Variables: (ability.Variables || []).map((variable) => ({
        Id: variable.Id,
        CurrentTier: 0,
        ValueFixedPoint: variable.ValueAsInt ?? Math.round((variable.Value || 0) * 100)
      }))
    }));

  const client = new MongoClient(process.env.mongoUri);
  await client.connect();
  try {
    const users = client.db('StumbleGuys').collection('Users');
    const user = await users.findOne({ stumbleId }, { projection: { username: 1 } });
    if (!user) throw new Error('Current local-backend account was not found.');

    await users.updateOne({ _id: user._id }, { $set: { actionEmotes } });
    console.log(`Seeded ${actionEmotes.length} reset abilities for ${user.username}.`);
  } finally {
    await client.close();
  }
})().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
