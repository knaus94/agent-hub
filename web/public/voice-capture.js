// Hands the microphone's samples to the page as they come, for voice input. A worklet is the one way to get raw
// samples on every browser; it lives in its own file because the page's policy allows scripts from its origin only.
class VoiceCapture extends AudioWorkletProcessor {
   process(inputs) {
      const channel = inputs[0]?.[0];
      if (channel) this.port.postMessage(channel.slice(0));
      return true;
   }
}

registerProcessor('voice-capture', VoiceCapture);
