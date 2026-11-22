<script lang="ts">
	// Someone at the door, asking for a seat, a new one or the one they sat in
	// before: the GM's to answer. It stays until it is answered, or they give up.

	import type { Knock } from '#lib/shared/types.ts';

	interface Props {
		isGm: boolean;
		/** Everyone asking for a seat right now, the first to ask first. */
		knocks: Knock[];
		answerKnock: (knock: Knock, grant: boolean) => void;
	}

	let { isGm, knocks, answerKnock }: Props = $props();
</script>

{#if isGm && knocks.length}
	<!-- Someone at the door, asking for a seat, a new one or the one
	     they sat in before: the GM's to answer. It stays until it is
	     answered, or they give up. -->
	{@const knock = knocks[0]}
	{@const asks = knock.newcomer
		? 'is asking to join the table'
		: 'is asking for their seat back, from another browser'}
	<div
		class="pointer-events-auto flex max-w-[calc(100%-28px)] flex-wrap items-center justify-center gap-2 rounded-[10px] border border-accent bg-[#3a3018] py-2 pr-2 pl-3.5 text-sm shadow-pop"
		role="alertdialog"
		aria-label="{knock.name} {asks}"
	>
		<span>
			<strong>{knock.name}</strong>
			{asks}.
			{#if knocks.length > 1}
				<span class="text-muted">And {knocks.length - 1} more.</span>
			{/if}
		</span>
		<span class="flex gap-1.5">
			<button class="btn btn-sm btn-primary" onclick={() => answerKnock(knock, true)}>
				Let them in
			</button>
			<button class="btn btn-sm" onclick={() => answerKnock(knock, false)}>
				{knock.newcomer ? 'Not now' : 'Not them'}
			</button>
		</span>
	</div>
{/if}
