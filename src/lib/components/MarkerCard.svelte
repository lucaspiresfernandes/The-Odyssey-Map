<script lang="ts">
	import { KEY } from '#lib/client/keys.ts';
	import { canEditMarkerKind, canEditWorld, canRemoveMarker } from '#lib/shared/rules.ts';
	import { imageUrl, markerType, type Marker, type Player, type Role } from '#lib/shared/types.ts';
	import MarkerGlyph from './MarkerGlyph.svelte';
	import ToolButton from './ToolButton.svelte';

	interface Props {
		marker: Marker;
		/** The campaign the marker is in: where its picture is loaded from. */
		campaignId: string;
		role: Role;
		/** Who is looking. A table note offers Delete to its author and to the GM. */
		userId: string;
		/** A pinned card stays open and offers actions. A hover card only informs. */
		pinned: boolean;
		onclose: () => void;
		onedit: (marker: Marker) => void;
		onmove: (marker: Marker) => void;
		ondelete: (marker: Marker) => void;
		onhide: (marker: Marker, hidden: boolean) => void;
		/** The players of the campaign, for the GM to read who a hidden marker is a secret with. */
		players?: Player[];
		/** The GM is to say who sees the marker. */
		onvisibility?: (marker: Marker) => void;
	}

	let {
		marker,
		campaignId,
		role,
		userId,
		pinned,
		onclose,
		onedit,
		onmove,
		ondelete,
		onhide,
		players = [],
		onvisibility
	}: Props = $props();

	/** The picture couldn't be loaded: the card does without it. */
	let broken = $state<string | null>(null);
	const picture = $derived(marker.image && marker.image !== broken ? marker.image : null);

	const type = $derived(markerType(marker.type));
	const gm = $derived(canEditWorld(role));
	const editable = $derived(canEditMarkerKind(role, marker.kind));
	const removable = $derived(canRemoveMarker(role, userId, marker));
	/** The players this marker is a secret with, by name. */
	const inOnIt = $derived(
		players.filter((player) => marker.seenBy.includes(player.id)).map((player) => player.name)
	);
	/** Who sees it, for the tooltip of the button that changes it. */
	const seen = $derived(
		!marker.hidden
			? 'Everyone sees it'
			: inOnIt.length
				? `Only you and ${inOnIt.join(', ')} see it`
				: 'Only you see it'
	);

	/**
	 * A key was pressed with this card pinned: it does what the button it
	 * belongs to does. True if it was one of the card's. `held` says the key
	 * is being held down: it is done once, not over and over.
	 */
	export function key(pressed: string, held = false): boolean {
		const mine = keyed(pressed);
		if (!mine) return false;
		if (!held) mine();
		return true;
	}

	/** What a key does to the marker, or nothing if it is no key of the card's. */
	function keyed(pressed: string): (() => void) | null {
		if (!pinned || !editable) return null;
		const world = marker.kind === 'world';
		if (pressed === KEY.rename || pressed === KEY.renameToo) return () => onedit(marker);
		if (pressed === KEY.move) return () => onmove(marker);
		// The quick way, with no button of its own: hidden from everyone, or back.
		if (pressed === KEY.hide && world) return () => onhide(marker, !marker.hidden);
		if (pressed === KEY.share && world && onvisibility) return () => onvisibility(marker);
		if ((pressed === KEY.remove || pressed === 'Backspace') && removable) {
			return () => ondelete(marker);
		}
		return null;
	}
</script>

<article
	class={[
		'grid gap-1.5 rounded-xl border bg-[#171b24f2] px-3.5 py-3 shadow-pop backdrop-blur-[6px]',
		// A card with a picture is as wide as the picture's place on it.
		picture
			? 'w-[min(300px,calc(100vw-32px))]'
			: 'w-max max-w-[min(320px,calc(100vw-32px))] min-w-[200px]',
		pinned && 'border-[#55607a]'
	]}
>
	{#if picture}
		<!-- Its picture, whole, in a place of one size: the card is as tall
		     before it has loaded as after. -->
		<img
			class="mb-1 h-44 w-full rounded-lg bg-night object-contain"
			src={imageUrl(campaignId, picture, 'thumb')}
			alt=""
			draggable="false"
			onerror={() => (broken = picture)}
		/>
	{/if}
	<header class="flex items-center gap-2 text-xs">
		<!-- The chip takes the colour of the marker's type, which arrives as --c. -->
		<span
			class="inline-flex items-center gap-1 rounded-full bg-(--c)/22 py-0.5 pr-2 pl-1.5 font-semibold text-[color-mix(in_srgb,var(--c)_75%,white)]"
			style:--c={type.color}
		>
			<MarkerGlyph type={marker.type} size={13} />
			{type.label}
		</span>
		<span class="text-muted">{marker.kind === 'world' ? 'World' : 'Table note'}</span>
		{#if pinned}
			<button
				class="-my-1.5 -mr-2 ml-auto size-7 cursor-pointer touch:-my-2.5 touch:size-9 rounded-md text-xl leading-none text-muted hover:bg-panel-2 hover:text-cream"
				aria-label="Close"
				onclick={onclose}>×</button
			>
		{/if}
	</header>

	<h3 class="text-lg/tight wrap-anywhere">{marker.title}</h3>
	{#if marker.description}
		<p class="max-h-[40vh] overflow-y-auto wrap-anywhere whitespace-pre-wrap text-[#d3cfc4]">
			{marker.description}
		</p>
	{/if}

	{#if marker.hidden}
		<p class="text-xs text-[#e8b85a]">
			{#if !gm}
				A secret: not everyone at the table sees this
			{:else if inOnIt.length}
				A secret with {inOnIt.join(', ')}
			{:else}
				Hidden from players
			{/if}
		</p>
	{/if}
	{#if marker.kind === 'player'}
		<p class="text-xs text-muted">
			Added by {marker.authorId === userId ? 'you' : marker.authorName}
		</p>
	{/if}

	{#if editable}
		{#if pinned}
			<!-- Icons, each with a tooltip that names it, like the tools under the map. -->
			<footer class="mt-1.5 flex flex-wrap gap-1">
				<ToolButton
					small
					icon="rename"
					label="Edit"
					shortcut={KEY.rename}
					onclick={() => onedit(marker)}
				/>
				<ToolButton
					small
					icon="move"
					label="Move"
					shortcut={KEY.move}
					onclick={() => onmove(marker)}
				/>
				{#if marker.kind === 'world' && onvisibility}
					<ToolButton
						small
						icon={marker.hidden ? 'hide' : 'reveal'}
						label="Visibility"
						hint={seen}
						shortcut={KEY.share}
						active={marker.hidden}
						onclick={() => onvisibility(marker)}
					/>
				{/if}
				{#if removable}
					<ToolButton
						small
						danger
						icon="delete"
						label="Delete"
						shortcut={KEY.remove}
						onclick={() => ondelete(marker)}
					/>
				{/if}
			</footer>
		{:else}
			<p class="text-xs text-muted">Click the marker to edit</p>
		{/if}
	{/if}
</article>
