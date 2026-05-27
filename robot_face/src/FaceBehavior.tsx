import { useEffect, useRef, useCallback, useMemo } from 'react';
import { useVizijRuntime } from '@vizij/runtime-react';
import { useRobotState } from './useRobotState';

const VISEME_SEGMENTS = [
  'a', 'at', 'b', 'e', 'e_2', 'f', 'i', 'k',
  'm', 'o', 'o_2', 'p', 'r', 's', 't', 't_2', 'u',
] as const;

const VISEME_GRAPH = 'hugo_latest_visemes_pose_graph';
const EMOTION_GRAPH = 'hugo_latest_emotions_pose_graph';

// Mouth animation interval — animateValue duration matches tick so tweens chain smoothly
const MOUTH_TICK_MS = 80;

export function FaceBehavior() {
  const { ready, faceId, setInput, animateValue } = useVizijRuntime();
  const { state, text, sentence_id } = useRobotState();

  const faceSegment = useMemo(() => (faceId ?? 'face').toLowerCase(), [faceId]);
  const rig = useCallback(
    (path: string) => `rig/${faceSegment}/${path}`,
    [faceSegment],
  );

  const lastSpokenIdRef  = useRef<string | null>(null);
  const mouthIntervalRef = useRef<number>(0);
  const blinkTimerRef   = useRef<number>(0);
  const glanceTimerRef  = useRef<number>(0);

  // --- Helpers ---

  const setEmotion = useCallback(
    (emotion: string, weight: number, dur = 0.5) => {
      if (!ready || !faceId) return;
      void animateValue(rig(`${EMOTION_GRAPH}/${emotion}.weight`), { float: weight }, { duration: dur });
    },
    [ready, faceId, rig, animateValue],
  );

  const clearEmotions = useCallback(() => {
    if (!ready || !faceId) return;
    const emotions = ['angry', 'concerned', 'happy', 'neutral', 'sad', 'sleepy', 'surprise'];
    emotions.forEach((e) => {
      setInput(rig(`${EMOTION_GRAPH}/${e}.weight`), { float: 0 });
    });
  }, [ready, faceId, rig, setInput]);

  const clearVisemes = useCallback(() => {
    if (!ready || !faceId) return;
    VISEME_SEGMENTS.forEach((seg) => {
      setInput(rig(`${VISEME_GRAPH}/${seg}.weight`), { float: 0 });
    });
    setInput(rig('standard/mouth/morph'), { float: 0 });
    setInput(rig('mouth/jawud/value'),    { float: 0 });
  }, [ready, faceId, rig, setInput]);

  const gazeForward = useCallback(
    (yOffset = 0, dur = 0.4) => {
      if (!ready || !faceId) return;
      void animateValue(rig('standard/left_eye/pos/x'),  { float: 0 },       { duration: dur });
      void animateValue(rig('standard/right_eye/pos/x'), { float: 0 },       { duration: dur });
      void animateValue(rig('standard/left_eye/pos/y'),  { float: yOffset }, { duration: dur });
      void animateValue(rig('standard/right_eye/pos/y'), { float: yOffset }, { duration: dur });
    },
    [ready, faceId, rig, animateValue],
  );

  const setEyelids = useCallback(
    (value: number, dur = 0.3) => {
      if (!ready || !faceId) return;
      void animateValue(rig('standard/left_eye_top_eyelid/pos/y'),  { float: value }, { duration: dur });
      void animateValue(rig('standard/right_eye_top_eyelid/pos/y'), { float: value }, { duration: dur });
    },
    [ready, faceId, rig, animateValue],
  );

  // --- Blink ---
  const performBlink = useCallback(() => {
    if (!ready || !faceId) return;
    const closed = { float: 0.9 };
    void animateValue(rig('blink'),                                    closed, { duration: 0.07, easing: 'easeIn' });
    void animateValue(rig('standard/left_eye_top_eyelid/pos/y'),  closed, { duration: 0.07, easing: 'easeIn' });
    void animateValue(rig('standard/right_eye_top_eyelid/pos/y'), closed, { duration: 0.07, easing: 'easeIn' });
    window.setTimeout(() => {
      if (!ready || !faceId) return;
      const open = { float: 0 };
      void animateValue(rig('blink'),                                    open, { duration: 0.12, easing: 'easeOut' });
      void animateValue(rig('standard/left_eye_top_eyelid/pos/y'),  open, { duration: 0.12, easing: 'easeOut' });
      void animateValue(rig('standard/right_eye_top_eyelid/pos/y'), open, { duration: 0.12, easing: 'easeOut' });
    }, 80);
  }, [ready, faceId, rig, animateValue]);

  // --- Glance ---
  const performGlance = useCallback(() => {
    if (!ready || !faceId) return;
    const x   = Math.random() * 0.8 - 0.4;
    const y   = Math.random() * 0.5 - 0.15;
    const dur = 0.4 + Math.random() * 0.5;
    void animateValue(rig('standard/left_eye/pos/x'),  { float: x - 0.03 }, { duration: dur, easing: 'easeInOut' });
    void animateValue(rig('standard/right_eye/pos/x'), { float: x + 0.03 }, { duration: dur, easing: 'easeInOut' });
    void animateValue(rig('standard/left_eye/pos/y'),  { float: y },         { duration: dur, easing: 'easeInOut' });
    void animateValue(rig('standard/right_eye/pos/y'), { float: y },         { duration: dur, easing: 'easeInOut' });
  }, [ready, faceId, rig, animateValue]);

  // --- Idle behavior loop ---
  useEffect(() => {
    if (!ready) return;

    const scheduleGlance = () => {
      glanceTimerRef.current = window.setTimeout(() => {
        performGlance();
        scheduleGlance();
      }, 1800 + Math.random() * 2400);
    };

    const scheduleBlink = () => {
      blinkTimerRef.current = window.setTimeout(() => {
        performBlink();
        scheduleBlink();
      }, 2500 + Math.random() * 3000);
    };

    scheduleGlance();
    scheduleBlink();

    return () => {
      clearTimeout(glanceTimerRef.current);
      clearTimeout(blinkTimerRef.current);
    };
  }, [ready, performGlance, performBlink]);

  // --- Mouth animation via setInterval + animateValue ---
  // animateValue keeps the vizij step loop active and guarantees the tween is processed;
  // MOUTH_TICK_MS duration means each tick smoothly transitions to the next target.
  const startMouthAnimation = useCallback(() => {
    if (!ready || !faceId) return;

    const tick = () => {
      const t   = performance.now() / 1000;
      const dur = MOUTH_TICK_MS / 1000;

      // Jaw open/close at natural speech rhythm (~4–5 Hz)
      const jaw = Math.max(0, Math.sin(t * 4.8) * 0.65 + 0.15);
      void animateValue(rig('mouth/jawud/value'),    { float: jaw }, { duration: dur });
      void animateValue(rig('standard/mouth/morph'), { float: jaw }, { duration: dur });

      // Visemes at different frequencies and phases for natural variety
      const aW = Math.max(0, Math.sin(t * 4.8 + 0.2) * 0.75);          // open vowel, tracks jaw
      const oW = Math.max(0, Math.sin(t * 2.9 + 1.8) * 0.50);          // rounded, slower
      const eW = Math.max(0, Math.sin(t * 3.3 + 0.9) * 0.40);          // spread lips
      const uW = Math.max(0, Math.sin(t * 2.0 + 2.6) * 0.35);          // labial round, slow
      const mW = Math.max(0, Math.sin(t * 6.2 + 0.7) * 0.30);          // bilabial flicker
      const fW = Math.max(0, Math.sin(t * 5.1 + 3.2) * 0.25);          // fricative shape

      // Normalise so total viseme weight stays ≤ 1
      const total = aW + oW + eW + uW + mW + fW;
      const s     = total > 1 ? 1 / total : 1;

      void animateValue(rig(`${VISEME_GRAPH}/a.weight`), { float: aW * s }, { duration: dur });
      void animateValue(rig(`${VISEME_GRAPH}/o.weight`), { float: oW * s }, { duration: dur });
      void animateValue(rig(`${VISEME_GRAPH}/e.weight`), { float: eW * s }, { duration: dur });
      void animateValue(rig(`${VISEME_GRAPH}/u.weight`), { float: uW * s }, { duration: dur });
      void animateValue(rig(`${VISEME_GRAPH}/m.weight`), { float: mW * s }, { duration: dur });
      void animateValue(rig(`${VISEME_GRAPH}/f.weight`), { float: fW * s }, { duration: dur });
    };

    tick(); // fire immediately so there's no initial delay
    mouthIntervalRef.current = window.setInterval(tick, MOUTH_TICK_MS);
  }, [ready, faceId, rig, animateValue]);

  // --- TTS ---
  const speakText = useCallback(
    (textToSpeak: string) => {
      if (typeof window === 'undefined' || !window.speechSynthesis) return;
      window.speechSynthesis.cancel();

      const utterance  = new SpeechSynthesisUtterance(textToSpeak);
      utterance.rate   = 0.85;
      utterance.pitch  = 1.0;

      // Don't stop mouth animation here — Chrome fires onend early on long sentences.
      // The state machine calls stopSpeech() when the robot state transitions away from speaking.
      utterance.onerror = () => { window.speechSynthesis.cancel(); };

      window.speechSynthesis.speak(utterance);
    },
    [clearVisemes],
  );

  const stopSpeech = useCallback(() => {
    if (typeof window !== 'undefined' && window.speechSynthesis) {
      window.speechSynthesis.cancel();
    }
    clearInterval(mouthIntervalRef.current);
    clearVisemes();
  }, [clearVisemes]);

  // --- State machine ---
  useEffect(() => {
    if (!ready || !faceId) return;

    switch (state) {
      case 'idle': {
        stopSpeech();
        clearEmotions();
        setEmotion('neutral', 0.4, 0.6);
        gazeForward(0, 0.6);
        setEyelids(0, 0.4);
        break;
      }

      case 'speaking': {
        const currentId = sentence_id != null ? String(sentence_id) : text;
        if (lastSpokenIdRef.current === currentId) break;
        lastSpokenIdRef.current = currentId;

        stopSpeech();
        clearEmotions();
        setEmotion('neutral', 0.3, 0.3);
        gazeForward(0.1, 0.3);
        setEyelids(0, 0.2);

        if (text) {
          startMouthAnimation();
          speakText(text);
        }
        break;
      }

      case 'listening': {
        stopSpeech();
        clearEmotions();
        setEmotion('neutral', 0.3, 0.4);
        gazeForward(0.3, 0.4);
        setEyelids(0, 0.3);
        break;
      }

      case 'thinking': {
        clearVisemes();
        clearEmotions();
        setEmotion('concerned', 0.35, 0.5);
        if (!faceId) break;
        void animateValue(rig('standard/left_eye/pos/x'),  { float: 0.35 }, { duration: 0.5, easing: 'easeInOut' });
        void animateValue(rig('standard/right_eye/pos/x'), { float: 0.35 }, { duration: 0.5, easing: 'easeInOut' });
        void animateValue(rig('standard/left_eye/pos/y'),  { float: 0.35 }, { duration: 0.5, easing: 'easeInOut' });
        void animateValue(rig('standard/right_eye/pos/y'), { float: 0.35 }, { duration: 0.5, easing: 'easeInOut' });
        setEyelids(0.15, 0.5);
        break;
      }

      case 'done': {
        clearVisemes();
        clearEmotions();
        setEmotion('happy', 0.6, 0.6);
        gazeForward(0.15, 0.5);
        setEyelids(0, 0.4);
        break;
      }
    }
  }, [
    state, text, sentence_id,
    ready, faceId,
    rig, animateValue,
    stopSpeech, clearVisemes, clearEmotions,
    gazeForward, setEyelids, setEmotion,
    startMouthAnimation, speakText,
  ]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (typeof window !== 'undefined' && window.speechSynthesis) {
        window.speechSynthesis.cancel();
      }
      clearInterval(mouthIntervalRef.current);
    };
  }, []);

  return null;
}
