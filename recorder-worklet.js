// recorder-worklet.js — runs on the audio rendering thread.
// Accumulates Float32 mic samples and posts them to the main thread.
class RecorderProcessor extends AudioWorkletProcessor {
    constructor() {
        super();
        this.buffer = [];
        this._total = 0;
        this.port.onmessage = (e) => {
            if (e.data === "stop") {
                // Concatenate and ship the full recording.
                const out = new Float32Array(this._total);
                let off = 0;
                for (const c of this.buffer) { out.set(c, off); off += c.length; }
                this.port.postMessage(out, [out.buffer]);
                this.buffer = [];
                this._total = 0;
            }
        };
    }
    process(inputs) {
        const ch = inputs[0] && inputs[0][0];
        if (ch && ch.length) {
            const copy = new Float32Array(ch); // detach-safe copy
            this.buffer.push(copy);
            this._total += copy.length;
        }
        return true; // keep alive
    }
}
registerProcessor("recorder-processor", RecorderProcessor);
