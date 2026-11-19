// What this machine is called on the network, for the invite a phone scans.

import { networkInterfaces } from 'node:os';

/** How likely an address is to be the one the table's phones are on: home networks first. */
function rank(address: string): number {
	if (address.startsWith('192.168.')) return 0;
	if (address.startsWith('10.')) return 1;
	// 172.16 to 172.31 are private too, and on a PC most often a virtual machine's.
	if (/^172\.(1[6-9]|2\d|3[01])\./.test(address)) return 2;
	// 169.254 is what a machine gives itself when nothing answered: no way in.
	if (address.startsWith('169.254.')) return 4;
	return 3;
}

/**
 * The IPv4 addresses this machine has on its networks, the likeliest first.
 * Empty while the app only answers on this machine itself, which is how
 * `bun run dev` and `bun run start` begin without `--lan`.
 */
export function lanHosts(): string[] {
	const host = process.env.HOST;
	if (host && host !== '0.0.0.0' && host !== '::') return [];
	const found: string[] = [];
	for (const addresses of Object.values(networkInterfaces())) {
		for (const each of addresses ?? []) {
			if (each.family === 'IPv4' && !each.internal) found.push(each.address);
		}
	}
	return [...new Set(found)].sort((a, b) => rank(a) - rank(b));
}

/** The public addresses of the app, from `ORIGIN`, for a deployment behind a proxy. */
export function publicOrigins(): string[] {
	return (process.env.ORIGIN ?? '')
		.split(',')
		.map((origin) => origin.trim().replace(/\/+$/, ''))
		.filter(Boolean);
}
