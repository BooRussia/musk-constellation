import { useEffect, useRef } from 'react'
import { useThree, useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import type { OrbitControls as OrbitControlsImpl } from 'three-stdlib'

// ============================================
// KEYBOARD ORBIT (WASD + QE + arrows) for the Earth scene
//   W / S       — orbit polar (move camera up / down around target)
//   A / D       — orbit azimuthally (left / right) around target
//   Q / E       — dolly camera away / toward target (zoom out / in)
//   Arrow keys  — pan target left/right/up/down (in camera plane)
// Mirrors the constellation view's KEYBOARD ORBIT implementation
// (see ConstellationCanvas.tsx) so both views feel identical: per-frame
// eased velocities with delta-time scaling, so a tapped key produces a
// soft glide instead of a jerky step. Composes cleanly with drei's
// OrbitControls damping — we only read/write camera.position +
// controls.target and call controls.update() each frame, which is the
// same surface OrbitControls itself touches.
//
// Orbit + pan rates scale with ALTITUDE above the surface, so the ground
// tracks at a consistent on-screen speed at every zoom: tap A/D zoomed
// out and the globe spins; tap A/D zoomed into the detail tiles and it
// nudges gently instead of whipping the surface past the camera.
// ============================================

// Globe radius in scene units (see EarthScene). Altitude = camera
// distance − this.
const EARTH_RADIUS = 5
// Altitude (scene units) of the default opening view (distance 21): the
// zoom level at which orbit speed equals the base `orbitRate` below.
const REF_ALTITUDE = 16
export default function KeyboardCameraControls({
  controlsRef,
}: {
  controlsRef: React.RefObject<OrbitControlsImpl | null>
}) {
  const camera = useThree((s) => s.camera)

  const keysHeld = useRef<Set<string>>(new Set())
  const orbitVel = useRef({ azimuth: 0, polar: 0, dolly: 0, panX: 0, panY: 0 })
  const sphericalRef = useRef(new THREE.Spherical())
  const offsetVec = useRef(new THREE.Vector3())
  const panVec = useRef(new THREE.Vector3())
  const tmpVec = useRef(new THREE.Vector3())

  useEffect(() => {
    const isEditable = (el: EventTarget | null): boolean => {
      if (!el || !(el instanceof HTMLElement)) return false
      const tag = el.tagName
      return (
        tag === 'INPUT' ||
        tag === 'TEXTAREA' ||
        tag === 'SELECT' ||
        el.isContentEditable
      )
    }
    const onDown = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return
      if (isEditable(document.activeElement)) return
      const k = e.key.length === 1 ? e.key.toLowerCase() : e.key
      if (
        k === 'w' || k === 'a' || k === 's' || k === 'd' ||
        k === 'q' || k === 'e' ||
        k === 'ArrowUp' || k === 'ArrowDown' || k === 'ArrowLeft' || k === 'ArrowRight'
      ) {
        keysHeld.current.add(k)
        e.preventDefault()
      }
    }
    const onUp = (e: KeyboardEvent) => {
      const k = e.key.length === 1 ? e.key.toLowerCase() : e.key
      keysHeld.current.delete(k)
    }
    const onBlur = () => keysHeld.current.clear()
    window.addEventListener('keydown', onDown)
    window.addEventListener('keyup', onUp)
    window.addEventListener('blur', onBlur)
    return () => {
      window.removeEventListener('keydown', onDown)
      window.removeEventListener('keyup', onUp)
      window.removeEventListener('blur', onBlur)
    }
  }, [])

  useFrame((_, delta) => {
    const controls = controlsRef.current
    const cam = camera as THREE.PerspectiveCamera
    if (!controls || !cam) return

    // Clamp delta so a long pause / tab-switch doesn't snap the camera.
    const dt = Math.min(delta, 0.05)

    // Target accelerations from currently-held keys.
    const held = keysHeld.current
    const accel = 12 // 1/s — how fast velocity ramps to target
    const decay = 8 // 1/s — how fast velocity decays when no key held
    const targetAz = (held.has('d') ? 1 : 0) - (held.has('a') ? 1 : 0)
    const targetPol = (held.has('w') ? 1 : 0) - (held.has('s') ? 1 : 0)
    const targetDolly = (held.has('q') ? 1 : 0) - (held.has('e') ? 1 : 0)
    const targetPanX = (held.has('ArrowLeft') ? 1 : 0) - (held.has('ArrowRight') ? 1 : 0)
    const targetPanY = (held.has('ArrowUp') ? 1 : 0) - (held.has('ArrowDown') ? 1 : 0)

    const ease = (v: number, target: number) => {
      const k = target === 0 ? decay : accel
      return v + (target - v) * Math.min(1, dt * k)
    }
    const v = orbitVel.current
    v.azimuth = ease(v.azimuth, targetAz)
    v.polar = ease(v.polar, targetPol)
    v.dolly = ease(v.dolly, targetDolly)
    v.panX = ease(v.panX, targetPanX)
    v.panY = ease(v.panY, targetPanY)

    const anyMotion =
      Math.abs(v.azimuth) > 0.001 ||
      Math.abs(v.polar) > 0.001 ||
      Math.abs(v.dolly) > 0.001 ||
      Math.abs(v.panX) > 0.001 ||
      Math.abs(v.panY) > 0.001
    if (!anyMotion) return

    // Per-second motion rates. Tuned for the Earth scale (OrbitControls
    // minDistance 5.15, maxDistance 92): a touch slower on orbit than the
    // constellation view so the close-in globe doesn't whip past you.
    const orbitRate = 1.4 // rad/s at full velocity (at the reference altitude)
    const dollyRate = 2.0 // radius scales by up to 2.0× per second at full velocity
    const panRate = 0.4 // fraction of altitude to target per second

    // Apply azimuth + polar + dolly via spherical coords around target.
    offsetVec.current.subVectors(cam.position, controls.target)
    sphericalRef.current.setFromVector3(offsetVec.current)
    // Altitude-proportional orbit speed: visible ground span and angular
    // rate both scale with altitude, so the time to sweep the surface
    // across the screen stays ~constant. Capped at 1 so zooming out never
    // spins faster than today; tiny floor keeps it alive right at the deck.
    const altitude = sphericalRef.current.radius - EARTH_RADIUS
    const zoomScale = THREE.MathUtils.clamp(altitude / REF_ALTITUDE, 0.006, 1)
    sphericalRef.current.theta += v.azimuth * orbitRate * zoomScale * dt
    sphericalRef.current.phi -= v.polar * orbitRate * zoomScale * dt
    // Clamp polar so we don't flip past the poles.
    sphericalRef.current.phi = Math.max(0.05, Math.min(Math.PI - 0.05, sphericalRef.current.phi))
    sphericalRef.current.radius *= Math.pow(dollyRate, v.dolly * dt)
    sphericalRef.current.radius = Math.max(
      controls.minDistance,
      Math.min(controls.maxDistance, sphericalRef.current.radius),
    )
    offsetVec.current.setFromSpherical(sphericalRef.current)
    cam.position.copy(controls.target).add(offsetVec.current)

    // Pan: move both camera + target sideways/up in the screen-aligned
    // plane. OrbitControls.enablePan is false here, so this is the only
    // way arrow-pan reaches the target. Subtle by design.
    if (Math.abs(v.panX) > 0.001 || Math.abs(v.panY) > 0.001) {
      // Pan in proportion to altitude (not full orbit radius) so arrow-pan
      // also stays fine-grained when zoomed in close to the surface.
      const panAltitude = Math.max(offsetVec.current.length() - EARTH_RADIUS, 0.08)
      const panAmount = panAltitude * panRate * dt
      // Camera-right vector in world space.
      tmpVec.current.set(1, 0, 0).applyQuaternion(cam.quaternion)
      panVec.current.copy(tmpVec.current).multiplyScalar(v.panX * panAmount)
      // Camera-up vector.
      tmpVec.current.set(0, 1, 0).applyQuaternion(cam.quaternion)
      panVec.current.addScaledVector(tmpVec.current, v.panY * panAmount)
      cam.position.add(panVec.current)
      controls.target.add(panVec.current)
    }

    controls.update()
  })

  return null
}
