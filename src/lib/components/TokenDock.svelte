<script lang="ts">
	// The dock under a battle map: every token that can be put on it. The
	// first is a plain disc. The rest are the campaign's token pictures: all
	// of them for the GM, the ones the GM has revealed for a player.
	//
	// Click one and it goes down in the middle of the view. Drag it and it
	// goes down where it is let go. The GM's plus adds pictures to the
	// gallery from here, and they show up in the dock at once.

	import { LIMITS, imageUrl, type GalleryItem, type GalleryResponse } from '#lib/shared/types.ts';
	import { KEY, ariaKey, keyLabel } from '#lib/client/keys.ts';
	import ToolButton from './ToolButton.svelte';

	interface Props {
		campaignId: string;
		gm: boolean;
		/** The colour of the plain disc: the one a token made from it will be. */
		color: string;
		/** Changes whenever the gallery may have: the dock reads it again. */
		stamp: number;
		collapsed: boolean;
		/**
		 * A token is wanted: of this picture, or a plain one for null. `drop` is
		 * where on the screen it was let go, or null for a click.
		 */
		onadd: (item: GalleryItem | null, drop: { x: number; y: number } | null) => void;
		/** Something went wrong that the person should hear about. */
		onerror: (text: string) => void;
	}

	let { campaignId, gm, color, stamp, collapsed = $bindable(), onadd, onerror }: Props = $props();

	const ACCEPT = 'image/png,image/jpeg,image/webp,image/gif,image/avif';

	let items = $state<GalleryItem[]>([]);
	let uploading = $state(false);
	let fileInput = $state<HTMLInputElement>();
	/** A token on its way from the dock to the map, and where the pointer has it. */
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

	/** What is taken out of the dock: a token of a picture, or a plain one (null). */
	type Piece = GalleryItem | null;

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
		if (completed) onadd(item, dragged ? { x: e.clientX, y: e.clientY } : null);
	}

	/** Enter or Space on a token in the dock. A pointer's click was already answered above. */
	function onclick(e: MouseEvent, item: Piece) {
		if (e.detail === 0) onadd(item, null);
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
		{#if ghost.item}
			<img
				class="size-full object-cover"
				src={imageUrl(campaignId, ghost.item.file, 'thumb')}
				alt=""
			/>
		{/if}
	</div>
{/if}
