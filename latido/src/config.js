// Configuración leída de variables de entorno.
export const config = {
  port: Number(process.env.PORT || 3000),
  baseUrl: (process.env.BASE_URL || 'http://localhost:3000').replace(/\/$/, ''),
  brand: process.env.BRAND_NAME || 'Latido',
  dbPath: process.env.DB_PATH || './data/latido.db',
  smtp: {
    host: process.env.SMTP_HOST || '',
    port: Number(process.env.SMTP_PORT || 587),
    user: process.env.SMTP_USER || '',
    pass: process.env.SMTP_PASS || '',
    from: process.env.SMTP_FROM || 'alertas@localhost',
  },
  telegramToken: process.env.TELEGRAM_BOT_TOKEN || '',
  stripe: {
    secretKey: process.env.STRIPE_SECRET_KEY || '',
    webhookSecret: process.env.STRIPE_WEBHOOK_SECRET || '',
    prices: { pro: process.env.STRIPE_PRICE_PRO || '', agency: process.env.STRIPE_PRICE_AGENCY || '' },
  },
  checkerEnabled: process.env.CHECKER_ENABLED !== 'false',
};

// Límites por plan. Los planes de pago se activan desde los webhooks de Stripe.
export const plans = {
  free: { name: 'Gratis', maxMonitors: 5, minInterval: 300 },
  pro: { name: 'Pro', maxMonitors: 50, minInterval: 60 },
  agency: { name: 'Agencia', maxMonitors: 200, minInterval: 30 },
};
