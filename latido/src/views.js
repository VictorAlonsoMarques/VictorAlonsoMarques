import { config } from './config.js';

export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const css = `
:root{--bg:#f7f8fa;--card:#fff;--text:#1a1d24;--muted:#646b78;--border:#e3e6eb;--accent:#e5484d;--up:#30a46c;--down:#e5484d;--pending:#a0a6b1}
@media (prefers-color-scheme:dark){:root{--bg:#111318;--card:#1a1d24;--text:#eceef2;--muted:#9aa1ad;--border:#2b2f38}}
*{box-sizing:border-box}body{margin:0;font:16px/1.5 system-ui,-apple-system,Segoe UI,Roboto,sans-serif;background:var(--bg);color:var(--text)}
a{color:inherit}main{max-width:960px;margin:0 auto;padding:24px 16px}
header.top{display:flex;justify-content:space-between;align-items:center;padding:16px;max-width:960px;margin:0 auto}
header.top nav a{margin-left:16px;text-decoration:none;color:var(--muted)}
.logo{font-weight:700;font-size:20px;text-decoration:none}.logo span{color:var(--accent)}
.card{background:var(--card);border:1px solid var(--border);border-radius:12px;padding:20px;margin-bottom:16px}
input,select{font:inherit;padding:10px 12px;border:1px solid var(--border);border-radius:8px;background:var(--bg);color:var(--text);width:100%}
label{display:block;margin:12px 0 4px;font-size:14px;color:var(--muted)}
button,.btn{font:inherit;display:inline-block;background:var(--accent);color:#fff;border:0;border-radius:8px;padding:10px 18px;cursor:pointer;text-decoration:none}
button.link{background:none;color:var(--muted);padding:0;text-decoration:underline}
.grid{display:grid;gap:12px;grid-template-columns:repeat(auto-fit,minmax(200px,1fr))}
table{width:100%;border-collapse:collapse}th,td{text-align:left;padding:10px 8px;border-bottom:1px solid var(--border);font-size:15px}
th{color:var(--muted);font-weight:500;font-size:13px}
.dot{display:inline-block;width:10px;height:10px;border-radius:50%;margin-right:8px;background:var(--pending)}
.dot.up{background:var(--up)}.dot.down{background:var(--down)}
.muted{color:var(--muted)}.err{background:#fde8e8;color:#9b1c1c;padding:10px 12px;border-radius:8px}.ok{background:#e3f5ea;color:#1b5e3a;padding:10px 12px;border-radius:8px}
.bars{display:flex;gap:2px;height:28px;align-items:stretch}.bars i{flex:1;border-radius:2px;background:var(--pending)}.bars i.up{background:var(--up)}.bars i.down{background:var(--down)}
.hero{text-align:center;padding:48px 0}.hero h1{font-size:40px;line-height:1.15;margin:0 0 16px}.hero p{font-size:19px;color:var(--muted);max-width:640px;margin:0 auto 24px}
.price{font-size:32px;font-weight:700}.table-wrap{overflow-x:auto}
footer{text-align:center;color:var(--muted);font-size:14px;padding:32px 16px}
`;

export function layout({ title, user, body, plain = false }) {
  const nav = plain ? '' : user
    ? `<nav><a href="/app">Monitores</a><a href="/app/plan">Plan</a><a href="/app/ajustes">Ajustes</a><form method="post" action="/salir" style="display:inline;margin-left:16px"><button class="link">Salir</button></form></nav>`
    : `<nav><a href="/entrar">Entrar</a><a href="/registro" class="btn" style="color:#fff">Empieza gratis</a></nav>`;
  return `<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)} · ${esc(config.brand)}</title><style>${css}</style></head><body>
<header class="top"><a class="logo" href="/">${esc(config.brand)}<span>.</span></a>${nav}</header>
<main>${body}</main>
<footer>${esc(config.brand)} · Monitorización de webs en español</footer></body></html>`;
}

export const fmtPct = (v) => (v === null || v === undefined ? '—' : `${v.toFixed(v === 100 ? 0 : 2)}%`);
export const statusLabel = { up: 'Funciona', down: 'Caída', pending: 'Pendiente' };

export function bars(checks) {
  const cells = checks.map((c) => `<i class="${c.ok ? 'up' : 'down'}" title="${esc(new Date(c.at).toLocaleString('es-ES'))}${c.error ? ' · ' + esc(c.error) : ''}"></i>`);
  while (cells.length < 60) cells.unshift('<i></i>');
  return `<div class="bars">${cells.join('')}</div>`;
}
