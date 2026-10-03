import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openDb } from '../src/db.js';
import { buildApp } from '../src/app.js';

const form = (o) => ({ method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded', ...o.headers }, body: new URLSearchParams(o.body).toString() });

test('registro, monitores y página de estado', async () => {
  const db = openDb(':memory:');
  const app = buildApp(db);

  let res = await app.request('/registro', form({ body: { email: 'Ana@Ejemplo.es', password: 'corta' } }));
  assert.match(await res.text(), /al menos 8 caracteres/);

  res = await app.request('/registro', form({ body: { email: 'ana@ejemplo.es', password: 'contraseña-segura' } }));
  assert.equal(res.status, 302);
  const cookie = res.headers.get('set-cookie').split(';')[0];

  res = await app.request('/app', { headers: { cookie } });
  assert.match(await res.text(), /Aún no tienes monitores/);
  assert.equal((await app.request('/app')).status, 302, 'sin sesión redirige');

  res = await app.request('/app/monitores', form({ headers: { cookie }, body: { name: 'Tienda', url: 'ftp://x', interval: '60' } }));
  assert.match(res.headers.get('location'), /error=/);

  for (let i = 0; i < 5; i++) {
    res = await app.request('/app/monitores', form({ headers: { cookie }, body: { name: `Web ${i}`, url: `https://web${i}.es`, interval: '30' } }));
    assert.equal(res.headers.get('location'), '/app');
  }
  res = await app.request('/app/monitores', form({ headers: { cookie }, body: { name: 'Sexta', url: 'https://sexta.es' } }));
  assert.match(decodeURIComponent(res.headers.get('location')), /permite 5 monitores/);
  assert.ok(db.prepare('SELECT MIN(interval_s) AS m FROM monitors').get().m >= 300, 'el plan gratis impone 5 min');

  const slug = db.prepare('SELECT status_slug FROM users').get().status_slug;
  res = await app.request(`/s/${slug}`);
  const html = await res.text();
  assert.match(html, /Web 0/);
  assert.match(html, /Monitorizado por/);

  // Otro usuario no puede ver ni borrar monitores ajenos
  res = await app.request('/registro', form({ body: { email: 'eve@ejemplo.es', password: 'otra-contraseña' } }));
  const evil = res.headers.get('set-cookie').split(';')[0];
  assert.equal((await app.request('/app/monitor/1', { headers: { cookie: evil } })).status, 404);
  await app.request('/app/monitor/1/borrar', form({ headers: { cookie: evil }, body: {} }));
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM monitors').get().n, 5);

  // CSRF desde otro origen
  res = await app.request('http://localhost/app/monitor/1/borrar', form({ headers: { cookie, origin: 'https://malo.com', host: 'localhost' }, body: {} }));
  assert.equal(res.status, 403);
});
