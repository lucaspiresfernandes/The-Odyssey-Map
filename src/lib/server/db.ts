// One SQLite file, opened by both the SvelteKit server and the WebSocket
// server. WAL mode lets the two processes read and write side by side.

import { Database } from 'bun:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

export type Db = Database;

export function dataDir(): string {
	return resolve(process.env.DATA_DIR ?? 'data');
}

export function uploadsDir(): string {
	return resolve(dataDir(), 'uploads');
}

const MIGRATIONS: string[] = [
	`
	CREATE TABLE users (
		id TEXT PRIMARY KEY,
		name TEXT NOT NULL,
		username TEXT UNIQUE,
		password_hash TEXT,
		created_at INTEGER NOT NULL
	);

	CREATE TABLE sessions (
		token_hash TEXT PRIMARY KEY,
		user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
		expires_at INTEGER NOT NULL
	);

	CREATE TABLE campaigns (
		id TEXT PRIMARY KEY,
		name TEXT NOT NULL,
		owner_id TEXT NOT NULL REFERENCES users(id),
		invite_token TEXT NOT NULL UNIQUE,
		root_map_id TEXT NOT NULL,
		created_at INTEGER NOT NULL
	);

	CREATE TABLE members (
		campaign_id TEXT NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
		user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
		role TEXT NOT NULL CHECK (role IN ('gm', 'player')),
		joined_at INTEGER NOT NULL,
		PRIMARY KEY (campaign_id, user_id)
	);

	CREATE TABLE maps (
		id TEXT PRIMARY KEY,
		campaign_id TEXT NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
		parent_id TEXT REFERENCES maps(id),
		name TEXT NOT NULL,
		image_file TEXT,
		width INTEGER NOT NULL,
		height INTEGER NOT NULL,
		created_at INTEGER NOT NULL
	);
	CREATE INDEX maps_campaign ON maps(campaign_id);

	CREATE TABLE regions (
		id TEXT PRIMARY KEY,
		map_id TEXT NOT NULL REFERENCES maps(id) ON DELETE CASCADE,
		target_map_id TEXT NOT NULL REFERENCES maps(id),
		points TEXT NOT NULL,
		created_at INTEGER NOT NULL,
		deleted_at INTEGER
	);
	CREATE INDEX regions_map ON regions(map_id);

	CREATE TABLE markers (
		id TEXT PRIMARY KEY,
		map_id TEXT NOT NULL REFERENCES maps(id) ON DELETE CASCADE,
		kind TEXT NOT NULL CHECK (kind IN ('world', 'player')),
		type TEXT NOT NULL,
		title TEXT NOT NULL,
		description TEXT NOT NULL DEFAULT '',
		x REAL NOT NULL,
		y REAL NOT NULL,
		hidden INTEGER NOT NULL DEFAULT 0,
		author_id TEXT NOT NULL,
		author_name TEXT NOT NULL,
		created_at INTEGER NOT NULL,
		updated_at INTEGER NOT NULL,
		deleted_at INTEGER
	);
	CREATE INDEX markers_map ON markers(map_id);

	-- Append-only. Every change to the world is one row here; the edit
	-- history reads it and the WebSocket server tails it for live updates.
	CREATE TABLE events (
		seq INTEGER PRIMARY KEY AUTOINCREMENT,
		campaign_id TEXT NOT NULL,
		map_id TEXT NOT NULL,
		actor_id TEXT NOT NULL,
		actor_name TEXT NOT NULL,
		at INTEGER NOT NULL,
		entity TEXT NOT NULL,
		entity_id TEXT NOT NULL,
		action TEXT NOT NULL,
		before TEXT,
		after TEXT
	);
	CREATE INDEX events_campaign ON events(campaign_id, seq);
	`
];

function migrate(db: Database) {
	// IMMEDIATE takes the write lock up front, so if both servers start at
	// once the second one waits and then sees the first one's work.
	db.exec('BEGIN IMMEDIATE');
	try {
		const row = db.query('PRAGMA user_version').get() as { user_version: number };
		for (let v = row.user_version; v < MIGRATIONS.length; v++) {
			db.exec(MIGRATIONS[v]);
			db.exec(`PRAGMA user_version = ${v + 1}`);
		}
		db.exec('COMMIT');
	} catch (err) {
		db.exec('ROLLBACK');
		throw err;
	}
}

export function openDb(path?: string): Database {
	const file = path ?? process.env.DATABASE_PATH ?? resolve(dataDir(), 'odyssey.db');
	if (file !== ':memory:') mkdirSync(dirname(resolve(file)), { recursive: true });

	const db = new Database(file, { create: true });
	db.exec('PRAGMA busy_timeout = 5000');
	db.exec('PRAGMA journal_mode = WAL');
	db.exec('PRAGMA synchronous = NORMAL');
	db.exec('PRAGMA foreign_keys = ON');
	migrate(db);
	return db;
}

// Vite reloads server modules during development; keep one handle per process.
const globals = globalThis as typeof globalThis & { __odysseyDb?: Database };

export function getDb(): Database {
	return (globals.__odysseyDb ??= openDb());
}
