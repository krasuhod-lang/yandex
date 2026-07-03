// Custom Chart renderer used by the CJM & Finance dashboard.
// Extracted from the retired dashboard-app.js — this file exposes the global
// `Chart` class (plus a few helper functions) and nothing else, so it can be
// loaded standalone by cjm-unit-dashboard.js.
const MIN_CANVAS_WIDTH=320, DEFAULT_CANVAS_WIDTH=640, DEFAULT_CANVAS_HEIGHT=160;
const HTML_ESCAPE_MAP={'&':'&amp;','<':'&lt;','>':'&gt;','\"':'&quot;',"'":'&#39;'};
const ALLOWED_METRIC_CLASSES=new Set(['positive','negative','accent']);
function niceNum(range,round){const exp=Math.floor(Math.log10(range)),frac=range/Math.pow(10,exp);let nf;if(round){nf=frac<1.5?1:frac<3?2:frac<7?5:10}else{nf=frac<=1?1:frac<=2?2:frac<=5?5:10}return nf*Math.pow(10,exp)}
function niceTicks(min,max,count){const range=niceNum(Math.max(max-min,1),false),step=niceNum(range/Math.max(count-1,1),true),niceMin=Math.floor(min/step)*step,niceMax=Math.ceil(max/step)*step,ticks=[];for(let v=niceMin;v<=niceMax+step*.5;v+=step)ticks.push(Number(v.toFixed(10)));return {ticks,min:niceMin,max:niceMax}}
function shortNum(v){const a=Math.abs(v);if(a>=1e9)return (v/1e9).toLocaleString('ru-RU',{maximumFractionDigits:1})+' млрд';if(a>=1e6)return (v/1e6).toLocaleString('ru-RU',{maximumFractionDigits:1})+' млн';if(a>=1e3)return (v/1e3).toLocaleString('ru-RU',{maximumFractionDigits:1})+' тыс';return Number(v).toLocaleString('ru-RU',{maximumFractionDigits:1})}
function hexToRgba(hex,a){let c=String(hex||'').trim();if(/^#[0-9a-f]{8}$/i.test(c)){const r=parseInt(c.slice(1,3),16),g=parseInt(c.slice(3,5),16),b=parseInt(c.slice(5,7),16),aa=parseInt(c.slice(7,9),16)/255;return `rgba(${r},${g},${b},${(aa*a).toFixed(3)})`}if(/^#[0-9a-f]{6}$/i.test(c)){const r=parseInt(c.slice(1,3),16),g=parseInt(c.slice(3,5),16),b=parseInt(c.slice(5,7),16);return `rgba(${r},${g},${b},${a})`}if(/^#[0-9a-f]{3}$/i.test(c)){const r=parseInt(c[1]+c[1],16),g=parseInt(c[2]+c[2],16),b=parseInt(c[3]+c[3],16);return `rgba(${r},${g},${b},${a})`}return c}
function stripAlpha(c){const s=String(c||'');return /^#[0-9a-f]{8}$/i.test(s)?s.slice(0,7):s}
function roundedRect(ctx,x,y,w,h,r){r=Math.max(0,Math.min(r,Math.abs(w)/2,Math.abs(h)/2));ctx.beginPath();ctx.moveTo(x+r,y);ctx.lineTo(x+w-r,y);ctx.quadraticCurveTo(x+w,y,x+w,y+r);ctx.lineTo(x+w,y+h-r);ctx.quadraticCurveTo(x+w,y+h,x+w-r,y+h);ctx.lineTo(x+r,y+h);ctx.quadraticCurveTo(x,y+h,x,y+h-r);ctx.lineTo(x,y+r);ctx.quadraticCurveTo(x,y,x+r,y);ctx.closePath()}
class Chart{
 constructor(canvas,config){
  this.canvas=canvas;this.config=config;
  if(!canvas){console.warn('Chart canvas is missing');return}
  this.ctx=canvas.getContext('2d');
  this.progress=0;this.hoverIndex=-1;this.layout=null;this._raf=0;
  this._lastW=0;this._lastH=0;
  this._ensureTooltip();
  this._onMove=this._onMove.bind(this);
  this._onLeave=this._onLeave.bind(this);
  canvas.addEventListener('mousemove',this._onMove);
  canvas.addEventListener('mouseleave',this._onLeave);
  this._observeResize();
  this._animate();
 }
 _ensureTooltip(){
  const parent=this.canvas.parentElement;
  if(!parent)return;
  if(getComputedStyle(parent).position==='static')parent.style.position='relative';
  let tt=parent.querySelector(':scope > .chart-tooltip');
  if(!tt){tt=document.createElement('div');tt.className='chart-tooltip';parent.appendChild(tt)}
  this.tooltip=tt;
 }
 // Наблюдаем за изменениями размера родителя canvas: если график был построен
 // при скрытом (или узком) контейнере — например, при загрузке страницы с
 // шаринг-ссылкой на финмодель — то после активации вкладки размер меняется и
 // мы должны перерисовать график с новой шириной/высотой. Без этого чарты
 // остаются пустыми/минимального размера.
 _observeResize(){
  if(typeof ResizeObserver==='undefined')return;
  const parent=this.canvas.parentElement;if(!parent)return;
  // Дебаунсим редрав, чтобы серия быстрых ресайзов (например, при
  // раскрытии вкладки или ресайзе окна) не приводила к десяткам draw() подряд.
  let scheduled=0;
  this._ro=new ResizeObserver(()=>{
   if(!this.ctx||!this.canvas)return;
   const rect=this.canvas.getBoundingClientRect();
   const w=Math.round(rect.width),h=Math.round(rect.height);
   if(w===this._lastW&&h===this._lastH)return;
   if(scheduled)clearTimeout(scheduled);
   scheduled=setTimeout(()=>{
    scheduled=0;
    if(!this.ctx||!this.canvas)return;
    this.progress=1;
    this.draw();
   },80);
  });
  try{this._ro.observe(parent);}catch(e){}
 }
 destroy(){
  if(this._raf)cancelAnimationFrame(this._raf);
  if(this._ro){try{this._ro.disconnect();}catch(e){}this._ro=null;}
  if(this.canvas){
   this.canvas.removeEventListener('mousemove',this._onMove);
   this.canvas.removeEventListener('mouseleave',this._onLeave);
  }
  if(this.tooltip)this.tooltip.classList.remove('show');
  if(this.ctx)this.ctx.clearRect(0,0,this.canvas.width,this.canvas.height);
 }
 _animate(){
  const start=performance.now(),dur=650;
  const tick=(t)=>{
   const p=Math.min(1,(t-start)/dur);
   this.progress=1-Math.pow(1-p,3);
   this.draw();
   if(p<1)this._raf=requestAnimationFrame(tick);else this._raf=0;
  };
  this._raf=requestAnimationFrame(tick);
 }
 _onMove(ev){
  if(!this.layout)return;
  const rect=this.canvas.getBoundingClientRect();
  const x=ev.clientX-rect.left,y=ev.clientY-rect.top;
  const L=this.layout;
  if(x<L.pad.l-4||x>L.pad.l+L.plotW+4||y<L.pad.t-4||y>L.pad.t+L.plotH+8){
   if(this.hoverIndex!==-1){this.hoverIndex=-1;this.draw()}
   return;
  }
  const n=L.labels.length;if(!n)return;
  const rel=(x-L.pad.l)/Math.max(L.plotW,1);
  const idx=Math.max(0,Math.min(n-1,Math.round(rel*(n-1))));
  if(idx!==this.hoverIndex){this.hoverIndex=idx;this.draw()}
 }
 _onLeave(){if(this.hoverIndex!==-1){this.hoverIndex=-1;this.draw()}}
 draw(){
  if(!this.ctx||!this.canvas)return;
  const ctx=this.ctx, cfg=this.config, dpr=window.devicePixelRatio||1;
  const rect=this.canvas.getBoundingClientRect();
  const parent=this.canvas.parentElement;
  const width=Math.max(MIN_CANVAS_WIDTH,rect.width||(parent&&parent.clientWidth)||DEFAULT_CANVAS_WIDTH);
  const height=Math.max(140,rect.height||(parent&&parent.clientHeight)||DEFAULT_CANVAS_HEIGHT);
  this.canvas.width=width*dpr;this.canvas.height=height*dpr;this.canvas.style.width=width+'px';this.canvas.style.height=height+'px';
  this._lastW=width;this._lastH=height;
  ctx.setTransform(dpr,0,0,dpr,0,0);ctx.clearRect(0,0,width,height);
  const colors=chartColors();
  const datasets=cfg.data.datasets||[], labels=cfg.data.labels||[];
  const values=datasets.flatMap(ds=>(ds.data||[]).map(Number)).filter(Number.isFinite);
  const rawMin=Math.min(0,...values), rawMax=Math.max(1,...values);
  const {ticks,min,max}=niceTicks(rawMin,rawMax,5);
  ctx.font='12px '+chartFont();
  const yLabelW=Math.max(...ticks.map(t=>ctx.measureText(shortNum(t)).width),28);
  // Доп. запас слева для подписей оси Y, чтобы они не наезжали на колонки графика (особенно
  // для stacked-баров с большими суммированными значениями вроде «Расходы по статьям, тыс. ₽»).
  const padL=Math.ceil(yLabelW)+22;
  const padR=24;
  ctx.font='12px '+chartFont();
  const legendItems=datasets.filter(ds=>ds.label).map(ds=>{
   const rawColor=ds.borderColor||(Array.isArray(ds.backgroundColor)?ds.backgroundColor[0]:ds.backgroundColor)||colors.blue;
   const text=String(ds.label||'');
   return {text,color:stripAlpha(rawColor),w:14+ctx.measureText(text).width+16};
  });
  const legendPos=[];
  let legendH=0;
  if(legendItems.length){
   let lx=0,ly=0;
   const rowH=18,maxLegendW=Math.max(120,width-padL-padR);
   legendItems.forEach(item=>{
    if(lx&&lx+item.w>maxLegendW){ly+=rowH;lx=0}
    legendPos.push({x:padL+lx,y:4+ly,item});
    lx+=item.w;
   });
   legendH=ly+rowH;
  }
  const rotateX=labels.some(label=>String(label).length>4)||labels.length>8;
  ctx.font='12px '+chartFont();
  const maxLabelWidth=Math.max(...labels.map(label=>ctx.measureText(String(label)).width),24);
  // При повороте на -30° подпись «спускается» вниз на sin(30°)·ширина = ширина/2.
  // Поэтому отступ снизу должен учитывать эту проекцию плюс высоту строки и зазоры,
  // иначе подписи либо обрезаются у нижнего края канваса, либо налезают на сам график.
  const SIN30=0.5, COS30=0.8660254;
  const xLabelH=rotateX?Math.ceil(maxLabelWidth*SIN30+12*COS30+14):30;
  // Зазор между блоком легенды и областью графика, чтобы подписи рядов не наезжали на сам график.
  // Для stacked-баров с несколькими рядами легенда обычно занимает 2 строки и без зазора
  // верхняя сетка/значения «прилипают» к подписям — добавляем дополнительный отступ.
  const legendGap=legendItems.length?(legendH>22?16:12):0;
  const pad={l:padL,r:padR,t:10+legendH+legendGap,b:xLabelH};
  const plotW=width-pad.l-pad.r, plotH=height-pad.t-pad.b;
  // legend
  if(legendItems.length){
   ctx.font='12px '+chartFont();
   legendPos.forEach(pos=>{ctx.fillStyle=pos.item.color;roundedRect(ctx,pos.x,pos.y+3,10,10,2);ctx.fill();ctx.fillStyle=colors.text;ctx.fillText(pos.item.text,pos.x+14,pos.y+13)});
  }
  const range=max-min||1;
  const scale=v=>pad.t+plotH-((v-min)/range)*plotH;
  const y0=scale(0);
  const prog=Math.max(0,Math.min(1,this.progress));
  // gridlines + Y labels
  ctx.font='12px '+chartFont();ctx.textBaseline='middle';
  ticks.forEach(t=>{const y=scale(t);ctx.strokeStyle=t===0?colors.line:colors.line+'66';ctx.lineWidth=1;ctx.beginPath();ctx.moveTo(pad.l,y);ctx.lineTo(width-pad.r,y);ctx.stroke();ctx.fillStyle=colors.muted;ctx.textAlign='right';ctx.fillText(shortNum(t),pad.l-10,y)});
  // X axis labels
  ctx.font='12px '+chartFont();ctx.textBaseline='alphabetic';ctx.textAlign='center';ctx.fillStyle=colors.muted;
  const approxSpan=rotateX?24:maxLabelWidth+16;
  const step=Math.max(1,Math.ceil(labels.length*approxSpan/Math.max(plotW,1)));
  // Якорь подписи держим непосредственно под областью графика. При повороте на -30°
  // правая часть строки совпадает с якорем, а левая «уезжает» вниз на ширина·sin(30°),
  // поэтому позицию выбираем так, чтобы крайняя нижняя точка подписи не выходила за канвас.
  const xAxisTop=pad.t+plotH+8;
  const xAxisBottomMax=height-4;
  const rotatedAnchorY=Math.min(xAxisTop+12, xAxisBottomMax-maxLabelWidth*SIN30);
  labels.forEach((label,i)=>{if(i%step!==0&&i!==labels.length-1)return;const x=labels.length===1?pad.l+plotW/2:pad.l+(i/(labels.length-1))*plotW;const s=String(label);ctx.save();if(rotateX){ctx.translate(x,rotatedAnchorY);ctx.rotate(-Math.PI/6);ctx.textAlign='right';ctx.fillText(s,0,0)}else{ctx.translate(x,height-9);ctx.fillText(s,0,0)}ctx.restore()});
  // Аннотации: вертикальные линии-маркеры с подписями (например, точка перегиба окупаемости).
  const annotations=Array.isArray(cfg.annotations)?cfg.annotations:[];
  annotations.forEach(an=>{
   if(typeof an.index!=='number'||an.index<0||an.index>=labels.length)return;
   const ax=labels.length===1?pad.l+plotW/2:pad.l+(an.index/(labels.length-1))*plotW;
   const color=an.color||colors.blue;
   ctx.save();
   ctx.strokeStyle=color;ctx.lineWidth=1.4;ctx.setLineDash([5,4]);
   ctx.beginPath();ctx.moveTo(ax,pad.t);ctx.lineTo(ax,pad.t+plotH);ctx.stroke();
   if(an.label){
    ctx.setLineDash([]);
    ctx.font='600 11px '+chartFont();
    const text=String(an.label);
    const tw=ctx.measureText(text).width+12;
    const th=20;
    let bx=ax+6, by=pad.t+4;
    if(bx+tw>width-pad.r)bx=ax-6-tw;
    ctx.fillStyle=hexToRgba(stripAlpha(color),.92);
    roundedRect(ctx,bx,by,tw,th,6);ctx.fill();
    ctx.fillStyle='#ffffff';ctx.textBaseline='middle';ctx.textAlign='left';
    ctx.fillText(text,bx+6,by+th/2+1);
   }
   ctx.restore();
  });
  const barSets=datasets.filter(ds=>(ds.type||cfg.type)!=='line'), lineSets=datasets.filter(ds=>(ds.type||cfg.type)==='line');
  const stacked=!!cfg.stacked;
  const groupW=plotW/Math.max(labels.length,1);
  // Hover guide line behind series
  if(this.hoverIndex>=0&&this.hoverIndex<labels.length){
   const hx=labels.length===1?pad.l+plotW/2:pad.l+(this.hoverIndex/(labels.length-1))*plotW;
   ctx.save();ctx.strokeStyle=colors.muted+'88';ctx.setLineDash([4,4]);ctx.lineWidth=1;ctx.beginPath();ctx.moveTo(hx,pad.t);ctx.lineTo(hx,pad.t+plotH);ctx.stroke();ctx.restore();
  }
  // Bars
  const barLayout=[]; // {x,y,w,h,color,ds,i,val,top,base}
  if(stacked){
   const posStack=new Array(labels.length).fill(0), negStack=new Array(labels.length).fill(0);
   const barW=Math.max(2,groupW*.7);
   barSets.forEach(ds=>{(ds.data||[]).forEach((v,i)=>{
    const val=(Number(v)||0)*prog;const base=val>=0?posStack[i]:negStack[i];const y=scale(base+val),yb=scale(base);
    const top=Math.min(y,yb), h=Math.max(1,Math.abs(yb-y));
    const x=pad.l+i*groupW+(groupW-barW)/2;
    const fill=Array.isArray(ds.backgroundColor)?ds.backgroundColor[i]||colors.blue:ds.backgroundColor||colors.blue;
    barLayout.push({ds,i,x,y:top,w:barW,h,color:fill,val:Number(v)||0});
    if(val>=0)posStack[i]+=val;else negStack[i]+=val;
   })});
  }else{
   const innerGap=2;const slot=groupW*.84;const barW=Math.max(2,(slot-innerGap*(barSets.length-1))/Math.max(barSets.length,1));
   barSets.forEach((ds,di)=>{(ds.data||[]).forEach((v,i)=>{
    const raw=(Number(v)||0)*prog, y=scale(raw), yb=scale(0), top=Math.min(y,yb), h=Math.max(1,Math.abs(yb-y));
    const x=pad.l+i*groupW+(groupW-slot)/2+di*(barW+innerGap);
    const fill=Array.isArray(ds.backgroundColor)?ds.backgroundColor[i]||colors.blue:ds.backgroundColor||colors.blue;
    barLayout.push({ds,i,x,y:top,w:barW,h,color:fill,val:Number(v)||0});
   })});
  }
  // draw bars with rounded top + gradient
  barLayout.forEach(b=>{
   const baseColor=stripAlpha(b.color);
   const isHover=b.i===this.hoverIndex;
   const grad=ctx.createLinearGradient(0,b.y,0,b.y+b.h);
   grad.addColorStop(0,hexToRgba(baseColor,isHover?1:.92));
   grad.addColorStop(1,hexToRgba(baseColor,isHover?.85:.7));
   ctx.fillStyle=grad;
   const r=Math.min(4,b.w/2,b.h);
   roundedRect(ctx,b.x,b.y,b.w,b.h,r);ctx.fill();
   if(isHover){ctx.strokeStyle=hexToRgba(baseColor,1);ctx.lineWidth=1.5;ctx.stroke()}
  });
  // Lines
  const lineLayout=[]; // {ds, pts:[{x,y,val}]}
  lineSets.forEach(ds=>{
   const stroke=ds.borderColor||colors.blue;
   const strokeSolid=stripAlpha(stroke);
   const pts=(ds.data||[]).map((v,i)=>({x:labels.length===1?pad.l+plotW/2:pad.l+(i/(labels.length-1))*plotW,y:scale((Number(v)||0)),val:Number(v)||0}));
   const animPts=pts.map(p=>({x:p.x,y:y0+(p.y-y0)*prog,val:p.val}));
   if(ds.fill){
    const fillColor=ds.backgroundColor||hexToRgba(strokeSolid,.18);
    const grad=ctx.createLinearGradient(0,pad.t,0,pad.t+plotH);
    grad.addColorStop(0,typeof fillColor==='string'?fillColor:hexToRgba(strokeSolid,.28));
    grad.addColorStop(1,hexToRgba(strokeSolid,.02));
    ctx.fillStyle=grad;
    ctx.beginPath();animPts.forEach((p,i)=>i?ctx.lineTo(p.x,p.y):ctx.moveTo(p.x,p.y));ctx.lineTo(animPts[animPts.length-1].x,y0);ctx.lineTo(animPts[0].x,y0);ctx.closePath();ctx.fill();
   }
   ctx.strokeStyle=strokeSolid;ctx.lineWidth=ds.borderWidth||2.2;ctx.lineJoin='round';ctx.lineCap='round';
   ctx.beginPath();animPts.forEach((p,i)=>i?ctx.lineTo(p.x,p.y):ctx.moveTo(p.x,p.y));ctx.stroke();
   const baseR=ds.pointRadius||(animPts.length<=2?3:0);
   if(baseR){ctx.fillStyle=strokeSolid;animPts.forEach(p=>{ctx.beginPath();ctx.arc(p.x,p.y,baseR,0,Math.PI*2);ctx.fill()})}
   lineLayout.push({ds,pts:animPts,color:strokeSolid});
  });
  // Hover points on lines
  if(this.hoverIndex>=0){
   lineLayout.forEach(L=>{const p=L.pts[this.hoverIndex];if(!p)return;
    ctx.save();ctx.fillStyle=hexToRgba(L.color,.18);ctx.beginPath();ctx.arc(p.x,p.y,8,0,Math.PI*2);ctx.fill();
    ctx.fillStyle=L.color;ctx.beginPath();ctx.arc(p.x,p.y,4,0,Math.PI*2);ctx.fill();
    ctx.strokeStyle=colors.surface||'#fff';ctx.lineWidth=2;ctx.stroke();ctx.restore();
   });
  }
  this.layout={pad,plotW,plotH,labels,width,height};
  // Tooltip
  if(this.tooltip){
   if(this.hoverIndex>=0&&prog>=1){
    const idx=this.hoverIndex;
    const rows=datasets.map(ds=>{
     const raw=Array.isArray(ds.data)?ds.data[idx]:undefined;
     if(raw===undefined||raw===null||!Number.isFinite(Number(raw)))return null;
     const swatch=stripAlpha(ds.borderColor||(Array.isArray(ds.backgroundColor)?ds.backgroundColor[idx]:ds.backgroundColor)||colors.blue);
     const label=ds.label||'';
     const shown=typeof ds.tooltipFormat==='function'?ds.tooltipFormat(Number(raw),idx):shortNum(Number(raw));
     return `<div class="tt-row"><span class="tt-label"><span class="tt-sw" style="background:${swatch}"></span>${label}</span><b>${shown}</b></div>`;
    }).filter(Boolean).join('');
    const title=String(labels[idx]||'');
    this.tooltip.innerHTML=`<div class="tt-title">${title}</div>${rows}`;
    const hx=labels.length===1?pad.l+plotW/2:pad.l+(idx/(labels.length-1))*plotW;
    const minY=Math.min(...lineLayout.map(L=>L.pts[idx]?.y??Infinity), ...barLayout.filter(b=>b.i===idx).map(b=>b.y));
    const ty=Number.isFinite(minY)?minY:pad.t+plotH/2;
    let left=hx, top=ty;
    // clamp horizontally inside parent
    const ttRect=this.tooltip.getBoundingClientRect();
    const parentW=this.canvas.parentElement.clientWidth;
    if(left-ttRect.width/2<6)left=ttRect.width/2+6;
    if(left+ttRect.width/2>parentW-6)left=parentW-ttRect.width/2-6;
    if(top<ttRect.height+14)top=ttRect.height+14;
    this.tooltip.style.left=left+'px';
    this.tooltip.style.top=top+'px';
    this.tooltip.classList.add('show');
   }else{
    this.tooltip.classList.remove('show');
   }
  }
 }
}
function chartFont(){return '"Golos Text", -apple-system, BlinkMacSystemFont, "SF Pro Text", sans-serif'}
