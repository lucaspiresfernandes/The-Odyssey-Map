import { json, type RequestHandler } from '@sveltejs/kit';
import { getDb } from '#lib/server/db.ts';
import { listHistory } from '#lib/server/queries.ts';
import { requireMemberApi } from '#lib/server/session.ts';

export const GET: RequestHandler = (event) => {
	const { campaign } = requireMemberApi(event, event.params.campaign!);
	const before = Number(event.url.searchParams.get('before'));
	const entries = listHistory(getDb(), campaign.id, campaign.role, {
		mapId: event.url.searchParams.get('map') || undefined,
		beforeSeq: Number.isInteger(before) && before > 0 ? before : undefined,
		limit: 60
	});
	return json({ entries }, { headers: { 'cache-control': 'no-store' } });
};
