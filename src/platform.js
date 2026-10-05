// Platform adapter. Everything the game needs from its host (save data, score reporting,
// pause/resume, audio permission) goes through here, so the game code never touches a
// host SDK directly. The local build below uses localStorage; a YouTube Playables build
// only has to swap the body of these functions for ytgame.* calls.
const KEY = 'turbo-racing-save-v1';

const platform = {
  name: 'local',
  _pauseCbs: [],
  _resumeCbs: [],

  async init() {},                         // host SDK bootstrapping goes here
  firstFrameReady() {},                    // called when the first frame is rendered
  gameReady() {},                          // called when the game is interactive (menu)
  loadSave() {
    try { return JSON.parse(localStorage.getItem(KEY) || 'null'); } catch { return null; }
  },
  saveData(data) {
    try { localStorage.setItem(KEY, JSON.stringify(data)); } catch { /* storage blocked */ }
  },
  sendScore(_score) {},                    // report best score to the host
  onPause(cb) { this._pauseCbs.push(cb); },
  onResume(cb) { this._resumeCbs.push(cb); },
  onAudioEnabledChange(_cb) {},            // host can mute the game
  isAudioEnabled() { return true; },
};

// Browser visibility doubles as pause/resume on the local build.
document.addEventListener('visibilitychange', () => {
  (document.hidden ? platform._pauseCbs : platform._resumeCbs).forEach((cb) => cb());
});

export default platform;
