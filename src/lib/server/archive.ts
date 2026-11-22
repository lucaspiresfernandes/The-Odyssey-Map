// A whole campaign in one file, and back out of one.
//
// The file is a tar archive: `campaign.json`, which lists every map, region,
// marker, note, token, drawing and encounter and says what is in the gallery, followed
// by the gallery's pictures as they were uploaded. It is a backup that the
// app itself can restore, and a way to hand a prepared world to another GM.
//
// What is left out is what belongs to one table and not to the world: who
// plays in it, which of them is let in on which secret, and the history
// that undo works from. Tiles and thumbnails are made again when they are
// next asked for.
//
// Importing never changes a campaign that is there. It makes a new one,
// owned by whoever imports it, with ids and file names of its own, so the
// same file can be imported twice, or into the app it came from. The file
// may come from anyone, so nothing in it is taken on trust: every value is
// checked the way a command's would be, and every picture is read as one.

import { eq, inArray, isNull, and, sql } from 'drizzle-orm';
import type { User } from './auth';
import type { Campaign } from './campaigns';
import type { Db } from './db';
import { newImageFile } from './gallery';
import { newId, newToken } from './ids';
import { fogOf } from '../shared/fog';
import {
	campaigns,
	drawings,
	encounters,
	gallery,
	maps,
	markers,
	members,
	regions,
	tokens
} from './schema';
import { getStorage } from './storage';
import { tarEntries, tarStream, TarError, type TarFile } from './tar';
import { imageSize, sniffImage, uploadKey } from './tiles';
import { IMAGE_FILE_PATTERN } from './world';
import {
	DEFAULT_CELL_FEET,
	DEFAULT_GRID,
	DIAGONALS,
	INK_COLORS,
	LIMITS,
	MARKER_TYPE_IDS,
	ROTATION_STEP,
	TOKEN_COLORS,
	TOKEN_MARK_IDS,
	TOKEN_SIZE_STEP,
	UNITS,
	isTemplate,
	type DrawingKind,
	type EncounterToken,
	type Fog,
	type FogMark,
	type GalleryKind,
	type Grid,
	type MapKind,
	type MarkerKind,
	type MarkerType,
	type Point,
	type Rect,
	type TokenMark,
	type Turns
} from '../shared/types';

/** Goes up when the file changes in a way an older app could not read. */
const VERSION = 1;
const MANIFEST = 'campaign.json';
/** The most a campaign's list of everything may weigh. */
const MANIFEST_BYTES = 64 * 1024 * 1024;

/** A refusal that is safe to show to whoever is importing. */
export class ImportError extends Error {}

function refuse(reason = 'This file is not a campaign exported from The Odyssey Map.'): never {
	throw new ImportError(reason);
}

// ------------------------------------------------------------------ export

/** Everything about a campaign that goes in the file, but for its pictures. */
function manifestOf(db: Db, campaignId: string) {
	return db.transaction((tx) => {
		const campaign = tx.select().from(campaigns).where(eq(campaigns.id, campaignId)).get();
		if (!campaign) throw new Error('No such campaign.');
		const mapRows = tx
			.select()
			.from(maps)
			.where(eq(maps.campaignId, campaignId))
			.orderBy(maps.createdAt)
			.all();
		const ids = mapRows.map((map) => map.id);
		const on = <T>(rows: (list: string[]) => T[]): T[] => {
			// A few hundred at a time: SQLite takes only so many values in one question.
			const all: T[] = [];
			for (let i = 0; i < ids.length; i += 400) all.push(...rows(ids.slice(i, i + 400)));
			return all;
		};
		return {
			odyssey: VERSION,
			exportedAt: Date.now(),
			name: campaign.name,
			// The date it is in the world: where the story has got to.
			date: campaign.date,
			rootMapId: campaign.rootMapId,
			maps: mapRows.map(({ campaignId: _, ...map }) => map),
			regions: on((list) =>
				tx.select().from(regions).where(inArray(regions.mapId, list)).orderBy(regions.createdAt).all()
			).map(({ seenBy: _, ...region }) => region),
			markers: on((list) =>
				tx
					.select()
					.from(markers)
					.where(and(inArray(markers.mapId, list), isNull(markers.deletedAt)))
					.orderBy(markers.createdAt)
					.all()
			).map(({ seenBy: _, authorId: __, deletedAt: ___, ...marker }) => marker),
			tokens: on((list) =>
				tx
					.select()
					.from(tokens)
					.where(and(inArray(tokens.mapId, list), isNull(tokens.deletedAt)))
					.orderBy(tokens.createdAt)
					.all()
			).map(
				// Whose a token is, and whose character, stays behind with who plays.
				({ seenBy: _, ownerId: __, ownerName: ___, characterAt: ____, deletedAt: _____, ...token }) =>
					token
			),
			drawings: on((list) =>
				tx
					.select()
					.from(drawings)
					.where(and(inArray(drawings.mapId, list), isNull(drawings.deletedAt)))
					.orderBy(drawings.createdAt)
					.all()
			).map(({ seenBy: _, authorId: __, deletedAt: ___, ...drawing }) => drawing),
			gallery: tx
				.select()
				.from(gallery)
				.where(eq(gallery.campaignId, campaignId))
				.orderBy(gallery.createdAt)
				.all()
				// Which player added a picture stays behind as well.
				.map(({ campaignId: _, ownerId: __, deletedAt, ...picture }) => ({
					...picture,
					// One taken out of the gallery, and kept for the maps and tokens that still show it.
					removed: deletedAt !== null
				})),
			// The encounters the GM made ahead of time, to put down in one go.
			encounters: tx
				.select()
				.from(encounters)
				.where(eq(encounters.campaignId, campaignId))
				.orderBy(encounters.createdAt)
				.all()
				.map(({ campaignId: _, ...encounter }) => encounter)
		};
	});
}

/** A campaign as one file: its name, and the bytes of the archive as a stream. */
export function exportCampaign(
	db: Db,
	campaignId: string
): { name: string; stream: ReadableStream<Uint8Array> } {
	const manifest = manifestOf(db, campaignId);
	const storage = getStorage();
	async function* files(): AsyncGenerator<TarFile> {
		const listed = new TextEncoder().encode(JSON.stringify(manifest));
		yield { name: MANIFEST, size: listed.length, bytes: [listed] };
		for (const picture of manifest.gallery) {
			const blob = await storage.get(uploadKey(picture.file));
			// A picture that has gone missing leaves a gap, not a broken file.
			if (!blob) continue;
			yield {
				name: uploadKey(picture.file),
				size: blob.size,
				bytes: blob.stream() as unknown as AsyncIterable<Uint8Array>
			};
		}
	}
	return { name: manifest.name, stream: tarStream(files()) };
}

// ------------------------------------------------------------------ import

// Each of these reads one value out of the file, and refuses the file if
// the value is not what it should be.

type Raw = Record<string, unknown>;

function record(value: unknown): Raw {
	if (typeof value !== 'object' || value === null || Array.isArray(value)) refuse();
	return value as Raw;
}

function list(value: unknown, most: number): unknown[] {
	if (!Array.isArray(value) || value.length > most) refuse();
	return value;
}

function text(value: unknown, most: number, required = true): string {
	if (typeof value !== 'string') refuse();
	const trimmed = value.trim().slice(0, most);
	if (required && !trimmed) refuse();
	return trimmed;
}

function number(value: unknown, low: number, high: number): number {
	if (typeof value !== 'number' || !Number.isFinite(value) || value < low || value > high) refuse();
	return value;
}

const whole = (value: unknown, low: number, high: number) => Math.round(number(value, low, high));
const coord = (value: unknown) => number(value, 0, 1);
const flag = (value: unknown) => value === true;
const time = (value: unknown) => (typeof value === 'number' && value > 0 ? Math.floor(value) : Date.now());

function oneOf<T extends string>(value: unknown, among: readonly T[], fallback?: T): T {
	if (typeof value === 'string' && (among as readonly string[]).includes(value)) return value as T;
	return fallback ?? refuse();
}

function points(value: unknown, least: number, most: number): Point[] {
	const all = list(value, most);
	if (all.length < least) refuse();
	return all.map((each) => {
		const [x, y] = list(each, 2);
		return [coord(x), coord(y)];
	});
}

function fog(value: unknown): Fog {
	const raw = record(value ?? { on: false, clear: [] });
	const clear = list(raw.clear ?? [], LIMITS.fogRects).map((each): Rect => {
		const [x0, y0, x1, y1] = list(each, 4).map(coord);
		if (!(x0 < x1 && y0 < y1)) refuse();
		return [x0, y0, x1, y1];
	});
	// What was done to it by hand since: a box, or where a brush swept, round or square.
	const marks = list(raw.marks ?? [], LIMITS.fogMarks).map((each): FogMark => {
		const mark = record(each);
		if (mark.box !== undefined) {
			const [x0, y0, x1, y1] = list(mark.box, 4).map(coord);
			if (!(x0 < x1 && y0 < y1)) refuse();
			return { cover: flag(mark.cover), box: [x0, y0, x1, y1] };
		}
		const [rx, ry] = list(mark.r, 2);
		const swept = {
			cover: flag(mark.cover),
			path: points(mark.path, 1, LIMITS.fogPath),
			r: [number(rx, 1e-6, 4), number(ry, 1e-6, 4)] as [number, number]
		};
		return mark.square === true ? { ...swept, square: true } : swept;
	});
	// A file from when a world map's fog lifted around the party has round
	// patches of another kind. Those are left behind.
	return fogOf({ on: flag(raw.on), clear, marks });
}

function grid(value: unknown): Grid {
	const raw = record(value ?? DEFAULT_GRID);
	const size = number(raw.size, LIMITS.gridMin, LIMITS.gridMax);
	return {
		size,
		x: number(raw.x ?? 0, 0, size),
		y: number(raw.y ?? 0, 0, size),
		shown: raw.shown !== false
	};
}

/**
 * Reads the campaign out of an archive and makes a new campaign of it, owned
 * by `owner`. Resolves to that campaign. Rejects with an `ImportError` when
 * the file is not one this can read, and leaves nothing behind then.
 */
export async function importCampaign(
	db: Db,
	owner: User,
	body: ReadableStream<Uint8Array>
): Promise<Campaign> {
	if (owner.isGuest) refuse('Create an account to run your own campaign.');
	const storage = getStorage();
	/** What each picture in the file is called here, and how big it really is. */
	const pictures = new Map<string, { file: string; width: number; height: number }>();
	let manifest: Raw | null = null;

	try {
		const sizes = (name: string) => (name === MANIFEST ? MANIFEST_BYTES : LIMITS.imageBytes);
		for await (const entry of tarEntries(body, sizes)) {
			if (!manifest) {
				// The list of everything comes first, and says which pictures to expect.
				if (entry.name !== MANIFEST) refuse();
				try {
					manifest = record(JSON.parse(new TextDecoder().decode(entry.bytes)));
				} catch {
					refuse();
				}
				if (manifest.odyssey !== VERSION) {
					refuse(
						typeof manifest.odyssey === 'number' && manifest.odyssey > VERSION
							? 'This campaign was exported from a newer version of The Odyssey Map.'
							: undefined
					);
				}
				continue;
			}
			const old = entry.name.startsWith('uploads/') ? entry.name.slice('uploads/'.length) : '';
			const listed = list(manifest.gallery, 20000).some((each) => record(each).file === old);
			if (!IMAGE_FILE_PATTERN.test(old) || !listed || pictures.has(old)) continue;
			// A picture is what its bytes say it is, whatever it is called.
			const format = sniffImage(entry.bytes);
			const size = format && (await imageSize(entry.bytes));
			if (!format || !size) refuse(`A picture in this file can't be read: ${old}`);
			if (Math.max(size.width, size.height) > LIMITS.imageSide) {
				refuse(`A picture in this file is too big: ${old}`);
			}
			const file = newImageFile(format);
			await storage.put(uploadKey(file), entry.bytes);
			pictures.set(old, { file, ...size });
		}
		if (!manifest) refuse();
		return build(db, owner, manifest, pictures);
	} catch (err) {
		// Whatever was kept of a file that turned out not to be one is let go of.
		for (const { file } of pictures.values()) await storage.remove(uploadKey(file)).catch(() => {});
		if (err instanceof TarError) refuse();
		throw err;
	}
}

/** Writes the campaign a file describes, with ids of its own throughout. */
function build(
	db: Db,
	owner: User,
	manifest: Raw,
	pictures: Map<string, { file: string; width: number; height: number }>
): Campaign {
	const name = text(manifest.name, LIMITS.name);
	// From files that have one: on one line, as the GM's own would be kept.
	const date = text(manifest.date ?? '', 4000, false).replace(/\s+/g, ' ').slice(0, LIMITS.date);
	const now = Date.now();
	const campaignId = newId();

	// The maps, and the tree they make: one first map, and every other inside
	// a map that is there.
	const mapRows = list(manifest.maps, 5000).map(record);
	const mapIds = new Map<string, string>();
	for (const map of mapRows) mapIds.set(text(map.id, 64), newId());
	if (mapIds.size !== mapRows.length) refuse();
	const kinds = new Map<string, MapKind>();
	const parents = new Map<string, string | null>();
	for (const map of mapRows) {
		const id = map.id as string;
		const parent = map.parentId === null || map.parentId === undefined ? null : text(map.parentId, 64);
		if (parent !== null && !mapIds.has(parent)) refuse();
		parents.set(id, parent);
		kinds.set(id, oneOf(map.kind, ['world', 'battle'] as const));
	}
	const root = text(manifest.rootMapId, 64);
	if (parents.get(root) !== null) refuse();
	for (const id of mapIds.keys()) {
		// Every map leads back to the first one, and no way round in a circle.
		let at: string | null = id;
		for (let depth = 0; at !== null && at !== root; depth++) {
			if (depth > 64) refuse();
			at = parents.get(at) ?? null;
		}
		if (at !== root) refuse();
	}

	// The regions: each on the map its own map is inside of, one to a map.
	const regionRows = list(manifest.regions, 5000).map(record);
	const doors = new Set<string>();
	for (const region of regionRows) {
		const target = text(region.targetMapId, 64);
		const from = text(region.mapId, 64);
		if (parents.get(target) !== from || doors.has(target)) refuse();
		// A battle map is where the way down ends.
		if (kinds.get(from) !== 'world') refuse();
		doors.add(target);
	}
	if (doors.size !== mapIds.size - 1) refuse();

	const tokenRows = list(manifest.tokens, 50000).map(record);
	const tokenIds = new Map<string, string>();
	for (const token of tokenRows) tokenIds.set(text(token.id, 64), newId());

	const galleryRows = list(manifest.gallery, 20000).map(record);
	const kindOf = new Map<string, GalleryKind>();
	for (const picture of galleryRows) {
		if (typeof picture.file === 'string') {
			kindOf.set(picture.file, oneOf(picture.kind, ['map', 'token'] as const));
		}
	}
	/** The picture a map or a token shows, as it is called here: null when the file didn't bring it. */
	const pictureOf = (value: unknown, kind: GalleryKind) =>
		typeof value === 'string' && kindOf.get(value) === kind ? (pictures.get(value) ?? null) : null;

	const turns = (value: unknown): Turns => {
		const raw = record(value ?? { order: [], current: null, round: 1 });
		const order = [
			...new Set(
				list(raw.order ?? [], LIMITS.turns).flatMap((id) => tokenIds.get(id as string) ?? [])
			)
		];
		const current = tokenIds.get(raw.current as string) ?? null;
		const rolls: Record<string, number> = {};
		for (const [id, roll] of Object.entries(record(raw.rolls ?? {}))) {
			const token = tokenIds.get(id);
			if (token && order.includes(token)) rolls[token] = whole(roll, LIMITS.rollMin, LIMITS.rollMax);
		}
		const out: Turns = {
			order,
			current: current && order.includes(current) ? current : null,
			round: whole(raw.round ?? 1, 1, 9999)
		};
		if (Object.keys(rolls).length) out.rolls = rolls;
		return out;
	};

	const side = (value: unknown) => whole(value, 1, LIMITS.imageSide);

	return db.transaction(
		(tx) => {
			// The first map is inserted before the campaign it points at, so the
			// foreign key check is left for the end of the transaction.
			tx.run(sql`PRAGMA defer_foreign_keys = ON`);
			for (const map of mapRows) {
				const id = map.id as string;
				const image = pictureOf(map.imageFile, 'map');
				const kind = kinds.get(id)!;
				tx.insert(maps)
					.values({
						id: mapIds.get(id)!,
						campaignId,
						parentId: parents.get(id) ? mapIds.get(parents.get(id)!)! : null,
						name: text(map.name, LIMITS.name),
						kind,
						grid: grid(map.grid),
						cellFeet: number(map.cellFeet ?? DEFAULT_CELL_FEET, LIMITS.cellFeetMin, LIMITS.cellFeetMax),
						fog: fog(map.fog),
						turns: kind === 'battle' ? turns(map.turns) : { order: [], current: null, round: 1 },
						miles:
							kind === 'world' && map.miles != null
								? number(map.miles, LIMITS.milesMin, LIMITS.milesMax)
								: null,
						dayMiles:
							kind === 'world' && map.dayMiles != null
								? number(map.dayMiles, LIMITS.dayMilesMin, LIMITS.dayMilesMax)
								: null,
						// A file from before maps said any of these says none of them.
						units: map.units == null ? null : oneOf(map.units, UNITS),
						diagonal: map.diagonal == null ? null : oneOf(map.diagonal, DIAGONALS),
						sight:
							kind === 'battle' && map.sight != null
								? number(map.sight, LIMITS.sightMin, LIMITS.sightMax)
								: null,
						imageFile: image?.file ?? null,
						// A map with an image is the size of it.
						width: image?.width ?? side(map.width),
						height: image?.height ?? side(map.height),
						createdAt: time(map.createdAt)
					})
					.run();
			}
			tx.insert(campaigns)
				.values({
					id: campaignId,
					name,
					ownerId: owner.id,
					inviteToken: newToken(),
					rootMapId: mapIds.get(text(manifest.rootMapId, 64))!,
					date,
					createdAt: now
				})
				.run();
			tx.insert(members).values({ campaignId, userId: owner.id, role: 'gm', joinedAt: now }).run();

			for (const region of regionRows) {
				tx.insert(regions)
					.values({
						id: newId(),
						mapId: mapIds.get(region.mapId as string)!,
						targetMapId: mapIds.get(region.targetMapId as string)!,
						points: points(region.points, 3, LIMITS.regionPoints),
						hidden: flag(region.hidden),
						closed: flag(region.closed),
						createdAt: time(region.createdAt)
					})
					.run();
			}

			for (const marker of list(manifest.markers, 100000).map(record)) {
				const on = text(marker.mapId, 64);
				// Markers and notes go on world maps.
				if (kinds.get(on) !== 'world') refuse();
				const kind = oneOf<MarkerKind>(marker.kind, ['world', 'player']);
				tx.insert(markers)
					.values({
						id: newId(),
						mapId: mapIds.get(on)!,
						kind,
						type: oneOf(marker.type, MARKER_TYPE_IDS as readonly MarkerType[], 'note'),
						title: text(marker.title, LIMITS.title),
						description: text(marker.description ?? '', LIMITS.description, false),
						x: coord(marker.x),
						y: coord(marker.y),
						hidden: kind === 'world' && flag(marker.hidden),
						// The picture on its card, off either shelf of the gallery.
						image:
							kind === 'world' && typeof marker.image === 'string'
								? (pictures.get(marker.image)?.file ?? null)
								: null,
						// Whoever imports the world is the one its notes answer to now.
						authorId: owner.id,
						authorName: text(marker.authorName ?? owner.name, 40, false) || owner.name,
						createdAt: time(marker.createdAt),
						updatedAt: time(marker.updatedAt)
					})
					.run();
			}

			for (const token of tokenRows) {
				const on = text(token.mapId, 64);
				if (kinds.get(on) !== 'battle') refuse();
				const size = number(token.size ?? 1, TOKEN_SIZE_STEP, LIMITS.tokenSize);
				tx.insert(tokens)
					.values({
						id: tokenIds.get(token.id as string)!,
						mapId: mapIds.get(on)!,
						name: text(token.name, LIMITS.tokenName),
						color: oneOf(token.color, TOKEN_COLORS, TOKEN_COLORS[0]),
						outline: token.outline == null ? null : oneOf(token.outline, TOKEN_COLORS, TOKEN_COLORS[0]),
						image: pictureOf(token.image, 'token')?.file ?? null,
						x: coord(token.x),
						y: coord(token.y),
						size: Math.round(size / TOKEN_SIZE_STEP) * TOKEN_SIZE_STEP,
						rotation:
							(Math.round(number(token.rotation ?? 0, -3600, 3600) / ROTATION_STEP) * ROTATION_STEP +
								3600) %
							360,
						locked: flag(token.locked),
						marks: (TOKEN_MARK_IDS as TokenMark[]).filter((mark) =>
							list(token.marks ?? [], 64).includes(mark)
						),
						count: token.count == null ? null : whole(token.count, LIMITS.countMin, LIMITS.countMax),
						countHidden: flag(token.countHidden),
						hidden: flag(token.hidden),
						createdAt: time(token.createdAt),
						updatedAt: time(token.updatedAt)
					})
					.run();
			}

			for (const drawing of list(manifest.drawings, 100000).map(record)) {
				const on = text(drawing.mapId, 64);
				if (kinds.get(on) !== 'battle') refuse();
				const kind = oneOf<DrawingKind>(drawing.kind, ['line', 'text', 'circle', 'cone', 'rect', 'ray']);
				const exact = kind === 'text' ? 1 : isTemplate(kind) ? 2 : 0;
				tx.insert(drawings)
					.values({
						id: newId(),
						mapId: mapIds.get(on)!,
						kind,
						points: points(drawing.points, exact || 2, exact || LIMITS.drawingPoints),
						text: kind === 'text' ? text(drawing.text, LIMITS.drawingText) : '',
						color: oneOf(drawing.color, INK_COLORS, INK_COLORS[0]),
						size: number(drawing.size, LIMITS.drawingSizeMin, LIMITS.drawingSizeMax),
						hidden: flag(drawing.hidden),
						authorId: owner.id,
						authorName: text(drawing.authorName ?? owner.name, 40, false) || owner.name,
						createdAt: time(drawing.createdAt),
						updatedAt: time(drawing.updatedAt)
					})
					.run();
			}

			for (const picture of galleryRows) {
				const kept = typeof picture.file === 'string' ? pictures.get(picture.file) : undefined;
				// A picture the file lists and didn't bring is not in the gallery.
				if (!kept) continue;
				const kind = oneOf<GalleryKind>(picture.kind, ['map', 'token']);
				const tokenSize =
					kind === 'token' && picture.tokenSize != null
						? number(picture.tokenSize, TOKEN_SIZE_STEP, LIMITS.tokenSize)
						: null;
				tx.insert(gallery)
					.values({
						id: newId(),
						campaignId,
						kind,
						name: text(picture.name, LIMITS.name),
						file: kept.file,
						width: kept.width,
						height: kept.height,
						hidden: picture.hidden !== false,
						tokenSize: tokenSize && Math.round(tokenSize / TOKEN_SIZE_STEP) * TOKEN_SIZE_STEP,
						tokenOutline:
							kind === 'token' && picture.tokenOutline != null
								? oneOf(picture.tokenOutline, TOKEN_COLORS, TOKEN_COLORS[0])
								: null,
						createdAt: time(picture.createdAt),
						deletedAt: flag(picture.removed) ? now : null
					})
					.run();
			}

			// The encounters, from files that have them: an older file calls them
			// `groups`. A token of one whose picture the file didn't bring is a
			// plain disc, as on a map.
			const kept = manifest.encounters ?? manifest.groups ?? [];
			for (const encounter of list(kept, LIMITS.encounters).map(record)) {
				const saved = list(encounter.tokens, LIMITS.encounterTokens)
					.map(record)
					.map((token): EncounterToken => {
						const size = number(token.size ?? 1, TOKEN_SIZE_STEP, LIMITS.tokenSize);
						return {
							name: text(token.name, LIMITS.tokenName),
							color: oneOf(token.color, TOKEN_COLORS, TOKEN_COLORS[0]),
							outline:
								token.outline == null ? null : oneOf(token.outline, TOKEN_COLORS, TOKEN_COLORS[0]),
							image: pictureOf(token.image, 'token')?.file ?? null,
							size: Math.round(size / TOKEN_SIZE_STEP) * TOKEN_SIZE_STEP,
							rotation:
								(Math.round(number(token.rotation ?? 0, -3600, 3600) / ROTATION_STEP) * ROTATION_STEP +
									3600) %
								360,
							marks: (TOKEN_MARK_IDS as TokenMark[]).filter((mark) =>
								list(token.marks ?? [], 64).includes(mark)
							),
							count:
								token.count == null ? null : whole(token.count, LIMITS.countMin, LIMITS.countMax),
							countHidden: flag(token.countHidden),
							dx: number(token.dx ?? 0, -LIMITS.encounterReach, LIMITS.encounterReach),
							dy: number(token.dy ?? 0, -LIMITS.encounterReach, LIMITS.encounterReach)
						};
					});
				tx.insert(encounters)
					.values({
						id: newId(),
						campaignId,
						name: text(encounter.name, LIMITS.name),
						tokens: saved,
						createdAt: time(encounter.createdAt)
					})
					.run();
			}

			return { id: campaignId, name, rootMapId: mapIds.get(text(manifest.rootMapId, 64))!, date };
		},
		{ behavior: 'immediate' }
	);
}
