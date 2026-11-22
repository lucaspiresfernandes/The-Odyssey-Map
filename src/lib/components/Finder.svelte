<script lang="ts">
	// The finder: type a few letters of a place, a marker or a token, and go
	// there. It searches every map of the campaign, every marker and note on
	// them, and on the battle maps every token and what is written there,
	// that this person may see. Nothing of it is on screen until it is asked
	// for, with Ctrl+K or the magnifier at the top.

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

	/** One thing that was found. `words` is the part of a marker's description that matched. */
	interface Found {
		entry: FindEntry;
		rank: number;
		words?: string;
	}

	/** How much of a description is shown before the words that were found in it. */
	const LEAD = 24;

	/**
	 * The stretch of a description around what was found in it, cut at a
	 * word where it doesn't start at the beginning. Taking the accents off a
	 * text can change how long it is, so each plain letter remembers where
	 * it stood in the text as it was written.
	 */
	function around(text: string, wanted: string): string {
		let flat = '';
		const stood: number[] = [];
		let i = 0;
		for (const letter of text) {
			const bare = plain(letter);
			flat += bare;
			for (let n = 0; n < bare.length; n++) stood.push(i);
			i += letter.length;
		}
		const at = stood[flat.indexOf(wanted)] ?? 0;
		let from = Math.max(0, at - LEAD);
		if (from > 0) {
			const gap = text.slice(from, at).search(/\s/);
			from = gap === -1 ? at : from + gap + 1;
		}
		const words = text.slice(from).replace(/\s+/g, ' ').trim();
		return from > 0 ? `…${words}` : words;
	}

	/**
	 * What matches, the best first: a name that starts with what was typed,
	 * then one with a word that does, then one that has it anywhere, and
	 * last a marker whose description has it. Maps come before markers, and
	 * markers before what is on a battle map. Before anything is typed, the
	 * maps are listed.
	 */
	const ORDER: Record<FindEntry['kind'], number> = { map: 0, marker: 1, token: 2, text: 2 };

	/** How each kind that isn't a marker is drawn: a sheet, a grid, a disc, a letter. */
	const SIGNS: Record<string, string> = {
		world: 'M3 6l6-2 6 2 6-2v14l-6 2-6-2-6 2Z M9 4v14 M15 6v14',
		battle: 'M3 3h18v18H3Z M3 9h18 M3 15h18 M9 3v18 M15 3v18',
		token: 'M4 12a8 8 0 1 0 16 0a8 8 0 1 0-16 0 M9 12a3 3 0 1 0 6 0a3 3 0 1 0-6 0',
		text: 'M4 7V4h16v3 M9 20h6 M12 4v16'
	};

	const results = $derived.by((): Found[] => {
		if (!entries) return [];
		const wanted = plain(query.trim());
		const ranked: Found[] = [];
		for (const entry of entries) {
			if (entry.kind === 'map' && entry.id === here) continue;
			if (!wanted) {
				if (entry.kind === 'map') ranked.push({ entry, rank: 0 });
				continue;
			}
			const name = plain(entry.name);
			const found = name.indexOf(wanted);
			if (found !== -1) {
				const rank = found === 0 ? 0 : /\s/.test(name[found - 1]) ? 1 : 2;
				ranked.push({ entry, rank: rank * 3 + ORDER[entry.kind] });
			} else if (entry.text && plain(entry.text).includes(wanted)) {
				ranked.push({ entry, rank: 9, words: entry.text });
			}
		}
		// Only what is shown has its words cut out: there may be a great many markers.
		return ranked
			.sort((a, b) => a.rank - b.rank)
			.slice(0, MOST)
			.map((found) => (found.words ? { ...found, words: around(found.words, wanted) } : found));
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
			const found = results[at];
			if (found) onpick(found.entry);
		}
	}
</script>

<Modal title="Find a place, a marker or a token" {onclose}>
	<div class="grid gap-3">
		<!-- svelte-ignore a11y_autofocus -->
		<input
			class="input"
			type="search"
			placeholder="Type a name, or a word from a marker…"
			aria-label="Name of a map, a marker or a token, or words from a marker"
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
				{query.trim() ? 'Nothing by that name, and no marker that says it.' : 'This campaign has no other maps yet.'}
			</p>
		{:else}
			<ul id="finder-results" class="grid gap-0.5" role="listbox" aria-label="What was found">
				{#each results as { entry, words }, i (entry.kind + entry.id)}
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
							<!-- A marker shows its glyph in its type's colour (--c), a map a
							     small sheet, a token a disc and a text a letter. -->
							<span
								class="grid size-6 shrink-0 place-items-center text-(--c)"
								style:--c={entry.kind === 'marker'
									? markerType(entry.type as MarkerType).color
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
										<path d={SIGNS[entry.type] ?? SIGNS.world} />
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
								{#if words}
									<span class="truncate text-xs">{words}</span>
								{/if}
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
