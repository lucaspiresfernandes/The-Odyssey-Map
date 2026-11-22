<script lang="ts">
	// The third shelf of the gallery: the campaign's encounters. An encounter
	// is tokens made ahead of time, to put down on a battle map in one go.
	//
	// The shelf shows them all, and the way to make one more. Open one and it
	// is the encounter's own page: its name, the tokens in it, and under them
	// everything a token can be made of. That is a plain disc, the token
	// pictures in the gallery, and a plus for a picture that isn't there yet.
	// Click one and the encounter has one more of it.
	//
	// Like the rest of the gallery, every change is kept as it is made. None
	// of it is part of a map's history, and only the GM ever sees it.

	import {
		LIMITS,
		TOKEN_COLORS,
		imageUrl,
		type Encounter,
		type EncounterPiece,
		type EncountersResponse,
		type GalleryItem
	} from '#lib/shared/types.ts';

	interface Props {
		campaignId: string;
		/** The token pictures in the gallery, to make tokens of. */
		pictures: GalleryItem[];
		/** The encounters the campaign keeps. Null until they have been read. */
		encounters: Encounter[] | null;
		/** Pictures are on their way into the gallery. */
		uploading: boolean;
		/** Puts new token pictures in the gallery, and answers with the ones that went in. */
		onupload: (files: File[]) => Promise<GalleryItem[]>;
		/** Something went wrong that the GM should hear about, or with nothing, it is over. */
		onerror: (text: string) => void;
	}

	let {
		campaignId,
		pictures,
		encounters = $bindable(),
		uploading,
		onupload,
		onerror
	}: Props = $props();

	const ACCEPT = 'image/png,image/jpeg,image/webp,image/gif,image/avif';

	/** The encounter that is open, by id, or null while the shelf shows them all. */
	let open = $state<string | null>(null);
	/**
	 * The tokens of the open encounter, as they are on this screen. The server
	 * is told of every change, but it is this list the GM is looking at.
	 */
	let draft = $state.raw<EncounterPiece[]>([]);
	/** The open encounter was made a moment ago: its name is waiting to be typed over. */
	let fresh = $state(false);
	/** The encounter the GM has asked to throw away, while they are asked if they mean it. */
	let removing = $state<string | null>(null);
	let fileInput = $state<HTMLInputElement>();

	const opened = $derived(encounters?.find((each) => each.id === open) ?? null);
	const full = $derived(draft.length >= LIMITS.encounterTokens);

	/** Asks for something to be done to the encounters. Every answer is all of them, as they are afterwards. */
	async function ask(path: string, method: string, body?: unknown) {
		try {
			const response = await fetch(`/c/${campaignId}/encounters${path}`, {
				method,
				headers: body ? { 'content-type': 'application/json' } : {},
				body: body ? JSON.stringify(body) : undefined
			});
			const result = (await response.json().catch(() => null)) as EncountersResponse | null;
			if (!result?.ok || !result.items) {
				throw new Error(result?.error ?? "The encounters couldn't be reached.");
			}
			encounters = result.items;
			return result;
		} catch (err) {
			onerror((err as Error).message);
			return null;
		}
	}

	/** A token of an encounter without where it stands: that is the server's to say. */
	const pieceOf = ({ dx: _, dy: __, ...piece }: EncounterPiece & { dx?: number; dy?: number }) =>
		piece;

	function edit(encounter: Encounter, isNew = false) {
		onerror('');
		removing = null;
		fresh = isNew;
		draft = encounter.tokens.map(pieceOf);
		open = encounter.id;
	}

	/** A name no encounter has yet: "New encounter", then "New encounter 2". */
	function spareName(): string {
		const taken = new Set((encounters ?? []).map((each) => each.name.toLowerCase()));
		for (let n = 1; ; n++) {
			const name = n === 1 ? 'New encounter' : `New encounter ${n}`;
			if (!taken.has(name.toLowerCase())) return name;
		}
	}

	/** One more encounter, empty, and open to be named and filled. */
	async function create() {
		onerror('');
		const result = await ask('', 'POST', { name: spareName() });
		const made = result?.items?.find((each) => each.id === result.made);
		if (made) edit(made, true);
	}

	async function rename(encounter: Encounter, input: HTMLInputElement) {
		const name = input.value.trim();
		if (name === encounter.name) return;
		onerror('');
		const renamed = name !== '' && (await ask(`/${encounter.id}`, 'PATCH', { name }));
		// A name that didn't take is put back as it was.
		if (!renamed) input.value = encounter.name;
	}

	async function remove(encounter: Encounter) {
		removing = null;
		onerror('');
		if (await ask(`/${encounter.id}`, 'DELETE')) {
			if (open === encounter.id) open = null;
		}
	}

	// Each change sends all the tokens of the encounter, so two sent at once
	// could land in the wrong order. They go one at a time, and whatever is
	// waiting when one comes back is sent as the latest of them.
	let sending = false;
	let waiting: { id: string; tokens: EncounterPiece[] } | null = null;

	async function keep() {
		if (!open) return;
		waiting = { id: open, tokens: draft };
		if (sending) return;
		sending = true;
		while (waiting) {
			const { id, tokens } = waiting;
			waiting = null;
			const kept = await ask(`/${id}`, 'PATCH', { tokens });
			if (!kept) {
				// Refused: the screen goes back to what the encounter does hold.
				waiting = null;
				const held = encounters?.find((each) => each.id === id);
				if (held && open === id) draft = held.tokens.map(pieceOf);
			}
		}
		sending = false;
	}

	function add(piece: EncounterPiece) {
		if (full) return;
		onerror('');
		draft = [...draft, piece];
		keep();
	}

	/** A token as it starts out: of this picture, which may say how big and ringed in what, or plain. */
	function pieceFrom(item: GalleryItem | null): EncounterPiece {
		return {
			name: (item?.name ?? 'Token').slice(0, LIMITS.tokenName).trim() || 'Token',
			color: TOKEN_COLORS[0],
			outline: item?.tokenOutline ?? null,
			image: item?.file ?? null,
			size: item?.tokenSize ?? 1,
			rotation: 0,
			marks: [],
			count: null,
			countHidden: false
		};
	}

	function renameToken(index: number, input: HTMLInputElement) {
		const name = input.value.trim();
		if (name === draft[index].name) return;
		if (name === '') {
			input.value = draft[index].name;
			return;
		}
		onerror('');
		draft = draft.map((piece, i) => (i === index ? { ...piece, name } : piece));
		keep();
	}

	function takeOut(index: number) {
		onerror('');
		draft = draft.filter((_, i) => i !== index);
		keep();
	}

	/** New pictures go in the gallery, and a token of each goes in the encounter. */
	async function upload(files: File[]) {
		const into = open;
		const made = await onupload(files);
		if (fileInput) fileInput.value = '';
		if (open !== into) return;
		for (const item of made) add(pieceFrom(item));
	}

	/** The name of a new encounter is there to be typed over. */
	function takeFocus(input: HTMLInputElement) {
		if (!fresh) return;
		input.focus();
		input.select();
	}

	const count = (n: number) => `${n} ${n === 1 ? 'token' : 'tokens'}`;
	/** What a token is besides its name, for its tooltip: "2 cells across". */
	const about = (piece: EncounterPiece) =>
		piece.size === 1 ? piece.name : `${piece.name}: ${piece.size} cells across`;
</script>

{#if opened}
	<!-- One encounter: its name, what is in it, and what can be added to it. -->
	<div class="flex items-center gap-2">
		<button
			class="btn btn-sm shrink-0"
			onclick={() => {
				open = null;
				onerror('');
			}}
		>
			<svg width="14" height="14" viewBox="0 0 24 24" aria-hidden="true">
				<path d="M15 6l-6 6 6 6" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" />
			</svg>
			Encounters
		</button>
		{#key opened.id}
			<input
				class="input min-w-0 flex-1 font-semibold"
				value={opened.name}
				maxlength={LIMITS.name}
				aria-label="Name of the encounter"
				onchange={(e) => rename(opened, e.currentTarget)}
				onkeydown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
				use:takeFocus
			/>
		{/key}
	</div>

	<section class="grid gap-2" aria-label="Tokens in this encounter">
		<h3 class="font-sans text-[13px] font-normal text-muted">
			In this encounter
			<span class="tabular-nums">· {count(draft.length)}</span>
		</h3>
		{#if draft.length === 0}
			<p class="rounded-lg border border-dashed px-3 py-4 text-center text-sm text-muted">
				Nothing in it yet. Pick its tokens below: one click for each token it has.
			</p>
		{:else}
			<ul class="grid grid-cols-[repeat(auto-fill,minmax(88px,1fr))] content-start gap-x-2 gap-y-3">
				{#each draft as piece, i (i)}
					<li class="group relative grid content-start justify-items-center gap-1">
						<!-- As it will look on the map: its picture or its colour (--c),
						     ringed in its outline (--o), if it has one. -->
						<span
							class="grid size-16 place-items-center overflow-hidden rounded-full border-[3px] border-(--o) bg-(--c)"
							style:--c={piece.image ? 'var(--color-night)' : piece.color}
							style:--o={piece.outline ?? '#12151c'}
							title={about(piece)}
						>
							{#if piece.image}
								<img
									class="size-full object-cover"
									src={imageUrl(campaignId, piece.image, 'thumb')}
									alt=""
									loading="lazy"
									draggable="false"
								/>
							{/if}
						</span>
						{#if piece.size !== 1}
							<!-- How many cells across, for one that isn't the usual one. -->
							<span
								class="absolute top-11 left-1/2 ml-3 rounded-full border bg-night px-1.5 text-[11px] text-muted tabular-nums"
								aria-hidden="true">{piece.size}</span
							>
						{/if}
						<!-- The name is its own field: change it and leave, and it is renamed. -->
						<input
							class="w-full min-w-0 truncate rounded-md border border-transparent bg-transparent px-1 py-0.5 text-center text-[13px] hover:border-line focus:border-line focus:bg-[#12161e] touch:text-base"
							value={piece.name}
							maxlength={LIMITS.tokenName}
							aria-label="Name of token {i + 1}, {piece.name}"
							onchange={(e) => renameToken(i, e.currentTarget)}
							onkeydown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
						/>
						<button
							class="absolute top-0 right-1 grid size-6.5 cursor-pointer place-items-center rounded-full border bg-night/85 text-base leading-none text-muted opacity-0 transition-opacity group-focus-within:opacity-100 group-hover:opacity-100 hover:text-danger touch:size-9 touch:opacity-100"
							aria-label="Take token {i + 1}, {piece.name}, out of the encounter"
							title="Take it out of the encounter"
							onclick={() => takeOut(i)}>x</button
						>
					</li>
				{/each}
			</ul>
		{/if}
	</section>

	<section class="grid gap-2 border-t pt-3" aria-label="Tokens to add">
		<h3 class="font-sans text-[13px] font-normal text-muted">
			{#if full}
				An encounter holds up to {LIMITS.encounterTokens} tokens, and this one is full.
			{:else}
				Add a token: a plain one, one of your token pictures, or a new picture
			{/if}
		</h3>
		<div class="flex flex-wrap gap-2">
			<!-- The plain disc, in the colour (--c) a token made from it will be. -->
			<button
				class="size-11 cursor-pointer rounded-full border-2 border-[#12151c] bg-(--c) transition-[border-color,scale] duration-120 hover:scale-108 hover:border-accent disabled:cursor-default disabled:opacity-50 disabled:hover:scale-100"
				style:--c={TOKEN_COLORS[0]}
				title="A plain token"
				aria-label="Add a plain token"
				disabled={full}
				onclick={() => add(pieceFrom(null))}
			></button>
			{#each pictures as item (item.id)}
				<button
					class="size-11 cursor-pointer overflow-hidden rounded-full border-2 border-line bg-night transition-[border-color,scale] duration-120 hover:scale-108 hover:border-accent disabled:cursor-default disabled:opacity-50 disabled:hover:scale-100"
					title={item.name}
					aria-label="Add {item.name}"
					disabled={full}
					onclick={() => add(pieceFrom(item))}
				>
					<img
						class="pointer-events-none size-full object-cover"
						src={imageUrl(campaignId, item.file, 'thumb')}
						alt=""
						loading="lazy"
						draggable="false"
					/>
				</button>
			{/each}
			<!-- A picture that isn't in the gallery yet: it goes on the token
			     shelf, and a token of it goes in here. -->
			<button
				class="grid size-11 cursor-pointer place-items-center rounded-full border-2 border-dashed text-muted transition-colors hover:border-accent hover:text-accent disabled:cursor-default disabled:opacity-50"
				title={uploading ? 'Adding…' : 'A new picture. It goes in the gallery too, hidden from players.'}
				aria-label="Add a token with a new picture"
				disabled={full || uploading}
				onclick={() => fileInput?.click()}
			>
				<svg
					width="18"
					height="18"
					viewBox="0 0 24 24"
					fill="none"
					stroke="currentColor"
					stroke-width="2"
					stroke-linecap="round"
					aria-hidden="true"
				>
					<path d="M12 5v14 M5 12h14" />
				</svg>
			</button>
		</div>
		<input
			bind:this={fileInput}
			type="file"
			accept={ACCEPT}
			multiple
			hidden
			onchange={(e) => upload([...(e.currentTarget.files ?? [])])}
		/>
	</section>
{:else}
	<p class="text-[13px] text-muted">
		Tokens made ahead of time, to put down together. Open an encounter to say what is in it. On a
		battle map they are in the dock, under Encounters: drop one on the map and all its tokens go
		down, hidden from your players.
	</p>

	<ul class="grid grid-cols-[repeat(auto-fill,minmax(210px,1fr))] content-start gap-3">
		<!-- The first place on the shelf is the way to add to it. -->
		<li>
			<button
				class="flex h-16 w-full cursor-pointer items-center justify-center gap-2 rounded-lg border-2 border-dashed text-[13px] text-muted transition-colors hover:border-accent hover:text-accent disabled:cursor-default disabled:opacity-60"
				disabled={encounters === null || encounters.length >= LIMITS.encounters}
				onclick={create}
			>
				<svg
					width="20"
					height="20"
					viewBox="0 0 24 24"
					fill="none"
					stroke="currentColor"
					stroke-width="2"
					stroke-linecap="round"
					aria-hidden="true"
				>
					<path d="M12 5v14 M5 12h14" />
				</svg>
				New encounter
			</button>
		</li>

		{#each encounters ?? [] as encounter (encounter.id)}
			<li class="group relative">
				<!-- The first few of its tokens, its name and how many it holds. -->
				<button
					class="flex h-16 w-full cursor-pointer items-center gap-2.5 rounded-lg border-2 border-line bg-night pr-9 pl-2.5 text-left transition-colors hover:border-accent"
					aria-label="Open {encounter.name}: {count(encounter.tokens.length)}"
					onclick={() => edit(encounter)}
				>
					<span class="flex shrink-0 -space-x-4">
						{#each encounter.tokens.slice(0, 3) as piece, i (i)}
							<span
								class="grid size-10 place-items-center overflow-hidden rounded-full border-2 border-[#12151c] bg-(--c)"
								style:--c={piece.image ? 'var(--color-night)' : piece.color}
							>
								{#if piece.image}
									<img
										class="size-full object-cover"
										src={imageUrl(campaignId, piece.image, 'thumb')}
										alt=""
										loading="lazy"
										draggable="false"
									/>
								{/if}
							</span>
						{:else}
							<span class="size-10 rounded-full border-2 border-dashed"></span>
						{/each}
					</span>
					<span class="grid min-w-0">
						<span class="truncate text-sm font-semibold">{encounter.name}</span>
						<span class="text-xs text-muted tabular-nums">
							{encounter.tokens.length ? count(encounter.tokens.length) : 'Empty'}
						</span>
					</span>
				</button>

				{#if removing === encounter.id}
					<div
						class="absolute inset-0 flex items-center justify-center gap-2 rounded-lg bg-night/92 text-[13px]"
					>
						<span>Throw it away?</span>
						<button class="btn btn-sm btn-danger" onclick={() => remove(encounter)}>Yes</button>
						<button class="btn btn-sm" onclick={() => (removing = null)}>No</button>
					</div>
				{:else}
					<button
						class="absolute top-1/2 right-2 grid size-6.5 -translate-y-1/2 cursor-pointer place-items-center rounded-full border bg-night/85 text-base leading-none text-muted opacity-0 transition-opacity group-focus-within:opacity-100 group-hover:opacity-100 hover:text-danger touch:size-9 touch:opacity-100"
						aria-label="Throw {encounter.name} away"
						title="Throw this encounter away"
						onclick={() => (removing = encounter.id)}>x</button
					>
				{/if}
			</li>
		{/each}
	</ul>

	{#if encounters === null}
		<p class="text-sm text-muted">Opening the encounters…</p>
	{:else if encounters.length > 0}
		<p class="text-[13px] text-muted">
			Throwing an encounter away leaves the tokens already put down from it on their maps.
		</p>
	{/if}
{/if}
