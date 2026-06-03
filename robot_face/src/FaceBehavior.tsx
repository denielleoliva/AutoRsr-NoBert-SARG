import { useEffect, useRef, useCallback, useMemo } from 'react';
import { useVizijRuntime } from '@vizij/runtime-react';
import { useRobotState } from './useRobotState';

const VISEME_SEGMENTS = [
  'a', 'at', 'b', 'e', 'e_2', 'f', 'i', 'k',
  'm', 'o', 'o_2', 'p', 'r', 's', 't', 't_2', 'u',
] as const;
type Viseme = typeof VISEME_SEGMENTS[number];

const VISEME_GRAPH  = 'hugo_latest_visemes_pose_graph';
const EMOTION_GRAPH = 'hugo_latest_emotions_pose_graph';

// ms per viseme frame — roughly one phoneme at 0.85× speech rate
const VISEME_TICK_MS = 110;

// --- Phoneme → viseme mapping ---
interface VisemeFrame { viseme: Viseme; jaw: number }

function textToVisemeSequence(text: string): VisemeFrame[] {
  const seq: VisemeFrame[] = [];

  for (const word of text.toLowerCase().split(/\s+/)) {
    const w = word.replace(/[^a-z]/g, '');
    if (!w) continue;

    for (const ch of w) {
      let frame: VisemeFrame;
      switch (ch) {
        case 'a':                        frame = { viseme: 'a',   jaw: 0.75 }; break;
        case 'e':                        frame = { viseme: 'e',   jaw: 0.50 }; break;
        case 'i':                        frame = { viseme: 'i',   jaw: 0.40 }; break;
        case 'o':                        frame = { viseme: 'o',   jaw: 0.65 }; break;
        case 'u':                        frame = { viseme: 'u',   jaw: 0.50 }; break;
        case 'b': case 'm': case 'p':   frame = { viseme: 'm',   jaw: 0.02 }; break;
        case 'f': case 'v':             frame = { viseme: 'f',   jaw: 0.20 }; break;
        case 's': case 'z':             frame = { viseme: 's',   jaw: 0.15 }; break;
        case 't': case 'd': case 'n':   frame = { viseme: 't',   jaw: 0.25 }; break;
        case 'k': case 'g':             frame = { viseme: 'k',   jaw: 0.30 }; break;
        case 'r':                        frame = { viseme: 'r',   jaw: 0.35 }; break;
        default:                         frame = { viseme: 'at',  jaw: 0.30 }; break;
      }

      // Skip consecutive identical visemes
      const prev = seq[seq.length - 1];
      if (!prev || prev.viseme !== frame.viseme) seq.push(frame);
    }

    // Brief lip closure between words
    const last = seq[seq.length - 1];
    if (!last || last.viseme !== 'm') seq.push({ viseme: 'm', jaw: 0 });
  }

  return seq.length ? seq : [{ viseme: 'a', jaw: 0.5 }];
}

// --- Component ---

const EMOTION_GRAPH_EMOTIONS = ['angry', 'concerned', 'happy', 'neutral', 'sad', 'sleepy', 'surprise'];

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
  const blinkTimerRef    = useRef<number>(0);
  const glanceTimerRef   = useRef<number>(0);

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
    EMOTION_GRAPH_EMOTIONS.forEach((e) => {
      setInput(rig(`${EMOTION_GRAPH}/${e}.weight`), { float: 0 });
    });
  }, [ready, faceId, rig, setInput]);

  const returnMouthToNeutral = useCallback(() => {
    if (!ready || !faceId) return;
    const dur = 0.2;
    void animateValue(rig('mouth/jawud/value'),    { float: 0 }, { duration: dur });
    void animateValue(rig('standard/mouth/morph'), { float: 0 }, { duration: dur });
    VISEME_SEGMENTS.forEach((seg) => {
      void animateValue(rig(`${VISEME_GRAPH}/${seg}.weight`), { float: 0 }, { duration: dur });
    });
  }, [ready, faceId, rig, animateValue]);

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
    void animateValue(rig('blink'),                                   closed, { duration: 0.07, easing: 'easeIn' });
    void animateValue(rig('standard/left_eye_top_eyelid/pos/y'),  closed, { duration: 0.07, easing: 'easeIn' });
    void animateValue(rig('standard/right_eye_top_eyelid/pos/y'), closed, { duration: 0.07, easing: 'easeIn' });
    window.setTimeout(() => {
      if (!ready || !faceId) return;
      const open = { float: 0 };
      void animateValue(rig('blink'),                                   open, { duration: 0.12, easing: 'easeOut' });
      void animateValue(rig('standard/left_eye_top_eyelid/pos/y'),  open, { duration: 0.12, easing: 'easeOut' });
      void animateValue(rig('standard/right_eye_top_eyelid/pos/y'), open, { duration: 0.12, easing: 'easeOut' });
    }, 80);
  }, [ready, faceId, rig, animateValue]);

  // --- Glance: subtle, infrequent ---
  const performGlance = useCallback(() => {
    if (!ready || !faceId) return;
    const x   = Math.random() * 0.3 - 0.15;
    const y   = Math.random() * 0.2 - 0.05;
    const dur = 0.5 + Math.random() * 0.5;
    void animateValue(rig('standard/left_eye/pos/x'),  { float: x - 0.02 }, { duration: dur, easing: 'easeInOut' });
    void animateValue(rig('standard/right_eye/pos/x'), { float: x + 0.02 }, { duration: dur, easing: 'easeInOut' });
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
      }, 5000 + Math.random() * 5000);
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

  // --- Mouth: one viseme at a time, derived from text phonemes ---
  const startMouthAnimation = useCallback((textToAnimate: string) => {
    if (!ready || !faceId) return;

    const sequence = textToVisemeSequence(textToAnimate);
    let idx = 0;

    const applyFrame = (frame: VisemeFrame) => {
      const dur = VISEME_TICK_MS / 1000;
      void animateValue(rig('mouth/jawud/value'),    { float: frame.jaw }, { duration: dur });
      void animateValue(rig('standard/mouth/morph'), { float: frame.jaw }, { duration: dur });

      // Drive exactly one viseme to 1, all others to 0
      VISEME_SEGMENTS.forEach((seg) => {
        void animateValue(
          rig(`${VISEME_GRAPH}/${seg}.weight`),
          { float: seg === frame.viseme ? 1.0 : 0 },
          { duration: dur },
        );
      });
    };

    applyFrame(sequence[0]);
    mouthIntervalRef.current = window.setInterval(() => {
      idx = (idx + 1) % sequence.length;
      applyFrame(sequence[idx]);
    }, VISEME_TICK_MS);
  }, [ready, faceId, rig, animateValue]);

  // --- TTS ---
  const speakText = useCallback((textToSpeak: string) => {
    if (typeof window === 'undefined' || !window.speechSynthesis) return;
    window.speechSynthesis.cancel();

    const utterance  = new SpeechSynthesisUtterance(textToSpeak);
    utterance.rate   = 0.85;
    utterance.pitch  = 1.0;

    // Don't stop animation on onend — Chrome fires it early on long sentences.
    // stopSpeech() is called by the state machine when state leaves speaking.
    utterance.onerror = () => { window.speechSynthesis.cancel(); };

    window.speechSynthesis.speak(utterance);
  }, []);

  const stopSpeech = useCallback(() => {
    if (typeof window !== 'undefined' && window.speechSynthesis) {
      window.speechSynthesis.cancel();
    }
    clearInterval(mouthIntervalRef.current);
    clearVisemes();
    returnMouthToNeutral();
  }, [clearVisemes, returnMouthToNeutral]);

  // --- State machine ---
  useEffect(() => {
    if (!ready || !faceId) return;

    switch (state) {
      case 'idle': {
        lastSpokenIdRef.current = null;
        stopSpeech();
        clearEmotions();
        setEmotion('neutral', 0.2, 0.6);
        setEmotion('happy',   0.2, 0.6);
        gazeForward(0, 0.6);
        setEyelids(0, 0.2);
        break;
      }

      case 'speaking': {
        const currentId = sentence_id != null ? String(sentence_id) : text;
        if (lastSpokenIdRef.current === currentId) break;
        lastSpokenIdRef.current = currentId;

        stopSpeech();
        clearEmotions();
        setEmotion('neutral', 0.15, 0.3);
        setEmotion('happy',   0.1,  0.3);
        gazeForward(0.1, 0.3);
        setEyelids(0, 0.1);

        if (text) {
          startMouthAnimation(text);
          speakText(text);
        }
        break;
      }

      case 'listening': {
        lastSpokenIdRef.current = null;
        stopSpeech();
        clearEmotions();
        setEmotion('neutral', 0.15, 0.4);
        setEmotion('happy',   0.2, 0.4);
        gazeForward(0.3, 0.4);
        setEyelids(0, 0.1);
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
        setEmotion('happy', 0.3, 0.6);
        gazeForward(0.15, 0.5);
        setEyelids(0, 0.1);
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
