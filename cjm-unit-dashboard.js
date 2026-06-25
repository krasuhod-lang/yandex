(function(){
  'use strict';

  var STORAGE_KEY='cjm_unit_dashboard_v2';
  var TAB_KEY='cjm_inner_tab_v2';
  var PAYBACK_KEY='cjm_payback_inputs_v1';
  var MODE_KEY='cjm_unit_mode_v1';
  var MANUAL_KEY='cjm_manual_inputs_v1';
  var BASE_VISITS=10000;
  var CF_CHECK_REQUEST='POST /api/v1/cf/check-hash';
  var PAYBACK_CONVERSION_RATE=0.02;
  var PAYBACK_CPA=1500;
  var HTML_ESCAPE_MAP={'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;','/':'&#x2F;','`':'&#96;'};
  var charts={};

  // Each segment now carries:
  //  - defaultCr: {visitLead, leadApproval, approvalIssue} (%, applied to BASE_VISITS)
  //  - cac/cpa/ltv: editable economics
  //  - justify: object explaining each manually editable indicator
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
      defaultCr:{visitLead:7.2,leadApproval:28,approvalIssue:78},
      cac:583,cpa:3500,ltv:3500,payback:3,share:0.28,
      mix:{seo:0.72,paid:0.18,crm:0.04,pr:0.06},
      color:'#1d9d52',
      justify:{
        visitLead:'7,2% Visit → Lead — выше среднего по рынку (4–5%): пользователь уже испытал боль отказа в банке, мотивация заполнить анкету высокая, но недоверие после прошлых отказов часть аудитории отсеивает.',
        leadApproval:'28% Lead → Approval — БФЛ-партнёры жёстко скорят по признакам реальной просрочки и подтверждённого дохода, не каждый лид доходит до целевого статуса.',
        approvalIssue:'78% Approval → Issue — высокая закрываемость: продукт БФЛ востребован, но 22% отваливаются на сборе пакета документов и подписании договора.',
        cac:'CAC 583 ₽ — почти весь объём идёт через дешёвый SEO по длинному низкочастотному хвосту («займ без отказа», «банкротство физлиц»), платный трафик минимален.',
        cpa:'CPA 3 500 ₽ — БФЛ-выплата самая дорогая на рынке: партнёр получает 30–60 тыс. ₽ за заключённый договор и платит щедро за квалифицированный лид.',
        ltv:'LTV 3 500 ₽ — разовая монетизация на этапе лида, повторные циклы редки, поэтому LTV ≈ CPA.'
      }
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
      defaultCr:{visitLead:5.2,leadApproval:18,approvalIssue:72},
      cac:889,cpa:2400,ltv:2400,payback:5,share:0.32,
      mix:{seo:0.18,paid:0.72,crm:0.05,pr:0.05},
      color:'#0071e3',
      justify:{
        visitLead:'5,2% Visit → Lead — после отказа часть аудитории разочарована и уходит, но «горячая» потребность в деньгах удерживает CR на среднерыночном уровне.',
        leadApproval:'18% Lead → Approval — отказы у МФО мягче, чем у ЦФ, но платёжеспособность аудитории низкая, поэтому больше половины лидов снова получают отказ.',
        approvalIssue:'72% Approval → Issue — типичный PDL-отвал: клиент проходит скоринг, но не доходит до подписания (бросает SMS, не подтверждает карту).',
        cac:'CAC 889 ₽ — основной источник Яндекс.Директ + ретаргет, ставки в нише «срочный заём» высокие, а CTR ограничен из-за насыщенности рынка.',
        cpa:'CPA 2 400 ₽ — средневзвешенная выплата МФО за выданный займ; зависит от партнёра, но 2–3 тыс. ₽ — рыночная норма для качественного отказника.',
        ltv:'LTV 2 400 ₽ — повторных выкупов мало, аудитория размывается между МФО, поэтому LTV ≈ CPA.'
      }
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
      defaultCr:{visitLead:12,leadApproval:35,approvalIssue:80},
      cac:250,cpa:0,ltv:550,payback:4,share:0.20,
      mix:{seo:0.08,paid:0.06,crm:0.82,pr:0.04},
      color:'#6e5dc6',
      justify:{
        visitLead:'12% Visit → Lead — аномально высокий CR за счёт собственной базы ЦФ: лояльность, известный бренд, push-кампании прогревают перед визитом.',
        leadApproval:'35% Lead → Approval — есть положительная кредитная история внутри ЦФ, скоринг автоматически одобряет большую долю заявок.',
        approvalIssue:'80% Approval → Issue — repeat-выдача быстрая, KYC уже пройден, отвал минимальный.',
        cac:'CAC 250 ₽ — стоимость касания через CRM/Push фактически близка к нулю; небольшая сумма аллоцирована на брендовую закупку и retention-инфраструктуру.',
        cpa:'CPA 0 ₽ (внутр.) — это внутренняя синергия: не выручка маркетплейса, а защита базы ЦФ от каннибализации внешними МФО.',
        ltv:'LTV 550 ₽ — складывается из дельты по повышенному лимиту и реструктуризации; ниже, чем у внешних сегментов, так как нет CPA-выплат.'
      }
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
      defaultCr:{visitLead:4,leadApproval:20,approvalIssue:60},
      cac:938,cpa:1500,ltv:1500,payback:6,share:0.20,
      mix:{seo:0.46,paid:0.16,crm:0.03,pr:0.35},
      color:'#c2680a',
      justify:{
        visitLead:'4% Visit → Lead — холодный трафик, аудитория не знакома с брендом и сравнивает варианты: ниже среднего по сравнению с «горячими» сегментами.',
        leadApproval:'20% Lead → Approval — широкий профиль аудитории, скоринг работает по среднерыночным правилам; одобряется примерно каждый пятый лид.',
        approvalIssue:'60% Approval → Issue — много отвалов на этапе подписания: новички осторожнее, читают условия, не все принимают офер.',
        cac:'CAC 938 ₽ — органический и PR-трафик «бесплатный» в моменте, но содержание контента и брендовая закупка дают высокую стоимость одной выдачи.',
        cpa:'CPA 1 500 ₽ — fallback-витрина после отказа ЦФ, дают банки и крупные МФО; для непрофиля ставки умеренные.',
        ltv:'LTV 1 500 ₽ — разовая транзакция, дальнейший прогрев уже идёт в сегмент «Действующие ЦФ», поэтому LTV здесь не накопительный.'
      }
    }
  ];

  // SSR matrix (8 rows) — unchanged
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
  function esc(value){return String(value==null?'':value).replace(/[&<>"'\/`]/g,function(c){return HTML_ESCAPE_MAP[c];});}
  var memStore={};
  function read(key,fallback){
    try{var raw=localStorage.getItem(key);if(raw!=null)return JSON.parse(raw);}
    catch(e){/* localStorage unavailable — fall through to in-memory */}
    return key in memStore?memStore[key]:fallback;
  }
  function write(key,value){
    memStore[key]=value;
    try{localStorage.setItem(key,JSON.stringify(value));}
    catch(e){/* in-memory copy already kept */}
  }
  function fmt(v){return Math.round(Number(v)||0).toLocaleString('ru-RU');}
  function rub(v){return fmt(v)+' ₽';}
  function pct(v,digits){return (Number(v)||0).toLocaleString('ru-RU',{maximumFractionDigits:digits==null?1:digits})+'%';}
  function ratioTone(v){return v>=3?'green':v>=1.5?'yellow':'red';}
  function clamp(v,min,max){v=Number(v);if(!isFinite(v))v=min;return Math.max(min,Math.min(max,v));}

  function segmentById(id){return segments.find(function(s){return s.id===id;})||null;}
  function selectedId(){return read(STORAGE_KEY,{segment:segments[0].id}).segment||segments[0].id;}
  function setSelected(id){write(STORAGE_KEY,{segment:id});}
  function isMatrixView(){return selectedId()==='matrix';}
  function currentSegment(){return segmentById(selectedId())||segments[0];}

  function activeInnerTab(){return read(TAB_KEY,'funnel')||'funnel';}
  function setActiveInnerTab(tab){write(TAB_KEY,tab);}

  // --- Manual inputs management ---------------------------------------------
  // Stored shape: { [segmentId]: { visitLead, leadApproval, approvalIssue, cac, cpa, ltv } }
  function manualStore(){return read(MANUAL_KEY,{});}
  function manualFor(id){
    var seg=segmentById(id);if(!seg)return null;
    var store=manualStore();var saved=store[id]||{};
    return {
      visitLead:saved.visitLead!=null?Number(saved.visitLead):seg.defaultCr.visitLead,
      leadApproval:saved.leadApproval!=null?Number(saved.leadApproval):seg.defaultCr.leadApproval,
      approvalIssue:saved.approvalIssue!=null?Number(saved.approvalIssue):seg.defaultCr.approvalIssue,
      cac:saved.cac!=null?Number(saved.cac):seg.cac,
      cpa:saved.cpa!=null?Number(saved.cpa):seg.cpa,
      ltv:saved.ltv!=null?Number(saved.ltv):seg.ltv
    };
  }
  function isEdited(id,key){var store=manualStore();return store[id]&&store[id][key]!=null;}
  function setManual(id,key,value){
    var store=manualStore();
    if(!store[id])store[id]={};
    store[id][key]=value;
    write(MANUAL_KEY,store);
  }
  function resetManual(id){
    var store=manualStore();
    delete store[id];
    write(MANUAL_KEY,store);
  }

  // --- Funnel computation ---------------------------------------------------
  function funnelFor(id,opts){
    opts=opts||{};
    var m=manualFor(id);
    var visit=BASE_VISITS;
    var crVL=clamp(m.visitLead,0,100);
    var crLA=clamp(m.leadApproval,0,100);
    var crAI=clamp(m.approvalIssue,0,100);
    if(opts.mode==='toBe'){crVL*=1.05;crLA*=1.05;crAI*=1.05;}
    crVL=Math.min(crVL,100);crLA=Math.min(crLA,100);crAI=Math.min(crAI,100);
    var lead=Math.round(visit*crVL/100);
    var approval=Math.round(lead*crLA/100);
    var issue=Math.round(approval*crAI/100);
    return {visit:visit,lead:lead,approval:approval,issue:issue,crVL:crVL,crLA:crLA,crAI:crAI};
  }
  function ltvCacFor(id){var m=manualFor(id);return m.cac>0?m.ltv/m.cac:0;}

  // --- Charts wrapper -------------------------------------------------------
  function clearChart(id){if(charts[id]){charts[id].destroy();delete charts[id];}}
  function drawChart(id,config){var canvas=$(id);if(!canvas)return;if(typeof Chart==='undefined'){console.warn('CJM dashboard: custom Chart renderer is unavailable; ensure dashboard-app.js is loaded before cjm-unit-dashboard.js');return;}clearChart(id);charts[id]=new Chart(canvas,config);}

  // --- Top segment tabs (level 1) -------------------------------------------
  function renderSegmentTabs(){
    var host=$('cjmSegmentTabs');
    if(!host)return;
    var current=selectedId();
    var html=segments.map(function(s){
      var active=current===s.id?' active':'';
      return '<button class="cjm-seg-tab'+active+'" type="button" data-seg="'+esc(s.id)+'">'+
        '<span class="cjm-seg-dot" style="background:'+esc(s.color)+'"></span>'+
        '<span>'+esc(s.name)+'</span>'+
        '<span class="cjm-seg-share">'+pct(s.share*100,0)+'</span>'+
      '</button>';
    }).join('');
    html+='<button class="cjm-seg-tab is-matrix'+(current==='matrix'?' active':'')+'" type="button" data-seg="matrix">'+
      '<span>📊 Сводная матрица</span>'+
      '<span class="cjm-seg-share">все 4</span>'+
    '</button>';
    host.innerHTML=html;
    host.querySelectorAll('.cjm-seg-tab').forEach(function(btn){
      btn.addEventListener('click',function(){
        setSelected(btn.getAttribute('data-seg'));
        renderAll();
      });
    });
  }

  // --- Inner tabs (level 2) -------------------------------------------------
  function initInnerTabs(){
    document.querySelectorAll('#cjmInnerTabs .cjm-tab').forEach(function(btn){
      btn.addEventListener('click',function(){
        var tab=btn.getAttribute('data-cjm-tab');
        setActiveInnerTab(tab);
        applyInnerTab();
        requestAnimationFrame(renderCharts);
      });
    });
  }
  function applyInnerTab(){
    var matrix=isMatrixView();
    var innerNav=$('cjmInnerTabs');
    if(innerNav)innerNav.style.display=matrix?'none':'';
    document.querySelectorAll('.cjm-panel').forEach(function(panel){panel.classList.remove('active');});
    if(matrix){
      var m=$('cjm-tab-matrix');if(m)m.classList.add('active');
    }else{
      var tab=activeInnerTab();
      var target=$('cjm-tab-'+tab);
      if(!target){tab='funnel';target=$('cjm-tab-funnel');setActiveInnerTab(tab);}
      target.classList.add('active');
      document.querySelectorAll('#cjmInnerTabs .cjm-tab').forEach(function(b){
        b.classList.toggle('active',b.getAttribute('data-cjm-tab')===tab);
      });
    }
  }

  // --- Hero (title + lead) updated per selection ---------------------------
  function renderHero(){
    var title=$('cjmHeroTitle'),lead=$('cjmHeroLead'),eyebrow=$('cjmHeroEyebrow');
    if(!title)return;
    if(isMatrixView()){
      eyebrow.textContent='Раздел сайта · CJM & Юнит-экономика — сводный обзор';
      title.textContent='Сводная матрица всех сегментов';
      lead.textContent='Сравнение 4 сегментов рядом: воронки на 10 000 пользователей, юнит-экономика, каналы привлечения и LTV/CAC. Чтобы перейти к деталям конкретного сегмента — нажмите на его таб сверху.';
    }else{
      var s=currentSegment();
      eyebrow.textContent='Раздел сайта · CJM & Юнит-экономика — сегмент: '+s.name;
      title.textContent=s.label;
      lead.textContent=s.pains+' Внутри 5 вкладок-переключателей: воронка на 10 000 пользователей с ручными показателями, путь клиента, юнит-экономика, маршрутизация SSR и окупаемость.';
    }
  }

  // --- Funnel tab (per segment): 10 000 users + manual inputs + justify -----
  function renderFunnelPanel(){
    if(isMatrixView())return;
    var s=currentSegment();
    var f=funnelFor(s.id);
    var steps=[
      ['Visit',f.visit,'100% базы симуляции'],
      ['Lead',f.lead,pct(f.crVL,1)+' Visit → Lead'],
      ['Approval',f.approval,pct(f.crLA,1)+' Lead → Approval'],
      ['Issue',f.issue,pct(f.crAI,1)+' Approval → Issue']
    ];
    var host=$('cjmSegmentFunnel');
    if(host){
      host.innerHTML=steps.map(function(st){
        return '<div class="cjm-funnel-step"><span>'+esc(st[0])+'</span><b>'+fmt(st[1])+'</b><p class="metric-sub">'+esc(st[2])+'</p></div>';
      }).join('');
    }

    var fields=[
      {key:'visitLead',label:'CR · Visit → Lead',suffix:'%',step:'0.1',min:0,max:100},
      {key:'leadApproval',label:'CR · Lead → Approval',suffix:'%',step:'0.1',min:0,max:100},
      {key:'approvalIssue',label:'CR · Approval → Issue',suffix:'%',step:'0.1',min:0,max:100},
      {key:'cac',label:'CAC',suffix:'₽',step:'1',min:0,max:1000000},
      {key:'cpa',label:'CPA / выплата партнёра',suffix:'₽',step:'1',min:0,max:1000000},
      {key:'ltv',label:'LTV',suffix:'₽',step:'1',min:0,max:1000000}
    ];
    var m=manualFor(s.id);
    var inputs=$('cjmManualInputs');
    if(inputs){
      inputs.innerHTML=fields.map(function(f){
        var edited=isEdited(s.id,f.key);
        return '<label for="cjmIn_'+esc(f.key)+'">'+esc(f.label)+
          (edited?' <span class="cjm-manual-suffix" title="Значение изменено вручную">· изменено</span>':'')+
          '<input id="cjmIn_'+esc(f.key)+'" type="number" inputmode="decimal" '+
            'min="'+f.min+'" max="'+f.max+'" step="'+f.step+'" '+
            'value="'+esc(m[f.key])+'" data-key="'+esc(f.key)+'" '+
            (edited?'class="is-edited"':'')+'>'+
        '</label>';
      }).join('');
      inputs.querySelectorAll('input[data-key]').forEach(function(input){
        input.addEventListener('input',function(){
          var key=input.getAttribute('data-key');
          var raw=input.value;
          if(raw===''){
            // empty -> reset to default for this key
            var store=manualStore();
            if(store[s.id]&&store[s.id][key]!=null){delete store[s.id][key];if(Object.keys(store[s.id]).length===0)delete store[s.id];write(MANUAL_KEY,store);}
          }else{
            setManual(s.id,key,Number(raw));
          }
          // Re-render this tab + unit tab data; redraw chart only if visible
          renderFunnelPanel();
          renderUnitPanel();
          if(activeInnerTab()==='unit')requestAnimationFrame(renderCharts);
        });
      });
    }

    var just=$('cjmJustifications');
    if(just){
      var rows=[
        ['CR · Visit → Lead',s.justify.visitLead],
        ['CR · Lead → Approval',s.justify.leadApproval],
        ['CR · Approval → Issue',s.justify.approvalIssue],
        ['CAC',s.justify.cac],
        ['CPA',s.justify.cpa],
        ['LTV',s.justify.ltv]
      ];
      just.innerHTML=rows.map(function(r){return '<li><b>'+esc(r[0])+':</b> '+esc(r[1])+'</li>';}).join('');
    }

    var resetBtn=$('cjmFunnelReset');
    if(resetBtn&&!resetBtn.__bound){
      resetBtn.__bound=true;
      resetBtn.addEventListener('click',function(){
        resetManual(currentSegment().id);
        renderFunnelPanel();renderUnitPanel();
        if(activeInnerTab()==='unit')requestAnimationFrame(renderCharts);
      });
    }
  }

  // --- CJM journey panel (per segment) --------------------------------------
  function renderJourneyPanel(){
    if(isMatrixView())return;
    var host=$('cjmJourneyHost');if(!host)return;
    var s=currentSegment();
    host.innerHTML='<article class="card" style="border-top:4px solid '+esc(s.color)+'">'+
      '<div class="card-title"><div><span class="eyebrow">'+esc(s.status)+'</span><h2>'+esc(s.label)+'</h2><p>'+esc(s.pains)+'</p></div></div>'+
      '<div class="cjm-stage-grid">'+
        '<div class="cjm-stage"><h3>1. Вход (Источник)</h3><p>'+esc(s.source)+'</p></div>'+
        '<div class="cjm-stage"><h3>2. Smart Safe Router</h3><p>'+esc(s.router)+'</p></div>'+
        '<div class="cjm-stage"><h3>3. Витрина (Офферы)</h3><p>'+esc(s.showcase)+'</p></div>'+
        '<div class="cjm-stage"><h3>4. Монетизация</h3><p><b>'+esc(s.monetization)+'</b></p></div>'+
      '</div>'+
      '<div class="card cjm-jtbd tight"><div class="card-title"><div><h3>Боли и барьеры (JTBD)</h3><p>'+esc(s.pains)+'</p></div></div></div>'+
    '</article>';
  }

  // --- Unit-economics panel (per segment) -----------------------------------
  function renderUnitPanel(){
    if(isMatrixView())return;
    var s=currentSegment();
    var mode=read(MODE_KEY,'asIs');
    var f=funnelFor(s.id,{mode:mode});
    var m=manualFor(s.id);
    var ltvCac=m.cac>0?m.ltv/m.cac:0;
    var tone=ratioTone(ltvCac);
    var kpis=[
      ['CAC',rub(m.cac),'Стоимость привлечения на выдачу','blue'],
      ['CPA',s.id==='active'?'внутр.':rub(m.cpa),'Средняя выплата/ценность действия','blue'],
      ['LTV',rub(m.ltv),'Ожидаемая ценность клиента','green'],
      ['LTV/CAC',ltvCac.toFixed(1)+'×','Светофор: ≥3 green, 1.5–2.9 yellow, <1.5 red',tone]
    ];
    var kpiHost=$('cjmUnitKpis');
    if(kpiHost){
      kpiHost.innerHTML=kpis.map(function(k){
        return '<div class="ue2-kpi tone-'+k[3]+'"><span class="ue2-kpi-label">'+esc(k[0])+'</span><span class="ue2-kpi-value">'+esc(k[1])+'</span><span class="ue2-kpi-sub">'+esc(k[2])+'</span></div>';
      }).join('');
    }
    var rows=[
      ['Visit',f.visit,'—','100%'],
      ['Lead',f.lead,pct(f.crVL),pct(f.lead/f.visit*100)],
      ['Approval',f.approval,pct(f.crLA),pct(f.approval/f.visit*100)],
      ['Issue',f.issue,pct(f.crAI),pct(f.issue/f.visit*100)]
    ];
    var t=$('cjmUnitFunnel');
    if(t){
      t.innerHTML='<thead><tr><th>Шаг</th><th>Абс.</th><th>CR шага</th><th>CR от Visit</th></tr></thead><tbody>'+
        rows.map(function(r){return '<tr><td class="ue2-t-name">'+esc(r[0])+'</td><td>'+fmt(r[1])+'</td><td>'+esc(r[2])+'</td><td>'+esc(r[3])+'</td></tr>';}).join('')+'</tbody>';
    }
    document.querySelectorAll('[data-cjm-mode]').forEach(function(btn){btn.classList.toggle('active',btn.getAttribute('data-cjm-mode')===mode);});
  }

  // --- SSR panel (per segment) ---------------------------------------------
  function renderSsrPanel(){
    var t=$('cjmSsrTable');
    if(t){
      t.innerHTML='<thead><tr><th>Статус API</th><th>Смысл</th><th>Разрешено</th><th>Блокируется</th></tr></thead><tbody>'+
        ssrRows.map(function(r){return '<tr><td class="ue2-t-name"><b>'+esc(r[0])+'</b></td><td>'+esc(r[1])+'</td><td class="tone-green">'+esc(r[2])+'</td><td class="tone-red">'+esc(r[3])+'</td></tr>';}).join('')+'</tbody>';
    }
    var flow=[
      ['Входящий трафик','SEO · Директ · PR · Push'],
      ['Lead Capture','Телефон, сумма, согласие 152-ФЗ'],
      ['S2S API ЦФ',CF_CHECK_REQUEST],
      ['Smart Safe Router','8 статусов → правила Offers Engine'],
      ['Витрина / действие','ЦФ, CPA, БФЛ, банк или отказ']
    ];
    var f=$('cjmRouteFlow');
    if(f)f.innerHTML=flow.map(function(n){return '<div class="cjm-route-node"><h3>'+esc(n[0])+'</h3><p>'+esc(n[1])+'</p></div>';}).join('');

    var seg=$('cjmSsrSegmentCard');
    if(seg&&!isMatrixView()){
      var s=currentSegment();
      seg.innerHTML='<div class="card-title"><div><span class="eyebrow">Сегмент · '+esc(s.status)+'</span><h2>Как роутер обрабатывает «'+esc(s.name)+'»</h2><p>Поведение Smart Safe Router и Offers Engine для выбранного сегмента</p></div></div>'+
        '<div class="cjm-ssr-segment-grid">'+
          '<div class="ssr-cell"><h3>Источник трафика</h3><p>'+esc(s.source)+'</p></div>'+
          '<div class="ssr-cell"><h3>Решение роутера</h3><p>'+esc(s.router)+'</p></div>'+
          '<div class="ssr-cell"><h3>Что показываем</h3><p>'+esc(s.showcase)+'</p></div>'+
          '<div class="ssr-cell"><h3>Монетизация</h3><p>'+esc(s.monetization)+'</p></div>'+
        '</div>';
    }
  }

  // --- Payback panel --------------------------------------------------------
  function initUnitMode(){
    document.querySelectorAll('[data-cjm-mode]').forEach(function(btn){
      btn.addEventListener('click',function(){write(MODE_KEY,btn.getAttribute('data-cjm-mode'));renderUnitPanel();requestAnimationFrame(renderCharts);});
    });
  }
  function initPaybackInputs(){
    var host=$('cjmPaybackInputs');if(!host)return;
    var defaults=read(PAYBACK_KEY,{sleeping:9000,rejected:12000,new:7000});
    var fields=[
      ['sleeping','Спящие / БФЛ'],
      ['rejected','Отказники ЦФ'],
      ['new','Новые']
    ];
    host.innerHTML=fields.map(function(f){
      return '<label for="cjmPb_'+esc(f[0])+'">'+esc(f[1])+'<input id="cjmPb_'+esc(f[0])+'" type="number" min="0" step="100" value="'+esc(defaults[f[0]]||0)+'" inputmode="numeric"></label>';
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
    if(!$('cjmPaybackInputs'))return;
    var v=paybackValues();
    var cr=PAYBACK_CONVERSION_RATE,cpa=PAYBACK_CPA;
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
      'Увеличивать SEO-долю для «Спящих / БФЛ»: LTV/CAC 6,0× и payback 3 мес. дают лучший ROMI.',
      'Платный трафик масштабировать через «Отказников» только при сохранении CPA ≥ CAC: роутер должен компенсировать закупку.',
      'Действующих клиентов ЦФ держать в отдельном CRM-контуре: это внутренняя синергия и защита от каннибализации, а не выручка маркетплейса.',
      'Для «Новых» ограничивать бюджет тестами и прогревом базы: LTV/CAC 1,6× близок к красной зоне.'
    ].map(function(x){return '<li>'+esc(x)+'</li>';}).join('');
  }

  // --- Matrix view ----------------------------------------------------------
  function renderMatrix(){
    if(!isMatrixView())return;
    // Funnels card per segment
    var funnels=$('cjmMatrixFunnels');
    if(funnels){
      funnels.innerHTML=segments.map(function(s){
        var f=funnelFor(s.id);
        return '<article class="cjm-matrix-segment" style="border-top-color:'+esc(s.color)+'">'+
          '<header><h3>'+esc(s.name)+'</h3><span class="cjm-matrix-status">'+esc(s.status)+'</span></header>'+
          '<div class="cjm-matrix-step"><span class="cjm-matrix-step-name">Visit</span><span class="cjm-matrix-step-val">'+fmt(f.visit)+'</span><span class="cjm-matrix-step-cr">100%</span></div>'+
          '<div class="cjm-matrix-step"><span class="cjm-matrix-step-name">Lead</span><span class="cjm-matrix-step-val">'+fmt(f.lead)+'</span><span class="cjm-matrix-step-cr">'+pct(f.crVL,1)+'</span></div>'+
          '<div class="cjm-matrix-step"><span class="cjm-matrix-step-name">Approval</span><span class="cjm-matrix-step-val">'+fmt(f.approval)+'</span><span class="cjm-matrix-step-cr">'+pct(f.crLA,1)+'</span></div>'+
          '<div class="cjm-matrix-step"><span class="cjm-matrix-step-name">Issue</span><span class="cjm-matrix-step-val">'+fmt(f.issue)+'</span><span class="cjm-matrix-step-cr">'+pct(f.crAI,1)+'</span></div>'+
          '<footer><span>Доля сегмента</span><b>'+pct(s.share*100,0)+'</b></footer>'+
        '</article>';
      }).join('');
    }
    renderSummaryTable();
    renderMatrixChannelMix();
  }
  function renderSummaryTable(){
    var table=$('cjmSummaryTable');if(!table)return;
    var rows=segments.slice();
    var data=rows.map(function(s){var m=manualFor(s.id);var f=funnelFor(s.id);return {s:s,cac:m.cac,cpa:m.cpa,ltv:m.ltv,ltvCac:m.cac>0?m.ltv/m.cac:0,payback:s.payback,issue:f.issue};});
    var metrics=['cac','cpa','ltv','ltvCac','payback','issue'];
    var best={},worst={};
    metrics.forEach(function(k){
      var vals=data.map(function(d){return d[k];});
      best[k]=(k==='cac'||k==='payback')?Math.min.apply(Math,vals):Math.max.apply(Math,vals);
      worst[k]=(k==='cac'||k==='payback')?Math.max.apply(Math,vals):Math.min.apply(Math,vals);
    });
    function cls(d,k){return d[k]===best[k]?'tone-green':d[k]===worst[k]?'tone-red':'';}
    table.innerHTML='<thead><tr><th>Сегмент</th><th>Выдач (на 10 000)</th><th>CAC</th><th>CPA</th><th>LTV</th><th>LTV/CAC</th><th>Payback</th></tr></thead><tbody>'+
      data.map(function(d){
        return '<tr><td class="ue2-t-name"><span class="ue2-seg-dot" style="background:'+esc(d.s.color)+'"></span>'+esc(d.s.name)+'</td>'+
          '<td class="'+cls(d,'issue')+'">'+fmt(d.issue)+'</td>'+
          '<td class="'+cls(d,'cac')+'">'+rub(d.cac)+'</td>'+
          '<td class="'+cls(d,'cpa')+'">'+(d.s.id==='active'?'внутр.':rub(d.cpa))+'</td>'+
          '<td class="'+cls(d,'ltv')+'">'+rub(d.ltv)+'</td>'+
          '<td class="'+cls(d,'ltvCac')+'">'+d.ltvCac.toFixed(1)+'×</td>'+
          '<td class="'+cls(d,'payback')+'">'+d.payback+' мес.</td></tr>';
      }).join('')+'</tbody>';
  }
  function renderMatrixChannelMix(){
    var host=$('cjmChannelMix');if(!host)return;
    var total=segments.reduce(function(a,s){return a+s.share;},0)||1;
    var mix={seo:0,paid:0,crm:0,pr:0};
    segments.forEach(function(s){mix.seo+=s.mix.seo*s.share/total;mix.paid+=s.mix.paid*s.share/total;mix.crm+=s.mix.crm*s.share/total;mix.pr+=s.mix.pr*s.share/total;});
    var seo=mix.seo*100, paid=seo+mix.paid*100, crm=paid+mix.crm*100;
    host.innerHTML='<div class="cjm-pie-visual" style="--seo:'+seo+'%;--paid:'+paid+'%;--crm:'+crm+'%"></div><div class="cjm-legend">'+
      [['SEO',mix.seo,'var(--blue)'],['Платный трафик',mix.paid,'var(--orange)'],['CRM / Push',mix.crm,'var(--violet)'],['PR / Organic',mix.pr,'var(--green)']]
      .map(function(r){return '<div class="cjm-legend-row"><span><i class="cjm-dot" style="background:'+r[2]+'"></i>'+esc(r[0])+'</span><b>'+pct(r[1]*100,0)+'</b></div>';}).join('')+'</div>';
  }

  // --- Charts ---------------------------------------------------------------
  function renderCharts(){
    var colors={blue:'#0071e3',green:'#1d9d52'};
    if(isMatrixView()){
      drawChart('cjmTrendChart',{
        type:'bar',
        data:{labels:segments.map(function(s){return s.name;}),datasets:[{label:'LTV/CAC, ×',data:segments.map(function(s){return ltvCacFor(s.id);}),backgroundColor:segments.map(function(s){return s.color;})}]}
      });
    }
    if(!isMatrixView()&&activeInnerTab()==='unit'){
      var s=currentSegment();
      var asIs=funnelFor(s.id,{mode:'asIs'}),toBe=funnelFor(s.id,{mode:'toBe'});
      drawChart('cjmUnitChart',{
        type:'bar',
        data:{labels:['Lead','Approval','Issue'],datasets:[
          {label:'As-Is',data:[asIs.lead,asIs.approval,asIs.issue],backgroundColor:colors.blue},
          {label:'To-Be +5% CR',data:[toBe.lead,toBe.approval,toBe.issue],backgroundColor:colors.green}
        ]}
      });
    }
  }

  function renderAll(){
    renderSegmentTabs();
    renderHero();
    applyInnerTab();
    if(isMatrixView()){
      renderMatrix();
    }else{
      renderFunnelPanel();
      renderJourneyPanel();
      renderUnitPanel();
      renderSsrPanel();
    }
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
    initInnerTabs();
    initUnitMode();
    initPaybackInputs();
    initTheme();
    renderAll();
  }

  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init);
  else init();
})();
