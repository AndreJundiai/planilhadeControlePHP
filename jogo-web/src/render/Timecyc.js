import * as THREE from 'three';

// San Andreas-style "timecyc": colour keyframes per hour, linearly blended.
// [hour, skyTop, skyHorizon/fog, sunColor, sunIntensity, ambientSky, ambientGround, ambientIntensity]
const KEYS = [
  [0, 0x0a1020, 0x1c2438, 0x8fa0d0, 0.6, 0x6a7cb8, 0x2a2a30, 2.2],
  [5, 0x2a3052, 0x86606a, 0xff9a60, 0.8, 0x7a7a9a, 0x3a3028, 1.6],
  [7, 0x6a9ad0, 0xf2b482, 0xffc27e, 1.5, 0xa8aec4, 0x6a5440, 1.25],
  [12, 0x4f86cc, 0xd6d2c0, 0xfff4e0, 2.2, 0x87ceeb, 0x7a6c50, 1.15], // sol forte e quente, sombra azulada
  [17, 0x5f80bc, 0xf2a85e, 0xffae5a, 1.8, 0xd8a684, 0x7a5440, 1.3],
  [19, 0x3a3a72, 0xe2703e, 0xff7230, 1.2, 0xb07a88, 0x553828, 1.3],
  [21, 0x101830, 0x342c44, 0x8fa0d0, 0.6, 0x6a74a8, 0x2a2a30, 2.0],
  [24, 0x0a1020, 0x1c2438, 0x8fa0d0, 0.6, 0x6a7cb8, 0x2a2a30, 2.2],
];


const lerpColor = (a, b, t) => new THREE.Color(a).lerp(new THREE.Color(b), t);

/** @returns {{skyTop:THREE.Color, horizon:THREE.Color, sun:THREE.Color, sunIntensity:number, ambSky:THREE.Color, ambGround:THREE.Color, ambIntensity:number, night:number}} */
export function sampleTimecyc(hour) {
  const h = ((hour % 24) + 24) % 24;
  let i = 0;
  while (KEYS[i + 1][0] <= h) i++;
  const A = KEYS[i], B = KEYS[i + 1], t = (h - A[0]) / (B[0] - A[0]);
  const night = h < 5.5 || h > 19.5 ? 1 : h < 6.5 ? 6.5 - h : h > 18.5 ? h - 18.5 : 0;
  return {
    skyTop: lerpColor(A[1], B[1], t),
    horizon: lerpColor(A[2], B[2], t),
    sun: lerpColor(A[3], B[3], t),
    sunIntensity: A[4] + (B[4] - A[4]) * t,
    ambSky: lerpColor(A[5], B[5], t),
    ambGround: lerpColor(A[6], B[6], t),
    ambIntensity: A[7] + (B[7] - A[7]) * t,
    night: Math.min(1, night),
  };
}

/** Sun direction for a given hour (east in the morning, west in the afternoon). */
export function sunDirection(hour) {
  const night = hour < 6 || hour >= 19;
  const elev = THREE.MathUtils.degToRad(night ? 35 : Math.max(6, 72 * Math.sin((Math.PI * (hour - 6)) / 12)));
  const azim = THREE.MathUtils.degToRad(hour < 12 ? 80 : -80);
  return new THREE.Vector3().setFromSphericalCoords(1, Math.PI / 2 - elev, azim);
}
