/**
 * One icon set, drawn rather than imported: 24-box, 1.6 stroke, currentColor.
 * Keeping them here means they stay visually consistent and add no dependency.
 */

type Props = { className?: string };

const s = {
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.6,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
};

function Svg({ className, children }: Props & { children: React.ReactNode }) {
  return (
    <svg viewBox="0 0 24 24" className={className} aria-hidden>
      {children}
    </svg>
  );
}

export const HomeIcon = (p: Props) => (
  <Svg {...p}>
    <path {...s} d="M3.5 10 12 3.5l8.5 6.5V19a1.5 1.5 0 0 1-1.5 1.5h-3.5V14h-7v6.5H5A1.5 1.5 0 0 1 3.5 19Z" />
  </Svg>
);

export const TodayIcon = (p: Props) => (
  <Svg {...p}>
    <rect {...s} x="3.5" y="5" width="17" height="15.5" rx="3" />
    <path {...s} d="M3.5 9.5h17M8 3.5v3M16 3.5v3" />
    <path {...s} d="M9 14.5l2 2 4-4" />
  </Svg>
);

export const WeekIcon = (p: Props) => (
  <Svg {...p}>
    <rect {...s} x="3.5" y="5" width="17" height="15.5" rx="3" />
    <path {...s} d="M3.5 9.5h17M8 3.5v3M16 3.5v3" />
    <path {...s} d="M9 13h6M9 17h4" opacity="0.7" />
  </Svg>
);

export const PlanIcon = (p: Props) => (
  <Svg {...p}>
    <rect {...s} x="4" y="3.5" width="16" height="17" rx="3" />
    <path {...s} d="M8.5 8.5h7M8.5 12.5h7M8.5 16.5h4" />
  </Svg>
);

export const CheckinIcon = (p: Props) => (
  <Svg {...p}>
    <path {...s} d="M4 6.5A2.5 2.5 0 0 1 6.5 4h11A2.5 2.5 0 0 1 20 6.5v7a2.5 2.5 0 0 1-2.5 2.5H9l-5 4Z" />
    <path {...s} d="M9 10h6" />
  </Svg>
);

export const PatternsIcon = (p: Props) => (
  <Svg {...p}>
    <path {...s} d="M3.5 17c3 0 3.5-8 6.5-8s3.5 8 6.5 8 3.5-4.5 3.5-4.5" />
    <circle cx="10" cy="9" r="1.6" fill="currentColor" stroke="none" />
  </Svg>
);

export const SettingsIcon = (p: Props) => (
  <Svg {...p}>
    <circle {...s} cx="12" cy="12" r="3" />
    <path
      {...s}
      d="M12 3.5v2M12 18.5v2M20.5 12h-2M5.5 12h-2M18 6l-1.5 1.5M7.5 16.5 6 18M18 18l-1.5-1.5M7.5 7.5 6 6"
    />
  </Svg>
);

export const PlusIcon = (p: Props) => (
  <Svg {...p}>
    <path {...s} d="M12 5v14M5 12h14" />
  </Svg>
);

export const MoonIcon = (p: Props) => (
  <Svg {...p}>
    <path {...s} d="M20 13.5A8 8 0 0 1 10.5 4a8 8 0 1 0 9.5 9.5Z" />
  </Svg>
);

export const SearchIcon = (p: Props) => (
  <Svg {...p}>
    <circle {...s} cx="11" cy="11" r="6.5" />
    <path {...s} d="m16 16 4 4" />
  </Svg>
);

export const BellIcon = (p: Props) => (
  <Svg {...p}>
    <path {...s} d="M6.5 10a5.5 5.5 0 0 1 11 0c0 4 1.5 5.5 1.5 5.5H5S6.5 14 6.5 10Z" />
    <path {...s} d="M10 19a2 2 0 0 0 4 0" />
  </Svg>
);

export const SparkleIcon = (p: Props) => (
  <Svg {...p}>
    <path
      d="M12 3.5 13.6 9l5.4 1.6-5.4 1.6L12 17.6l-1.6-5.4L5 10.6 10.4 9Z"
      fill="currentColor"
    />
    <path d="M18.5 4 19 5.9l1.9.6-1.9.6-.5 1.9-.6-1.9-1.9-.6 1.9-.6Z" fill="currentColor" opacity="0.75" />
  </Svg>
);

export const MicIcon = (p: Props) => (
  <Svg {...p}>
    <rect {...s} x="9" y="3" width="6" height="11" rx="3" />
    <path {...s} d="M5.5 11.5a6.5 6.5 0 0 0 13 0M12 18v3" />
  </Svg>
);

export const ArrowRightIcon = (p: Props) => (
  <Svg {...p}>
    <path {...s} d="M5 12h14M13 6l6 6-6 6" />
  </Svg>
);

export const ChevronRightIcon = (p: Props) => (
  <Svg {...p}>
    <path {...s} d="m9.5 6 6 6-6 6" />
  </Svg>
);

export const BarsIcon = (p: Props) => (
  <Svg {...p}>
    <path {...s} d="M5 19v-6M12 19V5M19 19v-9" />
  </Svg>
);

export const FlameIcon = (p: Props) => (
  <Svg {...p}>
    <path
      d="M12 3s1 3-1 5.5C9 11 7 12 7 15a5 5 0 0 0 10 0c0-2-1-3.5-2-5 0 1.5-.8 2.5-1.5 2.5S12 11 12 9c0-2 0-4 0-6Z"
      fill="currentColor"
    />
  </Svg>
);
