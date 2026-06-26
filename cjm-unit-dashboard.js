(function(){
  'use strict';

  var STORAGE_KEY='cjm_unit_dashboard_v2';
  var TAB_KEY='cjm_inner_tab_v2';
  var MODE_KEY='cjm_unit_mode_v1';
  var MANUAL_KEY='cjm_manual_inputs_v2';
  var VERSION_KEY='vyruchai_app_version_v1';
  var BASE_VISITS=10000;
  var HTML_ESCAPE_MAP={'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;','/':'&#x2F;','`':'&#96;'};
  var charts={};

  // 5 segments per CJM/JTBD spec (Miro):
  //  1. new        — Новый клиент            (yellow)
  //  2. repeat     — Повторный клиент        (green)
  //  3. rejected   — Отказной клиент         (red)
  //  4. sleeping   — Спящий/БФЛ              (blue, описание пустое по схеме)
  //  5. noncore    — Новый (непрофильный)    (violet)
  // Воронка (новая, согласована с бизнесом):
  //   Visit → Контакт (квиз) → Проверка ЦФ → Показ витрины → Заявка → Выдача
  // CR-показатели сегмента (% к предыдущему шагу):
  //   visitQuiz       — Visit → Контакт через квиз
  //   quizCfCheck     — Контакт → Проверка в ЦФ
  //   cfCheckShowcase — Проверка ЦФ → Показ витрины (для new/repeat это CF-витрина;
  //                     если клиент уходит в ЦФ, заявка и выдача идут уже по пути ЦФ)
  //   showcaseApp     — Витрина → Заявка
  //   appIssue        — Заявка → Выдача (мы зарабатываем на этом шаге)
  //  - cac/cpa/ltv: правимая экономика
  //  - description / points_of_entry / how_arrives / why_here: JTBD-блоки CJM
  //  - branch: ключ ветки в Smart Safe Router (см. renderRoutingDiagram)
  //  - colorVar: CSS-переменная цвета сегмента
  //  - justify: пояснения к ручным показателям воронки/экономики
  var segments=[
    {
      id:'new',
      name:'Новый клиент',
      label:'Новый клиент (Желтый)',
      branch:'new',
      color:'var(--yellow)',
      status:'NEW · нет в базе ЦФ',
      description:'Клиент отсутствует в базе Центрофинанс и подходит по параметрам для оформления в Центрофинансе (скоринг, МПЛ, возраст, регион и т.д.).',
      points_of_entry:['SEO','Контекстная реклама','Ремаркетинг','Соц. сети'],
      how_arrives:'Посещение сайтов финансовой тематики (Ремаркетинг), прямой поиск по ключам «Займы онлайн» и т.д. (SEO+ЯД), скроллинг ленты в соцсетях.',
      why_here:'Клиент ещё не знает ни про Центрофинанс, ни про Выручай, возможно имел займы в других МФО. Занимается поиском решения своих финансовых вопросов (ремонт, покупка техники, лечение и т.д.).',
      pains:'Ищет решение финансового вопроса и сравнивает МФО — ещё не знает Центрофинанс.',
      source:'SEO + контекст + ремаркетинг + соц. сети',
      router:'API NOT_FOUND → проверка скоррингом → при одобрении выдача ЦФ',
      showcase:'Лид-форма ЦФ; при отказе — Пробив чеккером по номеру телефона и переход в ветку «Непрофильный»',
      monetization:'Основная: выдача Центрофинанс; при отказе — CPA-витрина непрофильной ветки',
      defaultCr:{visitQuiz:5.0,quizCfCheck:95,cfCheckShowcase:24,showcaseApp:85,appIssue:68},
      cac:780,cpa:1500,ltv:1800,payback:5,share:0.30,
      mix:{seo:0.42,paid:0.34,crm:0.04,pr:0.20},
      justify:{
        visitQuiz:'5,0% Visit → Контакт — холодный трафик; квиз снимает контакт у мотивированной части аудитории.',
        quizCfCheck:'95% Контакт → Проверка ЦФ — почти весь контакт прогоняется через S2S API ЦФ.',
        cfCheckShowcase:'24% Проверка ЦФ → CF-витрина — стандартное автоодобрение ЦФ для новой аудитории.',
        showcaseApp:'85% Витрина → Заявка — увидев предложение, большинство одобренных оформляет заявку в ЦФ.',
        appIssue:'68% Заявка → Выдача — типичный отвал новичков на подписании договора.',
        cac:'CAC 780 ₽ — микс SEO + контекста, ставка в нише «займы онлайн» высокая.',
        cpa:'CPA 1 500 ₽ — fallback-выплата витрины, если ЦФ отказал.',
        ltv:'LTV 1 800 ₽ — первая выдача + первая ступень прогрева в повторного клиента.'
      }
    },
    {
      id:'repeat',
      name:'Действующий клиент',
      label:'Действующий клиент (Зеленый)',
      branch:'repeat',
      color:'var(--green)',
      status:'ACTIVE · 1+ займ в ЦФ',
      description:'Клиент присутствует в базе Центрофинанс, имеет 1 или более займов в компании. По результатам проверки Центрофинанс готов предложить продукт. Ядро лояльной аудитории ЦФ — точка роста через кросс-сейл.',
      points_of_entry:['SEO','Контекстная реклама','Ремаркетинг','Соц. сети'],
      how_arrives:'Посещение сайтов финансовой тематики (Ремаркетинг), прямой поиск по ключам «Займы онлайн» и т.д. (SEO+ЯД), скроллинг ленты в соцсетях.',
      why_here:'Клиент, возможно, ищет более выгодное предложение (например, ставку 0% на первый заём) или просто про нас забыл, так как имеет несколько займов в разных МФО. Но после ввода телефона роутер узнаёт его как «Действующего» и вместо стандартной анкеты переводит в Личный кабинет.',
      pains:'Возвращается, чтобы добрать лимит (Top-up), управлять займом или получить удобную банковскую карту.',
      source:'SEO + ретаргет + CRM-касания + соц. сети',
      router:'Телефон → Авторизация → Личный кабинет (Top-up + витрина банковских карт). Роутер узнаёт «Действующего» и ведёт в ЛК, минуя стандартную анкету.',
      showcase:'Личный кабинет: Top-up (добор займа ЦФ) + витрина банковских карт (дебетовая / кредитная).',
      monetization:'Процентная прибыль ЦФ с Top-up + CPA с оформленных банковских карт. CPA: 1 000–1 500 ₽ (дебетовые), 3 000–5 000 ₽ (кредитные).',
      defaultCr:{visitQuiz:8.4,quizCfCheck:98,cfCheckShowcase:42,showcaseApp:92,appIssue:90},
      cac:380,cpa:0,ltv:2600,payback:3,share:0.25,
      mix:{seo:0.28,paid:0.20,crm:0.42,pr:0.10},
      justify:{
        visitQuiz:'8,4% Visit → Контакт — клиент уже знаком с брендом, охотнее оставляет телефон.',
        quizCfCheck:'98% Контакт → Авторизация — почти весь действующий поток узнаётся роутером и подтягивается из базы ЦФ.',
        cfCheckShowcase:'42% Авторизация → Личный кабинет — заходят в ЛК за Top-up и предложениями по картам.',
        showcaseApp:'CR в заявку (от авторизованных): Top-up ~15–20%, дебетовая карта ~5–8%, кредитная карта ~3–5%.',
        appIssue:'Апрув: Top-up ЦФ ~85–95%, дебетовая карта партнёра ~95–99%, кредитная карта партнёра ~20–30%.',
        cac:'CAC 380 ₽ — основная масса возврата идёт через CRM и ретаргет.',
        cpa:'CPA: 1 000–1 500 ₽ (дебетовые карты), 3 000–5 000 ₽ (кредитные карты). Top-up — внутренняя выдача ЦФ.',
        ltv:'LTV 2 600 ₽ — процентная прибыль ЦФ с Top-up + CPA с оформленных банковских карт.'
      }
    },
    {
      id:'rejected',
      name:'Отказной клиент',
      label:'Отказной клиент (Красный)',
      branch:'rejected',
      color:'var(--red)',
      status:'REJECTED · отказ ЦФ 1–14 дней',
      description:'Клиент, получивший отказ от Центрофинанс от 1 до 14 дней назад. Присутствует в базе как отказной. Т.е. это не обязательно прямая монетизация отказного трафика через маркетплейс.',
      points_of_entry:['SEO','Контекстная реклама','Ремаркетинг','Соц. сети'],
      how_arrives:'Посещение сайтов финансовой тематики (Ремаркетинг), прямой поиск по ключам «Займы онлайн» и т.д. (SEO+ЯД), скроллинг ленты в соцсетях.',
      why_here:'Скорее всего, клиент, получивший отказ в одной или нескольких МФО, находится в поиске решения своих вопросов. Ищет МФО, где ему точно не откажут или с высоким шансом одобрения (посещает каталоги, читает отзывы).',
      pains:'Только что получил отказ; срочно нужны деньги, согласен почти на любые условия.',
      source:'Платный трафик и ретаргет на срочный заём',
      router:'Телефон → Статус: Отказ → ромб «Проверка ПДН (долговой нагрузки)»: ПДН нормальный → витрина CPA-МФО; ПДН высокий (закредитован) → офферы БФЛ (Банкротство).',
      showcase:'Ветка МФО: витрина 5 офферов МФО, где клиента нет в базе. Ветка БФЛ: офферы юристов по банкротству физлиц.',
      monetization:'Компенсация маркетингового бюджета. Ветка МФО: CPA ~2 000–2 400 ₽. Ветка БФЛ: CPA ~3 500–5 000 ₽. LTV ≈ разовая CPA (растится через CRM: Push/СМС).',
      defaultCr:{visitQuiz:5.4,quizCfCheck:95,cfCheckShowcase:42,showcaseApp:5,appIssue:72},
      cac:870,cpa:2400,ltv:2400,payback:5,share:0.25,
      mix:{seo:0.18,paid:0.70,crm:0.05,pr:0.07},
      justify:{
        visitQuiz:'5,4% Visit → Контакт — «горячая» потребность в деньгах удерживает CR на среднерыночном уровне.',
        quizCfCheck:'95% Контакт → Статус: Отказ — отказным гоним проверку ПДН, чтобы корректно распределить ветку (МФО / БФЛ).',
        cfCheckShowcase:'Переход по витрине: МФО ~40–45%, БФЛ ~15–20% (зависит от результата проверки ПДН).',
        showcaseApp:'CR в заявку партнёра: ветка МФО ~4–6%, ветка БФЛ — апрув юристами ~5–7%.',
        appIssue:'Апрув партнёра: ветка МФО ~5–8% (КИ испорчена). Ветка БФЛ — квалификация юристами.',
        cac:'CAC 870 ₽ — основной источник Яндекс.Директ + ретаргет в дорогой нише «срочный заём».',
        cpa:'CPA: ветка МФО ~2 000–2 400 ₽, ветка БФЛ ~3 500–5 000 ₽.',
        ltv:'LTV ≈ разовая CPA-выплата; растится только через CRM-маркетинг (Push/СМС с новыми витринами).'
      }
    },
    {
      id:'sleeping',
      name:'Спящий клиент',
      label:'Спящий клиент (Синий)',
      branch:'sleeping',
      color:'var(--blue)',
      status:'DORMANT · в базе ЦФ, неактивен >30 дней',
      description:'Клиент присутствует в базе Центрофинанс, но не проявлял активности более 30 дней (ранее успешно закрыл займ или несколько займов и не вернулся, либо бросил старую заявку). Возврат ушедшей аудитории, защита базы от «слива» конкурентам.',
      points_of_entry:['Retention-кампании (СМС/Email/Push)','SEO','Контекстная реклама','Ремаркетинг','Соц. сети'],
      how_arrives:'Переход по ссылке из реактивационной рассылки (например, оффер «Мы скучали, вот вам скидка»), посещение сайтов финансовой тематики (Ремаркетинг), прямой поиск по ключам «Займы онлайн» и т.д. (SEO+ЯД).',
      why_here:'У клиента снова возникла финансовая потребность. Он мог забыть про Центрофинанс и искать новые МФО через поиск (Яндекс/Google), либо напрямую отреагировал на наше спецпредложение. Главная цель системы — «перехватить» его и вернуть в контур ЦФ до того, как он оставит заявку конкурентам.',
      pains:'Снова возникла потребность; вспомнил про нас или отреагировал на рассылку. Анкета уже заполнена.',
      source:'Retention (СМС/Email/Push) + SEO + ретаргет + соц. сети',
      router:'Телефон → Статус: Спящий → ромб «ЦФ готов одобрить?»: ДА → Welcome-back бонус ЦФ → выдача ЦФ; НЕТ (испортил КИ) → витрина CPA-МФО.',
      showcase:'Если ЦФ одобряет — Welcome-back оффер ЦФ. Если нет — витрина 5 офферов МФО-партнёров.',
      monetization:'Если забирает ЦФ: CPA = 0 ₽, клиент возвращается в цикл ЦФ (реактивация высокого LTV). Если витрина: CPA ~2 000–2 400 ₽, LTV = разовый CPA.',
      defaultCr:{visitQuiz:7.0,quizCfCheck:95,cfCheckShowcase:45,showcaseApp:25,appIssue:75},
      cac:600,cpa:2400,ltv:3500,payback:3,share:0.05,
      mix:{seo:0.30,paid:0.20,crm:0.40,pr:0.10},
      justify:{
        visitQuiz:'7,0% Visit → Контакт — реактивационные рассылки и знакомый бренд поднимают долю оставивших телефон.',
        quizCfCheck:'95% Контакт → Статус: Спящий — прогоняем по базе ЦФ, чтобы попытаться вернуть в контур.',
        cfCheckShowcase:'45% Спящий → Решение «ЦФ готов одобрить?» — апрув ЦФ для спящих ~40–50%.',
        showcaseApp:'CR в заявку ~20–30% (от вернувшихся в ЦФ) — анкета уже заполнена, проходит быстро.',
        appIssue:'Апрув ЦФ ~40–50%; при отказе клиент уходит на витрину CPA-МФО.',
        cac:'CAC 600 ₽ — дешёвый возврат через собственный CRM-канал.',
        cpa:'Если ЦФ — CPA 0 ₽ (внутр.). Если витрина — CPA ~2 000–2 400 ₽.',
        ltv:'LTV до 3 500 ₽ при возврате в цикл ЦФ; на витрине LTV = разовый CPA.'
      }
    },
    {
      id:'noncore',
      name:'Новый (непрофильный)',
      label:'Новый (непрофильный) (Фиолетовый)',
      branch:'noncore',
      color:'var(--violet)',
      status:'NOT_FOUND · непрофильный',
      description:'Клиент отсутствует в базе Центрофинанс. По результатам проверки, даже поверхностной, Центрофинанс не готов предложить ему продукт.',
      points_of_entry:['SEO','Контекстная реклама','Ремаркетинг','Соц. сети'],
      how_arrives:'Посещение сайтов финансовой тематики (Ремаркетинг), прямой поиск по ключам «Займы онлайн» и т.д. (SEO+ЯД), скроллинг ленты в соцсетях.',
      why_here:'Скорее всего клиент также ищет информацию об МФО, готовых предложить ему продукт с минимальными проверками (владеет информацией о себе, знает просрочки, получил несколько отказов, возможно регион/возраст).',
      pains:'Ищет МФО с минимальными проверками, владеет инф-ей о своих просрочках/отказах.',
      source:'SEO + контекст + ремаркетинг + соц. сети',
      router:'API NOT_FOUND (после поверхностной проверки) → Пробив чеккером по номеру телефона → витрина монетизации',
      showcase:'Показ 5 офферов МФО, где клиента нет в базе (витрина монетизации)',
      monetization:'CPA-выплата от МФО-партнёров за оформленный заём',
      defaultCr:{visitQuiz:4.2,quizCfCheck:95,cfCheckShowcase:100,showcaseApp:16,appIssue:62},
      cac:920,cpa:1800,ltv:1800,payback:6,share:0.15,
      mix:{seo:0.40,paid:0.30,crm:0.05,pr:0.25},
      justify:{
        visitQuiz:'4,2% Visit → Контакт — холодный трафик с низким доверием.',
        quizCfCheck:'95% Контакт → Проверка ЦФ — поверхностная проверка обязательна для всех новых.',
        cfCheckShowcase:'100% Проверка ЦФ → Витрина — после NOT_FOUND сразу показываем CPA-витрину.',
        showcaseApp:'16% Витрина → Заявка — у партнёров жёсткий фильтр на этой аудитории.',
        appIssue:'62% Заявка → Выдача — часть отваливается на согласовании условий.',
        cac:'CAC 920 ₽ — стоимость касания в перегретой нише + бренд-затраты.',
        cpa:'CPA 1 800 ₽ — fallback-выплата витрины МФО.',
        ltv:'LTV 1 800 ₽ — разовая транзакция через CPA-партнёра.'
      }
    }
  ];

  // SSR matrix (8 rows) — removed: вкладка «Маршрутизация SSR» убрана из шапки.

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
  // Stored shape: { [segmentId]: { visitQuiz, quizCfCheck, cfCheckShowcase, showcaseApp, appIssue, cac, cpa, ltv } }
  function manualStore(){return read(MANUAL_KEY,{});}
  function manualFor(id){
    var seg=segmentById(id);if(!seg)return null;
    var store=manualStore();var saved=store[id]||{};
    return {
      visitQuiz:saved.visitQuiz!=null?Number(saved.visitQuiz):seg.defaultCr.visitQuiz,
      quizCfCheck:saved.quizCfCheck!=null?Number(saved.quizCfCheck):seg.defaultCr.quizCfCheck,
      cfCheckShowcase:saved.cfCheckShowcase!=null?Number(saved.cfCheckShowcase):seg.defaultCr.cfCheckShowcase,
      showcaseApp:saved.showcaseApp!=null?Number(saved.showcaseApp):seg.defaultCr.showcaseApp,
      appIssue:saved.appIssue!=null?Number(saved.appIssue):seg.defaultCr.appIssue,
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
  // Шесть шагов: Visit → Контакт (квиз) → Проверка ЦФ → Показ витрины → Заявка → Выдача.
  // Пять конверсий между ними (visitQuiz, quizCfCheck, cfCheckShowcase, showcaseApp, appIssue).
  function funnelFor(id,opts){
    opts=opts||{};
    var m=manualFor(id);
    var visit=BASE_VISITS;
    var crVQ=clamp(m.visitQuiz,0,100);
    var crQC=clamp(m.quizCfCheck,0,100);
    var crCS=clamp(m.cfCheckShowcase,0,100);
    var crSA=clamp(m.showcaseApp,0,100);
    var crAI=clamp(m.appIssue,0,100);
    if(opts.mode==='toBe'){crVQ*=1.05;crQC*=1.05;crCS*=1.05;crSA*=1.05;crAI*=1.05;}
    crVQ=Math.min(crVQ,100);crQC=Math.min(crQC,100);crCS=Math.min(crCS,100);
    crSA=Math.min(crSA,100);crAI=Math.min(crAI,100);
    var quiz=Math.round(visit*crVQ/100);
    var cfCheck=Math.round(quiz*crQC/100);
    var showcase=Math.round(cfCheck*crCS/100);
    var app=Math.round(showcase*crSA/100);
    var issue=Math.round(app*crAI/100);
    return {
      visit:visit,quiz:quiz,cfCheck:cfCheck,showcase:showcase,app:app,issue:issue,
      crVQ:crVQ,crQC:crQC,crCS:crCS,crSA:crSA,crAI:crAI
    };
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
      ['Контакт · квиз',f.quiz,pct(f.crVQ,1)+' Visit → Контакт'],
      ['Проверка ЦФ',f.cfCheck,pct(f.crQC,1)+' Контакт → Проверка ЦФ'],
      ['Показ витрины',f.showcase,pct(f.crCS,1)+' Проверка ЦФ → Витрина'],
      ['Заявка',f.app,pct(f.crSA,1)+' Витрина → Заявка'],
      ['Выдача',f.issue,pct(f.crAI,1)+' Заявка → Выдача · мы зарабатываем']
    ];
    var host=$('cjmSegmentFunnel');
    if(host){
      host.innerHTML=steps.map(function(st){
        return '<div class="cjm-funnel-step"><span>'+esc(st[0])+'</span><b>'+fmt(st[1])+'</b><p class="metric-sub">'+esc(st[2])+'</p></div>';
      }).join('');
    }

    var fields=[
      {key:'visitQuiz',label:'CR · Visit → Контакт (квиз)',suffix:'%',step:'0.1',min:0,max:100},
      {key:'quizCfCheck',label:'CR · Контакт → Проверка ЦФ',suffix:'%',step:'0.1',min:0,max:100},
      {key:'cfCheckShowcase',label:'CR · Проверка ЦФ → Витрина',suffix:'%',step:'0.1',min:0,max:100},
      {key:'showcaseApp',label:'CR · Витрина → Заявка',suffix:'%',step:'0.1',min:0,max:100},
      {key:'appIssue',label:'CR · Заявка → Выдача',suffix:'%',step:'0.1',min:0,max:100},
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
        ['CR · Visit → Контакт',s.justify.visitQuiz],
        ['CR · Контакт → Проверка ЦФ',s.justify.quizCfCheck],
        ['CR · Проверка ЦФ → Витрина',s.justify.cfCheckShowcase],
        ['CR · Витрина → Заявка',s.justify.showcaseApp],
        ['CR · Заявка → Выдача',s.justify.appIssue],
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

  // --- CJM journey panel (per segment) -- JTBD blocks per spec --------------
  function renderJourneyPanel(){
    if(isMatrixView()){renderRoutingDiagram();return;}
    var host=$('cjmJourneyHost');if(!host)return;
    var s=currentSegment();
    var hasDescription=!!(s.description&&s.description.length);
    var poeHtml=(s.points_of_entry&&s.points_of_entry.length)
      ? '<ul>'+s.points_of_entry.map(function(p){return '<li>'+esc(p)+'</li>';}).join('')+'</ul>'
      : '<p class="cjm-jtbd-empty">Точки входа пока не утверждены</p>';
    var howHtml=s.how_arrives?'<p>'+esc(s.how_arrives)+'</p>':'<p class="cjm-jtbd-empty">Описание появится позже</p>';
    var whyHtml=s.why_here?'<p>'+esc(s.why_here)+'</p>':'<p class="cjm-jtbd-empty">«Почему на Выручай.ру» — данные ещё не получены</p>';
    var descHtml=hasDescription
      ? '<p>'+esc(s.description)+'</p>'
      : '<p class="cjm-jtbd-empty">Описание сегмента ещё не утверждено в Miro. CJM-блок отображён как заглушка.</p>';
    host.innerHTML='<article class="card" style="border-top:4px solid '+esc(s.color)+'">'+
      '<div class="card-title"><div><span class="eyebrow">'+esc(s.status)+'</span><h2>'+esc(s.label)+'</h2>'+descHtml+'</div></div>'+
      '<div class="cjm-stage-grid">'+
        '<div class="cjm-stage"><h3>1. Вход (Источник)</h3><p>'+esc(s.source)+'</p></div>'+
        '<div class="cjm-stage"><h3>2. Smart Safe Router</h3><p>'+esc(s.router)+'</p></div>'+
        '<div class="cjm-stage"><h3>3. Витрина (Офферы)</h3><p>'+esc(s.showcase)+'</p></div>'+
        '<div class="cjm-stage"><h3>4. Монетизация</h3><p><b>'+esc(s.monetization)+'</b></p></div>'+
      '</div>'+
      '<div class="cjm-jtbd-grid">'+
        '<div class="jtbd-cell"><h3>Точки входа</h3>'+poeHtml+'</div>'+
        '<div class="jtbd-cell"><h3>Как попадает</h3>'+howHtml+'</div>'+
        '<div class="jtbd-cell"><h3>Почему на Выручай.ру</h3>'+whyHtml+'</div>'+
      '</div>'+
    '</article>';
    renderRoutingDiagram();
  }

  // --- Smart Safe Router block-flow diagram (Miro-style, inline SVG) --------
  // Five branches after the central CF-check router; entry points are common
  // for all branches (SEO / Контекстная реклама / Ремаркетинг / Соц. сети).
  // Selected segment branch keeps opacity:1; others are dimmed via CSS.
  function renderRoutingDiagram(){
    var host=$('cjmRouteDiagram');if(!host)return;
    var s=isMatrixView()?null:currentSegment();
    var activeBranch=s?s.branch:null;
    host.classList.toggle('has-active',!!activeBranch);

    // Geometry --------------------------------------------------------------
    // Координаты подобраны так, чтобы ветки не перекрывались между собой.
    // Для веток с ромбом «Одобрено?» справа от ромба ставится блок «ДА → Выдача
    // ЦФ» (x = col[4] + ширина ромба + 30), а под ним — блок «НЕТ → …». Поэтому
    // холст шире самого правого узла (W=1760), а ряды с ромбом получают повышенный
    // вертикальный шаг, чтобы кластер «ДА/НЕТ» одной ветки не наезжал на соседнюю.
    var W=1760,H=1080;
    var BW=240,BH=72;                       // box width/height
    var col=[60,360,660,960,1240];          // x of column lefts
    // Entry column (4 stacked boxes at x=col[0])
    var entryY=[80,200,320,440];
    var entries=['SEO','Контекстная реклама','Ремаркетинг','Соц. сети'];
    // Hub column
    var hubX=col[1], hubW=BW;
    var siteY=220,routerY=420;
    // Branch rows — равномерно распределены с учётом доп. блока «НЕТ».
    // Ветки с ромбом (new/repeat) занимают по вертикали ~222px (блок «ДА» сверху,
    // ромб по центру, блок «НЕТ» снизу), поэтому между ними увеличенный отступ.
    var branches=[
      {key:'new',     y:80,  color:'var(--yellow)', name:'Новый клиент',
        nodes:[ {t:'Новый клиент',s:'Желтый сегмент'},
                {t:'Проверка скоррингом',s:'Скоринг ЦФ'},
                {t:'Одобрено?',s:'Решение',shape:'diamond'},
                {t:'Выдача ЦФ',s:'ДА · целевой результат',out:true} ]},
      {key:'repeat',  y:360, color:'var(--green)',  name:'Повторный клиент',
        nodes:[ {t:'Повторный клиент',s:'Зеленый сегмент'},
                {t:'Проверка скоррингом',s:'Скоринг ЦФ · repeat'},
                {t:'Одобрено?',s:'Решение',shape:'diamond'},
                {t:'Выдача ЦФ',s:'ДА · repeat-выдача',out:true} ]},
      {key:'rejected',y:620, color:'var(--red)',    name:'Отказной клиент',
        nodes:[ {t:'Отказной клиент',s:'Красный сегмент'},
                {t:'Пробив чеккером',s:'по номеру телефона'},
                null,
                {t:'5 офферов МФО',s:'Витрина монетизации',out:true} ]},
      {key:'sleeping',y:780, color:'var(--blue)',   name:'Спящий / БФЛ',
        nodes:[ {t:'Спящий / БФЛ',s:'Синий сегмент · в разработке'},
                null,null,null ]},
      {key:'noncore', y:940, color:'var(--violet)', name:'Новый (непрофильный)',
        nodes:[ {t:'Новый (непрофильный)',s:'Фиолетовый сегмент'},
                {t:'Пробив чеккером',s:'по номеру телефона'},
                null,
                {t:'5 офферов МФО',s:'Витрина монетизации',out:true} ]}
    ];

    var svg=[];
    svg.push('<svg viewBox="0 0 '+W+' '+H+'" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="Блок-схема Smart Safe Router">');
    svg.push('<defs><marker id="rdArrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="9" markerHeight="9" orient="auto-start-reverse"><path d="M0,0 L10,5 L0,10 z" class="rd-arrow"/></marker></defs>');

    function box(x,y,w,h,opts){
      opts=opts||{};
      var cls='rd-box';
      if(opts.entry)cls+=' rd-entry';
      if(opts.hub)cls+=' rd-hub';
      if(opts.out)cls+=' rd-out';
      var style=opts.borderColor?'border-top:4px solid '+opts.borderColor+';':'';
      var sub=opts.s?'<div class="rd-s">'+esc(opts.s)+'</div>':'';
      return '<foreignObject x="'+x+'" y="'+y+'" width="'+w+'" height="'+h+'">'+
        '<div xmlns="http://www.w3.org/1999/xhtml" class="'+cls+'" style="'+style+'">'+
          '<div class="rd-t">'+esc(opts.t)+'</div>'+sub+
        '</div></foreignObject>';
    }
    function diamond(x,y,w,h,opts){
      opts=opts||{};
      var cx=x+w/2,cy=y+h/2;
      var pts=[cx+','+y,(x+w)+','+cy,cx+','+(y+h),x+','+cy].join(' ');
      var color=opts.borderColor||'var(--line-strong)';
      return '<polygon points="'+pts+'" fill="var(--surface)" stroke="'+color+'" stroke-width="2"/>'+
        '<foreignObject x="'+x+'" y="'+y+'" width="'+w+'" height="'+h+'">'+
          '<div xmlns="http://www.w3.org/1999/xhtml" style="height:100%;display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center;padding:0 18px">'+
            '<div class="rd-t" style="font-size:14px">'+esc(opts.t)+'</div>'+
            (opts.s?'<div class="rd-s" style="font-size:12px">'+esc(opts.s)+'</div>':'')+
          '</div></foreignObject>';
    }
    function edge(x1,y1,x2,y2,label){
      var mx=(x1+x2)/2;
      var d='M'+x1+','+y1+' C'+mx+','+y1+' '+mx+','+y2+' '+x2+','+y2;
      var l=label?'<text x="'+((x1+x2)/2)+'" y="'+((y1+y2)/2-6)+'" class="rd-elabel" text-anchor="middle">'+esc(label)+'</text>':'';
      return '<path class="rd-edge" d="'+d+'" marker-end="url(#rdArrow)"/>'+l;
    }

    // Entry boxes
    entries.forEach(function(name,i){
      svg.push(box(col[0],entryY[i],BW,BH,{t:name,entry:true}));
    });
    // Hub: Выручай.ру
    svg.push(box(hubX,siteY,hubW,BH,{t:'Выручай.ру',s:'Единая точка входа',hub:true}));
    // Hub: Проверка по базе ЦФ
    svg.push(box(hubX,routerY,hubW,BH,{t:'Проверка по базе ЦФ',s:'Smart Safe Router',hub:true}));
    // Entry → Выручай.ру
    entries.forEach(function(_,i){
      svg.push(edge(col[0]+BW,entryY[i]+BH/2,hubX,siteY+BH/2));
    });
    // Выручай.ру → роутер
    svg.push(edge(hubX+hubW/2,siteY+BH,hubX+hubW/2,routerY));

    // Branches
    branches.forEach(function(br){
      svg.push('<g class="ssr-branch ssr-branch-'+br.key+(activeBranch===br.key?' is-active':'')+'">');
      // First node (segment box) anchored at col[2]
      var x0=col[2],y0=br.y;
      svg.push(box(x0,y0,BW,BH,{t:br.nodes[0].t,s:br.nodes[0].s,borderColor:br.color}));
      // Router → segment box
      svg.push(edge(hubX+hubW,routerY+BH/2,x0,y0+BH/2));

      var n1=br.nodes[1];
      if(n1){
        var x1=col[3],y1=br.y;
        svg.push(box(x1,y1,BW,BH,{t:n1.t,s:n1.s,borderColor:br.color}));
        svg.push(edge(x0+BW,y0+BH/2,x1,y1+BH/2));
        var n2=br.nodes[2],n3=br.nodes[3];
        if(n2&&n2.shape==='diamond'){
          var dx=col[4],dy=br.y-4,dw=200,dh=80;
          svg.push(diamond(dx,dy,dw,dh,{t:n2.t,s:n2.s,borderColor:br.color}));
          svg.push(edge(x1+BW,y1+BH/2,dx,dy+dh/2,'Да'));
          // YES branch — Выдача ЦФ (n3)
          if(n3){
            var yx=dx+dw+30,yy=dy-30;
            svg.push(box(yx,yy,BW,BH,{t:n3.t,s:n3.s,out:true,borderColor:'var(--green)'}));
            svg.push(edge(dx+dw,dy+dh/2,yx,yy+BH/2,'ДА'));
          }
          // NO branch — depends on segment
          var noY=dy+dh+40;
          var noText=br.key==='new'
            ? 'НЕТ → Пробив чеккером (ветка «Непрофильный»)'
            : 'НЕТ → «Ну нет и нет, ПК мы подаём»';
          svg.push('<foreignObject x="'+dx+'" y="'+noY+'" width="'+(BW+60)+'" height="'+BH+'">'+
            '<div xmlns="http://www.w3.org/1999/xhtml" class="rd-box" style="border-top:4px solid var(--orange);font-size:12px">'+
              '<div class="rd-t" style="font-size:13px">'+esc(noText)+'</div>'+
            '</div></foreignObject>');
          svg.push(edge(dx+dw/2,dy+dh,dx+dw/2,noY,'НЕТ'));
        }else if(n3){
          var x3=col[4],y3=br.y;
          svg.push(box(x3,y3,BW,BH,{t:n3.t,s:n3.s,out:true,borderColor:br.color}));
          svg.push(edge(x1+BW,y1+BH/2,x3,y3+BH/2));
        }
      }else{
        // Branch ends here (sleeping/БФЛ) — small badge
        svg.push('<foreignObject x="'+(col[3])+'" y="'+(br.y)+'" width="'+BW+'" height="'+BH+'">'+
          '<div xmlns="http://www.w3.org/1999/xhtml" class="rd-box" style="border-top:4px dashed var(--blue);font-size:12px">'+
            '<div class="rd-t" style="font-size:13px">Ветка в разработке</div>'+
            '<div class="rd-s">Логика будет дополнена позже</div>'+
          '</div></foreignObject>');
        svg.push(edge(x0+BW,y0+BH/2,col[3],br.y+BH/2));
      }
      svg.push('</g>');
    });

    svg.push('</svg>');
    host.innerHTML=svg.join('');
  }

  // --- Пример расчёта (полная воронка → выручка) ----------------------------
  function calcFor(id){
    var s=segmentById(id);var f=funnelFor(id);var m=manualFor(id);
    var revenue=f.issue*m.ltv;
    var cost=f.visit*0 + (f.issue*m.cac); // CAC взимается за выдачу (на 1 issue)
    var profit=revenue-cost;
    return {s:s,f:f,m:m,revenue:revenue,cost:cost,profit:profit};
  }
  function renderCalcPanel(){
    if(isMatrixView())return;
    var s=currentSegment();
    var c=calcFor(s.id);
    var card=$('cjmCalcSegmentCard');
    if(card){
      var steps=[
        {n:'1. Визиты',v:fmt(c.f.visit),sub:'База расчёта · 10 000'},
        {n:'2. Контакт · квиз',v:fmt(c.f.quiz),sub:pct(c.f.crVQ,1)+' Visit → Контакт'},
        {n:'3. Проверка ЦФ',v:fmt(c.f.cfCheck),sub:pct(c.f.crQC,1)+' Контакт → Проверка ЦФ'},
        {n:'4. Показ витрины',v:fmt(c.f.showcase),sub:pct(c.f.crCS,1)+' Проверка ЦФ → Витрина'},
        {n:'5. Заявка',v:fmt(c.f.app),sub:pct(c.f.crSA,1)+' Витрина → Заявка'},
        {n:'6. Выдача',v:fmt(c.f.issue),sub:pct(c.f.crAI,1)+' Заявка → Выдача'},
        {n:'7. Затраты на CAC',v:rub(c.cost),sub:'CAC '+rub(c.m.cac)+' × '+fmt(c.f.issue)+' выдач'},
        {n:'8. Выручка',v:rub(c.revenue),sub:'LTV '+rub(c.m.ltv)+' × '+fmt(c.f.issue)+' выдач',revenue:true}
      ];
      card.innerHTML='<div class="card-title"><div><span class="eyebrow" style="color:'+esc(s.color)+'">'+esc(s.label)+'</span><h2>Сквозной расчёт по сегменту</h2><p>От визитов до выручки: каждый шаг — результат предыдущего по введённым CR/CAC/LTV. Прогноз прибыли: <b>'+rub(c.profit)+'</b>.</p></div></div>'+
        '<div class="cjm-calc-flow">'+steps.map(function(st){
          return '<div class="cjm-calc-step'+(st.revenue?' cs-revenue':'')+'"><span class="cs-name">'+esc(st.n)+'</span><span class="cs-val">'+esc(st.v)+'</span><span class="cs-sub">'+esc(st.sub)+'</span></div>';
        }).join('')+'</div>';
    }
  }

  // Сводная таблица «Сводка по всем сегментам» — теперь рендерится только в матрице.
  function renderCalcSummaryTable(){
    var table=$('cjmCalcTable');
    if(!table)return;
    var rows=segments.map(function(seg){return calcFor(seg.id);});
    var totalRev=rows.reduce(function(a,r){return a+r.revenue;},0);
    var totalProfit=rows.reduce(function(a,r){return a+r.profit;},0);
    table.innerHTML='<thead><tr><th>Сегмент</th><th>Визиты</th><th>Контакт</th><th>Проверка ЦФ</th><th>Витрина</th><th>Заявка</th><th>Выдачи</th><th>CAC × выдачи</th><th>LTV</th><th>Выручка</th><th>Прибыль</th></tr></thead><tbody>'+
      rows.map(function(r){
        return '<tr><td class="ue2-t-name"><span class="ue2-seg-dot" style="background:'+esc(r.s.color)+'"></span>'+esc(r.s.name)+'</td>'+
          '<td>'+fmt(r.f.visit)+'</td>'+
          '<td>'+fmt(r.f.quiz)+'</td>'+
          '<td>'+fmt(r.f.cfCheck)+'</td>'+
          '<td>'+fmt(r.f.showcase)+'</td>'+
          '<td>'+fmt(r.f.app)+'</td>'+
          '<td>'+fmt(r.f.issue)+'</td>'+
          '<td>'+rub(r.cost)+'</td>'+
          '<td>'+rub(r.m.ltv)+'</td>'+
          '<td class="tone-green"><b>'+rub(r.revenue)+'</b></td>'+
          '<td class="'+(r.profit>=0?'tone-green':'tone-red')+'">'+rub(r.profit)+'</td></tr>';
      }).join('')+
      '<tr><td class="ue2-t-name"><b>Итого по '+rows.length+' сегментам</b></td><td colspan="8"></td><td class="tone-green"><b>'+rub(totalRev)+'</b></td><td class="'+(totalProfit>=0?'tone-green':'tone-red')+'"><b>'+rub(totalProfit)+'</b></td></tr>'+
      '</tbody>';
  }

  // --- SSR panel removed (per spec): диаграмма теперь рендерится внутри CJM

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
      ['CPA',m.cpa<=0?'внутр.':rub(m.cpa),'Средняя выплата/ценность действия','blue'],
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
      ['Контакт · квиз',f.quiz,pct(f.crVQ),pct(f.quiz/f.visit*100)],
      ['Проверка ЦФ',f.cfCheck,pct(f.crQC),pct(f.cfCheck/f.visit*100)],
      ['Показ витрины',f.showcase,pct(f.crCS),pct(f.showcase/f.visit*100)],
      ['Заявка',f.app,pct(f.crSA),pct(f.app/f.visit*100)],
      ['Выдача',f.issue,pct(f.crAI),pct(f.issue/f.visit*100)]
    ];
    var t=$('cjmUnitFunnel');
    if(t){
      t.innerHTML='<thead><tr><th>Шаг</th><th>Абс.</th><th>CR шага</th><th>CR от Visit</th></tr></thead><tbody>'+
        rows.map(function(r){return '<tr><td class="ue2-t-name">'+esc(r[0])+'</td><td>'+fmt(r[1])+'</td><td>'+esc(r[2])+'</td><td>'+esc(r[3])+'</td></tr>';}).join('')+'</tbody>';
    }
    document.querySelectorAll('[data-cjm-mode]').forEach(function(btn){btn.classList.toggle('active',btn.getAttribute('data-cjm-mode')===mode);});
  }

  // --- SSR panel (per segment) ---------------------------------------------
  // (removed per spec; routing diagram теперь рендерится внутри CJM-вкладки)

  // --- Unit-economics mode toggle ------------------------------------------
  function initUnitMode(){
    document.querySelectorAll('[data-cjm-mode]').forEach(function(btn){
      btn.addEventListener('click',function(){write(MODE_KEY,btn.getAttribute('data-cjm-mode'));renderUnitPanel();requestAnimationFrame(renderCharts);});
    });
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
          '<div class="cjm-matrix-step"><span class="cjm-matrix-step-name">Контакт</span><span class="cjm-matrix-step-val">'+fmt(f.quiz)+'</span><span class="cjm-matrix-step-cr">'+pct(f.crVQ,1)+'</span></div>'+
          '<div class="cjm-matrix-step"><span class="cjm-matrix-step-name">Проверка ЦФ</span><span class="cjm-matrix-step-val">'+fmt(f.cfCheck)+'</span><span class="cjm-matrix-step-cr">'+pct(f.crQC,1)+'</span></div>'+
          '<div class="cjm-matrix-step"><span class="cjm-matrix-step-name">Витрина</span><span class="cjm-matrix-step-val">'+fmt(f.showcase)+'</span><span class="cjm-matrix-step-cr">'+pct(f.crCS,1)+'</span></div>'+
          '<div class="cjm-matrix-step"><span class="cjm-matrix-step-name">Заявка</span><span class="cjm-matrix-step-val">'+fmt(f.app)+'</span><span class="cjm-matrix-step-cr">'+pct(f.crSA,1)+'</span></div>'+
          '<div class="cjm-matrix-step"><span class="cjm-matrix-step-name">Выдача</span><span class="cjm-matrix-step-val">'+fmt(f.issue)+'</span><span class="cjm-matrix-step-cr">'+pct(f.crAI,1)+'</span></div>'+
          '<footer><span>Доля сегмента</span><b>'+pct(s.share*100,0)+'</b></footer>'+
        '</article>';
      }).join('');
    }
    renderCalcSummaryTable();
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
          '<td class="'+cls(d,'cpa')+'">'+(d.cpa<=0?'внутр.':rub(d.cpa))+'</td>'+
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
        data:{labels:['Контакт','Проверка ЦФ','Витрина','Заявка','Выдача'],datasets:[
          {label:'As-Is',data:[asIs.quiz,asIs.cfCheck,asIs.showcase,asIs.app,asIs.issue],backgroundColor:colors.blue},
          {label:'To-Be +5% CR',data:[toBe.quiz,toBe.cfCheck,toBe.showcase,toBe.app,toBe.issue],backgroundColor:colors.green}
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
      renderCalcPanel();
      renderUnitPanel();
    }
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

  // Version switcher: переключает видимость #cjmDashboard ↔ .original-app-hidden
  // через атрибут body[data-app-version] (CSS-правила определены в HTML).
  function applyAppVersion(ver){
    var v=ver==='legacy'?'legacy':'new';
    document.body.setAttribute('data-app-version',v);
    document.querySelectorAll('.version-switch button').forEach(function(b){
      b.classList.toggle('active',b.getAttribute('data-app-version')===v);
    });
    write(VERSION_KEY,v);
  }
  function initVersionSwitcher(){
    var saved=read(VERSION_KEY,'new');
    applyAppVersion(saved);
    document.querySelectorAll('.version-switch button[data-app-version]').forEach(function(b){
      b.addEventListener('click',function(){applyAppVersion(b.getAttribute('data-app-version'));});
    });
  }

  function init(){
    initVersionSwitcher();
    initInnerTabs();
    initUnitMode();
    initTheme();
    renderAll();
  }

  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init);
  else init();
})();
