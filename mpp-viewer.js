// MPXJ is the gold-standard Java library ported to JS/WASM for reading .mpp files.
// Loaded lazily (only when a file is dropped) to avoid blocking page load.
const MPXJ_CDN = 'https://cdn.jsdelivr.net/npm/mpxj/+esm';

// ── DOM refs ──────────────────────────────────────────────────────────────────
const uploadZone = document.getElementById('upload-zone');
const fileInput  = document.getElementById('file-input');
const loading    = document.getElementById('loading');
const errorBox   = document.getElementById('error-box');
const errorMsg   = document.getElementById('error-msg');
const results    = document.getElementById('results');
const taskBody   = document.getElementById('task-body');

// ── State ─────────────────────────────────────────────────────────────────────
let mpxjLib = null;

// ── UI state machine ──────────────────────────────────────────────────────────
function setState(state) {
  uploadZone.hidden = state !== 'upload';
  loading.hidden    = state !== 'loading';
  errorBox.hidden   = state !== 'error';
  results.hidden    = state !== 'results';
}

function showError(msg) {
  errorMsg.textContent = msg;
  setState('error');
}

// ── Format helpers ────────────────────────────────────────────────────────────
function fmtDate(d) {
  if (!d) return '—';
  try {
    return new Date(d).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
  } catch { return '—'; }
}

function fmtDuration(dur) {
  if (!dur) return '—';
  try {
    const n = dur.getDuration ? dur.getDuration() : Number(dur);
    if (!isFinite(n) || n <= 0) return '—';
    if (n < 1) return `${Math.round(n * 8)}h`;
    return `${parseFloat(n.toFixed(1))}d`;
  } catch { return '—'; }
}

// ── MPXJ lazy loader ──────────────────────────────────────────────────────────
async function loadMpxj() {
  if (mpxjLib) return mpxjLib;
  mpxjLib = await import(MPXJ_CDN);
  return mpxjLib;
}

// ── File processor ────────────────────────────────────────────────────────────
async function processFile(file) {
  if (!file) return;
  if (!file.name.match(/\.mpp$/i)) {
    showError('Please select a valid Microsoft Project (.mpp) file.');
    return;
  }

  setState('loading');

  try {
    const { readProject } = await loadMpxj();
    const buffer = await file.arrayBuffer();
    const project = await readProject(buffer);
    renderProject(project, file.name);
    setState('results');
  } catch (err) {
    console.error(err);
    showError(
      `Could not parse "${file.name}". ` +
      `Make sure it is a valid .mpp file (MS Project 2003–2021). ` +
      `Detail: ${err.message}`
    );
  }
}

// ── Renderer ──────────────────────────────────────────────────────────────────
function renderProject(project, filename) {
  const props = project.getProjectProperties();
  const allTasks = [...project.getTasks()];

  // Filter out the implicit root task (ID 0, no name)
  const tasks = allTasks.filter(t => t.getID() > 0 && t.getName());

  // Project info bar
  const title = safeGet(() => props.getProjectTitle()) || filename;
  document.getElementById('proj-name').textContent   = title;
  document.getElementById('proj-start').textContent  = fmtDate(safeGet(() => props.getStartDate()));
  document.getElementById('proj-finish').textContent = fmtDate(safeGet(() => props.getFinishDate()));
  document.getElementById('proj-count').textContent  =
    `${tasks.filter(t => !safeGet(() => t.getSummary())).length} tasks`;

  // Build table rows
  taskBody.innerHTML = '';
  const frag = document.createDocumentFragment();

  for (const task of tasks) {
    const id       = safeGet(() => task.getID()) ?? '';
    const name     = safeGet(() => task.getName()) ?? '';
    const start    = safeGet(() => task.getStart());
    const finish   = safeGet(() => task.getFinish());
    const dur      = safeGet(() => task.getDuration());
    const pct      = safeGet(() => task.getPercentageComplete()) ?? 0;
    const level    = safeGet(() => task.getOutlineLevel()) ?? 0;
    const isSummary = safeGet(() => task.getSummary()) ?? false;

    const tr = document.createElement('tr');
    if (isSummary) tr.classList.add('summary-row');

    tr.innerHTML = `
      <td class="col-id">${id}</td>
      <td class="col-name" style="padding-left:${8 + (level - 1) * 18}px">${escHtml(name)}</td>
      <td class="col-date">${fmtDate(start)}</td>
      <td class="col-date">${fmtDate(finish)}</td>
      <td class="col-dur">${fmtDuration(dur)}</td>
      <td class="col-pct">
        <div class="pct-bar">
          <div class="pct-track"><div class="pct-fill" style="width:${pct}%"></div></div>
          <span class="pct-label">${Math.round(pct)}%</span>
        </div>
      </td>`;

    frag.appendChild(tr);
  }

  taskBody.appendChild(frag);
}

// ── Utilities ─────────────────────────────────────────────────────────────────
function safeGet(fn) {
  try { return fn(); } catch { return null; }
}

function escHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// ── Event listeners ───────────────────────────────────────────────────────────
fileInput.addEventListener('change', e => {
  processFile(e.target.files[0]);
  e.target.value = ''; // reset so same file can be re-selected
});

uploadZone.addEventListener('dragover', e => {
  e.preventDefault();
  uploadZone.classList.add('drag-over');
});

uploadZone.addEventListener('dragleave', e => {
  if (!uploadZone.contains(e.relatedTarget)) uploadZone.classList.remove('drag-over');
});

uploadZone.addEventListener('drop', e => {
  e.preventDefault();
  uploadZone.classList.remove('drag-over');
  processFile(e.dataTransfer.files[0]);
});

// "Try again" / "Open another" buttons both return to upload state
document.getElementById('reset-btn').addEventListener('click', () => setState('upload'));
document.getElementById('reset-btn2').addEventListener('click', () => setState('upload'));
