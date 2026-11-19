// The GM bringing everyone to the part of a map they are looking at.
//
// Nothing about the world changes, so nothing is stored. The app's part is
// to say who may follow: players are never sent to a map behind a hidden
// region. The WebSocket server passes the call on to the rest.

import { json, type RequestHandler } from '@sveltejs/kit';
import { summon } from '#lib/server/bridge.ts';
import { getDb } from '#lib/server/db.ts';
import { audienceOf } from '#lib/server/queries.ts';
import { requireMemberApi } from '#lib/server/session.ts';
import { canEditWorld } from '#lib/shared/rules.ts';
import type { Gather, GatherResponse, Sight } from '#lib/shared/types.ts';

function refuse(status: number, error: string) {
	return json({ ok: false, error } satisfies GatherResponse, { status });
}

/** A view of a map that makes sense: a spot on or near it, and some of it showing. */
function asSight(value: unknown): Sight | null {
	const { x, y, w, h } = (value ?? {}) as Record<string, unknown>;
	const sound = (n: unknown, low: number, high: number): n is number =>
		typeof n === 'number' && Number.isFinite(n) && n >= low && n <= high;
	if (!sound(x, -16, 16) || !sound(y, -16, 16) || !sound(w, 1e-4, 64) || !sound(h, 1e-4, 64)) {
		return null;
	}
	return { x, y, w, h };
}

export const POST: RequestHandler = async (event) => {
	const { actor } = requireMemberApi(event, event.params.campaign!);
	if (!canEditWorld(actor.role)) return refuse(403, 'Only the GM brings everyone along.');

	const body = (await event.request.json().catch(() => null)) as Record<string, unknown> | null;
	const view = asSight(body?.view);
	const { mapId, from } = body ?? {};
	if (!view || typeof mapId !== 'string' || typeof from !== 'string' || from.length > 64) {
		return refuse(400, 'Malformed request.');
	}
	const audience = audienceOf(getDb(), actor.campaignId, mapId);
	if (!audience) return refuse(404, 'That map does not exist.');

	const gather: Gather = { mapId, view, by: actor.name, from, at: Date.now() };
	const players = audience === 'table';
	await summon(actor.campaignId, { gm: gather, player: players ? gather : null });
	return json({ ok: true, players, at: gather.at } satisfies GatherResponse);
};
