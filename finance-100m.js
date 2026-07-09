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
  var NET_PROFIT_EASING_EXPONENT=1.28;
  var SOLVER_ITERATIONS=40;
  var SEASONALITY_KEY_PREFIX='seasonality_';
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

  // --- Дефолты. Единственные «якоря» модели — стартовая выручка (t=0) и
  //     целевая чистая прибыль на целевую дату {targetMonth, targetYear}.
  //     Все промежуточные точки — производные от формул (solver подбирает
  //     конечную выручку так, чтобы прибыль на целевой дате сошлась ровно
  //     в targetNetProfit). Никаких зашитых значений на конкретные месяцы.
  var DEFAULTS={
    targetNetProfit: 100000000,
    grossMargin: 65,
    marketingShare: 22,
    avgFot: 250000,
    startHeadcount: 3,
    targetHeadcount: 26,
    // Эластичность влияния стартового штата на темп роста выручки:
    // скорость роста = (стартовый штат / базовый штат)^hcGrowthElasticity.
    hcGrowthElasticity: 0.35,
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
    startYear: 2026,
    // Целевая дата достижения targetNetProfit. По умолчанию — конец горизонта
    // (декабрь 2029 при старте с июля 2026 и горизонте 41 мес.).
    targetMonth: 12,
    targetYear: 2029,
    // Эластичность маркетингового бюджета в нелинейной модели прибыли.
    alpha: 0.7,
    // Стартовый кассовый резерв для расчёта Burn Rate / Runway.
    startCashReserve: 10000000,
    // Доля бесплатного SEO-трафика в общем миксе: растёт от старта к концу
    // горизонта и снижает эффективный CAC во времени.
    seoShareStart: 5,
    seoShareEnd: 35,
    // --- Форма кривой роста выручки (логистическая S-кривая) -----------------
    // Рост не бесконечно-экспоненциальный: выручка разгоняется, а по мере
    // приближения к «мягкому потолку» месячный темп плавно снижается (без
    // резкого скачка). Конечную точку (revEnd) по-прежнему подбирает solver
    // под целевую чистую прибыль — потолок задаёт лишь ФОРМУ траектории.
    // «Мягкий потолок» ₽/мес: уровень месячной выручки, около которого рост
    // начинает плавно замедляться (обычно 50–100 млн ₽/мес).
    growthCeiling: 60000000,
    // Крутизна S-кривой: чем больше, тем выраженнее замедление у потолка.
    growthSaturation: 3,
    // Усиление роста в первый год, %: мягкий лифт выручки первых 12 месяцев
    // (пик на 12-м месяце), затухает к 24-му месяцу и не смещает конечную точку.
    firstYearGrowthBoost: 10
  };

  // Метаданные полей: подпись, единица, min/max, пояснение связи с
  // остальной моделью. Пояснения даны без «подзаголовков» — коротким
  // одноаспектным предложением, в строгом деловом тоне.
  var FIELDS=[
    {key:'targetNetProfit', label:'Целевая чистая прибыль', suffix:'₽ в месяц', min:0, max:10000000000,
      hint:'Главный якорь модели: месячная чистая прибыль на целевую дату. Solver подбирает выручку так, чтобы прибыль сошлась ровно в цель.'},
    {key:'targetMonth', label:'Месяц достижения цели', suffix:'1–12', min:1, max:12,
      hint:'Месяц целевой даты. При изменении вся кривая роста между стартом и целью перестраивается.'},
    {key:'targetYear', label:'Год достижения цели', suffix:'год', min:2020, max:2100,
      hint:'Год целевой даты. Вместе с месяцем задаёт targetIdx — точку, в которой прибыль равна цели.'},
    {key:'grossMargin', label:'Маржинальность после выплат', suffix:'%', min:10, max:95,
      hint:'Внутренний коэффициент после прямой себестоимости и партнёрских выплат.'},
    {key:'marketingShare', label:'Маркетинг и медиа', suffix:'% от выручки', min:0, max:60,
      hint:'Доля маркетинга от выручки на целевой дате. Подтягивается из финмодели «до декабря 2027», если не переопределено. От стартового маркетинга до этой доли — экспоненциальный рост.'},
    {key:'avgFot', label:'Средний ФОТ на сотрудника', suffix:'₽ в месяц, с налогами', min:30000, max:2000000,
      hint:'ФОТ месяца = штат месяца × средний ФОТ с индексацией окладов.'},
    {key:'startHeadcount', label:'Стартовый штат', suffix:'чел', min:1, max:1000,
      hint:'Численность команды на старте (t=0). Чем больше сотрудников на старте, тем быстрее растёт выручка (см. коэффициент влияния штата).'},
    {key:'hcGrowthElasticity', label:'Коэффициент влияния штата на рост', suffix:'0–1', min:0, max:1,
      hint:'Эластичность роста от стартового штата: скорость роста = (стартовый штат / '+DEFAULTS.startHeadcount+')^коэффициент. При 0 штат не влияет; чем ближе к 1, тем сильнее больший штат на старте ускоряет выручку.'},
    {key:'targetHeadcount', label:'Целевой штат', suffix:'чел', min:1, max:10000,
      hint:'Численность команды при выходе на целевую выручку.'},
    {key:'devShare', label:'Разработка и продукт', suffix:'% от выручки', min:0, max:20,
      hint:'Инженерия, продукт, аналитика, данные. Рост доли увеличивает расходы каждого месяца, и solver требует больше выручки для той же цели.'},
    {key:'gaShare', label:'Административные расходы', suffix:'% от выручки', min:0, max:15,
      hint:'Офис, юридическое сопровождение, финансы, HR.'},
    {key:'riskShare', label:'Резерв на риски', suffix:'% от выручки', min:0, max:10,
      hint:'Буфер на регуляторные и рыночные колебания.'},
    {key:'taxRate', label:'Налог от выручки', suffix:'% от выручки', min:0, max:50,
      hint:'Упрощённый налог от общей выручки, а не от прибыли; вычитается при расчёте чистой прибыли.'},
    {key:'startRevenue', label:'Стартовая выручка', suffix:'₽ в месяц', min:0, max:1000000000,
      hint:'Жёсткая точка старта t=0: весь ряд выручки строится вперёд от неё. При 0 используется значение по умолчанию.'},
    {key:'startMarketing', label:'Стартовый маркетинг', suffix:'₽ в месяц', min:0, max:100000000,
      hint:'Инвестиции в маркетинг с первого месяца, до появления выручки. Растут по экспоненте до маркетинга на целевой дате (выручка × доля маркетинга).'},
    {key:'startFot', label:'Стартовый ФОТ', suffix:'₽ в месяц', min:0, max:100000000,
      hint:'Справочный бюджет команды на старте: участвует в калибровке нелинейной модели. Сам ФОТ считается как штат × средний ФОТ.'},
    {key:'startDev', label:'Стартовая разработка', suffix:'₽ в месяц', min:0, max:100000000,
      hint:'Бюджет разработки и продукта на старте. Растёт до бюджета на целевой дате (выручка × доля разработки).'},
    {key:'startMonth', label:'Стартовый месяц', suffix:'1–12', min:1, max:12,
      hint:'Номер месяца начала горизонта (1 — январь, 12 — декабрь). По умолчанию 7 (июль).'},
    {key:'startYear', label:'Стартовый год', suffix:'год', min:2020, max:2100,
      hint:'Год начала горизонта. По умолчанию 2026 — старт с июля 2026 года и далее.'},
    {key:'horizonMonths', label:'Горизонт', suffix:'месяцев', min:6, max:120,
      hint:'Длина таблицы. Целевая дата должна лежать внутри горизонта; иначе целью считается конец горизонта.'},
    {key:'alpha', label:'Эластичность маркетинга (α)', suffix:'0.5–0.9', min:0.5, max:0.9,
      hint:'Коэффициент эластичности бюджета в нелинейной модели прибыли: PR = R·S·k·B^α − B − FC.'},
    {key:'startCashReserve', label:'Стартовый кассовый резерв', suffix:'₽', min:0, max:10000000000,
      hint:'Начальный остаток кассы для расчёта Burn Rate и Runway.'},
    {key:'seoShareStart', label:'Доля SEO-трафика на старте', suffix:'%', min:0, max:100,
      hint:'Доля бесплатного трафика в миксе на t=0. SEO не расходует маркетинговый бюджет, но даёт заявки.'},
    {key:'seoShareEnd', label:'Доля SEO-трафика на конце', suffix:'%', min:0, max:100,
      hint:'Целевая доля SEO к концу горизонта. Рост доли снижает эффективный CAC и частично компенсирует инфляцию привлечения.'},
    {key:'cacInflation', label:'Инфляция стоимости привлечения', suffix:'% в месяц', min:0, max:10,
      hint:'Ориентир аукционного давления. Частично компенсируется ростом доли SEO-трафика.'},
    {key:'fotIndex', label:'Индексация ФОТ', suffix:'% в год', min:0, max:30,
      hint:'Ежегодное повышение окладов при удержании штата: средний ФОТ месяца t = базовый × (1+индекс)^(t/12).'},
    {key:'growthCeiling', label:'Мягкий потолок выручки', suffix:'₽ в месяц', min:1000000, max:1000000000,
      hint:'Уровень месячной выручки, около которого рост плавно замедляется (обычно 50–100 млн ₽/мес). Это не жёсткий предел: он задаёт форму S-кривой — где именно темп начинает снижаться. Конечную выручку по-прежнему подбирает solver под целевую прибыль.'},
    {key:'growthSaturation', label:'Крутизна насыщения роста', suffix:'1–10', min:1, max:10,
      hint:'Насколько выражено замедление у потолка: чем больше значение, тем резче месячный темп снижается по мере приближения к мягкому потолку. Меньше — плавнее и ровнее.'},
    {key:'firstYearGrowthBoost', label:'Усиление роста в первый год', suffix:'%', min:0, max:50,
      hint:'Мягкий лифт выручки первых 12 месяцев (пик на 12-м месяце), затухающий к 24-му. Ускоряет старт, но не смещает конечную точку и целевую прибыль.'}
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
    // Синхронизация с общим состоянием дашборда (/api/cjm-state + ссылка
    // «Поделиться»): правки финмодели 100 млн сохраняются и шарятся так же,
    // как правки остальных вкладок.
    try{
      if(typeof window!=='undefined'&&window.CjmSharedState&&typeof window.CjmSharedState.scheduleWrite==='function'){
        window.CjmSharedState.scheduleWrite(STORAGE_KEY,obj);
      }
    }catch(e){}
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
  // --- Сезонность: массив из 12 месячных коэффициентов (default 1.0) --------
  function seasonality(){
    var raw=read();
    var out=[];
    for(var i=0;i<12;i++){
      var v=Number(raw[SEASONALITY_KEY_PREFIX+i]);
      out.push(isFinite(v)&&v>0?v:1);
    }
    return out;
  }
  function setSeasonality(i,val){
    var raw=read();
    var n=Number(val);
    if(!isFinite(n)||n<=0)n=1;
    raw[SEASONALITY_KEY_PREFIX+i]=n;
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
  // Якоря модели ровно два: стартовая выручка (t=0) и целевая чистая прибыль
  // на целевую дату targetIdx (из targetMonth/targetYear). Всё остальное —
  // производные:
  //   rev[t]  = startRevenue × (revEnd/startRevenue)^shape(t/targetIdx) × boost(t)
  //             где shape — логистическая S-кривая (разгон → плавное замедление
  //             у «мягкого потолка» growthCeiling), а boost — мягкий лифт роста
  //             первого года (firstYearGrowthBoost), затухающий к 24-му месяцу;
  //   hc[t]   = startHeadcount + (targetHeadcount − startHeadcount) × прогресс
  //             роста выручки (нормированный к [0..1])
  //   fot[t]  = hc[t] × avgFot × (1+fotIndex/100)^(t/12)
  //   mkt[t]  = экспонента от startMarketing до revEnd × marketingShare
  //   dev[t]  = экспонента от startDev до revEnd × devShare
  //   np[t]   = rev[t] × marginFactor − mkt[t] − fot[t] − dev[t],
  //             где marginFactor = (grossMargin − gaShare − riskShare − taxRate)/100
  // revEnd подбирается численно (бисекция), чтобы np[targetIdx] === targetNetProfit.
  // При изменении любого входа (цель, дата цели, доли расходов, старт) весь ряд
  // пересчитывается от startRevenue заново — фиксированных месяцев нет.
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

  // Форма кривой роста выручки: логистическая S-кривая.
  // Возвращает функцию shape(p), где p — прогресс к целевой дате [0..∞):
  //   shape(0)=0, shape(1)=1 — конечная точка сохраняется, поэтому solver
  //   (подбор revEnd под целевую прибыль) продолжает работать без изменений.
  // Месячный темп (производная) сначала растёт, затем ПЛАВНО снижается по мере
  // приближения выручки к «мягкому потолку» ceiling — рост не бесконечный.
  //   ceiling — уровень ₽/мес, около которого темп замедляется;
  //   steep    — крутизна замедления у потолка (1 — плавно, 10 — резко).
  function growthShape(ratio,ceiling,start,steep){
    if(!(ratio>1))return function(p){return Math.max(0,Math.min(1,p));};
    var logRatio=Math.log(ratio);
    // Точка перегиба p0 — доля лог-прогресса, на которой выручка проходит
    // «мягкий потолок»; там месячный темп максимален и начинает снижаться.
    // start×1.0001 — защита от log(1)=0, если потолок ≤ стартовой выручки.
    // Зажимаем p0 в 40–70%: перегиб не должен попадать в самое начало (иначе
    // рост «замирает» уже на старте) или в самый конец горизонта (иначе
    // замедления у потолка не видно вовсе).
    var infl=clamp(Math.log(Math.max(start*1.0001,Number(ceiling)||start)/start)/logRatio,0.4,0.7);
    var a=clamp(Number(steep)||1,1,10);
    function L(x){return 1/(1+Math.exp(-a*(x-infl)));}
    var L0=L(0),L1=L(1),denom=(L1-L0)||1e-9;
    return function(p){
      if(p<=0)return 0;
      if(p<=1)return (L(p)-L0)/denom;
      // За целевой датой — линейное продолжение с наклоном кривой в точке p=1
      // (без жёсткого плато выручки, но и без повторного ускорения). Наклон
      // считаем численной производной (шаг eps=1e-4) нормированной S-кривой.
      var eps=1e-4,slope=((L(1)-L(1-eps))/eps)/denom;
      return 1+slope*(p-1);
    };
  }

  // Лифт роста первого года: мягкий «колокол» с пиком на 12-м месяце,
  // затухающий к 24-му. При t≥24 равен 1 — конечная точка и целевая прибыль
  // не смещаются, ускоряется только старт.
  function firstYearBoost(t,boostPct){
    var b=clamp(Number(boostPct)||0,0,100)/100;
    if(b<=0||t<=0||t>=24)return 1;
    // 0.5·(1−cos(π·t/12)) переводит косинус-волну из [−1..1] в [0..1] с пиком 1
    // ровно на t=12; итоговый множитель растёт от 1 до (1+b) и обратно к 1.
    return 1+b*0.5*(1-Math.cos(Math.PI*t/12));
  }

  // Целевая точка t (targetIdx) из явных targetMonth/targetYear. Если дата вне
  // горизонта или совпадает со стартом — целью считается конец горизонта.
  function resolveTargetIdx(inp,H){
    var m=Math.round(Number(inp.targetMonth));
    var y=Math.round(Number(inp.targetYear));
    if(m>=1&&m<=12&&y>=1900&&y<=9999){
      var idx=monthIndexForKey(inp,y+'-'+String(m).padStart(2,'0'),H);
      if(idx>0)return idx;
    }
    return H;
  }

  // Построение помесячного ряда при заданной конечной выручке revEnd.
  // Используется и solver-ом (только столбец np), и финальным compute().
  function computeSeries(params){
    var inp=params.inp,H=params.H,targetIdx=params.targetIdx;
    var start=params.start,revEnd=Math.max(start,params.revEnd);
    var marginFactor=params.marginFactor;
    var marketingEnd=revEnd*inp.marketingShare/100;
    var devEnd=revEnd*inp.devShare/100;
    var startHc=Math.max(1,Math.round(inp.startHeadcount));
    var targetHc=Math.max(startHc,Math.round(inp.targetHeadcount));
    // Зависимость «штат → рост»: чем больше сотрудников на старте относительно
    // базового штата, тем быстрее растёт выручка. Скорость роста — степенная
    // функция от отношения штатов; коэффициент задаёт эластичность (0 — нет
    // влияния, 1 — пропорционально штату). Ограничена диапазоном ×0.5…×3,
    // чтобы экстремальный штат не ломал модель.
    var teamSpeed=clamp(Math.pow(startHc/Math.max(1,DEFAULTS.startHeadcount),clamp(inp.hcGrowthElasticity,0,1)),0.5,3);
    // Логистическая форма кривой роста: разгон в начале и плавное замедление у
    // «мягкого потолка». Строится один раз на ряд — от отношения revEnd/start.
    var revShape=growthShape(revEnd/start,inp.growthCeiling,start,inp.growthSaturation);

    function revenueAt(t){
      if(t===0)return start;
      // teamSpeed «сжимает» время: при коэффициенте >1 выручка проходит ту же
      // кривую быстрее и на целевой дате превышает revEnd — solver в ответ
      // подбирает меньший revEnd, так что прибыль на целевой дате всё равно
      // сходится ровно в цель, а рост в ранних месяцах становится быстрее.
      var p=targetIdx>0?(t*teamSpeed)/targetIdx:1;
      return start*Math.pow(revEnd/start,revShape(p))*firstYearBoost(t,inp.firstYearGrowthBoost);
    }
    // Штат растёт синхронно с темпом роста выручки (не линейно по времени):
    // прогресс = (rev[t] − старт) / (revEnd − старт), обрезанный к [0..1].
    function headcountAt(t){
      var span=revEnd-start;
      var progress=span>0?clamp((revenueAt(t)-start)/span,0,1):1;
      return Math.round(startHc+(targetHc-startHc)*progress);
    }
    function avgFotAt(t){
      return Math.max(1,inp.avgFot*Math.pow(1+inp.fotIndex/100,t/12));
    }
    function fotAt(t){
      return headcountAt(t)*avgFotAt(t);
    }

    var rows=[];
    for(var t=0;t<=H;t++){
      var rev=revenueAt(t);
      var marketing=budgetCurve(params.startMkt,marketingEnd,t,targetIdx);
      var fot=fotAt(t);
      var dev=budgetCurve(params.startDev,devEnd,t,targetIdx);
      var gross=rev*inp.grossMargin/100;
      var ga=rev*inp.gaShare/100;
      var risk=rev*inp.riskShare/100;
      var opex=marketing+fot+dev+ga+risk;
      var revenueTax=rev*inp.taxRate/100;
      // np = rev×marginFactor − mkt − fot − dev; grossMargin и все %-доли
      // напрямую влияют на каждый месяц, а не только на конечную точку.
      var np=gross-opex-revenueTax;
      var ebitda=rev-(marketing+fot+dev+ga+risk);
      rows.push({t:t,rev:rev,gross:gross,marketing:marketing,fot:fot,dev:dev,ga:ga,risk:risk,
        opex:opex,tax:revenueTax,np:np,ebitda:ebitda,headcount:headcountAt(t)});
    }
    return {rows:rows,revEnd:revEnd,marketingEnd:marketingEnd,devEnd:devEnd,teamSpeed:teamSpeed};
  }

  // Solver: бисекция по revEnd, чтобы np[targetIdx] === targetNetProfit.
  // np(targetIdx) монотонно растёт по revEnd (маржинальный фактор выше суммы
  // долей маркетинга и разработки), поэтому бисекция сходится за 40 итераций.
  function solveForTarget(params,targetNetProfit){
    var lo=params.start,hi=Math.max(params.start*1000,targetNetProfit*100);
    for(var i=0;i<SOLVER_ITERATIONS;i++){
      var mid=(lo+hi)/2;
      params.revEnd=mid;
      var npAtTarget=computeSeries(params).rows[params.targetIdx].np;
      if(npAtTarget<targetNetProfit)lo=mid;else hi=mid;
    }
    return (lo+hi)/2;
  }

  // Растущая доля SEO-трафика: снижает эффективный CAC во времени.
  function seoShareAt(inp,t,H){
    var s0=clamp(inp.seoShareStart,0,100)/100;
    var s1=clamp(inp.seoShareEnd,0,100)/100;
    var lo=Math.min(s0,s1),hi=Math.max(s0,s1);
    return clamp(s0+(s1-s0)*(t/Math.max(1,H)),lo,hi);
  }

  function compute(){
    var inp=inputs();
    var season=seasonality();
    var H=Math.max(1,Math.round(inp.horizonMonths));
    var monthKeys=[];
    for(var kt=0;kt<=H;kt++)monthKeys.push(monthKey(inp,kt));
    var targetIdx=resolveTargetIdx(inp,H);
    var start=inp.startRevenue>0?inp.startRevenue:DEFAULTS.startRevenue;
    var startMkt=inp.startMarketing>0?inp.startMarketing:DEFAULTS.startMarketing;
    var startFot=inp.startFot>0?inp.startFot:DEFAULTS.startFot;
    var startDev=inp.startDev>0?inp.startDev:DEFAULTS.startDev;
    // Доля внутреннего масштаба, из которой после переменных G&A/резерва/налога
    // покрываются маркетинг, ФОТ, разработка и целевая чистая прибыль.
    var marginFactor=(inp.grossMargin-inp.gaShare-inp.riskShare-inp.taxRate)/100;
    marginFactor=Math.max(0.01,marginFactor);

    var params={inp:inp,H:H,targetIdx:targetIdx,start:start,startMkt:startMkt,
      startDev:startDev,marginFactor:marginFactor,revEnd:start};
    params.revEnd=solveForTarget(params,inp.targetNetProfit);
    var series=computeSeries(params);
    var revEnd=series.revEnd;
    var marketingEnd=series.marketingEnd;
    var devEnd=series.devEnd;

    // Объёмная воронка из показателей сегментов (может отсутствовать, если модуль
    // сегментов не загружен — тогда funnel===null и объёмы просто не показываются).
    var funnel=segmentFunnel();

    // Калибровка ёмкости маркетингового канала k на t=0 через воронку:
    // R·S₀·k·B₀^α должно равняться стартовой валовой отдаче
    // (startNp + startMarketing + startFot + startDev = start×marginFactor).
    var alpha=clamp(inp.alpha,0.5,0.9);
    var kChannel=null;
    if(funnel&&funnel.blendedPayout>0&&startMkt>0){
      var startNp=start*marginFactor-startMkt-series.rows[0].fot-startDev;
      kChannel=(startNp+startMkt+series.rows[0].fot+startDev)/
        (funnel.blendedPayout*season[0]*Math.pow(startMkt,alpha));
    }

    var rows=[];
    var cumProfit=0, minCum=0, breakEvenIdx=-1, hitIdx=-1;
    var cash=Math.max(0,inp.startCashReserve);
    var prevCash=cash;
    for(var t=0;t<=H;t++){
      var s=series.rows[t];
      cumProfit+=s.np;
      if(cumProfit<minCum)minCum=cumProfit;
      if(breakEvenIdx<0&&cumProfit>=0&&t>0)breakEvenIdx=t;
      if(hitIdx<0&&s.np>=inp.targetNetProfit)hitIdx=t;
      // Касса, Burn Rate и Runway (§8): cash[t] = cash[t−1] + np[t].
      prevCash=cash;
      cash=cash+s.np;
      var burn=prevCash-cash; // >0 — компания тратит больше, чем зарабатывает
      var runway=burn>0?Math.max(0,cash)/burn:Infinity;
      var row={t:t,label:monthLabel(inp,t),key:monthKeys[t],rev:s.rev,gross:s.gross,
        marketing:s.marketing,fot:s.fot,dev:s.dev,ga:s.ga,risk:s.risk,opex:s.opex,
        tax:s.tax,np:s.np,ebitda:s.ebitda,cum:cumProfit,headcount:s.headcount,
        cash:cash,burn:burn,runway:runway,
        // Справочный KPI: доля ФОТ в выручке (не входной параметр).
        fotShare:s.rev>0?s.fot/s.rev*100:0,
        seoShare:seoShareAt(inp,t,H)};
      if(funnel){
        // Объёмы воронки, выведенные из выручки месяца через конверсии сегментов.
        row.approvals=s.rev*funnel.apprPerRuble;
        row.applications=s.rev*funnel.appsPerRuble;
        row.clicks=s.rev*funnel.clicksPerRuble;
        row.contacts=s.rev*funnel.contactsPerRuble;
        row.traffic=s.rev*funnel.trafficPerRuble;
        // SEO-трафик не расходует маркетинговый бюджет: эффективный CAC
        // считается только от платной части бюджета и снижается с ростом SEO.
        var paidShare=1-row.seoShare;
        row.effectiveMarketingCost=s.marketing*paidShare;
        row.effectiveCac=row.approvals>0?row.effectiveMarketingCost/row.approvals:0;
        // BEP (точка безубыточности, ₽): TFC / (1 − VC/P),
        // TFC = fot+dev, VC = маркетинг на 1 выдачу, P = средняя выплата.
        var vcPerUnit=row.approvals>0?s.marketing/row.approvals:0;
        var bepDenom=1-vcPerUnit/funnel.blendedPayout;
        row.bep=bepDenom>0?(s.fot+s.dev)/bepDenom:null;
        // Нелинейная прибыль маркетингового канала: PR = R·S·k·B^α − B − FC.
        if(kChannel!=null){
          row.marketingProfit=funnel.blendedPayout*season[t%12]*kChannel*
            Math.pow(s.marketing,alpha)-s.marketing-(s.fot+s.dev);
        }
      }
      rows.push(row);
    }

    var endRow=rows[rows.length-1];
    var targetRow=rows[targetIdx];

    var funnelEnd=funnel?{
      approvals:endRow.approvals,
      applications:endRow.applications,
      clicks:endRow.clicks,
      contacts:endRow.contacts,
      traffic:endRow.traffic,
      blendedPayout:funnel.blendedPayout,
      avgCrVc:funnel.avgCrVc,
      avgCrCc:funnel.avgCrCc,
      avgCrCa:funnel.avgCrCa,
      avgCrAi:funnel.avgCrAi
    }:null;

    var g=targetIdx>0&&start>0?Math.pow(rows[targetIdx].rev/start,1/targetIdx)-1:0;

    return {
      inp:inp, seasonality:season, alpha:alpha, kChannel:kChannel,
      revEnd:endRow.rev, grossEnd:endRow.gross, marketingEnd:endRow.marketing, fotEnd:endRow.fot,
      headcount:endRow.headcount, devEnd:endRow.dev, gaEnd:endRow.ga, riskEnd:endRow.risk,
      opexEnd:endRow.opex, taxEnd:endRow.tax, npEnd:endRow.np,
      startEff:start, startMktEff:startMkt, startFotEff:rows[0].fot, startDevEff:startDev,
      monthlyGrowth:g, horizon:H, rows:rows, funnel:funnelEnd, teamSpeed:series.teamSpeed,
      breakEvenIdx:breakEvenIdx, targetIdx:targetIdx, hitIdx:hitIdx, peakInvest:-minCum,
      targetRow:targetRow, solvedRevEnd:targetRow.rev, marginFactor:marginFactor
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
      '<p class="fin100-lead">Модель сфокусирована на чистой прибыли: единственные якоря — стартовая выручка (t=0) '+
        'и целевая чистая прибыль на выбранную дату. Solver автоматически подбирает конечную выручку, '+
        'а масштаб, расходы, штат и объёмы воронки выводятся из формул — фиксированных месяцев в таблице нет.</p>'+
      '<div class="fin100-chain" id="fin100Chain"></div>'+
      '<div class="card"><div class="card-title"><div><h2>Параметры модели</h2></div></div>'+
        '<p class="fin100-note">Параметры разбиты на три группы по функциональному назначению. Каждое поле снабжено пояснением, как оно влияет на итог.</p>'+
        '<div class="fin100-inputs" id="fin100Inputs"></div>'+
      '</div>'+
      '<div class="card"><div class="card-title"><div><h2>Сезонность по месяцам</h2></div></div>'+
        '<p class="fin100-note">Коэффициенты сезонности S (по умолчанию 1.0) применяются в нелинейной модели прибыли маркетингового канала: PR = R·S·k·B^α − B − FC.</p>'+
        '<div class="fin100-seasonality" id="fin100Seasonality"></div>'+
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
      '.fin100-seasonality{display:grid;grid-template-columns:repeat(auto-fill,minmax(90px,1fr));gap:8px}'+
      '.fin100-season-item{display:flex;flex-direction:column;gap:4px}'+
      '.fin100-season-item span{font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.05em;color:var(--muted)}'+
      '.fin100-season-item input{border:1px solid var(--line-strong);border-radius:var(--radius-xs);padding:8px 10px;background:var(--surface-2);font:inherit;font-size:13px;font-weight:600;color:var(--text);font-variant-numeric:tabular-nums;width:100%;box-sizing:border-box}'+
      '.fin100-season-item input:focus{outline:2px solid var(--blue);outline-offset:1px}'+
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
      {tone:'target',formula:'Якорь t=0',value:millions(res.startEff),cap:'Стартовая выручка — точка старта всего ряда'},
      {tone:'target',formula:'Якорь цели',value:res.targetRow?millions(res.targetRow.np):'—',cap:'Чистая прибыль · '+monthLabel(res.inp,res.targetIdx)+' (цель '+millions(res.inp.targetNetProfit)+')'},
      {tone:'derived',formula:'Solver',value:millions(res.solvedRevEnd),cap:'Подобранная выручка на целевой дате'},
      {tone:'derived',formula:'Расходы + команда',value:millions(res.opexEnd),cap:'OPEX в месяц на конце горизонта'},
      {tone:'derived',formula:'Штат × средний ФОТ',value:fmt(res.headcount)+' чел',cap:'Численность штата на конце горизонта'}
    ];
    if(res.funnel){
      items.push(
        {tone:'derived',formula:'Выручка / выплата',value:qty(res.funnel.approvals)+' выдач',cap:'Выдачи в месяц — из показателей сегментов'},
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
    var targetNp=res.targetRow?res.targetRow.np:0;
    var hitTarget = targetNp>=res.inp.targetNetProfit*0.999;
    // Burn Rate / Runway — по первому месяцу после старта (текущее состояние кассы).
    var burnRow=res.rows[1]||res.rows[0];
    var burning=burnRow.burn>0;
    var startRow=res.rows[0];
    var endRow=res.rows[res.rows.length-1];
    var kpis=[
      {tone:hitTarget?'green':'red',label:'Чистая прибыль на целевой дате',value:res.targetRow?millions(res.targetRow.np):'—',sub:'Цель '+millions(res.inp.targetNetProfit)+' · '+monthLabel(res.inp,res.targetIdx)},
      {tone:'blue',label:'Выручка на целевой дате',value:millions(res.solvedRevEnd),sub:'Подобрана solver-ом под целевую прибыль'},
      {tone:'green',label:'Чистая прибыль на конце',value:millions(res.npEnd),sub:'Рост продолжается тем же темпом после цели'},
      {tone:'blue',label:'Фактическая чистая маржа',value:pct(actualMargin,1),sub:'Справочно: чистая прибыль / выручка на конце'},
      {tone:'orange',label:'OPEX в месяц',value:millions(res.opexEnd),sub:'Маркетинг + ФОТ + разработка + G&A + резерв'},
      {tone:'violet',label:'Штат',value:fmt(res.headcount)+' чел',sub:'Растёт от '+fmt(res.inp.startHeadcount)+' до '+fmt(res.inp.targetHeadcount)+' синхронно с выручкой'},
      {tone:'orange',label:'Маркетинг в месяц',value:millions(res.marketingEnd),sub:'На высококонкурентном рынке'},
      {tone:'orange',label:'ФОТ с налогами',value:millions(res.fotEnd),sub:'Штат × средний ФОТ с индексацией'},
      {tone:'blue',label:'Доля ФОТ в выручке',value:pct(endRow.fotShare,1),sub:'Справочный KPI: ФОТ / выручка, не входной параметр'},
      {tone:'blue',label:'Темп роста выручки',value:pct(res.monthlyGrowth*100,1)+' в месяц',sub:'Между стартом и целевой датой'},
      {tone:'violet',label:'Ускорение роста от штата',value:'×'+res.teamSpeed.toLocaleString('ru-RU',{maximumFractionDigits:2}),sub:'(стартовый штат / '+fmt(DEFAULTS.startHeadcount)+')^эластичность («Коэффициент влияния штата на рост») — больше людей на старте, быстрее рост выручки'},
      {tone:burning?'red':'green',label:'Burn Rate (текущий)',value:burning?millions(burnRow.burn)+' в мес':'устойчиво',sub:'Касса[t−1] − Касса[t] на инвестиционной фазе'},
      {tone:burning?'orange':'green',label:'Runway',value:burning?(isFinite(burnRow.runway)?fmt(burnRow.runway)+' мес':'∞'):'∞ / устойчиво',sub:'Кассовый резерв / месячный burn при burn > 0'},
      {tone:res.peakInvest>0?'red':'green',label:'Пиковый кассовый разрыв',value:millions(res.peakInvest),sub:'Максимум накопленного убытка на инвестиционной фазе'},
      {tone:'green',label:'Месяц выхода в накопленный плюс',value:res.breakEvenIdx>=0?monthLabel(res.inp,res.breakEvenIdx):'за горизонтом',sub:'Кумулятивная прибыль ≥ 0'},
      {tone:res.hitIdx>=0?'green':'red',label:'Месяц достижения цели',value:res.hitIdx>=0?monthLabel(res.inp,res.hitIdx):'за горизонтом',sub:'Месячная NP ≥ '+millions(res.inp.targetNetProfit)},
      {tone:'violet',label:'Доля SEO-трафика',value:pct(startRow.seoShare*100,0)+' → '+pct(endRow.seoShare*100,0),sub:'Рост доли бесплатного трафика снижает эффективный CAC'}
    ];
    if(res.funnel){
      var tRow=res.targetRow||endRow;
      if(tRow.bep!=null)kpis.push({tone:'orange',label:'BEP (точка безубыточности)',value:millions(tRow.bep),sub:'TFC / (1 − VC/P) на целевой дате'});
      if(tRow.marketingProfit!=null)kpis.push({tone:'violet',label:'Нелинейная прибыль маркетинга',value:millions(tRow.marketingProfit),sub:'PR = R·S·k·B^α − B − FC · α = '+res.alpha});
      if(tRow.effectiveCac!=null)kpis.push({tone:'blue',label:'Эффективный CAC на выдачу',value:rub(tRow.effectiveCac),sub:'Платная часть маркетинга / выдачи, с учётом доли SEO'});
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
      note.textContent='План построен от периода '+monthLabel(res.inp,0)+' до '+monthLabel(res.inp,res.horizon)+'. '+
        'Старт таблицы жёстко равен стартовой выручке '+millions(res.startEff)+'; целевая точка — '+monthLabel(res.inp,res.targetIdx)+
        ', где чистая прибыль сходится в '+millions(res.inp.targetNetProfit)+' (выручку подбирает solver). '+
        'ФОТ = штат месяца × средний ФОТ с индексацией окладов ('+pct(res.inp.fotIndex,0)+' в год); штат растёт от '+
        fmt(res.inp.startHeadcount)+' до '+fmt(res.inp.targetHeadcount)+' человек синхронно с темпом роста выручки. '+
        'Чистая прибыль = выручка × маржинальность после выплат − OPEX − налог от выручки; изменение любой %-доли меняет все месяцы.'+
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
      '<th>Доля ФОТ</th>'+
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
      else if(res.breakEvenIdx===r.t)cls.push('is-breakeven');
      return '<tr'+(cls.length?' class="'+cls.join(' ')+'"':'')+'>'+
        '<td>'+esc(r.label)+'</td>'+
        (hasFunnel?tdq(r.traffic)+tdq(r.contacts)+tdq(r.clicks)+tdq(r.applications)+tdq(r.approvals):'')+
        td(r.rev)+td(r.marketing)+td(r.fot)+'<td>'+esc(fmt(r.headcount))+'</td>'+
        '<td>'+esc(pct(r.fotShare,1))+'</td>'+
        td(r.dev)+td(r.ga)+td(r.risk)+td(r.opex)+td(r.tax)+td(r.np)+td(r.cum)+
      '</tr>';
    }).join('')+'</tbody>';
    host.innerHTML=head+body;
  }

  function renderSeasonality(){
    var host=$('fin100Seasonality');if(!host)return;
    var season=seasonality();
    host.innerHTML=season.map(function(v,i){
      return '<label class="fin100-season-item">'+
        '<span>'+esc(MONTH_NAMES_RU[i])+'</span>'+
        '<input type="number" min="0.1" max="5" step="0.05" data-fin100-season="'+i+'" value="'+esc(v)+'" aria-label="Сезонность: '+esc(MONTH_NAMES_RU[i])+'">'+
      '</label>';
    }).join('');
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
      var seasonIdx=el&&el.getAttribute&&el.getAttribute('data-fin100-season');
      if(seasonIdx!=null){
        var normalizedSeason=setSeasonality(seasonIdx,el.value);
        if(el.value===''||Number(el.value)<=0)el.value=normalizedSeason;
        var res2=compute();
        renderChain(res2);renderKpis(res2);renderTable(res2);
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
    renderSeasonality();
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
    ensurePanel:ensurePanel,
    // Расчётное ядро экспортируется для unit-тестов (node): compute строит
    // полный план, setInput/resetAll управляют входами без UI.
    compute:compute,
    setInput:setInput,
    resetAll:resetAll,
    defaults:DEFAULTS
  };

  // Автоинициализация панели (скрытая до активации таба).
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',function(){ensureStyles();ensurePanel();});
  else {ensureStyles();ensurePanel();}
})();
