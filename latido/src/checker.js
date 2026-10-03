import tls from 'node:tls';
import { Agent, buildConnector, fetch } from 'undici';
import { config } from './config.js';
import { notify } from './notify.js';
import { safeLookup, checkIpLiteral } from './netguard.js';

const TIMEOUT_MS = 15000;
const SSL_WARN_DAYS = 14;
const connector = buildConnector({ lookup: safeLookup, timeout: TIMEOUT_MS });
const dispatcher = new Agent({
  connect: (opts, cb) => {
    const err = checkIpLiteral(opts.hostname);
    return err ? cb(err, null) : connector(opts, cb);
  },
});

// Una comprobación HTTP. Devuelve { ok, ms, error }.
export async function httpCheck(url, keyword) {
  const start = Date.now();
  try {
    const res = await fetch(url, {
      dispatcher,
      redirect: 'follow',
      signal: AbortSignal.timeout(TIMEOUT_MS),
      headers: { 'user-agent': `${config.brand}Monitor/1.0 (+${config.baseUrl})` },
    });
    const body = keyword ? await res.text() : (await res.body?.cancel(), '');
    const ms = Date.now() - start;
    if (res.status >= 400) return { ok: false, ms, error: `HTTP ${res.status}` };
    if (keyword && !body.includes(keyword)) return { ok: false, ms, error: `No aparece la palabra "${keyword}"` };
    return { ok: true, ms, error: null };
  } catch (e) {
    const cause = e.cause?.message || e.message;
    return { ok: false, ms: Date.now() - start, error: e.name === 'TimeoutError' ? 'Tiempo de espera agotado' : cause };
  }
}

// Fecha de caducidad (ms) del certificado TLS, o null.
export function sslExpiry(url) {
  const u = new URL(url);
  if (u.protocol !== 'https:' || checkIpLiteral(u.hostname)) return Promise.resolve(null);
  return new Promise((resolve) => {
    const sock = tls.connect({
      host: u.hostname, port: Number(u.port || 443), servername: u.hostname,
      lookup: safeLookup, rejectUnauthorized: false, timeout: TIMEOUT_MS,
    }, () => {
      const cert = sock.getPeerCertificate();
      sock.end();
      resolve(cert?.valid_to ? Date.parse(cert.valid_to) : null);
    });
    sock.on('error', () => resolve(null));
    sock.on('timeout', () => { sock.destroy(); resolve(null); });
  });
}

export async function runCheck(db, monitor, { retryDelayMs = 3000 } = {}) {
  let r = await httpCheck(monitor.url, monitor.keyword);
  // Reintento antes de dar la web por caída, para evitar falsas alarmas.
  if (!r.ok && retryDelayMs >= 0) {
    await new Promise((s) => setTimeout(s, retryDelayMs));
    r = await httpCheck(monitor.url, monitor.keyword);
  }
  const now = Date.now();
  const newStatus = r.ok ? 'up' : 'down';
  db.prepare('INSERT INTO checks (monitor_id, at, ok, response_ms, error) VALUES (?, ?, ?, ?, ?)')
    .run(monitor.id, now, r.ok ? 1 : 0, r.ms, r.error);
  db.prepare('UPDATE monitors SET status = ?, last_checked_at = ?, last_response_ms = ?, last_error = ? WHERE id = ?')
    .run(newStatus, now, r.ms, r.error, monitor.id);

  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(monitor.user_id);
  const link = `${config.baseUrl}/app`;
  if (newStatus === 'down' && monitor.status !== 'down') {
    db.prepare('INSERT INTO incidents (monitor_id, started_at, cause) VALUES (?, ?, ?)').run(monitor.id, now, r.error);
    await notify(user, `🔴 ${monitor.name} está caída`, `${monitor.url}\nMotivo: ${r.error}\n\n${link}`);
  } else if (newStatus === 'up' && monitor.status === 'down') {
    const inc = db.prepare('SELECT * FROM incidents WHERE monitor_id = ? AND resolved_at IS NULL ORDER BY id DESC').get(monitor.id);
    if (inc) db.prepare('UPDATE incidents SET resolved_at = ? WHERE id = ?').run(now, inc.id);
    const mins = inc ? Math.max(1, Math.round((now - inc.started_at) / 60000)) : null;
    await notify(user, `🟢 ${monitor.name} vuelve a funcionar`, `${monitor.url}${mins ? `\nCaída durante ~${mins} min` : ''}\n\n${link}`);
  }

  // Certificado SSL: como mucho una vez cada 12 h.
  if (r.ok && monitor.url.startsWith('https:') && (!monitor.ssl_checked_at || now - monitor.ssl_checked_at > 12 * 3600e3)) {
    const exp = await sslExpiry(monitor.url);
    db.prepare('UPDATE monitors SET ssl_expires_at = ?, ssl_checked_at = ? WHERE id = ?').run(exp, now, monitor.id);
    const days = exp ? (exp - now) / 86400e3 : null;
    if (days !== null && days < SSL_WARN_DAYS && (!monitor.ssl_warned_at || now - monitor.ssl_warned_at > 7 * 86400e3)) {
      db.prepare('UPDATE monitors SET ssl_warned_at = ? WHERE id = ?').run(now, monitor.id);
      await notify(user, `⚠️ El certificado SSL de ${monitor.name} caduca pronto`,
        `${monitor.url}\nCaduca en ${Math.floor(days)} días (${new Date(exp).toLocaleDateString('es-ES')}).`);
    }
  }
  return r;
}

// Bucle principal: cada 10 s lanza las comprobaciones que tocan, con concurrencia limitada.
export function startChecker(db, { concurrency = 20 } = {}) {
  const running = new Set();
  const tick = async () => {
    const now = Date.now();
    const due = db.prepare(
      'SELECT * FROM monitors WHERE last_checked_at IS NULL OR last_checked_at + interval_s * 1000 <= ? ORDER BY last_checked_at LIMIT 200',
    ).all(now);
    for (const m of due) {
      if (running.has(m.id) || running.size >= concurrency) continue;
      running.add(m.id);
      runCheck(db, m).catch((e) => console.error('Error en comprobación', m.id, e)).finally(() => running.delete(m.id));
    }
    // Limpieza: guardamos 90 días de historial.
    if (Math.random() < 0.01) db.prepare('DELETE FROM checks WHERE at < ?').run(now - 90 * 86400e3);
  };
  const timer = setInterval(tick, 10000);
  tick();
  return () => clearInterval(timer);
}
