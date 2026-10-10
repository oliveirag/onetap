/** Fictional-use test merchants for the terminal simulator. MCCs are standard ISO 18245 codes. */
export interface TestMerchant {
  merchantId: string;
  merchantName: string;
  mcc: string;
  category: string;
}

export const TEST_MERCHANTS: readonly TestMerchant[] = [
  { merchantId: 'MID-WALMART-0001', merchantName: 'Walmart', mcc: '5310', category: 'Discount stores' },
  { merchantId: 'MID-WHOLEFOODS-0001', merchantName: 'Whole Foods Market', mcc: '5411', category: 'Grocery stores' },
  { merchantId: 'MID-SHELL-0001', merchantName: 'Shell', mcc: '5541', category: 'Service stations' },
  { merchantId: 'MID-STARBUCKS-0001', merchantName: 'Starbucks', mcc: '5814', category: 'Fast food' },
  { merchantId: 'MID-TARGET-0001', merchantName: 'Target', mcc: '5310', category: 'Discount stores' },
  { merchantId: 'MID-CVS-0001', merchantName: 'CVS Pharmacy', mcc: '5912', category: 'Drug stores' },
  { merchantId: 'MID-DELTA-0001', merchantName: 'Delta Air Lines', mcc: '3058', category: 'Airlines' },
];
