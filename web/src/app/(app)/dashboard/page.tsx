import Link from "next/link";
import { CalendarDays, CheckSquare, ShoppingCart, Users } from "lucide-react";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { can } from "@/lib/permissions";
import { eventPrimaryColor } from "@/lib/event-color";
import { getSettings } from "@/lib/settings";
import { WeatherWidget } from "@/components/WeatherWidget";
import { AutoRefresher } from "@/components/AutoRefresher";
import { NotesWidget } from "@/components/NotesWidget";
import { effectiveModuleIds } from "@/lib/modules";
import { getCurrentDevice } from "@/lib/auth";
import { expandOccurrences, ruleFromRow } from "@/lib/recurrence";

export default async function DashboardPage() {
  const me = await requireUser();
  const settings = await getSettings();

  // v4.9.2 — respect the module hide list when deciding whether to render
  // the Notes widget on the dashboard. The session's effective module set
  // is the global hide list plus the active kiosk's hide list, mirroring
  // what the layout resolves for the nav.
  const device = await getCurrentDevice();
  let deviceHidden: unknown = null;
  if (device) {
    const row = await prisma.localDevice.findUnique({
      where: { id: device.id },
      select: { hiddenModules: true },
    });
    deviceHidden = row?.hiddenModules ?? null;
  }
  const visibleModules = effectiveModuleIds({
    globalDisabled: settings.disabledModules,
    deviceHidden,
  });
  const showNotesWidget = visibleModules.has("notes");

  const now = new Date();
  const in7 = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);

  // v4.9.9 — pull TWO sets of events and merge:
  //   (a) one-off events whose startAt falls in [now, in7]
  //   (b) every recurring event row (we expand occurrences below)
  // The old query was a single findMany filtered on `startAt: { gte: now,
  // lte: in7 }`, which silently dropped recurring events whose original
  // startAt was in the past — even when they had occurrences inside the
  // 7-day window. Users with a weekly chore reminder set up months ago
  // would see "Nothing scheduled for the next 7 days" on the dashboard
  // while /calendar correctly listed them.
  //
  // We also display the next-occurrence date (not the row's startAt)
  // below, so a Wednesday-recurring event correctly shows as "Wed 3 pm"
  // instead of its first-ever date from last year.
  const [eventRows, openTodos, shoppingOpen, userCount] = await Promise.all([
    can(me, "canViewCalendar")
      ? prisma.event.findMany({
          where: {
            OR: [
              { recurrenceFrequency: null, startAt: { gte: now, lte: in7 } },
              { recurrenceFrequency: { not: null } },
            ],
          },
          // Cap at 500 to bound work on a busy calendar; expandOccurrences
          // then narrows further.
          take: 500,
          orderBy: { startAt: "asc" },
          include: {
            participants: {
              include: { user: { select: { name: true, color: true, avatarEmoji: true } } },
            },
          },
        })
      : [],
    can(me, "canViewTodos")
      ? prisma.todo.count({ where: { done: false } })
      : 0,
    can(me, "canViewShopping")
      ? prisma.shoppingItem.count({ where: { done: false } })
      : 0,
    prisma.user.count(),
  ]);

  // Build the Coming Up list by expanding each row's occurrences and
  // sorting by the actual upcoming instant. Take the soonest 5.
  type EventRow = (typeof eventRows)[number];
  interface ComingUp {
    row: EventRow;
    occurrenceAt: Date;
  }
  const upcoming: ComingUp[] = [];
  for (const ev of eventRows) {
    const rule = ruleFromRow(ev);
    if (!rule) {
      upcoming.push({ row: ev, occurrenceAt: ev.startAt });
      continue;
    }
    const occs = expandOccurrences(
      { id: ev.id, startAt: ev.startAt, endAt: ev.endAt, recurrence: rule },
      now,
      in7,
    );
    for (const o of occs) {
      upcoming.push({ row: ev, occurrenceAt: o.occurrenceStart });
    }
  }
  upcoming.sort((a, b) => a.occurrenceAt.getTime() - b.occurrenceAt.getTime());
  const upcomingTop = upcoming.slice(0, 5);
  const upcomingCount = upcoming.length;

  return (
    <div className="space-y-6">
      {/* v4.7.17 — keeps the dashboard counts + "Coming Up" event list fresh
          without a manual reload. Refreshes on mount, tab focus, and every
          60 s while visible. Hidden tabs don't poll. */}
      <AutoRefresher intervalMs={60_000} />
      <div>
        <h1 className="text-3xl font-bold">Hi, {me.name} 👋</h1>
        <p className="muted">Here's what's happening in your household.</p>
      </div>

      {settings.weatherEnabled && settings.weatherShowOnHome && <WeatherWidget />}

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <StatCard
          href="/calendar"
          icon={<CalendarDays size={20} />}
          label="Next 7 days"
          value={`${upcomingCount} event${upcomingCount === 1 ? "" : "s"}`}
          tint="linear-gradient(135deg,#8338ec,#3a86ff)"
        />
        <StatCard
          href="/todos"
          icon={<CheckSquare size={20} />}
          label="Open to-dos"
          value={`${openTodos}`}
          tint="linear-gradient(135deg,#06d6a0,#2bd9fe)"
        />
        <StatCard
          href="/shopping"
          icon={<ShoppingCart size={20} />}
          label="Shopping list"
          value={`${shoppingOpen} item${shoppingOpen === 1 ? "" : "s"}`}
          tint="linear-gradient(135deg,#ff8a3d,#ffd23f)"
        />
        <StatCard
          href={me.role === "PARENT" ? "/family" : "/dashboard"}
          icon={<Users size={20} />}
          label="Family members"
          value={`${userCount}`}
          tint="linear-gradient(135deg,#f15bb5,#ff006e)"
        />
      </div>

      {/* v4.9.2 — family sticky-notes board ("fridge magnets"). Hidden
          when the notes module is off (globally or on this kiosk). */}
      {showNotesWidget && <NotesWidget />}

      {can(me, "canViewCalendar") && (
        <section className="card p-5">
          <div className="flex items-center justify-between mb-3">
            <h2 className="font-bold text-lg">Coming Up</h2>
            <Link href="/calendar" className="text-sm muted hover:underline">
              Open Calendar →
            </Link>
          </div>
          {upcomingTop.length === 0 ? (
            <p className="muted text-sm">Nothing scheduled for the next 7 days.</p>
          ) : (
            <ul className="divide-y divide-[rgb(var(--border))]">
              {upcomingTop.map((u, i) => {
                const e = u.row;
                return (
                  <li
                    // v4.9.9 — composite key (event id + ISO occurrence)
                    // so a recurring event with multiple occurrences in
                    // the next 7 days renders as distinct rows without
                    // React key-collision warnings.
                    key={`${e.id}:${u.occurrenceAt.toISOString()}:${i}`}
                    className="py-3 flex items-center gap-3"
                  >
                    <div
                      className="w-2 self-stretch rounded-full"
                      style={{ background: eventPrimaryColor(e) }}
                    />
                    <div className="flex-1 min-w-0">
                      <div className="font-semibold truncate">{e.title}</div>
                      <div className="text-sm muted">
                        {u.occurrenceAt.toLocaleString(undefined, {
                          weekday: "short",
                          day: "numeric",
                          month: "short",
                          hour: e.allDay ? undefined : "numeric",
                          minute: e.allDay ? undefined : "2-digit",
                          // v4.7.15 — force the app's configured TZ so a
                          // UTC-clocked container doesn't render a Sunday
                          // 8am AEST event as "Sat 10pm" the night before.
                          timeZone: settings.timezone || undefined,
                        })}
                        {e.location ? ` · ${e.location}` : ""}
                      </div>
                    </div>
                    <div className="flex -space-x-2">
                      {e.participants.slice(0, 4).map((p: { id: string; user: { name: string; color: string; avatarEmoji: string } }) => (
                        <div
                          key={p.id}
                          title={p.user.name}
                          className="w-7 h-7 rounded-full flex items-center justify-center text-sm border"
                          style={{
                            background: p.user.color + "33",
                            borderColor: p.user.color,
                          }}
                        >
                          {p.user.avatarEmoji}
                        </div>
                      ))}
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      )}
    </div>
  );
}

function StatCard({
  icon,
  label,
  value,
  href,
  tint,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  href: string;
  tint: string;
}) {
  return (
    <Link href={href} className="card p-4 hover:shadow-lg transition block">
      <div
        className="w-10 h-10 rounded-xl flex items-center justify-center text-white mb-3"
        style={{ background: tint }}
      >
        {icon}
      </div>
      <div className="text-2xl font-bold">{value}</div>
      <div className="text-sm muted">{label}</div>
    </Link>
  );
}
