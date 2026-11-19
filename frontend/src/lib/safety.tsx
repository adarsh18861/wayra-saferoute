/**
 * Live safety state for the signed-in app (Phases 6-7), shared by every page:
 * trusted contacts, the active trip, location (real GPS or the DEMO MODE walker), the user
 * WebSocket, deviation check-ins, SOS, voice SOS, fake call and toasts.
 *
 * It sits above the routes so a trip keeps running while the user moves between Map, Contacts
 * and SOS history. It is inert while nobody is signed in.
 */
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useWebSocket, type SocketState } from "../hooks/useWebSocket";
import {
  ApiError,
  answerCheckApi,
  endTripApi,
  getActiveTrip,
  getToken,
  imSafeApi,
  inChicago,
  listContacts,
  osmLink,
  recheckTrip,
  rerouteTrip,
  resolveSOS as resolveSOSApi,
  setTripDemo,
  sosHistory,
  startTripApi,
  triggerSOS as triggerSOSApi,
  wsUrl,
  type Alert,
  type Contact,
  type Place,
  type RouteOption,
  type RouteSegment,
  type SaferRoute,
  type SOSRecord,
  type Trip,
} from "./api";
import { useAuth } from "./auth";
import { RouteLine, WALK_M_PER_S, type LatLng } from "./geo";
import { playChime, playTick, startRingtone, unlockAudio, vibrate } from "./sound";
import { useVoiceSOS, type VoiceState } from "./voice";

// ------------------------------------------------------------------ types
export type Position = { lat: number; lng: number; acc?: number; t: number; sim: boolean };
export type ToastTone = "info" | "success" | "warn" | "danger";
export type Toast = {
  id: number;
  tone: ToastTone;
  title: string;
  text?: string;
  action?: { label: string; run: () => void };
  ttl?: number;
};
export type CheckState = { reason: "off_route" | "stopped"; deadline: number; detail?: number };
export type SOSPhase = "idle" | "countdown" | "sending" | "active";
export type SOSSource = "button" | "voice";
export type SOSState = {
  phase: SOSPhase;
  source: SOSSource;
  record: SOSRecord | null;
  offline: boolean;
  smsUrl: string | null;
  position: Position | null;
};
export type DemoSpeed = 1 | 5 | 20;
/** `autoReason`: why WAYRA switched to demo by itself (outside Chicago, permission denied, no fix); shown in the trip panel. */
export type DemoState = { on: boolean; speed: DemoSpeed; deviating: boolean; stopped: boolean; autoReason?: string | null };
export type FakeCallPhase = "idle" | "scheduled" | "ringing" | "incall";
export type FakeCallState = { phase: FakeCallPhase; caller: string; ringAt: number | null; answeredAt: number | null };
export type TripProgress = { remainingM: number; etaMin: number; offRouteM: number; onRoute: boolean; done: number };
export type SaferSuggestion = { route: SaferRoute; avoided: number; extraMin: number };

type Ctx = {
  contacts: Contact[] | null;
  setContacts: (c: Contact[]) => void;
  refreshContacts: () => Promise<void>;

  trip: Trip | null;
  tripSegments: RouteSegment[] | null;
  startTrip: (route: RouteOption, from: Place | null, to: Place | null, demo: boolean) => Promise<void>;
  endTrip: () => Promise<void>;
  imSafe: () => Promise<void>;
  progress: TripProgress | null;
  socket: SocketState;
  saferRoute: SaferSuggestion | null;
  acceptSaferRoute: () => Promise<void>;
  dismissSaferRoute: () => void;

  position: Position | null;
  locationError: string | null;

  demo: DemoState;
  setDemoOn: (on: boolean) => Promise<void>;
  setDemoSpeed: (s: DemoSpeed) => void;
  toggleDeviation: () => void;
  toggleStop: () => void;

  check: CheckState | null;
  answerCheck: () => void;

  sos: SOSState;
  startSOS: (source: SOSSource) => void;
  cancelSOS: () => void;
  confirmSOS: () => Promise<void>;
  resolveSOS: () => Promise<void>;

  voice: VoiceState;
  setVoiceEnabled: (on: boolean) => void;

  fakeCall: FakeCallState;
  fakeSetupOpen: boolean;
  openFakeCallSetup: () => void;
  closeFakeCallSetup: () => void;
  scheduleFakeCall: (caller: string, delaySec: number) => void;
  acceptFakeCall: () => void;
  endFakeCall: () => void;

  toasts: Toast[];
  notify: (t: Omit<Toast, "id">) => void;
  dismissToast: (id: number) => void;
};

const SafetyContext = createContext<Ctx | null>(null);

// ------------------------------------------------------------------ storage helpers
const CONTACTS_KEY = "wayra.contacts";
const LASTPOS_KEY = "wayra.lastpos";

function load<T>(key: string): T | null {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}
function save(key: string, v: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(v));
  } catch {
    /* storage unavailable */
  }
}

/** Last known position, kept across reloads so an offline SOS still has a location. */
export function lastKnownPosition(): Position | null {
  return load<Position>(LASTPOS_KEY);
}

/** sms: link to every contact with a phone number, pre-filled with an OSM link to the position. */
export function offlineSmsUrl(contacts: Contact[], pos: Position | null): string {
  const phones = contacts.map((c) => c.phone?.replace(/[^\d+]/g, "")).filter((p): p is string => !!p);
  const where = pos ? osmLink(pos.lat, pos.lng) : "location unavailable";
  const body = `SOS from WAYRA – my location: ${where}`;
  return `sms:${phones.join(",")}?&body=${encodeURIComponent(body)}`;
}

const IDLE_SOS: SOSState = { phase: "idle", source: "button", record: null, offline: false, smsUrl: null, position: null };
const IDLE_CALL: FakeCallState = { phase: "idle", caller: "Mom", ringAt: null, answeredAt: null };
const DEMO_STEP_MS = 1000;
const DEVIATE_M = 200;

// ------------------------------------------------------------------ provider
export function SafetyProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();

  // ---- toasts
  const [toasts, setToasts] = useState<Toast[]>([]);
  const toastId = useRef(0);
  const dismissToast = useCallback((id: number) => setToasts((ts) => ts.filter((t) => t.id !== id)), []);
  const notify = useCallback(
    (t: Omit<Toast, "id">) => {
      const id = ++toastId.current;
      setToasts((ts) => [...ts.slice(-3), { ...t, id }]);
      const ttl = t.ttl ?? (t.action ? 20_000 : 6000);
      if (ttl > 0) window.setTimeout(() => dismissToast(id), ttl);
    },
    [dismissToast],
  );

  // ---- contacts
  const [contacts, setContactsState] = useState<Contact[] | null>(() => load<Contact[]>(CONTACTS_KEY));
  const setContacts = useCallback((c: Contact[]) => {
    setContactsState(c);
    save(CONTACTS_KEY, c);
  }, []);
  const refreshContacts = useCallback(async () => {
    try {
      setContacts(await listContacts());
    } catch {
      /* offline: keep the cached list */
    }
  }, [setContacts]);

  // ---- trip
  const [trip, setTrip] = useState<Trip | null>(null);
  const [tripSegments, setTripSegments] = useState<RouteSegment[] | null>(null);
  const [saferRoute, setSaferRoute] = useState<SaferSuggestion | null>(null);
  const tripRef = useRef<Trip | null>(null);
  tripRef.current = trip;
  const line = useMemo(() => (trip ? new RouteLine(trip.geometry) : null), [trip]);

  // ---- location
  const [position, setPosition] = useState<Position | null>(null);
  const [locationError, setLocationError] = useState<string | null>(null);
  const posRef = useRef<Position | null>(null);
  const updatePosition = useCallback((p: Position) => {
    posRef.current = p;
    setPosition(p);
    save(LASTPOS_KEY, p);
  }, []);

  // ---- demo
  const [demo, setDemo] = useState<DemoState>({ on: false, speed: 5, deviating: false, stopped: false });
  const alongRef = useRef(0);
  const offsetRef = useRef(0);

  // ---- check-ins, SOS, fake call
  const [check, setCheck] = useState<CheckState | null>(null);
  const [sos, setSos] = useState<SOSState>(IDLE_SOS);
  const sosRef = useRef(sos);
  sosRef.current = sos;
  const [fakeCall, setFakeCall] = useState<FakeCallState>(IDLE_CALL);
  const [fakeSetupOpen, setFakeSetupOpen] = useState(false);

  // Reset everything on logout / restore on login.
  useEffect(() => {
    if (!user) {
      setTrip(null);
      setTripSegments(null);
      setCheck(null);
      setSos(IDLE_SOS);
      setDemo((d) => ({ ...d, on: false, deviating: false, stopped: false }));
      return;
    }
    void refreshContacts();
    getActiveTrip()
      .then((t) => {
        if (!t) return;
        setTrip(t);
        setDemo((d) => ({ ...d, on: t.demo }));
        alongRef.current = 0;
      })
      .catch(() => {});
    sosHistory()
      .then((list) => {
        const open = list.find((s) => !s.resolved_at);
        if (open) setSos({ ...IDLE_SOS, phase: "active", record: open });
      })
      .catch(() => {});
  }, [user, refreshContacts]);

  // ---- WebSocket (open while a trip or an SOS is active)
  const sharing = !!user && (!!trip || sos.phase === "active" || sos.phase === "sending") && !sos.offline;
  const token = getToken();
  const url = sharing && token ? wsUrl(`/api/ws/user?token=${encodeURIComponent(token)}`) : null;

  const onMessage = useCallback(
    (msg: Record<string, unknown>) => {
      switch (msg.type) {
        case "check": {
          const seconds = Number(msg.seconds ?? 15);
          setCheck({ reason: msg.reason as CheckState["reason"], deadline: Date.now() + seconds * 1000, detail: Number(msg.detail) });
          vibrate([300, 150, 300, 150, 300]);
          playTick(true);
          break;
        }
        case "check_cleared":
          setCheck(null);
          break;
        case "alert": {
          const a = msg.alert as Alert;
          const n = Number(msg.contacts ?? 0);
          const who = n === 1 ? "1 contact" : `${n} contacts`;
          if (a.kind === "off_route" || a.kind === "stopped") {
            setCheck(null);
            notify({ tone: "danger", title: `Alert sent to ${who}`, text: a.message, ttl: 10_000 });
            playChime();
          } else if (a.kind === "arrived") {
            notify({ tone: "success", title: "You arrived safely", text: n ? `${who} got the "arrived safely" message.` : undefined, ttl: 8000 });
            playChime();
          } else if (a.kind === "safe") {
            notify({ tone: "success", title: `"I'm safe" sent to ${who}`, ttl: 5000 });
          }
          break;
        }
        case "trip": {
          const t = msg.trip as Trip;
          if (!tripRef.current || t.id !== tripRef.current.id) break;
          if (t.status === "active") setTrip(t);
          else {
            setTrip(null);
            setTripSegments(null);
            setCheck(null);
            setSaferRoute(null);
            setDemo((d) => ({ ...d, deviating: false, stopped: false }));
          }
          break;
        }
      }
    },
    [notify],
  );
  const { state: socket, send } = useWebSocket(url, onMessage);

  // ---- real GPS while sharing (or during an SOS countdown) and not in demo mode
  const sosBusy = sos.phase !== "idle";
  const wantGps = !!user && (!!trip || sosBusy) && !demo.on;
  useEffect(() => {
    if (!wantGps) return;
    if (!("geolocation" in navigator)) {
      setLocationError("This browser can't share location.");
      return;
    }
    let first = true;
    const id = navigator.geolocation.watchPosition(
      (p) => {
        setLocationError(null);
        const fix: Position = { lat: p.coords.latitude, lng: p.coords.longitude, acc: p.coords.accuracy, t: Date.now(), sim: false };
        // Presenting outside Chicago? The route is in Chicago, so a real fix would be "off route".
        if (first && tripRef.current && !inChicago(fix.lat, fix.lng)) {
          first = false;
          void switchToDemo("You're outside the Chicago pilot area, so a simulated walker follows your route. Your contacts still follow the trip live.");
          return;
        }
        first = false;
        updatePosition(fix);
      },
      (err) => {
        const denied = err.code === err.PERMISSION_DENIED;
        setLocationError(denied ? "Location permission is off." : "Can't get your location right now.");
        if (tripRef.current && first) {
          first = false;
          void switchToDemo(
            denied
              ? "Location permission is off, so a simulated walker follows your route. To use real GPS, allow location in the address bar."
              : "No GPS fix yet, so a simulated walker follows your route.",
          );
        }
      },
      { enableHighAccuracy: true, maximumAge: 5000, timeout: 20_000 },
    );
    return () => navigator.geolocation.clearWatch(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wantGps, updatePosition]);

  // ---- demo walker: moves along the trip route at 5 km/h × speed
  useEffect(() => {
    if (!demo.on || !line) return;
    const step = () => {
      if (!demo.stopped) alongRef.current = Math.min(line.length, alongRef.current + WALK_M_PER_S * demo.speed * (DEMO_STEP_MS / 1000));
      const target = demo.deviating ? DEVIATE_M : 0;
      const d = target - offsetRef.current;
      offsetRef.current += Math.sign(d) * Math.min(Math.abs(d), 30);
      const [lat, lng] = line.pointAt(alongRef.current, offsetRef.current);
      updatePosition({ lat, lng, acc: 5, t: Date.now(), sim: true });
    };
    step();
    const id = window.setInterval(step, DEMO_STEP_MS);
    return () => window.clearInterval(id);
  }, [demo.on, demo.speed, demo.deviating, demo.stopped, line, updatePosition]);

  // ---- stream the latest fix: every 3 s (real GPS) or every 1 s (demo)
  const lastSent = useRef(0);
  useEffect(() => {
    if (socket !== "open") return;
    lastSent.current = 0; // resend the current fix on (re)connect
    const tick = () => {
      const p = posRef.current;
      if (!p || p.t === lastSent.current) return;
      if (send({ type: "loc", lat: p.lat, lng: p.lng, acc: p.acc, sim: p.sim })) lastSent.current = p.t;
    };
    tick();
    const id = window.setInterval(tick, demo.on ? 1000 : 3000);
    return () => window.clearInterval(id);
  }, [socket, send, demo.on]);

  // ---- local progress (works offline too)
  const progress = useMemo<TripProgress | null>(() => {
    if (!trip || !line) return null;
    const p = position ? ([position.lat, position.lng] as LatLng) : trip.geometry[0];
    const { offM, along } = line.locate(p);
    const remaining = Math.max(0, line.length - along);
    return {
      remainingM: remaining,
      etaMin: remaining / WALK_M_PER_S / 60,
      offRouteM: offM,
      onRoute: offM <= 100,
      done: line.length > 0 ? along / line.length : 0,
    };
  }, [trip, line, position]);

  // ---- safer-route re-check every 60 s during a trip (incident reports)
  const dismissedKey = useRef<string | null>(null);
  useEffect(() => {
    if (!trip) return;
    const run = () => {
      const p = posRef.current;
      if (!p || !tripRef.current) return;
      recheckTrip(tripRef.current.id, p.lat, p.lng)
        .then((r) => {
          if (!r.safer) return setSaferRoute(null);
          const key = `${r.safer.distance_m}-${r.safer.safety_score}`;
          if (dismissedKey.current === key) return;
          setSaferRoute({ route: r.safer, avoided: r.avoided ?? 1, extraMin: r.extra_min ?? 0 });
        })
        .catch(() => {});
    };
    const first = window.setTimeout(run, 8000);
    const id = window.setInterval(run, 60_000);
    return () => {
      window.clearTimeout(first);
      window.clearInterval(id);
    };
  }, [trip?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const acceptSaferRoute = useCallback(async () => {
    const s = saferRoute;
    const t = tripRef.current;
    if (!s || !t) return;
    try {
      const nt = await rerouteTrip(t.id, s.route);
      setTrip(nt);
      setTripSegments(s.route.segments);
      setSaferRoute(null);
      alongRef.current = 0;
      offsetRef.current = 0;
      setDemo((d) => ({ ...d, deviating: false }));
      notify({ tone: "success", title: "Switched to the safer route", text: "Your contacts see the new route too." });
    } catch (e) {
      notify({ tone: "warn", title: "Couldn't switch route", text: e instanceof Error ? e.message : undefined });
    }
  }, [saferRoute, notify]);
  const dismissSaferRoute = useCallback(() => {
    if (saferRoute) dismissedKey.current = `${saferRoute.route.distance_m}-${saferRoute.route.safety_score}`;
    setSaferRoute(null);
  }, [saferRoute]);

  // ---- trip actions
  const startTrip = useCallback(
    async (route: RouteOption, from: Place | null, to: Place | null, demoOn: boolean) => {
      const t = await startTripApi({
        profile: route.profile,
        from_name: from?.name ?? "",
        to_name: to?.name ?? "",
        geometry: route.geometry,
        distance_m: route.distance_m,
        eta_min: route.eta_min,
        safety_score: route.safety_score,
        demo: demoOn,
      });
      alongRef.current = 0;
      offsetRef.current = 0;
      setTrip(t);
      setTripSegments(route.segments);
      setCheck(null);
      setSaferRoute(null);
      dismissedKey.current = null;
      setDemo((d) => ({ ...d, on: demoOn, deviating: false, stopped: false, autoReason: null }));
      const n = contacts?.length ?? 0;
      notify(
        n
          ? { tone: "success", title: "Trip started", text: `${n === 1 ? "Your trusted contact" : `Your ${n} trusted contacts`} can now follow you live.` }
          : { tone: "info", title: "Trip started", text: "No trusted contacts yet. Share the trip link, or add contacts so they're alerted automatically." },
      );
    },
    [contacts, notify],
  );

  const endTrip = useCallback(async () => {
    const t = tripRef.current;
    if (!t) return;
    try {
      await endTripApi(t.id);
    } catch (e) {
      if (!(e instanceof ApiError && e.status === 409)) throw e;
    }
    setTrip(null);
    setTripSegments(null);
    setCheck(null);
    setSaferRoute(null);
    setDemo((d) => ({ ...d, deviating: false, stopped: false }));
    notify({ tone: "info", title: "Trip ended", text: "Location sharing stopped." });
  }, [notify]);

  const imSafe = useCallback(async () => {
    const t = tripRef.current;
    if (!t) return;
    setCheck(null);
    await imSafeApi(t.id);
  }, []);

  // ---- demo controls
  const switchToDemo = useCallback(
    async (reason?: string) => {
      const t = tripRef.current;
      if (t) {
        const p = posRef.current;
        alongRef.current = p ? new RouteLine(t.geometry).locate([p.lat, p.lng]).along : 0;
        offsetRef.current = 0;
        setTripDemo(t.id, true).then(setTrip).catch(() => {});
      }
      setDemo((d) => ({ ...d, on: true, autoReason: reason ?? null }));
      if (reason) notify({ tone: "warn", title: "Switched to DEMO MODE", text: reason, ttl: 15_000 });
    },
    [notify],
  );
  const setDemoOn = useCallback(
    async (on: boolean) => {
      if (on) return switchToDemo();
      const t = tripRef.current;
      setDemo((d) => ({ ...d, on: false, deviating: false, stopped: false, autoReason: null }));
      offsetRef.current = 0;
      if (t) setTripDemo(t.id, false).then(setTrip).catch(() => {});
    },
    [switchToDemo],
  );
  const setDemoSpeed = useCallback((speed: DemoSpeed) => setDemo((d) => ({ ...d, speed })), []);
  const toggleDeviation = useCallback(() => setDemo((d) => ({ ...d, deviating: !d.deviating, stopped: false })), []);
  const toggleStop = useCallback(() => setDemo((d) => ({ ...d, stopped: !d.stopped })), []);

  // ---- check-in
  const answerCheck = useCallback(() => {
    setCheck(null);
    if (!send({ type: "ok" }) && tripRef.current) void answerCheckApi(tripRef.current.id).catch(() => {});
  }, [send]);

  // ---- SOS
  const startSOS = useCallback((source: SOSSource) => {
    if (sosRef.current.phase !== "idle") return;
    unlockAudio();
    setSos({ ...IDLE_SOS, phase: "countdown", source });
    vibrate(200);
  }, []);
  const cancelSOS = useCallback(() => {
    if (sosRef.current.phase === "countdown") setSos(IDLE_SOS);
  }, []);

  const goOffline = useCallback(
    (pos: Position | null) => {
      const list = contacts ?? load<Contact[]>(CONTACTS_KEY) ?? [];
      const smsUrl = offlineSmsUrl(list, pos);
      setSos((s) => ({ ...s, phase: "active", offline: true, smsUrl, position: pos, record: null }));
      if (list.some((c) => c.phone)) window.location.href = smsUrl;
    },
    [contacts],
  );

  const confirmSOS = useCallback(async () => {
    const cur = sosRef.current;
    if (cur.phase !== "countdown") return;
    const pos = posRef.current ?? lastKnownPosition();
    vibrate([500, 200, 500]);
    if (!navigator.onLine) return goOffline(pos);
    setSos((s) => ({ ...s, phase: "sending", position: pos }));
    try {
      const record = await triggerSOSApi({ lat: pos?.lat, lng: pos?.lng, source: cur.source });
      setSos((s) => ({ ...s, phase: "active", record, position: pos }));
    } catch (e) {
      if (e instanceof ApiError && e.status === 0) return goOffline(pos);
      setSos((s) => ({ ...s, phase: "active", record: null }));
      notify({ tone: "danger", title: "SOS couldn't reach the server", text: "Call 911 or text your contacts directly.", ttl: 0 });
    }
  }, [goOffline, notify]);

  const resolveSOS = useCallback(async () => {
    const cur = sosRef.current;
    if (cur.record) {
      try {
        await resolveSOSApi(cur.record.id);
        notify({ tone: "success", title: "SOS closed", text: "Your contacts were told you're safe now." });
      } catch {
        notify({ tone: "warn", title: "Couldn't reach the server", text: "Tell your contacts you're safe directly." });
      }
    }
    setSos(IDLE_SOS);
  }, [notify]);

  // ---- voice SOS
  const onVoiceTrigger = useCallback(() => startSOS("voice"), [startSOS]);
  const [voice, setVoiceEnabled] = useVoiceSOS(!!user && !sosBusy, onVoiceTrigger);

  // ---- fake call
  const stopRing = useRef<(() => void) | null>(null);
  const callTimer = useRef<number | undefined>(undefined);
  const ring = useCallback(() => {
    stopRing.current?.();
    stopRing.current = startRingtone();
    setFakeCall((c) => ({ ...c, phase: "ringing", ringAt: Date.now() }));
  }, []);
  useEffect(() => {
    if (fakeCall.phase !== "ringing") return;
    vibrate([900, 600]);
    const id = window.setInterval(() => vibrate([900, 600]), 1500);
    return () => {
      window.clearInterval(id);
      vibrate(0);
    };
  }, [fakeCall.phase]);
  const scheduleFakeCall = useCallback(
    (caller: string, delaySec: number) => {
      unlockAudio(); // inside the click, so the ringtone may play later
      setFakeSetupOpen(false);
      window.clearTimeout(callTimer.current);
      setFakeCall({ phase: "scheduled", caller: caller.trim() || "Mom", ringAt: Date.now() + delaySec * 1000, answeredAt: null });
      if (delaySec <= 0) ring();
      else callTimer.current = window.setTimeout(ring, delaySec * 1000);
    },
    [ring],
  );
  const acceptFakeCall = useCallback(() => {
    stopRing.current?.();
    stopRing.current = null;
    setFakeCall((c) => ({ ...c, phase: "incall", answeredAt: Date.now() }));
  }, []);
  const endFakeCall = useCallback(() => {
    stopRing.current?.();
    stopRing.current = null;
    window.clearTimeout(callTimer.current);
    setFakeCall(IDLE_CALL);
  }, []);
  useEffect(() => () => stopRing.current?.(), []);

  const value: Ctx = {
    contacts, setContacts, refreshContacts,
    trip, tripSegments, startTrip, endTrip, imSafe, progress, socket, saferRoute, acceptSaferRoute, dismissSaferRoute,
    position, locationError,
    demo, setDemoOn, setDemoSpeed, toggleDeviation, toggleStop,
    check, answerCheck,
    sos, startSOS, cancelSOS, confirmSOS, resolveSOS,
    voice, setVoiceEnabled,
    fakeCall, fakeSetupOpen,
    openFakeCallSetup: () => setFakeSetupOpen(true),
    closeFakeCallSetup: () => setFakeSetupOpen(false),
    scheduleFakeCall, acceptFakeCall, endFakeCall,
    toasts, notify, dismissToast,
  };
  return <SafetyContext.Provider value={value}>{children}</SafetyContext.Provider>;
}

export function useSafety(): Ctx {
  const ctx = useContext(SafetyContext);
  if (!ctx) throw new Error("useSafety must be used inside <SafetyProvider>");
  return ctx;
}
