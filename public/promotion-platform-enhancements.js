(function(){
  'use strict';

  const presets={
    Instagram:{
      title:'მაგ. გამომყევი Instagram-ზე',
      url:'https://instagram.com/...'
    },
    TikTok:{
      title:'მაგ. გამომყევი TikTok-ზე',
      url:'https://tiktok.com/@...'
    },
    YouTube:{
      title:'მაგ. გამომიწერე YouTube-ზე',
      url:'https://youtube.com/@...'
    },
    X:{
      title:'მაგ. გამომყევი X-ზე',
      url:'https://x.com/...'
    },
    Facebook:{
      title:'მაგ. გამომყევი Facebook-ზე',
      url:'https://facebook.com/...'
    }
  };

  function getElements(){
    return {
      platform:document.querySelector('#promotionPlatform'),
      title:document.querySelector('#promotionTitle'),
      url:document.querySelector('#promotionUrl'),
      previewUrl:document.querySelector('#previewUrl'),
      previewPlatform:document.querySelector('#previewPlatform')
    };
  }

  function applyPlatform(){
    const {platform,title,url,previewUrl,previewPlatform}=getElements();
    if(!platform)return false;

    const preset=presets[platform.value]||presets.Instagram;

    if(title){
      title.placeholder=preset.title;
      title.setAttribute('aria-label',preset.title);
    }

    if(url){
      url.placeholder=preset.url;
      url.setAttribute('inputmode','url');
      url.setAttribute('aria-label',preset.url);
    }

    if(previewPlatform){
      previewPlatform.textContent=platform.value;
    }

    if(previewUrl && (!url || !url.value.trim())){
      previewUrl.textContent=preset.url;
    }

    if(typeof window.preview==='function'){
      try{window.preview();}catch{}
    }

    return true;
  }

  function handleChange(event){
    const target=event.target;
    if(target && target.id==='promotionPlatform'){
      applyPlatform();
    }
  }

  function init(){
    document.addEventListener('change',handleChange,true);
    applyPlatform();

    if(typeof MutationObserver==='undefined')return;

    const observer=new MutationObserver(()=>{
      const platform=document.querySelector('#promotionPlatform');
      if(platform && !platform.dataset.platformExamplesReady){
        platform.dataset.platformExamplesReady='1';
        applyPlatform();
      }
    });

    observer.observe(document.body,{childList:true,subtree:true});
  }

  if(document.readyState==='loading'){
    document.addEventListener('DOMContentLoaded',init,{once:true});
  }else{
    init();
  }
})();
