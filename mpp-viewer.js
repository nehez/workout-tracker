// MPP Viewer — client-side Microsoft Project file parser
// Uses MPXJ loaded lazily from CDN

const CDN = 'https://cdn.jsdelivr.net/npm/mpxj/+esm';

// ── State machine ─────────────────────────────────────────────────────────────
const states = ['upload', 'loading', 'error', 'results'];

function setState(name) {
  for (const s of states) {
    const el = document.getElementById(`state-${s}`);
    if (el) el.classList.toggle('active', s === name);
  }
}

// ── Date formatting ───────────────────────────────────────────────────────────
function formatDate(d) {
  if (!d) return '—';
  try {
    // MPXJ dates may be Java Date objects with getTime(), or native JS Dates
    const ms = typeof d.getTime === 'function' ? d.getTime() : null;
    if (ms === null) return String(d);
    const date = new Date(ms);
    if (isNaN(date.getTime())) return '—';
    return date.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
  } catch {
    return '—';
  }
}

// ── Safe MPXJ accessor ────────────────────────────────────────────────────────
function safeGet(fn) {
  try {
    const val = fn();
    return val ?? null;
  } catch {
    return null;
  }
}

// ── Duration formatting ───────────────────────────────────────────────────────
function formatDuration(dur) {
  if (!dur) return '—';
  try {
    const d = safeGet(() => dur.getDuration());
    const u = safeGet(() => dur.getUnits()?.toString());
    if (d === null) return '—';
    const rounded = Math.round(d * 100) / 100;
    const unit = u ? u.replace('TIME_UNIT_', '').toLowerCase().replace('_', ' ') : 'days';
    return `${rounded} ${unit}`;
  } catch {
    return '—';
  }
}

// ── Render tasks into the table ───────────────────────────────────────────────
function renderTasks(tasks) {
  const tbody = document.getElementById('task-tbody');
  tbody.innerHTML = '';

  const fragment = document.createDocumentFragment();

  for (const task of tasks) {
    const id = safeGet(() => task.getID());
    const name = safeGet(() => task.getName());

    // Filter out root task (ID=0 or no name)
    if (id === 0 || !name) continue;

    const start = safeGet(() => task.getStart());
    const finish = safeGet(() => task.getFinish());
    const duration = safeGet(() => task.getDuration());
    const pctRaw = safeGet(() => task.getPercentageComplete());
    const outlineLevel = safeGet(() => task.getOutlineLevel()) ?? 0;
    const isSummary = safeGet(() => task.getSummary()) ?? false;

    const pct = pctRaw !== null ? Math.round(Number(pctRaw)) : 0;
    const indent = Math.max(0, (outlineLevel - 1)) * 18;

    const tr = document.createElement('tr');
    if (isSummary) tr.classList.add('summary-row');

    tr.innerHTML = `
      <td class="col-id">${id ?? '—'}</td>
      <td class="col-name">
        <span class="task-name" style="padding-left:${indent}px">${escHtml(name)}</span>
      </td>
      <td class="col-start">${formatDate(start)}</td>
      <td class="col-finish">${formatDate(finish)}</td>
      <td class="col-duration">${formatDuration(duration)}</td>
      <td class="col-complete">
        <div class="progress-wrap">
          <div class="progress-track">
            <div class="progress-fill" style="width:${pct}%"></div>
          </div>
          <span class="progress-label">${pct}%</span>
        </div>
      </td>
    `;

    fragment.appendChild(tr);
  }

  tbody.appendChild(fragment);
}

// ── HTML escape ───────────────────────────────────────────────────────────────
function escHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// ── Parse and display ─────────────────────────────────────────────────────────
async function readProject(arrayBuffer) {
  setState('loading');
  try {
    const { LocalDateTimeUtility, ProjectFile, MPPReader } = await import(CDN);

    const reader = new MPPReader();
    const bytes = new Uint8Array(arrayBuffer);
    const project = reader.read(bytes);

    const tasks = [...project.getTasks()];
    const props = project.getProjectProperties();

    const name = safeGet(() => props.getProjectTitle()) || safeGet(() => props.getName()) || '(untitled)';
    const start = safeGet(() => props.getStartDate());
    const finish = safeGet(() => props.getFinishDate());

    // Count non-root tasks
    const taskCount = tasks.filter(t => {
      const id = safeGet(() => t.getID());
      const n = safeGet(() => t.getName());
      return id !== 0 && n;
    }).length;

    document.getElementById('meta-name').textContent = name;
    document.getElementById('meta-start').textContent = formatDate(start);
    document.getElementById('meta-finish').textContent = formatDate(finish);
    document.getElementById('meta-count').textContent = taskCount;

    renderTasks(tasks);
    setState('results');
  } catch (err) {
    console.error(err);
    document.getElementById('error-message').textContent =
      err?.message || 'Failed to parse the MPP file. Make sure it is a valid Microsoft Project file.';
    setState('error');
  }
}

// ── File handling ─────────────────────────────────────────────────────────────
function handleFile(file) {
  if (!file) return;
  if (!/\.(mpp)$/i.test(file.name)) {
    document.getElementById('error-message').textContent =
      `"${file.name}" does not appear to be an MPP file.`;
    setState('error');
    return;
  }
  const reader = new FileReader();
  reader.onload = e => readProject(e.target.result);
  reader.onerror = () => {
    document.getElementById('error-message').textContent = 'Could not read the file.';
    setState('error');
  };
  reader.readAsArrayBuffer(file);
}

// ── Drag-and-drop ─────────────────────────────────────────────────────────────
const dropZone = document.getElementById('drop-zone');

dropZone.addEventListener('dragover', e => {
  e.preventDefault();
  dropZone.classList.add('drag-over');
});

dropZone.addEventListener('dragleave', () => {
  dropZone.classList.remove('drag-over');
});

dropZone.addEventListener('drop', e => {
  e.preventDefault();
  dropZone.classList.remove('drag-over');
  const file = e.dataTransfer?.files?.[0];
  handleFile(file);
});

dropZone.addEventListener('keydown', e => {
  if (e.key === 'Enter' || e.key === ' ') {
    e.preventDefault();
    document.getElementById('file-input').click();
  }
});

// ── File input ────────────────────────────────────────────────────────────────
document.getElementById('file-input').addEventListener('change', e => {
  handleFile(e.target.files?.[0]);
  e.target.value = '';
});

// ── Reset buttons ─────────────────────────────────────────────────────────────
document.getElementById('btn-try-again').addEventListener('click', () => setState('upload'));
document.getElementById('btn-open-another').addEventListener('click', () => setState('upload'));
