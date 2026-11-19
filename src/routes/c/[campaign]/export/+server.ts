// A whole campaign as one file to download: every map and what is on it,
// and the pictures in its gallery. The GM's, since it holds everything that
// is hidden. See src/lib/server/archive.ts for what is in it.

import { type RequestHandler } from '@sveltejs/kit';
import { exportCampaign } from '#lib/server/archive.ts';
import { getDb } from '#lib/server/db.ts';
import { requireMemberApi } from '#lib/server/session.ts';
import { canEditWorld } from '#lib/shared/rules.ts';

export const GET: RequestHandler = (event) => {
	const { actor } = requireMemberApi(event, event.params.campaign!);
	if (!canEditWorld(actor.role)) return new Response('Only the GM exports a campaign.', { status: 403 });

	const { name, stream } = exportCampaign(getDb(), actor.campaignId);
	// A file name any system will take, made from the name of the campaign.
	const plain = name.replace(/[^A-Za-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'campaign';
	const day = new Date().toISOString().slice(0, 10);
	return new Response(stream, {
		headers: {
			'content-type': 'application/x-tar',
			'content-disposition': `attachment; filename="${plain}-${day}.odyssey.tar"`,
			'cache-control': 'no-store'
		}
	});
};
