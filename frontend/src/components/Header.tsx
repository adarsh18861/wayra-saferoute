import { BrainCircuit, ChevronDown, History, LogOut, Map as MapIcon, Mic, PhoneIncoming, Users, WifiOff } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { startTransition, useEffect, useId, useRef, useState } from "react";
import { Link, NavLink, useNavigate } from "react-router";
import { useOnlineStatus } from "../hooks/useOnlineStatus";
import { useAuth } from "../lib/auth";
import { useSafety } from "../lib/safety";
import { VoiceListeningPill } from "./VoiceSOS";
import Logo, { LogoMark } from "./ui/Logo";

function navClass({ isActive }: { isActive: boolean }): string {
  return `relative inline-flex items-center gap-1.5 rounded-lg px-2.5 py-2 text-sm font-semibold transition sm:px-3 ${
    isActive ? "bg-brand-50 text-brand-800" : "text-ink-soft hover:bg-brand-50/60 hover:text-brand-800"
  }`;
}

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  return ((parts[0]?.[0] ?? "") + (parts.length > 1 ? parts[parts.length - 1][0] : "")).toUpperCase() || "?";
}

/** Avatar button with a small menu (name, email, Log out). */
function UserMenu() {
  const { user, logout } = useAuth();
  const { voice, setVoiceEnabled, openFakeCallSetup } = useSafety();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const itemRef = useRef<HTMLButtonElement>(null);
  const menuId = useId();
  useEffect(() => {
    if (!open) return;
    itemRef.current?.focus();
    const onDown = (e: PointerEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("pointerdown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);
  if (!user) return null;
  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={menuId}
        aria-label={`Account menu for ${user.name}`}
        onClick={() => setOpen((o) => !o)}
        className="flex items-center gap-2 rounded-full py-1 pl-1 pr-2 transition hover:bg-brand-50"
      >
        <span className="flex h-9 w-9 items-center justify-center rounded-full bg-gradient-to-br from-brand-500 to-brand-800 font-display text-sm font-bold text-white ring-2 ring-white">
          {initials(user.name)}
        </span>
        <span className="hidden max-w-[10rem] truncate text-sm font-semibold text-ink md:inline">{user.name}</span>
        <ChevronDown className={`h-4 w-4 text-ink-soft transition ${open ? "rotate-180" : ""}`} aria-hidden />
      </button>
      <AnimatePresence>
        {open && (
          <motion.div
            id={menuId}
            role="menu"
            initial={{ opacity: 0, y: -6, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -6, scale: 0.98 }}
            transition={{ duration: 0.15 }}
            className="absolute right-0 top-full z-[1500] mt-2 w-64 origin-top-right rounded-2xl bg-white p-2 shadow-[var(--shadow-lift)] ring-1 ring-line"
          >
            <div className="px-3 py-2">
              <p className="truncate text-sm font-semibold text-ink">{user.name}</p>
              <p className="truncate text-xs text-ink-soft">{user.email}</p>
            </div>
            <div className="my-1 h-px bg-line" />
            {[
              { to: "/contacts", icon: Users, label: "Trusted contacts" },
              { to: "/sos", icon: History, label: "SOS history" },
            ].map(({ to, icon: Icon, label }) => (
              <Link
                key={to}
                to={to}
                role="menuitem"
                onClick={() => setOpen(false)}
                className="flex w-full items-center gap-2 rounded-xl px-3 py-2.5 text-sm font-medium text-ink transition hover:bg-brand-50 focus-visible:bg-brand-50"
              >
                <Icon className="h-4 w-4 text-ink-soft" aria-hidden /> {label}
              </Link>
            ))}
            <button
              type="button"
              role="menuitem"
              onClick={() => {
                setOpen(false);
                openFakeCallSetup();
              }}
              className="flex w-full items-center gap-2 rounded-xl px-3 py-2.5 text-sm font-medium text-ink transition hover:bg-brand-50 focus-visible:bg-brand-50"
            >
              <PhoneIncoming className="h-4 w-4 text-ink-soft" aria-hidden /> Fake call
            </button>
            <button
              type="button"
              role="menuitemcheckbox"
              aria-checked={voice.enabled}
              onClick={() => setVoiceEnabled(!voice.enabled)}
              className="flex w-full items-center gap-2 rounded-xl px-3 py-2.5 text-left text-sm font-medium text-ink transition hover:bg-brand-50 focus-visible:bg-brand-50"
            >
              <Mic className="h-4 w-4 shrink-0 text-ink-soft" aria-hidden />
              <span className="flex-1">
                Voice SOS
                <span className="block text-xs font-normal text-ink-soft">
                  {voice.supported ? "Say “help help” or “WAYRA help”" : "Needs Chrome or Edge"}
                </span>
              </span>
              <span className={`relative h-5 w-9 shrink-0 rounded-full transition ${voice.enabled ? "bg-brand-700" : "bg-slate-300"}`} aria-hidden>
                <span className={`absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition-all ${voice.enabled ? "left-[1.125rem]" : "left-0.5"}`} />
              </span>
            </button>
            {voice.error && <p className="px-3 pb-1 text-xs text-red-700">{voice.error}</p>}
            <div className="my-1 h-px bg-line" />
            <button
              ref={itemRef}
              type="button"
              role="menuitem"
              onClick={() => {
                // One transition, so the route guard never sees "logged out" while still on /app
                // (that would redirect to /login instead of home).
                startTransition(() => {
                  navigate("/", { replace: true });
                  logout();
                });
              }}
              className="flex w-full items-center gap-2 rounded-xl px-3 py-2.5 text-sm font-medium text-ink transition hover:bg-brand-50 focus-visible:bg-brand-50"
            >
              <LogOut className="h-4 w-4 text-ink-soft" aria-hidden /> Log out
            </button>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function OfflineBadge() {
  const online = useOnlineStatus();
  if (online) return null;
  return (
    <span
      role="status"
      title="You're offline. SOS will open your SMS app with your last known location."
      className="inline-flex items-center gap-1.5 rounded-full bg-amber-100 px-2.5 py-1 text-xs font-semibold text-amber-900 ring-1 ring-amber-300"
    >
      <WifiOff className="h-3.5 w-3.5" aria-hidden />
      <span className="hidden sm:inline">Offline</span>
      <span className="sr-only sm:hidden">Offline</span>
    </span>
  );
}

/** App navbar: logo, Map · Contacts · AI Model, status pills, avatar menu. */
export default function Header() {
  return (
    <header className="relative z-[1100] flex h-16 shrink-0 items-center justify-between gap-2 border-b border-line bg-white/90 px-3 backdrop-blur-xl sm:px-5">
      <Link to="/" aria-label="WAYRA home" className="rounded-lg">
        <span className="sm:hidden">
          <LogoMark className="h-9 w-9" />
        </span>
        <span className="hidden sm:inline lg:hidden">
          <Logo sub="Pilot: Chicago" />
        </span>
        <span className="hidden lg:inline">
          <Logo sub="Pilot: Chicago (data-available city)" />
        </span>
      </Link>
      <nav aria-label="App" className="flex items-center gap-1">
        <NavLink to="/app" end className={navClass} aria-label="Map">
          <MapIcon className="h-4 w-4 md:hidden" aria-hidden />
          <span className="hidden md:inline">Map</span>
        </NavLink>
        <NavLink to="/contacts" className={navClass} aria-label="Contacts">
          <Users className="h-4 w-4 md:hidden" aria-hidden />
          <span className="hidden md:inline">Contacts</span>
        </NavLink>
        <NavLink to="/model" className={navClass} aria-label="AI Model">
          <BrainCircuit className="h-4 w-4 md:hidden" aria-hidden />
          <span className="hidden md:inline">AI Model</span>
        </NavLink>
      </nav>
      <div className="flex items-center gap-1.5 sm:gap-2">
        <OfflineBadge />
        <VoiceListeningPill />
        <UserMenu />
      </div>
    </header>
  );
}
