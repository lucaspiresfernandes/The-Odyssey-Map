<script lang="ts">
	import { canEditWorld, canMoveToken } from '#lib/shared/rules.ts';
	import { imageUrl, type Role, type Token } from '#lib/shared/types.ts';

	interface Props {
		token: Token;
		campaignId: string;
		role: Role;
		/** Who is looking. A token offers its actions to whoever moves it. */
		userId: string;
		onclose: () => void;
		onedit: (token: Token) => void;
		ondelete: (token: Token) => void;
		onhide: (token: Token, hidden: boolean) => void;
	}

	let { token, campaignId, role, userId, onclose, onedit, ondelete, onhide }: Props = $props();

	const movable = $derived(canMoveToken(role, userId, token));
	const whose = $derived(
		token.ownerId === userId
			? 'Your token'
			: token.ownerName
				? `${token.ownerName}'s token`
				: "The GM's token"
	);
</script>

<!-- Shown for the token that was clicked: whose it is, and what can be done with it. -->
<article
	class="grid w-max max-w-[min(280px,calc(100vw-32px))] min-w-[180px] gap-1.5 rounded-xl border border-[#55607a] bg-[#171b24f2] px-3.5 py-3 shadow-pop backdrop-blur-[6px]"
>
	<header class="flex items-center gap-2">
		{#if token.image}
			<!-- Its picture, ringed in the token's own colour, which arrives as --c. -->
			<img
				class="size-9 shrink-0 rounded-full border-2 border-(--c) object-cover"
				style:--c={token.color}
				src={imageUrl(campaignId, token.image)}
				alt=""
			/>
		{:else}
			<!-- A dot in the token's own colour, which arrives as --c. -->
			<span class="size-3 shrink-0 rounded-full bg-(--c)" style:--c={token.color}></span>
		{/if}
		<h3 class="text-lg/tight wrap-anywhere">{token.name}</h3>
		<button
			class="-my-1.5 -mr-2 ml-auto size-7 shrink-0 cursor-pointer rounded-md text-xl leading-none text-muted hover:bg-panel-2 hover:text-cream touch:-my-2.5 touch:size-9"
			aria-label="Close"
			onclick={onclose}>×</button
		>
	</header>

	<p class="text-xs text-muted">
		{whose}{#if movable}<span class="touch:hidden">{' · drag it to move'}</span>{/if}
	</p>
	{#if token.hidden}<p class="text-xs text-[#e8b85a]">Hidden from players</p>{/if}

	{#if movable}
		<footer class="mt-1.5 flex flex-wrap gap-1.5">
			<button class="btn btn-sm" onclick={() => onedit(token)}>Edit</button>
			{#if canEditWorld(role)}
				<button class="btn btn-sm" onclick={() => onhide(token, !token.hidden)}>
					{token.hidden ? 'Reveal' : 'Hide'}
				</button>
			{/if}
			<button class="btn btn-sm btn-danger" onclick={() => ondelete(token)}>Delete</button>
		</footer>
	{/if}
</article>
