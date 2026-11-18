// The database as one SQLite file on this machine, opened with bun:sqlite.
// It answers to `file:` addresses, plain paths, and `:memory:` for tests.

import { Database } from 'bun:sqlite';
import { drizzle } from 'drizzle-orm/bun-sqlite';
import { migrate } from 'drizzle-orm/bun-sqlite/migrator';
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { DatabaseDriver } from '../db';
import * as schema from '../schema';

/** `file:data/odyssey.db`, `file:///C:/maps/odyssey.db` or a bare path, as a path. */
function pathOf(url: string): string {
	if (url.startsWith('file://')) return fileURLToPath(url);
	return url.startsWith('file:') ? url.slice('file:'.length) : url;
}

export const bunSqlite: DatabaseDriver = {
	schemes: ['file'],

	open(url, migrationsFolder) {
		const file = pathOf(url);
		if (file !== ':memory:') mkdirSync(dirname(resolve(file)), { recursive: true });

		const sqlite = new Database(file, { create: true });
		sqlite.exec('PRAGMA busy_timeout = 5000');
		sqlite.exec('PRAGMA journal_mode = WAL');
		sqlite.exec('PRAGMA synchronous = NORMAL');
		sqlite.exec('PRAGMA foreign_keys = ON');

		const db = drizzle({ client: sqlite, schema });
		migrate(db, { migrationsFolder });
		return db;
	}
};
