// What is made from the pictures in the uploads directory.
//
// A big map image is cut into the preview and tiles described in
// src/lib/shared/tiles.ts. Every picture gets a thumbnail, for the gallery.
// They are made once per picture and kept in `data/tiles/` and
// `data/thumbs/`, which can be deleted at any time: whatever is missing is
// made again the next time someone asks for it.

import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { rename } from 'node:fs/promises';
import { rm } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import sharp from 'sharp';
import { dataDir, uploadsDir } from '#lib/server/db.ts';
import { PREVIEW_SIZE, TILE_SIZE } from '#lib/shared/tiles.ts';
import { LIMITS } from '#lib/shared/types.ts';

export function tilesDir(): string {
	return resolve(dataDir(), 'tiles');
}

export function thumbsDir(): string {
	return resolve(dataDir(), 'thumbs');
}

/** A file name without its extension: what the things made from a picture are filed under. */
const stem = (file: string) => file.slice(0, file.lastIndexOf('.'));

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
	const dir = join(tilesDir(), stem(file));
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

/** The longest side of a thumbnail: a card in the gallery, on a sharp screen. */
const THUMB_SIZE = 360;

const thumbing = new Map<string, Promise<void>>();

/**
 * Where the thumbnail of a picture is, made first if it isn't there yet.
 * `file` is a name from the uploads directory.
 */
export async function thumbOf(file: string): Promise<string> {
	const path = join(thumbsDir(), `${stem(file)}.webp`);
	if (!existsSync(path)) {
		let job = thumbing.get(file);
		if (!job) {
			job = (async () => {
				// A big map has a preview already, far quicker to read than the map.
				const preview = join(tilesDir(), stem(file), 'preview.webp');
				const tiled = existsSync(join(tilesDir(), stem(file), DONE));
				// Read here and handed over as bytes: given a path, sharp can keep
				// the file open on Windows, and then it can't be removed.
				const source = Bun.file(tiled ? preview : join(uploadsDir(), file));
				const small = await shrunk(await source.bytes(), THUMB_SIZE);
				mkdirSync(thumbsDir(), { recursive: true });
				// Written under another name first, so a thumbnail that is there is whole.
				const draft = `${path}.${process.pid}.tmp`;
				await Bun.write(draft, small.bytes);
				await rename(draft, path);
			})().finally(() => thumbing.delete(file));
			thumbing.set(file, job);
		}
		await job;
	}
	return path;
}

/**
 * Removes pictures from the uploads directory, each with its thumbnail,
 * preview and tiles. For pictures the gallery has let go of: nothing can
 * ask for these files again. A file that won't go is left behind with a
 * warning, since the database has forgotten it either way.
 */
export async function dropImages(files: string[]): Promise<void> {
	// Whatever is still being made would be written back after it went.
	await Promise.allSettled(files.flatMap((file) => [building.get(file), thumbing.get(file)]));

	for (const file of files) {
		const made = [
			join(uploadsDir(), file),
			join(tilesDir(), stem(file)),
			join(thumbsDir(), `${stem(file)}.webp`)
		];
		for (const path of made) {
			try {
				await rm(path, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
			} catch (err) {
				console.warn(`Could not remove ${path}:`, err);
			}
		}
	}
}
