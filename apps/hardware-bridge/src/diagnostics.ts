import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { arch, platform, release } from 'node:os';

export const ACS_VENDOR_ID = 0x072f;
/** ACR1252 USB product ids listed in Apple's bundled CCID driver (ifd-ccid.bundle). */
export const ACR1252_PRODUCT_IDS = [0x223b, 0x223e];

export interface UsbDevice {
  name: string;
  vendorId: number | null;
  productId: number | null;
  serial?: string;
}

/** Enumerates USB devices via system_profiler (macOS). Returns [] elsewhere. */
export function listUsbDevices(): UsbDevice[] {
  if (platform() !== 'darwin') return [];
  const out: UsbDevice[] = [];
  for (const dataType of ['SPUSBHostDataType', 'SPUSBDataType']) {
    try {
      const json = JSON.parse(execFileSync('system_profiler', [dataType, '-json'], { encoding: 'utf8', timeout: 15_000 }));
      const walk = (nodes: unknown[]) => {
        for (const n of nodes as Record<string, unknown>[]) {
          const vid = String(n.USBDeviceKeyVendorID ?? n.vendor_id ?? '');
          const pid = String(n.USBDeviceKeyProductID ?? n.product_id ?? '');
          const parse = (s: string) => {
            const m = /0x([0-9a-f]+)/i.exec(s);
            return m ? parseInt(m[1]!, 16) : null;
          };
          if (n._name && (vid || pid)) out.push({ name: String(n._name), vendorId: parse(vid), productId: parse(pid), serial: n.serial_num as string | undefined });
          if (Array.isArray(n._items)) walk(n._items);
        }
      };
      walk(Object.values(json).flat() as unknown[]);
      if (out.length) break;
    } catch {
      /* try next data type */
    }
  }
  return out;
}

export function findAcsReaders(devices: UsbDevice[]): UsbDevice[] {
  return devices.filter((d) => d.vendorId === ACS_VENDOR_ID || /ACR1252|ACS/i.test(d.name));
}

export interface DriverStatus {
  platform: string;
  bundledCcidDriver: boolean;
  bundledCcidListsAcr1252: boolean;
  acsVendorDriverInstalled: boolean;
  note: string;
}

export function driverStatus(): DriverStatus {
  const bundled = '/usr/libexec/SmartCardServices/drivers/ifd-ccid.bundle/Contents/Info.plist';
  const vendor = '/usr/local/libexec/SmartCardServices/drivers/ifd-acsccid.bundle';
  let lists = false;
  if (existsSync(bundled)) {
    try {
      const plist = execFileSync('plutil', ['-convert', 'json', '-o', '-', bundled], { encoding: 'utf8' });
      const j = JSON.parse(plist) as { ifdFriendlyName?: string[] };
      lists = (j.ifdFriendlyName ?? []).some((n) => /ACR1252/i.test(n));
    } catch {
      lists = false;
    }
  }
  return {
    platform: `${platform()} ${release()} ${arch()} node ${process.version}`,
    bundledCcidDriver: existsSync(bundled),
    bundledCcidListsAcr1252: lists,
    acsVendorDriverInstalled: existsSync(vendor),
    note: lists
      ? 'macOS bundled CCID driver lists ACS ACR1252 — no vendor driver required.'
      : 'ACR1252 not found in the bundled CCID list — install the ACS macOS driver from acs.com.hk.',
  };
}
