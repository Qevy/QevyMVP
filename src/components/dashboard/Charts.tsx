import { cn } from "@/lib/ui";

/**
 * Small SVG charts, drawn directly rather than pulling in a charting library:
 * three shapes, all fed by a handful of numbers, and none of them need the
 * axes, tooltips, or legends a library exists to provide.
 */

export function DonutRing({
  percent,
  label,
  caption,
}: {
  percent: number | null;
  label: string;
  caption: string;
}) {
  const size = 132;
  const stroke = 12;
  const radius = (size - stroke) / 2;
  const circumference = 2 * Math.PI * radius;
  const filled = ((percent ?? 0) / 100) * circumference;

  return (
    <div className="relative shrink-0" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90">
        <defs>
          <linearGradient id="ring" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor="#5b8def" />
            <stop offset="100%" stopColor="#7c5cff" />
          </linearGradient>
        </defs>
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke="var(--color-surface-3)"
          strokeWidth={stroke}
        />
        {percent !== null && (
          <circle
            cx={size / 2}
            cy={size / 2}
            r={radius}
            fill="none"
            stroke="url(#ring)"
            strokeWidth={stroke}
            strokeLinecap="round"
            strokeDasharray={`${filled} ${circumference}`}
          />
        )}
      </svg>
      <div className="absolute inset-0 grid place-items-center text-center">
        <div>
          <p className="tabular text-2xl font-semibold text-text">{label}</p>
          <p className="text-[11px] text-text-dim">{caption}</p>
        </div>
      </div>
    </div>
  );
}

export type DayBar = { label: string; hours: number; isToday: boolean };

export function WeekBars({
  days,
  target,
}: {
  days: DayBar[];
  target: number;
}) {
  const ceiling = Math.max(target * 1.5, ...days.map((d) => d.hours), 4);
  const ticks = [0, ceiling / 4, ceiling / 2, (ceiling * 3) / 4, ceiling];

  return (
    <div className="flex gap-3">
      <div className="flex flex-col justify-between py-1 text-[10px] text-text-faint">
        {[...ticks].reverse().map((tick) => (
          <span key={tick} className="tabular">
            {Math.round(tick)}
          </span>
        ))}
      </div>

      <div className="relative flex-1">
        {/* Target line — the only dashed rule on the page, so it reads as a goal. */}
        <div
          className="absolute inset-x-0 border-t border-dashed border-line-strong"
          style={{ bottom: `${(target / ceiling) * 100}%` }}
        >
          <span className="absolute -top-5 right-0 text-[10px] text-text-faint">
            Daily target {target}
          </span>
        </div>

        <div className="flex h-[150px] items-end gap-2">
          {days.map((day) => {
            const height = Math.max(2, (day.hours / ceiling) * 100);
            return (
              <div key={day.label} className="flex flex-1 flex-col items-center gap-2">
                <div
                  className="w-full rounded-md transition-all"
                  style={{
                    height: `${height}%`,
                    background: day.isToday
                      ? "linear-gradient(180deg,#5b8def,#7c5cff)"
                      : day.hours > 0
                        ? "linear-gradient(180deg,#f59e0b,#ec4899)"
                        : "var(--color-surface-3)",
                  }}
                />
              </div>
            );
          })}
        </div>

        <div className="mt-2 flex gap-2">
          {days.map((day) => (
            <span
              key={day.label}
              className={cn(
                "flex-1 text-center text-[11px]",
                day.isToday ? "text-text" : "text-text-faint",
              )}
            >
              {day.label}
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}

export function Sparkline({ points }: { points: number[] }) {
  if (points.length < 2) {
    return <div className="h-16 rounded-lg bg-surface-2" />;
  }

  const width = 260;
  const height = 64;
  const max = Math.max(...points, 1);
  const min = Math.min(...points, 0);
  const span = max - min || 1;

  const coords = points.map((value, i) => {
    const x = (i / (points.length - 1)) * width;
    const y = height - ((value - min) / span) * (height - 8) - 4;
    return [x, y] as const;
  });

  // Smooth the line with midpoint quadratics — a productivity trend is not
  // a set of hard corners.
  let d = `M ${coords[0][0]} ${coords[0][1]}`;
  for (let i = 1; i < coords.length; i++) {
    const [px, py] = coords[i - 1];
    const [cx, cy] = coords[i];
    d += ` Q ${px} ${py} ${(px + cx) / 2} ${(py + cy) / 2}`;
  }
  d += ` T ${coords[coords.length - 1][0]} ${coords[coords.length - 1][1]}`;

  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      className="h-16 w-full"
      preserveAspectRatio="none"
      aria-hidden
    >
      <defs>
        <linearGradient id="spark" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0%" stopColor="#5b8def" />
          <stop offset="100%" stopColor="#a855f7" />
        </linearGradient>
      </defs>
      <path d={d} fill="none" stroke="url(#spark)" strokeWidth="2.5" strokeLinecap="round" />
    </svg>
  );
}
