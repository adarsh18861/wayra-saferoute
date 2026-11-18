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
