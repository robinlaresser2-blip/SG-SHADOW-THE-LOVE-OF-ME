'use strict';

module.exports = function requestDiagnostics(report = console.log) {
  let sequence = 0;
  return function diagnose(req, res, next) {
    const id = ++sequence;
    const started = process.hrtime.bigint();
    // Exclude query strings, headers, bodies and account identifiers.
    const path = (req.originalUrl || '/').split('?')[0];
    const route = path.startsWith('/action-emotes/')
      ? '/action-emotes/' + (['upgrade', 'level-up', 'equip-skin'].includes(path.split('/')[2]) ? path.split('/')[2] : 'other')
      : /^\/ranked\/game\/finish\/?$/i.test(path) ? '/ranked/game/finish'
      : /^\/ranked\/me\/?$/i.test(path) ? '/ranked/me'
      : /^\/round\/(?:eventfinish|finish)(?:\/|$)/i.test(path) ? '/round/finish'
      : path === '/health/diagnostics' ? path : '/other';
    report(`[RequestDiagnostics v1] #${id} START ${req.method} ${route}`);
    let completed = false;
    function end(event) {
      if (completed) return;
      completed = true;
      const ms = Number(process.hrtime.bigint() - started) / 1e6;
      report(`[RequestDiagnostics v1] #${id} ${event} status=${res.statusCode} durationMs=${ms.toFixed(1)}`);
    }
    res.once('finish', () => end('FINISH'));
    res.once('close', () => end('CLOSE'));
    next();
  };
};
