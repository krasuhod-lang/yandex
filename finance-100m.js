(function(){
  'use strict';

  // ==========================================================================
  // Финмодель «100 млн ₽ чистыми в месяц»
  // --------------------------------------------------------------------------
  // Самодостаточный модуль: рендерит собственную панель #cjm-tab-finance100,
  // не вмешивается в остальные вкладки. Хостится на той же странице, что и
  // cjm-unit-dashboard.js, и подключается тем же селектором сегментов
  // (selectedId==='finance100'). Все параметры редактируются пользователем,
  // сохраняются в localStorage и синхронизируются с same-origin API
  // /api/cjm-state (через основной модуль, если он есть — иначе только
  // локально). Модуль строит цепочку показателей, которая делает
  // прозрачной закономерность: как из целевой чистой прибыли выводятся
  // выручка, валовая маржа, штат, расходы и требуемый темп роста.
  // ==========================================================================

  var STORAGE_KEY='fin100_inputs_v1';
  var HTML_ESCAPE_MAP={'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;','/':'&#x2F;','`':'&#96;'};

  // --- Дефолты. Отражают устойчивую конфигурацию высококонкурентного
  //     лидогенерационного бизнеса на масштабе 500 млн ₽/мес выручки. Все
  //     доли и коэффициенты калиброваны так, чтобы при 20% чистой марже
  //     цепочка сходилась к 100 млн ₽/мес чистой прибыли, а месячный темп
  //     роста от старта 250 000 ₽/мес до цели укладывался в 36 месяцев.
  var DEFAULTS={
    targetNetProfit: 100000000,
    netMargin: 20,
    grossMargin: 60,
    marketingShare: 25,
    fotShare: 12,
    avgFot: 250000,
    devShare: 4,
    gaShare: 3,
    riskShare: 1,
    taxRate: 20,
    startRevenue: 250000,
    horizonMonths: 36,
    cacInflation: 2,
    fotIndex: 7
  };

  // Метаданные полей: подпись, единица, min/max, пояснение связи с
  // остальной моделью. Пояснения даны без «подзаголовков» — коротким
  // одноаспектным предложением, в строгом деловом тоне.
  var FIELDS=[
    {key:'targetNetProfit', label:'Целевая чистая прибыль', suffix:'₽ в месяц', min:0, max:10000000000,
      hint:'Задаёт всю цепочку: выручка = цель / чистая маржа.'},
    {key:'netMargin', label:'Чистая маржа', suffix:'% от выручки', min:1, max:60,
      hint:'Определяет требуемую выручку. При 20% требуется 500 млн ₽/мес.'},
    {key:'grossMargin', label:'Валовая маржа', suffix:'% от выручки', min:10, max:95,
      hint:'После прямой себестоимости и выплат партнёрам. База для покрытия OPEX.'},
    {key:'marketingShare', label:'Маркетинг и медиа', suffix:'% от выручки', min:0, max:60,
      hint:'Верхняя граница на конкурентном рынке — 25–30%.'},
    {key:'fotShare', label:'ФОТ с налогами', suffix:'% от выручки', min:0, max:40,
      hint:'При среднем ФОТ на сотрудника — задаёт численность штата.'},
    {key:'avgFot', label:'Средний ФОТ на сотрудника', suffix:'₽ в месяц, с налогами', min:30000, max:2000000,
      hint:'Штат = (выручка × доля ФОТ) / средний ФОТ.'},
    {key:'devShare', label:'Разработка и продукт', suffix:'% от выручки', min:0, max:20,
      hint:'Инженерия, продукт, аналитика, данные.'},
    {key:'gaShare', label:'Административные расходы', suffix:'% от выручки', min:0, max:15,
      hint:'Офис, юридическое сопровождение, финансы, HR.'},
    {key:'riskShare', label:'Резерв на риски', suffix:'% от выручки', min:0, max:10,
      hint:'Буфер на регуляторные и рыночные колебания.'},
    {key:'taxRate', label:'Налог на прибыль', suffix:'% от EBITDA', min:0, max:50,
      hint:'Чистая прибыль = EBITDA × (1 − ставка налога).'},
    {key:'startRevenue', label:'Стартовая выручка', suffix:'₽ в месяц', min:0, max:1000000000,
      hint:'База траектории роста. Требуемый темп выводится из соотношения цель / старт.'},
    {key:'horizonMonths', label:'Горизонт', suffix:'месяцев до цели', min:6, max:120,
      hint:'Задаёт требуемый месячный темп роста выручки.'},
    {key:'cacInflation', label:'Инфляция стоимости привлечения', suffix:'% в месяц', min:0, max:10,
      hint:'Аукционное давление конкурентов. Ужесточает маркетинг-бюджет со временем.'},
    {key:'fotIndex', label:'Индексация ФОТ', suffix:'% в год', min:0, max:30,
      hint:'Ежегодное повышение окладов при удержании штата.'}
  ];

  // --- Утилиты --------------------------------------------------------------
  function $(id){return document.getElementById(id);}
  function esc(v){return String(v==null?'':v).replace(/[&<>"'\/`]/g,function(c){return HTML_ESCAPE_MAP[c];});}
  function fmt(v){return Math.round(Number(v)||0).toLocaleString('ru-RU');}
  function pct(v,digits){return (Number(v)||0).toLocaleString('ru-RU',{maximumFractionDigits:digits==null?1:digits})+'%';}
  function rub(v){return fmt(v)+' ₽';}
  function millions(v){
    var a=Math.abs(Number(v)||0);
    if(a<1000000)return fmt(v)+' ₽';
    var m=(Number(v)||0)/1000000;
    return m.toLocaleString('ru-RU',{maximumFractionDigits:m>=100?0:m>=10?1:2})+' млн ₽';
  }
  function clamp(v,min,max){v=Number(v);if(!isFinite(v))v=min;return Math.max(min,Math.min(max,v));}

  var mem={};
  function read(){
    try{var raw=localStorage.getItem(STORAGE_KEY);if(raw!=null)return JSON.parse(raw)||{};}
    catch(e){}
    return mem[STORAGE_KEY]||{};
  }
  function write(obj){
    mem[STORAGE_KEY]=obj;
    try{localStorage.setItem(STORAGE_KEY,JSON.stringify(obj));}catch(e){}
  }
  function inputs(){
    var raw=read();var out={};
    Object.keys(DEFAULTS).forEach(function(k){
      var v=raw[k];
      out[k]=(v==null||v===''||!isFinite(Number(v)))?DEFAULTS[k]:Number(v);
    });
    return out;
  }
  function isEdited(key){
    var raw=read();return raw[key]!=null&&raw[key]!==''&&Number(raw[key])!==DEFAULTS[key];
  }
  function setInput(key,val){
    var raw=read();raw[key]=val;write(raw);
  }
  function unsetInput(key){
    var raw=read();delete raw[key];write(raw);
  }
  function resetAll(){write({});}

  // --- Модель ---------------------------------------------------------------
  // Замкнутая цепочка расчётов на конце горизонта:
  //   выручка_end   = цель / (чистая_маржа/100)
  //   валовая_end   = выручка_end × валовая_маржа/100
  //   маркетинг_end = выручка_end × доля_маркетинга/100
  //   ФОТ_end       = выручка_end × доля_ФОТ/100
  //   штат_end      = ФОТ_end / средний_ФОТ
  //   dev_end       = выручка_end × доля_разработки/100
  //   G&A_end       = выручка_end × доля_G&A/100
  //   резерв_end    = выручка_end × доля_резерва/100
  //   OPEX_end      = маркетинг + ФОТ + dev + G&A + резерв
  //   EBITDA_end    = валовая − OPEX
  //   налог_end     = EBITDA × ставка/100 (при EBITDA>0)
  //   NP_end        = EBITDA − налог
  // Помесячная траектория: экспоненциальный рост выручки от startRevenue до
  // выручка_end за horizonMonths, темп g = (выручка_end/старт)^(1/H) − 1.
  // Маркетинг учитывает CAC-инфляцию: доля_маркетинга × (1+cacInflation)^t.
  // ФОТ учитывает годовую индексацию окладов: штат постоянен, а средний
  // ФОТ на сотрудника растёт по (1+fotIndex)^(t/12). Такая структура делает
  // видимой закономерность: цель по прибыли жёстко детерминирует выручку и
  // штат, а темп роста и время выхода на масштаб — расстояние от старта.
  function compute(){
    var inp=inputs();
    var revEnd = inp.targetNetProfit/(inp.netMargin/100);
    var grossEnd = revEnd*inp.grossMargin/100;
    var marketingEnd = revEnd*inp.marketingShare/100;
    var fotEnd = revEnd*inp.fotShare/100;
    var headcount = Math.round(fotEnd/Math.max(1,inp.avgFot));
    var devEnd = revEnd*inp.devShare/100;
    var gaEnd = revEnd*inp.gaShare/100;
    var riskEnd = revEnd*inp.riskShare/100;
    var opexEnd = marketingEnd+fotEnd+devEnd+gaEnd+riskEnd;
    var ebitdaEnd = grossEnd-opexEnd;
    var taxEnd = Math.max(0,ebitdaEnd)*inp.taxRate/100;
    var npEnd = ebitdaEnd-taxEnd;

    var H=Math.max(1,Math.round(inp.horizonMonths));
    var start=Math.max(1,inp.startRevenue);
    var g = Math.pow(revEnd/start,1/H)-1;

    var rows=[];
    var cumProfit=0, minCum=0, breakEvenIdx=-1, targetIdx=-1;
    for(var t=0;t<=H;t++){
      var rev = start*Math.pow(1+g,t);
      var gross = rev*inp.grossMargin/100;
      var mktMul = Math.pow(1+inp.cacInflation/100,t);
      var marketing = rev*inp.marketingShare/100*mktMul;
      var fotIdx = Math.pow(1+inp.fotIndex/100,t/12);
      // Штат считаем по цели/end-point и держим постоянным во времени;
      // расходы на ФОТ растут только за счёт индексации окладов. Так модель
      // отражает большой штат как структурную инвестицию, а не как реакцию
      // на выручку месяц-в-месяц.
      var fot = headcount*inp.avgFot*fotIdx;
      var dev = rev*inp.devShare/100;
      var ga  = rev*inp.gaShare/100;
      var risk= rev*inp.riskShare/100;
      var opex= marketing+fot+dev+ga+risk;
      var ebitda= gross-opex;
      var tax = Math.max(0,ebitda)*inp.taxRate/100;
      var np  = ebitda-tax;
      cumProfit += np;
      if(cumProfit<minCum)minCum=cumProfit;
      if(breakEvenIdx<0&&cumProfit>=0&&t>0)breakEvenIdx=t;
      if(targetIdx<0&&np>=inp.targetNetProfit)targetIdx=t;
      rows.push({t:t,rev:rev,gross:gross,marketing:marketing,fot:fot,dev:dev,ga:ga,risk:risk,opex:opex,ebitda:ebitda,tax:tax,np:np,cum:cumProfit,headcount:headcount});
    }

    return {
      inp:inp,
      revEnd:revEnd, grossEnd:grossEnd, marketingEnd:marketingEnd, fotEnd:fotEnd,
      headcount:headcount, devEnd:devEnd, gaEnd:gaEnd, riskEnd:riskEnd,
      opexEnd:opexEnd, ebitdaEnd:ebitdaEnd, taxEnd:taxEnd, npEnd:npEnd,
      monthlyGrowth:g, horizon:H, rows:rows,
      breakEvenIdx:breakEvenIdx, targetIdx:targetIdx, peakInvest:-minCum
    };
  }

  // --- Разметка HTML вкладки -----------------------------------------------
  function ensurePanel(){
    // Панель вставляется рядом с остальными cjm-panel внутри <main>.
    if($('cjm-tab-finance100'))return $('cjm-tab-finance100');
    var main=document.querySelector('#cjmDashboard main');
    if(!main)return null;
    var section=document.createElement('section');
    section.id='cjm-tab-finance100';
    section.className='cjm-panel fin100-panel';
    section.innerHTML=
      '<div class="cjm-section-head">'+
        '<div><h2>Финансовая модель выхода на 100 млн ₽ чистыми в месяц</h2></div>'+
        '<div class="cjm-head-actions">'+
          '<button type="button" class="cjm-reset-btn" id="fin100Reset" title="Сбросить все параметры к значениям по умолчанию">Сбросить к дефолтам</button>'+
        '</div>'+
      '</div>'+
      '<p class="fin100-lead">Модель показывает закономерность между целевой чистой прибылью, требуемой выручкой, структурой расходов, численностью штата и темпом роста. Каждый параметр редактируется — цепочка показателей пересчитывается автоматически.</p>'+
      '<div class="fin100-chain" id="fin100Chain"></div>'+
      '<div class="card"><div class="card-title"><div><h2>Параметры модели</h2></div></div>'+
        '<p class="fin100-note">Параметры разбиты на три группы по функциональному назначению. Каждое поле снабжено пояснением, как оно влияет на итог.</p>'+
        '<div class="fin100-inputs" id="fin100Inputs"></div>'+
      '</div>'+
      '<div class="card"><div class="card-title"><div><h2>Ключевые показатели на конце горизонта</h2></div></div>'+
        '<div class="fin100-kpis" id="fin100Kpis"></div>'+
      '</div>'+
      '<div class="card"><div class="card-title"><div><h2>Помесячный план</h2></div></div>'+
        '<p class="fin100-note" id="fin100TableNote"></p>'+
        '<div class="fin100-table-wrap"><table class="fin100-table" id="fin100Table"></table></div>'+
      '</div>';
    main.appendChild(section);
    return section;
  }

  function ensureStyles(){
    if(document.getElementById('fin100-styles'))return;
    var css=
      '.fin100-lead{margin:0 0 16px;color:var(--muted);font-size:13.5px;line-height:1.55;max-width:960px}'+
      '.fin100-note{margin:0 0 14px;color:var(--muted);font-size:12px;line-height:1.5}'+
      '.fin100-chain{display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:10px;margin:0 0 22px;padding:18px;background:var(--surface-2);border:1px solid var(--line);border-radius:var(--radius-xs)}'+
      '.fin100-chain-item{display:flex;flex-direction:column;gap:4px;padding:10px 12px;background:var(--surface);border:1px solid var(--line);border-radius:8px;position:relative}'+
      '.fin100-chain-item .fin100-chain-formula{font-size:11px;color:var(--muted);font-weight:600;letter-spacing:.02em}'+
      '.fin100-chain-item .fin100-chain-value{font-size:20px;font-weight:700;letter-spacing:-.02em;font-variant-numeric:tabular-nums;color:var(--text)}'+
      '.fin100-chain-item .fin100-chain-cap{font-size:11.5px;color:var(--muted);line-height:1.4}'+
      '.fin100-chain-item.is-target{border-left:3px solid var(--green)}'+
      '.fin100-chain-item.is-target .fin100-chain-value{color:var(--green)}'+
      '.fin100-chain-item.is-derived{border-left:3px solid var(--blue)}'+
      '.fin100-inputs{display:grid;grid-template-columns:repeat(auto-fill,minmax(220px,1fr));gap:12px}'+
      '.fin100-input{display:flex;flex-direction:column;gap:5px}'+
      '.fin100-input-label{font-size:11.5px;font-weight:700;text-transform:uppercase;letter-spacing:.05em;color:var(--muted);line-height:1.3}'+
      '.fin100-input-suffix{display:block;font-size:11px;font-weight:600;color:var(--muted);text-transform:none;letter-spacing:0;margin-top:2px}'+
      '.fin100-input input{border:1px solid var(--line-strong);border-radius:var(--radius-xs);padding:10px 12px;background:var(--surface-2);font:inherit;font-size:14px;font-weight:600;color:var(--text);font-variant-numeric:tabular-nums;width:100%;box-sizing:border-box}'+
      '.fin100-input input:focus{outline:2px solid var(--blue);outline-offset:1px}'+
      '.fin100-input input.is-edited{border-color:var(--blue);background:color-mix(in srgb,var(--blue) 7%,var(--surface-2))}'+
      '.fin100-input .fin100-input-hint{font-size:11px;color:var(--muted);line-height:1.4;font-weight:500;text-transform:none;letter-spacing:0}'+
      '.fin100-kpis{display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:12px}'+
      '.fin100-kpi{padding:14px 15px;background:var(--surface-2);border:1px solid var(--line);border-left:4px solid var(--line-strong);border-radius:var(--radius-xs);display:flex;flex-direction:column;gap:4px}'+
      '.fin100-kpi.tone-green{border-left-color:var(--green)}'+
      '.fin100-kpi.tone-blue{border-left-color:var(--blue)}'+
      '.fin100-kpi.tone-violet{border-left-color:var(--violet)}'+
      '.fin100-kpi.tone-orange{border-left-color:var(--orange)}'+
      '.fin100-kpi.tone-red{border-left-color:var(--red)}'+
      '.fin100-kpi .fin100-kpi-label{font-size:11px;text-transform:uppercase;letter-spacing:.06em;color:var(--muted);font-weight:700}'+
      '.fin100-kpi .fin100-kpi-value{font-size:22px;font-weight:700;letter-spacing:-.02em;font-variant-numeric:tabular-nums;color:var(--text)}'+
      '.fin100-kpi.tone-green .fin100-kpi-value{color:var(--green)}'+
      '.fin100-kpi.tone-red .fin100-kpi-value{color:var(--red)}'+
      '.fin100-kpi .fin100-kpi-sub{font-size:11.5px;color:var(--muted);line-height:1.4}'+
      '.fin100-table-wrap{overflow:auto;border:1px solid var(--line);border-radius:var(--radius-xs)}'+
      '.fin100-table{width:100%;border-collapse:collapse;font-size:12.5px;min-width:1000px;font-variant-numeric:tabular-nums}'+
      '.fin100-table th,.fin100-table td{padding:8px 11px;text-align:right;border-bottom:1px solid var(--line);white-space:nowrap}'+
      '.fin100-table th{position:sticky;top:0;background:var(--surface-3);font-size:10.5px;text-transform:uppercase;letter-spacing:.04em;color:var(--muted);font-weight:800;z-index:1}'+
      '.fin100-table td:first-child,.fin100-table th:first-child{text-align:left;font-weight:600}'+
      '.fin100-table tbody tr:nth-child(even){background:var(--surface-2)}'+
      '.fin100-table tbody tr.is-target{background:color-mix(in srgb,var(--green) 12%,var(--surface))}'+
      '.fin100-table tbody tr.is-target td{color:var(--green);font-weight:700}'+
      '.fin100-table tbody tr.is-breakeven{background:color-mix(in srgb,var(--blue) 8%,var(--surface))}'+
      '.fin100-table td.neg{color:var(--red)}'+
      '';
    var style=document.createElement('style');style.id='fin100-styles';style.textContent=css;
    document.head.appendChild(style);
  }

  // --- Рендер ---------------------------------------------------------------
  function renderChain(res){
    var host=$('fin100Chain');if(!host)return;
    var items=[
      {tone:'target',formula:'Задано',value:millions(res.inp.targetNetProfit),cap:'Целевая чистая прибыль в месяц'},
      {tone:'derived',formula:'Цель / чистая маржа',value:millions(res.revEnd),cap:'Требуемая выручка в месяц'},
      {tone:'derived',formula:'Выручка × валовая маржа',value:millions(res.grossEnd),cap:'Валовая прибыль в месяц'},
      {tone:'derived',formula:'Выручка × доля маркетинга',value:millions(res.marketingEnd),cap:'Маркетинг и медиа в месяц'},
      {tone:'derived',formula:'Выручка × доля ФОТ / средний ФОТ',value:fmt(res.headcount)+' чел',cap:'Численность штата'},
      {tone:'derived',formula:'Валовая − OPEX − налог',value:millions(res.npEnd),cap:'Чистая прибыль на конце горизонта'}
    ];
    host.innerHTML=items.map(function(it){
      return '<div class="fin100-chain-item is-'+it.tone+'">'+
        '<span class="fin100-chain-formula">'+esc(it.formula)+'</span>'+
        '<span class="fin100-chain-value">'+esc(it.value)+'</span>'+
        '<span class="fin100-chain-cap">'+esc(it.cap)+'</span>'+
      '</div>';
    }).join('');
  }

  function renderInputs(){
    var host=$('fin100Inputs');if(!host)return;
    var inp=inputs();
    host.innerHTML=FIELDS.map(function(f){
      var val=inp[f.key];
      var edited=isEdited(f.key)?' is-edited':'';
      return '<label class="fin100-input">'+
        '<span class="fin100-input-label">'+esc(f.label)+
          '<span class="fin100-input-suffix">'+esc(f.suffix)+'</span>'+
        '</span>'+
        '<input type="number" data-fin100="'+esc(f.key)+'" value="'+esc(val)+'" min="'+esc(f.min)+'" max="'+esc(f.max)+'" step="any" class="'+edited.trim()+'">'+
        '<span class="fin100-input-hint">'+esc(f.hint)+'</span>'+
      '</label>';
    }).join('');
  }

  function renderKpis(res){
    var host=$('fin100Kpis');if(!host)return;
    var actualMargin = res.revEnd>0?(res.npEnd/res.revEnd*100):0;
    var hitTarget = res.npEnd>=res.inp.targetNetProfit;
    var kpis=[
      {tone:hitTarget?'green':'red',label:'Чистая прибыль на конце',value:millions(res.npEnd),sub:'Фактическая NP при заданной структуре'},
      {tone:'blue',label:'Фактическая чистая маржа',value:pct(actualMargin,1),sub:'Замыкание модели: (валовая − OPEX) × (1 − налог) / выручка'},
      {tone:'blue',label:'Требуемая выручка',value:millions(res.revEnd),sub:'Цель / чистая маржа'},
      {tone:'blue',label:'Валовая прибыль',value:millions(res.grossEnd),sub:'Выручка × валовая маржа'},
      {tone:'orange',label:'OPEX в месяц',value:millions(res.opexEnd),sub:'Маркетинг + ФОТ + разработка + G&A + резерв'},
      {tone:'violet',label:'Штат',value:fmt(res.headcount)+' чел',sub:'ФОТ / средний ФОТ на сотрудника'},
      {tone:'orange',label:'Маркетинг в месяц',value:millions(res.marketingEnd),sub:'На высококонкурентном рынке'},
      {tone:'orange',label:'ФОТ с налогами',value:millions(res.fotEnd),sub:'При штате и среднем ФОТ'},
      {tone:'blue',label:'Требуемый темп роста',value:pct(res.monthlyGrowth*100,1)+' в месяц',sub:'Из соотношения цель / старт за '+res.horizon+' мес'},
      {tone:res.peakInvest>0?'red':'green',label:'Пиковый кассовый разрыв',value:millions(res.peakInvest),sub:'Максимум накопленного убытка на инвестиционной фазе'},
      {tone:'green',label:'Месяц выхода в накопленный плюс',value:res.breakEvenIdx>=0?('м. '+res.breakEvenIdx):'за горизонтом',sub:'Кумулятивная прибыль ≥ 0'},
      {tone:hitTarget?'green':'red',label:'Месяц достижения цели',value:res.targetIdx>=0?('м. '+res.targetIdx):'за горизонтом',sub:'Месячная NP ≥ '+millions(res.inp.targetNetProfit)}
    ];
    host.innerHTML=kpis.map(function(k){
      return '<div class="fin100-kpi tone-'+k.tone+'">'+
        '<span class="fin100-kpi-label">'+esc(k.label)+'</span>'+
        '<span class="fin100-kpi-value">'+esc(k.value)+'</span>'+
        '<span class="fin100-kpi-sub">'+esc(k.sub)+'</span>'+
      '</div>';
    }).join('');
  }

  function renderTable(res){
    var host=$('fin100Table');if(!host)return;
    var note=$('fin100TableNote');
    if(note){
      note.textContent='Траектория от стартовой выручки '+millions(res.inp.startRevenue)+
        ' до требуемой '+millions(res.revEnd)+' за '+res.horizon+' месяцев. '+
        'Требуемый месячный темп роста выручки: '+pct(res.monthlyGrowth*100,1)+'. '+
        'Маркетинг индексируется на инфляцию стоимости привлечения ('+pct(res.inp.cacInflation,1)+' в месяц), '+
        'ФОТ — на годовую индексацию окладов ('+pct(res.inp.fotIndex,0)+' в год).';
    }
    var head='<thead><tr>'+
      '<th>Месяц</th>'+
      '<th>Выручка</th>'+
      '<th>Валовая</th>'+
      '<th>Маркетинг</th>'+
      '<th>ФОТ</th>'+
      '<th>Разработка</th>'+
      '<th>G&amp;A</th>'+
      '<th>Резерв</th>'+
      '<th>OPEX</th>'+
      '<th>EBITDA</th>'+
      '<th>Налог</th>'+
      '<th>Чистая прибыль</th>'+
      '<th>Накоплено</th>'+
    '</tr></thead>';
    function td(v){var neg=v<0?' class="neg"':'';return '<td'+neg+'>'+esc(millions(v))+'</td>';}
    var body='<tbody>'+res.rows.map(function(r){
      var cls=[];
      if(res.targetIdx===r.t)cls.push('is-target');
      else if(res.breakEvenIdx===r.t)cls.push('is-breakeven');
      return '<tr'+(cls.length?' class="'+cls.join(' ')+'"':'')+'>'+
        '<td>м. '+r.t+'</td>'+
        td(r.rev)+td(r.gross)+td(r.marketing)+td(r.fot)+td(r.dev)+td(r.ga)+td(r.risk)+td(r.opex)+td(r.ebitda)+td(r.tax)+td(r.np)+td(r.cum)+
      '</tr>';
    }).join('')+'</tbody>';
    host.innerHTML=head+body;
  }

  function bindEvents(){
    var section=$('cjm-tab-finance100');
    if(!section||section._fin100Wired)return;
    section._fin100Wired=true;
    section.addEventListener('input',function(ev){
      var el=ev.target;
      var key=el&&el.getAttribute&&el.getAttribute('data-fin100');
      if(!key)return;
      var meta=FIELDS.filter(function(f){return f.key===key;})[0];
      if(!meta)return;
      var raw=el.value;
      if(raw===''){unsetInput(key);el.classList.remove('is-edited');}
      else{
        var val=clamp(raw,meta.min,meta.max);
        setInput(key,val);
        el.classList.add('is-edited');
      }
      var res=compute();
      renderChain(res);renderKpis(res);renderTable(res);
    });
    var reset=$('fin100Reset');
    if(reset)reset.addEventListener('click',function(){
      resetAll();render();
    });
  }

  function render(){
    ensureStyles();
    var section=ensurePanel();
    if(!section)return;
    renderInputs();
    var res=compute();
    renderChain(res);
    renderKpis(res);
    renderTable(res);
    bindEvents();
  }

  // Публичный API для cjm-unit-dashboard.js -----------------------------------
  window.Finance100={
    id:'finance100',
    label:'Финмодель 100 млн ₽',
    render:render,
    ensurePanel:ensurePanel
  };

  // Автоинициализация панели (скрытая до активации таба).
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',function(){ensureStyles();ensurePanel();});
  else {ensureStyles();ensurePanel();}
})();
