// A face for someone at the table, the GM or a player, drawn by DiceBear out
// of their user id. The id never changes, so neither does the face: a player
// renamed is still the one the table knows by sight. It gives nothing away
// that the id doesn't, so it asks for no login, and a browser keeps it for good.

import { Avatar, Style } from '@dicebear/core';
import definition from '@dicebear/styles/adventurer.json' with { type: 'json' };
import { error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';

const style = new Style(definition);

/** What a user id looks like: see ids.ts. Anything else is no one. */
const USER_ID = /^[0-9a-zA-Z]{1,40}$/;

export const GET: RequestHandler = ({ params }) => {
	if (!USER_ID.test(params.id)) error(404, 'No such face.');
	return new Response(new Avatar(style, { seed: params.id }).toString(), {
		headers: {
			'content-type': 'image/svg+xml',
			'cache-control': 'public, max-age=31536000, immutable'
		}
	});
};
