<script lang="ts">
	import { enhance } from '$app/forms';
	import type { PageProps } from './$types';

	let { data, form }: PageProps = $props();
</script>

<svelte:head>
	<title>Join {data.campaignName} · The Odyssey Map</title>
</svelte:head>

<main class="mx-auto grid max-w-105 gap-2.5 px-5 pt-[16vh] pb-10 text-center">
	<p class="text-muted">You've been invited to</p>
	<h1 class="mb-4.5 text-[34px]">{data.campaignName}</h1>

	<form method="POST" class="grid gap-3.5 rounded-[14px] border bg-panel p-5.5 text-left" use:enhance>
		{#if data.user}
			<p>Join as <strong>{data.user.name}</strong>?</p>
		{:else}
			<label class="field">
				<span>What should the table call you?</span>
				<!-- svelte-ignore a11y_autofocus -->
				<input class="input" name="name" maxlength="40" placeholder="Your name" required autofocus />
			</label>
		{/if}
		{#if form?.message}<p class="text-sm text-danger">{form.message}</p>{/if}
		<button class="btn btn-primary">Open the map</button>
	</form>
</main>
