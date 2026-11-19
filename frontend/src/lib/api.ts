const TOKEN_KEY = "wayra.token";

export function getToken(): string | null {
  try {
    return localStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}

export function setToken(token: string | null): void {
  try {
    if (token) localStorage.setItem(TOKEN_KEY, token);
    else localStorage.removeItem(TOKEN_KEY);
  } catch {
    /* storage unavailable (private mode); the session just won't persist */
  }
}

export class ApiError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

type ValidationIssue = { loc?: (string | number)[]; msg?: string };

/** Turn a FastAPI error body into one readable sentence. */
function errorMessage(status: number, body: unknown): string {
  const detail = (body as { detail?: unknown } | null)?.detail;
  if (typeof detail === "string") return detail;
  if (Array.isArray(detail) && detail.length > 0) {
    return (detail as ValidationIssue[])
      .map((d) => {
        const field = d.loc?.[d.loc.length - 1];
        const msg = (d.msg ?? "is invalid").replace(/^Value error, /, "");
        return field ? `${String(field)}: ${msg}` : msg;
      })
      .join(". ");
  }
  if (status >= 500) return "The server had a problem. Please try again.";
  return `Request failed (${status})`;
}

export async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);
  if (init.body && !headers.has("Content-Type")) headers.set("Content-Type", "application/json");
  const token = getToken();
  if (token) headers.set("Authorization", `Bearer ${token}`);

  let res: Response;
  try {
    res = await fetch(path, { ...init, headers });
  } catch (err) {
    if (err instanceof DOMException && err.name === "AbortError") throw err;
    throw new ApiError(0, "Can't reach the server. Check your connection and try again.");
  }
  const body: unknown = await res.json().catch(() => null);
  if (!res.ok) throw new ApiError(res.status, errorMessage(res.status, body));
  return body as T;
}

export async function getHealth(): Promise<{ status: string }> {
  return request("/api/health");
}

// ---- Auth ----
export type User = { id: number; name: string; email: string };
export type TokenResponse = { access_token: string; token_type: string; user: User };

export function apiLogin(email: string, password: string): Promise<TokenResponse> {
  return request("/api/auth/login", { method: "POST", body: JSON.stringify({ email, password }) });
}

export function apiRegister(name: string, email: string, password: string): Promise<TokenResponse> {
  return request("/api/auth/register", {
    method: "POST",
    body: JSON.stringify({ name, email, password }),
  });
}

export function apiMe(): Promise<User> {
  return request("/api/auth/me");
}

// ---- Places ----
export type Place = { name: string; lat: number; lon: number };

export function searchPlaces(q: string, signal?: AbortSignal): Promise<Place[]> {
  return request(`/api/geocode/search?q=${encodeURIComponent(q)}`, { signal });
}

/** City of Chicago bounding box (pilot area). */
export const CHICAGO_BOUNDS = { south: 41.6445, north: 42.023, west: -87.9401, east: -87.524 };

export function inChicago(lat: number, lon: number): boolean {
  const b = CHICAGO_BOUNDS;
  return lat >= b.south && lat <= b.north && lon >= b.west && lon <= b.east;
}

// ---- Routing ----
export type RouteProfile = "fastest" | "balanced" | "safest";
export type RiskLevel = "green" | "amber" | "red";
/** One street edge. `name` = OSM street name or a label like "Footpath" (absent with an old graph cache). */
export type RouteSegment = { coords: [number, number][]; rel_risk: number; length_m: number; level: RiskLevel; name?: string };
export type RouteOption = {
  profile: RouteProfile;
  label: string;
  lambda: number;
  geometry: [number, number][];
  distance_m: number;
  eta_min: number;
  safety_score: number;
  risk_m: Record<RiskLevel, number>;
  segments: RouteSegment[];
  identical_to: RouteProfile[];
};
export type RouteResponse = {
  depart_at: string;
  bucket: number;
  night_mode: boolean;
  night_mode_source: "auto" | "override";
  sunrise: string;
  sunset: string;
  identical_routes: boolean;
  routes: RouteOption[];
  compute_ms: number;
};

export function planRoute(
  from: Place,
  to: Place,
  opts: { departAt?: string; nightMode?: boolean | "auto" } = {},
): Promise<RouteResponse> {
  return request("/api/route", {
    method: "POST",
    body: JSON.stringify({
      from: { lat: from.lat, lng: from.lon },
      to: { lat: to.lat, lng: to.lon },
      depart_at: opts.departAt ?? null,
      night_mode: opts.nightMode ?? "auto",
    }),
  });
}

// ---- Map status, heatmap, model card ----
/** GET /api/status: public; Chicago time, auto night mode and which data is loaded. */
export type MapStatus = {
  now: string;
  bucket: number;
  night_mode: boolean;
  sunrise: string;
  sunset: string;
  routing_ready: boolean;
  heatmap_ready: boolean;
  model_card_ready: boolean;
};

export function getStatus(at?: string | null): Promise<MapStatus> {
  return request(`/api/status${at ? `?at=${encodeURIComponent(at)}` : ""}`);
}

export type HeatCell = {
  type: "Feature";
  geometry: { type: "Polygon"; coordinates: [number, number][][] };
  properties: { h3: string; rel_risk: number; risk: number };
};
export type Heatmap = {
  type: "FeatureCollection";
  bucket: number;
  forecast_month: string | null;
  features: HeatCell[];
};

export function getHeatmap(bucket: number, signal?: AbortSignal): Promise<Heatmap> {
  return request(`/api/heatmap?bucket=${bucket}`, { signal });
}

export type MetricSet = { roc_auc: number; pr_auc: number; hit_rate_top10pct: number; brier?: number };
export type ModelCard = {
  unit?: string;
  split?: { train?: string; valid?: string; test?: string; forecast_month?: string };
  rows?: Record<string, number>;
  test_positive_rate?: number;
  n_cells?: number;
  test: { model: MetricSet; baseline: MetricSet; model_uncalibrated?: MetricSet };
  definitions?: Record<string, string>;
  feature_importance_gain_share?: Record<string, number>;
};

export function getModelCard(): Promise<ModelCard> {
  return request("/api/model-card");
}

/** A user-facing error: short title + one helpful sentence. */
export type FriendlyError = { title: string; text: string };

/** Map API/network failures to friendly copy (never a bare "Not Found"). */
export function friendlyError(err: unknown, what: "route" | "heatmap" | "model card"): FriendlyError {
  if (err instanceof ApiError) {
    if (err.status === 0) {
      return { title: "Can't reach WAYRA", text: "The server isn't responding. Check your connection, or make sure the server is running (npm run demo or npm run dev)." };
    }
    if (err.status === 401) {
      return { title: "Session expired", text: "Please log out and sign in again." };
    }
    if (err.status === 404) {
      return { title: "Feature not available yet", text: `The server doesn't offer the ${what} yet. Restart the backend so it picks up the latest version.` };
    }
    if (err.status === 503) {
      const fix = what === "route" ? "npm run score" : "npm run train";
      return { title: "Still getting ready", text: `The ${what} data isn't loaded on the server yet. Run \`${fix}\`, then restart the backend.` };
    }
    if (err.status === 422 && what === "route") {
      if (/too far|pilot area/i.test(err.message)) {
        return { title: "Outside the Chicago pilot area", text: "One of the points is too far from Chicago's walking network. Pick a start and destination inside the City of Chicago." };
      }
      if (/no walking route/i.test(err.message)) {
        return { title: "No walking route found", text: "We couldn't connect these two points on foot. Try a nearby street address or landmark." };
      }
      return { title: "Can't plan this route", text: err.message };
    }
    if (err.status >= 500) {
      return { title: "Something went wrong", text: `The server had a problem loading the ${what}. Please try again.` };
    }
    return { title: `Couldn't load the ${what}`, text: err.message };
  }
  return { title: `Couldn't load the ${what}`, text: "Please try again." };
}

/** GET /api/public/model-summary: headline held-out metrics for the public landing page. */
export type ModelSummary = {
  roc_auc: number | null;
  roc_auc_baseline: number | null;
  hit_rate_top10pct: number | null;
  hit_rate_top10pct_baseline: number | null;
  pr_auc: number | null;
  pr_auc_baseline: number | null;
  test_months: string | null;
  n_cells: number | null;
};

export function getModelSummary(): Promise<ModelSummary> {
  return request("/api/public/model-summary");
}

// ---- Safety (Phases 6-7): contacts, trips, SOS, alerts, watch/track, reports ----
export type Contact = {
  id: number;
  name: string;
  relation: string | null;
  phone: string | null;
  email: string | null;
  watch_token: string;
  created_at: string;
};
export type ContactInput = { name: string; relation: string; phone: string; email: string };
export const MAX_CONTACTS = 5;

export const listContacts = (): Promise<Contact[]> => request("/api/contacts");
export const addContact = (c: ContactInput): Promise<Contact> =>
  request("/api/contacts", { method: "POST", body: JSON.stringify(c) });
export const editContact = (id: number, c: ContactInput): Promise<Contact> =>
  request(`/api/contacts/${id}`, { method: "PUT", body: JSON.stringify(c) });
export const resetContactLink = (id: number): Promise<Contact> =>
  request(`/api/contacts/${id}/reset-link`, { method: "POST" });
export async function deleteContact(id: number): Promise<void> {
  await request(`/api/contacts/${id}`, { method: "DELETE" });
}

export type Trip = {
  id: number;
  share_token: string;
  status: "active" | "ended" | "arrived";
  profile: RouteProfile;
  from_name: string;
  to_name: string;
  geometry: [number, number][];
  distance_m: number;
  eta_min: number;
  safety_score: number | null;
  demo: boolean;
  started_at: string;
  ended_at: string | null;
};
export type TripStartInput = {
  profile: RouteProfile;
  from_name: string;
  to_name: string;
  geometry: [number, number][];
  distance_m: number;
  eta_min: number;
  safety_score: number;
  demo: boolean;
};
export const startTripApi = (t: TripStartInput): Promise<Trip> =>
  request("/api/trips", { method: "POST", body: JSON.stringify(t) });
export const getActiveTrip = (): Promise<Trip | null> => request("/api/trips/active");
export const endTripApi = (id: number): Promise<Trip> => request(`/api/trips/${id}/end`, { method: "POST" });
export const imSafeApi = (id: number): Promise<{ ok: boolean }> => request(`/api/trips/${id}/safe`, { method: "POST" });
export const answerCheckApi = (id: number): Promise<{ cancelled: boolean }> =>
  request(`/api/trips/${id}/ok`, { method: "POST" });
export const setTripDemo = (id: number, demo: boolean): Promise<Trip> =>
  request(`/api/trips/${id}/demo`, { method: "PATCH", body: JSON.stringify({ demo }) });
export type SaferRoute = {
  profile: RouteProfile;
  geometry: [number, number][];
  distance_m: number;
  eta_min: number;
  safety_score: number;
  segments: RouteSegment[];
};
export type RecheckResult = { safer: SaferRoute | null; reason?: string; avoided?: number; extra_min?: number };
export const recheckTrip = (id: number, lat: number, lng: number): Promise<RecheckResult> =>
  request(`/api/trips/${id}/recheck`, { method: "POST", body: JSON.stringify({ lat, lng }) });
export const rerouteTrip = (id: number, r: SaferRoute): Promise<Trip> =>
  request(`/api/trips/${id}/reroute`, {
    method: "POST",
    body: JSON.stringify({ profile: r.profile, geometry: r.geometry, distance_m: r.distance_m, eta_min: r.eta_min, safety_score: r.safety_score }),
  });

export type AlertKind = "sos" | "sos_resolved" | "off_route" | "stopped" | "arrived" | "safe" | "trip_started" | "trip_ended";
export type Alert = {
  id: number;
  trip_id: number | null;
  kind: AlertKind;
  message: string;
  source: string | null;
  lat: number | null;
  lng: number | null;
  created_at: string;
  resolved_at: string | null;
};
export type Delivery = { contact_name: string; channel: string; status: string; detail: string | null };
export type SOSRecord = Alert & { deliveries: Delivery[]; duration_s: number | null };

export const triggerSOS = (body: { lat?: number; lng?: number; source: "button" | "voice" | "offline" }): Promise<SOSRecord> =>
  request("/api/sos", { method: "POST", body: JSON.stringify(body) });
export const resolveSOS = (id: number): Promise<SOSRecord> => request(`/api/sos/${id}/resolve`, { method: "POST" });
export const sosHistory = (): Promise<SOSRecord[]> => request("/api/sos");
export const myAlerts = (): Promise<Alert[]> => request("/api/alerts");

export type LivePoint = { lat: number; lng: number; t: string | null; sim?: boolean };
export type LiveProgress = { remaining_m: number; off_route_m: number; on_route: boolean; eta_min: number };
export type LiveSnapshot = {
  kind: "watch" | "track";
  viewer: { name: string; relation: string | null } | null;
  user: { first_name: string };
  trip: Trip | null;
  sos: Alert | null;
  last: LivePoint | null;
  trail: [number, number][];
  progress: LiveProgress | null;
  alerts: Alert[];
  channels: string[];
};
export const getWatch = (token: string): Promise<LiveSnapshot> => request(`/api/watch/${encodeURIComponent(token)}`);
export const getTrack = (token: string): Promise<LiveSnapshot> => request(`/api/track/${encodeURIComponent(token)}`);

export type ReportCategory = "harassment" | "poor_lighting" | "suspicious" | "unsafe_crowd" | "followed" | "other";
export type IncidentReport = { id: number; category: ReportCategory; note: string; lat: number; lng: number; created_at: string; weight: number };
export const listReports = (): Promise<IncidentReport[]> => request("/api/reports");
export const addReport = (r: { category: ReportCategory; note: string; lat: number; lng: number }): Promise<IncidentReport> =>
  request("/api/reports", { method: "POST", body: JSON.stringify(r) });

/** ws(s)://host/api/... (Vite proxies /api WebSockets to the backend in dev). */
export function wsUrl(path: string): string {
  const proto = window.location.protocol === "https:" ? "wss" : "ws";
  return `${proto}://${window.location.host}${path}`;
}

export const watchLink = (token: string): string => `${window.location.origin}/watch/${token}`;
export const trackLink = (token: string): string => `${window.location.origin}/track/${token}`;
export const osmLink = (lat: number, lng: number): string =>
  `https://www.openstreetmap.org/?mlat=${lat.toFixed(6)}&mlon=${lng.toFixed(6)}#map=17/${lat.toFixed(6)}/${lng.toFixed(6)}`;
