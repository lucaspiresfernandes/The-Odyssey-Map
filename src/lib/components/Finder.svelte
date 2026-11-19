<script lang="ts">
	// The finder: type a few letters of a place or a marker, and go there.
	// It searches every map of the campaign, and every marker and note on
	// them, that this person may see. Nothing of it is on screen until it is
	// asked for, with Ctrl+K or the magnifier at the top.

	import {
		markerType,
		type FindEntry,
		type FindResponse,
		type MarkerType
	} from '#lib/shared/types.ts';
	import MarkerGlyph from './MarkerGlyph.svelte';
	import Modal from './Modal.svelte';

	interface Props {
		campaignId: string;
		/** The map this was opened on: it is left out of what is found, being here already. */
		here: string;
		onpick: (entry: FindEntry) => void;
		onclose: () => void;
	}

	let { campaignId, here, onpick, onclose }: Props = $props();

	const MOST = 12;

	/** Null until the campaign has been read. */
	let entries = $state.raw<FindEntry[] | null>(null);
	let failed = $state(false);
	let query = $state('');
	/** Which of the results the arrow keys are on. */
	let at = $state(0);

	$effect(() => {
		fetch(`/c/${campaignId}/find`)
			.then((response) => response.json() as Promise<FindResponse>)
			.then((result) => (entries = result.entries))
			.catch(() => (failed = true));
	});

	/** Lower-cased, and without accents: "Cafe" finds "Café". */
	const plain = (text: string) =>
		text
			.normalize('NFD')
			.replace(/[̀-ͯ]/g, '')
			.toLowerCase();

	/**
	 * What matches, the best first: a name that starts with what was typed,
	 * then one with a word that does, then one that has it anywhere. Maps
	 * come before markers. Before anything is typed, the maps are listed.
	 */
	const results = $derived.by(() => {
		if (!entries) return [];
		const wanted = plain(query.trim());
		const ranked: { entry: FindEntry; rank: number }[] = [];
		for (const entry of entries) {
			if (entry.kind === 'map' && entry.id === here) continue;
			if (!wanted) {
				if (entry.kind === 'map') ranked.push({ entry, rank: 0 });
				continue;
			}
			const name = plain(entry.name);
			const found = name.indexOf(wanted);
			if (found === -1) continue;
			const rank = found === 0 ? 0 : /\s/.test(name[found - 1]) ? 1 : 2;
			ranked.push({ entry, rank: rank * 2 + (entry.kind === 'map' ? 0 : 1) });
		}
		return ranked
			.sort((a, b) => a.rank - b.rank)
			.slice(0, MOST)
			.map((each) => each.entry);
	});

	$effect(() => {
		void query;
		at = 0;
	});

	function onkeydown(e: KeyboardEvent) {
		if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
			e.preventDefault();
			if (results.length) {
				at = (at + (e.key === 'ArrowDown' ? 1 : -1) + results.length) % results.length;
			}
		} else if (e.key === 'Enter') {
			e.preventDefault();
			const entry = results[at];
			if (entry) onpick(entry);
		}
	}
</script>

<Modal title="Find a place or a marker" {onclose}>
	<div class="grid gap-3">
		<!-- svelte-ignore a11y_autofocus -->
		<input
			class="input"
			type="search"
			placeholder="Type a name…"
			aria-label="Name of a map or a marker"
			aria-controls="finder-results"
			autocomplete="off"
			autofocus
			bind:value={query}
			{onkeydown}
		/>

		{#if failed}
			<p class="text-sm text-muted">The campaign couldn't be searched. Try again in a moment.</p>
		{:else if entries === null}
			<p class="text-sm text-muted">Reading the campaign…</p>
		{:else if results.length === 0}
			<p class="text-sm text-muted">
				{query.trim() ? 'Nothing by that name.' : 'This campaign has no other maps yet.'}
			</p>
		{:else}
			<ul id="finder-results" class="grid gap-0.5" role="listbox" aria-label="What was found">
				{#each results as entry, i (entry.kind + entry.id)}
					<li role="option" aria-selected={i === at}>
						<button
							class={[
								'flex w-full cursor-pointer items-center gap-2.5 rounded-lg border px-2.5 py-1.5 text-left',
								i === at ? 'border-accent bg-panel-2' : 'border-transparent hover:bg-panel-2'
							]}
							tabindex="-1"
							onpointermove={() => (at = i)}
							onclick={() => onpick(entry)}
						>
							<!-- A marker shows its glyph in its type's colour (--c), a map a small sheet. -->
							<span
								class="grid size-6 shrink-0 place-items-center text-(--c)"
								style:--c={entry.kind === 'marker'
									? markerType(entry.type).color
									: 'var(--color-muted)'}
							>
								{#if entry.kind === 'marker'}
									<MarkerGlyph type={entry.type as MarkerType} size={17} />
								{:else}
									<svg
										width="17"
										height="17"
										viewBox="0 0 24 24"
										fill="none"
										stroke="currentColor"
										stroke-width="2"
										stroke-linejoin="round"
										aria-hidden="true"
									>
										<path
											d={entry.type === 'battle'
												? 'M3 3h18v18H3Z M3 9h18 M3 15h18 M9 3v18 M15 3v18'
												: 'M3 6l6-2 6 2 6-2v14l-6 2-6-2-6 2Z M9 4v14 M15 6v14'}
										/>
									</svg>
								{/if}
							</span>
							<span class="grid min-w-0">
								<span class="truncate">
									{entry.name}
									{#if entry.hidden}
										<span class="text-xs font-semibold text-[#f2c14e]">· hidden</span>
									{/if}
								</span>
								{#if entry.path.length}
									<span class="truncate text-xs text-muted">{entry.path.join(' › ')}</span>
								{/if}
							</span>
						</button>
					</li>
				{/each}
			</ul>
		{/if}
	</div>
</Modal>
