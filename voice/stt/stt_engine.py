import sys
import json
import os
import queue
import sounddevice as sd
from vosk import Model, KaldiRecognizer

WAKE_WORD = "rocky"
MODEL_PATH = os.path.join(os.path.dirname(__file__), "model")
SAMPLE_RATE = 16000

def main():
    if not os.path.exists(MODEL_PATH):
        print("[ERROR] Model not found at: " + MODEL_PATH, flush=True)
        sys.exit(1)

    model = Model(MODEL_PATH)
    recognizer = KaldiRecognizer(model, SAMPLE_RATE)

    audio_queue = queue.Queue()
    is_woken = False

    def audio_callback(indata, frames, time, status):
        if status:
            pass  # Ignore status warnings
        audio_queue.put(bytes(indata))

    print("[READY]", flush=True)

    with sd.RawInputStream(samplerate=SAMPLE_RATE, blocksize=8000, dtype="int16",
                           channels=1, callback=audio_callback):
        while True:
            data = audio_queue.get()
            if recognizer.AcceptWaveform(data):
                result = json.loads(recognizer.Result())
                text = result.get("text", "").lower().strip()

                if not text:
                    continue

                if not is_woken:
                    if WAKE_WORD in text:
                        is_woken = True
                        print("[WAKE]", flush=True)

                        # Capture anything after "rocky" in the same utterance
                        after = text.split(WAKE_WORD, 1)[-1].strip()
                        if len(after) > 2:
                            print(f"[COMMAND] {after}", flush=True)
                            is_woken = False
                else:
                    if len(text) > 2:
                        print(f"[COMMAND] {text}", flush=True)
                        is_woken = False

if __name__ == "__main__":
    main()
