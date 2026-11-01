'use strict';
const labels = Object.freeze({ approved: 'Discord authorization approved', cancelled: 'Discord authorization cancelled', unavailable: 'Discord service error', game_success: 'Discord game login succeeded', game_failure: 'Discord game login failed' });
module.exports = function createLogger({ env = process.env, fetchImpl = fetch, now = Date.now } = {}) {
  let next = 0, active = false;
  return function report(event, details = {}) {
    if (!labels[event] || !env.DISCORD_LOGIN_WEBHOOK_URL || active || now() < next) return;
    let url;
    try { url = new URL(env.DISCORD_LOGIN_WEBHOOK_URL); } catch { return; }
    if (url.protocol !== 'https:' || url.hostname !== 'discord.com' || url.port || url.username || url.password || !/^\/api\/webhooks\/\d+\/[\w-]+$/.test(url.pathname)) return;
    const success = event === 'approved' || event === 'game_success';
    const fields = [
      { name: 'Stage', value: event.startsWith('game_') ? 'Game login' : 'Discord authorization', inline: true },
      { name: 'Result', value: success ? 'Success' : event === 'cancelled' ? 'Cancelled' : 'Failed', inline: true },
      { name: 'Login policy', value: env.DISCORD_LOGIN_REQUIRED === '1' ? 'Required' : 'Optional / private test', inline: true }
    ];
    if (Number.isInteger(details.httpStatus) && details.httpStatus >= 100 && details.httpStatus <= 599)
      fields.push({ name: 'HTTP status', value: String(details.httpStatus), inline: true });
    if (Number.isFinite(details.durationMs) && details.durationMs >= 0)
      fields.push({ name: 'Request duration', value: Math.min(Math.round(details.durationMs), 3600000) + ' ms', inline: true });
    const payload = { allowed_mentions: { parse: [] }, embeds: [{
      title: labels[event], color: success ? 0x2ecc71 : event === 'cancelled' ? 0xf1c40f : 0xe74c3c,
      fields, timestamp: new Date(now()).toISOString(), footer: { text: 'Stumble Ultimate • Login reports' }
    }] };
    active = true; next = now() + 3000;
    Promise.resolve().then(() => fetchImpl(url.href, { method: 'POST', redirect: 'error', signal: AbortSignal.timeout(5000), headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) }))
      .then(response => { if (!response.ok) next = now() + 60000; })
      .catch(() => { next = now() + 60000; })
      .finally(() => { active = false; });
  };
};