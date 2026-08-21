import { prisma } from "./prisma";

// Build the title used for both the Birthday row and its linked calendar
// Event, so they stay visually in sync.
export function birthdayEventTitle(name: string): string {
  return `🎂 ${name}'s Birthday`;
}

// Year used as a sentinel when the caller doesn't know the person's actual
// year of birth. 2000 is a leap year (divisible by 400), which keeps Feb 29
// valid when someone has a leap-day birthday but an unknown birth year.
// Display code keys off `yearKnown` (not the stored year) so this value is
// only ever a storage detail and never shown to users.
export const UNKNOWN_BIRTH_YEAR = 2000;

// Returns a UTC-noon `Date` for the given ISO string or Date, so two
// birthday entries for the same day always serialise identically.
// When `yearKnown` is false the year is overwritten with UNKNOWN_BIRTH_YEAR
// so the stored row can't leak a placeholder year the user picked in the UI.
//
// Important: we deliberately anchor birthdays at 12:00 UTC rather than 00:00
// UTC. A midnight anchor falls on the *previous* local day for any timezone
// west of UTC and on the same day for timezones east of UTC, and combined
// with a 23:59:59 UTC end time the event silently spans two local days in
// most of the world. Noon UTC keeps the event inside a single calendar day
// in every timezone from UTC−11 through UTC+11 (i.e. everywhere real people
// live).
export function asBirthdayDay(
  input: Date | string,
  yearKnown: boolean = true,
): Date {
  const d = typeof input === "string" ? new Date(input) : input;
  const year = yearKnown ? d.getUTCFullYear() : UNKNOWN_BIRTH_YEAR;
  return new Date(Date.UTC(year, d.getUTCMonth(), d.getUTCDate(), 12, 0, 0));
}

// Create or update the calendar Event attached to a Birthday row. If the
// Birthday already has a linked event we update it; otherwise we create a
// fresh yearly-recurring all-day event and link it.
export async function syncBirthdayEvent(opts: {
  birthdayId: string;
  name: string;
  dateOfBirth: Date;
  color: string | null;
  notes: string | null;
  createdById: string;
}): Promise<string> {
  const start = asBirthdayDay(opts.dateOfBirth);
  // Collapse start/end to the same instant — the Event is flagged `allDay`
  // so the calendar render only needs an anchor date. Using an identical
  // endAt avoids the UTC-midnight-to-23:59 span that previously made
  // birthdays appear on two local days.
  const end = new Date(start.getTime());
  const title = birthdayEventTitle(opts.name);

  const existing = await prisma.birthday.findUnique({
    where: { id: opts.birthdayId },
    select: { linkedEventId: true },
  });

  if (existing?.linkedEventId) {
    await prisma.event.update({
      where: { id: existing.linkedEventId },
      data: {
        title,
        description: opts.notes,
        startAt: start,
        endAt: end,
        allDay: true,
        color: opts.color,
        recurrenceFrequency: "YEARLY",
        recurrenceInterval: 1,
        recurrenceByWeekday: null,
        recurrenceEndDate: null,
        recurrenceEndCount: null,
      },
    });
    return existing.linkedEventId;
  }

  const event = await prisma.event.create({
    data: {
      title,
      description: opts.notes,
      startAt: start,
      endAt: end,
      allDay: true,
      color: opts.color,
      recurrenceFrequency: "YEARLY",
      recurrenceInterval: 1,
      createdById: opts.createdById,
    },
  });
  await prisma.birthday.update({
    where: { id: opts.birthdayId },
    data: { linkedEventId: event.id },
  });
  return event.id;
}

// Remove the linked calendar event (if any) for a Birthday row. Called by
// the DELETE route before dropping the Birthday itself.
export async function deleteBirthdayEvent(birthdayId: string): Promise<void> {
  const existing = await prisma.birthday.findUnique({
    where: { id: birthdayId },
    select: { linkedEventId: true },
  });
  if (!existing?.linkedEventId) return;
  try {
    await prisma.event.delete({ where: { id: existing.linkedEventId } });
  } catch {
    // Event may already be gone — ignore.
  }
}

// ---------------------------------------------------------------------------
// v4.7.15 — User-level birthday calendar sync.
//
// Family members (User rows) can opt in/out of showing their birthday on the
// shared calendar via `showBirthdayOnCalendar`. Defaults to true. The link is
// stored as User.linkedBirthdayEventId pointing at an Event row that we
// create + maintain here.
//
// Call `syncUserBirthdayEvent(userId)` after any user create/update that
// might have touched dateOfBirth, showBirthdayOnCalendar, or the display
// fields (name / color / avatarEmoji). It is idempotent: it (re)creates the
// event if it should exist, updates it if details changed, or deletes it if
// the user has turned the flag off or cleared their DOB.
// ---------------------------------------------------------------------------

export function userBirthdayEventTitle(name: string, avatar: string): string {
  return `${avatar || "🎂"} ${name}'s Birthday`;
}

export async function syncUserBirthdayEvent(userId: string): Promise<void> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      id: true,
      name: true,
      color: true,
      avatarEmoji: true,
      dateOfBirth: true,
      showBirthdayOnCalendar: true,
      linkedBirthdayEventId: true,
    },
  });
  if (!user) return;

  const shouldExist = Boolean(user.dateOfBirth && user.showBirthdayOnCalendar);

  // Case 1: shouldn't exist (no DOB or opted out) — clean up if needed.
  if (!shouldExist) {
    if (user.linkedBirthdayEventId) {
      // Nullify the link first so the SetNull constraint doesn't fight us.
      await prisma.user.update({
        where: { id: user.id },
        data: { linkedBirthdayEventId: null },
      });
      try {
        await prisma.event.delete({ where: { id: user.linkedBirthdayEventId } });
      } catch {
        // Event may already be gone — ignore.
      }
    }
    return;
  }

  // Case 2: should exist. We have a non-null DOB at this point.
  const start = asBirthdayDay(user.dateOfBirth!, true);
  const end = new Date(start.getTime());
  const title = userBirthdayEventTitle(user.name, user.avatarEmoji);

  if (user.linkedBirthdayEventId) {
    // Try to update in place. If the underlying event went missing (e.g.
    // someone deleted it from the calendar UI), fall through to create.
    try {
      await prisma.event.update({
        where: { id: user.linkedBirthdayEventId },
        data: {
          title,
          startAt: start,
          endAt: end,
          allDay: true,
          color: user.color,
          recurrenceFrequency: "YEARLY",
          recurrenceInterval: 1,
          recurrenceByWeekday: null,
          recurrenceEndDate: null,
          recurrenceEndCount: null,
        },
      });
      return;
    } catch {
      // Linked event was deleted out from under us; create a fresh one below.
      await prisma.user.update({
        where: { id: user.id },
        data: { linkedBirthdayEventId: null },
      });
    }
  }

  const event = await prisma.event.create({
    data: {
      title,
      startAt: start,
      endAt: end,
      allDay: true,
      color: user.color,
      recurrenceFrequency: "YEARLY",
      recurrenceInterval: 1,
      createdById: user.id, // the user "owns" their own birthday event
    },
  });
  await prisma.user.update({
    where: { id: user.id },
    data: { linkedBirthdayEventId: event.id },
  });
}

// Best-effort cleanup of a user's linked birthday event before the user
// itself is removed. Safe to call when no event exists.
export async function deleteUserBirthdayEvent(userId: string): Promise<void> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { linkedBirthdayEventId: true },
  });
  if (!user?.linkedBirthdayEventId) return;
  try {
    await prisma.event.delete({ where: { id: user.linkedBirthdayEventId } });
  } catch {
    // Already gone — fine.
  }
}
