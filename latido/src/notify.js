import nodemailer from 'nodemailer';
import { config } from './config.js';

let transport;
function mailer() {
  if (!config.smtp.host) return null;
  transport ??= nodemailer.createTransport({
    host: config.smtp.host,
    port: config.smtp.port,
    secure: config.smtp.port === 465,
    auth: config.smtp.user ? { user: config.smtp.user, pass: config.smtp.pass } : undefined,
  });
  return transport;
}

// Envía la alerta por los canales que tenga configurados el usuario.
// Los fallos se registran pero nunca rompen el bucle de comprobaciones.
export async function notify(user, subject, text) {
  const jobs = [];
  const m = mailer();
  if (m && user.notify_email) {
    jobs.push(m.sendMail({ from: config.smtp.from, to: user.email, subject: `[${config.brand}] ${subject}`, text }));
  }
  if (config.telegramToken && user.telegram_chat_id) {
    jobs.push(fetch(`https://api.telegram.org/bot${config.telegramToken}/sendMessage`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ chat_id: user.telegram_chat_id, text: `${subject}\n\n${text}` }),
    }));
  }
  if (!jobs.length) console.log(`[alerta sin canal] ${user.email}: ${subject}`);
  for (const r of await Promise.allSettled(jobs)) {
    if (r.status === 'rejected') console.error('Error enviando alerta:', r.reason?.message || r.reason);
  }
}
