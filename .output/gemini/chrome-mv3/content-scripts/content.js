var content=(function(){function e(e){return e}function t(e){return String(e||``).replace(/<[^>]*>/g,``).replace(/&amp;/g,`&`).replace(/&lt;/g,`<`).replace(/&gt;/g,`>`).replace(/&quot;/g,`"`).replace(/&#39;|&apos;/g,`'`).replace(/\s+/g,` `).trim()}function n(e){return e.replace(`,`,`.`).split(`:`).map(Number).reduce((e,t)=>e*60+t,0)}function r(e){return e.map(e=>({start:Number(e.start),end:Number(e.end),text:t(e.text)})).filter(e=>Number.isFinite(e.start)&&Number.isFinite(e.end)&&e.start>=0&&e.end>e.start&&e.text).sort((e,t)=>e.start-t.start)}function i(e){let t=[],i=e.replace(/^\uFEFF/,``).replace(/\r/g,``).split(`
`);for(let e=0;e<i.length;e++){let r=i[e].match(/^\s*((?:\d+:)?\d{2}:\d{2}[.,]\d+)\s*-->\s*((?:\d+:)?\d{2}:\d{2}[.,]\d+)/);if(!r)continue;let a=[];for(;++e<i.length&&i[e].trim();)a.push(i[e]);t.push({start:n(r[1]),end:n(r[2]),text:a.join(` `)})}return r(t)}function a(e){return r((e.events||[]).filter(e=>e.segs).map(e=>({start:(e.tStartMs||0)/1e3,end:((e.tStartMs||0)+(e.dDurationMs||2e3))/1e3,text:(e.segs||[]).map(e=>e.utf8||``).join(``)})))}function o(e,t){let n=0,r=e.length-1,i=-1;for(;n<=r;){let a=n+r>>1;e[a].start<=t?(i=a,n=a+1):r=a-1}return i>=0&&e[i].end>t?i:-1}function s(e,{maxGap:t=1.2,maxDuration:n=12,maxChars:r=320,maxCues:i=6}={}){let a=[],o=null;return e.forEach((e,s)=>{o&&(e.start-o.end>t||e.end-o.start>n||o.text.length+e.text.length+1>r||o.cues.length>=i)&&(a.push(o),o=null),o?(o.end=Math.max(o.end,e.end),o.text+=` `+e.text,o.cues.push(s)):o={start:e.start,end:e.end,text:e.text,cues:[s]},/[.!?…]["'”’)\]]*$/.test(e.text)&&(a.push(o),o=null)}),o&&a.push(o),a}typeof globalThis<`u`&&(globalThis.LocalSubtitles={clean:t,timestamp:n,normalize:r,parse:i,json3:a,indexAt:o,sentences:s});var c=`[LocalTranslator] `;function l(e,t={},n=`info`){let r=JSON.stringify({event:e,time:new Date().toISOString(),...t});n===`error`?console.error(c+r):n===`warn`?console.warn(c+r):console.log(c+r)}typeof globalThis<`u`&&(globalThis.LTLog=l);var u=null,d=null,ee=null,te=null,f=!1,p=`Offline`;function m(e){p=e}var h=`<svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true" style="display:block;fill:currentColor"><path d="M12 5c-5 0-9.27 3.11-11 7 1.73 3.89 6 7 11 7s9.27-3.11 11-7c-1.73-3.89-6-7-11-7zm0 12a5 5 0 1 1 0-10 5 5 0 0 1 0 10zm0-2a3 3 0 1 0 0-6 3 3 0 0 0 0 6z"/></svg>`,g=`<svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true" style="display:block;fill:currentColor"><path d="m2.1 3.51 1.41-1.42 18.4 18.4-1.42 1.42-3.28-3.28A12.7 12.7 0 0 1 12 20C7 20 2.73 16.89 1 13a12.9 12.9 0 0 1 4.04-5.1L2.1 3.51zM8.2 9.62A5 5 0 0 0 14.38 15.8L8.2 9.62zM12 6c5 0 9.27 3.11 11 7a12.7 12.7 0 0 1-3.28 4.4l-2.9-2.9A5 5 0 0 0 9.5 7.18L7.8 5.48A13 13 0 0 1 12 6z"/></svg>`;function _(){if(!u||!d)return;let e=d.querySelector(`.card`),t=d.querySelector(`#subtitle-visibility`);e?.classList.toggle(`subtitles-hidden`,f),t&&(t.innerHTML=f?h:g,t.title=f?`Hiện phụ đề`:`Ẩn phụ đề`,t.setAttribute(`aria-label`,f?`Hiện phụ đề`:`Ẩn phụ đề`),t.setAttribute(`aria-pressed`,String(f)))}function v(){if(typeof document>`u`)return{host:null,ui:null};if(u?.isConnected)return{host:u,ui:d};let e=document.getElementById(`local-translator-root`);e&&e.remove(),u=document.createElement(`div`),u.id=`local-translator-root`,u.style.cssText=`position:fixed;bottom:64px;left:50%;transform:translateX(-50%);z-index:2147483647;width:85vw;min-width:85vw;max-width:85vw;pointer-events:none;`,d=u.attachShadow({mode:`open`}),d.innerHTML=`<style>
    :host {
      display: block !important;
      width: 85vw !important;
      min-width: 85vw !important;
      max-width: 85vw !important;
      color-scheme: dark;
    }
    * { box-sizing: border-box; }
    .card {
      position: relative;
      display: block;
      width: 85vw !important;
      min-width: 85vw !important;
      max-width: 85vw !important;
      box-sizing: border-box;
      background: rgba(15, 23, 42, 0.88);
      backdrop-filter: blur(10px);
      -webkit-backdrop-filter: blur(10px);
      color: #edf4ff;
      border: 1px solid rgba(255, 255, 255, 0.12);
      border-radius: 12px;
      padding: 10px 84px 10px 18px;
      box-shadow: 0 10px 32px rgba(0, 0, 0, 0.5);
      text-align: center;
      cursor: grab;
      pointer-events: auto;
      user-select: none;
      min-height: 48px;
    }
    .card:active { cursor: grabbing; }

    .controls {
      position: absolute;
      top: 6px;
      right: 8px;
      display: flex;
      align-items: center;
      gap: 6px;
      pointer-events: auto;
    }

    .card.subtitles-hidden {
      width: max-content !important;
      min-width: 0 !important;
      max-width: 100% !important;
      min-height: 0;
      margin-left: auto;
      padding: 6px;
    }
    .card.subtitles-hidden .controls {
      position: static;
      justify-content: flex-end;
    }
    .card.subtitles-hidden #source,
    .card.subtitles-hidden #target { display: none; }

    #live-indicator {
      display: inline-flex;
      align-items: center;
      gap: 5px;
      padding: 2px 7px;
      border-radius: 999px;
      background: rgba(255, 255, 255, 0.08);
      border: 1px solid rgba(255, 255, 255, 0.16);
      font: 700 10px/1.2 system-ui, sans-serif;
      letter-spacing: 0.5px;
      color: #94a3b8;
      cursor: pointer;
      user-select: none;
      transition: all 0.2s;
    }
    #live-indicator:hover {
      background: rgba(255, 255, 255, 0.18);
      color: #ffffff;
    }
    .live-dot {
      width: 6px;
      height: 6px;
      border-radius: 50%;
      background: #64748b;
      transition: all 0.2s;
    }
    #live-indicator.active {
      background: rgba(239, 68, 68, 0.22);
      border-color: rgba(239, 68, 68, 0.45);
      color: #fca5a5;
    }
    #live-indicator.active .live-dot {
      background: #ef4444;
      box-shadow: 0 0 6px #ef4444;
      animation: pulse 1.4s ease-in-out infinite;
    }
    @keyframes pulse {
      0%, 100% { opacity: 1; transform: scale(1); }
      50% { opacity: 0.35; transform: scale(0.85); }
    }
    #live-indicator.paused {
      background: rgba(245, 158, 11, 0.22);
      border-color: rgba(245, 158, 11, 0.45);
      color: #fde68a;
    }
    #live-indicator.paused .live-dot {
      background: #f59e0b;
      box-shadow: 0 0 6px #f59e0b;
      animation: none;
    }
    #live-indicator.connecting {
      background: rgba(56, 189, 248, 0.2);
      border-color: rgba(56, 189, 248, 0.45);
      color: #bae6fd;
    }
    #live-indicator.connecting .live-dot {
      background: #38bdf8;
      box-shadow: 0 0 6px #38bdf8;
      animation: pulse 0.8s ease-in-out infinite;
    }

    #reset {
      width: 22px;
      height: 22px;
      padding: 0;
      border: 0;
      border-radius: 50%;
      background: transparent;
      color: #94a3b8;
      font: 14px/1 system-ui, sans-serif;
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: center;
      transition: all 0.15s;
    }
    #subtitle-visibility {
      width: 22px;
      height: 22px;
      padding: 3px;
      border: 0;
      border-radius: 50%;
      background: transparent;
      color: #94a3b8;
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: center;
      transition: all 0.15s;
    }
    #subtitle-visibility:hover {
      background: rgba(255, 255, 255, 0.15);
      color: #ffffff;
    }
    #reset:hover {
      background: rgba(255, 255, 255, 0.15);
      color: #ffffff;
    }

    #source {
      display: block;
      width: 100%;
      box-sizing: border-box;
      text-align: center;
      font-size: 18px;
      line-height: 1.4;
      color: #cbd5e1;
      font-family: system-ui, -apple-system, sans-serif;
      text-shadow: 0 1px 3px rgba(0, 0, 0, 0.75);
      word-break: break-word;
      overflow-wrap: break-word;
    }
    #source:empty { display: none; }

    #target {
      display: block;
      width: 100%;
      box-sizing: border-box;
      text-align: center;
      font-size: 18px;
      font-weight: 600;
      line-height: 1.4;
      color: #ffffff;
      font-family: system-ui, -apple-system, sans-serif;
      text-shadow: 0 1px 3px rgba(0, 0, 0, 0.75);
      margin-top: 3px;
      word-break: break-word;
      overflow-wrap: break-word;
    }
    #target:empty { display: none; }
    /* Live turns may run for minutes. Keep a rolling window instead of
       letting the accumulated transcript cover the video. */
    .card.live-subtitles #source {
      max-height: min(2.8em, 8vh);
      overflow: hidden;
    }
    .card.live-subtitles #target {
      max-height: min(4.2em, 12vh);
      overflow: hidden;
    }
  </style>
  <div class="card">
    <div class="controls">
      <button id="live-indicator" type="button" title="Chế độ ${p} · Bấm để bật Gemini Live" aria-label="Bật/Tắt Gemini Live">
        <span class="live-dot"></span>
        <span class="live-text">LIVE</span>
      </button>
      <button id="subtitle-visibility" type="button" title="Ẩn phụ đề" aria-label="Ẩn phụ đề" aria-pressed="false">${g}</button>
      <button id="reset" type="button" title="Đưa phụ đề về vị trí mặc định" aria-label="Đưa phụ đề về vị trí mặc định">↺</button>
      <label title="Mở SRT / VTT" style="cursor:pointer;font:11px system-ui">SRT/VTT<input id="file" type="file" accept=".srt,.vtt" style="display:none"></label>
    </div>
    <div id="source"></div>
    <div id="target"></div>
  </div>`,(document.fullscreenElement||document.body||document.documentElement).append(u);let t=d.querySelector(`.card`),n=d.querySelector(`#reset`),r=d.querySelector(`#live-indicator`),i=d.querySelector(`#subtitle-visibility`),a=d.querySelector(`#file`);a.addEventListener(`change`,()=>{let e=a.files?.[0];e&&te?.(e),a.value=``}),_();let o=()=>{u&&(u.style.left=`50%`,u.style.top=``,u.style.bottom=`64px`,u.style.transform=`translateX(-50%)`)};return n.addEventListener(`click`,e=>{e.stopPropagation(),o()}),i.addEventListener(`click`,e=>{e.stopPropagation(),f=!f,_()}),r.addEventListener(`click`,e=>{e.stopPropagation(),ee?.()}),t.addEventListener(`pointerdown`,e=>{if(e.button!==0||e.target.closest(`#reset`)||e.target.closest(`#subtitle-visibility`)||e.target.closest(`#live-indicator`)||e.target.closest(`.controls`)||!u)return;let n=u.getBoundingClientRect(),r=e.clientX-n.left,i=e.clientY-n.top;t.setPointerCapture(e.pointerId);let a=e=>{if(!u)return;let t=u.getBoundingClientRect().width,n=u.getBoundingClientRect().height,a=Math.max(0,Math.min(window.innerWidth-t,e.clientX-r)),o=Math.max(0,Math.min(window.innerHeight-n,e.clientY-i));u.style.left=`${a}px`,u.style.top=`${o}px`,u.style.bottom=`auto`,u.style.transform=`none`},o=()=>{t.removeEventListener(`pointermove`,a),t.removeEventListener(`pointerup`,o),t.removeEventListener(`pointercancel`,o)};t.addEventListener(`pointermove`,a),t.addEventListener(`pointerup`,o),t.addEventListener(`pointercancel`,o)}),{host:u,ui:d}}function y(e,t){if(!d)return;d.querySelector(`.card`)?.classList.toggle(`live-subtitles`,e===`live`);let n=d.querySelector(`#live-indicator`);if(!n)return;let r=n.querySelector(`.live-text`);n.classList.remove(`active`,`paused`,`connecting`),e===`live`?t===`paused`?(n.classList.add(`paused`),r&&(r.textContent=`PAUSED`),n.title=`Gemini Live: Tạm dừng · Bấm để tắt`):[`connecting`,`reconnecting`].includes(t||``)?(n.classList.add(`connecting`),r&&(r.textContent=`CONNECTING`),n.title=`Đang kết nối Gemini Live… (Bấm để hủy)`):(n.classList.add(`active`),r&&(r.textContent=`LIVE`),n.title=`Gemini Live: Đang chạy · Bấm để tắt`):(r&&(r.textContent=`LIVE`),n.title=`Chế độ ${p} · Bấm để bật Gemini Live`)}function b(e,t){if((!d||!u?.isConnected)&&v(),!d)return;let n=d.querySelector(`#source`),r=d.querySelector(`#target`);if(n&&typeof e==`string`&&(n.textContent=e),r&&typeof t==`string`&&(r.textContent=t),d.querySelector(`.card.live-subtitles`))for(let e of[n,r])e&&(e.scrollTop=e.scrollHeight)}function ne(){}function re(e){if((!d||!u?.isConnected)&&v(),!d)return;let t=d.querySelector(`#playback-status`);t||(t=document.createElement(`div`),t.id=`playback-status`,t.style.cssText=`font:11px system-ui;color:#94a3b8;margin-top:4px`,d.querySelector(`.card`)?.append(t)),t.textContent=e}function ie(e){ee=e}function ae(e){te=e}function x(){u?.isConnected&&u.remove(),u=null,d=null}function S(){return!!u?.isConnected}function C(e){f=!!e,_()}function oe(){return f}function se(){return u}function w(){return d}typeof document<`u`&&document.addEventListener(`fullscreenchange`,()=>{u?.isConnected&&(document.fullscreenElement||document.body).append(u)});var T={setOnImport:ae,configure:m,ensure:v,setBadge:y,setText:b,setLoading:ne,setStatus:re,remove:x,isConnected:S,setSubtitlesHidden:C,areSubtitlesHidden:oe,getHost:se,getUi:w,setOnLiveToggle:ie};typeof globalThis<`u`&&(globalThis.LTCaptionUI=T);var E=`offline`;function ce(e){E=e}var le=`#movie_player > div.ytp-chrome-bottom > div.ytp-chrome-controls > div.ytp-right-controls`,D=null,O={},k=new WeakSet;function ue(){if(typeof document>`u`||document.getElementById(`local-translator-yt-style`))return;let e=document.createElement(`style`);e.id=`local-translator-yt-style`,e.textContent=`
    #local-translator-youtube-button.local-translator-active img {
      filter: drop-shadow(0 0 6px rgba(99, 102, 241, 0.9));
    }
    #local-translator-live-button {
      color: #fff;
      transition: color 0.2s, filter 0.2s;
    }
    #local-translator-live-button.local-translator-live-active {
      color: #ff3b30 !important;
      filter: drop-shadow(0 0 6px rgba(255, 59, 48, 0.85));
    }
    #local-translator-live-button.local-translator-live-connecting {
      color: #f59e0b !important;
    }
    #local-translator-live-button.local-translator-live-paused {
      color: #94a3b8 !important;
      opacity: 0.85;
    }
  `,document.head?.append(e)}function A(e){if(typeof document>`u`)return;let t=document.querySelector(`#local-translator-youtube-button`);t&&(t.classList.toggle(`local-translator-active`,!!e),t.setAttribute(`aria-pressed`,String(!!e)),t.setAttribute(`title`,e?`Đang dịch phụ đề (Bấm để dừng)`:`Dịch phụ đề tiếng Việt (${E})`))}function j(e){if(typeof document>`u`)return;let t=document.querySelector(`#local-translator-live-button`);if(!t)return;let n=[`active`,`transcript`].includes(e),r=[`connecting`,`reconnecting`].includes(e),i=e===`paused`;t.classList.toggle(`local-translator-live-active`,n),t.classList.toggle(`local-translator-live-connecting`,r),t.classList.toggle(`local-translator-live-paused`,i),t.setAttribute(`aria-pressed`,String(n||r||i)),i?t.setAttribute(`title`,`Gemini Live đang tạm dừng (Bấm để tắt)`):r?t.setAttribute(`title`,`Đang kết nối Gemini Live… (Bấm để hủy)`):n?t.setAttribute(`title`,`Đang chạy Gemini Live (Bấm để tắt)`):t.setAttribute(`title`,`Bật Gemini Live Audio Translate`)}var M=()=>O.onPause?.(),N=()=>O.onPlay?.(),P=()=>O.onSeeking?.(),F=()=>O.onSeeked?.(),I=()=>O.onEnded?.();function L(e){if(typeof document>`u`)return null;e&&(O=e);let t=document.querySelector(`#movie_player video`)||document.querySelector(`video`);return t===D?D:(D&&(D.removeEventListener(`pause`,M),D.removeEventListener(`play`,N),D.removeEventListener(`seeking`,P),D.removeEventListener(`seeked`,F),D.removeEventListener(`ended`,I)),D=t,D&&(D.addEventListener(`pause`,M),D.addEventListener(`play`,N),D.addEventListener(`seeking`,P),D.addEventListener(`seeked`,F),D.addEventListener(`ended`,I)),O.onVideoChanged?.(D),D)}function R(e={}){if(typeof document>`u`||typeof location>`u`||!/(^|\.)youtube\.com$/.test(location.hostname))return;let t=document.querySelector(le);if(!t)return;ue();let n=t.querySelector(`#local-translator-youtube-button`);n||(n=document.createElement(`button`),n.id=`local-translator-youtube-button`,n.className=`ytp-button`,n.type=`button`,n.title=`Dịch phụ đề tiếng Việt (${E})`,n.setAttribute(`aria-label`,`Dịch phụ đề tiếng Việt`),n.setAttribute(`aria-pressed`,`false`),n.innerHTML=`<img src="${chrome.runtime.getURL(`logo.svg`)}" alt="" style="display:block;width:26px;height:26px;margin:auto">`,n.addEventListener(`click`,t=>{t.preventDefault(),t.stopPropagation(),e.onSubtitleClick?.()}),t.append(n)),n&&(n.style.display=e.subtitlesEnabled===!1?`none`:``);let r=t.querySelector(`#local-translator-live-button`);r||(r=document.createElement(`button`),r.id=`local-translator-live-button`,r.className=`ytp-button`,r.type=`button`,r.title=`Bật Gemini Live Audio Translate`,r.setAttribute(`aria-label`,`Bật Gemini Live Translate`),r.setAttribute(`aria-pressed`,`false`),r.innerHTML=`
      <svg viewBox="0 0 24 24" width="22" height="22" style="display:block;margin:auto;fill:currentColor">
        <path d="M12 14c1.66 0 3-1.34 3-3V5c0-1.66-1.34-3-3-3S9 3.34 9 5v6c0 1.66 1.34 3 3 3z"/>
        <path d="M17 11c0 2.76-2.24 5-5 5s-5-2.24-5-5H5c0 3.53 2.61 6.43 6 6.92V21h2v-3.08c3.39-.49 6-3.39 6-6.92h-2z"/>
      </svg>
    `,r.addEventListener(`click`,t=>{t.preventDefault(),t.stopPropagation(),e.onLiveClick?.()}),t.append(r)),r&&(r.style.display=e.liveEnabled===!1?`none`:``),typeof e.getSubtitleActive==`function`&&A(e.getSubtitleActive());let i=t.querySelector(`#local-translator-dubbing-button`);if(e.segmentedDubbing!==!1){i||(i=document.createElement(`button`),i.id=`local-translator-dubbing-button`,i.className=`ytp-button`,i.type=`button`,i.textContent=`VI`,i.style.fontWeight=`bold`,i.addEventListener(`click`,t=>{t.preventDefault(),t.stopPropagation(),e.onDubbingClick?.()}),t.append(i)),i.style.display=``;let n=!!e.getDubbingActive?.();i.title=n?`Tắt dịch voice theo đoạn`:`Dịch voice theo đoạn (thử nghiệm)`,i.setAttribute(`aria-label`,i.title),i.setAttribute(`aria-pressed`,String(n)),i.style.color=n?`#34d399`:``}else i&&(i.style.display=`none`);typeof e.getLivePhase==`function`&&j(e.getLivePhase()),L(e.videoCallbacks);let a=document.querySelector(`#movie_player .ytp-fullscreen-button`);a&&!k.has(a)&&(k.add(a),a.addEventListener(`click`,e=>{let t=document.querySelector(`#movie_player`);t&&document.fullscreenEnabled&&(e.preventDefault(),e.stopImmediatePropagation(),document.fullscreenElement?document.exitFullscreen().catch(()=>{}):t.requestFullscreen({navigationUI:`hide`}).catch(()=>{}))},!0))}function de(e={}){if(typeof document>`u`||typeof location>`u`||!/(^|\.)youtube\.com$/.test(location.hostname))return;let t=()=>{R(e),L(e.videoCallbacks)};t(),new MutationObserver(t).observe(document.documentElement,{childList:!0,subtree:!0}),window.addEventListener(`yt-navigate-finish`,t)}function fe(){return typeof document>`u`?null:D||document.querySelector(`#movie_player video`)||document.querySelector(`video`)}var z={configure:ce,installButtons:R,observe:de,updateSubtitleButton:A,updateLiveButton:j,watchVideo:L,getVideo:fe};typeof globalThis<`u`&&(globalThis.LTYoutubeControls=z);function B(e){if(T.configure(e.subtitleLabel),z.configure(e.subtitleLabel),globalThis.__localTranslator)return;globalThis.__localTranslator=!0;let n=null,c=null,u=!1;function d(){c?.stop(),c=null}async function ee(){if(!e.segmentedPlayer)return;if(c){d();return}if(u)return;let t=z.getVideo(),n=Q()?.replace(/^(watch|shorts):/,``)||``;if(!t||!/^[A-Za-z0-9_-]{11}$/.test(n)){Z(`Dịch theo đoạn cần một video YouTube.`);return}if(document.querySelector(`#movie_player.ad-showing`)){Z(`Chờ quảng cáo kết thúc rồi bật dịch theo đoạn.`);return}u=!0;try{if(await X({type:`live-stop`}),$(),T.ensure(),T.setText(``,``),!e.segmentedPlayer)throw Error(`Chế độ này chưa có trong bản Gemini.`);let r=new e.segmentedPlayer(t,n,{request:async(e,t,n,r)=>{let i=crypto.randomUUID(),a=!1,o=setInterval(async()=>{if(!(r.aborted||a)){a=!0;try{let e=await X({type:`dubbing-status`,jobId:i});r.aborted||n(e)}catch{}finally{a=!1}}},2e3),s=()=>{clearInterval(o),X({type:`dubbing-cancel`,jobId:i}).catch(()=>{})};r.addEventListener(`abort`,s,{once:!0});try{return await X({type:`dubbing-segment`,videoId:e,index:t,jobId:i})}finally{clearInterval(o),r.removeEventListener(`abort`,s)}},currentVideoId:()=>(Q()||``).replace(/^(watch|shorts):/,``),caption:(e,t)=>T.setText(e,t),status:e=>{Z(e),T.setStatus(e)},stopped:e=>{c=null,e?(T.setText(``,e),Z(e)):T.remove()}});c=r,await r.start()}catch(e){d(),T.setText(``,e.message),Z(e.message)}finally{u=!1}}let te=null,f=[],p=[],m=new Map,h=0,g=!1,_=-1,v=-1,y=null,b=null,ne=0,re=0,ie=null,ae=new Set,x=null,S=!0,C=null,oe=async()=>{if(e.loadPublicSettings){let t=await e.loadPublicSettings();C=t,S=t.speechEnabled!==!1;let n=t.featureFlags||{};z.installButtons({subtitlesEnabled:n.enableSubtitles!==!1,liveEnabled:n.enableLive!==!1,segmentedDubbing:!!e.segmentedPlayer&&n.enableSegmentedDubbing!==!1&&t.provider!==`gemini`})}};oe().catch(()=>{});let se=null,w=null,E=[],ce=[],le=0,D=``,O=0,k=``,ue=!1,A=0,j=``,M=-1,N=!1,P=0,F=!1,I=!0,L=[],R=new Map,de=null,fe=null,B=!1,V=[],H=!1,U=0,W=0,pe=new WeakSet,G=[],me=new WeakMap,he=1,ge=0,_e=``,ve=!1,K=`idle`,q=null,J=null,ye=!1,be=`Extension vừa được tải lại hoặc cập nhật. Tải lại trang (F5) để tiếp tục.`,Y=e=>(me.has(e)||me.set(e,he++),me.get(e));function xe(e){try{return new URL(e,location.href).origin}catch{return`unknown`}}function Se(e){return{language:e.language,kind:e.kind,mode:e.mode,cues:e.cues?.length??null}}function Ce(e){let t=Array.from(document.querySelectorAll(`video`)).map(e=>({id:Y(e),selected:e===n,paused:e.paused,currentTime:e.currentTime,readyState:e.readyState,networkState:e.networkState,width:Math.round(e.getBoundingClientRect().width),sourceOrigin:xe(e.currentSrc),player:e.closest(`.video-js`)?`videojs`:`html5`,tracks:Array.from(e.textTracks||[]).map(Se),trackElements:Array.from(e.querySelectorAll(`track`)).map(e=>({language:e.srclang,kind:e.kind,readyState:e.readyState,sourceOrigin:xe(e.src)}))}));l(`diagnostics`,{reason:e,mode:n?B?`page+video`:`video`:B?`page`:`idle`,videos:t,iframeOrigins:Array.from(document.querySelectorAll(`iframe`)).map(e=>xe(e.src)),pageBlocks:document.querySelectorAll(`p,h1,h2,h3,h4,h5,h6,li,td,th,blockquote,figcaption`).length,pageQueue:V.length,pageBusy:H,pageTranslated:W,subtitleLines:f.length,subtitleUnits:p.length,subtitleTranslated:m.size,subtitleBusy:g,speech:{enabled:S,speaking:y?.key??null,pending:b?.key??null,retryInMs:Math.max(0,re-Date.now()),originalMuted:w!==null},openShadowRoots:Array.from(document.querySelectorAll(`*`)).filter(e=>e.shadowRoot&&e!==T.getHost()).length})}function we(){if(ve)return!1;let e=!1;try{e=!!chrome.runtime?.id}catch{}return e?!0:(ve=!0,l(`extension.orphaned`,{hint:be}),$(),Xe(),Z(be),!1)}async function X(e){if(!we())throw Error(be);let t=++ge,n=performance.now();l(`request.start`,{id:t,type:e.type,texts:e.texts?.length,characters:e.texts?.reduce((e,t)=>e+t.length,0)??e.text?.length});try{let r=await chrome.runtime.sendMessage(e);if(!r?.ok)throw Error(r?.error||`Extension đã tải lại; hãy tải lại trang.`);return l(`request.done`,{id:t,type:e.type,ms:Math.round(performance.now()-n),translations:r.data?.translations?.length}),r.data}catch(r){let i=!we();throw l(`request.failed`,{id:t,type:e.type,ms:Math.round(performance.now()-n),error:r.message},i?`info`:`error`),i?Error(be):r}}function Z(e){e!==_e&&(l(`status`,{message:e}),_e=e)}function Te(e){let t=q;q=null,e&&t?.isConnected&&t.paused&&!t.seeking&&J===Q()&&t.play().catch(()=>Z(`Không thể tự tiếp tục video sau khi bật Live.`))}function Q(){return location.pathname===`/watch`?new URL(location.href).searchParams.get(`v`):location.pathname.match(/^\/shorts\/([^/]+)/)?.[1]||null}function Ee(){J&&(J=null,ye=!1,Te(!1),K=`stopping`,T.remove(),X({type:`live-stop`}).catch(()=>{}))}window.addEventListener(`yt-navigate-finish`,()=>{J&&J!==Q()&&Ee()}),window.addEventListener(`popstate`,()=>{J&&J!==Q()&&Ee()});function De(t){if(K=t.phase,z.updateLiveButton(K),T.ensure(),T.setBadge(`live`,t.phase),t.phase===`connecting`)J=Q(),T.setText(``,``),T.setLoading();else if(t.phase===`active`)q?Te(!0):z.getVideo()?.paused&&(X({type:`live-pause`}).catch(()=>{}),K=`paused`,z.updateLiveButton(`paused`),T.setBadge(`live`,`paused`)),T.setLoading();else if(t.phase===`paused`)T.setText(``,``),T.setLoading();else if(t.phase===`reconnecting`){let e=z.getVideo();e&&!e.paused&&(q=e,e.pause()),T.setText(``,``),T.setLoading()}else t.phase===`transcript`?(T.setText(t.original||``,t.translation||``),T.setLoading()):t.phase===`stopping`?T.setLoading():t.phase===`stopped`?(Te(!0),J=null,T.setText(``,``),T.setLoading(),n||T.remove()):t.phase===`error`&&(Te(!0),J=null,T.setText(``,e.liveError?.(t.code)||e.connectionError),T.setLoading())}function Oe(){n&&w===null&&(se=n.volume,w=n.muted,n.muted=!0)}function ke(){n&&w!==null&&(n.volume=se,n.muted=w),se=null,w=null}function Ae(){if(b=null,clearTimeout(ie),y){let{id:e,key:t}=y,n=h;X({type:`speech-stop`,id:e}).then(e=>{n===h&&e?.at>.05&&(x={key:t,offset:e.at})}).catch(()=>{})}else e.loadPublicSettings&&X({type:`speech-stop`}).catch(()=>{});y=null}function $(){e.loadPublicSettings&&X({type:`requests-cancel`,scope:`video`}).catch(()=>{}),h++,N=!1,P++,clearInterval(te),Ae(),ke();for(let e of E)e();E=[];for(let[e,t]of ce)e.mode=t;ce=[],n=null,g=!1,ue=!1,le=0,re=0,A++,j=``,M=-1,x=null,f=[],p=[],m.clear(),ae.clear(),F=!1,I=!0,L.length=0,R.clear(),z.updateSubtitleButton(!1),T.setBadge(void 0)}async function je(e,t){let n=Array.from(e.textTracks||[]);l(`subtitles.tracks`,{videoId:Y(e),tracks:n.map(Se)});let i=n.find(e=>/^(en)(-|$)/i.test(e.language)&&[`subtitles`,`captions`].includes(e.kind))||n.find(e=>!e.language&&[`subtitles`,`captions`].includes(e.kind));if(!i)return l(`subtitles.no-native-english-track`,{videoId:Y(e)}),[];ce.push([i,i.mode]),i.mode===`disabled`&&(i.mode=`hidden`);for(let e=0;e<12&&!i.cues?.length&&t===h;e++)await new Promise(e=>setTimeout(e,100));return t===h?(l(`subtitles.track-loaded`,{videoId:Y(e),...Se(i)}),r(Array.from(i.cues||[]).map(e=>({start:e.startTime,end:e.endTime,text:e.text})))):[]}async function Me(e,t){await oe(),l(`mode.video.start`,{videoId:e,importedCues:t?.length||0}),K=`idle`;let i=Array.from(document.querySelectorAll(`video`)).find(t=>Y(t)===e);if(!i)throw Error(`Không tìm thấy video. Hãy bật video rồi quét lại.`);let o=!i.paused;o&&i.pause(),$(),T.ensure(),n=i,Oe(),z.updateSubtitleButton(!0),T.setBadge(`offline`),Ce(`video-start`);let c=h;_=-1,v=-1,x=null,D=k=``,T.setText(``,``),Z(`Đang tìm phụ đề tiếng Anh…`);let u=!1;for(let e of[`pause`,`seeking`,`ended`]){let t=()=>{l(`video.`+e,{currentTime:i.currentTime,playbackRate:i.playbackRate}),Ae(),M=-1,e!==`pause`&&(_=-1,v=-1,x=null),e===`seeking`&&(u=!i.paused,u&&i.pause(),T.setLoading(),A++,D=k=j=``,T.setText(``,``))};n.addEventListener(e,t),E.push(()=>i.removeEventListener(e,t))}let d=()=>{p.length?ze(u):T.setLoading(),u=!1};i.addEventListener(`seeked`,d),E.push(()=>i.removeEventListener(`seeked`,d));let ee=()=>l(`video.ratechange`,{currentTime:i.currentTime,playbackRate:i.playbackRate});i.addEventListener(`ratechange`,ee),E.push(()=>i.removeEventListener(`ratechange`,ee));let m=()=>{$(),Z(`Video đã thay đổi. Bấm nút dịch trong thanh điều khiển để dịch lại.`)};i.addEventListener(`emptied`,m),E.push(()=>i.removeEventListener(`emptied`,m));let g=!t&&/(^|\.)youtube\.com$/.test(location.hostname)?X({type:`youtube`}).catch(e=>(l(`subtitles.youtube-failed`,{error:e.message}),null)):null,y=t||await je(i,c);if(c!==h)return;if(!y.length&&i.closest(`.video-js`))try{let e=await X({type:`videojs`,index:Array.from(document.querySelectorAll(`video`)).indexOf(i),elementId:i.id});if(c!==h)return;l(`subtitles.videojs`,{reason:e?.reason,tracks:e?.tracks||[],count:e?.cues?.length||0}),e?.cues?.length&&(y=r(e.cues))}catch(e){c===h&&l(`subtitles.videojs-failed`,{error:e.message})}if(c!==h)return;if(!y.length&&g){let e=await g;e?.caption&&(y=a(e.caption),F=!!e.autoGenerated)}if(c!==h)return;f=y,p=s(f);let b=i.closest(`.video-js`)?`videojs-visible-cc`:/(^|\.)youtube\.com$/.test(location.hostname)?`youtube-visible-cc`:`import-srt-vtt`;l(`subtitles.ready`,{count:f.length,sentences:p.length,autoGenerated:F,fallback:p.length?null:b}),Z(p.length?`Đã lấy ${f.length} dòng phụ đề, gộp thành ${p.length} câu. Đang chuẩn bị bản dịch…`:b===`videojs-visible-cc`?`Đang đọc CC của Video.js. Bật phụ đề English trong video.`:`Chưa có file phụ đề. Trên YouTube hãy bật CC tiếng Anh, hoặc mở SRT/VTT.`),te=setInterval(Ye,250),p.length?await ze(o):(T.setLoading(),T.setText(``,`Bật CC tiếng Anh trong video YouTube để dịch.`),Ye())}function Ne(){let e=0,t=p.length;for(;e<t;){let r=e+t>>1;p[r].end<=n.currentTime?e=r+1:t=r}return e}async function Pe(t,n=8){if(g||Date.now()<le)return!1;let r=[];for(let e=t;e<Math.min(t+n,p.length);e++)m.has(e)||r.push(e);if(!r.length)return!0;g=!0;let i=h;try{let t=await X({type:`translate`,texts:r.map(e=>p[e].text.slice(0,6e3))});return i===h&&(r.forEach((e,n)=>m.set(e,t.translations[n])),Z(`Phụ đề ${e.label} · ${p.length} câu (${f.length} dòng) · ${m.size} câu đã dịch`),!0)}catch(e){return i===h&&(le=Date.now()+5e3,Z(e.message)),!1}finally{i===h&&(g=!1)}}let Fe=e=>new Promise(t=>setTimeout(t,e));function Ie(e){let t=o(L,e);return t>=0?{index:t,unit:L[t]}:null}async function Le(e){if(!F||!I||!f.length)return[];let t=Math.max(0,e-4),n=Math.min(f.length,t+48),r=`${t}:${n}`;if(R.has(r))return R.get(r);let i=h,a=X({type:`caption-polish`,cues:f.slice(t,n).map(e=>e.text),windowKey:r}).then(e=>{if(i!==h||!e?.available||!Array.isArray(e.sentences))return e&&!e.available&&(I=!1),[];let r=e.sentences.map(e=>({start:f[t+e.start]?.start,end:f[t+e.end-1]?.end,text:e.original,translation:e.translation,cueEnd:t+e.end})).filter(e=>Number.isFinite(e.start)&&Number.isFinite(e.end)&&e.end>e.start&&typeof e.text==`string`&&typeof e.translation==`string`);return L.push(...r),L.sort((e,t)=>e.start-t.start||e.end-t.end),l(`subtitles.gemini-window`,{startCue:t,endCue:n,sentences:r.length}),r}).catch(e=>(l(`subtitles.gemini-failed`,{startCue:t,error:e.message}),[]));return R.set(r,a),a}function Re(){if(!F||!I||!n)return;let e=Ie(n.currentTime);e&&o(f,n.currentTime)>=e.unit.cueEnd-8&&Le(e.unit.cueEnd-4).catch(()=>{})}async function ze(e){if(!n||!p.length)return;let t=++P,r=h;N=!0,T.setLoading();let i=o(p,n.currentTime),a=i>=0?i:Ne(),s=o(f,n.currentTime);for(F&&s>=0&&await Promise.race([Le(s),Fe(8e3)]);g&&r===h&&t===P;)await new Promise(e=>setTimeout(e,50));let c=Ie(n.currentTime),u=c?!0:await Pe(a,3);if(r!==h||t!==P)return;let d=[];if(c)d.push(c.unit.translation.slice(0,1500));else for(let e=a;e<Math.min(a+3,p.length);e++){let t=m.get(e);t&&d.push(t.slice(0,1500))}if(u&&d.length&&S)try{await X({type:`speech-warm`,texts:d})}catch(e){l(`speech.warm-failed`,{error:e.message})}r===h&&t===P&&(N=!1,T.setLoading(),We(a),Re(),l(`subtitles.buffered`,{start:a,count:d.length,resume:e}),e&&n.paused&&!n.seeking&&n.play().catch(e=>l(`video.resume-failed`,{error:e.message})),Ye())}let Be=e.voiceName;function Ve(e){l(`speech.failed`,{error:e.message},`error`),``+e.message,ke()}function He(e,t){clearTimeout(ie),ie=setTimeout(()=>Ue(e,`timeout`),(t+3)*1e3)}function Ue(e,t,r){if(!y||y.id!==e)return;clearTimeout(ie);let{key:i,test:a}=y;y=null,l(`speech.`+t,{cue:i,currentTime:n?.currentTime,...r?{error:r}:{}}),t===`error`&&Ve(Error(r||`Lỗi phát audio giọng đọc.`)),Ke()}function We(e){let t=[];for(let n=e;n<Math.min(e+4,p.length)&&m.has(n);n++){let e=m.get(n).slice(0,1500);ae.has(e)||(ae.add(e),t.push(e))}t.length&&X({type:`speech-prefetch`,texts:t}).catch(e=>l(`speech.prefetch-failed`,{error:e.message}))}function Ge(e,t,n,r=0){b&&l(`speech.skipped`,{reason:`superseded`,cue:b.key}),b={key:e,text:t,end:n,startAt:r},Ke()}async function Ke(){if(y||!b||!S||Date.now()<re||!n||n.paused||n.seeking)return;let e=b;b=null;let t=n.currentTime-e.end;if(t>1.5){l(`speech.skipped`,{reason:`cue-expired`,cue:e.key,late:Math.round(t*10)/10});return}let r=++ne,i=h,a=Math.max(.25,n.playbackRate||1);y={id:r,key:e.key};try{let t=Math.max(1.2,(e.end-n.currentTime)/a),o=Math.round(Math.min(1500,Math.max(400,t*300))),s=await X({type:`speech-play`,id:r,text:e.text.slice(0,1500),available:t,wait:o,startAt:e.startAt});if(i!==h||y?.id!==r){s?.ok&&X({type:`speech-stop`,id:r}).catch(()=>{});return}if(!s?.ok){y=null;return}Oe(),He(r,s.duration/s.rate),s.fallback||``+Be(s.engine),l(`speech.playing`,{cue:e.key,sample:!1,duration:s.duration,rate:s.rate,engine:s.engine,fallback:s.fallback,resumeFrom:e.startAt,currentTime:n.currentTime})}catch(e){if(i!==h||y?.id!==r)return;y=null,re=Date.now()+3e3,Ve(e)}}function qe(){let e=n?.closest(`.video-js`),r=e||n?.closest(`.html5-video-player`);return r?{text:t(Array.from(r.querySelectorAll(e?`.vjs-text-track-display .vjs-text-track-cue`:`.ytp-caption-segment`)).filter(e=>{let t=e.getAttribute(`lang`)||``;if(t&&!/^en(?:[-_]|$)/i.test(t))return!1;let n=getComputedStyle(e);return n.display!==`none`&&n.visibility!==`hidden`&&n.opacity!==`0`&&e.getClientRects().length>0}).map(e=>e.textContent).join(` `)),source:e?`videojs-visible-cc`:`youtube-visible-cc`}:{text:``,source:`none`}}async function Je(){let{text:e,source:t}=qe();if(e!==D&&(b?.key===`live`&&(b=null),x?.key===`live`&&(x=null),A++,D=e,O=Date.now(),k=j=``,M=-1,T.setText(e,``),l(`subtitles.visible-change`,{source:t,characters:e.length})),!e||n.seeking)return;if(e===k){if(j&&S&&!n.paused&&M!==A){M=A;let e=x?.key===`live`?x.offset:0;x=null,Ge(`live`,j,n.currentTime+8,e)}return}if(ue||Date.now()<le||Date.now()-O<500)return;ue=!0;let r=h,i=A;try{let a=await X({type:`translate`,texts:[e.slice(0,6e3)]});if(r!==h||i!==A||e!==qe().text)return;k=e,j=a.translations[0],T.setText(e,j),Z(`Đang dịch CC ${t===`videojs-visible-cc`?`Video.js`:`YouTube`} hiển thị · có độ trễ`),l(`subtitles.visible-translated`,{source:t,characters:j.length,paused:n.paused})}catch(e){r===h&&(le=Date.now()+5e3,Z(e.message))}finally{r===h&&(ue=!1)}}function Ye(){if(!we())return;if(!n?.isConnected){$();return}if(N)return;if(Ke(),!p.length){Je();return}let e=Ie(n.currentTime);if(e){let{unit:t}=e,r=`gemini:${t.start}:${t.end}`;if(v!==r&&(v=r,T.setText(t.text,t.translation)),S&&!n.paused&&!n.seeking&&_!==r&&(x=null,_=r,Ge(r,t.translation,t.end)),S){let e=t.translation.slice(0,1500);ae.has(e)||(ae.add(e),X({type:`speech-prefetch`,texts:[e]}).catch(e=>l(`speech.prefetch-failed`,{error:e.message})))}Re();return}let t=Ne();Pe(t);let r=o(p,n.currentTime);if(r!==v&&(v=r,T.setText(r>=0?p[r].text:``,``)),r>=0&&m.has(r)){let e=m.get(r);if(T.setText(void 0,e),S&&!n.paused&&!n.seeking){if(_!==r)x=null,_=r,Ge(r,e,p[r].end);else if(x?.key===r){let{offset:t}=x;x=null,Ge(r,e,p[r].end,t)}}}S&&We(r>=0?r:t)}function Xe(){e.loadPublicSettings&&X({type:`requests-cancel`,scope:`page`}).catch(()=>{}),B=!1,U++,H=!1,de?.disconnect(),fe?.disconnect(),V=[],G.forEach(e=>e.remove()),G=[],pe=new WeakSet,W=0}let Ze=`p,h1,h2,h3,h4,h5,h6,li,td,th,blockquote,figcaption`;function Qe(){let e=document.querySelectorAll(Ze),t=0;for(let n of e){if(pe.has(n)||n.querySelector(Ze)||n.closest(`[contenteditable],pre,code,nav,script,style,textarea,[data-local-translation]`))continue;let e=n.textContent?.trim()||``;e.length<4||e.length>6e3||!/[a-zA-Z]/.test(e)||(pe.add(n),de?.observe(n),t++)}(t||!e.length)&&l(`page.scan`,{candidates:e.length,newlyObserved:t,queue:V.length})}async function $e(){if(H||!B||!V.length)return;H=!0;let e=U,t=V.splice(0,3).filter(e=>e.isConnected),n=t.map(e=>e.textContent?.trim()||``);l(`page.batch`,{blocks:t.length,characters:n.reduce((e,t)=>e+t.length,0),remaining:V.length});try{if(!t.length)return;let r=await X({type:`translate`,texts:n,scope:`page`});if(e!==U)return;t.forEach((e,t)=>{if(!e.isConnected||e.textContent?.trim()!==n[t])return;let i=document.createElement(`span`);i.dataset.localTranslation=`true`,i.lang=`vi`,i.textContent=r.translations[t],i.style.cssText=`display:block;color:#16816b;border-left:3px solid #48b59c;padding:4px 10px;margin:6px 0;font-size:0.95em;line-height:1.6;`,e.append(i),G.push(i),W++}),Z(`Đã dịch ${W} đoạn · cuộn trang để dịch tiếp`)}catch(t){e===U&&(Z(t.message),B=!1)}finally{e===U&&(H=!1,B&&setTimeout($e,50))}}function et(){Xe(),T.ensure(),B=!0,l(`mode.page.start`,{hint:`Dịch trang; để dịch video hãy chọn Dịch & đọc video trong popup.`}),Ce(`page-start`),Z(`Đang dịch nội dung trong vùng nhìn thấy…`),de=new IntersectionObserver(e=>{l(`page.visibility`,{observed:e.length,visible:e.filter(e=>e.isIntersecting).length});for(let t of e)t.isIntersecting&&(de?.unobserve(t.target),V.push(t.target));$e()},{rootMargin:`200px`}),Qe();let t=U;setTimeout(()=>{t===U&&B&&!W&&(Ce(`page-no-result-after-5s`),l(`page.waiting`,{queue:V.length,busy:H,hint:H?`Đang chờ phản hồi bộ dịch `+e.label+`.`:`Chưa có đoạn văn bản hiển thị để dịch trong frame này. Video cần chế độ Dịch & đọc video.`}))},5e3);let n;fe=new MutationObserver(()=>{clearTimeout(n),n=setTimeout(()=>{B&&Qe()},500)}),fe.observe(document.body,{childList:!0,subtree:!0})}chrome.runtime.onMessage.addListener((t,r,i)=>{if(t.type===`speech-event`){Ue(t.id,t.event,t.error);return}if(t.type===`live-ui`){t.phase===`connecting`&&d(),De(t),i({shown:!0});return}if(t.type===`live-hold`){let e=z.getVideo();e&&!e.paused?(q=e,e.pause(),i({held:!0})):i({held:!1});return}if(l(`command.received`,{type:t.type,videoId:t.videoId}),t.type===`inspect`){Ce(`scan`),i({title:document.title,url:location.href,videos:Array.from(document.querySelectorAll(`video`)).map(e=>({id:Y(e),playing:!e.paused,width:Math.round(e.getBoundingClientRect().width),duration:Number.isFinite(e.duration)?Math.round(e.duration):null,tracks:e.textTracks?.length||0}))});return}if(t.type===`start-video`)return d(),Me(t.videoId).then(()=>i({started:!0})).catch(e=>i({error:e.message})),!0;if(t.type===`start-page`){et(),i({started:!0});return}if(t.type===`stop-page`){Xe(),n||T.remove(),i({stopped:!0});return}if(t.type===`stop-video`){$(),B||T.remove(),i({stopped:!0});return}if(t.type===`stop`){d(),$(),Xe(),T.remove(),i({stopped:!0});return}if(t.type===`get-mode`){i({mode:n?`offline`:c?`dubbing`:[`connecting`,`active`,`transcript`,`paused`].includes(K)?`live`:`idle`,livePhase:K});return}if(t.type===`toggle-mode`){let e=t.mode;return(async()=>{if(e===`offline`){if(d(),n)$(),T.remove();else{await X({type:`live-stop`}).catch(()=>{});let e=z.getVideo();if(!e)throw Error(`Chưa tìm thấy video trên trang.`);await Me(Y(e))}}else e===`live`&&(d(),n&&($(),T.remove()),await X({type:`live-toggle`}))})().then(()=>i({ok:!0})).catch(e=>i({ok:!1,error:e.message})),!0}if(t.type===`save-and-reload`)return(async()=>{if(await oe(),e.loadPublicSettings){Ae(),n&&$();return}let t=z.getVideo()||document.querySelector(`video`);t&&!t.paused&&t.pause(),Ae(),[`connecting`,`active`,`transcript`,`paused`,`reconnecting`].includes(K)&&(await X({type:`live-stop`}).catch(()=>{}),setTimeout(async()=>{await X({type:`live-toggle`}).catch(e=>Z(e.message))},300))})().then(()=>i({ok:!0})).catch(e=>i({ok:!1,error:e.message})),!0}),z.observe({segmentedDubbing:!!e.segmentedPlayer&&C?.featureFlags?.enableSegmentedDubbing!==!1&&C?.provider!==`gemini`,subtitlesEnabled:C?.featureFlags?.enableSubtitles!==!1,liveEnabled:C?.featureFlags?.enableLive!==!1,getDubbingActive:()=>c!==null,onDubbingClick:()=>{ee()},getSubtitleActive:()=>n!==null,getLivePhase:()=>K,onSubtitleClick:async()=>{d();let e=z.getVideo();if(!e){Z(`Chưa tìm thấy video YouTube.`);return}if(await X({type:`live-stop`}).catch(()=>{}),n===e){$(),T.remove();return}Me(Y(e)).catch(e=>Z(e.message))},onLiveClick:async()=>{d(),n&&($(),T.remove()),await X({type:`live-toggle`}).catch(e=>Z(e.message))},videoCallbacks:{onPause:()=>{q!==z.getVideo()&&[`connecting`,`active`,`transcript`,`reconnecting`].includes(K)&&(X({type:`live-pause`}).catch(()=>{}),K=`paused`,z.updateLiveButton(`paused`),T.setBadge(`live`,`paused`),T.setLoading())},onPlay:()=>{if(q===z.getVideo()&&(q=null),J&&[`connecting`,`reconnecting`].includes(K)){let e=z.getVideo();e&&(q=e,e.pause());return}if(K===`paused`){let e=z.getVideo();e&&(q=e,e.pause()),X({type:`live-resume`}).catch(()=>{}),K=`reconnecting`,z.updateLiveButton(`reconnecting`),T.setBadge(`live`,`reconnecting`),T.setLoading()}},onSeeking:()=>{if(J&&![`stopped`,`stopping`,`error`].includes(K)){ye=!0;let e=z.getVideo();e&&!e.paused&&(q=e,e.pause()),T.setText(``,``),X({type:`live-seek`,complete:!1}).catch(()=>{})}},onSeeked:()=>{ye&&J&&(ye=!1,X({type:`live-seek`,complete:!0,paused:!q&&!!z.getVideo()?.paused}).catch(()=>{}))},onVideoChanged:e=>{J&&(!e||J!==Q())&&Ee()},onEnded:()=>{Ee()}}}),T.setOnLiveToggle(async()=>{d(),n&&$(),await X({type:`live-toggle`}).catch(e=>Z(e.message))}),T.setOnImport(e=>{(async()=>{if(e.size>5242880)throw Error(`File phụ đề tối đa 5 MB.`);let t=i(await e.text());if(!t.length)throw Error(`File không có phụ đề SRT/VTT hợp lệ.`);let r=n||z.getVideo();if(!r)throw Error(`Chưa tìm thấy video để dùng phụ đề.`);d(),await X({type:`live-stop`}).catch(()=>{}),await Me(Y(r),t)})().catch(e=>{Z(e.message),T.setText(``,e.message)})}),l(`content.ready`,{version:chrome.runtime?.getManifest?.()?.version,videos:document.querySelectorAll(`video`).length,iframes:document.querySelectorAll(`iframe`).length})}function V(e){return{UnsupportedTab:`Chế độ Live chỉ hỗ trợ trên YouTube.`,MissingApiKey:`Nhập Gemini API key trong cài đặt extension.`,AuthenticationError:`API key không hợp lệ hoặc chưa có quyền truy cập model Live.`,QuotaExceeded:`Gemini đã hết hạn mức. Chờ rồi bật lại Live.`,LiveConfigurationError:`Gemini từ chối cấu hình hoặc model Live đang chọn. Chọn lại model và kiểm tra kết nối.`,LiveReadyTimeout:`Gemini Live chưa xác nhận kết nối sau 35 giây. Kiểm tra kết nối rồi bật lại Live.`,ServiceUnavailable:`Dịch vụ Gemini Live đang gặp lỗi. Chờ rồi bật lại Live.`,CapturePermissionDenied:`Chrome chưa cho phép capture âm thanh tab. Mở YouTube và bật Live từ extension.`,CaptureEnded:`Chrome đã dừng capture âm thanh tab. Bật lại Live trên tab YouTube.`,LiveAudioError:`Không khởi tạo được capture hoặc phát audio trong Chrome. Reload extension và tab YouTube rồi bật lại Live.`,InvalidServerMessage:`Gemini Live trả về dữ liệu hoặc định dạng audio không hợp lệ.`,InputBackpressure:`Audio gửi tới Gemini bị nghẽn. Dừng rồi bật lại Live.`,OutputBackpressure:`Giọng Gemini trả về bị dồn quá nhiều. Dừng rồi bật lại Live.`,GeminiDisconnected:`Kết nối WebSocket tới Gemini Live bị ngắt sau nhiều lần thử lại. Kiểm tra mạng rồi bật lại Live.`}[e||``]||`Không bật được Gemini Live. Reload extension và kiểm tra lại cấu hình.`}var H=e({matches:[`http://*/*`,`https://*/*`],allFrames:!0,matchAboutBlank:!0,runAt:`document_idle`,main(){B({label:`Gemini`,subtitleLabel:`Gemini`,voiceName:()=>`Gemini TTS`,connectionError:`Mất kết nối Gemini. Kiểm tra mạng và API key rồi bật lại Live.`,liveError:V,loadPublicSettings:async()=>{let e=await chrome.runtime.sendMessage({type:`settings-public`});if(!e?.ok)throw Error(e?.error||`Không đọc được cài đặt Gemini.`);return e.data}})}}),U={debug:(...e)=>([...e],void 0),log:(...e)=>([...e],void 0),warn:(...e)=>([...e],void 0),error:(...e)=>([...e],void 0)},W=globalThis.browser?.runtime?.id?globalThis.browser:globalThis.chrome,pe=class e extends Event{static EVENT_NAME=G(`wxt:locationchange`);constructor(t,n){super(e.EVENT_NAME,{}),this.newUrl=t,this.oldUrl=n}};function G(e){return`${W?.runtime?.id}:content:${e}`}var me=typeof globalThis.navigation?.addEventListener==`function`;function he(e){let t,n=!1;return{run(){n||(n=!0,t=new URL(location.href),me?globalThis.navigation.addEventListener(`navigate`,e=>{let n=new URL(e.destination.url);n.href!==t.href&&(window.dispatchEvent(new pe(n,t)),t=n)},{signal:e.signal}):e.setInterval(()=>{let e=new URL(location.href);e.href!==t.href&&(window.dispatchEvent(new pe(e,t)),t=e)},1e3))}}}var ge=class e{static SCRIPT_STARTED_MESSAGE_TYPE=G(`wxt:content-script-started`);id;abortController;locationWatcher=he(this);constructor(e,t){this.contentScriptName=e,this.options=t,this.id=Math.random().toString(36).slice(2),this.abortController=new AbortController,this.stopOldScripts(),this.listenForNewerScripts()}get signal(){return this.abortController.signal}abort(e){return this.abortController.abort(e)}get isInvalid(){return W.runtime?.id??this.notifyInvalidated(),this.signal.aborted}get isValid(){return!this.isInvalid}onInvalidated(e){return this.signal.addEventListener(`abort`,e),()=>this.signal.removeEventListener(`abort`,e)}block(){return new Promise(()=>{})}setInterval(e,t){let n=setInterval(()=>{this.isValid&&e()},t);return this.onInvalidated(()=>clearInterval(n)),n}setTimeout(e,t){let n=setTimeout(()=>{this.isValid&&e()},t);return this.onInvalidated(()=>clearTimeout(n)),n}requestAnimationFrame(e){let t=requestAnimationFrame((...t)=>{this.isValid&&e(...t)});return this.onInvalidated(()=>cancelAnimationFrame(t)),t}requestIdleCallback(e,t){let n=requestIdleCallback((...t)=>{this.signal.aborted||e(...t)},t);return this.onInvalidated(()=>cancelIdleCallback(n)),n}addEventListener(e,t,n,r){t===`wxt:locationchange`&&this.isValid&&this.locationWatcher.run(),e.addEventListener?.(t.startsWith(`wxt:`)?G(t):t,n,{...r,signal:this.signal})}notifyInvalidated(){this.abort(`Content script context invalidated`),U.debug(`Content script "${this.contentScriptName}" context invalidated`)}stopOldScripts(){document.dispatchEvent(new CustomEvent(e.SCRIPT_STARTED_MESSAGE_TYPE,{detail:{contentScriptName:this.contentScriptName,messageId:this.id}})),this.options?.noScriptStartedPostMessage||window.postMessage({type:e.SCRIPT_STARTED_MESSAGE_TYPE,contentScriptName:this.contentScriptName,messageId:this.id},`*`)}verifyScriptStartedEvent(e){let t=e.detail?.contentScriptName===this.contentScriptName,n=e.detail?.messageId===this.id;return t&&!n}listenForNewerScripts(){let t=e=>{e instanceof CustomEvent&&this.verifyScriptStartedEvent(e)&&this.notifyInvalidated()};document.addEventListener(e.SCRIPT_STARTED_MESSAGE_TYPE,t),this.onInvalidated(()=>document.removeEventListener(e.SCRIPT_STARTED_MESSAGE_TYPE,t))}},_e={debug:(...e)=>([...e],void 0),log:(...e)=>([...e],void 0),warn:(...e)=>([...e],void 0),error:(...e)=>([...e],void 0)};return(async()=>{try{let{main:e,...t}=H;return await e(new ge(`content`,t))}catch(e){throw _e.error(`The content script "content" crashed on startup!`,e),e}})()})();
content;