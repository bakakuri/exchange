(function () {
  'use strict';

  const $ = (s) => document.querySelector(s);
  const esc = (v) => String(v ?? '').replace(/[&<>\"']/g, c => ({
    '&':'&amp;','<':'&lt;','>':'&gt;','\"':'&quot;',"'":'&#039;'
  }[c]));

  const style = document.createElement('style');
  style.textContent = `
    .verification-note{font-size:13px;color:var(--muted,#718096);margin:8px 0;line-height:1.45}
    .verification-admin-card{display:grid;gap:10px;padding:16px;border:1px solid var(--border,#e5e7eb);border-radius:16px;background:var(--card,#fff);margin:10px 0}
    .verification-admin-meta{display:grid;gap:4px;font-size:13px}
    .verification-admin-actions{display:flex;gap:8px;flex-wrap:wrap}
    .verification-proof{word-break:break-word;font-size:13px}
  `;
  document.head.appendChild(style);

  let wrappedLoadData = false;

  function toast(message) {
    if (typeof window.toast === 'function') return window.toast(message);
    const el = $('#toast');
    if (!el) return;
    el.textContent = message;
    el.classList.add('show');
    clearTimeout(el.__verificationTimer);
    el.__verificationTimer = setTimeout(() => el.classList.remove('show'), 3500);
  }

  function modal(html) {
    if (typeof window.modal === 'function') return window.modal(html);
    const host = $('#modalContent');
    const box = $('#modal');
    if (!host || !box) return;
    host.innerHTML = html;
    box.hidden = false;
    document.body.style.overflow = 'hidden';
  }

  function closeModal() {
    if (typeof window.closeModal === 'function') return window.closeModal();
    const box = $('#modal');
    if (box) box.hidden = true;
    document.body.style.overflow = '';
  }

  function client() { return window.state?.supabase || null; }
  function user() { return window.state?.user || null; }

  async function getVerification(taskId) {
    const db = client();
    const me = user();
    if (!db || !me) return null;
    const { data, error } = await db
      .from('task_verifications')
      .select('id,status,method,proof_url,note,created_at,reviewed_at')
      .eq('task_id', taskId)
      .eq('user_id', me.id)
      .maybeSingle();
    if (error) throw error;
    return data || null;
  }

  async function openVerification(taskId) {
    const db = client();
    const me = user();
    const task = (window.state?.tasks || []).find(t => t.id === taskId);
    if (!db || !me || !task) {
      toast('დავალების დადასტურებისთვის საჭიროა ანგარიშში შესვლა.');
      return;
    }

    let existing = null;
    try { existing = await getVerification(taskId); }
    catch (error) { toast(error.message || error); return; }

    if (existing?.status === 'approved') {
      return claimReward(taskId);
    }

    modal(`
      <h2>დავალების დადასტურება</h2>
      <p><strong>${esc(task.title || 'დავალება')}</strong></p>
      <p class="verification-note">
        შეასრულე მითითებული მოქმედება და გამოგზავნე მტკიცებულება. ჯილდო გაიცემა მხოლოდ ადმინისტრატორის მიერ დადასტურების შემდეგ.
      </p>
      <form id="verificationForm">
        <label>დადასტურების მეთოდი
          <select id="verificationMethod">
            <option value="manual">ხელით შემოწმება</option>
            <option value="link">მტკიცებულების ბმული</option>
            <option value="screenshot">სქრინშოტის ბმული</option>
            <option value="platform">პლატფორმის შემოწმება</option>
          </select>
        </label>
        <label>მტკიცებულების ბმული
          <input id="verificationProof" type="url" placeholder="https://...">
        </label>
        <label>შენიშვნა
          <textarea id="verificationNote" rows="3" placeholder="რა მოქმედება შეასრულე?"></textarea>
        </label>
        <button class="primary large" type="submit">დადასტურების გაგზავნა</button>
      </form>
    `);

    if (existing?.status === 'rejected') {
      $('#verificationNote').value = existing.note || '';
      $('#verificationProof').value = existing.proof_url || '';
    }

    const form = $('#verificationForm');
    if (!form) return;
    form.onsubmit = async (event) => {
      event.preventDefault();
      const submit = form.querySelector('button[type="submit"]');
      submit.disabled = true;
      try {
        const result = await db.rpc('submit_task_verification', {
          p_task_id: taskId,
          p_method: $('#verificationMethod').value,
          p_proof_url: $('#verificationProof').value.trim() || null,
          p_note: $('#verificationNote').value.trim() || null
        });
        if (result.error) throw result.error;
        closeModal();
        toast('დადასტურება გაიგზავნა ✓ ჯილდო გაიცემა დამტკიცების შემდეგ.');
        renderButtons();
      } catch (error) {
        toast(error.message || error);
      } finally {
        submit.disabled = false;
      }
    };
  }

  async function claimReward(taskId) {
    const db = client();
    if (!db) return;
    const selector = `[data-task-id="${CSS.escape(taskId)}"]`;
    const button = document.querySelector(selector);
    if (button) button.disabled = true;
    try {
      const result = await db.rpc('complete_task', { p_task_id: taskId });
      if (result.error) throw result.error;
      toast('დავალება დადასტურდა · +' + Number(result.data || 0).toLocaleString('ka-GE') + ' კრედიტი');
      if (typeof window.loadData === 'function') await window.loadData();
    } catch (error) {
      toast(error.message || error);
      if (button) button.disabled = false;
    }
  }

  async function decorateButton(button) {
    if (!button || button.dataset.verificationChecked === '1') return;
    button.dataset.verificationChecked = '1';
    try {
      const v = await getVerification(button.dataset.taskId);
      if (!v) return;
      if (v.status === 'pending') {
        button.disabled = true;
        button.textContent = 'შემოწმების მოლოდინში';
        button.classList.add('done');
      } else if (v.status === 'rejected') {
        button.disabled = false;
        button.textContent = 'ხელახლა დადასტურება';
      } else if (v.status === 'approved') {
        button.disabled = false;
        button.textContent = 'ჯილდოს მიღება';
        button.dataset.claimApproved = '1';
      }
    } catch (error) {
      console.error('verification status:', error);
    }
  }

  function renderButtons() {
    document.querySelectorAll('[data-task-id]').forEach(decorateButton);
  }

  function interceptClicks() {
    document.addEventListener('click', (event) => {
      const button = event.target.closest?.('[data-task-id]');
      if (!button) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      if (button.disabled) return;
      const taskId = button.dataset.taskId;
      if (button.dataset.claimApproved === '1') claimReward(taskId);
      else openVerification(taskId);
    }, true);
  }

  async function adminPanel() {
    const state = window.state;
    if (!state?.user || state.profile?.role !== 'admin') return;
    const host = $('#adminContent');
    if (!host || host.querySelector('#verificationQueue')) return;

    const section = document.createElement('section');
    section.id = 'verificationQueue';
    section.className = 'panel';
    section.innerHTML = `
      <div class="section-head">
        <div><h2>დავალებების შემოწმება</h2><p>მომხმარებლების მტკიცებულებების განხილვა</p></div>
        <button class="secondary" id="refreshVerificationQueue">განახლება</button>
      </div>
      <div id="verificationQueueList"><div class="empty">იტვირთება...</div></div>
    `;
    host.appendChild(section);

    const load = async () => {
      const list = $('#verificationQueueList');
      const db = client();
      if (!list || !db) return;
      list.innerHTML = '<div class="empty">იტვირთება...</div>';
      try {
        const result = await db.rpc('admin_pending_task_verifications');
        if (result.error) throw result.error;
        const rows = result.data || [];
        list.innerHTML = rows.length ? rows.map(row => `
          <article class="verification-admin-card">
            <div class="verification-admin-meta">
              <strong>${esc(row.task_title || 'დავალება')}</strong>
              <span>${esc(row.username || row.user_id || '')} · ${esc(row.platform || '')} · ${esc(row.action || '')}</span>
              <span>${new Date(row.created_at).toLocaleString('ka-GE')}</span>
            </div>
            <div class="verification-proof"><b>მტკიცებულება:</b> ${row.proof_url ? `<a href="${esc(row.proof_url)}" target="_blank" rel="noopener">გახსნა ↗</a>` : 'არ არის'}</div>
            <div class="verification-proof"><b>შენიშვნა:</b> ${esc(row.note || 'არ არის')}</div>
            <div class="verification-admin-actions">
              <button class="primary" data-review-id="${esc(row.verification_id)}" data-review-status="approved">დადასტურება</button>
              <button class="secondary" data-review-id="${esc(row.verification_id)}" data-review-status="rejected">უარყოფა</button>
            </div>
          </article>
        `).join('') : '<div class="empty">მოლოდინში მყოფი დადასტურებები არ არის.</div>';
      } catch (error) {
        list.innerHTML = `<div class="empty">შემოწმების სიის ჩატვირთვა ვერ მოხერხდა: ${esc(error.message || error)}</div>`;
      }
    };

    $('#refreshVerificationQueue')?.addEventListener('click', load);
    section.addEventListener('click', async (event) => {
      const button = event.target.closest?.('[data-review-id]');
      if (!button) return;
      button.disabled = true;
      try {
        const rejected = button.dataset.reviewStatus === 'rejected';
        const note = rejected ? prompt('მიუთითე უარყოფის მიზეზი:') : null;
        if (rejected && !note?.trim()) {
          button.disabled = false;
          return;
        }
        const result = await client().rpc('admin_review_task_verification', {
          p_verification_id: button.dataset.reviewId,
          p_status: button.dataset.reviewStatus,
          p_note: note || null
        });
        if (result.error) throw result.error;
        toast(rejected ? 'დადასტურება უარყოფილია' : 'დადასტურება მიღებულია ✓');
        await load();
      } catch (error) {
        toast(error.message || error);
        button.disabled = false;
      }
    });

    await load();
  }

  function bindLoadData() {
    if (wrappedLoadData || typeof window.loadData !== 'function') return;
    const original = window.loadData;
    window.loadData = async function () {
      const result = await original.apply(this, arguments);
      setTimeout(() => {
        renderButtons();
        adminPanel();
      }, 0);
      return result;
    };
    wrappedLoadData = true;
  }

  function boot() {
    bindLoadData();
    interceptClicks();
    renderButtons();
    adminPanel();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot, { once: true });
  } else {
    boot();
  }
})();
