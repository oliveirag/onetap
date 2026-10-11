import { appProductId, isRouted, productSlug, toOneTapCard, toProfile, toProfilePatch, toTransaction, toUserCard, type DbFundingAccount, type DbPayment } from './backend';

const goldProduct = {
  product_slug: 'amex-gold',
  issuer_name: 'American Express',
  product_name: 'American Express Gold Card',
  card_network: 'AMEX',
  reward_type: 'points',
  reward_currency: 'Membership Rewards',
  cents_per_point: '1.00',
  card_art: 'lines',
  is_generic: false,
};

const funding = (over: Partial<DbFundingAccount> = {}): DbFundingAccount => ({
  id: 'fa-1',
  display_name: 'American Express Gold Card',
  last4: '1008',
  match_source: 'auto',
  priority: 1,
  current_balance_cents: '84217',
  credit_limit_cents: 1_500_000,
  status: 'ACTIVE',
  card_product: goldProduct,
  ...over,
});

const payment = (over: Partial<DbPayment> = {}): DbPayment => ({
  id: 'tx-1',
  user_id: 'u-1',
  reclaimed_card_id: 'rc-1',
  processor: 'mock',
  processor_reference: 'MOCK-123',
  merchant_id: 'MID-STARBUCKS-0001',
  merchant_name: 'Starbucks',
  mcc: '5814',
  amount_cents: '1250',
  state: 'AUTHORIZED',
  funding_account_id: 'fa-1',
  category_id: 'dining',
  routing_mode: 'auto',
  decision_reason: 'best_rate',
  multiplier: '4.00',
  points_earned: 50,
  reward_value_cents: '50',
  baseline_value_cents: '25',
  best_value_cents: '50',
  alternatives: [{ funding_account_id: 'fa-2', name: 'Citi Double Cash Card', last4: '7731', multiplier: 2, value_cents: 25 }],
  is_seeded: false,
  created_at: '2026-10-10T20:00:00.000Z',
  ...over,
});

describe('backend row mapping', () => {
  it('uses catalog ids for products, both ways', () => {
    expect(appProductId('amex-gold')).toBe('cp-amex-gold');
    expect(appProductId('other-card')).toBe('cp-other');
    expect(productSlug('cp-chase-sapphire-preferred')).toBe('chase-sapphire-preferred');
    expect(productSlug('cp-other')).toBe('other-card');
  });

  it('maps a funding account to a user card with the design short name and numeric cents', () => {
    expect(toUserCard(funding())).toEqual({
      id: 'fa-1',
      account_name: 'American Express Gold Card',
      mask: '1008',
      card_product_id: 'cp-amex-gold',
      match_source: 'auto',
      priority: 1,
      current_balance_cents: 84_217,
      credit_limit_cents: 1_500_000,
      points_balance: 0,
      is_active: true,
      card_product: {
        id: 'cp-amex-gold',
        issuer: 'American Express',
        name: 'Amex Gold',
        network: 'amex',
        reward_type: 'points',
        reward_currency: 'Membership Rewards',
        cents_per_point: 1,
        card_art: 'lines',
        is_generic: false,
      },
    });
  });

  it('treats a card with no product as Other card', () => {
    const c = toUserCard(funding({ card_product: null, last4: null }));
    expect(c.card_product_id).toBe('cp-other');
    expect(c.card_product?.is_generic).toBe(true);
    expect(c.mask).toBe('');
  });

  it('maps a routed payment to the transaction contract', () => {
    expect(toTransaction(payment())).toEqual({
      id: 'tx-1',
      user_id: 'u-1',
      onetap_card_id: 'rc-1',
      lithic_token: null,
      merchant_id: 'MID-STARBUCKS-0001',
      merchant_name: 'Starbucks',
      mcc: '5814',
      category_id: 'dining',
      amount_cents: 1250,
      routed_card_id: 'fa-1',
      routing_mode: 'auto',
      decision_reason: 'best_rate',
      multiplier: 4,
      points_earned: 50,
      reward_value_cents: 50,
      baseline_value_cents: 25,
      best_value_cents: 50,
      alternatives: [{ user_card_id: 'fa-2', card_name: 'Citi Double Cash Card', mask: '7731', multiplier: 2, value_cents: 25 }],
      status: 'approved',
      is_seeded: false,
      created_at: '2026-10-10T20:00:00.000Z',
    });
  });

  it('keeps the Lithic token only for Lithic payments, and maps later states', () => {
    expect(toTransaction(payment({ processor: 'lithic_sandbox', processor_reference: 'tok_1' })).lithic_token).toBe('tok_1');
    expect(toTransaction(payment({ state: 'SETTLED' })).status).toBe('approved');
    expect(toTransaction(payment({ state: 'DECLINED' })).status).toBe('declined');
  });

  it('only treats payments with a routing decision as transactions', () => {
    expect(isRouted(payment())).toBe(true);
    expect(isRouted(payment({ decision_reason: null }))).toBe(false);
  });

  it('shows only the last four of the OneTap card and maps frozen to paused', () => {
    expect(toOneTapCard({ id: 'rc-1', display_id: 'RC-7F3A-19C2', status: 'ACTIVE' })).toEqual({ id: 'rc-1', last4: '19C2', state: 'open' });
    expect(toOneTapCard({ id: 'rc-1', display_id: 'RC-7F3A-19C2', status: 'FROZEN' }).state).toBe('paused');
  });

  it('maps profiles and writes only the columns the app may change', () => {
    expect(toProfile({ id: 'u-1', full_name: 'Ada', routing_mode: 'manual', manual_card_id: 'fa-1', default_card_id: null })).toEqual({
      id: 'u-1',
      display_name: 'Ada',
      routing_mode: 'manual',
      manual_card_id: 'fa-1',
      default_card_id: null,
      onboarding_step: 'done',
    });
    expect(toProfilePatch({ routing_mode: 'auto', display_name: 'Ada', onboarding_step: 'card', id: 'x' })).toEqual({ routing_mode: 'auto', full_name: 'Ada' });
  });
});
