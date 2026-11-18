import { useAuth } from "../lib/auth";

export default function Header() {
  const { user, logout } = useAuth();
  return (
    <header className="z-[1000] flex items-center justify-between gap-3 bg-brand-purple px-4 py-3 text-white shadow-md">
      <div className="min-w-0">
        <h1 className="text-lg font-semibold tracking-wide">
          WAYRA <span className="text-brand-teal">–</span> SafeRoute
        </h1>
        <p className="hidden text-xs text-white/70 sm:block">Pilot: Chicago (data-available city)</p>
      </div>
      {user && (
        <div className="flex min-w-0 items-center gap-3">
          <span className="truncate text-sm" title={user.email}>
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
