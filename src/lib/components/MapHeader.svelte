<script lang="ts">
	// The bar over a map: the menu, the trail of maps on the way here, the
	// way into the regions of this one, and what the GM opens from the top.
	// A table display has none of it.

	import { KEY, ariaKey, keyLabel } from '#lib/client/keys.ts';
	import type { Crumb, Region } from '#lib/shared/types.ts';
	import Menu from './Menu.svelte';
	import ToolButton from './ToolButton.svelte';

	interface Props {
		display: boolean;
		isGm: boolean;
		/** The maps on the way here, the first map of the campaign first. */
		trail: Crumb[];
		regions: Region[];
		mapId: string;
		/** The address of a map of this campaign. */
		mapUrl: (mapId: string) => string;
		/** Steps into a region. */
		enter: (region: Region) => void;
		/** The live connection is down. */
		offline: boolean;
		onsettings: () => void;
		onseats: () => void;
		onexit: () => void;
		onfind: () => void;
		onhelp: () => void;
		ongallery: () => void;
		oninvite: () => void;
	}

	let {
		display,
		isGm,
		trail,
		regions,
		mapId,
		mapUrl,
		enter,
		offline,
		onsettings,
		onseats,
		onexit,
		onfind,
		onhelp,
		ongallery,
		oninvite
	}: Props = $props();

	const crumbLink = 'text-muted no-underline hover:text-accent touch:py-2';
</script>

<header
	hidden={display}
	class="flex min-h-12 items-center gap-3 border-b bg-panel px-3 py-1.5 max-[720px]:flex-wrap"
>
	<!-- The menu and the trail of maps keep to one row, on a narrow screen too. -->
	<div class="flex min-w-0 items-center gap-3">
		<!-- The menu of the bar: what there is to set about the map itself, for
		     the GM, and the way out of the campaign, for everyone. It stands
		     outside the trail of maps, which scrolls sideways and would cut off
		     what hangs under it. -->
		<Menu
			label="Menu"
			items={[
				...(isGm
					? [
							{ label: 'Map Settings', shortcut: KEY.settings, onclick: onsettings },
							{ label: 'Seats', shortcut: KEY.seats, onclick: onseats }
						]
					: []),
				{ label: 'Exit', shortcut: KEY.exit, onclick: onexit }
			]}
		/>
		<nav
			class="flex min-w-0 items-center gap-2 overflow-x-auto font-serif text-[17px] whitespace-nowrap scrollbar-none"
			aria-label="Breadcrumb"
		>
			{#each trail as crumb, i (crumb.id)}
				{#if i > 0}<span class="text-[#5c667a]" aria-hidden="true">›</span>{/if}
				{#if i < trail.length - 1}
					<a class={crumbLink} href={mapUrl(crumb.id)}>{crumb.name}</a>
				{:else}
					<span class="font-semibold" aria-current="page">{crumb.name}</span>
				{/if}
			{/each}
			{#if regions.length}
				<!-- The same doorways as on the map, for keyboards and screen readers. -->
				<select
					class="ml-1.5 cursor-pointer rounded-lg border bg-panel-2 px-1.5 py-0.75 font-sans text-[13px] text-muted touch:min-h-9 touch:min-w-28 touch:text-base"
					aria-label="Step into a region of this map"
					onchange={(e) => {
						const region = regions.find((r) => r.id === e.currentTarget.value);
						e.currentTarget.value = '';
						if (region) enter(region);
					}}
				>
					<option value="">Step into…</option>
					{#each regions as region (region.id)}
						{#if isGm || !region.closed}
							<option value={region.id}>
								{region.name}{region.hidden ? (isGm ? ' (hidden)' : ' (a secret)') : ''}{region.closed
									? ' (closed)'
									: ''}
							</option>
						{/if}
					{/each}
				</select>
			{/if}
		</nav>
	</div>

	<!-- ml-auto keeps these on the right when a narrow screen wraps them onto a row of their own. -->
	<div class="ml-auto flex shrink-0 items-center gap-2">
		{#if offline}
			<span class="text-xs text-[#e8b85a]" role="status">Reconnecting…</span>
		{/if}
		<!-- Nothing of the finder is on screen but this, until it is asked for. -->
		<ToolButton
			small
			tip="bottom-end"
			icon="search"
			label="Find a place or a marker"
			shortcut={KEY.find}
			onclick={onfind}
		/>
		<!-- What every key does. Only where there are keys to press. -->
		<span class="flex touch:hidden">
			<ToolButton
				small
				tip="bottom-end"
				icon="keys"
				label="Keyboard shortcuts"
				shortcut={KEY.help}
				onclick={onhelp}
			/>
		</span>

		{#if isGm}
			<!-- The players' view of this map in a window of its own, to put on a
			     screen the table can see. It opens in the one window however
			     often it is asked for. -->
			<a
				class="btn btn-sm no-underline"
				href="{mapUrl(mapId)}?display"
				target="odyssey-display"
				aria-keyshortcuts={ariaKey(KEY.display)}
				title="Opens what the players see in a window of its own, for a TV or a second screen ({keyLabel(
					KEY.display
				)})"
				>Display</a
			>
			<!-- The campaign's pictures, to stock ahead of the maps and tokens that will use them. -->
			<button
				class="btn btn-sm"
				aria-keyshortcuts={ariaKey(KEY.gallery)}
				title="The campaign's pictures, for its maps and tokens ({keyLabel(KEY.gallery)})"
				onclick={ongallery}>Gallery</button
			>
			<button
				class="btn btn-sm"
				aria-keyshortcuts={ariaKey(KEY.invite)}
				title="A code for players to scan, and the link to send them ({keyLabel(KEY.invite)})"
				onclick={oninvite}>Invite</button
			>
		{/if}
	</div>
</header>
