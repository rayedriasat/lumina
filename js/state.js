export const state = {
  view: 'dashboard',
  subView: null,
  courses: [],
  currentCourse: null,
  currentFile: null,
  sidebarOpen: true,
  mobileSidebarOpen: false,
  isMobile: window.innerWidth < 768,
  activeBlobUrl: null,
  activeSubUrls: [],
  player: null,
  saveTimer: null,
  lastRenderView: null,
  peekVideo: null,
  cueData: [],
  rightPanelOpen: true,
  sidebarWidth: 288,
  noteText: '',
  autoProceedTimer: null,
  pdfDoc: null,
  pdfPage: 1,
  pdfScale: 1.5,
  _peekCleanup: null,
};

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
