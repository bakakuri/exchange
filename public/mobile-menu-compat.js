/* Compatibility shim for the legacy #mobileMenu listener in app.js. */
(function(){
  if(document.getElementById('mobileMenu')) return;
  const b=document.createElement('button');
  b.id='mobileMenu';
  b.type='button';
  b.hidden=true;
  b.setAttribute('aria-hidden','true');
  b.tabIndex=-1;
  document.body.appendChild(b);
})();
