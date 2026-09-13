(function(){
  'use strict';

  const q=s=>document.querySelector(s);

  const presets={
    Instagram:{
      title:'მაგ. გამომყევი Instagram-ზე',
      url:'https://instagram.com/...',
      handle:'Instagram მომხმარებელი'
    },
    TikTok:{
      title:'მაგ. გამომყევი TikTok-ზე',
      url:'https://tiktok.com/@...',
      handle:'TikTok მომხმარებელი'
    },
    YouTube:{
      title:'მაგ. გამომიწერე YouTube-ზე',
      url:'https://youtube.com/@...',
      handle:'YouTube არხი'
    },
    X:{
      title:'მაგ. გამომყევი X-ზე',
      url:'https://x.com/...',
      handle:'X მომხმარებელი'
    },
    Facebook:{
      title:'მაგ. გამომყევი Facebook-ზე',
      url:'https://facebook.com/...',
      handle:'Facebook გვერდი'
    }
  };

  function applyPlatform(){
    const platform=q('#promotionPlatform');
    const title=q('#promotionTitle');
    const url=q('#promotionUrl');
    const previewUrl=q('#previewUrl');
    const previewPlatform=q('#previewPlatform');
    if(!platform)return;

    const p=presets[platform.value]||presets.Instagram;

    if(title){
      title.placeholder=p.title;
      title.setAttribute('aria-label',p.title);
    }

    if(url){
      url.placeholder=p.url;
      url.setAttribute('inputmode','url');
      url.setAttribute('aria-label',p.url);
    }

    if(previewUrl && (!url || !url.value.trim())){
      previewUrl.textContent=p.url;
    }

    if(previewPlatform){
      previewPlatform.textContent=platform.value;
    }

    if(typeof window.preview==='function'){
      try{window.preview()}catch{}
    }
  }

  function bind(){
    const platform=q('#promotionPlatform');
    if(!platform)return false;

    if(platform.dataset.platformExamplesBound!=='1'){
      platform.dataset.platformExamplesBound='1';
      platform.addEventListener('change',applyPlatform);
    }

    applyPlatform();
    return true;
  }

  function init(){
    if(bind())return;
    const observer=new MutationObserver(()=>{
      if(bind())observer.disconnect();
    });
    observer.observe(document.body,{childList:true,subtree:true});
    setTimeout(()=>observer.disconnect(),10000);
  }

  if(document.readyState==='loading'){
    document.addEventListener('DOMContentLoaded',init,{once:true});
  }else{
    init();
  }
})();
