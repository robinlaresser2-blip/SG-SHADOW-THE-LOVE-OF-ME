const countries = require('./ProfileCountries.json');
const codes = new Set(countries.map(c => c.Code));
module.exports = UserModel => async (req, res) => {
  if (!req.user?.stumbleId) return res.status(401).json({ message: 'Authentication required.' });
  const code = typeof req.body?.Country === 'string' ? req.body.Country.trim().toUpperCase() : '';
  if (!codes.has(code)) return res.status(400).json({ message: 'Choose a valid country.' });
  try {
    await UserModel.update(req.user.stumbleId, { country: code, 'userProfile.country': code });
    return res.json({ Country: code });
  } catch (error) {
    return res.status(503).json({ message: 'Country could not be saved. Please retry.' });
  }
};
