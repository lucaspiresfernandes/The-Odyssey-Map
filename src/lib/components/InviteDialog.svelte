<script lang="ts">
	// How players get to the table: a code to scan with a phone, and the same
	// link to copy. Around a real table the code can go up on the table
	// display, for everyone to scan from where they sit.

	import {
		inviteAddress,
		rememberHost,
		rememberedHost,
		type Invite
	} from '#lib/client/invite.ts';
	import Modal from './Modal.svelte';
	import QrCode from './QrCode.svelte';

	interface Props {
		invite: Invite;
		campaignName: string;
		/** The address of the table display for the map the GM is on. */
		displayUrl: string;
		/** Says how copying the link went. */
		oncopied: (ok: boolean) => void;
		onclose: () => void;
	}

	let { invite, campaignName, displayUrl, oncopied, onclose }: Props = $props();

	/** Which of this machine's addresses the link is made out to, when there are several. */
	let picked = $state(rememberedHost());
	const address = $derived(inviteAddress(invite, location, picked));

	async function copy() {
		try {
			await navigator.clipboard.writeText(address.url);
			oncopied(true);
		} catch {
			// The link is in the box, to be copied by hand.
			oncopied(false);
		}
	}
</script>

<Modal title="Invite players to {campaignName}" {onclose}>
	<div class="grid justify-items-center gap-3">
		<QrCode text={address.url} size={232} label="A code to scan: it opens the invite link" />
		<p class="text-center text-[13px] text-muted">
			Scan it with a phone's camera and pick a name, or the name you played under before. You
			are asked here before anyone is let in.
		</p>
	</div>

	{#if address.local}
		<p class="rounded-lg border border-[#96721f] bg-[#3a3018] px-3 py-2 text-[13px]">
			This link only opens on this machine. For phones on your network to reach the map, start the
			app with <code class="font-semibold">bun run start:lan</code>.
		</p>
	{/if}

	{#if address.hosts.length > 1}
		<label class="field">
			<span>This machine has several addresses. Pick the one on the network your players are on.</span>
			<select
				class="input"
				value={address.host}
				onchange={(e) => {
					picked = e.currentTarget.value;
					rememberHost(picked);
				}}
			>
				{#each address.hosts as host (host)}
					<option value={host}>{host}</option>
				{/each}
			</select>
		</label>
	{/if}

	<div class="flex gap-2">
		<input
			class="input min-w-0 flex-1 text-[13px]"
			value={address.url}
			readonly
			aria-label="Invite link"
			onfocus={(e) => e.currentTarget.select()}
		/>
		<button class="btn btn-primary" onclick={copy}>Copy</button>
	</div>

	<!-- The display is one window however often it is asked for, so these two
	     links turn the page it is on. -->
	<div class="flex flex-wrap items-center justify-between gap-2 border-t pt-3.5">
		<span class="text-[13px] text-muted">On the table display:</span>
		<span class="flex gap-2">
			<a class="btn btn-sm no-underline" href="{displayUrl}&invite" target="odyssey-display">
				Show the code
			</a>
			<a class="btn btn-sm btn-ghost no-underline" href={displayUrl} target="odyssey-display">
				Take it off
			</a>
		</span>
	</div>
</Modal>
