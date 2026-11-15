package com.betteranki.app.ui

/**
 * The card page's gesture script (the same as the server's, server/src/render/page.ts), added to every card page by
 * [withGestures]. Older servers' pages and decks downloaded before an update don't have it, and gestures would
 * otherwise do nothing there. A page whose own script has it sets `window.__baGestures`, and this copy stands down.
 */
private val GESTURE_JS = """(function(){
if(window.__baGestures) return;
function post(m){ try{ window.BetterAnkiAndroid.postMessage(JSON.stringify(m)); }catch(e){} }
// touch gestures on the card, for the apps to act on: 'tap:<zone 0-8, rows of three>', 'doubleTap',
// 'swipe:<left|right|up|down>'. Not on links, sounds or inputs, or while selecting text. Vertical swipes only
// count when the card didn't scroll. The Android app adds this same script itself (for older servers and
// downloaded decks) and stands down when the page already has it.
window.__baGestures=1;
var touch=null, lastTap=null;
function control(el){ return el&&el.closest&&el.closest('a,button,input,textarea,select,summary,label,[contenteditable],.soundLink,.hint'); }
function swipe(s,x,y){
  var dx=x-s.x, dy=y-s.y, ax=Math.abs(dx), ay=Math.abs(dy);
  if(Date.now()-s.at>1000||(s.el&&s.el.closest&&s.el.closest('input,textarea,[contenteditable]'))) return;
  if(ax>50&&ax>1.5*ay) post({type:'swipe:'+(dx<0?'left':'right')});
  else if(ay>50&&ay>1.5*ax&&window.scrollY===s.sy) post({type:'swipe:'+(dy<0?'up':'down')});
}
document.addEventListener('touchstart',function(e){
  if(e.touches.length>1){ touch=null; lastTap=null; return; }
  var t=e.touches[0]; touch={x:t.clientX,y:t.clientY,lx:t.clientX,ly:t.clientY,at:Date.now(),sy:window.scrollY,el:e.target,moved:false};
},{passive:true});
document.addEventListener('touchmove',function(e){
  var t=e.touches[0]; if(!touch||!t) return;
  touch.lx=t.clientX; touch.ly=t.clientY;
  if(Math.abs(t.clientX-touch.x)>10||Math.abs(t.clientY-touch.y)>10) touch.moved=true;
},{passive:true});
// the browser may cancel a touch it takes over (to scroll or overscroll): a swipe still counts
document.addEventListener('touchcancel',function(){ var s=touch; touch=null; lastTap=null; if(s&&s.moved) swipe(s,s.lx,s.ly); },{passive:true});
document.addEventListener('touchend',function(e){
  var s=touch; touch=null; var t=e.changedTouches&&e.changedTouches[0];
  if(!s||!t||e.touches.length) return;
  var sel=window.getSelection&&window.getSelection(); if(sel&&String(sel).length){ lastTap=null; return; }
  if(s.moved){ lastTap=null; swipe(s,t.clientX,t.clientY); return; }
  if(Date.now()-s.at>500||control(s.el)){ lastTap=null; return; } // a long press, or a link/button/input
  var now=Date.now();
  if(lastTap&&now-lastTap.at<350&&Math.abs(t.clientX-lastTap.x)<40&&Math.abs(t.clientY-lastTap.y)<40){
    lastTap=null; e.preventDefault(); post({type:'doubleTap'}); return;
  }
  lastTap={at:now,x:t.clientX,y:t.clientY};
  var w=window.innerWidth||1, h=window.innerHeight||1;
  post({type:'tap:'+((t.clientY<h/3?0:t.clientY<2*h/3?1:2)*3+(t.clientX<w/3?0:t.clientX<2*w/3?1:2))});
});
// tell the app when an input (the typed answer) has focus, so its keyboard shortcuts stay out of the way
document.addEventListener('focusin',function(e){ if(e.target&&e.target.matches&&e.target.matches('input,textarea,[contenteditable]')) post({type:'inputFocus'}); });
document.addEventListener('focusout',function(e){ if(e.target&&e.target.matches&&e.target.matches('input,textarea,[contenteditable]')) post({type:'inputBlur'}); });
})();"""

/** [html] with the gesture script added just before `</body>` (or at the end). */
fun withGestures(html: String): String {
    val tag = "<script>$GESTURE_JS</script>"
    val i = html.lastIndexOf("</body>", ignoreCase = true)
    return if (i >= 0) html.substring(0, i) + tag + html.substring(i) else html + tag
}
