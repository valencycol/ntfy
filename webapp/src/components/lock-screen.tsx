"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import "@/styles/lock.css";

import { api } from "@/lib/api";

const DOTS = [0, 1, 2, 3, 4, 5, 6, 7, 8];
const HIT_RADIUS = 26;
/**
 * Tapping dot by dot has no "done" gesture, so a pause stands in for one. It
 * has to be generous: 700ms cut people off mid-pattern, submitting the first
 * four dots while they were still entering the fifth.
 */
const AUTOSUBMIT_MS = 2000;
const MIN_LENGTH = 4;
/** A finger never holds perfectly still, so a tap is allowed to wander a little. */
const DRAG_THRESHOLD_PX = 10;

export function LockScreen({ onUnlock }: { onUnlock: () => void | Promise<void> }) {
  const [seq, setSeq] = useState<number[]>([]);
  const [message, setMessage] = useState("");
  const [wrong, setWrong] = useState(false);
  const [points, setPoints] = useState("");

  const padRef = useRef<HTMLDivElement>(null);
  const dotRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const draggingRef = useRef(false);
  /** Whether the pointer travelled far enough this gesture to count as a drag. */
  const movedRef = useRef(false);
  const originRef = useRef({ x: 0, y: 0 });
  const lastGestureWasDragRef = useRef(false);
  const submitTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const seqRef = useRef<number[]>([]);
  seqRef.current = seq;

  const clearSubmitTimer = () => {
    if (submitTimer.current) {
      clearTimeout(submitTimer.current);
      submitTimer.current = null;
    }
  };

  // The trail is drawn in pad-local coordinates, so it has to be recomputed
  // whenever the sequence changes or the pad moves (resize, orientation).
  const paint = useCallback(() => {
    const pad = padRef.current;
    if (!pad) return;
    const box = pad.getBoundingClientRect();
    setPoints(
      seqRef.current
        .map(i => {
          const dot = dotRefs.current[i];
          if (!dot) return "";
          const r = dot.getBoundingClientRect();
          return `${r.left - box.left + r.width / 2},${r.top - box.top + r.height / 2}`;
        })
        .filter(Boolean)
        .join(" ")
    );
  }, []);

  useEffect(() => {
    paint();
  }, [seq, paint]);

  useEffect(() => {
    window.addEventListener("resize", paint);
    return () => {
      window.removeEventListener("resize", paint);
      clearSubmitTimer();
    };
  }, [paint]);

  const submitPattern = useCallback(async () => {
    clearSubmitTimer();
    const pattern = seqRef.current.join("");
    try {
      await api("/api/login", { method: "POST", body: JSON.stringify({ pattern }) });
      setSeq([]);
      setMessage("");
      setWrong(false);
      await onUnlock();
    } catch (err) {
      // Flash the trail and dots rose before clearing, so a wrong pattern reads
      // as rejected rather than just silently vanishing.
      setMessage(err instanceof Error ? err.message : "Wrong pattern.");
      setWrong(true);
      setTimeout(() => {
        if (!draggingRef.current) {
          setSeq([]);
          setWrong(false);
        }
      }, 550);
    }
  }, [onUnlock]);

  const push = useCallback(
    (i: number) => {
      if (seqRef.current.includes(i)) return;
      const next = [...seqRef.current, i];
      seqRef.current = next;
      setSeq(next);
      clearSubmitTimer();

      // Never while a finger or button is still down: a slow drag would submit
      // itself part-way through. A drag ends at pointerup, which submits then;
      // this timer is only for entries with no such ending — taps, and keyboard
      // or switch users activating each dot in turn.
      if (draggingRef.current) return;
      if (next.length >= MIN_LENGTH) submitTimer.current = setTimeout(submitPattern, AUTOSUBMIT_MS);
    },
    [submitPattern]
  );

  const hit = (clientX: number, clientY: number) => {
    for (const i of DOTS) {
      const dot = dotRefs.current[i];
      if (!dot) continue;
      const r = dot.getBoundingClientRect();
      if (Math.hypot(clientX - (r.left + r.width / 2), clientY - (r.top + r.height / 2)) < HIT_RADIUS) {
        push(i);
        return;
      }
    }
  };

  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    draggingRef.current = true;
    movedRef.current = false;
    originRef.current = { x: e.clientX, y: e.clientY };
    padRef.current?.setPointerCapture(e.pointerId);
    clearSubmitTimer();

    // Starting a new *drag* discards the previous attempt, but a tap must add
    // to what is already there — clearing on every pointerdown meant tapping
    // the dots one at a time could never reach four, so a finger that taps
    // rather than drags could not unlock at all.
    if (lastGestureWasDragRef.current || wrong) {
      seqRef.current = [];
      setSeq([]);
      setMessage("");
      setWrong(false);
    }

    hit(e.clientX, e.clientY);
  };

  const onPointerUp = () => {
    if (!draggingRef.current) return;
    draggingRef.current = false;
    lastGestureWasDragRef.current = movedRef.current;

    if (seqRef.current.length < MIN_LENGTH) return;

    // Lifting the finger ends a drag, so submit at once. A tap is not an
    // ending, so start the pause instead — push() deliberately skipped it
    // while the pointer was down.
    clearSubmitTimer();
    if (movedRef.current) {
      void submitPattern();
    } else {
      submitTimer.current = setTimeout(submitPattern, AUTOSUBMIT_MS);
    }
  };

  return (
    <section className={`lock${wrong ? " wrong" : ""}`}>
      <div className="lockcard">
        <div className="lockmark" aria-hidden="true">
          <svg viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <rect x="4" y="10" width="16" height="10" rx="2" />
            <path d="M8 10V7a4 4 0 0 1 8 0v3" />
          </svg>
        </div>

        <h1>Colaco Calendar</h1>
        <p className="locksub">Draw your pattern to enter</p>

        <div className="padwrap">
          <svg className="trail" aria-hidden="true" width="216" height="216">
            <polyline fill="none" stroke="var(--gold-line)" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" points={points} />
          </svg>

          <div
            className="pad"
            ref={padRef}
            role="group"
            aria-label="Pattern lock, three by three grid — draw a pattern of 4 or more dots to unlock"
            onPointerDown={onPointerDown}
            onPointerMove={e => {
              if (!draggingRef.current) return;
              if (Math.hypot(e.clientX - originRef.current.x, e.clientY - originRef.current.y) > DRAG_THRESHOLD_PX) {
                movedRef.current = true;
              }
              hit(e.clientX, e.clientY);
            }}
            onPointerUp={onPointerUp}
            onPointerCancel={() => {
              draggingRef.current = false;
            }}
          >
            {DOTS.map(i => (
              <button
                key={i}
                type="button"
                className="dot"
                aria-pressed={seq.includes(i)}
                aria-label={`Point ${i + 1}`}
                ref={el => {
                  dotRefs.current[i] = el;
                }}
                onClick={e => {
                  e.preventDefault();
                  push(i);
                }}
              />
            ))}
          </div>
        </div>

        <p className="lockmsg" role="status" aria-live="polite">
          {message}
        </p>
      </div>
    </section>
  );
}
