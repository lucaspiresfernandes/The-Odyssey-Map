<script lang="ts">
	// Someone's face, the GM's or a player's, in a disc: drawn out of their
	// user id (see routes/avatars), so it is the same face wherever they show
	// and whatever they are called. The GM's disc is gold, the players' slate.
	// Their initials sit under the face, and show if it can't be loaded.

	interface Props {
		id: string;
		name: string;
		gm?: boolean;
		/** Size, border and the like, in Tailwind classes. */
		class?: string;
	}

	let { id, name, gm = false, class: classes = 'size-6.5' }: Props = $props();

	const initials = $derived(
		name
			.split(/\s+/)
			.slice(0, 2)
			.map((word) => word[0]?.toUpperCase() ?? '')
			.join('')
	);
</script>

<span
	class={[
		'relative grid shrink-0 place-items-center overflow-hidden rounded-full text-[11px] font-semibold',
		gm ? 'bg-accent text-accent-ink' : 'bg-[#3a465c]',
		classes
	]}
	aria-hidden="true"
>
	{initials}
	<img
		class="absolute inset-0 size-full"
		src="/avatars/{id}.svg"
		alt=""
		draggable="false"
		onerror={(e) => e.currentTarget.remove()}
	/>
</span>
