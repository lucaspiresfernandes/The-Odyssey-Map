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
//
// `bun run dev` and `bun run start` make one of their own before the servers
// come up, in `backups/auto/` beside the data folder: see `autoBackup`.

import { Database } from 'bun:sqlite';
import { existsSync, statSync } from 'node:fs';
import { copyFile, cp, mkdir, readdir, rm } from 'node:fs/promises';
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

/** Where the database and the pictures are, when both are kept on this machine. */
function sources(): { database: string; uploads: string } | null {
	const database = fileOf(databaseUrl(), '');
	const pictures = fileOf(process.env.STORAGE_URL, dataDir());
	if (!database || !pictures) return null;
	return { database: resolve(database), uploads: join(resolve(pictures), 'uploads') };
}

/** A folder name that sorts by when it was made: `2026-11-19_20-15-03`. */
function stampOf(now: Date): string {
	const two = (n: number) => String(n).padStart(2, '0');
	return (
		`${now.getFullYear()}-${two(now.getMonth() + 1)}-${two(now.getDate())}` +
		`_${two(now.getHours())}-${two(now.getMinutes())}-${two(now.getSeconds())}`
	);
}

const STAMP = /^\d{4}-\d{2}-\d{2}_\d{2}-\d{2}-\d{2}$/;

/** The database, written out whole by SQLite itself. */
function copyDatabase(from: string, to: string) {
	const source = new Database(from, { readonly: true });
	try {
		source.exec('PRAGMA busy_timeout = 5000');
		source.query('VACUUM INTO ?').run(to);
	} finally {
		source.close();
	}
}

const megabytes = (bytes: number) => `${(bytes / 1024 / 1024).toFixed(1)} MB`;

/** How many backups `bun run dev` and `bun run start` keep before the oldest goes. */
export const AUTO_BACKUPS_KEPT = 20;

/** Where the automatic backups go: `backups/auto/` beside the data folder. */
export function autoBackupDir(): string {
	return resolve(dataDir(), '..', 'backups', 'auto');
}

/**
 * The backup made each time the servers are started: the database as it is
 * before anything touches it, a migration included, in a dated folder of
 * its own, and every picture not copied yet into one `uploads/` folder
 * beside those. A picture's file never changes, so one copy of each does
 * for every dated database. The newest `AUTO_BACKUPS_KEPT` are kept.
 *
 * It never stops the servers from starting: with nothing to back up it
 * says nothing, and a failure is a warning. Returns the folder it wrote,
 * or null when it wrote none.
 */
export async function autoBackup(root = autoBackupDir()): Promise<string | null> {
	const from = sources();
	if (!from || !existsSync(from.database)) return null;
	const target = join(root, stampOf(new Date()));
	await mkdir(target, { recursive: true });
	copyDatabase(from.database, join(target, 'odyssey.db'));

	// The pictures: only the ones that are not there yet.
	let added = 0;
	if (existsSync(from.uploads)) {
		const kept = join(root, 'uploads');
		await mkdir(kept, { recursive: true });
		const have = new Set(await readdir(kept));
		for (const file of await readdir(from.uploads)) {
			if (have.has(file)) continue;
			await copyFile(join(from.uploads, file), join(kept, file));
			added++;
		}
	}

	// The oldest go once there are more than are kept.
	const dated = (await readdir(root)).filter((name) => STAMP.test(name)).sort();
	for (const old of dated.slice(0, Math.max(0, dated.length - AUTO_BACKUPS_KEPT))) {
		await rm(join(root, old), { recursive: true, force: true });
	}

	const size = megabytes(statSync(join(target, 'odyssey.db')).size);
	const pictures = added ? `, ${added} new ${added === 1 ? 'picture' : 'pictures'}` : '';
	console.log(`Backed up the database to ${target} (${size}${pictures})`);
	return target;
}

if (import.meta.main) {
	const from = sources();
	if (!from) {
		console.error(
			'This backs up a database and pictures kept on this machine. DATABASE_URL or STORAGE_URL ' +
				'points somewhere else: back that up where it is kept.'
		);
		process.exit(1);
	}
	if (!existsSync(from.database)) {
		console.error(`There is no database at ${from.database} yet. Nothing to back up.`);
		process.exit(1);
	}

	const target = resolve(process.argv[2] ?? 'backups', stampOf(new Date()));
	await mkdir(target, { recursive: true });
	copyDatabase(from.database, join(target, 'odyssey.db'));

	// The pictures, as they were uploaded.
	let count = 0;
	if (existsSync(from.uploads)) {
		await cp(from.uploads, join(target, 'uploads'), { recursive: true });
		count = (await readdir(join(target, 'uploads'))).length;
	}

	console.log(`Backed up to ${target}`);
	console.log(`  odyssey.db   ${megabytes(statSync(join(target, 'odyssey.db')).size)}`);
	console.log(`  uploads/     ${count} ${count === 1 ? 'picture' : 'pictures'}`);
}
