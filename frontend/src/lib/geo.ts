/** Small geometry helpers for live trips (same maths as backend/app/services/deviation.py). */
export type LatLng = [number, number];

const M_PER_DEG_LAT = 111_320;
export const WALK_M_PER_S = 5000 / 3600; // 5 km/h, the speed the router's ETAs assume

export function haversineM(a: LatLng, b: LatLng): number {
  const r = 6_371_000;
  const toRad = Math.PI / 180;
  const dp = (b[0] - a[0]) * toRad;
  const dl = (b[1] - a[1]) * toRad;
  const h = Math.sin(dp / 2) ** 2 + Math.cos(a[0] * toRad) * Math.cos(b[0] * toRad) * Math.sin(dl / 2) ** 2;
  return 2 * r * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** A polyline with cumulative lengths in a local metric projection, for fast "where am I" queries. */
export class RouteLine {
  readonly pts: LatLng[];
  readonly xy: [number, number][];
  readonly cum: number[];
  private readonly lat0: number;
  private readonly lng0: number;
  private readonly kx: number;

  constructor(points: LatLng[]) {
    this.pts = points.length === 1 ? [points[0], points[0]] : points;
    this.lat0 = this.pts[0][0];
    this.lng0 = this.pts[0][1];
    this.kx = M_PER_DEG_LAT * Math.cos((this.lat0 * Math.PI) / 180);
    this.xy = this.pts.map((p) => this.project(p));
    this.cum = [0];
    for (let i = 1; i < this.xy.length; i++) {
      this.cum.push(this.cum[i - 1] + Math.hypot(this.xy[i][0] - this.xy[i - 1][0], this.xy[i][1] - this.xy[i - 1][1]));
    }
  }

  get length(): number {
    return this.cum[this.cum.length - 1];
  }

  project(p: LatLng): [number, number] {
    return [(p[1] - this.lng0) * this.kx, (p[0] - this.lat0) * M_PER_DEG_LAT];
  }

  unproject(x: number, y: number): LatLng {
    return [this.lat0 + y / M_PER_DEG_LAT, this.lng0 + x / this.kx];
  }

  /** Distance to the line (m) and distance along it of the closest point. */
  locate(p: LatLng): { offM: number; along: number } {
    const [px, py] = this.project(p);
    let best = Infinity;
    let along = 0;
    for (let i = 0; i < this.xy.length - 1; i++) {
      const [ax, ay] = this.xy[i];
      const [bx, by] = this.xy[i + 1];
      const dx = bx - ax;
      const dy = by - ay;
      const l2 = dx * dx + dy * dy;
      const t = l2 > 0 ? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / l2)) : 0;
      const d = Math.hypot(ax + t * dx - px, ay + t * dy - py);
      if (d < best) {
        best = d;
        along = this.cum[i] + t * Math.sqrt(l2);
      }
    }
    return { offM: best, along };
  }

  /** Point at `along` metres, pushed `offsetM` metres to the left of the direction of travel. */
  pointAt(along: number, offsetM = 0): LatLng {
    const a = Math.max(0, Math.min(this.length, along));
    let i = 0;
    while (i < this.cum.length - 2 && this.cum[i + 1] < a) i++;
    const [ax, ay] = this.xy[i];
    const [bx, by] = this.xy[i + 1];
    const seg = this.cum[i + 1] - this.cum[i];
    const t = seg > 0 ? (a - this.cum[i]) / seg : 0;
    let x = ax + t * (bx - ax);
    let y = ay + t * (by - ay);
    if (offsetM && seg > 0) {
      x += (-(by - ay) / seg) * offsetM;
      y += ((bx - ax) / seg) * offsetM;
    }
    return this.unproject(x, y);
  }
}

export function km(m: number): string {
  return m < 1000 ? `${Math.round(m)} m` : `${(m / 1000).toFixed(1)} km`;
}
