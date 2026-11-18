import type { User } from '#lib/server/auth.ts';

declare global {
	namespace App {
		interface Locals {
			/** The logged-in user, resolved from the session cookie on every request. */
			user: User | null;
		}
	}
}

export {};
