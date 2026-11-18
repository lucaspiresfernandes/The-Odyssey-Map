// Cuts uploaded map images into the preview and tiles described in
// src/lib/shared/tiles.ts. They are made once per image and kept in
// `data/tiles/`, which can be deleted at any time: whatever is missing is
// made again the next time someone opens the map.

import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import sharp from 'sharp';
import { dataDir, uploadsDir } from '#lib/server/db.ts';
import { PREVIEW_SIZE, TILE_SIZE } from '#lib/shared/tiles.ts';
import { LIMITS } from '#lib/shared/types.ts';

export function tilesDir(): string {
	return resolve(dataDir(), 'tiles');
}

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
 * Written last, so its presence says the directory is complete. It holds the
 * number sharp gave the full-size level: sharp counts its levels from the
 * smallest up, the other way round from ours.
 */
const DONE = 'done';

async function build(file: string, dir: string): Promise<void> {
	const source = join(uploadsDir(), file);
	// Whatever is there already was left half-made. Everything is written
	// straight into place and nothing is renamed afterwards: on Windows a
	// folder of files this fresh often can't be moved yet.
	rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
	mkdirSync(dir, { recursive: true });

	await open(source)
		.resize({ width: PREVIEW_SIZE, height: PREVIEW_SIZE, fit: 'inside' })
		.webp(WEBP)
		.toFile(join(dir, 'preview.webp'));

	// Makes `levels_files/<level>/<x>_<y>.webp`.
	await open(source)
		.webp(WEBP)
		.tile({ size: TILE_SIZE, overlap: 0, layout: 'dz', depth: 'onetile' })
		.toFile(join(dir, 'levels'));

	const made = readdirSync(join(dir, 'levels_files')).map(Number).filter(Number.isInteger);
	writeFileSync(join(dir, DONE), String(Math.max(...made)));
}

const building = new Map<string, Promise<void>>();

/**
 * Where the preview and the tiles of an uploaded image are, made first if
 * they aren't there yet. `file` is a name from the uploads directory.
 */
export async function tilesOf(
	file: string
): Promise<{ preview: string; tile: (level: number, x: number, y: number) => string }> {
	const dir = join(tilesDir(), file.slice(0, file.lastIndexOf('.')));
	if (!existsSync(join(dir, DONE))) {
		let job = building.get(file);
		if (!job) {
			job = build(file, dir).finally(() => building.delete(file));
			building.set(file, job);
		}
		await job;
	}
	const full = Number(readFileSync(join(dir, DONE), 'utf8'));
	return {
		preview: join(dir, 'preview.webp'),
		tile: (level, x, y) => join(dir, 'levels_files', String(full - level), `${x}_${y}.webp`)
	};
}

/**
 * Removes every image that was uploaded for these maps, with its preview
 * and tiles. For maps that have been deleted: nothing can ask for these
 * files again. A file that won't go is left behind with a warning, since
 * the maps are gone from the database either way.
 */
export async function dropImagesOf(mapIds: string[]): Promise<void> {
	const gone = new Set(mapIds);
	// An upload is `<mapId>-<random>.<ext>` and its tiles are in a folder of
	// the same name without the extension. Ids have no dash in them.
	const theirs = (name: string) => gone.has(name.slice(0, Math.max(0, name.indexOf('-'))));

	// Tiles still being cut would be written back after their folder went.
	await Promise.allSettled([...building].filter(([file]) => theirs(file)).map(([, job]) => job));

	for (const dir of [uploadsDir(), tilesDir()]) {
		if (!existsSync(dir)) continue;
		for (const name of readdirSync(dir).filter(theirs)) {
			try {
				await rm(join(dir, name), { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
			} catch (err) {
				console.warn(`Could not remove ${join(dir, name)}:`, err);
			}
		}
	}
}
