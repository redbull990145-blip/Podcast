import { SectionLabel } from "@/components/ui/page";
import { formatBytes, formatHours } from "@/lib/stats/summarise";
import type { DashboardStats } from "@/lib/stats/listening";

function Card({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="elev-card rounded-app-lg p-5">
      <SectionLabel>{label}</SectionLabel>
      {children}
    </div>
  );
}

function Figure({ value, unit }: { value: string; unit?: string }) {
  return (
    <p className="mt-3 text-[34px] font-semibold leading-none -tracking-[0.03em] tabular-nums">
      {value}
      {unit && (
        <span className="ml-1 text-[15px] font-medium text-subtle">{unit}</span>
      )}
    </p>
  );
}

function Note({ children }: { children: React.ReactNode }) {
  return (
    <p className="mt-3.5 text-[12.5px] leading-relaxed text-subtle">{children}</p>
  );
}

/**
 * The week at a glance.
 *
 * Every number is measured, and where one cannot be measured honestly it is not
 * shown — a card whose data has not accumulated yet says so rather than
 * displaying a zero that looks like a failure.
 */
export function StatCards({ stats }: { stats: DashboardStats }) {
  const {
    weekSeconds,
    daily,
    completedThisWeek,
    completedLastWeek,
    categories,
    downloadCount,
    downloadBytes,
  } = stats;

  const completionDelta = completedThisWeek - completedLastWeek;
  const peak = Math.max(...daily.map((d) => d.seconds), 1);

  return (
    <div className="mt-4 grid gap-3.5 sm:grid-cols-2 lg:grid-cols-4">
      <Card label="This week">
        <Figure value={formatHours(weekSeconds)} unit="hrs" />

        {/*
          Seven bars, one per day, scaled against the busiest rather than
          against a fixed ceiling — the shape of the week is the point, not the
          absolute height. Days with nothing on them still draw a stub in the
          track colour so the row reads as a full week with gaps rather than as
          a chart that lost its axis.
        */}
        <div className="mt-3.5 flex h-[34px] items-end gap-[5px]">
          {daily.map((day) => {
            const filled = day.seconds > 0;
            return (
              <span
                key={day.date}
                title={`${day.label} · ${formatHours(day.seconds)} hrs`}
                className={`flex-1 rounded-[3px] ${
                  filled ? "bg-accent-subtle-2" : "bg-track"
                }`}
                style={{
                  height: filled ? `${Math.max(12, (day.seconds / peak) * 100)}%` : "18%",
                }}
              />
            );
          })}
        </div>
      </Card>

      <Card label="Completed">
        <Figure value={String(completedThisWeek)} />
        <Note>
          {completedLastWeek === 0 && completedThisWeek === 0
            ? "Nothing finished yet this week."
            : completionDelta === 0
              ? "The same as the week before."
              : completionDelta > 0
                ? `${completionDelta} more than the week before.`
                : `${Math.abs(completionDelta)} fewer than the week before.`}
        </Note>
      </Card>

      <Card label="Most time in">
        {categories.length === 0 ? (
          <>
            <p className="mt-3 text-[22px] font-semibold leading-tight -tracking-[0.02em] text-subtle">
              —
            </p>
            <Note>A week of listening is enough to work this out.</Note>
          </>
        ) : (
          <>
            <p className="mt-3 line-clamp-1 text-[22px] font-semibold leading-tight -tracking-[0.02em]">
              {categories[0].name}
            </p>
            <div className="mt-3.5 flex flex-col gap-2">
              {categories.map((category, i) => (
                <div key={category.name} className="flex items-center gap-2">
                  <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-track">
                    <span
                      className={`block h-full rounded-full ${
                        i === 0 ? "bg-accent" : i === 1 ? "bg-clay" : "bg-faint-2"
                      }`}
                      style={{ width: `${Math.round(category.share * 100)}%` }}
                    />
                  </span>
                  <span className="w-8 shrink-0 text-right text-[11px] tabular-nums text-subtle">
                    {Math.round(category.share * 100)}%
                  </span>
                </div>
              ))}
            </div>
          </>
        )}
      </Card>

      <Card label="Saved offline">
        <Figure value={String(downloadCount)} />
        <Note>
          {downloadCount === 0
            ? "Nothing downloaded on this device yet."
            : `${formatBytes(downloadBytes)} across ${
                downloadCount === 1 ? "one episode" : `${downloadCount} episodes`
              }.`}
        </Note>
      </Card>
    </div>
  );
}
