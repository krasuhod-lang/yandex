(function(){
  'use strict';

  var STORAGE_KEY='cjm_unit_dashboard_v1';
  var PAYBACK_KEY='cjm_payback_inputs_v1';
  var MODE_KEY='cjm_unit_mode_v1';
  var COLORS=['var(--blue)','var(--orange)','var(--violet)','var(--green)'];
  var charts={};

  var segments=[
    {
      id:'sleeping',
      name:'Спящие / БФЛ',
      label:'Спящие / БФЛ (самый выгодный)',
      source:'SEO-трафик: «займ без отказа», «кредит с плохой КИ»',
      router:'API статус REJECTED или OVERDUE; SSR переводит в безопасную CPA-ветку',
      showcase:'CPA-офферы PDL, БФЛ, HR и антидолговые продукты',
      monetization:'CPA-выплата ≈ 3 500 ₽ за целевое действие / лид БФЛ',
      pains:'Отказы в банках, просрочки, нужна гарантированная выдача или решение долга без повторных анкет.',
      status:'REJECTED / OVERDUE',
      cac:583,
      cpa:3500,
      ltv:3500,
      ltvCac:6.0,
      payback:3,
      share:0.28,
      mix:{seo:0.72,paid:0.18,crm:0.04,pr:0.06},
      funnel:{visit:10000,lead:720,approval:202,issue:158},
      color:'#1d9d52'
    },
    {
      id:'rejected',
      name:'Отказники ЦФ',
      label:'Отказники ЦФ',
      source:'Платный трафик: Яндекс.Директ и ретаргет на срочный заём',
      router:'API статус REJECTED; роутер спасает уже потраченный CAC',
      showcase:'Широкая витрина микрозаймов с сортировкой по EPC и вероятности выдачи',
      monetization:'CPA-выплата ≈ 2 400 ₽ от МФО-партнёров',
      pains:'Клиент только что получил отказ в ЦФ, деньги нужны срочно, повторную анкету заполнять не хочет.',
      status:'REJECTED',
      cac:889,
      cpa:2400,
      ltv:2400,
      ltvCac:2.7,
      payback:5,
      share:0.32,
      mix:{seo:0.18,paid:0.72,crm:0.05,pr:0.05},
      funnel:{visit:10000,lead:520,approval:94,issue:68},
      color:'#0071e3'
    },
    {
      id:'active',
      name:'Действующие ЦФ',
      label:'Действующие ЦФ',
      source:'Ремаркетинг, CRM и Push-уведомления Центрофинанса',
      router:'API статус ACTIVE; внешние кредитные офферы блокируются',
      showcase:'Офферы ЦФ: увеличение лимита, реструктуризация; сторонние PDL скрыты',
      monetization:'Внутренняя синергия: защита базы и экономия CAC ЦФ, не external revenue',
      pains:'Нужна сумма больше текущего лимита и понятный путь в одном окне без каннибализации.',
      status:'ACTIVE',
      cac:250,
      cpa:0,
      ltv:550,
      ltvCac:2.2,
      payback:4,
      share:0.20,
      mix:{seo:0.08,paid:0.06,crm:0.82,pr:0.04},
      funnel:{visit:10000,lead:1200,approval:420,issue:336},
      color:'#6e5dc6'
    },
    {
      id:'new',
      name:'Новые (непрофильные)',
      label:'Новые (непрофильные)',
      source:'Органический, PR и брендовый трафик с поиском лучших условий',
      router:'API статус NOT_FOUND; сначала сбор лида и маршрут в ЦФ, при отказе — возврат на CPA',
      showcase:'Лид-форма, оффер ЦФ, затем резервная витрина банков/CPA при отказе',
      monetization:'CPA ≈ 1 500 ₽ плюс инвестиция в пополнение базы ЦФ',
      pains:'Сравнивают варианты, ищут низкий процент и понятные условия, ещё не знают бренд.',
      status:'NOT_FOUND',
      cac:938,
      cpa:1500,
      ltv:1500,
      ltvCac:1.6,
      payback:6,
      share:0.20,
      mix:{seo:0.46,paid:0.16,crm:0.03,pr:0.35},
      funnel:{visit:10000,lead:400,approval:80,issue:48},
      color:'#c2680a'
    }
  ];

  var ssrRows=[
    ['CF_TARGET','Идеальный профиль ЦФ','Оффер Центрофинанс, лимит, персональная ставка','Все конкурирующие МФО/банки'],
    ['CF_ACTIVE','Действующий займ','ЦФ-сервис, увеличение лимита, безопасные не-кредитные продукты','PDL, Installment, cash loans'],
    ['CF_REPEAT','Повторный клиент','ЦФ repeat, CRM-предложение, cross-sell','Холодные CPA-офферы'],
    ['CF_DORMANT','Спящий клиент','Win-back ЦФ, PDL fallback, БФЛ при признаках долга','Нерелевантные крупные кредиты'],
    ['CF_OVERDUE','Просрочка','БФЛ, HR, антидолговые консультации','МФО, банки, кредитные карты'],
    ['CF_REJECTED','Отказ ЦФ','PDL CPA-витрина, микрозаймы, альтернативные МФО','Оффер ЦФ'],
    ['CF_NON_CORE','Непрофильный запрос','Банки, авто, ипотека, залоговые продукты','PDL при крупной сумме'],
    ['NOT_FOUND','Новый пользователь','Сбор лида, ЦФ first, CPA fallback','Ничего до согласия и скоринга']
  ];

  function $(id){return document.getElementById(id);}
  function esc(value){return String(value==null?'':value).replace(/[&<>"']/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c];});}
  function read(key,fb){try{var raw=localStorage.getItem(key);return raw?JSON.parse(raw):fb;}catch(e){return fb;}}
  function write(key,value){try{localStorage.setItem(key,JSON.stringify(value));}catch(e){}}
  function fmt(v){return Math.round(Number(v)||0).toLocaleString('ru-RU');}
  function rub(v){return fmt(v)+' ₽';}
  function pct(v,digits){return (Number(v)||0).toLocaleString('ru-RU',{maximumFractionDigits:digits==null?1:digits})+'%';}
  function rate(num,den){return den>0?num/den*100:0;}
  function ratioTone(v){return v>=3?'green':v>=1.5?'yellow':'red';}
  function segmentById(id){return segments.find(function(s){return s.id===id;})||null;}
  function selectedId(){return read(STORAGE_KEY,{segment:'all'}).segment||'all';}
  function setSelected(id){write(STORAGE_KEY,{segment:id});}
  function selectedSegments(){var id=selectedId();return id==='all'?segments:[segmentById(id)||segments[0]];}
  function weighted(field){var list=selectedSegments();var total=list.reduce(function(a,s){return a+s.share;},0)||1;return list.reduce(function(a,s){return a+s[field]*s.share/total;},0);}
  function weightedNested(group,key){var list=selectedSegments();var total=list.reduce(function(a,s){return a+s.share;},0)||1;return list.reduce(function(a,s){return a+s[group][key]*s.share/total;},0);}
  function aggregateFunnel(mode){
    var list=selectedSegments();
    var total=list.reduce(function(a,s){return a+s.share;},0)||1;
    var result={visit:10000,lead:0,approval:0,issue:0};
    ['lead','approval','issue'].forEach(function(key){
      result[key]=list.reduce(function(a,s){
        var value=s.funnel[key];
        if(mode==='toBe'&&key!=='visit')value=Math.round(value*1.05);
        return a+value*s.share/total;
      },0);
    });
    result.lead=Math.round(result.lead);
    result.approval=Math.round(result.approval);
    result.issue=Math.round(result.issue);
    return result;
  }
  function currentSegmentLabel(){var id=selectedId();return id==='all'?'Все сегменты':(segmentById(id)||segments[0]).name;}
  function clearChart(id){if(charts[id]){charts[id].destroy();delete charts[id];}}
  function drawChart(id,config){var canvas=$(id);if(!canvas||typeof Chart==='undefined')return;clearChart(id);charts[id]=new Chart(canvas,config);}

  function initSelector(){
    var select=$('cjmSegmentSelect');
    if(!select)return;
    select.innerHTML='<option value="all">Все сегменты</option>'+segments.map(function(s){return '<option value="'+esc(s.id)+'">'+esc(s.name)+'</option>';}).join('');
    select.value=selectedId();
    select.addEventListener('change',function(){setSelected(select.value);renderAll();});
  }

  function initTabs(){
    document.querySelectorAll('.cjm-tab').forEach(function(btn){
      btn.addEventListener('click',function(){
        var tab=btn.getAttribute('data-cjm-tab');
        document.querySelectorAll('.cjm-tab').forEach(function(x){x.classList.toggle('active',x===btn);});
        document.querySelectorAll('.cjm-panel').forEach(function(panel){panel.classList.toggle('active',panel.id==='cjm-tab-'+tab);});
        requestAnimationFrame(renderCharts);
      });
    });
  }

  function renderOverview(){
    var funnel=aggregateFunnel('asIs');
    var steps=[
      ['Visit',funnel.visit,'100% базы симуляции'],
      ['Lead',funnel.lead,pct(funnel.lead/funnel.visit*100)+' Visit → Lead'],
      ['Approval',funnel.approval,pct(funnel.approval/funnel.lead*100)+' Lead → Approval'],
      ['Issue',funnel.issue,pct(funnel.issue/funnel.approval*100)+' Approval → Issue']
    ];
    $('cjmOverviewFunnel').innerHTML=steps.map(function(s){return '<div class="cjm-funnel-step"><span>'+esc(s[0])+'</span><b>'+fmt(s[1])+'</b><p class="metric-sub">'+esc(s[2])+'</p></div>';}).join('');

    var mix={seo:weightedNested('mix','seo'),paid:weightedNested('mix','paid'),crm:weightedNested('mix','crm'),pr:weightedNested('mix','pr')};
    var seo=mix.seo*100, paid=seo+mix.paid*100, crm=paid+mix.crm*100;
    $('cjmChannelMix').innerHTML='<div class="cjm-pie-visual" style="--seo:'+seo+'%;--paid:'+paid+'%;--crm:'+crm+'%"></div><div class="cjm-legend">'+
      [['SEO',mix.seo,'var(--blue)'],['Платный трафик',mix.paid,'var(--orange)'],['CRM / Push',mix.crm,'var(--violet)'],['PR / Organic',mix.pr,'var(--green)']]
      .map(function(r){return '<div class="cjm-legend-row"><span><i class="cjm-dot" style="background:'+r[2]+'"></i>'+esc(r[0])+'</span><b>'+pct(r[1]*100,0)+'</b></div>';}).join('')+'</div>';

    renderSummaryTable();
  }

  function renderSummaryTable(){
    var table=$('cjmSummaryTable');
    var rows=segments.slice();
    var metrics=['cac','cpa','ltv','ltvCac','payback'];
    var best={},worst={};
    metrics.forEach(function(m){
      var vals=rows.map(function(s){return s[m];});
      best[m]=m==='cac'||m==='payback'?Math.min.apply(Math,vals):Math.max.apply(Math,vals);
      worst[m]=m==='cac'||m==='payback'?Math.max.apply(Math,vals):Math.min.apply(Math,vals);
    });
    function cls(s,m){return s[m]===best[m]?'tone-green':s[m]===worst[m]?'tone-red':'';}
    table.innerHTML='<thead><tr><th>Сегмент</th><th>CAC</th><th>CPA</th><th>LTV</th><th>LTV/CAC</th><th>Payback</th></tr></thead><tbody>'+
      rows.map(function(s){
        return '<tr><td class="ue2-t-name"><span class="ue2-seg-dot" style="background:'+esc(s.color)+'"></span>'+esc(s.name)+'</td>'+
          '<td class="'+cls(s,'cac')+'">'+rub(s.cac)+'</td>'+
          '<td class="'+cls(s,'cpa')+'">'+(s.cpa?rub(s.cpa):'внутр.')+'</td>'+
          '<td class="'+cls(s,'ltv')+'">'+rub(s.ltv)+'</td>'+
          '<td class="'+cls(s,'ltvCac')+'">'+s.ltvCac.toFixed(1)+'×</td>'+
          '<td class="'+cls(s,'payback')+'">'+s.payback+' мес.</td></tr>';
      }).join('')+'</tbody>';
  }

  function renderJourney(){
    var list=selectedSegments();
    $('cjmJourneyHost').innerHTML=list.map(function(s){
      return '<article class="card" style="border-top:4px solid '+esc(s.color)+'">'+
        '<div class="card-title"><div><span class="eyebrow">'+esc(s.status)+'</span><h2>'+esc(s.label)+'</h2><p>'+esc(s.pains)+'</p></div></div>'+
        '<div class="cjm-stage-grid">'+
          '<div class="cjm-stage"><h3>1. Вход (Источник)</h3><p>'+esc(s.source)+'</p></div>'+
          '<div class="cjm-stage"><h3>2. Smart Safe Router</h3><p>'+esc(s.router)+'</p></div>'+
          '<div class="cjm-stage"><h3>3. Витрина (Офферы)</h3><p>'+esc(s.showcase)+'</p></div>'+
          '<div class="cjm-stage"><h3>4. Монетизация</h3><p><b>'+esc(s.monetization)+'</b></p></div>'+
        '</div>'+
        '<div class="card cjm-jtbd tight"><div class="card-title"><div><h3>Боли и барьеры (JTBD)</h3><p>'+esc(s.pains)+'</p></div></div></div>'+
      '</article>';
    }).join('');
  }

  function renderUnit(){
    var mode=read(MODE_KEY,'asIs');
    var funnel=aggregateFunnel(mode);
    var ltvCac=weighted('ltvCac');
    var tone=ratioTone(ltvCac);
    var kpis=[
      ['CAC',rub(weighted('cac')),'Стоимость привлечения на выдачу','blue'],
      ['CPA',selectedId()==='active'?'внутр.':rub(weighted('cpa')),'Средняя выплата/ценность действия','blue'],
      ['LTV',rub(weighted('ltv')),'Ожидаемая ценность клиента','green'],
      ['LTV/CAC',ltvCac.toFixed(1)+'×','Светофор: ≥3 green, 1.5–2.9 yellow, <1.5 red',tone]
    ];
    $('cjmUnitKpis').innerHTML=kpis.map(function(k){
      return '<div class="ue2-kpi tone-'+k[3]+'"><span class="ue2-kpi-label">'+esc(k[0])+'</span><span class="ue2-kpi-value">'+esc(k[1])+'</span><span class="ue2-kpi-sub">'+esc(k[2])+'</span></div>';
    }).join('');
    var rows=[
      ['Visit',funnel.visit,'—','100%'],
      ['Lead',funnel.lead,pct(rate(funnel.lead,funnel.visit)),pct(rate(funnel.lead,funnel.visit))],
      ['Approval',funnel.approval,pct(rate(funnel.approval,funnel.lead)),pct(rate(funnel.approval,funnel.visit))],
      ['Issue',funnel.issue,pct(rate(funnel.issue,funnel.approval)),pct(rate(funnel.issue,funnel.visit))]
    ];
    $('cjmUnitFunnel').innerHTML='<thead><tr><th>Шаг</th><th>Абс.</th><th>CR шага</th><th>CR от Visit</th></tr></thead><tbody>'+
      rows.map(function(r){return '<tr><td class="ue2-t-name">'+esc(r[0])+'</td><td>'+fmt(r[1])+'</td><td>'+esc(r[2])+'</td><td>'+esc(r[3])+'</td></tr>';}).join('')+'</tbody>';
    document.querySelectorAll('[data-cjm-mode]').forEach(function(btn){btn.classList.toggle('active',btn.getAttribute('data-cjm-mode')===mode);});
  }

  function renderSsr(){
    $('cjmSsrTable').innerHTML='<thead><tr><th>Статус API</th><th>Смысл</th><th>Разрешено</th><th>Блокируется</th></tr></thead><tbody>'+
      ssrRows.map(function(r){return '<tr><td class="ue2-t-name"><b>'+esc(r[0])+'</b></td><td>'+esc(r[1])+'</td><td class="tone-green">'+esc(r[2])+'</td><td class="tone-red">'+esc(r[3])+'</td></tr>';}).join('')+'</tbody>';
    var flow=[
      ['Входящий трафик','SEO · Директ · PR · Push'],
      ['Lead Capture','Телефон, сумма, согласие 152-ФЗ'],
      ['S2S API ЦФ','POST /api/v1/cf/check-hash'],
      ['Smart Safe Router','8 статусов → правила Offers Engine'],
      ['Витрина / действие','ЦФ, CPA, БФЛ, банк или отказ']
    ];
    $('cjmRouteFlow').innerHTML=flow.map(function(n){return '<div class="cjm-route-node"><h3>'+esc(n[0])+'</h3><p>'+esc(n[1])+'</p></div>';}).join('');
  }

  function initUnitMode(){
    document.querySelectorAll('[data-cjm-mode]').forEach(function(btn){
      btn.addEventListener('click',function(){write(MODE_KEY,btn.getAttribute('data-cjm-mode'));renderAll();});
    });
  }

  function initPaybackInputs(){
    var defaults=read(PAYBACK_KEY,{sleeping:9000,rejected:12000,new:7000});
    var fields=[
      ['sleeping','Спящие / БФЛ'],
      ['rejected','Отказники ЦФ'],
      ['new','Новые']
    ];
    $('cjmPaybackInputs').innerHTML=fields.map(function(f){
      return '<label>'+esc(f[1])+'<input id="cjmPb_'+esc(f[0])+'" type="number" min="0" step="100" value="'+esc(defaults[f[0]]||0)+'" inputmode="numeric"></label>';
    }).join('');
    fields.forEach(function(f){
      var input=$('cjmPb_'+f[0]);
      input.addEventListener('input',function(){persistPayback();renderPayback();});
    });
  }

  function paybackValues(){
    return {
      sleeping:Number($('cjmPb_sleeping')&&$('cjmPb_sleeping').value)||0,
      rejected:Number($('cjmPb_rejected')&&$('cjmPb_rejected').value)||0,
      new:Number($('cjmPb_new')&&$('cjmPb_new').value)||0
    };
  }
  function persistPayback(){write(PAYBACK_KEY,paybackValues());}
  function renderPayback(){
    var v=paybackValues();
    var cr=0.02,cpa=1500;
    var total=v.sleeping+v.rejected+v.new;
    var revenue=total*cr*cpa;
    $('cjmPaybackRevenue').textContent=rub(revenue);
    $('cjmPaybackFormula').innerHTML=fmt(total)+' визитов × 2% × 1 500 ₽ = <b>'+rub(revenue)+'</b> в месяц. Действующие ЦФ исключены из расчёта внешней выручки.';
    $('cjmPaybackBreakdown').innerHTML=[
      ['Спящие / БФЛ',v.sleeping],
      ['Отказники',v.rejected],
      ['Новые',v.new]
    ].map(function(r){return '<div class="ue2-kpi-mini tone-blue"><span class="ue2-mini-name">'+esc(r[0])+'</span><span class="ue2-mini-val">'+rub(r[1]*cr*cpa)+'</span><span class="ue2-mini-sub">'+fmt(r[1])+' визитов</span></div>';}).join('');
    $('cjmRecommendations').innerHTML=[
      'Увеличивать SEO-долю для «Спящих / БФЛ»: LTV/CAC 6.0× и payback 3 мес. дают лучший ROMI.',
      'Платный трафик масштабировать через «Отказников» только при сохранении CPA ≥ CAC: роутер должен компенсировать закупку.',
      'Действующих клиентов ЦФ держать в отдельном CRM-контуре: это внутренняя синергия и защита от каннибализации, а не выручка маркетплейса.',
      'Для «Новых» ограничивать бюджет тестами и прогревом базы: LTV/CAC 1.6× близок к красной зоне.'
    ].map(function(x){return '<li>'+esc(x)+'</li>';}).join('');
  }

  function renderCharts(){
    var colors={blue:'#0071e3',green:'#1d9d52',orange:'#c2680a',red:'#e0162b',violet:'#6e5dc6'};
    var segmentNames=segments.map(function(s){return s.name;});
    var segmentRatios=segments.map(function(s){return s.ltvCac;});
    var segmentColors=segments.map(function(s){return s.color;});
    drawChart('cjmTrendChart',{
      type:'bar',
      data:{labels:segmentNames,datasets:[{label:'LTV/CAC, ×',data:segmentRatios,backgroundColor:segmentColors,tooltipFormat:function(v){return v.toFixed(1)+'×';}}]}
    });
    var asIs=aggregateFunnel('asIs'), toBe=aggregateFunnel('toBe');
    drawChart('cjmUnitChart',{
      type:'bar',
      data:{labels:['Lead','Approval','Issue'],datasets:[
        {label:'As-Is',data:[asIs.lead,asIs.approval,asIs.issue],backgroundColor:colors.blue},
        {label:'To-Be +5% CR',data:[toBe.lead,toBe.approval,toBe.issue],backgroundColor:colors.green}
      ]}
    });
  }

  function renderAll(){
    renderOverview();
    renderJourney();
    renderUnit();
    renderSsr();
    renderPayback();
    requestAnimationFrame(renderCharts);
  }

  function initTheme(){
    var btn=$('cjmThemeToggle');
    if(!btn)return;
    btn.addEventListener('click',function(){
      var root=document.documentElement;
      root.dataset.theme=root.dataset.theme==='dark'?'light':'dark';
      requestAnimationFrame(renderCharts);
    });
  }

  function init(){
    initSelector();
    initTabs();
    initUnitMode();
    initPaybackInputs();
    initTheme();
    renderAll();
  }

  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init);
  else init();
})();
