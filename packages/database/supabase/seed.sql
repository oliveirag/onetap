-- Seed: 10 credit card products plus the routing reference data (categories, MCC map, reward rates).
-- Idempotent: keyed on product_slug / natural keys; safe to run any number of times.
-- Networks verified 2026-10-10 against issuer/press descriptions; see docs/setup.md for caveats.

insert into public.card_products (issuer_name, product_name, product_slug, card_network, notes, match_keywords)
values
  ('Chase', 'Chase Sapphire Preferred', 'chase-sapphire-preferred', 'VISA',
    'Visa Signature.', array['sapphire preferred', 'sapphire pref', 'csp']),
  ('Chase', 'Chase Freedom Unlimited', 'chase-freedom-unlimited', 'VISA',
    'Visa Signature.', array['freedom unlimited', 'cfu']),
  ('Chase', 'Chase Freedom Flex', 'chase-freedom-flex', 'MASTERCARD',
    'World Elite Mastercard.', array['freedom flex', 'cff']),
  ('Citi', 'Citi Double Cash', 'citi-double-cash', 'MASTERCARD',
    'Mastercard.', array['double cash']),
  ('Citi', 'Citi Custom Cash', 'citi-custom-cash', 'MASTERCARD',
    'Mastercard. Reported closed to new applications as of 2026-05-28; existing accounts remain.',
    array['custom cash']),
  ('American Express', 'American Express Gold Card', 'amex-gold', 'AMEX',
    'Issued on the American Express network.', array['gold card', 'amex gold', 'american express gold']),
  ('American Express', 'The Platinum Card from American Express', 'amex-platinum', 'AMEX',
    'Issued on the American Express network.', array['platinum card', 'amex platinum', 'american express platinum']),
  ('Capital One', 'Capital One Venture X', 'capital-one-venture-x', 'VISA',
    'Visa Infinite. Capital One has announced migrating some cards to the Discover network; network may vary per account.',
    array['venture x']),
  ('Capital One', 'Capital One Savor', 'capital-one-savor', 'MASTERCARD',
    'World Elite Mastercard. Capital One lists Savor among cards that may move to the Discover network; network may vary per account.',
    array['savor']),
  ('Discover', 'Discover it Cash Back', 'discover-it-cash-back', 'DISCOVER',
    'Discover network. Discover is owned by Capital One; accounts are migrating to Capital One servicing in 2026.',
    array['discover it', 'discover cash back', 'discover it cash back'])
on conflict (product_slug) do update
  set issuer_name = excluded.issuer_name,
      product_name = excluded.product_name,
      card_network = excluded.card_network,
      notes = excluded.notes,
      match_keywords = excluded.match_keywords;

-- PRD F2: an account that matches no product still routes, at 1x on everything.
insert into public.card_products (issuer_name, product_name, product_slug, card_network, notes, match_keywords, is_generic)
values ('Other', 'Other card', 'other-card', 'VISA', 'Generic product for unmatched accounts.', '{}', true)
on conflict (product_slug) do update set is_generic = true;

-- ---------- Routing reference data (OneTap) ----------
-- Reward multipliers are DEMO ESTIMATES (the app labels them), not verified issuer terms.
-- They mirror mobile/src/lib/catalog.ts. cents_per_point is 1.00 for every product.

update public.card_products p
   set reward_type = v.reward_type, reward_currency = v.reward_currency, card_art = v.card_art, cents_per_point = 1.00
  from (values
    ('amex-gold', 'points', 'Membership Rewards', 'lines'),
    ('amex-platinum', 'points', 'Membership Rewards', 'solid'),
    ('capital-one-savor', 'cashback', 'Cash back', 'dots'),
    ('capital-one-venture-x', 'points', 'Capital One Miles', 'grid'),
    ('chase-freedom-flex', 'points', 'Ultimate Rewards', 'lines'),
    ('chase-freedom-unlimited', 'points', 'Ultimate Rewards', 'dots'),
    ('chase-sapphire-preferred', 'points', 'Ultimate Rewards', 'dots'),
    ('citi-custom-cash', 'points', 'ThankYou Points', 'grid'),
    ('citi-double-cash', 'cashback', 'Cash back', 'solid'),
    ('discover-it-cash-back', 'cashback', 'Cash back', 'grid'),
    ('other-card', 'cashback', 'Cash back', 'solid')
  ) as v(slug, reward_type, reward_currency, card_art)
 where p.product_slug = v.slug;

-- One row per product and category; categories not listed earn 1x.
insert into public.card_product_rates (card_product_id, category_id, multiplier)
select p.id, c.id, coalesce(r.multiplier, 1)
  from public.card_products p
  cross join public.categories c
  left join (values
    ('amex-gold', 'dining', 4), ('amex-gold', 'groceries', 4), ('amex-gold', 'travel', 3),
    ('amex-platinum', 'travel', 5),
    ('capital-one-savor', 'dining', 3), ('capital-one-savor', 'groceries', 3), ('capital-one-savor', 'streaming', 3),
    ('capital-one-venture-x', 'dining', 2), ('capital-one-venture-x', 'groceries', 2), ('capital-one-venture-x', 'gas', 2),
    ('capital-one-venture-x', 'streaming', 2), ('capital-one-venture-x', 'travel', 2), ('capital-one-venture-x', 'general', 2),
    ('chase-freedom-flex', 'dining', 3),
    ('chase-freedom-unlimited', 'dining', 3), ('chase-freedom-unlimited', 'groceries', 1.5), ('chase-freedom-unlimited', 'gas', 1.5),
    ('chase-freedom-unlimited', 'streaming', 1.5), ('chase-freedom-unlimited', 'travel', 1.5), ('chase-freedom-unlimited', 'general', 1.5),
    ('chase-sapphire-preferred', 'dining', 3), ('chase-sapphire-preferred', 'streaming', 3), ('chase-sapphire-preferred', 'travel', 5),
    ('citi-custom-cash', 'gas', 5),
    ('citi-double-cash', 'dining', 2), ('citi-double-cash', 'groceries', 2), ('citi-double-cash', 'gas', 2),
    ('citi-double-cash', 'streaming', 2), ('citi-double-cash', 'travel', 2), ('citi-double-cash', 'general', 2)
  ) as r(slug, category_id, multiplier) on r.slug = p.product_slug and r.category_id = c.id
on conflict (card_product_id, category_id) do update set multiplier = excluded.multiplier;

-- MCC -> category. Unlisted MCCs route as 'general'.
insert into public.mcc_map (mcc, category_id, description)
values
  ('5411', 'groceries', 'Grocery stores, supermarkets'),
  ('5422', 'groceries', 'Meat provisioners'),
  ('5441', 'groceries', 'Candy, nut and confectionery stores'),
  ('5451', 'groceries', 'Dairy products stores'),
  ('5462', 'groceries', 'Bakeries'),
  ('5541', 'gas', 'Service stations'),
  ('5542', 'gas', 'Automated fuel dispensers'),
  ('5811', 'dining', 'Caterers'),
  ('5812', 'dining', 'Restaurants'),
  ('5813', 'dining', 'Bars'),
  ('5814', 'dining', 'Fast food'),
  ('4899', 'streaming', 'Cable and streaming services'),
  ('5815', 'streaming', 'Digital media'),
  ('5816', 'streaming', 'Digital games'),
  ('5818', 'streaming', 'Digital goods'),
  ('3058', 'travel', 'Delta Air Lines'),
  ('4511', 'travel', 'Airlines'),
  ('4111', 'travel', 'Commuter transport'),
  ('4121', 'travel', 'Taxis and rideshare'),
  ('4722', 'travel', 'Travel agencies'),
  ('7011', 'travel', 'Hotels and lodging'),
  ('7512', 'travel', 'Car rental'),
  ('5310', 'general', 'Discount stores'),
  ('5912', 'general', 'Drug stores')
on conflict (mcc) do update set category_id = excluded.category_id, description = excluded.description;

-- Plaid personal_finance_category -> category, for spending across connected cards (card_spending).
-- Detailed codes win over primary ones; anything unlisted is 'general'.
insert into public.plaid_category_map (plaid_category, category_id)
values
  ('FOOD_AND_DRINK', 'dining'),
  ('FOOD_AND_DRINK_GROCERIES', 'groceries'),
  ('FOOD_AND_DRINK_BEER_WINE_AND_LIQUOR', 'groceries'),
  ('TRANSPORTATION_GAS', 'gas'),
  ('TRANSPORTATION_TAXIS_AND_RIDE_SHARES', 'travel'),
  ('TRANSPORTATION_PUBLIC_TRANSIT', 'travel'),
  ('TRAVEL', 'travel'),
  ('ENTERTAINMENT_TV_AND_MOVIES', 'streaming'),
  ('ENTERTAINMENT_MUSIC_AND_AUDIO', 'streaming'),
  ('ENTERTAINMENT_VIDEO_GAMES', 'streaming')
on conflict (plaid_category) do update set category_id = excluded.category_id;
