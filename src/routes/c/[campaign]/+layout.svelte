<script lang="ts">
	import LiveProvider from '#lib/components/LiveProvider.svelte';
	import type { LayoutProps } from './$types';

	let { data, children }: LayoutProps = $props();
</script>

<svelte:head>
	<title>{data.campaign.name} · The Odyssey Map</title>
</svelte:head>

{#key data.campaign.id}
	<LiveProvider campaignId={data.campaign.id} ws={data.ws}>
		{@render children()}
	</LiveProvider>
{/key}
