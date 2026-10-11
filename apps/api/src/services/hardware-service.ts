import {
  ReclaimedError,
  type EnrollmentDto,
  type HardwareReaderDto,
  type HardwareReaderEvent,
  type HardwareStatusDto,
  type HardwareTapDto,
  type TapEvent,
  type TapOutcome,
  type TapResultDto,
} from '@reclaimed/shared';
import type { Database, Queryable } from '@reclaimed/database';
import {
  newCardDisplayId,
  toEnrollmentDto,
  toTransactionDto,
  loadAuthorizationDto,
  type AuthorizationService,
  type EnrollmentRow,
  type PaymentTransactionRow,
} from '@reclaimed/payment-core';
import { maskUid, uidFingerprint } from '../lib/crypto.js';
import { audit } from '../lib/audit.js';
import type { RealtimePublisher } from '../realtime/hub.js';
import type { Logger } from '../logger.js';

interface ReaderRow {
  id: string;
  bridge_id: string;
  reader_name: string;
  model: string | null;
  connected: boolean;
  last_seen_at: Date | null;
  last_card_present_at: Date | null;
  last_card_removed_at: Date | null;
  last_card_type: string | null;
  last_uid_masked: string | null;
  last_error: string | null;
}

const toReaderDto = (r: ReaderRow): HardwareReaderDto => ({
  id: r.id,
  readerName: r.reader_name,
  bridgeId: r.bridge_id,
  model: r.model,
  connected: r.connected,
  lastSeenAt: r.last_seen_at?.toISOString() ?? null,
  lastCardPresentAt: r.last_card_present_at?.toISOString() ?? null,
  lastCardRemovedAt: r.last_card_removed_at?.toISOString() ?? null,
  lastCardType: r.last_card_type,
  lastUidMasked: r.last_uid_masked,
  lastError: r.last_error,
});

/** Detects the reader model from the PC/SC reader name. Never assumes from other ACS models. */
export function detectReaderModel(readerName: string): string | null {
  if (/ACR1252/i.test(readerName)) return 'ACS ACR1252U';
  if (/ACR122/i.test(readerName)) return 'ACS ACR122U (unverified model)';
  return null;
}

/**
 * Processes authenticated hardware-bridge events and routes physical taps:
 *  - enrolled card + open checkout on this reader → authorization
 *  - unknown card  + open checkout               → authorization (declines INVALID_CARD)
 *  - pending enrollment for this reader          → enrollment
 *  - otherwise                                   → recorded, no payment
 * A tap NEVER creates a payment on its own; it can only complete an existing checkout.
 */
export class HardwareService {
  private lastHeartbeat = new Map<string, number>();

  constructor(
    private readonly db: Database,
    private readonly deps: {
      authorization: AuthorizationService;
      realtime: RealtimePublisher;
      logger: Logger;
      /** Stripe test-mode charge of the routed card; runs after the tap is answered. */
      charges?: { start(transactionId: string): Promise<void> } | null;
    },
    private readonly opts: { pepper: string; debounceMs: number; enrollmentTtlMs: number; paymentMode: string; lithic: HardwareStatusDto['lithic'] },
  ) {}

  heartbeat(bridgeId: string): void {
    this.lastHeartbeat.set(bridgeId, Date.now());
  }

  bridgeConnected(): boolean {
    const cutoff = Date.now() - 30_000;
    return [...this.lastHeartbeat.values()].some((t) => t > cutoff);
  }

  async upsertReader(tx: Queryable, bridgeId: string, readerName: string): Promise<ReaderRow> {
    const { rows } = await tx.query<ReaderRow>(
      `insert into hardware_readers (bridge_id, reader_name, model, last_seen_at)
       values ($1, $2, $3, now())
       on conflict (bridge_id, reader_name) do update set last_seen_at = now(), model = coalesce(excluded.model, hardware_readers.model)
       returning *`,
      [bridgeId, readerName, detectReaderModel(readerName)],
    );
    return rows[0]!;
  }

  async recordReaderEvent(e: HardwareReaderEvent): Promise<{ duplicate: boolean; reader: HardwareReaderDto }> {
    this.heartbeat(e.bridgeId);
    const result = await this.db.transaction(async (tx) => {
      const reader = await this.upsertReader(tx, e.bridgeId, e.readerName);
      const ins = await tx.query(
        `insert into hardware_tap_events (external_event_id, event_type, reader_id, bridge_id, detail, occurred_at)
         values ($1, $2, $3, $4, $5, $6) on conflict (external_event_id) do nothing returning id`,
        [e.eventId, e.type, reader.id, e.bridgeId, JSON.stringify(e.detail ?? {}), e.occurredAt],
      );
      if (!ins.rowCount) return { duplicate: true, reader };
      const message = String((e.detail as { message?: string } | undefined)?.message ?? e.type).slice(0, 500);
      const updates: Record<string, [string, unknown[]]> = {
        READER_CONNECTED: ['connected = true, last_connected_at = $2, last_error = null', [e.occurredAt]],
        READER_DISCONNECTED: ['connected = false, last_disconnected_at = $2', [e.occurredAt]],
        CARD_REMOVED: ['last_card_removed_at = $2', [e.occurredAt]],
        CARD_PRESENTED: ['last_card_present_at = $2', [e.occurredAt]],
        READER_ERROR: ['last_error = $2', [message]],
      };
      const [setSql, params] = updates[e.type]!;
      const { rows } = await tx.query<ReaderRow>(`update hardware_readers set ${setSql} where id = $1 returning *`, [reader.id, ...params]);
      return { duplicate: false, reader: rows[0]! };
    });
    const dto = toReaderDto(result.reader);
    if (!result.duplicate) this.deps.realtime.hardware({ type: 'hardware.reader', reader: dto });
    return { duplicate: result.duplicate, reader: dto };
  }

  async processTap(tap: TapEvent, requestId?: string): Promise<TapResultDto> {
    this.heartbeat(tap.bridgeId);
    const fingerprint = uidFingerprint(this.opts.pepper, tap.uid);
    const masked = maskUid(tap.uid);

    // Phase A: record the tap (idempotent on tapId), dedupe, and decide the route.
    const route = await this.db.transaction(async (tx) => {
      const reader = await this.upsertReader(tx, tap.bridgeId, tap.readerName);
      const prior = await tx.query<{ id: string; outcome: TapOutcome; payment_transaction_id: string | null; enrollment_id: string | null }>(
        'select id, outcome, payment_transaction_id, enrollment_id from hardware_tap_events where external_event_id = $1',
        [tap.tapId],
      );
      if (prior.rows[0]) return { kind: 'replay' as const, prior: prior.rows[0] };

      const recent = await tx.query(
        `select 1 from hardware_tap_events
          where reader_id = $1 and uid_fingerprint = $2 and event_type = 'CARD_PRESENTED'
            and occurred_at > $3::timestamptz - ($4 || ' milliseconds')::interval and outcome <> 'DUPLICATE_TAP'`,
        [reader.id, fingerprint, tap.presentedAt, String(this.opts.debounceMs)],
      );
      const card = (
        await tx.query<{ id: string; user_id: string; status: string }>(
          `select id, user_id, status from reclaimed_cards where uid_fingerprint = $1 and status <> 'REVOKED'`,
          [fingerprint],
        )
      ).rows[0];

      await tx.query(
        `update hardware_readers set last_card_present_at = $2, last_card_type = $3, last_uid_masked = $4, connected = true where id = $1`,
        [reader.id, tap.presentedAt, tap.cardType ?? null, masked],
      );
      const insert = async (outcome: TapOutcome, extra: { paymentId?: string; enrollmentId?: string } = {}) =>
        (
          await tx.query<{ id: string }>(
            `insert into hardware_tap_events (external_event_id, event_type, reader_id, bridge_id, uid_fingerprint, uid_masked, card_type, atr,
                outcome, reclaimed_card_id, user_id, enrollment_id, payment_transaction_id, occurred_at)
             values ($1, 'CARD_PRESENTED', $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13) returning id`,
            [tap.tapId, reader.id, tap.bridgeId, fingerprint, masked, tap.cardType ?? null, tap.atr ?? null, outcome, card?.id ?? null,
              card?.user_id ?? null, extra.enrollmentId ?? null, extra.paymentId ?? null, tap.presentedAt],
          )
        ).rows[0]!.id;

      if (recent.rowCount) return { kind: 'done' as const, tapRowId: await insert('DUPLICATE_TAP'), outcome: 'DUPLICATE_TAP' as const, reader };

      const checkout = (
        await tx.query<PaymentTransactionRow>(
          `select p.* from payment_transactions p join test_terminals t on t.id = p.terminal_id
            where p.state = 'CREATED' and p.expires_at > now() and t.is_active and (t.reader_id is null or t.reader_id = $1)
            order by p.created_at desc limit 1 for update of p`,
          [reader.id],
        )
      ).rows[0];
      const enrollment = (
        await tx.query<EnrollmentRow>(
          `select * from nfc_enrollments where status = 'PENDING' and expires_at > now() and (reader_id is null or reader_id = $1)
            order by created_at desc limit 1 for update`,
          [reader.id],
        )
      ).rows[0];

      if (checkout && (card || !enrollment)) {
        const tapRowId = await insert('AUTHORIZATION_STARTED', { paymentId: checkout.id });
        return { kind: 'authorize' as const, tapRowId, checkout, cardId: card?.id ?? null, reader };
      }
      if (enrollment) {
        if (card) {
          await tx.query(`update nfc_enrollments set status = 'FAILED', failure_reason = 'CARD_ALREADY_ENROLLED' where id = $1`, [enrollment.id]);
          const tapRowId = await insert('ENROLLMENT_REJECTED', { enrollmentId: enrollment.id });
          return { kind: 'enrollment' as const, tapRowId, enrollmentId: enrollment.id, userId: enrollment.user_id, outcome: 'ENROLLMENT_REJECTED' as const, reader };
        }
        // The physical card joins the user's digital OneTap card when there is one; otherwise it is a new card.
        const attached = (
          await tx.query<{ id: string }>(
            `update reclaimed_cards set uid_fingerprint = $2, uid_masked = $3, card_technology = $4, atr = $5, enrolled_at = now()
              where id = (select id from reclaimed_cards where user_id = $1 and uid_fingerprint is null and status in ('ACTIVE', 'FROZEN')
                           order by created_at desc limit 1)
              returning id`,
            [enrollment.user_id, fingerprint, masked, tap.cardType ?? null, tap.atr ?? null],
          )
        ).rows[0];
        const newCard =
          attached ??
          (
            await tx.query<{ id: string }>(
              `insert into reclaimed_cards (user_id, display_id, nickname, status, uid_fingerprint, uid_masked, card_technology, atr, enrolled_at)
               values ($1, $2, $3, 'ACTIVE', $4, $5, $6, $7, now()) returning id`,
              [enrollment.user_id, newCardDisplayId(), enrollment.nickname, fingerprint, masked, tap.cardType ?? null, tap.atr ?? null],
            )
          ).rows[0]!;
        await tx.query(
          `update nfc_enrollments set status = 'COMPLETED', reclaimed_card_id = $2, completed_at = now(), reader_id = $3 where id = $1`,
          [enrollment.id, newCard.id, reader.id],
        );
        const tapRowId = await insert('ENROLLED', { enrollmentId: enrollment.id });
        await tx.query('update hardware_tap_events set reclaimed_card_id = $2, user_id = $3 where id = $1', [tapRowId, newCard.id, enrollment.user_id]);
        await audit(tx, {
          actorType: 'bridge', actorId: tap.bridgeId, userId: enrollment.user_id, action: 'reclaimed_card.enrolled',
          entityType: 'reclaimed_card', entityId: newCard.id, metadata: { uidMasked: masked, cardType: tap.cardType ?? null }, requestId,
        });
        return { kind: 'enrollment' as const, tapRowId, enrollmentId: enrollment.id, userId: enrollment.user_id, outcome: 'ENROLLED' as const, reader };
      }
      const outcome: TapOutcome = card ? 'NO_PENDING_CHECKOUT' : 'UNKNOWN_CARD';
      return { kind: 'done' as const, tapRowId: await insert(outcome), outcome, reader, userId: card?.user_id };
    });

    if (route.kind === 'replay') {
      const outcome = route.prior.outcome;
      const res: TapResultDto = { tapId: tap.tapId, outcome, message: `Tap already processed (${outcome}).` };
      if (route.prior.payment_transaction_id) {
        const t = await this.db.query<PaymentTransactionRow>('select * from payment_transactions where id = $1', [route.prior.payment_transaction_id]);
        if (t.rows[0]) res.transaction = toTransactionDto(t.rows[0]);
        res.authorization = (await loadAuthorizationDto(this.db, { paymentTransactionId: route.prior.payment_transaction_id })) ?? undefined;
      }
      return res;
    }

    const tapDto: HardwareTapDto = {
      id: route.tapRowId,
      readerId: route.reader.id,
      uidMasked: masked,
      cardType: tap.cardType ?? null,
      outcome: route.kind === 'authorize' ? 'AUTHORIZATION_STARTED' : route.outcome,
      paymentTransactionId: route.kind === 'authorize' ? route.checkout.id : null,
      enrollmentId: route.kind === 'enrollment' ? route.enrollmentId : null,
      createdAt: new Date().toISOString(),
    };
    this.deps.realtime.hardware({ type: 'hardware.tap', tap: tapDto });

    if (route.kind === 'enrollment') {
      const enrollment = await this.enrollmentDto(route.enrollmentId);
      this.deps.realtime.toUser(route.userId, { type: 'enrollment.updated', enrollment });
      return {
        tapId: tap.tapId,
        outcome: route.outcome,
        enrollment,
        message: route.outcome === 'ENROLLED' ? 'Card enrolled in Reclaimed.' : 'This card is already enrolled.',
      };
    }
    if (route.kind === 'done') {
      const messages: Record<string, string> = {
        DUPLICATE_TAP: 'Repeated presentation ignored.',
        NO_PENDING_CHECKOUT: 'Card recognized. No checkout is waiting, so no payment was created.',
        UNKNOWN_CARD: 'This NFC card is not enrolled in Reclaimed.',
      };
      return { tapId: tap.tapId, outcome: route.outcome, message: messages[route.outcome] ?? route.outcome };
    }

    // Phase B: authorize the pending checkout with the tapped card.
    const c = route.checkout;
    this.deps.realtime.toTerminal(c.terminal_id, {
      type: 'payment.updated',
      transaction: { ...toTransactionDto(c), state: 'AUTHORIZATION_PENDING' },
    });
    const outcome = await this.deps.authorization.authorize({
      transactionId: c.id,
      reclaimedCardId: route.cardId,
      merchantId: c.merchant_id,
      merchantName: c.merchant_name,
      mcc: c.mcc,
      amountCents: c.amount_cents,
      currency: c.currency,
      terminalId: c.terminal_id,
      timestamp: tap.presentedAt,
      tapEventId: route.tapRowId,
    });
    if (outcome.result === 'APPROVED' && !outcome.replayed && this.deps.charges) {
      // Fire and forget: the tap answer and the routing result never wait on Stripe.
      void this.deps.charges.start(c.id).catch((err) => this.deps.logger.error({ err, transactionId: c.id }, 'stripe charge start failed'));
    }
    const event = { type: 'payment.updated' as const, transaction: outcome.transaction, authorization: outcome.authorization };
    this.deps.realtime.toTerminal(c.terminal_id, event);
    if (outcome.transaction.reclaimedCardId) {
      const owner = await this.db.query<{ user_id: string }>('select user_id from payment_transactions where id = $1', [c.id]);
      if (owner.rows[0]?.user_id) this.deps.realtime.toUser(owner.rows[0].user_id, event);
    }
    return {
      tapId: tap.tapId,
      outcome: 'AUTHORIZATION_STARTED',
      transaction: outcome.transaction,
      authorization: outcome.authorization,
      message: `Simulated authorization ${outcome.result}.`,
    };
  }

  async startEnrollment(userId: string, opts: { readerId?: string; nickname?: string }): Promise<EnrollmentDto> {
    const row = await this.db.transaction(async (tx) => {
      if (opts.readerId) {
        const r = await tx.query('select 1 from hardware_readers where id = $1', [opts.readerId]);
        if (!r.rowCount) throw new ReclaimedError('NFC_READER_NOT_FOUND');
      }
      await tx.query(`update nfc_enrollments set status = 'CANCELED' where user_id = $1 and status = 'PENDING'`, [userId]);
      const { rows } = await tx.query<EnrollmentRow>(
        `insert into nfc_enrollments (user_id, reader_id, nickname, expires_at)
         values ($1, $2, $3, now() + ($4 || ' milliseconds')::interval) returning *`,
        [userId, opts.readerId ?? null, opts.nickname ?? null, String(this.opts.enrollmentTtlMs)],
      );
      return rows[0]!;
    });
    return toEnrollmentDto(row);
  }

  async getEnrollment(userId: string, id: string): Promise<EnrollmentDto> {
    await this.expireEnrollments();
    const { rows } = await this.db.query<EnrollmentRow>('select * from nfc_enrollments where id = $1 and user_id = $2', [id, userId]);
    if (!rows[0]) throw new ReclaimedError('NOT_FOUND', 'Enrollment not found.');
    return toEnrollmentDto(rows[0]);
  }

  async cancelEnrollment(userId: string, id: string): Promise<EnrollmentDto> {
    const { rows } = await this.db.query<EnrollmentRow>(
      `update nfc_enrollments set status = 'CANCELED' where id = $1 and user_id = $2 and status = 'PENDING' returning *`,
      [id, userId],
    );
    if (!rows[0]) return this.getEnrollment(userId, id);
    return toEnrollmentDto(rows[0]);
  }

  async expireEnrollments(): Promise<{ id: string; userId: string }[]> {
    const { rows } = await this.db.query<{ id: string; user_id: string }>(
      `update nfc_enrollments set status = 'EXPIRED' where status = 'PENDING' and expires_at <= now() returning id, user_id`,
    );
    return rows.map((r) => ({ id: r.id, userId: r.user_id }));
  }

  async enrollmentDto(id: string): Promise<EnrollmentDto> {
    const { rows } = await this.db.query<EnrollmentRow>('select * from nfc_enrollments where id = $1', [id]);
    return toEnrollmentDto(rows[0]!);
  }

  async listReaders(): Promise<HardwareReaderDto[]> {
    const { rows } = await this.db.query<ReaderRow>('select * from hardware_readers order by last_seen_at desc nulls last');
    return rows.map(toReaderDto);
  }

  async status(opts: { userId?: string; terminalId?: string } = {}): Promise<HardwareStatusDto> {
    const readers = await this.listReaders();
    const taps = await this.db.query<{
      id: string; reader_id: string | null; uid_masked: string | null; card_type: string | null; outcome: TapOutcome;
      payment_transaction_id: string | null; enrollment_id: string | null; created_at: Date;
    }>(
      `select id, reader_id, uid_masked, card_type, outcome, payment_transaction_id, enrollment_id, created_at
         from hardware_tap_events where event_type = 'CARD_PRESENTED' order by created_at desc limit 10`,
    );
    const events = await this.db.query<{ event_type: HardwareStatusDto['recentEvents'][number]['type']; reader_name: string; occurred_at: Date; detail: unknown }>(
      `select e.event_type, r.reader_name, e.occurred_at, e.detail from hardware_tap_events e
         left join hardware_readers r on r.id = e.reader_id order by e.created_at desc limit 20`,
    );
    const pending = await this.db.query<PaymentTransactionRow>(
      `select * from payment_transactions where state in ('CREATED', 'AUTHORIZATION_PENDING') and expires_at > now()
          and ($1::uuid is null or terminal_id = $1) order by created_at desc limit 1`,
      [opts.terminalId ?? null],
    );
    const latestAuth = await this.db.query<{ id: string }>(
      `select a.id from authorization_attempts a
        where a.completed_at is not null and ($1::uuid is null or a.user_id = $1)
        order by a.created_at desc limit 1`,
      [opts.userId ?? null],
    );
    return {
      readers,
      bridgeConnected: this.bridgeConnected(),
      recentTaps: taps.rows.map((t) => ({
        id: t.id,
        readerId: t.reader_id,
        uidMasked: t.uid_masked ?? '',
        cardType: t.card_type,
        outcome: t.outcome,
        paymentTransactionId: t.payment_transaction_id,
        enrollmentId: t.enrollment_id,
        createdAt: t.created_at.toISOString(),
      })),
      recentEvents: events.rows.map((e) => ({ type: e.event_type, readerName: e.reader_name, occurredAt: e.occurred_at.toISOString(), detail: e.detail })),
      paymentMode: this.opts.paymentMode,
      lithic: this.opts.lithic,
      pendingCheckout: pending.rows[0] ? toTransactionDto(pending.rows[0]) : null,
      latestAuthorization: latestAuth.rows[0] ? await loadAuthorizationDto(this.db, { id: latestAuth.rows[0].id }) : null,
    };
  }
}
