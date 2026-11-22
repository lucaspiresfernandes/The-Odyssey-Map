// The encounters the GM keeps: what they are, and making one more. All of
// it is the GM's. One encounter is changed and thrown away at ./[id].
//
// Putting an encounter down on a map is not here: that is a batch of
// `token.create` commands, like any other change to a map.

import { type RequestHandler } from '@sveltejs/kit';
import { getDb } from '#lib/server/db.ts';
import { createEncounter, encounterFromMap, listEncounters } from '#lib/server/encounters.ts';
import { requireMemberApi } from '#lib/server/session.ts';
import { ActionError, ERROR_STATUS } from '#lib/server/world.ts';
import type { EncountersResponse } from '#lib/shared/types.ts';

function refusal(err: unknown) {
	if (!(err instanceof ActionError)) throw err;
	return Response.json({ ok: false, error: err.message } satisfies EncountersResponse, {
		status: ERROR_STATUS[err.code]
	});
}

export const GET: RequestHandler = (event) => {
	const { actor } = requireMemberApi(event, event.params.campaign!);
	try {
		return Response.json({
			ok: true,
			items: listEncounters(getDb(), actor)
		} satisfies EncountersResponse);
	} catch (err) {
		return refusal(err);
	}
};

/**
 * Makes an encounter: of the `tokens` given, which may be none yet, or with
 * `from`, of the tokens that stand on a battle map, by their ids.
 */
export const POST: RequestHandler = async (event) => {
	const { actor } = requireMemberApi(event, event.params.campaign!);
	const body = (await event.request.json().catch(() => null)) as {
		name?: unknown;
		tokens?: unknown;
		from?: unknown;
	} | null;
	try {
		const db = getDb();
		const made =
			body?.from !== undefined
				? encounterFromMap(db, actor, body.name, body.from)
				: createEncounter(db, actor, body?.name, body?.tokens ?? []);
		return Response.json({
			ok: true,
			items: listEncounters(db, actor),
			made: made.id
		} satisfies EncountersResponse);
	} catch (err) {
		return refusal(err);
	}
};
