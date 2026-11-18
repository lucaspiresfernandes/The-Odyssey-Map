// The same commands the WebSocket server accepts, over plain HTTP. The
// browser falls back to this when the live connection is down, so the map
// stays editable. Both paths end in the same `perform` call.

import { json, type RequestHandler } from '@sveltejs/kit';
import { getDb } from '#lib/server/db.ts';
import { requireMemberApi } from '#lib/server/session.ts';
import { toLiveEvent } from '#lib/server/visibility.ts';
import { ActionError, perform, type ErrorCode } from '#lib/server/world.ts';
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
		const events = perform(getDb(), actor, command);
		return json({
			ok: true,
			events: events.map((e) => toLiveEvent(e, actor.role)).filter((e) => e !== null)
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
