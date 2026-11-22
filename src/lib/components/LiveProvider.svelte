<script lang="ts">
	import { refreshAll } from '$app/navigation';
	import { page } from '$app/state';
	import { onMount, type Snippet } from 'svelte';
	import { Live, setLive } from '#lib/client/live.svelte.ts';
	import type { MapSnapshot } from '#lib/shared/types.ts';

	interface Props {
		campaignId: string;
		ws: { url: string | null; port: number };
		/** This window is a table display: it is sent what a player is, and takes no part. */
		display?: boolean;
		children: Snippet;
	}

	let { campaignId, ws, display = false, children }: Props = $props();

	// One connection per campaign. The parent re-creates this component when
	// the campaign changes, so these values are fixed for its lifetime.
	// svelte-ignore state_referenced_locally
	const live = new Live({
		campaignId,
		url: () => {
			const scheme = location.protocol === 'https:' ? 'wss' : 'ws';
			const base = ws.url ?? `${scheme}://${location.hostname}:${ws.port}`;
			const query = `campaign=${encodeURIComponent(campaignId)}${display ? '&display=1' : ''}`;
			return `${base}${base.includes('?') ? '&' : '?'}${query}`;
		},
		onHello: (seq) => {
			// The server has changes this page's snapshot was taken before:
			// either the page loaded a moment ahead of the socket, or the
			// connection was down for a while. Fetch a fresh snapshot.
			const snapshot = (page.data as { snapshot?: MapSnapshot }).snapshot;
			if (snapshot && seq > snapshot.lastSeq) refreshAll();
		},
		// The GM has taken this browser's seat away: back to the first page,
		// which is all that is left for it. Loaded afresh, since who this
		// browser is may have gone with the seat.
		onBye: () => location.assign('/')
	});
	setLive(live);

	// Once, for as long as the component is there. Not an effect: connecting
	// reads the address out of the props, and an effect would run again when
	// a refresh hands over a fresh copy of them, hanging up for good.
	onMount(() => {
		live.connect();

		// A phone that was locked, a tab that was behind another: the moment it
		// is looked at again, the connection is seen to, and not whenever its
		// own timer would have got round to it.
		let hiddenAt: number | null = document.hidden ? Date.now() : null;
		const looked = () => {
			if (document.hidden) {
				hiddenAt = Date.now();
				return;
			}
			const away = hiddenAt === null ? 0 : Date.now() - hiddenAt;
			hiddenAt = null;
			live.wake(away);
		};
		// The network is back, which may be another network: whatever socket
		// there was is not to be trusted.
		const back = () => live.wake(Infinity);
		document.addEventListener('visibilitychange', looked);
		window.addEventListener('online', back);

		return () => {
			document.removeEventListener('visibilitychange', looked);
			window.removeEventListener('online', back);
			live.stop();
		};
	});
</script>

{@render children()}
