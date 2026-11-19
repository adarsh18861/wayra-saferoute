import { LoaderCircle } from "lucide-react";
import { MotionConfig } from "motion/react";
import { lazy, Suspense, type ReactNode } from "react";
import { BrowserRouter, Navigate, Route, Routes, useLocation } from "react-router";
import Header from "./components/Header";
import SOSButton from "./components/SOSButton";
import { LogoMark } from "./components/ui/Logo";
import { AuthProvider, useAuth } from "./lib/auth";
import LandingPage from "./pages/LandingPage";

// Route-level code splitting: Leaflet and the map UI load only on /app.
const LoginPage = lazy(() => import("./pages/LoginPage"));
const RegisterPage = lazy(() => import("./pages/RegisterPage"));
const MapPage = lazy(() => import("./pages/MapPage"));
const ModelCardPage = lazy(() => import("./pages/ModelCardPage"));
const TrackPage = lazy(() => import("./pages/TrackPage"));

function FullScreenLoading() {
  return (
    <div role="status" className="flex h-full flex-col items-center justify-center gap-4 bg-canvas text-ink-soft">
      <LogoMark className="h-12 w-12" />
      <span className="flex items-center gap-2 text-sm">
        <LoaderCircle className="h-4 w-4 animate-spin" aria-hidden /> Loading…
      </span>
    </div>
  );
}

function RequireAuth({ children }: { children: ReactNode }) {
  const { user, loading } = useAuth();
  const location = useLocation();
  if (loading) return <FullScreenLoading />;
  if (!user) return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  return children;
}

function GuestOnly({ children }: { children: ReactNode }) {
  const { user, loading } = useAuth();
  if (loading) return <FullScreenLoading />;
  if (user) return <Navigate to="/app" replace />;
  return children;
}

/** Signed-in layout: app navbar, page, and the always-visible SOS button. */
function Shell({ children, scroll = false }: { children: ReactNode; scroll?: boolean }) {
  return (
    <div className="flex h-full flex-col">
      <Header />
      <main id="main" className={`relative flex-1 ${scroll ? "overflow-y-auto" : "overflow-hidden"}`}>
        {children}
      </main>
      <SOSButton />
    </div>
  );
}

export default function App() {
  return (
    <MotionConfig reducedMotion="user">
      <AuthProvider>
        <BrowserRouter>
          <Suspense fallback={<FullScreenLoading />}>
          <Routes>
            <Route path="/" element={<LandingPage />} />
            <Route path="/login" element={<GuestOnly><LoginPage /></GuestOnly>} />
            <Route path="/register" element={<GuestOnly><RegisterPage /></GuestOnly>} />
            <Route path="/app" element={<RequireAuth><Shell><MapPage /></Shell></RequireAuth>} />
            <Route path="/model" element={<RequireAuth><Shell scroll><ModelCardPage /></Shell></RequireAuth>} />
            <Route path="/model-card" element={<Navigate to="/model" replace />} />
            <Route path="/track/:token" element={<TrackPage />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
          </Suspense>
        </BrowserRouter>
      </AuthProvider>
    </MotionConfig>
  );
}
