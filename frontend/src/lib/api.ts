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
export type RouteSegment = { coords: [number, number][]; rel_risk: number; length_m: number; level: RiskLevel };
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
      return { title: "Can't reach WAYRA", text: "The server isn't responding. Check your connection, or make sure the backend is running (npm run dev)." };
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
