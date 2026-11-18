<script lang="ts">
	import { enhance } from '$app/forms';
	import type { PageProps } from './$types';

	let { data, form }: PageProps = $props();

	let mode = $state<'login' | 'register'>('login');
	const shown = $derived(form?.form === 'register' || form?.form === 'login' ? form.form : mode);
	const query = $derived(data.next ? `&next=${encodeURIComponent(data.next)}` : '');
</script>

<main>
	<header>
		<h1>The Odyssey Map</h1>
		<p class="muted">A living map you can zoom into forever.</p>
	</header>

	{#if data.user}
		<section class="panel">
			<div class="row">
				<h2>Your campaigns</h2>
				<form method="POST" action="?/logout" use:enhance>
					<span class="muted">{data.user.name}</span>
					<button class="btn small ghost">Log out</button>
				</form>
			</div>

			{#if data.campaigns.length}
				<ul class="campaigns">
					{#each data.campaigns as campaign (campaign.id)}
						<li>
							<a href="/c/{campaign.id}">
								<strong>{campaign.name}</strong>
								<span class="tag">{campaign.role === 'gm' ? 'Game master' : 'Player'}</span>
							</a>
						</li>
					{/each}
				</ul>
			{:else}
				<p class="muted">
					Nothing here yet.
					{data.user.isGuest
						? 'Open an invite link from your GM to join a campaign.'
						: 'Create your first world below.'}
				</p>
			{/if}

			{#if !data.user.isGuest}
				<form method="POST" action="?/create" class="create" use:enhance>
					<label class="field">
						<span>New campaign</span>
						<input class="input" name="name" placeholder="Name of your world" maxlength="80" required />
					</label>
					<button class="btn primary">Create</button>
				</form>
				{#if form?.form === 'create'}<p class="error-text">{form.message}</p>{/if}
			{/if}
		</section>
	{:else}
		<section class="panel">
			<div class="tabs" role="tablist">
				<button
					role="tab"
					aria-selected={shown === 'login'}
					class:on={shown === 'login'}
					onclick={() => ((mode = 'login'), (form = null))}>Log in</button
				>
				<button
					role="tab"
					aria-selected={shown === 'register'}
					class:on={shown === 'register'}
					onclick={() => ((mode = 'register'), (form = null))}>Create a GM account</button
				>
			</div>

			<form method="POST" action="?/{shown}{query}" class="auth" use:enhance>
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
				{#if form?.message && form.form === shown}<p class="error-text">{form.message}</p>{/if}
				<button class="btn primary">{shown === 'login' ? 'Log in' : 'Create account'}</button>
			</form>

			<p class="muted hint">
				Players don't need an account. They join with the invite link their GM shares.
			</p>
		</section>
	{/if}
</main>

<style>
	main {
		max-width: 520px;
		margin: 0 auto;
		padding: 12vh 20px 40px;
		display: grid;
		gap: 28px;
	}

	header {
		text-align: center;
		display: grid;
		gap: 6px;
	}

	h1 {
		font-size: 40px;
		letter-spacing: 0.01em;
	}

	h2 {
		font-size: 20px;
	}

	.panel {
		background: var(--panel);
		border: 1px solid var(--line);
		border-radius: 14px;
		padding: 22px;
		display: grid;
		gap: 16px;
	}

	.row {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 12px;
	}

	.row form {
		display: flex;
		align-items: center;
		gap: 8px;
		font-size: 14px;
	}

	.campaigns {
		list-style: none;
		margin: 0;
		padding: 0;
		display: grid;
		gap: 8px;
	}

	.campaigns a {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 12px;
		padding: 12px 14px;
		border: 1px solid var(--line);
		border-radius: var(--radius);
		background: var(--panel-2);
		color: var(--text);
		text-decoration: none;
	}

	.campaigns a:hover {
		border-color: var(--accent);
	}

	.campaigns strong {
		font-family: var(--serif);
		font-size: 17px;
		font-weight: 600;
	}

	.tag {
		font-size: 12px;
		color: var(--muted);
	}

	.create {
		display: flex;
		align-items: end;
		gap: 8px;
	}

	.create .field {
		flex: 1;
	}

	.tabs {
		display: flex;
		gap: 4px;
		border-bottom: 1px solid var(--line);
	}

	.tabs button {
		padding: 8px 12px;
		border: 0;
		border-bottom: 2px solid transparent;
		margin-bottom: -1px;
		background: none;
		color: var(--muted);
		cursor: pointer;
	}

	.tabs button.on {
		color: var(--text);
		border-bottom-color: var(--accent);
	}

	.auth {
		display: grid;
		gap: 14px;
	}

	.hint {
		font-size: 13px;
	}
</style>
