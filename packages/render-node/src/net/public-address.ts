/**
 * Which addresses a fetch on someone's behalf may connect to: public unicast
 * only. No loopback, private, link-local (cloud metadata 169.254.169.254),
 * CGNAT, multicast, reserved, documentation, NAT64/6to4/Teredo, or the Azure
 * platform address 168.63.129.16. Zenvi Cloud's SSRF policy (cloud
 * net/ssrf.ts) and the CLI's web video fetch (host/web-video.ts, zenvi-core
 * web_video_ingest.assert_public_http_url) share it.
 */

import { BlockList, isIP } from "node:net";

const V4_BLOCKED: [string, number][] = [
  ["0.0.0.0", 8],
  ["10.0.0.0", 8],
  ["100.64.0.0", 10],
  ["127.0.0.0", 8],
  ["169.254.0.0", 16],
  ["172.16.0.0", 12],
  ["192.0.0.0", 24],
  ["192.0.2.0", 24],
  ["192.88.99.0", 24],
  ["192.168.0.0", 16],
  ["198.18.0.0", 15],
  ["198.51.100.0", 24],
  ["203.0.113.0", 24],
  ["224.0.0.0", 4],
  ["240.0.0.0", 4],
  ["168.63.129.16", 32],
];

const V6_BLOCKED: [string, number][] = [
  ["64:ff9b::", 96],
  ["64:ff9b:1::", 48],
  ["100::", 64],
  ["2001::", 23],
  ["2001:db8::", 32],
  ["2002::", 16],
  ["3fff::", 20],
];

const v4Blocked = new BlockList();
for (const [net, prefix] of V4_BLOCKED) v4Blocked.addSubnet(net, prefix, "ipv4");
const v6Blocked = new BlockList();
for (const [net, prefix] of V6_BLOCKED) v6Blocked.addSubnet(net, prefix, "ipv6");
// Only global unicast IPv6 (2000::/3) is ever public; this also rules out
// ::, ::1, ::/96 (IPv4-compatible), fc00::/7, fe80::/10, fec0::/10, ff00::/8.
const v6Global = new BlockList();
v6Global.addSubnet("2000::", 3, "ipv6");

/** Expand an IPv6 address (optionally with a trailing dotted quad) into 8 hextets. */
function hextets(ip: string): number[] | null {
  let text = ip.toLowerCase();
  const quad = /(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(text);
  if (quad) {
    const bytes = quad.slice(1).map(Number);
    if (bytes.some((b) => b > 255)) return null;
    const [a = 0, b = 0, c = 0, d = 0] = bytes;
    text = `${text.slice(0, quad.index)}${((a << 8) | b).toString(16)}:${((c << 8) | d).toString(16)}`;
  }
  const halves = text.split("::");
  if (halves.length > 2) return null;
  const parse = (part: string | undefined): number[] => (part ? part.split(":").map((h) => Number.parseInt(h, 16)) : []);
  const head = parse(halves[0]);
  const tail = parse(halves[1]);
  const missing = 8 - head.length - tail.length;
  if (halves.length === 1 ? missing !== 0 : missing < 1) return null;
  const all = [...head, ...Array<number>(halves.length === 1 ? 0 : missing).fill(0), ...tail];
  return all.length === 8 && all.every((h) => Number.isInteger(h) && h >= 0 && h <= 0xffff) ? all : null;
}

/** IPv4 embedded in an IPv4-mapped IPv6 address (::ffff:a.b.c.d), if it is one. */
function mappedV4(ip: string): string | null {
  const parts = hextets(ip);
  if (!parts) return null;
  if (parts.slice(0, 5).some((h) => h !== 0) || parts[5] !== 0xffff) return null;
  const hi = parts[6] ?? 0;
  const lo = parts[7] ?? 0;
  return `${hi >> 8}.${hi & 0xff}.${lo >> 8}.${lo & 0xff}`;
}

/** True when `ip` is a public unicast address we are willing to connect to. */
export function isPublicAddress(ip: string): boolean {
  if (ip.includes("%")) return false; // zone ids only exist on link-local scopes
  const family = isIP(ip);
  if (family === 4) return !v4Blocked.check(ip, "ipv4");
  if (family === 6) {
    const v4 = mappedV4(ip);
    if (v4 !== null) return isPublicAddress(v4);
    return v6Global.check(ip, "ipv6") && !v6Blocked.check(ip, "ipv6");
  }
  return false;
}
