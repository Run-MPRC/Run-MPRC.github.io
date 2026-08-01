const functions = require('firebase-functions');
const admin = require('firebase-admin');
const { Timestamp } = require('firebase-admin/firestore');
const { loadServerConfig } = require('./serverConfig');

/**
 * Firestore trigger: writes an email doc to the `mail` collection when a
 * registration flips to a confirmed state (paid | comp). The Firebase
 * "Trigger Email from Firestore" extension picks up `mail` docs and sends
 * them via the configured SMTP / provider.
 *
 * Setup: install the `firebase/firestore-send-email` extension and point
 * it at collection `mail` with SMTP credentials for the club's mail provider.
 */

const CONFIRMED_STATUSES = new Set(['paid', 'comp']);

function escapeHtml(value) {
  if (typeof value !== 'string') return '';
  return value.replace(/[&<>"']/g, (character) => {
    switch (character) {
      case '&': return '&amp;';
      case '<': return '&lt;';
      case '>': return '&gt;';
      case '"': return '&quot;';
      case "'": return '&#39;';
      default: return '';
    }
  });
}

function encodePathSegment(value) {
  if (typeof value !== 'string') return '';
  try {
    return encodeURIComponent(value);
  } catch {
    return '';
  }
}

function moneyUsd(cents) {
  return `$${((cents || 0) / 100).toFixed(2)}`;
}

function eventDate(ts) {
  if (!ts) return '';
  const d = ts.toDate ? ts.toDate() : new Date(ts);
  return d.toLocaleString('en-US', {
    weekday: 'long', month: 'long', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit',
  });
}

function buildEmail({ reg, event, siteOrigin }) {
  const slug = event.slug || reg.eventId;
  const eventUrl = `${siteOrigin}/events/${encodePathSegment(slug)}`;
  const eventTitleHtml = escapeHtml(event.title);
  const firstNameHtml = escapeHtml(reg.runner?.firstName);
  const eventDateHtml = escapeHtml(eventDate(event.startAt));
  const eventLocationHtml = escapeHtml(event.location);
  const registrationIdHtml = escapeHtml(reg.id);
  const receiptLine = reg.priceTier === 'comp'
    ? '<p>Your registration is comped — thanks for supporting MPRC!</p>'
    : `<p>Amount paid: <strong>${moneyUsd(reg.amountCents)}</strong></p>`;
  const html = `
    <div style="font-family:system-ui,Arial,sans-serif;max-width:560px;margin:0 auto;color:#111">
      <h2>You're registered for ${eventTitleHtml}</h2>
      <p>Hi ${firstNameHtml},</p>
      <p>Your registration for <strong>${eventTitleHtml}</strong> is confirmed.</p>
      <p><strong>When:</strong> ${eventDateHtml}<br/>
      <strong>Where:</strong> ${eventLocationHtml}</p>
      ${receiptLine}
      <p>Registration ID: <code>${registrationIdHtml}</code></p>
      <p><a href="${escapeHtml(eventUrl)}">Event page</a></p>
      <hr/>
      <p style="color:#666;font-size:12px">Mid-Peninsula Running Club · runmprc.com</p>
    </div>
  `;
  const text = [
    `You're registered for ${event.title}`,
    `When: ${eventDate(event.startAt)}`,
    `Where: ${event.location || ''}`,
    reg.priceTier === 'comp' ? 'Your registration is comped.' : `Amount paid: ${moneyUsd(reg.amountCents)}`,
    `Registration ID: ${reg.id || ''}`,
    eventUrl,
  ].join('\n\n');
  return { html, text };
}

exports.sendConfirmationEmail = functions.firestore
  .document('events/{eventId}/registrations/{regId}')
  .onUpdate(async (change, context) => {
    const before = change.before.data();
    const after = change.after.data();
    if (!after) return;

    const becameConfirmed = CONFIRMED_STATUSES.has(after.status)
      && !CONFIRMED_STATUSES.has(before?.status);
    if (!becameConfirmed) return;
    if (after.confirmationEmailSentAt) return;

    const email = after.runner?.email;
    if (!email) return;
    const { siteOrigin } = loadServerConfig();

    const eventSnap = await admin.firestore()
      .collection('events').doc(context.params.eventId).get();
    if (!eventSnap.exists) return;
    const event = { id: eventSnap.id, ...eventSnap.data() };

    const { html, text } = buildEmail({
      reg: { id: context.params.regId, ...after },
      event,
      siteOrigin,
    });

    await admin.firestore().collection('mail').add({
      to: email,
      message: {
        subject: `Registration confirmed — ${event.title}`,
        html,
        text,
      },
      createdAt: Timestamp.now(),
    });

    await change.after.ref.update({
      confirmationEmailSentAt: Timestamp.now(),
    });
  });

exports.sendConfirmationEmailOnCreate = functions.firestore
  .document('events/{eventId}/registrations/{regId}')
  .onCreate(async (snap, context) => {
    const data = snap.data();
    if (!CONFIRMED_STATUSES.has(data.status)) return;
    if (data.confirmationEmailSentAt) return;

    const email = data.runner?.email;
    if (!email) return;
    const { siteOrigin } = loadServerConfig();

    const eventSnap = await admin.firestore()
      .collection('events').doc(context.params.eventId).get();
    if (!eventSnap.exists) return;
    const event = { id: eventSnap.id, ...eventSnap.data() };

    const { html, text } = buildEmail({
      reg: { id: context.params.regId, ...data },
      event,
      siteOrigin,
    });

    await admin.firestore().collection('mail').add({
      to: email,
      message: {
        subject: `Registration confirmed — ${event.title}`,
        html,
        text,
      },
      createdAt: Timestamp.now(),
    });

    await snap.ref.update({
      confirmationEmailSentAt: Timestamp.now(),
    });
  });
