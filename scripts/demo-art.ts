// Placeholder maps for the demo campaign, drawn from noise so the seed
// script needs no image files. Real campaigns upload their own art.

import { deflateSync } from 'node:zlib';

export interface Painting {
	png: Uint8Array;
	width: number;
	height: number;
}

type Rgb = [number, number, number];

// --------------------------------------------------------------------- png

function chunk(type: string, data: Uint8Array): Uint8Array {
	const out = new Uint8Array(12 + data.length);
	const view = new DataView(out.buffer);
	view.setUint32(0, data.length);
	out.set(new TextEncoder().encode(type), 4);
	out.set(data, 8);
	view.setUint32(8 + data.length, Bun.hash.crc32(out.subarray(4, 8 + data.length)));
	return out;
}

function encodePng(width: number, height: number, rgb: Uint8Array): Uint8Array {
	const stride = width * 3 + 1;
	const raw = new Uint8Array(stride * height); // each row starts with filter type 0
	for (let y = 0; y < height; y++) {
		raw.set(rgb.subarray(y * width * 3, (y + 1) * width * 3), y * stride + 1);
	}
	const header = new Uint8Array(13);
	const view = new DataView(header.buffer);
	view.setUint32(0, width);
	view.setUint32(4, height);
	header[8] = 8; // bits per channel
	header[9] = 2; // truecolour
	const parts = [
		new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
		chunk('IHDR', header),
		chunk('IDAT', deflateSync(raw, { level: 9 })),
		chunk('IEND', new Uint8Array(0))
	];
	const png = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
	let offset = 0;
	for (const part of parts) {
		png.set(part, offset);
		offset += part.length;
	}
	return png;
}

// ------------------------------------------------------------------- noise

function hash(x: number, y: number, seed: number): number {
	let h = Math.imul(x, 374761393) ^ Math.imul(y, 668265263) ^ Math.imul(seed, 1274126177);
	h = Math.imul(h ^ (h >>> 13), 1274126177);
	return ((h ^ (h >>> 16)) >>> 0) / 4294967295;
}

function noise(x: number, y: number, seed: number): number {
	const xi = Math.floor(x);
	const yi = Math.floor(y);
	const fx = x - xi;
	const fy = y - yi;
	const sx = fx * fx * (3 - 2 * fx);
	const sy = fy * fy * (3 - 2 * fy);
	const top = hash(xi, yi, seed) * (1 - sx) + hash(xi + 1, yi, seed) * sx;
	const bottom = hash(xi, yi + 1, seed) * (1 - sx) + hash(xi + 1, yi + 1, seed) * sx;
	return top * (1 - sy) + bottom * sy;
}

function fbm(x: number, y: number, seed: number, octaves: number): number {
	let sum = 0;
	let weight = 0;
	let amplitude = 0.5;
	for (let i = 0; i < octaves; i++) {
		sum += amplitude * noise(x, y, seed + i * 101);
		weight += amplitude;
		amplitude *= 0.5;
		x *= 2;
		y *= 2;
	}
	return sum / weight;
}

// ----------------------------------------------------------------- terrain

const WORLD_ASPECT = 1.6;

// Elevation bands, lowest first. Flat colours keep the files small and
// give the map the look of a printed chart.
const BANDS: [number, Rgb][] = [
	[0.36, [38, 70, 92]],
	[0.43, [52, 92, 112]],
	[0.48, [78, 124, 138]],
	[0.5, [124, 164, 166]],
	[0.52, [222, 205, 160]],
	[0.58, [176, 188, 128]],
	[0.64, [142, 166, 104]],
	[0.7, [104, 138, 86]],
	[0.76, [128, 126, 92]],
	[0.82, [158, 148, 122]],
	[0.88, [190, 184, 170]],
	[2, [236, 234, 228]]
];

function elevation(u: number, v: number, seed: number, octaves: number): number {
	const rough = fbm(u * WORLD_ASPECT * 3.2, v * 3.2, seed, octaves);
	// Pull the edges of the world under water so it reads as a landmass.
	const dx = (u - 0.5) * 2;
	const dy = (v - 0.5) * 2;
	const edge = Math.min(1, Math.hypot(dx * 0.95, dy * 1.05));
	return rough * 0.72 + (1 - edge * edge) * 0.36 - 0.04;
}

/**
 * Paints the window (x0, y0)-(x1, y1) of one continuous world, where 0..1
 * spans the whole world. A child map painted from the bounds of its region
 * shows the same land as its parent, closer and in more detail.
 */
export function terrain(opts: { seed: number; x0: number; y0: number; x1: number; y1: number }): Painting {
	const spanU = opts.x1 - opts.x0;
	const spanV = opts.y1 - opts.y0;
	const width = 1600;
	const height = Math.round((width * spanV) / (spanU * WORLD_ASPECT));
	const octaves = 6 + Math.ceil(Math.log2(1 / spanU));

	const band = new Uint8Array(width * height);
	for (let y = 0; y < height; y++) {
		for (let x = 0; x < width; x++) {
			const h = elevation(
				opts.x0 + (x / width) * spanU,
				opts.y0 + (y / height) * spanV,
				opts.seed,
				octaves
			);
			let i = 0;
			while (h >= BANDS[i][0]) i++;
			band[y * width + x] = i;
		}
	}

	const rgb = new Uint8Array(width * height * 3);
	for (let y = 0; y < height; y++) {
		for (let x = 0; x < width; x++) {
			const i = y * width + x;
			const here = band[i];
			let [r, g, b] = BANDS[here][1];
			// Ink the line wherever a band meets a lower one: contours, and
			// a heavier stroke along the coast.
			const lower =
				(x > 0 && band[i - 1] < here) || (y > 0 && band[i - width] < here);
			if (lower) {
				const ink = here === 4 ? 0.45 : 0.82;
				r *= ink;
				g *= ink;
				b *= ink;
			}
			rgb[i * 3] = r;
			rgb[i * 3 + 1] = g;
			rgb[i * 3 + 2] = b;
		}
	}
	return { png: encodePng(width, height, rgb), width, height };
}

// --------------------------------------------------------------- interiors

interface Rect {
	x: number;
	y: number;
	w: number;
	h: number;
}

/** A floor plan: one building split into rooms, with a doorway in every wall between them. */
export function interior(opts: { seed: number; rooms: number; dark?: boolean }): Painting {
	const width = 1400;
	const height = 1000;
	const wall = 14;
	let counter = 0;
	const random = () => hash(counter++, 17, opts.seed);

	const outside: Rgb = opts.dark ? [20, 20, 24] : [34, 30, 26];
	const walls: Rgb = opts.dark ? [52, 52, 60] : [58, 44, 30];
	const floors: Rgb[] = opts.dark
		? [
				[96, 98, 104],
				[86, 88, 96]
			]
		: [
				[168, 128, 84],
				[156, 116, 74]
			];

	const rooms: Rect[] = [{ x: 90, y: 90, w: width - 180, h: height - 180 }];
	const doors: Rect[] = [];
	while (rooms.length < opts.rooms) {
		rooms.sort((a, b) => b.w * b.h - a.w * a.h);
		const room = rooms.shift()!;
		const at = 0.38 + random() * 0.24;
		const along = 0.2 + random() * 0.6;
		if (room.w > room.h) {
			const cut = Math.round(room.w * at);
			rooms.push({ ...room, w: cut }, { ...room, x: room.x + cut, w: room.w - cut });
			doors.push({ x: room.x + cut - wall, y: room.y + room.h * along - 40, w: wall * 2, h: 80 });
		} else {
			const cut = Math.round(room.h * at);
			rooms.push({ ...room, h: cut }, { ...room, y: room.y + cut, h: room.h - cut });
			doors.push({ x: room.x + room.w * along - 40, y: room.y + cut - wall, w: 80, h: wall * 2 });
		}
	}

	const rgb = new Uint8Array(width * height * 3);
	const fill = (rect: Rect, colour: (x: number, y: number) => Rgb) => {
		const x1 = Math.min(width, Math.round(rect.x + rect.w));
		const y1 = Math.min(height, Math.round(rect.y + rect.h));
		for (let y = Math.max(0, Math.round(rect.y)); y < y1; y++) {
			for (let x = Math.max(0, Math.round(rect.x)); x < x1; x++) {
				rgb.set(colour(x, y), (y * width + x) * 3);
			}
		}
	};

	// Boards run the length of the building, with a seam every few planks.
	const floor = (x: number, y: number): Rgb => {
		const plank = Math.floor(y / 22);
		if (y % 22 === 0 || (x + plank * 137) % 260 === 0) return walls;
		return floors[plank % 2];
	};

	fill({ x: 0, y: 0, w: width, h: height }, () => outside);
	for (const room of rooms) {
		fill({ x: room.x - wall / 2, y: room.y - wall / 2, w: room.w + wall, h: room.h + wall }, () => walls);
	}
	for (const room of rooms) {
		fill({ x: room.x + wall / 2, y: room.y + wall / 2, w: room.w - wall, h: room.h - wall }, floor);
	}
	for (const door of doors) fill(door, floor);

	return { png: encodePng(width, height, rgb), width, height };
}
