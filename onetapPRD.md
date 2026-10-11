# OneTap: Product Requirements Document

**Event:** Knight Hacks IX, UCF, Oct 9 to 11, 2026
**Team:** Gui Oliveira, Sultan Lodi, Ehsan Ayoubi, Amer Samman
**Goals:** Best Overall, plus the BNY Financial Services Challenge
**Time remaining when written:** about 32 hours, nothing built yet
**Status:** v1, written Saturday Oct 10. Updated Sunday Oct 11: Lithic was dropped. The backend authorizes taps itself and charges the routed card through Stripe in test mode.

---

## 1. Overview and objectives

### What it is
OneTap is one card that routes every purchase to the best of the credit cards you already own. You tap one card. The app picks which of your cards gets the charge, based on what earns the most rewards for that kind of purchase.

### The problem
People with more than one credit card have to remember which card earns the most at restaurants, at the grocery store, at the gas station, and so on. Most people do not, so they use one card for everything and lose rewards on every purchase.

### One sentence of human stakes (pick one for the pitch)
1. "A student with three cards and no time to memorize bonus categories pays with the wrong one every week, and the rewards they lose are money they needed."
2. "Every time you tap the wrong card, you leave money at the register, and nobody tells you."
3. "Students are told to build credit with rewards cards, then left to work out a rulebook nobody has time to read."

### Objectives for the weekend
| Objective | How we know it is met |
|---|---|
| A real end-to-end loop | A judge taps the NFC card at the store laptop and the phone shows the routing result within 2 seconds |
| Functionality score of 5 | At least 90% of what we mention in the pitch works live, with no piece demoed separately |
| Technical Understanding score of 5 | Architecture diagram and latency chart at the table; every teammate can explain their part and name the AI tools used |
| Design score of 5 | One consistent visual system across the app and the store page, built from Gui's design system |
| BNY track fit | The pitch frames OneTap as real-time authorization decisioning that improves a client experience |

### What is out of scope
- Moving real money or charging real cards
- Sign-up bonuses
- Spending limits, declines or budget enforcement
- Apple Pay, Apple Wallet, Tap to Pay on iPhone
- Solana (no Solana track was announced)

---

## 2. Target audience

**Pitch persona:** a college student with two to four credit cards who is struggling with money and wants every dollar of rewards without thinking about it.

**Who it works for:** anyone with more than one rewards card.

**Who is at the table:** judges scoring five criteria from 1 to 5 in a science-fair format, and BNY sponsor judges looking for a tool that makes a financial services process work better.

---

## 3. Core features and acceptance criteria

Priority labels: **Must** ships or the demo fails. **Should** ships if the Must items are done by the Hour 18 gate. **Stretch** only after feature freeze items are stable.

### F1. Sign up and sign in (Must)
Real accounts through Supabase Auth. Sign in with Apple is the first choice. Email and password is added only if it is easy; it becomes the replacement if Apple sign-in is not working by Hour 8.

Acceptance criteria
- [ ] A new user can create an account and reach onboarding in under 30 seconds.
- [ ] A returning user who reopens the app is still signed in and lands on Home.
- [ ] Signing out returns to the welcome screen and clears the session.
- [ ] A user can only read their own cards, transactions and chats (row-level security is on for every user table).

### F2. Onboarding (Must)
Four steps: connect cards, confirm card matches, choose routing mode, receive the OneTap card.

Acceptance criteria
- [ ] The user connects accounts through Plaid Link in sandbox and sees every credit card account returned, with name, last four digits, balance and limit.
- [ ] Each connected account is pre-matched to a card product from our catalog by account name. The user can change any match with a picker.
- [ ] An account with no match is assigned "Other card (1x on everything)" so routing still works.
- [ ] The user picks Auto or Manual. In Manual, they also pick the card.
- [ ] Finishing onboarding creates the user's OneTap card on our backend and shows it in the app with its last four digits.
- [ ] If the app is closed mid-onboarding, it resumes at the same step.
- [ ] Fallback: if the Plaid Link screen cannot be made to work in the app, the backend creates the sandbox connection directly and the onboarding screen shows the same accounts.

### F3. Card catalog and reward rates (Must)
About 15 hand-entered card products. Each has a reward multiplier per category and a fixed value in cents per point.

Acceptance criteria
- [ ] Every card product has a multiplier for all six categories (dining, groceries, gas, streaming, travel, general).
- [ ] Every card product has one cents-per-point value. Cash back cards use 1.0.
- [ ] Every catalog screen that shows a point value labels it as an estimate.
- [ ] The four demo cards give a different winner in at least four of the six categories, so the demo visibly switches cards.

### F4. Routing engine (Must)
Runs on the backend when a tap reaches us at checkout. Claude is not involved.

Rules
- Category comes from the merchant category code (MCC). An unknown code counts as general.
- **Auto mode:** pick the card with the highest value rate for that category, where value rate = multiplier × cents per point. A tie goes to the card higher in the user's card order.
- **Manual mode:** use the card the user chose before the tap. Nothing is asked at tap time.
- **Fallback:** if the user has no usable card, the chosen card is inactive, or the decision errors, approve anyway and use the user's default card. The fallback is recorded and shown.
- **Reward math:** points earned = purchase amount in dollars × multiplier, rounded to a whole point. Reward value = points earned × cents per point. Example: a $13.00 meal on a 4x dining card at 1.0 cents per point earns 52 points, shown as "+$0.52".
- **Baseline:** each transaction also stores what the user's default card would have earned, so the app can show extra value earned.

Acceptance criteria
- [ ] Auto mode picks the highest-value card in every case of the routing test matrix (see F10).
- [ ] Manual mode routes to the chosen card for every category.
- [ ] Our server answers the tap in under 500 ms at the 95th percentile. The Stripe charge happens after the answer, never before it.
- [ ] A repeated tap or a retried Stripe call for the same purchase creates only one transaction and never charges twice.
- [ ] A request that fails signature verification is rejected and logged.
- [ ] Every decision stores the reason (best rate, tie, manual, fallback) and the losing options.

### F5. Store terminal and NFC tap (Must)
A checkout page on the laptop plus a small reader program. The judge picks a merchant and taps the card.

Acceptance criteria
- [ ] The store page shows 6 to 8 fictional merchants, each with a category, a basket and a fixed price.
- [ ] After a merchant is chosen, the page shows "Tap your card" and waits.
- [ ] A fake tap (a key press) and a real tap send the identical event. The page cannot tell them apart.
- [ ] A tap produces "Approved" on the store page within 3 seconds, showing only the OneTap card's last four digits, as a real merchant would see.
- [ ] An unknown card shows "Card not recognized" and does not crash the page.
- [ ] If the backend is unreachable, the page shows a clear error and a retry button.
- [ ] The real reader is tested within one hour of delivery. If it fails, the fake tap is the demo.

Suggested merchants (fictional names, real category codes)
| Merchant | Category | MCC | Basket |
|---|---|---|---|
| Knight Bites | Dining | 5812 | Burrito bowl, $13.00 |
| Citrus Coffee | Dining | 5814 | Latte and bagel, $8.50 |
| Pegasus Market | Groceries | 5411 | Weekly groceries, $64.20 |
| Sunshine Fuel | Gas | 5541 | Fill-up, $41.75 |
| StreamBox | Streaming | 4899 | Monthly plan, $15.99 |
| Orlando Air | Travel | 4511 | Flight home, $218.00 |
| Lakeside Inn | Travel | 7011 | One night, $129.00 |
| Campus Books | General | 5942 | Textbook, $89.99 |

### F6. Live routing result on the phone (Must)
The moment of the demo. The phone updates on its own after the tap.

Acceptance criteria
- [ ] Within 2 seconds of the tap, the app shows the merchant, amount, chosen card, multiplier and reward value, for example "Routed to Amex Gold, 4x dining, +$0.52".
- [ ] The phone gives a haptic tap when the result arrives.
- [ ] The result screen has a "Why this card" section listing the other cards and what each would have earned.
- [ ] In Manual mode, the result also shows what Auto would have earned, if it is more.
- [ ] The result appears whether the app is on Home, Spending or Assistant.
- [ ] If the live connection drops, the app refetches on reconnect and the transaction still appears.

### F7. Home and routing mode toggle (Must)
Acceptance criteria
- [ ] Home shows the in-app OneTap card, the current mode, and a feed of recent transactions.
- [ ] One toggle switches Auto and Manual. The next tap uses the new mode with no app restart.
- [ ] In Manual, the chosen card is always visible on Home and can be changed in two taps.

### F8. Spending view (Must)
For understanding money only. No limits, no declines. Uses OneTap transactions only.

Acceptance criteria
- [ ] Shows total spend, spend by category and spend by underlying card for the current month.
- [ ] Shows total rewards earned and extra value earned compared with the default card.
- [ ] Updates when a new tap arrives, without a manual refresh.
- [ ] The demo account has about 40 seeded transactions over the past 30 days, produced by the same routing rules, and the screen labels them "Demo history".
- [ ] A new account with no transactions shows a helpful empty state, not a blank screen.

### F9. Assistant: Relay and Points planner (Must for Points planner, Should for Relay)
One Assistant tab with two modes. Claude explains; our own code does the arithmetic.

**Points planner.** The user types a goal such as "fly to Canada". The backend works out which award options the user can reach from their point balances and our transfer partner table, then gives that list to Claude to rank and explain.

**Relay.** The user asks about their spending, such as "where did my money go this month?". The backend gives Claude the same totals the Spending view shows.

Acceptance criteria
- [ ] For "fly to Canada", the reply names the source card, the transfer partner, the transfer ratio, the points needed and the points left over, and every number matches our tables.
- [ ] If no option in our table fits the goal, the Assistant says so and offers the closest options it does have.
- [ ] If the user is short on points, the reply says how many more are needed.
- [ ] Relay answers match the Spending view totals exactly.
- [ ] Each mode has three suggested prompts so a judge can try it in one tap.
- [ ] Replies begin within 3 seconds.
- [ ] The Assistant screen carries a note that point values and award prices are demo estimates.
- [ ] If the Claude API fails, the screen shows a retry message and the rest of the app keeps working.

Data scope: 3 transfer programs and about 6 award routes from Orlando, hand-entered. Point balances are seeded per card and grow with points earned through OneTap, because Plaid cannot read rewards balances.

### F10. Reliability proof (Must)
Acceptance criteria
- [ ] A routing test matrix covers every catalog card against every category, plus ties, unknown MCC, Manual mode and the fallback, and all cases pass.
- [ ] Every authorization logs its response time. A chart of those times (median and 95th percentile) is shown at the table.
- [ ] A trace panel on the store page shows each step of the last tap with timings: tap, authorization sent, decision, phone updated.
- [ ] The fake tap is one key press away at all times during judging.

### F11. Real versus simulated disclosure (Must)
Acceptance criteria
- [ ] One slide or poster lists what is real and what is simulated (see section 9).
- [ ] The Assistant, Spending and catalog screens label demo data where it appears.
- [ ] The slide names the AI tools used to build the project.

### F12. Card pairing (Should)
Acceptance criteria
- [ ] The app shows a six-digit pairing code. Typing it on the store laptop and tapping a blank NFC card links that card to the account.
- [ ] If this is not built, the demo account's card is linked by a one-time setup step run by the team.

### Stretch, in this order
1. **Mock "Add to Wallet" screen**, labeled as a mock.
2. **"Money you left on the table" opener:** uses Plaid transaction history to estimate rewards missed last month.
3. **Simulated balance payoff** from a linked bank account.
4. **Credit health:** utilization and due dates from Plaid Liabilities.

---

## 4. Main workflow

1. User signs up and connects cards through Plaid sandbox.
2. App matches each account to a card product. User confirms and chooses a mode.
3. Backend creates the OneTap card. User sees the in-app card and is handed the physical NFC card.
4. At the store laptop, the judge picks a merchant and taps the card on the reader.
5. The reader program sends the tap to the store page, which sends merchant and card to the backend.
6. Backend authorizes the tap with that merchant's MCC and amount.
7. We choose the underlying card, answer "approved", save the transaction, then charge the chosen card through Stripe (test mode).
8. The database pushes the new transaction to the phone. The phone shows the result.
9. The store page shows "Approved".
10. The judge opens Spending, then asks the Assistant to plan a trip with their points.

**Demo script target:** 2 minutes for steps 4 to 10, with onboarding shown first on a second account or as a 20-second recording.

---

## 5. Technical stack and architecture

### Components
| Component | Technology | Owner | Job |
|---|---|---|---|
| Mobile app | Expo (React Native), TypeScript, EAS dev build | Gui | Onboarding, Home, result, Spending, Assistant |
| Backend | Node, TypeScript, Express or Fastify, hosted on Railway | Ehsan | Authorization, routing, Stripe charges, Plaid exchange, Claude calls |
| Database, auth, realtime | Supabase | Ehsan | Tables, row-level security, live push to the app |
| Payments | Stripe test mode | Ehsan | Charges the routed card with saved test payment methods, signed webhooks |
| Bank data | Plaid sandbox | Amer | Link, accounts, liabilities, transactions |
| AI | Claude through the Anthropic API | Sultan | Relay and Points planner |
| Store page | Next.js on the laptop | Amer | Merchant picker, tap screen, trace panel |
| Reader program | Node with nfc-pcsc, ACR122U reader | Amer | Reads the card's ID and sends the tap event |

### Why these choices
- **Railway over Render's free tier:** free Render services sleep when idle, and a sleeping server would blow the 2-second tap-to-phone target. If you use Render, keep it awake with a scheduled ping.
- **Supabase Realtime:** the app listens for new rows in the transactions table, so there is no separate push system to build.
- **Dev build, not Expo Go:** Sign in with Apple and the Plaid Link SDK both need native code.
- **Claude outside the routing path:** routing must be fast and identical every time. A lookup gives that; a language model does not.

### Backend endpoints (names only)
| Endpoint | Called by | Purpose |
|---|---|---|
| Create Plaid link token | App | Starts Plaid Link |
| Exchange Plaid token | App | Saves the connection and imports accounts |
| Create OneTap card | App | Creates the OneTap card at the end of onboarding |
| Store checkout | Store page | Receives merchant and card ID, authorizes the tap, runs routing, answers |
| Stripe webhook | Stripe | Receives PaymentIntent results for the charge on the routed card |
| Pair card | Store page | Links an NFC card ID to an account using the pairing code |
| Chat | App | Builds context, calls Claude, returns the reply |
| Latency metrics | Store page | Feeds the latency chart and trace panel |
| Health check | Team | Confirms the server is up before judging |

The app reads and writes its own rows (cards, mode, transactions) directly through Supabase with row-level security. Everything involving a secret key goes through the backend.

### Shared contracts to agree in the first two hours
These let all four people build in parallel against fake data.
1. **Tap event:** card ID, terminal ID, timestamp. Sent identically by the fake tap and the reader.
2. **Checkout request and response:** merchant ID and card ID in; approved or declined, last four digits and timings out.
3. **Transaction row:** the exact fields in section 6. The app builds its result screen from this row alone.
4. **Chat request and response:** mode and message in; reply text out.

### Routing speed plan
Start with one indexed database read per authorization (the user's mode, cards and rates). Measure it. Add an in-memory cache only if the 95th percentile is above 500 ms. Answer the tap first, then save the transaction and charge through Stripe, so the answer never waits on a write or a network call.

### Stripe facts the build depends on
- Test mode only: the backend refuses any `STRIPE_SECRET_KEY` that is not `sk_test_...`.
- Card numbers never pass through our API. Each connected card gets one of Stripe's saved test payment methods by network (`pm_card_visa`, `pm_card_amex`, ...).
- Every Stripe request carries an idempotency key, and the SDK's own retries are off, so our charge flow owns retries and never charges twice.
- A purchase gets at most two charge attempts, recorded in `stripe_charge_attempts`.
- Webhooks are verified with the `Stripe-Signature` header and `STRIPE_WEBHOOK_SECRET`; anything unsigned is rejected.
- The API version is pinned in code, so a dashboard change cannot alter response shapes.

### Plaid facts the plan depends on (checked against Plaid docs)
- A custom sandbox user can have accounts with names we choose, so "American Express Gold Card" can appear and be matched. Create it in Sandbox Studio in the Plaid dashboard.
- Limits: at most 10 accounts and about 250 transactions per custom user.
- Use a non-OAuth test institution such as First Platypus Bank; OAuth test institutions can override custom fields.
- A sandbox connection can be created from the server without Link. This is the onboarding fallback.

---

## 6. Data model

All tables live in Supabase Postgres. Money is stored in whole cents. Every user-owned table has row-level security so a user reads only their own rows. Reference tables are read-only to the app.

### Reference tables (hand-entered)

**categories**
| Field | Type | Notes |
|---|---|---|
| id | text, primary key | dining, groceries, gas, streaming, travel, general |
| label | text | Display name |
| icon | text | Icon name from the design system |
| sort_order | integer | Display order |

**mcc_map**
| Field | Type | Notes |
|---|---|---|
| mcc | text (4 characters), primary key | Merchant category code |
| category_id | text, references categories | |
| description | text | Plain description of the code |

**card_products** (about 15 rows)
| Field | Type | Notes |
|---|---|---|
| id | uuid, primary key | |
| issuer | text | |
| name | text | |
| network | text | visa, mastercard, amex, discover |
| reward_type | text | points or cashback |
| reward_currency | text | Program name; links to transfer_partners |
| cents_per_point | numeric(5,2) | Fixed demo value; 1.00 for cash back |
| match_keywords | text array | Words matched against Plaid account names |
| card_art | text | Art or color key for the app |
| is_generic | boolean | True for "Other card" |

**card_product_rates**
| Field | Type | Notes |
|---|---|---|
| id | uuid, primary key | |
| card_product_id | uuid, references card_products | |
| category_id | text, references categories | |
| multiplier | numeric(4,2) | Points or percent per dollar |
| | | Unique on card_product_id + category_id |

**merchants** (6 to 8 rows)
| Field | Type | Notes |
|---|---|---|
| id | uuid, primary key | |
| name | text | Fictional store name |
| descriptor | text | Statement descriptor sent with the Stripe charge |
| mcc | text, references mcc_map | |
| basket_label | text | What is being bought |
| amount_cents | integer | Fixed price |
| logo | text | |

**transfer_partners**
| Field | Type | Notes |
|---|---|---|
| id | uuid, primary key | |
| reward_currency | text | Matches card_products.reward_currency |
| partner_program | text | Airline or hotel program |
| partner_type | text | airline or hotel |
| ratio_from | integer | Points sent |
| ratio_to | integer | Points or miles received |
| transfer_time | text | For example "instant" |

**award_options** (about 6 rows)
| Field | Type | Notes |
|---|---|---|
| id | uuid, primary key | |
| partner_program | text | Matches transfer_partners.partner_program |
| origin | text | For example Orlando |
| destination | text | City |
| destination_country | text | Lets "Canada" match Toronto and Vancouver |
| cabin | text | economy or business |
| points_required | integer | One way |
| taxes_fees_cents | integer | |
| cash_price_cents | integer | Used to show value per point |

### User tables

**profiles** (one per user)
| Field | Type | Notes |
|---|---|---|
| id | uuid, primary key | Same as the Supabase Auth user ID |
| display_name | text | |
| routing_mode | text | auto or manual |
| manual_card_id | uuid, references user_cards, nullable | Required when mode is manual |
| default_card_id | uuid, references user_cards, nullable | Fallback and baseline card |
| onboarding_step | text | connect, match, mode, card, done |
| pairing_code | text, nullable | Six digits, short-lived |
| created_at | timestamptz | |

**plaid_items** (backend access only)
| Field | Type | Notes |
|---|---|---|
| id | uuid, primary key | |
| user_id | uuid, references profiles | |
| plaid_item_id | text, unique | |
| access_token | text | Never sent to the app |
| institution_name | text | |
| created_at | timestamptz | |

**user_cards** (the underlying cards)
| Field | Type | Notes |
|---|---|---|
| id | uuid, primary key | |
| user_id | uuid, references profiles | |
| plaid_item_id | uuid, references plaid_items | |
| plaid_account_id | text, unique | |
| account_name | text | As returned by Plaid |
| mask | text | Last four digits |
| card_product_id | uuid, references card_products | |
| match_source | text | auto or user |
| priority | integer | Card order; lower wins ties |
| current_balance_cents | integer | From Plaid |
| credit_limit_cents | integer | From Plaid |
| points_balance | integer | Seeded, then grows with earned points |
| is_active | boolean | |
| created_at | timestamptz | |

**onetap_cards** (one per user)
| Field | Type | Notes |
|---|---|---|
| id | uuid, primary key | |
| user_id | uuid, references profiles, unique | |
| last4 | text | Shown in the app and on the store page |
| nfc_uid | text, unique, nullable | ID of the physical card |
| state | text | open or paused |
| created_at | timestamptz | |

**transactions**
| Field | Type | Notes |
|---|---|---|
| id | uuid, primary key | |
| user_id | uuid, references profiles | |
| onetap_card_id | uuid, references onetap_cards | |
| processor_reference | text, unique, nullable | Blocks duplicates; empty for seeded rows |
| merchant_id | uuid, references merchants, nullable | |
| merchant_name | text | |
| mcc | text | |
| category_id | text, references categories | |
| amount_cents | integer | |
| routed_card_id | uuid, references user_cards | The card chosen |
| routing_mode | text | auto or manual at decision time |
| decision_reason | text | best_rate, tie_priority, manual, fallback_default |
| multiplier | numeric(4,2) | Rate applied |
| points_earned | integer | |
| reward_value_cents | integer | |
| baseline_value_cents | integer | What the default card would have earned |
| best_value_cents | integer | What Auto would have earned |
| alternatives | jsonb | Each other card with its multiplier and value |
| status | text | approved or declined |
| is_seeded | boolean | True for demo history |
| created_at | timestamptz | |

**auth_events** (backend access only; feeds the latency chart)
| Field | Type | Notes |
|---|---|---|
| id | uuid, primary key | |
| processor_reference | text | |
| transaction_id | uuid, references transactions, nullable | |
| received_at | timestamptz | |
| decision_ms | integer | Time to answer the tap |
| result | text | approved, declined, error |
| error | text, nullable | |
| source | text | nfc, fake_tap, test |

**chat_threads**
| Field | Type | Notes |
|---|---|---|
| id | uuid, primary key | |
| user_id | uuid, references profiles | |
| mode | text | relay or points |
| created_at | timestamptz | |

**chat_messages**
| Field | Type | Notes |
|---|---|---|
| id | uuid, primary key | |
| thread_id | uuid, references chat_threads | |
| role | text | user or assistant |
| content | text | |
| created_at | timestamptz | |

### Relationships
- A profile has many plaid_items, many user_cards, one onetap_card, many transactions and many chat_threads.
- A plaid_item has many user_cards.
- A user_card belongs to one card_product. A card_product has six card_product_rates, one per category.
- An mcc_map row points to one category. A merchant points to one mcc_map row.
- A transaction belongs to one profile, one onetap_card, one routed user_card and one category.
- A card_product links to transfer_partners through reward_currency. A transfer_partner links to award_options through partner_program.
- A chat_thread has many chat_messages.

---

## 7. User interface design principles

**Design source:** Gui's design system, adapted as needed: https://claude.ai/artifact/JXMM6qazE1pxYkXXHxCbuF
The contents of that page could not be read while writing this document, so colors, type and spacing come from Gui directly.

**App structure:** four tabs: Home, Spending, Assistant, Cards.

| Screen | Purpose |
|---|---|
| Welcome | Sign in with Apple |
| Onboarding (4 steps) | Connect, confirm matches, choose mode, meet your card |
| Home | OneTap card, mode toggle, recent activity |
| Routing result | The tap result with "Why this card" |
| Spending | Totals by category and card, rewards earned |
| Assistant | Relay and Points planner |
| Cards | Connected cards, card order, match and default settings |

**Principles**
1. **The result is the hero.** The routing result is the largest, clearest thing in the app. Card, multiplier and dollars earned are readable from a judge's standing distance.
2. **One system everywhere.** The store page uses the same colors, type and components as the app, so the two screens look like one product.
3. **Show the reason.** Every routing decision can be opened to see why.
4. **Say what is a demo.** Labels for demo data use one consistent, quiet style.
5. **No dead ends.** Every screen has a loading, empty and error state.
6. **Motion with a purpose.** One animation matters: the result arriving after the tap. Keep the rest still.
7. **Money is exact.** Amounts always show two decimals and never jump or flicker while loading.

---

## 8. Security considerations

Sized for a hackathon, and each item is something a judge might ask about.

- **Secrets stay on the server.** Stripe, Plaid, Claude and Supabase service keys live only in backend environment variables. None are in the app or the repository.
- **Row-level security on every user table.** The app can only read rows where the user ID matches the signed-in user.
- **Plaid access tokens** are stored in a table the app cannot read.
- **Full card numbers** never reach the app or the store page. Only the last four digits are shown.
- **Webhook verification.** The Stripe webhook checks the `Stripe-Signature` header on every request and rejects anything unsigned.
- **Store checkout endpoint** requires a shared terminal key, so a stranger cannot trigger authorizations.
- **Claude receives only** card names, categories, totals and point balances. No account numbers, tokens or email addresses.
- **The NFC card ID is not secure.** It can be copied. Real cards prove themselves with a cryptogram on each tap. This goes on the disclosure slide.

---

## 9. Real versus simulated

| Real | Simulated |
|---|---|
| Accounts and sign-in | Charges to the underlying cards (a ledger entry in our database) |
| Stripe test-mode charges on the routed card | The money itself; nothing moves (test mode, saved test cards) |
| Our approve decision at the tap | Bank accounts and cards (Plaid sandbox test data) |
| Routing logic and reward math | Point values, reward rates and award prices (hand-entered estimates) |
| Realtime push to the phone | Starting point balances and the 30 days of demo history |
| NFC read of a physical card | The store and its merchants |
| Claude responses over our data | Card security (ID only, no cryptogram) |

**Why it is simulated:** real routing needs a card issuer with a bank partner. Plaid can read accounts but cannot charge cards or read rewards balances. No public data source exists for reward rates, transfer partners or award prices.

**AI tools used to build this:** the team lists every coding assistant used and what it was used for. *(To fill in before judging.)*

---

## 10. Build plan: 32 hours by workstream

Hour 0 is when this plan starts. Hour 32 is submission. The NFC reader arrives Saturday at 11am, wherever that falls.

### Gates
| Gate | Hour | Must be true | If not |
|---|---|---|---|
| Apple sign-in check | 8 | Sign in with Apple works on the dev build | Switch to email and password |
| A. Loop works | 10 | Fake tap on the laptop makes the phone show a routing result | Everyone stops and works on the loop |
| B. Full flow | 18 | A new account can onboard, tap, and see Spending | Cut the Should items |
| C. Feature freeze | 24 | No new features after this | Fix bugs only |
| D. Submission ready | 29 | Devpost draft saved, backup video recorded | Stop polishing, submit |

### Hours 0 to 2: setup, everyone together
- Agree the four shared contracts (section 5).
- Create the Supabase project and all tables.
- Get Stripe (test mode), Plaid and Anthropic keys working with one test call each.
- Deploy an empty backend to Railway and confirm it has a public HTTPS address.
- Gui starts the first EAS dev build with every native module already added (Apple sign-in, Plaid Link, haptics). Adding a native module later means another full build.

### Workstream plan
| Hours | Gui: app | Ehsan: backend | Amer: store, NFC, Plaid | Sultan: AI, data, pitch |
|---|---|---|---|---|
| 2 to 6 | App shell, tabs, design system set up. Home and result screens on fake data. | OneTap card creation. Checkout authorization that approves a tap. Stripe test-mode charge and signed webhook. | Store page with merchant picker and fake tap. Create the Plaid custom sandbox user with named card accounts. | Enter the card catalog, rates, MCC map and merchants. Pick the four demo cards. |
| 6 to 10 | Live subscription to transactions. Result screen with haptic. Sign in with Apple. | Routing engine with Auto, Manual and fallback. Save transactions. Checkout endpoint. | Connect the store page to the checkout endpoint. Trace panel. Plaid token endpoints with Ehsan. | Routing test matrix cases. Enter transfer partners and award options. Draft Claude prompts. |
| **10** | **Gate A: fake tap to phone** | | | |
| 10 to 14 | Onboarding screens. Plaid Link in the app. Card match picker. | Plaid exchange and account import. Card matching. Signature check and duplicate handling. | Reader program with nfc-pcsc. Swap in the real reader when it arrives and test within the hour. | Chat endpoint with Ehsan. Points planner calculation of reachable awards. |
| 14 to 18 | Spending view. Mode toggle. Cards tab. | Latency logging and metrics endpoint. Seed script for demo history. | Card pairing screen. Store page styling to match the app. | Assistant answers verified against tables. Relay mode. |
| **18** | **Gate B: full flow** | | | |
| 18 to 24 | Assistant screen. "Why this card". Empty, loading and error states. | Run the test matrix. Latency test. Fix slow paths. | Unknown card and offline handling. Latency chart. | Architecture diagram. Disclosure slide. Devpost draft. |
| **24** | **Gate C: feature freeze** | | | |
| 24 to 28 | Visual polish on the result and Home. Bug fixes. | Bug fixes. Reset script that restores the demo account. | Full demo run on the real hardware, ten times in a row. | Pitch script. Record the backup video. Coach each person's explanation. |
| 28 to 32 | Rehearse | Rehearse, watch server health | Rehearse with reader and fake tap | Submit Devpost by Hour 29, then rehearse |

### Sleep
Take four-hour blocks between Hours 12 and 22, two people at a time. Gui and Ehsan should not be asleep at the same time before Gate B.

### If you fall behind, cut in this order
1. All stretch items
2. Card pairing screen (link the card with a setup step)
3. Relay mode (keep the Points planner)
4. Plaid Link screen in the app (use the server-side sandbox connection)
5. Email and password sign-in

Never cut: the tap loop, the result screen, the Spending view, the reliability proof, the disclosure slide.

---

## 11. Challenges and mitigations

| Risk | Likelihood | Mitigation |
|---|---|---|
| NFC reader does not work on the laptop | Medium | The fake tap is built first and is always available. On recent macOS versions, USB readers can need a driver install; check the laptop's operating system before 11am. |
| EAS build queue is slow | Medium | Start the first build in Hour 0 with all native modules. Later changes are then code-only. A local build is the backup. |
| Sign in with Apple setup stalls | Medium | Hard check at Hour 8, then switch to email and password. |
| A Stripe charge fails or its webhook never arrives | Medium | The tap is already answered, so the purchase still shows. Each charge attempt is recorded, and every checkout is logged so a missing webhook is visible. |
| Backend too slow or asleep | Low | Railway stays awake. Health check before judging. Answer the tap before writing to the database. |
| Venue Wi-Fi blocks or drops connections | Medium | Phone hotspot ready. The backend is hosted, so only the laptop and phone need a connection. |
| Plaid Link fails inside the app | Medium | Server-side sandbox connection gives the same accounts. |
| Plaid account names do not match the catalog | Low | Custom sandbox user with names we choose, plus the manual picker. |
| Claude gets a number wrong | Medium | Our code computes every number and Claude only explains. Test the three suggested prompts repeatedly. |
| Demo data gets messy after many judges | High | A reset script restores the demo account to a known state between judges. |
| Live demo fails in front of a judge | Low | Backup video on the laptop, and the trace panel shows where it stopped. |

---

## 12. Potential costs

All sandbox services are free. Treat the figures below as estimates and confirm on each provider's pricing page.

| Item | Cost |
|---|---|
| Stripe test mode | Free |
| Plaid sandbox | Free |
| Supabase | Free tier is enough |
| Railway | A few dollars for the weekend, or trial credit |
| Claude API | Pay per use; a weekend of demo chats is a few dollars |
| EAS builds | Free tier, with a slower queue |
| Apple Developer account | Already paid (Gui) |
| ACR122U reader and NFC cards | Already bought |

---

## 13. Judging strategy

### Rubric map
| Criterion | What earns a 5 | What we show |
|---|---|---|
| Originality | A solution never seen before | A physical card that chooses among your own cards at the moment of purchase, plus a points planner. Lead with the tap, not "AI finance app". |
| Technical Understanding | Full understanding, with visuals | Architecture diagram, latency chart, live trace panel. Each person explains their own part and names the AI tools they used and the problems they hit. |
| Functionality | 90% working, fluid, end to end | One continuous demo from tap to phone to Spending to Assistant. Nothing shown in pieces. |
| Design | Fantastic design, seamless experience | One design system across phone and store page. The judge does the tap themselves. |
| Wow Factor | Judge discretion | The phone buzzing with the answer one second after the judge's own tap. |

### Who explains what
| Person | Explains |
|---|---|
| Gui | The app, the design system, how the phone gets the result live |
| Ehsan | Authorizing the tap, the Stripe charge on the routed card, the routing rules, the latency chart |
| Amer | The NFC reader, why a browser cannot read it, the fake-tap design, Plaid sandbox |
| Sultan | Why Claude is outside the routing path, how the planner computes before Claude explains, what is simulated |

### BNY Financial Services Challenge angle
The brief asks for a tool that improves a process in the industry, with client experience and workflow automation named as examples. OneTap automates a decision every cardholder makes many times a day, using the same real-time authorization decisioning that card issuers run in production. Say that sentence to the BNY judges, then show the trace panel.

### Table checklist
- [ ] Laptop with store page, reader plugged in, fake tap ready
- [ ] Phone signed in to the demo account, on Home
- [ ] Architecture diagram and latency chart visible
- [ ] Real versus simulated slide visible
- [ ] Backup video open in a tab
- [ ] Reset script run before each judge

---

## 14. Future expansion

- A real card program with an issuing bank partner, so charges reach the underlying cards
- Live reward rates, rotating categories and spending caps
- Merchant-level rules, not only category codes
- Real points balances through issuer connections
- Apple Wallet and Google Wallet provisioning
- Credit health: utilization, due dates and payoff planning
- Shared cards for couples and families

---

## 15. Assumptions made to finish this document

These were open questions answered with defaults. Change any of them and the related section changes with it.

| # | Assumption | Section affected |
|---|---|---|
| 1 | Manual mode uses one card for every purchase | F4 |
| 2 | Auto mode ignores spending caps and annual fees; ties go to card order | F4 |
| 3 | A failed decision still approves, using the default card | F4 |
| 4 | A Plaid custom sandbox user provides named card accounts | F2 |
| 5 | Point balances are seeded, then grow with OneTap earnings | F9 |
| 6 | The Assistant answers only from 3 programs and about 6 routes | F9 |
| 7 | Relay and the Points planner share one tab | F9 |
| 8 | Spending view uses 30 days of labeled demo history | F8 |
| 9 | Merchants have fixed basket prices; results show in the app, not as push notifications | F5, F6 |
| 10 | One demo account at the table; sign-up is shown but judges do not need to do it | F12, demo |
| 11 | "Money you left on the table" is a stretch item | Stretch |
| 12 | Amer takes store, NFC and Plaid; Sultan takes AI, seed data and pitch | Section 10 |
| 13 | Only the BNY sponsor track is targeted | Section 13 |

### Still needed from the team
- The four demo cards and their rates (Sultan, Hour 2 to 6)
- Design tokens from Gui's design system
- The list of AI coding tools used, for the disclosure slide
- Which human-stakes sentence to use
- The laptop's operating system, to check reader driver needs before delivery

---

### Sources checked while writing
- Knight Hacks IX judging rubric: https://knight-hacks.notion.site/Judging-Rubric-38ae290ccffe80618aaac0649d791591
- Stripe idempotent requests: https://docs.stripe.com/api/idempotent_requests
- Stripe webhook signatures: https://docs.stripe.com/webhooks#verify-events
- Stripe test cards: https://docs.stripe.com/testing
- Plaid custom sandbox users: https://plaid.com/docs/sandbox/user-custom/
- NFC readers on macOS 14: https://www.wakdev.com/en/knowledge-base/troubleshooting/nfc-tools-macos-fix-the-reading-issue-with-nfc-readers-on-macos-14-sonoma.html
