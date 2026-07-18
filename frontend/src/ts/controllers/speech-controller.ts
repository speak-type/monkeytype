import type {
  TtsSession as TtsSessionType,
  VoiceId,
} from "@mintplex-labs/piper-tts-web";
import * as Notifications from "../elements/notifications";

// Offline, realistic neural TTS via Piper (ONNX runtime in WASM).
// A voice model is fetched from the HuggingFace CDN on first use of a given
// language and cached in the browser (OPFS) by the library, so subsequent runs
// work offline. Each language uses its own Piper voice / session.

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

// Maps a Monkeytype language (base name) to a Piper voice. Size/variant suffixes
// (e.g. `_1k`, `_10k`, `_medical`) are stripped by the prefix match below.
// Languages without an entry are simply not spoken.
const VOICE_BY_LANGUAGE: Record<string, VoiceId> = {
  english: "en_US-hfc_female-medium",
  german: "de_DE-thorsten-medium",
  french: "fr_FR-siwis-medium",
  spanish: "es_ES-davefx-medium",
  italian: "it_IT-riccardo-x_low",
  russian: "ru_RU-ruslan-medium",
  portuguese: "pt_BR-faber-medium",
  dutch: "nl_NL-mls-medium",
  polish: "pl_PL-gosia-medium",
  turkish: "tr_TR-fahrettin-medium",
  ukrainian: "uk_UA-ukrainian_tts-medium",
  swedish: "sv_SE-nst-medium",
  finnish: "fi_FI-harri-medium",
  danish: "da_DK-talesyntese-medium",
  norwegian: "no_NO-talesyntese-medium",
  greek: "el_GR-rapunzelina-low",
  czech: "cs_CZ-jirka-medium",
  romanian: "ro_RO-mihai-medium",
  arabic: "ar_JO-kareem-medium",
  persian: "fa_IR-gyro-medium",
  chinese: "zh_CN-huayan-medium",
  vietnamese: "vi_VN-vais1000-medium",
  hungarian: "hu_HU-berta-medium",
  icelandic: "is_IS-salka-medium",
  slovak: "sk_SK-lili-medium",
  slovenian: "sl_SI-artur-medium",
  serbian: "sr_RS-serbski_institut-medium",
  catalan: "ca_ES-upc_ona-medium",
  georgian: "ka_GE-natia-medium",
  kazakh: "kk_KZ-issai-high",
  nepali: "ne_NP-google-medium",
  swahili: "sw_CD-lanfrica-medium",
  luxembourgish: "lb_LU-marylux-medium",
};

function voiceForLanguage(language: string): VoiceId | null {
  for (const base of Object.keys(VOICE_BY_LANGUAGE)) {
    if (language === base || language.startsWith(base + "_")) {
      return VOICE_BY_LANGUAGE[base] as VoiceId;
    }
  }
  return null;
}

// One session per voice, plus in-flight init promises to dedupe concurrent loads.
const sessions = new Map<VoiceId, TtsSessionType>();
const initPromises = new Map<VoiceId, Promise<TtsSessionType | null>>();
const unsupportedNotified = new Set<string>();

let currentAudio: HTMLAudioElement | null = null;
let currentUrl: string | null = null;

async function getSession(voiceId: VoiceId): Promise<TtsSessionType | null> {
  const existing = sessions.get(voiceId);
  if (existing !== undefined) return existing;
  const pending = initPromises.get(voiceId);
  if (pending !== undefined) return pending;

  const promise = (async () => {
    try {
      const { TtsSession } = await import("@mintplex-labs/piper-tts-web");
      let notified = false;
      const created = await TtsSession.create({
        voiceId,
        wasmPaths: WASM_PATHS,
        progress: (p): void => {
          if (!notified && p.total > 0 && p.loaded < p.total) {
            notified = true;
            Notifications.add("Downloading speech voice (one time)...", 0);
          }
        },
      });
      sessions.set(voiceId, created);
      return created;
    } catch (e) {
      Notifications.add(
        "Failed to load speech voice: " + (e as Error).message,
        -1
      );
      return null;
    } finally {
      initPromises.delete(voiceId);
    }
  })();

  initPromises.set(voiceId, promise);
  return promise;
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

export async function speak(word: string, language: string): Promise<void> {
  if (word === undefined || word === "") return;

  const voiceId = voiceForLanguage(language);
  if (voiceId === null) {
    if (!unsupportedNotified.has(language)) {
      unsupportedNotified.add(language);
      Notifications.add(`No speech voice available for ${language}.`, 0);
    }
    return;
  }

  const s = await getSession(voiceId);
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

// Warm up a language's model download ahead of time (e.g. on setting change).
export async function preload(language: string): Promise<void> {
  const voiceId = voiceForLanguage(language);
  if (voiceId !== null) await getSession(voiceId);
}
