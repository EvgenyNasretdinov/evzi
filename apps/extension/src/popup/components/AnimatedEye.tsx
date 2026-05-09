import { useEffect, useRef } from "react";

// Eye states extracted from SVGs:
// Default:    iris(17,20)  pupil(17,20)  highlight(20.5,17.5) — center
// Default-1:  iris(15,21)  pupil(14,21)  highlight(17.5,18.5) — left-down
// Default-2:  iris(15,19)  pupil(14,19)  highlight(17.5,16.5) — left-up
// Variant5:   iris(21,20)  pupil(22,20)  highlight(24.5,17.5) — right
// Variant6:   iris(17,22)  pupil(17,24)  highlight(20.5,21.5) — down

type EyeKeyframe = {
  time: number;
  iris: [number, number];
  pupil: [number, number];
  highlight: [number, number];
};

const KEYFRAMES: EyeKeyframe[] = [
  { time: 0, iris: [17, 20], pupil: [17, 20], highlight: [20.5, 17.5] },
  { time: 1000, iris: [21, 20], pupil: [22, 20], highlight: [24.5, 17.5] },
  { time: 2000, iris: [21, 20], pupil: [22, 20], highlight: [24.5, 17.5] },
  { time: 3000, iris: [15, 19], pupil: [14, 19], highlight: [17.5, 16.5] },
  { time: 3800, iris: [15, 21], pupil: [13.5, 23], highlight: [17, 21] },
  { time: 4600, iris: [15, 21], pupil: [13.5, 23], highlight: [17, 21] },
  { time: 5400, iris: [17, 22], pupil: [17, 24], highlight: [20.5, 21.5] },
  { time: 6000, iris: [17, 20], pupil: [17, 20], highlight: [20.5, 17.5] },
  { time: 7000, iris: [17, 20], pupil: [17, 20], highlight: [20.5, 17.5] },
];

const MOTION_DURATION_MS = 7000;
/** Full repeat period: one motion pass, then hold until the next cycle (product spec: 15s). */
const IDLE_CYCLE_MS = 15_000;

function easeInOut(t: number) {
  return t < 0.5 ? 2 * t * t : -1 + (4 - 2 * t) * t;
}

function lerp(a: number, b: number, t: number) {
  return a + (b - a) * t;
}

function interpolateKeyframes(elapsed: number) {
  const t = elapsed % MOTION_DURATION_MS;

  let from: EyeKeyframe = KEYFRAMES[0]!;
  let to: EyeKeyframe = KEYFRAMES[KEYFRAMES.length - 1]!;

  for (let i = 0; i < KEYFRAMES.length - 1; i++) {
    const a = KEYFRAMES[i]!;
    const b = KEYFRAMES[i + 1]!;
    if (t >= a.time && t < b.time) {
      from = a;
      to = b;
      break;
    }
  }

  const segDuration = to.time - from.time;
  const segElapsed = t - from.time;
  const rawT = segDuration === 0 ? 0 : segElapsed / segDuration;
  const easedT = easeInOut(rawT);

  return {
    iris: [lerp(from.iris[0], to.iris[0], easedT), lerp(from.iris[1], to.iris[1], easedT)] as const,
    pupil: [lerp(from.pupil[0], to.pupil[0], easedT), lerp(from.pupil[1], to.pupil[1], easedT)] as const,
    highlight: [lerp(from.highlight[0], to.highlight[0], easedT), lerp(from.highlight[1], to.highlight[1], easedT)] as const,
  };
}

function poseForCycle(elapsed: number) {
  const t = elapsed % IDLE_CYCLE_MS;
  if (t < MOTION_DURATION_MS) return interpolateKeyframes(t);
  const rest = KEYFRAMES[0]!;
  return {
    iris: rest.iris,
    pupil: rest.pupil,
    highlight: rest.highlight,
  };
}

export interface AnimatedEyeProps {
  size?: number;
}

export function AnimatedEye({ size = 120 }: AnimatedEyeProps) {
  const irisRef = useRef<SVGCircleElement>(null);
  const pupilRef = useRef<SVGCircleElement>(null);
  const highlightRef = useRef<SVGCircleElement>(null);
  const startRef = useRef<number | null>(null);

  useEffect(() => {
    let rafId = 0;
    const animate = (timestamp: number) => {
      if (startRef.current === null) startRef.current = timestamp;
      const elapsed = timestamp - startRef.current;

      const { iris, pupil, highlight } = poseForCycle(elapsed);

      irisRef.current?.setAttribute("cx", String(iris[0]));
      irisRef.current?.setAttribute("cy", String(iris[1]));
      pupilRef.current?.setAttribute("cx", String(pupil[0]));
      pupilRef.current?.setAttribute("cy", String(pupil[1]));
      highlightRef.current?.setAttribute("cx", String(highlight[0]));
      highlightRef.current?.setAttribute("cy", String(highlight[1]));

      rafId = requestAnimationFrame(animate);
    };

    rafId = requestAnimationFrame(animate);
    return () => cancelAnimationFrame(rafId);
  }, []);

  return (
    <svg width={size} height={(size * 36) / 40} viewBox="0 0 40 36" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden>
      <rect x="34" width="6" height="6" fill="black" />
      <rect x="34" y="34" width="34" height="28" transform="rotate(180 34 34)" fill="black" />
      <path
        d="M17.46 11.0078C22.2642 11.1756 28.8863 13.9506 32 20C28.8863 26.0494 22.2642 28.8244 17.46 28.9922L17 29C12.1675 28.9999 5.21426 26.2448 2 20C5.21426 13.7553 12.1675 11.0001 17 11L17.46 11.0078Z"
        fill="white"
      />
      <circle ref={irisRef} cx="17" cy="20" r="7" fill="#74CAFF" />
      <circle ref={pupilRef} cx="17" cy="20" r="4" fill="black" />
      <circle ref={highlightRef} cx="20.5" cy="17.5" r="1.5" fill="white" />
    </svg>
  );
}
