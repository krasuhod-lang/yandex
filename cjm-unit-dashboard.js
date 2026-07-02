(function(){
  'use strict';

  var STORAGE_KEY='cjm_unit_dashboard_v2';
  var TAB_KEY='cjm_inner_tab_v2';
  var MANUAL_KEY='cjm_manual_inputs_v3';
  var GLOBAL_KEY='cjm_global_inputs_v1';
  var SHARES_KEY='cjm_segment_shares_v1';
  var DESC_KEY='cjm_segment_descriptions_v1';
  var VERSION_KEY='vyruchai_app_version_v1';
  var BASE_VISITS=10000;
  // Глобальные параметры, общие для всех сегментов:
  //  - visitContact — CR · Визит → Контакт (одна для всех сегментов)
  //  - contactCost  — Стоимость привлечения одного контакта (₽), общая
  //  - n_visitContact / n_contactCost — объём выборки, на котором посчитан показатель
  var GLOBAL_DEFAULTS={visitContact:5.4,contactCost:140,n_visitContact:50000,n_contactCost:50000};
  var HTML_ESCAPE_MAP={'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;','/':'&#x2F;','`':'&#96;'};
  var charts={};

  // ===== Финмодель (вкладка «Финмодель до декабря 2027») ======================
  // Самодостаточный слой: воронка считается от контактов, полученных из бюджетов
  // по источникам трафика и CPL. Центрофинанс выступает трекером лида и не является
  // источником объёма. Продажа лида обратно в ЦФ по 3000 ₽ убрана из выручки
  // (по требованию бизнеса) — вместо неё используются партнёрские ставки за выдачу
  // по каждому сегменту. Все входные параметры редактируются пользователем и
  // сохраняются в localStorage.
  var FINANCE_KEY='cjm_finance_inputs_v2';
  var FINANCE_LEGACY_KEYS=['cjm_finance_inputs_v1'];
  // Горизонт совпадает с baseline PNL: июль 2026 → декабрь 2027 (18 месяцев).
  var FIN_MONTHS=['Июль 2026','Август 2026','Сентябрь 2026','Октябрь 2026','Ноябрь 2026','Декабрь 2026','Январь 2027','Февраль 2027','Март 2027','Апрель 2027','Май 2027','Июнь 2027','Июль 2027','Август 2027','Сентябрь 2027','Октябрь 2027','Ноябрь 2027','Декабрь 2027'];
  var FIN_MONTHS_SHORT=['Июл26','Авг26','Сен26','Окт26','Ноя26','Дек26','Янв27','Фев27','Мар27','Апр27','Май27','Июн27','Июл27','Авг27','Сен27','Окт27','Ноя27','Дек27'];
  // Модель драйвится не визитами/CPC, а бюджетами по источникам трафика и
  // «стоимостью оставленного номера» (CPL): бюджет_i / CPL_i = контакты_i.
  // Контакты → Заявки → Выдачи. Доли и CPA — по 5 сегментам, редактируются вручную.
  // Дефолты отражают стартовую выручку около 60–70 тыс. ₽/мес и нарастающий эффект
  // вложений с июля: первые месяцы проект убыточен, к декабрю 2027 — 20+ млн ₽
  // выручки и 10+ млн ₽ прибыли в месяц.
  var FIN_DEFAULTS={
    monthlyGrowth:40,
    // 4 источника трафика: стартуем от малого июльского бюджета, дальше масштабируем эффект.
    srcYdBudget:15000, srcYdCpl:180,
    srcSeoBudget:3000, srcSeoCpl:45,
    srcPrBudget:2000,  srcPrCpl:120,
    srcOtherBudget:5000, srcOtherCpl:150,
    // Воронка от контакта
    crContactApp:40, crAppIssue:32,
    // 5 сегментов — доли (%) и ставка CPA (₽ за выдачу партнёру)
    shareNew:30, shareRejected:20, shareRepeat:20, shareSleeping:15, shareNoncore:15,
    payoutNew:3200, payoutRejected:2700, payoutRepeat:3000, payoutSleeping:2300, payoutNoncore:1800,
    // Фикс. расходы
    fotMonthly:325000, devMonthly:200000,
    // Центрофинанс как трекер лида (не источник объёма)
    cfApprovalShare:30, cfPayout:0,
    // Цель
    targetRevenue:20000000
  };
  var FIN_SEG_META=[
    {key:'New',name:'Новый',color:'var(--yellow)',shareKey:'shareNew',payoutKey:'payoutNew'},
    {key:'Rejected',name:'Отказной',color:'var(--red)',shareKey:'shareRejected',payoutKey:'payoutRejected'},
    {key:'Repeat',name:'Действующий',color:'var(--green)',shareKey:'shareRepeat',payoutKey:'payoutRepeat'},
    {key:'Sleeping',name:'Спящий',color:'var(--blue)',shareKey:'shareSleeping',payoutKey:'payoutSleeping'},
    {key:'Noncore',name:'Непрофильный',color:'var(--violet)',shareKey:'shareNoncore',payoutKey:'payoutNoncore'}
  ];
  var FIN_SRC_META=[
    {key:'Yd',name:'Яндекс.Директ',color:'var(--yellow)',budgetKey:'srcYdBudget',cplKey:'srcYdCpl'},
    {key:'Seo',name:'SEO',color:'var(--green)',budgetKey:'srcSeoBudget',cplKey:'srcSeoCpl'},
    {key:'Pr',name:'PR / соцсети',color:'var(--violet)',budgetKey:'srcPrBudget',cplKey:'srcPrCpl'},
    {key:'Other',name:'Прочие источники',color:'var(--blue)',budgetKey:'srcOtherBudget',cplKey:'srcOtherCpl'}
  ];

  // 5 segments per CJM/JTBD spec (Miro):
  //  1. new        — Новый клиент            (yellow)
  //  2. repeat     — Действующий клиент       (green)
  //  3. rejected   — Отказной клиент         (red, ветка ПДН → МФО / БФЛ)
  //  4. sleeping   — Спящий клиент           (blue, ромб «ЦФ готов одобрить?»)
  //  5. noncore    — Новый (непрофильный)    (violet)
  // Воронка (упрощённая, согласована с бизнесом):
  //   Visit → Контакт (общая CR на все сегменты)
  //   Visit → Клик по офферу → Заявка → Выдача (CR — по сегментам)
  // CR-показатели:
  //   visitContact — Визит → Контакт (общий, в GLOBAL_DEFAULTS)
  //   visitClick   — Визит → Клик по офферу (по сегменту)
  //   clickApp     — Клик по офферу → Заявка
  //   appIssue     — Заявка → Выдача (мы зарабатываем на этом шаге)
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
      status:'Нет в базе ЦФ',
      description:'Клиент отсутствует в базе Центрофинанс и подходит по параметрам для оформления в Центрофинансе (скоринг, МПЛ, возраст, регион и т.д.).',
      points_of_entry:['SEO','Контекстная реклама','Ремаркетинг','Соц. сети'],
      how_arrives:'Посещение сайтов финансовой тематики (Ремаркетинг), прямой поиск по ключам «Займы онлайн» и т.д. (SEO+ЯД), скроллинг ленты в соцсетях.',
      why_here:'Клиент ещё не знает ни про Центрофинанс, ни про Выручай, возможно имел займы в других МФО. Занимается поиском решения своих финансовых вопросов (ремонт, покупка техники, лечение и т.д.).',
      pains:'Ищет решение финансового вопроса и сравнивает МФО — ещё не знает Центрофинанс.',
      source:'SEO + контекст + ремаркетинг + соц. сети',
      router:'Клиент не найден в базе ЦФ → Квиз-преквалификация → продажа лида: вариант А — в Центрофинанс (CPA 3 000 ₽), вариант Б — в стороннюю МФО (CPA 2 500–3 000 ₽).',
      showcase:'Лид-форма ЦФ; при отказе — Пробив чеккером по номеру телефона и переход в ветку «Непрофильный»',
      monetization:'Два варианта продажи лида: (А) в Центрофинанс — Выручай.ру получает 3 000 ₽ за выдачу; (Б) в стороннюю МФО — 2 500–3 000 ₽ за выдачу. Ставки задаются вручную, чтобы гибко настраивать математику под партнёров.',
      defaultCr:{visitClick:4.5,clickApp:80,appIssue:20},
      cac:780,cpa:2875,ltv:1800,payback:5,share:0.20,
      // Альтернативные сценарии монетизации лида (см. CJM diagram). На каждого клиента
      // показываем ОДИН из вариантов — сценарии не суммируются. Поле `share` —
      // доля распределения трафика по сценарию (последний считается как остаток до 100%).
      // Эффективный CPA = Σ cpa_i × share_i / 100 и используется как seg.cpa / LTV в воронке
      // (в lead-sale модели LTV ≈ выплата за выдачу). Поля редактируются в блоке
      // «Параметры сегмента» (manual inputs) и сохраняются вместе с остальными.
      // storageKey: cpa* / share* — ключи в localStorage (для совместимости со старыми сохранениями).
      leadSale:{
        inputsTitle:'Продажа лида · два варианта монетизации',
        compareDescription:'Считаем экономику сегмента в двух крайних сценариях: продаём весь трафик в ЦФ vs продаём по CPA в стороннюю МФО. Воронка одинакова, отличается только выплата за выдачу — это даёт прямой ответ, по какому сценарию выгоднее запускать сегмент.',
        verdictTie:'Сценарии равнозначны по прибыли — разница &lt; 0,5%. Можно выбирать по операционным критериям (стабильность партнёра, риски выплаты, удобство интеграции).',
        options:[
          {key:'cf',label:'Продажа лида в Центрофинанс',shortLabel:'ЦФ',cpaStorageKey:'cpaCf',shareStorageKey:'shareCf',defaultCpa:3000,defaultShare:50,cpaMin:0,cpaMax:1000000,
            cardEyebrow:'Сценарий А',cardTitle:'Продажа лида в Центрофинанс',cardSub:'Весь трафик уходит в ЦФ (доля 100%) · CPA {cpa} за выдачу.',
            verdictName:'Сценарий А — продажа лида в ЦФ'},
          {key:'third',label:'Продажа лида в стороннюю МФО',shortLabel:'МФО',cpaStorageKey:'cpaThird',shareStorageKey:null,defaultCpa:2750,defaultShare:50,cpaMin:0,cpaMax:1000000,cpaHintMin:2500,cpaHintMax:3000,
            cardEyebrow:'Сценарий Б',cardTitle:'Продажа по CPA в стороннюю МФО',cardSub:'Весь трафик уходит в партнёрскую МФО (доля 0% ЦФ) · CPA {cpa} за выдачу.',
            verdictName:'Сценарий Б — продажа по CPA в стороннюю МФО'}
        ]
      },
      mix:{seo:0.42,paid:0.34,crm:0.04,pr:0.20},
      cpa_text:'3 000 ₽ за лид в ЦФ · 2 500–3 000 ₽ за лид в стороннюю МФО (микс настраивается)',
      ltv_text:'Высокий — у 20% зашедших 3–5 займов ЦФ за год; остальные 80% уходят на витрины партнёров.',
      justify:{
        visitClick:'4,5% Визит → Клик по офферу — мотивированный «холодный» клиент кликает на анкету ЦФ.',
        clickApp:'80% Клик → Заявка (анкета ЦФ) — конверсия в полностью заполненную анкету.',
        appIssue:'20% Заявка → Апрув (выдача) — типичный апрув-рейт для новой аудитории (ЦФ или сторонняя МФО).',
        cpa:'CPA смешанный: 3 000 ₽ — продажа лида в ЦФ, 2 500–3 000 ₽ — продажа лида в стороннюю МФО. Эффективная ставка зависит от доли распределения.',
        ltv:'LTV (1 год) высокий: у 20% зашедших — 3–5 займов ЦФ, остальные 80% уходят на партнёрские витрины.'
      },
      userStory:{
        title:'Как человек, внезапно столкнувшийся с финансовой потребностью',
        text:'Как человек, внезапно столкнувшийся с финансовой потребностью (поломка, лечение), я хочу быстро сравнить условия и найти самое выгодное предложение (в идеале под 0% на первый заём), чтобы решить проблему без лишних переплат и долгих проверок.',
        pains:'Боится скрытых комиссий, навязанных страховок и того, что данные утекут спамерам.'
      }
    },
    {
      id:'repeat',
      name:'Действующий клиент',
      label:'Действующий клиент (Зеленый)',
      branch:'repeat',
      color:'var(--green)',
      status:'Действующий договор',
      description:'Клиент присутствует в базе Центрофинанс, имеет действующий договор. Ядро лояльной аудитории ЦФ — точка роста через кросс-сейл.',
      points_of_entry:['SEO','Контекстная реклама','Ремаркетинг','Соц. сети'],
      how_arrives:'Посещение сайтов финансовой тематики (Ремаркетинг), прямой поиск по ключам «Займы онлайн» и т.д. (SEO+ЯД), скроллинг ленты в соцсетях.',
      why_here:'',
      pains:'Возвращается, чтобы добрать лимит (Top-up), управлять займом или получить удобную банковскую карту.',
      source:'SEO + ретаргет + CRM-касания + соц. сети',
      router:'Телефон → Роутер узнаёт «Действующего». Три альтернативных сценария монетизации на одном уровне (показываем один из трёх): продукты ЦФ (Top-up / повторный заём / программа лояльности) ИЛИ добор в другой МФО ИЛИ банковские карты (дебетовая / кредитная). Конкретный сценарий выбирается под цель сегмента и текущий трафик.',
      showcase:'',
      monetization:'Три альтернативных сценария на одном уровне: (А) Продукты ЦФ — процентная прибыль с Top-up / повторного займа; (Б) Добор в другой МФО — CPA партнёрской МФО за дополнительный заём; (В) Банковские карты — CPA 1 000–1 500 ₽ (дебетовые) или 3 000–5 000 ₽ (кредитные). Сценарии не суммируются — на каждого клиента показываем один из трёх в зависимости от цели и сегментации.',
      defaultCr:{visitClick:7.5,clickApp:35,appIssue:30},
      cac:380,cpa:3000,ltv:4500,payback:3,share:0.15,
      // Три альтернативных сценария монетизации (либо/либо/либо) — см. CJM «Действующий».
      // На каждого клиента показываем ОДИН из трёх; сценарии не суммируются. Доли
      // распределения задают, какую часть трафика обслуживает каждый сценарий
      // (последний считается как остаток до 100%). Эффективный CPA = Σ cpa_i × share_i / 100
      // и используется как seg.cpa / LTV в воронке (в lead-sale модели LTV ≈ выплата за выдачу).
      leadSale:{
        inputsTitle:'Продажа лида · три альтернативных сценария монетизации',
        compareDescription:'Считаем экономику сегмента в трёх крайних сценариях: весь трафик уходит либо в продукты ЦФ (Top-up / повторный заём), либо в добор стороннего МФО, либо на витрину банковских карт. Воронка одинакова, отличается только выплата за выдачу — это даёт прямой ответ, по какому сценарию выгоднее запускать сегмент.',
        verdictTie:'Сценарии равнозначны по прибыли — разница &lt; 0,5%. Выбор делаем по операционным критериям (доступность Top-up, договорённости с МФО-партнёром, выплаты банков-эмитентов).',
        options:[
          {key:'topup',label:'CPA · Продукты ЦФ (Top-up / повторный заём)',shortLabel:'ЦФ Top-up',cpaStorageKey:'cpaRepeatTopup',shareStorageKey:'shareRepeatTopup',defaultCpa:3000,defaultShare:40,cpaMin:0,cpaMax:1000000,
            cardEyebrow:'Сценарий А',cardTitle:'Продукты ЦФ — Top-up / повторный заём',cardSub:'Весь трафик уходит на продукты ЦФ (доля 100%) · процентная прибыль с Top-up, эквивалент CPA {cpa} за выдачу.',
            verdictName:'Сценарий А — продукты ЦФ (Top-up / повторный заём)'},
          {key:'mfo',label:'CPA · Добор в стороннюю МФО',shortLabel:'МФО',cpaStorageKey:'cpaRepeatMfo',shareStorageKey:'shareRepeatMfo',defaultCpa:2500,defaultShare:30,cpaMin:0,cpaMax:1000000,
            cardEyebrow:'Сценарий Б',cardTitle:'Добор в стороннюю МФО',cardSub:'Весь трафик уходит в партнёрскую МФО за дополнительный заём (доля 100%) · CPA {cpa} за выдачу.',
            verdictName:'Сценарий Б — добор в стороннюю МФО'},
          {key:'cards',label:'CPA · Банковские карты (дебет / кредит)',shortLabel:'Карты',cpaStorageKey:'cpaRepeatCards',shareStorageKey:null,defaultCpa:3000,defaultShare:30,cpaMin:0,cpaMax:1000000,cpaHintMin:1000,cpaHintMax:5000,
            cardEyebrow:'Сценарий В',cardTitle:'Банковские карты (дебет / кредит)',cardSub:'Весь трафик уходит на витрину банковских карт (доля 100%) · CPA {cpa} за оформление: 1 000–1 500 ₽ дебетовые, 3 000–5 000 ₽ кредитные.',
            verdictName:'Сценарий В — банковские карты'}
        ]
      },
      mix:{seo:0.28,paid:0.20,crm:0.42,pr:0.10},
      cpa_text:'1 000 – 5 000 ₽ (зависит от типа: дебет / кредитка)',
      ltv_text:'До 7 займов ЦФ за год + кросс-сейл банковских карт у ~20% (зависит от типа карты).',
      justify:{
        visitClick:'7,5% Визит → Клик по офферу — клиент уже знаком с брендом, охотнее идёт в Top-up / витрину ЛК.',
        clickApp:'35% Клик → Заявка — в среднем по Top-up и кросс-сейлу карт.',
        appIssue:'30% Заявка → Апрув — суммарно по Top-up ЦФ и банковским картам партнёров. Карты: ~20% (зависит от типа).',
        cpa:'CPA 1 000 – 5 000 ₽ — дебетовые ~1 000–1 500 ₽, кредитные ~3 000–5 000 ₽. Top-up — внутренняя выдача ЦФ.',
        ltv:'LTV (1 год): до 7 займов ЦФ — самый прибыльный сегмент за счёт повторных выдач и кросс-сейла карт.'
      },
      userStory:{
        title:'Как клиент с опытом и одобренными лимитами',
        text:'Как клиент, у которого уже есть опыт работы с займами (и, возможно, есть текущие долги), я хочу авторизоваться по номеру телефона и увидеть свои персональные, уже одобренные лимиты, чтобы получить нужную сумму в 1 клик без повторного заполнения 30 полей анкеты.',
        pains:'Боится отказа из-за высокой кредитной нагрузки, не хочет тратить время на бюрократию, хочет уверенности, что ему точно дадут деньги.'
      }
    },
    {
      id:'rejected',
      name:'Отказной клиент',
      label:'Отказной клиент (Красный)',
      branch:'rejected',
      color:'var(--red)',
      status:'Отказ ЦФ 1–30 дней',
      description:'Клиент, получивший отказ от Центрофинанс от 1 до 30 дней назад. Присутствует в базе как отказной и нет заключенного договора.',
      points_of_entry:['SEO','Контекстная реклама','Ремаркетинг','Соц. сети'],
      how_arrives:'Посещение сайтов финансовой тематики (Ремаркетинг), прямой поиск по ключам «Займы онлайн» и т.д. (SEO+ЯД), скроллинг ленты в соцсетях.',
      why_here:'Скорее всего, клиент, получивший отказ в одной или нескольких МФО, находится в поиске решения своих вопросов. Ищет МФО, где ему точно не откажут или с высоким шансом одобрения (посещает каталоги, читает отзывы).',
      pains:'Только что получил отказ; срочно нужны деньги, согласен почти на любые условия.',
      source:'Платный трафик и ретаргет на срочный заём',
      router:'Телефон → Статус: Отказ → ромб «Проверка ПДН (долговой нагрузки)»: ПДН нормальный → витрина CPA-МФО; ПДН высокий (закредитован) → офферы БФЛ (Банкротство).',
      showcase:'Ветка МФО: витрина 5 офферов МФО, где клиента нет в базе. Ветка БФЛ: офферы юристов по банкротству физлиц.',
      monetization:'Компенсация маркетингового бюджета. Ветка МФО: CPA ~2 000–2 400 ₽. Ветка БФЛ: CPA ~3 500–5 000 ₽. LTV ≈ разовая CPA (растится через CRM: Push/СМС).',
      defaultCr:{visitClick:2.1,clickApp:18,appIssue:27},
      cac:870,cpa:2200,ltv:2400,payback:5,share:0.10,
      mix:{seo:0.18,paid:0.70,crm:0.05,pr:0.07},
      cpa_text:'2 000 – 2 400 ₽ (среднее по рынку CPA-витрины МФО)',
      ltv_text:'2–3 займа в год через партнёрские МФО (LTV ≈ накопленная CPA-выручка).',
      justify:{
        visitClick:'2,1% Визит → Клик по офферу — клиент кликает по партнёрскому офферу из топ-5 МФО.',
        clickApp:'18% Клик → Заявка (анкета партнёра) — типичный CR заполнения анкеты у партнёров.',
        appIssue:'27% Заявка → Апрув (выдача партнёра) — среднерыночный апрув по сложному трафику.',
        cpa:'CPA 2 000 – 2 400 ₽ — средняя выплата CPA-витрины МФО за оформленный заём.',
        ltv:'LTV (1 год): 2–3 займа — растим через CRM (Push/СМС с новыми витринами).'
      },
      userStory:{
        title:'Как заёмщик, только что получивший отказ',
        text:'Как заёмщик, который только что получил обидный отказ от кредитора, я хочу попасть на витрину лояльных МФО с высоким процентом одобрения, чтобы гарантированно получить деньги и не портить свою кредитную историю чередой новых пустых запросов.',
        pains:'Находится в стрессе из-за отказа, боится повторных отказов, нуждается в деньгах «еще вчера».'
      }
    },
    {
      id:'sleeping',
      name:'Спящий клиент',
      label:'Спящий клиент (Синий)',
      branch:'sleeping',
      color:'var(--blue)',
      status:'В базе ЦФ, неактивен > 30 дней',
      description:'Клиент присутствует в базе Центрофинанс, но не проявлял активности более 30 дней (ранее успешно закрыл займ или несколько займов и не вернулся, либо бросил старую заявку). Возврат ушедшей аудитории, защита базы от «слива» конкурентам.',
      points_of_entry:['Retention-кампании (СМС/Email/Push)','SEO','Контекстная реклама','Ремаркетинг','Соц. сети'],
      how_arrives:'Переход по ссылке из реактивационной рассылки (например, оффер «Мы скучали, вот вам скидка»), посещение сайтов финансовой тематики (Ремаркетинг), прямой поиск по ключам «Займы онлайн» и т.д. (SEO+ЯД).',
      why_here:'У клиента снова возникла финансовая потребность. Он мог забыть про Центрофинанс и искать новые МФО через поиск (Яндекс/Google), либо напрямую отреагировал на наше спецпредложение. Главная цель системы — «перехватить» его и вернуть в контур ЦФ до того, как он оставит заявку конкурентам.',
      pains:'Снова возникла потребность; вспомнил про нас или отреагировал на рассылку. Анкета уже заполнена.',
      source:'Retention (СМС/Email/Push) + SEO + ретаргет + соц. сети',
      router:'Телефон → Статус: Спящий → ромб «ЦФ готов одобрить?»: ДА → Welcome-back бонус ЦФ → выдача ЦФ; НЕТ (испортил КИ) → витрина CPA-МФО.',
      showcase:'Если ЦФ одобряет — Welcome-back оффер ЦФ. Если нет — витрина 5 офферов МФО-партнёров.',
      monetization:'Если забирает ЦФ: CPA = 0 ₽, клиент возвращается в цикл ЦФ (реактивация высокого LTV). Если витрина: CPA ~2 000–2 400 ₽, LTV = разовый CPA.',
      defaultCr:{visitClick:3.3,clickApp:45,appIssue:45},
      cac:600,cpa:0,ltv:3500,payback:3,share:0.30,
      mix:{seo:0.30,paid:0.20,crm:0.40,pr:0.10},
      cpa_text:'0 ₽ — экономия CAC + возобновление маржи ЦФ',
      ltv_text:'До 3–4 займов ЦФ в год после реактивации.',
      justify:{
        visitClick:'3,3% Визит → Клик по офферу — клиент видит реактивационное предложение Welcome-back и кликает.',
        clickApp:'45% Клик → Заявка — анкета уже заполнена, проходит быстро.',
        appIssue:'45% Заявка → Апрув (выдача ЦФ) — апрув-рейт ЦФ для спящих ~40–50%.',
        cpa:'CPA 0 ₽ — экономия CAC, возобновление маржи ЦФ через собственную выдачу.',
        ltv:'LTV (1 год): до 3–4 займов ЦФ при возврате в цикл.'
      },
      userStory:{
        title:'Как человек, которому снова срочно нужны деньги',
        text:'Как человек, которому срочно понадобились деньги, я ищу в интернете выгодный микрозаём (возможно, забыв про свой прошлый опыт в «Центрофинанс» или решив поискать условия получше у конкурентов). Я хочу оставить заявку на сервисе, который подберёт мне 100% одобренный вариант без отказов и долгих проверок.',
        pains:'Не хочет заново вводить паспортные данные, СНИЛС и место работы. Боится, что везде будут отказывать, поэтому ищет агрегаторы/маркетплейсы («Выручай»), надеясь, что там шансы выше. Возможно, у него уже есть пара займов в других местах, и он боится отказа из-за нагрузки.'
      }
    },
    {
      id:'noncore',
      name:'Непрофильный клиент',
      label:'Непрофильный клиент (Фиолетовый)',
      branch:'noncore',
      color:'var(--violet)',
      status:'Непрофильный · отсутствует в базе ЦФ',
      description:'Клиент отсутствует в базе Центрофинанс. По результатам проверки, даже поверхностной, Центрофинанс не готов предложить ему продукт. Монетизируем через витрину банковских продуктов или 5 офферов МФО.',
      points_of_entry:['SEO','Контекстная реклама','Ремаркетинг','Соц. сети'],
      how_arrives:'Посещение сайтов финансовой тематики (Ремаркетинг), прямой поиск по ключам «Займы онлайн» и т.д. (SEO+ЯД), скроллинг ленты в соцсетях.',
      why_here:'Скорее всего клиент также ищет информацию об МФО, готовых предложить ему продукт с минимальными проверками (владеет информацией о себе, знает просрочки, получил несколько отказов, возможно регион/возраст).',
      pains:'Ищет МФО с минимальными проверками, владеет инф-ей о своих просрочках/отказах.',
      source:'SEO + контекст + ремаркетинг + соц. сети',
      router:'Клиент не найден в базе ЦФ (после поверхностной проверки) → Пробив чеккером по номеру телефона → витрина банковских продуктов или 5 МФО',
      showcase:'Витрина банковских продуктов (кредиты + дебетовые карты) или 5 офферов МФО, где клиента нет в базе',
      monetization:'CPA от банков-партнёров (кредиты, дебетовые карты) + CPA от МФО-партнёров за оформленный заём',
      defaultCr:{visitClick:1.4,clickApp:25,appIssue:18},
      cac:920,cpa:3500,ltv:3500,payback:6,share:0.25,
      mix:{seo:0.40,paid:0.30,crm:0.05,pr:0.25},
      cpa_text:'1 000 – 6 000 ₽ (банки + МФО)',
      ltv_text:'Средний — 2–3 партнёрских продукта (кредиты / дебетовые карты / займы МФО) за год.',
      justify:{
        visitClick:'1,4% Визит → Клик по офферу — кликают на витрину банковских продуктов или МФО.',
        clickApp:'25% Клик → Заявка (анкета банка / МФО) — типичный CR заполнения анкеты.',
        appIssue:'15–20% Заявка → Апрув по кредитам, ~20% по дебетовым картам, отдельный апрув у МФО.',
        cpa:'CPA 1 000 – 6 000 ₽ — спред по типам продуктов: дебетовые карты дешевле, кредиты и кредитки дороже.',
        ltv:'LTV (1 год) средний: 2–3 партнёрских продукта на клиента.'
      },
      userStory:{
        title:'Как непрофильный клиент, ищущий «помощь сервиса»',
        text:'Как человек, которому нужны заёмные средства (до зарплаты, на покупку или рефинансирование), я захожу на Выручай.ру, чтобы быстро найти компанию, которая одобрит мою заявку. Я хочу получить деньги без лишних заморочек, даже если у меня неофициальный доход, неподходящий возраст или я ищу не просто заём, а, например, кредитную карту.',
        pains:'Часто сталкивается с отказами в банках и крупных МФО из-за формальных требований (19 лет, нет стажа, плохая КИ — или наоборот, чистая КИ, но банки перестраховываются). Не понимает, какие именно компании готовы с ним работать. Устал подавать заявки вручную на десятках разных сайтов и получать отказы, поэтому пришёл на маркетплейс-агрегатор в надежде на «помощь сервиса».'
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
  function ratioTone(v){return v>2?'green':v>=1?'yellow':'red';}
  function clamp(v,min,max){v=Number(v);if(!isFinite(v))v=min;return Math.max(min,Math.min(max,v));}

  // --- Segment descriptions (editable text blocks) --------------------------
  // Хранение пользовательских правок описаний сегментов CJM:
  //   { [segmentId]: { description, userStoryText, userStoryPains,
  //                    router, monetization, points_of_entry, how_arrives } }
  // Пустая строка = «очистить поле» (отображаем пустой блок). Если поля нет в
  // объекте — берём дефолтное значение из массива segments.
  var DESC_FIELDS=['description','userStoryText','userStoryPains','router','monetization','points_of_entry','how_arrives'];
  function descStore(){return read(DESC_KEY,{})||{};}
  function descForRaw(id){return descStore()[id]||{};}
  function setDescFields(id,fields){
    var store=descStore();var cur=store[id]||{};
    Object.keys(fields).forEach(function(k){cur[k]=fields[k];});
    store[id]=cur;write(DESC_KEY,store);
  }
  function resetDesc(id){var store=descStore();delete store[id];write(DESC_KEY,store);}
  // Возвращает «вью-копию» сегмента с применёнными правками описаний.
  function segmentWithDescOverrides(seg){
    if(!seg)return seg;
    var raw=descForRaw(seg.id);
    var view={};Object.keys(seg).forEach(function(k){view[k]=seg[k];});
    if(raw.description!=null)view.description=String(raw.description);
    if(raw.router!=null)view.router=String(raw.router);
    if(raw.monetization!=null)view.monetization=String(raw.monetization);
    if(raw.how_arrives!=null)view.how_arrives=String(raw.how_arrives);
    if(raw.points_of_entry!=null){
      var poe=String(raw.points_of_entry).split(',').map(function(x){return x.trim();}).filter(function(x){return x.length>0;});
      view.points_of_entry=poe;
    }
    if(raw.userStoryText!=null||raw.userStoryPains!=null){
      var us=seg.userStory||{text:'',pains:''};
      view.userStory={
        title:us.title||'',
        text:raw.userStoryText!=null?String(raw.userStoryText):(us.text||''),
        pains:raw.userStoryPains!=null?String(raw.userStoryPains):(us.pains||'')
      };
    }
    return view;
  }
  function isDescEdited(id){
    var raw=descForRaw(id);
    for(var i=0;i<DESC_FIELDS.length;i++){if(raw[DESC_FIELDS[i]]!=null)return true;}
    return false;
  }

  function setSelected(id){write(STORAGE_KEY,{segment:id});}
  function segmentById(id){return segments.find(function(s){return s.id===id;})||null;}
  function selectedId(){return read(STORAGE_KEY,{segment:segments[0].id}).segment||segments[0].id;}
  function isMatrixView(){return selectedId()==='matrix';}
  function currentSegment(){return segmentById(selectedId())||segments[0];}

  function activeInnerTab(){return read(TAB_KEY,'funnel')||'funnel';}
  function setActiveInnerTab(tab){write(TAB_KEY,tab);}

  // --- Manual inputs management ---------------------------------------------
  // Per-segment shape: { [segmentId]: { visitClick, clickApp, appIssue, cpa, ltv,
  //                                     n_visitClick, n_clickApp, n_appIssue, n_cpa, n_ltv } }
  // Global (общие для всех сегментов): { visitContact, contactCost, n_visitContact, n_contactCost }
  function manualStore(){return read(MANUAL_KEY,{});}
  function globalStore(){var g=read(GLOBAL_KEY,{})||{};var out={};
    Object.keys(GLOBAL_DEFAULTS).forEach(function(k){out[k]=g[k]!=null?Number(g[k]):GLOBAL_DEFAULTS[k];});
    return out;
  }
  function globalRaw(){return read(GLOBAL_KEY,{})||{};}
  function setGlobal(key,value){var g=globalRaw();g[key]=value;write(GLOBAL_KEY,g);}
  function unsetGlobal(key){var g=globalRaw();delete g[key];write(GLOBAL_KEY,g);}
  function isGlobalEdited(key){var g=globalRaw();return g[key]!=null;}
  function manualFor(id){
    var seg=segmentById(id);if(!seg)return null;
    var store=manualStore();var saved=store[id]||{};
    var g=globalStore();
    var out={
      // глобальные показатели — общие для всех сегментов
      visitContact:g.visitContact,
      contactCost:g.contactCost,
      // показатели сегмента
      visitClick:saved.visitClick!=null?Number(saved.visitClick):seg.defaultCr.visitClick,
      clickApp:saved.clickApp!=null?Number(saved.clickApp):seg.defaultCr.clickApp,
      appIssue:saved.appIssue!=null?Number(saved.appIssue):seg.defaultCr.appIssue,
      cpa:saved.cpa!=null?Number(saved.cpa):seg.cpa,
      ltv:saved.ltv!=null?Number(saved.ltv):seg.ltv
    };
    // Доп. поля для сегментов с альтернативными сценариями монетизации (lead-sale).
    // Каждый сценарий имеет свой CPA и долю распределения трафика. Последний сценарий
    // получает остаток до 100% (так интуитивно работает мини-микс). Эффективный CPA —
    // взвешенное среднее по долям — используется как seg.cpa и как LTV в воронке
    // (т.к. в lead-sale модели LTV ≈ выплата за выдачу).
    if(seg.leadSale&&Array.isArray(seg.leadSale.options)){
      var opts=seg.leadSale.options;
      var leadOpts=[];
      var sumStoredShares=0;
      // 1) читаем сохранённые/дефолтные значения CPA и долей (кроме последней).
      for(var oi=0;oi<opts.length;oi++){
        var opt=opts[oi];
        var cpaKey=opt.cpaStorageKey;
        var cpaVal=saved[cpaKey]!=null?Number(saved[cpaKey]):opt.defaultCpa;
        cpaVal=clamp(cpaVal,opt.cpaMin!=null?opt.cpaMin:0,opt.cpaMax!=null?opt.cpaMax:1000000);
        out[cpaKey]=cpaVal;
        var shareVal;
        if(opt.shareStorageKey){
          shareVal=saved[opt.shareStorageKey]!=null?Number(saved[opt.shareStorageKey]):opt.defaultShare;
          shareVal=clamp(shareVal,0,100);
          out[opt.shareStorageKey]=shareVal;
          sumStoredShares+=shareVal;
        }else{
          shareVal=null; // последний — остаток
        }
        leadOpts.push({opt:opt,cpa:cpaVal,share:shareVal});
      }
      // 2) Подгоняем доли: суммарно сохранённые не должны превышать 100%,
      //    последний сценарий получает остаток (>= 0). Если переполнение —
      //    нормализуем все «сохранённые» доли пропорционально, остаток = 0.
      if(sumStoredShares>100){
        var scale=100/sumStoredShares;
        for(var li=0;li<leadOpts.length;li++){
          if(leadOpts[li].share!=null){
            leadOpts[li].share=Math.round(leadOpts[li].share*scale*10)/10;
            out[leadOpts[li].opt.shareStorageKey]=leadOpts[li].share;
          }
        }
        sumStoredShares=100;
      }
      var remainder=Math.max(0,100-sumStoredShares);
      for(var ri=0;ri<leadOpts.length;ri++){
        if(leadOpts[ri].share==null) leadOpts[ri].share=remainder;
      }
      // 3) Эффективный CPA — взвешенное среднее.
      var effective=0;
      for(var ei=0;ei<leadOpts.length;ei++){
        effective+=leadOpts[ei].cpa*leadOpts[ei].share/100;
      }
      out.cpaEffective=effective;
      out._leadOpts=leadOpts; // используется UI/расчётами; не сохраняется в storage
      // Перекрываем cpa эффективным значением, если пользователь не задал явно cpa.
      if(saved.cpa==null) out.cpa=effective;
      // Перекрываем LTV эффективным значением, если пользователь не задал явно ltv.
      if(saved.ltv==null) out.ltv=effective;
    }
    return out;
  }
  function isEdited(id,key){var store=manualStore();return store[id]&&store[id][key]!=null;}
  function setManual(id,key,value){
    var store=manualStore();
    if(!store[id])store[id]={};
    store[id][key]=value;
    write(MANUAL_KEY,store);
  }
  function unsetManual(id,key){
    var store=manualStore();
    if(store[id]&&store[id][key]!=null){
      delete store[id][key];
      if(Object.keys(store[id]).length===0)delete store[id];
      write(MANUAL_KEY,store);
    }
  }
  function resetManual(id){
    var store=manualStore();
    delete store[id];
    write(MANUAL_KEY,store);
  }
  // sample size helpers (объём выборки)
  function sampleFor(id,key){
    var store=manualStore();var saved=store[id]||{};var sk='n_'+key;
    return saved[sk]!=null?Number(saved[sk]):null;
  }
  function setSample(id,key,value){setManual(id,'n_'+key,value);}
  function unsetSample(id,key){unsetManual(id,'n_'+key);}
  function globalSampleFor(key){var g=globalStore();var sk='n_'+key;return g[sk]!=null?Number(g[sk]):null;}

  // --- Segment shares (matrix-only editor) ---------------------------------
  // Хранятся как объект {segmentId: percent}. По умолчанию используется
  // s.share (доля 0..1) из дефолтов сегмента. Пользовательские значения
  // применяются к segments[i].share при инициализации и при изменении.
  var DEFAULT_SHARES=segments.reduce(function(acc,s){acc[s.id]=s.share;return acc;},{});
  function applyStoredShares(){
    var saved=read(SHARES_KEY,null);
    if(!saved||typeof saved!=='object')return;
    segments.forEach(function(s){
      if(saved[s.id]!=null){
        var v=Number(saved[s.id]);
        if(isFinite(v)&&v>=0)s.share=v;
      }
    });
  }
  function setShare(id,fraction){
    var s=segmentById(id);if(!s)return;
    var v=clamp(fraction,0,1);
    s.share=v;
    var saved=read(SHARES_KEY,{})||{};
    saved[id]=v;
    write(SHARES_KEY,saved);
  }
  function resetShares(){
    write(SHARES_KEY,null);
    segments.forEach(function(s){s.share=DEFAULT_SHARES[s.id];});
  }

  // --- Finance model: state + computation -----------------------------------
  function isFinanceView(){return selectedId()==='finance';}
  function finRaw(){
    var raw=read(FINANCE_KEY,null);
    if(raw&&typeof raw==='object')return raw;
    for(var i=0;i<FINANCE_LEGACY_KEYS.length;i++){
      var legacy=read(FINANCE_LEGACY_KEYS[i],null);
      if(legacy&&typeof legacy==='object'){
        write(FINANCE_KEY,legacy);
        return legacy;
      }
    }
    return {};
  }
  function finInputs(){
    var raw=finRaw();var out={};
    Object.keys(FIN_DEFAULTS).forEach(function(k){
      out[k]=raw[k]!=null&&isFinite(Number(raw[k]))?Number(raw[k]):FIN_DEFAULTS[k];
    });
    return out;
  }
  function finIsEdited(key){var raw=finRaw();return raw[key]!=null;}
  function setFin(key,value){var raw=finRaw();raw[key]=value;write(FINANCE_KEY,raw);}
  function unsetFin(key){var raw=finRaw();if(raw[key]!=null){delete raw[key];write(FINANCE_KEY,raw);}}
  function resetFin(){write(FINANCE_KEY,{});}

  // Нормированные доли сегментов (0..1). Порядок соответствует FIN_SEG_META.
  function finSharesNormalized(inp){
    var raw=FIN_SEG_META.map(function(m){return Math.max(0,Number(inp[m.shareKey])||0);});
    var sum=raw.reduce(function(a,b){return a+b;},0)||1;
    return raw.map(function(v){return v/sum;});
  }

  // Считает контакты (оставленные телефоны) по каждому источнику для стартового месяца.
  //   contacts_i = budget_i / cpl_i (при cpl>0)
  //   средний CPL = Σ budget_i / Σ contacts_i (арифм. средневзвешенный)
  function finSourcesBreakdown(inp){
    var items=FIN_SRC_META.map(function(m){
      var b=Math.max(0,Number(inp[m.budgetKey])||0);
      var c=Math.max(0,Number(inp[m.cplKey])||0);
      var contacts=c>0?b/c:0;
      return {meta:m,budget:b,cpl:c,contacts:contacts};
    });
    var totalBudget=items.reduce(function(a,x){return a+x.budget;},0);
    var totalContacts=items.reduce(function(a,x){return a+x.contacts;},0);
    var avgCpl=totalContacts>0?totalBudget/totalContacts:0;
    return {items:items,totalBudget:totalBudget,totalContacts:totalContacts,avgCpl:avgCpl};
  }

  // Основной расчёт: возвращает помесячные ряды и агрегаты.
  //   contacts_t = contacts_0 × (1+g)^t          (бюджеты и контакты масштабируются)
  //   trafficCost_t = totalBudget × (1+g)^t
  //   issues_t = contacts_t × crContactApp × crAppIssue
  //   revenue_t = issues_t × Σ share_i·payout_i (+ CF-выручка при cfPayout>0)
  //   costs_t = trafficCost_t + FOT + Dev
  function computeFinance(){
    var inp=finInputs();
    var g=inp.monthlyGrowth/100;
    var conv=(inp.crContactApp/100)*(inp.crAppIssue/100);
    var shares=finSharesNormalized(inp);
    var payouts=FIN_SEG_META.map(function(m){return Number(inp[m.payoutKey])||0;});
    var blendedPayout=0;for(var si=0;si<shares.length;si++)blendedPayout+=shares[si]*payouts[si];
    var sources=finSourcesBreakdown(inp);
    var contacts0=sources.totalContacts;
    var trafficCost0=sources.totalBudget;
    var cfShare=clamp(inp.cfApprovalShare,0,100)/100;
    var n=FIN_MONTHS.length;
    var contacts=[],apps=[],issues=[],revenue=[],cost=[],profit=[],cumProfit=[],cumInvest=[],cfClients=[],cfRevenue=[],ppc=[];
    var runProfit=0,runInvest=0,peakNeed=0,paybackIdx=-1;
    var fixedMonthly=inp.fotMonthly+inp.devMonthly;
    for(var t=0;t<n;t++){
      var scale=Math.pow(1+g,t);
      var ct=contacts0*scale;
      var ap=ct*(inp.crContactApp/100);
      var iss=ap*(inp.crAppIssue/100);
      var segRev=iss*blendedPayout;
      var cfCl=iss*cfShare;
      var cfRev=cfCl*inp.cfPayout;
      var rev=segRev+cfRev;
      var c=trafficCost0*scale+fixedMonthly;
      var p=rev-c;
      runProfit+=p;runInvest+=c;
      if(runProfit<0)peakNeed=Math.max(peakNeed,-runProfit);
      if(paybackIdx<0&&runProfit>=0&&t>0)paybackIdx=t;
      contacts.push(ct);apps.push(ap);issues.push(iss);revenue.push(rev);cost.push(c);profit.push(p);
      cumProfit.push(runProfit);cumInvest.push(runInvest);cfClients.push(cfCl);cfRevenue.push(cfRev);
      ppc.push(iss>0?p/iss:0);
    }
    var lastRev=revenue[n-1],target=inp.targetRevenue;
    var revPerContact=conv*(blendedPayout+cfShare*inp.cfPayout);
    var neededGrowth=null;
    if(revPerContact>0&&contacts0>0&&n>1){
      var neededEndContacts=target/revPerContact;
      neededGrowth=(Math.pow(neededEndContacts/contacts0,1/(n-1))-1)*100;
    }
    return {
      inp:inp,months:FIN_MONTHS,shares:shares,payouts:payouts,blendedPayout:blendedPayout,conv:conv,
      revPerContact:revPerContact,sources:sources,
      contacts:contacts,apps:apps,issues:issues,revenue:revenue,cost:cost,profit:profit,
      cumProfit:cumProfit,cumInvest:cumInvest,cfClients:cfClients,cfRevenue:cfRevenue,ppc:ppc,
      lastRevenue:lastRev,lastProfit:profit[n-1],lastCumProfit:cumProfit[n-1],totalInvest:cumInvest[n-1],
      lastPpc:ppc[n-1],peakNeed:peakNeed,paybackIdx:paybackIdx,target:target,
      targetHit:lastRev>=target,neededGrowth:neededGrowth
    };
  }

  function millions(v){var a=Math.abs(Number(v)||0);if(a<1000000)return fmt(v)+' ₽';var m=(Number(v)||0)/1000000;return m.toLocaleString('ru-RU',{maximumFractionDigits:m>=10?1:2})+' млн ₽';}

  // --- Funnel computation ---------------------------------------------------
  // Шаги воронки: Visit → Контакт (общая CR) — параллельный замер контактов.
  //               Visit → Клик по офферу → Заявка → Выдача — путь монетизации.
  // Контакт и Клик считаются обе от Visit (parallel branches); цепочка
  // Клик → Заявка → Выдача — последовательная (как и раньше).
  function funnelFor(id,opts){
    opts=opts||{};
    var m=manualFor(id);
    var visit=BASE_VISITS;
    var crVC=clamp(m.visitContact,0,100);     // Визит → Контакт (общая)
    var crVK=clamp(m.visitClick,0,100);       // Визит → Клик по офферу
    var crKA=clamp(m.clickApp,0,100);         // Клик → Заявка
    var crAI=clamp(m.appIssue,0,100);         // Заявка → Выдача
    crVC=Math.min(crVC,100);crVK=Math.min(crVK,100);crKA=Math.min(crKA,100);crAI=Math.min(crAI,100);
    var contact=Math.round(visit*crVC/100);
    var click=Math.round(visit*crVK/100);
    var app=Math.round(click*crKA/100);
    var issue=Math.round(app*crAI/100);
    return {
      visit:visit,contact:contact,click:click,app:app,issue:issue,
      crVC:crVC,crVK:crVK,crKA:crKA,crAI:crAI
    };
  }
  // CAC (производный): стоимость привлечённого клиента =
  //   contactCost (общая стоимость одного контакта) × контакты сегмента / выдачи сегмента.
  function cacFor(id,opts){
    var m=manualFor(id);var f=funnelFor(id,opts);
    if(f.issue<=0)return 0;
    return m.contactCost*f.contact/f.issue;
  }
  function ltvCacFor(id){var m=manualFor(id);var cac=cacFor(id);return cac>0?m.ltv/cac:0;}

  // --- Charts wrapper -------------------------------------------------------
  function clearChart(id){if(charts[id]){charts[id].destroy();delete charts[id];}}
  function drawChart(id,config){var canvas=$(id);if(!canvas)return;if(typeof Chart==='undefined'){console.warn('CJM dashboard: custom Chart renderer is unavailable; ensure dashboard-app.js is loaded before cjm-unit-dashboard.js');return;}clearChart(id);charts[id]=new Chart(canvas,config);}

  // --- Top segment tabs (level 1) -------------------------------------------
  function renderSegmentTabs(){
    var host=$('cjmSegmentTabs');
    if(!host)return;
    var current=selectedId();
    var totalShare=segments.reduce(function(a,s){return a+(Number(s.share)||0);},0)||1;
    var html=segments.map(function(s){
      var active=current===s.id?' active':'';
      var norm=(s.share/totalShare)*100;
      return '<button class="cjm-seg-tab'+active+'" type="button" data-seg="'+esc(s.id)+'">'+
        '<span class="cjm-seg-dot" style="background:'+esc(s.color)+'"></span>'+
        '<span>'+esc(s.name)+'</span>'+
        '<span class="cjm-seg-share">'+pct(norm,0)+'</span>'+
      '</button>';
    }).join('');
    html+='<button class="cjm-seg-tab is-matrix'+(current==='matrix'?' active':'')+'" type="button" data-seg="matrix">'+
      '<span>Сводная матрица</span>'+
      '<span class="cjm-seg-share">все 5</span>'+
    '</button>';
    html+='<button class="cjm-seg-tab is-matrix'+(current==='finance'?' active':'')+'" type="button" data-seg="finance">'+
      '<span>Финмодель 2027</span>'+
      '<span class="cjm-seg-share">P&amp;L</span>'+
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
    var finance=isFinanceView();
    var innerNav=$('cjmInnerTabs');
    if(innerNav)innerNav.style.display='none';
    document.querySelectorAll('.cjm-panel').forEach(function(panel){panel.classList.remove('active');});
    if(finance){
      var fp=$('cjm-tab-finance');if(fp)fp.classList.add('active');
    }else if(matrix){
      var m=$('cjm-tab-matrix');if(m)m.classList.add('active');
    }else{
      // Единый лист сегмента: Описание → Схема → Юнит-экономика → Пример расчёта
      ['cjm-tab-cjm','cjm-tab-unit','cjm-tab-calc'].forEach(function(id){
        var el=$(id);if(el)el.classList.add('active');
      });
    }
  }

  // --- Hero (title + lead) updated per selection ---------------------------
  function renderHero(){
    var title=$('cjmHeroTitle'),lead=$('cjmHeroLead'),eyebrow=$('cjmHeroEyebrow');
    if(!title)return;
    if(isFinanceView()){
      eyebrow.textContent='Раздел сайта · Финмодель до декабря 2027';
      title.textContent='Финмодель 2027';
      lead.textContent='Единый план для презентации: сколько денег нужно вложить, какой прогноз продаж и какая ожидаемая прибыль. Воронка считается от реального трафика, база Центрофинанс работает как трекер лида, продажа лида обратно в Центрофинанс по 3000 ₽ убрана из выручки.';
    }else if(isMatrixView()){
      eyebrow.textContent='Раздел сайта · CJM & Юнит-экономика — сводный обзор';
      title.textContent='Сводная матрица всех сегментов';
      lead.textContent='Сравнение 5 сегментов рядом: воронки на 10 000 пользователей, юнит-экономика, каналы привлечения и LTV/CAC. Сегмент-лидер по выручке подсвечен. Чтобы перейти к деталям конкретного сегмента — нажмите на его таб сверху.';
    }else{
      var s=currentSegment();
      eyebrow.textContent='';
      title.textContent=s.label;
      lead.textContent='';
    }
  }

  // --- Funnel tab (per segment): 10 000 users + manual inputs + justify -----
  // Lightweight refresh — only updates derived outputs (steps, CAC) and dependent
  // panels without rebuilding the manual-input fields. Used from input handlers
  // so that the focused <input> survives every keystroke (бывший баг: курсор
  // пропадал после первой введённой цифры из-за полной перестройки DOM).
  function refreshFunnelOutputs(){
    if(isMatrixView())return;
    var s=currentSegment();
    var f=funnelFor(s.id);
    var host=$('cjmSegmentFunnel');
    if(host){
      var steps=[
        ['Visit',f.visit,'100% базы симуляции'],
        ['Контакт',f.contact,pct(f.crVC,1)+' Визит → Контакт · общая на все сегменты'],
        ['Клик по офферу',f.click,pct(f.crVK,1)+' Визит → Клик по офферу'],
        ['Заявка',f.app,pct(f.crKA,1)+' Клик → Заявка'],
        ['Выдача',f.issue,pct(f.crAI,1)+' Заявка → Выдача · мы зарабатываем']
      ];
      host.innerHTML=steps.map(function(st){
        return '<div class="cjm-funnel-step"><span>'+esc(st[0])+'</span><b>'+fmt(st[1])+'</b><p class="metric-sub">'+esc(st[2])+'</p></div>';
      }).join('');
    }
    var m=manualFor(s.id);
    var cacEl=document.querySelector('#cjmManualInputs .cjm-manual-derived .cjm-derived-value');
    var cacFormulaEl=document.querySelector('#cjmManualInputs .cjm-manual-derived .cjm-derived-formula');
    if(cacEl) cacEl.textContent=rub(cacFor(s.id));
    if(cacFormulaEl){
      cacFormulaEl.textContent='= Стоимость контакта × Контакты сегмента / Выдачи сегмента = '+
        rub(m.contactCost)+' × '+fmt(f.contact)+' / '+fmt(f.issue);
    }
    // Обновляем «Эффективный CPA» для lead-sale сегмента, не пересобирая инпуты
    // (чтобы не терять фокус ввода при наборе значений).
    var lsValueEl=document.querySelector('#cjmManualInputs .cjm-manual-leadsale .cjm-derived-value');
    var lsFormulaEl=document.querySelector('#cjmManualInputs .cjm-manual-leadsale .cjm-derived-formula');
    if(lsValueEl&&m.cpaEffective!=null) lsValueEl.textContent=rub(m.cpaEffective);
    if(lsFormulaEl&&m.cpaEffective!=null){
      lsFormulaEl.textContent=effectiveCpaFormula(s,m);
    }
  }

  // Формула эффективного CPA для сегмента с альтернативными сценариями монетизации.
  // Пример (2 опции): «= CPA(ЦФ) × доля(ЦФ) + CPA(МФО) × доля(МФО) = 3 000 ₽ × 50% + 2 750 ₽ × 50%».
  // Используется в renderFunnelPanel при первичной отрисовке и в refreshFunnelOutputs
  // при онлайн-обновлении (чтобы не пересобирать DOM инпутов и не терять фокус).
  function effectiveCpaFormula(seg,m){
    if(!seg||!seg.leadSale||!Array.isArray(seg.leadSale.options))return '';
    var opts=seg.leadSale.options;
    var sumStored=0;
    var leftParts=[];
    var rightParts=[];
    for(var i=0;i<opts.length;i++){
      var opt=opts[i];
      var share;
      if(opt.shareStorageKey){
        share=Number(m[opt.shareStorageKey])||0;
        sumStored+=share;
      }else{
        share=Math.max(0,100-sumStored);
      }
      var cpa=Number(m[opt.cpaStorageKey])||0;
      leftParts.push('CPA('+opt.shortLabel+') × доля('+opt.shortLabel+')');
      rightParts.push(rub(cpa)+' × '+pct(share,0));
    }
    return '= '+leftParts.join(' + ')+' = '+rightParts.join(' + ');
  }

  function renderFunnelPanel(){
    if(isMatrixView())return;
    var s=currentSegment();
    var f=funnelFor(s.id);
    var steps=[
      ['Visit',f.visit,'100% базы симуляции'],
      ['Контакт',f.contact,pct(f.crVC,1)+' Визит → Контакт · общая на все сегменты'],
      ['Клик по офферу',f.click,pct(f.crVK,1)+' Визит → Клик по офферу'],
      ['Заявка',f.app,pct(f.crKA,1)+' Клик → Заявка'],
      ['Выдача',f.issue,pct(f.crAI,1)+' Заявка → Выдача · мы зарабатываем']
    ];
    var host=$('cjmSegmentFunnel');
    if(host){
      host.innerHTML=steps.map(function(st){
        return '<div class="cjm-funnel-step"><span>'+esc(st[0])+'</span><b>'+fmt(st[1])+'</b><p class="metric-sub">'+esc(st[2])+'</p></div>';
      }).join('');
    }

    var m=manualFor(s.id);
    var cacDerived=cacFor(s.id);

    var globalFields=[
      {key:'visitContact',label:'CR · Визит → Контакт (общая для всех сегментов)',suffix:'%',step:'0.1',min:0,max:100},
      {key:'contactCost',label:'Стоимость привлечения контакта (общая)',suffix:'₽',step:'1',min:0,max:1000000}
    ];
    var segFields=[
      {key:'visitClick',label:'CR · Визит → Клик по офферу',suffix:'%',step:'0.1',min:0,max:100},
      {key:'clickApp',label:'CR · Клик по офферу → Заявка',suffix:'%',step:'0.1',min:0,max:100},
      {key:'appIssue',label:'CR · Заявка → Выдача',suffix:'%',step:'0.1',min:0,max:100},
      {key:'cpa',label:'CPA / выплата партнёра',suffix:'₽',step:'1',min:0,max:1000000},
      {key:'ltv',label:'LTV (1 год)',suffix:'₽',step:'1',min:0,max:1000000}
    ];
    // «Новый клиент» (2 опции) / «Действующий» (3 опции): альтернативные сценарии
    // монетизации лида (см. CJM-схему) — список CPA + долей распределения,
    // эффективный CPA = взвешенное среднее. Поля редактируются вручную, чтобы гибко
    // настраивать математику. Последний сценарий получает остаток до 100% автоматически.
    var leadSaleFields=[];
    if(s.leadSale&&Array.isArray(s.leadSale.options)){
      s.leadSale.options.forEach(function(opt){
        leadSaleFields.push({key:opt.cpaStorageKey,label:opt.label,suffix:'₽',step:'50',min:opt.cpaMin!=null?opt.cpaMin:0,max:opt.cpaMax!=null?opt.cpaMax:1000000});
        if(opt.shareStorageKey){
          leadSaleFields.push({key:opt.shareStorageKey,label:'Доля сценария «'+opt.shortLabel+'» (микс)',suffix:'%',step:'1',min:0,max:100});
        }
      });
    }

    function fieldInputHtml(f,value,edited,inputAttr){
      return '<label>'+
        '<span class="cjm-manual-label">'+esc(f.label)+
          (edited?' <span class="cjm-manual-suffix" title="Значение изменено вручную">· изменено</span>':'')+
        '</span>'+
        '<input type="number" inputmode="decimal" '+
          'min="'+f.min+'" max="'+f.max+'" step="'+f.step+'" '+
          'value="'+esc(value)+'" '+inputAttr+' '+
          (edited?'class="is-edited"':'')+'>'+
      '</label>';
    }

    var inputs=$('cjmManualInputs');
    if(inputs){
      // 1) глобальный блок
      var globalHtml='<div class="cjm-manual-section"><div class="cjm-manual-section-title">Общие показатели (для всех сегментов)</div><div class="cjm-manual-grid-inner">';
      globalHtml+=globalFields.map(function(f){
        var edited=isGlobalEdited(f.key);
        return fieldInputHtml(f,m[f.key],edited,'data-global="'+esc(f.key)+'"');
      }).join('');
      globalHtml+='</div></div>';
      // 2) производный CAC
      var cacBlock='<div class="cjm-manual-section cjm-manual-derived">'+
        '<div class="cjm-manual-section-title">Производный показатель</div>'+
        '<div class="cjm-derived-row">'+
          '<span class="cjm-derived-label">CAC · стоимость привлечённого клиента (сегмент)</span>'+
          '<span class="cjm-derived-value">'+esc(rub(cacDerived))+'</span>'+
          '<span class="cjm-derived-formula">= Стоимость контакта × Контакты сегмента / Выдачи сегмента = '+
            esc(rub(m.contactCost))+' × '+esc(fmt(f.contact))+' / '+esc(fmt(f.issue))+
          '</span>'+
        '</div>'+
      '</div>';
      // 3) сегментный блок
      var segHtml='<div class="cjm-manual-section"><div class="cjm-manual-section-title">Показатели сегмента «'+esc(s.name)+'»</div><div class="cjm-manual-grid-inner">';
      segHtml+=segFields.map(function(f){
        var edited=isEdited(s.id,f.key);
        return fieldInputHtml(f,m[f.key],edited,'data-key="'+esc(f.key)+'"');
      }).join('');
      segHtml+='</div></div>';
      // 4) блок lead-sale — для сегментов с альтернативными сценариями монетизации лида
      var leadSaleHtml='';
      if(leadSaleFields.length){
        var effective=m.cpaEffective!=null?m.cpaEffective:0;
        var optsCount=(s.leadSale.options||[]).length;
        var sectionTitle=s.leadSale.inputsTitle||(optsCount===2?'Продажа лида · два варианта монетизации':'Продажа лида · '+optsCount+' альтернативных сценария монетизации');
        leadSaleHtml='<div class="cjm-manual-section cjm-manual-leadsale">'+
          '<div class="cjm-manual-section-title">'+esc(sectionTitle)+'</div>'+
          '<div class="cjm-manual-grid-inner">'+
            leadSaleFields.map(function(f){
              var edited=isEdited(s.id,f.key);
              return fieldInputHtml(f,m[f.key],edited,'data-key="'+esc(f.key)+'"');
            }).join('')+
          '</div>'+
          '<div class="cjm-derived-row">'+
            '<span class="cjm-derived-label">Эффективный CPA (микс)</span>'+
            '<span class="cjm-derived-value">'+esc(rub(effective))+'</span>'+
            '<span class="cjm-derived-formula">'+esc(effectiveCpaFormula(s,m))+'</span>'+
          '</div>'+
        '</div>';
      }
      inputs.innerHTML=globalHtml+cacBlock+segHtml+leadSaleHtml;

      // bindings — segment inputs
      inputs.querySelectorAll('input[data-key]').forEach(function(input){
        input.addEventListener('input',function(){
          var key=input.getAttribute('data-key');
          var raw=input.value;
          if(raw===''){unsetManual(s.id,key);}
          else{setManual(s.id,key,Number(raw));}
          input.classList.toggle('is-edited',isEdited(s.id,key));
          refreshFunnelOutputs();renderUnitPanel();renderCalcPanel();renderJourneyPanel();renderScenarioComparePanel();
          if(activeInnerTab()==='unit')requestAnimationFrame(renderCharts);
        });
      });
      // bindings — global inputs (CR · Визит→Контакт, Стоимость контакта)
      inputs.querySelectorAll('input[data-global]').forEach(function(input){
        input.addEventListener('input',function(){
          var key=input.getAttribute('data-global');
          var raw=input.value;
          if(raw===''){unsetGlobal(key);}
          else{setGlobal(key,Number(raw));}
          input.classList.toggle('is-edited',isGlobalEdited(key));
          refreshFunnelOutputs();renderUnitPanel();renderCalcPanel();renderJourneyPanel();renderScenarioComparePanel();
          if(activeInnerTab()==='unit')requestAnimationFrame(renderCharts);
        });
      });
    }

    var just=$('cjmJustifications');
    if(just){
      var rows=[
        ['CR · Визит → Клик по офферу',s.justify.visitClick],
        ['CR · Клик по офферу → Заявка',s.justify.clickApp],
        ['CR · Заявка → Выдача',s.justify.appIssue],
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
        renderFunnelPanel();renderUnitPanel();renderCalcPanel();renderScenarioComparePanel();
        if(activeInnerTab()==='unit')requestAnimationFrame(renderCharts);
      });
    }
  }

  // --- CJM journey panel (per segment) -- блочная карточка «Описание сегмента»
  // Поддерживает inline-редактирование текстовых блоков: «Описание сегмента»,
  // «User Story · мотив клиента» (текст + боли), «Маршрутизация», «Монетизация»,
  // «Точки входа», «Как попадает». Правки сохраняются в localStorage по сегменту
  // (см. DESC_KEY) и применяются при следующей загрузке страницы.
  function renderJourneyPanel(){
    if(isMatrixView()){renderRoutingDiagram();return;}
    var host=$('cjmJourneyHost');if(!host)return;
    var base=currentSegment();
    var s=segmentWithDescOverrides(base);
    var poe=(s.points_of_entry&&s.points_of_entry.length)?s.points_of_entry.join(', '):'';

    // Блок «Показатели» убран — те же значения доступны в «Юнит-экономике».
    // Пропускаем пустые секции (например, у «Действующего» нет showcase).
    var c=calcFor(s.id);
    var profitTone=c.profit>=0?'tone-green':'tone-red';
    var profitExampleHtml='<b>База:</b> '+fmt(BASE_VISITS)+' визитов · '+
      '<b>Выдач:</b> '+fmt(c.f.issue)+' · '+
      '<b>Выручка:</b> '+rub(c.revenue)+' (LTV '+rub(c.m.ltv)+' × '+fmt(c.f.issue)+' выдач) · '+
      '<b>Затраты на контакты:</b> '+rub(c.cost)+' ('+rub(c.m.contactCost)+' × '+fmt(c.f.contact)+' контактов) · '+
      '<b>Прибыль:</b> <span class="'+profitTone+'">'+rub(c.profit)+'</span>';
    // «Пример расчёта прибыли» скрыт во всех сегментах описания: значения доступны
    // во вкладке «Юнит-экономика» и в блоке «Пример расчёта на 10 000 пользователей».
    // Блок «Витрина» убран из описания всех сегментов по согласованию.
    var hideProfitExample={new:true,repeat:true,rejected:true,sleeping:true,noncore:true}[s.id];

    // Редактируемый блок: contenteditable с data-edit-field для последующего сбора значений.
    function editable(field,value,placeholder,extraCls){
      var cls='cjm-editable'+(extraCls?' '+extraCls:'');
      return '<span class="'+cls+'" contenteditable="true" spellcheck="true" '+
        'data-edit-field="'+esc(field)+'" '+
        'data-placeholder="'+esc(placeholder||'')+'" '+
        'role="textbox" aria-multiline="true" aria-label="'+esc(placeholder||field)+'">'+
        esc(value||'')+'</span>';
    }
    var userStoryHtml=
      '<span class="cjm-user-story-text">'+editable('userStoryText',(s.userStory&&s.userStory.text)||'','Описание мотивации клиента')+'</span>'+
      '<span class="cjm-user-story-pains"><b>Боли и страхи:</b> '+editable('userStoryPains',(s.userStory&&s.userStory.pains)||'','Боли и страхи клиента')+'</span>';

    var blocks=[
      {h:'Описание сегмента',html:editable('description',s.description||'','Опишите сегмент'),wide:true,always:true},
      {h:'User Story · мотив клиента',html:userStoryHtml,wide:true,storyClass:true,always:true},
      {h:'Маршрутизация',html:editable('router',s.router||'','Опишите маршрутизацию'),always:true},
      {h:'Монетизация',html:editable('monetization',s.monetization||'','Опишите схему монетизации'),always:true},
      {h:'Точки входа',html:editable('points_of_entry',poe,'Перечислите через запятую'),always:true},
      {h:'Как попадает',html:editable('how_arrives',s.how_arrives||'','Опишите, как клиент попадает в сегмент'),always:true},
      {h:'Пример расчёта прибыли',html:hideProfitExample?'':profitExampleHtml,wide:true}
    ];
    var bodyHtml=blocks.filter(function(b){return b.always||b.html;}).map(function(b){
      var extraCls=b.storyClass?' cjm-user-story':'';
      return '<section class="cjm-seg-block'+(b.wide?' is-wide':'')+extraCls+'"><h3>'+esc(b.h)+'</h3><p>'+b.html+'</p></section>';
    }).join('');

    var editedBadge=isDescEdited(s.id)?'<span class="cjm-desc-badge" title="Описание изменено вручную">изменено</span>':'';
    var controlsHtml='<div class="cjm-desc-controls">'+
      '<button type="button" class="ghost-btn cjm-desc-save" data-desc-save>Сохранить описания</button>'+
      '<button type="button" class="cjm-reset-btn" data-desc-reset'+(isDescEdited(s.id)?'':' disabled')+'>Сбросить к исходному</button>'+
      '<span class="cjm-desc-status" data-desc-status aria-live="polite"></span>'+
      '</div>';

    host.innerHTML='<article class="card cjm-seg-desc" style="border-top:4px solid '+esc(s.color)+'">'+
      '<div class="card-title"><div>'+
        '<h2>'+esc(s.label)+'</h2>'+editedBadge+
      '</div></div>'+
      '<div class="cjm-seg-desc-body cjm-seg-desc-blocks">'+bodyHtml+'</div>'+
      controlsHtml+
    '</article>';

    // --- Bindings: save / reset ---------------------------------------------
    var saveBtn=host.querySelector('[data-desc-save]');
    var resetBtn=host.querySelector('[data-desc-reset]');
    var statusEl=host.querySelector('[data-desc-status]');
    function flash(text,tone){
      if(!statusEl)return;
      statusEl.textContent=text;
      statusEl.classList.remove('is-ok','is-warn');
      if(tone)statusEl.classList.add('is-'+tone);
      clearTimeout(flash._t);
      flash._t=setTimeout(function(){if(statusEl)statusEl.textContent='';},2500);
    }
    if(saveBtn){
      saveBtn.addEventListener('click',function(){
        var fields={};
        host.querySelectorAll('[data-edit-field]').forEach(function(el){
          var key=el.getAttribute('data-edit-field');
          // Берём именно текст (исключаем случайный HTML, который мог попасть при paste).
          var val=(el.innerText||el.textContent||'').replace(/\u00a0/g,' ').trim();
          fields[key]=val;
        });
        setDescFields(s.id,fields);
        flash('Сохранено','ok');
        // Полный ререндер карточки + связанной диаграммы, чтобы значения подхватились.
        renderJourneyPanel();
      });
    }
    if(resetBtn&&!resetBtn.disabled){
      resetBtn.addEventListener('click',function(){
        if(typeof window!=='undefined'&&window.confirm){
          if(!window.confirm('Сбросить описания сегмента к исходным значениям?'))return;
        }
        resetDesc(s.id);
        flash('Сброшено к исходному','warn');
        renderJourneyPanel();
      });
    }
    // Ctrl/Cmd+Enter в любом редактируемом поле — быстрый сейв.
    host.querySelectorAll('[data-edit-field]').forEach(function(el){
      el.addEventListener('keydown',function(ev){
        if((ev.ctrlKey||ev.metaKey)&&ev.key==='Enter'){ev.preventDefault();if(saveBtn)saveBtn.click();}
      });
    });

    renderRoutingDiagram();
  }


  // --- Smart Safe Router block-flow diagram (Miro-style, inline SVG) --------
  // В CJM выбранного сегмента отображается ТОЛЬКО ветка этого сегмента
  // (entries → Выручай.ру → Проверка ЦФ → step → fork → outs).
  // В сводной матрице рендерим полный мульти-ветвистый плакат — все 5 веток сразу.
  function renderRoutingDiagram(){
    var host=$('cjmRouteDiagram');if(!host)return;
    var s=isMatrixView()?null:currentSegment();
    var activeBranch=s?s.branch:null;
    host.classList.toggle('has-active',!!activeBranch);
    host.classList.toggle('is-single',!!activeBranch);

    // Полная модель веток (см. ТЗ по каждому сегменту).
    var BW=240,BH=72;                        // box width/height
    var DW=200,DH=84;                        // diamond width/height
    var entries=['SEO','Контекстная реклама','Ремаркетинг','Соц. сети'];
    // Получаем настраиваемые ставки продажи лида «Нового клиента»
    // (для подписи к веткам диаграммы — отражают актуальные значения CPA).
    var newSeg=segmentById('new');
    var newLead=(newSeg&&newSeg.leadSale)||{cpaCf:3000,cpaThird:2750,cpaThirdMin:2500,cpaThirdMax:3000};
    var newCpaCfLabel=rub(newLead.cpaCf);
    var newCpaThirdLabel=newLead.cpaThirdMin!=null&&newLead.cpaThirdMax!=null
      ? fmt(newLead.cpaThirdMin)+'–'+rub(newLead.cpaThirdMax)
      : rub(newLead.cpaThird);
    var allBranches=[
      { key:'new', color:'var(--yellow)', name:'Новый клиент',
        seg:{t:'Новый клиент',s:'Жёлтый · нет в базе ЦФ'},
        step:{t:'Анкета · Скоринг',s:'Преквалификация по квизу'},
        fork:{ type:'diamond', t:'Кому продаём лид?', s:'Маршрутизация лида',
          outs:[ {t:'Лид в Центрофинанс',s:'CPA '+newCpaCfLabel+' за выдачу',label:'ЦФ',color:'var(--green)'},
                 {t:'Лид в стороннюю МФО',s:'CPA '+newCpaThirdLabel+' ₽ за выдачу · ставка настраивается',label:'СТОР.',color:'var(--orange)'} ] } },
      { key:'repeat', color:'var(--green)', name:'Действующий клиент',
        seg:{t:'Действующий клиент',s:'Зелёный · 1+ займ в ЦФ'},
        step:{t:'Роутер узнаёт «Действующего»',s:'Идентификация по базе ЦФ'},
        // Три альтернативных сценария монетизации (либо / либо / либо).
        // На клиента показываем ОДИН из трёх — не суммируются, разные сценарии.
        fork:{ type:'split', t:'Альтернативные сценарии монетизации', s:'Показываем один из трёх — либо / либо / либо',
          outs:[ {t:'Продукты ЦФ',s:'Top-up · повторный заём · программа лояльности',label:'Сценарий А',color:'var(--green)'},
                 {t:'Добор в другой МФО',s:'Партнёрская МФО · доп. лимит',label:'Сценарий Б',color:'var(--orange)'},
                 {t:'Банковские карты (дебет / кредит)',s:'CPA 1 000–5 000 ₽',label:'Сценарий В',color:'var(--blue)'} ] } },
      { key:'rejected', color:'var(--red)', name:'Отказной клиент',
        seg:{t:'Отказной клиент',s:'Красный · отказ ЦФ'},
        step:{t:'Пробив чекером по номеру',s:'Фильтрация баз партнёров'},
        fork:{ type:'terminal',
          outs:[ {t:'Витрина МФО · 5 офферов',s:'Сортировка по EPC и AR (Вебзайм, Credit7…) · CPA 2,0–2,4 т.₽',color:'var(--orange)'} ] } },
      { key:'sleeping', color:'var(--blue)', name:'Спящий клиент',
        seg:{t:'Спящий клиент',s:'Синий · >30 дней'},
        step:{t:'Welcome-back · Пробив чекером',s:'Реактивация в контур ЦФ'},
        fork:{ type:'terminal',
          outs:[ {t:'Показ 5 офферов, где клиента нет в базе',s:'Welcome ЦФ + витрина 5 МФО · CPA 0 ₽ при возврате в ЦФ',color:'var(--blue)'} ] } },
      { key:'noncore', color:'var(--violet)', name:'Непрофильный клиент',
        seg:{t:'Непрофильный клиент',s:'Фиолетовый · вне профиля ЦФ'},
        step:{t:'Чекер: непрофильный',s:'ЦФ не готов выдать продукт'},
        fork:{ type:'terminal',
          outs:[ {t:'Витрина банковских продуктов / 5 МФО',s:'Кредиты, дебетовые карты банков · либо 5 МФО · CPA 1–6 т.₽',color:'var(--violet)'} ] } }
    ];

    var renderBranches;
    var W,H;
    if(activeBranch){
      // Single-segment view: только ветка активного сегмента, компактная высота.
      // Высота увеличена, чтобы вертикальная колонка из трёх hub-блоков
      // (Выручай.ру → Проверка по базе ЦФ → Квиз) уместилась симметрично.
      H=680;
      renderBranches=allBranches.filter(function(b){return b.key===activeBranch;}).map(function(b){
        return Object.assign({},b,{cy:H/2});
      });
      W=2080;
    }else{
      // Матричный вид — все 5 веток рядом.
      renderBranches=allBranches.map(function(b,i){return Object.assign({},b,{cy:130+i*240});});
      W=2080; H=1240;
    }

    // Колонки одинаковы в обоих режимах.
    // col[0]=entries, col[1]=hub-колонка (Выручай.ру / Проверка ЦФ / Квиз),
    // col[2]=сегмент, col[3]=шаг, col[4]=fork. Дополнительная колонка для
    // финального tail-блока (например, «Продукты ЦФ» в ветке «Действующий»)
    // вычисляется уже относительно outs.
    var col=[60,360,660,960,1240];
    // Entry column (4 stacked boxes at x=col[0]) — вертикально центрируем относительно H.
    var entrySpan=BH*4 + 48*3; // 4 блока + 3 промежутка по 48
    var entryStartY=Math.max(60,(H-entrySpan)/2);
    var entryY=[0,1,2,3].map(function(i){return entryStartY+i*(BH+48);});
    var hubX=col[1], hubW=BW;
    // Три hub-блока выстроены вертикально в col[1]: Выручай.ру → Проверка по базе ЦФ → Квиз.
    // Стек центрируется по H/2: общий размер = 3*BH + 2*60 = 336.
    var hubGap=60;
    var hubStack=BH*3+hubGap*2;
    var siteY=Math.max(60,(H-hubStack)/2);
    var routerY=siteY+BH+hubGap;
    var quizY=routerY+BH+hubGap;

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
          '<div xmlns="http://www.w3.org/1999/xhtml" style="height:100%;display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center;padding:0 16px">'+
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
    svg.push(box(hubX,siteY,hubW,BH,{t:'Выручай.ру',s:'Ввод телефона (контакт)',hub:true}));
    // Hub: Проверка по базе ЦФ
    svg.push(box(hubX,routerY,hubW,BH,{t:'Проверка по базе ЦФ',s:'Smart Safe Router',hub:true}));
    // Hub: Квиз — интерактивная преквалификация после идентификации в базе ЦФ.
    // Уточняет сумму/срок/тип займа и поднимает CR Visit→Lead перед маршрутизацией
    // по сегментам (5 веток снизу).
    svg.push(box(hubX,quizY,hubW,BH,{t:'Квиз',s:'Преквалификация · уточнение запроса',hub:true}));
    // Entry → Выручай.ру
    entries.forEach(function(_,i){
      svg.push(edge(col[0]+BW,entryY[i]+BH/2,hubX,siteY+BH/2));
    });
    // Выручай.ру → Проверка по базе ЦФ
    svg.push(edge(hubX+hubW/2,siteY+BH,hubX+hubW/2,routerY));
    // Проверка по базе ЦФ → Квиз
    svg.push(edge(hubX+hubW/2,routerY+BH,hubX+hubW/2,quizY));

    // Branches
    renderBranches.forEach(function(br){
      svg.push('<g class="ssr-branch ssr-branch-'+br.key+(activeBranch===br.key?' is-active':'')+'">');
      var cy=br.cy, segX=col[2], stepX=col[3], forkX=col[4];
      function top(c){return c-BH/2;}
      // Segment box + квиз → segment (теперь маршрутизация идёт после квиза)
      svg.push(box(segX,top(cy),BW,BH,{t:br.seg.t,s:br.seg.s,borderColor:br.color}));
      svg.push(edge(hubX+hubW,quizY+BH/2,segX,cy));
      // Step box
      svg.push(box(stepX,top(cy),BW,BH,{t:br.step.t,s:br.step.s,borderColor:br.color}));
      svg.push(edge(segX+BW,cy,stepX,cy));

      var fork=br.fork;
      // Самая правая координата ветки — нужна, чтобы поставить tail-блок
      // (например, «Продукты ЦФ» для «Действующего») в самом конце схемы.
      var branchRightX=forkX+BW;
      var tailFromCy=cy;
      if(fork.type==='terminal'){
        var o=fork.outs[0];
        svg.push(box(forkX,top(cy),BW,BH,{t:o.t,s:o.s,out:true,borderColor:o.color}));
        svg.push(edge(stepX+BW,cy,forkX,cy));
        branchRightX=forkX+BW;
        tailFromCy=cy;
      }else{
        var nodeRight;
        if(fork.type==='diamond'){
          svg.push(diamond(forkX,cy-DH/2,DW,DH,{t:fork.t,s:fork.s,borderColor:br.color}));
          nodeRight=forkX+DW;
        }else{ // split — узел-разветвление (блок-хаб)
          svg.push(box(forkX,top(cy),BW,BH,{t:fork.t,s:fork.s,hub:true,borderColor:br.color}));
          nodeRight=forkX+BW;
        }
        svg.push(edge(stepX+BW,cy,forkX,cy));
        // N выходов — вертикально симметрично относительно cy.
        // 2 выхода → ±(BH/2+16); 3 выхода → top/mid/bot c шагом (BH+8).
        var outX=nodeRight+40;
        var nOuts=fork.outs.length;
        var outCys;
        if(nOuts===3){
          var d3=BH+8; // шаг между центрами выходов (≈80px)
          outCys=[cy-d3,cy,cy+d3];
        }else if(nOuts===2){
          outCys=[cy-(BH/2+16),cy+(BH/2+16)];
        }else{
          // fallback: равномерно распределяем по высоте
          var step=BH+8;
          var start=cy-step*(nOuts-1)/2;
          outCys=[];
          for(var oi=0;oi<nOuts;oi++)outCys.push(start+oi*step);
        }
        fork.outs.forEach(function(out,i){
          var ocy=outCys[i];
          svg.push(box(outX,ocy-BH/2,BW,BH,{t:out.t,s:out.s,out:true,borderColor:out.color}));
          svg.push(edge(nodeRight,cy,outX,ocy,out.label));
        });
        branchRightX=outX+BW;
        tailFromCy=cy;
      }
      // Tail-блок ветки (например, «Продукты ЦФ» в самом конце для «Действующего»).
      // Линкуется от центра ветки (или от каждого выхода для split-fork с двумя outs).
      if(br.tail){
        var tailX=branchRightX+40;
        svg.push(box(tailX,top(cy),BW,BH,{t:br.tail.t,s:br.tail.s,out:true,borderColor:br.tail.color||br.color}));
        if(fork.type==='split'&&fork.outs&&fork.outs.length===2){
          // Сводим обе ветки кросс-сейла в финальный блок «Продукты ЦФ».
          // outs нарисованы в (outX, upCy/loCy), их правые края — на outX+BW = branchRightX.
          var outRight=branchRightX;
          var upCy2=cy-(BH/2+16), loCy2=cy+(BH/2+16);
          svg.push(edge(outRight,upCy2,tailX,cy));
          svg.push(edge(outRight,loCy2,tailX,cy));
        }else{
          svg.push(edge(branchRightX,tailFromCy,tailX,cy));
        }
      }
      svg.push('</g>');
    });

    svg.push('</svg>');
    host.innerHTML=svg.join('');
  }

  // --- Пример расчёта (полная воронка → выручка) ----------------------------
  function calcFor(id,opts){
    var s=segmentById(id);var f=funnelFor(id,opts);var m=manualFor(id);
    var revenue=f.issue*m.ltv;
    var cac=cacFor(id,opts);
    // Маркетинговые затраты по сегменту = стоимость контактов сегмента.
    var cost=m.contactCost*f.contact;
    var profit=revenue-cost;
    return {s:s,f:f,m:m,cac:cac,revenue:revenue,cost:cost,profit:profit};
  }
  function renderCalcPanel(){
    if(isMatrixView())return;
    var s=currentSegment();
    var c=calcFor(s.id);
    var card=$('cjmCalcSegmentCard');
    if(card){
      var steps=[
        {n:'1. Визиты',v:fmt(c.f.visit),sub:'База расчёта · 10 000'},
        {n:'2. Контакт',v:fmt(c.f.contact),sub:pct(c.f.crVC,1)+' Визит → Контакт · общая на все сегменты'},
        {n:'3. Клик по офферу',v:fmt(c.f.click),sub:pct(c.f.crVK,1)+' Визит → Клик по офферу'},
        {n:'4. Заявка',v:fmt(c.f.app),sub:pct(c.f.crKA,1)+' Клик → Заявка'},
        {n:'5. Выдача',v:fmt(c.f.issue),sub:pct(c.f.crAI,1)+' Заявка → Выдача'},
        {n:'6. Затраты на контакты',v:rub(c.cost),sub:'Стоимость контакта '+rub(c.m.contactCost)+' × '+fmt(c.f.contact)+' контактов'},
        {n:'7. CAC (произв.)',v:rub(c.cac),sub:'= Затраты / выдачи = '+rub(c.cost)+' / '+fmt(c.f.issue)},
        {n:'8. Выручка',v:rub(c.revenue),sub:'LTV '+rub(c.m.ltv)+' × '+fmt(c.f.issue)+' выдач',revenue:true},
        {n:'9. Прибыль',v:rub(c.profit),sub:'= Выручка − Затраты = '+rub(c.revenue)+' − '+rub(c.cost),profit:true,negative:c.profit<0},
        {n:'10. Прибыль на 1 человека',v:rub(c.f.visit>0?c.profit/c.f.visit:0),sub:'= Прибыль / '+fmt(c.f.visit)+' визитов',profit:true,negative:c.profit<0}
      ];
      card.innerHTML='<div class="card-title"><div><span class="eyebrow" style="color:'+esc(s.color)+'">'+esc(s.label)+'</span><h2>Сквозной расчёт по сегменту</h2></div></div>'+
        '<div class="cjm-calc-flow">'+steps.map(function(st){
          return '<div class="cjm-calc-step'+(st.revenue?' cs-revenue':'')+(st.profit?(st.negative?' cs-loss':' cs-profit'):'')+'"><span class="cs-name">'+esc(st.n)+'</span><span class="cs-val">'+esc(st.v)+'</span><span class="cs-sub">'+esc(st.sub)+'</span></div>';
        }).join('')+'</div>';
    }
  }

  // --- Сравнение сценариев монетизации трафика (lead-sale сегменты) ---------
  // Для сегментов с `leadSale.options` считаем по одному сценарию на каждую опцию:
  // в каждом сценарии 100% трафика идёт через конкретный канал, остальные = 0%.
  // Показываем карточки рядом и сравниваем выручку, затраты, прибыль и прибыль
  // на 1 человека — чтобы понять, по какому сценарию лучше запускать сегмент.
  // Подсвечиваем лучший вариант по прибыли. «Новый» — 2 сценария (А/Б),
  // «Действующий» — 3 (А/Б/В): Top-up ЦФ / Добор МФО / Банковские карты.
  function calcScenario(id, cpaOverride){
    // Считает экономику сегмента, переопределяя CPA/LTV эффективным значением
    // сценария (в lead-sale модели LTV ≈ выплата за выдачу). Воронка остаётся
    // той же — отличается только монетизация выдачи.
    var s=segmentById(id);if(!s)return null;
    var f=funnelFor(id);
    var m=manualFor(id);
    var cpa=Number(cpaOverride)||0;
    var revenue=f.issue*cpa;          // LTV ≈ CPA (lead-sale)
    var cost=m.contactCost*f.contact; // те же затраты на контакты
    var profit=revenue-cost;
    var cac=f.issue>0?(m.contactCost*f.contact/f.issue):0;
    var profitPerVisit=f.visit>0?profit/f.visit:0;
    return {s:s,f:f,m:m,cpa:cpa,revenue:revenue,cost:cost,profit:profit,cac:cac,profitPerVisit:profitPerVisit};
  }
  function renderScenarioComparePanel(){
    var host=$('cjmScenarioCompareHost');
    if(!host)return;
    if(isMatrixView()){host.innerHTML='';return;}
    var s=currentSegment();
    if(!s||!s.leadSale||!Array.isArray(s.leadSale.options)||s.leadSale.options.length<2){host.innerHTML='';return;}
    var m=manualFor(s.id);
    var opts=s.leadSale.options;
    // Считаем по сценарию на каждую опцию (100% трафика → этот канал).
    var scenarios=opts.map(function(opt){
      var sc=calcScenario(s.id,m[opt.cpaStorageKey]);
      if(sc) sc.opt=opt;
      return sc;
    }).filter(function(x){return !!x;});
    if(scenarios.length<2){host.innerHTML='';return;}
    // Лучший сценарий — по прибыли. Если разница незначительна (< 0.5% от max|profit|) —
    // считаем «паритетом» и не подсвечиваем «Лучший сценарий».
    var maxProfit=-Infinity, secondProfit=-Infinity, winnerIdx=-1;
    scenarios.forEach(function(sc,i){
      if(sc.profit>maxProfit){secondProfit=maxProfit;maxProfit=sc.profit;winnerIdx=i;}
      else if(sc.profit>secondProfit){secondProfit=sc.profit;}
    });
    var absMax=Math.max(Math.abs(maxProfit),Math.abs(secondProfit),1);
    var isTie=Math.abs(maxProfit-secondProfit)/absMax<0.005;

    // Чтобы карточки сценариев были визуально симметричны, строим их одинаково.
    function rowsHtml(scn,isWinner){
      var profitTone=scn.profit>=0?'tone-green':'tone-red';
      var ppvTone=scn.profitPerVisit>=0?'tone-green':'tone-red';
      var betterCls=(!isTie&&isWinner)?' is-better':'';
      return '<div class="cjm-scn-rows">'+
        '<div class="cjm-scn-row"><span class="scn-l">CPA / выплата за выдачу</span><span class="scn-v">'+esc(rub(scn.cpa))+'</span></div>'+
        '<div class="cjm-scn-row"><span class="scn-l">Визиты<span class="scn-sub">база симуляции</span></span><span class="scn-v">'+esc(fmt(scn.f.visit))+'</span></div>'+
        '<div class="cjm-scn-row"><span class="scn-l">Контакты<span class="scn-sub">'+esc(pct(scn.f.crVC,1))+' Визит → Контакт</span></span><span class="scn-v">'+esc(fmt(scn.f.contact))+'</span></div>'+
        '<div class="cjm-scn-row"><span class="scn-l">Клики по офферу<span class="scn-sub">'+esc(pct(scn.f.crVK,1))+' Визит → Клик</span></span><span class="scn-v">'+esc(fmt(scn.f.click))+'</span></div>'+
        '<div class="cjm-scn-row"><span class="scn-l">Заявки<span class="scn-sub">'+esc(pct(scn.f.crKA,1))+' Клик → Заявка</span></span><span class="scn-v">'+esc(fmt(scn.f.app))+'</span></div>'+
        '<div class="cjm-scn-row"><span class="scn-l">Выдачи<span class="scn-sub">'+esc(pct(scn.f.crAI,1))+' Заявка → Выдача</span></span><span class="scn-v">'+esc(fmt(scn.f.issue))+'</span></div>'+
        '<div class="cjm-scn-row"><span class="scn-l">CAC (произв.)<span class="scn-sub">затраты на контакты ÷ выдачи</span></span><span class="scn-v">'+esc(rub(scn.cac))+'</span></div>'+
        '<div class="cjm-scn-row"><span class="scn-l">Выручка<span class="scn-sub">CPA × выдачи</span></span><span class="scn-v tone-green">'+esc(rub(scn.revenue))+'</span></div>'+
        '<div class="cjm-scn-row"><span class="scn-l">Затраты на контакты<span class="scn-sub">стоимость контакта × контакты</span></span><span class="scn-v">'+esc(rub(scn.cost))+'</span></div>'+
        '<div class="cjm-scn-row is-key"><span class="scn-l">Прибыль<span class="scn-sub">Выручка − Затраты</span></span><span class="scn-v '+profitTone+betterCls+'">'+esc(rub(scn.profit))+'</span></div>'+
        '<div class="cjm-scn-row is-key"><span class="scn-l">Прибыль на 1 человека<span class="scn-sub">Прибыль ÷ '+esc(fmt(scn.f.visit))+' визитов</span></span><span class="scn-v '+ppvTone+betterCls+'">'+esc(rub(scn.profitPerVisit))+'</span></div>'+
      '</div>';
    }

    var cardsHtml=scenarios.map(function(scn,i){
      var isWinner=!isTie&&i===winnerIdx;
      var cardClass='cjm-scn-card'+(isWinner?' is-winner':'');
      var opt=scn.opt;
      var subText=String(opt.cardSub||'').replace(/\{cpa\}/g,rub(scn.cpa));
      return '<article class="'+cardClass+'">'+
        '<header class="cjm-scn-head">'+
          '<span class="cjm-scn-eyebrow">'+esc(opt.cardEyebrow||('Сценарий '+(i+1)))+'</span>'+
          '<span class="cjm-scn-title">'+esc(opt.cardTitle||opt.label)+'</span>'+
          '<span class="cjm-scn-sub">'+esc(subText)+'</span>'+
        '</header>'+
        rowsHtml(scn,isWinner)+
      '</article>';
    }).join('');

    var verdictHtml;
    if(isTie){
      var tieText=s.leadSale.verdictTie||'Сценарии равнозначны по прибыли — разница &lt; 0,5%. Выбор делаем по операционным критериям.';
      verdictHtml='<div class="cjm-scn-verdict is-tie"><b>Сценарии равнозначны по прибыли</b> — '+tieText+'</div>';
    }else{
      var winner=scenarios[winnerIdx];
      var winName=winner.opt.verdictName||winner.opt.cardTitle||('Сценарий '+(winnerIdx+1));
      var delta=winner.profit-secondProfit;
      // дельта на 1 человека — относительно второго по прибыли сценария
      var secondScn=scenarios.reduce(function(acc,sc,i){
        if(i===winnerIdx)return acc;
        if(!acc||sc.profit>acc.profit)return sc;
        return acc;
      },null);
      var deltaPerVisit=winner.profitPerVisit-(secondScn?secondScn.profitPerVisit:0);
      verdictHtml='<div class="cjm-scn-verdict"><b>'+esc(winName)+'</b> — лучший выбор для сегмента «'+esc(s.name)+'»: '+
        'прибыль выше на '+esc(rub(delta))+' (на '+esc(fmt(winner.f.visit))+' визитов) · +'+esc(rub(deltaPerVisit))+' на 1 человека. '+
        'Воронка одинакова во всех сценариях — различие только в монетизации выдачи (CPA).</div>';
    }

    var gridStyle=' style="--cjm-scn-cols:'+scenarios.length+'"';
    var introText=s.leadSale.compareDescription
      ||'Считаем экономику сегмента в '+scenarios.length+' крайних сценариях монетизации трафика. Воронка одинакова, отличается только выплата за выдачу — это даёт прямой ответ, по какому сценарию выгоднее запускать сегмент.';

    host.innerHTML='<div class="card cjm-scn-compare">'+
      '<div class="card-title"><div>'+
        '<span class="eyebrow" style="color:'+esc(s.color)+'">'+esc(s.label)+'</span>'+
        '<h2>Сравнение сценариев монетизации трафика</h2>'+
        '<p>'+esc(introText)+'</p>'+
      '</div></div>'+
      '<div class="cjm-scn-compare-grid"'+gridStyle+'>'+
        cardsHtml+
      '</div>'+
      verdictHtml+
    '</div>';
  }

  // Сводная таблица «Сводка по всем сегментам» — теперь рендерится только в матрице.
  function renderCalcSummaryTable(leaderId){
    var table=$('cjmCalcTable');
    if(!table)return;
    var rows=segments.map(function(seg){return calcFor(seg.id);});
    if(leaderId==null){
      var max=-Infinity;
      rows.forEach(function(r){if(r.revenue>max){max=r.revenue;leaderId=r.s.id;}});
    }
    var totalRev=rows.reduce(function(a,r){return a+r.revenue;},0);
    var totalProfit=rows.reduce(function(a,r){return a+r.profit;},0);
    var totalVisits=rows.reduce(function(a,r){return a+r.f.visit;},0);
    var avgProfitPerVisit=totalVisits>0?totalProfit/totalVisits:0;
    table.innerHTML='<thead><tr><th>Сегмент</th><th>Визиты</th><th>Контакт</th><th>Клик по офферу</th><th>Заявка</th><th>Выдачи</th><th>Затраты на контакты</th><th>CAC (произв.)</th><th>LTV</th><th>Выручка</th><th>Прибыль</th><th>Прибыль / 1 чел.</th></tr></thead><tbody>'+
      rows.map(function(r){
        var leader=leaderId&&r.s.id===leaderId?' class="is-leader"':'';
        var ppv=r.f.visit>0?r.profit/r.f.visit:0;
        return '<tr'+leader+'><td class="ue2-t-name"><span class="ue2-seg-dot" style="background:'+esc(r.s.color)+'"></span>'+esc(r.s.name)+'</td>'+
          '<td>'+fmt(r.f.visit)+'</td>'+
          '<td>'+fmt(r.f.contact)+'</td>'+
          '<td>'+fmt(r.f.click)+'</td>'+
          '<td>'+fmt(r.f.app)+'</td>'+
          '<td>'+fmt(r.f.issue)+'</td>'+
          '<td>'+rub(r.cost)+'</td>'+
          '<td>'+rub(r.cac)+'</td>'+
          '<td>'+rub(r.m.ltv)+'</td>'+
          '<td class="tone-green"><b>'+rub(r.revenue)+'</b></td>'+
          '<td class="'+(r.profit>=0?'tone-green':'tone-red')+'">'+rub(r.profit)+'</td>'+
          '<td class="'+(ppv>=0?'tone-green':'tone-red')+'">'+rub(ppv)+'</td></tr>';
      }).join('')+
      '<tr><td class="ue2-t-name"><b>Итого по '+rows.length+' сегментам</b></td><td colspan="8"></td><td class="tone-green"><b>'+rub(totalRev)+'</b></td><td class="'+(totalProfit>=0?'tone-green':'tone-red')+'"><b>'+rub(totalProfit)+'</b></td><td class="'+(avgProfitPerVisit>=0?'tone-green':'tone-red')+'"><b>'+rub(avgProfitPerVisit)+'</b></td></tr>'+
      '</tbody>';
  }

  // --- SSR panel removed (per spec): диаграмма теперь рендерится внутри CJM

  // --- Unit-economics panel (per segment) -----------------------------------
  function renderUnitPanel(){
    if(isMatrixView())return;
    var s=currentSegment();
    var f=funnelFor(s.id);
    var m=manualFor(s.id);
    var c=calcFor(s.id);
    var ltvCac=c.cac>0?m.ltv/c.cac:0;
    var tone=ratioTone(ltvCac);
    // Абсолютные конверсии от Visit (строго: значения берутся из той же воронки f).
    var crVisitToApp=f.visit>0?f.app/f.visit*100:0;
    var crVisitToIssue=f.visit>0?f.issue/f.visit*100:0;
    // Прибыль на 1 посетителя — ключевой показатель эффективности на одного человека
    // (на сколько каждый визит приносит/съедает денег).
    var profitPerVisit=f.visit>0?c.profit/f.visit:0;
    var kpis=[
      ['CAC (произв.)',rub(c.cac),'Стоимость контакта × контакты / выдачи','blue'],
      ['CPA',m.cpa<=0?'внутр.':rub(m.cpa),'Средняя выплата/ценность действия','blue'],
      ['LTV',rub(m.ltv),'Ожидаемая ценность клиента','green'],
      ['LTV/CAC',ltvCac.toFixed(1)+'×','Светофор: >2 green, 1–2 yellow, <1 red',tone],
      ['CR · Визит → Заявка',pct(crVisitToApp,2),'Абсолютная конверсия от визита до заявки','blue'],
      ['CR · Визит → Выдача',pct(crVisitToIssue,2),'Абсолютная конверсия от визита до выдачи','green'],
      ['Выручка',rub(c.revenue),'LTV × выдачи (на 10 000 визитов)','green'],
      ['Прибыль',rub(c.profit),'Выручка − затраты на контакты',c.profit>=0?'green':'red'],
      ['Прибыль на 1 человека',rub(profitPerVisit),'Прибыль ÷ '+fmt(f.visit)+' визитов · оценка эффективности на 1 посетителя',profitPerVisit>=0?'green':'red']
    ];
    var kpiHost=$('cjmUnitKpis');
    if(kpiHost){
      kpiHost.innerHTML=kpis.map(function(k){
        return '<div class="ue2-kpi tone-'+k[3]+'"><span class="ue2-kpi-label">'+esc(k[0])+'</span><span class="ue2-kpi-value">'+esc(k[1])+'</span><span class="ue2-kpi-sub">'+esc(k[2])+'</span></div>';
      }).join('');
    }
    var rows=[
      ['Visit',f.visit,'—','100%'],
      ['Контакт',f.contact,pct(f.crVC)+' от Visit · общая',pct(f.contact/f.visit*100)],
      ['Клик по офферу',f.click,pct(f.crVK)+' от Visit',pct(f.click/f.visit*100)],
      ['Заявка',f.app,pct(f.crKA)+' от клика',pct(f.app/f.visit*100)],
      ['Выдача',f.issue,pct(f.crAI)+' от заявки',pct(f.issue/f.visit*100)]
    ];
    var t=$('cjmUnitFunnel');
    if(t){
      t.innerHTML='<thead><tr><th>Шаг</th><th>Абс.</th><th>CR шага</th><th>CR от Visit</th></tr></thead><tbody>'+
        rows.map(function(r){return '<tr><td class="ue2-t-name">'+esc(r[0])+'</td><td>'+fmt(r[1])+'</td><td>'+esc(r[2])+'</td><td>'+esc(r[3])+'</td></tr>';}).join('')+'</tbody>';
    }
  }

  // --- SSR panel (per segment) ---------------------------------------------
  // (removed per spec; routing diagram теперь рендерится внутри CJM-вкладки)

  // --- Matrix view ----------------------------------------------------------
  function renderMatrix(){
    if(!isMatrixView())return;
    // Compute revenue per segment to flag the leader (segment that brings most money).
    var revenueById={};
    var leaderId=null,leaderRev=-Infinity;
    segments.forEach(function(s){
      var c=calcFor(s.id);
      revenueById[s.id]=c.revenue;
      if(c.revenue>leaderRev){leaderRev=c.revenue;leaderId=s.id;}
    });
    // Funnels card per segment
    var funnels=$('cjmMatrixFunnels');
    if(funnels){
      var totalShare=segments.reduce(function(a,s){return a+(Number(s.share)||0);},0)||1;
      funnels.innerHTML=segments.map(function(s){
        var f=funnelFor(s.id);
        var isLeader=s.id===leaderId;
        var normShare=(s.share/totalShare)*100;
        return '<article class="cjm-matrix-segment'+(isLeader?' is-leader':'')+'" style="border-top-color:'+esc(s.color)+'">'+
          '<header><h3>'+esc(s.name)+'</h3></header>'+
          '<div class="cjm-matrix-step"><span class="cjm-matrix-step-name">Visit</span><span class="cjm-matrix-step-val">'+fmt(f.visit)+'</span><span class="cjm-matrix-step-cr">100%</span></div>'+
          '<div class="cjm-matrix-step"><span class="cjm-matrix-step-name">Контакт</span><span class="cjm-matrix-step-val">'+fmt(f.contact)+'</span><span class="cjm-matrix-step-cr">'+pct(f.crVC,1)+'</span></div>'+
          '<div class="cjm-matrix-step"><span class="cjm-matrix-step-name">Клик по офферу</span><span class="cjm-matrix-step-val">'+fmt(f.click)+'</span><span class="cjm-matrix-step-cr">'+pct(f.crVK,1)+'</span></div>'+
          '<div class="cjm-matrix-step"><span class="cjm-matrix-step-name">Заявка</span><span class="cjm-matrix-step-val">'+fmt(f.app)+'</span><span class="cjm-matrix-step-cr">'+pct(f.crKA,1)+'</span></div>'+
          '<div class="cjm-matrix-step"><span class="cjm-matrix-step-name">Выдача</span><span class="cjm-matrix-step-val">'+fmt(f.issue)+'</span><span class="cjm-matrix-step-cr">'+pct(f.crAI,1)+'</span></div>'+
          '<footer><span>Доля сегмента</span><b>'+pct(normShare,0)+'</b></footer>'+
        '</article>';
      }).join('');
    }
    renderCalcSummaryTable(leaderId);
    renderSummaryTable(leaderId);
    renderShareEditor();
  }
  function renderSummaryTable(leaderId){
    var table=$('cjmSummaryTable');if(!table)return;
    var rows=segments.slice();
    var data=rows.map(function(s){var m=manualFor(s.id);var f=funnelFor(s.id);var cac=cacFor(s.id);return {s:s,cac:cac,cpa:m.cpa,ltv:m.ltv,ltvCac:cac>0?m.ltv/cac:0,payback:s.payback,issue:f.issue};});
    var metrics=['cac','cpa','ltv','ltvCac','payback','issue'];
    var best={},worst={};
    metrics.forEach(function(k){
      var vals=data.map(function(d){return d[k];});
      best[k]=(k==='cac'||k==='payback')?Math.min.apply(Math,vals):Math.max.apply(Math,vals);
      worst[k]=(k==='cac'||k==='payback')?Math.max.apply(Math,vals):Math.min.apply(Math,vals);
    });
    function cls(d,k){return d[k]===best[k]?'tone-green':d[k]===worst[k]?'tone-red':'';}
    table.innerHTML='<thead><tr><th>Сегмент</th><th>Выдач (на 10 000)</th><th>CAC (произв.)</th><th>CPA</th><th>LTV</th><th>LTV/CAC</th><th>Payback</th></tr></thead><tbody>'+
      data.map(function(d){
        var leader=leaderId&&d.s.id===leaderId?' class="is-leader"':'';
        var lcTone='lc-'+ratioTone(d.ltvCac);
        var lcCls=[cls(d,'ltvCac'),lcTone].filter(Boolean).join(' ');
        return '<tr'+leader+'><td class="ue2-t-name"><span class="ue2-seg-dot" style="background:'+esc(d.s.color)+'"></span>'+esc(d.s.name)+'</td>'+
          '<td class="'+cls(d,'issue')+'">'+fmt(d.issue)+'</td>'+
          '<td class="'+cls(d,'cac')+'">'+rub(d.cac)+'</td>'+
          '<td class="'+cls(d,'cpa')+'">'+(d.cpa<=0?'внутр.':rub(d.cpa))+'</td>'+
          '<td class="'+cls(d,'ltv')+'">'+rub(d.ltv)+'</td>'+
          '<td class="'+lcCls+'">'+d.ltvCac.toFixed(1)+'×</td>'+
          '<td class="'+cls(d,'payback')+'">'+d.payback+' мес.</td></tr>';
      }).join('')+'</tbody>';
  }
  // --- Segment-share editor (matrix-only) -----------------------------------
  function renderShareEditor(){
    var host=$('cjmShareEditor');if(!host)return;
    var total=segments.reduce(function(a,s){return a+(Number(s.share)||0);},0);
    var totalPct=total*100;
    var rowsHtml=segments.map(function(s){
      var raw=(Number(s.share)||0)*100;
      var norm=total>0?(s.share/total)*100:0;
      var pctText=norm.toLocaleString('ru-RU',{maximumFractionDigits:1})+'%';
      return '<div class="cjm-share-row" data-seg="'+esc(s.id)+'">'+
        '<span class="cjm-share-name"><span class="cjm-share-dot" style="background:'+esc(s.color)+'"></span>'+esc(s.name)+'</span>'+
        '<input type="range" min="0" max="100" step="1" value="'+raw.toFixed(0)+'" data-share-range="'+esc(s.id)+'" aria-label="Доля сегмента «'+esc(s.name)+'»">'+
        '<input type="number" min="0" max="100" step="1" value="'+raw.toFixed(0)+'" data-share-number="'+esc(s.id)+'">'+
        '<span class="cjm-share-norm" data-share-norm="'+esc(s.id)+'">'+esc(pctText)+'</span>'+
      '</div>';
    }).join('');
    var sumWarn=Math.abs(totalPct-100)>0.5?' is-warn':'';
    var footerHtml='<div class="cjm-share-footer">'+
      '<span class="cjm-share-footer-sum'+sumWarn+'">Сумма указанных долей: <b>'+totalPct.toLocaleString('ru-RU',{maximumFractionDigits:0})+'%</b>. Доли в правой колонке нормируются к 100%.</span>'+
      '<button type="button" class="cjm-share-reset" data-share-reset>Сбросить к дефолту</button>'+
    '</div>';
    host.innerHTML='<div class="cjm-share-editor-rows">'+rowsHtml+'</div>'+footerHtml;

    function onChange(id,raw){
      var v=Math.max(0,Math.min(100,Number(raw)||0));
      setShare(id,v/100);
      // Sync the paired input on the same row, refresh normalized labels + dependent UI.
      var row=host.querySelector('.cjm-share-row[data-seg="'+CSS.escape(id)+'"]');
      if(row){
        var rng=row.querySelector('input[type="range"]');
        var num=row.querySelector('input[type="number"]');
        if(rng&&rng.value!==String(v))rng.value=String(v);
        if(num&&document.activeElement!==num&&num.value!==String(v))num.value=String(v);
      }
      var newTotal=segments.reduce(function(a,s){return a+(Number(s.share)||0);},0);
      host.querySelectorAll('[data-share-norm]').forEach(function(el){
        var sid=el.getAttribute('data-share-norm');
        var seg=segmentById(sid);if(!seg)return;
        var n=newTotal>0?(seg.share/newTotal)*100:0;
        el.textContent=n.toLocaleString('ru-RU',{maximumFractionDigits:1})+'%';
      });
      var sumEl=host.querySelector('.cjm-share-footer-sum');
      if(sumEl){
        var pctSum=newTotal*100;
        sumEl.classList.toggle('is-warn',Math.abs(pctSum-100)>0.5);
        sumEl.innerHTML='Сумма указанных долей: <b>'+pctSum.toLocaleString('ru-RU',{maximumFractionDigits:0})+'%</b>. Доли в правой колонке нормируются к 100%.';
      }
      // Refresh segment tabs (показывает доли) и подвал воронок матрицы.
      renderSegmentTabs();
      renderMatrixFunnelsFooter();
    }
    host.querySelectorAll('input[data-share-range]').forEach(function(input){
      input.addEventListener('input',function(){onChange(input.getAttribute('data-share-range'),input.value);});
    });
    host.querySelectorAll('input[data-share-number]').forEach(function(input){
      input.addEventListener('input',function(){onChange(input.getAttribute('data-share-number'),input.value);});
    });
    var reset=host.querySelector('[data-share-reset]');
    if(reset){
      reset.addEventListener('click',function(){
        resetShares();
        renderShareEditor();
        renderSegmentTabs();
        renderMatrixFunnelsFooter();
      });
    }
  }
  // Обновляет только подвал «Доля сегмента» в карточках матрицы — без полной перестройки.
  function renderMatrixFunnelsFooter(){
    var total=segments.reduce(function(a,s){return a+(Number(s.share)||0);},0)||1;
    document.querySelectorAll('.cjm-matrix-segment').forEach(function(card,i){
      var s=segments[i];if(!s)return;
      var footer=card.querySelector('footer b');
      if(footer)footer.textContent=pct((s.share/total)*100,0);
    });
  }

  // --- Charts ---------------------------------------------------------------
  // --- Finance panel: inputs + outputs + charts -----------------------------
  var FIN_FIELD_GROUPS={
    finInputsSources:[
      {key:'srcYdBudget',label:'Яндекс.Директ · бюджет / мес',suffix:'₽',step:'5000',min:0,max:1000000000},
      {key:'srcYdCpl',label:'Яндекс.Директ · CPL (цена номера)',suffix:'₽',step:'10',min:0,max:1000000},
      {key:'srcSeoBudget',label:'SEO · бюджет / мес',suffix:'₽',step:'5000',min:0,max:1000000000},
      {key:'srcSeoCpl',label:'SEO · CPL (цена номера)',suffix:'₽',step:'10',min:0,max:1000000},
      {key:'srcPrBudget',label:'PR / соцсети · бюджет / мес',suffix:'₽',step:'5000',min:0,max:1000000000},
      {key:'srcPrCpl',label:'PR / соцсети · CPL (цена номера)',suffix:'₽',step:'10',min:0,max:1000000},
      {key:'srcOtherBudget',label:'Прочие источники · бюджет / мес',suffix:'₽',step:'5000',min:0,max:1000000000},
      {key:'srcOtherCpl',label:'Прочие источники · CPL (цена номера)',suffix:'₽',step:'10',min:0,max:1000000}
    ],
    finInputsFunnel:[
      {key:'monthlyGrowth',label:'Темп роста в месяц',suffix:'%',step:'0.5',min:-50,max:200},
      {key:'crContactApp',label:'CR · Контакт → Заявка',suffix:'%',step:'0.5',min:0,max:100},
      {key:'crAppIssue',label:'CR · Заявка → Выдача',suffix:'%',step:'0.5',min:0,max:100}
    ],
    finInputsShares:[
      {key:'shareNew',label:'Новый',suffix:'%',step:'1',min:0,max:100},
      {key:'shareRejected',label:'Отказной',suffix:'%',step:'1',min:0,max:100},
      {key:'shareRepeat',label:'Действующий',suffix:'%',step:'1',min:0,max:100},
      {key:'shareSleeping',label:'Спящий',suffix:'%',step:'1',min:0,max:100},
      {key:'shareNoncore',label:'Непрофильный',suffix:'%',step:'1',min:0,max:100}
    ],
    finInputsPayout:[
      {key:'payoutNew',label:'CPA · Новый',suffix:'₽',step:'50',min:0,max:1000000},
      {key:'payoutRejected',label:'CPA · Отказной',suffix:'₽',step:'50',min:0,max:1000000},
      {key:'payoutRepeat',label:'CPA · Действующий',suffix:'₽',step:'50',min:0,max:1000000},
      {key:'payoutSleeping',label:'CPA · Спящий',suffix:'₽',step:'50',min:0,max:1000000},
      {key:'payoutNoncore',label:'CPA · Непрофильный',suffix:'₽',step:'50',min:0,max:1000000}
    ],
    finInputsBudget:[
      {key:'fotMonthly',label:'ФОТ в месяц',suffix:'₽',step:'5000',min:0,max:100000000},
      {key:'devMonthly',label:'Разработка в месяц',suffix:'₽',step:'5000',min:0,max:100000000},
      {key:'cfApprovalShare',label:'Доля выдач в Центрофинанс',suffix:'%',step:'1',min:0,max:100},
      {key:'cfPayout',label:'Выплата Центрофинанс за клиента',suffix:'₽',step:'50',min:0,max:1000000},
      {key:'targetRevenue',label:'Цель выручки в месяц',suffix:'₽',step:'100000',min:0,max:1000000000}
    ]
  };

  function finColor(name){
    var v=getComputedStyle(document.documentElement).getPropertyValue('--'+name);
    return (v||'').trim()||'#0071e3';
  }

  function finFieldHtml(f,value,edited){
    return '<label>'+
      '<span class="cjm-manual-label">'+esc(f.label)+' <span class="cjm-manual-suffix">'+esc(f.suffix)+'</span>'+
        (edited?' <span class="cjm-manual-suffix" title="Значение изменено вручную">· изменено</span>':'')+
      '</span>'+
      '<input type="number" inputmode="decimal" min="'+f.min+'" max="'+f.max+'" step="'+f.step+'" '+
        'value="'+esc(value)+'" data-fin="'+esc(f.key)+'"'+(edited?' class="is-edited"':'')+'>'+
    '</label>';
  }

  function renderFinanceInputs(){
    var inp=finInputs();
    Object.keys(FIN_FIELD_GROUPS).forEach(function(hostId){
      var host=$(hostId);if(!host)return;
      host.innerHTML=FIN_FIELD_GROUPS[hostId].map(function(f){
        return finFieldHtml(f,inp[f.key],finIsEdited(f.key));
      }).join('');
    });
    // Один делегированный обработчик на панель — переживает перерисовку значений.
    var panel=$('cjm-tab-finance');
    if(panel&&!panel._finWired){
      panel._finWired=true;
      panel.addEventListener('input',function(ev){
        var el=ev.target;
        if(!el||el.getAttribute('data-fin')==null)return;
        var key=el.getAttribute('data-fin');
        var meta=null;
        Object.keys(FIN_FIELD_GROUPS).forEach(function(g){FIN_FIELD_GROUPS[g].forEach(function(f){if(f.key===key)meta=f;});});
        var raw=el.value;
        if(raw===''){unsetFin(key);el.classList.remove('is-edited');}
        else{
          var val=clamp(raw,meta?meta.min:0,meta?meta.max:1000000000);
          setFin(key,val);el.classList.add('is-edited');
        }
        var res=computeFinance();
        renderFinanceOutputs(res);
        renderFinanceCharts(res);
      });
      var reset=$('finReset');
      if(reset)reset.addEventListener('click',function(){resetFin();renderFinancePanel();});
    }
  }

  function renderFinanceOutputs(res){
    var inp=res.inp,n=res.months.length,last=n-1;
    // KPI (5 карточек: вложить, выручка, прибыль, прибыль/1 чел, окупаемость)
    var payTone=res.paybackIdx>=0?'green':'red';
    var ppcTone=res.lastPpc>=0?'green':'red';
    var kpis=[
      {tone:'orange',label:'Нужно вложить',value:millions(res.peakNeed),sub:'Пиковый кассовый разрыв за горизонт'},
      {tone:'blue',label:'Выручка · декабрь 2027',value:millions(res.lastRevenue),sub:'Цель '+millions(res.target)+' в месяц'},
      {tone:res.lastProfit>=0?'green':'red',label:'Прибыль · декабрь 2027',value:millions(res.lastProfit),sub:'Чистыми в месяц на конец горизонта'},
      {tone:ppcTone,label:'Прибыль / 1 чел',value:rub(res.lastPpc),sub:'На одну выдачу на конец горизонта'},
      {tone:payTone,label:'Окупаемость',value:res.paybackIdx>=0?res.months[res.paybackIdx]:'за горизонтом',sub:res.paybackIdx>=0?'Месяц выхода в накопленный плюс':'Накопленная прибыль ещё отрицательна'}
    ];
    var kh=$('finKpis');
    if(kh)kh.innerHTML=kpis.map(function(k,i){
      return '<div class="fin-kpi tone-'+k.tone+'" style="animation-delay:'+(i*60)+'ms">'+
        '<span class="fin-kpi-label">'+esc(k.label)+'</span>'+
        '<span class="fin-kpi-value">'+esc(k.value)+'</span>'+
        '<span class="fin-kpi-sub">'+esc(k.sub)+'</span>'+
      '</div>';
    }).join('');
    // Target strip
    var progress=res.target>0?clamp(res.lastRevenue/res.target*100,0,100):0;
    var gap=res.target-res.lastRevenue;
    var strip=$('finTargetStrip');
    if(strip){
      var statusItem=res.targetHit
        ?'<div class="fin-target-item is-hit"><span class="fin-target-num">Цель достигнута</span><span class="fin-target-cap">Выручка ≥ цели</span></div>'
        :'<div class="fin-target-item is-gap"><span class="fin-target-num">'+esc(millions(gap))+'</span><span class="fin-target-cap">Осталось до цели</span></div>';
      var growthItem=res.neededGrowth!=null
        ?'<div class="fin-target-item"><span class="fin-target-num">'+esc(pct(res.neededGrowth,1))+'</span><span class="fin-target-cap">Нужный рост контактов в месяц</span></div>'
        :'';
      strip.innerHTML=
        '<div class="fin-target-item"><span class="fin-target-num">'+esc(millions(res.lastRevenue))+'</span><span class="fin-target-cap">Выручка на конец</span></div>'+
        '<div class="fin-target-item"><span class="fin-target-num">'+esc(millions(res.target))+'</span><span class="fin-target-cap">Цель · декабрь 2027</span></div>'+
        statusItem+
        '<div class="fin-target-item"><span class="fin-target-num">'+esc(pct(inp.monthlyGrowth,1))+'</span><span class="fin-target-cap">Текущий рост контактов в месяц</span></div>'+
        growthItem+
        '<div class="fin-progress"><span style="width:'+progress.toFixed(1)+'%"></span></div>';
    }
    // Источники трафика — сводка (контакты, доли, средний CPL)
    var srcHost=$('finSourcesRow');
    if(srcHost){
      var src=res.sources;
      var cardsHtml=src.items.map(function(it){
        var shareTxt=src.totalContacts>0?pct(it.contacts/src.totalContacts*100,0):'—';
        return '<div class="fin-src-card" style="border-top-color:'+esc(it.meta.color)+'">'+
          '<span class="fin-src-name">'+esc(it.meta.name)+'</span>'+
          '<span class="fin-src-val">'+esc(fmt(it.contacts))+'</span>'+
          '<span class="fin-src-cap">контактов / мес · доля '+esc(shareTxt)+'</span>'+
          '<span class="fin-src-note">бюджет '+esc(rub(it.budget))+' · CPL '+esc(rub(it.cpl))+'</span>'+
        '</div>';
      }).join('');
      var footer='<div class="fin-src-footer">'+
        '<span>Итого контактов: <b>'+esc(fmt(src.totalContacts))+'</b> / мес</span>'+
        '<span>Итого бюджет: <b>'+esc(rub(src.totalBudget))+'</b> / мес</span>'+
        '<span>Средний CPL (арифм. средневзвешенный): <b>'+esc(rub(src.avgCpl))+'</b></span>'+
      '</div>';
      srcHost.innerHTML='<div class="fin-src-cards">'+cardsHtml+'</div>'+footer;
    }
    // Segment shares normalization footer
    var rawSum=FIN_SEG_META.reduce(function(a,m){return a+(Number(inp[m.shareKey])||0);},0);
    var normEl=$('finSharesNorm');
    if(normEl){
      normEl.className='fin-norm'+(Math.abs(rawSum-100)>0.5?' is-warn':'');
      var normed=res.shares.map(function(x,i){return FIN_SEG_META[i].name+' '+pct(x*100,0);}).join(' · ');
      normEl.innerHTML='<span>Введено суммарно: <b>'+pct(rawSum,0)+'</b></span><span>После нормировки: '+esc(normed)+'</span>';
    }
    // Segment revenue breakdown (5 сегментов): выручка/мес и доля в выручке на конец
    var segHost=$('finSegRow');
    if(segHost){
      var lastIssues=res.issues[last];
      var segCards=FIN_SEG_META.map(function(m,i){
        var segIss=lastIssues*res.shares[i];
        var segRev=segIss*res.payouts[i];
        return '<div class="fin-seg-card" style="border-top-color:'+esc(m.color)+'">'+
          '<span class="fin-seg-name">'+esc(m.name)+'</span>'+
          '<span class="fin-seg-val">'+esc(millions(segRev))+' / мес</span>'+
          '<span class="fin-seg-cap">доля '+esc(pct(res.shares[i]*100,0))+' · CPA '+esc(rub(res.payouts[i]))+'</span>'+
          '<span class="fin-seg-note">выдач '+esc(fmt(segIss))+' / мес (декабрь 2027)</span>'+
        '</div>';
      }).join('');
      segHost.innerHTML=segCards;
    }
    // CF tracker row
    var cfEl=$('finCfRow');
    if(cfEl){
      cfEl.innerHTML=
        '<div class="fin-cf-cell"><span class="fin-cf-cap">Клиентов Центрофинанс в месяц</span><span class="fin-cf-val">'+esc(fmt(res.cfClients[last]))+'</span><span class="fin-cf-note">Декабрь 2027 · '+esc(pct(inp.cfApprovalShare,0))+' выдач уходит в Центрофинанс</span></div>'+
        '<div class="fin-cf-cell"><span class="fin-cf-cap">Выручка от Центрофинанс</span><span class="fin-cf-val">'+esc(rub(res.cfRevenue[last]))+'</span><span class="fin-cf-note">По вашей ставке · продажа лида обратно по 3000 ₽ убрана из расчёта</span></div>'+
        '<div class="fin-cf-cell"><span class="fin-cf-cap">Ставка Центрофинанс за клиента</span><span class="fin-cf-val">'+esc(rub(inp.cfPayout))+'</span><span class="fin-cf-note">0 ₽ означает, что лид обратно в Центрофинанс не продаём</span></div>';
    }
    // Monthly table
    var tbl=$('finTable');
    if(tbl){
      var head='<thead><tr><th>Месяц</th><th>Контакты</th><th>Заявки</th><th>Выдачи</th><th>Выручка</th><th>Расходы</th><th>Прибыль</th><th>Прибыль / 1 чел</th><th>Накопл. прибыль</th></tr></thead>';
      var rows='';
      for(var t=0;t<n;t++){
        var pc=res.profit[t]>=0?'fin-pos':'fin-neg';
        var cc=res.cumProfit[t]>=0?'fin-pos':'fin-neg';
        var ppcCls=res.ppc[t]>=0?'fin-pos':'fin-neg';
        rows+='<tr'+(t===last?' class="is-target"':'')+'>'+
          '<td>'+esc(res.months[t])+'</td>'+
          '<td>'+esc(fmt(res.contacts[t]))+'</td>'+
          '<td>'+esc(fmt(res.apps[t]))+'</td>'+
          '<td>'+esc(fmt(res.issues[t]))+'</td>'+
          '<td>'+esc(rub(res.revenue[t]))+'</td>'+
          '<td>'+esc(rub(res.cost[t]))+'</td>'+
          '<td class="'+pc+'">'+esc(rub(res.profit[t]))+'</td>'+
          '<td class="'+ppcCls+'">'+esc(rub(res.ppc[t]))+'</td>'+
          '<td class="'+cc+'">'+esc(rub(res.cumProfit[t]))+'</td>'+
        '</tr>';
      }
      tbl.innerHTML=head+'<tbody>'+rows+'</tbody>';
    }
    // Executive summary
    var sum=$('finSummary');
    if(sum){
      var paybackTxt=res.paybackIdx>=0?('окупаемость наступает в '+res.months[res.paybackIdx]):'на горизонте до декабря 2027 накопленная прибыль остаётся отрицательной';
      var firstPositiveIdx=-1;
      for(var pi=0;pi<res.profit.length;pi++){
        if(res.profit[pi]>=0){firstPositiveIdx=pi;break;}
      }
      var monthlyProfitStatusTxt=firstPositiveIdx>=0?('месячная прибыль становится положительной в '+res.months[firstPositiveIdx]):'месячная прибыль остаётся отрицательной до конца горизонта';
      var goalTxt=res.targetHit?('план выходит на цель '+millions(res.target)+' в месяц'):('до цели '+millions(res.target)+' в месяц не хватает '+millions(gap)+', для её достижения нужен рост контактов около '+pct(res.neededGrowth,1)+' в месяц вместо текущих '+pct(inp.monthlyGrowth,1));
      var summaryParts=[
        '<span class="fin-summary-lead">Резюме для презентации</span>',
        'Текущая база почти нулевая: ориентир <b>60–70 тыс. ₽/мес</b> без вложений. С июля включаем нарастающее финансирование 4 источников (Яндекс.Директ, SEO, PR, прочие) через средний CPL — на старте это <b>'+esc(fmt(res.sources.totalContacts))+'</b> контактов в месяц при среднем CPL <b>'+esc(rub(res.sources.avgCpl))+'</b> и общем бюджете <b>'+esc(rub(res.sources.totalBudget))+'</b>.',
        'Чтобы выйти на выручку <b>'+esc(millions(res.lastRevenue))+'</b> в месяц к декабрю 2027, в проект нужно вложить до <b>'+esc(millions(res.peakNeed))+'</b> (пиковый кассовый разрыв).',
        'Быстрой окупаемости в первый год не закладываем: '+esc(monthlyProfitStatusTxt)+', '+esc(paybackTxt)+'. При заданных параметрах прибыль на конец горизонта составляет <b>'+esc(millions(res.lastProfit))+'</b> в месяц, то есть целевой уровень 10+ млн ₽/мес, а прибыль на одну выдачу — <b>'+esc(rub(res.lastPpc))+'</b>.',
        'По цели: '+esc(goalTxt)+'.',
        'Выручка построена на партнёрских ставках CPA по 5 сегментам, продажа лида обратно в Центрофинанс по 3000 ₽ из расчёта исключена, а сам Центрофинанс учитывается как трекер лида: '+esc(fmt(res.cfClients[last]))+' клиентов в месяц на конец горизонта.'
      ];
      sum.innerHTML=summaryParts.join(' ');
    }
  }

  function renderFinanceCharts(res){
    if(typeof Chart==='undefined')return;
    res=res||computeFinance();
    var labels=FIN_MONTHS_SHORT;
    var toM=function(v){return v/1000000;};
    var cBlue=finColor('blue'),cGreen=finColor('green'),cRed=finColor('red'),cViolet=finColor('violet'),cYellow=finColor('yellow');
    drawChart('finChartTrajectory',{type:'line',data:{labels:labels,datasets:[
      {label:'Выручка, млн ₽',data:res.revenue.map(toM),borderColor:cBlue,backgroundColor:cBlue+'22',fill:true,borderWidth:2.5,pointRadius:2},
      {label:'Расходы, млн ₽',data:res.cost.map(toM),borderColor:cRed,borderWidth:2},
      {label:'Цель, млн ₽',data:res.revenue.map(function(){return toM(res.target);}),borderColor:cViolet,borderWidth:1.5}
    ]}});
    drawChart('finChartPnl',{type:'bar',data:{labels:labels,datasets:[
      {label:'Выручка, млн ₽',data:res.revenue.map(toM),backgroundColor:cGreen+'cc'},
      {label:'Расходы, млн ₽',data:res.cost.map(toM),backgroundColor:cRed+'99'},
      {label:'Прибыль, млн ₽',type:'line',data:res.profit.map(toM),borderColor:cBlue,borderWidth:2.5,pointRadius:2}
    ]}});
    drawChart('finChartPayback',{type:'line',data:{labels:labels,datasets:[
      {label:'Накопленная прибыль, млн ₽',data:res.cumProfit.map(toM),borderColor:cBlue,backgroundColor:cBlue+'22',fill:true,borderWidth:2.5},
      {label:'Накопленные вложения, млн ₽',data:res.cumInvest.map(toM),borderColor:cRed,borderWidth:2}
    ]},annotations:res.paybackIdx>=0?[{index:res.paybackIdx,color:cBlue,label:'Окупаемость · '+(res.months[res.paybackIdx]||'')}]:[]});
  }

  function renderFinancePanel(){
    renderFinanceInputs();
    var res=computeFinance();
    renderFinanceOutputs(res);
  }

  function renderCharts(){
    if(isFinanceView()){
      renderFinanceCharts();
      return;
    }
    if(isMatrixView()){
      // LTV/CAC bar chart removed per spec; LTV/CAC теперь читается из таблицы
      // «Сравнительная экономика» (светофор: >2 ×, 1–2 ×, <1 ×).
    }
    if(!isMatrixView()){
      // As-Is / To-Be chart removed per spec; nothing to draw in segment view.
    }
  }

  function renderAll(){
    renderSegmentTabs();
    renderHero();
    applyInnerTab();
    if(isFinanceView()){
      renderFinancePanel();
    }else if(isMatrixView()){
      renderMatrix();
    }else{
      renderFunnelPanel();
      renderJourneyPanel();
      renderCalcPanel();
      renderUnitPanel();
      renderScenarioComparePanel();
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
    applyStoredShares();
    initVersionSwitcher();
    initInnerTabs();
    initTheme();
    renderAll();
  }

  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init);
  else init();
})();
