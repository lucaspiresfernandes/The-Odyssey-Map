// What the finder searches: every map of the campaign, and every marker and
// note, that this person may be taken to. The browser asks for the lot when
// the finder opens, and narrows it down as they type.

import { type RequestHandler } from '@sveltejs/kit';
import { getDb } from '#lib/server/db.ts';
import { findable } from '#lib/server/queries.ts';
import { requireMemberApi } from '#lib/server/session.ts';
import type { FindResponse } from '#lib/shared/types.ts';

export const GET: RequestHandler = (event) => {
	const { campaign } = requireMemberApi(event, event.params.campaign!);
	const entries = findable(getDb(), campaign.id, campaign.role);
	return Response.json({ ok: true, entries } satisfies FindResponse, {
		headers: { 'cache-control': 'no-store' }
	});
};
