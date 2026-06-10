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
  ctx.font='11px '+chartFont();
  const yLabelW=Math.max(...ticks.map(t=>ctx.measureText(shortNum(t)).width),28);
  const padL=Math.ceil(yLabelW)+12;
  const padR=16;
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
  const xLabelH=rotateX?42:24;
  // Зазор между блоком легенды и областью графика, чтобы подписи рядов не наезжали на сам график.
  const legendGap=legendItems.length?12:0;
  const pad={l:padL,r:padR,t:8+legendH+legendGap,b:xLabelH};
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
  ctx.font='11px '+chartFont();ctx.textBaseline='middle';
  ticks.forEach(t=>{const y=scale(t);ctx.strokeStyle=t===0?colors.line:colors.line+'66';ctx.lineWidth=1;ctx.beginPath();ctx.moveTo(pad.l,y);ctx.lineTo(width-pad.r,y);ctx.stroke();ctx.fillStyle=colors.muted;ctx.textAlign='right';ctx.fillText(shortNum(t),pad.l-8,y)});
  // X axis labels
  ctx.textBaseline='alphabetic';ctx.textAlign='center';ctx.fillStyle=colors.muted;
  const maxLabelWidth=Math.max(...labels.map(label=>ctx.measureText(String(label)).width),24);
  const approxSpan=rotateX?22:maxLabelWidth+14;
  const step=Math.max(1,Math.ceil(labels.length*approxSpan/Math.max(plotW,1)));
  labels.forEach((label,i)=>{if(i%step!==0&&i!==labels.length-1)return;const x=labels.length===1?pad.l+plotW/2:pad.l+(i/(labels.length-1))*plotW;const s=String(label);ctx.save();ctx.translate(x,height-(rotateX?8:6));if(rotateX){ctx.rotate(-Math.PI/6);ctx.textAlign='right';ctx.fillText(s,0,0)}else{ctx.fillText(s,0,0)}ctx.restore()});
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
     return `<div class="tt-row"><span class="tt-label"><span class="tt-sw" style="background:${swatch}"></span>${label}</span><b>${shortNum(Number(raw))}</b></div>`;
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


const months=['Май 2026','Июнь 2026','Июль 2026','Август 2026','Сентябрь 2026','Октябрь 2026','Ноябрь 2026','Декабрь 2026','Январь 2027','Февраль 2027','Март 2027','Апрель 2027','Май 2027','Июнь 2027','Июль 2027','Август 2027','Сентябрь 2027','Октябрь 2027','Ноябрь 2027','Декабрь 2027'];
const revenue=[127360.5978,159117.9348,221445,341018.8043,532290.0652,795462.7891,1070183.369,1765383.335,1877356.452,2129657.314,2445466.57,3254744.138,3909008.9,4753230.091,5833006.543,6741346.983,7831355.51,9292788.909,10540212.54,12276711.91];
const expenses=[1275000,1475000,1675000,1225000,1225000,1445000,1495000,1845000,1895000,1995000,1995000,2245000,2045000,2145000,2495000,2495000,2495000,2495000,2495000,2495000];
const profit=[-1147639.402,-1315882.065,-1453555,-883981.1957,-692709.9348,-649537.2109,-424816.6307,-79616.66459,-17643.54844,134657.3141,450466.5695,1009744.138,1864008.9,2608230.091,3338006.543,4246346.983,5336355.51,6797788.909,8045212.537,9781711.91];
const visits=[11570.65217,12145.65217,17233.47826,19388.47826,23283.22826,30897.37935,36476.59185,48558.70968,51240.66761,58538.64741,66469.74934,88726.41775,105310.8217,126820.3642,156532.2632,179143.0636,206276.0242,231007.8642,259511.9154,301819.5807];
const repeat=[196.701087,242.9130435,379.1365217,484.7119565,651.9303913,926.9213804,1203.727531,1699.554839,1793.423366,2341.545897,2991.13872,4436.320887,6318.6493,8496.964404,11739.91974,15048.01734,18564.84218,23100.78642,28546.31069,36218.34968];
const offerClicks=[2745.380435,3120.543478,4471.5,5364.684783,6875.157065,9133.879837,11127.85346,15406.68308,16360.39487,18583.39087,21386.54967,28696.46327,34551.18718,42139.74613,51741.60839,59742.10399,69342.6987,78123.71293,88249.97511,103147.5645];
const applications=[578.2744565,671.3206522,935.025,1251.552717,1786.739755,2457.727508,3155.618277,4629.2956,4963.094725,5588.534632,6569.64021,8899.196926,10948.3503,13604.34593,16583.47598,19383.64944,22743.85759,25817.21257,29361.40433,34575.56063];
const approvals=[132.7866848,159.1179348,218.295,316.548587,483.4146848,676.1645511,892.0285386,1347.89022,1450.396633,1627.718905,1926.346095,2612.430003,3235.079764,4041.362954,4914.200762,5767.910479,6792.36214,8175.127301,9328.149041,11008.00728];
const epc=[46.3,51.0,49.4,63.5,77.4,87.0,96.1,114.6,114.7,114.6,114.3,113.4,113.1,112.8,112.7,112.8,112.9,119.0,119.4,119.0];
const trafficSEO=[2875,3450,4140,6210,9936,12916.8,18083.52,25316.928,27848.6208,30633.48288,38291.8536,53608.59504,69691.17355,90598.52562,108718.2307,130461.8769,156554.2523,180037.3901,207042.9986,248451.5983];
const trafficPPC=[8695.652174,8695.652174,13043.47826,13043.47826,13043.47826,17391.30435,17391.30435,21739.13043,21739.13043,26086.95652,26086.95652,32608.69565,32608.69565,32608.69565,43478.26087,43478.26087,43478.26087,43478.26087,43478.26087,43478.26087];
const trafficPR=[0,0,50,135,303.75,589.275,1001.7675,1502.65125,1652.916375,1818.208013,2090.939214,2509.127057,3010.952469,3613.142962,4335.771555,5202.925866,6243.511039,7492.213247,8990.655896,9889.721486];
const budgetDirect=[200000,200000,300000,300000,300000,400000,400000,500000,500000,600000,600000,750000,750000,750000,1000000,1000000,1000000,1000000,1000000,1000000];
const budgetSEO=[300000,350000,450000,450000,450000,550000,550000,600000,650000,650000,650000,700000,700000,800000,900000,900000,900000,900000,900000,900000];
const budgetPR=[200000,200000,300000,300000,300000,400000,400000,500000,200000,200000,200000,250000,250000,250000,250000,250000,250000,250000,250000,250000];
const totals={revenue:75897147.75,expenses:38950000,profit:36947147.75,visits:2030951.549,repeat:165381.8654,clicks:670311.0778,applications:214503.8772,approvals:65105.33756,directRevenue:14361739.13,seoRevenue:53920909.98,prRevenue:7614498.645,directSpend:12550000,seoSpend:13250000,prSpend:5450000};
const cumulative=a=>a.reduce((acc,v,i)=>{acc.push((acc[i-1]||0)+v);return acc},[]);
const cumulativeRevenue=cumulative(revenue), cumulativeInvestment=cumulative(expenses), cumulativeProfit=cumulative(profit);
const firstMonthlyProfitIndex=profit.findIndex(v=>v>0), paybackIndex=cumulativeProfit.findIndex(v=>v>=0);

// Краткие подписи месяцев в формате "ММ.ГГ" (10.26, 11.26 ...) — компактный таймлайн для 20 месяцев.
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
// Дисконтирование денежных потоков: накопленная дисконтированная прибыль считается в функции cumulativeDiscounted() ниже в логике рендера.

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
 {key:'mfo',label:'Микрозаймы (МФО)',share:0.55,partners:'Центрофинанс, МФО Север, МФО Риск'},
 {key:'loan',label:'Кредиты и рефинансирование',share:0.14,partners:'Банк Город'},
 {key:'card',label:'Кредитные карты',share:0.12,partners:'Карта Плюс'},
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
// Базовые допущения demo-модели: 76% одобрений доходят до выдачи, LTV выше базовой выручки в 1.34x, NPV считаем от 20% годовых, цель repeat-share — 6%.
const DEFAULT_MODEL_INPUTS={issuedToApprovalRate:0.76,ltvFactor:1.34,annualDiscountRate:0.20,targetRepeatShare:0.06};
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
  annualDiscountRate:clamp(Number(raw?.annualDiscountRate)||DEFAULT_MODEL_INPUTS.annualDiscountRate,0,1),
  targetRepeatShare:clamp(Number(raw?.targetRepeatShare)||DEFAULT_MODEL_INPUTS.targetRepeatShare,0,1)
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
 {id:'p-02',name:'МФО Север',type:'CPA',status:'активен',sla:'97.1%',response:'1.2 с',approval:31,issue:22,revenue:11700000,epc:116,ecpa:810,complaints:1.7,reject:'Возраст, регион',action:'закрепить'},
 {id:'p-03',name:'Банк Город',type:'прямой API',status:'наблюдение',sla:'93.0%',response:'2.8 с',approval:22,issue:15,revenue:9300000,epc:104,ecpa:1190,complaints:2.9,reject:'КИ, доход',action:'понизить'},
 {id:'p-04',name:'Карта Плюс',type:'CPA',status:'активен',sla:'98.0%',response:'780 мс',approval:27,issue:18,revenue:6400000,epc:91,ecpa:670,complaints:1.1,reject:'Скоринг банка',action:'кросс-продажа'},
 {id:'p-05',name:'Страховой партнёр',type:'CPA',status:'активен',sla:'98.8%',response:'610 мс',approval:35,issue:25,revenue:3900000,epc:84,ecpa:430,complaints:0.6,reject:'Не подходит продукт',action:'закрепить'},
 {id:'p-06',name:'МФО Риск',type:'ручной',status:'риск',sla:'88.5%',response:'4.6 с',approval:16,issue:9,revenue:1700000,epc:42,ecpa:1510,complaints:5.4,reject:'Пустые ответы',action:'пауза'}
];
const flows=[
 {name:'Обычный список',users:100000,offers:5.8,approval:24,issued:17,revenue:92,time:'9 мин',note:'Широкий каталог, ниже точность'},
 {name:'AI топ-3',users:100000,offers:3,approval:32,issued:23,revenue:118,time:'4 мин',note:'Рост одобрения и выручки на пользователя'},
 {name:'SOS',users:100000,offers:2.4,approval:38,issued:29,revenue:136,time:'2 мин',note:'Ограниченная подача, меньше риск для КИ'}
];
const aiRows=[
 ['rec-2026-001','До зарплаты','Центрофинанс API, МФО Север, Карта Плюс','стабильный доход, быстрое решение',0.74,'одобрено',18.6,41,96],
 ['rec-2026-002','Есть долги','Банк Город, МФО Север, Центрофинанс API','низкий ПДН, подходит рефинансирование',0.52,'отказ',9.4,24,91],
 ['rec-2026-003','Перегруженный клиент','Центрофинанс API, МФО Риск','подходит SOS, ограниченная отправка',0.61,'одобрено',14.1,33,88],
 ['rec-2026-004','Страхование','Страховой партнёр, Карта Плюс','подходит кросс-продажа, активный полис',0.68,'одобрено',12.8,35,94]
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
 {severity:'red',entity:'МФО Риск',reason:'SLA ниже 90%, время ответа 4.6 с',action:'Поставить партнёра на паузу и вывести из SOS'},
 {severity:'yellow',entity:'Банк Город',reason:'Прогноз одобрения 33%, факт 22%',action:'Понизить в ранжировании и проверить скоринг'},
 {severity:'yellow',entity:'Яндекс.Директ',reason:'CAC выше SEO на 28%',action:'Оставить только прибыльные группы объявлений'},
 {severity:'green',entity:'SEO long-tail',reason:'ROI 75%, EPC стабильно выше CPC',action:'Масштабировать страницы и ссылочную массу'},
 {severity:'yellow',entity:'Доля повторов',reason:'5.1% против цели 6%',action:'Усилить SMS D+14 и кросс-продажи'},
 {severity:'red',entity:'Пустые рекомендации',reason:'2.7% сессий без топ-3',action:'Включить резервный список и логировать отсутствующие ответы партнёров'}
];

function sum(a){return a.reduce((x,y)=>x+(Number.isFinite(Number(y))?Number(y):0),0)}
function fmt(n){return Math.round(n).toLocaleString('ru-RU')}
function money(n){return fmt(n)+' ₽'}
function mln(n){return (n/1000000).toLocaleString('ru-RU',{maximumFractionDigits:1})+' млн ₽'}
function pct(n){return Number(n).toLocaleString('ru-RU',{maximumFractionDigits:1})+'%'}
function ratio(a,b){return b? a/b:0}
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
 completeness:'полный исторический период, 20 месяцев',
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
 {id:'base',label:'База',values:{issuedToApprovalRate:0.76,ltvFactor:1.34,annualDiscountRate:0.20,targetRepeatShare:0.06},role:'Руководитель',channel:'Все каналы',scenario:'Все сценарии',note:'Базовая модель совета'},
 {id:'growth',label:'Рост',values:{issuedToApprovalRate:0.79,ltvFactor:1.41,annualDiscountRate:0.18,targetRepeatShare:0.06},role:'Рост',channel:'SEO',scenario:'До зарплаты',note:'Смещение в acquisition и SEO'},
 {id:'crm',label:'CRM',values:{issuedToApprovalRate:0.74,ltvFactor:1.52,annualDiscountRate:0.17,targetRepeatShare:0.08},role:'CRM',channel:'Повторный',scenario:'Есть долги',note:'Повышение repeat-share и LTV'},
 {id:'stress',label:'Стресс',values:{issuedToApprovalRate:0.69,ltvFactor:1.22,annualDiscountRate:0.24,targetRepeatShare:0.05},role:'Руководитель',channel:'Яндекс.Директ',scenario:'Перегруженный клиент',note:'Пессимистичный стресс-тест'}
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
 {id:'repair-bank',title:'Починить Банк Город',description:'Факт одобрения отстаёт от прогноза — нужен аудит скоринга и rank-модели.',severity:'warn',roles:['Операции','Продукт','Руководитель'],channels:['PR','Яндекс.Директ','Все каналы'],scenarios:['Есть долги','Все сценарии'],owner:'Операции',source:'партнёрский SLA и approval gap'},
 {id:'pause-risk',title:'Убрать МФО Риск из SOS',description:'Низкий SLA и жалобы создают репутационный и conversion-риск.',severity:'bad',roles:['Операции','Руководитель'],channels:['PR','Все каналы'],scenarios:['Перегруженный клиент','Все сценарии'],owner:'Операции',source:'alerts + partner card'},
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
const CHART_PANELS={chartOverview:'overview',chartInvestment:'overview',chartCacChannels:'overview',chartCostMix:'overview',chartProducts:'overview',chartTraffic:'traffic',chartEpc:'traffic',chartRetention:'retention',chartUnit:'unit'};
let lastDrawerFocus=null;

function activeRoleProfile(){return ROLE_PROFILES[state.role]||ROLE_PROFILES['Все роли']}
// Период-фильтр убран: бизнес-план всегда показывается за весь горизонт (20 месяцев).
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
function currentDraftInputs(){return normalizeModelInputs({issuedToApprovalRate:Number(document.getElementById('inputIssuedRate')?.value||0)/100,ltvFactor:Number(document.getElementById('inputLtvFactor')?.value||0),annualDiscountRate:Number(document.getElementById('inputAnnualDiscount')?.value||0)/100,targetRepeatShare:Number(document.getElementById('inputRepeatTarget')?.value||0)/100})}
function sameModelInputs(a,b){return ['issuedToApprovalRate','ltvFactor','annualDiscountRate','targetRepeatShare'].every(key=>Math.abs((a[key]||0)-(b[key]||0))<0.0001)}
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
function monthlyDiscountRate(){return Math.pow(1+modelInputs.annualDiscountRate,1/12)-1}
function cumulativeDiscounted(arr){const acc=[];let total=0;const rate=monthlyDiscountRate();arr.forEach((v,i)=>{total+=v/Math.pow(1+rate,i);acc.push(total)});return acc}
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
function buildInputData(ch){
 const comparison=comparePeriods(ch.rev);
 return [
  {title:'Период и база модели',value:'Май 2026 — декабрь 2027',text:`${months.length} мес. на горизонте плана; роль ${activeRoleProfile().label.toLowerCase()}.`},
  {title:'Инвестиции и капитал',value:mln(sum(sliceWindow(ch.cost))),text:`Пик потребности ${mln(Math.abs(Math.min(...cumulativeProfit)))}; первая половина горизонта ${comparison.previous?mln(comparison.previous):'—'}.`},
  {title:'Драйверы математики',value:`${pct(modelInputs.issuedToApprovalRate*100)} → ${modelInputs.ltvFactor.toFixed(2)}x`,text:`NPV ${pct(modelInputs.annualDiscountRate*100)} годовых; цель repeat ${pct(modelInputs.targetRepeatShare*100)}.`}
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
 document.getElementById('focusBanner').textContent=`${activeRoleProfile().label}: ${activeRoleProfile().summary}. Источник: ${DATA_SOURCE.modeLabel.toLowerCase()}, обновление ${DATA_SOURCE.updatedAt}.`;
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
 const fCumRev=cumulative(fRev), fCumCost=cumulative(fCost), fCumProfit=cumulative(fProfit), fNpvProfit=cumulativeDiscounted(fProfit);
 const isAllChannels=state.channel==='Все каналы'&&selectedChannelKeys().length===4;
 const isRepeatOnly=selectedChannelKeys().length===1&&selectedChannelKeys()[0]==='Повторный';
 let retFirst,retRepeat;
 if(isAllChannels){retFirst=revenueFirstTime;retRepeat=revenueRepeat}
 else if(isRepeatOnly){retFirst=fRev.map(()=>0);retRepeat=fRev.slice()}
 else{retFirst=fRev.slice();retRepeat=fRev.map(()=>0)}
 const cfg={
  chartOverview:{type:'bar',data:{labels,datasets:[{label:'Выручка ('+ch.label+')',data:sliceWindow(fRev).map(v=>v/1000),backgroundColor:c.green+'cc'},{label:'Расходы',data:sliceWindow(fCost).map(v=>v/1000),backgroundColor:c.red+'99'},{label:'Прибыль',type:'line',data:sliceWindow(fProfit).map(v=>v/1000),borderColor:c.blue,borderWidth:2.5,pointRadius:3}]}},
  chartInvestment:{type:'line',data:{labels,datasets:[{label:'Накопленная выручка',data:sliceWindow(fCumRev).map(v=>v/1000000),borderColor:c.green,borderWidth:2.5},{label:'Накопленные инвестиции',data:sliceWindow(fCumCost).map(v=>v/1000000),borderColor:c.red,borderWidth:2.5},{label:'Накопленная прибыль',data:sliceWindow(fCumProfit).map(v=>v/1000000),borderColor:c.blue,backgroundColor:c.blue+'22',fill:true,borderWidth:2.5},{label:'Дисконтированная накопленная прибыль (NPV)',data:sliceWindow(fNpvProfit).map(v=>v/1000000),borderColor:c.violet,borderWidth:2}]}},
  chartTraffic:isAllChannels?{type:'bar',stacked:true,data:{labels,datasets:[{label:'SEO',data:sliceWindow(trafficSEO),backgroundColor:c.green+'cc'},{label:'Директ',data:sliceWindow(trafficPPC),backgroundColor:c.blue+'cc'},{label:'PR',data:sliceWindow(trafficPR),backgroundColor:c.violet+'cc'},{label:'Повторы',data:sliceWindow(repeat),backgroundColor:c.orange+'cc'}]}}:{type:'bar',data:{labels,datasets:[{label:'Трафик: '+ch.label,data:sliceWindow(ch.traffic),backgroundColor:c.blue+'cc'}]}},
  chartEpc:{type:'line',data:{labels,datasets:[{label:'EPC ('+ch.label+'), ₽',data:sliceWindow(ch.epc),borderColor:c.blue,backgroundColor:c.blue+'22',fill:true,borderWidth:2.5,pointRadius:3}]}},
  chartRetention:{type:'bar',stacked:true,data:{labels,datasets:[{label:'Выручка с первой сделки, тыс. ₽',data:sliceWindow(retFirst).map(v=>v/1000),backgroundColor:c.green+'cc'},{label:'Выручка с повторов / CRM, тыс. ₽',data:sliceWindow(retRepeat).map(v=>v/1000),backgroundColor:c.orange+'cc'},{label:'Повторные визиты',type:'line',data:sliceWindow(repeat),borderColor:c.violet,borderWidth:2}]}},
  chartUnit:{type:'bar',data:{labels,datasets:[{label:'Маржинальная прибыль ('+ch.label+'), тыс. ₽',data:sliceWindow(fProfit).map(v=>v/1000),backgroundColor:sliceWindow(fProfit).map(v=>v>=0?c.green+'bb':c.red+'99')}]}},
  chartCacChannels:(function(){const cc=channelCac();const order=['SEO','Яндекс.Директ','PR','Повторный','Все каналы'];return {type:'bar',data:{labels:order,datasets:[{label:'CAC, ₽',data:order.map(k=>Math.round(cc[k].cac)),backgroundColor:order.map(k=>k==='Все каналы'?c.muted+'aa':k==='SEO'?c.green+'cc':k==='Яндекс.Директ'?c.blue+'cc':k==='PR'?c.violet+'cc':c.orange+'cc')}]}}})(),
  chartCostMix:{type:'bar',stacked:true,data:{labels,datasets:COST_ITEMS.map(item=>({label:item.label,data:sliceWindow(item.data).map(v=>v/1000),backgroundColor:c[item.color]+'cc'}))}},
  chartProducts:{type:'line',data:{labels,datasets:[{label:'Микрозаймы',data:sliceWindow(productSeries.mfo).map(v=>v/1000000),borderColor:c.blue,borderWidth:2.5},{label:'Кредиты',data:sliceWindow(productSeries.loan).map(v=>v/1000000),borderColor:c.green,borderWidth:2.5},{label:'Карты',data:sliceWindow(productSeries.card).map(v=>v/1000000),borderColor:c.violet,borderWidth:2.5},{label:'Страхование',data:sliceWindow(productSeries.insurance).map(v=>v/1000000),borderColor:c.orange,borderWidth:2},{label:'Повторы / кросс',data:sliceWindow(productSeries.repeat).map(v=>v/1000000),borderColor:c.red,borderWidth:2}]}}
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
 document.getElementById('assumptionSummary').innerHTML=[['Выдачи по модели',fmt(issued)],['LTV по модели',Math.round(ltv).toLocaleString('ru-RU')+' ₽'],['CAC по модели',Math.round(cac).toLocaleString('ru-RU')+' ₽'],['Цель по повторам',pct(modelInputs.targetRepeatShare*100)],['Ставка NPV',pct(modelInputs.annualDiscountRate*100)+' годовых']].map(r=>`<div class="mini-row"><span>${r[0]}</span><b>${r[1]}</b></div>`).join('');
 document.getElementById('recentActions').innerHTML=recentActions.length?recentActions.map(item=>`<div class="mini-row"><span>${escapeHtml(item.text)}</span><b>${escapeHtml(item.time)}</b></div>`).join(''):'<div class="mini-row"><span>Изменений ещё не сохраняли</span><b>локально</b></div>';
 const committeeCards=[
  {id:'revenue',tone:'good',tag:'срез',label:'Фокус роли',value:activeRoleProfile().label,sub:activeRoleProfile().summary},
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
 document.getElementById('execGrid').innerHTML=[
  {id:'revenue',tone:'good',tag:'итог',label:'Чистая прибыль за весь план',value:mln(sum(sliceWindow(ch.rev))-sum(sliceWindow(ch.cost))),sub:'рост 2-й половины к 1-й '+(formatDelta(revCompare.delta)?.text||'—')},
  {id:'revenue',tone:'good',tag:'безубыточность',label:'Первый прибыльный месяц',value:months[firstMonthlyProfitIndex]||'—',sub:'месячная маржа уже положительная'},
  {id:'revenue',tone:'good',tag:'окупаемость',label:'Возврат инвестиций',value:months[paybackIndex]||'—',sub:'когда покроется накопленный минус'},
  {id:'cac',tone:'warn',tag:'cash burn',label:'Максимальный накопленный минус',value:mln(maxDrawdown),sub:'расходы 2-й половины к 1-й '+(formatDelta(costCompare.delta)?.text||'—')},
  {id:'revenue',tone:'good',tag:'лидер',label:'Лучший канал по ROI',value:topChannel.n,sub:'ROAS '+topChannel.roas.toFixed(1)+'x · ROI '+pct(topChannel.roi*100)},
  {id:'cac',tone:'warn',tag:'слабое звено',label:'Канал с худшим ROI',value:weakChannel.n,sub:'ROAS '+weakChannel.roas.toFixed(1)+'x · ROI '+pct(weakChannel.roi*100)},
  {id:'ltv-cac',tone:'good',tag:'юнит',label:'LTV / CAC',value:(ltv/Math.max(cac,1)).toFixed(1)+'x',sub:'LTV '+Math.round(ltv)+' ₽ · CAC '+Math.round(cac)+' ₽'},
  {id:'revenue',tone:'good',tag:'рост',label:'Темп роста выручки',value:'×'+yoy.toFixed(1),sub:'декабрь 2027 к маю 2026'}
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
 document.getElementById('paybackList').innerHTML=[['Первая месячная прибыль',months[firstMonthlyProfitIndex]||'—'],['Окупаемость накопленных инвестиций',months[paybackIndex]||'—'],['Максимальный накопленный минус',mln(Math.min(...cumulativeProfit))],['Финальный накопленный PnL',mln(totals.profit)]].map((r,i)=>`<div class="mini-row"><span><span class="status ${i===3?'green':i===2?'red':'yellow'}"></span> ${r[0]}</span><b>${r[1]}</b></div>`).join('');
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
 const funnel=[['Сессии',fmt(sum(sliceWindow(ch.traffic)))],['Сценарий выбран',fmt(totals.visits*.78)],['Диагностика завершена',fmt(totals.visits*.61)],['Рекомендации сформированы',fmt(totals.visits*.54)],['Клик по офферу',fmt(totals.clicks)],['Заявки',fmt(totals.applications)],['Одобрения',fmt(totals.approvals)],['Выданные сделки',fmt(issued)]];
 document.getElementById('mainFunnel').innerHTML=funnel.slice(0,5).map((x,i)=>`<div class="step"><b>${x[1]}</b><span>${x[0]}</span><div class="progress" style="margin-top:12px"><div class="bar" style="width:${100-i*13}%"></div></div></div>`).join('');
 document.getElementById('flowComparison').innerHTML=(filteredFlows.length?filteredFlows:flows).map(f=>`<div class="card scenario-card"><div class="scenario-head"><h3>${escapeHtml(f.name)}</h3><span class="pill">${escapeHtml(f.offers)} оффера</span></div><div class="mini-row"><span>Одобрение</span><b>${pct(f.approval)}</b></div><div class="mini-row"><span>Выдачи</span><b>${pct(f.issued)}</b></div><div class="mini-row"><span>Выручка / пользователь</span><b>${escapeHtml(f.revenue)} ₽</b></div><div class="mini-row"><span>Время решения</span><b>${escapeHtml(f.time)}</b></div><p class="muted">${escapeHtml(f.note)}</p></div>`).join('');
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
 kpi('retentionKpis',filterByRole([{id:'repeat-share',roles:['CRM','Руководитель'],label:'Доля повторов',value:'5.1%',sub:'цель 6%'},{id:'repeat-share',roles:['CRM'],label:'Дней до повтора',value:'21',sub:'медиана дней'},{id:'repeat-share',roles:['CRM','Руководитель'],label:'Реактивация SMS',value:'12.8%',sub:'лучший канал',cls:'positive'},{id:'repeat-share',roles:['CRM','Руководитель'],label:'Выручка после сделки',value:mln(9860000),sub:'повторы + кросс-продажи',cls:'positive'}]));
 table('retentionTable',['Событие','Пользователи / события','Конверсия'],retentionEvents);
 const unitLtv=ratio(totals.revenue,totals.approvals)*modelInputs.ltvFactor;
 kpi('unitKpis',filterByRole([{id:'revenue',roles:['Рост','Руководитель'],label:'EPC',value:Math.round(ratio(totals.revenue,totals.clicks))+' ₽',sub:'выручка / клики'},{id:'cac',roles:['Рост','Руководитель'],label:'CAC выдачи',value:Math.round(cac)+' ₽',sub:'расходы / первые выдачи'},{id:'ltv-cac',roles:['CRM','Руководитель'],label:'LTV',value:Math.round(unitLtv)+' ₽',sub:'чистая выручка с повторами'},{id:'ltv-cac',roles:['Руководитель'],label:'LTV / CAC',value:(unitLtv/Math.max(cac,1)).toFixed(1)+'x',sub:'здорово при > 3x',cls:'positive'}]));
 document.getElementById('formulaList').innerHTML=filterByRole(formulaCatalog).map(x=>`<div class="mini-row" ${drillAttrs('formula',x.label)}><span>${escapeHtml(x.label)}</span><b>${escapeHtml(x.status)}</b></div>`).join('');
 const filteredAlerts=filterContext(alertCatalog);
 document.getElementById('alertsGrid').innerHTML=(filteredAlerts.length?filteredAlerts:alertCatalog).map(a=>`<div class="card alert-card" ${drillAttrs('alert',a.id)}><div class="alert-head"><h3>${escapeHtml(a.entity)}</h3><span class="delta ${a.severity==='red'?'bad':a.severity==='yellow'?'warn':'good'}">${a.severity==='red'?'критично':a.severity==='yellow'?'внимание':'норма'}</span></div><div class="mini-row"><span>Первое обнаружение</span><b>${DATA_SOURCE.updatedAt}</b></div><p class="muted">${escapeHtml(a.reason)}</p><div class="actions"><button class="action" type="button" ${drillAttrs('alert',a.id)}>Разобрать сигнал</button></div></div>`).join('');
 const filteredExperiments=filterContext(experimentCatalog);
 document.getElementById('experimentsGrid').innerHTML=(filteredExperiments.length?filteredExperiments:experimentCatalog).slice(0,3).map(e=>`<div class="card" ${drillAttrs('experiment',e.id)}><div class="card-title"><div><h3>${escapeHtml(e.name)}</h3><p>${escapeHtml(e.id)}</p></div><span class="pill">${escapeHtml(e.status)}</span></div><div class="mini-row"><span>Главная метрика</span><b>${escapeHtml(e.primary)}</b></div><div class="mini-row"><span>Уверенность</span><b>${escapeHtml(e.confidence)}</b></div><div class="mini-row"><span>Результат</span><b>${escapeHtml(e.result)}</b></div></div>`).join('');
 table('experimentsTable',['Эксперимент','Главная метрика','Ограничение','Сегмент','Уверенность','Снимок','Решение'],(filteredExperiments.length?filteredExperiments:experimentCatalog).map(e=>[e.name,e.primary,e.guardrail,e.segment,e.confidence,e.result,e.status]));
 table('unitTable',['Канал','Микс интеграций','Выручка','Расходы','Валовая прибыль','EPC','CAC одобрения','LTV/CAC','Окупаемость','Маркетинговый PnL'],channelRows(filterByRole(UNIT_ROWS)).map(r=>r.build(totals)));
 renderDataStatusList();
 renderPriorityList();
}
function renderAll(){syncControlsFromState();renderModelDirtyState();renderPresetActions();renderContextualViews();renderCharts()}
function fillModelInputs(values){document.getElementById('inputIssuedRate').value=(values.issuedToApprovalRate*100).toFixed(1);document.getElementById('inputLtvFactor').value=values.ltvFactor.toFixed(2);document.getElementById('inputAnnualDiscount').value=(values.annualDiscountRate*100).toFixed(1);document.getElementById('inputRepeatTarget').value=(values.targetRepeatShare*100).toFixed(1);renderModelDirtyState()}
function init(){
 const persisted=safeRead(STORAGE_KEYS.prefs,{});
 modelInputs=normalizeModelInputs(safeRead(STORAGE_KEYS.model,DEFAULT_MODEL_INPUTS));
 recentActions=Array.isArray(safeRead(STORAGE_KEYS.actions,[]))?safeRead(STORAGE_KEYS.actions,[]):[];
 state.role=persisted.role||state.role;
 state.channel=persisted.channel||state.channel;
 state.scenario=persisted.scenario||state.scenario;
 state.activeTab=persisted.activeTab||state.activeTab;
 document.documentElement.dataset.theme=persisted.theme||document.documentElement.dataset.theme||'light';
 fillModelInputs(modelInputs);
 renderAll();
}
const tabs=document.querySelectorAll('.tab'),panels=document.querySelectorAll('.panel');
tabs.forEach(t=>t.addEventListener('click',()=>{tabs.forEach(x=>x.classList.remove('active'));panels.forEach(x=>x.classList.remove('active'));t.classList.add('active');document.getElementById('tab-'+t.dataset.tab).classList.add('active');state.activeTab=t.dataset.tab;persistPreferences();requestAnimationFrame(renderCharts)}));
document.querySelectorAll('.filters select').forEach(sel=>{const label=sel.getAttribute('aria-label');sel.addEventListener('change',()=>{const v=sel.value;if(label==='Канал')state.channel=v;else if(label==='Сценарий')state.scenario=v;else if(label==='Роль'){state.role=v;if(state.activeTab==='overview'&&ROLE_PROFILES[v]?.recommendedTab)state.activeTab=ROLE_PROFILES[v].recommendedTab};persistPreferences();renderAll()})});
document.getElementById('themeToggle').addEventListener('click',()=>{const root=document.documentElement;root.dataset.theme=root.dataset.theme==='dark'?'light':'dark';persistPreferences();requestAnimationFrame(renderCharts)});
document.querySelectorAll('#inputIssuedRate,#inputLtvFactor,#inputAnnualDiscount,#inputRepeatTarget').forEach(input=>input.addEventListener('input',renderModelDirtyState));
document.getElementById('saveModelInputs').addEventListener('click',()=>{modelInputs=currentDraftInputs();recordAction(`Обновлены вводные модели: выдача ${pct(modelInputs.issuedToApprovalRate*100)}, LTV ${modelInputs.ltvFactor.toFixed(2)}x, NPV ${pct(modelInputs.annualDiscountRate*100)}`);persistModelInputs();renderAll()});
document.getElementById('resetModelInputs').addEventListener('click',()=>{fillModelInputs(DEFAULT_MODEL_INPUTS);recordAction('Поля модели сброшены к базовому пресету');renderModelDirtyState()});
document.addEventListener('click',e=>{const preset=e.target.closest('[data-preset-id]');if(preset){const cfg=MODEL_PRESETS.find(x=>x.id===preset.dataset.presetId);if(cfg){fillModelInputs(cfg.values);state.role=cfg.role;state.channel=cfg.channel;state.scenario=cfg.scenario;state.activeTab=ROLE_PROFILES[cfg.role]?.recommendedTab||state.activeTab;persistPreferences();recordAction(`Выбран пресет ${cfg.label}: ${cfg.note}`);renderAll();}return;}const drill=e.target.closest('[data-drill-kind]');if(drill){openDrawer(drill.dataset.drillKind,drill.dataset.drillId);return;}});
document.addEventListener('keydown',e=>{const drill=e.target.closest?.('[data-drill-kind]');const nativeTag=['BUTTON','A','INPUT','SELECT','TEXTAREA'].includes(e.target?.tagName);if(drill&&(e.key==='Enter'||(e.key===' '&&!nativeTag))){e.preventDefault();openDrawer(drill.dataset.drillKind,drill.dataset.drillId);}if(e.key==='Escape')closeDrawer()});
document.getElementById('drawerClose').addEventListener('click',closeDrawer);
let resizeTimer;window.addEventListener('resize',()=>{clearTimeout(resizeTimer);resizeTimer=setTimeout(renderCharts,120)});
init();
