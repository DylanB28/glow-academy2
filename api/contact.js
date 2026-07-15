import { Resend } from 'resend';
import { cleanText, requestFingerprint, requireMethod, sendJson, supabaseAdmin } from './_lib/server.js';

const resend = new Resend(process.env.RESEND_API_KEY);

function escapeHtml(value) {
  return String(value).replace(/[&<>'"]/g, character => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;'
  }[character]));
}

export default async function handler(req, res) {
  if (!requireMethod(req, res, 'POST')) return;

  const name = cleanText(req.body?.name, 80);
  const email = cleanText(req.body?.email, 160).toLowerCase();
  const message = cleanText(req.body?.message, 3000);
  const website = cleanText(req.body?.website, 120);
  if (website) return sendJson(res, 200, { success: true });
  if (name.length < 2 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || message.length < 10) {
    return sendJson(res, 400, { error: 'Check your name, email address and message.' });
  }

  try {
    const fingerprint = requestFingerprint(req, [email]);
    const globalFingerprint = requestFingerprint(req, ['contact-global']);
    const since = new Date(Date.now() - 60 * 60 * 1000).toISOString();
    const [specificRate, globalRate] = await Promise.all([
      supabaseAdmin.from('contact_submissions').select('id', { count: 'exact', head: true })
        .eq('fingerprint', fingerprint).gte('created_at', since),
      supabaseAdmin.from('contact_submissions').select('id', { count: 'exact', head: true })
        .eq('fingerprint', globalFingerprint).gte('created_at', since)
    ]);
    if (specificRate.error) throw specificRate.error;
    if (globalRate.error) throw globalRate.error;
    if ((specificRate.count || 0) >= 5 || (globalRate.count || 0) >= 20) {
      return sendJson(res, 429, { error: 'Too many messages. Please try again later.' });
    }

    const delivery = await resend.emails.send({
      from: process.env.CONTACT_FROM_EMAIL || 'Gem Glow Academy <hello@gemglowacademy.com>',
      to: process.env.CONTACT_TO_EMAIL || 'contactmightyminds@gmail.com',
      subject: `Gem Glow support message from ${name}`,
      replyTo: email,
      html: `<h2>New support message</h2><p><strong>Name:</strong> ${escapeHtml(name)}</p><p><strong>Email:</strong> ${escapeHtml(email)}</p><p><strong>Message:</strong></p><p>${escapeHtml(message).replace(/\n/g, '<br>')}</p>`
    });
    if (delivery?.error) throw new Error(delivery.error.message || 'Email delivery failed.');

    const emailHash = requestFingerprint(req, [email, 'email']);
    await supabaseAdmin.from('contact_submissions').insert([
      { fingerprint, email_hash: emailHash },
      { fingerprint: globalFingerprint, email_hash: emailHash }
    ]);
    return sendJson(res, 200, { success: true });
  } catch (error) {
    console.error('[contact]', error);
    return sendJson(res, 500, { error: 'Your message could not be sent. Please try again.' });
  }
}
