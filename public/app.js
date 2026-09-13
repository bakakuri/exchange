const state = {
  supabase: null,
  user: null,
  profile: null,
  tasks: [],
  socialProfiles: [],
  completed: new Set(),
  signUpMode: false
};

const $ = (s) => document.querySelector(s);
const $$ = (s) => [...document.querySelectorAll(s)];

function toast(message) {
  const el = $("#toast");
  el.textContent = message;
  el.classList.add("show");
  setTimeout(() => el.classList.remove("show"), 2400);
}

function showView(id) {
  $$(".view").forEach(v => v.classList.remove("active-view"));
  $("#" + id)?.classList.add("active-view");
  $$(".nav-item[data-view]").forEach(b => b.classList.toggle("active", b.dataset.view === id));
  window.scrollTo({top:0, behavior:"smooth"});
}

$$(".nav-item[data-view]").forEach(btn => btn.addEventListener("click", () => showView(btn.dataset.view)));
$$("[data-view-target]").forEach(btn => btn.addEventListener("click", () => showView(btn.dataset.viewTarget)));

function setCredits(value) {
  const n = Number(value || 0);
  $("#credits").textContent = n;
  $("#walletCredits").textContent = n;
}

function taskCard(task) {
  const done = state.completed.has(task.id);
  return `<article class="task-card">
    <div><div class="task-top"><span class="platform">${escapeHtml(task.platform)}</span><span class="reward">+${task.reward} credits</span></div>
    <h3>${escapeHtml(task.title)}</h3><small>${escapeHtml(task.category)} · ${escapeHtml(task.action)}</small></div>
    <div class="task-actions">
      <a class="task-action secondary" href="${safeUrl(task.target_url)}" target="_blank" rel="noopener noreferrer">Open →</a>
      <button class="task-action ${done ? "done" : ""}" data-task="${task.id}" ${done ? "disabled" : ""}>${done ? "✓ Completed" : "Confirm & earn"}</button>
    </div>
  </article>`;
}

function renderTasks(list = state.tasks) {
  $("#allTasks").innerHTML = list.length ? list.map(taskCard).join("") : `<div class="empty">No active tasks yet.</div>`;
  $("#dashboardTasks").innerHTML = list.slice(0,4).map(taskCard).join("") || `<div class="empty">No tasks available.</div>`;
}

async function loadData() {
  if (!state.supabase || !state.user) {
    setCredits(0);
    $("#profileGrid").innerHTML = `<div class="empty">Sign in to manage your profiles.</div>`;
    return;
  }

  const uid = state.user.id;
  const [{data: profile}, {data: tasks}, {data: socials}, {data: completions}] = await Promise.all([
    state.supabase.from("profiles").select("*").eq("id", uid).maybeSingle(),
    state.supabase.from("tasks").select("*").eq("status","active").order("created_at",{ascending:false}),
    state.supabase.from("social_profiles").select("*").eq("user_id",uid).order("created_at",{ascending:false}),
    state.supabase.from("task_completions").select("task_id").eq("user_id",uid)
  ]);

  state.profile = profile;
  state.tasks = tasks || [];
  state.socialProfiles = socials || [];
  state.completed = new Set((completions || []).map(x => x.task_id));

  setCredits(profile?.credits || 0);
  $("#completedCount").textContent = state.completed.size;
  $("#profileCount").textContent = state.socialProfiles.length;

  const name = profile?.display_name || state.user.email?.split("@")[0] || "User";
  $("#userName").textContent = name;
  $("#userPlan").textContent = "Free plan";
  $("#avatar").textContent = name[0]?.toUpperCase() || "U";
  $("#topAvatar").textContent = name[0]?.toUpperCase() || "U";

  $("#profileGrid").innerHTML = state.socialProfiles.length
    ? state.socialProfiles.map(p => `<div class="profile-card"><div class="platform-icon">${escapeHtml(p.platform[0])}</div><div><b>${escapeHtml(p.handle)}</b><small>${escapeHtml(p.platform)} · ${p.active ? "Active":"Paused"}</small></div><a href="${safeUrl(p.url)}" target="_blank" rel="noopener noreferrer">Open</a></div>`).join("")
    : `<div class="empty">No social profiles yet. Add one to start.</div>`;

  renderTasks();
}

document.addEventListener("click", async (e) => {
  const btn = e.target.closest("[data-task]");
  if (!btn) return;
  if (!state.user) return openAuth();
  const taskId = btn.dataset.task;
  btn.disabled = true;
  try {
    const {data, error} = await state.supabase.rpc("complete_task", {p_task_id: taskId});
    if (error) throw error;
    toast(`Task completed · +${data} credits`);
    await loadData();
  } catch (err) {
    toast(err.message || "Could not complete task");
    btn.disabled = false;
  }
});

$("#filter").addEventListener("change", (e) => {
  const value = e.target.value;
  renderTasks(value === "All platforms" ? state.tasks : state.tasks.filter(t => t.platform === value));
});

function openAuth() {
  $("#modal").classList.remove("hidden");
  $("#signOutBtn").classList.toggle("hidden", !state.user);
  $("#authForm").classList.toggle("hidden", !!state.user);
  $("#toggleAuth").classList.toggle("hidden", !!state.user);
  $("#modalTitle").textContent = state.user ? "Account" : (state.signUpMode ? "Create account" : "Sign in");
  $("#authSubmit").textContent = state.signUpMode ? "Create account" : "Sign in";
  $("#displayName").classList.toggle("hidden", !state.signUpMode);
}

$("#authBtn").addEventListener("click", openAuth);
$("#closeModal").addEventListener("click", () => $("#modal").classList.add("hidden"));
$("#toggleAuth").addEventListener("click", () => { state.signUpMode = !state.signUpMode; openAuth(); });

$("#authForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  if (!state.supabase) return toast("Supabase is not configured.");
  const email = $("#email").value.trim();
  const password = $("#password").value;
  const displayName = $("#displayName").value.trim();

  try {
    let result;
    if (state.signUpMode) {
      result = await state.supabase.auth.signUp({
        email, password,
        options: { data: { display_name: displayName || email.split("@")[0] } }
      });
    } else {
      result = await state.supabase.auth.signInWithPassword({email,password});
    }
    if (result.error) throw result.error;
    toast(state.signUpMode ? "Account created. Check your email if confirmation is enabled." : "Signed in.");
    $("#modal").classList.add("hidden");
    await initSession();
  } catch (err) {
    toast(err.message || "Authentication failed");
  }
});

$("#signOutBtn").addEventListener("click", async () => {
  await state.supabase.auth.signOut();
  $("#modal").classList.add("hidden");
  await initSession();
  toast("Signed out");
});

$("#addProfile").addEventListener("click", async () => {
  if (!state.user) return openAuth();
  const platform = prompt("Platform: Instagram, TikTok, X, YouTube or Facebook");
  if (!platform) return;
  const handle = prompt("Handle / channel name");
  const url = prompt("Public profile URL");
  const allowed = ["Instagram","TikTok","X","YouTube","Facebook"];
  if (!allowed.includes(platform) || !handle || !url) return toast("Invalid profile data.");
  const {error} = await state.supabase.from("social_profiles").insert({user_id:state.user.id,platform,handle,url});
  if (error) return toast(error.message);
  await loadData();
  toast("Profile added");
});

async function initSession() {
  if (!state.supabase) return;
  const {data:{session}} = await state.supabase.auth.getSession();
  state.user = session?.user || null;
  $("#authBtn").querySelector("span").textContent = state.user ? "Account" : "Sign in";
  await loadData();
}

function escapeHtml(v) {
  return String(v ?? "").replace(/[&<>"']/g, c => ({ "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;" }[c]));
}
function safeUrl(v) {
  try {
    const u = new URL(v);
    return ["http:","https:"].includes(u.protocol) ? u.href : "#";
  } catch { return "#"; }
}

(async function boot() {
  try {
    const cfg = await fetch("/api/config").then(r => r.json());
    if (!cfg.supabaseUrl || !cfg.supabaseAnonKey || !window.supabase) {
      toast("Supabase configuration is missing.");
      return;
    }
    state.supabase = window.supabase.createClient(cfg.supabaseUrl, cfg.supabaseAnonKey);
    state.supabase.auth.onAuthStateChange(() => initSession());
    await initSession();
  } catch {
    toast("Could not initialize Exchange.");
  }
})();
