// SvelteKit-side helpers around the shared auth and campaign modules.

import { error, redirect, type RequestEvent } from '@sveltejs/kit';
import { SESSION_COOKIE, SESSION_MAX_AGE, createSession, deleteSession, type User } from './auth';
import { actorFor, getMembership, type CampaignSummary } from './campaigns';
import { getDb } from './db';
import type { Actor } from './world';

/** Extra origins that count as this app, for deployments behind a proxy that rewrites Host. */
const TRUSTED_ORIGINS = new Set(
	(process.env.ORIGIN ?? '')
		.split(',')
		.map((origin) => origin.trim())
		.filter(Boolean)
);

/**
 * True unless a browser says the request was started by a page on another
 * site. Browsers attach `Origin` to every cross-site POST, so a request
 * without one did not come from someone else's web page.
 */
export function isSameOrigin(event: RequestEvent): boolean {
	const origin = event.request.headers.get('origin');
	if (origin === null) return true;
	if (TRUSTED_ORIGINS.has(origin)) return true;
	try {
		return new URL(origin).host === event.url.host;
	} catch {
		return false; // "null" and other opaque origins
	}
}

/**
 * Whether the visitor is really on https. The page's own `Origin` header
 * is the reliable witness: `event.url` reflects what the adapter assumes.
 */
function isHttps(event: RequestEvent): boolean {
	try {
		return new URL(event.request.headers.get('origin') ?? event.url.href).protocol === 'https:';
	} catch {
		return false;
	}
}

function cookieOptions(event: RequestEvent) {
	return {
		path: '/',
		httpOnly: true,
		sameSite: 'lax',
		// A Secure cookie is dropped over plain http, which has to keep
		// working for a table playing over the LAN.
		secure: isHttps(event)
	} as const;
}

export function startSession(event: RequestEvent, user: User) {
	const token = createSession(getDb(), user.id);
	event.cookies.set(SESSION_COOKIE, token, { ...cookieOptions(event), maxAge: SESSION_MAX_AGE });
	event.locals.user = user;
}

export function endSession(event: RequestEvent) {
	deleteSession(getDb(), event.cookies.get(SESSION_COOKIE));
	event.cookies.delete(SESSION_COOKIE, cookieOptions(event));
	event.locals.user = null;
}

/** Only same-site paths are accepted as a place to return to after logging in. */
export function safeNext(value: string | null | undefined): string | null {
	return value && /^\/(?![/\\])/.test(value) ? value : null;
}

export interface Member {
	user: User;
	campaign: CampaignSummary;
	actor: Actor;
}

/**
 * For pages: sends visitors to the login form, and answers 404 for a
 * campaign the user is not part of (the same as one that doesn't exist).
 */
export function requireMember(event: RequestEvent, campaignId: string): Member {
	const user = event.locals.user;
	if (!user) redirect(303, `/?next=${encodeURIComponent(event.url.pathname)}`);
	const campaign = getMembership(getDb(), campaignId, user.id);
	if (!campaign) error(404, 'Campaign not found');
	return { user, campaign, actor: actorFor(user, campaign) };
}

/** For endpoints: same checks, but answers with a status instead of redirecting. */
export function requireMemberApi(event: RequestEvent, campaignId: string): Member {
	const user = event.locals.user;
	if (!user) error(401, 'Not logged in');
	const campaign = getMembership(getDb(), campaignId, user.id);
	if (!campaign) error(404, 'Campaign not found');
	return { user, campaign, actor: actorFor(user, campaign) };
}
