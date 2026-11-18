import { afterAll, beforeAll, expect, test } from 'bun:test';
import { existsSync, mkdirSync, readdirSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';
import sharp from 'sharp';
import { uploadsDir } from './db';
import { dropImages, shrunk, thumbOf, thumbsDir, tilesDir, tilesOf } from './tiles';

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

test('dropped pictures go, thumbnail, tiles and all, and no others', async () => {
	await upload('a-first.png');
	await upload('a-second.png');
	await upload('b-only.png');
	for (const file of ['a-first.png', 'a-second.png', 'b-only.png']) await thumbOf(file);
	expect(existsSync(join(tilesDir(), 'a-first', 'levels_files'))).toBe(true);
	expect(existsSync(join(thumbsDir(), 'a-first.webp'))).toBe(true);

	// Straight after the tiles were written, as when a picture is taken out
	// of the gallery moments after it went up. One that was never there is
	// no trouble.
	await dropImages(['a-first.png', 'a-second.png', 'c-never.png']);

	expect(readdirSync(uploadsDir())).toEqual(['b-only.png']);
	expect(readdirSync(tilesDir())).toEqual(['b-only']);
	expect(readdirSync(thumbsDir())).toEqual(['b-only.webp']);
});

test('a thumbnail is small, and made for small pictures too', async () => {
	await upload('d-big.png');
	await sharp({ create: { width: 300, height: 900, channels: 3, background: '#345' } })
		.png()
		.toFile(join(uploadsDir(), 'd-small.png'));

	// Read as bytes: sharp would keep a file it was pointed at open.
	const look = async (file: string) => sharp(await Bun.file(await thumbOf(file)).bytes()).metadata();
	const big = await look('d-big.png');
	const small = await look('d-small.png');
	expect([big.format, big.width, big.height]).toEqual(['webp', 360, 225]);
	expect([small.format, small.width, small.height]).toEqual(['webp', 120, 360]);
	await dropImages(['d-big.png', 'd-small.png']);
});

test('a token picture is shrunk to fit, and a small one left as it is', async () => {
	const portrait = await sharp({ create: { width: 1200, height: 1800, channels: 3, background: '#a42' } })
		.png()
		.toBuffer();
	const icon = await sharp({ create: { width: 64, height: 64, channels: 3, background: '#a42' } })
		.png()
		.toBuffer();
	expect(await shrunk(portrait, 512)).toMatchObject({ width: 341, height: 512 });
	expect(await shrunk(icon, 512)).toMatchObject({ width: 64, height: 64 });
	expect(shrunk(new Uint8Array([1, 2, 3]), 512)).rejects.toThrow();
});

test('tiles still being cut are waited for, not left behind', async () => {
	await sharp({ create: { width: 2400, height: 1500, channels: 3, background: '#543' } })
		.png()
		.toFile(join(uploadsDir(), 'e-busy.png'));
	const cutting = tilesOf('e-busy.png');
	await dropImages(['e-busy.png']);
	await cutting.catch(() => {});

	expect(existsSync(join(uploadsDir(), 'e-busy.png'))).toBe(false);
	expect(existsSync(join(tilesDir(), 'e-busy'))).toBe(false);
});
