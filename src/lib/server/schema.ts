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
import type {
	EntityType,
	EventAction,
	MapInfo,
	Marker,
	MarkerType,
	Point,
	Region
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
		before: text('before', { mode: 'json' }).$type<Marker | Region | MapInfo>(),
		after: text('after', { mode: 'json' }).$type<Marker | Region | MapInfo>()
	},
	(t) => [index('events_campaign').on(t.campaignId, t.seq)]
);
