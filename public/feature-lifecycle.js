(() => {
  'use strict';
  if (window.__exchangeFeatureLifecycleInstalled) return;
  window.__exchangeFeatureLifecycleInstalled = true;

  const q = s => document.querySelector(s);
  const esc = v => String(v ?? '').replace(/[&<>\"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','\"':'&quot;',"'":'&#039;'}[c]));
  const getState = () => window.state || null;
  const toast = message => { if (typeof window.toast === 'function') window.toast(message); };
  const closeModal = () => {
    if (typeof window.closeModal === 'function') return window.closeModal();
    const modal = q('#modal');
    if (modal) modal.hidden = true;
    document.body.style.overflow = '';
  };
  const openModal = html => {
    if (typeof window.modal === 'function') return window.modal(html);
    const content = q('#modalContent');
    const modal = q('#modal');
    if (content && modal) { content.innerHTML = html; modal.hidden = false; document.body.style.overflow = 'hidden'; }
  };

  let coreLoadData = typeof window.loadData === 'function' ? window.loadData : null;
  let inFlight = null;
  let requestSequence = 0;

  async function loadData(...args) {
    if (inFlight) return inFlight;
    const sequence = ++requestSequence;
    inFlight = (async () => {
      if (typeof coreLoadData !== 'function') throw new Error('Exchange data service is unavailable');
      const result = await coreLoadData.apply(this, args);
      document.dispatchEvent(new CustomEvent('exchange:data-ready', { detail: { state: getState(), result, sequence } }));
      return result;
    })();
    try { return await inFlight; } finally { inFlight = null; }
  }

  window.__exchangeCoreLoadData = coreLoadData;
  window.exchangeLoadData = loadData;
  window.__exchangeDataReady = result => document.dispatchEvent(new CustomEvent('exchange:data-ready', { detail: { state: getState(), result } }));
  try {
    Object.defineProperty(window, 'loadData', {
      configurable: true,
      enumerable: true,
      get: () => loadData,
      set: next => { if (typeof next === 'function' && next !== loadData) coreLoadData = next; }
    });
  } catch (error) { console.error('Exchange lifecycle install failed:', error); }

  document.addEventListener('click', event => {
    const target = event.target.closest?.('[data-stage4-go]');
    if (!target) return;
    const id = target.dataset.stage4Go;
    if (id && typeof window.showView === 'function') { event.preventDefault(); window.showView(id); }
  }, false);

  async function getVerification(taskId) {
    const s = getState();
    if (!s?.supabase || !s?.user) return null;
    const { data, error } = await s.supabase.from('task_verifications').select('id,status,method,proof_url,note').eq('task_id', taskId).eq('user_id', s.user.id).maybeSingle();
    if (error) throw error;
    return data || null;
  }

  async function claimReward(taskId, button) {
    const s = getState();
    if (!s?.supabase) return;
    if (button) button.disabled = true;
    try {
      const result = await s.supabase.rpc('complete_task', { p_task_id: taskId });
      if (result.error) throw result.error;
      toast('დავალება დასრულდა · +' + Number(result.data || 0).toLocaleString('ka-GE') + ' კრედიტი ✓');
      await loadData();
    } catch (error) {
      toast(error.message || String(error));
      if (button) button.disabled = false;
    }
  }

  async function submitVerification(taskId) {
    const s = getState();
    const form = q('#exchangeVerificationForm');
    const submit = form?.querySelector('button[type="submit"]');
    if (submit) submit.disabled = true;
    try {
      const result = await s.supabase.rpc('submit_task_verification', {
        p_task_id: taskId,
        p_method: q('#exchangeVerificationMethod')?.value || 'manual',
        p_proof_url: q('#exchangeVerificationProof')?.value.trim() || null,
        p_note: q('#exchangeVerificationNote')?.value.trim() || null
      });
      if (result.error) throw result.error;
      closeModal();
      toast('დადასტურება გაიგზავნა ✓');
      await loadData();
    } catch (error) {
      toast(error.message || String(error));
      if (submit) submit.disabled = false;
    }
  }

  async function openVerification(taskId, button) {
    const s = getState();
    if (!s?.user || !s?.supabase) { toast('დავალების შესასრულებლად შედი ანგარიშში.'); return; }
    const task = (s.tasks || []).find(item => item.id === taskId);
    if (!task) return;
    const existing = await getVerification(taskId);
    if (existing?.status === 'pending') { toast('ეს დავალება უკვე გაგზავნილია შემოწმებაზე.'); return; }
    if (existing?.status === 'approved') return claimReward(taskId, button);

    openModal(`<h2>დავალების დადასტურება</h2><p><strong>${esc(task.title || 'დავალება')}</strong></p><p class="verification-note">შეასრულე მოქმედება და გამოგზავნე მტკიცებულება. ჯილდო გაიცემა ადმინისტრატორის დადასტურების შემდეგ.</p><form id="exchangeVerificationForm"><label>მეთოდი<select id="exchangeVerificationMethod"><option value="manual">ხელით შემოწმება</option><option value="link">მტკიცებულების ბმული</option><option value="screenshot">სქრინშოტის ბმული</option><option value="platform">პლატფორმის შემოწმება</option></select></label><label>მტკიცებულების ბმული<input id="exchangeVerificationProof" type="url" placeholder="https://..."></label><label>შენიშვნა<textarea id="exchangeVerificationNote" rows="3" placeholder="რა მოქმედება შეასრულე?"></textarea></label><button class="primary large" type="submit">დადასტურების გაგზავნა</button></form>`);
    if (existing?.status === 'rejected') {
      q('#exchangeVerificationProof').value = existing.proof_url || '';
      q('#exchangeVerificationNote').value = existing.note || '';
    }
    q('#exchangeVerificationForm')?.addEventListener('submit', event => { event.preventDefault(); submitVerification(taskId); }, { once: true });
  }

  document.addEventListener('click', event => {
    const button = event.target.closest?.('button[data-task-id]');
    if (!button) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    if (button.disabled || button.dataset.exchangeBusy === '1') return;
    button.dataset.exchangeBusy = '1';
    openVerification(button.dataset.taskId, button).catch(error => toast(error.message || String(error))).finally(() => { button.dataset.exchangeBusy = ''; });
  }, true);

  document.documentElement.dataset.stage4Guards = '0';
  document.dispatchEvent(new CustomEvent('exchange:lifecycle-ready', { detail: { loadData } }));
})();
