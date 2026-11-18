<script lang="ts">
	import { getLive } from '#lib/client/live.svelte.ts';
	import {
		markerType,
		type HistoryEntry,
		type MapInfo,
		type Marker,
		type Region,
		type Role
	} from '#lib/shared/types.ts';

	interface Props {
		campaignId: string;
		mapId: string;
		role: Role;
		onclose: () => void;
		onerror: (message: string) => void;
	}

	let { campaignId, mapId, role, onclose, onerror }: Props = $props();

	const live = getLive();
	const PAGE = 60;

	let scope = $state<'map' | 'all'>('map');
	let entries = $state<HistoryEntry[]>([]);
	let loading = $state(true);
	let complete = $state(false);
	let failed = $state(false);
	let busy = $state<number | null>(null);
	let request = 0;

	async function load(more = false) {
		const mine = ++request;
		const params = new URLSearchParams();
		if (scope === 'map') params.set('map', mapId);
		if (more && entries.length) params.set('before', String(entries[entries.length - 1].seq));
		try {
			const response = await fetch(`/c/${campaignId}/history?${params}`);
			if (!response.ok) throw new Error();
			const page = ((await response.json()) as { entries: HistoryEntry[] }).entries;
			if (mine !== request) return;
			entries = more ? [...entries, ...page] : page;
			complete = page.length < PAGE;
			failed = false;
		} catch {
			if (mine === request) failed = true;
		} finally {
			if (mine === request) loading = false;
		}
	}

	$effect(() => {
		void scope;
		void mapId;
		loading = true;
		load();
	});

	// Stay current while the panel is open: any change at the table is a new entry.
	$effect(() => {
		let timer: ReturnType<typeof setTimeout>;
		const stop = live.subscribe(() => {
			clearTimeout(timer);
			timer = setTimeout(() => load(), 150);
		});
		return () => {
			clearTimeout(timer);
			stop();
		};
	});

	async function revert(entry: HistoryEntry) {
		busy = entry.seq;
		try {
			await live.send({ t: 'history.revert', seq: entry.seq });
		} catch (err) {
			onerror((err as Error).message);
		}
		busy = null;
		load();
	}

	interface Line {
		verb: string;
		subject: string;
		details: string[];
		was?: string;
	}

	function describe(entry: HistoryEntry): Line {
		const now = entry.after ?? entry.before;
		if (entry.entity === 'marker') {
			const before = entry.before as Marker | null;
			const after = entry.after as Marker | null;
			const subject = (now as Marker).title;
			if (entry.action === 'create') {
				return { verb: 'added', subject, details: after!.hidden ? ['hidden from players'] : [] };
			}
			if (entry.action === 'delete') return { verb: 'deleted', subject, details: [] };
			if (entry.action === 'restore') return { verb: 'restored', subject, details: [] };

			const details: string[] = [];
			let was: string | undefined;
			if (before!.title !== after!.title) details.push(`renamed from “${before!.title}”`);
			if (before!.description !== after!.description) {
				details.push('changed the description');
				was = before!.description || '(empty)';
			}
			if (before!.type !== after!.type) {
				details.push(`type ${markerType(before!.type).label} → ${markerType(after!.type).label}`);
			}
			if (before!.x !== after!.x || before!.y !== after!.y) details.push('moved');
			if (before!.hidden !== after!.hidden) {
				const verb = after!.hidden ? 'hid' : 'revealed';
				if (details.length === 0) return { verb, subject, details: [] };
				details.push(after!.hidden ? 'hidden from players' : 'revealed to players');
			}
			return { verb: 'edited', subject, details, was };
		}

		if (entry.entity === 'region') {
			const subject = (now as Region).name;
			const verb = { create: 'drew region', update: 'reshaped region', delete: 'deleted region', restore: 'restored region' }[entry.action];
			return { verb, subject, details: [] };
		}

		const before = entry.before as MapInfo | null;
		const after = entry.after as MapInfo;
		if (entry.action === 'create') return { verb: 'created map', subject: after.name, details: [] };
		const details: string[] = [];
		if (before!.name !== after.name) details.push(`renamed from “${before!.name}”`);
		if (before!.imageFile !== after.imageFile) details.push('new map image');
		return { verb: 'updated map', subject: after.name, details };
	}

	function kindOf(entry: HistoryEntry): string {
		if (entry.entity !== 'marker') return entry.entity;
		return ((entry.after ?? entry.before) as Marker).kind === 'world' ? 'world' : 'note';
	}

	const clock = new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' });
	const calendar = new Intl.DateTimeFormat(undefined, {
		month: 'short',
		day: 'numeric',
		hour: 'numeric',
		minute: '2-digit'
	});

	function when(at: number): string {
		const minutes = Math.floor((Date.now() - at) / 60000);
		if (minutes < 1) return 'just now';
		if (minutes < 60) return `${minutes} min ago`;
		const date = new Date(at);
		return date.toDateString() === new Date().toDateString()
			? clock.format(date)
			: calendar.format(date);
	}
</script>

<aside aria-label="Edit history">
	<header>
		<h2>History</h2>
		<button class="btn small ghost" onclick={onclose} aria-label="Close history">×</button>
	</header>

	<div class="scope" role="group" aria-label="Show changes from">
		<button class:on={scope === 'map'} onclick={() => (scope = 'map')}>This map</button>
		<button class:on={scope === 'all'} onclick={() => (scope = 'all')}>Whole campaign</button>
	</div>

	{#if role === 'player'}
		<p class="note">Changes to the table's notes. Anything deleted can be brought back.</p>
	{/if}

	{#if loading}
		<p class="note">Loading…</p>
	{:else if failed}
		<p class="note">
			Couldn't load the history. <button class="link" onclick={() => load()}>Try again</button>
		</p>
	{:else if entries.length === 0}
		<p class="note">Nothing has changed here yet.</p>
	{:else}
		<ol>
			{#each entries as entry (entry.seq)}
				{@const line = describe(entry)}
				<li>
					<div class="what">
						<p>
							<strong>{entry.actorName}</strong>
							{line.verb}
							<em>{line.subject}</em>
						</p>
						{#if line.details.length}<p class="details">{line.details.join(' · ')}</p>{/if}
						{#if line.was}<p class="was"><span>Before:</span> {line.was}</p>{/if}
						<p class="meta">
							<span class="tag {kindOf(entry)}">{kindOf(entry)}</span>
							<time datetime={new Date(entry.at).toISOString()}>{when(entry.at)}</time>
							{#if scope === 'all' && entry.mapName}<span>· {entry.mapName}</span>{/if}
						</p>
					</div>
					{#if entry.canRevert}
						<button
							class="btn small"
							disabled={busy === entry.seq}
							onclick={() => revert(entry)}
						>
							{entry.action === 'delete' ? 'Restore' : 'Undo'}
						</button>
					{/if}
				</li>
			{/each}
		</ol>
		{#if !complete}
			<button class="btn small more" onclick={() => load(true)}>Show older changes</button>
		{/if}
	{/if}
</aside>

<style>
	aside {
		width: min(360px, 100vw);
		height: 100%;
		display: flex;
		flex-direction: column;
		gap: 12px;
		padding: 14px;
		background: var(--panel);
		border-left: 1px solid var(--line);
		overflow-y: auto;
	}

	header {
		display: flex;
		align-items: center;
		justify-content: space-between;
	}

	h2 {
		font-size: 19px;
	}

	header .btn {
		font-size: 20px;
	}

	.scope {
		display: grid;
		grid-template-columns: 1fr 1fr;
		border: 1px solid var(--line);
		border-radius: 8px;
		overflow: hidden;
	}

	.scope button {
		padding: 6px;
		border: 0;
		background: none;
		color: var(--muted);
		font-size: 13px;
		cursor: pointer;
	}

	.scope button.on {
		background: var(--panel-2);
		color: var(--text);
	}

	.note {
		font-size: 13px;
		color: var(--muted);
	}

	.link {
		padding: 0;
		border: 0;
		background: none;
		color: var(--accent);
		text-decoration: underline;
		cursor: pointer;
	}

	ol {
		list-style: none;
		margin: 0;
		padding: 0;
		display: grid;
	}

	li {
		display: flex;
		align-items: flex-start;
		justify-content: space-between;
		gap: 10px;
		padding: 10px 0;
		border-top: 1px solid var(--line);
	}

	.what {
		display: grid;
		gap: 3px;
		min-width: 0;
		font-size: 14px;
		overflow-wrap: anywhere;
	}

	em {
		font-family: var(--serif);
		font-style: normal;
		font-size: 15px;
		color: #f3ead2;
	}

	.details,
	.was,
	.meta {
		font-size: 12px;
		color: var(--muted);
	}

	.was {
		display: -webkit-box;
		-webkit-line-clamp: 3;
		line-clamp: 3;
		-webkit-box-orient: vertical;
		overflow: hidden;
		white-space: pre-wrap;
	}

	.was span {
		color: #c9b891;
	}

	.meta {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 6px;
	}

	.tag {
		padding: 0 6px;
		border-radius: 999px;
		border: 1px solid var(--line);
		font-size: 11px;
	}

	.tag.note {
		border-color: #a8935c;
		color: #d8c690;
	}

	.tag.world {
		border-color: #5b8def;
		color: #9db9f5;
	}

	.more {
		align-self: center;
	}
</style>
