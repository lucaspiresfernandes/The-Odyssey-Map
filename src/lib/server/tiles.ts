// What is made from the pictures the campaign keeps.
//
// A big map image is cut into the preview and tiles described in
// src/lib/shared/tiles.ts. Every picture gets a thumbnail, for the gallery.
// They are made once per picture and kept in the storage beside it, under
// `tiles/` and `thumbs/`. Either can be emptied at any time: whatever is
// missing is made again the next time someone asks for it.
//
// Everything here goes through `server/storage.ts`, so none of it cares
// whether the pictures are on this machine's disk or somewhere else.

import { mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import sharp from 'sharp';
import { getStorage } from '#lib/server/storage.ts';
import { PREVIEW_SIZE, TILE_SIZE } from '#lib/shared/tiles.ts';
import { LIMITS } from '#lib/shared/types.ts';

/** A file name without its extension: what the things made from a picture are filed under. */
const stem = (file: string) => file.slice(0, file.lastIndexOf('.'));

/** The key a picture itself is kept under, as it was uploaded. */
export const uploadKey = (file: string) => `uploads/${file}`;
const thumbKey = (file: string) => `thumbs/${stem(file)}.webp`;
/** Everything cut from a big map image is under this. */
const tilesKey = (file: string) => `tiles/${stem(file)}`;

/** Opens an image the way a browser shows it: turned upright if a camera stored it sideways. */
function open(input: string | Uint8Array) {
	return sharp(input, { limitInputPixels: LIMITS.imageSide ** 2 }).autoOrient();
}

/** The size of an image in pixels, or null if it can't be read as one. */
export async function imageSize(
	input: string | Uint8Array
): Promise<{ width: number; height: number } | null> {
	try {
		// Only the header is read here, so any size is safe to look at.
		const { autoOrient } = await sharp(input, { limitInputPixels: false }).metadata();
		return { width: autoOrient.width, height: autoOrient.height };
	} catch {
		return null;
	}
}

const WEBP = { quality: 90, smartSubsample: true } as const;

/**
 * A picture made to fit inside a square of `side` pixels, as WebP. One that
 * fits already is not made bigger. Throws if it can't be read.
 */
export async function shrunk(
	input: string | Uint8Array,
	side: number
): Promise<{ bytes: Uint8Array; width: number; height: number }> {
	const { data, info } = await open(input)
		.resize({ width: side, height: side, fit: 'inside', withoutEnlargement: true })
		.webp(WEBP)
		.toBuffer({ resolveWithObject: true });
	return { bytes: data, width: info.width, height: info.height };
}

/** What is kept under `key`, as bytes. Throws when nothing is. */
async function bytesOf(key: string): Promise<Uint8Array> {
	const kept = await getStorage().get(key);
	if (!kept) throw new Error(`Nothing is kept under ${key}.`);
	return kept.bytes();
}

/**
 * Written last, so its presence says the tiles are complete. It holds the
 * number sharp gave the full-size level: sharp counts its levels from the
 * smallest up, the other way round from ours.
 */
const DONE = 'done';

async function build(file: string): Promise<void> {
	const storage = getStorage();
	const base = tilesKey(file);
	// Whatever is there already was left half-made.
	await storage.remove(base);

	// On this machine's disk everything is written straight into place and
	// nothing is moved afterwards: on Windows a folder of files this fresh
	// often can't be moved yet. For a storage that is somewhere else, the
	// tiles are cut in a scratch folder and sent over from there.
	const place = storage.pathOf?.(base);
	const dir = place ?? mkdtempSync(join(tmpdir(), 'odyssey-tiles-'));
	try {
		mkdirSync(dir, { recursive: true });
		// A path where there is one: sharp then reads a big image a strip at a time.
		const source = storage.pathOf?.(uploadKey(file)) ?? (await bytesOf(uploadKey(file)));

		await open(source)
			.resize({ width: PREVIEW_SIZE, height: PREVIEW_SIZE, fit: 'inside' })
			.webp(WEBP)
			.toFile(join(dir, 'preview.webp'));

		// Makes `levels_files/<level>/<x>_<y>.webp`.
		await open(source)
			.webp(WEBP)
			.tile({ size: TILE_SIZE, overlap: 0, layout: 'dz', depth: 'onetile' })
			.toFile(join(dir, 'levels'));

		const levels = readdirSync(join(dir, 'levels_files')).filter((name) =>
			Number.isInteger(Number(name))
		);
		const full = String(Math.max(...levels.map(Number)));
		if (place) {
			writeFileSync(join(dir, DONE), full);
			return;
		}

		await storage.put(`${base}/preview.webp`, await Bun.file(join(dir, 'preview.webp')).bytes());
		for (const level of levels) {
			for (const tile of readdirSync(join(dir, 'levels_files', level))) {
				const bytes = await Bun.file(join(dir, 'levels_files', level, tile)).bytes();
				await storage.put(`${base}/levels_files/${level}/${tile}`, bytes);
			}
		}
		await storage.put(`${base}/${DONE}`, new TextEncoder().encode(full));
	} finally {
		if (!place) rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
	}
}

/** What `DONE` says about a picture's tiles, once they are all there: made first if they aren't. */
async function tiled(file: string): Promise<number> {
	const storage = getStorage();
	const marker = `${tilesKey(file)}/${DONE}`;
	let done = await storage.get(marker);
	if (!done) {
		await build(file);
		done = await storage.get(marker);
	}
	if (!done) throw new Error(`The tiles of ${file} went missing while they were being made.`);
	return Number(await done.text());
}

// Whoever asks for a picture's tiles or its thumbnail while they are being
// looked for or made waits for the same answer. Each is in here from the
// moment it is asked for, so `dropImages` never misses one that has begun.
const building = new Map<string, Promise<number>>();

/**
 * The keys of the preview and the tiles of an uploaded image, which are
 * made first if they aren't there yet. `file` is the name of a picture.
 */
export async function tilesOf(
	file: string
): Promise<{ preview: string; tile: (level: number, x: number, y: number) => string }> {
	const base = tilesKey(file);
	let job = building.get(file);
	if (!job) {
		job = tiled(file).finally(() => building.delete(file));
		building.set(file, job);
	}
	const full = await job;
	return {
		preview: `${base}/preview.webp`,
		tile: (level, x, y) => `${base}/levels_files/${full - level}/${x}_${y}.webp`
	};
}

/** The longest side of a thumbnail: a card in the gallery, on a sharp screen. */
const THUMB_SIZE = 360;

const thumbing = new Map<string, Promise<void>>();

/**
 * The key of a picture's thumbnail, which is made first if it isn't there
 * yet. `file` is the name of a picture.
 */
export async function thumbOf(file: string): Promise<string> {
	const storage = getStorage();
	const key = thumbKey(file);
	let job = thumbing.get(file);
	if (!job) {
		job = (async () => {
			if (await storage.has(key)) return;
			// A big map has a preview already, far quicker to read than the map.
			const cut = await storage.has(`${tilesKey(file)}/${DONE}`);
			// Handed over as bytes: given a path, sharp can keep the file open
			// on Windows, and then it can't be removed.
			const source = await bytesOf(cut ? `${tilesKey(file)}/preview.webp` : uploadKey(file));
			const small = await shrunk(source, THUMB_SIZE);
			await storage.put(key, small.bytes);
		})().finally(() => thumbing.delete(file));
		thumbing.set(file, job);
	}
	await job;
	return key;
}

/**
 * Removes pictures from the storage, each with its thumbnail, preview and
 * tiles. For pictures the gallery has let go of: nothing can ask for them
 * again. One that won't go is left behind with a warning, since the
 * database has forgotten it either way.
 */
export async function dropImages(files: string[]): Promise<void> {
	// Whatever is still being made would be written back after it went.
	await Promise.allSettled(files.flatMap((file) => [building.get(file), thumbing.get(file)]));

	const storage = getStorage();
	for (const file of files) {
		for (const key of [uploadKey(file), tilesKey(file), thumbKey(file)]) {
			try {
				await storage.remove(key);
			} catch (err) {
				console.warn(`Could not remove ${key}:`, err);
			}
		}
	}
}
