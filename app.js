(() => {
  const KEY = 'focusflow-data-v1';
  const todayKey = () => localDateKey(new Date());
  const esc = (s) => String(s).replace(/[&<>'"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]));
  const uid = () => `${Date.now().toString(36)}-${Math.random().toString(36).slice(2,8)}`;
  const pad = n => String(n).padStart(2,'0');
  const localDateKey = d => `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`;
  const parseKey = key => { const [y,m,day] = key.split('-').map(Number); return new Date(y,m-1,day); };
  const formatDate = key => parseKey(key).toLocaleDateString(undefined,{weekday:'long',month:'short',day:'numeric',year:'numeric'});
  const shortDate = key => parseKey(key).toLocaleDateString(undefined,{month:'short',day:'numeric'});
  const fmtMins = mins => {
    mins = Math.max(0, Math.round(mins || 0));
    const h = Math.floor(mins/60), m = mins%60;
    if (!h) return `${m} min`;
    if (!m) return `${h} hr`;
    return `${h} hr ${m} min`;
  };
  const fmtClock = secs => `${pad(Math.floor(Math.max(0,secs)/60))}:${pad(Math.max(0,secs)%60)}`;
  const blankDay = () => ({ timers: [], reps: [] });
  const defaultData = () => ({ days: {}, exercises: [], version: 1 });
  let data = load();
  let selectedDate = todayKey();
  let activeTab = 'focus';
  let openLogExercise = null;
  let editTimerId = null;
  let fullscreenTimerId = null;
  const FULLSCREEN_STATE_KEY = 'focusflow-fullscreen-timer-id';
  let toastTimer;
  let deferredInstallPrompt = null;
  let audioContext = null;
  let lastNotificationTick = {};
  let notificationSyncBusy = false;
  let notificationSyncQueued = false;
  let fullscreenEventsBound = false;
  let completionTimeouts = {};
  const NOTIFICATION_REFRESH_SECONDS = 1;
  const TIMER_NOTIFICATION_TAG_PREFIX = 'focusflow-timer-';

  function load() {
    try {
      const x = JSON.parse(localStorage.getItem(KEY));
      if (x && x.version === 1) return x;
    } catch {}
    return defaultData();
  }
  function save() { localStorage.setItem(KEY, JSON.stringify(data)); }
  function day(key=selectedDate) { if (!data.days[key]) data.days[key] = blankDay(); return data.days[key]; }

  function rememberFullscreenTimer(id) {
    try { sessionStorage.setItem(FULLSCREEN_STATE_KEY, id); } catch {}
  }
  function forgetFullscreenTimer() {
    try { sessionStorage.removeItem(FULLSCREEN_STATE_KEY); } catch {}
  }
  function rememberedFullscreenTimerId() {
    try { return sessionStorage.getItem(FULLSCREEN_STATE_KEY); } catch { return null; }
  }
  function getRunningTimers() {
    const running = [];
    Object.entries(data.days).forEach(([dateKey, d]) => {
      d.timers.forEach(t => {
        if (t.endAt && !t.done) {
          t.dayKey = t.dayKey || dateKey;
          running.push(t);
        }
      });
    });
    return running;
  }
  function firstRunningTimer() {
    return getRunningTimers().sort((a,b) => Number(a.endAt) - Number(b.endAt))[0] || null;
  }
  function restoreFullscreenTimer() {
    const id = rememberedFullscreenTimerId();
    if (!id) return;
    const t = findTimerAcrossDays(id, selectedDate);
    if (!t || t.done || !t.endAt || t.endAt <= Date.now()) {
      forgetFullscreenTimer();
      return;
    }
    selectedDate = t.dayKey || selectedDate;
    fullscreenTimerId = t.id;
    renderFullscreenTimer();
    document.body.classList.add('fullscreen-timer-open');
  }

  function seedWelcome() {
    if (!localStorage.getItem(KEY)) {
      data.exercises = [
        {id:uid(), name:'Push-ups'},
        {id:uid(), name:'Squats'},
        {id:uid(), name:'Pull-ups'}
      ];
      save();
    }
  }
  seedWelcome();

  function dateShift(delta) {
    const d = parseKey(selectedDate); d.setDate(d.getDate()+delta); selectedDate = localDateKey(d); render();
  }
  window.addEventListener('beforeinstallprompt', (event) => {
    event.preventDefault();
    deferredInstallPrompt = event;
    refreshInstallButton();
  });

  window.addEventListener('appinstalled', () => {
    deferredInstallPrompt = null;
    refreshInstallButton();
    toast('FocusFlow installed');
  });

  function render() {
    document.querySelector('#app').innerHTML = `
      <div class="app-shell">
        <header class="topbar">
          <div class="topbar-inner">
            <div class="brand">
              <div class="brand-mark">FF</div>
              <div><h1>FocusFlow</h1><p>Study + workout log</p></div>
            </div>
            <div class="topbar-actions"><button class="btn small install-btn" data-action="install-app">Install App</button><button class="btn small ghost" data-action="today">Today</button></div>
          </div>
          <nav class="tabs">
            <button class="tab ${activeTab==='focus'?'active':''}" data-tab="focus">Focus</button>
            <button class="tab ${activeTab==='exercise'?'active':''}" data-tab="exercise">Exercise</button>
          </nav>
        </header>
        <main>
          <section class="screen ${activeTab==='focus'?'active':''}" id="focus-screen">${renderFocus()}</section>
          <section class="screen ${activeTab==='exercise'?'active':''}" id="exercise-screen">${renderExercise()}</section>
        </main>
        <div id="modal-root"></div>
        <div id="fullscreen-timer-root"></div>
        <div class="toast" id="toast"></div>
      </div>`;
    bind();
    registerSW();
    bindFullscreenEscape();
    refreshInstallButton();
  }

  function dateHeader() {
    return `<div class="date-controls">
      <button class="btn small" data-action="prev-date">←</button>
      <div class="date-label">${selectedDate===todayKey()?'Today · ':''}${formatDate(selectedDate)}</div>
      <button class="btn small" data-action="next-date">→</button>
    </div>`;
  }

  function renderFocus() {
    const d = day();
    const completed = d.timers.filter(t=>t.done);
    const planned = d.timers.reduce((s,t)=>s+Number(t.minutes||0),0);
    const studied = completed.reduce((s,t)=>s+Number(t.minutes||0),0);
    const percent = planned ? Math.min(100, Math.round(studied/planned*100)) : 0;
    return `
      <div class="grid">
        <div class="card card-pad span-8">
          <div class="section-head">
            <div><h2>Study sessions</h2><p>Add a batch, tweak individual durations, then mark sessions done. The timer is optional.</p></div>
            ${dateHeader()}
          </div>
          <div class="add-timers">
            <input class="input" id="timer-count" type="number" min="1" max="50" value="4" placeholder="Number of timers">
            <input class="input" id="timer-minutes" type="number" min="1" max="1440" value="30" placeholder="Minutes each">
            <button class="btn primary" data-action="add-batch">+ Add timers</button>
          </div>
          <div style="height:14px"></div>
          ${renderActiveTimerCard()}
          <div class="timer-list">
            ${d.timers.length ? d.timers.map(renderTimer).join('') : `<div class="empty">No timers for this day yet.<br>Add a batch above.</div>`}
          </div>
          <div class="footer-note">Completing a session adds its configured minutes to that day. Undoing it removes those minutes. Nothing requires starting the countdown.</div>
        </div>

        <div class="card card-pad span-4">
          <div class="section-head"><div><h2>Today’s numbers</h2><p>${selectedDate===todayKey()?'Live for today':formatDate(selectedDate)}</p></div></div>
          <div class="metrics">
            <div class="metric"><small>Studied</small><strong>${fmtMins(studied)}</strong></div>
            <div class="metric"><small>Completed</small><strong>${completed.length}/${d.timers.length}</strong></div>
          </div>
          <div class="progress"><span style="width:${percent}%"></span></div>
          <div class="footer-note">${percent}% of the planned minutes on this day are marked complete.</div>
        </div>

        <div class="card card-pad span-8">
          <div class="section-head"><div><h2>Weekly study</h2><p>Last 7 calendar days, including the selected day.</p></div></div>
          ${renderChart(selectedDate)}
        </div>

        <div class="card card-pad span-4">
          <div class="section-head"><div><h2>Past days</h2><p>Tap a day to open its log.</p></div></div>
          ${renderHistory()}
        </div>
      </div>`;
  }

  function renderActiveTimerCard() {
    const running = getRunningTimers();
    if (!running.length) return '';
    const t = running.slice().sort((a,b) => Number(a.endAt) - Number(b.endAt))[0];
    const remaining = Math.max(0, Math.ceil((t.endAt - Date.now()) / 1000));
    return `<div class="active-timer-card">
      <div><small>ACTIVE TIMER</small><strong>${esc(t.title || 'Study session')}</strong><span>${fmtClock(remaining)} remaining</span></div>
      <button class="btn small primary" data-action="open-timer" data-timer-id="${t.id}">Open timer</button>
    </div>`;
  }

  function renderTimer(t) {
    const remaining = t.endAt ? Math.max(0, Math.ceil((t.endAt-Date.now())/1000)) : null;
    const running = !!t.endAt && remaining > 0 && !t.done;
    const ended = !!t.endAt && remaining <= 0 && !t.done;
    return `<div class="timer-row ${t.done?'done':''}" data-id="${t.id}">
      <button class="timer-check" title="Mark done/undone" data-action="toggle-done">${t.done?'✓':''}</button>
      <div class="timer-main">
        <div class="timer-title"><strong>${esc(t.title || 'Study session')}</strong> <span class="badge ${t.done?'done':running?'running':''}">${t.done?'Completed':running?'Running':ended?'Time up':'Not started'}</span></div>
        <div class="timer-meta"><span class="countdown" data-countdown="${t.id}">${t.done?'done': t.endAt ? fmtClock(remaining) : (t.remainingAtPause ? fmtClock(Math.ceil(t.remainingAtPause/1000)) : `${t.minutes} min`)}</span> · ${t.minutes} planned minutes</div>
      </div>
      <div class="timer-actions">
        ${t.done ? `<button class="btn small" data-action="toggle-done">Undo</button>` : `${running ? `<button class="btn small primary" data-action="open-timer">Open</button>` : ''}<button class="btn small" data-action="toggle-timer">${running?'Pause':'Start'}</button><button class="btn small" data-action="toggle-done">Done</button>`}
        <button class="btn small" data-action="edit-timer">Edit</button>
        <button class="btn small danger" data-action="delete-timer">Delete</button>
      </div>
    </div>`;
  }

  function renderChart(endKey) {
    const end = parseKey(endKey);
    const dates = [];
    for (let i=6;i>=0;i--) { const d = new Date(end); d.setDate(end.getDate()-i); dates.push(localDateKey(d)); }
    const values = dates.map(k => day(k).timers.filter(t=>t.done).reduce((s,t)=>s+Number(t.minutes||0),0));
    const max = Math.max(30, ...values);
    return `<div class="chart">${dates.map((k,i)=>`<div class="bar-col"><div class="bar-value">${values[i] ? fmtMins(values[i]) : ''}</div><div class="bar-wrap"><div class="bar ${k===todayKey()?'today':''}" style="height:${Math.max(3,Math.round(values[i]/max*100))}%"></div></div><div class="bar-label">${parseKey(k).toLocaleDateString(undefined,{weekday:'short'}).slice(0,3)}</div></div>`).join('')}</div>`;
  }

  function renderHistory() {
    const entries = Object.entries(data.days)
      .map(([key,d]) => ({key, mins:d.timers.filter(t=>t.done).reduce((s,t)=>s+Number(t.minutes||0),0), done:d.timers.filter(t=>t.done).length, total:d.timers.length, reps:d.reps.reduce((s,r)=>s+Number(r.count||0),0)}))
      .filter(x => x.total || x.mins || x.reps)
      .sort((a,b)=>b.key.localeCompare(a.key))
      .slice(0,14);
    if (!entries.length) return `<div class="empty">Your completed-day history will appear here.</div>`;
    return `<div class="history-list">${entries.map(x=>`<button class="history-row" data-action="open-date" data-date="${x.key}"><span><strong>${x.key===todayKey()?'Today':shortDate(x.key)}</strong><small>${x.done}/${x.total} study sessions${x.reps?` · ${x.reps} reps`:''}</small></span><strong>${fmtMins(x.mins)}</strong></button>`).join('')}</div>`;
  }

  function renderExercise() {
    const d = day();
    const todayReps = new Map();
    d.reps.forEach(r => todayReps.set(r.exerciseId, (todayReps.get(r.exerciseId)||0)+Number(r.count||0)));
    return `<div class="grid">
      <div class="card card-pad span-8">
        <div class="section-head"><div><h2>Exercises</h2><p>Add reps after any study session. Each + opens a quick log input.</p></div>${dateHeader()}</div>
        <div class="form-row"><input class="input" id="exercise-name" placeholder="Exercise name, e.g. Push-ups"><button class="btn primary" data-action="add-exercise">+ Add</button></div>
        <div style="height:14px"></div>
        <div class="exercise-list">
          ${data.exercises.length ? data.exercises.map(e=>`<div class="exercise-row" data-exercise="${e.id}"><div><div class="exercise-name">${esc(e.name)}</div><div class="exercise-today">Today: ${todayReps.get(e.id)||0} reps</div></div><button class="plus-btn" data-action="open-log" title="Add reps">+</button><button class="btn small danger" data-action="remove-exercise">Remove</button>${openLogExercise===e.id?`<div class="inline-log"><input class="input rep-input" type="number" min="1" max="10000" placeholder="Reps"><button class="btn primary small" data-action="save-reps">Log reps</button></div>`:''}</div>`).join('') : `<div class="empty">No exercises yet. Add your first one above.</div>`}
        </div>
        <div class="footer-note">Exercise logs are stored by date, so changing the day above shows that day’s totals and entries.</div>
      </div>

      <div class="card card-pad span-4">
        <div class="section-head"><div><h2>${selectedDate===todayKey()?'Today':'Selected day'}’s workout</h2><p>Final output for this day.</p></div></div>
        ${renderExerciseTotals(d)}
      </div>

      <div class="card card-pad span-12">
        <div class="section-head"><div><h2>Recent exercise logs</h2><p>Most recent entries for ${formatDate(selectedDate)}.</p></div></div>
        ${renderRepHistory(d)}
      </div>
    </div>`;
  }

  function renderExerciseTotals(d) {
    if (!d.reps.length) return `<div class="empty">No reps logged for this day.</div>`;
    const map = new Map();
    d.reps.forEach(r => map.set(r.exerciseId,(map.get(r.exerciseId)||0)+Number(r.count||0)));
    return `<div class="metrics">${data.exercises.map(e=>`<div class="metric"><small>${esc(e.name)}</small><strong>${map.get(e.id)||0}</strong><div class="footer-note" style="margin-top:5px">reps</div></div>`).join('')}</div>`;
  }

  function renderRepHistory(d) {
    const rows = d.reps.slice().sort((a,b)=>b.ts-a.ts);
    if (!rows.length) return `<div class="empty">Nothing logged yet.</div>`;
    const names = Object.fromEntries(data.exercises.map(e=>[e.id,e.name]));
    return `<div class="rep-history">${rows.map(r=>`<div class="rep-row"><span>${esc(names[r.exerciseId]||'Deleted exercise')} · ${new Date(r.ts).toLocaleTimeString(undefined,{hour:'2-digit',minute:'2-digit'})}</span><strong>+${r.count}</strong></div>`).join('')}</div>`;
  }

  function ensureAudioReady() {
    try {
      if (!audioContext) {
        const AudioCtx = window.AudioContext || window.webkitAudioContext;
        if (AudioCtx) audioContext = new AudioCtx();
      }
      if (audioContext?.state === 'suspended') audioContext.resume().catch(() => {});
    } catch {}
  }

  async function requestNotificationPermission() {
    if (!('Notification' in window)) return 'unsupported';
    try {
      if (Notification.permission === 'default') return await Notification.requestPermission();
      return Notification.permission;
    } catch {
      return 'unsupported';
    }
  }

  async function showAppNotification(title, options = {}) {
    if (!('Notification' in window) || Notification.permission !== 'granted') return false;
    try {
      const registration = await navigator.serviceWorker.ready;
      await registration.showNotification(title, options);
      return true;
    } catch {
      return false;
    }
  }

  function timerNotificationTag(t) {
    return `${TIMER_NOTIFICATION_TAG_PREFIX}${t.id}`;
  }

  async function closeTimerNotification(t) {
    if (!t || !('serviceWorker' in navigator)) return;
    try {
      const registration = await navigator.serviceWorker.ready;
      const notifications = await registration.getNotifications({ tag: timerNotificationTag(t) });
      notifications.forEach(n => n.close());
    } catch {}
  }

  async function showTimerNotification(t, completed = false) {
    if (!t) return;
    if (!('Notification' in window) || Notification.permission !== 'granted') return;
    const remaining = t.endAt ? Math.max(0, Math.ceil((t.endAt - Date.now()) / 1000)) : 0;
    const tag = timerNotificationTag(t);
    await showAppNotification(
      completed ? 'FocusFlow — Session complete' : 'FocusFlow — Study timer running',
      {
        body: completed
          ? `${t.title || 'Study session'} is complete. It has been marked done automatically.`
          : `${t.title || 'Study session'} • ${fmtClock(remaining)} remaining`,
        tag,
        renotify: completed,
        requireInteraction: true,
        silent: !completed,
        icon: './icon.svg',
        badge: './icon.svg',
        vibrate: completed ? [160, 80, 160, 80, 320] : undefined,
        timestamp: Date.now(),
        data: { type: 'timer', timerId: t.id, dateKey: t.dayKey || selectedDate, completed },
        actions: completed ? [{ action: 'open', title: 'Open FocusFlow' }] : [
          { action: 'done', title: 'Mark done' },
          { action: 'open', title: 'Open timer' }
        ]
      }
    );
  }

  async function syncRunningTimerNotifications(force = false) {
    if (!('Notification' in window) || Notification.permission !== 'granted') return;
    if (notificationSyncBusy) {
      notificationSyncQueued = true;
      return;
    }
    notificationSyncBusy = true;
    try {
      do {
        notificationSyncQueued = false;
        const running = getRunningTimers();
        for (const t of running) {
          const secs = Math.max(0, Math.ceil((t.endAt - Date.now()) / 1000));
          if (secs <= 0) {
            await completeTimer(t);
            continue;
          }
          if (force || lastNotificationTick[t.id] !== secs) {
            lastNotificationTick[t.id] = secs;
            await showTimerNotification(t, false);
          }
        }
      } while (notificationSyncQueued);
    } finally {
      notificationSyncBusy = false;
    }
  }

  function playCompletionChime() {
    try {
      ensureAudioReady();
      if (!audioContext) return;
      const notes = [659.25, 783.99, 987.77, 783.99, 659.25, 987.77, 783.99];
      const start = audioContext.currentTime + 0.05;
      const total = 4.9;
      notes.forEach((freq, i) => {
        const when = start + Math.min(total - 0.7, i * 0.7);
        const osc = audioContext.createOscillator();
        const gain = audioContext.createGain();
        osc.type = 'sine';
        osc.frequency.setValueAtTime(freq, when);
        gain.gain.setValueAtTime(0.0001, when);
        gain.gain.exponentialRampToValueAtTime(0.18, when + 0.04);
        gain.gain.exponentialRampToValueAtTime(0.0001, when + 0.62);
        osc.connect(gain).connect(audioContext.destination);
        osc.start(when);
        osc.stop(when + 0.66);
      });
    } catch {}
  }

  function scheduleTimerCompletion(t) {
    if (!t?.endAt) return;
    clearTimeout(completionTimeouts[t.id]);
    const delay = Math.max(0, t.endAt - Date.now() + 100);
    completionTimeouts[t.id] = setTimeout(() => {
      const latest = findTimerAcrossDays(t.id, t.dayKey || selectedDate);
      if (latest?.endAt && latest.endAt <= Date.now() && !latest.done) completeTimer(latest);
    }, delay);
  }

  function findTimerAcrossDays(id, dateKey) {
    if (dateKey && data.days[dateKey]) {
      const match = data.days[dateKey].timers.find(x => x.id === id);
      if (match) return match;
    }
    for (const d of Object.values(data.days)) {
      const match = d.timers.find(x => x.id === id);
      if (match) return match;
    }
    return null;
  }

  async function completeTimer(t) {
    if (!t || t.done) return false;
    clearTimeout(completionTimeouts[t.id]);
    delete completionTimeouts[t.id];
    t.done = true;
    t.endAt = null;
    t.remainingAtPause = null;
    save();
    playCompletionChime();
    await closeTimerNotification(t);
    await showTimerNotification(t, true);
    lastNotificationTick[t.id] = null;
    const wasFullscreen = fullscreenTimerId === t.id;
    if (wasFullscreen) forgetFullscreenTimer();
    render();
    if (wasFullscreen) {
      fullscreenTimerId = t.id;
      renderFullscreenTimer();
      document.body.classList.add('fullscreen-timer-open');
      setTimeout(() => closeFullscreenTimer(), 1200);
    }
    toast(`${t.title || 'Study session'} complete`);
    return true;
  }

  async function handleNotificationAction(message) {
    if (!message?.timerId || !message?.dateKey) return;
    const d = day(message.dateKey);
    const t = d.timers.find(x => x.id === message.timerId);
    if (!t) return;
    selectedDate = message.dateKey;
    if (message.action === 'done') {
      if (!t.done) {
        t.done = true;
        t.endAt = null;
        t.remainingAtPause = null;
        save();
      }
      closeTimerNotification(t);
      render();
      toast('Marked done from notification');
    } else {
      render();
      openFullscreenTimer(t.id);
    }
  }

  function bind() {
    document.querySelectorAll('[data-tab]').forEach(b=>b.onclick=()=>{activeTab=b.dataset.tab;openLogExercise=null;render();});
    document.querySelectorAll('[data-action]').forEach(el=>el.addEventListener('click', handle));
  }

  function handle(e) {
    const action = e.currentTarget.dataset.action;
    const row = e.currentTarget.closest('[data-id]');
    const exRow = e.currentTarget.closest('[data-exercise]');
    if (action==='install-app') installApp();
    if (action==='today') { selectedDate=todayKey(); render(); }
    if (action==='prev-date') dateShift(-1);
    if (action==='next-date') dateShift(1);
    if (action==='add-batch') addBatch();
    if (action==='toggle-done' && row) toggleDone(row.dataset.id);
    if (action==='toggle-timer' && row) toggleTimer(row.dataset.id);
    if (action==='open-timer') openFullscreenTimer(e.currentTarget.dataset.timerId || row?.dataset.id);
    if (action==='edit-timer' && row) openEdit(row.dataset.id);
    if (action==='delete-timer' && row) deleteTimer(row.dataset.id);
    if (action==='open-date') { selectedDate=e.currentTarget.dataset.date; render(); }
    if (action==='add-exercise') addExercise();
    if (action==='remove-exercise' && exRow) removeExercise(exRow.dataset.exercise);
    if (action==='open-log' && exRow) { openLogExercise = exRow.dataset.exercise; render(); setTimeout(()=>document.querySelector('.rep-input')?.focus(),0); }
    if (action==='save-reps' && exRow) saveReps(exRow.dataset.exercise, exRow.querySelector('.rep-input')?.value);
    if (action==='cancel-modal') closeModal();
    if (action==='save-edit') saveEdit();
    if (action==='close-fullscreen-timer') closeFullscreenTimer();
    if (action==='fullscreen-toggle-timer' && fullscreenTimerId) toggleTimerFromFullscreen(fullscreenTimerId);
    if (action==='fullscreen-done' && fullscreenTimerId) doneFromFullscreen(fullscreenTimerId);
  }

  function addBatch() {
    const count = Math.min(50, Math.max(1, Number(document.querySelector('#timer-count')?.value || 1)));
    const minutes = Math.min(1440, Math.max(1, Number(document.querySelector('#timer-minutes')?.value || 30)));
    const d = day();
    const startIndex = d.timers.length;
    for (let i=0;i<count;i++) d.timers.push({id:uid(),title:`Study ${startIndex+i+1}`,minutes,done:false,endAt:null,dayKey:selectedDate});
    save(); render(); toast(`${count} timer${count>1?'s':''} added`);
  }

  function findTimer(id) { return day().timers.find(t=>t.id===id) || findTimerAcrossDays(id, selectedDate); }
  function toggleDone(id) {
    const t=findTimer(id); if(!t) return;
    if (t.done) { t.done=false; }
    else {
      t.done=true; t.endAt=null; t.remainingAtPause=null;
      clearTimeout(completionTimeouts[t.id]);
      delete completionTimeouts[t.id];
      closeTimerNotification(t);
    }
    save(); render(); toast(t.done?'Marked done':'Marked undone');
  }
  async function toggleTimer(id) {
    const t=findTimer(id); if(!t || t.done) return;
    if (t.endAt) {
      const remaining = Math.max(0, Math.ceil((t.endAt-Date.now())/1000));
      t.remainingAtPause = remaining * 1000;
      t.endAt = null;
      save();
      await closeTimerNotification(t);
      clearTimeout(completionTimeouts[t.id]);
      delete completionTimeouts[t.id];
      if (fullscreenTimerId===id) renderFullscreenTimer();
      else { render(); toast('Timer paused'); }
    } else {
      const ms = t.remainingAtPause || Number(t.minutes)*60000;
      if (ms > 0) {
        ensureAudioReady();
        await requestNotificationPermission();
        t.dayKey = t.dayKey || selectedDate;
        t.endAt = Date.now() + ms;
        t.remainingAtPause = null;
        save();
        scheduleTimerCompletion(t);
        render();
        openFullscreenTimer(id, { requestNative: true });
        lastNotificationTick[t.id] = null;
        syncRunningTimerNotifications(true);
        toast('Timer started');
      }
    }
  }

  function toggleTimerFromFullscreen(id) {
    const t=findTimer(id); if(!t || t.done) return;
    toggleTimer(id);
  }

  async function doneFromFullscreen(id) {
    const t=findTimer(id); if(!t) return;
    if (!t.done) {
      t.done=true;
      t.endAt=null;
      t.remainingAtPause=null;
      save();
    }
    await closeTimerNotification(t);
    closeFullscreenTimer();
    render();
    toast('Marked done');
  }

  function openFullscreenTimer(id, { requestNative = true } = {}) {
    const t = findTimerAcrossDays(id, selectedDate);
    if (!t) return;
    selectedDate = t.dayKey || selectedDate;
    fullscreenTimerId = id;
    rememberFullscreenTimer(id);
    renderFullscreenTimer();
    document.body.classList.add('fullscreen-timer-open');
    const el = document.documentElement;
    if (requestNative && document.fullscreenEnabled && el.requestFullscreen && !document.fullscreenElement) {
      el.requestFullscreen().catch(() => {});
    }
  }

  function renderFullscreenTimer() {
    const t = fullscreenTimerId ? findTimerAcrossDays(fullscreenTimerId, selectedDate) : null;
    const root = document.querySelector('#fullscreen-timer-root');
    if (!root || !t) return;
    const remaining = t.endAt ? Math.max(0, Math.ceil((t.endAt-Date.now())/1000)) : (t.remainingAtPause ? Math.ceil(t.remainingAtPause/1000) : Number(t.minutes)*60);
    const running = !!t.endAt && remaining > 0 && !t.done;
    const ended = !t.done && !running && remaining <= 0;
    root.innerHTML = `
      <div class="fullscreen-timer" role="dialog" aria-modal="true" aria-label="Full screen study timer">
        <div class="fullscreen-timer-top">
          <div>
            <div class="fullscreen-timer-label">FOCUS SESSION</div>
            <h2>${esc(t.title || 'Study session')}</h2>
          </div>
          <button class="btn small ghost fullscreen-close" data-action="close-fullscreen-timer" aria-label="Close timer">✕</button>
        </div>
        <div class="fullscreen-timer-center">
          <div class="fullscreen-countdown ${ended?'ended':''}" id="fullscreen-countdown">${ended?'00:00':fmtClock(remaining)}</div>
          <div class="fullscreen-status">${t.done?'Completed':running?'Running':ended?'Time up':'Paused'}</div>
        </div>
        <div class="fullscreen-timer-actions">
          ${t.done ? '' : `<button class="btn primary fullscreen-main-btn" data-action="fullscreen-toggle-timer">${running?'Pause':'Start'}</button>`}
          ${t.done ? '' : `<button class="btn fullscreen-main-btn" data-action="fullscreen-done">Done</button>`}
        </div>
        <div class="fullscreen-timer-note">Closing this view does not stop the timer. Use “Open” in the session list to bring it back.</div>
      </div>`;
    root.querySelectorAll('[data-action]').forEach(el=>el.addEventListener('click', handle));
  }

  function closeFullscreenTimer({ forget = true } = {}) {
    fullscreenTimerId = null;
    if (forget) forgetFullscreenTimer();
    document.body.classList.remove('fullscreen-timer-open');
    const root = document.querySelector('#fullscreen-timer-root');
    if (root) root.innerHTML='';
    if(document.fullscreenElement && document.exitFullscreen) document.exitFullscreen().catch(()=>{});
  }

  function bindFullscreenEscape() {
    if (fullscreenEventsBound) return;
    fullscreenEventsBound = true;
    document.onkeydown = (e) => {
      if(e.key==='Escape' && fullscreenTimerId) closeFullscreenTimer();
    };
    document.addEventListener('fullscreenchange', () => {
      if(!document.fullscreenElement && fullscreenTimerId) {
        // Android/Chrome exits native fullscreen when another app comes to the foreground.
        // Keep our in-app fullscreen overlay alive so the timer can be restored immediately.
        document.body.classList.add('fullscreen-timer-open');
        renderFullscreenTimer();
      }
    });
  }

  function deleteTimer(id) {
    day().timers = day().timers.filter(t=>t.id!==id); save(); render(); toast('Timer deleted');
  }

  function openEdit(id) {
    const t=findTimer(id); if(!t) return; editTimerId=id;
    document.querySelector('#modal-root').innerHTML = `<div class="modal-backdrop open" id="edit-modal"><div class="modal"><h3>Edit study session</h3><p>You can change the name and planned minutes at any time.</p><label style="display:block;font-size:12px;color:var(--muted);margin-bottom:6px">Name</label><input class="input" id="edit-title" value="${esc(t.title||'Study session')}"><div style="height:10px"></div><label style="display:block;font-size:12px;color:var(--muted);margin-bottom:6px">Minutes</label><input class="input" id="edit-minutes" type="number" min="1" max="1440" value="${Number(t.minutes)||30}"><div class="modal-actions"><button class="btn" data-action="cancel-modal">Cancel</button><button class="btn primary" data-action="save-edit">Save</button></div></div></div>`;
    document.querySelector('#edit-modal').addEventListener('click', e=>{ if(e.target.id==='edit-modal') closeModal(); });
    document.querySelectorAll('#modal-root [data-action]').forEach(el=>el.addEventListener('click', handle));
  }
  function closeModal() { editTimerId=null; document.querySelector('#modal-root').innerHTML=''; }
  function saveEdit() {
    const t=findTimer(editTimerId); if(!t) return;
    t.title=document.querySelector('#edit-title').value.trim() || 'Study session';
    t.minutes=Math.min(1440,Math.max(1,Number(document.querySelector('#edit-minutes').value)||30));
    if(t.endAt && !t.done) t.endAt=Date.now()+t.minutes*60000; if(t.remainingAtPause && !t.done) t.remainingAtPause=t.minutes*60000;
    save(); closeModal(); render(); toast('Session updated');
  }

  function addExercise() {
    const input=document.querySelector('#exercise-name'); const name=input?.value.trim();
    if(!name) return;
    if(data.exercises.some(e=>e.name.toLowerCase()===name.toLowerCase())) return toast('That exercise already exists');
    data.exercises.push({id:uid(),name}); save(); render(); toast('Exercise added');
  }
  function removeExercise(id) {
    const found=data.exercises.find(e=>e.id===id); if(!found) return;
    data.exercises=data.exercises.filter(e=>e.id!==id); save(); render(); toast('Exercise removed');
  }
  function saveReps(exerciseId, countValue) {
    const count=Math.max(1,Number(countValue)||0); if(!count) return;
    day().reps.push({id:uid(),exerciseId,count,ts:Date.now()});
    openLogExercise=null; save(); render(); toast(`+${count} reps logged`);
  }

  function updateCountdowns() {
    const now = Date.now();
    let changed = false;
    const expired = [];

    document.querySelectorAll('[data-countdown]').forEach(el => {
      const t = findTimer(el.dataset.countdown);
      if (!t || t.done || !t.endAt) return;
      const secs = Math.max(0, Math.ceil((t.endAt-now)/1000));
      el.textContent = fmtClock(secs);
      if (secs <= 0) expired.push(t);
    });

    if (fullscreenTimerId) {
      const t = findTimerAcrossDays(fullscreenTimerId, selectedDate);
      const cd = document.querySelector('#fullscreen-countdown');
      const status = document.querySelector('.fullscreen-status');
      if (!t) {
        closeFullscreenTimer();
      } else if (t.done) {
        if(cd) cd.textContent='Done';
        if(status) status.textContent='Completed';
      } else if (t.endAt) {
        const secs = Math.max(0, Math.ceil((t.endAt-now)/1000));
        if(cd) cd.textContent=fmtClock(secs);
        if(status) status.textContent=secs>0?'Running':'Time up';
        if (secs <= 0) expired.push(t);
      } else if (t.remainingAtPause) {
        if(cd) cd.textContent=fmtClock(Math.ceil(t.remainingAtPause/1000));
        if(status) status.textContent='Paused';
      }
    }

    const uniqueExpired = [...new Map(expired.map(t=>[t.id,t])).values()];
    uniqueExpired.forEach(t => { if (!t.done) completeTimer(t); changed = true; });

    if (activeTab === 'focus') {
      const activeCard = document.querySelector('.active-timer-card');
      if (activeCard) {
        const t = firstRunningTimer();
        if (t) {
          const remaining = Math.max(0, Math.ceil((t.endAt-now)/1000));
          const span = activeCard.querySelector('span');
          if (span) span.textContent = `${fmtClock(remaining)} remaining`;
        } else {
          activeCard.remove();
        }
      }
    }

    if(changed) save();
    syncRunningTimerNotifications(false);
  }
  setInterval(updateCountdowns, 1000);
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) {
      updateCountdowns();
      restoreFullscreenTimer();
      syncRunningTimerNotifications(true);
    }
  });
  window.addEventListener('pageshow', () => {
    updateCountdowns();
    if (!document.hidden) restoreFullscreenTimer();
    syncRunningTimerNotifications(true);
  });

  function toast(msg) {
    const el=document.querySelector('#toast'); if(!el) return; clearTimeout(toastTimer); el.textContent=msg; el.classList.add('show'); toastTimer=setTimeout(()=>el.classList.remove('show'),1800);
  }
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.addEventListener('message', (event) => {
      if (event.data?.type === 'focusflow-notification-action') handleNotificationAction(event.data);
    });
  }

  function registerSW() { if('serviceWorker' in navigator && location.protocol.startsWith('http')) navigator.serviceWorker.register('./sw.js').catch(()=>{}); }

  function resumeTimerSchedules() {
    Object.entries(data.days).forEach(([dateKey, d]) => {
      d.timers.filter(t => t.endAt && !t.done).forEach(t => {
        t.dayKey = t.dayKey || dateKey;
        scheduleTimerCompletion(t);
      });
    });
  }

  render();
  resumeTimerSchedules();
  if (!document.hidden) restoreFullscreenTimer();
})();
