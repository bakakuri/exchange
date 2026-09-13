const state = { credits: 240, tasks: [] };
const $ = (s) => document.querySelector(s);
const $$ = (s) => [...document.querySelectorAll(s)];

function taskCard(task) {
  return `<article class="task-card"><div><div class="task-top"><span class="platform">${task.platform}</span><span class="reward">+${task.reward} credits</span></div><h3>${task.action} ${task.handle}</h3><small>${task.category} · Community task</small></div><button class="task-action" data-task="${task.id}">Open task →</button></article>`;
}
function renderTasks(list = state.tasks) {
  $('#allTasks').innerHTML = list.map(taskCard).join('');
  $('#dashboardTasks').innerHTML = list.slice(0, 4).map(taskCard).join('');
}
function setCredits(value) {
  state.credits = value;
  $('#credits').textContent = value;
  $('#walletCredits').textContent = value;
}
function toast(message) {
  const el = $('#toast'); el.textContent = message; el.classList.add('show');
  setTimeout(() => el.classList.remove('show'), 2200);
}
function showView(id) {
  $$('.view').forEach(v => v.classList.remove('active-view'));
  $('#' + id)?.classList.add('active-view');
  $$('.nav-item[data-view]').forEach(b => b.classList.toggle('active', b.dataset.view === id));
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

$$('.nav-item[data-view]').forEach(btn => btn.addEventListener('click', () => showView(btn.dataset.view)));
$$('[data-view-target]').forEach(btn => btn.addEventListener('click', () => showView(btn.dataset.viewTarget)));
$('#filter').addEventListener('change', (e) => renderTasks(e.target.value === 'All platforms' ? state.tasks : state.tasks.filter(t => t.platform === e.target.value)));
document.addEventListener('click', (e) => {
  const btn = e.target.closest('[data-task]');
  if (!btn) return;
  if (btn.classList.contains('done')) return;
  const task = state.tasks.find(t => String(t.id) === btn.dataset.task);
  if (!task) return;
  setCredits(state.credits + task.reward);
  btn.textContent = '✓ Completed'; btn.classList.add('done');
  toast(`Task completed · +${task.reward} credits`);
});
$('#addProfile').addEventListener('click', () => toast('Profile form is ready for Supabase integration.'));

fetch('/api/demo/tasks').then(r => r.json()).then(tasks => { state.tasks = tasks; renderTasks(); }).catch(() => toast('Could not load tasks.'));
