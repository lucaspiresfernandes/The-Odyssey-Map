// The address a player's phone can reach the invite at.
//
// The link the GM's own browser would make is no use when that browser is
// on the machine the app runs on: `localhost` is the phone itself. So the
// server says which addresses this machine has on the network, and the
// invite is made out to one of those instead.

/** What the server tells the GM's browser about inviting players. */
export interface Invite {
	/** The path of the invite link: `/join/<token>`. */
	path: string;
	/** The public addresses of the app, when it is set up behind a proxy. */
	origins: string[];
	/**
	 * The addresses this machine has on the network, the likeliest first.
	 * Empty while the servers only answer on this machine itself.
	 */
	hosts: string[];
}

/** Where this browser remembers which of several network addresses the GM picked. */
const HOST_KEY = 'odyssey:invite-host';

const isLoopback = (hostname: string) =>
	hostname === 'localhost' || hostname === '[::1]' || /^127\./.test(hostname);

export function rememberedHost(): string | null {
	try {
		return localStorage.getItem(HOST_KEY);
	} catch {
		return null;
	}
}

export function rememberHost(host: string) {
	try {
		localStorage.setItem(HOST_KEY, host);
	} catch {
		// A private window may refuse: the first address is used next time.
	}
}

export interface InviteAddress {
	/** The whole link, to copy or to scan. */
	url: string;
	/** The network addresses there are to choose from, when this link is made out to one of them. */
	hosts: string[];
	/** The one it is made out to. */
	host: string | null;
	/** True when the link only works on the machine the app runs on. */
	local: boolean;
}

/**
 * The invite link as other devices can open it. A browser that is already
 * on an address the others can reach uses that. One on the machine itself
 * uses the app's public address if it has one, or else one of the
 * machine's addresses on the network: `picked` if it is still one of them.
 */
export function inviteAddress(
	invite: Invite,
	here: Pick<Location, 'origin' | 'hostname' | 'protocol' | 'port'>,
	picked: string | null = null
): InviteAddress {
	if (!isLoopback(here.hostname)) {
		return { url: here.origin + invite.path, hosts: [], host: null, local: false };
	}
	if (invite.origins.length) {
		return { url: invite.origins[0] + invite.path, hosts: [], host: null, local: false };
	}
	if (invite.hosts.length) {
		const host = picked && invite.hosts.includes(picked) ? picked : invite.hosts[0];
		const port = here.port ? `:${here.port}` : '';
		return {
			url: `${here.protocol}//${host}${port}${invite.path}`,
			hosts: invite.hosts,
			host,
			local: false
		};
	}
	return { url: here.origin + invite.path, hosts: [], host: null, local: true };
}
