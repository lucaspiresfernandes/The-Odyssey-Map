// Asked by the WebSocket server when a browser connects: it passes along the
// browser's cookies, and the answer tells it who that is in this campaign.

import { json, type RequestHandler } from '@sveltejs/kit';
import { getDb } from '#lib/server/db.ts';
import { requireMemberApi } from '#lib/server/session.ts';
import { latestSeq } from '#lib/server/world.ts';
import type { LiveIdentity } from '#lib/shared/types.ts';

export const GET: RequestHandler = (event) => {
	const { user, campaign } = requireMemberApi(event, event.params.campaign!);
	const identity: LiveIdentity = {
		user: { id: user.id, name: user.name },
		role: campaign.role,
		seq: latestSeq(getDb(), campaign.id)
	};
	return json(identity, { headers: { 'cache-control': 'no-store' } });
};
