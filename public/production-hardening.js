(function(){
  'use strict';
  document.addEventListener('submit',async function(e){
    const form=e.target;
    if(!form||form.id!=='profileSettingsForm')return;
    if(typeof state==='undefined'||!state.user||!state.supabase)return;
    e.preventDefault();
    e.stopImmediatePropagation();
    const button=form.querySelector('button[type="submit"]');
    if(button)button.disabled=true;
    try{
      const r=await state.supabase.rpc('update_my_profile',{
        p_username:document.querySelector('#settingsUsername')?.value.trim()||'',
        p_display_name:document.querySelector('#settingsDisplayName')?.value.trim()||'',
        p_avatar_url:document.querySelector('#settingsAvatarUrl')?.value.trim()||''
      });
      if(r.error)throw r.error;
      if(typeof window.toast==='function')window.toast('პროფილი განახლდა ✓');
      if(typeof window.loadData==='function')await window.loadData();
    }catch(err){
      if(typeof window.toast==='function')window.toast(err.message||String(err));
    }finally{
      if(button)button.disabled=false;
    }
  },true);
})();
