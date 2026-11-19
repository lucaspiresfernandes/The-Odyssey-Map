// Copies everything that can't be made again into a folder of its own:
//
//   bun run backup              into backups/<date and time>/
//   bun run backup D:\maps      into D:\maps\<date and time>/
//
// That is the database, as one whole file, and the pictures as they were
// uploaded. Tiles and thumbnails are left out: the app makes them again
// when they are next asked for.
//
// It is safe to run while the app is running. The database is not copied
// as a file, which could catch it half written: SQLite is asked to write a
// clean copy of itself, and nothing in the one the app is using is changed.
//
// To go back to a backup: stop the app, and put its `odyssey.db` and its
// `uploads/` folder in `data/` in place of the ones there, along with
// deleting `odyssey.db-wal` and `odyssey.db-shm` if they are there.

import { Database } from 'bun:sqlite';
import { existsSync, statSync } from 'node:fs';
import { cp, mkdir, readdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { databaseUrl } from '#lib/server/db.ts';
import { dataDir } from '#lib/server/paths.ts';

/** `file:data/odyssey.db`, `file:///C:/maps/odyssey.db` or a bare path, as a path. Null for anything else. */
function fileOf(url: string | undefined, fallback: string): string | null {
	if (!url) return fallback;
	if (url.startsWith('file://')) return fileURLToPath(url);
	if (url.startsWith('file:')) return url.slice('file:'.length);
	// A single letter before a colon is a Windows drive, not a scheme.
	return /^[a-z][a-z0-9+.-]+:/i.test(url) ? null : url;
}

const database = fileOf(databaseUrl(), '');
const pictures = fileOf(process.env.STORAGE_URL, dataDir());
if (!database || !pictures) {
	console.error(
		'This backs up a database and pictures kept on this machine. DATABASE_URL or STORAGE_URL ' +
			'points somewhere else: back that up where it is kept.'
	);
	process.exit(1);
}
if (!existsSync(database)) {
	console.error(`There is no database at ${resolve(database)} yet. Nothing to back up.`);
	process.exit(1);
}

const now = new Date();
const two = (n: number) => String(n).padStart(2, '0');
const stamp =
	`${now.getFullYear()}-${two(now.getMonth() + 1)}-${two(now.getDate())}` +
	`_${two(now.getHours())}-${two(now.getMinutes())}-${two(now.getSeconds())}`;
const target = resolve(process.argv[2] ?? 'backups', stamp);
await mkdir(target, { recursive: true });

// The database, written out whole by SQLite itself.
const source = new Database(database, { readonly: true });
source.exec('PRAGMA busy_timeout = 5000');
source.query('VACUUM INTO ?').run(join(target, 'odyssey.db'));
source.close();

// The pictures, as they were uploaded.
const uploads = join(resolve(pictures), 'uploads');
let count = 0;
if (existsSync(uploads)) {
	await cp(uploads, join(target, 'uploads'), { recursive: true });
	count = (await readdir(join(target, 'uploads'))).length;
}

const megabytes = (bytes: number) => `${(bytes / 1024 / 1024).toFixed(1)} MB`;
console.log(`Backed up to ${target}`);
console.log(`  odyssey.db   ${megabytes(statSync(join(target, 'odyssey.db')).size)}`);
console.log(`  uploads/     ${count} ${count === 1 ? 'picture' : 'pictures'}`);
