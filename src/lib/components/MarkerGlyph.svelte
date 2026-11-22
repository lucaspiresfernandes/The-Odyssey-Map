<script lang="ts">
  import type { MarkerType } from "#lib/shared/types.ts";

  let { type, size = 16 }: { type: MarkerType; size?: number } = $props();

  // Line icons on a 24 x 24 grid.
  const PATHS: Record<MarkerType, string> = {
    // Exclamation mark.
    quest: "M12 4.5v9.5 M12 18.6v.2",
    // Cut gem.
    treasure: "M6.5 4.5h11L21 9.5 12 20 3 9.5Z M3 9.5h18 M9.3 4.6 12 9.5l2.7-4.9",
    // Chest with a domed lid and a lock.
    cache: "M4 11h16v8H4Z M4 11V9a3 3 0 0 1 3-3h10a3 3 0 0 1 3 3v2 M12 11v3",
    // Tied coin purse.
    merchant:
      "M9 3.5h6L13 7h-2Z M10 7C5.5 9.5 4 13 4.5 16.5 5 19 6.5 20 9 20h6c2.5 0 4-1 4.5-3.5.5-3.5-1-7-5.5-9.5",
    // Anchor.
    harbor:
      "M12 3a2.5 2.5 0 1 0 0 5 2.5 2.5 0 1 0 0-5 M12 8v12 M8.5 11h7 M5 13a7 7 0 0 0 14 0 M3 15l2-2 2 2 M17 15l2-2 2 2",
    // Pediment on three columns.
    temple: "M3 9.5 12 4l9 5.5Z M6 9.5V20 M12 9.5V20 M18 9.5V20 M3.5 20h17",
    // Two broken columns.
    ruins: "M3 20h18 M6 20V6l2 1.5L10 5v15 M14 20v-7l2 1 2-1.5V20",
    // Tent with an open flap.
    camp: "M3 20 12 5l9 15Z M12 20v-5.5 M10 3l2 2 2-2",
    // Twin mountain peaks.
    natural_feature: "M2.5 19 9 7.5l4 7 2.5-3.5 6 8Z",
    // Flag.
    point_of_interest: "M7 21V4 M7 5h10.5l-2.6 3.5 2.6 3.5H7",
    // Lines of text.
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
