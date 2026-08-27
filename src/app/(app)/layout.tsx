import { Sidebar, MobileBar, Logo } from "@/components/Sidebar";
import { SearchIcon, BellIcon } from "@/components/icons";
import { requireUser } from "@/lib/auth";

export default async function AppLayout({ children }: LayoutProps<"/">) {
  const user = await requireUser();
  const initial = (user.email?.[0] ?? "H").toUpperCase();

  return (
    <div className="min-h-full">
      <Sidebar initial={initial} />

      {/* Phone header: the sidebar's identity, without the sidebar. */}
      <div className="flex items-center justify-between border-b border-line px-5 py-3.5 lg:hidden">
        <Logo />
        <div className="flex items-center gap-1">
          <IconButton label="Search">
            <SearchIcon className="size-[18px]" />
          </IconButton>
          <IconButton label="Notifications">
            <BellIcon className="size-[18px]" />
          </IconButton>
          <span className="ml-1 grid size-8 place-items-center rounded-full bg-surface-2 text-xs font-medium text-text-dim">
            {initial}
          </span>
        </div>
      </div>

      <div className="pb-28 lg:pb-0 lg:pl-[200px]">{children}</div>

      <MobileBar />
    </div>
  );
}

function IconButton({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      className="grid size-9 place-items-center rounded-full text-text-dim transition hover:bg-surface hover:text-text"
    >
      {children}
    </button>
  );
}
