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

  const sentenceBuffer = useRef('');
  const isSpeakingRef = useRef(false);

  // Streaming TTS method
  const streamSpeak = (token) => {
    if (!synthRef.current) return;
    sentenceBuffer.current += token;

    // Check for sentence completion boundaries
    if (/[.!?]\s*$/.test(sentenceBuffer.current) || sentenceBuffer.current.includes('\n')) {
      const sentenceToSpeak = sentenceBuffer.current.trim();
      sentenceBuffer.current = ''; // Reset buffer

      if (sentenceToSpeak.length > 0) {
        const utterance = new SpeechSynthesisUtterance(sentenceToSpeak);
        const voices = synthRef.current.getVoices();
        const preferredVoice = voices.find(v => v.name.includes('Mark') || v.name.includes('Google US English'));
        if (preferredVoice) utterance.voice = preferredVoice;
        utterance.rate = 1.05;
        
        synthRef.current.speak(utterance);
      }
    }
  };

  // TTS method (Full text)
  const speak = (text, onEnd) => {
    if (!synthRef.current) return;
    synthRef.current.cancel();
    sentenceBuffer.current = '';

    const utterance = new SpeechSynthesisUtterance(text);
    const voices = synthRef.current.getVoices();
    const preferredVoice = voices.find(v => v.name.includes('Mark') || v.name.includes('Google US English'));
    if (preferredVoice) utterance.voice = preferredVoice;
    utterance.rate = 1.05;
    if (onEnd) utterance.onend = onEnd;
    synthRef.current.speak(utterance);
  };

  return {
    startBackgroundListening,
    stopBackgroundListening,
    speak,
    streamSpeak,
    sttStatus,
    currentTranscript
  };
}
