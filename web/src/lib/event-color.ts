// Shared helper for deriving the display colour of a calendar event.
//
// Rule (per user request): an event shown on the calendar should use the
// assigned family member's colour — not the colour of whoever entered it.
// If multiple members are assigned we render a striped linear-gradient so
// each member's colour still shows on the pill. If no members are assigned
// we fall back to the explicit event.color (for holiday / general events),
// and finally to the app's default violet.

const DEFAULT_COLOR = "#7c3aed";

type EventLike = {
  color?: string | null;
  participants?: { user?: { color?: string | null } | null }[];
};

export function eventDisplayBackground(event: EventLike): string {
  const colors = (event.participants || [])
    .map((p) => p.user?.color)
    .filter((c): c is string => !!c);

  if (colors.length === 1) return colors[0];

  if (colors.length > 1) {
    // Even-width stripes across the pill (e.g. 2 colours → 50%/50%).
    const step = 100 / colors.length;
    const stops = colors
      .map((c, i) => `${c} ${i * step}% ${(i + 1) * step}%`)
      .join(", ");
    return `linear-gradient(90deg, ${stops})`;
  }

  return event.color || DEFAULT_COLOR;
}

// When only a solid side-bar/strip is needed (no gradient support), returns
// the first participant's colour, or the event's explicit colour, or default.
export function eventPrimaryColor(event: EventLike): string {
  const first = (event.participants || []).find((p) => p.user?.color)?.user
    ?.color;
  return first || event.color || DEFAULT_COLOR;
}
