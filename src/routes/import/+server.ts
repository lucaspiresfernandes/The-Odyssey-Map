// Makes a new campaign out of a file that was exported from one. The file
// is the body of the request, read as it arrives: a campaign with big map
// images never has to fit in memory whole. See src/lib/server/archive.ts.

import { type RequestHandler } from '@sveltejs/kit';
import { ImportError, importCampaign } from '#lib/server/archive.ts';
import { getDb } from '#lib/server/db.ts';

function refuse(status: number, error: string) {
	return Response.json({ ok: false, error }, { status });
}

export const POST: RequestHandler = async (event) => {
	const user = event.locals.user;
	if (!user) return refuse(401, 'Log in first.');
	if (user.isGuest) return refuse(403, 'Create an account to run your own campaign.');
	if (!event.request.body) return refuse(400, 'No file was sent.');

	try {
		const campaign = await importCampaign(getDb(), user, event.request.body);
		return Response.json({ ok: true, id: campaign.id });
	} catch (err) {
		if (err instanceof ImportError) return refuse(400, err.message);
		console.error('Could not import a campaign:', err);
		return refuse(500, "The campaign couldn't be imported. The server's output says why.");
	}
};
