// The groups of tokens the GM has saved: what they are, saving the tokens
// selected as one more, and throwing one away. All of it is the GM's.
//
// Putting a group down on a map is not here: that is a batch of
// `token.create` commands, like any other change to a map.

import { type RequestHandler } from '@sveltejs/kit';
import { getDb } from '#lib/server/db.ts';
import { listGroups, removeGroup, saveGroup } from '#lib/server/groups.ts';
import { requireMemberApi } from '#lib/server/session.ts';
import { dropImages } from '#lib/server/tiles.ts';
import { ActionError, ERROR_STATUS } from '#lib/server/world.ts';
import type { GroupsResponse } from '#lib/shared/types.ts';

function refusal(err: unknown) {
	if (!(err instanceof ActionError)) throw err;
	return Response.json({ ok: false, error: err.message } satisfies GroupsResponse, {
		status: ERROR_STATUS[err.code]
	});
}

export const GET: RequestHandler = (event) => {
	const { actor } = requireMemberApi(event, event.params.campaign!);
	try {
		return Response.json({ ok: true, items: listGroups(getDb(), actor) } satisfies GroupsResponse);
	} catch (err) {
		return refusal(err);
	}
};

/** Saves the tokens named, by id, as a group. */
export const POST: RequestHandler = async (event) => {
	const { actor } = requireMemberApi(event, event.params.campaign!);
	const body = (await event.request.json().catch(() => null)) as {
		name?: unknown;
		tokens?: unknown;
	} | null;
	try {
		const db = getDb();
		saveGroup(db, actor, body?.name, body?.tokens);
		return Response.json({ ok: true, items: listGroups(db, actor) } satisfies GroupsResponse);
	} catch (err) {
		return refusal(err);
	}
};

/** Throws the group named, by id, away. */
export const DELETE: RequestHandler = async (event) => {
	const { actor } = requireMemberApi(event, event.params.campaign!);
	const body = (await event.request.json().catch(() => null)) as { id?: unknown } | null;
	try {
		const db = getDb();
		if (typeof body?.id !== 'string') throw new ActionError('invalid', 'Malformed request.');
		// A picture only the group still wore goes with it.
		await dropImages(removeGroup(db, actor, body.id));
		return Response.json({ ok: true, items: listGroups(db, actor) } satisfies GroupsResponse);
	} catch (err) {
		return refusal(err);
	}
};
