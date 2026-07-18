import type { TtsSession as TtsSessionType } from "@mintplex-labs/piper-tts-web";
import * as Notifications from "../elements/notifications";

// Offline, realistic neural TTS via Piper (ONNX runtime in WASM).
// The voice model is fetched from the HuggingFace CDN on first use and cached
// in the browser (OPFS) by the library, so subsequent runs work offline.

const VOICE_ID = "en_US-hfc_female-medium";

// The library's default ONNX runtime base (cdnjs 1.18.0) does not host the
// files it requests, and its version must match the onnxruntime-web the
// library resolves as a peer dependency (1.27.0) or the WASM ABI mismatches
// ("e.getValue is not a function"). Piper phonemizer WASM keeps library defaults.
const PIPER_WASM_BASE =
  "https://cdn.jsdelivr.net/npm/@diffusionstudio/piper-wasm@1.0.0/build/piper_phonemize";
const WASM_PATHS = {
  onnxWasm: "https://cdn.jsdelivr.net/npm/onnxruntime-web@1.27.0/dist/",
  piperData: `${PIPER_WASM_BASE}.data`,
  piperWasm: `${PIPER_WASM_BASE}.wasm`,
};

let session: TtsSessionType | null = null;
let initPromise: Promise<TtsSessionType | null> | null = null;
let currentAudio: HTMLAudioElement | null = null;
let currentUrl: string | null = null;

async function getSession(): Promise<TtsSessionType | null> {
  if (session !== null) return session;
  if (initPromise !== null) return initPromise;

  initPromise = (async () => {
    try {
      const { TtsSession } = await import("@mintplex-labs/piper-tts-web");
      let notified = false;
      const created = await TtsSession.create({
        voiceId: VOICE_ID,
        wasmPaths: WASM_PATHS,
        progress: (p): void => {
          if (!notified && p.total > 0 && p.loaded < p.total) {
            notified = true;
            Notifications.add("Downloading speech voice (one time)...", 0);
          }
        },
      });
      session = created;
      return created;
    } catch (e) {
      Notifications.add(
        "Failed to load speech voice: " + (e as Error).message,
        -1
      );
      return null;
    }
  })();

  return initPromise;
}

function stop(): void {
  if (currentAudio !== null) {
    currentAudio.pause();
    currentAudio = null;
  }
  if (currentUrl !== null) {
    URL.revokeObjectURL(currentUrl);
    currentUrl = null;
  }
}

export async function speak(word: string): Promise<void> {
  if (word === undefined || word === "") return;

  const s = await getSession();
  if (s === null) return;

  try {
    const wav = await s.predict(word);
    // A newer word may have been requested while synthesizing; drop stale audio.
    stop();
    const url = URL.createObjectURL(wav);
    const audio = new Audio(url);
    currentAudio = audio;
    currentUrl = url;
    audio.addEventListener("ended", () => {
      if (currentAudio === audio) stop();
    });
    await audio.play();
  } catch {
    // Ignore playback/synthesis errors so typing is never blocked.
  }
}

// Warm up the model download ahead of time (e.g. when the setting is enabled).
export async function preload(): Promise<void> {
  await getSession();
}
