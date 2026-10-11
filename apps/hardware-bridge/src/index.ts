import { HardwareBridge } from './bridge.js';
import { HttpBridgeApi } from './api-client.js';
import { PcscReaderDriver } from './driver/pcsc-driver.js';
import { bridgeConfig, consoleLogger } from './config.js';

const cfg = bridgeConfig();
if (!cfg.secret || cfg.secret.length < 16) {
  console.error('[bridge] HARDWARE_BRIDGE_SECRET (min 16 chars) must be set in .env');
  process.exit(1);
}

const driver = new PcscReaderDriver({ readerFilter: cfg.readerFilter });
const api = new HttpBridgeApi({ baseUrl: cfg.apiUrl, secret: cfg.secret, bridgeId: cfg.bridgeId });
const bridge = new HardwareBridge(driver, api, consoleLogger, { bridgeId: cfg.bridgeId });

consoleLogger.info('Reclaimed hardware bridge starting', { api: cfg.apiUrl, bridgeId: cfg.bridgeId, reader: cfg.readerModel, filter: cfg.readerFilter.source });
consoleLogger.info('Waiting for the ACS ACR1252U… plug it in at any time; reconnects are handled automatically.');
try {
  await bridge.start();
} catch (err) {
  consoleLogger.error('failed to start PC/SC monitoring', { message: (err as Error).message, code: (err as { code?: string }).code });
  process.exit(1);
}

let stopping = false;
const shutdown = async () => {
  if (stopping) return;
  stopping = true;
  consoleLogger.info('stopping bridge');
  await bridge.stop();
  process.exit(0);
};
process.on('SIGINT', () => void shutdown());
process.on('SIGTERM', () => void shutdown());
