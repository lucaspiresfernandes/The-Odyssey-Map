// The database schema. This file is the source of truth: after changing it,
// run `bun run db:generate` to write the matching migration into drizzle/.
//
// Times are milliseconds since the epoch, stored as plain integers.

import { sql } from 'drizzle-orm';
import {
	check,
	index,
	integer,
	primaryKey,
	real,
	sqliteTable,
	text,
	type AnySQLiteColumn
} from 'drizzle-orm/sqlite-core';
import {
	DEFAULT_CELL_FEET,
	DEFAULT_GRID,
	NO_FOG,
	NO_TURNS,
	type Entity,
	type EntityType,
	type EventAction,
	type Fog,
	type GalleryKind,
	type Grid,
	type MarkerType,
	type Point,
	type TokenMark,
	type Turns
} from '../shared/types';

export const users = sqliteTable('users', {
	id: text('id').primaryKey(),
	name: text('name').notNull(),
	/** Lower-cased. Null for guests, who joined by invite link. */
	username: text('username').unique(),
	passwordHash: text('password_hash'),
	createdAt: integer('created_at').notNull()
});

export const sessions = sqliteTable('sessions', {
	tokenHash: text('token_hash').primaryKey(),
	userId: text('user_id')
		.notNull()
		.references(() => users.id, { onDelete: 'cascade' }),
	expiresAt: integer('expires_at').notNull()
});

export const campaigns = sqliteTable('campaigns', {
	id: text('id').primaryKey(),
	name: text('name').notNull(),
	ownerId: text('owner_id')
		.notNull()
		.references(() => users.id),
	inviteToken: text('invite_token').notNull().unique(),
	// Not a foreign key: maps already point at their campaign, and SQLite
	// would need both rows to exist before either could be inserted.
	rootMapId: text('root_map_id').notNull(),
	/**
	 * File name of the picture the GM is holding up for the whole table, out
	 * of the gallery. Null while none is. Not a foreign key, for the same
	 * reason, and because a picture may leave the gallery while it is shown.
	 */
	shownFile: text('shown_file'),
	createdAt: integer('created_at').notNull()
});

export const members = sqliteTable(
	'members',
	{
		campaignId: text('campaign_id')
			.notNull()
			.references(() => campaigns.id, { onDelete: 'cascade' }),
		userId: text('user_id')
			.notNull()
			.references(() => users.id, { onDelete: 'cascade' }),
		role: text('role', { enum: ['gm', 'player'] }).notNull(),
		joinedAt: integer('joined_at').notNull()
	},
	(t) => [
		primaryKey({ columns: [t.campaignId, t.userId] }),
		check('members_role', sql`${t.role} IN ('gm', 'player')`)
	]
);

export const maps = sqliteTable(
	'maps',
	{
		id: text('id').primaryKey(),
		campaignId: text('campaign_id')
			.notNull()
			.references(() => campaigns.id, { onDelete: 'cascade' }),
		parentId: text('parent_id').references((): AnySQLiteColumn => maps.id),
		name: text('name').notNull(),
		/** A battle map has a grid and tokens on top of everything a world map has. */
		kind: text('kind', { enum: ['world', 'battle'] }).notNull().default('world'),
		grid: text('grid', { mode: 'json' }).$type<Grid>().notNull().default(DEFAULT_GRID),
		/** How many feet one cell of the grid stands for. */
		cellFeet: real('cell_feet').notNull().default(DEFAULT_CELL_FEET),
		/** The fog of war on a battle map: whether it is on, and where it has been cleared. */
		fog: text('fog', { mode: 'json' }).$type<Fog>().notNull().default(NO_FOG),
		/** Whose turn it is on a battle map, and who comes after. */
		turns: text('turns', { mode: 'json' }).$type<Turns>().notNull().default(NO_TURNS),
		/** How many miles a world map is across, when the GM has said so. */
		miles: real('miles'),
		imageFile: text('image_file'),
		width: integer('width').notNull(),
		height: integer('height').notNull(),
		createdAt: integer('created_at').notNull()
	},
	(t) => [index('maps_campaign').on(t.campaignId)]
);

export const regions = sqliteTable(
	'regions',
	{
		id: text('id').primaryKey(),
		mapId: text('map_id')
			.notNull()
			.references(() => maps.id, { onDelete: 'cascade' }),
		targetMapId: text('target_map_id')
			.notNull()
			.references(() => maps.id),
		// The name is not here: a region is called what the map behind it is called.
		points: text('points', { mode: 'json' }).$type<Point[]>().notNull(),
		/** A hidden region keeps players out of its map, and of every map inside that one. */
		hidden: integer('hidden', { mode: 'boolean' }).notNull().default(false),
		createdAt: integer('created_at').notNull()
	},
	(t) => [index('regions_map').on(t.mapId)]
);

// Where each campaign's party is: one row at most, on one of its world
// maps. It goes with that map when the region leading there is deleted.
export const parties = sqliteTable('parties', {
	campaignId: text('campaign_id')
		.primaryKey()
		.references(() => campaigns.id, { onDelete: 'cascade' }),
	mapId: text('map_id')
		.notNull()
		.references(() => maps.id, { onDelete: 'cascade' }),
	x: real('x').notNull(),
	y: real('y').notNull(),
	updatedAt: integer('updated_at').notNull()
});

export const markers = sqliteTable(
	'markers',
	{
		id: text('id').primaryKey(),
		mapId: text('map_id')
			.notNull()
			.references(() => maps.id, { onDelete: 'cascade' }),
		kind: text('kind', { enum: ['world', 'player'] }).notNull(),
		type: text('type').$type<MarkerType>().notNull(),
		title: text('title').notNull(),
		description: text('description').notNull().default(''),
		x: real('x').notNull(),
		y: real('y').notNull(),
		hidden: integer('hidden', { mode: 'boolean' }).notNull().default(false),
		authorId: text('author_id').notNull(),
		authorName: text('author_name').notNull(),
		createdAt: integer('created_at').notNull(),
		updatedAt: integer('updated_at').notNull(),
		deletedAt: integer('deleted_at')
	},
	(t) => [
		index('markers_map').on(t.mapId),
		check('markers_kind', sql`${t.kind} IN ('world', 'player')`)
	]
);

// The pieces on a battle map. Deleted like markers are: the row stays, so
// that undoing the delete brings the same token back.
export const tokens = sqliteTable(
	'tokens',
	{
		id: text('id').primaryKey(),
		mapId: text('map_id')
			.notNull()
			.references(() => maps.id, { onDelete: 'cascade' }),
		name: text('name').notNull(),
		/** What a plain disc is filled with. */
		color: text('color').notNull(),
		/** The colour of the ring around it. Null for none. */
		outline: text('outline'),
		/** File name of its picture, out of the gallery. Null for a plain disc. */
		image: text('image'),
		x: real('x').notNull(),
		y: real('y').notNull(),
		/**
		 * Cells across, in halves. The column was made for whole cells and SQLite
		 * can't change a column's type without rebuilding the table, so it is
		 * still declared an integer: SQLite keeps 1.5 in one as the real it is.
		 */
		size: integer('size').notNull().default(1),
		/** Degrees clockwise. */
		rotation: integer('rotation').notNull().default(0),
		locked: integer('locked', { mode: 'boolean' }).notNull().default(false),
		/** What it is marked with: pips on its rim, or crossed out. */
		marks: text('marks', { mode: 'json' }).$type<TokenMark[]>().notNull().default([]),
		// From when a token belonged to one player. Nothing reads or writes
		// these now: anyone moves any token that isn't locked.
		ownerId: text('owner_id'),
		ownerName: text('owner_name'),
		hidden: integer('hidden', { mode: 'boolean' }).notNull().default(false),
		createdAt: integer('created_at').notNull(),
		updatedAt: integer('updated_at').notNull(),
		deletedAt: integer('deleted_at')
	},
	(t) => [index('tokens_map').on(t.mapId)]
);

// What the table draws and writes on a battle map: freehand lines, lines of
// text, and the templates that mark out the area of a spell. Deleted like
// tokens are, so that undo brings the same one back.
export const drawings = sqliteTable(
	'drawings',
	{
		id: text('id').primaryKey(),
		mapId: text('map_id')
			.notNull()
			.references(() => maps.id, { onDelete: 'cascade' }),
		kind: text('kind', { enum: ['line', 'text', 'circle', 'cone', 'rect'] }).notNull(),
		/** In map space. A text has one, a template two. */
		points: text('points', { mode: 'json' }).$type<Point[]>().notNull(),
		text: text('text').notNull().default(''),
		color: text('color').notNull(),
		/** In cells: the thickness of a line, the height of a text's letters. */
		size: real('size').notNull(),
		authorId: text('author_id').notNull(),
		authorName: text('author_name').notNull(),
		createdAt: integer('created_at').notNull(),
		updatedAt: integer('updated_at').notNull(),
		deletedAt: integer('deleted_at')
	},
	(t) => [index('drawings_map').on(t.mapId)]
);

// The pictures a campaign keeps to use again: images to lay under a map, and
// pictures to put on tokens. Maps and tokens point at one by its file name.
// The file itself is in the uploads directory.
export const gallery = sqliteTable(
	'gallery',
	{
		id: text('id').primaryKey(),
		campaignId: text('campaign_id')
			.notNull()
			.references(() => campaigns.id, { onDelete: 'cascade' }),
		kind: text('kind').$type<GalleryKind>().notNull(),
		name: text('name').notNull(),
		/** Never reused, so a file name means the same bytes for good. */
		file: text('file').notNull().unique(),
		width: integer('width').notNull(),
		height: integer('height').notNull(),
		/**
		 * Players are shown only the pictures the GM has revealed. Every picture
		 * starts hidden, so nothing spoils a surprise by being added.
		 */
		hidden: integer('hidden', { mode: 'boolean' }).notNull().default(true),
		/**
		 * What a token made from this picture starts out as: how many cells
		 * across, and the colour of its ring. Null for the usual.
		 */
		tokenSize: real('token_size'),
		tokenOutline: text('token_outline'),
		createdAt: integer('created_at').notNull(),
		/**
		 * Set when the GM takes a picture out of the gallery while a map or a
		 * token still shows it. The row and the file stay until nothing does.
		 */
		deletedAt: integer('deleted_at')
	},
	(t) => [
		index('gallery_campaign').on(t.campaignId),
		check('gallery_kind', sql`${t.kind} IN ('map', 'token')`)
	]
);

// Every change to the world is one row here. Undo works from it, and the
// same events are what the table is sent live. Rows are only ever added,
// with one exception: deleting a region takes the events of the maps behind
// it along, since nothing in them can be undone any more.
export const events = sqliteTable(
	'events',
	{
		seq: integer('seq').primaryKey({ autoIncrement: true }),
		campaignId: text('campaign_id').notNull(),
		mapId: text('map_id').notNull(),
		actorId: text('actor_id').notNull(),
		actorName: text('actor_name').notNull(),
		at: integer('at').notNull(),
		entity: text('entity').$type<EntityType>().notNull(),
		entityId: text('entity_id').notNull(),
		action: text('action').$type<EventAction>().notNull(),
		/** Full snapshots of the entity, stored as JSON. */
		before: text('before', { mode: 'json' }).$type<Entity>(),
		after: text('after', { mode: 'json' }).$type<Entity>()
	},
	(t) => [index('events_campaign').on(t.campaignId, t.seq)]
);
