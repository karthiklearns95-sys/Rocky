import { useEffect, useRef, useState } from 'react';

export default function useVoiceController(onWakeWord, onSpeechResult) {
  const [isListening, setIsListening] = useState(false);
  const [sttStatus, setSttStatus] = useState('Initializing...');
  const [currentTranscript, setCurrentTranscript] = useState('');
  const recognitionRef = useRef(null);
  const synthRef = useRef(window.speechSynthesis);

  useEffect(() => {
    // UI STT is disabled. Native STT is running in the Node.js backend.
    setSttStatus('Native Windows STT Active (Backend)');
  }, [onWakeWord, onSpeechResult, isListening]);

  // Start the background listening loop
  const startBackgroundListening = () => {
    setIsListening(true);
  };

  const stopBackgroundListening = () => {
    setIsListening(false);
  };

  // TTS method
  const speak = (text, onEnd) => {
    if (!synthRef.current) return;
    
    // Stop any ongoing speech
    synthRef.current.cancel();

    const utterance = new SpeechSynthesisUtterance(text);
    // Find a good voice (e.g. Microsoft Mark or generic male/female)
    const voices = synthRef.current.getVoices();
    const preferredVoice = voices.find(v => v.name.includes('Mark') || v.name.includes('Google US English'));
    if (preferredVoice) utterance.voice = preferredVoice;
    
    utterance.rate = 1.05; // slightly faster/energetic
    
    if (onEnd) {
      utterance.onend = onEnd;
    }

    synthRef.current.speak(utterance);
  };

  return {
    startBackgroundListening,
    stopBackgroundListening,
    speak,
    sttStatus,
    currentTranscript
  };
}
