<script lang="ts">
	// The dock under a battle map: every token that can be put on it. The
	// first is a plain disc. The rest are the campaign's token pictures: all
	// of them for the GM, the ones the GM has revealed for a player.
	//
	// Click one and it goes down in the middle of the view. Drag it and it
	// goes down where it is let go. The GM's plus adds pictures to the
	// gallery from here, and they show up in the dock at once.
	//
	// The GM's dock also holds the groups they saved: several tokens that go
	// down together, hidden, as they stood when they were saved. Each is a
	// pill between the plain disc and the pictures, clicked or dragged like a
	// token, with a cross to throw it away.

	import {
		LIMITS,
		imageUrl,
		type GalleryItem,
		type GalleryResponse,
		type GroupsResponse,
		type TokenGroup
	} from '#lib/shared/types.ts';
	import { KEY, ariaKey, keyLabel } from '#lib/client/keys.ts';
	import ToolButton from './ToolButton.svelte';

	interface Props {
		campaignId: string;
		gm: boolean;
		/** The colour of the plain disc: the one a token made from it will be. */
		color: string;
		/** Changes whenever the gallery may have: the dock reads it again. */
		stamp: number;
		/** Changes whenever the saved groups may have: the GM's dock reads them again. */
		groupStamp: number;
		collapsed: boolean;
		/**
		 * A token is wanted: of this picture, or a plain one for null. `drop` is
		 * where on the screen it was let go, or null for a click.
		 */
		onadd: (item: GalleryItem | null, drop: { x: number; y: number } | null) => void;
		/** A saved group is wanted on the map: dropped there, or clicked. */
		ongroup: (group: TokenGroup, drop: { x: number; y: number } | null) => void;
		/** Something went wrong that the person should hear about. */
		onerror: (text: string) => void;
	}

	let {
		campaignId,
		gm,
		color,
		stamp,
		groupStamp,
		collapsed = $bindable(),
		onadd,
		ongroup,
		onerror
	}: Props = $props();

	const ACCEPT = 'image/png,image/jpeg,image/webp,image/gif,image/avif';

	let items = $state<GalleryItem[]>([]);
	/** The groups the GM saved. A player has none. */
	let groups = $state.raw<TokenGroup[]>([]);
	/** The group the GM has pressed the cross of, by id: it asks before it goes. */
	let discarding = $state<string | null>(null);
	let uploading = $state(false);
	let fileInput = $state<HTMLInputElement>();
	/** A token or a group on its way from the dock to the map, and where the pointer has it. */
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

	async function readGroups() {
		try {
			const response = await fetch(`/c/${campaignId}/groups`);
			const result = (await response.json()) as GroupsResponse;
			if (result.ok && result.items) groups = result.items;
		} catch {
			// The dock keeps what it had.
		}
	}

	$effect(() => {
		void [campaignId, groupStamp];
		if (gm) readGroups();
	});

	/** Throws a saved group away, once the GM has said they mean it. */
	async function discard(group: TokenGroup) {
		discarding = null;
		try {
			const response = await fetch(`/c/${campaignId}/groups`, {
				method: 'DELETE',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ id: group.id })
			});
			const result = (await response.json()) as GroupsResponse;
			if (!result.ok || !result.items) throw new Error(result.error);
			groups = result.items;
		} catch (err) {
			onerror((err as Error).message || `“${group.name}” couldn't be thrown away.`);
		}
	}

	/** A player isn't told when the GM reveals a picture, so reaching for the dock looks again. */
	function glance() {
		if (Date.now() - readAt > 15000) read();
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

	/** What is taken out of the dock: a token of a picture, a plain one (null), or a saved group. */
	type Piece = GalleryItem | TokenGroup | null;
	const isGroup = (piece: Piece): piece is TokenGroup => piece !== null && 'tokens' in piece;

	/** It goes on the map: a group through `ongroup`, a token through `onadd`. */
	function put(piece: Piece, drop: { x: number; y: number } | null) {
		if (isGroup(piece)) ongroup(piece, drop);
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

	const piece =
		'grid size-11 shrink-0 cursor-grab touch-pan-x place-items-center overflow-hidden rounded-full border-2 transition-[border-color,scale] duration-120 select-none hover:scale-108 hover:border-accent active:cursor-grabbing';
</script>

{#if collapsed}
	<button
		class="btn btn-sm pointer-events-auto rounded-full bg-panel/94 pr-1.5 shadow-pop"
		aria-expanded="false"
		onclick={() => (collapsed = false)}
	>
		Tokens
		<svg width="15" height="15" viewBox="0 0 24 24" aria-hidden="true">
			<path d="M6 15l6-6 6 6" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" />
		</svg>
	</button>
{:else}
	<!-- svelte-ignore a11y_interactive_supports_focus -->
	<div
		class="pointer-events-auto flex max-w-[calc(100%-120px)] items-center gap-1.5 rounded-xl border bg-panel/94 p-1.5 shadow-pop max-[720px]:max-w-[calc(100%-24px)]"
		role="toolbar"
		aria-label="Tokens to put on the map"
		onpointerenter={glance}
	>
		<ToolButton icon="down" label="Fold the tokens away" onclick={() => (collapsed = true)} />
		<span class="w-px self-stretch bg-line"></span>

		<div class="flex min-w-0 items-center gap-2 overflow-x-auto px-1 py-0.5 [scrollbar-width:thin]">
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
			{#each groups as group (group.id)}
				{#if discarding === group.id}
					<!-- Thrown away, a group is gone for good: it asks first. -->
					<span
						class="flex h-11 shrink-0 items-center gap-1.5 rounded-full border-2 border-danger bg-night pr-1.5 pl-3 text-xs"
						role="group"
						aria-label="Throw {group.name} away?"
					>
						<span class="max-w-40 truncate">Throw “{group.name}” away?</span>
						<button class="btn btn-sm btn-danger" onclick={() => discard(group)}>Yes</button>
						<button class="btn btn-sm" onclick={() => (discarding = null)}>No</button>
					</span>
				{:else}
					<!-- A saved group: the first few of its tokens, its name and how
					     many it holds. Dashed, like everything that goes down hidden. -->
					<span class="relative flex shrink-0" data-group={group.id}>
						<button
							class="flex h-11 cursor-grab touch-pan-x items-center gap-1.5 rounded-full border-2 border-dashed border-line bg-night pr-7 pl-1 transition-[border-color] duration-120 select-none hover:border-accent active:cursor-grabbing"
							title="{group.name}: {group.tokens.length} {group.tokens.length === 1
								? 'token'
								: 'tokens'}. They go down hidden from the players."
							aria-label="Put down {group.name}: {group.tokens.length} {group.tokens.length === 1
								? 'token'
								: 'tokens'}, hidden from the players"
							onpointerdown={(e) => onpointerdown(e, group)}
							{onpointermove}
							onpointerup={(e) => onpointerup(e, true)}
							onpointercancel={(e) => onpointerup(e, false)}
							onclick={(e) => onclick(e, group)}
						>
							<span class="pointer-events-none flex -space-x-3.5">
								{#each group.tokens.slice(0, 3) as token, i (i)}
									<span
										class="grid size-8 place-items-center overflow-hidden rounded-full border-2 border-[#12151c] bg-(--c)"
										style:--c={token.color}
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
							<span class="pointer-events-none max-w-28 truncate text-xs font-semibold">{group.name}</span>
							<span class="pointer-events-none text-xs text-muted tabular-nums">{group.tokens.length}</span>
						</button>
						<button
							class="absolute top-1/2 right-1.5 grid size-5 -translate-y-1/2 cursor-pointer place-items-center rounded-full text-muted hover:bg-panel-2 hover:text-danger"
							title="Throw this group away"
							aria-label="Throw {group.name} away"
							onclick={() => (discarding = group.id)}
						>
							<svg width="11" height="11" viewBox="0 0 24 24" aria-hidden="true">
								<path
									d="M6 6l12 12M18 6 6 18"
									fill="none"
									stroke="currentColor"
									stroke-width="3"
									stroke-linecap="round"
								/>
							</svg>
						</button>
					</span>
				{/if}
			{/each}
			{#if groups.length}<span class="w-px shrink-0 self-stretch bg-line"></span>{/if}
			{#each items as item (item.id)}
				<button
					class={[piece, 'bg-night', item.hidden ? 'border-dashed border-line' : 'border-line']}
					title={item.hidden ? `${item.name} (players can't pick it)` : item.name}
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

		{#if gm}
			<span class="w-px self-stretch bg-line"></span>
			<ToolButton
				icon="plus"
				label={uploading ? 'Adding…' : 'Add token pictures'}
				hint="They go in the gallery, hidden from players"
				disabled={uploading}
				onclick={() => fileInput?.click()}
			/>
			<input
				bind:this={fileInput}
				type="file"
				accept={ACCEPT}
				multiple
				hidden
				onchange={(e) => upload([...(e.currentTarget.files ?? [])])}
			/>
		{/if}
	</div>
{/if}

{#if ghost}
	<!-- What is being carried to the map, under the pointer. -->
	<div
		class="pointer-events-none fixed z-10 size-12 -translate-1/2 overflow-hidden rounded-full border-2 border-accent bg-(--c) opacity-85 shadow-pop"
		style:left="{ghost.x}px"
		style:top="{ghost.y}px"
		style:--c={ghost.item ? 'var(--color-night)' : color}
	>
		{#if isGroup(ghost.item)}
			<!-- A group on its way: how many tokens are coming. -->
			<span class="grid size-full place-items-center text-sm font-bold text-accent tabular-nums">
				{ghost.item.tokens.length}
			</span>
		{:else if ghost.item}
			<img
				class="size-full object-cover"
				src={imageUrl(campaignId, ghost.item.file, 'thumb')}
				alt=""
			/>
		{/if}
	</div>
{/if}
