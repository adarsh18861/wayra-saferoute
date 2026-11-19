import { NavLink } from "react-router";
import { useAuth } from "../lib/auth";

function navClass({ isActive }: { isActive: boolean }): string {
  return `rounded-full px-3 py-1.5 text-sm font-medium transition focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-teal ${
    isActive ? "bg-white/15 text-white" : "text-white/75 hover:bg-white/10 hover:text-white"
  }`;
}

export default function Header() {
  const { user, logout } = useAuth();
  return (
    <header className="relative z-[1100] flex items-center justify-between gap-2 bg-brand-purple px-3 py-2.5 text-white shadow-md sm:px-4">
      <div className="flex min-w-0 items-center gap-2">
        <div aria-hidden className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-brand-teal font-bold text-brand-purple">
          W
        </div>
        <div className="min-w-0 leading-tight">
          <h1 className="text-base font-semibold tracking-wide sm:text-lg">
            WAYRA <span className="hidden font-normal text-brand-teal-light sm:inline">SafeRoute</span>
          </h1>
          <p className="truncate text-[11px] text-brand-teal-light">
            Pilot: Chicago<span className="hidden sm:inline"> (data-available city)</span>
          </p>
        </div>
      </div>
      <nav aria-label="Main" className="flex items-center gap-1">
        <NavLink to="/" end className={navClass}>
          Map
        </NavLink>
        <NavLink to="/model-card" className={navClass}>
          Model card
        </NavLink>
      </nav>
      {user && (
        <div className="flex min-w-0 items-center gap-2">
          <span className="hidden truncate text-sm md:inline" title={user.email}>
            Hi, <span className="font-semibold">{user.name}</span>
          </span>
          <button
            type="button"
            onClick={logout}
            className="shrink-0 rounded-full border border-white/30 px-3 py-1 text-sm transition hover:bg-white/10"
          >
            Log out
          </button>
        </div>
      )}
    </header>
  );
}
