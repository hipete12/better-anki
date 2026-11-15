// Builds self-contained HTML documents for displaying a card side inside a
// sandboxed iframe (web) or WebView (Android). Both clients use the same page.
import { escapeHtml } from "../util";

export interface PageOptions {
  html: string;
  css: string;
  ord: number;
  night: boolean;
  mediaBase: string;
  autoplay: boolean;
  side: "question" | "answer";
  platform?: string;
  questionHtml?: string; // used to determine answer-only sounds
  /** Offline pages: write night-mode class placeholders the device fills in (see NIGHT_TOKENS). */
  nightTokens?: boolean;
}

/** Placeholders in offline card pages; the device replaces them with the night classes or "". */
export const NIGHT_TOKENS = { html: "__BA_NIGHT_HTML__", card: "__BA_NIGHT_CARD__" } as const;

const VIDEO_EXT = /\.(mp4|webm|mkv|mov|ogv|avi|m4v)$/i;

const BASE_CSS = `
html { -webkit-text-size-adjust: 100%; }
body { margin: 0; padding: 40px 28px 64px; overflow-wrap: break-word; min-height: 100vh; box-sizing: border-box; }
@media (max-width: 520px) { body { padding: 28px 18px 48px; } }
.card.nightMode, .nightMode .card { color: #eceef4; background-color: #14161c; }
img { max-width: 100%; height: auto; }
.nightMode img.invert, .nightMode .invert-dark { filter: invert(1) hue-rotate(180deg); }
hr#answer { border: 0; height: 1px; background: currentColor; opacity: .25; margin: 1.2em 0; }
#typeans { font-family: ui-monospace, Menlo, Consolas, monospace; font-size: 1em; }
input#typeans { width: min(90%, 520px); box-sizing: border-box; padding: .5em .7em; border-radius: 10px; border: 1.5px solid #8885; background: transparent; color: inherit; outline: none; margin-top: .6em; }
input#typeans:focus { border-color: #6366f1; box-shadow: 0 0 0 3px #6366f133; }
code#typeans { display: inline-block; padding: .4em .6em; border-radius: 8px; background: #8881; }
.typeGood { background: #22c55e44; } .typeBad { background: #ef444455; } .typeMissed { background: #9993; }
.replay-button { display: inline-flex; vertical-align: middle; margin: 0 .2em; text-decoration: none; }
.replay-button svg { width: 34px; height: 34px; }
.replay-button svg circle { fill: #6366f1; } .replay-button svg path { fill: #fff; }
.replay-button.playing svg circle { fill: #22c55e; }
.template-error { color: #ef4444; font-family: monospace; font-size: 14px; }
a.hint { color: #6366f1; }
.cloze-inactive[data-shape], .cloze[data-shape] { display: none; }
video { max-width: 100%; }
`;

const PLAY_SVG = `<svg viewBox="0 0 64 64" aria-hidden="true"><circle cx="32" cy="32" r="29"/><path d="M56.502,32.301l-37.502,20.101l0.329,-40.804l37.173,20.703Z" transform="translate(-6 0) scale(1)"/></svg>`;

function transformMedia(html: string, sounds: string[], tts: { lang: string; text: string }[]): string {
  html = html.replace(/\[sound:([^\]]+)\]/g, (_m, file: string) => {
    if (VIDEO_EXT.test(file)) return `<video controls playsinline src="${escapeHtml(encodeURI(file))}"></video>`;
    const idx = sounds.push(file) - 1;
    return `<a class="replay-button soundLink" href="#" data-sound="${idx}" onclick="window.__ba.play(${idx});return false;" aria-label="Play audio">${PLAY_SVG}</a>`;
  });
  html = html.replace(/\[anki:tts lang=([^\]]*)\]([\s\S]*?)\[\/anki:tts\]/g, (_m, lang: string, text: string) => {
    const idx = sounds.push(`tts:${tts.length}`) - 1;
    tts.push({ lang, text });
    return `<a class="replay-button soundLink" href="#" data-sound="${idx}" onclick="window.__ba.play(${idx});return false;" aria-label="Speak">${PLAY_SVG}</a>`;
  });
  // [$]...[/$] and [latex] -> MathJax delimiters (no local LaTeX needed)
  html = html
    .replace(/\[\$\]([\s\S]*?)\[\/\$\]/g, (_m, t) => `\\(${t}\\)`)
    .replace(/\[\$\$\]([\s\S]*?)\[\/\$\$\]/g, (_m, t) => `\\[${t}\\]`)
    .replace(/\[latex\]([\s\S]*?)\[\/latex\]/g, (_m, t) => `\\[${String(t).replace(/\\begin\{document\}|\\end\{document\}/g, "")}\\]`);
  return html;
}

function soundsIn(html: string): string[] {
  return [...html.matchAll(/\[sound:([^\]]+)\]/g)].map((m) => m[1]).filter((f) => !VIDEO_EXT.test(f));
}

export function buildCardPage(o: PageOptions): string {
  const sounds: string[] = [];
  const tts: { lang: string; text: string }[] = [];
  const body = transformMedia(o.html, sounds, tts);
  // On the answer side only auto-play sounds that weren't on the question.
  let autoplayFrom = 0;
  if (o.side === "answer" && o.questionHtml !== undefined) {
    const qCount = soundsIn(o.questionHtml).length + (o.questionHtml.match(/\[anki:tts/g)?.length ?? 0);
    autoplayFrom = o.html.includes(o.questionHtml) || /<hr id=["']?answer/.test(o.html) ? qCount : 0;
  }
  const needsMath = /\\\(|\\\[|\[\$\]|\[\$\$\]|\[latex\]/.test(o.html);
  const classes = ["card", `card${o.ord + 1}`, o.platform ? `ba-${o.platform}` : "", o.nightTokens ? NIGHT_TOKENS.card : o.night ? "nightMode night_mode" : ""]
    .filter(Boolean)
    .join(" ");
  const state = {
    sounds,
    tts,
    autoplay: o.autoplay,
    autoplayFrom: Math.min(autoplayFrom, sounds.length),
    side: o.side,
  };
  return `<!doctype html>
<html class="${o.nightTokens ? NIGHT_TOKENS.html : o.night ? "night-mode" : ""}"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<base href="${escapeHtml(o.mediaBase)}">
<style>${BASE_CSS}</style>
<style>${o.css}</style>
${
  needsMath
    ? `<script>window.MathJax={tex:{displayMath:[["\\\\[","\\\\]"]],inlineMath:[["\\\\(","\\\\)"]],processEscapes:false},startup:{typeset:true}};</script><script async src="https://cdn.jsdelivr.net/npm/mathjax@3.2.2/es5/tex-chtml.js"></script>`
    : ""
}
</head><body class="${classes}"><div id="qa">${body}</div>
<script>${bridgeScript(state)}</script>
</body></html>`;
}

function bridgeScript(state: object): string {
  return `(function(){
var S=${JSON.stringify(state)};
var audio=null, queue=[], cur=-1;
function post(msg){
  try{ if(window.BetterAnkiAndroid){ window.BetterAnkiAndroid.postMessage(JSON.stringify(msg)); return; } }catch(e){}
  try{ window.parent && window.parent!==window && window.parent.postMessage(Object.assign({__ba:1},msg),'*'); }catch(e){}
}
function mark(i,on){ var el=document.querySelector('[data-sound="'+i+'"]'); if(el) el.classList.toggle('playing',!!on); }
function stop(){ if(audio){ try{audio.pause();}catch(e){} audio=null; } if(window.speechSynthesis) speechSynthesis.cancel(); if(cur>=0) mark(cur,false); cur=-1; queue=[]; }
function playOne(i,done){
  var s=S.sounds[i]; if(s==null){done&&done();return;}
  cur=i; mark(i,true);
  var fin=function(){ mark(i,false); if(cur===i)cur=-1; done&&done(); };
  if(s.indexOf('tts:')===0){
    var t=S.tts[+s.slice(4)]; if(!window.speechSynthesis){fin();return;}
    var u=new SpeechSynthesisUtterance(t.text); if(t.lang) u.lang=t.lang.replace('_','-');
    u.onend=fin; u.onerror=fin; speechSynthesis.speak(u); return;
  }
  audio=new Audio(encodeURI(s)); audio.onended=fin; audio.onerror=fin;
  var p=audio.play(); if(p&&p.catch) p.catch(function(){ fin(); post({type:'autoplayBlocked'}); });
}
function playQueue(list){ stop(); queue=list.slice(); (function next(){ if(!queue.length){ post({type:'audioDone'}); return;} playOne(queue.shift(),next); })(); }
var api={
  play:function(i){ playQueue([i]); },
  replay:function(){ var l=[]; for(var i=(S.side==='answer'?S.autoplayFrom:0);i<S.sounds.length;i++) l.push(i); if(!l.length) for(var j=0;j<S.sounds.length;j++) l.push(j); playQueue(l); },
  stop:stop,
  getTyped:function(){ var el=document.getElementById('typeans'); return el&&el.value!==undefined? el.value : null; },
  send:function(type,data){ post({type:type,data:data}); },
  hasSounds:function(){ return S.sounds.length>0; }
};
window.__ba=api;
window.addEventListener('message',function(e){
  var d=e.data||{}; if(!d.__baCmd) return;
  if(d.__baCmd==='getTyped') post({type:'typed',value:api.getTyped(),req:d.req});
  else if(d.__baCmd==='replay') api.replay();
  else if(d.__baCmd==='stop') api.stop();
  else if(d.__baCmd==='focusType'){ var el=document.getElementById('typeans'); if(el) el.focus(); }
});
document.addEventListener('keydown',function(e){
  var t=e.target; if(t&&(t.tagName==='INPUT'||t.tagName==='TEXTAREA'||t.isContentEditable)) { if(e.key==='Escape') t.blur(); return; }
  post({type:'key',key:e.key,code:e.code,ctrl:e.ctrlKey,meta:e.metaKey,shift:e.shiftKey,alt:e.altKey});
  if(e.key===' '||e.key==='Enter') e.preventDefault();
});
// double-tap on the card (touch only, not on links, sounds, inputs or while selecting text): the app undoes
var lastTap=null;
document.addEventListener('touchstart',function(e){ if(e.touches.length>1) lastTap=null; },{passive:true});
document.addEventListener('touchend',function(e){
  var t=e.changedTouches&&e.changedTouches[0]; if(!t||e.touches.length) return;
  var el=e.target; if(el&&el.closest&&el.closest('a,button,input,textarea,select,summary,label,[contenteditable],.soundLink,.hint')){ lastTap=null; return; }
  var now=Date.now();
  if(lastTap&&now-lastTap.at<350&&Math.abs(t.clientX-lastTap.x)<30&&Math.abs(t.clientY-lastTap.y)<30){
    lastTap=null; var sel=window.getSelection&&window.getSelection(); if(sel&&String(sel).length) return;
    e.preventDefault(); post({type:'doubleTap'}); return;
  }
  lastTap={at:now,x:t.clientX,y:t.clientY};
});
document.addEventListener('touchmove',function(){ lastTap=null; },{passive:true});
document.addEventListener('click',function(e){
  var a=e.target&&e.target.closest&&e.target.closest('a[href]');
  if(a&&!a.classList.contains('soundLink')&&!a.classList.contains('hint')){ var h=a.getAttribute('href'); if(h&&/^https?:/i.test(h)){ e.preventDefault(); post({type:'openLink',url:h}); } }
});
// Image occlusion support (Anki-compatible note format)
window.anki=window.anki||{};
window.anki.imageOcclusion={setup:function(){
  var c=document.getElementById('image-occlusion-container'); if(!c) return;
  var img=c.querySelector('img'); var cv=document.getElementById('image-occlusion-canvas'); if(!img||!cv) return;
  var answer=S.side==='answer'; var showInactive=true;
  function draw(){
    var w=img.clientWidth,h=img.clientHeight; if(!w||!h) return;
    cv.width=w*devicePixelRatio; cv.height=h*devicePixelRatio; cv.style.cssText='position:absolute;left:0;top:0;width:'+w+'px;height:'+h+'px;pointer-events:none';
    var g=cv.getContext('2d'); g.setTransform(devicePixelRatio,0,0,devicePixelRatio,0,0); g.clearRect(0,0,w,h);
    document.querySelectorAll('.cloze[data-shape],.cloze-inactive[data-shape]').forEach(function(el){
      var active=el.classList.contains('cloze'); var oi=el.dataset.oi==='1';
      if(!active && !(oi||showInactive)) return;
      if(!active && !oi && answer===false && !showInactive) return;
      var fill, stroke;
      if(active){ if(answer){ fill='rgba(0,0,0,0)'; stroke='#ef4444'; } else { fill='#ff8e8e'; stroke='#212121'; } }
      else { if(!oi && !showInactive) return; fill='#ffeba2'; stroke='#212121'; }
      var L=+el.dataset.left*w, T=+el.dataset.top*h;
      g.fillStyle=fill; g.strokeStyle=stroke; g.lineWidth=2.5;
      var shape=el.dataset.shape;
      g.beginPath();
      if(shape==='ellipse'){ var rx=+el.dataset.rx*w, ry=+el.dataset.ry*h; g.ellipse(L+rx,T+ry,rx,ry,0,0,Math.PI*2); }
      else if(shape==='polygon'){ var pts=(el.dataset.points||'').trim().split(' ').map(function(p){var q=p.split(',');return [+q[0]*w,+q[1]*h];}); pts.forEach(function(p,i){ i?g.lineTo(p[0],p[1]):g.moveTo(p[0],p[1]); }); g.closePath(); }
      else { g.rect(L,T,+el.dataset.width*w,+el.dataset.height*h); }
      g.fill(); g.stroke();
    });
  }
  if(img.complete) draw(); else img.onload=draw; window.addEventListener('resize',draw);
  var tg=document.getElementById('toggle'); if(tg) tg.onclick=function(){ showInactive=!showInactive; draw(); };
}};
if(S.side==='answer'){ var an=document.getElementById('answer'); if(an) setTimeout(function(){ if(an.getBoundingClientRect().top>innerHeight*0.6) an.scrollIntoView({block:'start'}); },0); }
window.addEventListener('load',function(){
  if(S.autoplay && S.sounds.length>S.autoplayFrom){ var l=[]; for(var i=S.autoplayFrom;i<S.sounds.length;i++) l.push(i); playQueue(l); }
  post({type:'ready',side:S.side,sounds:S.sounds.length});
});
})();`;
}
