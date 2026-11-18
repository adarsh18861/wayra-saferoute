export default function Header() {
  return (
    <header className="z-[1000] flex items-center justify-between bg-brand-purple px-4 py-3 text-white shadow-md">
      <h1 className="text-lg font-semibold tracking-wide">
        WAYRA <span className="text-brand-teal">–</span> SafeRoute
      </h1>
      <span className="rounded-full bg-white/10 px-3 py-1 text-xs">
        Pilot: Chicago (data-available city)
      </span>
    </header>
  );
}
