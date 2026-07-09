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
  var MONTH_NAMES_RU=['янв','фев','мар','апр','май','июн','июл','авг','сен','окт','ноя','дек'];
  var DEC_2028_MIN_NET_PROFIT=50000000;
  var NET_PROFIT_EASING_EXPONENT=1.28;
  var DEFAULT_PROFIT_GROWTH_STEPS=12;
  var TEAM_ROLES=[
    'Разработчик',
    'SEO midle',
    'SEO junior',
    'Директолог',
    'Таргетолог',
    'Проджект менеджер',
    'Делопроизводитель',
    'Владелец проекта'
  ];

  // --- Дефолты. Отражают устойчивую конфигурацию высококонкурентного
  //     лидогенерационного бизнеса с фокусом на чистую прибыль. Период старта
  //     совпадает с вкладкой «Финмодель 2027»: июль 2026 → декабрь 2027.
  //     Далее модель строит реалистичную траекторию к 50 млн ₽ чистыми в
  //     декабре 2028 и к 100 млн ₽ чистыми на конце горизонта.
  var DEFAULTS={
    targetNetProfit: 100000000,
    minNetProfitDec2028: DEC_2028_MIN_NET_PROFIT,
    netMargin: 20,
    grossMargin: 65,
    marketingShare: 22,
    fotShare: 10,
    avgFot: 250000,
    devShare: 4,
    gaShare: 2,
    riskShare: 1,
    taxRate: 6,
    startRevenue: 250000,
    // Стартовые бюджеты инвестиционной фазы. Их можно вручную поднять до
    // 100 млн ₽/мес, чтобы раскладывать сценарий масштабирования крупнее,
    // чем базовая финмодель до декабря 2027.
    startMarketing: 1000000,
    startFot: 1000000,
    startDev: 1000000,
    horizonMonths: 41,
    cacInflation: 2,
    fotIndex: 7,
    // Начальный месяц горизонта. По умолчанию — июль 2026, как в финмодели 2027.
    startMonth: 7,
    startYear: 2026
  };

  // Метаданные полей: подпись, единица, min/max, пояснение связи с
  // остальной моделью. Пояснения даны без «подзаголовков» — коротким
  // одноаспектным предложением, в строгом деловом тоне.
  var FIELDS=[
    {key:'targetNetProfit', label:'Целевая чистая прибыль', suffix:'₽ в месяц', min:0, max:10000000000,
      hint:'Финальная цель модели: месячная чистая прибыль на конце горизонта.'},
    {key:'minNetProfitDec2028', label:'Минимум чистыми — декабрь 2028', suffix:'₽ в месяц', min:DEC_2028_MIN_NET_PROFIT, max:10000000000,
      hint:'Контрольная точка: в декабре 2028 модель держит не меньше этого уровня чистой прибыли.'},
    {key:'netMargin', label:'Расчётная чистая маржа', suffix:'%', min:1, max:60,
      hint:'Внутренний коэффициент для масштаба бизнеса на конце горизонта; в интерфейсе фокус остаётся на чистой прибыли.'},
    {key:'grossMargin', label:'Маржинальность после выплат', suffix:'%', min:10, max:95,
      hint:'Внутренний коэффициент после прямой себестоимости и партнёрских выплат.'},
    {key:'marketingShare', label:'Маркетинг и медиа', suffix:'% от выручки', min:0, max:60,
      hint:'Доля маркетинга от выручки на конце горизонта. Подтягивается из финмодели «до декабря 2027», если не переопределено. От стартового маркетинга до этой доли — экспоненциальный рост.'},
    {key:'fotShare', label:'ФОТ с налогами', suffix:'% от выручки', min:0, max:40,
      hint:'Целевая доля ФОТ на конце горизонта. До неё модель растит стартовый ФОТ.'},
    {key:'avgFot', label:'Средний ФОТ на сотрудника', suffix:'₽ в месяц, с налогами', min:30000, max:2000000,
      hint:'Штат текущего месяца = ФОТ месяца / средний ФОТ.'},
    {key:'devShare', label:'Разработка и продукт', suffix:'% от выручки', min:0, max:20,
      hint:'Инженерия, продукт, аналитика, данные.'},
    {key:'gaShare', label:'Административные расходы', suffix:'% от выручки', min:0, max:15,
      hint:'Офис, юридическое сопровождение, финансы, HR.'},
    {key:'riskShare', label:'Резерв на риски', suffix:'% от выручки', min:0, max:10,
      hint:'Буфер на регуляторные и рыночные колебания.'},
    {key:'taxRate', label:'Налог от выручки', suffix:'% от выручки', min:0, max:50,
      hint:'Начисляется каждый месяц от общей выручки, независимо от накопленного результата.'},
    {key:'startRevenue', label:'Стартовая выручка', suffix:'₽ в месяц', min:0, max:1000000000,
      hint:'База траектории роста. Требуемый темп выводится из соотношения цель / старт. При 0 используется значение по умолчанию.'},
    {key:'startMarketing', label:'Стартовый маркетинг', suffix:'₽ в месяц', min:0, max:100000000,
      hint:'Инвестиции в маркетинг с первого месяца, до появления выручки. Растут по экспоненте до маркетинга на конце горизонта (выручка × доля маркетинга).'},
    {key:'startFot', label:'Стартовый ФОТ', suffix:'₽ в месяц', min:0, max:100000000,
      hint:'Команда на старте инвестиционной фазы. Растёт до ФОТ на конце горизонта (выручка × доля ФОТ).'},
    {key:'startDev', label:'Стартовая разработка', suffix:'₽ в месяц', min:0, max:100000000,
      hint:'Бюджет разработки и продукта на старте. Растёт до бюджета на конце горизонта (выручка × доля разработки).'},
    {key:'startMonth', label:'Стартовый месяц', suffix:'1–12', min:1, max:12,
      hint:'Номер месяца начала горизонта (1 — январь, 12 — декабрь). По умолчанию 7 (июль).'},
    {key:'startYear', label:'Стартовый год', suffix:'год', min:2020, max:2100,
      hint:'Год начала горизонта. По умолчанию 2026 — старт с июля 2026 года и далее.'},
    {key:'horizonMonths', label:'Горизонт', suffix:'месяцев до цели', min:6, max:120,
      hint:'Задаёт конец горизонта: при старте в июле 2026 значение 41 соответствует декабрю 2029.'},
    {key:'cacInflation', label:'Инфляция стоимости привлечения', suffix:'% в месяц', min:0, max:10,
      hint:'Ориентир аукционного давления. Траектория маркетинга задаётся связкой «стартовый маркетинг → маркетинг на конце горизонта», поэтому параметр носит справочный характер.'},
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
  // Формат количества (штук): абсолютное значение с абревиатурой тыс/млн для крупных чисел.
  function qty(v){
    var a=Math.abs(Number(v)||0);
    if(a<10000)return fmt(v);
    if(a<1000000){var k=(Number(v)||0)/1000;return k.toLocaleString('ru-RU',{maximumFractionDigits:k>=100?0:1})+' тыс';}
    var m=(Number(v)||0)/1000000;
    return m.toLocaleString('ru-RU',{maximumFractionDigits:m>=100?0:m>=10?1:2})+' млн';
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
  // «% на маркетинг» из обычной финмодели («Финмодель до декабря 2027»).
  // Если основной модуль отдал корректное значение, оно используется вместо
  // дефолта — обе вкладки исходят из одних показателей. Ручной ввод в поле
  // «Маркетинг и медиа» по-прежнему переопределяет источник.
  function bridgeMarketingShare(){
    if(typeof window==='undefined')return null;
    var b=window.CjmSegmentsBridge;
    if(!b||typeof b.getMarketingSharePct!=='function')return null;
    var v;try{v=b.getMarketingSharePct();}catch(e){return null;}
    v=Number(v);
    if(!isFinite(v)||v<0)return null;
    // Уважает границы поля «Маркетинг и медиа» (0..60% от выручки).
    v=clamp(v,0,60);
    return Math.round(v*10)/10;
  }
  function inputs(){
    var raw=read();var out={};
    Object.keys(DEFAULTS).forEach(function(k){
      var v=raw[k];
      var fallback=DEFAULTS[k];
      if(k==='marketingShare'){
        var bridged=bridgeMarketingShare();
        if(bridged!=null)fallback=bridged;
      }
      out[k]=(v==null||v===''||!isFinite(Number(v)))?fallback:Number(v);
    });
    return out;
  }
  function isEdited(key){
    var raw=read();
    if(raw[key]==null||raw[key]==='')return false;
    // marketingShare берётся из обычной финмодели, поэтому любой ручной ввод —
    // это переопределение источника, а не сравнение со статичным дефолтом.
    if(key==='marketingShare')return true;
    return Number(raw[key])!==DEFAULTS[key];
  }
  function setInput(key,val){
    var raw=read();raw[key]=val;write(raw);
  }
  function unsetInput(key){
    var raw=read();delete raw[key];write(raw);
  }
  function resetAll(){write({});}
  function teamInputKey(i,field){return 'team_'+i+'_'+field;}
  function teamRows(){
    var raw=read();
    var rows=TEAM_ROLES.map(function(role,i){
      var salary=Math.max(0,Number(raw[teamInputKey(i,'salary')])||0);
      var count=Math.max(0,Math.round(Number(raw[teamInputKey(i,'count')])||0));
      return {i:i,role:role,salary:salary,count:count,fot:salary*count};
    });
    var totalCount=0,totalFot=0;
    rows.forEach(function(r){totalCount+=r.count;totalFot+=r.fot;});
    return {rows:rows,totalCount:totalCount,totalFot:totalFot};
  }
  function setTeamValue(i,field,val){
    var raw=read();
    var n=Number(val);
    if(!isFinite(n)||n<0)n=0;
    if(field==='count')n=Math.round(n);
    raw[teamInputKey(i,field)]=n;
    write(raw);
    return n;
  }

  // --- Воронка объёмов из показателей сегментов ------------------------------
  // Финмодель top-down даёт требуемую выручку. Из неё, используя посегментные
  // конверсии (Визит→Контакт→Клик→Заявка→Выдача) и выплату за выдачу из вкладок
  // сегментов CJM, выводим необходимые объёмы: выдачи, заявки, клики, контакты, трафик.
  // Связь: выручка = Σ выдачи_i × выплата_i; выдачи распределяются по долям сегментов.
  //   выдачи_i     = выдачи_всего × доля_i
  //   заявки_i     = выдачи_i / crAi_i             (Заявка → Выдача)
  //   клики_i      = заявки_i / crCa_i             (Клик → Заявка)
  //   контакты_i   = клики_i / crCc_i              (Контакт → Клик)
  //   трафик_i     = контакты_i / crVc_i           (Визит → Контакт)
  // Так как конверсии постоянны во времени, объёмы линейно масштабируются с выручкой,
  // поэтому считаем множители «на 1 ₽ выручки» и применяем их к каждому месяцу.
  function segmentFunnel(){
    if(typeof window==='undefined')return null;
    var bridge=window.CjmSegmentsBridge;
    if(!bridge||typeof bridge.getFunnel!=='function')return null;
    var data;
    try{data=bridge.getFunnel();}catch(e){return null;}
    if(!data||!data.segments||!data.segments.length)return null;
    var segs=data.segments;
    var blendedPayout=0; // Σ доля_i × выплата_i — средняя выручка на одну выдачу
    // Множители «на одну выдачу»: сколько заявок/кликов/контактов/визитов приходится
    // на одну выдачу с учётом распределения выдач по долям сегментов.
    var appsPerAppr=0,clicksPerAppr=0,contPerAppr=0,visPerAppr=0;
    var usableShare=0;
    for(var i=0;i<segs.length;i++){
      var s=segs[i];
      var share=Number(s.share)||0;
      if(share<=0)continue;
      blendedPayout+=share*s.payout;
      // Пропускаем сегмент в объёмной воронке, если какая-то конверсия равна 0
      // (бесконечный объём) — чтобы не ломать расчёт делением на ноль.
      if(s.crAi>0&&s.crCa>0&&s.crCc>0&&s.crVc>0){
        var apps=share/s.crAi;
        var clicks=apps/s.crCa;
        var cont=clicks/s.crCc;
        var vis=cont/s.crVc;
        appsPerAppr+=apps;
        clicksPerAppr+=clicks;
        contPerAppr+=cont;
        visPerAppr+=vis;
        usableShare+=share;
      }
    }
    if(!isFinite(blendedPayout)||blendedPayout<=0||usableShare<=0)return null;
    // Выдач на 1 ₽ выручки = 1 / средняя выплата за выдачу.
    var apprPerRuble=1/blendedPayout;
    return {
      segments:segs,
      blendedPayout:blendedPayout,
      apprPerRuble:apprPerRuble,
      appsPerRuble:apprPerRuble*appsPerAppr,
      clicksPerRuble:apprPerRuble*clicksPerAppr,
      contactsPerRuble:apprPerRuble*contPerAppr,
      trafficPerRuble:apprPerRuble*visPerAppr,
      avgCrVc:(visPerAppr>0&&contPerAppr>0)?contPerAppr/visPerAppr:0,
      avgCrCc:(contPerAppr>0&&clicksPerAppr>0)?clicksPerAppr/contPerAppr:0,
      avgCrCa:(clicksPerAppr>0&&appsPerAppr>0)?appsPerAppr/clicksPerAppr:0,
      avgCrAi:appsPerAppr>0?usableShare/appsPerAppr:0
    };
  }

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
  //   налог_end     = выручка_end × ставка_налога/100 (от выручки)
  //   NP_end        = валовая − OPEX − налог
  // Помесячная траектория: экспоненциальный рост выручки от startRevenue до
  // выручка_end за horizonMonths, темп g = (выручка_end/старт)^(1/H) − 1.
  // Стартовая выручка 0 вырождает экспоненту, поэтому трактуется как «не задано»
  // и заменяется значением по умолчанию.
  // Маркетинг, ФОТ и разработка идут от явно заданных стартовых бюджетов до
  // целевых долей от выручки на конце горизонта. ФОТ-индексация применяется
  // к средней стоимости сотрудника при расчёте штата.
  // Такая структура делает видимой закономерность: цель по прибыли жёстко
  // детерминирует выручку и штат, а темп роста и время выхода на масштаб —
  // расстояние от старта.
  // Метка «мес год» для строки таблицы. При некорректном стартовом месяце
  // или годе — возвращаем короткий индекс, чтобы не ломать разметку.
  function monthLabel(inp,t){
    var m0=Math.round(Number(inp.startMonth));
    var y0=Math.round(Number(inp.startYear));
    if(!(m0>=1&&m0<=12)||!(y0>=1900&&y0<=9999))return 'м. '+t;
    var idx=(m0-1)+t;
    var year=y0+Math.floor(idx/12);
    var month=((idx%12)+12)%12;
    return MONTH_NAMES_RU[month]+' '+year;
  }
  function monthKey(inp,t){
    var m0=Math.round(Number(inp.startMonth));
    var y0=Math.round(Number(inp.startYear));
    if(!(m0>=1&&m0<=12)||!(y0>=1900&&y0<=9999))return '';
    var idx=(m0-1)+t;
    var year=y0+Math.floor(idx/12);
    // t в модели всегда неотрицательный, но формула безопасно нормализует месяц
    // и для отрицательного idx при ручных экспериментах со стартовой датой.
    var month=((idx%12)+12)%12+1;
    return year+'-'+String(month).padStart(2,'0');
  }
  function monthIndexForKey(inp,key,H){
    for(var t=0;t<=H;t++){if(monthKey(inp,t)===key)return t;}
    return -1;
  }

  function budgetCurve(start,end,t,H){
    start=Math.max(0,Number(start)||0);
    end=Math.max(0,Number(end)||0);
    if(end<=0)return 0;
    if(start<=0)return end*Math.pow(t/Math.max(1,H),2);
    return start*Math.pow(end/start,t/Math.max(1,H));
  }

  function bridgeFinancePlan(){
    if(typeof window==='undefined')return null;
    var bridge=window.CjmSegmentsBridge;
    if(!bridge||typeof bridge.getFinancePlan!=='function')return null;
    try{return bridge.getFinancePlan();}catch(e){return null;}
  }

  function bridgeProfitMap(plan){
    var out={};
    if(!plan||!Array.isArray(plan.months))return out;
    plan.months.forEach(function(m){
      if(m&&m.key&&isFinite(Number(m.netProfit)))out[m.key]=Number(m.netProfit);
    });
    return out;
  }

  function easedValue(from,to,fromT,toT,t){
    if(toT<=fromT)return to;
    var p=(t-fromT)/(toT-fromT);
    p=Math.max(0,Math.min(1,p));
    // Back-loaded рост: NET_PROFIT_EASING_EXPONENT оставляет кривую близкой к линейной,
    // но сдвигает примерно 10–15% прироста из первых месяцев в последние,
    // что правдоподобно для накопительного SEO/бренд-эффекта без резкого скачка.
    p=Math.pow(p,NET_PROFIT_EASING_EXPONENT);
    return from+(to-from)*p;
  }

  function compute(){
    var inp=inputs();
    var revEnd = inp.targetNetProfit/(inp.netMargin/100);
    var marketingEnd = revEnd*inp.marketingShare/100;
    var fotEnd = revEnd*inp.fotShare/100;
    var devEnd = revEnd*inp.devShare/100;

    var H=Math.max(1,Math.round(inp.horizonMonths));
    var monthKeys=[];
    for(var kt=0;kt<=H;kt++)monthKeys.push(monthKey(inp,kt));
    var start=inp.startRevenue>0?inp.startRevenue:DEFAULTS.startRevenue;
    var startMkt=inp.startMarketing>0?inp.startMarketing:DEFAULTS.startMarketing;
    var startFot=inp.startFot>0?inp.startFot:DEFAULTS.startFot;
    var startDev=inp.startDev>0?inp.startDev:DEFAULTS.startDev;
    var mktG=(marketingEnd>0&&startMkt>0)?Math.pow(marketingEnd/startMkt,1/H)-1:0;
    // Доля внутреннего масштаба, из которой после переменных G&A/резерва/налога
    // покрываются маркетинг, ФОТ, разработка и целевая чистая прибыль.
    var marginFactor=(inp.grossMargin-inp.gaShare-inp.riskShare-inp.taxRate)/100;
    marginFactor=Math.max(0.01,marginFactor);

    var bridgePlan=bridgeFinancePlan();
    var bridgeMap=bridgeProfitMap(bridgePlan);
    var dec2027Idx=monthIndexForKey(inp,'2027-12',H);
    var dec2028Idx=monthIndexForKey(inp,'2028-12',H);
    var dec2028Target=Math.max(Number(inp.minNetProfitDec2028)||0,DEC_2028_MIN_NET_PROFIT);
    var lastBridgeIdx=-1,lastBridgeProfit=null;
    for(var bt=0;bt<=H;bt++){
      var bk=monthKeys[bt];
      if(bridgeMap[bk]!=null){lastBridgeIdx=bt;lastBridgeProfit=bridgeMap[bk];}
    }
    var startNetApprox=start*marginFactor-startMkt-startFot-startDev;
    var anchorIdx=lastBridgeIdx>=0?lastBridgeIdx:0;
    var anchorProfit=lastBridgeProfit!=null?lastBridgeProfit:startNetApprox;
    function targetNetForMonth(t){
      var key=monthKeys[t];
      if(Object.prototype.hasOwnProperty.call(bridgeMap,key))return bridgeMap[key];
      if(t<=anchorIdx)return anchorProfit;
      if(dec2028Idx>=0&&t<=dec2028Idx){
        return easedValue(anchorProfit,Math.max(dec2028Target,anchorProfit),anchorIdx,dec2028Idx,t);
      }
      var hasDec2028Anchor=dec2028Idx>=0&&dec2028Idx>anchorIdx;
      var fromIdx=anchorIdx;
      var fromVal=anchorProfit;
      if(hasDec2028Anchor){
        fromIdx=dec2028Idx;
        fromVal=Math.max(dec2028Target,anchorProfit);
      }
      return easedValue(fromVal,inp.targetNetProfit,fromIdx,H,t);
    }

    // Объёмная воронка из показателей сегментов (может отсутствовать, если модуль
    // сегментов не загружен — тогда funnel===null и объёмы просто не показываются).
    var funnel=segmentFunnel();

    var rows=[];
    var cumProfit=0, minCum=0, breakEvenIdx=-1, targetIdx=-1;
    for(var t=0;t<=H;t++){
      var marketing = startMkt*Math.pow(1+mktG,t);
      var fot = budgetCurve(startFot,fotEnd,t,H);
      var avgFotAtT=Math.max(1,inp.avgFot*Math.pow(1+inp.fotIndex/100,(t-H)/12));
      var hc  = Math.max(0,Math.round(fot/avgFotAtT));
      var dev = budgetCurve(startDev,devEnd,t,H);
      var targetNp=targetNetForMonth(t);
      var rev = t===0?start:Math.max(0,(targetNp+marketing+fot+dev)/marginFactor);
      var gross = rev*inp.grossMargin/100;
      var ga  = rev*inp.gaShare/100;
      var risk= rev*inp.riskShare/100;
      var opex= marketing+fot+dev+ga+risk;
      var revenueTax=rev*inp.taxRate/100;
      var np  = gross-opex-revenueTax;
      cumProfit += np;
      if(cumProfit<minCum)minCum=cumProfit;
      if(breakEvenIdx<0&&cumProfit>=0&&t>0)breakEvenIdx=t;
      if(targetIdx<0&&np>=inp.targetNetProfit)targetIdx=t;
      var row={t:t,label:monthLabel(inp,t),key:monthKeys[t],rev:rev,gross:gross,marketing:marketing,fot:fot,dev:dev,ga:ga,risk:risk,opex:opex,tax:revenueTax,np:np,cum:cumProfit,headcount:hc,bridgeProfit:bridgeMap[monthKeys[t]]!=null};
      if(funnel){
        // Объёмы воронки, выведенные из выручки месяца через конверсии сегментов.
        row.approvals=rev*funnel.apprPerRuble;
        row.applications=rev*funnel.appsPerRuble;
        row.clicks=rev*funnel.clicksPerRuble;
        row.contacts=rev*funnel.contactsPerRuble;
        row.traffic=rev*funnel.trafficPerRuble;
      }
      rows.push(row);
    }

    var endRow=rows[rows.length-1]||{rev:0,gross:0,marketing:0,fot:0,dev:0,ga:0,risk:0,opex:0,tax:0,np:0,headcount:0};
    revEnd=endRow.rev;
    var grossEnd=endRow.gross;
    var headcount=endRow.headcount;
    var gaEnd=endRow.ga;
    var riskEnd=endRow.risk;
    var opexEnd=endRow.opex;
    var revenueTaxEnd=endRow.tax;
    var npEnd=endRow.np;
    var dec2027Profit=dec2027Idx>=0&&rows[dec2027Idx]?rows[dec2027Idx].np:null;
    var dec2028Profit=dec2028Idx>=0&&rows[dec2028Idx]?rows[dec2028Idx].np:null;
    var growthBase=(dec2027Profit!=null&&dec2027Profit>0)?dec2027Profit:Math.max(1,anchorProfit);
    // Если пользователь убрал одну из контрольных дат за горизонт, считаем темп
    // на стандартном годовом окне планирования.
    var growthSteps=(dec2028Idx>=0&&dec2027Idx>=0&&dec2028Idx>dec2027Idx)?(dec2028Idx-dec2027Idx):DEFAULT_PROFIT_GROWTH_STEPS;
    var g = growthBase>0?Math.pow(Math.max(dec2028Target,growthBase)/growthBase,1/Math.max(1,growthSteps))-1:0;

    var funnelEnd=funnel?{
      approvals:endRow.rev*funnel.apprPerRuble,
      applications:endRow.rev*funnel.appsPerRuble,
      clicks:endRow.rev*funnel.clicksPerRuble,
      contacts:endRow.rev*funnel.contactsPerRuble,
      traffic:endRow.rev*funnel.trafficPerRuble,
      blendedPayout:funnel.blendedPayout,
      avgCrVc:funnel.avgCrVc,
      avgCrCc:funnel.avgCrCc,
      avgCrCa:funnel.avgCrCa,
      avgCrAi:funnel.avgCrAi
    }:null;

    return {
      inp:inp,
      revEnd:revEnd, grossEnd:grossEnd, marketingEnd:marketingEnd, fotEnd:fotEnd,
      headcount:headcount, devEnd:devEnd, gaEnd:gaEnd, riskEnd:riskEnd,
      opexEnd:opexEnd, taxEnd:revenueTaxEnd, npEnd:npEnd,
      startEff:start, startMktEff:startMkt, startFotEff:startFot, startDevEff:startDev,
      monthlyGrowth:g, horizon:H, rows:rows, funnel:funnelEnd,
      breakEvenIdx:breakEvenIdx, targetIdx:targetIdx, peakInvest:-minCum,
      dec2027Idx:dec2027Idx, dec2028Idx:dec2028Idx, dec2027Profit:dec2027Profit,
      dec2028Profit:dec2028Profit, dec2028Target:dec2028Target, bridgeUsed:lastBridgeIdx>=0
    };
  }


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
      '<p class="fin100-lead">Модель сфокусирована на чистой прибыли: декабрь 2027 берётся из вкладки «Финмодель 2027», '+
        'декабрь 2028 закреплён на уровне не ниже '+esc(millions(DEFAULTS.minNetProfitDec2028))+' чистыми в месяц, '+
        'финальная цель — '+esc(millions(DEFAULTS.targetNetProfit))+' чистыми. '+
        'Внутренние расчёты автоматически подбирают масштаб, расходы, штат и объёмы воронки.</p>'+
      '<div class="fin100-chain" id="fin100Chain"></div>'+
      '<div class="card"><div class="card-title"><div><h2>Параметры модели</h2></div></div>'+
        '<p class="fin100-note">Параметры разбиты на три группы по функциональному назначению. Каждое поле снабжено пояснением, как оно влияет на итог.</p>'+
        '<div class="fin100-inputs" id="fin100Inputs"></div>'+
      '</div>'+
      '<div class="card"><div class="card-title"><div><h2>Ключевые показатели по чистой прибыли</h2></div></div>'+
        '<div class="fin100-kpis" id="fin100Kpis"></div>'+
      '</div>'+
      '<div class="card"><div class="card-title"><div><h2>Помесячный план</h2></div></div>'+
        '<p class="fin100-note" id="fin100TableNote"></p>'+
        '<div class="fin100-table-wrap"><table class="fin100-table" id="fin100Table"></table></div>'+
      '</div>'+
      '<div class="card"><div class="card-title"><div><h2>Команда</h2></div></div>'+
        '<p class="fin100-note">Задайте зарплату и количество сотрудников по каждой должности вручную. Итоги показывают общую численность команды и общий ФОТ в месяц.</p>'+
        '<div class="fin100-table-wrap fin100-team-wrap"><table class="fin100-table fin100-team-table" id="fin100TeamTable"></table></div>'+
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
      '.fin100-table-wrap{max-height:75vh;overflow:auto;border:1px solid var(--line);border-radius:var(--radius-xs);position:relative}'+
      '.fin100-table{width:100%;border-collapse:separate;border-spacing:0;font-size:12.5px;min-width:1000px;font-variant-numeric:tabular-nums}'+
      '.fin100-table th,.fin100-table td{padding:8px 11px;text-align:right;border-bottom:1px solid var(--line);white-space:nowrap}'+
      '.fin100-table thead th{position:sticky;top:0;background:var(--surface-3);font-size:10.5px;text-transform:uppercase;letter-spacing:.04em;color:var(--muted);font-weight:800;z-index:2;box-shadow:inset 0 -1px 0 var(--line)}'+
      '.fin100-table td:first-child,.fin100-table th:first-child{'+
        'text-align:left;'+
        'font-weight:600;'+
        'position:sticky;'+
        'left:0;'+
        'background:var(--fin-sticky-row-bg,var(--surface));'+
        'z-index:1;'+
        'box-shadow:1px 0 0 var(--line)'+
      '}'+
      '.fin100-table thead th:first-child{z-index:3;background:var(--surface-3)}'+
      '.fin100-table tbody tr{--fin-sticky-row-bg:var(--surface)}'+
      '.fin100-table tbody tr:nth-child(even){background:var(--surface-2);--fin-sticky-row-bg:var(--surface-2)}'+
      '.fin100-table tbody tr.is-target{--fin-sticky-row-bg:color-mix(in srgb,var(--green) 12%,var(--surface));background:var(--fin-sticky-row-bg)}'+
      '.fin100-table tbody tr.is-target td{color:var(--green);font-weight:700}'+
      '.fin100-table tbody tr.is-milestone{--fin-sticky-row-bg:color-mix(in srgb,var(--blue) 10%,var(--surface));background:var(--fin-sticky-row-bg)}'+
      '.fin100-table tbody tr.is-milestone td{color:var(--blue);font-weight:700}'+
      '.fin100-table tbody tr.is-breakeven{--fin-sticky-row-bg:color-mix(in srgb,var(--blue) 8%,var(--surface));background:var(--fin-sticky-row-bg)}'+
      '.fin100-table td.neg{color:var(--red)}'+
      '.fin100-team-wrap{max-height:none}'+
      '.fin100-team-table{min-width:640px}'+
      '.fin100-team-table input{width:150px;max-width:100%;border:1px solid var(--line-strong);border-radius:8px;padding:8px 10px;background:var(--surface-2);font:inherit;font-size:12.5px;font-weight:600;color:var(--text);text-align:right;font-variant-numeric:tabular-nums;box-sizing:border-box}'+
      '.fin100-team-table input:focus{outline:2px solid var(--blue);outline-offset:1px}'+
      '.fin100-team-table tfoot td{position:sticky;bottom:0;background:var(--surface-3);font-weight:800;color:var(--text);border-top:1px solid var(--line-strong)}'+
      '';
    var style=document.createElement('style');style.id='fin100-styles';style.textContent=css;
    document.head.appendChild(style);
  }

  // --- Рендер ---------------------------------------------------------------
  function renderChain(res){
    var host=$('fin100Chain');if(!host)return;
    var items=[
      {tone:'target',formula:'Из финмодели 2027',value:res.dec2027Profit!=null?millions(res.dec2027Profit):'—',cap:'Чистая прибыль · декабрь 2027'},
      {tone:'target',formula:'Контрольная точка',value:res.dec2028Profit!=null?millions(res.dec2028Profit):'—',cap:'Чистая прибыль · декабрь 2028, минимум '+millions(res.dec2028Target)},
      {tone:'target',formula:'Финальная цель',value:millions(res.npEnd),cap:'Чистая прибыль на конце горизонта'},
      {tone:'derived',formula:'Расходы + команда',value:millions(res.opexEnd),cap:'OPEX в месяц на конце горизонта'},
      {tone:'derived',formula:'ФОТ / средний ФОТ',value:fmt(res.headcount)+' чел',cap:'Численность штата'}
    ];
    if(res.funnel){
      items.push(
        {tone:'derived',formula:'Внутренний масштаб / выплата',value:qty(res.funnel.approvals)+' выдач',cap:'Выдачи в месяц — из показателей сегментов'},
        {tone:'derived',formula:'Выдачи / средние CR сегментов',value:qty(res.funnel.traffic)+' виз.',cap:'Требуемый трафик в месяц'}
      );
    }
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
    var hit2028 = res.dec2028Profit!=null&&res.dec2028Profit>=res.dec2028Target;
    var kpis=[
      {tone:res.bridgeUsed?'green':'orange',label:'Чистая прибыль · декабрь 2027',value:res.dec2027Profit!=null?millions(res.dec2027Profit):'—',sub:res.bridgeUsed?'Совпадает с вкладкой «Финмодель 2027»':'Нет данных моста — используется расчётная траектория'},
      {tone:hit2028?'green':'red',label:'Чистая прибыль · декабрь 2028',value:res.dec2028Profit!=null?millions(res.dec2028Profit):'—',sub:'Минимум '+millions(res.dec2028Target)+' в месяц'},
      {tone:hitTarget?'green':'red',label:'Чистая прибыль на конце',value:millions(res.npEnd),sub:'Финальная цель '+millions(res.inp.targetNetProfit)+' в месяц'},
      {tone:'blue',label:'Фактическая чистая маржа',value:pct(actualMargin,1),sub:'Справочно: чистая прибыль / внутренний масштаб бизнеса'},
      {tone:'orange',label:'OPEX в месяц',value:millions(res.opexEnd),sub:'Маркетинг + ФОТ + разработка + G&A + резерв'},
      {tone:'violet',label:'Штат',value:fmt(res.headcount)+' чел',sub:'ФОТ / средний ФОТ на сотрудника'},
      {tone:'orange',label:'Маркетинг в месяц',value:millions(res.marketingEnd),sub:'На высококонкурентном рынке'},
      {tone:'orange',label:'ФОТ с налогами',value:millions(res.fotEnd),sub:'При штате и среднем ФОТ'},
      {tone:'blue',label:'Темп роста чистой прибыли',value:pct(res.monthlyGrowth*100,1)+' в месяц',sub:'Между декабрём 2027 и контрольной точкой 2028'},
      {tone:res.peakInvest>0?'red':'green',label:'Пиковый кассовый разрыв',value:millions(res.peakInvest),sub:'Максимум накопленного убытка на инвестиционной фазе'},
      {tone:'green',label:'Месяц выхода в накопленный плюс',value:res.breakEvenIdx>=0?monthLabel(res.inp,res.breakEvenIdx):'за горизонтом',sub:'Кумулятивная прибыль ≥ 0'},
      {tone:hitTarget?'green':'red',label:'Месяц достижения цели',value:res.targetIdx>=0?monthLabel(res.inp,res.targetIdx):'за горизонтом',sub:'Месячная NP ≥ '+millions(res.inp.targetNetProfit)}
    ];
    if(res.funnel){
      // Объёмы воронки на конце горизонта, выведенные из требуемой выручки через
      // средние конверсии сегментов (Визит→Контакт→Клик→Заявка→Выдача).
      kpis.push(
        {tone:'violet',label:'Трафик в месяц',value:qty(res.funnel.traffic),sub:'Визиты на маркетплейс — из выручки через конверсии сегментов'},
        {tone:'blue',label:'CR · Трафик → Контакт',value:pct(res.funnel.avgCrVc*100,1),sub:'Средняя конверсия по сегментам'},
        {tone:'violet',label:'Контакты в месяц',value:qty(res.funnel.contacts),sub:'Оставленные телефоны · Визит → Контакт'},
        {tone:'blue',label:'CR · Контакт → Клик',value:pct(res.funnel.avgCrCc*100,1),sub:'Средняя конверсия по сегментам'},
        {tone:'violet',label:'Клики по офферам',value:qty(res.funnel.clicks),sub:'Переходы из контакта на релевантные офферы'},
        {tone:'blue',label:'CR · Клик → Заявка',value:pct(res.funnel.avgCrCa*100,1),sub:'Средняя конверсия по сегментам'},
        {tone:'violet',label:'Заявки в месяц',value:qty(res.funnel.applications),sub:'Оформленные заявки · Клик → Заявка'},
        {tone:'blue',label:'CR · Заявка → Выдача',value:pct(res.funnel.avgCrAi*100,1),sub:'Средняя конверсия по сегментам'},
        {tone:'green',label:'Выдачи в месяц',value:qty(res.funnel.approvals),sub:'Выручка / средняя выплата за выдачу '+rub(res.funnel.blendedPayout)}
      );
    }
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
      note.textContent='Траектория чистой прибыли построена от периода '+monthLabel(res.inp,0)+' до '+monthLabel(res.inp,res.horizon)+'. '+
        (res.bridgeUsed?'Месяцы до декабря 2027 берутся из вкладки «Финмодель 2027», поэтому декабрь 2027 совпадает с базовой моделью. ':'')+
        'Декабрь 2028 закреплён на уровне '+millions(res.dec2028Target)+' чистыми в месяц, финальная цель — '+millions(res.inp.targetNetProfit)+'. '+
        'Стартовые бюджеты: маркетинг '+millions(res.startMktEff)+', ФОТ '+millions(res.startFotEff)+', разработка '+millions(res.startDevEff)+' в месяц; дальше они растут к целевым долям масштаба на конце горизонта. '+
        'Штат считается от бюджета ФОТ месяца и среднего ФОТ с индексацией окладов ('+pct(res.inp.fotIndex,0)+' в год). '+
        'Общая выручка выводится в таблике, а налог каждый месяц считается от этой суммы: чистая прибыль = выручка × маржинальность после выплат − OPEX − налог от выручки. ' +
        (res.funnel?' Объёмы воронки (трафик, контакты, клики по офферам, заявки, выдачи) выведены из общей выручки через средние конверсии сегментов.':'');
    }
    var hasFunnel=!!res.funnel;
    var head='<thead><tr>'+
      '<th>Месяц</th>'+
      (hasFunnel?'<th>Трафик</th><th>Контакты</th><th>Клики</th><th>Заявки</th><th>Выдачи</th>':'')+
      '<th>Выручка</th>'+
      '<th>Маркетинг</th>'+
      '<th>ФОТ</th>'+
      '<th>Штат</th>'+
      '<th>Разработка</th>'+
      '<th>G&amp;A</th>'+
      '<th>Резерв</th>'+
      '<th>OPEX</th>'+
      '<th>Налог от выручки</th>'+
      '<th>Чистая прибыль</th>'+
      '<th>Накоплено</th>'+
    '</tr></thead>';
    function td(v){var neg=v<0?' class="neg"':'';return '<td'+neg+'>'+esc(millions(v))+'</td>';}
    function tdq(v){return '<td>'+esc(qty(v))+'</td>';}
    var body='<tbody>'+res.rows.map(function(r){
      var cls=[];
      if(res.targetIdx===r.t)cls.push('is-target');
      else if(res.dec2028Idx===r.t)cls.push('is-milestone');
      else if(res.breakEvenIdx===r.t)cls.push('is-breakeven');
      return '<tr'+(cls.length?' class="'+cls.join(' ')+'"':'')+'>'+
        '<td>'+esc(r.label)+'</td>'+
        (hasFunnel?tdq(r.traffic)+tdq(r.contacts)+tdq(r.clicks)+tdq(r.applications)+tdq(r.approvals):'')+
        td(r.rev)+td(r.marketing)+td(r.fot)+'<td>'+esc(fmt(r.headcount))+'</td>'+td(r.dev)+td(r.ga)+td(r.risk)+td(r.opex)+td(r.tax)+td(r.np)+td(r.cum)+
      '</tr>';
    }).join('')+'</tbody>';
    host.innerHTML=head+body;
  }

  function renderTeam(){
    var host=$('fin100TeamTable');if(!host)return;
    var data=teamRows();
    var head='<thead><tr>'+
      '<th>Должность</th>'+
      '<th>Зарплата</th>'+
      '<th>Кол-во сотрудников</th>'+
      '<th>ФОТ по должности</th>'+
    '</tr></thead>';
    var body='<tbody>'+data.rows.map(function(r){
      return '<tr>'+
        '<td>'+esc(r.role)+'</td>'+
        '<td><input type="number" min="0" step="1000" data-fin100-team="'+r.i+'" data-fin100-team-field="salary" value="'+esc(r.salary)+'" aria-label="Зарплата: '+esc(r.role)+'"></td>'+
        '<td><input type="number" min="0" step="1" data-fin100-team="'+r.i+'" data-fin100-team-field="count" value="'+esc(r.count)+'" aria-label="Количество сотрудников: '+esc(r.role)+'"></td>'+
        '<td data-fin100-team-total="'+r.i+'">'+esc(millions(r.fot))+'</td>'+
      '</tr>';
    }).join('')+'</tbody>';
    var foot='<tfoot><tr>'+
      '<td>Итого</td>'+
      '<td></td>'+
      '<td id="fin100TeamTotalCount">'+esc(fmt(data.totalCount))+'</td>'+
      '<td id="fin100TeamTotalFot">'+esc(millions(data.totalFot))+'</td>'+
    '</tr></tfoot>';
    host.innerHTML=head+body+foot;
  }

  function refreshTeamTotals(){
    var data=teamRows();
    data.rows.forEach(function(r){
      var cell=document.querySelector('[data-fin100-team-total="'+r.i+'"]');
      if(cell)cell.textContent=millions(r.fot);
    });
    var totalCount=$('fin100TeamTotalCount');
    var totalFot=$('fin100TeamTotalFot');
    if(totalCount)totalCount.textContent=fmt(data.totalCount);
    if(totalFot)totalFot.textContent=millions(data.totalFot);
  }

  function bindEvents(){
    var section=$('cjm-tab-finance100');
    if(!section||section._fin100Wired)return;
    section._fin100Wired=true;
    section.addEventListener('input',function(ev){
      var el=ev.target;
      var key=el&&el.getAttribute&&el.getAttribute('data-fin100');
      if(key){
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
        return;
      }
      var teamIdx=el&&el.getAttribute&&el.getAttribute('data-fin100-team');
      if(teamIdx!=null){
        var field=el.getAttribute('data-fin100-team-field');
        if(field==='salary'||field==='count'){
          var normalized=setTeamValue(teamIdx,field,el.value);
          if(field==='count'&&String(normalized)!==el.value)el.value=normalized;
          refreshTeamTotals();
        }
      }
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
    renderTeam();
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
