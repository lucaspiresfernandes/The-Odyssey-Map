// One picture in the gallery: renaming it, revealing it to the players or
// hiding it again, saying what a token made from it starts out as, and
// taking it out. All of it is the GM's.

import { type RequestHandler } from '@sveltejs/kit';
import { holdUp } from '#lib/server/bridge.ts';
import { getDb } from '#lib/server/db.ts';
import {
	hideInGallery,
	listGallery,
	presetInGallery,
	removeFromGallery,
	renameInGallery,
	shownTo
} from '#lib/server/gallery.ts';
import { requireMemberApi } from '#lib/server/session.ts';
import { dropImages } from '#lib/server/tiles.ts';
import { ActionError, type ErrorCode } from '#lib/server/world.ts';
import type { GalleryResponse } from '#lib/shared/types.ts';

const STATUS: Record<ErrorCode, number> = {
	invalid: 400,
	forbidden: 403,
	not_found: 404,
	conflict: 409
};

function refusal(err: unknown) {
	if (!(err instanceof ActionError)) throw err;
	return Response.json({ ok: false, error: err.message } satisfies GalleryResponse, {
		status: STATUS[err.code]
	});
}

export const PATCH: RequestHandler = async (event) => {
	const { actor } = requireMemberApi(event, event.params.campaign!);
	const body = (await event.request.json().catch(() => null)) as {
		name?: unknown;
		hidden?: unknown;
		preset?: { size?: unknown; outline?: unknown } | null;
	} | null;
	try {
		const db = getDb();
		const id = event.params.id!;
		// Whichever of the three are asked for. A request for none is a rename with no name.
		if (body?.hidden !== undefined) hideInGallery(db, actor, id, body.hidden);
		if (body?.preset !== undefined) presetInGallery(db, actor, id, body.preset ?? {});
		if (body?.name !== undefined || (body?.hidden === undefined && body?.preset === undefined)) {
			renameInGallery(db, actor, id, body?.name);
		}
		return Response.json({ ok: true, items: listGallery(db, actor) } satisfies GalleryResponse);
	} catch (err) {
		return refusal(err);
	}
};

export const DELETE: RequestHandler = async (event) => {
	const { actor } = requireMemberApi(event, event.params.campaign!);
	try {
		const db = getDb();
		const held = shownTo(db, actor.campaignId);
		// A picture that a map or a token still shows stays on disk for them.
		await dropImages(removeFromGallery(db, actor, event.params.id!));
		// The one being held up for the table comes down with it.
		if (held && !shownTo(db, actor.campaignId)) await holdUp(actor.campaignId, null);
		return Response.json({ ok: true, items: listGallery(db, actor) } satisfies GalleryResponse);
	} catch (err) {
		return refusal(err);
	}
};
