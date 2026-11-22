<script lang="ts">
	// The seats at the table, which are the GM's to look after: the players
	// of the campaign. A seat is a name and nothing else, with no login and
	// no password. Here the GM makes one ahead of the session, changes what a
	// player is called, and takes a seat away.
	//
	// Whoever is to sit in a seat opens the invite link and picks their name
	// among the seats that are there. The GM is asked on the map, and lets
	// them in.

	import type { Presence, Seat, SeatsResponse } from '#lib/shared/types.ts';
	import Avatar from './Avatar.svelte';
	import Modal from './Modal.svelte';

	interface Props {
		campaignId: string;
		/** Who is at the table now, to say which seats have someone in them this minute. */
		online: Presence[];
		/** The seats are not what they were: a player was added, renamed or taken away. */
		onchange: () => void;
		/** On to the invite: the code to scan and the link to send. */
		oninvite: () => void;
		onclose: () => void;
	}

	let { campaignId, online, onchange, oninvite, onclose }: Props = $props();

	/** Null until the seats have been read. */
	let seats = $state.raw<Seat[] | null>(null);
	let error = $state('');
	/** The name of a seat about to be made. */
	let fresh = $state('');
	let busy = $state(false);
	/** The seat the GM has asked to take away, while they are being asked if they mean it. */
	let removing = $state<string | null>(null);

	/** Asks the server for something about the seats. True when it went through. */
	async function ask(path: string, init?: RequestInit): Promise<boolean> {
		error = '';
		try {
			const response = await fetch(`/c/${campaignId}/seats${path}`, init);
			const result = (await response.json()) as SeatsResponse;
			if (!result.ok) {
				error = result.error ?? 'Something went wrong.';
				return false;
			}
			seats = result.seats ?? [];
			return true;
		} catch {
			error = "Can't reach the server.";
			return false;
		}
	}

	const json = (method: string, body: unknown): RequestInit => ({
		method,
		headers: { 'content-type': 'application/json' },
		body: JSON.stringify(body)
	});

	$effect(() => {
		ask('');
	});

	async function add(event: SubmitEvent) {
		event.preventDefault();
		const name = fresh.trim();
		if (!name || busy) return;
		busy = true;
		if (await ask('', json('POST', { name }))) {
			fresh = '';
			onchange();
		}
		busy = false;
	}

	async function rename(seat: Seat, input: HTMLInputElement) {
		const name = input.value.trim();
		if (name === seat.name) return;
		const renamed = name !== '' && (await ask(`/${seat.id}`, json('PATCH', { name })));
		// A name that didn't take is put back as it was.
		if (!renamed) input.value = seat.name;
		else onchange();
	}

	async function remove(seat: Seat) {
		removing = null;
		if (await ask(`/${seat.id}`, { method: 'DELETE' })) onchange();
	}

	/** There is a seat with nobody in it: someone to invite. */
	const anyFree = $derived(seats?.some((seat) => seat.guest && !seat.taken) ?? false);

	/** How it stands with a seat, in a few words. */
	function standing(seat: Seat): string {
		if (online.some((person) => person.id === seat.id)) return 'At the table now';
		if (!seat.guest) return 'Has an account of their own';
		return seat.taken ? 'Away' : 'Nobody has sat here yet';
	}
</script>

<Modal title="Seats at the table" {onclose}>
	<p class="text-[13px] text-muted">
		A seat is a player of this campaign: a name, with no login and no password. To sit down,
		someone opens the invite link and picks their name. You are asked before they are let in.
	</p>

	{#if seats === null}
		<p class="text-sm text-muted">{error || 'Reading the seats…'}</p>
	{:else}
		{#if seats.length === 0}
			<p class="text-sm text-muted">There are no seats yet. Make one for each of your players.</p>
		{:else}
			<ul class="grid gap-1" aria-label="Seats">
				{#each seats as seat (seat.id)}
					{@const here = online.some((person) => person.id === seat.id)}
					<li class="rounded-lg border bg-panel-2 px-2 py-1.5" data-seat={seat.name}>
						{#if removing === seat.id}
							<!-- Asked first: there is no undo for this one. -->
							<div class="grid gap-2 px-1 py-0.5">
								<p class="text-[13px]">
									Take <strong>{seat.name}</strong>’s seat away? Their tokens become nobody’s, and
									they are in on no secret any more. Their notes and drawings stay. It can't be
									undone.
								</p>
								<div class="flex justify-end gap-1.5">
									<button class="btn btn-sm btn-ghost" onclick={() => (removing = null)}>Keep it</button>
									<button class="btn btn-sm btn-danger" onclick={() => remove(seat)}>
										Take it away
									</button>
								</div>
							</div>
						{:else}
							<div class="flex items-center gap-2">
								<span
									class={['size-2 shrink-0 rounded-full', here ? 'bg-[#3fae7c]' : 'bg-[#55607a]']}
									aria-hidden="true"
								></span>
								<Avatar id={seat.id} name={seat.name} class="size-7" />
								{#if seat.guest}
									<!-- The name is its own field: change it and leave, and the player is renamed. -->
									<input
										class="min-w-0 flex-1 truncate rounded-md border border-transparent bg-transparent px-1.5 py-0.5 hover:border-line focus:border-line focus:bg-[#12161e] touch:min-h-9 touch:text-base"
										value={seat.name}
										maxlength="40"
										aria-label="Name of the player in this seat"
										autocomplete="off"
										spellcheck="false"
										onchange={(e) => rename(seat, e.currentTarget)}
										onkeydown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
									/>
								{:else}
									<span class="min-w-0 flex-1 truncate px-1.5 py-0.5">{seat.name}</span>
								{/if}
								<span class="shrink-0 text-xs text-muted">{standing(seat)}</span>
								<button
									class="btn btn-sm btn-ghost shrink-0"
									aria-label="Take {seat.name}’s seat away"
									title="Take this seat away"
									onclick={() => (removing = seat.id)}
								>
									×
								</button>
							</div>
						{/if}
					</li>
				{/each}
			</ul>
		{/if}

		<form class="flex items-end gap-2" onsubmit={add}>
			<label class="field min-w-0 flex-1">
				<span>A new seat, for</span>
				<input
					class="input"
					bind:value={fresh}
					maxlength="40"
					placeholder="The player's name"
					autocomplete="off"
					spellcheck="false"
				/>
			</label>
			<button class="btn btn-primary" disabled={busy || !fresh.trim()}>Add the seat</button>
		</form>

		{#if error}
			<p class="text-[13px] text-danger" role="alert">{error}</p>
		{/if}
	{/if}

	<div class="flex justify-end gap-2">
		<button
			class="btn"
			disabled={!anyFree}
			title={anyFree
				? 'A code for players to scan, and the link to send them'
				: 'With no seat free, there is nobody to invite'}
			onclick={oninvite}
		>
			Invite players
		</button>
		<button class="btn" onclick={onclose}>Done</button>
	</div>
</Modal>
