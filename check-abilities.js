require('dotenv').config();

const { MongoClient } = require('mongodb');
const stumbleId = 'AC434A648252A6D9D65D3CD3A47A53FC';

(async () => {
  const client = new MongoClient(process.env.mongoUri);
  await client.connect();
  try {
    const user = await client.db('StumbleGuys').collection('Users').findOne(
      { stumbleId },
      { projection: { username: 1, actionEmotes: 1 } }
    );
    if (!user) throw new Error('Current local-backend account was not found.');

    console.log(JSON.stringify({
      username: user.username,
      abilityCount: (user.actionEmotes || []).length,
      abilities: (user.actionEmotes || []).map((ability) => ({
        id: typeof ability === 'string' ? ability : ability.Id,
        level: typeof ability === 'string' ? null : ability.CurrentTier,
        pending: typeof ability === 'string' ? null : ability.PendingAbilityUpgrades,
        variables: typeof ability === 'string' ? null : ability.Variables
      }))
    }, null, 2));
  } finally {
    await client.close();
  }
})().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
