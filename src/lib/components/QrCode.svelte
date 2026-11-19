<script lang="ts">
	// A QR code for a line of text: dark squares on a pale card with a quiet
	// border around them, which a phone's camera needs to find it.

	import qrcode from 'qrcode-generator';

	interface Props {
		text: string;
		/** How wide and tall it is drawn, in pixels. */
		size?: number;
		/** What it is, for someone who can't see it. */
		label: string;
	}

	let { text, size = 220, label }: Props = $props();

	/** How many squares of pale border go around the code. */
	const QUIET = 3;

	/** The dark squares as one path, and how many squares the code is across. */
	const code = $derived.by(() => {
		// 0 lets the code grow to fit the text. M survives a glare on the screen.
		const qr = qrcode(0, 'M');
		qr.addData(text);
		qr.make();
		const count = qr.getModuleCount();
		let d = '';
		for (let row = 0; row < count; row++) {
			for (let col = 0; col < count; col++) {
				if (qr.isDark(row, col)) d += `M${col + QUIET} ${row + QUIET}h1v1h-1Z`;
			}
		}
		return { d, across: count + QUIET * 2 };
	});
</script>

<svg
	class="block rounded-lg bg-[#fff8e4]"
	viewBox="0 0 {code.across} {code.across}"
	width={size}
	height={size}
	role="img"
	aria-label={label}
	shape-rendering="crispEdges"
>
	<path d={code.d} fill="#12151c" />
</svg>
