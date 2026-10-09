"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import {
  mapSpeechRecognitionError,
  type SpeechRecognitionFailure,
} from "@/lib/shopping/voice-transcript";

// A minimal slice of the Web Speech API. TypeScript's DOM lib doesn't ship
// SpeechRecognition (it's still prefixed as webkitSpeechRecognition in
// Chrome and Safari), so only the members voice add uses are typed here.
type SpeechRecognitionResultLike = { isFinal: boolean; 0: { transcript: string } };
type SpeechRecognitionEventLike = {
  resultIndex: number;
  results: { length: number; [index: number]: SpeechRecognitionResultLike };
};
type SpeechRecognitionErrorEventLike = { error: string };
type SpeechRecognitionLike = {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  maxAlternatives: number;
  onresult: ((event: SpeechRecognitionEventLike) => void) | null;
  onerror: ((event: SpeechRecognitionErrorEventLike) => void) | null;
  onend: (() => void) | null;
  start: () => void;
  stop: () => void;
  abort: () => void;
};
type SpeechRecognitionConstructor = new () => SpeechRecognitionLike;

function getRecognitionConstructor(): SpeechRecognitionConstructor | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as {
    SpeechRecognition?: SpeechRecognitionConstructor;
    webkitSpeechRecognition?: SpeechRecognitionConstructor;
  };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

// Support never changes during a page's life, so there's nothing to
// subscribe to — useSyncExternalStore is here for its server snapshot:
// "unsupported" during SSR and hydration, then the real answer, without the
// hydration mismatch (or the setState-in-effect) a plain check would cause.
const subscribe = () => () => {};
const getSnapshot = () => getRecognitionConstructor() !== null;
const getServerSnapshot = () => false;

/**
 * One-utterance speech recognition for the smart add line (AUTO-12):
 * `start()` listens until the speaker pauses, reports the running
 * transcript through `onInterim`, and the final one through `onFinal`.
 * `supported` is false wherever the browser has no recognizer (Firefox,
 * many installed iOS PWAs), and the caller hides the button entirely then —
 * voice is a bonus, never the only way to add something.
 */
export function useSpeechRecognition({
  lang,
  onInterim,
  onFinal,
  onError,
}: {
  lang: string;
  onInterim: (transcript: string) => void;
  onFinal: (transcript: string) => void;
  onError: (failure: SpeechRecognitionFailure) => void;
}) {
  const supported = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  const [listening, setListening] = useState(false);
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);
  // The latest callbacks, read by the recognizer's handlers — they're set
  // once at start() and would otherwise see the render they started in.
  const callbacksRef = useRef({ onInterim, onFinal, onError });
  useEffect(() => {
    callbacksRef.current = { onInterim, onFinal, onError };
  });

  // Leaving the page mid-utterance must not leave the mic open.
  useEffect(() => () => recognitionRef.current?.abort(), []);

  const start = () => {
    const Recognition = getRecognitionConstructor();
    if (!Recognition || recognitionRef.current) return;
    const recognition = new Recognition();
    recognition.lang = lang;
    // One utterance per tap: "two liters of milk and eggs", pause, done.
    // Continuous mode would keep the mic (and, in Chrome, the upload to
    // Google's servers) running until the user remembers to stop it.
    recognition.continuous = false;
    recognition.interimResults = true;
    recognition.maxAlternatives = 1;

    let finalTranscript = "";
    recognition.onresult = (event) => {
      let interim = "";
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const result = event.results[i];
        if (result.isFinal) finalTranscript += result[0].transcript;
        else interim += result[0].transcript;
      }
      callbacksRef.current.onInterim((finalTranscript + interim).trim());
    };
    recognition.onerror = (event) => {
      // "aborted" is our own stop()/unmount, not something to report.
      if (event.error === "aborted") return;
      finalTranscript = "";
      callbacksRef.current.onError(mapSpeechRecognitionError(event.error));
    };
    // onend fires after every session, final result or not — the one place
    // to hand over what was heard and reset.
    recognition.onend = () => {
      recognitionRef.current = null;
      setListening(false);
      const transcript = finalTranscript.trim();
      if (transcript) callbacksRef.current.onFinal(transcript);
    };

    recognitionRef.current = recognition;
    try {
      recognition.start();
      setListening(true);
    } catch {
      // start() throws if a session is somehow already running.
      recognitionRef.current = null;
      callbacksRef.current.onError("failed");
    }
  };

  /** Stops listening; whatever was already heard still goes to onFinal. */
  const stop = () => recognitionRef.current?.stop();

  return { supported, listening, start, stop };
}
