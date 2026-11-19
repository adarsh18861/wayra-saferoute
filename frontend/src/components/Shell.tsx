import type { ReactNode } from "react";
import CheckPrompt from "./CheckPrompt";
import FakeCall from "./FakeCall";
import Header from "./Header";
import SOSButton from "./SOSButton";
import Toaster from "./Toaster";

/** Signed-in layout: app navbar, page, the always-visible SOS button and the safety overlays.
 *  Lazy-loaded from App.tsx so none of this ships in the public landing bundle. */
export default function Shell({ children, scroll = false }: { children: ReactNode; scroll?: boolean }) {
  return (
    <div className="flex h-full flex-col">
      <Header />
      <main id="main" className={`relative flex-1 ${scroll ? "overflow-y-auto" : "overflow-hidden"}`}>
        {children}
      </main>
      <SOSButton />
      <CheckPrompt />
      <FakeCall />
      <Toaster />
    </div>
  );
}
