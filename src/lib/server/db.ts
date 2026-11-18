// One SQLite file, and one server that opens it: the SvelteKit app. The
// WebSocket server never does; it asks the app instead.
//
// Queries go through Drizzle. The tables are defined in ./schema.ts and the
// migrations in drizzle/ are generated from it (`bun run db:generate`).

import { Database } from 'bun:sqlite';
import { drizzle } from 'drizzle-orm/bun-sqlite';
import { migrate } from 'drizzle-orm/bun-sqlite/migrator';
import type { BaseSQLiteDatabase } from 'drizzle-orm/sqlite-core';
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import * as schema from './schema';

/**
 * What every function that touches the database takes. Both the database
 * itself and the `tx` handed to a `db.transaction()` callback fit, so the
 * same function works inside and outside a transaction.
 */
export type Db = BaseSQLiteDatabase<'sync', void, typeof schema>;

export function dataDir(): string {
	return resolve(process.env.DATA_DIR ?? 'data');
}

export function uploadsDir(): string {
	return resolve(dataDir(), 'uploads');
}

/** The app is started from the project root, so this sits beside `data/`. */
function migrationsDir(): string {
	return resolve('drizzle');
}

export function openDb(path?: string) {
	const file = path ?? process.env.DATABASE_PATH ?? resolve(dataDir(), 'odyssey.db');
	if (file !== ':memory:') mkdirSync(dirname(resolve(file)), { recursive: true });

	const sqlite = new Database(file, { create: true });
	sqlite.exec('PRAGMA busy_timeout = 5000');
	sqlite.exec('PRAGMA journal_mode = WAL');
	sqlite.exec('PRAGMA synchronous = NORMAL');
	sqlite.exec('PRAGMA foreign_keys = ON');

	const db = drizzle({ client: sqlite, schema });
	migrate(db, { migrationsFolder: migrationsDir() });
	return db;
}

// Vite reloads server modules during development; keep one handle per process.
const globals = globalThis as typeof globalThis & { __odysseyDb?: ReturnType<typeof openDb> };

export function getDb() {
	return (globals.__odysseyDb ??= openDb());
}
