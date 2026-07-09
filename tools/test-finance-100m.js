#!/usr/bin/env node
// Unit-тесты расчётного ядра финмодели «100 млн ₽» (finance-100m.js).
// Запуск: node tools/test-finance-100m.js
// Модуль загружается в песочницу vm с минимальными заглушками DOM;
// localStorage отсутствует — модуль сам падает на in-memory хранилище.
'use strict';

var fs=require('fs');
var path=require('path');
var vm=require('vm');

function makeElement(){
  return {
    id:'',className:'',innerHTML:'',textContent:'',
    appendChild:function(){},addEventListener:function(){},
    classList:{add:function(){},remove:function(){}},
    setAttribute:function(){},getAttribute:function(){return null;}
  };
}

function loadModule(bridge){
  var documentStub={
    readyState:'complete',
    getElementById:function(){return null;},
    querySelector:function(){return null;},
    createElement:function(){return makeElement();},
    addEventListener:function(){},
    head:{appendChild:function(){}}
  };
  var windowStub={};
  if(bridge)windowStub.CjmSegmentsBridge=bridge;
  var sandbox={window:windowStub,document:documentStub,console:console};
  vm.createContext(sandbox);
  var code=fs.readFileSync(path.join(__dirname,'..','finance-100m.js'),'utf8');
  vm.runInContext(code,sandbox,{filename:'finance-100m.js'});
  return sandbox.window.Finance100;
}

// Стаб воронки сегментов: R (blendedPayout) обязан браться строго отсюда.
var FUNNEL_BRIDGE={
  getFunnel:function(){
    return {segments:[
      {share:0.6,payout:4000,crAi:0.5,crCa:0.3,crCc:0.4,crVc:0.1},
      {share:0.4,payout:6000,crAi:0.4,crCa:0.25,crCc:0.35,crVc:0.08}
    ]};
  }
};
var EXPECTED_BLENDED_PAYOUT=0.6*4000+0.4*6000; // 4800

var failures=0,checks=0;
function assert(cond,msg){
  checks++;
  if(!cond){failures++;console.error('FAIL: '+msg);}
  else console.log('ok:   '+msg);
}
function approx(a,b,relTol){
  return Math.abs(a-b)<=Math.abs(b)*(relTol==null?0.005:relTol)+1e-6;
}

// --- 1. Старт таблицы всегда равен startRevenue --------------------------
(function(){
  var fin=loadModule(null);
  fin.resetAll();
  fin.setInput('startRevenue',777000);
  var res=fin.compute();
  assert(res.rows[0].rev===777000,'t=0 всегда равен startRevenue (777 000)');
})();

// --- 2. Solver сходится в targetNetProfit на targetIdx --------------------
(function(){
  var fin=loadModule(null);
  fin.resetAll();
  var res=fin.compute();
  assert(res.targetIdx>0,'targetIdx определяется из targetMonth/targetYear');
  assert(approx(res.rows[res.targetIdx].np,res.inp.targetNetProfit),
    'np[targetIdx] сходится в targetNetProfit ('+Math.round(res.rows[res.targetIdx].np)+' ≈ '+res.inp.targetNetProfit+')');
})();

// --- 3. Смена targetNetProfit пересчитывает всю таблицу -------------------
(function(){
  var fin=loadModule(null);
  fin.resetAll();
  var a=fin.compute();
  fin.setInput('targetNetProfit',150000000);
  var b=fin.compute();
  var mid=Math.floor(b.targetIdx/2);
  assert(Math.abs(b.rows[mid].np-a.rows[mid].np)>1,'при цели 150 млн промежуточный np[t='+mid+'] пересчитан');
  assert(b.rows[mid].rev>a.rows[mid].rev,'промежуточная выручка тоже пересчитана');
  assert(approx(b.rows[b.targetIdx].np,150000000),'новая цель достигается на targetIdx');
  assert(b.rows[0].rev===a.rows[0].rev,'старт t=0 не меняется при смене цели');
})();

// --- 4. Смена targetDate перестраивает кривую (нет фиксированных месяцев) --
(function(){
  var fin=loadModule(null);
  fin.resetAll();
  var a=fin.compute(); // цель: декабрь 2029
  fin.setInput('targetMonth',12);
  fin.setInput('targetYear',2028);
  var b=fin.compute();
  assert(b.targetIdx<a.targetIdx,'targetIdx уменьшился при переносе цели на 2028');
  assert(approx(b.rows[b.targetIdx].np,b.inp.targetNetProfit),'цель достигается в декабре 2028');
  // Декабрь 2027 — обычный расчётный месяц: значение меняется вместе с датой цели.
  var dec2027a=a.rows.filter(function(r){return r.key==='2027-12';})[0];
  var dec2027b=b.rows.filter(function(r){return r.key==='2027-12';})[0];
  assert(dec2027a&&dec2027b&&Math.abs(dec2027a.np-dec2027b.np)>1,
    'декабрь 2027 не зашит: '+Math.round(dec2027a.np)+' ≠ '+Math.round(dec2027b.np));
})();

// --- 5. ФОТ = headcount(t) × avgFot(t), штат растёт с выручкой -------------
(function(){
  var fin=loadModule(null);
  fin.resetAll();
  var res=fin.compute();
  var inp=res.inp;
  assert(res.rows[0].headcount===inp.startHeadcount,'штат на старте = startHeadcount (3)');
  assert(res.rows[res.targetIdx].headcount===inp.targetHeadcount,'штат на целевой дате = targetHeadcount (26)');
  var monotonic=true;
  for(var t=1;t<=res.targetIdx;t++){
    if(res.rows[t].headcount<res.rows[t-1].headcount)monotonic=false;
  }
  assert(monotonic,'headcount растёт монотонно');
  var ok=true;
  for(var t2=0;t2<=res.targetIdx;t2++){
    var expected=res.rows[t2].headcount*inp.avgFot*Math.pow(1+inp.fotIndex/100,t2/12);
    if(!approx(res.rows[t2].fot,expected,1e-9)){ok=false;break;}
  }
  assert(ok,'fot[t] = headcount[t] × avgFot × (1+fotIndex)^(t/12) для всех t');
})();

// --- 6. Рост devShare увеличивает расходы, solver поднимает revEnd ---------
(function(){
  var fin=loadModule(null);
  fin.resetAll();
  var a=fin.compute();
  fin.setInput('devShare',8);
  var b=fin.compute();
  var mid=Math.floor(a.targetIdx/2);
  assert(b.solvedRevEnd>a.solvedRevEnd,'solver увеличил revEnd при devShare 4% → 8%');
  assert(b.rows[b.targetIdx].dev>a.rows[a.targetIdx].dev,'dev[targetIdx] вырос');
  assert(b.rows[mid].opex>a.rows[mid].opex,'opex промежуточного месяца вырос');
  assert(approx(b.rows[b.targetIdx].np,b.inp.targetNetProfit),'цель всё равно достигается на targetIdx');
  assert(b.rows[mid].dev>a.rows[mid].dev,'dev промежуточного месяца вырос при devShare 4% → 8%');
})();

// --- 7. Прочие %-доли влияют на np[t] всех месяцев -------------------------
(function(){
  var fin=loadModule(null);
  fin.resetAll();
  var a=fin.compute();
  fin.setInput('gaShare',6);
  var b=fin.compute();
  assert(b.solvedRevEnd>a.solvedRevEnd,'рост gaShare требует больше выручки для той же цели');
  assert(approx(b.rows[b.targetIdx].np,b.inp.targetNetProfit),'цель достигается при выросшем G&A');
})();

// --- 8. Воронка: R строго из segmentFunnel(); BEP и нелинейная прибыль -----
(function(){
  var fin=loadModule(FUNNEL_BRIDGE);
  fin.resetAll();
  var res=fin.compute();
  assert(res.funnel!=null,'воронка сегментов подхватилась');
  assert(approx(res.funnel.blendedPayout,EXPECTED_BLENDED_PAYOUT,1e-9),
    'R = blendedPayout из сегментов ('+res.funnel.blendedPayout+' ₽)');
  var row=res.rows[res.targetIdx];
  assert(isFinite(row.bep)&&row.bep>0,'BEP считается ('+Math.round(row.bep)+' ₽)');
  assert(isFinite(row.marketingProfit),'нелинейная прибыль маркетинга считается');
  // Калибровка k: на t=0 нелинейная прибыль равна фактической стартовой NP.
  var r0=res.rows[0];
  var startNp=r0.rev*res.marginFactor-r0.marketing-r0.fot-res.startDevEff;
  assert(approx(res.rows[0].marketingProfit,startNp,0.02),
    'k откалиброван: PR(0) ≈ стартовой прибыли');
})();

// --- 9. EBITDA, Burn Rate, Runway, касса -----------------------------------
(function(){
  var fin=loadModule(null);
  fin.resetAll();
  fin.setInput('startCashReserve',10000000);
  var res=fin.compute();
  var ok=true;
  res.rows.forEach(function(r){
    if(!approx(r.ebitda,r.rev-(r.marketing+r.fot+r.dev+r.ga+r.risk),1e-9))ok=false;
  });
  assert(ok,'ebitda[t] = rev − (marketing+fot+dev+ga+risk)');
  var cashOk=true,prev=10000000;
  res.rows.forEach(function(r){
    if(!approx(r.cash,prev+r.np,1e-9))cashOk=false;
    if(!approx(r.burn,prev-r.cash,1e-9))cashOk=false;
    prev=r.cash;
  });
  assert(cashOk,'cash[t] = cash[t−1] + np[t]; burn[t] = cash[t−1] − cash[t]');
  var neg=res.rows.filter(function(r){return r.burn>0;})[0];
  if(neg)assert(isFinite(neg.runway)&&neg.runway>=0,'runway конечен при burn > 0');
  var pos=res.rows.filter(function(r){return r.burn<=0;})[0];
  if(pos)assert(pos.runway===Infinity,'runway = ∞ при burn ≤ 0 (устойчиво)');
})();

// --- 10. Доля SEO растёт и снижает эффективный CAC -------------------------
(function(){
  var fin=loadModule(FUNNEL_BRIDGE);
  fin.resetAll();
  var res=fin.compute();
  var first=res.rows[0],last=res.rows[res.rows.length-1];
  assert(approx(first.seoShare,0.05,1e-9),'seoShare на старте = 5%');
  assert(approx(last.seoShare,0.35,1e-9),'seoShare на конце = 35%');
  var mono=true;
  for(var t=1;t<res.rows.length;t++){
    if(res.rows[t].seoShare<res.rows[t-1].seoShare)mono=false;
  }
  assert(mono,'seoShare растёт монотонно');
  // Эффективный CAC учитывает только платную долю бюджета.
  var expectCac=last.marketing*(1-last.seoShare)/last.approvals;
  assert(approx(last.effectiveCac,expectCac,1e-9),'effectiveCac = маркетинг × платная доля / выдачи');
})();

// --- 11. Справочная доля ФОТ — производный KPI, не вход --------------------
(function(){
  var fin=loadModule(null);
  fin.resetAll();
  var res=fin.compute();
  var r=res.rows[res.targetIdx];
  assert(approx(r.fotShare,r.fot/r.rev*100,1e-9),'fotShare[t] = fot/rev × 100 (справочно)');
})();

// --- 12. Больше сотрудников на старте → быстрее рост выручки ---------------
(function(){
  var fin=loadModule(null);
  fin.resetAll();
  var a=fin.compute();
  assert(approx(a.teamSpeed,1,1e-9),'при дефолтном штате скорость роста ×1 (модель не меняется)');
  fin.setInput('startHeadcount',12);
  var b=fin.compute();
  assert(b.teamSpeed>1,'штат 12 вместо 3 даёт коэффициент ускорения > 1 (×'+b.teamSpeed.toFixed(2)+')');
  var mid=Math.floor(a.targetIdx/2);
  assert(b.rows[mid].rev/b.rows[0].rev>a.rows[mid].rev/a.rows[0].rev,
    'относительный рост выручки к середине горизонта быстрее при большем стартовом штате');
  assert(approx(b.rows[b.targetIdx].np,b.inp.targetNetProfit),'цель по прибыли всё равно достигается на targetIdx');
  fin.setInput('hcGrowthElasticity',0);
  var c=fin.compute();
  assert(approx(c.teamSpeed,1,1e-9),'при коэффициенте 0 штат не влияет на скорость роста');
})();

// --- 13. Логистическая S-кривая: рост плавно замедляется у потолка --------
(function(){
  var fin=loadModule(null);
  fin.resetAll();
  var res=fin.compute();
  var rows=res.rows,ti=res.targetIdx;
  // Выручка строго монотонна на всём горизонте.
  var mono=true;
  for(var t=1;t<rows.length;t++){if(rows[t].rev<rows[t-1].rev)mono=false;}
  assert(mono,'выручка растёт монотонно на всём горизонте');
  // Месячный темп сначала растёт, затем снижается (единственный горб) —
  // рост не бесконечно-ускоряющийся, а замедляется у потолка.
  var mom=[];for(var i=1;i<rows.length;i++)mom.push(rows[i].rev/rows[i-1].rev-1);
  var peak=-Infinity,peakIdx=0;
  for(var j=0;j<mom.length;j++){if(mom[j]>peak){peak=mom[j];peakIdx=j;}}
  assert(peakIdx>3&&peakIdx<mom.length-3,'пик месячного темпа лежит внутри горизонта (t='+(peakIdx+1)+')');
  var lateIdx=Math.min(mom.length-1,ti-3);
  assert(mom[lateIdx]<peak,'месячный темп у целевой даты ниже пикового (замедление)');
  // Эндпойнт (revEnd) и целевая прибыль не зависят от формы кривой.
  assert(approx(rows[ti].np,res.inp.targetNetProfit),'цель по прибыли достигается при S-кривой');
})();

// --- 14. Усиление роста первого года: лифт есть, эндпойнт неизменен --------
(function(){
  var fin=loadModule(null);
  fin.resetAll();
  fin.setInput('firstYearGrowthBoost',0);
  var off=fin.compute();
  fin.setInput('firstYearGrowthBoost',10);
  var on=fin.compute();
  assert(on.rows[12].rev>off.rows[12].rev,'выручка 12-го месяца выше при усилении роста первого года');
  assert(approx(on.rows[12].rev/off.rows[12].rev,1.10,0.01),'лифт на пике (12 мес.) ≈ +10% при boost=10');
  assert(approx(on.rows[on.targetIdx].rev,off.rows[off.targetIdx].rev,1e-9),'конечная выручка не смещается лифтом первого года');
  assert(approx(on.rows[24].rev,off.rows[24].rev,1e-9),'к 24-му месяцу лифт затухает (эффект только в первый год)');
})();

console.log('\n'+(checks-failures)+'/'+checks+' проверок пройдено');
process.exit(failures?1:0);
