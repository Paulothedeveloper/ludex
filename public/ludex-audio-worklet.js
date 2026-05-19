// v0.9.1: AudioWorkletProcessor rodando na audio thread = zero stutter
// independente do que o main thread esta fazendo (React render, GC, etc).
//
// Arquitetura: ring buffer de Float32 stereo interleaved. Frame loop posta
// chunks via port.postMessage. process() pega N samples por chamada (~128
// samples a 44.1kHz = ~3ms quantum), drena do ring buffer continuamente.
//
// Se ring buffer vazia (underrun), preenche com silencio em vez de stutter.

class LudexAudioProcessor extends AudioWorkletProcessor {
  constructor(options) {
    super();
    const bufferSeconds = 2.0; // 2s de buffer = lots of headroom
    const sampleRate = options.processorOptions?.sampleRate || 48000;
    this.size = Math.round(sampleRate * 2 * bufferSeconds); // stereo interleaved
    this.buf = new Float32Array(this.size);
    this.write = 0;
    this.read = 0;
    this.available = 0;
    this.underruns = 0;
    this.totalIn = 0;
    this.totalOut = 0;

    this.port.onmessage = (e) => {
      const msg = e.data;
      if (msg.type === 'samples') {
        // msg.data: Int16Array interleaved L,R,L,R...
        const i16 = msg.data;
        const n = i16.length;
        // Se nao cabe, descarta os mais antigos (drop instead of stall)
        if (this.available + n > this.size) {
          const drop = (this.available + n) - this.size;
          this.read = (this.read + drop) % this.size;
          this.available -= drop;
        }
        for (let i = 0; i < n; i++) {
          this.buf[this.write] = i16[i] / 32768;
          this.write = (this.write + 1) % this.size;
        }
        this.available += n;
        this.totalIn += n;
      } else if (msg.type === 'reset') {
        this.write = 0; this.read = 0; this.available = 0;
      } else if (msg.type === 'stats') {
        this.port.postMessage({
          type: 'stats-reply',
          available: this.available,
          underruns: this.underruns,
          totalIn: this.totalIn,
          totalOut: this.totalOut,
        });
      }
    };
  }

  process(inputs, outputs) {
    const out = outputs[0];
    if (!out || out.length < 2) return true;
    const left = out[0];
    const right = out[1];
    const n = left.length;
    for (let i = 0; i < n; i++) {
      // Precisa de 2 floats (L, R) por sample
      if (this.available >= 2) {
        left[i]  = this.buf[this.read];
        right[i] = this.buf[(this.read + 1) % this.size];
        this.read = (this.read + 2) % this.size;
        this.available -= 2;
        this.totalOut += 2;
      } else {
        // Underrun — silencio sutil em vez de pop/click
        left[i] = 0;
        right[i] = 0;
        this.underruns++;
      }
    }
    return true;
  }
}

registerProcessor('ludex-audio-processor', LudexAudioProcessor);
