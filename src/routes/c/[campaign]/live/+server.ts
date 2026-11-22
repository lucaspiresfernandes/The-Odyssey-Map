// Asked by the WebSocket server when a browser connects: it passes along the
// browser's cookies, and the answer tells it who that is in this campaign.

import { type RequestHandler } from '@sveltejs/kit';
import { getDb } from '#lib/server/db.ts';
import { knocksOf } from '#lib/server/seats.ts';
import { requireMemberApi } from '#lib/server/session.ts';
import { latestSeq } from '#lib/server/world.ts';
import type { LiveIdentity } from '#lib/shared/types.ts';

export const GET: RequestHandler = (event) => {
	const { user, campaign } = requireMemberApi(event, event.params.campaign!);
	// A table display is shown what a player is, whoever opened it: one who
	// is let in on nobody's secret.
	const display = event.url.searchParams.has('display');
	const identity: LiveIdentity = {
		user: { id: user.id, name: user.name },
		role: display ? 'player' : campaign.role,
		seq: latestSeq(getDb(), campaign.id),
		// Who is asking for a seat is the GM's to know, and to answer.
		knocks: !display && campaign.role === 'gm' ? knocksOf(getDb(), campaign.id) : [],
		date: campaign.date
	};
	return Response.json(identity, { headers: { 'cache-control': 'no-store' } });
};
