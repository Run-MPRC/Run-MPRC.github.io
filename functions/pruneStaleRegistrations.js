const functions = require('firebase-functions');
const admin = require('firebase-admin');
const { Timestamp } = require('firebase-admin/firestore');

/**
 * Scheduled cleanup:
 * - Pending registrations older than 7 days are marked cancelled. Stripe
 *   Checkout sessions expire after 24h, but a few hit stuck states; this
 *   is the catch-all so they don't clog capacity counts.
 * - Runs daily at 3 AM America/Los_Angeles.
 */

const STALE_PENDING_DAYS = 7;

exports.pruneStaleRegistrations = functions.pubsub
  .schedule('0 3 * * *')
  .timeZone('America/Los_Angeles')
  .onRun(async () => {
    const cutoff = Timestamp.fromMillis(
      Date.now() - STALE_PENDING_DAYS * 24 * 60 * 60 * 1000,
    );

    const stale = await admin.firestore()
      .collectionGroup('registrations')
      .where('status', '==', 'pending')
      .where('createdAt', '<', cutoff)
      .limit(500)
      .get();

    if (stale.empty) {
      console.log('pruneStaleRegistrations: nothing to prune');
      return null;
    }

    const batch = admin.firestore().batch();
    stale.forEach((doc) => {
      batch.update(doc.ref, {
        status: 'cancelled',
        cancelledAt: Timestamp.now(),
        updatedAt: Timestamp.now(),
        auditLog: admin.firestore.FieldValue.arrayUnion({
          ts: Timestamp.now(),
          actorUid: null,
          actorEmail: null,
          action: 'system.prune_stale_pending',
          note: `idle > ${STALE_PENDING_DAYS} days`,
        }),
      });
    });
    await batch.commit();
    console.log(`pruneStaleRegistrations: marked ${stale.size} stale pending regs cancelled`);
    return null;
  });
