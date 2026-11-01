'use strict';
module.exports = function equippedAbilities(UserModel) {
  return async function (req, res) {
    try {
      const id = req.params.userId;
      if (!/^\d+$/.test(id)) return res.status(400).json({ error: 'INVALID_USER_ID' });
      const user = await UserModel.findById(id);
      if (!user) return res.status(404).json({ error: 'USER_NOT_FOUND' });
      const result = { UserId: String(user.id ?? id) };
      const equipped = user.equippedCosmetics || {};
      for (let slot = 1; slot <= 4; slot++) {
        const abilityId = equipped[`ActionEmote${slot}`] ?? equipped[`actionEmote${slot}`];
        const owned = (user.actionEmotes || []).find(a => (typeof a === 'string' ? a : a?.Id) === abilityId);
        result[`ActionEmote${slot}`] = typeof abilityId === 'string' && owned ? {
          Id: abilityId,
          EquippedActionEmoteSkin: typeof owned === 'object' ? owned.EquippedSkin || null : null,
          IsActionEmoteMaxLevel: typeof owned === 'object' && owned.MaxTierReached === true
        } : null;
      }
      return res.json(result);
    } catch (error) {
      console.error('[EquippedAbilities] Profile lookup failed:', error.name);
      return res.status(500).json({ error: 'PROFILE_LOOKUP_FAILED' });
    }
  };
};
