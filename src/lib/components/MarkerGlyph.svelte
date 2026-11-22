<script lang="ts">
  import type { MarkerType } from "#lib/shared/types.ts";

  let { type, size = 16 }: { type: MarkerType; size?: number } = $props();

  // Line icons on a 24 x 24 grid.
  const PATHS: Record<MarkerType, string> = {
    quest: "M12 4.5v9.5 M12 18.6v.2",
	treasure: "M6.5 4.5h11L21 9.5 12 20 3 9.5Z M3 9.5h18 M9.3 4.6 12 9.5l2.7-4.9",
	cache: "M6.5 4.5h11L21 9.5 12 20 3 9.5Z M3 9.5h18 M9.3 4.6 12 9.5l2.7-4.9",
	merchant: "M4 20V11h4V6h8v5h4v9Z M10.5 20v-4h3v4 M8 6V4 M12 6V4 M16 6V4",
	harbor: "M4 20V11h4V6h8v5h4v9Z M10.5 20v-4h3v4 M8 6V4 M12 6V4 M16 6V4",
	temple: "M4 20V11h4V6h8v5h4v9Z M10.5 20v-4h3v4 M8 6V4 M12 6V4 M16 6V4",
	ruins: "M4 20V11h4V6h8v5h4v9Z M10.5 20v-4h3v4 M8 6V4 M12 6V4 M16 6V4",
	camp: "M3 20 12 5l9 15Z M12 20v-5.5 M10 3l2 2 2-2",
	natural_feature: "M7 21V4 M7 5h10.5l-2.6 3.5 2.6 3.5H7",
	point_of_interest: "M7 21V4 M7 5h10.5l-2.6 3.5 2.6 3.5H7",
	note: "M6 7h12 M6 12h12 M6 17h7",
  };
</script>

<svg
  width={size}
  height={size}
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2.3"
  stroke-linecap="round"
  stroke-linejoin="round"
  aria-hidden="true"
>
  <path d={PATHS[type] ?? PATHS.note} />
</svg>
