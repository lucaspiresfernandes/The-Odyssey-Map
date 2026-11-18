<script lang="ts">
	import { enhance } from '$app/forms';
	import type { PageProps } from './$types';

	let { data, form }: PageProps = $props();
</script>

<svelte:head>
	<title>Join {data.campaignName} · The Odyssey Map</title>
</svelte:head>

<main>
	<p class="muted">You've been invited to</p>
	<h1>{data.campaignName}</h1>

	<form method="POST" class="panel" use:enhance>
		{#if data.user}
			<p>Join as <strong>{data.user.name}</strong>?</p>
		{:else}
			<label class="field">
				<span>What should the table call you?</span>
				<!-- svelte-ignore a11y_autofocus -->
				<input class="input" name="name" maxlength="40" placeholder="Your name" required autofocus />
			</label>
		{/if}
		{#if form?.message}<p class="error-text">{form.message}</p>{/if}
		<button class="btn primary">Open the map</button>
	</form>
</main>

<style>
	main {
		max-width: 420px;
		margin: 0 auto;
		padding: 16vh 20px 40px;
		display: grid;
		gap: 10px;
		text-align: center;
	}

	h1 {
		font-size: 34px;
		margin-bottom: 18px;
	}

	.panel {
		background: var(--panel);
		border: 1px solid var(--line);
		border-radius: 14px;
		padding: 22px;
		display: grid;
		gap: 14px;
		text-align: left;
	}
</style>
