<script lang="ts">
	// The campaign's gallery, one shelf of it at a time: the map images, or
	// the pictures for tokens. Opened from where a picture is wanted, it
	// shows that shelf, and whoever opened it picks one to use. The GM can
	// also add to the shelf, rename what is on it and take things off while
	// here, and decides which token pictures the players get to see: every
	// picture starts hidden from them. A player only looks at what has been
	// revealed, and picks.
	//
	// Opened on its own, with no `kind`, it is the GM's storeroom: both
	// shelves, to stock and tidy ahead of the session. Nothing is picked.
	// From there a picture can be held up for the whole table to look at.
	// The storeroom has a third shelf, which holds no pictures: the
	// encounters, each a handful of tokens made ahead of time out of the token
	// pictures. See EncounterShelf.svelte.
	//
	// With no `kind` and something to do with a pick, both shelves are there
	// to pick from: the card of a marker shows a picture off either.

	import {
		LIMITS,
		imageUrl,
		type Encounter,
		type EncountersResponse,
		type GalleryItem,
		type GalleryKind,
		type GalleryResponse,
		type Player
	} from '#lib/shared/types.ts';
	import EncounterShelf from './EncounterShelf.svelte';
	import Modal from './Modal.svelte';
	import PlayerPicker from './PlayerPicker.svelte';

	/** A shelf of the storeroom: one of pictures, or the encounters. */
	type Shelf = GalleryKind | 'encounter';

	interface Props {
		campaignId: string;
		/** The shelf to pick from. Left out, both shelves are here to look after. */
		kind?: GalleryKind;
		/** The file in use where this was opened from, to mark it on the shelf. */
		current?: string | null;
		/** For a player: the shelf is there to pick from, and nothing on it can be changed. */
		readonly?: boolean;
		/** With both shelves open, the one to start on. The map images, unless it says otherwise. */
		start?: Shelf;
		/**
		 * What to do with the picture that is picked. With a `kind` it is picked
		 * from that shelf, and without one from either.
		 */
		onpick?: (item: GalleryItem) => void;
		onclose: () => void;
	}

	let {
		campaignId,
		kind,
		current = null,
		readonly = false,
		start = 'map',
		onpick,
		onclose
	}: Props = $props();

	/** The players the next picture is held up for. With none, it is for the whole table. */
	let audience = $state<string[]>([]);

	const ACCEPT = 'image/png,image/jpeg,image/webp,image/gif,image/avif';
	/**
	 * With nothing to pick and everything to look after, this is the GM's
	 * storeroom: the only place the encounters are.
	 */
	const storeroom = $derived(!kind && !onpick && !readonly);
	const SHELVES = $derived<{ kind: Shelf; title: string }[]>([
		{ kind: 'map', title: 'Map images' },
		{ kind: 'token', title: 'Token pictures' },
		...(storeroom ? [{ kind: 'encounter' as const, title: 'Encounters' }] : [])
	]);

	/** The shelf on show while both are open. */
	// Deliberately a one-time copy: the shelf to start on, and the GM's to change.
	// svelte-ignore state_referenced_locally
	let tab = $state<Shelf>(start);
	const shown = $derived<Shelf>(kind ?? (tab === 'encounter' && !storeroom ? 'map' : tab));
	const maps = $derived(shown === 'map');
	const encountering = $derived(shown === 'encounter');

	/** Null until the gallery has been read. */
	let items = $state<GalleryItem[] | null>(null);
	/** The encounters, for the storeroom. Null until they have been read. */
	let encounters = $state<Encounter[] | null>(null);
	let error = $state('');
	/** How far a batch of uploads has come. */
	let uploading = $state<{ done: number; of: number } | null>(null);
	/** The picture the GM has asked to take out, while they are asked if they mean it. */
	let removing = $state<string | null>(null);
	/** Files are being held over the dialog, about to be dropped. */
	let over = $state(false);
	let fileInput = $state<HTMLInputElement>();

	const shelf = $derived(items?.filter((item) => item.kind === shown) ?? []);

	/** Asks the gallery for something. Every answer is the gallery as it is afterwards. */
	async function ask(path: string, init?: RequestInit): Promise<boolean> {
		try {
			const response = await fetch(`/c/${campaignId}/gallery${path}`, init);
			const result = (await response.json().catch(() => null)) as GalleryResponse | null;
			if (!result?.ok || !result.items) {
				throw new Error(result?.error ?? "The gallery couldn't be reached.");
			}
			items = result.items;
			return true;
		} catch (err) {
			error = (err as Error).message;
			return false;
		}
	}

	$effect(() => {
		ask('');
	});

	// The encounters are read along with the pictures, so their shelf can say
	// how many there are before it is opened.
	$effect(() => {
		if (!storeroom) return;
		fetch(`/c/${campaignId}/encounters`)
			.then((response) => response.json())
			.then((result: EncountersResponse) => {
				if (result.ok && result.items) encounters ??= result.items;
			})
			.catch(() => {
				// The shelf says so when it is opened and asked for something.
			});
	});

	/**
	 * Puts pictures on a shelf: the one that is open, unless another is named.
	 * Answers with the ones that went in.
	 */
	async function upload(files: File[], onto: GalleryKind = maps ? 'map' : 'token') {
		if (readonly || uploading || files.length === 0) return [];
		error = '';
		const had = new Set(items?.map((item) => item.id));
		const most = onto === 'map' ? LIMITS.imageBytes : LIMITS.tokenImageBytes;
		uploading = { done: 0, of: files.length };
		for (const file of files) {
			if (file.size > most) {
				const what = onto === 'map' ? 'Map images' : 'Token pictures';
				error = `${what} can be up to ${most / 1024 / 1024} MB. “${file.name}” is bigger.`;
			} else {
				const body = new FormData();
				body.set('kind', onto);
				body.set('file', file);
				await ask('', { method: 'POST', body });
			}
			uploading.done++;
		}
		uploading = null;
		if (fileInput) fileInput.value = '';
		return items?.filter((item) => item.kind === onto && !had.has(item.id)) ?? [];
	}

	async function rename(item: GalleryItem, input: HTMLInputElement) {
		const name = input.value.trim();
		if (name === item.name) return;
		error = '';
		const renamed =
			name !== '' &&
			(await ask(`/${item.id}`, {
				method: 'PATCH',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ name })
			}));
		// A name that didn't take is put back as it was.
		if (!renamed) input.value = item.name;
	}

	/** Reveals a picture to the players, or hides it from them again. */
	async function reveal(item: GalleryItem) {
		error = '';
		await ask(`/${item.id}`, {
			method: 'PATCH',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ hidden: !item.hidden })
		});
	}

	// An eye, and a line to strike it through.
	const EYE = 'M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12Z M9 12a3 3 0 1 0 6 0a3 3 0 1 0-6 0';
	const STRUCK = `${EYE} M4 3l16 18`;

	async function remove(item: GalleryItem) {
		removing = null;
		error = '';
		await ask(`/${item.id}`, { method: 'DELETE' });
	}

	function dropped(event: DragEvent) {
		event.preventDefault();
		over = false;
		// The encounters take pictures through the plus on their own page.
		if (encountering) return;
		upload([...(event.dataTransfer?.files ?? [])].filter((file) => file.type.startsWith('image/')));
	}
</script>

<Modal
	title={kind ? (maps ? 'Map images' : 'Token pictures') : onpick ? 'Pick a picture' : 'Gallery'}
	wide
	{onclose}
>
	<!-- svelte-ignore a11y_no_static_element_interactions -->
	<div
		class="grid gap-4"
		ondragover={(e) => {
			e.preventDefault();
			over = !readonly && !encountering;
		}}
		ondragleave={() => (over = false)}
		ondrop={dropped}
	>
		{#if !kind}
			<div class="-mt-1 flex gap-1.5" role="tablist" aria-label="Shelves of the gallery">
				{#each SHELVES as each (each.kind)}
					<button
						class={['btn btn-sm', shown === each.kind && 'btn-active']}
						role="tab"
						aria-selected={shown === each.kind}
						onclick={() => {
							tab = each.kind;
							removing = null;
							error = '';
						}}
					>
						{each.title}
						{#if each.kind === 'encounter'}
							{#if encounters}<span class="text-muted">{encounters.length}</span>{/if}
						{:else if items}
							<span class="text-muted">
								{items.filter((item) => item.kind === each.kind).length}
							</span>
						{/if}
					</button>
				{/each}
			</div>
		{/if}

		{#if error}
			<p class="rounded-lg border border-danger/50 bg-danger/10 px-3 py-2 text-sm" role="alert">
				{error}
			</p>
		{/if}

		{#if encountering}
			<EncounterShelf
				{campaignId}
				pictures={items?.filter((item) => item.kind === 'token') ?? []}
				bind:encounters
				uploading={uploading !== null}
				onupload={(files) => upload(files, 'token')}
				onerror={(text) => (error = text)}
			/>
		{:else}
		<p class={['text-[13px] text-muted', kind && '-mt-2']}>
			{#if readonly}
				Pick a picture for your token, from the ones the GM has shared with the table.
			{:else if !kind && onpick}
				Pick a picture for the card of this marker, off either shelf. Players who can see the
				marker see its picture, hidden in the gallery or not.
			{:else if maps}
				{kind ? 'Pick an image to lay under this map.' : 'The images to lay under your maps.'}
				What you add here is kept for the whole campaign, to use on any of its maps.
			{:else}
				{kind ? 'Pick a picture for this token.' : 'The pictures for your tokens.'}
				What you add here is kept for the whole campaign, to use on any of its tokens. Your players
				see none of it until you reveal a picture with its eye: those they can pick for their own tokens.
			{/if}
		</p>

		<ul
			class={[
				'grid content-start gap-3',
				maps
					? 'grid-cols-[repeat(auto-fill,minmax(150px,1fr))]'
					: 'grid-cols-[repeat(auto-fill,minmax(104px,1fr))]'
			]}
		>
			<!-- The first place on the shelf is the way to add to it. -->
			{#if !readonly}
				<li class="grid content-start gap-1.5">
					<button
						class={[
							'grid w-full cursor-pointer place-items-center border-2 border-dashed text-muted transition-colors hover:border-accent hover:text-accent disabled:cursor-default disabled:opacity-60',
							maps ? 'aspect-4/3 rounded-lg' : 'aspect-square rounded-full',
							over && 'border-accent text-accent'
						]}
						disabled={uploading !== null}
						onclick={() => fileInput?.click()}
					>
						<span class="grid justify-items-center gap-1 px-2 text-center text-[13px]">
							<svg
								width="22"
								height="22"
								viewBox="0 0 24 24"
								fill="none"
								stroke="currentColor"
								stroke-width="2"
								stroke-linecap="round"
								aria-hidden="true"
							>
								<path d="M12 5v14 M5 12h14" />
							</svg>
							{#if uploading}
								Adding {Math.min(uploading.done + 1, uploading.of)} of {uploading.of}…
							{:else}
								Add {maps ? 'images' : 'pictures'}
							{/if}
						</span>
					</button>
				</li>
			{/if}

			{#each shelf as item (item.id)}
				<li class="group relative grid content-start gap-1.5">
					{#if onpick}
						<button
							class={[
								'block w-full cursor-pointer overflow-hidden border-2 bg-night transition-colors hover:border-accent',
								maps ? 'aspect-4/3 rounded-lg' : 'aspect-square rounded-full',
								item.file === current ? 'border-accent' : 'border-line'
							]}
							aria-label="Use {item.name}{item.file === current ? ' (in use here)' : ''}"
							aria-current={item.file === current || undefined}
							onclick={() => onpick(item)}
						>
							<img
								class="size-full object-cover"
								src={imageUrl(campaignId, item.file, 'thumb')}
								alt=""
								loading="lazy"
								draggable="false"
							/>
						</button>
					{:else}
						<!-- Nothing to pick it for: the picture is only on show. -->
						<img
							class={[
								'block w-full border-2 border-line bg-night object-cover',
								maps ? 'aspect-4/3 rounded-lg' : 'aspect-square rounded-full'
							]}
							src={imageUrl(campaignId, item.file, 'thumb')}
							alt={item.name}
							loading="lazy"
							draggable="false"
						/>
					{/if}

					{#if readonly}
						<span class="truncate px-1 py-0.5 text-center text-[13px]">{item.name}</span>
					{:else}
						<!-- The name is its own field: change it and leave, and it is renamed. -->
						<input
							class="w-full min-w-0 truncate rounded-md border border-transparent bg-transparent px-1 py-0.5 text-center text-[13px] hover:border-line focus:border-line focus:bg-[#12161e] touch:text-base"
							value={item.name}
							maxlength={LIMITS.name}
							aria-label="Name of {item.name}"
							onchange={(e) => rename(item, e.currentTarget)}
							onkeydown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
						/>
					{/if}

					{#if !readonly}
						{#if removing === item.id}
							<div
								class="absolute inset-x-0 top-0 grid place-content-center gap-1.5 bg-night/92 p-2 text-center text-[13px] {maps
									? 'aspect-4/3 rounded-lg'
									: 'aspect-square rounded-full'}"
							>
								<span>Take it out?</span>
								<span class="flex justify-center gap-1.5">
									<button class="btn btn-sm btn-danger" onclick={() => remove(item)}>Yes</button>
									<button class="btn btn-sm" onclick={() => (removing = null)}>No</button>
								</span>
							</div>
						{:else}
							<button
								class="absolute top-1 right-1 grid size-6.5 cursor-pointer place-items-center rounded-full border bg-night/85 text-base leading-none text-muted opacity-0 transition-opacity group-focus-within:opacity-100 group-hover:opacity-100 hover:text-danger touch:size-9 touch:opacity-100 align-baseline"
								aria-label="Remove {item.name} from the gallery"
								title="Remove from the gallery"
								onclick={() => (removing = item.id)}>x</button
							>
							{#if !maps}
								<!-- Who gets to see it. A revealed picture keeps its eye in view, in
								     gold. A hidden one, which is most of them, shows a struck-out
								     eye only when the pointer or the focus is on its card. -->
								<button
									class={[
										'absolute top-1 left-1 grid size-6.5 cursor-pointer place-items-center rounded-full border bg-night/85 transition-opacity touch:size-9',
										item.hidden
											? 'text-muted opacity-0 group-focus-within:opacity-100 group-hover:opacity-100 hover:text-cream touch:opacity-100'
											: 'border-accent text-accent'
									]}
									aria-label="Show {item.name} to the players"
									aria-pressed={!item.hidden}
									title={item.hidden
										? 'Hidden from players. Click to reveal it to them.'
										: 'Players can see and pick this. Click to hide it.'}
									onclick={() => reveal(item)}
								>
									<svg
										width="15"
										height="15"
										viewBox="0 0 24 24"
										fill="none"
										stroke="currentColor"
										stroke-width="2"
										stroke-linecap="round"
										stroke-linejoin="round"
										aria-hidden="true"
									>
										<path d={item.hidden ? STRUCK : EYE} />
									</svg>
								</button>
							{/if}
						{/if}
					{/if}
				</li>
			{/each}
		</ul>

		{#if items === null && !error}
			<p class="text-sm text-muted">Opening the gallery…</p>
		{:else if items && shelf.length === 0}
			<p class="text-sm text-muted">
				{#if readonly}
					Nothing here yet. The GM hasn't shared any pictures with the table.
				{:else}
					Nothing here yet. Add {maps ? 'an image' : 'a picture'} with the button above, or drop
					files anywhere on this box.
				{/if}
			</p>
		{:else if shelf.length > 0 && !readonly}
			<p class="text-[13px] text-muted">
				Taking a picture out of the gallery leaves it on the {maps ? 'maps' : 'tokens'} that already
				use it.
			</p>
		{/if}

		<input
			bind:this={fileInput}
			type="file"
			accept={ACCEPT}
			multiple
			hidden
			onchange={(e) => upload([...(e.currentTarget.files ?? [])])}
		/>
		{/if}

		<div class="flex justify-end">
			<button class="btn" onclick={onclose}>Close</button>
		</div>
	</div>
</Modal>
