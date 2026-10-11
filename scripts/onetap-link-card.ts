/**
 * Operator tool for demos: attach a physical NFC card to a user's OneTap card.
 *
 *   npm run onetap:link-card -- user@example.com
 *
 * Opens an enrollment session for the user (creating their digital OneTap card if they have none),
 * then waits for the card to be tapped on the reader. Needs the API and the hardware bridge running
 * (npm run dev): the bridge reports the tap and the API attaches the card. Uses DATABASE_URL.
 */
import pg from 'pg';
import { newCardDisplayId } from '@reclaimed/payment-core';

const email = process.argv[2]?.trim().toLowerCase();
const WAIT_MS = Number(process.env.ENROLLMENT_TTL_MS ?? 60_000);

async function main() {
  if (!email) throw new Error('Usage: npm run onetap:link-card -- <user email>');
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL is not set.');
  const db = new pg.Client({ connectionString: url });
  await db.connect();
  try {
    console.log(`Database: ${new URL(url).hostname}`);
    const user = (await db.query<{ id: string }>('select id from auth.users where lower(email) = $1', [email])).rows[0];
    if (!user) throw new Error(`No account with email ${email}.`);

    const existing = await db.query<{ id: string; display_id: string; uid_masked: string | null }>(
      `select id, display_id, uid_masked from reclaimed_cards where user_id = $1 and status in ('ACTIVE', 'FROZEN')
        order by (uid_fingerprint is not null) desc, created_at desc limit 1`,
      [user.id],
    );
    if (existing.rows[0]?.uid_masked) {
      console.log(`Already linked: OneTap card ${existing.rows[0].display_id} has physical card ${existing.rows[0].uid_masked}.`);
      return;
    }
    if (!existing.rows[0]) {
      await db.query(`insert into reclaimed_cards (user_id, display_id, nickname, status) values ($1, $2, 'OneTap', 'ACTIVE') on conflict do nothing`, [
        user.id,
        newCardDisplayId(),
      ]);
      console.log('Created the digital OneTap card.');
    }

    await db.query(`update nfc_enrollments set status = 'CANCELED' where user_id = $1 and status = 'PENDING'`, [user.id]);
    const enrollment = (
      await db.query<{ id: string }>(
        `insert into nfc_enrollments (user_id, nickname, expires_at) values ($1, 'OneTap', now() + ($2 || ' milliseconds')::interval) returning id`,
        [user.id, String(WAIT_MS)],
      )
    ).rows[0]!;
    console.log(`Tap the physical card on the reader now (${Math.round(WAIT_MS / 1000)} s)...`);

    const deadline = Date.now() + WAIT_MS;
    while (Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 500));
      const e = (await db.query<{ status: string; failure_reason: string | null; reclaimed_card_id: string | null }>(
        'select status, failure_reason, reclaimed_card_id from nfc_enrollments where id = $1',
        [enrollment.id],
      )).rows[0]!;
      if (e.status === 'COMPLETED') {
        const card = (await db.query<{ display_id: string; uid_masked: string }>('select display_id, uid_masked from reclaimed_cards where id = $1', [e.reclaimed_card_id])).rows[0]!;
        console.log(`Linked: physical card ${card.uid_masked} is now OneTap card ${card.display_id} for ${email}.`);
        return;
      }
      if (e.status === 'FAILED') throw new Error(e.failure_reason === 'CARD_ALREADY_ENROLLED' ? 'That card is linked to another account.' : `Enrollment failed (${e.failure_reason}).`);
      if (e.status !== 'PENDING') throw new Error(`Enrollment ${e.status.toLowerCase()}.`);
    }
    await db.query(`update nfc_enrollments set status = 'CANCELED' where id = $1 and status = 'PENDING'`, [enrollment.id]);
    throw new Error('No card was tapped. Is `npm run dev` running with the reader plugged in?');
  } finally {
    await db.end();
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
