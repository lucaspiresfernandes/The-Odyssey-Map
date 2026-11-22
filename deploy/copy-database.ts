// Copies a SQLite database into one new file, whole.
//
//   bun deploy/copy-database.ts <from> <to>
//
// SQLite makes the copy itself, so it is right whatever else has the
// database open at that moment: a backup job reading it, or the app
// writing to it. Copying the files by hand is only safe while nothing has.
// What was still in the write-ahead log is in the copy, which needs no
// `-wal` or `-shm` file beside it.

import { Database } from 'bun:sqlite';

const [from, to] = process.argv.slice(2);
if (!from || !to) {
	console.error('usage: bun deploy/copy-database.ts <from> <to>');
	process.exit(2);
}

function open(): Database {
	try {
		// Read-only, so the database itself is left exactly as it was.
		return new Database(from, { readonly: true });
	} catch {
		// One that was not closed cleanly may need its log replayed first.
		return new Database(from);
	}
}

const db = open();
db.exec('PRAGMA busy_timeout = 10000');
db.exec(`VACUUM INTO '${to.replaceAll("'", "''")}'`);
db.close();
