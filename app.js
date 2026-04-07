// ============================================================
// SUPABASE
// ============================================================
const db = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// ============================================================
// CONFIG
// ============================================================
const CONFIG = {
  phase1Trials:  40,
  phase2Trials:  40,
  probWinner:    0.75,
  probLoser:     0.25,
  feedbackMs:    950,
  windowSize:    5,
};
CONFIG.totalTrials = CONFIG.phase1Trials + CONFIG.phase2Trials;

// ============================================================
// STATE
// ============================================================
let state = {};
let localTrials = [];

function resetState(name) {
  state = {
    name,
    sessionId:    crypto.randomUUID(),
    phase1Winner: Math.random() < 0.5 ? 'A' : 'B',  // randomized each session
    currentTrial: 0,
    score:        0,
    trialStart:   null,
    accepting:    false,
    charts:       {},
  };
  localTrials = [];
}

// ============================================================
// DOM REFS
// ============================================================
const el = id => document.getElementById(id);

const refs = {
  nameInput:         el('name-input'),
  btnStart:          el('btn-start'),
  score:             el('score'),
  trialNum:          el('trial-num'),
  feedbackArea:      el('feedback-area'),
  btnA:              el('btn-A'),
  btnB:              el('btn-B'),
  resultTitle:       el('result-title'),
  resultSummary:     el('result-summary'),
  phaseReveal:       el('phase-reveal'),
  btnToCollective:   el('btn-to-collective'),
  collectiveSummary: el('collective-summary'),
  collectiveStatus:  el('collective-status'),
  btnToLearn:        el('btn-to-learn'),
  btnRestart:        el('btn-restart'),
};

// ============================================================
// NAVIGATION
// ============================================================
const SCREENS = ['welcome', 'task', 'individual', 'collective', 'learn'];

function showScreen(name) {
  SCREENS.forEach(s =>
    el(`screen-${s}`).classList.toggle('active', s === name)
  );
  window.scrollTo(0, 0);
}

// ============================================================
// REWARD LOGIC
// ============================================================

// Returns true if `choice` is the optimal option for this trial
function isOptimal(choice, trialNumber, phase1Winner) {
  const inPhase1 = trialNumber <= CONFIG.phase1Trials;
  return inPhase1
    ? choice === phase1Winner
    : choice !== phase1Winner;
}

// Reward probability for a given choice
function rewardProb(choice, trialNumber, phase1Winner) {
  return isOptimal(choice, trialNumber, phase1Winner)
    ? CONFIG.probWinner
    : CONFIG.probLoser;
}

// ============================================================
// EXPERIMENT
// ============================================================
function startExperiment() {
  const name = refs.nameInput.value.trim();
  if (!name) return;
  resetState(name);
  refs.score.textContent = '0';
  showScreen('task');
  nextTrial();
}

function nextTrial() {
  state.currentTrial++;
  refs.trialNum.textContent  = state.currentTrial;
  refs.feedbackArea.textContent = '';
  refs.feedbackArea.className   = 'feedback-area';
  refs.btnA.disabled = false;
  refs.btnB.disabled = false;
  refs.btnA.classList.remove('pressed');
  refs.btnB.classList.remove('pressed');
  state.accepting  = true;
  state.trialStart = Date.now();
}

function handleChoice(choice) {
  if (!state.accepting) return;
  state.accepting = false;

  const rt      = Date.now() - state.trialStart;
  const prob    = rewardProb(choice, state.currentTrial, state.phase1Winner);
  const rewarded = Math.random() < prob;

  if (rewarded) state.score++;
  refs.score.textContent = state.score;

  const btn = choice === 'A' ? refs.btnA : refs.btnB;
  btn.classList.add('pressed');
  refs.btnA.disabled = true;
  refs.btnB.disabled = true;

  refs.feedbackArea.textContent = rewarded ? '+1 punto ✓' : 'Sin punto  ✗';
  refs.feedbackArea.className   = `feedback-area ${rewarded ? 'fb-reward' : 'fb-no-reward'}`;

  const phase = state.currentTrial <= CONFIG.phase1Trials ? 1 : 2;

  const trial = {
    session_id:       state.sessionId,
    participant_name: state.name,
    trial_number:     state.currentTrial,
    phase,
    choice,
    phase1_winner:    state.phase1Winner,
    rewarded,
    cumulative_score: state.score,
    reaction_time_ms: rt,
  };

  localTrials.push(trial);
  saveTrial(trial);

  setTimeout(() => {
    if (state.currentTrial >= CONFIG.totalTrials) {
      showIndividualResults();
    } else {
      nextTrial();
    }
  }, CONFIG.feedbackMs);
}

async function saveTrial(trial) {
  try {
    await db.from('trials').insert([trial]);
  } catch (_) {
    // silent — experiment continues without data persistence
  }
}

// ============================================================
// LEARNING CURVE HELPERS
// ============================================================

// % of trials in each window where participant chose the OPTIMAL option
function windowedOptimal(trials, phase1Winner) {
  const w = CONFIG.windowSize;
  const n = Math.floor(CONFIG.totalTrials / w);
  return Array.from({ length: n }, (_, i) => {
    const start = i * w + 1;
    const end   = start + w - 1;
    const slice = trials.filter(t => t.trial_number >= start && t.trial_number <= end);
    const optCount = slice.filter(t => isOptimal(t.choice, t.trial_number, phase1Winner)).length;
    const pct = slice.length ? (optCount / slice.length) * 100 : null;
    return { x: Math.round((start + end) / 2), y: pct };
  });
}

// Flat line at 75%: reward probability if you always choose optimally
function probSchedule() {
  return [
    { x: 1,                  y: CONFIG.probWinner * 100 },
    { x: CONFIG.totalTrials, y: CONFIG.probWinner * 100 },
  ];
}

// Inline Chart.js plugin: vertical dashed line at a given x
function vertLinePlugin(atX) {
  return {
    id: 'vertLine',
    beforeDraw(chart) {
      const { ctx, scales: { x, y } } = chart;
      const px = x.getPixelForValue(atX);
      ctx.save();
      ctx.beginPath();
      ctx.setLineDash([5, 4]);
      ctx.strokeStyle = '#4a4d6a';
      ctx.lineWidth = 1.5;
      ctx.moveTo(px, y.top);
      ctx.lineTo(px, y.bottom);
      ctx.stroke();
      ctx.restore();
    },
  };
}

function baseChartOptions() {
  return {
    responsive: true,
    maintainAspectRatio: false,
    parsing: false,
    scales: {
      x: {
        type: 'linear',
        min: 1,
        max: CONFIG.totalTrials,
        title: { display: true, text: 'Turno', color: '#8b8fa8', font: { family: 'DM Mono', size: 11 } },
        grid: { color: '#2a2d3e' },
        ticks: { color: '#8b8fa8', font: { family: 'DM Mono', size: 11 } },
        border: { color: '#2a2d3e' },
      },
      y: {
        min: 0,
        max: 100,
        title: { display: true, text: '% elige opción ganadora', color: '#8b8fa8', font: { family: 'DM Mono', size: 11 } },
        ticks: { color: '#8b8fa8', font: { family: 'DM Mono', size: 11 }, callback: v => v + '%' },
        grid: { color: '#2a2d3e' },
        border: { color: '#2a2d3e' },
      },
    },
    plugins: {
      legend: {
        position: 'bottom',
        labels: { boxWidth: 12, font: { family: 'DM Mono', size: 11 }, color: '#8b8fa8', padding: 16 },
      },
      tooltip: {
        backgroundColor: '#1e2030',
        borderColor: '#2a2d3e',
        borderWidth: 1,
        titleColor: '#e8e9f0',
        bodyColor: '#8b8fa8',
        callbacks: {
          label: ctx =>
            `${ctx.dataset.label}: ${ctx.parsed.y != null ? ctx.parsed.y.toFixed(0) + '%' : '—'}`,
        },
      },
    },
  };
}

// ============================================================
// INDIVIDUAL RESULTS
// ============================================================
function showIndividualResults() {
  showScreen('individual');

  const winner = state.phase1Winner;
  const loser  = winner === 'A' ? 'B' : 'A';

  refs.resultTitle.textContent = `Tus resultados, ${state.name}`;

  const pct = Math.round((state.score / CONFIG.totalTrials) * 100);
  refs.resultSummary.textContent =
    `Acumulaste ${state.score} puntos de ${CONFIG.totalTrials} posibles (${pct}%).`;

  refs.phaseReveal.innerHTML =
    `<strong>Lo que pasó:</strong> en esta sesión, la opción <strong>${winner}</strong> era la ganadora
     en los primeros 40 turnos (75% de probabilidad de punto). En el turno 41, la ganadora
     pasó a ser la opción <strong>${loser}</strong> sin ningún aviso.
     La línea azul marca el 75%: la probabilidad de recompensa si siempre elegís la opción ganadora.
     La línea vertical señala el momento del cambio. ¿Lo notaste?`;

  if (state.charts.individual) state.charts.individual.destroy();

  const ctx = el('chart-individual').getContext('2d');
  state.charts.individual = new Chart(ctx, {
    type: 'line',
    plugins: [vertLinePlugin(40.5)],
    data: {
      datasets: [
        {
          label: 'Tus elecciones (% opción ganadora)',
          data: windowedOptimal(localTrials, winner),
          borderColor: '#e8c547',
          backgroundColor: 'rgba(232,197,71,0.08)',
          tension: 0.35,
          pointRadius: 4,
          pointBackgroundColor: '#e8c547',
          fill: false,
        },
        {
          label: 'Probabilidad de recompensa (óptimo)',
          data: probSchedule(),
          borderColor: '#5b8dee',
          borderDash: [6, 4],
          borderWidth: 2,
          pointRadius: 0,
          tension: 0,
          fill: false,
        },
      ],
    },
    options: baseChartOptions(),
  });
}

// ============================================================
// COLLECTIVE RESULTS
// ============================================================
async function showCollectiveResults() {
  showScreen('collective');
  refs.collectiveStatus.textContent = 'Cargando datos del grupo…';
  refs.collectiveSummary.textContent = '';

  if (state.charts.collective) state.charts.collective.destroy();

  try {
    const { data, error } = await db
      .from('trials')
      .select('session_id, participant_name, trial_number, choice, phase1_winner, cumulative_score')
      .order('trial_number', { ascending: true });

    if (error) throw error;

    // Group by session; keep only complete sessions
    const sessions = {};
    data.forEach(row => {
      if (!sessions[row.session_id]) sessions[row.session_id] = [];
      sessions[row.session_id].push(row);
    });

    const complete = Object.values(sessions).filter(s => s.length >= CONFIG.totalTrials);
    const n = complete.length;

    refs.collectiveStatus.textContent = '';
    refs.collectiveSummary.textContent = n > 0
      ? `Promedio de ${n} sesión${n !== 1 ? 'es' : ''} completa${n !== 1 ? 's' : ''}.`
      : 'Todavía no hay sesiones completas del grupo.';

    if (n === 0) return;

    // Each session has its own phase1_winner — compute optimal curve per session
    const curves = complete.map(s => {
      const winner = s[0].phase1_winner;
      return windowedOptimal(s, winner);
    });

    const avgData = curves[0].map((pt, i) => {
      const ys  = curves.map(c => c[i].y).filter(v => v != null);
      const avg = ys.reduce((a, b) => a + b, 0) / ys.length;
      return { x: pt.x, y: Math.round(avg * 10) / 10 };
    });

    const ctx = el('chart-collective').getContext('2d');
    state.charts.collective = new Chart(ctx, {
      type: 'line',
      plugins: [vertLinePlugin(40.5)],
      data: {
        datasets: [
          {
            label: 'Promedio del grupo (% opción ganadora)',
            data: avgData,
            borderColor: '#e8c547',
            backgroundColor: 'rgba(232,197,71,0.08)',
            tension: 0.35,
            pointRadius: 4,
            pointBackgroundColor: '#e8c547',
            fill: false,
          },
          {
            label: 'Probabilidad de recompensa (óptimo)',
            data: probSchedule(),
            borderColor: '#5b8dee',
            borderDash: [6, 4],
            borderWidth: 2,
            pointRadius: 0,
            tension: 0,
            fill: false,
          },
        ],
      },
      options: baseChartOptions(),
    });

    renderLeaderboard(complete);

  } catch (_) {
    refs.collectiveStatus.textContent = 'No se pudieron cargar los datos del grupo.';
  }
}

// ============================================================
// LEADERBOARD
// ============================================================
function renderLeaderboard(sessions) {
  const lbEl     = el('leaderboard');
  const rowsEl   = el('lb-rows');
  const statusEl = el('lb-status');

  if (!sessions.length) { lbEl.style.display = 'none'; return; }

  const scores = sessions.map(s => ({
    name:  s[0].participant_name,
    score: Math.max(...s.map(t => t.cumulative_score)),
  }));

  scores.sort((a, b) => b.score - a.score);
  const top10 = scores.slice(0, 10);

  const medals     = ['🥇', '🥈', '🥉'];
  const rankCls    = ['r1', 'r2', 'r3'];

  statusEl.textContent = `Top ${top10.length}`;
  rowsEl.innerHTML = top10.map((entry, i) => {
    const rank   = i < 3 ? medals[i] : i + 1;
    const rCls   = i < 3 ? rankCls[i] : 'rn';
    const rowCls = i < 4 ? `rank-${i + 1}` : '';
    return `
      <div class="lb-row ${rowCls}">
        <div class="lb-rank ${rCls}">${rank}</div>
        <div class="lb-info"><div class="lb-name">${entry.name}</div></div>
        <div class="lb-score ${i === 0 ? 'r1' : ''}">${entry.score}</div>
      </div>`;
  }).join('');

  lbEl.style.display = 'block';
}

// ============================================================
// EVENT LISTENERS
// ============================================================
refs.nameInput.addEventListener('input', () => {
  refs.btnStart.disabled = refs.nameInput.value.trim().length === 0;
});

refs.nameInput.addEventListener('keydown', e => {
  if (e.key === 'Enter' && !refs.btnStart.disabled) refs.btnStart.click();
});

refs.btnStart.addEventListener('click', startExperiment);
refs.btnA.addEventListener('click', () => handleChoice('A'));
refs.btnB.addEventListener('click', () => handleChoice('B'));
refs.btnToCollective.addEventListener('click', showCollectiveResults);
refs.btnToLearn.addEventListener('click', () => showScreen('learn'));
refs.btnRestart.addEventListener('click', () => {
  refs.nameInput.value = '';
  refs.btnStart.disabled = true;
  showScreen('welcome');
});

// Arrow keys: ← = A, → = B (desktop only)
document.addEventListener('keydown', e => {
  if (!state.accepting) return;
  if (e.key === 'ArrowLeft')  handleChoice('A');
  if (e.key === 'ArrowRight') handleChoice('B');
});
