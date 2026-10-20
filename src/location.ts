import { angleDiff, normalizeDeg, type LngLat } from './geo';

export interface Fix {
  coord: LngLat;
  /** Metres (68% confidence). */
  accuracy: number;
  /** Direction of travel from GPS, only while moving. */
  course: number | null;
  simulated: boolean;
}

export type LocationError = 'denied' | 'unavailable';

/** Wraps watchPosition. Call simulate() to fake a position (demo / testing). */
export class LocationTracker {
  private watchId: number | null = null;
  private simulating = false;
  last: Fix | null = null;
  private readonly listeners: ((f: Fix) => void)[] = [];

  constructor(
    private readonly onFix: (f: Fix) => void,
    private readonly onError: (e: LocationError) => void,
  ) {}

  start(): void {
    if (!('geolocation' in navigator)) return this.onError('unavailable');
    this.watchId = navigator.geolocation.watchPosition(
      (p) => {
        if (this.simulating) return;
        const { longitude, latitude, accuracy, heading, speed } = p.coords;
        this.emit({
          coord: [longitude, latitude],
          accuracy,
          course: heading != null && !isNaN(heading) && (speed ?? 0) > 0.5 ? heading : null,
          simulated: false,
        });
      },
      (err) => this.onError(err.code === err.PERMISSION_DENIED ? 'denied' : 'unavailable'),
      { enableHighAccuracy: true, maximumAge: 2000, timeout: 20000 },
    );
  }

  simulate(coord: LngLat): void {
    this.simulating = true;
    this.emit({ coord, accuracy: 5, course: null, simulated: true });
  }

  /** Extra subscribers (e.g. the staff capture tool). */
  addListener(fn: (f: Fix) => void): void {
    this.listeners.push(fn);
  }

  stop(): void {
    if (this.watchId != null) navigator.geolocation.clearWatch(this.watchId);
  }

  private emit(f: Fix): void {
    this.last = f;
    this.onFix(f);
    for (const fn of this.listeners) fn(f);
  }
}

interface OrientationEventIOS extends DeviceOrientationEvent {
  webkitCompassHeading?: number;
}

/**
 * Device compass heading (degrees from north). iOS needs start() to be
 * called from a tap; Android exposes `deviceorientationabsolute`.
 */
export class Compass {
  heading: number | null = null;
  private listening = false;

  constructor(private readonly onHeading: (h: number) => void) {}

  static get supported(): boolean {
    return 'DeviceOrientationEvent' in window;
  }

  /** iOS 13+ asks for permission; must run inside a user gesture. */
  static get needsPermission(): boolean {
    return typeof (DeviceOrientationEvent as any)?.requestPermission === 'function';
  }

  async start(): Promise<boolean> {
    if (this.listening) return true;
    if (!Compass.supported) return false;
    if (Compass.needsPermission) {
      try {
        if ((await (DeviceOrientationEvent as any).requestPermission()) !== 'granted') return false;
      } catch {
        return false;
      }
    }
    const absolute = 'ondeviceorientationabsolute' in window;
    window.addEventListener(absolute ? 'deviceorientationabsolute' : 'deviceorientation', this.handle as EventListener);
    this.listening = true;
    return true;
  }

  private handle = (e: OrientationEventIOS): void => {
    let h: number | null = null;
    if (typeof e.webkitCompassHeading === 'number') h = e.webkitCompassHeading;
    else if (e.absolute && e.alpha != null) h = 360 - e.alpha;
    if (h == null) return;
    h = normalizeDeg(h + (screen.orientation?.angle ?? 0));
    // Low-pass filter on the circle so the arrow does not jitter.
    this.heading = this.heading == null ? h : normalizeDeg(this.heading + angleDiff(this.heading, h) * 0.25);
    this.onHeading(this.heading);
  };
}
