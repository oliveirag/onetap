-- Reclaimed Phase 1 seed: 10 credit card products.
-- Idempotent: keyed on product_slug; safe to run any number of times.
-- Only names and card networks are recorded. No fees, rewards or benefits (Phase 2).
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
