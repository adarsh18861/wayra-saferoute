import { Share2 } from "lucide-react";
import { LinkButton } from "../components/ui/Button";
import Logo from "../components/ui/Logo";

/** Public trip-share viewer. Placeholder: live tracking over WebSocket arrives in a later phase. */
export default function TrackPage() {
  return (
    <div className="flex min-h-full flex-col items-center justify-center gap-6 bg-canvas px-4 text-center">
      <Logo />
      <div className="max-w-md rounded-3xl bg-white p-8 shadow-[var(--shadow-card)] ring-1 ring-line">
        <span className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-brand-50 text-brand-700">
          <Share2 className="h-6 w-6" aria-hidden />
        </span>
        <h1 className="mt-4 text-2xl font-bold text-ink">Live trip sharing is coming soon</h1>
        <p className="mt-2 text-sm text-ink-soft">
          When it launches, this link will show a friend's walk in real time until they arrive safely.
        </p>
        <LinkButton to="/" variant="primary" className="mt-6">
          Learn about WAYRA
        </LinkButton>
      </div>
    </div>
  );
}
