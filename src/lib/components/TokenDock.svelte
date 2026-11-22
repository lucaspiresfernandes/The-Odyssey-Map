<script lang="ts">
	// The dock under a battle map, in two levels. At the bottom, one small
	// button for each kind of thing that can be put on the map: tokens, and
	// for the GM, encounters. Click one and its tray slides open on top of
	// it, with everything of that kind in it. Click it again and the tray is
	// put away, and the map has its room back.
	//
	// The tray of tokens starts with a player's own character, once they have
	// one, and then a plain disc. The rest are the campaign's token pictures:
	// all of them for the GM, for a player the ones the GM has revealed and
	// the ones they added themself. Click one and it goes down in the middle
	// of the view. Drag it and it goes down where it is let go. The plus adds
	// pictures to the gallery from here, and they show up in the tray at once.
	//
	// The tray of encounters starts with the party: the character of every
	// player, to put down together, each handed to its player. Then the ones
	// made in the gallery, each several tokens that go down together. One is
	// a pill with the first few of its tokens, its name and how many it
	// holds, clicked or dragged like a token.

	import { fly } from 'svelte/transition';
	import {
		LIMITS,
		imageUrl,
		type Encounter,
		type EncountersResponse,
		type GalleryItem,
		type GalleryResponse,
		type PartyMember,
		type PartyResponse
	} from '#lib/shared/types.ts';
	import { KEY, ariaKey, keyLabel } from '#lib/client/keys.ts';
	import ToolButton from './ToolButton.svelte';

	interface Props {
		campaignId: string;
		gm: boolean;
		/** The colour of the plain disc: the one a token made from it will be. */
		color: string;
		/** Changes whenever the gallery or its encounters may have: the dock reads them again. */
		stamp: number;
		/** No tray is open: the dock is its buttons and nothing more. */
		collapsed: boolean;
		/**
		 * A token is wanted: of this picture, or a plain one for null. `drop` is
		 * where on the screen it was let go, or null for a click.
		 */
		onadd: (item: GalleryItem | null, drop: { x: number; y: number } | null) => void;
		/** An encounter is wanted on the map: dropped there, or clicked. */
		onencounter: (encounter: Encounter, drop: { x: number; y: number } | null) => void;
		/** The GM wants the party on the map: the character of each of these players. */
		onparty: (party: PartyMember[], drop: { x: number; y: number } | null) => void;
		/** A player wants their own character on the map. */
		onmine: (member: PartyMember, drop: { x: number; y: number } | null) => void;
		/** The GM wants to make an encounter or change one: that is done in the gallery. */
		onencounters: () => void;
		/** Something went wrong that the person should hear about. */
		onerror: (text: string) => void;
	}

	let {
		campaignId,
		gm,
		color,
		stamp,
		collapsed = $bindable(),
		onadd,
		onencounter,
		onparty,
		onmine,
		onencounters,
		onerror
	}: Props = $props();

	const ACCEPT = 'image/png,image/jpeg,image/webp,image/gif,image/avif';

	let items = $state<GalleryItem[]>([]);
	/**
	 * The tray that is open, or while the dock is collapsed, the one that was
	 * open last. A player has only the tokens.
	 */
	let tray = $state<'tokens' | 'encounters'>('tokens');
	const open = $derived(collapsed ? null : gm ? tray : 'tokens');

	/** A button of the dock: it opens its tray, or puts it away when it is the one open. */
	function toggle(which: 'tokens' | 'encounters') {
		if (open === which) {
			collapsed = true;
			return;
		}
		tray = which;
		collapsed = false;
		if (which === 'tokens') glance();
		// Who is in the party, and how each looks, changes as tokens do.
		readParty();
	}
	/** The encounters with something in them. A player has none. */
	let encounters = $state.raw<Encounter[]>([]);
	/**
	 * The character of each player who has one, for the GM. For a player,
	 * their own and nobody else's, or none yet.
	 */
	let party = $state.raw<PartyMember[]>([]);
	let uploading = $state(false);
	let fileInput = $state<HTMLInputElement>();
	/** A token or an encounter on its way from the dock to the map, and where the pointer has it. */
	let ghost = $state.raw<{ item: Piece; x: number; y: number } | null>(null);
	let readAt = 0;

	async function read() {
		readAt = Date.now();
		try {
			const response = await fetch(`/c/${campaignId}/gallery`);
			const result = (await response.json()) as GalleryResponse;
			if (result.ok && result.items) items = result.items.filter((item) => item.kind === 'token');
		} catch {
			// The dock keeps what it had. The next look at the gallery tries again.
		}
	}

	$effect(() => {
		void [campaignId, stamp];
		read();
	});

	async function readEncounters() {
		try {
			const response = await fetch(`/c/${campaignId}/encounters`);
			const result = (await response.json()) as EncountersResponse;
			// One with nothing in it yet has nothing to put down.
			if (result.ok && result.items) {
				encounters = result.items.filter((each) => each.tokens.length > 0);
			}
		} catch {
			// The dock keeps what it had.
		}
	}

	$effect(() => {
		void [campaignId, stamp];
		if (gm) readEncounters();
	});

	async function readParty() {
		try {
			const response = await fetch(`/c/${campaignId}/party`);
			const result = (await response.json()) as PartyResponse;
			if (result.ok && result.party) party = result.party;
		} catch {
			// The dock keeps what it had.
		}
	}

	$effect(() => {
		void [campaignId, stamp];
		readParty();
	});

	/**
	 * The pointer has come to the tray: what is in it may be old news. The
	 * table is told when the gallery changes, so this is for a browser that
	 * missed it, and for the party, which changes as tokens do.
	 */
	function glance() {
		if (Date.now() - readAt <= 15000) return;
		read();
		readParty();
	}

	async function upload(files: File[]) {
		if (uploading || files.length === 0) return;
		uploading = true;
		for (const file of files) {
			if (file.size > LIMITS.tokenImageBytes) {
				const most = LIMITS.tokenImageBytes / 1024 / 1024;
				onerror(`Token pictures can be up to ${most} MB. “${file.name}” is bigger.`);
				continue;
			}
			const body = new FormData();
			body.set('kind', 'token');
			body.set('file', file);
			try {
				const response = await fetch(`/c/${campaignId}/gallery`, { method: 'POST', body });
				const result = (await response.json()) as GalleryResponse;
				if (!result.ok || !result.items) throw new Error(result.error);
				items = result.items.filter((item) => item.kind === 'token');
			} catch (err) {
				onerror((err as Error).message || `“${file.name}” couldn't be added.`);
			}
		}
		uploading = false;
		if (fileInput) fileInput.value = '';
	}

	// ------------------------------------------------------------- dragging

	/** The whole party, as one thing to put down. */
	interface Party {
		party: PartyMember[];
	}

	/**
	 * What is taken out of the dock: a token of a picture, a plain one (null),
	 * an encounter, the party, or for a player their own character.
	 */
	type Piece = GalleryItem | Encounter | Party | PartyMember | null;
	const isEncounter = (piece: Piece): piece is Encounter => piece !== null && 'tokens' in piece;
	const isParty = (piece: Piece): piece is Party => piece !== null && 'party' in piece;
	const isMember = (piece: Piece): piece is PartyMember => piece !== null && 'userId' in piece;

	/** It goes on the map, by whichever way is its own. */
	function put(piece: Piece, drop: { x: number; y: number } | null) {
		if (isEncounter(piece)) onencounter(piece, drop);
		else if (isParty(piece)) onparty(piece.party, drop);
		else if (isMember(piece)) onmine(piece, drop);
		else onadd(piece, drop);
	}

	let press: { item: Piece; x: number; y: number; id: number } | null = null;

	function onpointerdown(e: PointerEvent, item: Piece) {
		if (e.pointerType === 'mouse' && e.button !== 0) return;
		press = { item, x: e.clientX, y: e.clientY, id: e.pointerId };
		try {
			(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
		} catch {
			// The pointer is already gone. The drag then ends where it leaves the dock.
		}
	}

	function onpointermove(e: PointerEvent) {
		if (!press || e.pointerId !== press.id) return;
		if (ghost || Math.hypot(e.clientX - press.x, e.clientY - press.y) > 6) {
			ghost = { item: press.item, x: e.clientX, y: e.clientY };
		}
	}

	function onpointerup(e: PointerEvent, completed: boolean) {
		if (!press || e.pointerId !== press.id) return;
		const { item } = press;
		const dragged = ghost !== null;
		press = null;
		ghost = null;
		if (completed) put(item, dragged ? { x: e.clientX, y: e.clientY } : null);
	}

	/** Enter or Space on a token in the dock. A pointer's click was already answered above. */
	function onclick(e: MouseEvent, item: Piece) {
		if (e.detail === 0) put(item, null);
	}

	const count = (n: number) => `${n} ${n === 1 ? 'token' : 'tokens'}`;

	const piece =
		'grid size-11 shrink-0 cursor-grab touch-pan-x place-items-center overflow-hidden rounded-full border-2 transition-[border-color,scale] duration-120 select-none hover:scale-108 hover:border-accent active:cursor-grabbing';
	/** A pill that holds several tokens: an encounter, or the party. */
	const pill =
		'flex h-11 shrink-0 cursor-grab touch-pan-x items-center gap-1.5 rounded-full border-2 bg-night pr-3 pl-1 transition-[border-color] duration-120 select-none hover:border-accent active:cursor-grabbing';
</script>

<!-- The first few tokens of a pill, each overlapping the one before: a
     picture, or a disc in its colour (--c). -->
{#snippet faces(tokens: { image: string | null; color: string }[])}
	<span class="pointer-events-none flex -space-x-3.5">
		{#each tokens.slice(0, 3) as token, i (i)}
			<span
				class="grid size-8 place-items-center overflow-hidden rounded-full border-2 border-[#12151c] bg-(--c)"
				style:--c={token.image ? 'var(--color-night)' : token.color}
			>
				{#if token.image}
					<img
						class="size-full object-cover"
						src={imageUrl(campaignId, token.image, 'thumb')}
						alt=""
						loading="lazy"
						draggable="false"
					/>
				{/if}
			</span>
		{/each}
	</span>
{/snippet}

<div class="pointer-events-none flex w-full flex-col items-center gap-2">
	{#if open}
		<!-- The upper level: everything of the kind picked below, to put on the map. -->
		<!-- svelte-ignore a11y_interactive_supports_focus -->
		<div
			class="pointer-events-auto flex max-w-[calc(100%-120px)] items-center gap-1.5 rounded-xl border bg-panel/94 p-1.5 shadow-pop max-[720px]:max-w-[calc(100%-24px)]"
			role="toolbar"
			aria-label={open === 'encounters' ? 'Encounters to put on the map' : 'Tokens to put on the map'}
			data-tray={open}
			onpointerenter={glance}
			transition:fly={{ y: 14, duration: 140 }}
		>
			{#if open === 'encounters'}
				<div class="flex min-w-0 items-center gap-2 overflow-x-auto px-1 py-0.5 [scrollbar-width:thin]">
					{#if party.length}
						<!-- The party: the character of every player who has one. It goes
						     down in plain sight, so its pill is not dashed like the rest. -->
						<button
							class="{pill} border-accent/60"
							title="The party: the character of each player, handed to them. Players with a token on this map already are left out."
							aria-label="Put down the party: {count(party.length)}, each handed to its player"
							data-party
							onpointerdown={(e) => onpointerdown(e, { party })}
							{onpointermove}
							onpointerup={(e) => onpointerup(e, true)}
							onpointercancel={(e) => onpointerup(e, false)}
							onclick={(e) => onclick(e, { party })}
						>
							{@render faces(party)}
							<span class="pointer-events-none max-w-32 truncate text-xs font-semibold">
								The party
							</span>
							<span class="pointer-events-none text-xs text-muted tabular-nums">{party.length}</span>
						</button>
					{/if}
					{#each encounters as encounter (encounter.id)}
						<!-- An encounter: the first few of its tokens, its name and how many
						     it holds. Dashed, like everything that goes down hidden. -->
						<button
							class="{pill} border-dashed border-line"
							title="{encounter.name}: {count(encounter.tokens.length)}. They go down hidden from the players."
							aria-label="Put down {encounter.name}: {count(encounter.tokens.length)}, hidden from the players"
							data-encounter={encounter.id}
							onpointerdown={(e) => onpointerdown(e, encounter)}
							{onpointermove}
							onpointerup={(e) => onpointerup(e, true)}
							onpointercancel={(e) => onpointerup(e, false)}
							onclick={(e) => onclick(e, encounter)}
						>
							{@render faces(encounter.tokens)}
							<span class="pointer-events-none max-w-32 truncate text-xs font-semibold">
								{encounter.name}
							</span>
							<span class="pointer-events-none text-xs text-muted tabular-nums">
								{encounter.tokens.length}
							</span>
						</button>
					{/each}
					{#if encounters.length === 0 && party.length === 0}
						<span class="px-1.5 text-[13px] whitespace-nowrap text-muted">
							No encounters to put down yet.
						</span>
					{/if}
				</div>

				<span class="w-px self-stretch bg-line"></span>
				<ToolButton
					icon="rename"
					label="Make and change encounters"
					hint="They are put together in the gallery"
					onclick={onencounters}
				/>
			{:else}
				<div class="flex min-w-0 items-center gap-2 overflow-x-auto px-1 py-0.5 [scrollbar-width:thin]">
					{#if !gm && party[0]}
						{@const mine = party[0]}
						<!-- A player's own character comes first, ringed in gold: as its
						     token looks now, on whatever map that is. -->
						<button
							class="{piece} border-accent bg-(--c)"
							style:--c={mine.image ? 'var(--color-night)' : mine.color}
							title="Your character: {mine.name}"
							aria-label="Add your character, {mine.name}"
							data-mine
							onpointerdown={(e) => onpointerdown(e, mine)}
							{onpointermove}
							onpointerup={(e) => onpointerup(e, true)}
							onpointercancel={(e) => onpointerup(e, false)}
							onclick={(e) => onclick(e, mine)}
						>
							{#if mine.image}
								<img
									class="pointer-events-none size-full object-cover"
									src={imageUrl(campaignId, mine.image, 'thumb')}
									alt=""
									draggable="false"
								/>
							{/if}
						</button>
					{/if}
					<!-- The plain disc, in the colour (--c) a token made from it will be. -->
					<button
						class="{piece} border-[#12151c] bg-(--c)"
						style:--c={color}
						title="A plain token ({keyLabel(KEY.plainToken)})"
						aria-label="Add a plain token"
						aria-keyshortcuts={ariaKey(KEY.plainToken)}
						onpointerdown={(e) => onpointerdown(e, null)}
						{onpointermove}
						onpointerup={(e) => onpointerup(e, true)}
						onpointercancel={(e) => onpointerup(e, false)}
						onclick={(e) => onclick(e, null)}
					></button>
					{#each items as item (item.id)}
						<button
							class={[
								piece,
								'bg-night',
								gm && item.hidden ? 'border-dashed border-line' : 'border-line'
							]}
							title={gm && item.hidden ? `${item.name} (players can't pick it)` : item.name}
							aria-label="Add {item.name}"
							onpointerdown={(e) => onpointerdown(e, item)}
							{onpointermove}
							onpointerup={(e) => onpointerup(e, true)}
							onpointercancel={(e) => onpointerup(e, false)}
							onclick={(e) => onclick(e, item)}
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
				</div>

				<span class="w-px self-stretch bg-line"></span>
				<ToolButton
					icon="plus"
					label={uploading ? 'Adding…' : gm ? 'Add token pictures' : 'Add a picture of your own'}
					hint={gm
						? 'They go in the gallery, hidden from players'
						: 'For your own tokens: the table sees it on them'}
					disabled={uploading}
					onclick={() => fileInput?.click()}
				/>
			{/if}
		</div>
	{/if}

	<!-- The lower level: what there is to put on the map. Each button opens
	     its tray above, and the one that is lit puts its tray away again.
	     Their tooltips come out sideways, so they never lie over the tray. -->
	<div
		class="pointer-events-auto flex items-center gap-1.5 rounded-xl border bg-panel/94 p-1.5 shadow-pop"
		role="toolbar"
		aria-label="What to put on the map"
	>
		<ToolButton
			icon="token"
			label="Tokens"
			hint="Put them on the map one at a time"
			tip="left"
			active={open === 'tokens'}
			expanded={open === 'tokens'}
			onclick={() => toggle('tokens')}
		/>
		{#if gm}
			<ToolButton
				icon="encounter"
				label="Encounters"
				hint="Put the party, or a whole group of tokens, down at once"
				tip="right"
				active={open === 'encounters'}
				expanded={open === 'encounters'}
				onclick={() => toggle('encounters')}
			/>
		{/if}
	</div>
</div>

<!-- Outside the tray, so pictures on their way in outlast it being put away. -->
<input
	bind:this={fileInput}
	type="file"
	accept={ACCEPT}
	multiple
	hidden
	onchange={(e) => upload([...(e.currentTarget.files ?? [])])}
/>

{#if ghost}
	{@const carried = ghost.item}
	<!-- What is being carried to the map, under the pointer. -->
	<div
		class="pointer-events-none fixed z-10 size-12 -translate-1/2 overflow-hidden rounded-full border-2 border-accent bg-(--c) opacity-85 shadow-pop"
		style:left="{ghost.x}px"
		style:top="{ghost.y}px"
		style:--c={carried === null
			? color
			: isMember(carried) && !carried.image
				? carried.color
				: 'var(--color-night)'}
	>
		{#if isEncounter(carried) || isParty(carried)}
			<!-- Several on their way: how many tokens are coming. -->
			<span class="grid size-full place-items-center text-sm font-bold text-accent tabular-nums">
				{isEncounter(carried) ? carried.tokens.length : carried.party.length}
			</span>
		{:else if isMember(carried)}
			{#if carried.image}
				<img class="size-full object-cover" src={imageUrl(campaignId, carried.image, 'thumb')} alt="" />
			{/if}
		{:else if carried}
			<img class="size-full object-cover" src={imageUrl(campaignId, carried.file, 'thumb')} alt="" />
		{/if}
	</div>
{/if}
