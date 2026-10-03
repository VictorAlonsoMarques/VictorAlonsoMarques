import Stripe from 'stripe';
import { config, plans } from './config.js';

export const stripe = config.stripe.secretKey ? new Stripe(config.stripe.secretKey) : null;

const planForPrice = (priceId) =>
  Object.entries(config.stripe.prices).find(([, id]) => id && id === priceId)?.[0] || null;

// Cambia el plan y ajusta los intervalos al mínimo que permite el nuevo plan.
export function setPlan(db, userId, plan) {
  const p = plans[plan] || plans.free;
  db.prepare('UPDATE users SET plan = ? WHERE id = ?').run(plans[plan] ? plan : 'free', userId);
  db.prepare('UPDATE monitors SET interval_s = MAX(interval_s, ?) WHERE user_id = ?').run(p.minInterval, userId);
}

export async function checkoutUrl(db, user, plan) {
  const price = config.stripe.prices[plan];
  if (!stripe || !price) throw new Error('Los pagos todavía no están configurados.');
  const session = await stripe.checkout.sessions.create({
    mode: 'subscription',
    line_items: [{ price, quantity: 1 }],
    client_reference_id: String(user.id),
    ...(user.stripe_customer_id ? { customer: user.stripe_customer_id } : { customer_email: user.email }),
    subscription_data: { metadata: { user_id: String(user.id) } },
    automatic_tax: { enabled: process.env.STRIPE_AUTOMATIC_TAX === 'true' },
    tax_id_collection: { enabled: true },
    allow_promotion_codes: true,
    locale: 'es',
    success_url: `${config.baseUrl}/app/plan?ok=1`,
    cancel_url: `${config.baseUrl}/app/plan`,
  });
  return session.url;
}

export async function portalUrl(user) {
  if (!stripe || !user.stripe_customer_id) throw new Error('No tienes ninguna suscripción.');
  const s = await stripe.billingPortal.sessions.create({ customer: user.stripe_customer_id, locale: 'es', return_url: `${config.baseUrl}/app/plan` });
  return s.url;
}

export async function verifyWebhook(rawBody, signature) {
  if (!stripe || !config.stripe.webhookSecret) throw new Error('Stripe no configurado');
  return stripe.webhooks.constructEventAsync(rawBody, signature, config.stripe.webhookSecret);
}

export function handleEvent(db, event) {
  const obj = event.data.object;
  if (event.type === 'checkout.session.completed') {
    const userId = Number(obj.client_reference_id);
    if (userId) db.prepare('UPDATE users SET stripe_customer_id = ?, stripe_subscription_id = ? WHERE id = ?').run(obj.customer, obj.subscription, userId);
    return;
  }
  if (!event.type.startsWith('customer.subscription.')) return;
  const user = db.prepare('SELECT id FROM users WHERE id = ? OR stripe_customer_id = ?').get(Number(obj.metadata?.user_id) || -1, obj.customer);
  if (!user) return;
  db.prepare('UPDATE users SET stripe_customer_id = ?, stripe_subscription_id = ? WHERE id = ?').run(obj.customer, obj.id, user.id);
  // past_due mantiene el plan mientras Stripe reintenta el cobro.
  const active = event.type !== 'customer.subscription.deleted' && ['active', 'trialing', 'past_due'].includes(obj.status);
  setPlan(db, user.id, active ? planForPrice(obj.items?.data?.[0]?.price?.id) || 'free' : 'free');
}
