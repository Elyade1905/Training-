'use strict';

// ===== STORAGE =====
const DB = {
  KEY: 'workout_tracker_v1',
  load() {
    try {
      return JSON.parse(localStorage.getItem(this.KEY)) || { plans: [], sessions: [] };
    } catch { return { plans: [], sessions: [] }; }
  },
  save(data) {
    localStorage.setItem(this.KEY, JSON.stringify(data));
  },
  get() { return this._cache || (this._cache = this.load()); },
  commit() { this.save(this._cache); },
  reset() { this._cache = null; }
};

// ===== UTILITIES =====
function uuid() {
  return crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).slice(2);
}

function fmtDate(iso) {
  const d = new Date(iso);
  return d.toLocaleDateString('de-DE', { weekday: 'short', day: '2-digit', month: '2-digit', year: '2-digit' });
}

function fmtDateTime(iso) {
  const d = new Date(iso);
  return d.toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: '2-digit' }) +
    ' ' + d.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' });
}

function fmtDateTimeLocal(iso) {
  const d = new Date(iso);
  const pad = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function sessionVolume(session) {
  return session.exercises.reduce((total, ex) =>
    total + ex.sets.reduce((s, set) => s + (set.weight || 0) * (set.reps || 0), 0), 0);
}

function getExerciseHistory(name) {
  const db = DB.get();
  const entries = [];
  db.sessions.forEach(s => {
    s.exercises.forEach(ex => {
      if (ex.name.toLowerCase() === name.toLowerCase()) {
        entries.push({ date: s.date, sets: ex.sets, sessionId: s.id });
      }
    });
  });
  return entries.sort((a, b) => new Date(a.date) - new Date(b.date));
}

function getExerciseNames() {
  const db = DB.get();
  const names = new Set();
  db.sessions.forEach(s => s.exercises.forEach(ex => { if (ex.name.trim()) names.add(ex.name.trim()); }));
  db.plans.forEach(p => p.exercises.forEach(n => { if (n.trim()) names.add(n.trim()); }));
  return [...names].sort((a, b) => a.localeCompare(b, 'de'));
}

function maxWeight(history) {
  let max = 0;
  history.forEach(e => e.sets.forEach(s => { if ((s.weight || 0) > max) max = s.weight; }));
  return max;
}

function progressPercent(history) {
  if (history.length < 2) return null;
  const first = Math.max(...history[0].sets.map(s => s.weight || 0));
  const last = Math.max(...history[history.length - 1].sets.map(s => s.weight || 0));
  if (!first) return null;
  return Math.round(((last - first) / first) * 100);
}

function weekStreak() {
  const db = DB.get();
  if (!db.sessions.length) return 0;
  const days = new Set(db.sessions.map(s => s.date.slice(0, 10)));
  let streak = 0;
  const today = new Date();
  for (let i = 0; i < 365; i++) {
    const d = new Date(today);
    d.setDate(d.getDate() - i);
    if (days.has(d.toISOString().slice(0, 10))) streak++;
    else if (i > 0) break;
  }
  return streak;
}

function sessionsThisWeek() {
  const db = DB.get();
  const now = new Date();
  const start = new Date(now);
  start.setDate(now.getDate() - now.getDay() + (now.getDay() === 0 ? -6 : 1));
  start.setHours(0, 0, 0, 0);
  return db.sessions.filter(s => new Date(s.date) >= start).length;
}

// ===== TOAST =====
let _toastTimer;
function showToast(msg) {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(_toastTimer);
  _toastTimer = setTimeout(() => el.classList.remove('show'), 2500);
}

// ===== MODAL =====
let _activeModal = null;
const modalCtrl = {
  open(id) {
    if (_activeModal) document.getElementById(_activeModal)?.classList.remove('open');
    _activeModal = id;
    document.getElementById(id).classList.add('open');
    document.body.style.overflow = 'hidden';
  },
  close() {
    if (_activeModal) {
      document.getElementById(_activeModal)?.classList.remove('open');
      _activeModal = null;
    }
    document.body.style.overflow = '';
  },
  closeOnBackdrop(e) {
    if (e.target === e.currentTarget) this.close();
  }
};

// ===== CHART INSTANCE =====
let _detailChart = null;

// ===== APP =====
const App = {
  modal: modalCtrl,

  navigate(view, data) {
    document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
    document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));

    const viewEl = document.getElementById('view-' + view);
    if (viewEl) viewEl.classList.add('active');

    const navEl = document.querySelector(`.nav-item[data-view="${view}"]`);
    if (navEl) navEl.classList.add('active');

    const renderers = {
      dashboard: () => App.dashboard.render(),
      history: () => App.history.render(),
      exercises: () => App.exercises.render(),
      plans: () => App.plans.render(),
      log: () => App.log.init(data),
      'exercise-detail': () => App.exercises.renderDetail(data),
    };
    renderers[view]?.();
    modalCtrl.close();
  },

  // ===== DASHBOARD =====
  dashboard: {
    render() {
      const db = DB.get();
      document.getElementById('dashboard-date').textContent =
        new Date().toLocaleDateString('de-DE', { weekday: 'long', day: 'numeric', month: 'long' });
      document.getElementById('kpi-week-count').textContent = sessionsThisWeek();
      document.getElementById('kpi-total-count').textContent = db.sessions.length;
      document.getElementById('kpi-streak').textContent = weekStreak();
      document.getElementById('kpi-exercises').textContent = getExerciseNames().length;

      const recent = [...db.sessions].sort((a, b) => new Date(b.date) - new Date(a.date)).slice(0, 5);
      const container = document.getElementById('dashboard-recent');
      if (!recent.length) {
        container.innerHTML = '<p class="empty-state">Noch kein Training. Leg los!</p>';
        return;
      }
      container.innerHTML = recent.map(s => renderSessionCard(s, db)).join('');
    }
  },

  // ===== HISTORY =====
  history: {
    render() {
      const db = DB.get();
      const sorted = [...db.sessions].sort((a, b) => new Date(b.date) - new Date(a.date));
      const container = document.getElementById('history-list');
      const empty = document.getElementById('history-empty');
      if (!sorted.length) {
        container.innerHTML = '';
        empty.style.display = '';
        return;
      }
      empty.style.display = 'none';
      container.innerHTML = sorted.map(s => renderSessionCard(s, db)).join('');
    }
  },

  // ===== EXERCISES =====
  exercises: {
    _all: [],
    render() {
      this._all = getExerciseNames();
      this._renderList(this._all);
    },
    filter(q) {
      const filtered = q ? this._all.filter(n => n.toLowerCase().includes(q.toLowerCase())) : this._all;
      this._renderList(filtered);
    },
    _renderList(names) {
      const container = document.getElementById('exercise-list');
      const empty = document.getElementById('exercise-empty');
      if (!names.length) {
        container.innerHTML = '';
        empty.style.display = '';
        return;
      }
      empty.style.display = 'none';
      container.innerHTML = names.map(name => {
        const hist = getExerciseHistory(name);
        const pb = maxWeight(hist);
        const prog = progressPercent(hist);
        return `<div class="exercise-card" onclick="App.navigate('exercise-detail','${encodeURIComponent(name)}')">
          <div>
            <div class="exercise-card-name">${name}</div>
            <div class="exercise-card-meta">${hist.length} Session${hist.length !== 1 ? 's' : ''}${prog !== null ? ` · ${prog >= 0 ? '+' : ''}${prog}%` : ''}</div>
          </div>
          <div class="exercise-card-pb">
            <span class="pb-value">${pb || '–'}</span>
            <span class="pb-label">kg PB</span>
          </div>
        </div>`;
      }).join('');
    },
    renderDetail(encodedName) {
      const name = decodeURIComponent(encodedName);
      document.getElementById('exercise-detail-name').textContent = name;
      document.getElementById('exercise-detail-back').onclick = () => App.navigate('exercises');

      const hist = getExerciseHistory(name);
      const pb = maxWeight(hist);
      const prog = progressPercent(hist);

      document.getElementById('detail-pb').textContent = pb || '–';
      document.getElementById('detail-progress').textContent = prog !== null ? (prog >= 0 ? '+' : '') + prog : '–';
      document.getElementById('detail-sessions').textContent = hist.length;

      // Chart
      if (_detailChart) { _detailChart.destroy(); _detailChart = null; }
      const ctx = document.getElementById('detail-chart').getContext('2d');
      const labels = hist.map(e => fmtDate(e.date));
      const maxWeights = hist.map(e => Math.max(...e.sets.map(s => s.weight || 0)));
      const volumes = hist.map(e => e.sets.reduce((s, set) => s + (set.weight || 0) * (set.reps || 0), 0));

      _detailChart = new Chart(ctx, {
        type: 'line',
        data: {
          labels,
          datasets: [
            {
              label: 'Max. Gewicht (kg)',
              data: maxWeights,
              borderColor: '#6c63ff',
              backgroundColor: 'rgba(108,99,255,0.15)',
              tension: 0.3,
              fill: true,
              pointBackgroundColor: '#6c63ff',
              yAxisID: 'y',
            },
            {
              label: 'Volumen (kg×Wdh)',
              data: volumes,
              borderColor: '#22c55e',
              backgroundColor: 'rgba(34,197,94,0.08)',
              tension: 0.3,
              fill: false,
              pointBackgroundColor: '#22c55e',
              borderDash: [4, 4],
              yAxisID: 'y2',
            }
          ]
        },
        options: {
          responsive: true,
          interaction: { mode: 'index', intersect: false },
          plugins: {
            legend: { labels: { color: '#9898b8', font: { size: 11 } } }
          },
          scales: {
            x: { ticks: { color: '#9898b8', maxTicksLimit: 6 }, grid: { color: '#2e2e42' } },
            y: { ticks: { color: '#6c63ff' }, grid: { color: '#2e2e42' }, title: { display: true, text: 'kg', color: '#6c63ff' } },
            y2: { position: 'right', ticks: { color: '#22c55e' }, grid: { display: false }, title: { display: true, text: 'Vol.', color: '#22c55e' } }
          }
        }
      });

      // History list
      const allPBW = pb;
      const detailHistory = document.getElementById('detail-history');
      if (!hist.length) {
        detailHistory.innerHTML = '<p class="empty-state">Noch keine Daten.</p>';
        return;
      }
      detailHistory.innerHTML = [...hist].reverse().map(e => {
        const maxW = Math.max(...e.sets.map(s => s.weight || 0));
        const isPB = maxW === allPBW;
        const setsStr = e.sets.map((s, i) => `Set ${i+1}: ${s.weight}kg × ${s.reps}`).join(' | ');
        return `<div class="detail-row">
          <div>
            <div class="detail-row-date">${fmtDate(e.date)}</div>
            <div class="detail-row-sets">${setsStr}</div>
          </div>
          <div class="detail-row-max ${isPB ? 'pb' : ''}">${maxW}kg${isPB ? ' 🏆' : ''}</div>
        </div>`;
      }).join('');
    }
  },

  // ===== LOG =====
  log: {
    _mode: 'plan',
    _editId: null,

    init(editId) {
      this._editId = editId || null;
      const db = DB.get();

      // datetime
      const dtInput = document.getElementById('log-datetime');
      if (editId) {
        const session = db.sessions.find(s => s.id === editId);
        if (session) dtInput.value = fmtDateTimeLocal(session.date);
      } else {
        dtInput.value = fmtDateTimeLocal(new Date().toISOString());
      }

      // populate plan select
      const sel = document.getElementById('log-plan-id');
      sel.innerHTML = '<option value="">– Plan wählen –</option>';
      db.plans.forEach(p => {
        const opt = document.createElement('option');
        opt.value = p.id;
        opt.textContent = p.name;
        sel.appendChild(opt);
      });

      if (editId) {
        const session = db.sessions.find(s => s.id === editId);
        if (session) {
          this.switchMode(session.planId ? 'plan' : 'free');
          if (session.planId) sel.value = session.planId;
          document.getElementById('log-note').value = session.note || '';
          const exContainer = document.getElementById('log-exercises');
          exContainer.innerHTML = '';
          session.exercises.forEach(ex => this.addExercise(ex.name, ex.sets));
          return;
        }
      }

      document.getElementById('log-note').value = '';
      document.getElementById('log-exercises').innerHTML = '';
      this.switchMode('plan');
    },

    switchMode(mode) {
      this._mode = mode;
      document.getElementById('seg-plan').classList.toggle('active', mode === 'plan');
      document.getElementById('seg-free').classList.toggle('active', mode === 'free');
      document.getElementById('log-plan-select').style.display = mode === 'plan' ? '' : 'none';
      if (mode === 'free') {
        document.getElementById('log-plan-id').value = '';
        document.getElementById('log-exercises').innerHTML = '';
      }
    },

    onPlanSelect() {
      const db = DB.get();
      const planId = document.getElementById('log-plan-id').value;
      const exContainer = document.getElementById('log-exercises');
      exContainer.innerHTML = '';
      if (!planId) return;
      const plan = db.plans.find(p => p.id === planId);
      if (plan) plan.exercises.forEach(name => this.addExercise(name));
    },

    addExercise(name, sets) {
      const exContainer = document.getElementById('log-exercises');
      const id = uuid();
      const div = document.createElement('div');
      div.className = 'log-exercise';
      div.dataset.exId = id;

      const initialSets = sets || [{ weight: '', reps: '' }];
      div.innerHTML = `
        <div class="log-exercise-header">
          <input type="text" class="ex-name" placeholder="Übungsname" value="${name || ''}">
          <button class="log-exercise-remove" onclick="App.log.removeExercise('${id}')">
            <svg viewBox="0 0 24 24"><path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/></svg>
          </button>
        </div>
        <table class="sets-table">
          <thead><tr><th>#</th><th>Gewicht (kg)</th><th>Wdh.</th><th></th></tr></thead>
          <tbody class="sets-body"></tbody>
        </table>
        <button class="btn-add-set" onclick="App.log.addSet('${id}')">+ Set hinzufügen</button>
      `;
      exContainer.appendChild(div);
      initialSets.forEach(s => this.addSet(id, s));
    },

    addSet(exId, data) {
      const tbody = document.querySelector(`[data-ex-id="${exId}"] .sets-body`);
      if (!tbody) return;
      const idx = tbody.rows.length + 1;
      const row = document.createElement('tr');
      row.innerHTML = `
        <td class="set-row-num">${idx}</td>
        <td><input type="number" class="set-weight" placeholder="0" min="0" step="0.5" value="${data?.weight || ''}"></td>
        <td><input type="number" class="set-reps" placeholder="0" min="0" step="1" value="${data?.reps || ''}"></td>
        <td>
          <button class="btn-remove-set" onclick="App.log.removeSet(this)">
            <svg viewBox="0 0 24 24"><path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/></svg>
          </button>
        </td>
      `;
      tbody.appendChild(row);
    },

    removeSet(btn) {
      const row = btn.closest('tr');
      const tbody = row.parentElement;
      row.remove();
      tbody.querySelectorAll('.set-row-num').forEach((cell, i) => { cell.textContent = i + 1; });
    },

    removeExercise(id) {
      document.querySelector(`[data-ex-id="${id}"]`)?.remove();
    },

    collectData() {
      const exercises = [];
      document.querySelectorAll('#log-exercises .log-exercise').forEach(div => {
        const name = div.querySelector('.ex-name').value.trim();
        if (!name) return;
        const sets = [];
        div.querySelectorAll('.sets-body tr').forEach(row => {
          const w = parseFloat(row.querySelector('.set-weight').value);
          const r = parseInt(row.querySelector('.set-reps').value);
          if (!isNaN(w) || !isNaN(r)) sets.push({ weight: isNaN(w) ? 0 : w, reps: isNaN(r) ? 0 : r });
        });
        if (sets.length) exercises.push({ name, sets });
      });
      return exercises;
    },

    save() {
      const db = DB.get();
      const dtVal = document.getElementById('log-datetime').value;
      if (!dtVal) { showToast('Bitte Datum & Uhrzeit angeben'); return; }
      const exercises = this.collectData();
      if (!exercises.length) { showToast('Mindestens eine Übung mit Sets eintragen'); return; }

      const planId = this._mode === 'plan' ? (document.getElementById('log-plan-id').value || null) : null;
      const note = document.getElementById('log-note').value.trim();

      if (this._editId) {
        const idx = db.sessions.findIndex(s => s.id === this._editId);
        if (idx >= 0) {
          db.sessions[idx] = { ...db.sessions[idx], date: new Date(dtVal).toISOString(), exercises, planId, note };
        }
      } else {
        db.sessions.push({ id: uuid(), date: new Date(dtVal).toISOString(), exercises, planId, note });
      }

      DB.commit();
      DB.reset();
      showToast(this._editId ? 'Session aktualisiert!' : 'Session gespeichert!');
      this._editId = null;
      App.navigate('dashboard');
    }
  },

  // ===== PLANS =====
  plans: {
    render() {
      const db = DB.get();
      const container = document.getElementById('plans-list');
      const empty = document.getElementById('plans-empty');
      if (!db.plans.length) {
        container.innerHTML = '';
        empty.style.display = '';
        return;
      }
      empty.style.display = 'none';
      container.innerHTML = db.plans.map(p => `
        <div class="plan-card">
          <div class="plan-card-header">
            <span class="plan-card-name">${p.name}</span>
            <div class="plan-card-actions">
              <button class="btn-icon" onclick="App.plans.openForm('${p.id}')">
                <svg viewBox="0 0 24 24"><path d="M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25zM20.71 7.04c.39-.39.39-1.02 0-1.41l-2.34-2.34c-.39-.39-1.02-.39-1.41 0l-1.83 1.83 3.75 3.75 1.83-1.83z"/></svg>
              </button>
              <button class="btn-icon danger" onclick="App.plans.delete('${p.id}')">
                <svg viewBox="0 0 24 24"><path d="M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z"/></svg>
              </button>
            </div>
          </div>
          <div class="plan-card-exercises">${p.exercises.join(' · ') || 'Keine Übungen'}</div>
          <button class="btn-primary plan-start-btn" onclick="App.log.init(); App.navigate('log'); setTimeout(()=>{ document.getElementById('log-plan-id').value='${p.id}'; App.log.onPlanSelect(); App.log.switchMode('plan'); document.getElementById('seg-plan').classList.add('active'); document.getElementById('log-plan-select').style.display=''; },50)">
            Training starten
          </button>
        </div>
      `).join('');
    },

    openForm(planId) {
      const db = DB.get();
      const plan = planId ? db.plans.find(p => p.id === planId) : null;
      document.getElementById('modal-plan-title').textContent = plan ? 'Plan bearbeiten' : 'Plan erstellen';
      document.getElementById('plan-form-id').value = planId || '';
      document.getElementById('plan-form-name').value = plan?.name || '';
      document.getElementById('plan-form-exercises').innerHTML = '';
      const exercises = plan?.exercises || [''];
      exercises.forEach(e => this.addExerciseRow(e));
      modalCtrl.open('modal-plan');
    },

    addExerciseRow(val) {
      const container = document.getElementById('plan-form-exercises');
      const div = document.createElement('div');
      div.className = 'plan-exercise-row';
      div.innerHTML = `
        <input type="text" placeholder="Übungsname" value="${val || ''}">
        <button class="btn-icon danger" onclick="this.parentElement.remove()">
          <svg viewBox="0 0 24 24"><path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/></svg>
        </button>
      `;
      container.appendChild(div);
    },

    save() {
      const db = DB.get();
      const name = document.getElementById('plan-form-name').value.trim();
      if (!name) { showToast('Plan-Name angeben'); return; }
      const exercises = [...document.querySelectorAll('#plan-form-exercises .plan-exercise-row input')]
        .map(i => i.value.trim()).filter(Boolean);
      const planId = document.getElementById('plan-form-id').value;

      if (planId) {
        const idx = db.plans.findIndex(p => p.id === planId);
        if (idx >= 0) db.plans[idx] = { ...db.plans[idx], name, exercises };
      } else {
        db.plans.push({ id: uuid(), name, exercises });
      }

      DB.commit();
      DB.reset();
      modalCtrl.close();
      showToast(planId ? 'Plan aktualisiert' : 'Plan erstellt');
      this.render();
    },

    delete(planId) {
      if (!confirm('Plan wirklich löschen?')) return;
      const db = DB.get();
      db.plans = db.plans.filter(p => p.id !== planId);
      DB.commit();
      DB.reset();
      showToast('Plan gelöscht');
      this.render();
    }
  }
};

// ===== SESSION CARD RENDERER =====
function renderSessionCard(s, db) {
  const plan = s.planId ? db.plans.find(p => p.id === s.planId) : null;
  const vol = sessionVolume(s);
  const exNames = s.exercises.map(e => e.name).join(', ');
  return `<div class="session-card" onclick="App.openSession('${s.id}')">
    <div class="session-card-header">
      <span class="session-card-date">${fmtDateTime(s.date)}</span>
      ${plan ? `<span class="session-card-plan">${plan.name}</span>` : ''}
    </div>
    <div class="session-card-exercises">${exNames}</div>
    <div class="session-card-volume">${vol > 0 ? `Volumen: ${vol.toLocaleString('de-DE')} kg` : ''}</div>
  </div>`;
}

// ===== SESSION DETAIL MODAL =====
App.openSession = function(sessionId) {
  const db = DB.get();
  const s = db.sessions.find(s => s.id === sessionId);
  if (!s) return;
  const plan = s.planId ? db.plans.find(p => p.id === s.planId) : null;

  document.getElementById('modal-session-title').textContent = fmtDateTime(s.date) + (plan ? ` — ${plan.name}` : '');

  const body = document.getElementById('modal-session-body');
  body.innerHTML = s.exercises.map(ex => `
    <div class="session-modal-exercise">
      <h3>${ex.name}</h3>
      ${ex.sets.map((set, i) => `
        <div class="session-modal-set">
          <span>Set ${i+1}:</span>
          <strong>${set.weight} kg</strong>
          <span>×</span>
          <strong>${set.reps} Wdh.</strong>
          <span style="color:var(--text2)">(${set.weight * set.reps} kg Vol.)</span>
        </div>
      `).join('')}
    </div>
  `).join('') + (s.note ? `<p style="color:var(--text2);font-style:italic;margin-top:8px">"${s.note}"</p>` : '');

  document.getElementById('modal-session-delete').onclick = () => {
    if (!confirm('Session wirklich löschen?')) return;
    const db2 = DB.get();
    db2.sessions = db2.sessions.filter(x => x.id !== sessionId);
    DB.commit();
    DB.reset();
    modalCtrl.close();
    showToast('Session gelöscht');
    const activeView = document.querySelector('.view.active')?.id?.replace('view-', '');
    if (activeView === 'history') App.history.render();
    else App.dashboard.render();
  };

  document.getElementById('modal-session-edit').onclick = () => {
    modalCtrl.close();
    App.navigate('log', sessionId);
  };

  modalCtrl.open('modal-session');
};

// ===== PWA SERVICE WORKER =====
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js').catch(() => {});
  });
}

// ===== INIT =====
document.addEventListener('DOMContentLoaded', () => {
  App.navigate('dashboard');
});
