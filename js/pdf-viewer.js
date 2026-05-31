import * as pdfjsLib from '../vendor/pdfjs.min.mjs';
pdfjsLib.GlobalWorkerOptions.workerSrc = new URL('../vendor/pdfjs.worker.min.mjs', import.meta.url).href;

let pdfDoc = null;
let pdfPage = 1;
let pdfScale = 1.5;

export function renderPDF(url, container, state) {
  pdfDoc = null; pdfPage = 1; pdfScale = 1.5;
  state.pdfDoc = null; state.pdfPage = 1; state.pdfScale = 1.5;

  container.innerHTML = `
    <div class="flex flex-col bg-[#0b0f19] animate-fade-in" id="pdf-viewer" style="height:calc(100vh - 3.5rem)">
      <div class="h-14 glass-strong flex items-center gap-2 px-3 shrink-0 justify-between select-none">
        <div class="flex items-center gap-2">
          <button id="pdf-prev" class="btn-ghost p-2 rounded-lg" title="Previous page">←</button>
          <span class="text-sm text-slate-300 font-mono whitespace-nowrap"><span id="pdf-page-num">1</span> / <span id="pdf-page-count">?</span></span>
          <button id="pdf-next" class="btn-ghost p-2 rounded-lg" title="Next page">→</button>
        </div>
        <div class="flex items-center gap-2">
          <button id="pdf-zoom-out" class="btn-ghost px-2 py-1 rounded text-xs" title="Zoom out">-</button>
          <span id="pdf-zoom" class="text-xs text-slate-400 w-12 text-center">150%</span>
          <button id="pdf-zoom-in" class="btn-ghost px-2 py-1 rounded text-xs" title="Zoom in">+</button>
        </div>
      </div>
      <div class="flex-1 overflow-auto flex justify-center p-4 bg-[#0b0f19]">
        <canvas id="pdf-canvas" class="shadow-2xl rounded-md"></canvas>
      </div>
    </div>`;

  pdfjsLib.getDocument({ url }).promise.then(doc => {
    pdfDoc = doc;
    state.pdfDoc = doc;
    document.getElementById('pdf-page-count').textContent = doc.numPages;
    renderPage(1, state);
  }).catch(err => {
    container.innerHTML = `<div class="flex items-center justify-center h-full text-red-400 p-6 text-center">Failed to load PDF.<br>${err.message}</div>`;
  });

  container.querySelector('#pdf-prev').addEventListener('click', () => {
    if (pdfDoc && pdfPage > 1) { pdfPage--; renderPage(pdfPage, state); }
  });
  container.querySelector('#pdf-next').addEventListener('click', () => {
    if (pdfDoc && pdfPage < pdfDoc.numPages) { pdfPage++; renderPage(pdfPage, state); }
  });
  container.querySelector('#pdf-zoom-out').addEventListener('click', () => {
    pdfScale = Math.max(0.5, pdfScale - 0.25); updateZoom(state);
  });
  container.querySelector('#pdf-zoom-in').addEventListener('click', () => {
    pdfScale = Math.min(4, pdfScale + 0.25); updateZoom(state);
  });
}

function updateZoom(state) {
  const el = document.getElementById('pdf-zoom');
  if (el) el.textContent = Math.round(pdfScale * 100) + '%';
  if (pdfDoc) renderPage(pdfPage, state);
}

function renderPage(num, state) {
  if (!pdfDoc) return;
  pdfDoc.getPage(num).then(page => {
    const canvas = document.getElementById('pdf-canvas');
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    const viewport = page.getViewport({ scale: pdfScale });
    canvas.width = viewport.width;
    canvas.height = viewport.height;
    canvas.style.width = viewport.width + 'px';
    canvas.style.height = viewport.height + 'px';
    page.render({ canvasContext: ctx, viewport });
    document.getElementById('pdf-page-num').textContent = num;
    state.pdfPage = num; state.pdfScale = pdfScale; state.pdfDoc = pdfDoc;
  });
}
