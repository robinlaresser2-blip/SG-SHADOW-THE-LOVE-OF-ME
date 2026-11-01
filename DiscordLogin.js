'use strict';
const crypto = require('node:crypto');
const express = require('express');
const rateLimit = require('express-rate-limit');
const hash = value => crypto.createHash('sha256').update(value).digest('hex');
const random = () => crypto.randomBytes(32).toString('hex');
const valid = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);

module.exports = function discordLogin({ collection, findUserByDevice, fetchImpl = fetch, env = process.env }) {
  const router = express.Router();
  const report = require('./DiscordLoginWebhook')({ env });
  const enabled = () => env.DISCORD_LOGIN_REQUIRED === '1';
  const config = () => {
    if (!/^\d{17,20}$/.test(env.DISCORD_CLIENT_ID || '') || !env.DISCORD_CLIENT_SECRET)
      throw new Error('Discord application not configured');
    const redirect = new URL(env.DISCORD_REDIRECT_URI);
    if (redirect.protocol !== 'https:' || redirect.pathname !== '/auth/discord/callback')
      throw new Error('Invalid Discord redirect URI');
    return redirect;
  };
  const wrap = handler => (req, res, next) => Promise.resolve(handler(req, res)).catch(() =>
    (report('unavailable'), res.status(503).json({ error: 'Discord login unavailable. Please retry.' })));
  if (enabled()) config(); // Refuse to start mandatory login with missing credentials.
  router.use((req, res, next) => {
    res.set('Cache-Control', 'no-store');
    res.set('Referrer-Policy', 'no-referrer');
    next();
  });
  router.get('/config', (_req, res) => res.json({ required: enabled() }));
  router.use(rateLimit({ windowMs: 60000, max: 90, standardHeaders: true, legacyHeaders: false }));
  router.post('/start', wrap(async (req, res) => {
    // Optional authorization remains available while global enforcement is off.
    const redirect = config();
    const id = random(), secret = random();
    await collection().insertOne({ _id: hash(id), secret: hash(secret),
      expiresAt: new Date(Date.now() + 300000), status: 'pending' });
    res.json({ id, secret, url: `${redirect.origin}/auth/discord/authorize?id=${id}` });
  }));
  router.get('/authorize', wrap(async (req, res) => {
    if (!valid(req.query.id)) return res.sendStatus(400);
    const redirect = config(), state = random(), browser = random();
    const updated = await collection().updateOne({ _id: hash(req.query.id), status: 'pending',
      expiresAt: { $gt: new Date() }, state: { $exists: false } },
      { $set: { state: hash(state), browser: hash(browser) } });
    if (!updated.modifiedCount) return res.status(400).send('Login expired. Start again in the game.');
    res.cookie('ultimate_discord', browser, { httpOnly: true, secure: true,
      sameSite: 'lax', path: '/auth/discord/callback', maxAge: 300000 });
    const params = new URLSearchParams({ client_id: env.DISCORD_CLIENT_ID,
      response_type: 'code', scope: 'identify', redirect_uri: redirect.href, state });
    res.redirect(`https://discord.com/oauth2/authorize?${params}`);
  }));
  router.get('/callback', wrap(async (req, res) => {
    const cookie = (req.headers.cookie || '').split(';').map(s => s.trim())
      .find(s => s.startsWith('ultimate_discord='))?.slice('ultimate_discord='.length);
    if (!valid(req.query.state) || !valid(cookie)) return res.sendStatus(400);
    const session = await collection().findOneAndUpdate({ state: hash(req.query.state),
      browser: hash(cookie), status: 'pending', expiresAt: { $gt: new Date() } },
      { $set: { status: 'processing' } }, { returnDocument: 'after' });
    if (!session) return res.status(400).send('Login expired or already used.');
    res.clearCookie('ultimate_discord', { path: '/auth/discord/callback', secure: true, sameSite: 'lax' });
    if (req.query.error || typeof req.query.code !== 'string') {
      await collection().updateOne({ _id: session._id }, { $set: { status: 'denied' } });
      report('cancelled');
      return res.status(400).send('Login cancelled. Return to the game to retry.');
    }
    const redirect = config();
    const tokenResponse = await fetchImpl('https://discord.com/api/oauth2/token', {
      method: 'POST', signal: AbortSignal.timeout(15000),
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ client_id: env.DISCORD_CLIENT_ID,
        client_secret: env.DISCORD_CLIENT_SECRET, grant_type: 'authorization_code',
        code: req.query.code, redirect_uri: redirect.href }).toString()
    });
    if (!tokenResponse.ok) throw new Error('Token exchange rejected');
    const tokens = await tokenResponse.json();
    const identityResponse = await fetchImpl('https://discord.com/api/v10/users/@me', {
      signal: AbortSignal.timeout(15000), headers: { Authorization: `Bearer ${tokens.access_token}` }
    });
    if (!identityResponse.ok) throw new Error('Identity rejected');
    const identity = await identityResponse.json();
    if (!/^\d{17,20}$/.test(identity.id || '')) throw new Error('Invalid identity');
    // Never persist Discord access/refresh tokens or expose them to the game.
    await collection().updateOne({ _id: session._id, status: 'processing' },
      { $set: { status: 'approved', discordId: identity.id } });
    report('approved');
    res.type('text').send('Discord login complete. Return to Stumble Ultimate.');
  }));
  router.post('/status', wrap(async (req, res) => {
    if (!valid(req.body.id) || !valid(req.body.secret)) return res.sendStatus(400);
    const session = await collection().findOne({ _id: hash(req.body.id), secret: hash(req.body.secret),
      expiresAt: { $gt: new Date() } });
    if (!session) return res.status(410).json({ status: 'expired' });
    res.json({ status: session.status });
  }));
  router.post('/remember', wrap(async (req, res) => {
    if (!findUserByDevice || typeof req.body.deviceId !== 'string' || typeof req.body.token !== 'string') return res.sendStatus(400);
    const user = await findUserByDevice(req.body.deviceId);
    if (!user?.discordId || !require('./SessionIdentity')({ DeviceId: req.body.deviceId, Token: req.body.token }, user)) return res.sendStatus(401);
    const credential = random();
    await collection().insertOne({ _id: hash(credential), kind: 'remembered', deviceId: user.deviceId,
      discordId: user.discordId, sessionHash: hash(user.token), expiresAt: new Date(Date.now() + 30 * 86400000) });
    res.json({ credential });
  }));
  router.post('/resume', wrap(async (req, res) => {
    if (!findUserByDevice || !valid(req.body.credential)) return res.sendStatus(401);
    const saved = await collection().findOne({ _id: hash(req.body.credential), kind: 'remembered', expiresAt: { $gt: new Date() } });
    if (!saved) return res.sendStatus(401);
    const user = await findUserByDevice(saved.deviceId);
    if (!user || user.isBanned || user.discordId !== saved.discordId || typeof user.token !== 'string' || hash(user.token) !== saved.sessionHash) return res.sendStatus(401);
    const id = random(), secret = random();
    await collection().insertOne({ _id: hash(id), secret: hash(secret), discordId: saved.discordId,
      status: 'approved', expiresAt: new Date(Date.now() + 300000) });
    res.json({ proof: id + '.' + secret });
  }));
  async function consume(proof) {
    if (typeof proof !== 'string') return null;
    const [id, secret] = proof.split('.');
    if (!valid(id) || !valid(secret)) return null;
    const session = await collection().findOneAndDelete({ _id: hash(id), secret: hash(secret),
      status: 'approved', expiresAt: { $gt: new Date() } });
    return session?.discordId || null;
  }
  return { router, consume };
};
