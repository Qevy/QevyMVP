"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/ui";
import {
  HomeIcon,
  TodayIcon,
  WeekIcon,
  PlanIcon,
  CheckinIcon,
  PatternsIcon,
  SettingsIcon,
  PlusIcon,
  MoonIcon,
} from "./icons";

const NAV = [
  { href: "/", label: "Home", Icon: HomeIcon },
  { href: "/today", label: "Today", Icon: TodayIcon },
  { href: "/week", label: "Week", Icon: WeekIcon },
  { href: "/plan", label: "Plan", Icon: PlanIcon },
  { href: "/checkin", label: "Check-in", Icon: CheckinIcon },
  { href: "/patterns", label: "Patterns", Icon: PatternsIcon },
  { href: "/settings", label: "Settings", Icon: SettingsIcon },
] as const;

function isActive(pathname: string, href: string) {
  return href === "/" ? pathname === "/" : pathname.startsWith(href);
}

export function Logo({ withText = true }: { withText?: boolean }) {
  return (
    <span className="flex items-center gap-2.5">
      <span
        aria-hidden
        className="size-7 rounded-full"
        style={{
          background:
            "conic-gradient(from 210deg, #7c5cff, #5b8def, #22c55e, #f59e0b, #ec4899, #7c5cff)",
        }}
      />
      {withText && (
        <span className="text-[17px] font-semibold tracking-tight text-text">
          Planner
        </span>
      )}
    </span>
  );
}

export function Sidebar({ initial }: { initial: string }) {
  const pathname = usePathname();

  return (
    <aside className="fixed inset-y-0 left-0 hidden w-[200px] flex-col border-r border-line bg-bg lg:flex">
      <div className="px-6 py-5">
        <Link href="/">
          <Logo />
        </Link>
      </div>

      <nav className="flex flex-1 flex-col gap-1 px-3" aria-label="Main">
        {NAV.map(({ href, label, Icon }) => {
          const active = isActive(pathname, href);
          return (
            <Link
              key={href}
              href={href}
              aria-current={active ? "page" : undefined}
              className={cn(
                "flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm transition",
                active
                  ? "bg-surface-2 font-medium text-text"
                  : "text-text-dim hover:bg-surface hover:text-text",
              )}
            >
              <Icon className="size-[18px]" />
              {label}
            </Link>
          );
        })}
      </nav>

      <div className="flex flex-col gap-3 p-3">
        <Link
          href="/plan"
          className="flex items-center justify-center gap-2 rounded-xl border border-line-strong bg-surface px-3 py-2.5 text-sm text-text transition hover:bg-surface-2"
        >
          <PlusIcon className="size-4" />
          New task
        </Link>

        <div className="flex items-center justify-between px-1 pb-1">
          <span className="flex items-center gap-2 text-xs text-text-dim">
            <MoonIcon className="size-4" />
            Dark mode
          </span>
          <span className="grid size-7 place-items-center rounded-full bg-surface-2 text-[11px] font-medium text-text-dim">
            {initial}
          </span>
        </div>
      </div>
    </aside>
  );
}

/** Phone: the same destinations as a bottom bar, with Plan as the centre action. */
export function MobileBar() {
  const pathname = usePathname();
  const tabs = [NAV[0], NAV[1], NAV[2], NAV[5]] as const;

  return (
    <nav
      aria-label="Main"
      className="fixed inset-x-0 bottom-0 z-40 border-t border-line bg-bg/95 backdrop-blur lg:hidden"
      style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
    >
      <div className="mx-auto grid max-w-lg grid-cols-5 items-end px-2 pt-2 pb-1.5">
        {tabs.slice(0, 2).map(({ href, label, Icon }) => (
          <Tab key={href} href={href} label={label} Icon={Icon} active={isActive(pathname, href)} />
        ))}

        <div className="flex justify-center">
          <Link
            href="/plan"
            aria-label="Plan"
            className="-mt-6 grid size-14 place-items-center rounded-full text-white shadow-lg transition active:scale-95"
            style={{ background: "linear-gradient(135deg,#7c5cff,#ec4899)" }}
          >
            <PlusIcon className="size-6" />
          </Link>
        </div>

        {tabs.slice(2).map(({ href, label, Icon }) => (
          <Tab key={href} href={href} label={label} Icon={Icon} active={isActive(pathname, href)} />
        ))}
      </div>
    </nav>
  );
}

function Tab({
  href,
  label,
  Icon,
  active,
}: {
  href: string;
  label: string;
  Icon: (p: { className?: string }) => React.ReactElement;
  active: boolean;
}) {
  return (
    <Link
      href={href}
      aria-current={active ? "page" : undefined}
      className={cn(
        "flex flex-col items-center gap-1 py-1.5 text-[10px] transition",
        active ? "text-text" : "text-text-faint",
      )}
    >
      <Icon className="size-5" />
      {label}
    </Link>
  );
}
