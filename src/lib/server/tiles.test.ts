import { afterAll, beforeAll, expect, test } from 'bun:test';
import { existsSync, mkdirSync, readdirSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';
import sharp from 'sharp';
import { openDb } from './db';
import { diskStorage, getStorage, memoryStorage, openStorage, setStorage } from './storage';
import { dropImages, shrunk, thumbOf, tilesOf, uploadKey } from './tiles';

// Inside the project on purpose, not in the system's temp folder: Windows
// treats freshly written folders differently here, and that is what the
// app runs into.
const dataDir = resolve('node_modules', '.cache', `odyssey-tiles-test-${process.pid}`);
const uploads = join(dataDir, 'uploads');
const tiles = join(dataDir, 'tiles');
const thumbs = join(dataDir, 'thumbs');

beforeAll(() => {
	setStorage(diskStorage(dataDir));
	mkdirSync(uploads, { recursive: true });
});

afterAll(() => {
	setStorage(undefined);
	rmSync(dataDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
});

/** An image big enough to be cut into tiles. */
const big = (background = '#345') =>
	sharp({ create: { width: 2400, height: 1500, channels: 3, background } }).png();

/** Saves one the way an upload is, and cuts its tiles. */
async function upload(file: string) {
	await big().toFile(join(uploads, file));
	await tilesOf(file);
}

/** What is kept under a key, read as an image. */
async function look(key: string) {
	return sharp(await (await getStorage().get(key))!.bytes()).metadata();
}

test('dropped pictures go, thumbnail, tiles and all, and no others', async () => {
	await upload('a-first.png');
	await upload('a-second.png');
	await upload('b-only.png');
	for (const file of ['a-first.png', 'a-second.png', 'b-only.png']) await thumbOf(file);
	expect(existsSync(join(tiles, 'a-first', 'levels_files'))).toBe(true);
	expect(existsSync(join(thumbs, 'a-first.webp'))).toBe(true);

	// Straight after the tiles were written, as when a picture is taken out
	// of the gallery moments after it went up. One that was never there is
	// no trouble.
	await dropImages(['a-first.png', 'a-second.png', 'c-never.png']);

	expect(readdirSync(uploads)).toEqual(['b-only.png']);
	expect(readdirSync(tiles)).toEqual(['b-only']);
	expect(readdirSync(thumbs)).toEqual(['b-only.webp']);
});

test('a thumbnail is small, and made for small pictures too', async () => {
	await upload('d-big.png');
	await sharp({ create: { width: 300, height: 900, channels: 3, background: '#345' } })
		.png()
		.toFile(join(uploads, 'd-small.png'));

	const large = await look(await thumbOf('d-big.png'));
	const small = await look(await thumbOf('d-small.png'));
	expect([large.format, large.width, large.height]).toEqual(['webp', 360, 225]);
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
	await big('#543').toFile(join(uploads, 'e-busy.png'));
	const cutting = tilesOf('e-busy.png');
	await dropImages(['e-busy.png']);
	await cutting.catch(() => {});

	expect(existsSync(join(uploads, 'e-busy.png'))).toBe(false);
	expect(existsSync(join(tiles, 'e-busy'))).toBe(false);
});

test('a storage that is not a disk is sent the same pieces, and gives them back', async () => {
	const disk = getStorage();
	const elsewhere = memoryStorage();
	expect(elsewhere.pathOf).toBeUndefined();
	setStorage(elsewhere);
	try {
		await elsewhere.put(uploadKey('f-far.png'), await big().toBuffer());
		const pieces = await tilesOf('f-far.png');
		const thumb = await thumbOf('f-far.png');

		const preview = await look(pieces.preview);
		expect([preview.format, preview.width, preview.height]).toEqual(['webp', 2048, 1280]);
		// The full-size level is 2400 across: four tiles of 512 and one of what is left.
		expect((await look(pieces.tile(0, 0, 0))).width).toBe(512);
		expect((await look(pieces.tile(0, 4, 2))).width).toBe(2400 - 4 * 512);
		expect(await elsewhere.has(pieces.tile(0, 5, 0))).toBe(false);
		expect((await look(thumb)).width).toBe(360);

		await dropImages(['f-far.png']);
		for (const key of [uploadKey('f-far.png'), pieces.preview, pieces.tile(0, 0, 0), thumb]) {
			expect(await elsewhere.has(key)).toBe(false);
		}
	} finally {
		setStorage(disk);
	}
});

test('a key never reaches outside the folder of a disk storage', async () => {
	expect(getStorage().get('../outside.png')).rejects.toThrow('not a key');
});

test('the database and the storage are each picked by the scheme of their address', () => {
	expect(() => openDb('libsql://example.invalid')).toThrow('No database driver answers to "libsql:"');
	expect(() => openStorage('s3://bucket')).toThrow('No storage answers to "s3:"');

	// In memory, so no file is left open for Windows to hold the folder by.
	expect(openDb('file::memory:')).toBeDefined();
	expect(openStorage(`file:${dataDir}`).pathOf?.('uploads/x.png')).toBe(join(uploads, 'x.png'));
});
