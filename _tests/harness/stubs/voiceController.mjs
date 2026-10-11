const T = () => globalThis.__T;
const voiceController = {
  isFollowUpWindowActive: false,
  followUpTimer: null,
  tts: { speak(m) { T()?.side('tts.speak', m); } },
  startFollowUpWindow(ms) { T()?.main('voice.startFollowUpWindow', ms); },
};
export default voiceController;
