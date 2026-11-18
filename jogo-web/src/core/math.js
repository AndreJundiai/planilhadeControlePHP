export const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
export const angleDiff = (a, b) => ((((b - a + Math.PI) % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2)) - Math.PI;
export const lerpAngle = (a, b, t) => a + angleDiff(a, b) * Math.min(1, t);
export const dist2 = (ax, az, bx, bz) => Math.hypot(ax - bx, az - bz);
export const quatY = (h) => ({ x: 0, y: Math.sin(h / 2), z: 0, w: Math.cos(h / 2) });
export const nextFrame = () => new Promise((r) => requestAnimationFrame(() => r()));
