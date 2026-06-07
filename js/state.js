export const state = {
  view: 'dashboard',
  subView: null,
  subViewQuery: '',
  courses: [],
  currentCourse: null,
  currentFile: null,
  sidebarOpen: true,
  mobileSidebarOpen: false,
  isMobile: window.innerWidth < 768,
  activeBlobUrl: null,
  activeSubUrls: [],
  activePreviewThumbs: null,
  player: null,
  saveTimer: null,
  lastRenderView: null,
  lastRenderSubView: null,
  peekVideo: null,
  cueData: [],
  rightPanelOpen: true,
  rightPanelTab: 'subtitles',
  sidebarWidth: 288,
  noteText: '',
  autoProceedTimer: null,
  progressSaveTimer: null,
  notesSaveTimer: null,
  pdfDoc: null,
  pdfPage: 1,
  pdfScale: 1.5,
  _peekCleanup: null,
  playbackSpeedCache: {},
  pendingSeekTarget: null,
  seekRaf: null,
  environmentWarningDismissed: false,
  editingUsername: false,
  usernameDraft: '',
  bufferWarmDetach: null,
  thumbJob: null,
  indexingStatus: {},
  autoProceedKeydown: null,
  isCourseStartup: false,
  resumeBanner: null,

  // Gamification & User
  user: {
    name: 'Learner',
    streak: 0,
    highestStreak: 0,
    lastActive: null,
    totalMinutes: 0,
    activity: {} // { "YYYY-MM-DD": minutes }
  }
};

let statsTimer = null;
let lastTick = Date.now();

export function initGamification() {
  const saved = localStorage.getItem('lumina_user');
  if (saved) {
    try {
      state.user = { ...state.user, ...JSON.parse(saved) };
    } catch(e){}
  } else {
    // maybe first time prompt
  }
  
  // Check streak
  const today = new Date().toISOString().split('T')[0];
  if (state.user.lastActive) {
    const lastDate = new Date(state.user.lastActive);
    const currDate = new Date();
    const diffMs = currDate - lastDate;
    const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
    
    // If it's the next day
    if (diffDays === 1) {
       // streak continues
    } else if (diffDays > 1) {
       // streak broken
       state.user.streak = 0;
    }
  }

  // Activity timer (ticks every 10 seconds of active usage if in player)
  setInterval(() => {
    if (state.view === 'player' && document.hasFocus()) {
       const todayKey = new Date().toISOString().split('T')[0];
       state.user.activity[todayKey] = (state.user.activity[todayKey] || 0) + (10/60);
       state.user.totalMinutes += (10/60);
       
       if (state.user.lastActive !== todayKey) {
           if (state.user.lastActive) {
               const diffDays = Math.floor((new Date() - new Date(state.user.lastActive)) / (1000*60*60*24));
               if (diffDays === 1) state.user.streak++;
               else if (diffDays > 1) state.user.streak = 1;
           } else {
               state.user.streak = 1;
           }
           state.user.lastActive = todayKey;
       }
       if (state.user.streak > state.user.highestStreak) state.user.highestStreak = state.user.streak;
       
       saveGamification();
    }
  }, 10000);
}

export function setUsername(name) {
  state.user.name = name || 'Learner';
  saveGamification();
}

export function saveGamification() {
  localStorage.setItem('lumina_user', JSON.stringify(state.user));
}

window.addEventListener('resize', () => {
  state.isMobile = window.innerWidth < 768;
  if (!state.isMobile) state.mobileSidebarOpen = false;
  // trigger re-render if in player to adjust layout classes
  if (state.view === 'player') {
    // lightweight refresh by calling render from app.js is tricky because app.js not loaded yet.
    // We will dispatch a custom event that app.js listens to.
    window.dispatchEvent(new Event('lumina-resize'));
  }
});
