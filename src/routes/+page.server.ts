import { fail, redirect } from '@sveltejs/kit';
import { AuthError, registerUser, verifyLogin } from '#lib/server/auth.ts';
import { createCampaign, listCampaigns } from '#lib/server/campaigns.ts';
import { getDb } from '#lib/server/db.ts';
import { endSession, safeNext, startSession } from '#lib/server/session.ts';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = ({ locals, url }) => {
	const next = safeNext(url.searchParams.get('next'));
	if (locals.user && next) redirect(303, next);
	return {
		user: locals.user,
		campaigns: locals.user ? listCampaigns(getDb(), locals.user.id) : [],
		next
	};
};

// A small brake on password guessing: a handful of wrong passwords for one
// account from one address, then a wait. Kept in memory, which is enough
// for a single server.
const MAX_FAILURES = 8;
const WINDOW_MS = 10 * 60 * 1000;
const failures = new Map<string, { count: number; until: number }>();

export const actions: Actions = {
	login: async (event) => {
		const form = await event.request.formData();
		const username = form.get('username');
		const name = String(username ?? '');
		const key = `${event.getClientAddress()}|${name.trim().toLowerCase()}`;
		const now = Date.now();
		const record = failures.get(key);
		if (record && record.until < now) failures.delete(key);
		else if (record && record.count >= MAX_FAILURES) {
			return fail(429, {
				form: 'login',
				username: name,
				message: 'Too many wrong passwords. Try again in a few minutes.'
			});
		}

		try {
			startSession(event, await verifyLogin(getDb(), username, form.get('password')));
			failures.delete(key);
		} catch (err) {
			if (err instanceof AuthError) {
				const current = failures.get(key) ?? { count: 0, until: now + WINDOW_MS };
				current.count++;
				failures.set(key, current);
				return fail(400, { form: 'login', username: name, message: err.message });
			}
			throw err;
		}
		redirect(303, safeNext(event.url.searchParams.get('next')) ?? '/');
	},

	register: async (event) => {
		const form = await event.request.formData();
		const username = form.get('username');
		try {
			startSession(event, await registerUser(getDb(), username, form.get('password')));
		} catch (err) {
			if (err instanceof AuthError) {
				return fail(400, { form: 'register', username: String(username ?? ''), message: err.message });
			}
			throw err;
		}
		redirect(303, safeNext(event.url.searchParams.get('next')) ?? '/');
	},

	create: async (event) => {
		const user = event.locals.user;
		if (!user) return fail(401, { form: 'create', username: '', message: 'Log in first.' });
		const form = await event.request.formData();
		let campaign;
		try {
			campaign = createCampaign(getDb(), user, form.get('name'));
		} catch (err) {
			return fail(400, { form: 'create', username: '', message: (err as Error).message });
		}
		redirect(303, `/c/${campaign.id}`);
	},

	logout: async (event) => {
		endSession(event);
		redirect(303, '/');
	}
};
