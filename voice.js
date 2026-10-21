// voice.js — Whisper speech-to-text (local, via transformers.js) + TTS.
// Reverse-engineered Whisper pipeline: audio -> 16kHz log-Mel -> encoder/decoder -> tokens.
// transformers.js ships ONNX builds; we stream mic audio through it.

import { pipeline, env } from "https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.3.1";

env.allowLocalModels = false;
env.backends.onnx.wasm.wasmPaths = "https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.3.1/dist/";

let pipe = null;
let currentModel = "";

export function isReady() { return pipe !== null; }

export async function loadModel(modelId, onProgress) {
    if (pipe && currentModel === modelId) return pipe;
    if (pipe) { try { await pipe.dispose(); } catch (_) {} pipe = null; }
    currentModel = modelId;
    pipe = await pipeline("automatic-speech-recognition", modelId, {
        dtype: "q8",
        device: "wasm",
        progress_callback: onProgress,
    });
    return pipe;
}

// Record from the microphone using AudioWorklet (low latency) with a
// ScriptProcessor fallback for browsers without worklet support.
export function createRecorder() {
    const SAMPLE_RATE = 16000;
    let mediaStream = null;
    let audioCtx = null;
    let workletNode = null;
    let processor = null;   // fallback
    let source = null;
    let useWorklet = false;

    async function start() {
        mediaStream = await navigator.mediaDevices.getUserMedia({
            audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true },
        });
        audioCtx = new (window.AudioContext || window.webkitAudioContext)({ sampleRate: SAMPLE_RATE });
        source = audioCtx.createMediaStreamSource(mediaStream);

        if (audioCtx.audioWorklet) {
            try {
                const url = URL.createObjectURL(new Blob([await (await fetch("recorder-worklet.js")).text()], { type: "application/javascript" }));
                await audioCtx.audioWorklet.addModule(url);
                workletNode = new AudioWorkletNode(audioCtx, "recorder-processor");
                source.connect(workletNode);
                // Do not connect worklet to destination (would echo mic).
                useWorklet = true;
                return;
            } catch (_) { /* fall through */ }
        }
        // Fallback: ScriptProcessor (deprecated but universal)
        const bufferSize = 4096;
        processor = audioCtx.createScriptProcessor(bufferSize, 1, 1);
        processor._chunks = [];
        processor.onaudioprocess = (e) => {
            processor._chunks.push(new Float32Array(e.inputBuffer.getChannelData(0)));
        };
        source.connect(processor);
        processor.connect(audioCtx.destination);
    }

    function stop() {
        return new Promise(async (resolve) => {
            if (useWorklet && workletNode) {
                workletNode.port.onmessage = (e) => resolve(e.data);
                workletNode.port.postMessage("stop");
                try { source.disconnect(); workletNode.disconnect(); } catch (_) {}
            } else if (processor) {
                const chunks = processor._chunks || [];
                let total = 0; for (const c of chunks) total += c.length;
                const out = new Float32Array(total); let off = 0;
                for (const c of chunks) { out.set(c, off); off += c.length; }
                try { processor.disconnect(); source.disconnect(); } catch (_) {}
                resolve(out);
            } else resolve(new Float32Array(0));

            if (mediaStream) mediaStream.getTracks().forEach((t) => t.stop());
            if (audioCtx) await audioCtx.close().catch(() => {});
        });
    }

    return { start, stop };
}

export async function transcribe(audio, { language } = {}) {
    if (!pipe) throw new Error("Model not loaded");
    const opts = { chunk_length_s: 30, stride_length_s: 5 };
    if (language) opts.language = language;
    return await pipe(audio, opts);
}

// ---- Text-to-speech (SuperCmd-style "natural text-to-speech") ----
// Uses the browser's built-in SpeechSynthesis — no model download needed.
export function speak(text, { rate = 1.0, pitch = 1.0 } = {}) {
    return new Promise((resolve) => {
        if (!("speechSynthesis" in window) || !text) { resolve(); return; }
        window.speechSynthesis.cancel();
        const u = new SpeechSynthesisUtterance(text);
        u.rate = rate; u.pitch = pitch;
        const voices = window.speechSynthesis.getVoices();
        const preferred = voices.find(v => /en(-|_)(US|GB)/i.test(v.lang)) || voices.find(v => v.lang.startsWith("en")) || voices[0];
        if (preferred) u.voice = preferred;
        u.onend = resolve;
        u.onerror = resolve;
        window.speechSynthesis.speak(u);
    });
}
