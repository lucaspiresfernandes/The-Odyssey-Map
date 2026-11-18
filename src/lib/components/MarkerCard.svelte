<script lang="ts">
	import { canEditMarkerKind, canRemoveMarker } from '#lib/shared/rules.ts';
	import { markerType, type Marker, type Role } from '#lib/shared/types.ts';
	import MarkerGlyph from './MarkerGlyph.svelte';

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

<article class="card" class:pinned>
	<header>
		<span class="chip" style:--c={type.color}>
			<MarkerGlyph type={marker.type} size={13} />
			{type.label}
		</span>
		<span class="kind">{marker.kind === 'world' ? 'World' : 'Table note'}</span>
		{#if pinned}
			<button class="close" aria-label="Close" onclick={onclose}>×</button>
		{/if}
	</header>

	<h3>{marker.title}</h3>
	{#if marker.description}<p class="body">{marker.description}</p>{/if}

	{#if marker.hidden}<p class="secret">Hidden from players</p>{/if}
	{#if marker.kind === 'player'}
		<p class="by">Added by {marker.authorId === userId ? 'you' : marker.authorName}</p>
	{/if}

	{#if editable}
		{#if pinned}
			<footer>
				<button class="btn small" onclick={() => onedit(marker)}>Edit</button>
				<button class="btn small" onclick={() => onmove(marker)}>Move</button>
				{#if marker.kind === 'world'}
					<button class="btn small" onclick={() => onhide(marker, !marker.hidden)}>
						{marker.hidden ? 'Reveal' : 'Hide'}
					</button>
				{/if}
				{#if removable}
					<button class="btn small danger" onclick={() => ondelete(marker)}>Delete</button>
				{/if}
			</footer>
		{:else}
			<p class="by">Click the marker to edit</p>
		{/if}
	{/if}
</article>

<style>
	.card {
		width: max-content;
		min-width: 200px;
		max-width: min(320px, calc(100vw - 32px));
		padding: 12px 14px;
		display: grid;
		gap: 6px;
		background: #171b24f2;
		border: 1px solid var(--line);
		border-radius: 12px;
		box-shadow: var(--shadow);
		backdrop-filter: blur(6px);
	}

	.card.pinned {
		border-color: #55607a;
	}

	header {
		display: flex;
		align-items: center;
		gap: 8px;
		font-size: 12px;
	}

	.chip {
		display: inline-flex;
		align-items: center;
		gap: 4px;
		padding: 2px 8px 2px 6px;
		border-radius: 999px;
		background: color-mix(in srgb, var(--c) 22%, transparent);
		color: color-mix(in srgb, var(--c) 75%, white);
		font-weight: 600;
	}

	.kind {
		color: var(--muted);
	}

	.close {
		margin: -6px -8px -6px auto;
		width: 28px;
		height: 28px;
		border: 0;
		border-radius: 6px;
		background: none;
		color: var(--muted);
		font-size: 20px;
		line-height: 1;
		cursor: pointer;
	}

	.close:hover {
		background: var(--panel-2);
		color: var(--text);
	}

	h3 {
		font-size: 18px;
		overflow-wrap: anywhere;
	}

	.body {
		white-space: pre-wrap;
		overflow-wrap: anywhere;
		max-height: 40vh;
		overflow-y: auto;
		color: #d3cfc4;
	}

	.by,
	.secret {
		font-size: 12px;
		color: var(--muted);
	}

	.secret {
		color: #e8b85a;
	}

	footer {
		display: flex;
		flex-wrap: wrap;
		gap: 6px;
		margin-top: 6px;
	}
</style>
