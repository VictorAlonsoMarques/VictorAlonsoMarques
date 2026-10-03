import { test } from 'node:test';
import assert from 'node:assert/strict';

process.env.STRIPE_SECRET_KEY = 'sk_test_dummy';
process.env.STRIPE_WEBHOOK_SECRET = 'whsec_test';
process.env.STRIPE_PRICE_PRO = 'price_pro';
process.env.STRIPE_PRICE_AGENCY = 'price_agency';
const { openDb } = await import('../src/db.js');
const { buildApp } = await import('../src/app.js');
const { stripe } = await import('../src/billing.js');
const { createUser, createResetToken, verifyUser } = await import('../src/auth.js');

const sendEvent = (app, event) => {
  const payload = JSON.stringify(event);
  const header = stripe.webhooks.generateTestHeaderString({ payload, secret: 'whsec_test' });
  return app.request('/stripe/webhook', { method: 'POST', headers: { 'stripe-signature': header }, body: payload });
};
const sub = (type, status, price) => ({
  id: 'evt_1', type,
  data: { object: { id: 'sub_1', customer: 'cus_1', status, metadata: { user_id: '1' }, items: { data: [{ price: { id: price } }] } } },
});

test('webhooks de Stripe activan y cancelan planes', async () => {
  const db = openDb(':memory:');
  const app = buildApp(db);
  createUser(db, 'ana@ejemplo.es', 'contraseña-segura');
  db.prepare("INSERT INTO monitors (user_id, name, url, interval_s, created_at) VALUES (1, 'w', 'https://w.es', 300, 0)").run();
  const plan = () => db.prepare('SELECT plan FROM users WHERE id = 1').get().plan;

  const bad = await app.request('/stripe/webhook', { method: 'POST', headers: { 'stripe-signature': 't=1,v1=x' }, body: '{}' });
  assert.equal(bad.status, 400);

  assert.equal((await sendEvent(app, sub('customer.subscription.created', 'active', 'price_pro'))).status, 200);
  assert.equal(plan(), 'pro');
  assert.equal(db.prepare('SELECT stripe_customer_id FROM users').get().stripe_customer_id, 'cus_1');

  await sendEvent(app, sub('customer.subscription.updated', 'active', 'price_agency'));
  assert.equal(plan(), 'agency');
  db.prepare('UPDATE monitors SET interval_s = 30').run();

  await sendEvent(app, sub('customer.subscription.deleted', 'canceled', 'price_agency'));
  assert.equal(plan(), 'free');
  assert.equal(db.prepare('SELECT interval_s FROM monitors').get().interval_s, 300, 'al bajar de plan se ajusta el intervalo');
});

test('recuperar contraseña con enlace de un solo uso', async () => {
  const db = openDb(':memory:');
  const app = buildApp(db);
  createUser(db, 'ana@ejemplo.es', 'contraseña-vieja');
  const form = (path, body) => app.request(path, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(body).toString() });

  assert.equal(createResetToken(db, 'nadie@ejemplo.es'), null);
  const res = await form('/recuperar', { email: 'nadie@ejemplo.es' });
  assert.match(await res.text(), /Si hay una cuenta/);

  const token = createResetToken(db, 'ana@ejemplo.es');
  assert.equal((await form('/restablecer', { token, password: 'contraseña-nueva' })).status, 302);
  assert.ok(verifyUser(db, 'ana@ejemplo.es', 'contraseña-nueva'));
  assert.equal(verifyUser(db, 'ana@ejemplo.es', 'contraseña-vieja'), null);
  assert.match(await (await form('/restablecer', { token, password: 'otra-mas-nueva' })).text(), /no es válido/);
});
