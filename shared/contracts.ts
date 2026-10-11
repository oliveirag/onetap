// Sent by both the fake tap and the NFC reader. Must be identical.
export interface TapEvent {
  cardId: string;      // NFC UID, uppercase hex, no separators: "04A1B2C3D4"
  terminalId: string;  // "store-laptop-1"
  timestamp: string;   // ISO 8601 UTC, set at tap time
  source: "nfc" | "fake_tap"; // for logs only; never used in logic
}

export interface CheckoutRequest {
  merchantId: string;  // uuid from merchants table
  cardId: string;      // same format as TapEvent.cardId
  tapAt: string;       // TapEvent.timestamp, passed through for the trace panel
}

export interface CheckoutResponse {
  status: "approved" | "declined" | "unknown_card" | "error";
  last4: string | null;          // OneTap card only; null if unknown
  transactionId: string | null;
  timings: {
    tapAt: string;
    checkoutReceivedAt: string;
    authSentAt: string;          // backend asked Lithic to simulate
    decidedAt: string;           // our webhook answered Lithic
  };
  message?: string;              // human-readable, for errors
}

// ---------- Supabase rows (snake_case = Postgres column names) ----------

export type CategoryId = "dining" | "groceries" | "gas" | "streaming" | "travel" | "general";
export type RoutingMode = "auto" | "manual";
export type DecisionReason = "best_rate" | "tie_priority" | "manual" | "fallback_default";
export type OnboardingStep = "connect" | "match" | "mode" | "card" | "done";

// One losing option on a routing decision. Stored in transactions.alternatives (jsonb).
export interface Alternative {
  user_card_id: string;
  card_name: string;     // display name, so the app needs no join
  mask: string;          // last four digits
  multiplier: number;    // e.g. 3 or 1.5
  value_cents: number;   // what this card would have earned, integer cents
}

// transactions table. The app builds the result screen from this row plus cached user cards.
export interface TransactionRow {
  id: string;
  user_id: string;
  onetap_card_id: string;
  lithic_token: string | null;   // null for seeded rows
  merchant_id: string | null;
  merchant_name: string;
  mcc: string;                   // 4 characters
  category_id: CategoryId;
  amount_cents: number;
  routed_card_id: string;        // user_cards.id
  routing_mode: RoutingMode;     // mode at decision time
  decision_reason: DecisionReason;
  multiplier: number;
  points_earned: number;
  reward_value_cents: number;
  baseline_value_cents: number;  // what the default card would have earned
  best_value_cents: number;      // what Auto would have earned
  alternatives: Alternative[] | null;
  status: "approved" | "declined";
  is_seeded: boolean;            // true for demo history
  created_at: string;            // ISO 8601 UTC
  // Stripe test-mode charge of the underlying card, after the routing decision. Null/absent: no charge.
  charge_status?: "pending" | "succeeded" | "failed" | null;
  charged_card_id?: string | null; // the card finally charged: the routed card, or the default after a decline
}

export interface CardProduct {
  id: string;
  issuer: string;
  name: string;
  network: "visa" | "mastercard" | "amex" | "discover";
  reward_type: "points" | "cashback";
  reward_currency: string;
  cents_per_point: number;       // 1.0 for cash back
  card_art: string;              // art key: "lines" | "dots" | "grid" | "solid" for the app
  is_generic: boolean;
}

// card_product_rates table: one row per product and category (onetapPRD.md section 6).
export interface CardProductRate {
  card_product_id: string;
  category_id: CategoryId;
  multiplier: number;            // points or percent per dollar, e.g. 4 or 1.5
}

export interface UserCardRow {
  id: string;
  account_name: string;          // as returned by Plaid
  mask: string;
  card_product_id: string;
  match_source: "auto" | "user";
  priority: number;              // lower wins ties
  current_balance_cents: number;
  credit_limit_cents: number;
  points_balance: number;
  is_active: boolean;
  financial_account_id?: string | null; // the Plaid account behind it; joins card_spending rows
  card_product?: CardProduct;    // present when selected with card_products(*)
}

export interface ProfileRow {
  id: string;
  display_name: string | null;
  routing_mode: RoutingMode;
  manual_card_id: string | null; // required when routing_mode is "manual"
  default_card_id: string | null;
  onboarding_step: OnboardingStep;
}

export interface OneTapCardRow {
  id: string;
  last4: string;
  state: "open" | "paused";
  physical_linked?: boolean;     // the physical NFC card is attached to this (digital) card
}

// card_spending view: one purchase on a credit card the user connected through Plaid.
export interface CardSpendingRow {
  id: string;
  financial_account_id: string;
  account_name: string;
  mask: string | null;
  merchant: string;
  amount_cents: number;          // positive = spent
  date: string;                  // YYYY-MM-DD, as Plaid reports it
  pending: boolean;
  category_id: CategoryId;
}

// ---------- Chat (app -> backend, camelCase like the other HTTP payloads) ----------

export interface ChatRequest {
  mode: "relay" | "points";
  message: string;
  threadId?: string;             // omit to start a new thread
}

export interface ChatResponse {
  reply: string;
  threadId: string;
}