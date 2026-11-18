<script lang="ts">
	import LiveProvider from '#lib/components/LiveProvider.svelte';
	import type { LayoutProps } from './$types';

	let { data, children }: LayoutProps = $props();
</script>

<svelte:head>
	<title>{data.campaign.name} · The Odyssey Map</title>
</svelte:head>

<!-- A table display listens as a player does, so it is a connection of its own. -->
{#key `${data.campaign.id}:${data.display}`}
	<LiveProvider campaignId={data.campaign.id} ws={data.ws} display={data.display}>
		{@render children()}
	</LiveProvider>
{/key}
