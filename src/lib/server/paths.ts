// Where on this machine the app keeps what it is told to keep here.

import { resolve } from 'node:path';

/** The folder for the database file and the pictures, unless either is kept somewhere else. */
export function dataDir(): string {
	return resolve(process.env.DATA_DIR ?? 'data');
}
