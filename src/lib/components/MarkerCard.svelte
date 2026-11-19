<script lang="ts">
	import { canEditMarkerKind, canEditWorld, canRemoveMarker } from '#lib/shared/rules.ts';
	import { imageUrl, markerType, type Marker, type Player, type Role } from '#lib/shared/types.ts';
	import MarkerGlyph from './MarkerGlyph.svelte';
	import PlayerPicker from './PlayerPicker.svelte';
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
		/** The players of the campaign, for the GM to choose who a hidden marker is a secret with. */
		players?: Player[];
		/** The GM chose who sees a hidden marker: these players, and nobody else at the table. */
		onshare?: (marker: Marker, seenBy: string[]) => void;
		/** The GM holds the marker's picture up for the whole table to look at. */
		onshow?: (marker: Marker) => void;
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
		onshare,
		onshow
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
	/** The GM is choosing who sees it. */
	let sharing = $state(false);

	// The choosing is for the marker it was started on: it is put away when
	// the card shows another, and stays out while this one changes under it.
	const shownId = $derived(marker.id);
	$effect(() => {
		void shownId;
		sharing = false;
	});
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
				<ToolButton small icon="rename" label="Edit" onclick={() => onedit(marker)} />
				<ToolButton small icon="move" label="Move" onclick={() => onmove(marker)} />
				{#if marker.kind === 'world'}
					<ToolButton
						small
						icon={marker.hidden ? 'reveal' : 'hide'}
						label={marker.hidden ? 'Reveal to all players' : 'Hide from players'}
						active={marker.hidden}
						onclick={() => onhide(marker, !marker.hidden)}
					/>
					{#if onshare}
						<ToolButton
							small
							icon="people"
							label="Show to some players only"
							hint="A secret between them and you"
							active={marker.seenBy.length > 0}
							expanded={sharing}
							onclick={() => (sharing = !sharing)}
						/>
					{/if}
				{/if}
				{#if picture && onshow}
					<ToolButton
						small
						icon="show"
						label="Show the picture to the table"
						hint="Full screen, on every screen"
						onclick={() => onshow(marker)}
					/>
				{/if}
				{#if removable}
					<ToolButton small danger icon="delete" label="Delete" onclick={() => ondelete(marker)} />
				{/if}
			</footer>
			{#if sharing && onshare}
				<!-- Who a hidden marker is shown to all the same. Choosing someone
				     hides it from the rest. -->
				<div class="mt-1 grid gap-1.5 border-t pt-2">
					<span class="text-xs text-muted">Only these players see it:</span>
					<PlayerPicker
						{players}
						value={marker.seenBy}
						label="Players who see this marker"
						onchange={(ids) => onshare(marker, ids)}
					/>
				</div>
			{/if}
		{:else}
			<p class="text-xs text-muted">Click the marker to edit</p>
		{/if}
	{/if}
</article>
