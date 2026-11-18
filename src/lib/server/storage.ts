// Where the campaign's pictures are kept, and everything made from them.
//
// The rest of the app knows a picture by a key, like `uploads/abc-def.png`
// or `tiles/abc-def/preview.webp`, and asks the storage to keep, hand back
// or remove what is under it. `STORAGE_URL` says which storage, by its
// scheme. It starts out as a folder on this machine: `data/`, where the
// keys are simply paths. A storage for somewhere else implements `Storage`
// and goes in the list at the bottom, and nothing else has to know.

import { mkdirSync } from 'node:fs';
import { rename, rm } from 'node:fs/promises';
import { dirname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { dataDir } from './paths';

export interface Storage {
	/** Keeps `bytes` under `key`, in place of whatever was there. */
	put(key: string, bytes: Uint8Array): Promise<void>;
	/** What is kept under `key`, to read or to send as it is, or null when nothing is. */
	get(key: string): Promise<Blob | null>;
	has(key: string): Promise<boolean>;
	/** Removes what is under `key`, and everything under `key/`. Nothing there is no trouble. */
	remove(key: string): Promise<void>;
	/**
	 * Only for a storage on this machine's disk: the path `key` is kept at.
	 * A big map image is then read and cut into tiles right where it lies,
	 * instead of being fetched and sent back piece by piece.
	 */
	pathOf?(key: string): string;
}

/** A folder on this machine. A key is a path inside it. */
export function diskStorage(root: string): Storage {
	const base = resolve(root);
	const pathOf = (key: string) => {
		const path = resolve(base, key);
		// Keys are made by the app from names it chose itself. This is the net under that.
		if (!path.startsWith(base + sep)) throw new Error(`"${key}" is not a key of this storage.`);
		return path;
	};
	return {
		pathOf,
		async put(key, bytes) {
			const path = pathOf(key);
			mkdirSync(dirname(path), { recursive: true });
			// Written under another name first, so a file that is there is whole.
			const draft = `${path}.${process.pid}.tmp`;
			await Bun.write(draft, bytes);
			await rename(draft, path);
		},
		async get(key) {
			const file = Bun.file(pathOf(key));
			return (await file.exists()) ? file : null;
		},
		has: (key) => Bun.file(pathOf(key)).exists(),
		async remove(key) {
			// Windows can hold on to a file that was only just written.
			await rm(pathOf(key), { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
		}
	};
}

/**
 * Nothing but this process's memory: gone when it stops. For tests, and as
 * the least a storage that is not a disk has to do.
 */
export function memoryStorage(): Storage {
	const kept = new Map<string, Blob>();
	return {
		async put(key, bytes) {
			// A copy, so what is kept can't be changed from outside afterwards.
			kept.set(key, new Blob([new Uint8Array(bytes)]));
		},
		get: async (key) => kept.get(key) ?? null,
		has: async (key) => kept.has(key),
		async remove(key) {
			for (const each of [...kept.keys()]) {
				if (each === key || each.startsWith(`${key}/`)) kept.delete(each);
			}
		}
	};
}

/** Each kind of storage, by the scheme of `STORAGE_URL` it answers to. */
const KINDS: Record<string, (url: string) => Storage> = {
	file: (url) =>
		diskStorage(url.startsWith('file://') ? fileURLToPath(url) : url.replace(/^file:/, '')),
	memory: () => memoryStorage()
};

export function openStorage(url = process.env.STORAGE_URL): Storage {
	if (!url) return diskStorage(dataDir());
	// A single letter before a colon is a Windows drive, not a scheme.
	const scheme = /^([a-z][a-z0-9+.-]+):/i.exec(url)?.[1].toLowerCase() ?? 'file';
	const open = KINDS[scheme];
	if (!open) {
		throw new Error(
			`No storage answers to "${scheme}:". STORAGE_URL can start with: ${Object.keys(KINDS).join(', ')}.`
		);
	}
	return open(url);
}

// Vite reloads server modules during development; keep one per process.
const globals = globalThis as typeof globalThis & { __odysseyStorage?: Storage };

export function getStorage(): Storage {
	return (globals.__odysseyStorage ??= openStorage());
}

/** Puts another storage in place of the one in use. For tests. */
export function setStorage(storage: Storage | undefined) {
	globals.__odysseyStorage = storage;
}
