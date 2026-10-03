import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';

process.env.ALLOW_PRIVATE_TARGETS = 'true';
const { openDb } = await import('../src/db.js');
const { runCheck } = await import('../src/checker.js');

test('detecta caída y recuperación con incidencia', async () => {
  let mode = 'ok';
  const srv = http.createServer((req, res) => {
    if (mode === 'ok') res.end('<h1>Hola tienda</h1>');
    else { res.statusCode = 500; res.end('error'); }
  });
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  const url = `http://127.0.0.1:${srv.address().port}/`;
  const db = openDb(':memory:');
  db.prepare("INSERT INTO users (email, password_hash, status_slug, created_at, notify_email) VALUES ('a@b.es', 'x', 's', 0, 0)").run();
  db.prepare('INSERT INTO monitors (user_id, name, url, keyword, interval_s, created_at) VALUES (1, ?, ?, ?, 60, 0)').run('Tienda', url, 'tienda');
  const get = () => db.prepare('SELECT * FROM monitors WHERE id = 1').get();

  assert.equal((await runCheck(db, get(), { retryDelayMs: 0 })).ok, true);
  assert.equal(get().status, 'up');

  mode = 'fail';
  const r = await runCheck(db, get(), { retryDelayMs: 0 });
  assert.equal(r.error, 'HTTP 500');
  assert.equal(get().status, 'down');
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM incidents WHERE resolved_at IS NULL').get().n, 1);

  mode = 'ok';
  await runCheck(db, get(), { retryDelayMs: 0 });
  assert.equal(get().status, 'up');
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM incidents WHERE resolved_at IS NOT NULL').get().n, 1);

  db.prepare("UPDATE monitors SET keyword = 'inexistente'").run();
  assert.match((await runCheck(db, get(), { retryDelayMs: 0 })).error, /No aparece/);
  srv.close();
});
