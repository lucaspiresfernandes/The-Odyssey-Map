// One database, and one server that opens it: the SvelteKit app. The
// WebSocket server never does; it asks the app instead.
//
// Queries go through Drizzle. The tables are defined in ./schema.ts and the
// migrations in drizzle/ are generated from it (`bun run db:generate`).
//
// Where the database is kept is a driver's business. `DATABASE_URL` says
// which, by its scheme: `file:data/odyssey.db` is the SQLite file this
// starts out with. A driver for somewhere else goes in ./drivers and in the
// list below, and nothing else has to know.

import type { BaseSQLiteDatabase } from 'drizzle-orm/sqlite-core';
import { resolve } from 'node:path';
import { bunSqlite } from './drivers/bun-sqlite';
import { dataDir } from './paths';
import type * as schema from './schema';

/**
 * What every function that touches the database takes. Both the database
 * itself and the `tx` handed to a `db.transaction()` callback fit, so the
 * same function works inside and outside a transaction.
 *
 * Queries are synchronous: `.get()`, `.all()` and `.run()` answer at once,
 * and a transaction is a plain function. A driver has to be one Drizzle
 * drives that way. One that answers with promises (a database reached over
 * the network) needs the queries awaited first: see the README.
 */
export type Db = BaseSQLiteDatabase<'sync', unknown, typeof schema>;

/** One way of keeping the database. */
export interface DatabaseDriver {
	/** The schemes of `DATABASE_URL` it answers to: `file` for `file:data/odyssey.db`. */
	schemes: readonly string[];
	/** Opens the database at `url`, brought up to date with the migrations in that folder. */
	open(url: string, migrationsFolder: string): Db;
}

const DRIVERS: readonly DatabaseDriver[] = [bunSqlite];

/** The app is started from the project root, so this sits beside `data/`. */
function migrationsDir(): string {
	return resolve('drizzle');
}

/** What comes before the colon of an address, or `file` for a plain path. */
function schemeOf(url: string): string {
	if (url === ':memory:') return 'file';
	// A single letter before a colon is a Windows drive, not a scheme.
	return /^([a-z][a-z0-9+.-]+):/i.exec(url)?.[1].toLowerCase() ?? 'file';
}

/** Where the database is: what was asked for, what the environment says, or the file in `data/`. */
export function databaseUrl(url?: string): string {
	return (
		url ??
		process.env.DATABASE_URL ??
		process.env.DATABASE_PATH ??
		resolve(dataDir(), 'odyssey.db')
	);
}

export function openDb(url?: string): Db {
	const target = databaseUrl(url);
	const scheme = schemeOf(target);
	const driver = DRIVERS.find((each) => each.schemes.includes(scheme));
	if (!driver) {
		const known = DRIVERS.flatMap((each) => each.schemes).join(', ');
		throw new Error(
			`No database driver answers to "${scheme}:". DATABASE_URL can start with: ${known}.`
		);
	}
	return driver.open(target, migrationsDir());
}

// Vite reloads server modules during development; keep one handle per process.
const globals = globalThis as typeof globalThis & { __odysseyDb?: Db };

export function getDb(): Db {
	return (globals.__odysseyDb ??= openDb());
}
