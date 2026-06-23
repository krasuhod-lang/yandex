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
  this._ensureTooltip();
  this._onMove=this._onMove.bind(this);
  this._onLeave=this._onLeave.bind(this);
  canvas.addEventListener('mousemove',this._onMove);
  canvas.addEventListener('mouseleave',this._onLeave);
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
 destroy(){
  if(this._raf)cancelAnimationFrame(this._raf);
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
function chartFont(){return '-apple-system, BlinkMacSystemFont, "SF Pro Text", "Inter", sans-serif'}


// Горизонт плана: июль 2026 — декабрь 2027 (18 мес.). Май и июнь 2026 уже в прошлом, поэтому из ряда отрезаются первые 2 значения.
const _RAW_MONTHS=['Май 2026','Июнь 2026','Июль 2026','Август 2026','Сентябрь 2026','Октябрь 2026','Ноябрь 2026','Декабрь 2026','Январь 2027','Февраль 2027','Март 2027','Апрель 2027','Май 2027','Июнь 2027','Июль 2027','Август 2027','Сентябрь 2027','Октябрь 2027','Ноябрь 2027','Декабрь 2027'];
const PLAN_START_OFFSET=2; // отбрасываем Май и Июнь 2026
const _slice=arr=>arr.slice(PLAN_START_OFFSET);
const months=_slice(_RAW_MONTHS);
const revenue=_slice([127360.5978,159117.9348,221445,341018.8043,532290.0652,795462.7891,1070183.369,1765383.335,1877356.452,2129657.314,2445466.57,3254744.138,3909008.9,4753230.091,5833006.543,6741346.983,7831355.51,9292788.909,10540212.54,12276711.91]);
const expenses=_slice([1275000,1475000,1675000,1225000,1225000,1445000,1495000,1845000,1895000,1995000,1995000,2245000,2045000,2145000,2495000,2495000,2495000,2495000,2495000,2495000]);
const profit=_slice([-1147639.402,-1315882.065,-1453555,-883981.1957,-692709.9348,-649537.2109,-424816.6307,-79616.66459,-17643.54844,134657.3141,450466.5695,1009744.138,1864008.9,2608230.091,3338006.543,4246346.983,5336355.51,6797788.909,8045212.537,9781711.91]);
const visits=_slice([11570.65217,12145.65217,17233.47826,19388.47826,23283.22826,30897.37935,36476.59185,48558.70968,51240.66761,58538.64741,66469.74934,88726.41775,105310.8217,126820.3642,156532.2632,179143.0636,206276.0242,231007.8642,259511.9154,301819.5807]);
const repeat=_slice([196.701087,242.9130435,379.1365217,484.7119565,651.9303913,926.9213804,1203.727531,1699.554839,1793.423366,2341.545897,2991.13872,4436.320887,6318.6493,8496.964404,11739.91974,15048.01734,18564.84218,23100.78642,28546.31069,36218.34968]);
const offerClicks=_slice([2745.380435,3120.543478,4471.5,5364.684783,6875.157065,9133.879837,11127.85346,15406.68308,16360.39487,18583.39087,21386.54967,28696.46327,34551.18718,42139.74613,51741.60839,59742.10399,69342.6987,78123.71293,88249.97511,103147.5645]);
const applications=_slice([578.2744565,671.3206522,935.025,1251.552717,1786.739755,2457.727508,3155.618277,4629.2956,4963.094725,5588.534632,6569.64021,8899.196926,10948.3503,13604.34593,16583.47598,19383.64944,22743.85759,25817.21257,29361.40433,34575.56063]);
const approvals=_slice([132.7866848,159.1179348,218.295,316.548587,483.4146848,676.1645511,892.0285386,1347.89022,1450.396633,1627.718905,1926.346095,2612.430003,3235.079764,4041.362954,4914.200762,5767.910479,6792.36214,8175.127301,9328.149041,11008.00728]);
// EPC канала считается из выручки модели и кликов на оффер (раньше был жёсткий массив).
const epc=revenue.map((v,i)=>{const c=Number(offerClicks[i]||0);return c>0?v/c:0});
const trafficSEO=_slice([2875,3450,4140,6210,9936,12916.8,18083.52,25316.928,27848.6208,30633.48288,38291.8536,53608.59504,69691.17355,90598.52562,108718.2307,130461.8769,156554.2523,180037.3901,207042.9986,248451.5983]);
const trafficPPC=_slice([8695.652174,8695.652174,13043.47826,13043.47826,13043.47826,17391.30435,17391.30435,21739.13043,21739.13043,26086.95652,26086.95652,32608.69565,32608.69565,32608.69565,43478.26087,43478.26087,43478.26087,43478.26087,43478.26087,43478.26087]);
const trafficPR=_slice([0,0,50,135,303.75,589.275,1001.7675,1502.65125,1652.916375,1818.208013,2090.939214,2509.127057,3010.952469,3613.142962,4335.771555,5202.925866,6243.511039,7492.213247,8990.655896,9889.721486]);
const budgetDirect=_slice([200000,200000,300000,300000,300000,400000,400000,500000,500000,600000,600000,750000,750000,750000,1000000,1000000,1000000,1000000,1000000,1000000]);
const budgetSEO=_slice([300000,350000,450000,450000,450000,550000,550000,600000,650000,650000,650000,700000,700000,800000,900000,900000,900000,900000,900000,900000]);
const budgetPR=_slice([200000,200000,300000,300000,300000,400000,400000,500000,200000,200000,200000,250000,250000,250000,250000,250000,250000,250000,250000,250000]);
// Итоги пересчитываем из срезанных рядов, чтобы воронки и unit-экономика соответствовали новому горизонту.
const _sum0=a=>a.reduce((x,y)=>x+y,0);
const _seoTotalTraffic=_sum0(trafficSEO), _ppcTotalTraffic=_sum0(trafficPPC), _prTotalTraffic=_sum0(trafficPR);
const _channelTrafficSum=_seoTotalTraffic+_ppcTotalTraffic+_prTotalTraffic||1;
const _revenueTotal=_sum0(revenue);
// Сохраняем исторические доли каналов (SEO 71% / Директ 19% / PR 10%) — пропорционально весу трафика на горизонте 18 мес.
const totals={
 revenue:_revenueTotal,
 expenses:_sum0(expenses),
 profit:_sum0(profit),
 visits:_sum0(visits),
 repeat:_sum0(repeat),
 clicks:_sum0(offerClicks),
 applications:_sum0(applications),
 approvals:_sum0(approvals),
 directRevenue:_revenueTotal*(_ppcTotalTraffic/_channelTrafficSum),
 seoRevenue:_revenueTotal*(_seoTotalTraffic/_channelTrafficSum),
 prRevenue:_revenueTotal*(_prTotalTraffic/_channelTrafficSum),
 directSpend:_sum0(budgetDirect),
 seoSpend:_sum0(budgetSEO),
 prSpend:_sum0(budgetPR)
};
const cumulative=a=>a.reduce((acc,v,i)=>{acc.push((acc[i-1]||0)+v);return acc},[]);
const cumulativeRevenue=cumulative(revenue), cumulativeInvestment=cumulative(expenses), cumulativeProfit=cumulative(profit);
const firstMonthlyProfitIndex=profit.findIndex(v=>v>0), paybackIndex=cumulativeProfit.findIndex(v=>v>=0);
// Месяц начала роста накопленной окупаемости: первый индекс, в котором cumulativeProfit[i] > cumulativeProfit[i-1]
// после достижения исторического минимума. Источник — тот же массив profit, что и в PnL.
const paybackGrowthStartIndex=(()=>{
 if(!cumulativeProfit.length)return -1;
 let minIdx=0;
 for(let i=1;i<cumulativeProfit.length;i++){if(cumulativeProfit[i]<cumulativeProfit[minIdx])minIdx=i}
 // Первый рост после минимума: следующий индекс с положительной производной.
 for(let i=minIdx+1;i<cumulativeProfit.length;i++){if(cumulativeProfit[i]>cumulativeProfit[i-1])return i}
 return -1;
})();

// Краткие подписи месяцев в формате "ММ.ГГ" (10.26, 11.26 ...) — компактный таймлайн на горизонт плана.
const MONTH_NUM={'Январь':'01','Февраль':'02','Март':'03','Апрель':'04','Май':'05','Июнь':'06','Июль':'07','Август':'08','Сентябрь':'09','Октябрь':'10','Ноябрь':'11','Декабрь':'12'};
const shortMonths=months.map(m=>{const parts=m.split(' ');const mn=parts[0];const yr=parts[1]||'';return (MONTH_NUM[mn]||mn)+'.'+(yr.length>=2?yr.slice(-2):yr)});

// Декомпозиция помесячной выручки и расходов по каналам, чтобы фильтры пересчитывали графики, а не только таблицы.
// Подход: каждая месячная выручка revenue[i] распределяется между SEO/PPC/PR пропорционально доле канала в трафике месяца,
// после чего ряд канала перешкалируется так, чтобы суммарная годовая выручка канала совпадала с totals.{seo,direct,pr}Revenue.
const totalChannelTraffic=visits.map((_,i)=>(trafficSEO[i]+trafficPPC[i]+trafficPR[i])||1);
const seoShare=trafficSEO.map((v,i)=>v/totalChannelTraffic[i]);
const ppcShare=trafficPPC.map((v,i)=>v/totalChannelTraffic[i]);
const prShare=trafficPR.map((v,i)=>v/totalChannelTraffic[i]);
function distributeByWeights(monthlyTotals,weights,channelTotal){
 const raw=monthlyTotals.map((v,i)=>v*(weights[i]||0));
 const rawSum=raw.reduce((a,b)=>a+b,0)||1;
 const scale=channelTotal/rawSum;
 return raw.map(v=>v*scale);
}
const revenueSEO=distributeByWeights(revenue,seoShare,totals.seoRevenue);
const revenuePPC=distributeByWeights(revenue,ppcShare,totals.directRevenue);
const revenuePR=distributeByWeights(revenue,prShare,totals.prRevenue);
// CRM / повторные продажи: годовой объём 5,96 млн ₽ распределяется пропорционально repeat[i] (когортный хвост).
const REPEAT_REVENUE_TOTAL=5961100;
const repeatSum=repeat.reduce((a,b)=>a+b,0)||1;
const revenueRepeat=repeat.map(v=>v/repeatSum*REPEAT_REVENUE_TOTAL);
// Маркетинговые расходы по каналу — прямой бюджет; общий expenses[] также включает ФОТ и инфраструктуру.
const expensesSEO=budgetSEO.slice();
const expensesPPC=budgetDirect.slice();
const expensesPR=budgetPR.slice();
const expensesRepeat=revenue.map(()=>0);
// Доля выручки с повторных продаж в сумме месячной выручки — используется для стек-бара First-time vs Repeat в chartRetention.
const revenueFirstTime=revenue.map((v,i)=>Math.max(0,v-revenueRepeat[i]));
// EPC по каналу: выручка канала / клики канала, где клики канала ≈ offerClicks[i] * доля_трафика_канала.
function channelEpc(revArr,trafficArr){
 return revArr.map((v,i)=>{const sh=trafficArr[i]/totalChannelTraffic[i]||0;const clicks=offerClicks[i]*sh;return clicks?v/clicks:0});
}
const CHANNELS={
 'Все каналы':{rev:revenue,cost:expenses,traffic:visits,epc:epc,label:'все каналы'},
 'SEO':{rev:revenueSEO,cost:expensesSEO,traffic:trafficSEO,epc:channelEpc(revenueSEO,trafficSEO),label:'SEO'},
 'Яндекс.Директ':{rev:revenuePPC,cost:expensesPPC,traffic:trafficPPC,epc:channelEpc(revenuePPC,trafficPPC),label:'Яндекс.Директ'},
 'PR':{rev:revenuePR,cost:expensesPR,traffic:trafficPR,epc:channelEpc(revenuePR,trafficPR),label:'PR'},
 'Повторный':{rev:revenueRepeat,cost:expensesRepeat,traffic:repeat,epc:revenueRepeat.map((v,i)=>repeat[i]?v/repeat[i]:0),label:'CRM / повторные'}
};
// Модель оплаты — CPA: партнёр платит маркетплейсу фиксированную сумму за каждый оформленный продукт (заём/кредит/ипотека и др.).
// Годовых ставок дисконтирования нет, поэтому окупаемость считаем по накопленным денежным потокам без NPV.

// Декомпозиция расходов: общий expenses[] = бюджеты каналов + ФОТ + инфраструктура.
// "Прочее" = expenses - (Директ + SEO + PR). Делим на ФОТ (≈70%) и Инфраструктура/прочее (≈30%).
const expensesOther=expenses.map((v,i)=>Math.max(0,v-budgetDirect[i]-budgetSEO[i]-budgetPR[i]));
const expensesPayroll=expensesOther.map(v=>v*0.70);
const expensesInfra=expensesOther.map(v=>v*0.30);
const COST_ITEMS=[
 {key:'direct',label:'Яндекс.Директ',data:budgetDirect,color:'blue'},
 {key:'seo',label:'SEO / контент',data:budgetSEO,color:'green'},
 {key:'pr',label:'PR / медиа',data:budgetPR,color:'violet'},
 {key:'payroll',label:'ФОТ команды',data:expensesPayroll,color:'orange'},
 {key:'infra',label:'Инфраструктура и прочее',data:expensesInfra,color:'red'}
];

// Продуктовая разбивка выручки. Проценты получены из микса партнёров (МФО, банк, карта, страхование, повторы)
// и применяются к месячной выручке, сохраняя итог равным totals.revenue.
const PRODUCT_MIX=[
 {key:'mfo',label:'Микрозаймы (МФО)',share:0.55,partners:'Центрофинанс, МФО-партнёр №2 (PDL), МФО-партнёр №3 (контроль риска)'},
 {key:'loan',label:'Кредиты и рефинансирование',share:0.14,partners:'Банк-партнёр (необеспеченные кредиты)'},
 {key:'card',label:'Кредитные карты',share:0.12,partners:'Эмитент карт (партнёр)'},
 {key:'insurance',label:'Страхование',share:0.06,partners:'Страховой партнёр'},
 {key:'repeat',label:'Повторы и кросс-продажи',share:0.08,partners:'CRM, SMS D+14'},
 {key:'other',label:'CPA-комиссии и прочее',share:0.05,partners:'Партнёрская сеть'}
];
const productSeries=Object.fromEntries(PRODUCT_MIX.map(p=>[p.key,revenue.map(v=>v*p.share)]));
const productTotals=Object.fromEntries(PRODUCT_MIX.map(p=>[p.key,totals.revenue*p.share]));

// CAC по каналам: расходы канала / выданные клиенты канала.
// Доля одобрений канала ≈ доля выручки канала; выдачи = одобрения × ISSUED_TO_APPROVAL_RATE.
const STORAGE_VERSION='v2';
const STORAGE_KEYS={prefs:`vyruchai-dashboard-prefs-${STORAGE_VERSION}`,model:`vyruchai-dashboard-model-${STORAGE_VERSION}`,actions:`vyruchai-dashboard-actions-${STORAGE_VERSION}`};
// Базовые допущения demo-модели: 76% одобрений доходят до выдачи, LTV выше базовой выручки в 1.34x,
// фиксированная выплата партнёра за оформление ≈ 2400 ₽ (годовых ставок в модели нет — оплата за факт сделки), цель repeat-share — 6%.
// Размер базы Центрофинанса и match-rate — вводимые менеджером оценки (нет публичного бенчмарка).
// Маркетплейс-блок (router/cross/crm/tier) — вводные TZ Юнит-экономика; источник правды — EconomicsModel.
const DEFAULT_MARKETPLACE_INPUTS={
 routerMatch:0.42,routerApv2:0.18,routerApv3:0.09,
 routerPayout2:2400,routerPayout3:4500,
 crossCard:0.12,crossInsurance:0.07,crossPayout:1500,
 repeatRate12m:0.30,repeatMargin:1800,churnMonthly:0.10,
 tierBonus:0.06
};
const DEFAULT_MODEL_INPUTS={issuedToApprovalRate:0.76,ltvFactor:1.34,partnerPayout:2400,targetRepeatShare:0.06,centrofinansBaseSize:1.5,centrofinansMatchRate:0.42,...DEFAULT_MARKETPLACE_INPUTS};
// Dynamic CPA payouts per external branch type. Источник по умолчанию — DEFAULT_MARKETPLACE_INPUTS,
// но реально читаются из текущих modelInputs через dynamicPayouts() — это сделано, чтобы CJM
// waterfall и LTV/CAC simulator пересчитывались на любой ввод формы (TZ Раздел 3, связь Обзор↔CJM).
const DYNAMIC_PAYOUTS_BASE={CF_REJECTED:2400,CF_OVERDUE:4500,CF_NON_CORE:3500};
function dynamicPayouts(){
 return {
  CF_REJECTED:Number(modelInputs.routerPayout2)||DYNAMIC_PAYOUTS_BASE.CF_REJECTED,
  CF_OVERDUE:Number(modelInputs.routerPayout3)||DYNAMIC_PAYOUTS_BASE.CF_OVERDUE,
  CF_NON_CORE:Number(modelInputs.routerPayout3)||DYNAMIC_PAYOUTS_BASE.CF_NON_CORE
 };
}
// Сохраняем имя константы для совместимости с существующими прямыми обращениями.
const DYNAMIC_PAYOUTS=new Proxy(DYNAMIC_PAYOUTS_BASE,{get(t,k){const d=dynamicPayouts();return d[k]??t[k]}});
// Храним 6 последних действий: этого хватает, чтобы показать недавние изменения без перегрузки control card.
const MAX_RECENT_ACTIONS=6;
let modelInputs={...DEFAULT_MODEL_INPUTS};
let recentActions=[];
function safeRead(key,fallback){try{const raw=localStorage.getItem(key);return raw?JSON.parse(raw):fallback}catch{return fallback}}
function safeWrite(key,value){try{localStorage.setItem(key,JSON.stringify(value))}catch{}}
function clamp(value,min,max){return Math.min(max,Math.max(min,value))}
function normalizeModelInputs(raw){
 return {
  issuedToApprovalRate:clamp(Number(raw?.issuedToApprovalRate)||DEFAULT_MODEL_INPUTS.issuedToApprovalRate,0,1),
  ltvFactor:clamp(Number(raw?.ltvFactor)||DEFAULT_MODEL_INPUTS.ltvFactor,1,5),
  partnerPayout:clamp(Number(raw?.partnerPayout)||DEFAULT_MODEL_INPUTS.partnerPayout,0,1000000),
  targetRepeatShare:clamp(Number(raw?.targetRepeatShare)||DEFAULT_MODEL_INPUTS.targetRepeatShare,0,1),
  centrofinansBaseSize:clamp(Number(raw?.centrofinansBaseSize)||DEFAULT_MODEL_INPUTS.centrofinansBaseSize,0,50),
  centrofinansMatchRate:clamp(Number(raw?.centrofinansMatchRate)||DEFAULT_MODEL_INPUTS.centrofinansMatchRate,0,1),
  // Маркетплейс-эффекты (TZ §2)
  routerMatch:clamp(Number(raw?.routerMatch)||DEFAULT_MARKETPLACE_INPUTS.routerMatch,0,1),
  routerApv2:clamp(Number(raw?.routerApv2)||DEFAULT_MARKETPLACE_INPUTS.routerApv2,0,1),
  routerApv3:clamp(Number(raw?.routerApv3)||DEFAULT_MARKETPLACE_INPUTS.routerApv3,0,1),
  routerPayout2:clamp(Number(raw?.routerPayout2)||DEFAULT_MARKETPLACE_INPUTS.routerPayout2,0,100000),
  routerPayout3:clamp(Number(raw?.routerPayout3)||DEFAULT_MARKETPLACE_INPUTS.routerPayout3,0,100000),
  crossCard:clamp(Number(raw?.crossCard)||DEFAULT_MARKETPLACE_INPUTS.crossCard,0,1),
  crossInsurance:clamp(Number(raw?.crossInsurance)||DEFAULT_MARKETPLACE_INPUTS.crossInsurance,0,1),
  crossPayout:clamp(Number(raw?.crossPayout)||DEFAULT_MARKETPLACE_INPUTS.crossPayout,0,100000),
  repeatRate12m:clamp(Number(raw?.repeatRate12m)||DEFAULT_MARKETPLACE_INPUTS.repeatRate12m,0,1),
  repeatMargin:clamp(Number(raw?.repeatMargin)||DEFAULT_MARKETPLACE_INPUTS.repeatMargin,0,100000),
  churnMonthly:clamp(Number(raw?.churnMonthly)||DEFAULT_MARKETPLACE_INPUTS.churnMonthly,0,1),
  tierBonus:clamp(Number(raw?.tierBonus)||DEFAULT_MARKETPLACE_INPUTS.tierBonus,0,0.5)
 };
}
const scenarios=[
 // Разбивка JTBD по сценариям. Доля сценария = доля intent-трафика (поисковый спрос по job-to-be-done),
 // подтверждённая завершением диагностики (completion) и откалиброванная по фактической выручке сценария.
 // users отражает месячный пул intent-трафика; сумма ≈ 1,70 млн → доли спроса 43,6 / 19,9 / 12,6 / 11,1 / 7,4 / 5,4 %.
 {name:'Дотянуть до зарплаты',users:742000,completion:74,diag:83,match:69,approval:31,repeat:5.8,revenue:28400000,time:'2:18',best:'Наличие стабильной зарплаты'},
 {name:'Есть долги',users:338000,completion:58,diag:91,match:51,approval:24,repeat:7.2,revenue:14600000,time:'3:42',best:'Долговая нагрузка ниже 50%'},
 {name:'Хочу машину',users:126000,completion:62,diag:76,match:44,approval:19,repeat:3.4,revenue:7100000,time:'4:05',best:'Первоначальный взнос от 20%'},
 {name:'Накопления',users:214000,completion:67,diag:71,match:39,approval:29,repeat:4.1,revenue:5300000,time:'2:55',best:'Горизонт от 6 месяцев'},
 {name:'Страхование',users:188000,completion:64,diag:68,match:41,approval:27,repeat:6.6,revenue:3900000,time:'2:31',best:'Авто или действующий кредит'},
 {name:'Перегруженный клиент',users:92000,completion:49,diag:94,match:37,approval:18,repeat:8.9,revenue:2600000,time:'5:10',best:'Подтверждённый доход'}
];
const partners=[
 {id:'p-01',name:'Центрофинанс API',type:'прямой API',status:'активен',sla:'99.4%',response:'420 мс',approval:38,issue:29,revenue:18200000,epc:128,ecpa:940,complaints:0.8,reject:'ПДН, просрочки',action:'масштабировать'},
 {id:'p-02',name:'МФО-партнёр №2 (PDL)',type:'CPA',status:'активен',sla:'97.1%',response:'1.2 с',approval:31,issue:22,revenue:11700000,epc:116,ecpa:810,complaints:1.7,reject:'Возраст, регион',action:'закрепить'},
 {id:'p-03',name:'Банк-партнёр (необеспеченные кредиты)',type:'прямой API',status:'наблюдение',sla:'93.0%',response:'2.8 с',approval:22,issue:15,revenue:9300000,epc:104,ecpa:1190,complaints:2.9,reject:'КИ, доход',action:'понизить'},
 {id:'p-04',name:'Эмитент карт (партнёр)',type:'CPA',status:'активен',sla:'98.0%',response:'780 мс',approval:27,issue:18,revenue:6400000,epc:91,ecpa:670,complaints:1.1,reject:'Скоринг банка',action:'кросс-продажа'},
 {id:'p-05',name:'Страховой партнёр',type:'CPA',status:'активен',sla:'98.8%',response:'610 мс',approval:35,issue:25,revenue:3900000,epc:84,ecpa:430,complaints:0.6,reject:'Не подходит продукт',action:'закрепить'},
 {id:'p-06',name:'МФО-партнёр №3 (контроль риска)',type:'ручной',status:'риск',sla:'88.5%',response:'4.6 с',approval:16,issue:9,revenue:1700000,epc:42,ecpa:1510,complaints:5.4,reject:'Пустые ответы',action:'пауза'}
];
// Канонические шаги «Основной воронки» (значения зафиксированы по факту среза, см. вкладку «Воронки»).
// rate — конверсия шага относительно предыдущего; используется и для процентов в основной воронке,
// и как база для трёх продуктовых воронок (Обычная / AI / SOS) с разными множителями.
const FUNNEL_STAGES=['Сессии','Сценарий выбран','Диагностика завершена','Рекомендации сформированы','Клик по офферу','Заявки','Одобрения','Выданные сделки'];
const MAIN_FUNNEL=[2007235,1565643,1224413,1083907,664445,213254,64813,16203];
// Три воронки с разным функционалом. base — единая стартовая база сессий, conv — конверсия каждого
// шага к предыдущему (Сессии = 1.0). Числа расходятся по шагам, показывая эффект функционала.
const flows=[
 {name:'Обычная воронка',mod:'',users:1000000,offers:5.8,approval:24,issued:17,revenue:92,time:'9 мин',note:'Широкий каталог офферов, ниже точность подбора и одобрение.',conv:[1,0.76,0.76,0.88,0.56,0.30,0.24,0.71]},
 {name:'AI-воронка (топ-3)',mod:'is-ai',users:1000000,offers:3,approval:32,issued:23,revenue:118,time:'4 мин',note:'AI-подбор топ-3: выше завершение диагностики, CTR и одобрение.',conv:[1,0.82,0.84,0.94,0.64,0.38,0.32,0.76]},
 {name:'SOS-воронка',mod:'is-sos',users:1000000,offers:2.4,approval:38,issued:29,revenue:136,time:'2 мин',note:'Эксклюзивная подача в 2–3 партнёра: максимум одобрений и выдач, меньше риск для КИ.',conv:[1,0.85,0.88,0.96,0.70,0.44,0.38,0.82]}
];
const aiRows=[
 ['rec-2026-001','До зарплаты','Центрофинанс API, МФО-партнёр №2, Эмитент карт','стабильный доход, быстрое решение',0.74,'одобрено',18.6,41,96],
 ['rec-2026-002','Есть долги','Банк-партнёр, МФО-партнёр №2, Центрофинанс API','низкий ПДН, подходит рефинансирование',0.52,'отказ',9.4,24,91],
 ['rec-2026-003','Перегруженный клиент','Центрофинанс API, МФО-партнёр №3','подходит SOS, ограниченная отправка',0.61,'одобрено',14.1,33,88],
 ['rec-2026-004','Страхование','Страховой партнёр, Эмитент карт','подходит кросс-продажа, активный полис',0.68,'одобрено',12.8,35,94]
];
const sosRows=[['Доля входа в SOS','18.4%'],['Доля подходящих клиентов','61.0%'],['Среднее число отправок','2.4'],['Доля одобрений SOS','38.0%'],['Доля выдач SOS','29.0%'],['Выручка на SOS-пользователя','136 ₽'],['Среднее время до решения','2 мин 10 сек'],['Резервные сценарии','Рефинансирование, кредитный доктор, карта']];
const retentionEvents=[['Первая сделка','65 105','100%'],['Отправлено SMS-напоминание','54 420','83.6%'],['Открыто напоминание','27 910','51.3%'],['Повторный визит','165 382','254.0% к сделкам'],['Вторая заявка','18 940','29.1%'],['Второе одобрение','6 790','10.4%'],['Успешная кросс-продажа','4 560','7.0%']];
const experiments=[
 {id:'exp-ai-top3',name:'AI топ-3 против списка',primary:'Доля одобрений',guardrail:'Доля жалоб',segment:'JTBD займы',confidence:'96%',result:'+8 п.п. к одобрению',status:'раскатка'},
 {id:'exp-sos-limit',name:'2 партнёра против 3 партнёров SOS',primary:'Доля выдач',guardrail:'Выручка на пользователя',segment:'ПДН 50–80%',confidence:'91%',result:'3 партнёра лучше на 6%',status:'продолжить'},
 {id:'exp-retention-sms',name:'SMS D+14 против Push D+14',primary:'Повторная заявка',guardrail:'Отписки',segment:'Пользователи с выдачей',confidence:'88%',result:'SMS +2.4 п.п.',status:'расширить'},
 {id:'exp-reason-copy',name:'Текст причины рекомендации',primary:'CTR оффера',guardrail:'Время до клика',segment:'AI-воронка',confidence:'94%',result:'+11% CTR',status:'раскатка'}
];
const alerts=[
 {severity:'red',entity:'МФО-партнёр №3 (контроль риска)',reason:'SLA ниже 90%, время ответа 4.6 с',action:'Поставить партнёра на паузу и вывести из SOS'},
 {severity:'yellow',entity:'Банк-партнёр (необеспеченные кредиты)',reason:'Прогноз одобрения 33%, факт 22%',action:'Понизить в ранжировании и проверить скоринг'},
 {severity:'yellow',entity:'Яндекс.Директ',reason:'CAC выше SEO на 28%',action:'Оставить только прибыльные группы объявлений'},
 {severity:'green',entity:'SEO long-tail',reason:'ROI 75%, EPC стабильно выше CPC',action:'Масштабировать страницы и ссылочную массу'},
 {severity:'yellow',entity:'Доля повторов',reason:'5.1% против цели 6%',action:'Усилить SMS D+14 и кросс-продажи'},
 {severity:'red',entity:'Пустые рекомендации',reason:'2.7% сессий без топ-3',action:'Включить резервный список и логировать отсутствующие ответы партнёров'}
];
// Методика расчётов по партнёрам — что задано константой, а что пересчитывается из трафика.
const partnerMethodRows=[
 ['Доля одобрений (approval %)','Целевой бенчмарк сегмента','PDL 30–40%, банк 15–25%, карты 20–30% — ЦБ РФ + ретро Центрофинанса','Фиксируется на квартал; пересчёт при смене партнёра или скоринг-модели'],
 ['Доля выдач (issue %)','Производная','approval × доводимость на оформлении (65–75%)','Автоматически от approval и UX-метрик формы'],
 ['SLA, время ответа','Целевой operational KPI','Договор с партнёром, мониторинг API','Факт собирается из логов API; цель — пересмотр раз в квартал'],
 ['EPC (₽/клик)','Бенчмарк CPA-сетей','Leads.su / Lead-R / Mixmarket по сегменту','Пересчитывается при смене ставок партнёра или mix трафика'],
 ['eCPA (₽/заявка)','Производная','расходы на канал / заявки партнёра','Автоматически от плана трафика и approval'],
 ['Жалобы (%)','Целевой порог риска','Внутренний регламент: ≤ 1.5% — норма, > 3% — стоп','Факт из тикет-системы; превышение → alert'],
 ['Выручка партнёра, ₽','Производная','трафик × CTR оффера × approval × issue × средний чек комиссии','Пересчитывается при изменении входов на вкладке «Целевая модель»'],
 ['Доля продукта в выручке (share)','Целевой mix','Структура рынка по ЦБ РФ + позиционирование Выручай.ру','Фиксируется на год, ребалансировка по итогам квартала']
];

function sum(a){return a.reduce((x,y)=>x+(Number.isFinite(Number(y))?Number(y):0),0)}
function fmt(n){return Math.round(n).toLocaleString('ru-RU')}
// Денежный формат с автоматической точностью: для per-lead значений < 100 ₽ показываем
// 1–2 знака после запятой, чтобы изменения от ползунков и инпутов были заметны.
function moneyPrec(n){
 const v=Number(n)||0;const a=Math.abs(v);
 const d=a<10?2:a<100?1:0;
 return v.toLocaleString('ru-RU',{minimumFractionDigits:d,maximumFractionDigits:d})+' ₽';
}
function money(n){return fmt(n)+' ₽'}
function mln(n){return (n/1000000).toLocaleString('ru-RU',{maximumFractionDigits:1})+' млн ₽'}
function pct(n){return Number(n).toLocaleString('ru-RU',{maximumFractionDigits:1})+'%'}
function ratio(a,b){return b? a/b:0}
function signedMoney(n){const v=Math.round(Number(n)||0);return `${v>=0?'+':''}${v.toLocaleString('ru-RU')} ₽`}
function cls(v){return v>=0?'positive':'negative'}
function escapeHtml(value){return String(value).replace(/[&<>"']/g,ch=>HTML_ESCAPE_MAP[ch])}
function slug(value){return String(value).toLowerCase().replace(/[^a-zа-я0-9]+/gi,'-').replace(/^-+|-+$/g,'')}
function chartColors(){const s=getComputedStyle(document.documentElement);return {text:s.getPropertyValue('--text').trim(),muted:s.getPropertyValue('--muted').trim(),line:s.getPropertyValue('--line').trim(),blue:s.getPropertyValue('--blue').trim(),green:s.getPropertyValue('--green').trim(),orange:s.getPropertyValue('--orange').trim(),red:s.getPropertyValue('--red').trim(),violet:s.getPropertyValue('--violet').trim()}}
function table(id,head,rows,rowClasses){
 const el=document.getElementById(id);if(!el)return;
 const safeHead=head.map(h=>`<th>${escapeHtml(h)}</th>`).join('');
 const safeRows=rows.map((r,ri)=>{
  const rowCls=rowClasses&&rowClasses[ri]?` class="${escapeHtml(rowClasses[ri])}"`:'';
  return `<tr${rowCls}>`+r.map(c=>`<td class="${typeof c==='number'&&c<0?'negative':''}">${escapeHtml(c)}</td>`).join('')+'</tr>';
 }).join('');
 el.innerHTML='<thead><tr>'+safeHead+'</tr></thead><tbody>'+safeRows+'</tbody>';
}
function drillAttrs(kind,id){return `data-drill-kind="${escapeHtml(kind)}" data-drill-id="${escapeHtml(id)}" tabindex="0" role="button" aria-haspopup="dialog"`}
function emptyCard(message){return `<div class="card"><p class="muted">${escapeHtml(message)}</p></div>`}
function renderJtbdRationale(){
 const host=document.getElementById('jtbdRationale');
 if(!host)return;
 if(!scenarios.length){host.innerHTML='';const st=document.getElementById('jtbdShareTable');if(st)st.innerHTML='';return}
 const totalUsers=scenarios.reduce((a,s)=>a+s.users,0)||1;
 const totalRev=scenarios.reduce((a,s)=>a+s.revenue,0)||1;
 const enriched=scenarios.map(s=>({...s,demand:s.users/totalUsers*100,revShare:s.revenue/totalRev*100,gap:(s.revenue/totalRev*100)-(s.users/totalUsers*100)}));
 const anchor=enriched.slice().sort((a,b)=>b.demand-a.demand)[0];
 const overIndex=enriched.slice().sort((a,b)=>b.gap-a.gap)[0];
 const underIndex=enriched.slice().sort((a,b)=>a.gap-b.gap)[0];
 const points=[
  `Доли заданы <b>спросом (intent-трафиком)</b>: «${escapeHtml(anchor.name)}» формирует ${pct(anchor.demand)} пула — это якорный массовый JTBD с наибольшим поисковым спросом, поэтому он получает максимальную долю.`,
  `Каждая доля <b>подтверждается воронкой</b>: completion (завершение диагностики) и approval удерживают долю выручки около доли спроса, поэтому разбивка не произвольная.`,
  `Доли <b>откалиброваны по фактической выручке</b>: «${escapeHtml(overIndex.name)}» монетизируется выше спроса (вклад в выручку ${pct(overIndex.revShare)} против ${pct(overIndex.demand)} спроса) — приоритет на масштабирование.`,
  `«${escapeHtml(underIndex.name)}» <b>недомонетизирован</b> (${pct(underIndex.revShare)} выручки против ${pct(underIndex.demand)} спроса) — это узкое место для продукта, а не повод раздувать долю.`,
  `Длинный хвост держим небольшим: низкий спрос и высокое время решения дают низкую эффективность на юнит, поэтому доля ограничена сознательно.`
 ];
 host.innerHTML=`<div class="card-title"><div><h2>Аргументация разбивки по процентам</h2><p>Спрос → воронка → выручка: три опоры распределения</p></div></div><ul class="rationale-list">${points.map(p=>`<li>${p}</li>`).join('')}</ul>`;
 const shareRows=enriched.slice().sort((a,b)=>b.demand-a.demand).map(s=>[s.name,pct(s.demand),pct(s.completion),pct(s.approval),pct(s.revShare),s.gap>=0?'монетизация ≥ спроса':'недомонетизирован']);
 table('jtbdShareTable',['Сценарий','Доля спроса','Завершение','Одобрение','Доля выручки','Сигнал'],shareRows);
}
function kpi(container,items){
 const el=document.getElementById(container);if(!el)return;
 el.innerHTML=items.map(x=>{
  const label=escapeHtml(x.label), value=escapeHtml(x.value), sub=escapeHtml(x.sub||'');
  const metricCls=ALLOWED_METRIC_CLASSES.has(x.cls)?x.cls:'';
  const attrs=x.id?drillAttrs(x.kind||'metric',x.id):'';
  const tag=x.delta?`<span class="delta ${x.delta.tone}">${escapeHtml(x.delta.text)}</span>`:'';
  return `<div class="card tight" ${attrs}><div class="card-title"><div class="metric-label">${label}</div>${tag}</div><div class="metric-value ${metricCls}">${value}</div><div class="metric-sub">${sub}</div></div>`;
 }).join('');
}

const DATA_SOURCE={
 mode:'demo',
 modeLabel:'Демо-режим',
 source:'PNL - Выручай.ру.xlsx + встроенная управленческая витрина',
 updatedAt:'10.06.2026 08:00',
 owner:'операционная витрина growth / product / CRM',
 loadStatus:'проверенный срез',
 completeness:'полный плановый период, 18 месяцев (июль 2026 — декабрь 2027)',
 errorState:'ошибок загрузки не зафиксировано'
};
const ROLE_PROFILES={
 'Все роли':{label:'Общий слой',focusChannels:['SEO','Яндекс.Директ','PR','Повторный'],summary:'Все команды и сводные KPI по бизнес-модели',recommendedTab:'overview'},
 'Руководитель':{label:'Руководитель',focusChannels:['SEO','Яндекс.Директ','PR','Повторный'],summary:'Окупаемость, капитал, юнит-экономика и приоритеты роста',recommendedTab:'overview'},
 'Продукт':{label:'Продукт',focusChannels:['SEO','PR','Повторный'],summary:'JTBD, AI-рекомендации, завершение сценариев и quality of match',recommendedTab:'jtbd'},
 'Рост':{label:'Рост',focusChannels:['SEO','Яндекс.Директ','PR'],summary:'Привлечение, ROMI, CAC и масштабирование каналов',recommendedTab:'traffic'},
 'CRM':{label:'CRM',focusChannels:['Повторный'],summary:'Повторы, реактивация, удержание и пост-выдачный LTV',recommendedTab:'retention'},
 'Операции':{label:'Операции',focusChannels:['SEO','Яндекс.Директ','PR'],summary:'SLA партнёров, причины отказов, узкие места и риски витрины',recommendedTab:'partners'}
};
const MODEL_PRESETS=[
 {id:'base',label:'База',values:{issuedToApprovalRate:0.76,ltvFactor:1.34,partnerPayout:2400,targetRepeatShare:0.06},role:'Руководитель',channel:'Все каналы',scenario:'Все сценарии',note:'Базовая модель совета'},
 {id:'growth',label:'Рост',values:{issuedToApprovalRate:0.79,ltvFactor:1.41,partnerPayout:2200,targetRepeatShare:0.06},role:'Рост',channel:'SEO',scenario:'До зарплаты',note:'Смещение в acquisition и SEO'},
 {id:'crm',label:'CRM',values:{issuedToApprovalRate:0.74,ltvFactor:1.52,partnerPayout:2650,targetRepeatShare:0.08},role:'CRM',channel:'Повторный',scenario:'Есть долги',note:'Повышение repeat-share и LTV'},
 {id:'stress',label:'Стресс',values:{issuedToApprovalRate:0.69,ltvFactor:1.22,partnerPayout:1900,targetRepeatShare:0.05},role:'Руководитель',channel:'Яндекс.Директ',scenario:'Перегруженный клиент',note:'Пессимистичный стресс-тест'}
];
const channelClicksMap={
 'SEO':trafficSEO.map((_,i)=>offerClicks[i]*(trafficSEO[i]/totalChannelTraffic[i]||0)),
 'Яндекс.Директ':trafficPPC.map((_,i)=>offerClicks[i]*(trafficPPC[i]/totalChannelTraffic[i]||0)),
 'PR':trafficPR.map((_,i)=>offerClicks[i]*(trafficPR[i]/totalChannelTraffic[i]||0)),
 'Повторный':repeat.slice()
};
const scenarioCatalog=scenarios.map(s=>{
 const map={
  'Дотянуть до зарплаты':{id:'salary',roles:['Продукт','Рост','Руководитель'],channels:['SEO','Яндекс.Директ'],owner:'Продукт',playbook:['Сократить глубину анкеты на первых 3 шагах','Усилить объяснение пользы top-3','Поднять долю SEO landing pages для intent «срочно»']},
  'Есть долги':{id:'debts',roles:['Продукт','CRM','Руководитель'],channels:['Повторный','PR'],owner:'CRM',playbook:['Подмешать рефинансирование в стартовый блок','Дожимать SMS D+14 после отказа','Показывать ограничения ПДН раньше']},
  'Хочу машину':{id:'car',roles:['Продукт','Рост'],channels:['PR','Яндекс.Директ'],owner:'Рост',playbook:['Сделать отдельную дорожку по первоначальному взносу','Добавить калькулятор платёжеспособности','Отделить холодный PR-трафик от брендового']},
  'Накопления':{id:'savings',roles:['Продукт','CRM'],channels:['Повторный','SEO'],owner:'Продукт',playbook:['Усилить контентные страницы по накоплениям','Переиспользовать объяснения причин рекомендации','Добавить сценарии follow-up для длинного цикла']},
  'Страхование':{id:'insurance',roles:['Продукт','Операции','CRM'],channels:['PR','Повторный'],owner:'Операции',playbook:['Расширить кросс-продажи в post-approval','Отслеживать покрытие причины рекомендации','Проверить SLA страхового API в пике']},
  'Перегруженный клиент':{id:'overloaded',roles:['Операции','Продукт','Руководитель'],channels:['PR','Повторный'],owner:'Операции',playbook:['Жёстче переключать в SOS','Логировать пустые ответы и пустые рекомендации','Ставить резервный оффер при низком match-score']}
 }[s.name];
 return {...s,...map};
});
const partnerCatalog=partners.map(p=>{
 const map={
  'p-01':{roles:['Рост','Операции','Руководитель'],channels:['SEO'],owner:'Рост',plan:['Дать больший share в SEO выдаче','Не снижать позицию в SOS','Пересмотреть лимит по бренд-трафику']},
  'p-02':{roles:['Рост','Операции'],channels:['SEO','PR'],owner:'Операции',plan:['Закрепить в 2-м слоте JTBD займов','Оставить как резерв в PR-цепочках','Отдельно следить за региональными отказами']},
  'p-03':{roles:['Операции','Руководитель','Продукт'],channels:['PR','Яндекс.Директ'],owner:'Операции',plan:['Снизить rank до устранения гэпа прогноза','Проверить, где теряется match-score','Запустить аудит входных признаков скоринга']},
  'p-04':{roles:['CRM','Продукт'],channels:['Повторный'],owner:'CRM',plan:['Использовать как кросс-продажу D+14','Оставить в AI top-3 для клиентов с активным лимитом','Поднять visibility в retention-цепочке']},
  'p-05':{roles:['CRM','Операции'],channels:['Повторный','PR'],owner:'CRM',plan:['Усилить bundle со страхованием после выдачи','Следить за качеством ответа в вечерний пик','Оставить как стабильный low-risk оффер']},
  'p-06':{roles:['Операции','Руководитель'],channels:['PR'],owner:'Операции',plan:['Отключить из SOS на ближайший спринт','Разобрать пустые ответы и жалобы','Вернуть только после стабилизации SLA']}
 }[p.id];
 return {...p,...map};
});
const experimentCatalog=experiments.map(e=>({
 ...e,
 roles:e.id==='exp-retention-sms'?['CRM','Руководитель']:e.id==='exp-reason-copy'?['Продукт','Рост']:['Продукт','Рост','Руководитель'],
 channels:e.id==='exp-retention-sms'?['Повторный']:e.id==='exp-ai-top3'?['SEO','PR']:['SEO','Яндекс.Директ','PR']
}));
const alertCatalog=alerts.map((a,i)=>({
 ...a,
 id:['partner-risk','bank-gap','direct-cac','seo-scale','repeat-gap','empty-recs'][i],
 roles:[['Операции','Руководитель'],['Операции','Руководитель','Продукт'],['Рост','Руководитель'],['Рост','Руководитель'],['CRM','Руководитель'],['Продукт','Операции']][i],
 channels:[['PR'],['PR','Яндекс.Директ'],['Яндекс.Директ'],['SEO'],['Повторный'],['PR','SEO']][i],
 scenarios:[['Все сценарии'],['Есть долги'],['До зарплаты','Хочу машину'],['До зарплаты'],['Есть долги','Страхование'],['Перегруженный клиент']][i]
}));
const priorityCatalog=[
 {id:'scale-seo',title:'Масштабировать SEO',description:'SEO остаётся лидером по ROI и лучше всего конвертирует intent-трафик.',severity:'good',roles:['Рост','Руководитель'],channels:['SEO','Все каналы'],scenarios:['Все сценарии','До зарплаты'],owner:'Рост',source:'ROI и EPC по acquisition'},
 {id:'repair-bank',title:'Починить Банк-партнёр',description:'Факт одобрения отстаёт от прогноза — нужен аудит скоринга и rank-модели.',severity:'warn',roles:['Операции','Продукт','Руководитель'],channels:['PR','Яндекс.Директ','Все каналы'],scenarios:['Есть долги','Все сценарии'],owner:'Операции',source:'партнёрский SLA и approval gap'},
 {id:'pause-risk',title:'Убрать МФО-партнёр №3 из SOS',description:'Низкий SLA и жалобы создают репутационный и conversion-риск.',severity:'bad',roles:['Операции','Руководитель'],channels:['PR','Все каналы'],scenarios:['Перегруженный клиент','Все сценарии'],owner:'Операции',source:'alerts + partner card'},
 {id:'grow-repeat',title:'Дорастить repeat-share',description:'Повторы ниже целевого уровня, поэтому CRM должен добрать LTV через D+14 и кросс.',severity:'warn',roles:['CRM','Руководитель'],channels:['Повторный','Все каналы'],scenarios:['Есть долги','Страхование','Все сценарии'],owner:'CRM',source:'retention + repeat-share'},
 {id:'explain-ai',title:'Поднять explainability AI',description:'Нужно закрыть пустые рекомендации и довести покрытие объяснениями до полного.',severity:'warn',roles:['Продукт','Операции'],channels:['SEO','PR','Все каналы'],scenarios:['Перегруженный клиент','Все сценарии'],owner:'Продукт',source:'AI/SOS quality'}
];
const formulaCatalog=[
 {id:'formula-epc',label:'EPC = выручка / клики по офферам',status:'что делать: снижать CPC или повышать match-quality',roles:['Рост','Руководитель','Продукт']},
 {id:'formula-cac',label:'CAC = расходы / первые выдачи',status:'что делать: резать дорогие группы и чинить approval gap',roles:['Рост','Руководитель']},
 {id:'formula-ltv',label:'LTV = накопленная чистая выручка с повторами и кросс-продажами',status:'что делать: усиливать retention и post-approval',roles:['CRM','Руководитель']},
 {id:'formula-payback',label:'Срок окупаемости = CAC / месячная маржа на пользователя',status:'что делать: балансировать CAC и маржу по каналу',roles:['Руководитель','Рост']},
 {id:'formula-pnl',label:'Маркетинговый PnL = выручка - медиа - операционные расходы',status:'что делать: не масштабировать каналы с отрицательной экономикой',roles:['Руководитель','Операции']}
];
const charts={};
const state={role:'Все роли',channel:'Все каналы',scenario:'Все сценарии',activeTab:'overview'};
const CHART_PANELS={chartOverview:'overview',chartInvestment:'overview',chartCacChannels:'overview',chartCostMix:'overview',chartProducts:'overview',chartTargetScenario:'overview',chartTraffic:'traffic',chartEpc:'traffic',chartRetention:'retention',chartUnit:'unit'};
let lastDrawerFocus=null;

function activeRoleProfile(){return ROLE_PROFILES[state.role]||ROLE_PROFILES['Все роли']}
// Период-фильтр убран: бизнес-план всегда показывается за весь горизонт (18 месяцев, июль 2026 — декабрь 2027).
function windowSize(length){return length}
function sliceWindow(arr){return arr.slice()}
function sumSeries(series){return (series[0]||[]).map((_,i)=>sum(series.map(arr=>arr[i]||0)))}
// Динамика плана: сравниваем вторую половину горизонта с первой — стабильная и осмысленная мера роста.
function comparePeriods(arr){
 const half=Math.floor(arr.length/2);
 const previous=arr.slice(0,half), current=arr.slice(half);
 const currentSum=sum(current), previousSum=sum(previous);
 return {current:currentSum,previous:previousSum,delta:previousSum?(currentSum-previousSum)/previousSum:null,size:current.length};
}
function formatDelta(delta){if(delta===null||!Number.isFinite(delta))return null;return {text:`${delta>=0?'+':''}${pct(delta*100)}`,tone:delta>=0?'good':'bad'}}
function activeChartIds(){const panelId=document.querySelector('.panel.active')?.id||'tab-overview';const tab=panelId.replace('tab-','');return Object.entries(CHART_PANELS).filter(([,p])=>p===tab).map(([id])=>id)}
function selectedChannelKeys(){
 if(state.channel!=='Все каналы')return [state.channel];
 const keys=activeRoleProfile().focusChannels||['SEO','Яндекс.Директ','PR','Повторный'];
 return keys;
}
function resolveChannelSeries(){
 const keys=selectedChannelKeys();
 if(state.channel==='Все каналы'&&keys.length===4)return {...CHANNELS['Все каналы'],key:'Все каналы',keys,label:'все каналы'};
 if(keys.length===1){const single=CHANNELS[keys[0]];return {...single,key:keys[0],keys,label:single.label}}
 const rev=sumSeries(keys.map(k=>CHANNELS[k].rev));
 const cost=sumSeries(keys.map(k=>CHANNELS[k].cost));
 const traffic=sumSeries(keys.map(k=>CHANNELS[k].traffic));
 const clicks=sumSeries(keys.map(k=>channelClicksMap[k]||CHANNELS[k].traffic));
 const epcSeries=rev.map((v,i)=>clicks[i]?v/clicks[i]:0);
 return {key:'role-focus',keys,label:activeRoleProfile().label,rev,cost,traffic,epc:epcSeries};
}
function filterByRole(items){if(state.role==='Все роли')return items;return items.filter(item=>!item.roles||item.roles.includes(state.role))}
function matchesScenario(item){if(state.scenario==='Все сценарии')return true;if(!item.scenarios&&!item.name)return true;const query=state.scenario.toLowerCase();if(item.scenarios)return item.scenarios.includes(state.scenario)||item.scenarios.includes('Все сценарии');return String(item.name||'').toLowerCase().includes(query)||query.includes(String(item.name||'').toLowerCase())}
function matchesChannels(item){const keys=selectedChannelKeys();if(state.channel==='Все каналы')return !item.channels||item.channels.some(ch=>keys.includes(ch)||ch==='Все каналы');return !item.channels||item.channels.includes(state.channel)||item.channels.includes('Все каналы')}
function filterContext(items){return filterByRole(items).filter(matchesScenario).filter(matchesChannels)}
function channelRows(rows){const keys=selectedChannelKeys();return rows.filter(r=>state.channel==='Все каналы'?keys.includes(r.key):r.key===state.channel)}
function _v(id){return document.getElementById(id)?.value}
function currentDraftInputs(){return normalizeModelInputs({
 issuedToApprovalRate:Number(_v('inputIssuedRate')||0)/100,
 ltvFactor:Number(_v('inputLtvFactor')||0),
 partnerPayout:Number(_v('inputPartnerPayout')||0),
 targetRepeatShare:Number(_v('inputRepeatTarget')||0)/100,
 centrofinansBaseSize:Number(_v('inputBaseSize')||0),
 centrofinansMatchRate:Number(_v('inputMatchRate')||0)/100,
 routerMatch:Number(_v('inputRouterMatch')||0)/100,
 routerApv2:Number(_v('inputRouterApv2')||0)/100,
 routerApv3:Number(_v('inputRouterApv3')||0)/100,
 routerPayout2:Number(_v('inputRouterPayout2')||0),
 routerPayout3:Number(_v('inputRouterPayout3')||0),
 crossCard:Number(_v('inputCrossCard')||0)/100,
 crossInsurance:Number(_v('inputCrossInsurance')||0)/100,
 crossPayout:Number(_v('inputCrossPayout')||0),
 repeatRate12m:Number(_v('inputRepeatRate12m')||0)/100,
 repeatMargin:Number(_v('inputRepeatMargin')||0),
 churnMonthly:Number(_v('inputChurnMonthly')||0)/100,
 tierBonus:Number(_v('inputTierBonus')||0)/100
})}
const _MODEL_INPUT_KEYS=['issuedToApprovalRate','ltvFactor','partnerPayout','targetRepeatShare','centrofinansBaseSize','centrofinansMatchRate','routerMatch','routerApv2','routerApv3','routerPayout2','routerPayout3','crossCard','crossInsurance','crossPayout','repeatRate12m','repeatMargin','churnMonthly','tierBonus'];
function sameModelInputs(a,b){return _MODEL_INPUT_KEYS.every(key=>Math.abs((a[key]||0)-(b[key]||0))<0.0001)}
function syncControlsFromState(){
 document.documentElement.dataset.theme=(safeRead(STORAGE_KEYS.prefs,{theme:'light'}).theme)||'light';
 document.querySelectorAll('.filters select').forEach(sel=>{
  const label=sel.getAttribute('aria-label');
  if(label==='Канал')sel.value=state.channel;
  else if(label==='Сценарий')sel.value=state.scenario;
  else if(label==='Роль')sel.value=state.role;
 });
 const tab=state.activeTab||'overview';
 document.querySelectorAll('.tab').forEach(t=>t.classList.toggle('active',t.dataset.tab===tab));
 document.querySelectorAll('.panel').forEach(p=>p.classList.toggle('active',p.id==='tab-'+tab));
}
function persistPreferences(){safeWrite(STORAGE_KEYS.prefs,{role:state.role,channel:state.channel,scenario:state.scenario,activeTab:state.activeTab,theme:document.documentElement.dataset.theme||'light'})}
function persistModelInputs(){safeWrite(STORAGE_KEYS.model,modelInputs);safeWrite(STORAGE_KEYS.actions,recentActions)}
function currentStamp(){return new Date().toLocaleString('ru-RU',{day:'2-digit',month:'2-digit',year:'numeric',hour:'2-digit',minute:'2-digit'})}
function recordAction(text){recentActions=[{time:currentStamp(),text},...recentActions].slice(0,MAX_RECENT_ACTIONS);safeWrite(STORAGE_KEYS.actions,recentActions)}
function partnerPayoutValue(){return Number(modelInputs.partnerPayout)||0}
function channelCac(){
 const totalIssued=totals.approvals*modelInputs.issuedToApprovalRate;
 const make=(rev,spend)=>{const issued=totalIssued*(rev/totals.revenue);return {rev,spend,issued,cac:issued?spend/issued:0}};
 return {
  'Все каналы':{...make(totals.revenue,totals.expenses),label:'все каналы'},
  'SEO':{...make(totals.seoRevenue,totals.seoSpend),label:'SEO'},
  'Яндекс.Директ':{...make(totals.directRevenue,totals.directSpend),label:'Яндекс.Директ'},
  'PR':{...make(totals.prRevenue,totals.prSpend),label:'PR'},
  'Повторный':{...make(REPEAT_REVENUE_TOTAL,0),label:'CRM / повторные'}
 };
}
function calculateUnitEconomics(){
 const issued=totals.approvals*modelInputs.issuedToApprovalRate;
 const visitToApplicationRate=ratio(totals.applications,totals.visits);
 const applicationToApprovalRate=ratio(totals.approvals,totals.applications);
 const issueRateFromVisit=visitToApplicationRate*applicationToApprovalRate*modelInputs.issuedToApprovalRate;
 const revenuePerIssue=ratio(totals.revenue,issued);
 const ltvPerIssue=revenuePerIssue*modelInputs.ltvFactor;
 const cacPerIssue=ratio(totals.expenses,issued);
 const matchedVisits=totals.visits*modelInputs.centrofinansMatchRate;
 const unmatchedVisits=Math.max(0,totals.visits-matchedVisits);
 const clicksPerVisit=ratio(totals.clicks,totals.visits);
 return {
  issued,
  visitToApplicationRate,
  applicationToApprovalRate,
  issueRateFromVisit,
  issuePer1000:issueRateFromVisit*1000,
  revenuePerIssue,
  ltvPerIssue,
  cacPerIssue,
  partnerPayout:partnerPayoutValue(),
  dynamicPayouts:{...DYNAMIC_PAYOUTS},
  matchedVisits,
  unmatchedVisits,
  clicksPerVisit,
  epcValue:ratio(totals.revenue,totals.clicks)
 };
}
function routeScenarioVolumes(){
 const scenarioList=Array.isArray(scenarios)?scenarios:[];
 const scenarioMap=Object.fromEntries(scenarioList.map(item=>[item.name,item.users]));
 return {
  rejected:Math.round(Math.max(0,totals.applications-totals.approvals)/Math.max(months.length,1)),
  active:Math.round(totals.repeat/Math.max(months.length,1)),
  noncore:Math.round(scenarioMap['Хочу машину']||0),
  overdue:Math.round(scenarioMap['Перегруженный клиент']||0),
  target:Math.round(calculateUnitEconomics().matchedVisits/Math.max(months.length,1))
 };
}
// ===== TZ unit-economics model (§3) and светофор helper (§2). Single source of truth for #tab-unit. =====
// Light wrapper around calculateUnitEconomics + DYNAMIC_PAYOUTS, exposed in the {global_metrics, cjm_branches} shape from the TZ.
function statusFor(romi,ltvCac){
 const r=Number(romi);
 const lc=Number(ltvCac);
 const hasLtv=Number.isFinite(lc)&&lc>0;
 const isSuccess=(Number.isFinite(r)&&r>20)||(hasLtv&&lc>3);
 const isDanger=Number.isFinite(r)&&r<0;
 if(isSuccess)return {level:'success',badge:'Масштабировать',recommendation:'Масштабировать',rowClass:'row-status-success',dotClass:'status-success',badgeClass:'status-badge status-success'};
 if(isDanger)return {level:'danger',badge:'Отключить',recommendation:'Отключить',rowClass:'row-status-danger',dotClass:'status-danger',badgeClass:'status-badge status-danger'};
 return {level:'warning',badge:'Оптимизировать',recommendation:'Оптимизировать',rowClass:'row-status-warning',dotClass:'status-warning',badgeClass:'status-badge status-warning'};
}
// TZ §3 — Per-lead Data Engine. Принимает model + опциональные оверрайды для симулятора «Что если?».
// Базовый юнит = 1 входящий «грязный» лид (totals.visits). Считаем доли веток, ARPU каждой, Blended ARPU и Unit Margin.
function perLeadFromModel(model,overrides){
 const m=model||buildUnitModel();
 const totalLeads=Math.max(1,(typeof totals!=='undefined'&&totals.visits)||0);
 const spend=m.global_metrics.marketing_spend;
 // baseline CPL = весь маркетинговый расход / общий «грязный» трафик (визиты)
 let cpl=spend/totalLeads;
 // Доли веток по трафику (нормализуем — гарантируем сумму=1)
 const sumTraffic=m.cjm_branches.reduce((a,b)=>a+(b.traffic||0),0)||1;
 const baseShares=Object.fromEntries(m.cjm_branches.map(b=>[b.id,(b.traffic||0)/sumTraffic]));
 // ARPU каждой ветки (revenue/traffic) — для target = LTV-подобная выдача, для остальных = CPA × match-rate
 const baseArpu=Object.fromEntries(m.cjm_branches.map(b=>[b.id,b.arpu||0]));
 // Применяем оверрайды симулятора (TZ §5.4): cplDelta (-50..0), shareTargetAbs (+0..+0.05),
 // arpuRejectedMultiplier (1..2). При смещении share_target — пропорционально уменьшаем остальные ветки.
 const o=overrides||{};
 if(Number.isFinite(o.cplDelta))cpl=cpl*(1+o.cplDelta);
 const shares={...baseShares};
 if(Number.isFinite(o.shareTargetAbs)&&o.shareTargetAbs!==0){
  const newTarget=Math.min(0.5,Math.max(0,(shares.target||0)+o.shareTargetAbs));
  const restIds=Object.keys(shares).filter(k=>k!=='target');
  const restSum=restIds.reduce((a,k)=>a+(shares[k]||0),0)||1;
  const restNew=Math.max(0,1-newTarget);
  restIds.forEach(k=>{shares[k]=(shares[k]||0)*(restNew/restSum)});
  shares.target=newTarget;
 }
 const arpu={...baseArpu};
 if(Number.isFinite(o.arpuRejectedMul))arpu.rejected=(baseArpu.rejected||0)*o.arpuRejectedMul;
 // Per-branch contribution = share × ARPU
 const contrib=Object.fromEntries(Object.keys(shares).map(k=>[k,(shares[k]||0)*(arpu[k]||0)]));
 const blendedArpu=Object.values(contrib).reduce((a,b)=>a+b,0);
 const unitMargin=blendedArpu-cpl;
 const romi=cpl>0?unitMargin/cpl*100:0;
 return {totalLeads,cpl,blendedArpu,unitMargin,romi,shares,arpu,contrib,baseShares,baseArpu,baseCpl:spend/totalLeads};
}
function renderUnitBrief(model){
 const host=document.getElementById('ueLab');
 if(!host)return;
 const m=model||buildUnitModel();
 const u=perLeadFromModel(m);
 const branchMeta={
 target:{name:'Целевые',route:'выдача в ЦФ'},
 rejected:{name:'Отказы',route:'CPA при отказе'},
 noncore:{name:'Непрофильные',route:'кросс-офферы'},
 overdue:{name:'Просрочка',route:'перекредитованные / БФЛ'}
 };
 const branchLines=m.cjm_branches.map(b=>{
 const meta=branchMeta[b.id]||{name:b.name,route:'ветка CJM'};
 const share=u.shares[b.id]||0;
 const arpu=u.arpu[b.id]||0;
 const contrib=(u.contrib&&u.contrib[b.id])||share*arpu;
 return `<div class="unit-branch-line"><div><span class="unit-branch-name">${escapeHtml(meta.name)}</span><span class="muted"> — ${escapeHtml(meta.route)}</span></div>`+
  `<div class="unit-branch-metrics">доля <b>${escapeHtml(pct(share*100))}</b> · выручка на пользователя <b>${escapeHtml(moneyPrec(arpu))}</b> · вклад <b>${escapeHtml(moneyPrec(contrib))}</b></div></div>`;
 }).join('');
 const status=statusFor(u.romi);
 host.innerHTML=`<div class="card unit-brief-card"><div class="card-title"><div><h2>Краткая юнит-экономика</h2><p>Сводка считается из тех же данных, что дашборд и CJM: трафик, заявки, решения ЦФ, тарифы партнёров и доли веток.</p></div><span class="${status.badgeClass}"><span class="status-dot ${status.dotClass}"></span>${escapeHtml(status.recommendation)}</span></div>`+
 `<div class="unit-brief-grid"><div class="unit-branch-list">${branchLines}</div><div>`+
 `<div class="mini-row"><span>Стоимость лида</span><b>${escapeHtml(moneyPrec(u.cpl))}</b></div>`+
 `<div class="mini-row"><span>Средняя выручка на лид</span><b>${escapeHtml(moneyPrec(u.blendedArpu))}</b></div>`+
 `<div class="mini-row"><span>Маржа на лид</span><b class="${u.unitMargin>=0?'positive':'negative'}">${escapeHtml(moneyPrec(u.unitMargin))}</b></div>`+
 `<div class="mini-row"><span>Окупаемость рекламы</span><b class="${u.romi>=0?'positive':'negative'}">${escapeHtml(u.romi.toFixed(1)+'%')}</b></div>`+
 `<ul class="unit-driver-list">`+
 `<li><b>Что двигает:</b> тарифы партнёров, доля совпадений с базой ЦФ, множитель LTV и доли веток CJM.</li>`+
 `<li><b>Источник:</b> план трафика, воронка заявок, CJM Smart Safe Router и текущие вводные целевой модели.</li>`+
 `</ul></div></div></div>`;
}
function buildUnitModel(){
 const unit=calculateUnitEconomics();
 const monthCount=Math.max(months.length,1);
 const targetConversions=Math.max(1,unit.matchedVisits*unit.issueRateFromVisit);
 // Per-branch traffic over the plan horizon.
 // rejected = неодобренные заявки за весь горизонт; noncore/overdue = пул JTBD-сценариев (трактуем как объём за горизонт,
 // чтобы они были сопоставимы с rejected/target и светофор показывал разные уровни ROMI).
 const rejectedTraffic=Math.max(0,totals.applications-totals.approvals);
 const noncoreTraffic=(scenarios.find(s=>s.name==='Хочу машину')||{}).users||0;
 const overdueTraffic=(scenarios.find(s=>s.name==='Перегруженный клиент')||{}).users||0;
 const targetTraffic=unit.matchedVisits;
 const rejectedTrafficMonthly=rejectedTraffic/monthCount;
 const noncoreTrafficMonthly=noncoreTraffic/monthCount;
 const overdueTrafficMonthly=overdueTraffic/monthCount;
 const targetTrafficMonthly=targetTraffic/monthCount;
 // Conversion rates per branch.
 const targetCR=unit.issueRateFromVisit;
 const noncoreApproval=ratio((scenarios.find(s=>s.name==='Хочу машину')||{}).approval||19,100);
 const overdueApproval=ratio((scenarios.find(s=>s.name==='Перегруженный клиент')||{}).approval||18,100);
 const rejectedCR=unit.issueRateFromVisit*0.8;
 const noncoreCR=unit.issueRateFromVisit*noncoreApproval;
 const overdueCR=unit.issueRateFromVisit*overdueApproval;
 // CPA revenue per conversion.
 const cpaTarget=unit.revenuePerIssue;
 const cpaRejected=DYNAMIC_PAYOUTS.CF_REJECTED;
 const cpaNoncore=DYNAMIC_PAYOUTS.CF_NON_CORE;
 const cpaOverdue=DYNAMIC_PAYOUTS.CF_OVERDUE;
 // Cost distributed proportionally to traffic share of total marketing spend.
 const marketingSpend=totals.expenses;
 const trafficTotal=targetTraffic+rejectedTraffic+noncoreTraffic+overdueTraffic||1;
 const branch=(id,name,traffic,trafficMonthly,cr,cpa)=>{
  const conversions=traffic*cr;
  const revenue=traffic*cr*cpa;
  const cost=marketingSpend*(traffic/trafficTotal);
  const arpu=traffic?revenue/traffic:0;
  const cac=conversions?cost/conversions:0;
  const romi=cost?(revenue-cost)/cost*100:0;
  return {id,name,traffic,traffic_monthly:trafficMonthly,cr_to_deal:cr,cpa_revenue:cpa,cost,conversions,revenue,arpu,cac,romi,clicks:Math.round(traffic*unit.clicksPerVisit)};
 };
 const branches=[
  branch('target','Целевые (ЦФ)',targetTraffic,targetTrafficMonthly,targetCR,cpaTarget),
  branch('rejected','Отказники (Брокер)',rejectedTraffic,rejectedTrafficMonthly,rejectedCR,cpaRejected),
  branch('noncore','Непрофильные (Банк)',noncoreTraffic,noncoreTrafficMonthly,noncoreCR,cpaNoncore),
  branch('overdue','Перегруженные (БФЛ)',overdueTraffic,overdueTrafficMonthly,overdueCR,cpaOverdue)
 ];
 const totalRevenue=branches.reduce((a,b)=>a+b.revenue,0);
 const revenueByBranch=Object.fromEntries(branches.map(b=>[b.id,b.revenue]));
 // Per TZ formula §5: Blended CAC = (spend − rev_rejected − rev_noncore) / target_conversions.
 const blendedCac=Math.max(1,(marketingSpend-revenueByBranch.rejected-revenueByBranch.noncore-revenueByBranch.overdue)/targetConversions);
 const baseCac=marketingSpend/targetConversions;
 const margin=totalRevenue-marketingSpend;
 const romi=marketingSpend?margin/marketingSpend*100:0;
 // MoM trend: compare last month vs the prior month.
 const lastIdx=months.length-1;
 const prevIdx=Math.max(0,lastIdx-1);
 const mom=(arr)=>{
  const cur=Number(arr[lastIdx])||0;
  const prev=Number(arr[prevIdx])||0;
  if(!prev)return null;
  return (cur-prev)/prev*100;
 };
 // Blend monthly external revenue into total revenue series proportionally to monthly revenue weight.
 const revSum=sum(revenue)||1;
 const monthlyExternal=revenue.map(v=>(totalRevenue-totals.revenue)*(v/revSum));
 const monthlyRevenue=revenue.map((v,i)=>v+monthlyExternal[i]);
 const monthlyProfit=monthlyRevenue.map((v,i)=>v-expenses[i]);
 const monthlyRomi=monthlyProfit.map((p,i)=>expenses[i]?p/expenses[i]*100:0);
 return {
  global_metrics:{
   marketing_spend:marketingSpend,
   total_revenue:totalRevenue,
   margin,
   romi,
   base_cac:baseCac,
   blended_cac:blendedCac,
   target_conversions:targetConversions,
   trends:{
    spend:mom(expenses),
    revenue:mom(monthlyRevenue),
    margin:mom(monthlyProfit),
    romi:mom(monthlyRomi)
   }
  },
  cjm_branches:branches,
  monthly:{
   labels:shortMonths.slice(),
   revenue:monthlyRevenue,
   spend:expenses.slice(),
   romi:monthlyRomi
  }
 };
}
function currentRouteVolumes(){
 const defaults=routeScenarioVolumes();
 const read=(id,fallback)=>{
  const el=document.getElementById(id);
  const v=Number(el?.value);
  return el&&el.value!==''&&Number.isFinite(v)&&v>=0?v:fallback;
 };
 return {
  rejected:read('calcRejected',defaults.rejected),
  active:read('calcActive',defaults.active),
  noncore:read('calcNoncore',defaults.noncore),
  overdue:defaults.overdue,
  target:defaults.target
 };
}
function buildInputData(ch){
 const comparison=comparePeriods(ch.rev);
 return [
  {title:'Период и база модели',value:'Июль 2026 — декабрь 2027',text:`${months.length} мес. на горизонте плана; роль ${activeRoleProfile().label.toLowerCase()}.`},
  {title:'Инвестиции и капитал',value:mln(totals.expenses),text:`Совокупно: медиа (${mln(totals.directSpend+totals.seoSpend+totals.prSpend)}) + ФОТ команды (${mln(sum(expensesPayroll))}) + инфраструктура (${mln(sum(expensesInfra))}). Пик потребности ${mln(Math.abs(Math.min(...cumulativeProfit)))}.`},
  {title:'Драйверы математики',value:`${pct(modelInputs.issuedToApprovalRate*100)} → ${modelInputs.ltvFactor.toFixed(2)}x`,text:`Выплата за оформление ${fmt(partnerPayoutValue())} ₽ (фикс, не годовые); цель repeat ${pct(modelInputs.targetRepeatShare*100)}.`}
 ];
}
function renderModelDirtyState(){
 const draft=currentDraftInputs();
 const dirty=!sameModelInputs(draft,modelInputs);
 const el=document.getElementById('modelDirtyState');
 if(!el)return;
 el.textContent=dirty?'Есть несохранённые изменения':'Все изменения сохранены';
 el.classList.toggle('is-dirty',dirty);
}
function renderPresetActions(){
 const el=document.getElementById('presetActions');if(!el)return;
 el.innerHTML=MODEL_PRESETS.map(p=>`<button class="action" data-preset-id="${p.id}" type="button">${escapeHtml(p.label)}</button>`).join('');
}
// TZ §4.6 — 4 ветки CJM (Target / Rejected / Non-core / Overdue) со светофором.
function renderCjmUnitEconomics(){
 const host=document.getElementById('cjmUnitGrid');
 if(!host)return;
 const model=buildUnitModel();
 renderUnitBrief(model);
 const u=perLeadFromModel(model);
 const META={
  target:{title:'Целевые — выдача в ЦФ',sub:'Прямой оффер Центрофинанса',cls:'s-target'},
  rejected:{title:'Отказы — CPA при отказе',sub:'Мягкий отказ → витрина партнёров',cls:'s-rejected'},
  noncore:{title:'Непрофильные — кросс-офферы',sub:'Банк, авто, залог, ипотека',cls:'s-noncore'},
  overdue:{title:'Просрочка — БФЛ / работа',sub:'Банкротство и трудоустройство',cls:'s-overdue'}
 };
 host.innerHTML=model.cjm_branches.map(b=>{
  const meta=META[b.id]||{title:b.name,sub:'',cls:'s-notfound'};
  // Contribution margin per lead = share × ARPU − share × CPL (вклад ветки в Unit Margin).
  const share=u.shares[b.id]||0;
  const contribRevenue=share*(u.arpu[b.id]||0);
  const contribCost=share*u.cpl;
  const contribMargin=contribRevenue-contribCost;
  // Danger если ветка тянет Unit Margin вниз (отрицательный вклад per lead).
  const dangerLevel=contribMargin<0?'danger':(b.romi>=20?'success':'warning');
  const st={...statusFor(b.romi)};
  const isDanger=dangerLevel==='danger';
  const killBtn=isDanger?`<button class="cjm-kill-btn" type="button" disabled aria-disabled="true" title="UI-заглушка: отключение ветки">Отключить ветку</button>`:'';
  return `<article class="card cjm-unit-card ${escapeHtml(meta.cls)}" data-status="${escapeHtml(isDanger?'danger':st.level)}">
   <div class="cjm-unit-head">
    <div>
     <h3>${escapeHtml(meta.title)}</h3>
     <div class="cjm-unit-tags">
      <span class="${st.badgeClass}"><span class="status-dot ${st.dotClass}"></span>${escapeHtml(st.badge)}</span>
     </div>
    </div>
    <span class="cjm-unit-code">${escapeHtml(b.id.toUpperCase())}</span>
   </div>
   <div class="cjm-primary-metric"><div class="metric-label">Выручка ветки</div><div class="metric-value">${escapeHtml(money(b.revenue))}</div></div>
   <div class="cjm-secondary-row">
    <div class="mini-row"><span>Трафик</span><b>${escapeHtml(fmt(b.traffic))}</b></div>
    <div class="mini-row"><span>Доля трафика</span><b>${escapeHtml(pct(share*100))}</b></div>
    <div class="mini-row"><span>Выручка на пользователя</span><b>${escapeHtml(money(b.arpu))}</b></div>
    <div class="mini-row"><span>Окупаемость рекламы</span><b class="${b.romi>=0?'positive':'negative'}">${escapeHtml(b.romi.toFixed(1)+'%')}</b></div>
   </div>
   <div class="cjm-contrib-bar"><span>Маржа ветки / лид</span><b class="${contribMargin>=0?'positive':'negative'}">${(contribMargin>=0?'+':'')+money(contribMargin)}</b></div>
   <div class="cjm-conv-bar"><div class="cjm-conv-bar-label"><span>Конверсия</span><span>${pct(b.cr_to_deal*100)}</span></div><div class="cjm-conv-bar-track"><div class="cjm-conv-bar-fill" style="width:${Math.min(100,Math.round(b.cr_to_deal*100))}%"></div></div></div>
   <div class="cjm-unit-formula"><b>Вклад:</b> доля × выручка на пользователя − доля × стоимость лида = ${escapeHtml(pct(share*100))} × ${escapeHtml(money(b.arpu))} − ${escapeHtml(pct(share*100))} × ${escapeHtml(money(u.cpl))}</div>
   ${killBtn}
  </article>`;
 }).join('');
 renderPnlWaterfall(model);
 renderLtvCacSimulator(model);
}
// ===== ApexCharts instances (lazy) for the unit tab =====
const apexInstances={};
let apexLoadHookInstalled=false;
function ensureApexReady(callback){
 if(typeof window.ApexCharts!=='undefined'){callback();return}
 if(apexLoadHookInstalled)return;
 apexLoadHookInstalled=true;
 const tryRender=()=>{if(typeof window.ApexCharts!=='undefined'){callback();return true}return false};
 // External script is deferred — re-attempt after window load and via a short poll.
 window.addEventListener('load',tryRender,{once:true});
 let tries=0;const t=setInterval(()=>{if(tryRender()||++tries>40)clearInterval(t)},150);
}
function disposeApex(id){if(apexInstances[id]){try{apexInstances[id].destroy()}catch{}delete apexInstances[id]}}
function apexThemeMode(){return document.documentElement.dataset.theme==='dark'?'dark':'light'}
// TZ §5.2 — водопад PnL: стоимость лида, вклад веток CJM и итоговая маржа на лид.
const UNIT_LABELS={target:'Целевые — ЦФ',rejected:'Отказы — CPA',noncore:'Непрофильные — кросс',overdue:'Просрочка — БФЛ/HR'};
function renderPnlWaterfall(model,overrides){
 const host=document.getElementById('pnlWaterfallChart');
 if(!host)return;
 disposeApex('waterfall');
 host.innerHTML='';
 const m=model||buildUnitModel();
 const u=perLeadFromModel(m,overrides);
 const c=chartColors();
 if(typeof window.ApexCharts==='undefined'){
  host.innerHTML=`<div class="ltv-cac-fallback">Загрузка графика… Маржа на лид: <b>${money(u.unitMargin)}</b> = средняя выручка на лид (${money(u.blendedArpu)}) − стоимость лида (${money(u.cpl)}).</div>`;
  ensureApexReady(()=>renderPnlWaterfall(model,overrides));
  return;
 }
 // Build per-lead waterfall steps for ALL CJM branches present in the model.
 // Filter out branches with negligible contribution (< 0.5 ₽/lead) to keep the waterfall readable.
 const branchSteps=Object.keys(u.contrib).filter(k=>(u.contrib[k]||0)>0.005).map(k=>({
  key:k,label:'+ '+(UNIT_LABELS[k]||k),delta:u.contrib[k],color:c.green,share:u.shares[k],arpu:u.arpu[k]
 }));
 const steps=[{key:'cpl',label:'− стоимость лида',delta:-u.cpl,color:c.red},...branchSteps];
 let cum=0;
 const data=steps.map(s=>{const from=cum;cum+=s.delta;return {x:s.label,y:[from,cum],fillColor:s.color,label:s.label,delta:s.delta,share:s.share,arpu:s.arpu,key:s.key}});
 const marginColor=u.unitMargin>=0?c.blue:c.red;
 data.push({x:'= маржа на лид',y:[0,u.unitMargin],fillColor:marginColor,label:'Маржа на лид',delta:u.unitMargin,isTotal:true,key:'margin'});
 const options={
  series:[{name:'Экономика на лид',data}],
  chart:{type:'rangeBar',height:340,toolbar:{show:false},fontFamily:chartFont(),background:'transparent',animations:{enabled:true,speed:280}},
  theme:{mode:apexThemeMode()},
  plotOptions:{bar:{horizontal:false,borderRadius:6,columnWidth:'55%'}},
  dataLabels:{enabled:true,formatter:(_,o)=>{const d=data[o.dataPointIndex];return (d.delta>=0?'+':'')+Math.round(d.delta).toLocaleString('ru-RU')+' ₽'},style:{fontSize:'11px',fontWeight:700,colors:[c.text]},offsetY:-22},
  xaxis:{type:'category',labels:{style:{colors:c.muted,fontSize:'12px'}}},
  yaxis:{labels:{style:{colors:c.muted,fontSize:'11px'},formatter:v=>Math.round(v).toLocaleString('ru-RU')+' ₽'},title:{text:'₽ на лид',style:{color:c.muted,fontSize:'11px',fontWeight:600}}},
  grid:{borderColor:c.line+'55',strokeDashArray:4},
  legend:{show:false},
  annotations:{yaxis:[{y:0,strokeDashArray:0,borderColor:c.line,opacity:.6}]},
  tooltip:{theme:apexThemeMode(),custom:({dataPointIndex})=>{
   const d=data[dataPointIndex];
   const extra=d.isTotal
    ? `<div style="color:${c.muted};margin-top:2px">Окупаемость рекламы: ${u.romi.toFixed(1)}%</div>`
    : (d.key==='cpl'
       ? `<div style="color:${c.muted};margin-top:2px">всего лидов: ${fmt(u.totalLeads)}</div>`
       : `<div style="color:${c.muted};margin-top:2px">Доля: ${(d.share*100).toFixed(1)}% · выручка на пользователя: ${money(d.arpu)}</div>`);
   return `<div style="padding:8px 12px;font-size:12px"><div style="font-weight:800;margin-bottom:4px">${escapeHtml(d.label)}</div><div>${(d.delta>=0?'+':'')+money(d.delta)} / лид</div>${extra}</div>`;
  }},
  responsive:[{breakpoint:768,options:{chart:{height:260},plotOptions:{bar:{columnWidth:'80%'}},dataLabels:{style:{fontSize:'10px'},offsetY:-18}}}]
 };
 apexInstances.waterfall=new ApexCharts(host,options);
 apexInstances.waterfall.render();
}
// TZ §5.4 — Интерактивный симулятор «Что, если?».
// 3 ползунка: ΔCPL (-50..0%) · ΔShare_Target (+0..+5 п.п.) · ΔARPU_Rejected (×1..×2).
// OnInput: пересчёт Data Engine + live-обновление KPI карточек, Waterfall и блока LTV/CAC, без перезагрузки.
const SIM_STATE={cplDelta:0,shareTargetAbs:0,arpuRejectedMul:1};
function renderLtvCacSimulator(model){
 const host=document.getElementById('ltvCacSimulator');
 if(!host)return;
 disposeApex('ltvCac');
 host.innerHTML='';
 const m=model||buildUnitModel();
 host.innerHTML=`
  <div class="sim-grid">
   <div class="sim-sliders">
    <div class="sim-row" data-sim-key="cplDelta">
     <div class="sim-row-head"><span class="sim-row-label">Снизить стоимость лида</span><span class="sim-row-val" id="simValCpl">0%</span></div>
     <input type="range" class="sim-range" min="-50" max="0" step="1" value="${Math.round(SIM_STATE.cplDelta*100)}" data-sim="cplDelta" aria-label="Изменение стоимости лида в процентах">
     <div class="sim-row-meta"><span>−50%</span><span>0%</span></div>
    </div>
    <div class="sim-row" data-sim-key="shareTargetAbs">
     <div class="sim-row-head"><span class="sim-row-label">Повысить долю целевых ЦФ</span><span class="sim-row-val" id="simValShare">+0 п.п.</span></div>
     <input type="range" class="sim-range" min="0" max="5" step="0.1" value="${(SIM_STATE.shareTargetAbs*100).toFixed(1)}" data-sim="shareTargetAbs" aria-label="Прирост доли целевых ЦФ в процентных пунктах">
     <div class="sim-row-meta"><span>+0 п.п.</span><span>+5 п.п.</span></div>
    </div>
    <div class="sim-row" data-sim-key="arpuRejectedMul">
     <div class="sim-row-head"><span class="sim-row-label">Увеличить выручку с отказов</span><span class="sim-row-val" id="simValArpu">×1.00</span></div>
     <input type="range" class="sim-range" min="100" max="200" step="5" value="${Math.round(SIM_STATE.arpuRejectedMul*100)}" data-sim="arpuRejectedMul" aria-label="Множитель выручки с отказов">
     <div class="sim-row-meta"><span>×1.0</span><span>×2.0</span></div>
    </div>
    <button class="action sim-reset" type="button" id="simReset">Сбросить</button>
   </div>
   <div class="sim-output" id="simOutput"></div>
  </div>`;
 const refresh=()=>{
  const u=perLeadFromModel(m,SIM_STATE);
  const ub=perLeadFromModel(m,null);
  const out=document.getElementById('simOutput');
  if(out){
   const dMargin=u.unitMargin-ub.unitMargin;
   const dRomi=u.romi-ub.romi;
   const breakeven=u.unitMargin>=0;
   const reachStr=breakeven?'Точка безубыточности пройдена':'До безубыточности не хватает '+money(-u.unitMargin)+' / лид';
   out.innerHTML=`
    <div class="sim-out-row"><span>Стоимость лида</span><b class="negative">${money(u.cpl)}</b><span class="sim-delta ${u.cpl<ub.cpl?'good':u.cpl>ub.cpl?'bad':'warn'}">${u.cpl===ub.cpl?'•':((u.cpl<ub.cpl?'−':'+')+money(Math.abs(u.cpl-ub.cpl)))}</span></div>
    <div class="sim-out-row"><span>Средняя выручка на лид</span><b class="positive">${money(u.blendedArpu)}</b><span class="sim-delta ${u.blendedArpu>ub.blendedArpu?'good':u.blendedArpu<ub.blendedArpu?'bad':'warn'}">${u.blendedArpu===ub.blendedArpu?'•':((u.blendedArpu>ub.blendedArpu?'+':'−')+money(Math.abs(u.blendedArpu-ub.blendedArpu)))}</span></div>
    <div class="sim-out-row sim-out-row-strong"><span>Маржа на лид</span><b class="${u.unitMargin>=0?'positive':'negative'}">${money(u.unitMargin)}</b><span class="sim-delta ${dMargin>0?'good':dMargin<0?'bad':'warn'}">${dMargin===0?'•':((dMargin>0?'+':'−')+money(Math.abs(dMargin)))}</span></div>
    <div class="sim-out-row sim-out-row-strong"><span>Окупаемость рекламы</span><b class="${u.romi>=0?'positive':'negative'}">${u.romi.toFixed(1)}%</b><span class="sim-delta ${dRomi>0?'good':dRomi<0?'bad':'warn'}">${dRomi===0?'•':((dRomi>0?'+':'')+dRomi.toFixed(1)+' п.п.')}</span></div>
    <div class="sim-breakeven ${breakeven?'is-good':'is-bad'}"><span class="status-dot ${breakeven?'status-success':'status-danger'}"></span>${escapeHtml(reachStr)}</div>
    <div class="sim-formula">Средняя выручка на лид = Σ доля ветки × выручка на пользователя · Маржа на лид = средняя выручка на лид − стоимость лида · Окупаемость рекламы = маржа / стоимость лида × 100%</div>`;
  }
  document.getElementById('simValCpl').textContent=(SIM_STATE.cplDelta*100).toFixed(0)+'%';
  document.getElementById('simValShare').textContent='+'+(SIM_STATE.shareTargetAbs*100).toFixed(1)+' п.п.';
  document.getElementById('simValArpu').textContent='×'+SIM_STATE.arpuRejectedMul.toFixed(2);
  // Live-обновление Waterfall с теми же оверрайдами.
  renderPnlWaterfall(m,SIM_STATE);
 };
 host.querySelectorAll('input[data-sim]').forEach(inp=>{
  inp.addEventListener('input',e=>{
   const k=e.target.dataset.sim;const v=Number(e.target.value);
   if(k==='cplDelta')SIM_STATE.cplDelta=v/100;
   else if(k==='shareTargetAbs')SIM_STATE.shareTargetAbs=v/100;
   else if(k==='arpuRejectedMul')SIM_STATE.arpuRejectedMul=v/100;
   refresh();
  });
 });
 const reset=document.getElementById('simReset');
 if(reset)reset.addEventListener('click',()=>{
  SIM_STATE.cplDelta=0;SIM_STATE.shareTargetAbs=0;SIM_STATE.arpuRejectedMul=1;
  host.querySelectorAll('input[data-sim]').forEach(inp=>{
   const k=inp.dataset.sim;
   inp.value=k==='cplDelta'?0:k==='shareTargetAbs'?0:100;
  });
  refresh();
 });
 refresh();
}
// TZ §5.5 — Сортируемая таблица юнит-экономики с heatmap по ROMI.
const unitTableSort={key:'romi',dir:'desc'};
function romiHeatClass(r){if(!Number.isFinite(r))return 'romi-mid';if(r>=50)return 'romi-hot';if(r>=15)return 'romi-warm';if(r>=0)return 'romi-mid';if(r>=-30)return 'romi-cool';return 'romi-cold'}
function renderUnitTable(model){
 const el=document.getElementById('unitTable');
 if(!el)return;
 const m=model||buildUnitModel();
 const u=perLeadFromModel(m);
 const COLS=[
  {key:'name',label:'Источник',render:b=>escapeHtml(b.name)},
  {key:'leads',label:'Лиды',numeric:true,render:b=>fmt(b.traffic),getVal:b=>b.traffic},
  {key:'cpl',label:'Стоимость лида',numeric:true,render:b=>money(b.cost/Math.max(1,b.traffic)),getVal:b=>b.cost/Math.max(1,b.traffic)},
  {key:'share',label:'Доля ветки',numeric:true,render:b=>pct((u.shares[b.id]||0)*100),getVal:b=>(u.shares[b.id]||0)},
  {key:'arpu',label:'Выручка на пользователя',numeric:true,render:b=>money(b.arpu)},
  {key:'unitMargin',label:'Маржа на лид',numeric:true,render:b=>{const v=b.arpu-(b.cost/Math.max(1,b.traffic));return `<span class="${v>=0?'positive':'negative'}">${money(v)}</span>`},getVal:b=>b.arpu-(b.cost/Math.max(1,b.traffic))},
  {key:'romi',label:'Окупаемость рекламы',numeric:true,render:b=>`<span class="romi-cell ${romiHeatClass(b.romi)}">${b.romi.toFixed(1)}%</span>`},
  {key:'status',label:'Статус',render:b=>{const s=statusFor(b.romi);return `<span class="status-cell"><span class="status-dot ${s.dotClass}"></span>${escapeHtml(s.recommendation)}</span>`}}
 ];
 const rows=m.cjm_branches.slice();
 const col=COLS.find(c=>c.key===unitTableSort.key)||COLS[6];
 const getVal=(b)=>col.getVal?col.getVal(b):b[col.key];
 if(col.numeric)rows.sort((a,b)=>(getVal(a)-getVal(b))*(unitTableSort.dir==='asc'?1:-1));
 else rows.sort((a,b)=>String(getVal(a)||'').localeCompare(String(getVal(b)||''),'ru')*(unitTableSort.dir==='asc'?1:-1));
 const head=COLS.map(c=>{
  const aria=c.key===unitTableSort.key?unitTableSort.dir==='asc'?'ascending':'descending':'none';
  return `<th data-sort-key="${escapeHtml(c.key)}" aria-sort="${aria}" scope="col">${escapeHtml(c.label)}</th>`;
 }).join('');
 const body=rows.map(b=>{
  const st=statusFor(b.romi);
  return `<tr class="${st.rowClass}">`+COLS.map(c=>`<td>${c.render(b)}</td>`).join('')+`</tr>`;
 }).join('');
 el.classList.add('sortable');
 el.innerHTML='<thead><tr>'+head+'</tr></thead><tbody>'+body+'</tbody>';
}
function renderUnitRationale(perLead,model){
 const host=document.getElementById('unitRationale');
 if(!host)return;
 const u=perLead||perLeadFromModel();
 const m=model||buildUnitModel();
 const gm=m.global_metrics;
 const shares=u.shares||{},arpu=u.arpu||{};
 const branch=id=>m.cjm_branches.find(b=>b.id===id)||{};
 const shareLine=(id,name)=>`<li><b>${escapeHtml(name)}</b>: доля ${pct((shares[id]||0)*100)} · выручка на пользователя ${moneyPrec(arpu[id]||0)} · вклад ${moneyPrec((shares[id]||0)*(arpu[id]||0))}</li>`;
 const items=[
  {name:'Стоимость лида',val:moneyPrec(u.cpl),formula:'Стоимость лида = маркетинговый расход ÷ все входящие лиды (визиты)',inputs:[
    `<li>Маркетинговый расход за горизонт: <b>${mln(gm.marketing_spend)}</b> (Директ + SEO + PR)</li>`,
    `<li>Всего лидов: <b>${fmt(u.totalLeads)}</b> — сумма визитов из плана трафика</li>`,
    `<li>Что двигает: бюджеты каналов на вкладке «Обзор», ползунок «Снизить стоимость лида» в симуляторе</li>`
  ]},
  {name:'Средняя выручка',val:moneyPrec(u.blendedArpu),formula:'Средняя выручка на лид = Σ доля ветки × выручка на пользователя по 4 веткам Smart Safe Router',inputs:[
    shareLine('target','Целевые — выдача в ЦФ'),
    shareLine('rejected','Отказы — CPA при отказе'),
    shareLine('noncore','Непрофильные — кросс-офферы'),
    shareLine('overdue','Просрочка — перекредитованные'),
    `<li>Что двигает: тарифы партнёров, доля совпадений с базой ЦФ, множитель LTV, доли веток</li>`
  ]},
  {name:'Маржа на лид',val:moneyPrec(u.unitMargin),formula:'Маржа на лид = средняя выручка на лид − стоимость лида',inputs:[
    `<li>Средняя выручка на лид: <b>${moneyPrec(u.blendedArpu)}</b></li>`,
    `<li>Стоимость лида: <b>${moneyPrec(u.cpl)}</b></li>`,
    `<li>Положительный → каждый «грязный» лид приносит маржу до постоянных затрат</li>`,
    `<li>Что двигает: всё, что влияет на стоимость лида и выручку выше</li>`
  ]},
  {name:'Окупаемость рекламы',val:u.romi.toFixed(1)+'%',formula:'Окупаемость рекламы = маржа на лид ÷ стоимость лида × 100%',inputs:[
    `<li>Текущая окупаемость: <b>${u.romi.toFixed(1)}%</b> · светофор: <b>${escapeHtml(statusFor(u.romi).recommendation)}</b></li>`,
    `<li>Пороги: ≥ 50% — масштабировать, 0..50% — оптимизировать, < 0% — стоп</li>`,
    `<li>MoM-тренд по последним месяцам: расход ${gm.trends.spend===null?'n/a':gm.trends.spend.toFixed(1)+'%'} · выручка ${gm.trends.revenue===null?'n/a':gm.trends.revenue.toFixed(1)+'%'} · маржа ${gm.trends.margin===null?'n/a':gm.trends.margin.toFixed(1)+'%'}</li>`
  ]}
 ];
 host.innerHTML=items.map(it=>`<div class="unit-rationale-item">`+
  `<div class="uri-head"><span class="uri-name">${escapeHtml(it.name)}</span><span class="uri-val">${escapeHtml(it.val)}</span></div>`+
  `<div class="uri-formula">${escapeHtml(it.formula)}</div>`+
  `<ul>${it.inputs.join('')}</ul>`+
 `</div>`).join('');
 const foot=document.getElementById('unitRationaleFoot');
 if(foot){
  foot.innerHTML=`Все значения пересчитываются из текущего дашборда и CJM: план трафика, воронка, тарифы партнёров, доля совпадений с базой ЦФ, множитель LTV и доли веток. Если число выглядит «застывшим» — проверьте срез <b>«Все каналы / Все сценарии»</b> и примените изменения в целевой модели.`;
 }
}
function renderDataStatusList(){
 const items=[
  ['Режим данных',DATA_SOURCE.modeLabel],
  ['Источник',DATA_SOURCE.source],
  ['Последнее обновление',DATA_SOURCE.updatedAt],
  ['Статус среза',state.scenario==='Все сценарии'&&state.channel==='Все каналы'?'полный срез':'неполный срез по фильтру'],
  ['Роль-фокус',activeRoleProfile().summary],
  ['Ошибки',DATA_SOURCE.errorState]
 ];
 document.getElementById('dataStatusList').innerHTML=items.map(r=>`<div class="mini-row"><span>${escapeHtml(r[0])}</span><b>${escapeHtml(r[1])}</b></div>`).join('');
}
function renderPriorityList(){
 const filtered=filterContext(priorityCatalog);
 document.getElementById('priorityList').innerHTML=(filtered.length?filtered:priorityCatalog.slice(0,3)).slice(0,4).map(item=>`<div class="mini-row" ${drillAttrs('priority',item.id)}><span><span class="status ${item.severity==='bad'?'red':item.severity==='warn'?'yellow':'green'}"></span> ${escapeHtml(item.title)}</span><b>${escapeHtml(item.owner)}</b></div>`).join('');
}
function renderCharts(){
 const c=chartColors();
 const ids=activeChartIds();
 ids.forEach(id=>{if(charts[id]){charts[id].destroy();delete charts[id]}});
 const labels=sliceWindow(shortMonths);
 const ch=resolveChannelSeries();
 const fRev=ch.rev, fCost=ch.cost, fProfit=fRev.map((v,i)=>v-fCost[i]);
 const fCumRev=cumulative(fRev), fCumCost=cumulative(fCost), fCumProfit=cumulative(fProfit);
 const isAllChannels=state.channel==='Все каналы'&&selectedChannelKeys().length===4;
 const isRepeatOnly=selectedChannelKeys().length===1&&selectedChannelKeys()[0]==='Повторный';
 let retFirst,retRepeat;
 if(isAllChannels){retFirst=revenueFirstTime;retRepeat=revenueRepeat}
 else if(isRepeatOnly){retFirst=fRev.map(()=>0);retRepeat=fRev.slice()}
 else{retFirst=fRev.slice();retRepeat=fRev.map(()=>0)}
 const cfg={
  chartOverview:{type:'bar',data:{labels,datasets:[{label:'Выручка ('+ch.label+')',data:sliceWindow(fRev).map(v=>v/1000),backgroundColor:c.green+'cc'},{label:'Расходы',data:sliceWindow(fCost).map(v=>v/1000),backgroundColor:c.red+'99'},{label:'Прибыль',type:'line',data:sliceWindow(fProfit).map(v=>v/1000),borderColor:c.blue,borderWidth:2.5,pointRadius:3}]}},
  chartInvestment:{type:'line',data:{labels,datasets:[{label:'Накопленная выручка',data:sliceWindow(fCumRev).map(v=>v/1000000),borderColor:c.green,borderWidth:2.5},{label:'Накопленные инвестиции',data:sliceWindow(fCumCost).map(v=>v/1000000),borderColor:c.red,borderWidth:2.5},{label:'Накопленная прибыль',data:sliceWindow(fCumProfit).map(v=>v/1000000),borderColor:c.blue,backgroundColor:c.blue+'22',fill:true,borderWidth:2.5}]},annotations:paybackGrowthStartIndex>=0?[{index:paybackGrowthStartIndex,color:c.blue,label:'Начало роста окупаемости · '+(months[paybackGrowthStartIndex]||'')}]:[]},
  chartTraffic:isAllChannels?{type:'bar',stacked:true,data:{labels,datasets:[{label:'SEO',data:sliceWindow(trafficSEO),backgroundColor:c.green+'cc'},{label:'Директ',data:sliceWindow(trafficPPC),backgroundColor:c.blue+'cc'},{label:'PR',data:sliceWindow(trafficPR),backgroundColor:c.violet+'cc'},{label:'Повторы',data:sliceWindow(repeat),backgroundColor:c.orange+'cc'}]}}:{type:'bar',data:{labels,datasets:[{label:'Трафик: '+ch.label,data:sliceWindow(ch.traffic),backgroundColor:c.blue+'cc'}]}},
  chartEpc:{type:'line',data:{labels,datasets:[{label:'EPC ('+ch.label+'), ₽',data:sliceWindow(ch.epc),borderColor:c.blue,backgroundColor:c.blue+'22',fill:true,borderWidth:2.5,pointRadius:3}]}},
  chartRetention:{type:'bar',stacked:true,data:{labels,datasets:[{label:'Выручка с первой сделки, тыс. ₽',data:sliceWindow(retFirst).map(v=>v/1000),backgroundColor:c.green+'cc'},{label:'Выручка с повторов / CRM, тыс. ₽',data:sliceWindow(retRepeat).map(v=>v/1000),backgroundColor:c.orange+'cc'},{label:'Повторные визиты',type:'line',data:sliceWindow(repeat),borderColor:c.violet,borderWidth:2}]}},
  chartUnit:(function(){
   // TZ §4.2: столбцы выручки/расхода + линия окупаемости рекламы.
   const model=buildUnitModel();
   const labels2=model.monthly.labels.slice();
   const rev=model.monthly.revenue;
   const spend=model.monthly.spend;
   const romi=model.monthly.romi;
   const barMaxThs=Math.max(1,...rev.map(v=>v/1000),...spend.map(v=>v/1000));
   const romiMagn=Math.max(...romi.map(v=>Math.abs(v)),1);
   const lineScale=barMaxThs/romiMagn;
   return {type:'bar',data:{labels:labels2,datasets:[
    {label:'Выручка, тыс. ₽',data:rev.map(v=>v/1000),backgroundColor:c.green+'cc',tooltipFormat:v=>shortNum(v*1000)+' ₽'},
    {label:'Расход, тыс. ₽',data:spend.map(v=>v/1000),backgroundColor:c.red+'99',tooltipFormat:v=>shortNum(v*1000)+' ₽'},
    {label:'Окупаемость рекламы, %',type:'line',data:romi.map(v=>v*lineScale),borderColor:c.blue,borderWidth:2.5,pointRadius:3,tooltipFormat:(_,i)=>(romi[i]||0).toFixed(1)+'%'}
   ]}};
  })(),
  chartCacChannels:(function(){const cc=channelCac();const order=['SEO','Яндекс.Директ','PR','Повторный','Все каналы'];return {type:'bar',data:{labels:order,datasets:[{label:'CAC, ₽',data:order.map(k=>Math.round(cc[k].cac)),backgroundColor:order.map(k=>k==='Все каналы'?c.muted+'aa':k==='SEO'?c.green+'cc':k==='Яндекс.Директ'?c.blue+'cc':k==='PR'?c.violet+'cc':c.orange+'cc')}]}}})(),
  chartCostMix:{type:'bar',stacked:true,data:{labels,datasets:COST_ITEMS.map(item=>({label:item.label,data:sliceWindow(item.data).map(v=>v/1000),backgroundColor:c[item.color]+'cc'}))}},
  chartProducts:{type:'line',data:{labels,datasets:[{label:'Микрозаймы',data:sliceWindow(productSeries.mfo).map(v=>v/1000000),borderColor:c.blue,borderWidth:2.5},{label:'Кредиты',data:sliceWindow(productSeries.loan).map(v=>v/1000000),borderColor:c.green,borderWidth:2.5},{label:'Карты',data:sliceWindow(productSeries.card).map(v=>v/1000000),borderColor:c.violet,borderWidth:2.5},{label:'Страхование',data:sliceWindow(productSeries.insurance).map(v=>v/1000000),borderColor:c.orange,borderWidth:2},{label:'Повторы / кросс',data:sliceWindow(productSeries.repeat).map(v=>v/1000000),borderColor:c.red,borderWidth:2}]}},
  chartTargetScenario:(function(){const t=targetRevenueSeries();return {type:'line',data:{labels,datasets:[{label:'Базовый план, тыс. ₽',data:revenue.map(v=>v/1000),borderColor:c.blue,borderWidth:2.5,backgroundColor:c.blue+'22',fill:true},{label:'Целевая траектория к 40 млн ₽/мес',data:t.map(v=>v/1000),borderColor:c.green,borderWidth:2.5,backgroundColor:c.green+'22',fill:false},{label:'Цель: 40 млн ₽',type:'line',data:revenue.map(()=>TARGET_DEC_2027_REVENUE/1000),borderColor:c.violet,borderWidth:1.5}]}}})()
 };
 ids.forEach(id=>{const el=document.getElementById(id);if(el&&cfg[id])charts[id]=new Chart(el,cfg[id])});
}
const ACQUISITION_ROWS=[
 {key:'SEO',roles:['Рост','Руководитель'],channels:['SEO'],row:['SEO / органика','__seoSessions__','__seoUnique__','35%','35%','30.9%','__seoRev__','108 ₽','246 ₽','75%']},
 {key:'Яндекс.Директ',roles:['Рост','Руководитель'],channels:['Яндекс.Директ'],row:['Яндекс / CPC','__ppcSessions__','__ppcUnique__','27%','21.1%','24.2%','__directRev__','99 ₽','2 176 ₽','13%']},
 {key:'PR',roles:['Рост','Операции','Руководитель'],channels:['PR'],row:['PR / медиа','__prSessions__','__prUnique__','45%','35%','40%','__prRev__','280 ₽','1 432 ₽','28%']},
 {key:'Повторный',roles:['CRM','Руководитель'],channels:['Повторный'],row:['CRM / повторные','__repeatSessions__','__repeatUnique__','34%','28%','36%','__repeatRev__','112 ₽','0 ₽','∞']}
];
const UNIT_ROWS=[
 {key:'SEO',roles:['Рост','Руководитель'],build:t=>['SEO','CPA + прямой API',mln(t.seoRevenue),mln(t.seoSpend),mln(t.seoRevenue-t.seoSpend),'108 ₽','246 ₽','6.1x','4.2 мес',mln(t.seoRevenue-t.seoSpend)]},
 {key:'Яндекс.Директ',roles:['Рост','Руководитель'],build:t=>['Яндекс Директ','CPA + прямой API',mln(t.directRevenue),mln(t.directSpend),mln(t.directRevenue-t.directSpend),'99 ₽','1 701 ₽','1.8x','8.9 мес',mln(t.directRevenue-t.directSpend)]},
 {key:'PR',roles:['Операции','Рост','Руководитель'],build:t=>['PR','CPA',mln(t.prRevenue),mln(t.prSpend),mln(t.prRevenue-t.prSpend),'280 ₽','1 432 ₽','2.2x','7.1 мес',mln(t.prRevenue-t.prSpend)]},
 {key:'Повторный',roles:['CRM','Руководитель'],build:_=>['Повторы','прямой API + кросс-продажи',mln(5961100),'0 ₽',mln(5961100),'112 ₽','0 ₽','∞','в тот же день',mln(5961100)]}
];
function buildMetricDrawer(id){
 const ch=resolveChannelSeries();
 const issued=Math.round(totals.approvals*modelInputs.issuedToApprovalRate);
 const cac=ratio(sum(ch.cost),Math.max(1,issued));
 const repeatShare=ratio(REPEAT_REVENUE_TOTAL,totals.revenue);
 const metricMap={
  'revenue':{title:'Выручка',summary:`Активный фокус: ${ch.label}.`,formula:'Выручка = сумма комиссионной и повторной выручки по активному срезу.',rows:[['Весь план',mln(sum(sliceWindow(ch.rev)))],['Первая половина горизонта',mln(comparePeriods(ch.rev).previous||0)],['Источник',DATA_SOURCE.source]],actions:['Сравнить вклад каналов и сценариев','Не масштабировать каналы с падающим approval']},
  'cac':{title:'CAC',summary:'Стоимость привлечения клиента в активном канале / роли.',formula:'CAC = расходы / первые выдачи.',rows:[['Текущий CAC',Math.round(cac).toLocaleString('ru-RU')+' ₽'],['Цель',Math.round((sum(ch.rev)/Math.max(1,issued))*0.33).toLocaleString('ru-RU')+' ₽'],['Что делать','резать дорогие группы и чинить approval gap']],actions:['Проверить вклад Директа и PR','Сопоставить с LTV и payback']},
  'ltv-cac':{title:'LTV / CAC',summary:'Главный запас прочности по unit-экономике.',formula:'LTV / CAC = (LTV на пользователя с повторами) / CAC.',rows:[['Текущее значение',(ratio(totals.revenue,totals.approvals)*modelInputs.ltvFactor/Math.max(cac,1)).toFixed(1)+'x'],['Порог', '3.0x'],['Комментарий','ниже порога — не масштабировать']],actions:['Добрать repeat-share','Снизить CAC в PR и Директе']},
  'repeat-share':{title:'Доля повторов',summary:'Показывает устойчивость LTV и силу CRM-цепочек.',formula:'Repeat-share = выручка CRM / общая выручка.',rows:[['Факт',pct(repeatShare*100)],['Цель',pct(modelInputs.targetRepeatShare*100)],['Разрыв',pct((repeatShare-modelInputs.targetRepeatShare)*100)]],actions:['Усилить D+14 и reactivation','Добавить персональные post-approval офферы']}
 };
 return metricMap[id]||{title:id,summary:'Детализация недоступна',formula:'—',rows:[['Источник',DATA_SOURCE.source]],actions:['Проверьте связанный виджет в текущем срезе']};
}
function buildDrawerPayload(kind,id){
 if(kind==='metric'||kind==='formula')return kind==='formula'?{title:'Формула',summary:id,formula:id,rows:[['Роль',state.role],['Источник',DATA_SOURCE.source]],actions:['Используйте формулу как единый reference в обсуждении KPI']} : buildMetricDrawer(id);
 if(kind==='priority'){const item=priorityCatalog.find(x=>x.id===id);if(item)return {title:item.title,summary:item.description,formula:'Источник приоритета: '+item.source,rows:[['Ответственный',item.owner],['Роль-фокус',state.role],['Канал',state.channel]],actions:['Оценить эффект на горизонте плана','Открыть связанный сигнал или партнёра']};}
 if(kind==='scenario'){const item=scenarioCatalog.find(x=>x.id===id);if(item)return {title:item.name,summary:`Ответственный: ${item.owner}. Завершение ${pct(item.completion)} и approval ${pct(item.approval)}.`,formula:'Сценарий оценивается по completion, quality of match, approval и repeat.',rows:[['Пользователи',fmt(item.users)],['Выручка',mln(item.revenue)],['Лучший ответ',item.best]],actions:item.playbook};}
 if(kind==='partner'){const item=partnerCatalog.find(x=>x.id===id);if(item)return {title:item.name,summary:`${item.type}, статус ${item.status}, SLA ${item.sla}.`,formula:'Партнёр оценивается по SLA, approval, eCPA и жалобам.',rows:[['Выручка',mln(item.revenue)],['eCPA',item.ecpa+' ₽'],['Жалобы',pct(item.complaints)]],actions:item.plan};}
 if(kind==='alert'){const item=alertCatalog.find(x=>x.id===id);if(item)return {title:item.entity,summary:item.reason,formula:'Сигнал появляется, когда метрика уходит за контрольный порог.',rows:[['Серьёзность',item.severity==='red'?'критично':item.severity==='yellow'?'внимание':'норма'],['Роль',item.roles.join(', ')],['Действие',item.action]],actions:['Подтвердить сигнал на витрине','Назначить владельца и дедлайн']};}
 if(kind==='experiment'){const item=experimentCatalog.find(x=>x.id===id);if(item)return {title:item.name,summary:`${item.result} при уверенности ${item.confidence}.`,formula:`Primary: ${item.primary}; guardrail: ${item.guardrail}.`,rows:[['Сегмент',item.segment],['Статус',item.status],['Канал',item.channels.join(', ')]],actions:['Проверить guardrail до раскатки','Сохранить решение в backlog']};}
 return {title:'Детализация',summary:'Для этого элемента нет расширенной карточки.',formula:'Источник: встроенная витрина.',rows:[['Роль',state.role],['Канал',state.channel],['Сценарий',state.scenario]],actions:['Смените фильтр или выберите другой элемент']};
}
function openDrawer(kind,id){
 const drawer=document.getElementById('drawer'),content=document.getElementById('drawerContent');
 if(!drawer||!content)return;
 const payload=buildDrawerPayload(kind,id);
 lastDrawerFocus=document.activeElement;
 const rows=(payload.rows||[]).map(r=>`<div class="mini-row"><span>${escapeHtml(r[0])}</span><b>${escapeHtml(r[1])}</b></div>`).join('');
 const actions=(payload.actions||[]).map(x=>`<div class="mini-row"><span>${escapeHtml(x)}</span><b>следующий шаг</b></div>`).join('');
 content.innerHTML=`<h2 id="drawerTitle">${escapeHtml(payload.title)}</h2><p class="muted">${escapeHtml(payload.summary)}</p><div class="drawer-section"><div class="section-note">Как считается</div><div class="note-banner">${escapeHtml(payload.formula||'—')}</div></div><div class="drawer-section"><div class="section-note">Ключевые значения</div><div class="drawer-list">${rows}</div></div><div class="drawer-section"><div class="section-note">Что делать</div><div class="drawer-list">${actions}</div></div>`;
 drawer.classList.add('open');
 drawer.focus();
 requestAnimationFrame(()=>drawer.querySelector('.drawer-close')?.focus());
}
function canRestoreFocus(element){return !!(element&&document.contains(element)&&typeof element.focus==='function'&&!element.disabled&&element.offsetParent!==null)}
function closeDrawer(){const drawer=document.getElementById('drawer');if(!drawer)return;drawer.classList.remove('open');if(canRestoreFocus(lastDrawerFocus))lastDrawerFocus.focus()}
function renderContextualViews(){
 const ch=resolveChannelSeries();
 const approvalRate=ratio(totals.approvals,totals.applications)*100;
 const issued=Math.round(totals.approvals*modelInputs.issuedToApprovalRate);
 const gross=sum(sliceWindow(ch.rev))-sum(sliceWindow(ch.cost));
 const cac=ratio(sum(sliceWindow(ch.cost)),Math.max(1,issued));
 const ltv=ratio(totals.revenue,totals.approvals)*modelInputs.ltvFactor;
 const repeatShare=ratio(REPEAT_REVENUE_TOTAL,totals.revenue);
 const maxDrawdown=Math.min(...cumulativeProfit);
 const revCompare=comparePeriods(ch.rev), costCompare=comparePeriods(ch.cost), repeatCompare=comparePeriods(repeat);
 document.getElementById('inputDataList').innerHTML=buildInputData(ch).map(x=>`<div class="card tight"><div class="metric-label">${escapeHtml(x.title)}</div><div class="metric-value">${escapeHtml(x.value)}</div><div class="metric-sub">${escapeHtml(x.text)}</div></div>`).join('');
 const cacByApproval=ratio(sum(sliceWindow(ch.cost)),Math.max(1,totals.approvals));
 document.getElementById('assumptionSummary').innerHTML=[['Выдачи по модели',fmt(issued)],['LTV по модели',Math.round(ltv).toLocaleString('ru-RU')+' ₽'],['CAC = инвестиции / одобрения',Math.round(cacByApproval).toLocaleString('ru-RU')+' ₽'],['Цель по повторам',pct(modelInputs.targetRepeatShare*100)],['Выплата за оформление (фикс)',fmt(partnerPayoutValue())+' ₽']].map(r=>`<div class="mini-row"><span>${r[0]}</span><b>${r[1]}</b></div>`).join('');
 document.getElementById('recentActions').innerHTML=recentActions.length?recentActions.map(item=>`<div class="mini-row"><span>${escapeHtml(item.text)}</span><b>${escapeHtml(item.time)}</b></div>`).join(''):'<div class="mini-row"><span>Изменений ещё не сохраняли</span><b>локально</b></div>';
 const committeeCards=[
  {id:'revenue',tone:'good',tag:'окупаемость',label:'Начало роста окупаемости',value:months[paybackGrowthStartIndex]||'—',sub:'месяц, с которого накопленный PnL растёт по PnL'},
  {id:'ltv-cac',tone:ltv/cac>=3?'good':'warn',tag:'unit',label:'Запас LTV / CAC',value:(ltv/cac).toFixed(1)+'x',sub:'цель выше 3.0x'},
  {id:'repeat-share',tone:repeatShare>=modelInputs.targetRepeatShare?'good':'warn',tag:'retention',label:'Доля повторной выручки',value:pct(repeatShare*100),sub:'цель '+pct(modelInputs.targetRepeatShare*100)},
  {id:'cac',tone:'warn',tag:'capital',label:'Пиковый капитал',value:mln(Math.abs(maxDrawdown)),sub:'максимальная нагрузка на фондирование'}
 ];
 document.getElementById('committeeGrid').innerHTML=committeeCards.map(x=>`<div class="exec-card ${x.tone}" ${drillAttrs('metric',x.id)}><span class="tag">${escapeHtml(x.tag)}</span><div class="metric-label">${escapeHtml(x.label)}</div><div class="metric-value">${escapeHtml(x.value)}</div><div class="metric-sub">${escapeHtml(x.sub)}</div></div>`).join('');
 const cc=channelCac();
 const channelByRoi=[['SEO',totals.seoRevenue,totals.seoSpend],['Яндекс.Директ',totals.directRevenue,totals.directSpend],['PR',totals.prRevenue,totals.prSpend]].map(([n,r,s])=>({n,r,s,roi:s?(r-s)/s:0,roas:s?r/s:0}));
 const topChannel=channelByRoi.slice().sort((a,b)=>b.roi-a.roi)[0];
 const weakChannel=channelByRoi.slice().sort((a,b)=>a.roi-b.roi)[0];
 const yoy=revenue[0]?(revenue[revenue.length-1]/revenue[0]):0;
 const profitSeries=ch.rev.map((v,i)=>v-ch.cost[i]);
 const profitCompare=comparePeriods(profitSeries);
 document.getElementById('execGrid').innerHTML=[
  {id:'revenue',tone:'good',tag:'итог',label:'Прибыль за весь план',value:mln(sum(sliceWindow(ch.rev))-sum(sliceWindow(ch.cost))),sub:'рост 2-й половины к 1-й '+(formatDelta(profitCompare.delta)?.text||'—')},
  {id:'revenue',tone:'good',tag:'безубыточность',label:'Первый прибыльный месяц',value:months[firstMonthlyProfitIndex]||'—',sub:'месячная маржа уже положительная'},
  {id:'revenue',tone:'good',tag:'окупаемость',label:'Возврат инвестиций',value:months[paybackIndex]||'—',sub:'когда покроется накопленный минус'},
  {id:'cac',tone:'warn',tag:'cash burn',label:'Максимальный накопленный минус',value:mln(maxDrawdown),sub:'пиковая нагрузка на капитал до выхода в плюс'},
  {id:'revenue',tone:'good',tag:'лидер',label:'Лучший канал по ROI',value:topChannel.n,sub:'ROAS '+topChannel.roas.toFixed(1)+'x · ROI '+pct(topChannel.roi*100)},
  {id:'cac',tone:'warn',tag:'слабое звено',label:'Канал с худшим ROI',value:weakChannel.n,sub:'ROAS '+weakChannel.roas.toFixed(1)+'x · ROI '+pct(weakChannel.roi*100)},
  {id:'ltv-cac',tone:'good',tag:'юнит',label:'LTV / CAC',value:(ltv/Math.max(cac,1)).toFixed(1)+'x',sub:'LTV '+Math.round(ltv).toLocaleString('ru-RU')+' ₽ · CAC '+Math.round(cac).toLocaleString('ru-RU')+' ₽'},
  {id:'revenue',tone:'good',tag:'рост',label:'Темп роста выручки',value:'×'+yoy.toFixed(1),sub:'декабрь 2027 к июлю 2026'}
 ].map(x=>`<div class="exec-card ${x.tone}" ${drillAttrs('metric',x.id)}><span class="tag">${escapeHtml(x.tag)}</span><div class="metric-label">${escapeHtml(x.label)}</div><div class="metric-value">${escapeHtml(x.value)}</div><div class="metric-sub">${escapeHtml(x.sub)}</div></div>`).join('');
 kpi('kpiGrid',[
  {id:'revenue',label:'Пользователи / сессии',value:fmt(sum(sliceWindow(ch.traffic))),sub:`${activeRoleProfile().label.toLowerCase()} · ${ch.label}`},
  {id:'revenue',label:'Отправленные заявки',value:fmt(totals.applications),sub:'CR в заявку '+pct(ratio(totals.applications,totals.visits)*100)},
  {id:'revenue',label:'Доля одобрений',value:pct(approvalRate),sub:fmt(totals.approvals)+' одобрений',cls:'positive'},
  {id:'revenue',label:'Выданные сделки',value:fmt(issued),sub:'оценка выдач = '+pct(modelInputs.issuedToApprovalRate*100)+' одобрений'},
  {id:'revenue',label:'Выручка',value:mln(sum(sliceWindow(ch.rev))),sub:'источник данных — '+DATA_SOURCE.modeLabel,cls:'positive',delta:formatDelta(revCompare.delta)},
  {id:'revenue',label:'EPC',value:Math.round(ratio(sum(sliceWindow(ch.rev)),Math.max(1,sum(sliceWindow(channelClicksMap[selectedChannelKeys()[0]]||offerClicks)))))+' ₽',sub:'выручка / клики на офферы',cls:'positive'},
  {id:'cac',label:'CAC',value:Math.round(cac)+' ₽',sub:'расходы / выданные сделки',cls:'negative',delta:formatDelta(costCompare.delta)},
  {id:'ltv-cac',label:'LTV / CAC',value:(ltv/Math.max(cac,1)).toFixed(1)+'x',sub:'LTV учитывает повторы и кросс-продажи',cls:'positive'},
  {id:'repeat-share',label:'Доля повторов',value:pct(repeatShare*100),sub:'цель '+pct(modelInputs.targetRepeatShare*100),delta:formatDelta(repeatCompare.delta)},
  {id:'revenue',label:'Валовая прибыль',value:mln(gross),sub:'выручка минус расходы',cls:'positive'},
  {id:'revenue',label:'Маржинальность',value:pct(ratio(gross,Math.max(1,sum(sliceWindow(ch.rev))))*100),sub:'маржинальность за весь план',cls:'positive'},
  {id:'revenue',label:'PnL',value:mln(totals.profit),sub:'нарастающим итогом',cls:'positive'}
 ]);
 document.getElementById('paybackList').innerHTML=[['Начало роста окупаемости',months[paybackGrowthStartIndex]||'—'],['Первая месячная прибыль',months[firstMonthlyProfitIndex]||'—'],['Окупаемость накопленных инвестиций',months[paybackIndex]||'—'],['Максимальный накопленный минус',mln(Math.min(...cumulativeProfit))],['Финальный накопленный PnL',mln(totals.profit)]].map((r,i,arr)=>`<div class="mini-row"><span><span class="status ${i===arr.length-1?'green':i===arr.length-2?'red':'yellow'}"></span> ${r[0]}</span><b>${r[1]}</b></div>`).join('');
 const priorities=filterContext(priorityCatalog);
 document.getElementById('actionsList').innerHTML=(priorities.length?priorities:priorityCatalog.slice(0,4)).map(item=>`<div class="mini-row" ${drillAttrs('priority',item.id)}><span><span class="status ${item.severity==='bad'?'red':item.severity==='warn'?'yellow':'green'}"></span> ${escapeHtml(item.title)}</span><b>${escapeHtml(item.description)}</b></div>`).join('');
 const pnlRows=[['Выручка — итого',...revenue.map(money),money(totals.revenue)],['  · SEO',...revenueSEO.map(money),money(totals.seoRevenue)],['  · Яндекс.Директ',...revenuePPC.map(money),money(totals.directRevenue)],['  · PR',...revenuePR.map(money),money(totals.prRevenue)],['  · в т.ч. повторы / CRM',...revenueRepeat.map(money),money(REPEAT_REVENUE_TOTAL)],['Расходы — итого',...expenses.map(money),money(totals.expenses)],['  · Яндекс.Директ',...budgetDirect.map(money),money(sum(budgetDirect))],['  · SEO',...budgetSEO.map(money),money(sum(budgetSEO))],['  · PR',...budgetPR.map(money),money(sum(budgetPR))],['  · ФОТ команды',...expensesPayroll.map(money),money(sum(expensesPayroll))],['  · Инфраструктура и прочее',...expensesInfra.map(money),money(sum(expensesInfra))],['Прибыль',...profit.map(v=>money(v)),money(totals.profit)],['Рентабельность (чистая маржа)',...profit.map((v,i)=>pct(ratio(v,revenue[i])*100)),pct(ratio(totals.profit,totals.revenue)*100)],['Визиты',...visits.map(fmt),fmt(totals.visits)],['Клики на офферы',...offerClicks.map(fmt),fmt(totals.clicks)],['Заявки',...applications.map(fmt),fmt(totals.applications)],['Апрувы',...approvals.map(fmt),fmt(totals.approvals)]];
 // Цветовое выделение ключевых строк PnL: выручка, расходы, прибыль и рентабельность; вложенные строки приглушаем.
 const pnlRowClasses=pnlRows.map(r=>{const name=String(r[0]);if(name.startsWith('  ·'))return 'row-sub';if(name.startsWith('Выручка'))return 'row-revenue';if(name.startsWith('Расходы'))return 'row-cost';if(name.startsWith('Прибыль'))return 'row-profit';if(name.startsWith('Рентабельность'))return 'row-margin';return ''});
 table('pnlTable',['Показатель',...months,'Итого'],pnlRows,pnlRowClasses);
 const cacOrder=['SEO','Яндекс.Директ','PR','Повторный','Все каналы'];
 const cacKpiCls={'SEO':'positive','Яндекс.Директ':'negative','PR':'accent','Повторный':'positive','Все каналы':'accent'};
 kpi('cacKpis',cacOrder.map(k=>{const x=cc[k];return {id:'cac',label:'CAC · '+(k==='Все каналы'?'все каналы':k),value:Math.round(x.cac).toLocaleString('ru-RU')+' ₽',sub:'выдач '+fmt(x.issued)+' · бюджет '+mln(x.spend),cls:cacKpiCls[k]}}));
 table('cacTable',['Канал','Выручка','Расход','Выдач','CAC, ₽','LTV, ₽','LTV / CAC','ROAS'],cacOrder.map(k=>{const x=cc[k];const ltvValue=x.issued?(x.rev/x.issued)*modelInputs.ltvFactor:0;const lc=x.cac?ltvValue/x.cac:0;const roas=x.spend?x.rev/x.spend:0;return [k==='Все каналы'?'Все каналы (итого)':k,mln(x.rev),mln(x.spend),fmt(x.issued),Math.round(x.cac).toLocaleString('ru-RU'),Math.round(ltvValue).toLocaleString('ru-RU'),(isFinite(lc)?lc.toFixed(1):'∞')+'x',(isFinite(roas)?roas.toFixed(1):'∞')+'x']}));
 const colorVals=chartColors();
 const totalCost=COST_ITEMS.reduce((acc,it)=>acc+sum(it.data),0)||1;
 const costSums=COST_ITEMS.map(it=>({...it,total:sum(it.data),pct:sum(it.data)/totalCost*100}));
 document.getElementById('costBar').innerHTML=costSums.map(s=>`<span style="flex:${s.total};background:${colorVals[s.color]}"></span>`).join('');
 document.getElementById('costLegend').innerHTML=costSums.map(s=>`<div class="lg"><span><span class="sw" style="background:${colorVals[s.color]}"></span>${escapeHtml(s.label)}</span><b>${mln(s.total)} · ${pct(s.pct)}</b></div>`).join('');
 const productMax=Math.max(...PRODUCT_MIX.map(p=>productTotals[p.key]))||1;
 const productPalette={mfo:colorVals.blue,loan:colorVals.green,card:colorVals.violet,insurance:colorVals.orange,repeat:colorVals.red,other:colorVals.muted};
 document.getElementById('productList').innerHTML=PRODUCT_MIX.map(p=>{const v=productTotals[p.key];const w=v/productMax*100;return `<div class="product-row"><div><div class="pname">${escapeHtml(p.label)}</div><div class="pmeta">${escapeHtml(p.partners)}</div></div><div class="pval">${mln(v)}</div><div class="pval">${pct(p.share*100)}</div><div class="pbar"><span style="width:${w.toFixed(1)}%;background:${productPalette[p.key]}"></span></div></div>`}).join('');
 kpi('trafficKpis',filterByRole([{id:'revenue',roles:['Рост','Руководитель'],label:'Выручка SEO',value:mln(totals.seoRevenue),sub:'ROI 75%',cls:'positive'},{id:'revenue',roles:['Рост','Руководитель'],label:'Выручка Директа',value:mln(totals.directRevenue),sub:'ROI 13%'},{id:'revenue',roles:['Операции','Рост','Руководитель'],label:'Выручка PR',value:mln(totals.prRevenue),sub:'ROI 28%'},{id:'repeat-share',roles:['CRM','Руководитель'],label:'Повторные визиты',value:fmt(totals.repeat),sub:'CAC 0 ₽',cls:'positive'}]));
 ACQUISITION_ROWS[0].row[1]=fmt(sum(trafficSEO));ACQUISITION_ROWS[0].row[2]=fmt(sum(trafficSEO)*.92);ACQUISITION_ROWS[0].row[6]=mln(totals.seoRevenue);
 ACQUISITION_ROWS[1].row[1]=fmt(sum(trafficPPC));ACQUISITION_ROWS[1].row[2]=fmt(sum(trafficPPC)*.88);ACQUISITION_ROWS[1].row[6]=mln(totals.directRevenue);
 ACQUISITION_ROWS[2].row[1]=fmt(sum(trafficPR));ACQUISITION_ROWS[2].row[2]=fmt(sum(trafficPR)*.9);ACQUISITION_ROWS[2].row[6]=mln(totals.prRevenue);
 ACQUISITION_ROWS[3].row[1]=fmt(totals.repeat);ACQUISITION_ROWS[3].row[2]=fmt(totals.repeat*.76);ACQUISITION_ROWS[3].row[6]=mln(REPEAT_REVENUE_TOTAL);
 table('acquisitionTable',['Источник / канал','Сессии','Уникальные пользователи','Кликрейт оффера','Завершение заявки','Одобрение','Выручка','EPC','CAC','ROI / ROMI'],channelRows(filterByRole(ACQUISITION_ROWS)).map(r=>r.row));
 const filteredFlows=filterByRole([{...flows[0],roles:['Продукт','Рост','Руководитель']},{...flows[1],roles:['Продукт','Рост','Руководитель']},{...flows[2],roles:['Операции','CRM','Руководитель']}]);
 // Основная воронка: 8 канонических шагов. Для каждого показываем конверсию к предыдущему шагу
 // и накопленную конверсию от сессий (ширина бара = доля от первого шага).
 const funnelTop=MAIN_FUNNEL[0]||1;
 document.getElementById('mainFunnel').innerHTML=MAIN_FUNNEL.map((val,i)=>{
  const width=Math.max(4,Math.min(100,val/funnelTop*100));
  const stepConv=i===0?100:val/(MAIN_FUNNEL[i-1]||1)*100;
  const topConv=val/funnelTop*100;
  const dropCls=(i>0&&stepConv<60)?' drop':'';
  const stepBadge=i===0?'<span class="conv-badge conv-step">старт</span>':`<span class="conv-badge conv-step${dropCls}">↘ ${pct(stepConv)} к шагу</span>`;
  const topBadge=`<span class="conv-badge conv-top">${pct(topConv)} от сессий</span>`;
  return `<div class="step"><b>${fmt(val)}</b><span class="step-name">${escapeHtml(FUNNEL_STAGES[i])}</span><div class="conv-row">${stepBadge}${topBadge}</div><div class="progress"><div class="bar" style="width:${width.toFixed(1)}%"></div></div></div>`;
 }).join('');
 // Три воронки: одинаковая база сессий, разные конверсии по шагам → видно различие функционала.
 document.getElementById('flowComparison').innerHTML=(filteredFlows.length?filteredFlows:flows).map(f=>{
  let running=f.users;const vals=f.conv.map((c,i)=>{running=i===0?f.users:running*c;return Math.round(running)});
  const maxVal=vals[0]||1;
  const stepsHtml=vals.map((v,i)=>{
   const w=Math.max(2,v/maxVal*100);
   const conv=i===0?'100%':pct(v/(vals[i-1]||1)*100);
   return `<div class="flow-step"><span class="fs-name">${escapeHtml(FUNNEL_STAGES[i])}</span><span class="fs-val">${fmt(v)} · ${conv}</span><span class="fs-track"><span style="width:${w.toFixed(1)}%"></span></span></div>`;
  }).join('');
  const sessToIssue=vals[vals.length-1]/(vals[0]||1)*100;
  const stats=`<div class="scenario-stats"><div class="st"><span>Офферов на показ</span><b>${escapeHtml(String(f.offers))}</b></div><div class="st"><span>Одобрение (от заявок)</span><b>${pct(f.approval)}</b></div><div class="st"><span>Выдача (от одобрений)</span><b>${pct(f.issued)}</b></div><div class="st"><span>Сессия → выдача</span><b>${pct(sessToIssue)}</b></div><div class="st"><span>Выручка / пользователь</span><b>${escapeHtml(String(f.revenue))} ₽</b></div><div class="st"><span>Время решения</span><b>${escapeHtml(f.time)}</b></div></div>`;
  return `<div class="card scenario-card ${f.mod||''}"><div class="scenario-head"><h3>${escapeHtml(f.name)}</h3><span class="pill">${escapeHtml(String(f.offers))} оффера</span></div><div class="flow-funnel">${stepsHtml}</div>${stats}<p class="muted">${escapeHtml(f.note)}</p></div>`;
 }).join('');
 table('funnelTable',['Месяц','Визиты','Клики по офферам','Заявки','Одобрения','Доля одобрений','Выручка'],months.map((m,i)=>[m,fmt(visits[i]),fmt(offerClicks[i]),fmt(applications[i]),fmt(approvals[i]),pct(ratio(approvals[i],applications[i])*100),money(revenue[i])]));
 const filteredScenarios=filterContext(scenarioCatalog);
 document.getElementById('scenarioGrid').innerHTML=filteredScenarios.length?filteredScenarios.map(s=>`<div class="card scenario-card" ${drillAttrs('scenario',s.id)}><div class="scenario-head"><h3>${escapeHtml(s.name)}</h3><span class="pill">${fmt(s.users)} пользователей</span></div><div class="mini-row"><span>Завершение</span><b>${pct(s.completion)}</b></div><div class="mini-row"><span>Диагностика</span><b>${pct(s.diag)}</b></div><div class="mini-row"><span>Одобрение</span><b>${pct(s.approval)}</b></div><div class="mini-row"><span>Повтор</span><b>${pct(s.repeat)}</b></div><div class="mini-row"><span>Выручка</span><b>${mln(s.revenue)}</b></div><div class="progress"><div class="bar" style="width:${s.completion}%"></div></div><p class="muted">Застревание: диагностика и подтверждение данных. Лучший ответ: ${escapeHtml(s.best)}.</p></div>`).join(''):emptyCard('Нет сценариев под выбранный фильтр.');
 table('jtbdTable',['Сценарий','Потери на вопросах','Узкое место','Время','Лучший ответ для одобрения','Выручка','Повтор'],(filteredScenarios.length?filteredScenarios:[]).map(s=>[s.name,`${pct(100-s.completion)} отвал`,'ответы диагностики',s.time,s.best,mln(s.revenue),pct(s.repeat)]));
 renderJtbdRationale();
 kpi('aiKpis',filterByRole([{id:'revenue',roles:['Продукт','Рост','Руководитель'],label:'Сессии с рекомендациями',value:fmt(totals.visits*.54),sub:'логируется ID сессии рекомендации'},{id:'revenue',roles:['Продукт','Рост','Руководитель'],label:'CTR топ-3',value:'41%',sub:'клики по офферу / показы',cls:'positive'},{id:'revenue',roles:['Продукт','Руководитель'],label:'Прирост одобрений',value:'+8 п.п.',sub:'к обычному списку',cls:'positive'},{id:'revenue',roles:['Продукт','Операции'],label:'Покрытие объяснениями',value:'94%',sub:'присутствует причина рекомендации',cls:'positive'}]));
 table('aiTable',['ID сессии','Сценарий','Топ-3 оффера','Причина рекомендации','Прогноз одобрения','Фактический результат','Прирост выручки','CTR','Покрытие'],aiRows.map(r=>[r[0],r[1],r[2],r[3],pct(r[4]*100),r[5],pct(r[6]),pct(r[7]),pct(r[8])]));
 table('sosTable',['Метрика','Значение'],sosRows);
 const filteredPartners=filterContext(partnerCatalog);
 document.getElementById('partnerCards').innerHTML=(filteredPartners.length?filteredPartners:partnerCatalog).slice(0,3).map(p=>`<div class="card partner-card" ${drillAttrs('partner',p.id)}><div class="partner-head"><h3>${escapeHtml(p.name)}</h3><span class="pill">${escapeHtml(p.type)}</span></div><div class="mini-row"><span>SLA</span><b>${escapeHtml(p.sla)}</b></div><div class="mini-row"><span>Одобрение</span><b>${pct(p.approval)}</b></div><div class="mini-row"><span>EPC</span><b>${escapeHtml(p.epc)} ₽</b></div><div class="actions"><button class="action" type="button" ${drillAttrs('partner',p.id)}>План действий</button></div></div>`).join('');
 table('partnerTable',['Партнёр','Интеграция','Статус','SLA','Ответ','Доля одобрений','Доля выдач','Выручка','EPC','eCPA','Жалобы','Главная причина отказа','Действие'],(filteredPartners.length?filteredPartners:partnerCatalog).map(p=>[p.name,p.type,p.status,p.sla,p.response,pct(p.approval),pct(p.issue),mln(p.revenue),p.epc+' ₽',p.ecpa+' ₽',pct(p.complaints),p.reject,p.action]));
 table('partnerMethodTable',['Метрика','Тип значения','Источник / бенчмарк','Как пересчитывается'],partnerMethodRows);
 kpi('retentionKpis',filterByRole([{id:'repeat-share',roles:['CRM','Руководитель'],label:'Доля повторов',value:'5.1%',sub:'цель 6%'},{id:'repeat-share',roles:['CRM'],label:'Дней до повтора',value:'21',sub:'медиана дней'},{id:'repeat-share',roles:['CRM','Руководитель'],label:'Реактивация SMS',value:'12.8%',sub:'лучший канал',cls:'positive'},{id:'repeat-share',roles:['CRM','Руководитель'],label:'Выручка после сделки',value:mln(9860000),sub:'повторы + кросс-продажи',cls:'positive'}]));
 table('retentionTable',['Событие','Пользователи / события','Конверсия'],retentionEvents);
 // TZ §5.1 — Юнит-экономика: 4 верхние карточки на 1 лид.
 const _um=buildUnitModel();
 const _gm=_um.global_metrics;
 const _u=perLeadFromModel(_um);
 const _trendBadge=(value,inverted)=>{
  if(value===null||!Number.isFinite(value))return null;
  const positive=inverted?value<0:value>0;
  const tone=Math.abs(value)<0.5?'flat':(positive?'up':'down');
  const arrow=tone==='flat'?'•':positive?'▲':'▼';
  return {tone,text:`${arrow} ${Math.abs(value).toFixed(1)}% MoM`};
 };
 const _romiStatus=statusFor(_u.romi);
 const _toDelta=(badge,goodWhenUp=true)=>{
  if(!badge)return undefined;
  const isGood=goodWhenUp?badge.tone==='up':badge.tone==='down';
  const isBad=goodWhenUp?badge.tone==='down':badge.tone==='up';
  return {text:badge.text,tone:isGood?'good':isBad?'bad':'warn'};
 };
 const _cplBadge=_trendBadge(_gm.trends.spend,true);
 const _arpuBadge=_trendBadge(_gm.trends.revenue);
 const _marginBadge=_trendBadge(_gm.trends.margin);
 const _romiBadge=_trendBadge(_gm.trends.romi);
 kpi('unitKpis',filterByRole([
  {id:'cac',roles:['Рост','Руководитель'],label:'Стоимость лида',value:moneyPrec(_u.cpl),sub:`маркетинг ${mln(_gm.marketing_spend)} / лидов ${fmt(_u.totalLeads)}`,cls:'negative',delta:_toDelta(_cplBadge,false)},
  {id:'revenue',roles:['Рост','Руководитель'],label:'Средняя выручка на лид',value:moneyPrec(_u.blendedArpu),sub:'Σ доля ветки × выручка на пользователя',cls:'positive',delta:_toDelta(_arpuBadge)},
  {id:'revenue',roles:['Рост','Руководитель'],label:'Маржа на лид',value:moneyPrec(_u.unitMargin),sub:`средняя выручка − стоимость лида = ${moneyPrec(_u.blendedArpu)} − ${moneyPrec(_u.cpl)}`,cls:_u.unitMargin>=0?'positive':'negative',delta:_toDelta(_marginBadge)},
  {id:'ltv-cac',roles:['Руководитель'],label:'Окупаемость рекламы',value:_u.romi.toFixed(1)+'%',sub:`маржа / стоимость лида · светофор: ${_romiStatus.recommendation}`,cls:_romiStatus.level==='success'?'positive':_romiStatus.level==='danger'?'negative':'',delta:_toDelta(_romiBadge)}
 ]));
 renderUnitRationale(_u,_um);
 document.getElementById('formulaList').innerHTML=filterByRole(formulaCatalog).map(x=>`<div class="mini-row" ${drillAttrs('formula',x.label)}><span>${escapeHtml(x.label)}</span><b>${escapeHtml(x.status)}</b></div>`).join('');
 const filteredAlerts=filterContext(alertCatalog);
 document.getElementById('alertsGrid').innerHTML=(filteredAlerts.length?filteredAlerts:alertCatalog).map(a=>`<div class="card alert-card" ${drillAttrs('alert',a.id)}><div class="alert-head"><h3>${escapeHtml(a.entity)}</h3><span class="delta ${a.severity==='red'?'bad':a.severity==='yellow'?'warn':'good'}">${a.severity==='red'?'критично':a.severity==='yellow'?'внимание':'норма'}</span></div><div class="mini-row"><span>Первое обнаружение</span><b>${DATA_SOURCE.updatedAt}</b></div><p class="muted">${escapeHtml(a.reason)}</p><div class="actions"><button class="action" type="button" ${drillAttrs('alert',a.id)}>Разобрать сигнал</button></div></div>`).join('');
 const filteredExperiments=filterContext(experimentCatalog);
 const experimentsGridEl=document.getElementById('experimentsGrid');
 if(experimentsGridEl)experimentsGridEl.innerHTML=(filteredExperiments.length?filteredExperiments:experimentCatalog).slice(0,3).map(e=>`<div class="card" ${drillAttrs('experiment',e.id)}><div class="card-title"><div><h3>${escapeHtml(e.name)}</h3><p>${escapeHtml(e.id)}</p></div><span class="pill">${escapeHtml(e.status)}</span></div><div class="mini-row"><span>Главная метрика</span><b>${escapeHtml(e.primary)}</b></div><div class="mini-row"><span>Уверенность</span><b>${escapeHtml(e.confidence)}</b></div><div class="mini-row"><span>Результат</span><b>${escapeHtml(e.result)}</b></div></div>`).join('');
 table('experimentsTable',['Эксперимент','Главная метрика','Ограничение','Сегмент','Уверенность','Снимок','Решение'],(filteredExperiments.length?filteredExperiments:experimentCatalog).map(e=>[e.name,e.primary,e.guardrail,e.segment,e.confidence,e.result,e.status]));
 // TZ §4.3 — Юнит-экономика по каналам (сортируемая, со светофором).
 renderUnitTable(_um);
 renderCjmUnitEconomics();
 renderDataStatusList();
 renderPriorityList();
}
function renderAll(){ecoInvalidate();syncControlsFromState();renderModelDirtyState();renderPresetActions();renderEcoPresets();renderValidators();renderSeoStages();renderContextualViews();renderTargetScenario();renderCentrofinans();renderRouting();renderQuiz();renderCharts()}
// Целевой сценарий «40 млн ₽/мес к декабрю 2027»: строим помесячную траекторию выручки,
// требуемые мультипликаторы по воронке и список точек роста. Базовый план в декабре 2027
// (revenue последний элемент) недотягивает до цели, поэтому считаем равномерный коэффициент уплотнения.
const TARGET_DEC_2027_REVENUE=40_000_000;
function targetRevenueSeries(){
 // Линейно нарастающий мультипликатор: первый месяц ≈ 1.0x, последний — ровно targetMultiplier.
 const last=revenue[revenue.length-1]||1;
 const targetMultiplier=TARGET_DEC_2027_REVENUE/last;
 const n=revenue.length;
 return revenue.map((v,i)=>{const t=n>1?i/(n-1):1;const k=1+(targetMultiplier-1)*Math.pow(t,1.15);return v*k});
}
function renderTargetScenario(){
 const host=document.getElementById('targetScenarioKpis');
 if(!host)return;
 const target=targetRevenueSeries();
 const lastBase=revenue[revenue.length-1]||0;
 const lastTarget=target[target.length-1]||0;
 const multiplier=lastTarget/Math.max(1,lastBase);
 const targetTotal=target.reduce((a,b)=>a+b,0);
 const baseTotal=totals.revenue;
 const gap=targetTotal-baseTotal;
 // Декомпозиция требуемых показателей в декабре 2027: каждый шаг воронки масштабируется тем же мультипликатором,
 // но часть забирается улучшением конверсии (одобрение и выдача), а часть — ростом трафика.
 const lastIdx=visits.length-1;
 const baseDec={
  visits:visits[lastIdx],clicks:offerClicks[lastIdx],apps:applications[lastIdx],
  approvals:approvals[lastIdx],issued:approvals[lastIdx]*modelInputs.issuedToApprovalRate
 };
 // Целевая декомпозиция: 70% уплотнения — рост трафика, 30% — рост конверсии в одобрение и выдачу.
 const trafficGrowth=Math.pow(multiplier,0.70);
 const conversionGrowth=Math.pow(multiplier,0.30);
 const targetDec={
  visits:baseDec.visits*trafficGrowth,
  clicks:baseDec.clicks*trafficGrowth*1.03,
  apps:baseDec.apps*trafficGrowth*1.06,
  approvals:baseDec.approvals*trafficGrowth*conversionGrowth,
  issued:baseDec.issued*trafficGrowth*conversionGrowth*1.05
 };
 kpi('targetScenarioKpis',[
  {label:'Цель в декабре 2027',value:mln(TARGET_DEC_2027_REVENUE),sub:'месячная выручка по плану 40 млн ₽',cls:'positive'},
  {label:'Базовый план в декабре 2027',value:mln(lastBase),sub:'фактическая траектория без уплотнения'},
  {label:'Требуемый мультипликатор',value:'×'+multiplier.toFixed(2),sub:`разрыв ${mln(gap)} за весь период`,cls:'positive'},
  {label:'Доп. бюджет на разгон',value:mln(gap*0.18),sub:'≈18% уплотнения уходит в acquisition + CRM'}
 ]);
 // Воронка декабря 2027: база vs цель.
 const funnelRows=[
  ['Визиты',fmt(baseDec.visits),fmt(targetDec.visits),'×'+(targetDec.visits/baseDec.visits).toFixed(2)],
  ['Клики на офферы',fmt(baseDec.clicks),fmt(targetDec.clicks),'×'+(targetDec.clicks/baseDec.clicks).toFixed(2)],
  ['Заявки',fmt(baseDec.apps),fmt(targetDec.apps),'×'+(targetDec.apps/baseDec.apps).toFixed(2)],
  ['Одобрения',fmt(baseDec.approvals),fmt(targetDec.approvals),'×'+(targetDec.approvals/baseDec.approvals).toFixed(2)],
  ['Выданные сделки',fmt(baseDec.issued),fmt(targetDec.issued),'×'+(targetDec.issued/baseDec.issued).toFixed(2)],
  ['Месячная выручка, млн ₽',(lastBase/1e6).toFixed(1),(lastTarget/1e6).toFixed(1),'×'+multiplier.toFixed(2)]
 ];
 table('targetFunnelTable',['Показатель','База, дек 2027','Цель, дек 2027','Множитель'],funnelRows);
 // Точки роста: где брать недостающие 27 млн ₽ месячной выручки.
 const levers=[
  `<b>SEO-масштаб (вклад ≈45% разрыва).</b> Удвоить парк лендингов под intent-запросы, поднять покрытие long-tail и нарастить ссылочную массу. Цель: визиты SEO ×${trafficGrowth.toFixed(2)}, EPC удержать ≥ 110 ₽.`,
  `<b>Платный трафик с положительным ROI (≈30%).</b> Открыть Яндекс.Директ и performance-сети только в группах с ROAS&nbsp;≥&nbsp;1.6x; CAC выдачи держать ниже LTV/3. Бюджет: до ${mln(gap*0.10)} в месяц к концу 2027.`,
  `<b>Repeat-share и CRM (≈15%).</b> SMS D+14, реактивация D+45, кросс-продажи карты и страхования. Цель: доля повторов с ${pct(ratio(REPEAT_REVENUE_TOTAL,totals.revenue)*100)} → 10% к декабрю 2027.`,
  `<b>Партнёрский микс и SLA (≈10%).</b> Заменить «МФО-партнёр №3 (контроль риска)» на двух стабильных партнёров; перевести «Банк-партнёр» в наблюдение до починки скоринга; нарастить долю прямых API в выдаче — это снижает eCPA на 12–18%.`
 ];
 const leversHost=document.getElementById('targetGrowthLevers');
 if(leversHost)leversHost.innerHTML=levers.map(l=>`<li>${l}</li>`).join('');
}
// Центрофинанс как identity-слой: модель использует базу клиентов МФО как match-сервис,
// чтобы партнёр получал «совпадение / score / payload-токен», а не персональные данные.
function renderCentrofinans(){
 const host=document.getElementById('centrofinansKpis');
 if(!host)return;
 const baseSize=(Number(modelInputs.centrofinansBaseSize)||0)*1_000_000; // млн профилей → шт.
 const matchRate=Number(modelInputs.centrofinansMatchRate)||0;
 kpi('centrofinansKpis',[
  {label:'Размер базы',value:baseSize?fmt(baseSize):'вводится менеджером',sub:'оценка профилей (хеши e-mail/phone/passport)'},
  {label:'Ожидаемый match-rate',value:pct(matchRate*100),sub:'на горячем интент-трафике',cls:'positive'},
  {label:'Прирост одобрений',value:'+9–14 п.п.',sub:'для матчированных пользователей',cls:'positive'},
  {label:'PII наружу',value:'0 полей',sub:'партнёру уходит токен и score',cls:'positive'}
 ]);
 const flow=[
  '<b>Шаг 1. Хеширование на нашей стороне.</b> Из базы Центрофинанса формируется witness-таблица: HMAC-SHA-256 с секретным pepper и проектной солью по нормализованным контактам (phone, email) и Argon2id по паспортным данным. Pepper хранится в HSM, соль уникальна на проект и не выгружается — это закрывает атаки rainbow-таблицами на статичные идентификаторы.',
  '<b>Шаг 2. Match-API «Выручай.ру».</b> Когда пользователь заполняет анкету, мы хешируем его контакты тем же алгоритмом и сравниваем с witness-таблицей в нашей инфраструктуре. Партнёр в этот момент к базе не обращается.',
  '<b>Шаг 3. Обогащённый payload без PII.</b> Партнёру уходит match_id (псевдоним), risk_score, repeat_flag, recency_bucket и список разрешённых пользователем согласий — но не ФИО, телефон, паспорт.',
  '<b>Шаг 4. Подтверждение согласий.</b> На каждом шаге фиксируется отдельное согласие на трансграничную обработку и на передачу скоринговых признаков; согласие хранится у нас и предоставляется по запросу регулятора.',
  '<b>Шаг 5. Отзыв и журнал.</b> Пользователь может в любой момент потребовать удаления; witness-запись и match-логи удаляются по флагу right-to-be-forgotten, partner получает уведомление об отзыве согласия.'
 ];
 const flowHost=document.getElementById('centrofinansFlow');
 if(flowHost)flowHost.innerHTML=flow.map(p=>`<li>${p}</li>`).join('');
 const effects=[
  '<b>Что защищено.</b> База МФО физически не покидает периметр: ни один партнёр не получает выгрузку клиентов, токены не реверсятся без соли, лог match-запросов хранится и аудируется.',
  '<b>Что улучшится в воронке.</b> На матчированных профилях скорость решения снижается с 2:18 до ~1:10, доля одобрений растёт на 9–14 п.п., доля пустых рекомендаций уменьшается за счёт fallback-сценария по истории Центрофинанса.',
  '<b>Эффект на CAC.</b> На матчированном трафике повторная идентификация сокращает форму на 4 поля и поднимает completion на 6–8 п.п., что эквивалентно снижению CAC выдачи на ~14–17%.',
  '<b>Эффект на LTV.</b> Известная истории клиента позволяет точнее подобрать оффер и сразу включить кросс-продажу; ожидаемый прирост LTV на матче — около 22%.',
  '<b>Юридический контур.</b> Передача partner-у только обезличенных скоринговых признаков соответствует 152-ФЗ при правильно оформленных согласиях; раздельные согласия на профилирование и на передачу третьим лицам — обязательны.'
 ];
 const effectHost=document.getElementById('centrofinansEffect');
 if(effectHost)effectHost.innerHTML=effects.map(p=>`<li>${p}</li>`).join('');
 const legal=document.getElementById('centrofinansLegal');
 if(legal)legal.textContent='Принцип: «база Центрофинанса — наш ресурс, а не товар». Партнёрам передаётся только результат сопоставления (match-токен и score), исходные PII никогда не покидают периметр Выручай.ру. Любая интеграция начинается с DPA, оценки PIA и журналирования всех match-операций.';
}
// Вкладка «Маршрутизация»: схема статусов, флоу A/B, S2S-контракты, аналитика и критерии приёмки
// для системы кросс-идентификации трафика Центрофинанс ⇄ Выручай.ру.
const ROUTE_GOALS=[
 'Максимизировать выдачи для ЦФ — забирать себе целевых лидов из внешнего трафика.',
 'Балансировать непрофильный трафик через CPA-партнёров (МФО / банки) — Zero-Waste окупаемость CAC.',
 'Исключить перекредитованность действующих клиентов ЦФ у конкурентов.',
 'Гарантировать безопасность базы ЦФ — никаких прямых сливов конкурентам.'
];
const ROUTE_USER_STORIES=[
 {cls:'s-rejected',segment:'Story 1 · Soft Reject',title:'Окупаемость нецелевого трафика',story:'Как бизнес я хочу, чтобы клиент, получивший отказ от ЦФ по скорингу (CF_REJECTED), не уходил с платформы: лоадер «Анализ профиля…» → SPA-витрина с 3 альтернативными МФО со 100% одобрением.',outcome:'Результат: CAC окупается за счёт CPA-выплаты от стороннего МФО.'},
 {cls:'s-repeat',segment:'Story 2 · LTV Recovery',title:'Возврат «спящих» и повторных',story:'Как партнёр (ЦФ) я хочу первым получать своих повторных и «спящих» клиентов (CF_REPEAT / CF_DORMANT): закрепленный оффер ЦФ с бейджем «Предодобрено как надёжному клиенту», и только после отказа — открытие остальной витрины.',outcome:'Результат: рост LTV базы ЦФ без расходов партнёра на ретаргетинг.'},
 {cls:'s-active',segment:'Story 3 · Anti-Cannibalization',title:'Защита действующих заёмщиков',story:'Как риск-менеджер ЦФ я хочу, чтобы действующий клиент (CF_ACTIVE) не набрал займов у конкурентов на нашей же витрине: жёсткая блокировка любых кредитных продуктов (МФО, кредитки), показ только дебетовых карт, РКО, страховок и HR-вакансий.',outcome:'Результат: защита от долговой нагрузки + Zero-Waste монетизация через некредитные CPA.'},
 {cls:'s-overdue',segment:'Story 4 · NPL Monetization',title:'Заработок на «токсичном» трафике',story:'Как бизнес я хочу зарабатывать даже на токсичном трафике: при CF_OVERDUE (открытое взыскание) кредитовать нельзя — система блокирует все МФО и Банки и перестраивает витрину под офферы БФЛ (Банкротство физлиц) и HR (Поиск работы).',outcome:'Результат: лид на банкротство приносит CPA-доход (до 3000 ₽), окупая затраты на привлечение должника.'}
];
const ROUTE_STATUSES=[
 {cls:'s-target',code:'CF_TARGET',title:'Подходит для ЦФ',desc:'Идеальный профиль, хорошая КИ.',logic:'Маршрутизация сделки в ЦФ. Оффер ЦФ на 1-м месте или «режим SOS» (эксклюзивная выдача в ЦФ). Остальные МФО скрыты.',out:'Оффер ЦФ №1 или SOS-режим (эксклюзив ЦФ)',
  ui:'Иван, для вашего профиля 100% одобрение в Центрофинансе',allow:['Оффер ЦФ №1','Бейдж «100% одобрение»','SOS-режим'],block:['Сторонние МФО (на время SOS)']},
 {cls:'s-active',code:'CF_ACTIVE',title:'Действующий клиент ЦФ',desc:'Уже есть активный заём / долг.',logic:'Запрет на конкуренцию: все МФО-конкуренты (займы) полностью скрыты. Первым показываем Кредитную линию (продукт ЦФ), далее — иные предложения, кроме займов: РКО, карты, страхование, рефинансирование в банках.',out:'Кредитная линия ЦФ №1, далее иные продукты (кроме займов)',
  ui:'Специальные предложения для клиентов Центрофинанса',allow:['Кредитная линия ЦФ','Дебетовые карты','РКО','HR-офферы','Страхование','Дожим (Email)'],block:['МФО-конкуренты','Любые сторонние займы']},
 {cls:'s-rejected',code:'CF_REJECTED',title:'Отказник ЦФ · киллер-сегмент',desc:'ЦФ отклонил заявку по скорингу / КИ.',logic:'Полная свобода монетизации. Оффер ЦФ скрыт. Витрина из МФО-партнёров, готовых кредитовать с плохой КИ. Сделка уходит по CPA. Активируется Soft Reject Flow — экран без перезагрузки перестраивается в новую витрину.',out:'CPA-витрина ТОП-3 МФО, оффер ЦФ скрыт',
  ui:'Мы подобрали для вас 3 альтернативных финансовых решения с высокой вероятностью одобрения',allow:['ТОП-3 МФО (CPA)','Сорт. по EPC × Approval Rate','Soft Reject Flow','Брошенная корзина'],block:['Оффер ЦФ']},
 {cls:'s-noncore',code:'CF_NON_CORE',title:'Непрофильный для ЦФ',desc:'Продукт / сумма / срок вне профиля ЦФ (ипотека, авто, крупная сумма).',logic:'Лид не подходит ЦФ — продаём его другим игрокам рынка. Оффер ЦФ скрыт, показываем витрину крупных банков и залоговых продуктов.',out:'Витрина банков и залоговых продуктов',
  ui:'Подобрали для вас банковские продукты под вашу задачу',allow:['Потребкредиты банков','Автокредиты','Займы под залог','Ипотека'],block:['МФО (PDL)','Оффер ЦФ']},
 {cls:'s-notfound',code:'NOT_FOUND',title:'Новый (органический) трафик',desc:'В базе ЦФ не числится.',logic:'Смешанная витрина. ЦФ на 1-м месте + 2-3 партнёрских МФО для сравнения, конкуренты также доступны.',out:'Смешанная витрина: ЦФ №1 + 2-3 МФО',
  ui:'Подобрали лучшие предложения под ваш запрос',allow:['ЦФ №1','2-3 партнёрских МФО','Сравнение условий'],block:[]}
];
const ROUTE_DECISION_TREE=[
 {cls:'s-target',code:'CF_TARGET',title:'Идеальный профиль, новый клиент',ui:'Лучший оффер ЦФ, конкуренты скрыты (режим SOS)',
  allow:['Только ЦФ (Режим SOS)'],block:['Все конкуренты-МФО','Банки'],
  logic:'Отдаём целевой лид якорному партнёру.'},
 {cls:'s-active',code:'CF_ACTIVE',title:'Действующий заём в ЦФ без просрочек',ui:'«Специальные предложения для клиентов ЦФ»',
  allow:['Дебетовые карты','Страхование','HR-вакансии','РКО'],block:['Все кредитные продукты (PDL, МФО, кредиты)'],
  logic:'Защита от перекредитованности.'},
 {cls:'s-repeat',code:'CF_REPEAT',title:'Успешно закрыл займ в ЦФ',ui:'Закреплённый оффер ЦФ + бейдж «Предодобрено как надёжному клиенту»',
  allow:['ЦФ (1-е место)','Кредитные карты'],block:['Другие МФО (до отказа в ЦФ)'],
  logic:'Возврат проверенных клиентов (LTV Recovery).'},
 {cls:'s-dormant',code:'CF_DORMANT',title:'Спящий клиент (закрыл > 6 мес назад)',ui:'Оффер ЦФ со скидкой + смешанная витрина',
  allow:['ЦФ (со скидкой)','Рефинансирование','Кредитные карты'],block:[],
  logic:'Реактивация базы.'},
 {cls:'s-overdue',code:'CF_OVERDUE',title:'Открытая жёсткая просрочка (NPL)',ui:'«Помощь в трудной ситуации» — БФЛ и поиск работы',
  allow:['Юристы по банкротству (БФЛ)','Работа / HR'],block:['Все МФО','Все Банки','PDL','Кредитные карты'],
  logic:'NPL Monetization — монетизация токсичного трафика через B2B/Услуги.'},
 {cls:'s-rejected',code:'CF_REJECTED',title:'Отказ ЦФ по скорингу',ui:'«Подобраны 3 альтернативных решения со 100% одобрением» (Soft Reject Flow, без перезагрузки)',
  allow:['ТОП-3 CPA МФО с высоким апрувом'],block:['Оффер ЦФ'],
  logic:'Монетизация нецелевого трафика (Soft Reject).'},
 {cls:'s-noncore',code:'CF_NON_CORE',title:'Запрос не по профилю ЦФ (ипотека, залог)',ui:'Витрина банковских и залоговых продуктов',
  allow:['Банковские кредиты','Ипотека','Автокредиты','Займы под ПТС'],block:['Микрозаймы (PDL)'],
  logic:'Свободная CPA-маршрутизация.'},
 {cls:'s-notfound',code:'NOT_FOUND',title:'Органика — в БД ЦФ не найден',ui:'Смешанная конкурентная витрина',
  allow:['ЦФ (1-е место)','2–3 МФО','Кредитные карты'],block:[],
  logic:'Обычная конкурентная выдача.'}
];
function renderRouteDecisionTree(){
 const host=document.getElementById('routeDecisionTree');
 if(!host)return;
 const chips=(arr,kind)=>arr.length?arr.map(x=>`<span class="dt-chip dt-${kind}">${escapeHtml(x)}</span>`).join(''):`<span class="dt-chip dt-none">—</span>`;
 host.innerHTML=ROUTE_DECISION_TREE.map(r=>`<div class="dt-row ${escapeHtml(r.cls)}"><div class="dt-status"><span class="dt-code">${escapeHtml(r.code)}</span><span class="dt-title">${escapeHtml(r.title)}</span><span class="dt-ui">${escapeHtml(r.ui)}</span><span class="dt-ui" style="font-style:normal;color:var(--text);font-size:12.5px;margin-top:4px">${escapeHtml(r.logic)}</span></div><div class="dt-cell dt-cell-allow"><span class="dt-cell-h">Show · разрешено</span><div class="dt-cell-chips">${chips(r.allow,'allow')}</div></div><div class="dt-cell dt-cell-block"><span class="dt-cell-h">Hide · блокируется</span><div class="dt-cell-chips">${chips(r.block,'block')}</div></div></div>`).join('');
}
const ROUTE_SEGMENTS=[
 {cls:'s-rejected',code:'CF_REJECTED',title:'Ветка A · Отказники',
  userStory:'Я как заёмщик, получивший отказ у ЦФ, хочу без повторной анкеты найти компанию, чтобы она выдала заём прямо сейчас.',
  path:'Телефон + сумма → S2S API ЦФ → CF_REJECTED → лоадер 2–3 с → SPA-витрина ТОП-3 МФО → safe_router_redirect в DWH.',
  pain:'Срочно нужны деньги, отказ вызывает стресс, не хочет заново заполнять длинные анкеты на других сайтах.',
  whyUs:'Бережём нервы и время: даём 100% гарантию подбора компании, готовой кредитовать с текущей КИ. Клиент не уходит к конкурентам — остаётся у нас.',
  scheme:'Стороннее МФО-партнёр платит маркетплейсу комиссию за выданный заём (≈ 1 500–2 500 ₽).',
  actors:[
   ['Клиент','получает заём в стороннем МФО'],
   ['Выручай.ру','показывает витрину альтернативных МФО, фиксирует CPA'],
   ['МФО-партнёр','платит маркетплейсу CPA за оформленный заём'],
   ['Центрофинанс','не участвует в сделке, оффер скрыт']
  ],
  realIncome:'Внешний доход от МФО-партнёров. CAC = 0 ₽ для базы ЦФ — вся CPA-маржа в чистый PnL.',
  monLabel:'Внешний доход',isExternal:true,
  rule:'exclude_partners=["Centrofinance"], include_categories=["PDL"], sort=EPC_desc',
  capacity:'≈ 18 000 чел./мес',defaultVol:18000,payoutHint:'1 500 ₽ (средний CPA)'
 },
 {cls:'s-active',code:'CF_ACTIVE',title:'Ветка B · Действующие клиенты',
  userStory:'Я как действующий клиент ЦФ хочу безопасные не-кредитные продукты (карты, страхование, подработку), чтобы не усугублять свою долговую нагрузку.',
  path:'Вводит номер → есть активный заём в ЦФ → скрываем все кредитные предложения → показываем дебетовые карты, кэшбэк-сервисы, вакансии (HR), страхование.',
  pain:'Долговая яма. Очередной микрозаём усугубит ситуацию. Нужны дополнительные доходы и инструменты выгодных покупок.',
  whyUs:'Проявляем заботу: помогаем стабилизировать финансовое положение и не даём уйти к конкурентам и закредитоваться.',
  scheme:'Крупные банки платят CPA за выпуск дебетовых карт, HR-платформы — за отклики, страховщики — за полисы.',
  actors:[
   ['Клиент','оформляет дебетовую карту / страховку / отклик на вакансию'],
   ['Выручай.ру','показывает не-кредитную витрину, фиксирует CPA'],
   ['Банк / HR / страховщик','платит маркетплейсу CPA за целевое действие'],
   ['Центрофинанс','защищён от потери клиента и риска дефолта']
  ],
  realIncome:'Внешний доход от банков, HR- и страховых партнёров. Параллельно — защита базы ЦФ от перекредитования.',
  monLabel:'Внешний доход + защита базы',isExternal:true,
  rule:'exclude_categories=["PDL","Installment"], include_categories=["DebitCards","HR","Insurance"]',
  capacity:'≈ 24 000 чел./мес',defaultVol:24000,payoutHint:'1 200 ₽ (средний CPA)'
 },
 {cls:'s-target',code:'CF_TARGET',title:'Ветка C · Целевые / идеальный профиль',
  userStory:'Я как идеальный заёмщик хочу сразу получить лучший оффер от проверенной компании, чтобы не сравнивать десятки предложений.',
  path:'Вводит номер → система видит идеального заёмщика → блокирует всех конкурентов → показывает только Центрофинанс.',
  pain:'Нужна проверенная компания, лучшая ставка, отсутствие скрытых страховок и инфошума.',
  whyUs:'Избавляем от инфошума: сразу даём лучший премиум-оффер от генерального партнёра (ЦФ).',
  scheme:'ЦФ получает идеального лида из бесплатной органики маркетплейса, экономя бюджет на Яндекс.Директ.',
  actors:[
   ['Клиент','оформляет заём в ЦФ по лучшей ставке'],
   ['Выручай.ру','передаёт лида в ЦФ без CPA-комиссии'],
   ['Центрофинанс','получает идеального заёмщика и экономит на Яндекс.Директ'],
   ['Внешние партнёры','не участвуют — конкурирующие офферы скрыты']
  ],
  realIncome:'Внешнего дохода нет. Это перекладывание денег внутри группы (Маркетплейс → ЦФ): экономия рекламного бюджета ЦФ, не выручка маркетплейса.',
  monLabel:'Внутренняя синергия',isExternal:false,
  rule:'exclude_all_except=["Centrofinance"]',
  capacity:'не учитывается в калькуляторе внешнего дохода',defaultVol:0,payoutHint:'—'},
 {cls:'s-noncore',code:'CF_NON_CORE',title:'Ветка D · Непрофильные',
  userStory:'Я как заёмщик с крупной потребностью (≈ 1 млн ₽, ипотека, авто) хочу сразу попасть в банк, чтобы он реально одобрил такую сумму.',
  path:'Ищет крупную сумму (≈ 1 млн ₽) → скрываем микрозаймы → переводим в ТОП-банки (потреб, авто, залог, ипотека).',
  pain:'МФО не дают такие суммы. Нужно найти банк с высокой вероятностью одобрения крупного кредита.',
  whyUs:'Сразу маршрутизируем в целевые банки, экономя время на скоринге и подаче заявок в десяти местах.',
  scheme:'Топовые банки платят высокую комиссию за выданный потребкредит / автокредит / ипотеку (до 10 000 ₽).',
  actors:[
   ['Клиент','получает крупный кредит / ипотеку в банке'],
   ['Выручай.ру','показывает витрину банковских и залоговых продуктов'],
   ['Банк-партнёр','платит маркетплейсу CPA за выданный кредит'],
   ['Центрофинанс','не участвует — продукт вне профиля ЦФ']
  ],
  realIncome:'Полностью внешний канал заработка маркетплейса. Не пересекается с ЦФ.',
  monLabel:'Внешний доход',isExternal:true,
  rule:'include_categories=["CreditCards","CashLoans","Auto","Mortgage"]',
  capacity:'≈ 6 000 чел./мес',defaultVol:6000,payoutHint:'до 10 000 ₽ за выдачу'}
];
const ROUTE_STEP_SCHEMES=[
{cls:'c-rejected',code:'CF_REJECTED',title:'Zero-Waste Traffic: Интеллектуальная окупаемость маркетинга',desc:'Конкурентное преимущество Выручай.ру перед Банки.ру: мы не теряем лиды. Внешний трафик из Яндекса проходит проверку API. Если профиль Ивана не подходит ЦФ, система (без перезагрузки экрана) генерирует витрину CPA-партнёров. Затраты на привлечение Ивана (CAC) полностью компенсируются CPA-выплатой, давая чистый профит.',
 steps:[
  {title:'Заявка',subtitle:'Телефон + сумма',screen:'form',cta:'Проверить одобрение'},
  {title:'Решение роутера',subtitle:'CF_REJECTED · лоадер 2–3 с',screen:'loader',tip:'Подбираем альтернативные предложения'},
  {title:'ТОП-3 МФО',subtitle:'Готовы выдать деньги сейчас',screen:'mfo',event:'safe_router_redirect'}
 ]},
{cls:'c-active',code:'CF_ACTIVE',title:'Защита действующего клиента',desc:'После определения активного займа кредитные офферы скрываются, остаются безопасные продукты.',
 steps:[
  {title:'Вход клиента',subtitle:'Номер найден в базе ЦФ',screen:'form',cta:'Посмотреть предложения'},
  {title:'Правило безопасности',subtitle:'CF_ACTIVE · скрываем займы',screen:'loader',tip:'Убираем МФО-конкурентов'},
  {title:'Не-кредитная витрина',subtitle:'Карты, кэшбэк, HR, страхование',screen:'active',event:'non_credit_offers'}
 ]},
{cls:'c-target',code:'CF_TARGET',title:'Целевой клиент ЦФ',desc:'Идеальный профиль получает короткий путь к офферу Центрофинанса без инфошума конкурентов.',
 steps:[
  {title:'Идентификация',subtitle:'Профиль и запрос совпали',screen:'form',cta:'Получить лучший оффер'},
  {title:'Приоритет ЦФ',subtitle:'CF_TARGET · конкуренты скрыты',screen:'loader',tip:'Фиксируем эксклюзивный маршрут'},
  {title:'Оффер ЦФ №1',subtitle:'Прямой переход к оформлению',screen:'target',event:'centrofinance_lead'}
 ]},
{cls:'c-overdue',code:'CF_OVERDUE',title:'NPL Monetization · Заработок на токсичном трафике',desc:'Клиент с открытой жёсткой просрочкой. Кредитовать нельзя — все МФО и Банки заблокированы. Витрина перестраивается под БФЛ (Банкротство физлиц) и HR (Поиск работы). Лид на банкротство приносит CPA-доход до 3 000 ₽, окупая затраты на привлечение должника.',
 steps:[
  {title:'Заявка',subtitle:'Телефон + сумма',screen:'form',cta:'Проверить одобрение'},
  {title:'Решение роутера',subtitle:'CF_OVERDUE · все МФО и Банки скрыты',screen:'loader',tip:'Подбираем безопасные решения'},
  {title:'БФЛ + HR',subtitle:'Юристы по банкротству и вакансии',screen:'overdue',event:'npl_monetization_redirect'}
 ]}
];
function calculateExternalRevenue(rejectedVol,activeVol,noncoreVol){
 const unit=calculateUnitEconomics();
 const r=Math.max(0,Number(rejectedVol)||0);
 const a=Math.max(0,Number(activeVol)||0);
 const n=Math.max(0,Number(noncoreVol)||0);
 const total=r+a+n;
 return {total,revenue:total*unit.issueRateFromVisit*unit.partnerPayout,parts:{rejected:r,active:a,noncore:n},issueRate:unit.issueRateFromVisit,payout:unit.partnerPayout};
}
function formatRub(v){const n=Math.round(Number(v)||0);return n.toLocaleString('ru-RU')+' ₽'}
function formatPpl(v){return (Math.round(Number(v)||0)).toLocaleString('ru-RU')+' чел.'}
function updateVolumeCalculator(opts){
 const ri=document.getElementById('calcRejected');
 const ai=document.getElementById('calcActive');
 const ni=document.getElementById('calcNoncore');
 if(!ri||!ai||!ni)return;
 [ri,ai,ni].forEach(el=>{
  const v=Number(el.value);
  el.classList.toggle('is-invalid',el.value!==''&&(!Number.isFinite(v)||v<0));
 });
 const res=calculateExternalRevenue(ri.value,ai.value,ni.value);
 const sumEl=document.getElementById('calcSum');
 const revEl=document.getElementById('calcRevenue');
 const subEl=document.getElementById('calcRevenueSub');
 const bdEl=document.getElementById('calcBreakdown');
 const crEl=document.getElementById('calcCR');
 const cpaEl=document.getElementById('calcCPA');
 const formulaEl=document.getElementById('calcFormula');
 if(sumEl)sumEl.textContent=formatPpl(res.total);
 if(revEl){
  revEl.textContent=formatRub(res.revenue);
  if(opts&&opts.bump){revEl.classList.add('is-bump');setTimeout(()=>revEl.classList.remove('is-bump'),320)}
 }
 if(crEl)crEl.textContent=pct(res.issueRate*100);
 if(cpaEl)cpaEl.textContent=formatRub(res.payout);
 if(formulaEl)formulaEl.innerHTML=`expectedRevenue = (rejected + active + noncore) × <b>${pct(res.issueRate*100)}</b> × <b>${formatRub(res.payout)}</b>`;
 if(subEl){
  if(res.total===0)subEl.textContent='Введите объёмы трафика — пересчёт идёт без перезагрузки страницы.';
  else subEl.textContent=`${formatPpl(res.total)} × ${pct(res.issueRate*100)} × ${formatRub(res.payout)} = ${formatRub(res.revenue)} в месяц.`;
 }
 if(bdEl){
  const partDyn=(label,vol,code)=>`<div>${escapeHtml(label)}<b>${formatRub(vol*res.issueRate*(DYNAMIC_PAYOUTS[code]||res.payout))}</b></div>`;
  bdEl.innerHTML=partDyn('Отказники',res.parts.rejected,'CF_REJECTED')+partDyn('Действующие',res.parts.active,'CF_ACTIVE')+partDyn('Непрофильные',res.parts.noncore,'CF_NON_CORE');
 }
 // Sync per-branch capacity numbers in the big diagram
 const capMap={CF_REJECTED:res.parts.rejected,CF_ACTIVE:res.parts.active,CF_NON_CORE:res.parts.noncore};
 document.querySelectorAll('[data-cap-vol]').forEach(el=>{
  const v=capMap[el.dataset.capVol];if(v==null)return;
  el.textContent=v.toLocaleString('ru-RU');
 });
 document.querySelectorAll('[data-cap-rev]').forEach(el=>{
  const code=el.dataset.capRev;
  const v=capMap[code];if(v==null)return;
  el.textContent=formatRub(v*res.issueRate*(DYNAMIC_PAYOUTS[code]||res.payout));
 });
 renderRouteOkrKpis();
}
function initVolumeCalculator(){
 const ids=['calcRejected','calcActive','calcNoncore'];
 const inputs=ids.map(id=>document.getElementById(id)).filter(Boolean);
 if(inputs.length!==3)return;
 if(inputs[0].dataset.calcInit==='1'){updateVolumeCalculator();return}
 const defaults=routeScenarioVolumes();
 inputs.forEach(el=>{
  el.dataset.calcInit='1';
  if(el.value==='')el.value=String(defaults[el.id]??0);
  el.addEventListener('input',()=>updateVolumeCalculator({bump:true}));
  el.addEventListener('change',()=>updateVolumeCalculator({bump:true}));
 });
 updateVolumeCalculator();
}
function renderRouteStories(){
 const host=document.getElementById('routeStories');
 if(!host)return;
 host.innerHTML=ROUTE_USER_STORIES.map(s=>`<article class="story-card ${escapeHtml(s.cls)}"><span class="story-segment">${escapeHtml(s.segment)}</span><h3 class="story-title">${escapeHtml(s.title)}</h3><p class="story-text">${escapeHtml(s.story)}</p><p class="story-outcome">${escapeHtml(s.outcome)}</p></article>`).join('');
}
function renderRouteStepSchemes(){
 const host=document.getElementById('routeStepSchemes');
 if(!host)return;
 const screen=(step,idx,schemeCls)=>{
 if(step.screen==='loader')return `<div class="sr-screen sr-screen-load"><div class="sr-spinner"></div><div class="sr-h">${escapeHtml(step.title)}</div><div class="sr-sub">${escapeHtml(step.subtitle)}</div><div class="sr-progress"><span></span></div><div class="sr-tip">${escapeHtml(step.tip||'Проверяем статус')}</div></div>`;
 if(step.screen==='mfo')return `<div class="sr-screen sr-screen-shop"><div class="sr-h sr-h-win">${escapeHtml(step.title)}</div><div class="sr-sub">${escapeHtml(step.subtitle)}</div>`+
  [['МФО A','до 30 000 ₽ · 0% первый заём'],['МФО B','одобрение за 3 минуты'],['МФО C','деньги на карту онлайн']].map((o,i)=>`<div class="sr-offer"><span class="sr-logo sr-logo-${i+1}">${i+1}</span><span><span class="sr-name">${escapeHtml(o[0])}</span><span class="sr-rate">${escapeHtml(o[1])}</span></span><span class="sr-go">›</span></div>`).join('')+
  `<div class="sr-evt"><b>${escapeHtml(step.event)}</b> → DWH</div></div>`;
 if(step.screen==='active')return `<div class="sr-screen sr-screen-shop sr-screen-active"><div class="sr-h">${escapeHtml(step.title)}</div><div class="sr-sub">${escapeHtml(step.subtitle)}</div>`+
  [['Карта с кэшбэком','выпуск 0 ₽'],['Подработка','отклик за 1 минуту'],['Страхование','полис онлайн']].map((o,i)=>`<div class="sr-offer"><span class="sr-logo sr-logo-${i+1}">${i+1}</span><span><span class="sr-name">${escapeHtml(o[0])}</span><span class="sr-rate">${escapeHtml(o[1])}</span></span><span class="sr-go">›</span></div>`).join('')+
  `<div class="sr-evt"><b>${escapeHtml(step.event)}</b> · займы скрыты</div></div>`;
 if(step.screen==='target')return `<div class="sr-screen sr-screen-shop sr-screen-target"><div class="sr-h sr-h-win">${escapeHtml(step.title)}</div><div class="sr-sub">${escapeHtml(step.subtitle)}</div><div class="sr-offer"><span class="sr-logo sr-logo-2">ЦФ</span><span><span class="sr-name">Центрофинанс</span><span class="sr-rate">персональное одобрение</span></span><span class="sr-go">›</span></div><div class="sr-offer sr-muted-offer"><span class="sr-logo">×</span><span><span class="sr-name">Конкуренты</span><span class="sr-rate">скрыты роутером</span></span><span class="sr-go">—</span></div><div class="sr-cta">${escapeHtml(step.event)}</div></div>`;
 if(step.screen==='overdue')return `<div class="sr-screen sr-screen-shop sr-screen-overdue"><div class="sr-h">${escapeHtml(step.title)}</div><div class="sr-sub">${escapeHtml(step.subtitle)}</div>`+
  [['БФЛ-юрист','списание долгов · от 0 ₽'],['Подработка','отклик за 1 минуту'],['Соц. поддержка','помощь должникам']].map((o,i)=>`<div class="sr-offer"><span class="sr-logo sr-logo-${i+1}">${i+1}</span><span><span class="sr-name">${escapeHtml(o[0])}</span><span class="sr-rate">${escapeHtml(o[1])}</span></span><span class="sr-go">›</span></div>`).join('')+
  `<div class="sr-offer sr-muted-offer"><span class="sr-logo">×</span><span><span class="sr-name">МФО и банки</span><span class="sr-rate">заблокированы</span></span><span class="sr-go">—</span></div><div class="sr-evt"><b>${escapeHtml(step.event)}</b> · CPA до 3 000 ₽</div></div>`;
 return `<div class="sr-screen ${schemeCls==='c-active'?'sr-screen-active':''}"><div class="sr-bar"></div><div class="sr-h">${escapeHtml(step.title)}</div><div class="sr-sub">${escapeHtml(step.subtitle)}</div><div class="sr-input">+7 ··· ···-··-··</div><div class="sr-input">Сумма: 15 000 ₽</div><div class="sr-cta ${schemeCls==='c-target'?'sr-cta-blue':''}">${escapeHtml(step.cta||'Продолжить')}</div></div>`;
 };
 host.innerHTML=ROUTE_STEP_SCHEMES.map(s=>`<article class="route-scheme ${escapeHtml(s.cls)}"><div class="route-scheme-head"><div><span class="eyebrow">UI-схема · 3 шага</span><h3>${escapeHtml(s.title)}</h3><p>${escapeHtml(s.desc)}</p></div><span class="route-scheme-badge">${escapeHtml(s.code)}</span></div><div class="sr-grid">${s.steps.map((step,i)=>`<div class="sr-stage"><span class="sr-step-num">${i+1}</span><div class="sr-phone ${i===1?'sr-phone-pulse':''}">${screen(step,i,s.cls)}</div><p class="sr-cap"><b>${escapeHtml(step.title)}</b><br>${escapeHtml(step.subtitle)}</p></div>`).join('')}</div></article>`).join('');
}
function renderRoutingDiagram(){
 const host=document.getElementById('routeDiagram');
 if(!host)return;
 const unit=calculateUnitEconomics();
 const defaultVolumes=routeScenarioVolumes();
 const branchVolMap={CF_REJECTED:defaultVolumes.rejected,CF_ACTIVE:defaultVolumes.active,CF_NON_CORE:defaultVolumes.noncore};
 const NS='http://www.w3.org/1999/xhtml';
 const outCls={'s-target':'c-target','s-active':'c-active','s-rejected':'c-rejected','s-noncore':'c-noncore'};
 // ---- SVG funnel (entry → hub → router → diamond → 4 branch headers).
 // Mini-blocks are rendered as plain HTML grid below the SVG to avoid foreignObject clipping.
 const fo=(x,y,w,h,cls,inner)=>`<foreignObject x="${x}" y="${y}" width="${w}" height="${h}"><div xmlns="${NS}" class="rd-box ${cls}">${inner}</div></foreignObject>`;
 const edge=(d,extra='')=>`<path class="rd-edge${extra?' '+extra:''}" d="${d}" marker-end="url(#rdArrow)"/>`;
 const elabel=(x,y,t,extra='')=>`<text class="rd-elabel${extra?' '+extra:''}" x="${x}" y="${y}" text-anchor="middle">${escapeHtml(t)}</text>`;
 const COL_W=420,COL_GAP=16;
 const colX=[20,20+COL_W+COL_GAP,20+(COL_W+COL_GAP)*2,20+(COL_W+COL_GAP)*3]; // 20, 456, 892, 1328
 const HEADER_Y=620,HEADER_H=180;
 const VIEW_H=HEADER_Y+HEADER_H+40;
 // Top entry nodes (taller boxes — text fits comfortably, no clipping)
 let nodes='';
 nodes+=fo(300,30,400,110,'rd-entry','<span class="rd-t">Платный трафик Маркетплейса</span><span class="rd-s">PPC, SEO, CPA-сети — холодная органика и закупка трафика</span>');
 nodes+=fo(1100,30,400,110,'rd-entry','<span class="rd-t">База Центрофинанса</span><span class="rd-s">SMS-приглашение, подписанный одноразовый JWT (TTL 24 ч), флаг <b>is_cf_base = true</b></span>');
 nodes+=fo(610,170,580,140,'rd-hub','<span class="rd-t">Маркетплейс Выручай.ру · Сбор согласий и Идентификация</span><span class="rd-s">Ввод номера телефона. Обязательный чекбокс (152-ФЗ): <em>«Согласен на обработку ПД и передачу партнерам»</em>. Юридическая защита Smart Safe Router перед отправкой лида в CPA. Разрешение одноразового JWT (тёплый) или SHA-256 хеша.</span>');
 nodes+=fo(610,340,580,110,'rd-hub rd-killer','<span class="rd-killer-badge">Smart Safe Router · S2S API ЦФ</span><span class="rd-t">Решающий узел · POST /api/v1/cf/check-hash</span><span class="rd-s">Только Server-to-Server, только SHA-256-хеши и подписанные токены. Непрофильный трафик монетизируется через CPA-витрину, чтобы окупать CAC.</span>');
 // Diamond decision (bigger, easier to read)
 const diamond=`<polygon class="rd-diamond" points="900,478 1064,556 900,634 736,556"/>`+
  `<foreignObject x="744" y="492" width="312" height="128"><div xmlns="${NS}" class="rd-decision-label"><span class="rd-t">Какой статус клиента?</span><span class="rd-s">Offers Engine применяет правила маршрутизации (Decision Tree)</span></div></foreignObject>`;
 // Branch headers (only — mini blocks moved to HTML grid)
 const branches=ROUTE_SEGMENTS;
 let branchSvg='';
 branches.forEach((b,i)=>{
  const x=colX[i],cls=outCls[b.cls]||'';
  const monBadge=b.isExternal
   ?'<span class="rd-mon-flag rd-mon-ext">is_external_monetization: <b>true</b></span>'
   :'<span class="rd-mon-flag rd-mon-int">is_external_monetization: <b>false</b></span>';
  const headerInner=`<div class="rd-bh-top"><span class="rd-tag">${escapeHtml(b.code)}</span>${monBadge}</div>`+
   `<span class="rd-t">${escapeHtml(b.title)}</span>`+
   `<span class="rd-s">${escapeHtml(b.path)}</span>`;
  branchSvg+=fo(x,HEADER_Y,COL_W,HEADER_H,`rd-branch ${cls}`,headerInner);
 });
 const sourceArrowY=140;
 const edges=[
  edge(`M500,${sourceArrowY} V174 H900 V170`),
  edge(`M1300,${sourceArrowY} V174 H900 V170`),
  edge('M900,310 V340'),
  edge('M900,450 V478'),
  `<path class="rd-edge" d="M900,634 V${HEADER_Y-20}"/>`,
  edge(`M900,${HEADER_Y-20} H${colX[0]+COL_W/2} V${HEADER_Y}`),
  edge(`M900,${HEADER_Y-20} H${colX[1]+COL_W/2} V${HEADER_Y}`),
  edge(`M900,${HEADER_Y-20} H${colX[2]+COL_W/2} V${HEADER_Y}`),
  edge(`M900,${HEADER_Y-20} H${colX[3]+COL_W/2} V${HEADER_Y}`)
 ].join('');
 const labels=elabel(650,164,'JWT-токен (тёплый)')+elabel(1150,164,'SHA-256 хеш (холодный)')+
  elabel(900,470,'Smart Safe Router · перехват отказа','rd-elabel-killer');
 const svg=`<svg viewBox="0 0 1800 ${VIEW_H}" preserveAspectRatio="xMidYMid meet" role="img" aria-labelledby="rdTitle rdDesc">`+
  `<title id="rdTitle">CJM Smart Safe Router</title><desc id="rdDesc">Блок-схема показывает путь клиента от идентификации до статуса Центрофинанс и далее в одну из четырёх веток монетизации.</desc>`+
  `<defs><marker id="rdArrow" markerWidth="11" markerHeight="11" refX="8" refY="5.5" orient="auto" markerUnits="userSpaceOnUse"><path class="rd-arrow" d="M0,0 L11,5.5 L0,11 Z"/></marker></defs>`+
  edges+labels+nodes+diamond+branchSvg+`</svg>`;
 // ---- HTML grid: 4 columns × 6 rows of mini-cards (auto-sizes, no clipping).
 const cardForBranch=(b)=>{
  const cls=outCls[b.cls]||'';
  const actorsHtml=b.actors?`<ul class="rd-grid-actors">${b.actors.map(a=>`<li><b>${escapeHtml(a[0])}</b> — ${escapeHtml(a[1])}</li>`).join('')}</ul>`:'';
  const isTarget=b.code==='CF_TARGET';
  const capInner=isTarget
   ?`<div class="rd-cap-grid"><div>${escapeHtml(b.capacity)}</div><div>Внешний доход: <b>0 ₽</b> (внутренняя синергия)</div></div>`
   :`<div class="rd-cap-grid"><div>Прогноз: <b><span data-cap-vol="${escapeHtml(b.code)}">${(branchVolMap[b.code]||0).toLocaleString('ru-RU')}</span></b> чел./мес</div><div>Внешний доход/мес: <b><span data-cap-rev="${escapeHtml(b.code)}">${formatRub((branchVolMap[b.code]||0)*unit.issueRateFromVisit*(DYNAMIC_PAYOUTS[b.code]||unit.partnerPayout))}</span></b></div><div class="rd-cap-formula">Формула: объём × <b>${pct(unit.issueRateFromVisit*100)}</b> × <b>${formatRub(DYNAMIC_PAYOUTS[b.code]||unit.partnerPayout)}</b></div></div>`;
  const realInner=`<div class="rd-mini-b">${escapeHtml(b.realIncome||'')}</div>`+
   (b.payoutHint?`<div class="rd-cap-grid" style="margin-top:6px"><div>CPA-выплата: <b>${escapeHtml(b.payoutHint)}</b></div></div>`:'');
  const moneyInner=`<div class="rd-mini-b">${escapeHtml(b.scheme)}</div>${actorsHtml}`;
  const rows=[
   ['1 · История пользователя',`<div class="rd-mini-b">${escapeHtml(b.userStory||b.path)}</div>`],
   ['2 · Боль клиента',`<div class="rd-mini-b">${escapeHtml(b.pain)}</div>`],
   ['3 · Почему Выручай.ру',`<div class="rd-mini-b">${escapeHtml(b.whyUs)}</div><div class="rd-flow-note">Связка: интент → статус ЦФ → витрина → CRM/DWH → дожим.</div>`],
   ['4 · Схема монетизации',moneyInner],
   ['5 · Реальный заработок',realInner],
   ['6 · Ёмкость сегмента',capInner]
  ];
  return `<div class="rd-col rd-col-${cls}">`+rows.map(r=>`<div class="rd-mini ${cls}"><span class="rd-mini-h">${escapeHtml(r[0])}</span>${r[1]}</div>`).join('')+`</div>`;
 };
 const grid=`<div class="rd-html-grid" aria-label="Детализация веток Smart Safe Router">${branches.map(cardForBranch).join('')}</div>`;
 host.innerHTML=svg+grid;
}
function renderRouteOkrKpis(){
 const host=document.getElementById('routeOkrKpis');
 if(!host)return;
 const vols=currentRouteVolumes();
 const totalExternal=vols.rejected+vols.active+vols.noncore+Math.max(1,vols.target);
 const compensated=vols.rejected+vols.noncore;
 const cacReductionPct=Math.round(100*compensated/Math.max(1,totalExternal));
 const coreAllocPct=Math.round(100*vols.target/Math.max(1,totalExternal));
 const protectedBasePct=Math.round(100*vols.active/Math.max(1,totalExternal));
 const cards=[
  {id:'cac',label:'CAC Reduction',value:'−'+cacReductionPct+'%',sub:'Доля потоков, которые уже умеют компенсировать CAC через fallback-монетизацию по текущим вводным модели',cls:'positive'},
  {id:'revenue',label:'Protected Base Share',value:protectedBasePct+'%',sub:'Часть потока, которую CJM переводит в защиту базы ЦФ вместо каннибализации кредитными офферами',cls:'positive'},
  {id:'revenue',label:'Core Allocation · ЦФ',value:coreAllocPct+'%',sub:'Доля внешнего трафика, переданная якорному партнёру (Центрофинанс) как целевые лиды',cls:'positive'}
 ];
 host.innerHTML=cards.map(x=>{
  const attrs=x.id?drillAttrs('metric',x.id):'';
  return `<div class="card tight" ${attrs}><div class="card-title"><div class="metric-label">${escapeHtml(x.label)}</div></div><div class="metric-value ${ALLOWED_METRIC_CLASSES.has(x.cls)?x.cls:''}">${escapeHtml(x.value)}</div><div class="metric-sub">${escapeHtml(x.sub)}</div></div>`;
 }).join('');
}
function renderRouting(){
 const goals=document.getElementById('routeGoals');
 if(!goals)return;
 goals.innerHTML=ROUTE_GOALS.map((g,i)=>`<div class="route-goal"><span class="rg-num">${i+1}</span><span class="rg-text">${escapeHtml(g)}</span></div>`).join('');
 renderRouteStories();
 renderRouteDecisionTree();
 renderRoutingDiagram();
 renderRouteStepSchemes();
 initVolumeCalculator();
 renderRouteOkrKpis();
}
// ----------------------------------------------------------------
// Квиз-Сенсей · схематическое отражение прототипа krasuhod-lang/generator.
// Источник схемы — categories/prequalification.js (qualification_schema),
// SOS-прескоринг — buildOffers() (детерминированный rule-based).
// ----------------------------------------------------------------
const QUIZ_GOALS=[
 'Получить согласие 152-ФЗ до любого скоринга и до отправки лида в API партнёров',
 'Понять JTBD клиента: «закрыть долг», «лечение», «до зарплаты», «карта», «ипотека»',
 'Собрать минимально-достаточную анкету за 1 минуту через quick-replies и парсинг текста',
 'Посчитать SOS-прескоринг (low/medium/high) и показать top-3 маршрута с одобрением ≥ 80%',
 'Передать профиль в Smart Safe Router без повторного ввода данных (session_id)'
];
const QUIZ_STEPS=[
 {id:'consent',title:'Согласие 152-ФЗ',cls:'qs-consent',type:'choice',prompt:'Готовы начать функциональное демо?',opts:[['Согласен, начать'],['Не сейчас','ghost']],meta:'skipIf: уже есть согласие в cookie',note:'Без согласия квиз не запускает скоринг и не передаёт данные'},
 {id:'phone',title:'Телефон',type:'text',prompt:'Начнём с телефона в формате +7 999 123-45-67',opts:[],meta:'parse: parseRussianPhone · afterAnswer: lookup в реестре ЦФ + партнёров',note:'Используется для проверки повторных обращений у партнёров'},
 {id:'name',title:'Имя',type:'text',prompt:'Как к вам обращаться?',opts:[],meta:'parse: только буквы, 2–60 символов',note:'Для обращения в чате, не для скоринга'},
 {id:'purpose',title:'Цель займа (JTBD)',type:'choice',prompt:'Какая ситуация ближе всего?',opts:[['Закрыть долг'],['На лечение'],['До зарплаты'],['Кредитная карта'],['Ипотека'],['Другое']],meta:'parse: nlp.classifyJtbd · влияет на формулировки следующих шагов',note:'Ключевой бизнес-сигнал: меняет продукт и маршрут роутера'},
 {id:'amount',title:'Сумма',type:'number',prompt:'Какая сумма нужна? Можно «30 тысяч» или «10к»',opts:[['15 000 ₽'],['50 000 ₽'],['120 000 ₽'],['3 000 000 ₽']],meta:'parse: nlp.parseAmount · validate: 1 000…15 000 000 ₽',note:'Формулировка адаптируется под ипотеку / карту / рефинанс'},
 {id:'termDays',title:'Срок',type:'number',prompt:'На какой срок комфортно брать обязательство?',opts:[['14 дней'],['30 дней'],['6 месяцев'],['10 лет']],meta:'parse: nlp.parseTerm',note:'skipIf: цель = credit_card',skip:true},
 {id:'age',title:'Возраст',type:'number',prompt:'Сколько вам лет?',opts:[['21'],['30'],['45'],['62']],meta:'validate: 18–75 · skipIf: уже найден в реестре ЦФ',note:'Бонус к скорингу за «активный» возраст 23–55'},
 {id:'region',title:'Регион',type:'choice',prompt:'Регион проживания?',opts:[['Москва / СПб'],['Областной центр'],['Другой регион'],['С ограничениями','warn']],meta:'skipIf: регион известен из реестра ЦФ',note:'Регион с ограничениями (Крым/Севастополь) — штраф к скорингу'},
 {id:'income',title:'Доход (диапазон)',type:'choice',prompt:'Ежемесячный доход примерно?',opts:[['до 30 тыс'],['30–60 тыс'],['60–100 тыс'],['100+ тыс'],['нет','warn']],meta:'parse: nlp.parseAmount → бакет',note:'Спрашиваем диапазон, не точную сумму — снижает отказ от анкеты'},
 {id:'employment',title:'Тип занятости',type:'choice',prompt:'Тип занятости?',opts:[['По найму'],['Самозанятый'],['ИП'],['Пенсионер'],['Без оформления','warn']],meta:'skipIf: занятость известна из реестра ЦФ',note:'Влияет на доступные продукты (ипотека требует подтверждение)'},
 {id:'debtAmount',title:'Текущие долги',type:'number',prompt:'Сумма остатка по действующим долгам?',opts:[['Нет долгов'],['100 000 ₽'],['300 000 ₽'],['500 000 ₽+','warn']],meta:'parse: nlp.parseAmount или 0',note:'Триггер «БФЛ»: отказ + долг > 300 000 ₽ → маршрут реабилитации'},
 {id:'overdue12m',title:'Просрочки 12 мес',type:'choice',prompt:'За последние 12 месяцев были просрочки?',opts:[['Нет'],['Да','warn'],['Не знаю']],meta:'rule-based parse',note:'«Да» → даунгрейд до low, «Не знаю» → опц. БКИ по 218-ФЗ'},
 {id:'bki',title:'Опциональный запрос БКИ',cls:'qs-bki',type:'choice',prompt:'Согласны на запрос кредитной истории (218-ФЗ)?',opts:[['Согласен, запросить'],['Не сейчас','ghost']],meta:'отдельное согласие · мягкий запрос, не влияет на скоринговый балл',note:'Запускается только после показа предварительных офферов'}
];
const QUIZ_SCORING=[
 ['Возраст 23–55 лет','+8'],
 ['Возраст 18–22 или 56–70','+3'],
 ['Регион Москва / СПб','+5'],
 ['Регион с ограничениями (Крым/Севастополь)','−10'],
 ['Доход 100 000+ ₽','+10'],
 ['Доход 60–100 000 ₽','+5'],
 ['Доход «нет»','−15'],
 ['Занятость: по найму / самозанятый','+5'],
 ['Занятость: без оформления','−10'],
 ['Просрочки за 12 мес = «нет»','+8'],
 ['Просрочки за 12 мес = «да»','−20'],
 ['Долг > 12 × месячный доход','−15'],
 ['Сумма займа ≤ 50% от дохода','+5']
];
const QUIZ_GRADES=[
 {grade:'high',cls:'qgc-high',approval:'≥ 85%',route:'top-3 офферов ЦФ + банков, прямой Direct API, seamless checkout',action:'Маршрут CF_TARGET / CF_NON_CORE — см. вкладка CJM'},
 {grade:'medium',cls:'qgc-medium',approval:'70–84%',route:'3 МФО + 1 банк с лояльным скорингом, обязательный SMS-код',action:'Маршрут CF_ACTIVE — защита от перекредитованности'},
 {grade:'low',cls:'qgc-low',approval:'< 70%',route:'2 МФО PDL + предложение БКИ-проверки (218-ФЗ)',action:'Маршрут CF_REJECTED → БФЛ / реабилитация при долге > 300 000 ₽'}
];
// TZ — Quiz → Smart Safe Router: full mapping ответов на все 8 веток роутера (см. ROUTE_DECISION_TREE).
// Каждая ветка перечисляет: какие сигналы квиза её триггерят, какой грейд балла, и куда лид уходит в CJM.
const QUIZ_CJM_MAP=[
 {code:'CF_TARGET',cls:'s-target',title:'Идеальный для ЦФ',grade:'High · 85+',
  signals:['JTBD: до зарплаты / лечение','Возраст 23–55','Доход 60+ тыс','Без просрочек 12 мес','Не найден в реестре ЦФ как заёмщик'],
  routing:'SOS-режим: только оффер ЦФ №1, конкуренты скрыты. Прямой Direct API.',
  outcome:'Маршрут CF_TARGET · ARPU ≈ выплата за выдачу ЦФ'},
 {code:'CF_ACTIVE',cls:'s-active',title:'Действующий клиент ЦФ',grade:'High · из реестра',
  signals:['Телефон найден в реестре ЦФ','Открытый займ без просрочек','JTBD ≠ закрыть долг'],
  routing:'Запрет на МФО-конкурентов. Кредитная линия ЦФ + дебетовые карты, РКО, страхование, HR.',
  outcome:'Маршрут CF_ACTIVE · защита от перекредитованности, рост LTV'},
 {code:'CF_REPEAT',cls:'s-repeat',title:'Повторный (закрыл займ)',grade:'High · из реестра',
  signals:['Реестр ЦФ: статус «закрыт»','Срок с последнего займа ≤ 6 мес','Без просрочек'],
  routing:'Закреплённый оффер ЦФ + бейдж «Предодобрено как надёжному клиенту».',
  outcome:'Маршрут CF_REPEAT · LTV Recovery, CAC = 0 ₽'},
 {code:'CF_DORMANT',cls:'s-dormant',title:'Спящий (> 6 мес)',grade:'Medium',
  signals:['Реестр ЦФ: статус «закрыт»','Срок с последнего займа > 6 мес','JTBD: «до зарплаты» / «карта»'],
  routing:'Оффер ЦФ со скидкой + смешанная витрина (рефинансирование, кредитные карты).',
  outcome:'Маршрут CF_DORMANT · реактивация базы'},
 {code:'CF_REJECTED',cls:'s-rejected',title:'Soft reject у ЦФ',grade:'Low · 70−',
  signals:['Просрочки за 12 мес = «да»','Доход «нет» / без оформления','Регион с ограничениями','Возраст < 21 или > 65'],
  routing:'Soft Reject Flow без перезагрузки: SPA-витрина ТОП-3 МФО с лояльным скорингом.',
  outcome:'Маршрут CF_REJECTED · CPA-выплата ≈ 1 500–2 500 ₽'},
 {code:'CF_NON_CORE',cls:'s-noncore',title:'Не профиль ЦФ',grade:'High · 85+',
  signals:['JTBD: ипотека / автокредит','Сумма > 1 млн ₽','Срок > 1 года','Есть подтверждение дохода'],
  routing:'Оффер ЦФ скрыт. Витрина банков, ипотеки, авто, залоговых продуктов.',
  outcome:'Маршрут CF_NON_CORE · банковский CPA до 5 000 ₽'},
 {code:'CF_OVERDUE',cls:'s-overdue',title:'Открытое взыскание · NPL',grade:'Stop · кредитовать нельзя',
  signals:['Долг > 300 000 ₽ + просрочки','JTBD: «закрыть долг»','Возраст 35+, постоянные просрочки'],
  routing:'Все МФО и Банки блокируются. Витрина БФЛ (банкротство) + HR-вакансии.',
  outcome:'Маршрут CF_OVERDUE · CPA от БФЛ ≈ 2 000–3 000 ₽'},
 {code:'NOT_FOUND',cls:'s-notfound',title:'Органика — нет в БД',grade:'Medium / High',
  signals:['Телефон не найден в реестрах','Чистая КИ, средний доход','Стандартный JTBD'],
  routing:'Смешанная конкурентная витрина: ЦФ №1 + 2-3 МФО + кредитные карты.',
  outcome:'Маршрут NOT_FOUND · обычная конкурентная выдача'}
];
const QUIZ_FLOW=[
 {tag:'1 · Старт',cls:'qf-consent',title:'Согласие 152-ФЗ',desc:'Cookie-баннер + явный чекбокс. Без него <code>buildOffers()</code> не вызывается. session_id (UUID) сохраняется в sessionStorage.'},
 {tag:'2 · Сбор',cls:'',title:'12 шагов анкеты',desc:'schema-driven движок <code>core/dialog.js</code>: back/skip/preFill/autosave. Quick-replies + NLP-парсинг свободного текста через <code>core/nlp.js</code>.'},
 {tag:'3 · Mock-API',cls:'qf-mock',title:'POST /api/v1/scoring/sos',desc:'Фасад <code>Sensei.api</code> с флагом <code>USE_MOCK</code>. На фронте — детерминированные правила; в проде — один endpoint, без изменений UI.'},
 {tag:'4 · Top-3',cls:'',title:'buildOffers(params, profile)',desc:'Фильтр офферов по probability ≥ 80%, исключение партнёров со стоп-флагами из <code>partnersRegistry.lookupByPhone</code>.'},
 {tag:'5 · Router',cls:'qf-checkout',title:'Smart Safe Router · 1 из 8 веток',desc:'Профиль + session_id уходят в Router без повторного ввода: <code>CF_TARGET</code> / <code>CF_ACTIVE</code> / <code>CF_REPEAT</code> / <code>CF_DORMANT</code> / <code>CF_REJECTED</code> / <code>CF_NON_CORE</code> / <code>CF_OVERDUE</code> / <code>NOT_FOUND</code>. См. карточки ниже и вкладку CJM.'},
 {tag:'6 · Checkout',cls:'qf-checkout',title:'Seamless внутри чата',desc:'Единая JSON-анкета, SMS-согласия, статус заявки через <code>POST /api/v1/webhooks/status</code>. Без редиректа на сайт партнёра.'},
 {tag:'7 · БКИ (опц.)',cls:'qf-bki',title:'218-ФЗ inquiry',desc:'Отдельное согласие, отдельный экран. Мягкий запрос в НБКИ/ОКБ — не влияет на скоринговый балл клиента.'}
];
const QUIZ_HANDOFF=[];
// ---------- Интерактивный прототип квиза ----------
// Состояние держим в модуле — кнопки переключают шаги, профиль и скоринг пересчитываются на лету,
// в финале buildQuizResult() возвращает грейд + одну из 8 веток Smart Safe Router + top-3 оффера.
const QUIZ_PROTO_STATE={step:0,profile:{},history:[],score:68,done:false};
function quizGradeFor(score){
 if(score>=85)return {grade:'high',cls:'high',label:'High',approval:'≥ 85%'};
 if(score>=70)return {grade:'medium',cls:'medium',label:'Medium',approval:'70–84%'};
 return {grade:'low',cls:'low',label:'Low',approval:'< 70%'};
}
// Жёстко зашитые правила скоринга — совпадают с таблицей QUIZ_SCORING выше,
// чтобы прототип давал тот же балл, который объявлен в дашборде.
function quizScoreDelta(stepId,value){
 const v=String(value||'');
 if(stepId==='age'){const n=parseInt(v,10);if(n>=23&&n<=55)return 8;if((n>=18&&n<=22)||(n>=56&&n<=70))return 3;return -5}
 if(stepId==='region'){if(v.startsWith('Москва'))return 5;if(v.startsWith('С ограничениями'))return -10;return 0}
 if(stepId==='income'){if(v.startsWith('100+'))return 10;if(v.startsWith('60–100'))return 5;if(v.startsWith('30–60'))return 2;if(v==='нет')return -15;return -3}
 if(stepId==='employment'){if(v==='Без оформления')return -10;if(v==='Пенсионер')return -2;return 5}
 if(stepId==='overdue12m'){if(v==='Нет')return 8;if(v==='Да')return -20;return 0}
 if(stepId==='debtAmount'){if(v.startsWith('500'))return -15;if(v.startsWith('300'))return -8;return 0}
 return 0;
}
// Маршрутизация в одну из 8 веток Smart Safe Router по собранному профилю.
function quizRouteFor(profile,grade){
 const purpose=profile.purpose||'';
 const overdue=profile.overdue12m;
 const debt=String(profile.debtAmount||'');
 const employment=profile.employment;
 const amount=String(profile.amount||'');
 if(overdue==='Да'&&debt.startsWith('500'))return {code:'CF_OVERDUE',cls:'s-overdue',title:'Открытое взыскание · NPL',outcome:'Маршрут CF_OVERDUE — кредитование заблокировано, витрина БФЛ + HR-вакансии'};
 if(purpose==='Ипотека'||(amount.startsWith('3 000 000')&&employment&&employment!=='Без оформления'))return {code:'CF_NON_CORE',cls:'s-noncore',title:'Не профиль ЦФ',outcome:'Маршрут CF_NON_CORE — банковский CPA до 5 000 ₽'};
 if(grade.grade==='low'||overdue==='Да'||employment==='Без оформления')return {code:'CF_REJECTED',cls:'s-rejected',title:'Soft reject у ЦФ',outcome:'Маршрут CF_REJECTED — ТОП-3 МФО с лояльным скорингом, CPA ≈ 1 500–2 500 ₽'};
 if(purpose==='Закрыть долг')return {code:'CF_DORMANT',cls:'s-dormant',title:'Реактивация / спящий',outcome:'Маршрут CF_DORMANT — смешанная витрина рефинансирования'};
 if(grade.grade==='high'&&(purpose==='До зарплаты'||purpose==='На лечение'))return {code:'CF_TARGET',cls:'s-target',title:'Идеальный для ЦФ',outcome:'Маршрут CF_TARGET — прямой Direct API в Центрофинанс'};
 return {code:'NOT_FOUND',cls:'s-notfound',title:'Органика — нет в БД',outcome:'Маршрут NOT_FOUND — смешанная конкурентная витрина: ЦФ №1 + 2–3 МФО + карты'};
}
function quizTopOffers(route,grade){
 const map={
  CF_TARGET:[['Центрофинанс PDL','одобрение 92%, прямой API'],['Центрофинанс Installment','одобрение 88%, длинная линейка'],['Карта ЦФ кэшбек','одобрение 85%, пост-выдача']],
  CF_NON_CORE:[['Банк-партнёр · Ипотека','одобрение 84%'],['Банк-партнёр · Автокредит','одобрение 81%'],['Залоговый кредит','одобрение 80%']],
  CF_DORMANT:[['Центрофинанс рефинанс','скидка для returning'],['Кредитная карта 120 дней','без процентов'],['Беззалоговый кредит банка','одобрение 80%']],
  CF_REJECTED:[['МФО-партнёр №2 (PDL)','лояльный скоринг'],['МФО-партнёр №3 (контроль риска)','одобрение 80%'],['218-ФЗ: запрос БКИ','опционально, мягкий']],
  CF_OVERDUE:[['Банкротство физлиц (БФЛ)','CPA 2 000–3 000 ₽'],['HR-вакансии партнёра','доход для выхода из долга'],['Юридическая консультация','рассрочка платежей']],
  NOT_FOUND:[['Центрофинанс PDL','одобрение 88%'],['МФО-партнёр №2','одобрение 82%'],['Кредитная карта 120 дней','одобрение 80%']]
 };
 return map[route.code]||map.NOT_FOUND;
}
function renderQuizProto(){
 const host=document.getElementById('quizProto');
 if(!host)return;
 const st=QUIZ_PROTO_STATE;
 const steps=QUIZ_STEPS;
 const total=steps.length;
 const idx=Math.min(st.step,total);
 const progress=Math.round(idx/total*100);
 const grade=quizGradeFor(st.score);
 const profileEntries=Object.entries(st.profile);
 const profileText=profileEntries.length?JSON.stringify(Object.fromEntries(profileEntries),null,2):'// профиль пуст — ответьте на первый вопрос';
 // ---- chat messages
 const msgs=[];
 msgs.push(`<div class="qp-msg bot">Привет! Я Сенсей — помогу за 1 минуту узнать ваши шансы. Без отправки данных в банки.<div class="qp-msg-meta">шаг 0 · согласие 152-ФЗ</div></div>`);
 st.history.forEach(h=>{
  msgs.push(`<div class="qp-msg bot">${escapeHtml(h.prompt)}<div class="qp-msg-meta">шаг ${h.n} · id: ${escapeHtml(h.id)}</div></div>`);
  msgs.push(`<div class="qp-msg user">${escapeHtml(h.answer)}${h.delta?`<div class="qp-msg-meta">балл ${h.delta>=0?'+':''}${h.delta} → ${h.scoreAfter}</div>`:''}</div>`);
 });
 let quickHtml='';
 if(!st.done&&st.step<total){
  const cur=steps[st.step];
  msgs.push(`<div class="qp-msg bot">${escapeHtml(cur.prompt)}<div class="qp-msg-meta">шаг ${st.step+1}/${total} · id: ${escapeHtml(cur.id)} · type: ${escapeHtml(cur.type)}</div></div>`);
  const opts=cur.opts&&cur.opts.length?cur.opts:[['Продолжить']];
  quickHtml=opts.map((o,i)=>{
   const cls=o[1]==='warn'?'warn':(o[1]==='ghost'?'ghost':'');
   return `<button class="${cls}" type="button" data-qp-pick="${i}">${escapeHtml(o[0])}</button>`;
  }).join('');
  if(cur.skip)quickHtml+=`<button class="skip" type="button" data-qp-skip="1">пропустить →</button>`;
 }else if(st.done){
  msgs.push(`<div class="qp-msg bot">Готово! Прескоринг посчитан, top-3 офферов подобраны. Смотрите результат →<div class="qp-msg-meta">финал · SOS-grade ${grade.label}</div></div>`);
  quickHtml=`<button type="button" data-qp-restart="1">⟲ Пройти заново</button>`;
 }
 // ---- result panel (only after the final step)
 let resultHtml='';
 if(st.done){
  const route=quizRouteFor(st.profile,grade);
  const offers=quizTopOffers(route,grade);
  resultHtml=`<div class="qp-result"><h4>Результат · Smart Safe Router</h4>`+
   `<h5>${escapeHtml(route.title)} <span class="qp-route-code">${escapeHtml(route.code)}</span></h5>`+
   `<div class="qp-stub" style="font-style:normal">${escapeHtml(route.outcome)}</div>`+
   `<ol>${offers.map(o=>`<li><b>${escapeHtml(o[0])}</b> — ${escapeHtml(o[1])}</li>`).join('')}</ol>`+
   `</div>`;
 }else{
  resultHtml=`<div class="qp-stub">Top-3 офферов и маршрут Smart Safe Router появятся после прохождения всех шагов.</div>`;
 }
 host.innerHTML=
  `<div class="qp-chat">`+
   `<div class="qp-header">`+
    `<div class="qp-h-left"><div class="qp-avatar">С</div><div class="qp-title">Сенсей<small>чат-помощник · USE_MOCK</small></div></div>`+
    `<div class="qp-progress" aria-label="Прогресс ${progress}%"><div class="qp-progress-bar" style="width:${progress}%"></div></div>`+
    `<button class="qp-restart" type="button" data-qp-restart="1">Сброс</button>`+
   `</div>`+
   `<div class="qp-messages" id="qpMessages">${msgs.join('')}</div>`+
   `<div class="qp-quick">${quickHtml}</div>`+
  `</div>`+
  `<div class="qp-side">`+
   `<h4>Скоринг (база 68)</h4>`+
   `<div class="qp-score-box">`+
    `<div class="qp-score-row"><span>Текущий балл</span><b>${st.score}</b><span class="qp-grade ${grade.cls}">${grade.label}</span></div>`+
    `<div class="qp-score-row"><span>Одобрение (оценка)</span><span>${escapeHtml(grade.approval)}</span></div>`+
    `<div class="qp-score-row"><span>Шаг</span><span>${idx}/${total}</span></div>`+
   `</div>`+
   `<h4>JSON-профиль (session)</h4>`+
   `<div class="qp-profile">${escapeHtml(profileText)}</div>`+
   `<h4>Маршрут и top-3 офферов</h4>`+
   resultHtml+
  `</div>`;
 const msgEl=host.querySelector('#qpMessages');
 if(msgEl)msgEl.scrollTop=msgEl.scrollHeight;
}
function handleQuizProtoClick(ev){
 const btn=ev.target.closest('[data-qp-pick],[data-qp-skip],[data-qp-restart]');
 if(!btn||!btn.closest('#quizProto'))return;
 const st=QUIZ_PROTO_STATE;
 if(btn.dataset.qpRestart){
  st.step=0;st.profile={};st.history=[];st.score=68;st.done=false;
  renderQuizProto();return;
 }
 if(st.step>=QUIZ_STEPS.length){renderQuizProto();return}
 const cur=QUIZ_STEPS[st.step];
 if(btn.dataset.qpSkip){
  st.history.push({n:st.step+1,id:cur.id,prompt:cur.prompt,answer:'(пропущено)',delta:0,scoreAfter:st.score});
  st.step+=1;
 }else{
  const pickIdx=parseInt(btn.dataset.qpPick,10)||0;
  const opt=(cur.opts&&cur.opts[pickIdx])||['Продолжить'];
  const answer=opt[0];
  const delta=quizScoreDelta(cur.id,answer);
  st.score+=delta;
  st.profile[cur.id]=answer;
  st.history.push({n:st.step+1,id:cur.id,prompt:cur.prompt,answer,delta,scoreAfter:st.score});
  st.step+=1;
 }
 if(st.step>=QUIZ_STEPS.length)st.done=true;
 renderQuizProto();
}
document.addEventListener('click',handleQuizProtoClick);
function renderQuiz(){
 const goals=document.getElementById('quizGoals');
 if(!goals)return;
 goals.innerHTML=QUIZ_GOALS.map((g,i)=>`<div class="route-goal"><span class="rg-num">${i+1}</span><span class="rg-text">${escapeHtml(g)}</span></div>`).join('');
 const steps=document.getElementById('quizSteps');
 steps.innerHTML=QUIZ_STEPS.map((s,i)=>{
  const opts=(s.opts||[]).map(o=>`<span class="qs-chip${o[1]==='warn'?' qs-chip-warn':''}">${escapeHtml(o[0])}</span>`).join('');
  return `<div class="quiz-step ${s.cls||''}" data-n="${i+1}">`+
   `<div class="qs-id">id: ${escapeHtml(s.id)} · type: ${escapeHtml(s.type)}</div>`+
   `<div class="qs-title">${escapeHtml(s.title)}</div>`+
   `<div class="qs-prompt">«${escapeHtml(s.prompt)}»</div>`+
   (opts?`<div class="qs-opts">${opts}</div>`:'')+
   (s.skip?`<span class="qs-skip">может быть пропущен</span>`:'')+
   `<div class="qs-meta">${escapeHtml(s.meta)}</div>`+
   `<div class="qs-meta"><b>Зачем:</b> ${escapeHtml(s.note)}</div>`+
   `</div>`;
 }).join('');
 const scoring=document.getElementById('quizScoringTable');
 scoring.innerHTML=`<thead><tr><th>Правило</th><th>Δ балла</th></tr></thead><tbody>`+
  QUIZ_SCORING.map(r=>`<tr><td>${escapeHtml(r[0])}</td><td>${escapeHtml(r[1])}</td></tr>`).join('')+`</tbody>`;
 const grades=document.getElementById('quizGradeTable');
 grades.innerHTML=`<thead><tr><th>Грейд</th><th>Шанс</th><th>Что показываем</th><th>Действие</th></tr></thead><tbody>`+
  QUIZ_GRADES.map(g=>`<tr>`+
   `<td><span class="quiz-grade-cell"><span class="qgc-dot ${g.cls}"></span>${escapeHtml(g.grade)}</span></td>`+
   `<td>${escapeHtml(g.approval)}</td>`+
   `<td>${escapeHtml(g.route)}</td>`+
   `<td>${escapeHtml(g.action)}</td>`+
   `</tr>`).join('')+`</tbody>`;
 const flow=document.getElementById('quizFlow');
 flow.innerHTML=QUIZ_FLOW.map(s=>`<div class="quiz-flow-stage ${s.cls||''}">`+
  `<span class="qf-tag">${escapeHtml(s.tag)}</span>`+
  `<span class="qf-title">${escapeHtml(s.title)}</span>`+
  `<span class="qf-desc">${s.desc}</span>`+
  `</div>`).join('');
 const cjmGrid=document.getElementById('quizCjmGrid');
 if(cjmGrid){
  cjmGrid.innerHTML=QUIZ_CJM_MAP.map(r=>`<article class="quiz-cjm-card ${escapeHtml(r.cls)}">`+
   `<div class="quiz-cjm-head"><h3>${escapeHtml(r.title)}</h3><span class="quiz-cjm-code">${escapeHtml(r.code)}</span></div>`+
   `<span class="qcm-grade">Грейд: ${escapeHtml(r.grade)}</span>`+
   `<div class="quiz-cjm-section"><span class="qcl-h">Сигналы квиза</span><div class="quiz-cjm-signals">${r.signals.map(s=>`<span class="quiz-cjm-signal">${escapeHtml(s)}</span>`).join('')}</div></div>`+
   `<div class="quiz-cjm-section"><span class="qcl-h">Маршрутизация в витрине</span><span class="qcl-body">${escapeHtml(r.routing)}</span></div>`+
   `<div class="quiz-cjm-section"><span class="qcl-h">Результат</span><span class="qcl-body">${escapeHtml(r.outcome)}</span></div>`+
   `</article>`).join('');
 }
 const handoff=document.getElementById('quizHandoff');
 if(handoff)handoff.innerHTML=QUIZ_HANDOFF.map(h=>`<div class="card tight"><div class="card-title"><div><h2>${escapeHtml(h.title)}</h2><p>${h.desc}</p></div></div></div>`).join('');
 renderQuizProto();
}
// Drag-to-scroll для широкой PNL-таблицы: зажатая левая кнопка мыши тянет таблицу влево/вправо.
function initDragScroll(){
 document.querySelectorAll('[data-drag-scroll]').forEach(el=>{
  if(el.dataset.dragScrollInit==='1')return;
  el.dataset.dragScrollInit='1';
  let down=false,startX=0,startScroll=0,moved=0;
  el.addEventListener('mousedown',e=>{
   if(e.button!==0)return;
   const target=e.target;
   // Не перехватываем клики по интерактивным элементам внутри таблицы.
   if(target.closest('a,button,input,select,textarea,[data-drill-kind]'))return;
   down=true;moved=0;startX=e.pageX-el.offsetLeft;startScroll=el.scrollLeft;
   el.classList.add('is-dragging');
  });
  const stop=()=>{if(!down)return;down=false;el.classList.remove('is-dragging')};
  window.addEventListener('mouseup',stop);
  el.addEventListener('mouseleave',stop);
  el.addEventListener('mousemove',e=>{
   if(!down)return;
   e.preventDefault();
   const x=e.pageX-el.offsetLeft;
   const dx=x-startX;
   moved+=Math.abs(dx);
   el.scrollLeft=startScroll-dx;
  });
 });
}
// ===================================================================================
// EconomicsModel bridge (TZ Раздел 1: единый расчётный слой).
// Все разделы дашборда читают экономические агрегаты через ecoModel(), а не из
// разрозненных констант. Любое изменение modelInputs триггерит rebuild и через
// renderAll() пересчитывает: KPI, payback, CJM waterfall, валидаторы, светофор.
// ===================================================================================
function ecoBaseSeries(){
 // Адаптер к существующим переменным модуля: горизонт, ряды по каналам и итоги.
 return {
  months,revenue,expenses,visits,offerClicks,applications,approvals,repeat,
  revenueSEO,revenuePPC,revenuePR,revenueRepeat,
  expensesSEO,expensesPPC,expensesPR,expensesRepeat,
  trafficSEO,trafficPPC,trafficPR,
  budgetSEO,budgetDirect,budgetPR,
  expensesFixed:expensesPayroll.map((v,i)=>v+expensesInfra[i]),
  cjmNoncoreUsers:(scenarios.find(s=>s.name==='Хочу машину')||{}).users,
  cjmOverdueUsers:(scenarios.find(s=>s.name==='Перегруженный клиент')||{}).users,
  totals
 };
}
function ecoInputsFromUI(){
 // Маппинг modelInputs → форма, которую ожидает EconomicsModel.build.
 const m=modelInputs;
 return {
  issuedToApprovalRate:m.issuedToApprovalRate,ltvFactor:m.ltvFactor,partnerPayout:m.partnerPayout,
  targetRepeatShare:m.targetRepeatShare,
  router:{matchRate:m.routerMatch,pApprovalStep2:m.routerApv2,pApprovalStep3:m.routerApv3,
   payoutSecondary:m.routerPayout2,payoutTertiary:m.routerPayout3,attributionShare:1.0},
  cross:{pCard:m.crossCard,pInsurance:m.crossInsurance,payoutCross:m.crossPayout},
  crm:{repeatRate12m:m.repeatRate12m,marginRepeat:m.repeatMargin,churnMonthly:m.churnMonthly},
  tier:{bonusPerTier:m.tierBonus,volumePerTier:4000}
 };
}
let _ecoModelCache=null,_ecoModelDirty=true;
function ecoInvalidate(){_ecoModelDirty=true}
function ecoModel(){
 if(!_ecoModelDirty&&_ecoModelCache)return _ecoModelCache;
 if(typeof window.EconomicsModel==='undefined')return null;
 try{_ecoModelCache=window.EconomicsModel.build(ecoInputsFromUI(),ecoBaseSeries());}
 catch(e){console.error('EconomicsModel build failed',e);_ecoModelCache=null}
 _ecoModelDirty=false;return _ecoModelCache;
}
// ===================================================================================
// TZ §C2 — пресеты сценариев Конс / Базовый / Маркетплейс зрелый из EconomicsModel.
// Полный пресет состоит из патча на DEFAULT_MARKETPLACE_INPUTS + legacy-полей.
// ===================================================================================
function applyEcoPreset(presetId){
 const p=(window.EconomicsModel?.PRESETS||[]).find(x=>x.id===presetId);
 if(!p)return false;
 const patch=p.patch||{};
 const next={...modelInputs};
 if(patch.router){
  if(patch.router.matchRate!=null)next.routerMatch=patch.router.matchRate;
  if(patch.router.pApprovalStep2!=null)next.routerApv2=patch.router.pApprovalStep2;
  if(patch.router.pApprovalStep3!=null)next.routerApv3=patch.router.pApprovalStep3;
  if(patch.router.payoutSecondary!=null)next.routerPayout2=patch.router.payoutSecondary;
  if(patch.router.payoutTertiary!=null)next.routerPayout3=patch.router.payoutTertiary;
 }
 if(patch.cross){
  if(patch.cross.pCard!=null)next.crossCard=patch.cross.pCard;
  if(patch.cross.pInsurance!=null)next.crossInsurance=patch.cross.pInsurance;
  if(patch.cross.payoutCross!=null)next.crossPayout=patch.cross.payoutCross;
 }
 if(patch.crm){
  if(patch.crm.repeatRate12m!=null)next.repeatRate12m=patch.crm.repeatRate12m;
  if(patch.crm.marginRepeat!=null)next.repeatMargin=patch.crm.marginRepeat;
  if(patch.crm.churnMonthly!=null)next.churnMonthly=patch.crm.churnMonthly;
 }
 if(patch.tier&&patch.tier.bonusPerTier!=null)next.tierBonus=patch.tier.bonusPerTier;
 if(patch.ltvFactor!=null)next.ltvFactor=patch.ltvFactor;
 if(patch.targetRepeatShare!=null)next.targetRepeatShare=patch.targetRepeatShare;
 if(patch.issuedToApprovalRate!=null)next.issuedToApprovalRate=patch.issuedToApprovalRate;
 fillModelInputs(next);
 modelInputs=currentDraftInputs();ecoInvalidate();
 recordAction(`Применён сценарий «${p.label}»: ${p.note}`);
 persistModelInputs();renderAll();
 return true;
}
function renderEcoPresets(){
 const el=document.getElementById('scenarioActions');if(!el)return;
 const presets=window.EconomicsModel?.PRESETS||[];
 el.innerHTML=presets.map(p=>`<button class="action" data-eco-preset="${escapeHtml(p.id)}" type="button" title="${escapeHtml(p.note)}">${escapeHtml(p.label)}</button>`).join('');
}
// ===================================================================================
// TZ §C — validators панель (раздел 2: коридоры правдоподобности).
// Жёлтые/красные подсветки полей + список нарушений + блокировка «зелёного» статуса.
// ===================================================================================
function renderValidators(){
 const host=document.getElementById('validatorsPanel');if(!host)return;
 const E=window.EconomicsModel;if(!E){host.innerHTML='';return}
 const draft=currentDraftInputs();
 const ecoInputs={
  router:{matchRate:draft.routerMatch,pApprovalStep2:draft.routerApv2,pApprovalStep3:draft.routerApv3},
  cross:{pCard:draft.crossCard,pInsurance:draft.crossInsurance},
  crm:{repeatRate12m:draft.repeatRate12m},
  tier:{bonusPerTier:draft.tierBonus},
  funnel:{crApplicationToApproval:ratio(totals.approvals,totals.applications)}
 };
 const warnings=E.validateCorridors(ecoInputs);
 // Подсветить инпуты
 document.querySelectorAll('[data-corridor]').forEach(input=>{
  const path=input.dataset.corridor;
  const bad=warnings.find(w=>w.path===path);
  input.classList.toggle('is-corridor-error',!!bad);
 });
 if(!warnings.length){
  host.innerHTML=`<div class="validator-row is-ok">Все вводные в коридоре правдоподобности (PDL CR 18–35%, repeat 25–55%, match 40–70%, tier ≤ 25%)</div>`;
  return;
 }
 host.innerHTML=warnings.map(w=>{
  const valTxt=w.path.startsWith('tier.')||w.path.startsWith('router.payout')?w.value.toFixed(2):pct(w.value*100);
  return `<div class="validator-row is-error">${escapeHtml(w.label)}: ${escapeHtml(valTxt)} — ${escapeHtml(w.message)}</div>`;
 }).join('');
}
// ===================================================================================
// SEO-этапы (чек-лист Маркина) удалены из UI инвесткомитета. Файл data/seo-stages.json
// сохраняется в репозитории как офлайн-материал и больше не подключается к дашборду.
// ===================================================================================
function renderSeoStages(){/* удалено: чек-лист SEO-этапов не выводится на дашборде */}
// ===================================================================================
// TZ §C3 — Экспорт / Импорт сценария в JSON.
// ===================================================================================
function exportScenarioJSON(){
 const payload={version:STORAGE_VERSION,exportedAt:new Date().toISOString(),inputs:modelInputs};
 const blob=new Blob([JSON.stringify(payload,null,2)],{type:'application/json'});
 const url=URL.createObjectURL(blob);
 const a=document.createElement('a');a.href=url;a.download='vyruchai-scenario.json';document.body.appendChild(a);a.click();a.remove();
 setTimeout(()=>URL.revokeObjectURL(url),0);
 recordAction('Сценарий выгружен в JSON');
}
function importScenarioJSON(file){
 const r=new FileReader();
 r.onload=()=>{
  try{
   const p=JSON.parse(String(r.result||'{}'));
   if(p.inputs){modelInputs=normalizeModelInputs(p.inputs);fillModelInputs(modelInputs)}
   ecoInvalidate();persistModelInputs();
   recordAction('Сценарий загружен из JSON');renderAll();
  }catch(e){console.error('Import failed',e);alert('Не удалось прочитать JSON-сценарий')}
 };
 r.readAsText(file);
}
// ===================================================================================
// TZ §F2 + §F3 — smoke-сверка модели против baseline PNL (в консоль).
// ===================================================================================
let _pnlBaseline=null;
function loadPnlBaseline(){
 if(_pnlBaseline)return Promise.resolve(_pnlBaseline);
 return fetch('data/pnl-baseline.json').then(r=>r.ok?r.json():null).then(j=>{_pnlBaseline=j;return j}).catch(()=>null);
}
function runPnlSmokeCheck(){
 loadPnlBaseline().then(base=>{
  const m=ecoModel();if(!base||!m||!window.EconomicsModel)return;
  const diff=window.EconomicsModel.comparePnl(m,base);if(!diff)return;
  const worstRev=Math.abs(diff.worst.revenue||0)*100;
  if(worstRev>5)console.warn('[smoke] EconomicsModel vs PNL baseline: worst monthly revenue delta',worstRev.toFixed(1)+'% (порог 5%)');
  else console.info('[smoke] EconomicsModel vs PNL baseline: worst monthly revenue delta',worstRev.toFixed(1)+'% (ok)');
 });
}

function fillModelInputs(values){
 const v={...DEFAULT_MODEL_INPUTS,...values};
 const set=(id,val)=>{const el=document.getElementById(id);if(el)el.value=val};
 set('inputIssuedRate',(v.issuedToApprovalRate*100).toFixed(1));
 set('inputLtvFactor',Number(v.ltvFactor).toFixed(2));
 set('inputPartnerPayout',Math.round(Number(v.partnerPayout)));
 set('inputRepeatTarget',(v.targetRepeatShare*100).toFixed(1));
 set('inputBaseSize',Number(v.centrofinansBaseSize).toFixed(1));
 set('inputMatchRate',(v.centrofinansMatchRate*100).toFixed(1));
 set('inputRouterMatch',(v.routerMatch*100).toFixed(1));
 set('inputRouterApv2',(v.routerApv2*100).toFixed(1));
 set('inputRouterApv3',(v.routerApv3*100).toFixed(1));
 set('inputRouterPayout2',Math.round(v.routerPayout2));
 set('inputRouterPayout3',Math.round(v.routerPayout3));
 set('inputCrossCard',(v.crossCard*100).toFixed(1));
 set('inputCrossInsurance',(v.crossInsurance*100).toFixed(1));
 set('inputCrossPayout',Math.round(v.crossPayout));
 set('inputRepeatRate12m',(v.repeatRate12m*100).toFixed(1));
 set('inputRepeatMargin',Math.round(v.repeatMargin));
 set('inputChurnMonthly',(v.churnMonthly*100).toFixed(1));
 set('inputTierBonus',(v.tierBonus*100).toFixed(1));
 renderModelDirtyState();
 renderValidators();
}
function init(){
 const persisted=safeRead(STORAGE_KEYS.prefs,{});
 modelInputs=normalizeModelInputs(safeRead(STORAGE_KEYS.model,DEFAULT_MODEL_INPUTS));
 recentActions=Array.isArray(safeRead(STORAGE_KEYS.actions,[]))?safeRead(STORAGE_KEYS.actions,[]):[];
 state.role=persisted.role||state.role;
 state.channel=persisted.channel||state.channel;
 state.scenario=persisted.scenario||state.scenario;
 state.activeTab=persisted.activeTab||state.activeTab;
 // Если сохранённая вкладка была удалена из меню (например, experiments/partners), возвращаемся к обзору.
 if(!document.querySelector(`.tab[data-tab="${state.activeTab}"]`))state.activeTab='overview';
 document.documentElement.dataset.theme=persisted.theme||document.documentElement.dataset.theme||'light';
 fillModelInputs(modelInputs);
 renderAll();
 initDragScroll();
 // TZ §F3 — сверить модель с baseline PNL после первого рендера.
 setTimeout(runPnlSmokeCheck,300);
}
const tabs=document.querySelectorAll('.tab'),panels=document.querySelectorAll('.panel');
tabs.forEach(t=>t.addEventListener('click',()=>{tabs.forEach(x=>x.classList.remove('active'));panels.forEach(x=>x.classList.remove('active'));t.classList.add('active');document.getElementById('tab-'+t.dataset.tab).classList.add('active');state.activeTab=t.dataset.tab;persistPreferences();requestAnimationFrame(()=>{renderCharts();if(state.activeTab==='unit')renderCjmUnitEconomics();})}));
// TZ §4.3: клик по заголовку таблицы #unitTable переключает сортировку.
document.addEventListener('click',e=>{
 const th=e.target.closest?.('#unitTable thead th[data-sort-key]');
 if(!th)return;
 const key=th.dataset.sortKey;
 if(unitTableSort.key===key)unitTableSort.dir=unitTableSort.dir==='asc'?'desc':'asc';
 else{unitTableSort.key=key;unitTableSort.dir=key==='name'?'asc':'desc'}
 renderUnitTable();
});
document.querySelectorAll('.filters select').forEach(sel=>{const label=sel.getAttribute('aria-label');sel.addEventListener('change',()=>{const v=sel.value;if(label==='Канал')state.channel=v;else if(label==='Сценарий')state.scenario=v;else if(label==='Роль'){state.role=v;if(state.activeTab==='overview'&&ROLE_PROFILES[v]?.recommendedTab)state.activeTab=ROLE_PROFILES[v].recommendedTab};persistPreferences();renderAll()})});
document.getElementById('themeToggle').addEventListener('click',()=>{const root=document.documentElement;root.dataset.theme=root.dataset.theme==='dark'?'light':'dark';persistPreferences();requestAnimationFrame(()=>{renderCharts();if(state.activeTab==='unit')renderCjmUnitEconomics();})});
document.querySelectorAll('#inputIssuedRate,#inputLtvFactor,#inputPartnerPayout,#inputRepeatTarget,#inputBaseSize,#inputMatchRate,#inputRouterMatch,#inputRouterApv2,#inputRouterApv3,#inputRouterPayout2,#inputRouterPayout3,#inputCrossCard,#inputCrossInsurance,#inputCrossPayout,#inputRepeatRate12m,#inputRepeatMargin,#inputChurnMonthly,#inputTierBonus').forEach(input=>input.addEventListener('input',()=>{renderModelDirtyState();renderValidators()}));
document.getElementById('saveModelInputs').addEventListener('click',()=>{modelInputs=currentDraftInputs();ecoInvalidate();recordAction(`Обновлены вводные модели: выдача ${pct(modelInputs.issuedToApprovalRate*100)}, LTV ${modelInputs.ltvFactor.toFixed(2)}x, выплата ${fmt(partnerPayoutValue())} ₽, match роутера ${pct(modelInputs.routerMatch*100)}`);persistModelInputs();renderAll()});
document.getElementById('resetModelInputs').addEventListener('click',()=>{fillModelInputs(DEFAULT_MODEL_INPUTS);ecoInvalidate();recordAction('Поля модели сброшены к базовому пресету');renderModelDirtyState();renderValidators()});
document.addEventListener('click',e=>{
 const ecoPreset=e.target.closest('[data-eco-preset]');
 if(ecoPreset){applyEcoPreset(ecoPreset.dataset.ecoPreset);return}
 const preset=e.target.closest('[data-preset-id]');if(preset){const cfg=MODEL_PRESETS.find(x=>x.id===preset.dataset.presetId);if(cfg){fillModelInputs(cfg.values);state.role=cfg.role;state.channel=cfg.channel;state.scenario=cfg.scenario;state.activeTab=ROLE_PROFILES[cfg.role]?.recommendedTab||state.activeTab;persistPreferences();recordAction(`Выбран пресет ${cfg.label}: ${cfg.note}`);renderAll();}return;}
 const drill=e.target.closest('[data-drill-kind]');if(drill){openDrawer(drill.dataset.drillKind,drill.dataset.drillId);return;}
});
document.getElementById('exportScenarioBtn')?.addEventListener('click',exportScenarioJSON);
document.getElementById('importScenarioFile')?.addEventListener('change',e=>{const f=e.target.files?.[0];if(f)importScenarioJSON(f);e.target.value=''});
document.addEventListener('keydown',e=>{const drill=e.target.closest?.('[data-drill-kind]');const nativeTag=['BUTTON','A','INPUT','SELECT','TEXTAREA'].includes(e.target?.tagName);if(drill&&(e.key==='Enter'||(e.key===' '&&!nativeTag))){e.preventDefault();openDrawer(drill.dataset.drillKind,drill.dataset.drillId);}if(e.key==='Escape')closeDrawer()});
document.getElementById('drawerClose').addEventListener('click',closeDrawer);
let resizeTimer;window.addEventListener('resize',()=>{clearTimeout(resizeTimer);resizeTimer=setTimeout(renderCharts,120)});
init();
