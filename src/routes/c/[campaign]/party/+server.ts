// The party: the character of each player, for the dock of a battle map to
// put down. The GM is sent all of them, a player their own.

import { type RequestHandler } from '@sveltejs/kit';
import { getDb } from '#lib/server/db.ts';
import { partyOf } from '#lib/server/party.ts';
import { requireMemberApi } from '#lib/server/session.ts';
import type { PartyResponse } from '#lib/shared/types.ts';

export const GET: RequestHandler = (event) => {
	const { actor } = requireMemberApi(event, event.params.campaign!);
	return Response.json({ ok: true, party: partyOf(getDb(), actor) } satisfies PartyResponse, {
		headers: { 'cache-control': 'no-store' }
	});
};
