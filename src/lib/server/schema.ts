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
	DIAGONALS,
	NO_FOG,
	NO_TURNS,
	UNITS,
	type EncounterToken,
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
	/** The players that picture is held up for, by user id. Empty for the whole table. */
	shownTo: text('shown_to', { mode: 'json' }).$type<string[]>().notNull().default([]),
	/**
	 * The date it is in the world, in the GM's own words: its calendar is
	 * the setting's and not ours, so nothing here reads it. Empty for none.
	 */
	date: text('date').notNull().default(''),
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
		/** The fog of war: whether it is on, and where it has been cleared. */
		fog: text('fog', { mode: 'json' }).$type<Fog>().notNull().default(NO_FOG),
		/** Whose turn it is on a battle map, and who comes after. */
		turns: text('turns', { mode: 'json' }).$type<Turns>().notNull().default(NO_TURNS),
		/** How many miles a world map is across, when the GM has said so. */
		miles: real('miles'),
		/** How many miles a day's travel covers on a world map, when the GM has said so. */
		dayMiles: real('day_miles'),
		/** What distances are told in, when the GM has said so: null goes by the maps further out. */
		units: text('units', { enum: UNITS }),
		/** How a diagonal step is counted, when the GM has said so: null goes by the maps further out. */
		diagonal: text('diagonal', { enum: DIAGONALS }),
		/** How many feet a player's token sees, on a battle map where the fog follows the tokens. */
		sight: real('sight'),
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
		/** The players a hidden region is there for all the same, by user id. */
		seenBy: text('seen_by', { mode: 'json' }).$type<string[]>().notNull().default([]),
		/** A closed region shows on the map, and players can't step into it yet. */
		closed: integer('closed', { mode: 'boolean' }).notNull().default(false),
		createdAt: integer('created_at').notNull()
	},
	(t) => [index('regions_map').on(t.mapId)]
);

// Someone asking for a seat at a campaign's table: a new one, or the one
// they sat in before, when their browser has forgotten them or they have
// come on another device. The row is there while the GM has yet to answer,
// and a little longer once they have, for the browser that asked to hear of
// it. Only a hash of what that browser holds is kept, as with a login.
export const seatClaims = sqliteTable(
	'seat_claims',
	{
		id: text('id').primaryKey(),
		campaignId: text('campaign_id')
			.notNull()
			.references(() => campaigns.id, { onDelete: 'cascade' }),
		/**
		 * The player whose seat is asked for, or whoever is logged in and asks
		 * to join. Nobody yet for someone new with only a name: see `name`.
		 */
		userId: text('user_id').references(() => users.id, { onDelete: 'cascade' }),
		/** What someone new wants to be called. They become a player on a yes. */
		name: text('name'),
		tokenHash: text('token_hash').notNull().unique(),
		status: text('status', { enum: ['waiting', 'granted', 'refused'] })
			.notNull()
			.default('waiting'),
		createdAt: integer('created_at').notNull()
	},
	(t) => [index('seat_claims_campaign').on(t.campaignId)]
);

// Encounters: tokens made ahead of time, to put down in one go on any
// battle map of the campaign. Each token is kept as what it starts out as
// and where it stands from the middle of the encounter, in cells. Like the
// gallery, where they are put together, it is no part of the world's history.
//
// The table is still called `token_groups`, from when these were groups
// saved off a map: the rows are the same, so there was nothing to migrate.
export const encounters = sqliteTable(
	'token_groups',
	{
		id: text('id').primaryKey(),
		campaignId: text('campaign_id')
			.notNull()
			.references(() => campaigns.id, { onDelete: 'cascade' }),
		name: text('name').notNull(),
		tokens: text('tokens', { mode: 'json' }).$type<EncounterToken[]>().notNull(),
		createdAt: integer('created_at').notNull()
	},
	(t) => [index('token_groups_campaign').on(t.campaignId)]
);

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
		/** The players a hidden marker is shown to all the same, by user id. */
		seenBy: text('seen_by', { mode: 'json' }).$type<string[]>().notNull().default([]),
		/** File name of the picture its card shows, out of the gallery. Null for none. */
		image: text('image'),
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
		// The player whose token it is, and what they are called. Anyone still
		// moves any token that isn't locked: this says whose turn it is when
		// the token's turn comes. Not a foreign key, so that a campaign's
		// tokens never hang on who is still a member.
		ownerId: text('owner_id'),
		ownerName: text('owner_name'),
		/** A number the table counts on it: hit points, charges, rounds left. Null for none. */
		count: integer('count'),
		/** The GM keeps the number to themself: players are sent the token without it. */
		countHidden: integer('count_hidden', { mode: 'boolean' }).notNull().default(false),
		hidden: integer('hidden', { mode: 'boolean' }).notNull().default(false),
		/** The players a hidden token is shown to all the same, by user id. */
		seenBy: text('seen_by', { mode: 'json' }).$type<string[]>().notNull().default([]),
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
		hidden: integer('hidden', { mode: 'boolean' }).notNull().default(false),
		/** The players a hidden drawing is shown to all the same, by user id. */
		seenBy: text('seen_by', { mode: 'json' }).$type<string[]>().notNull().default([]),
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
