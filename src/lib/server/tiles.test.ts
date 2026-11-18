import { afterAll, beforeAll, expect, test } from 'bun:test';
import { existsSync, mkdirSync, readdirSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';
import sharp from 'sharp';
import { uploadsDir } from './db';
import { dropImagesOf, tilesDir, tilesOf } from './tiles';

// Inside the project on purpose, not in the system's temp folder: Windows
// treats freshly written folders differently here, and that is what the
// app runs into.
const dataDir = resolve('node_modules', '.cache', `odyssey-tiles-test-${process.pid}`);
const before = process.env.DATA_DIR;

beforeAll(() => {
	process.env.DATA_DIR = dataDir;
	mkdirSync(uploadsDir(), { recursive: true });
});

afterAll(() => {
	if (before === undefined) delete process.env.DATA_DIR;
	else process.env.DATA_DIR = before;
	rmSync(dataDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
});

/** Saves an image big enough to be cut into tiles, the way an upload is. */
async function upload(file: string) {
	await sharp({ create: { width: 2400, height: 1500, channels: 3, background: '#345' } })
		.png()
		.toFile(join(uploadsDir(), file));
	await tilesOf(file);
}

test('the images of deleted maps go, tiles and all, and no others', async () => {
	await upload('mapA-first.png');
	await upload('mapA-second.png');
	await upload('mapB-only.png');
	// An id that merely starts the same is another map.
	await upload('mapAB-other.png');
	expect(existsSync(join(tilesDir(), 'mapA-first', 'levels_files'))).toBe(true);

	// Straight after the tiles were written, as when a map is deleted moments
	// after its image went up.
	await dropImagesOf(['mapA', 'mapC']);

	expect(readdirSync(uploadsDir()).sort()).toEqual(['mapAB-other.png', 'mapB-only.png']);
	expect(readdirSync(tilesDir()).sort()).toEqual(['mapAB-other', 'mapB-only']);
});

test('tiles still being cut are waited for, not left behind', async () => {
	await sharp({ create: { width: 2400, height: 1500, channels: 3, background: '#543' } })
		.png()
		.toFile(join(uploadsDir(), 'mapD-busy.png'));
	const cutting = tilesOf('mapD-busy.png');
	await dropImagesOf(['mapD']);
	await cutting.catch(() => {});

	expect(existsSync(join(uploadsDir(), 'mapD-busy.png'))).toBe(false);
	expect(existsSync(join(tilesDir(), 'mapD-busy'))).toBe(false);
});
