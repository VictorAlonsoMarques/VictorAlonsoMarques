import { Hono } from 'hono';
import { getCookie, setCookie, deleteCookie } from 'hono/cookie';
import { config, plans } from './config.js';
import { uptime } from './db.js';
import { createUser, verifyUser, createSession, userFromSession, deleteSession } from './auth.js';
import { layout, esc, fmtPct, statusLabel, bars } from './views.js';

const COOKIE = 'sid';
const DAY = 86400e3;

export function buildApp(db) {
  const app = new Hono();

  // Protección CSRF: los POST deben venir de nuestro propio origen.
  app.use('*', async (c, next) => {
    if (c.req.method === 'POST') {
      const origin = c.req.header('origin');
      const host = c.req.header('x-forwarded-host') || c.req.header('host');
      if (origin && new URL(origin).host !== host) return c.text('Origen no permitido', 403);
    }
    c.set('user', userFromSession(db, getCookie(c, COOKIE)));
    await next();
  });

  const requireUser = async (c, next) => (c.get('user') ? next() : c.redirect('/entrar'));
  const page = (c, title, body, extra = {}) => c.html(layout({ title, user: c.get('user'), body, ...extra }));
  const login = (c, userId) => {
    setCookie(c, COOKIE, createSession(db, userId), {
      httpOnly: true, sameSite: 'Lax', secure: config.baseUrl.startsWith('https'), path: '/', maxAge: 30 * 86400,
    });
    return c.redirect('/app');
  };

  app.get('/health', (c) => c.text('ok'));

  app.get('/', (c) => page(c, 'Monitoriza tu web', `
    <section class="hero">
      <h1>Entérate de que tu web se ha caído<br>antes que tus clientes</h1>
      <p>Comprobamos tu web cada minuto y te avisamos por email o Telegram si deja de funcionar o si el certificado SSL va a caducar. Con página de estado pública para tus clientes. Todo en español.</p>
      <a class="btn" href="/registro">Empieza gratis</a> <span class="muted" style="margin-left:8px">Sin tarjeta</span>
    </section>
    <div class="grid">
      <div class="card"><h3>Avisos al instante</h3><p class="muted">Email y Telegram en cuanto tu web falla, y otro aviso cuando vuelve.</p></div>
      <div class="card"><h3>Página de estado</h3><p class="muted">Una página pública con el estado de tus servicios para compartir con tus clientes.</p></div>
      <div class="card"><h3>Certificados SSL</h3><p class="muted">Te avisamos 14 días antes de que caduque tu certificado.</p></div>
      <div class="card"><h3>Datos en Europa</h3><p class="muted">Servidores en la UE y cumplimiento del RGPD.</p></div>
    </div>
    <h2 style="text-align:center;margin-top:40px">Precios</h2>
    <div class="grid">
      <div class="card"><h3>Gratis</h3><div class="price">0 €</div><p class="muted">5 monitores · cada 5 min · email y Telegram · página de estado</p></div>
      <div class="card"><h3>Pro</h3><div class="price">9 €<small class="muted">/mes</small></div><p class="muted">50 monitores · cada minuto · dominio propio en la página de estado</p></div>
      <div class="card"><h3>Agencia</h3><div class="price">29 €<small class="muted">/mes</small></div><p class="muted">200 monitores · marca blanca · informes mensuales en PDF para tus clientes</p></div>
    </div>`));

  const authForm = (action, title, button, error, alt) => `
    <div class="card" style="max-width:420px;margin:40px auto">
      <h2>${title}</h2>${error ? `<p class="err">${esc(error)}</p>` : ''}
      <form method="post" action="${action}">
        <label>Email</label><input name="email" type="email" required autocomplete="email">
        <label>Contraseña</label><input name="password" type="password" required minlength="8">
        <p><button>${button}</button></p>
      </form><p class="muted">${alt}</p></div>`;

  app.get('/registro', (c) => page(c, 'Crear cuenta', authForm('/registro', 'Crea tu cuenta gratis', 'Crear cuenta', null, '¿Ya tienes cuenta? <a href="/entrar">Entra</a>')));
  app.post('/registro', async (c) => {
    const f = await c.req.parseBody();
    try {
      return login(c, createUser(db, f.email, f.password));
    } catch (e) {
      return page(c, 'Crear cuenta', authForm('/registro', 'Crea tu cuenta gratis', 'Crear cuenta', e.message, '¿Ya tienes cuenta? <a href="/entrar">Entra</a>'));
    }
  });
  app.get('/entrar', (c) => page(c, 'Entrar', authForm('/entrar', 'Entrar', 'Entrar', null, '¿No tienes cuenta? <a href="/registro">Regístrate gratis</a>')));
  app.post('/entrar', async (c) => {
    const f = await c.req.parseBody();
    const u = verifyUser(db, f.email, f.password);
    if (!u) return page(c, 'Entrar', authForm('/entrar', 'Entrar', 'Entrar', 'Email o contraseña incorrectos.', '¿No tienes cuenta? <a href="/registro">Regístrate gratis</a>'));
    return login(c, u.id);
  });
  app.post('/salir', (c) => {
    const t = getCookie(c, COOKIE);
    if (t) deleteSession(db, t);
    deleteCookie(c, COOKIE, { path: '/' });
    return c.redirect('/');
  });

  // Panel
  app.get('/app', requireUser, (c) => {
    const u = c.get('user');
    const plan = plans[u.plan] || plans.free;
    const monitors = db.prepare('SELECT * FROM monitors WHERE user_id = ? ORDER BY name').all(u.id);
    const now = Date.now();
    const rows = monitors.map((m) => {
      const sslDays = m.ssl_expires_at ? Math.floor((m.ssl_expires_at - now) / DAY) : null;
      return `<tr>
        <td><span class="dot ${m.status}"></span><a href="/app/monitor/${m.id}">${esc(m.name)}</a><br><small class="muted">${esc(m.url)}</small></td>
        <td>${statusLabel[m.status]}${m.last_error && m.status === 'down' ? `<br><small class="muted">${esc(m.last_error)}</small>` : ''}</td>
        <td>${fmtPct(uptime(db, m.id, now - DAY))}</td><td>${fmtPct(uptime(db, m.id, now - 30 * DAY))}</td>
        <td>${m.last_response_ms != null ? m.last_response_ms + ' ms' : '—'}</td>
        <td>${sslDays === null ? '—' : sslDays + ' días'}</td></tr>`;
    }).join('');
    const msg = c.req.query('error') ? `<p class="err">${esc(c.req.query('error'))}</p>` : '';
    const intervals = [30, 60, 300, 600, 1800].filter((s) => s >= plan.minInterval);
    return page(c, 'Monitores', `
      <h1>Tus monitores</h1>
      <p class="muted">Plan ${plan.name}: ${monitors.length} de ${plan.maxMonitors} monitores. Tu página de estado: <a href="/s/${u.status_slug}" target="_blank">${config.baseUrl}/s/${u.status_slug}</a></p>
      ${msg}
      <div class="card table-wrap">${monitors.length ? `<table><tr><th>Monitor</th><th>Estado</th><th>24 h</th><th>30 días</th><th>Respuesta</th><th>SSL</th></tr>${rows}</table>` : '<p class="muted">Aún no tienes monitores. Añade tu primera web abajo.</p>'}</div>
      <div class="card"><h3>Añadir monitor</h3>
        <form method="post" action="/app/monitores"><div class="grid">
          <div><label>Nombre</label><input name="name" required maxlength="80" placeholder="Mi tienda"></div>
          <div><label>URL</label><input name="url" type="url" required placeholder="https://ejemplo.es"></div>
          <div><label>Cada</label><select name="interval">${intervals.map((s) => `<option value="${s}" ${s === Math.max(300, plan.minInterval) ? 'selected' : ''}>${s < 60 ? s + ' s' : s / 60 + ' min'}</option>`).join('')}</select></div>
          <div><label>Palabra que debe aparecer (opcional)</label><input name="keyword" maxlength="200"></div>
        </div><p><button>Añadir</button></p></form></div>`);
  });

  app.post('/app/monitores', requireUser, async (c) => {
    const u = c.get('user');
    const plan = plans[u.plan] || plans.free;
    const f = await c.req.parseBody();
    const fail = (m) => c.redirect('/app?error=' + encodeURIComponent(m));
    const count = db.prepare('SELECT COUNT(*) AS n FROM monitors WHERE user_id = ?').get(u.id).n;
    if (count >= plan.maxMonitors) return fail(`Tu plan permite ${plan.maxMonitors} monitores.`);
    let url;
    try { url = new URL(String(f.url).trim()); } catch { return fail('La URL no es válida.'); }
    if (!['http:', 'https:'].includes(url.protocol)) return fail('La URL debe empezar por http:// o https://');
    const name = String(f.name || '').trim().slice(0, 80) || url.hostname;
    const interval = Math.max(plan.minInterval, Number(f.interval) || 300);
    const keyword = String(f.keyword || '').trim().slice(0, 200) || null;
    db.prepare('INSERT INTO monitors (user_id, name, url, keyword, interval_s, created_at) VALUES (?, ?, ?, ?, ?, ?)')
      .run(u.id, name, url.href, keyword, interval, Date.now());
    return c.redirect('/app');
  });

  const ownMonitor = (c) => db.prepare('SELECT * FROM monitors WHERE id = ? AND user_id = ?').get(Number(c.req.param('id')), c.get('user').id);

  app.get('/app/monitor/:id', requireUser, (c) => {
    const m = ownMonitor(c);
    if (!m) return c.notFound();
    const checks = db.prepare('SELECT * FROM checks WHERE monitor_id = ? ORDER BY at DESC LIMIT 60').all(m.id).reverse();
    const incidents = db.prepare('SELECT * FROM incidents WHERE monitor_id = ? ORDER BY started_at DESC LIMIT 20').all(m.id);
    const fmt = (t) => new Date(t).toLocaleString('es-ES');
    return page(c, m.name, `
      <p><a href="/app">← Monitores</a></p>
      <h1><span class="dot ${m.status}"></span>${esc(m.name)}</h1>
      <p class="muted">${esc(m.url)} · cada ${m.interval_s < 60 ? m.interval_s + ' s' : m.interval_s / 60 + ' min'}${m.keyword ? ` · palabra "${esc(m.keyword)}"` : ''}</p>
      <div class="card"><h3>Últimas comprobaciones</h3>${bars(checks)}</div>
      <div class="card table-wrap"><h3>Incidencias</h3>${incidents.length ? `<table><tr><th>Inicio</th><th>Fin</th><th>Motivo</th></tr>${incidents.map((i) => `<tr><td>${fmt(i.started_at)}</td><td>${i.resolved_at ? fmt(i.resolved_at) : '<b>En curso</b>'}</td><td>${esc(i.cause)}</td></tr>`).join('')}</table>` : '<p class="muted">Sin incidencias. 🎉</p>'}</div>
      <div class="card">
        <form method="post" action="/app/monitor/${m.id}/publico"><button class="link">${m.public ? 'Ocultar de la página de estado' : 'Mostrar en la página de estado'}</button></form>
        <form method="post" action="/app/monitor/${m.id}/borrar" onsubmit="return confirm('¿Borrar este monitor y su historial?')" style="margin-top:12px"><button class="link" style="color:var(--down)">Borrar monitor</button></form>
      </div>`);
  });
  app.post('/app/monitor/:id/publico', requireUser, (c) => {
    const m = ownMonitor(c);
    if (m) db.prepare('UPDATE monitors SET public = 1 - public WHERE id = ?').run(m.id);
    return c.redirect(`/app/monitor/${m?.id ?? ''}`);
  });
  app.post('/app/monitor/:id/borrar', requireUser, (c) => {
    const m = ownMonitor(c);
    if (m) db.prepare('DELETE FROM monitors WHERE id = ?').run(m.id);
    return c.redirect('/app');
  });

  app.get('/app/ajustes', requireUser, (c) => {
    const u = c.get('user');
    const saved = c.req.query('ok') ? '<p class="ok">Guardado.</p>' : '';
    return page(c, 'Ajustes', `
      <h1>Ajustes</h1>${saved}
      <div class="card"><form method="post" action="/app/ajustes">
        <label>Título de la página de estado</label><input name="status_title" maxlength="80" value="${esc(u.status_title)}">
        <label><input type="checkbox" name="notify_email" value="1" ${u.notify_email ? 'checked' : ''} style="width:auto"> Avisarme por email (${esc(u.email)})</label>
        <label>ID de chat de Telegram</label><input name="telegram_chat_id" maxlength="40" value="${esc(u.telegram_chat_id)}" placeholder="123456789">
        <p class="muted" style="font-size:14px">Escribe a nuestro bot de Telegram y pega aquí el ID de chat que te responda.</p>
        <p><button>Guardar</button></p></form></div>`);
  });
  app.post('/app/ajustes', requireUser, async (c) => {
    const f = await c.req.parseBody();
    db.prepare('UPDATE users SET status_title = ?, notify_email = ?, telegram_chat_id = ? WHERE id = ?').run(
      String(f.status_title || '').trim().slice(0, 80) || 'Estado de los servicios',
      f.notify_email ? 1 : 0,
      String(f.telegram_chat_id || '').replace(/[^0-9-]/g, '') || null,
      c.get('user').id);
    return c.redirect('/app/ajustes?ok=1');
  });

  // Página de estado pública
  app.get('/s/:slug', (c) => {
    const u = db.prepare('SELECT * FROM users WHERE status_slug = ?').get(c.req.param('slug'));
    if (!u) return c.notFound();
    const monitors = db.prepare('SELECT * FROM monitors WHERE user_id = ? AND public = 1 ORDER BY name').all(u.id);
    const allUp = monitors.every((m) => m.status !== 'down');
    const now = Date.now();
    const items = monitors.map((m) => {
      const checks = db.prepare('SELECT ok, at, error FROM checks WHERE monitor_id = ? ORDER BY at DESC LIMIT 60').all(m.id).reverse();
      return `<div class="card"><div style="display:flex;justify-content:space-between"><b><span class="dot ${m.status}"></span>${esc(m.name)}</b><span class="muted">${fmtPct(uptime(db, m.id, now - 30 * DAY))} en 30 días</span></div><div style="margin-top:12px">${bars(checks)}</div></div>`;
    }).join('');
    const powered = u.plan === 'agency' ? '' : `<p class="muted" style="text-align:center">Monitorizado por <a href="${config.baseUrl}/?ref=status">${esc(config.brand)}</a></p>`;
    return c.html(layout({ title: u.status_title, plain: true, body: `
      <h1>${esc(u.status_title)}</h1>
      <div class="card ${allUp ? 'ok' : 'err'}" style="border:0">${allUp ? 'Todos los servicios funcionan con normalidad.' : 'Algunos servicios tienen problemas.'}</div>
      ${items || '<p class="muted">No hay servicios publicados.</p>'}${powered}` }));
  });

  return app;
}
