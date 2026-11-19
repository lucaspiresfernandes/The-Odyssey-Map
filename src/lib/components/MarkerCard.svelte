<script lang="ts">
	import { canEditMarkerKind, canRemoveMarker } from '#lib/shared/rules.ts';
	import { markerType, type Marker, type Role } from '#lib/shared/types.ts';
	import MarkerGlyph from './MarkerGlyph.svelte';
	import ToolButton from './ToolButton.svelte';

	interface Props {
		marker: Marker;
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
	}

	let { marker, role, userId, pinned, onclose, onedit, onmove, ondelete, onhide }: Props =
		$props();

	const type = $derived(markerType(marker.type));
	const editable = $derived(canEditMarkerKind(role, marker.kind));
	const removable = $derived(canRemoveMarker(role, userId, marker));
</script>

<article
	class={[
		'grid w-max max-w-[min(320px,calc(100vw-32px))] min-w-[200px] gap-1.5 rounded-xl border bg-[#171b24f2] px-3.5 py-3 shadow-pop backdrop-blur-[6px]',
		pinned && 'border-[#55607a]'
	]}
>
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

	{#if marker.hidden}<p class="text-xs text-[#e8b85a]">Hidden from players</p>{/if}
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
						label={marker.hidden ? 'Reveal to players' : 'Hide from players'}
						active={marker.hidden}
						onclick={() => onhide(marker, !marker.hidden)}
					/>
				{/if}
				{#if removable}
					<ToolButton small danger icon="delete" label="Delete" onclick={() => ondelete(marker)} />
				{/if}
			</footer>
		{:else}
			<p class="text-xs text-muted">Click the marker to edit</p>
		{/if}
	{/if}
</article>
