<script lang="ts">
	import { enhance } from '$app/forms';
	import { invalidateAll } from '$app/navigation';
	import { page } from '$app/state';
	import type { SeatStatus } from '#lib/shared/types.ts';
	import type { PageProps } from './$types';

	let { data, form }: PageProps = $props();

	/** How the last asking ended, when it didn't end in a seat: the GM said no, or never answered. */
	let ended = $state<'refused' | 'gone' | null>(null);

	/** Asking again clears what is said about the last time. */
	const asking = () => {
		ended = null;
		return ({ update }: { update: () => Promise<void> }) => update();
	};

	// While the GM is being asked, the answer is looked for every couple of
	// seconds. A yes seats this browser, and the map opens.
	$effect(() => {
		if (!data.waiting) return;
		let over = false;
		const ask = async () => {
			try {
				const response = await fetch(`${page.url.pathname}/seat`);
				const answer = (await response.json()) as SeatStatus;
				if (over || answer.status === 'waiting') return;
				if (answer.status === 'granted' && answer.to) {
					// A whole new page: this browser is someone at the table now.
					location.href = answer.to;
					return;
				}
				ended = answer.status === 'refused' ? 'refused' : 'gone';
				await invalidateAll();
			} catch {
				// The server couldn't be reached: the next try may do better.
			}
		};
		const timer = setInterval(ask, 2000);
		return () => {
			over = true;
			clearInterval(timer);
		};
	});
</script>

<svelte:head>
	<title>Join {data.campaignName} · The Odyssey Map</title>
</svelte:head>

<main class="mx-auto grid max-w-105 gap-2.5 px-5 pt-[16vh] pb-10 text-center">
	<p class="text-muted">You've been invited to</p>
	<h1 class="mb-4.5 text-[34px]">{data.campaignName}</h1>

	{#if data.waiting}
		<!-- The GM has been asked. Nothing to do here but wait, or think again. -->
		<form
			method="POST"
			action="?/cancel"
			class="grid gap-3.5 rounded-[14px] border bg-panel p-5.5 text-left"
			use:enhance
		>
			<p role="status">
				{#if data.waiting.newcomer}
					Asking the GM to let you in as <strong>{data.waiting.name}</strong>…
				{:else}
					Asking the GM to let you back in as <strong>{data.waiting.name}</strong>…
				{/if}
			</p>
			<p class="text-[13px] text-muted">
				They see your request on their map. This page opens the map by itself once they say yes.
			</p>
			<button class="btn">Never mind</button>
		</form>
	{:else}
		{#if ended}
			<p class="rounded-[10px] border border-danger px-3.5 py-2.5 text-sm text-danger" role="alert">
				{#if ended === 'refused'}
					The GM didn't let that through. Have a word with them, then ask again.
				{:else}
					The GM didn't answer in time. Ask again once they have the map open.
				{/if}
			</p>
		{/if}

		<form
			method="POST"
			action="?/join"
			class="grid gap-3.5 rounded-[14px] border bg-panel p-5.5 text-left"
			use:enhance={asking}
		>
			{#if data.user}
				<p>Join as <strong>{data.user.name}</strong>?</p>
			{:else}
				<label class="field">
					<span>What should the table call you?</span>
					<!-- svelte-ignore a11y_autofocus -->
					<input
						class="input"
						name="name"
						maxlength="40"
						placeholder="Your name"
						required
						autofocus={data.seats.length === 0}
					/>
				</label>
			{/if}
			{#if form?.message}<p class="text-sm text-danger">{form.message}</p>{/if}
			<button class="btn btn-primary">Ask to join</button>
			<p class="text-[13px] text-muted">The GM lets you in from their screen.</p>
		</form>

		{#if data.seats.length}
			<!-- The seats that are taken: whoever sat in one picks their own name,
			     and the GM lets them back in. -->
			<form
				method="POST"
				action="?/claim"
				class="mt-3 grid gap-3 rounded-[14px] border bg-panel p-5.5 text-left"
				use:enhance={asking}
			>
				<p>
					Played here before?
					<span class="block text-[13px] text-muted">
						Pick your name. The GM lets you back in, with your notes and everything you were shown.
					</span>
				</p>
				<div class="flex flex-wrap gap-2">
					{#each data.seats as seat (seat.id)}
						<button class="btn max-w-full" name="seat" value={seat.id}>
							<span class="truncate">{seat.name}</span>
						</button>
					{/each}
				</div>
			</form>
		{/if}
	{/if}
</main>
