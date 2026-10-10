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
  last4: string | null;          // Reclaimed card only; null if unknown
  transactionId: string | null;
  timings: {
    tapAt: string;
    checkoutReceivedAt: string;
    authSentAt: string;          // backend asked Lithic to simulate
    decidedAt: string;           // our webhook answered Lithic
  };
  message?: string;              // human-readable, for errors
}