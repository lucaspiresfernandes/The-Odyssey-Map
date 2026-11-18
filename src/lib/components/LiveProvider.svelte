<script lang="ts">
	import { invalidateAll } from '$app/navigation';
	import { page } from '$app/state';
	import type { Snippet } from 'svelte';
	import { Live, setLive } from '#lib/client/live.svelte.ts';
	import type { MapSnapshot } from '#lib/shared/types.ts';

	interface Props {
		campaignId: string;
		ws: { url: string | null; port: number };
		children: Snippet;
	}

	let { campaignId, ws, children }: Props = $props();

	// One connection per campaign. The parent re-creates this component when
	// the campaign changes, so these values are fixed for its lifetime.
	// svelte-ignore state_referenced_locally
	const live = new Live({
		campaignId,
		url: () => {
			const scheme = location.protocol === 'https:' ? 'wss' : 'ws';
			const base = ws.url ?? `${scheme}://${location.hostname}:${ws.port}`;
			return `${base}${base.includes('?') ? '&' : '?'}campaign=${encodeURIComponent(campaignId)}`;
		},
		onHello: (seq) => {
			// The server has changes this page's snapshot was taken before:
			// either the page loaded a moment ahead of the socket, or the
			// connection was down for a while. Fetch a fresh snapshot.
			const snapshot = (page.data as { snapshot?: MapSnapshot }).snapshot;
			if (snapshot && seq > snapshot.lastSeq) invalidateAll();
		}
	});
	setLive(live);

	$effect(() => {
		live.connect();
		return () => live.stop();
	});
</script>

{@render children()}
