<script lang="ts">
	// The one line of news that floats over the bottom of a map, in the
	// colours of its kind: what was done, with a button to undo it where
	// there is something to undo.

	import type { Notice, NoticeType } from '#lib/client/notices.svelte.ts';
	import type { Step } from '#lib/client/undo.ts';

	interface Props {
		notice: Notice | null;
		/** Takes back what the notice is about. */
		onundo: (step: Step) => void;
		ondismiss: () => void;
	}

	let { notice, onundo, ondismiss }: Props = $props();

	/** The border and background of a notice of each type. */
	const NOTICE_COLORS: Record<NoticeType, string> = {
		success: 'border-[#3f7d58] bg-[#1e3329]',
		failure: 'border-[#9a4a44] bg-[#3b2224]',
		info: 'border-[#4a5670] bg-[#2a3142]',
		warning: 'border-[#96721f] bg-[#3a3018]'
	};
</script>

{#if notice}
	<div
		class={[
			'pointer-events-auto flex max-w-[calc(100%-28px)] items-center gap-2 rounded-[10px] border py-2 pr-2 pl-3.5 text-sm shadow-pop',
			NOTICE_COLORS[notice.type]
		]}
		role="status"
	>
		<span>{notice.text}</span>
		{#if notice.undo}
			{@const step = notice.undo}
			<button class="btn btn-sm" onclick={() => onundo(step)}>Undo</button>
		{/if}
		<button class="btn btn-sm btn-ghost" aria-label="Dismiss" onclick={ondismiss}>×</button>
	</div>
{/if}
