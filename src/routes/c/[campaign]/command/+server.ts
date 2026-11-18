// Where every command is carried out. The WebSocket server forwards the
// commands it receives to this endpoint, with the sender's cookies, and the
// browser posts here itself when its live connection is down, so the map
// stays editable.

import { json, type RequestHandler } from '@sveltejs/kit';
import { announce } from '#lib/server/bridge.ts';
import { getDb } from '#lib/server/db.ts';
import { sweepGallery } from '#lib/server/gallery.ts';
import { requireMemberApi } from '#lib/server/session.ts';
import { dropImages } from '#lib/server/tiles.ts';
import { toLiveEvent } from '#lib/server/visibility.ts';
import {
	ActionError,
	deletedMaps,
	perform,
	undoable,
	type ErrorCode
} from '#lib/server/world.ts';
import type { CommandResponse } from '#lib/shared/types.ts';

const STATUS: Record<ErrorCode, number> = {
	invalid: 400,
	forbidden: 403,
	not_found: 404,
	conflict: 409
};

export const POST: RequestHandler = async (event) => {
	const { actor } = requireMemberApi(event, event.params.campaign!);

	if (!event.request.headers.get('content-type')?.includes('application/json')) {
		return json({ ok: false, error: 'Malformed request.' } satisfies CommandResponse, { status: 415 });
	}
	let command: unknown;
	try {
		command = await event.request.json();
	} catch {
		return json({ ok: false, error: 'Malformed request.' } satisfies CommandResponse, { status: 400 });
	}

	try {
		const db = getDb();
		const events = perform(db, actor, command);
		// Deliver the change before answering, so the sender has already seen
		// its effect by the time their request resolves.
		await announce(db, events);
		// A deleted map may have been the last thing showing a picture that
		// was taken out of the gallery. Nothing holds that one any more.
		if (deletedMaps(events).length) await dropImages(sweepGallery(db, actor.campaignId));
		return json({
			ok: true,
			events: events.map((e) => toLiveEvent(db, e, actor.role)).filter((e) => e !== null),
			undo: undoable(events)
		} satisfies CommandResponse);
	} catch (err) {
		if (err instanceof ActionError) {
			return json({ ok: false, error: err.message } satisfies CommandResponse, {
				status: STATUS[err.code]
			});
		}
		throw err;
	}
};
