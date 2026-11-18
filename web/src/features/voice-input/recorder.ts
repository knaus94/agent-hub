// Records the microphone as 16 kHz mono 16-bit samples, the form the hub's speech recognition takes, and reports the
// level for a meter. Samples come raw from the audio graph and are resampled here, so nothing depends on which
// compressed formats a browser can record or decode.
const TARGET_RATE = 16000;
export const MAX_SECONDS = 300;

export type Recording = {
   // level is 0..1, the loudness of the last moment.
   level: () => number;
   seconds: () => number;
   // stop ends the recording and gives its samples; cancel drops them.
   stop: () => Int16Array<ArrayBuffer>;
   cancel: () => void;
};

export async function record(): Promise<Recording> {
   const stream = await navigator.mediaDevices.getUserMedia({
      audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true },
   });
   const context = new AudioContext();
   try {
      await context.audioWorklet.addModule('/voice-capture.js');
   } catch (error) {
      stream.getTracks().forEach((track) => track.stop());
      await context.close();
      throw error;
   }
   const source = context.createMediaStreamSource(stream);
   const capture = new AudioWorkletNode(context, 'voice-capture');
   const analyser = context.createAnalyser();
   analyser.fftSize = 512;
   const frames: Float32Array[] = [];
   let count = 0;
   capture.port.onmessage = (event: MessageEvent<Float32Array>) => {
      if (count < MAX_SECONDS * context.sampleRate) {
         frames.push(event.data);
         count += event.data.length;
      }
   };
   source.connect(analyser);
   source.connect(capture);
   // A worklet runs only while connected to the output; it writes nothing, so nothing is heard.
   capture.connect(context.destination);
   if (context.state === 'suspended') await context.resume();
   const meter = new Float32Array(analyser.fftSize);

   let ended = false;
   const end = () => {
      if (ended) return;
      ended = true;
      capture.port.onmessage = null;
      source.disconnect();
      capture.disconnect();
      stream.getTracks().forEach((track) => track.stop());
      void context.close();
   };

   return {
      level: () => {
         analyser.getFloatTimeDomainData(meter);
         let sum = 0;
         for (const value of meter) sum += value * value;
         // Speech sits around -30 dBFS; the square root spreads quiet and loud over the meter.
         return Math.min(1, Math.sqrt(Math.sqrt(sum / meter.length) * 8));
      },
      seconds: () => count / context.sampleRate,
      stop: () => {
         const rate = context.sampleRate;
         end();
         return resample(frames, count, rate);
      },
      cancel: end,
   };
}

// Each output sample is the mean of the input samples it stands for, which also keeps out what lies above 8 kHz.
function resample(frames: Float32Array[], count: number, rate: number): Int16Array<ArrayBuffer> {
   const input = new Float32Array(count);
   let offset = 0;
   for (const frame of frames) {
      input.set(frame.subarray(0, count - offset), offset);
      offset += frame.length;
      if (offset >= count) break;
   }
   const ratio = rate / TARGET_RATE;
   const output = new Int16Array(Math.floor(count / ratio));
   for (let i = 0; i < output.length; i++) {
      const from = Math.floor(i * ratio);
      const to = Math.max(from + 1, Math.floor((i + 1) * ratio));
      let sum = 0;
      for (let j = from; j < to; j++) sum += input[j];
      const value = sum / (to - from);
      output[i] = Math.max(-32768, Math.min(32767, Math.round(value * 32767)));
   }
   return output;
}
