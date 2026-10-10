import { ReclaimedError, type CardProductDto, type CardProductMatchDto } from '@reclaimed/shared';
import type { Database } from '@reclaimed/database';
import { toCardProductDto, type CardProductRow } from '@reclaimed/payment-core';

interface ProductWithKeywords extends CardProductRow {
  match_keywords: string[];
}

const ISSUER_ALIASES: Record<string, string[]> = {
  Chase: ['chase', 'jpmorgan'],
  Citi: ['citi', 'citibank', 'citigroup'],
  'American Express': ['american express', 'amex'],
  'Capital One': ['capital one', 'capitalone'],
  Discover: ['discover'],
};

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
/** Whole-word/phrase containment so "citi" does not match "citizens". */
const hasPhrase = (haystack: string, phrase: string) =>
  phrase.length > 0 && new RegExp(`(^|[^a-z0-9])${escapeRe(phrase)}([^a-z0-9]|$)`).test(haystack);

const norm = (s: string | null | undefined) => (s ?? '').toLowerCase().replace(/[®™]/g, '').replace(/\s+/g, ' ').trim();

/**
 * Text-based matching of Plaid credit accounts to the 10 seeded products.
 * It only SUGGESTS; ambiguous results require user confirmation and nothing is
 * invented when no seeded product fits. This is not a rewards engine.
 */
export class CardMatchingService {
  constructor(private readonly db: Database) {}

  async listProducts(search?: string): Promise<CardProductDto[]> {
    const q = norm(search);
    const { rows } = await this.db.query<CardProductRow>(
      `select id, issuer_name, product_name, product_slug, card_network from card_products
        where $1 = '' or lower(issuer_name || ' ' || product_name || ' ' || product_slug || ' ' || array_to_string(match_keywords, ' ')) like '%' || $1 || '%'
        order by issuer_name, product_name`,
      [q],
    );
    return rows.map(toCardProductDto);
  }

  async getProduct(id: string): Promise<CardProductDto> {
    const { rows } = await this.db.query<CardProductRow>(
      'select id, issuer_name, product_name, product_slug, card_network from card_products where id = $1',
      [id],
    );
    if (!rows[0]) throw new ReclaimedError('NOT_FOUND', 'Card product not found.');
    return toCardProductDto(rows[0]);
  }

  async suggest(financialAccountId: string, userId?: string): Promise<{ matches: CardProductMatchDto[]; ambiguous: boolean }> {
    const { rows } = await this.db.query<{ name: string; official_name: string | null; type: string; institution_name: string | null }>(
      `select a.name, a.official_name, a.type, i.institution_name
         from financial_accounts a join plaid_items i on i.id = a.plaid_item_id
        where a.id = $1 and ($2::uuid is null or a.user_id = $2)`,
      [financialAccountId, userId ?? null],
    );
    const acct = rows[0];
    if (!acct) throw new ReclaimedError('NOT_FOUND', 'Account not found.');
    if (acct.type !== 'credit') return { matches: [], ambiguous: false };
    const products = (await this.db.query<ProductWithKeywords>('select * from card_products')).rows;
    return scoreMatches({ institution: acct.institution_name, name: acct.name, officialName: acct.official_name }, products);
  }

  /** Auto-links only an unambiguous strong match, flagged as NOT user-confirmed. */
  async autoMatch(financialAccountId: string): Promise<void> {
    const existing = await this.db.query('select 1 from user_cards where financial_account_id = $1', [financialAccountId]);
    if (existing.rowCount) return;
    const { matches, ambiguous } = await this.suggest(financialAccountId);
    const top = matches[0];
    if (!top || ambiguous || top.confidence < 0.9) return;
    await this.db.query(
      `insert into user_cards (user_id, financial_account_id, card_product_id, confirmed_by_user)
       select user_id, id, $2, false from financial_accounts where id = $1
       on conflict (financial_account_id) do nothing`,
      [financialAccountId, top.product.id],
    );
  }

  /** User confirms or corrects the product; null clears the association. */
  async confirm(userId: string, financialAccountId: string, cardProductId: string | null): Promise<void> {
    const acct = await this.db.query<{ type: string }>('select type from financial_accounts where id = $1 and user_id = $2', [
      financialAccountId,
      userId,
    ]);
    if (!acct.rows[0]) throw new ReclaimedError('NOT_FOUND', 'Account not found.');
    if (cardProductId === null) {
      await this.db.query('delete from user_cards where financial_account_id = $1 and user_id = $2', [financialAccountId, userId]);
      return;
    }
    if (acct.rows[0].type !== 'credit') throw new ReclaimedError('VALIDATION_FAILED', 'Only credit accounts can be linked to a card product.');
    await this.getProduct(cardProductId);
    await this.db.query(
      `insert into user_cards (user_id, financial_account_id, card_product_id, confirmed_by_user, confirmed_at)
       values ($1, $2, $3, true, now())
       on conflict (financial_account_id) do update set card_product_id = excluded.card_product_id, confirmed_by_user = true, confirmed_at = now()`,
      [userId, financialAccountId, cardProductId],
    );
  }
}

export function scoreMatches(
  acct: { institution: string | null; name: string; officialName: string | null },
  products: ProductWithKeywords[],
): { matches: CardProductMatchDto[]; ambiguous: boolean } {
  const inst = norm(acct.institution);
  const text = `${norm(acct.name)} ${norm(acct.officialName)}`;
  const haystack = `${inst} ${text}`;
  const matches: CardProductMatchDto[] = [];
  for (const p of products) {
    const issuerHit = (ISSUER_ALIASES[p.issuer_name] ?? [norm(p.issuer_name)]).some((a) => hasPhrase(haystack, a));
    const keywordHit = p.match_keywords.some((k) => hasPhrase(text, norm(k))) || hasPhrase(text, norm(p.product_name));
    if (issuerHit && keywordHit) matches.push({ product: toCardProductDto(p), confidence: 0.9, reason: 'Issuer and product name match' });
    else if (keywordHit) matches.push({ product: toCardProductDto(p), confidence: 0.6, reason: 'Product name matches; issuer not confirmed' });
    else if (issuerHit) matches.push({ product: toCardProductDto(p), confidence: 0.3, reason: 'Same issuer; product not identified' });
  }
  matches.sort((a, b) => b.confidence - a.confidence || a.product.productName.localeCompare(b.product.productName));
  const top = matches[0]?.confidence ?? 0;
  const atTop = matches.filter((m) => m.confidence === top).length;
  return { matches, ambiguous: matches.length > 0 && (top < 0.9 || atTop > 1) };
}
