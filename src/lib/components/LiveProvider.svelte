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
		}
	});
	setLive(live);

	// Once, for as long as the component is there. Not an effect: connecting
	// reads the address out of the props, and an effect would run again when
	// a refresh hands over a fresh copy of them, hanging up for good.
	onMount(() => {
		live.connect();
		return () => live.stop();
	});
</script>

{@render children()}
