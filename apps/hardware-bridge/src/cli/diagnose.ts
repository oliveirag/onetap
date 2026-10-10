/**
 * npm run hardware:diagnose [-- --wait 20]
 * Reports reader model, USB/PCSC status, driver status, card presence/type, last
 * identifier, scan time, removal events and errors. Writes JSON evidence to
 * .hardware-test-results/. Requires the physical ACR1252U for card checks.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { PcscReaderDriver } from '../driver/pcsc-driver.js';
import { parseAtr } from '../atr.js';
import { readUid } from '../uid.js';
import { driverStatus, findAcsReaders, listUsbDevices } from '../diagnostics.js';

const args = process.argv.slice(2);
const waitSec = Number(args[args.indexOf('--wait') + 1]) || Number(args.find((a) => /^\d+$/.test(a))) || 20;
const evidence: Record<string, unknown> = { tool: 'reclaimed hardware:diagnose', startedAt: new Date().toISOString() };
const errors: string[] = [];
const line = (k: string, v: unknown) => console.log(`  ${k.padEnd(26)} ${typeof v === 'string' ? v : JSON.stringify(v)}`);

console.log('\nReclaimed — NFC hardware diagnostics (ACS ACR1252U)\n');
const driver = driverStatus();
evidence.driver = driver;
line('Platform', driver.platform);
line('Bundled CCID driver', driver.bundledCcidDriver ? 'present' : 'missing');
line('CCID lists ACR1252', driver.bundledCcidListsAcr1252 ? 'yes' : 'no');
line('ACS vendor driver', driver.acsVendorDriverInstalled ? 'installed' : 'not installed (not required if listed above)');

const usb = listUsbDevices();
const acs = findAcsReaders(usb);
evidence.usb = { totalDevices: usb.length, acsDevices: acs };
line('USB devices enumerated', usb.length);
line('ACS USB device', acs.length ? acs.map((d) => `${d.name} (VID 0x${d.vendorId?.toString(16)} PID 0x${d.productId?.toString(16)})`).join(', ') : 'NOT FOUND');

const all = new PcscReaderDriver({ readerFilter: /.*/ });
const readerNames: string[] = [];
let pcscOk = false;
all.on('reader-connected', (n) => readerNames.push(n));
all.on('error', (e) => errors.push(`${e.code ?? 'PCSC'}: ${e.message}`));
try {
  await all.start();
  pcscOk = true;
} catch (e) {
  errors.push(`PC/SC start failed: ${(e as Error).message}`);
}
await new Promise((r) => setTimeout(r, 1500));
line('PC/SC service', pcscOk ? 'connected' : 'FAILED');
line('PC/SC readers', readerNames.length ? readerNames : 'none');
const picc = readerNames.find((n) => /ACR1252.*PICC/i.test(n)) ?? readerNames.find((n) => /ACR1252/i.test(n));
const model = picc ? 'ACS ACR1252U' : null;
line('Reader model', model ?? 'ACR1252U not detected');
evidence.pcsc = { connected: pcscOk, readers: readerNames, selectedReader: picc ?? null, model };

if (picc) {
  console.log(`\n  Tap a generic NFC card on the reader within ${waitSec}s (then remove it)…`);
  const result: Record<string, unknown> = { cardPresent: false };
  await new Promise<void>((resolveWait) => {
    const timer = setTimeout(resolveWait, waitSec * 1000);
    all.on('card-present', async (e) => {
      if (e.readerName !== picc || result.cardPresent) return;
      const t0 = performance.now();
      const info = parseAtr(e.atr);
      Object.assign(result, { cardPresent: true, atr: e.atr, cardType: info.cardType, standard: info.standard, supported: info.supported, detectedAt: new Date().toISOString() });
      try {
        result.uid = await readUid(all, picc);
        result.uidReadMs = Math.round(performance.now() - t0);
      } catch (err) {
        errors.push(`UID read: ${(err as Error).message}`);
      }
      line('Card presence', 'PRESENT');
      line('Card type', `${info.cardType} (${info.standard})`);
      line('ATR', e.atr);
      line('Last detected identifier', result.uid ?? 'unreadable');
      line('Last scan time', `${result.detectedAt} (${result.uidReadMs ?? '?'} ms UID read)`);
      console.log('  Now remove the card…');
    });
    all.on('card-removed', (n) => {
      if (n !== picc || !result.cardPresent) return;
      result.removedAt = new Date().toISOString();
      line('Card removal event', result.removedAt);
      clearTimeout(timer);
      resolveWait();
    });
  });
  if (!result.cardPresent) line('Card presence', `none within ${waitSec}s`);
  evidence.card = result;
}
await all.stop();

line('Hardware errors', errors.length ? errors : 'none');
evidence.errors = errors;
evidence.finishedAt = new Date().toISOString();
const dir = resolve(process.cwd(), '..', '..', '.hardware-test-results');
mkdirSync(dir, { recursive: true });
const file = join(dir, `diagnose-${Date.now()}.json`);
writeFileSync(file, JSON.stringify(evidence, null, 2));
console.log(`\n  Evidence written to ${file}\n`);
process.exit(picc ? 0 : 2);
