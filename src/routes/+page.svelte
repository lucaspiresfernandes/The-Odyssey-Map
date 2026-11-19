<script lang="ts">
	import { enhance } from '$app/forms';
	import { goto } from '$app/navigation';
	import type { PageProps } from './$types';

	let { data, form }: PageProps = $props();

	/** A campaign is being made from a file, and what went wrong with the last one that was tried. */
	let importing = $state(false);
	let importError = $state('');

	/**
	 * Makes a new campaign out of a file that was exported from one. The file
	 * is sent as it is, however big, and the new campaign is opened once it
	 * is there.
	 */
	async function importFrom(input: HTMLInputElement) {
		const file = input.files?.[0];
		input.value = '';
		if (!file || importing) return;
		importing = true;
		importError = '';
		try {
			const response = await fetch('/import', {
				method: 'POST',
				headers: { 'content-type': 'application/x-tar' },
				body: file
			});
			const body = (await response.json().catch(() => null)) as {
				ok?: boolean;
				id?: string;
				error?: string;
			} | null;
			if (body?.ok && body.id) return await goto(`/c/${body.id}`);
			importError = body?.error ?? 'Something went wrong.';
		} catch {
			importError = "Can't reach the server.";
		} finally {
			importing = false;
		}
	}

	let mode = $state<'login' | 'register'>('login');
	const shown = $derived(form?.form === 'register' || form?.form === 'login' ? form.form : mode);
	const query = $derived(data.next ? `&next=${encodeURIComponent(data.next)}` : '');

	const panel = 'grid gap-4 rounded-[14px] border bg-panel p-5.5';
	const tab = '-mb-px cursor-pointer border-b-2 px-3 py-2';
	const tabOn = 'border-accent text-cream';
	const tabOff = 'border-transparent text-muted';
</script>

<main class="mx-auto grid max-w-130 gap-7 px-5 pt-[12vh] pb-10">
	<header class="grid gap-1.5 text-center">
		<h1 class="text-[40px] tracking-[0.01em]">The Odyssey Map</h1>
		<p class="text-muted">A living map you can zoom into forever.</p>
	</header>

	{#if data.user}
		<section class={panel}>
			<div class="flex items-center justify-between gap-3">
				<h2 class="text-xl/tight">Your campaigns</h2>
				<form method="POST" action="?/logout" class="flex items-center gap-2 text-sm" use:enhance>
					<span class="text-muted">{data.user.name}</span>
					<button class="btn btn-sm btn-ghost">Log out</button>
				</form>
			</div>

			{#if data.campaigns.length}
				<ul class="grid gap-2">
					{#each data.campaigns as campaign (campaign.id)}
						<li class="flex items-stretch gap-2">
							<a
								href="/c/{campaign.id}"
								class="flex min-w-0 flex-1 items-center justify-between gap-3 rounded-[10px] border bg-panel-2 px-3.5 py-3 text-cream no-underline hover:border-accent"
							>
								<strong class="truncate font-serif text-[17px] font-semibold">{campaign.name}</strong>
								<span class="shrink-0 text-xs text-muted">
									{campaign.role === 'gm' ? 'Game master' : 'Player'}
								</span>
							</a>
							{#if campaign.role === 'gm'}
								<!-- The whole campaign as one file: a backup, or a world to hand on. -->
								<a
									class="btn btn-ghost h-auto shrink-0 no-underline"
									href="/c/{campaign.id}/export"
									download
									title="Download this campaign as one file: its maps, what is on them, and its pictures"
									>Export</a
								>
							{/if}
						</li>
					{/each}
				</ul>
			{:else}
				<p class="text-muted">
					Nothing here yet.
					{data.user.isGuest
						? 'Open an invite link from your GM to join a campaign.'
						: 'Create your first world below.'}
				</p>
			{/if}

			{#if !data.user.isGuest}
				<form method="POST" action="?/create" class="flex items-end gap-2" use:enhance>
					<label class="field flex-1">
						<span>New campaign</span>
						<input class="input" name="name" placeholder="Name of your world" maxlength="80" required />
					</label>
					<button class="btn btn-primary">Create</button>
				</form>
				{#if form?.form === 'create'}<p class="text-sm text-danger">{form.message}</p>{/if}
				<!-- A campaign that was exported, here or anywhere, comes back as a new one. -->
				<label
					class={['btn btn-ghost justify-self-start', importing && 'pointer-events-none opacity-60']}
				>
					{importing ? 'Importing…' : 'Import a campaign from a file'}
					<input
						class="sr-only"
						type="file"
						accept=".tar,application/x-tar"
						disabled={importing}
						onchange={(e) => importFrom(e.currentTarget)}
					/>
				</label>
				{#if importError}<p class="text-sm text-danger" role="alert">{importError}</p>{/if}
			{/if}
		</section>
	{:else}
		<section class={panel}>
			<div class="flex gap-1 border-b" role="tablist">
				<button
					role="tab"
					aria-selected={shown === 'login'}
					class={[tab, shown === 'login' ? tabOn : tabOff]}
					onclick={() => ((mode = 'login'), (form = null))}>Log in</button
				>
				<button
					role="tab"
					aria-selected={shown === 'register'}
					class={[tab, shown === 'register' ? tabOn : tabOff]}
					onclick={() => ((mode = 'register'), (form = null))}>Create a GM account</button
				>
			</div>

			<form method="POST" action="?/{shown}{query}" class="grid gap-3.5" use:enhance>
				<label class="field">
					<span>Username</span>
					<input
						class="input"
						name="username"
						autocomplete="username"
						value={form?.username ?? ''}
						required
					/>
				</label>
				<label class="field">
					<span>Password</span>
					<input
						class="input"
						name="password"
						type="password"
						autocomplete={shown === 'login' ? 'current-password' : 'new-password'}
						minlength={shown === 'register' ? 8 : undefined}
						required
					/>
				</label>
				{#if form?.message && form.form === shown}
					<p class="text-sm text-danger">{form.message}</p>
				{/if}
				<button class="btn btn-primary">{shown === 'login' ? 'Log in' : 'Create account'}</button>
			</form>

			<p class="text-[13px] text-muted">
				Players don't need an account. They join with the invite link their GM shares.
			</p>
		</section>
	{/if}
</main>
