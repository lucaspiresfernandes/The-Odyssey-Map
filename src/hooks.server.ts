import type { Handle } from '@sveltejs/kit/hooks';
import { SESSION_COOKIE, getSessionUser } from '#lib/server/auth.ts';
import { getDb } from '#lib/server/db.ts';
import { isSameOrigin } from '#lib/server/session.ts';

const UNSAFE = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

export const handle: Handle = async ({ event, resolve }) => {
	// Cross-site request forgery guard. SvelteKit's built-in check compares
	// against the origin the adapter assumes, and the adapter assumes https,
	// which would lock out a table playing over plain http on a LAN. This
	// compares hosts instead, so it holds on http and https alike.
	if (UNSAFE.has(event.request.method) && !isSameOrigin(event)) {
		return new Response('Cross-site requests are not allowed.', { status: 403 });
	}

	event.locals.user = getSessionUser(getDb(), event.cookies.get(SESSION_COOKIE));
	return resolve(event);
};
