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
	DEFAULT_GRID,
	type Entity,
	type EntityType,
	type EventAction,
	type GalleryKind,
	type Grid,
	type MarkerType,
	type Point
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
		color: text('color').notNull(),
		/** File name of its picture, out of the gallery. Null for a plain disc. */
		image: text('image'),
		x: real('x').notNull(),
		y: real('y').notNull(),
		/** Cells across. */
		size: integer('size').notNull().default(1),
		/** The player who moves it, besides the GM. Null for the GM's own. */
		ownerId: text('owner_id'),
		ownerName: text('owner_name'),
		hidden: integer('hidden', { mode: 'boolean' }).notNull().default(false),
		createdAt: integer('created_at').notNull(),
		updatedAt: integer('updated_at').notNull(),
		deletedAt: integer('deleted_at')
	},
	(t) => [index('tokens_map').on(t.mapId)]
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
