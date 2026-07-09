(function(){
  'use strict';

  var STORAGE_KEY='cjm_unit_dashboard_v2';
  var TAB_KEY='cjm_inner_tab_v2';
  var MANUAL_KEY='cjm_manual_inputs_v3';
  var GLOBAL_KEY='cjm_global_inputs_v1';
  var SHARES_KEY='cjm_segment_shares_v1';
  var DESC_KEY='cjm_segment_descriptions_v1';
  var BASE_VISITS=10000;
  // Глобальные параметры, общие для всех сегментов:
  //  - visitContact — CR · Визит → Контакт (одна для всех сегментов)
  //  - contactCost  — Стоимость привлечения одного контакта (₽), общая
  //  - n_visitContact / n_contactCost — объём выборки, на котором посчитан показатель
  // 9.6% = целевой CR Visit→Contact после квиза-преквалификации: прежние 8% × +20% uplift.
  var GLOBAL_DEFAULTS={visitContact:9.6,contactCost:140,n_visitContact:50000,n_contactCost:50000};
  var HTML_ESCAPE_MAP={'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;','/':'&#x2F;','`':'&#96;'};
  var charts={};
  var sharedState={endpoint:null,loaded:false,available:false,saving:false,error:false,pending:{},timer:null};

  // ===== Финмодель (вкладка «Финмодель до декабря 2027») ======================
  // Самодостаточный слой: воронка считается от контактов, полученных из бюджетов
  // по источникам трафика и CPL. Центрофинанс выступает трекером лида и не является
  // источником объёма. Продажа лида обратно в ЦФ по 3000 ₽ убрана из выручки
  // (по требованию бизнеса) — вместо неё используются партнёрские ставки за выдачу
  // по каждому сегменту. Все входные параметры редактируются пользователем,
  // сохраняются локально и синхронизируются с same-origin API /api/cjm-state при наличии.
  var FINANCE_KEY='cjm_finance_inputs_v2';
  // Входы финмодели «100 млн ₽» (finance-100m.js): включены в общее состояние,
  // чтобы правки сохранялись в базу и попадали в ссылку «Поделиться».
  var FIN100_KEY='fin100_inputs_v1';
  var SHARED_STATE_KEYS=[STORAGE_KEY,MANUAL_KEY,GLOBAL_KEY,SHARES_KEY,DESC_KEY,FINANCE_KEY,FIN100_KEY];
  var FINANCE_LEGACY_KEYS=['cjm_finance_inputs_v1'];
  // Горизонт совпадает с baseline PNL: июль 2026 → декабрь 2027 (18 месяцев).
  var FIN_MONTHS=['Июль 2026','Август 2026','Сентябрь 2026','Октябрь 2026','Ноябрь 2026','Декабрь 2026','Январь 2027','Февраль 2027','Март 2027','Апрель 2027','Май 2027','Июнь 2027','Июль 2027','Август 2027','Сентябрь 2027','Октябрь 2027','Ноябрь 2027','Декабрь 2027'];
  var FIN_MONTHS_SHORT=['Июл26','Авг26','Сен26','Окт26','Ноя26','Дек26','Янв27','Фев27','Мар27','Апр27','Май27','Июн27','Июл27','Авг27','Сен27','Окт27','Ноя27','Дек27'];
  var FIN_MONTH_KEYS=['2026-07','2026-08','2026-09','2026-10','2026-11','2026-12','2027-01','2027-02','2027-03','2027-04','2027-05','2027-06','2027-07','2027-08','2027-09','2027-10','2027-11','2027-12'];
  var FIN_TARGET_NET_PROFIT_DEC_2027=16728855;
  var FIN_DEFAULT_START_REVENUE=250000;
  // Точный темп выведен из уравнения:
  // startRevenue × (1+g)^effectiveExpEnd × (1-taxRate) − finalCost = targetNetProfit.
  // Для значений по умолчанию: 250 тыс. ₽ старта, 6% налога, 2,445 млн ₽ расходов в декабре 2027
  // и 16 728 855 ₽ чистой прибыли на конец горизонта.
  var FIN_DEFAULT_MONTHLY_GROWTH_FOR_TARGET=42.39615324764201;
  // Модель драйвится не визитами/CPC, а бюджетами по источникам трафика и
  // «стоимостью оставленного номера» (CPL): бюджет_i / CPL_i = контакты_i.
  // Контакты → Заявки → Выдачи. Доли и CPA — по 5 сегментам, редактируются вручную.
  // Дефолты откалиброваны по baseline PNL: стартовые вложения ≈1,7 млн ₽/мес,
  // выручка стартует около 200–250 тыс. ₽/мес, а дальше растёт по более
  // реалистичной back-loaded траектории без скачков по 30%+ на большом обороте.
  // Важно: выручка растёт сильнее расходов за счёт накопительного SEO/бренд-эффекта,
  // а расходы растут только линейным планом.
  var FIN_DEFAULTS={
    // 37% — базовый response-scale спроса, подобран так, чтобы при пониженных
    // fixed-costs (devMonthly=100 тыс. ₽) и стартовом медиабюджете 1 млн ₽/мес
    // накопленная прибыль выходила в ноль ровно к концу горизонта (Декабрь 2027,
    // т.е. через 1,5 года от старта в Июле 2026). Первые месяцы дают слабый рост,
    // затем эффект накопленных вложений ускоряется. После мая 2027 включается
    // отдельное замедление, чтобы большие месячные объёмы не разгонялись слишком резко.
    monthlyGrowth:FIN_DEFAULT_MONTHLY_GROWTH_FOR_TARGET,
    startRevenue:FIN_DEFAULT_START_REVENUE,
    // «Степень» роста управляет ФОРМОЙ траектории, а не её масштабом.
    // Модель роста (нормирована на горизонт, без «двойной экспоненты»):
    //   exp(t)  = horizon · (t / horizon)^growthPower
    //   revenueScale_t = (1 + monthlyGrowth)^exp(t)
    //   growthPower=1  → чистая экспонента (1+g)^t (поведение по умолчанию)
    //   growthPower>1  → рост back-loaded: медленный старт, разгон к концу (вложения дают
    //                    отложенную отдачу — «раскачка» инвестиций и монетизации)
    //   growthPower<1  → рост front-loaded: быстрый старт и насыщение
    // Конечная точка scale_end=(1+g)^horizon фиксирована при любом growthPower, поэтому
    // степень НЕ приводит к взрыву показателя (раньше t^p давало млрд при p=2).
    // Выручка и расходы больше НЕ привязаны к одному scale_t: контакты/выручка
    // получают экспоненциальный response-scale, но медиарасходы растут линейно
    // через costGrowthMonthly. SEO берёт 100% накопительного эффекта, платные
    // источники — только paidDemandShare% от него (иначе модель превращается в
    // прямую зависимость «вложили ×2 → заработали ×2»).
    // p=1.7 заметно сдвигает отдачу к поздним месяцам: это отражает PNL-сценарий,
    // где SEO-страницы и бренд накапливают эффект не мгновенно, а после разгона.
    growthPower:1.7,
    // После мая 2027 оставляем только часть дальнейшего экспоненциального прироста:
    // 55% даёт плавный рост летом-осенью вместо прежнего резкого ускорения.
    postMayGrowthFactor:55,
    costGrowthMonthly:6,
    paidDemandShare:15,
    // 4 источника трафика: суммарный стартовый медиабюджет поднят до 1 млн ₽/мес
    // (350 тыс. ₽ Яндекс.Директ + 530 тыс. ₽ SEO + 120 тыс. ₽ PR/бренд), пропорции
    // сохранены к прежней структуре (300/450/100 тыс. ₽).
    // CPL здесь — не цена клика, а эффективная стоимость оставленного номера.
    // На раннем этапе она на порядок выше прежних demo-CPL, потому что SEO/бренд
    // расходы уже есть, а накопленный органический поток контактов ещё мал.
    srcYdBudget:350000, srcYdCpl:1800,
    srcSeoBudget:530000, srcSeoCpl:2200,
    srcPrBudget:120000,  srcPrCpl:2500,
    srcOtherBudget:0, srcOtherCpl:2000,
    // 5 сегментов — доли (%) и ставка CPA (₽ за выдачу партнёру)
    shareNew:30, shareRejected:20, shareRepeat:20, shareSleeping:15, shareNoncore:15,
    payoutNew:3200, payoutRejected:2700, payoutRepeat:3000, payoutSleeping:2300, payoutNoncore:1800,
    // Посегментные конверсии воронки — из сегментов CJM (см. массив `segments`).
    //   crVc_*: Визит → Контакт (по сегменту; средневзвешенная используется для расчёта объёма визитов на маркетплейс)
    //   crCc_*: Контакт → Клик по офферу
    //   crCa_*: Клик по офферу → Заявка
    //   crAi_*: Заявка → Апрув (выдача)
    // Дефолты берём из segments[i].defaultCr (visitClick/clickApp/appIssue) и глобальной
    // визит→контакт 9.6%. Это целевой, оптимизированный сценарий: квиз-преквалификация,
    // персональные витрины, SSR-маршрутизация и предзаполнение анкет должны резко сократить
    // отвал между этапами. Пользователь редактирует их в блоке «Конверсии по сегментам».
    crVc_New:9.6, crCc_New:55, crCa_New:88, crAi_New:45,
    crVc_Rejected:9.6, crCc_Rejected:45, crCa_Rejected:75, crAi_Rejected:48,
    crVc_Repeat:9.6, crCc_Repeat:65, crCa_Repeat:78, crAi_Repeat:55,
    crVc_Sleeping:9.6, crCc_Sleeping:50, crCa_Sleeping:76, crAi_Sleeping:50,
    crVc_Noncore:9.6, crCc_Noncore:40, crCa_Noncore:65, crAi_Noncore:40,
    // Фикс. расходы. devMonthly=100 тыс. ₽ — сниженный стартовый бюджет на
    // разработку/интеграции (вместо прежних 500 тыс. ₽), FOT не менялся.
    fotMonthly:325000, devMonthly:100000,
    taxRate:6,
    // Центрофинанс как трекер лида (не источник объёма)
    cfApprovalShare:30, cfPayout:0,
    // Цель
    targetNetProfit:FIN_TARGET_NET_PROFIT_DEC_2027
  };
  var FIN_SEG_META=[
    {key:'New',name:'Новый',color:'var(--yellow)',shareKey:'shareNew',payoutKey:'payoutNew',
      crVcKey:'crVc_New',crCcKey:'crCc_New',crCaKey:'crCa_New',crAiKey:'crAi_New'},
    {key:'Rejected',name:'Отказной',color:'var(--red)',shareKey:'shareRejected',payoutKey:'payoutRejected',
      crVcKey:'crVc_Rejected',crCcKey:'crCc_Rejected',crCaKey:'crCa_Rejected',crAiKey:'crAi_Rejected'},
    {key:'Repeat',name:'Действующий',color:'var(--green)',shareKey:'shareRepeat',payoutKey:'payoutRepeat',
      crVcKey:'crVc_Repeat',crCcKey:'crCc_Repeat',crCaKey:'crCa_Repeat',crAiKey:'crAi_Repeat'},
    {key:'Sleeping',name:'Спящий',color:'var(--blue)',shareKey:'shareSleeping',payoutKey:'payoutSleeping',
      crVcKey:'crVc_Sleeping',crCcKey:'crCc_Sleeping',crCaKey:'crCa_Sleeping',crAiKey:'crAi_Sleeping'},
    {key:'Noncore',name:'Непрофильный',color:'var(--violet)',shareKey:'shareNoncore',payoutKey:'payoutNoncore',
      crVcKey:'crVc_Noncore',crCcKey:'crCc_Noncore',crCaKey:'crCa_Noncore',crAiKey:'crAi_Noncore'}
  ];
  var FIN_SRC_META=[
    {key:'Yd',name:'Яндекс.Директ',color:'var(--yellow)',budgetKey:'srcYdBudget',cplKey:'srcYdCpl'},
    {key:'Seo',name:'SEO',color:'var(--green)',budgetKey:'srcSeoBudget',cplKey:'srcSeoCpl'},
    {key:'Pr',name:'PR / соцсети',color:'var(--violet)',budgetKey:'srcPrBudget',cplKey:'srcPrCpl'},
    {key:'Other',name:'Прочие источники',color:'var(--blue)',budgetKey:'srcOtherBudget',cplKey:'srcOtherCpl'}
  ];
  // 48 шагов бинарного поиска — верхняя защита от бесконечного цикла; обычно
  // поиск завершается раньше по epsilon ≈0,0001 п.п. месячного темпа.
  var MAX_GROWTH_BISECTION_ITERATIONS=48;
  var GROWTH_BISECTION_EPSILON=0.000001;

  // 5 segments per CJM/JTBD spec (Miro):
  //  1. new        — Новый клиент            (yellow)
  //  2. repeat     — Действующий клиент       (green)
  //  3. rejected   — Отказной клиент         (red, ветка ПДН → МФО / БФЛ)
  //  4. sleeping   — Спящий клиент           (blue, ромб «ЦФ готов одобрить?»)
  //  5. noncore    — Новый (непрофильный)    (violet)
  // Воронка (упрощённая, согласована с бизнесом) — последовательная:
  //   Visit → Контакт → Клик по офферу → Заявка → Выдача
  // CR-показатели:
  //   visitContact — Визит → Контакт (общий, в GLOBAL_DEFAULTS)
  //   visitClick   — Контакт → Клик по офферу (по сегменту)
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
      defaultCr:{visitClick:55,clickApp:88,appIssue:45},
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
        visitClick:'55% Контакт → Клик по офферу — квиз-преквалификация и персональная витрина ведут клиента сразу к релевантному офферу.',
        clickApp:'88% Клик → Заявка (анкета ЦФ) — короткая предзаполненная анкета и отсев нецелевых до клика.',
        appIssue:'45% Заявка → Апрув (выдача) — целевой апрув-рейт после скоринга и маршрутизации в ЦФ или стороннюю МФО.',
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
      defaultCr:{visitClick:65,clickApp:78,appIssue:55},
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
        visitClick:'65% Контакт → Клик по офферу — знакомый клиент видит персональный Top-up / карту / добор в один экран.',
        clickApp:'78% Клик → Заявка — минимум полей за счёт известного профиля и повторного сценария.',
        appIssue:'55% Заявка → Апрув — целевой апрув по лояльной базе, Top-up и кросс-сейлу партнёрских продуктов.',
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
      defaultCr:{visitClick:45,clickApp:75,appIssue:48},
      cac:870,cpa:2200,ltv:2400,payback:5,share:0.10,
      mix:{seo:0.18,paid:0.70,crm:0.05,pr:0.07},
      cpa_text:'2 000 – 2 400 ₽ (среднее по рынку CPA-витрины МФО)',
      ltv_text:'2–3 займа в год через партнёрские МФО (LTV ≈ накопленная CPA-выручка).',
      justify:{
        visitClick:'45% Контакт → Клик по офферу — отказной трафик ведём на витрину МФО/БФЛ с высоким шансом одобрения.',
        clickApp:'75% Клик → Заявка (анкета партнёра) — показываем только релевантные офферы после проверки ПДН.',
        appIssue:'48% Заявка → Апрув (выдача партнёра) — целевой апрув после маршрутизации в подходящий продукт.',
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
      defaultCr:{visitClick:50,clickApp:76,appIssue:50},
      cac:600,cpa:0,ltv:3500,payback:3,share:0.30,
      mix:{seo:0.30,paid:0.20,crm:0.40,pr:0.10},
      cpa_text:'0 ₽ — экономия CAC + возобновление маржи ЦФ',
      ltv_text:'До 3–4 займов ЦФ в год после реактивации.',
      justify:{
        visitClick:'50% Контакт → Клик по офферу — реактивация Welcome-back возвращает клиента в понятный сценарий.',
        clickApp:'76% Клик → Заявка — анкета уже заполнена, остаётся подтвердить актуальные данные.',
        appIssue:'50% Заявка → Апрув (выдача ЦФ) — целевой апрув для прогретой базы после проверки статуса.',
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
      defaultCr:{visitClick:40,clickApp:65,appIssue:40},
      cac:920,cpa:3500,ltv:3500,payback:6,share:0.25,
      mix:{seo:0.40,paid:0.30,crm:0.05,pr:0.25},
      cpa_text:'1 000 – 6 000 ₽ (банки + МФО)',
      ltv_text:'Средний — 2–3 партнёрских продукта (кредиты / дебетовые карты / займы МФО) за год.',
      justify:{
        visitClick:'40% Контакт → Клик по офферу — непрофильный трафик сразу уходит на витрину банковских продуктов или МФО.',
        clickApp:'65% Клик → Заявка (анкета банка / МФО) — сокращённая анкета и подбор офферов под профиль клиента.',
        appIssue:'40% Заявка → Апрув — целевой микс кредитов, карт и МФО после фильтрации нерелевантных офферов.',
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
  function isSharedStateKey(key){return SHARED_STATE_KEYS.indexOf(key)>=0;}
  function sharedStateEndpoint(){
    if(sharedState.endpoint!==null)return sharedState.endpoint;
    var cfg=(typeof window!=='undefined'&&window.VYRUCHAI_SHARED_STATE_URL!=null)?String(window.VYRUCHAI_SHARED_STATE_URL).trim():'';
    sharedState.endpoint=cfg||'/api/cjm-state';
    return sharedState.endpoint;
  }
  function updateSharedStatus(){
    var el=$('cjmSharedStateStatus');if(!el)return;
    var text='Локально';
    if(sharedState.saving)text='Сохраняем в базу…';
    else if(sharedState.available)text='Синхронизировано с базой';
    else if(sharedState.error)text='База недоступна, сохранено локально';
    el.textContent=text;
    el.className='cjm-shared-state '+(sharedState.available?'ok':(sharedState.error?'warn':''));
  }
  function persistSharedStateNow(){
    var endpoint=sharedStateEndpoint();
    var canSync=endpoint&&typeof fetch==='function';
    if(!canSync){
      updateSharedStatus();
      return Promise.resolve(false);
    }
    var values=sharedState.pending;
    sharedState.pending={};
    if(Object.keys(values).length===0){
      updateSharedStatus();
      return Promise.resolve(false);
    }
    sharedState.saving=true;sharedState.error=false;updateSharedStatus();
    return fetch(endpoint,{
      method:'PUT',
      headers:{'Content-Type':'application/json'},
      credentials:'same-origin',
      body:JSON.stringify({values:values,updatedAt:new Date().toISOString()})
    }).then(function(r){
      if(!r.ok)throw new Error('shared-state '+r.status);
      sharedState.available=true;sharedState.error=false;
      return true;
    }).catch(function(){
      sharedState.available=false;sharedState.error=true;
      Object.keys(values).forEach(function(k){sharedState.pending[k]=values[k];});
      return false;
    }).finally(function(){sharedState.saving=false;updateSharedStatus();});
  }
  function scheduleSharedStateWrite(key,value){
    if(!isSharedStateKey(key))return;
    sharedState.pending[key]=value;
    if(sharedState.timer)clearTimeout(sharedState.timer);
    sharedState.timer=setTimeout(persistSharedStateNow,600);
    updateSharedStatus();
  }
  function loadSharedState(done){
    var endpoint=sharedStateEndpoint();
    if(!endpoint||typeof fetch!=='function'){if(done)done(false);return;}
    fetch(endpoint,{method:'GET',credentials:'same-origin',cache:'no-store'}).then(function(r){
      if(!r.ok)throw new Error('shared-state '+r.status);
      return r.json();
    }).then(function(data){
      var values=data&&data.values&&typeof data.values==='object'?data.values:data;
      if(!values||typeof values!=='object')return false;
      SHARED_STATE_KEYS.forEach(function(key){
        if(values[key]!=null){
          memStore[key]=values[key];
          try{localStorage.setItem(key,JSON.stringify(values[key]));}catch(e){}
        }
      });
      sharedState.loaded=true;sharedState.available=true;sharedState.error=false;updateSharedStatus();
      return true;
    }).then(function(changed){if(done)done(!!changed);}).catch(function(){
      sharedState.loaded=true;sharedState.available=false;sharedState.error=true;updateSharedStatus();
      if(done)done(false);
    });
  }
  function read(key,fallback){
    try{var raw=localStorage.getItem(key);if(raw!=null)return JSON.parse(raw);}
    catch(e){/* localStorage unavailable — fall through to in-memory */}
    return key in memStore?memStore[key]:fallback;
  }
  function write(key,value){
    memStore[key]=value;
    try{localStorage.setItem(key,JSON.stringify(value));}
    catch(e){/* in-memory copy already kept */}
    scheduleSharedStateWrite(key,value);
  }
  // Мост для сторонних модулей (finance-100m.js): позволяет им отправлять свои
  // ключи состояния в /api/cjm-state тем же батчем, что и правки CJM-вкладок.
  if(typeof window!=='undefined')window.CjmSharedState={scheduleWrite:scheduleSharedStateWrite};

  // ---- Share-by-link (URL hash) --------------------------------------------
  // Позволяет скопировать текущее состояние дашборда в ссылку: все правки,
  // которые редактор внёс в сегменты/финмодель, кодируются в location.hash,
  // и любой, кто откроет ссылку, увидит те же цифры. Работает даже без
  // серверного /api/cjm-state — это делает дашборд полноценно «шаринговым».
  function utf8ToB64(str){
    try{
      return btoa(unescape(encodeURIComponent(str)))
        .replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
    }catch(e){return '';}
  }
  function b64ToUtf8(str){
    try{
      var s=String(str||'').replace(/-/g,'+').replace(/_/g,'/');
      while(s.length%4)s+='=';
      return decodeURIComponent(escape(atob(s)));
    }catch(e){return '';}
  }
  // Компактное URL-safe сжатие полезной нагрузки (алгоритм LZString,
  // compressToEncodedURIComponent / decompressFromEncodedURIComponent,
  // MIT © 2013 pieroxy — https://github.com/pieroxy/lz-string). Именно оно
  // делает ссылку короткой: JSON-состояние ужимается в разы перед вставкой в
  // hash. Без сервера-«сократителя» это самый надёжный способ уместить все
  // цифры и показатели в короткий линк, который можно скопировать и отправить.
  var LZ=(function(){
    var keyStr='ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+-$';
    var baseReverseDic={};
    function getBaseValue(alphabet,character){
      if(!baseReverseDic[alphabet]){
        baseReverseDic[alphabet]={};
        for(var i=0;i<alphabet.length;i++)baseReverseDic[alphabet][alphabet.charAt(i)]=i;
      }
      return baseReverseDic[alphabet][character];
    }
    function _compress(uncompressed,bitsPerChar,getCharFromInt){
      if(uncompressed==null)return '';
      var i,value,context_dictionary={},context_dictionaryToCreate={},context_c='',
        context_wc='',context_w='',context_enlargeIn=2,context_dictSize=3,context_numBits=2,
        context_data=[],context_data_val=0,context_data_position=0,ii;
      for(ii=0;ii<uncompressed.length;ii+=1){
        context_c=uncompressed.charAt(ii);
        if(!Object.prototype.hasOwnProperty.call(context_dictionary,context_c)){
          context_dictionary[context_c]=context_dictSize++;
          context_dictionaryToCreate[context_c]=true;
        }
        context_wc=context_w+context_c;
        if(Object.prototype.hasOwnProperty.call(context_dictionary,context_wc)){
          context_w=context_wc;
        }else{
          if(Object.prototype.hasOwnProperty.call(context_dictionaryToCreate,context_w)){
            if(context_w.charCodeAt(0)<256){
              for(i=0;i<context_numBits;i++){
                context_data_val=(context_data_val<<1);
                if(context_data_position==bitsPerChar-1){context_data_position=0;context_data.push(getCharFromInt(context_data_val));context_data_val=0;}else{context_data_position++;}
              }
              value=context_w.charCodeAt(0);
              for(i=0;i<8;i++){
                context_data_val=(context_data_val<<1)|(value&1);
                if(context_data_position==bitsPerChar-1){context_data_position=0;context_data.push(getCharFromInt(context_data_val));context_data_val=0;}else{context_data_position++;}
                value=value>>1;
              }
            }else{
              value=1;
              for(i=0;i<context_numBits;i++){
                context_data_val=(context_data_val<<1)|value;
                if(context_data_position==bitsPerChar-1){context_data_position=0;context_data.push(getCharFromInt(context_data_val));context_data_val=0;}else{context_data_position++;}
                value=0;
              }
              value=context_w.charCodeAt(0);
              for(i=0;i<16;i++){
                context_data_val=(context_data_val<<1)|(value&1);
                if(context_data_position==bitsPerChar-1){context_data_position=0;context_data.push(getCharFromInt(context_data_val));context_data_val=0;}else{context_data_position++;}
                value=value>>1;
              }
            }
            context_enlargeIn--;
            if(context_enlargeIn==0){context_enlargeIn=Math.pow(2,context_numBits);context_numBits++;}
            delete context_dictionaryToCreate[context_w];
          }else{
            value=context_dictionary[context_w];
            for(i=0;i<context_numBits;i++){
              context_data_val=(context_data_val<<1)|(value&1);
              if(context_data_position==bitsPerChar-1){context_data_position=0;context_data.push(getCharFromInt(context_data_val));context_data_val=0;}else{context_data_position++;}
              value=value>>1;
            }
          }
          context_enlargeIn--;
          if(context_enlargeIn==0){context_enlargeIn=Math.pow(2,context_numBits);context_numBits++;}
          context_dictionary[context_wc]=context_dictSize++;
          context_w=String(context_c);
        }
      }
      if(context_w!==''){
        if(Object.prototype.hasOwnProperty.call(context_dictionaryToCreate,context_w)){
          if(context_w.charCodeAt(0)<256){
            for(i=0;i<context_numBits;i++){
              context_data_val=(context_data_val<<1);
              if(context_data_position==bitsPerChar-1){context_data_position=0;context_data.push(getCharFromInt(context_data_val));context_data_val=0;}else{context_data_position++;}
            }
            value=context_w.charCodeAt(0);
            for(i=0;i<8;i++){
              context_data_val=(context_data_val<<1)|(value&1);
              if(context_data_position==bitsPerChar-1){context_data_position=0;context_data.push(getCharFromInt(context_data_val));context_data_val=0;}else{context_data_position++;}
              value=value>>1;
            }
          }else{
            value=1;
            for(i=0;i<context_numBits;i++){
              context_data_val=(context_data_val<<1)|value;
              if(context_data_position==bitsPerChar-1){context_data_position=0;context_data.push(getCharFromInt(context_data_val));context_data_val=0;}else{context_data_position++;}
              value=0;
            }
            value=context_w.charCodeAt(0);
            for(i=0;i<16;i++){
              context_data_val=(context_data_val<<1)|(value&1);
              if(context_data_position==bitsPerChar-1){context_data_position=0;context_data.push(getCharFromInt(context_data_val));context_data_val=0;}else{context_data_position++;}
              value=value>>1;
            }
          }
          context_enlargeIn--;
          if(context_enlargeIn==0){context_enlargeIn=Math.pow(2,context_numBits);context_numBits++;}
          delete context_dictionaryToCreate[context_w];
        }else{
          value=context_dictionary[context_w];
          for(i=0;i<context_numBits;i++){
            context_data_val=(context_data_val<<1)|(value&1);
            if(context_data_position==bitsPerChar-1){context_data_position=0;context_data.push(getCharFromInt(context_data_val));context_data_val=0;}else{context_data_position++;}
            value=value>>1;
          }
        }
        context_enlargeIn--;
        if(context_enlargeIn==0){context_enlargeIn=Math.pow(2,context_numBits);context_numBits++;}
      }
      value=2;
      for(i=0;i<context_numBits;i++){
        context_data_val=(context_data_val<<1)|(value&1);
        if(context_data_position==bitsPerChar-1){context_data_position=0;context_data.push(getCharFromInt(context_data_val));context_data_val=0;}else{context_data_position++;}
        value=value>>1;
      }
      while(true){
        context_data_val=(context_data_val<<1);
        if(context_data_position==bitsPerChar-1){context_data.push(getCharFromInt(context_data_val));break;}else context_data_position++;
      }
      return context_data.join('');
    }
    function _decompress(length,resetValue,getNextValue){
      var dictionary=[],next,enlargeIn=4,dictSize=4,numBits=3,entry='',result=[],i,w,bits,resb,maxpower,power,c,
        data={val:getNextValue(0),position:resetValue,index:1};
      for(i=0;i<3;i+=1)dictionary[i]=i;
      bits=0;maxpower=Math.pow(2,2);power=1;
      while(power!=maxpower){resb=data.val&data.position;data.position>>=1;if(data.position==0){data.position=resetValue;data.val=getNextValue(data.index++);}bits|=(resb>0?1:0)*power;power<<=1;}
      switch(next=bits){
        case 0:bits=0;maxpower=Math.pow(2,8);power=1;while(power!=maxpower){resb=data.val&data.position;data.position>>=1;if(data.position==0){data.position=resetValue;data.val=getNextValue(data.index++);}bits|=(resb>0?1:0)*power;power<<=1;}c=String.fromCharCode(bits);break;
        case 1:bits=0;maxpower=Math.pow(2,16);power=1;while(power!=maxpower){resb=data.val&data.position;data.position>>=1;if(data.position==0){data.position=resetValue;data.val=getNextValue(data.index++);}bits|=(resb>0?1:0)*power;power<<=1;}c=String.fromCharCode(bits);break;
        case 2:return '';
      }
      dictionary[3]=c;w=c;result.push(c);
      while(true){
        if(data.index>length)return '';
        bits=0;maxpower=Math.pow(2,numBits);power=1;
        while(power!=maxpower){resb=data.val&data.position;data.position>>=1;if(data.position==0){data.position=resetValue;data.val=getNextValue(data.index++);}bits|=(resb>0?1:0)*power;power<<=1;}
        switch(c=bits){
          case 0:bits=0;maxpower=Math.pow(2,8);power=1;while(power!=maxpower){resb=data.val&data.position;data.position>>=1;if(data.position==0){data.position=resetValue;data.val=getNextValue(data.index++);}bits|=(resb>0?1:0)*power;power<<=1;}dictionary[dictSize++]=String.fromCharCode(bits);c=dictSize-1;enlargeIn--;break;
          case 1:bits=0;maxpower=Math.pow(2,16);power=1;while(power!=maxpower){resb=data.val&data.position;data.position>>=1;if(data.position==0){data.position=resetValue;data.val=getNextValue(data.index++);}bits|=(resb>0?1:0)*power;power<<=1;}dictionary[dictSize++]=String.fromCharCode(bits);c=dictSize-1;enlargeIn--;break;
          case 2:return result.join('');
        }
        if(enlargeIn==0){enlargeIn=Math.pow(2,numBits);numBits++;}
        if(dictionary[c]){entry=dictionary[c];}else{if(c===dictSize){entry=w+w.charAt(0);}else{return null;}}
        result.push(entry);
        dictionary[dictSize++]=w+entry.charAt(0);
        enlargeIn--;
        w=entry;
        if(enlargeIn==0){enlargeIn=Math.pow(2,numBits);numBits++;}
      }
    }
    return {
      compressToEncodedURIComponent:function(input){
        if(input==null)return '';
        return _compress(input,6,function(a){return keyStr.charAt(a);});
      },
      decompressFromEncodedURIComponent:function(input){
        if(input==null)return '';
        if(input=='')return null;
        input=String(input).replace(/ /g,'+');
        return _decompress(input.length,32,function(index){return getBaseValue(keyStr,input.charAt(index));});
      }
    };
  })();
  function collectShareState(){
    return {
      [STORAGE_KEY]:read(STORAGE_KEY,{segment:segments[0].id})||{segment:segments[0].id},
      [MANUAL_KEY]:read(MANUAL_KEY,{})||{},
      [GLOBAL_KEY]:read(GLOBAL_KEY,{})||{},
      [SHARES_KEY]:read(SHARES_KEY,{})||{},
      [DESC_KEY]:read(DESC_KEY,{})||{},
      [FINANCE_KEY]:read(FINANCE_KEY,{})||{},
      [FIN100_KEY]:read(FIN100_KEY,{})||{}
    };
  }
  function saveCurrentSharedState(){
    var payload=collectShareState();
    SHARED_STATE_KEYS.forEach(function(key){
      var value=payload[key];
      memStore[key]=value;
      try{localStorage.setItem(key,JSON.stringify(value));}catch(e){}
      sharedState.pending[key]=value;
    });
    if(sharedState.timer){clearTimeout(sharedState.timer);sharedState.timer=null;}
    return persistSharedStateNow();
  }
  var SAVE_OK_MESSAGE='Показатели сохранены — ссылка откроется с текущими данными';
  var SAVE_ERROR_MESSAGE='Не удалось сохранить в базу — показатели остались только локально';
  var SAVE_FEEDBACK_MS=1800;
  function showSaveResult(ok){
    showToast(ok?SAVE_OK_MESSAGE:SAVE_ERROR_MESSAGE);
  }
  function buildShareUrl(){
    var payload=collectShareState();
    var json=JSON.stringify(payload);
    var base=location.origin+location.pathname+location.search;
    // Короткий формат #z= (сжатый). При сбое сжатия — откат на #s= (base64),
    // чтобы ссылка всё равно работала.
    var compressed='';
    try{compressed=LZ.compressToEncodedURIComponent(json);}catch(e){compressed='';}
    if(compressed)return base+'#z='+compressed;
    var encoded=utf8ToB64(json);
    return encoded?base+'#s='+encoded:base;
  }
  function applyStateFromUrl(){
    var hash=String(location.hash||'');
    var json='';
    var mz=hash.match(/[#&]z=([^&]+)/);
    if(mz){
      try{json=LZ.decompressFromEncodedURIComponent(mz[1])||'';}catch(e){json='';}
    }
    if(!json){
      var m=hash.match(/[#&]s=([^&]+)/);
      if(!m)return false;
      json=b64ToUtf8(m[1]);
    }
    if(!json)return false;
    var data;try{data=JSON.parse(json);}catch(e){return false;}
    if(!data||typeof data!=='object')return false;
    var applied=false;
    SHARED_STATE_KEYS.forEach(function(k){
      if(data[k]!=null){
        write(k,data[k]);
        applied=true;
      }
    });
    return applied;
  }
  function showToast(text){
    var t=document.createElement('div');
    t.className='cjm-toast';t.textContent=text;
    document.body.appendChild(t);
    requestAnimationFrame(function(){t.classList.add('show');});
    setTimeout(function(){t.classList.remove('show');setTimeout(function(){t.remove();},250);},SAVE_FEEDBACK_MS);
  }
  function copyToClipboard(text){
    if(navigator&&navigator.clipboard&&navigator.clipboard.writeText){
      return navigator.clipboard.writeText(text);
    }
    return new Promise(function(resolve,reject){
      try{
        var ta=document.createElement('textarea');ta.value=text;ta.style.position='fixed';ta.style.opacity='0';
        document.body.appendChild(ta);ta.select();
        var ok=document.execCommand('copy');ta.remove();
        ok?resolve():reject(new Error('copy failed'));
      }catch(e){reject(e);}
    });
  }
  function initShareLink(){
    var btn=$('cjmShareLink');if(!btn)return;
    btn.addEventListener('click',function(){
      var prev=btn.textContent;btn.disabled=true;btn.textContent='Сохраняем…';
      saveCurrentSharedState().then(function(ok){
        var url=buildShareUrl();
        try{history.replaceState(null,'',url);}catch(e){}
        return copyToClipboard(url).then(function(){
          btn.classList.add('copied');
          btn.textContent='Ссылка скопирована';
          showToast(ok?'Ссылка скопирована — отправьте её любому пользователю':'База недоступна — скопирована ссылка с данными внутри');
          setTimeout(function(){btn.classList.remove('copied');btn.textContent=prev;btn.disabled=false;},SAVE_FEEDBACK_MS);
        }).catch(function(){
          btn.textContent=prev;btn.disabled=false;
          showToast('Скопируйте ссылку из адресной строки');
        });
      });
    });
    var save=$('cjmSaveState');
    if(save)save.addEventListener('click',function(){
      var prev=save.textContent;save.disabled=true;save.textContent='Сохраняем…';
      saveCurrentSharedState().then(function(ok){
        showSaveResult(ok);
        save.textContent=ok?'Сохранено':'Ошибка';
        setTimeout(function(){save.textContent=prev;save.disabled=false;},SAVE_FEEDBACK_MS);
      });
    });
  }

  // --- Обмен финмоделью между ПК: ссылка / экспорт / импорт файла ----------
  // Экспорт скачивает JSON со всеми ключами состояния (сегменты, доли,
  // финмодель); импорт применяет такой файл через write(), поэтому данные
  // сохраняются локально и уходят в /api/cjm-state, если он доступен.
  function exportStateToFile(){
    var payload=collectShareState();
    var blob=new Blob([JSON.stringify(payload,null,2)],{type:'application/json'});
    var a=document.createElement('a');
    a.href=URL.createObjectURL(blob);
    a.download='vyruchai-finmodel-'+new Date().toISOString().slice(0,10)+'.json';
    document.body.appendChild(a);a.click();a.remove();
    setTimeout(function(){try{URL.revokeObjectURL(a.href);}catch(e){}},1000);
    showToast('Файл с показателями скачан — передайте его другому пользователю');
  }
  function importStateFromJson(json){
    var data;try{data=JSON.parse(json);}catch(e){return false;}
    if(!data||typeof data!=='object')return false;
    var applied=false;
    SHARED_STATE_KEYS.forEach(function(k){
      if(data[k]!=null){write(k,data[k]);applied=true;}
    });
    return applied;
  }
  function initFinShareTools(){
    var share=$('finShareLink');
    if(share)share.addEventListener('click',function(){
      var prev=share.textContent;share.disabled=true;share.textContent='Сохраняем…';
      saveCurrentSharedState().then(function(ok){
        var url=buildShareUrl();
        try{history.replaceState(null,'',url);}catch(e){}
        return copyToClipboard(url).then(function(){
          showToast(ok?'Ссылка скопирована — откройте её на любом ПК, показатели подтянутся':'База недоступна — скопирована ссылка с данными внутри');
        }).catch(function(){
          showToast('Скопируйте ссылку из адресной строки');
        }).finally(function(){share.textContent=prev;share.disabled=false;});
      });
    });
    var save=$('finSaveState');
    if(save)save.addEventListener('click',function(){
      var prev=save.textContent;save.disabled=true;save.textContent='Сохраняем…';
      saveCurrentSharedState().then(function(ok){
        showSaveResult(ok);
        save.textContent=ok?'Сохранено':'Ошибка';
        setTimeout(function(){save.textContent=prev;save.disabled=false;},SAVE_FEEDBACK_MS);
      });
    });
    var exp=$('finExport');
    if(exp)exp.addEventListener('click',exportStateToFile);
    var imp=$('finImport'),file=$('finImportFile');
    if(imp&&file){
      imp.addEventListener('click',function(){file.value='';file.click();});
      file.addEventListener('change',function(){
        var f=file.files&&file.files[0];if(!f)return;
        var reader=new FileReader();
        reader.onload=function(){
          if(importStateFromJson(String(reader.result||''))){
            applyStoredShares();renderAll();
            showToast('Показатели загружены из файла');
          }else{
            showToast('Не удалось прочитать файл — нужен JSON из кнопки «Экспорт в файл»');
          }
        };
        reader.readAsText(f);
      });
    }
    var mbtn=$('finMathBtn'),modal=$('finMathModal');
    if(mbtn&&modal){
      mbtn.addEventListener('click',function(){modal.hidden=false;});
      modal.addEventListener('click',function(ev){
        var close=ev.target&&ev.target.closest?ev.target.closest('[data-fin-math-close]'):null;
        if(close)modal.hidden=true;
      });
      document.addEventListener('keydown',function(ev){
        if(ev.key==='Escape'&&!modal.hidden)modal.hidden=true;
      });
    }
  }

  // Импортируем состояние из #s=... до первого рендера, чтобы сторонний
  // пользователь, открывший ссылку, увидел ровно те же данные.
  var urlStateApplied=applyStateFromUrl();

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
  function isFinance100View(){return selectedId()==='finance100';}
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
  // Единый источник посегментных показателей для финмодели: значения ВСЕГДА берутся
  // из вкладки соответствующего сегмента (блок «Ручной ввод показателей»), из
  // глобального блока «Визит → Контакт» либо из общего распределения долей CJM.
  //   crVc_*   (Визит → Контакт) ← глобальный visitContact (одна конверсия на все сегменты)
  //   crCc_*   (Контакт → Клик)  ← manualFor(seg).visitClick
  //   crCa_*   (Клик → Заявка)   ← manualFor(seg).clickApp
  //   crAi_*   (Заявка → Апрув)  ← manualFor(seg).appIssue
  //   payout_* (CPA / стоимость лида, ₽)     ← manualFor(seg).cpa
  //                                             (для сегментов с lead-sale миксом cpa
  //                                              = взвешенное среднее CPA сценариев,
  //                                              совпадает с показателем на вкладке)
  //   share_*  (доля сегмента в потоке, %)   ← segments[i].share × 100
  // Так финмодель и CJM-воронка не расходятся: правка в любом месте меняет одну и
  // ту же величину, и наоборот — правка во вкладке сегмента сразу отражается в
  // финмодели. Возвращает объект со всеми связанными ключами.
  function finSegSourced(){
    var g=globalStore();
    var out={};
    FIN_SEG_META.forEach(function(m){
      var id=m.key.toLowerCase();
      var man=manualFor(id)||{};
      var seg=segmentById(id);
      out[m.crVcKey]=g.visitContact;
      out[m.crCcKey]=man.visitClick;
      out[m.crCaKey]=man.clickApp;
      out[m.crAiKey]=man.appIssue;
      out[m.payoutKey]=man.cpa;
      out[m.shareKey]=seg?seg.share*100:null;
    });
    return out;
  }
  // Набор ключей, связанных с посегментными источниками (CR, payout, share).
  var FIN_SEG_LINKED_KEYS=(function(){
    var set={};
    FIN_SEG_META.forEach(function(m){
      set[m.crVcKey]=1;set[m.crCcKey]=1;set[m.crCaKey]=1;set[m.crAiKey]=1;
      set[m.payoutKey]=1;set[m.shareKey]=1;
    });
    return set;
  })();
  function finSegBinding(key){
    for(var i=0;i<FIN_SEG_META.length;i++){
      var m=FIN_SEG_META[i],id=m.key.toLowerCase();
      if(key===m.crVcKey)return {globalKey:'visitContact'};
      if(key===m.crCcKey)return {segId:id,manualKey:'visitClick'};
      if(key===m.crCaKey)return {segId:id,manualKey:'clickApp'};
      if(key===m.crAiKey)return {segId:id,manualKey:'appIssue'};
      if(key===m.payoutKey)return {segId:id,manualKey:'cpa'};
      if(key===m.shareKey)return {shareSegId:id};
    }
    return null;
  }
  function finSegSourceIsEdited(key){
    var b=finSegBinding(key);
    if(!b)return false;
    if(b.globalKey)return isGlobalEdited(b.globalKey);
    if(b.shareSegId){
      var saved=read(SHARES_KEY,null);
      return !!(saved&&saved[b.shareSegId]!=null);
    }
    return isEdited(b.segId,b.manualKey);
  }
  function setFinSegSource(key,value){
    var b=finSegBinding(key);
    if(!b)return false;
    if(b.globalKey){setGlobal(b.globalKey,value);return true;}
    if(b.shareSegId){setShare(b.shareSegId,Number(value)/100);return true;}
    setManual(b.segId,b.manualKey,value);
    return true;
  }
  function unsetFinSegSource(key){
    var b=finSegBinding(key);
    if(!b)return false;
    if(b.globalKey){unsetGlobal(b.globalKey);return true;}
    if(b.shareSegId){
      var saved=read(SHARES_KEY,{})||{};
      if(saved[b.shareSegId]!=null){
        delete saved[b.shareSegId];
        if(Object.keys(saved).length===0)write(SHARES_KEY,null);
        else write(SHARES_KEY,saved);
      }
      var s=segmentById(b.shareSegId);
      if(s)s.share=DEFAULT_SHARES[b.shareSegId];
      return true;
    }
    unsetManual(b.segId,b.manualKey);
    return true;
  }
  // Миграция legacy-значений `FINANCE_KEY`: раньше payout*/share* хранились
  // в отдельном слое финмодели. Теперь единый источник — сегменты, поэтому
  // переносим сохранённые правки в manualStore/SHARES_KEY и удаляем из FINANCE_KEY.
  function finMigrateLegacyLinked(){
    var raw=read(FINANCE_KEY,null);
    if(!raw||typeof raw!=='object')return;
    var changed=false;
    FIN_SEG_META.forEach(function(m){
      var id=m.key.toLowerCase();
      if(raw[m.payoutKey]!=null){
        // Пишем только если пользователь ещё не переопределил cpa в самом сегменте.
        if(!isEdited(id,'cpa')){
          var v=Number(raw[m.payoutKey]);
          if(isFinite(v))setManual(id,'cpa',clamp(v,0,1000000));
        }
        delete raw[m.payoutKey];changed=true;
      }
      if(raw[m.shareKey]!=null){
        var savedShares=read(SHARES_KEY,null);
        var hasCustom=savedShares&&savedShares[id]!=null;
        if(!hasCustom){
          var sv=Number(raw[m.shareKey]);
          if(isFinite(sv))setShare(id,clamp(sv,0,100)/100);
        }
        delete raw[m.shareKey];changed=true;
      }
    });
    if(changed)write(FINANCE_KEY,raw);
  }
  finMigrateLegacyLinked();
  function finInputs(){
    var raw=finRaw();var out={};
    var seg=finSegSourced();
    Object.keys(FIN_DEFAULTS).forEach(function(k){
      // Связанные с сегментами поля (CR / CPA / доли) всегда берём из единого
      // источника — вкладки сегмента / глобального блока / SHARES_KEY. Так
      // правка в любом месте меняет одну и ту же величину. Для остальных
      // финансовых полей остаётся FINANCE_KEY.
      var fallback=(FIN_SEG_LINKED_KEYS[k]&&seg[k]!=null&&isFinite(Number(seg[k])))?Number(seg[k]):FIN_DEFAULTS[k];
      out[k]=FIN_SEG_LINKED_KEYS[k]?fallback:(raw[k]!=null&&isFinite(Number(raw[k]))?Number(raw[k]):fallback);
    });
    return out;
  }
  function finIsEdited(key){if(FIN_SEG_LINKED_KEYS[key])return finSegSourceIsEdited(key);var raw=finRaw();return raw[key]!=null;}
  function setFin(key,value){if(FIN_SEG_LINKED_KEYS[key]){setFinSegSource(key,value);return;}var raw=finRaw();raw[key]=value;write(FINANCE_KEY,raw);}
  function unsetFin(key){if(FIN_SEG_LINKED_KEYS[key]){unsetFinSegSource(key);return;}var raw=finRaw();if(raw[key]!=null){delete raw[key];write(FINANCE_KEY,raw);}}
  function resetFin(){write(FINANCE_KEY,{});}

  // Нормированные доли сегментов (0..1). Порядок соответствует FIN_SEG_META.
  function finSharesNormalized(inp){
    var raw=FIN_SEG_META.map(function(m){return Math.max(0,Number(inp[m.shareKey])||0);});
    var sum=raw.reduce(function(a,b){return a+b;},0)||1;
    return raw.map(function(v){return v/sum;});
  }

  // Мост для финмодели «100 млн ₽» (finance-100m.js). Отдаёт посегментные показатели
  // воронки ровно в том виде, в каком их видят вкладки сегментов CJM:
  //   crVc  — Визит → Контакт (оставленный телефон)
  //   crCc  — Контакт → Клик по офферу
  //   crCa  — Клик → Заявка
  //   crAi  — Заявка → Апрув (выдача)
  //   payout — выплата за выдачу (₽), share — доля сегмента (0..1, нормирована).
  // Финмодель 100 млн использует эти конверсии, чтобы из требуемой выручки вывести
  // необходимые объёмы трафика, контактов, заявок и апрувов. Единый источник значений —
  // те же вкладки сегментов, поэтому правка конверсии в сегменте сразу отражается в модели.
  function finSegmentFunnel(){
    var inp=finInputs();
    var shares=finSharesNormalized(inp);
    var segments=FIN_SEG_META.map(function(m,i){
      return {
        key:m.key,
        name:m.name,
        share:shares[i],
        crVc:clamp(inp[m.crVcKey],0,100)/100,
        crCc:clamp(inp[m.crCcKey],0,100)/100,
        crCa:clamp(inp[m.crCaKey],0,100)/100,
        crAi:clamp(inp[m.crAiKey],0,100)/100,
        payout:Math.max(0,Number(inp[m.payoutKey])||0)
      };
    });
    return {segments:segments};
  }
  // Публичный доступ для finance-100m.js (он загружается тем же документом).
  // getMarketingSharePct — «% на маркетинг» из обычной финмодели («Финмодель
  // до декабря 2027»): медиа-бюджет / выручка на конце горизонта, в процентах.
  // Финмодель 100 млн использует его как источник доли маркетинга, чтобы обе
  // вкладки исходили из одних и тех же показателей.
  function finMarketingSharePct(){
    var res=computeFinance();
    var n=res.months.length;
    if(!n)return null;
    var mediaLast=res.cost[n-1]-res.fixedMonthly;
    var revLast=res.revenue[n-1];
    if(!isFinite(mediaLast)||!isFinite(revLast)||revLast<=0)return null;
    return clamp(mediaLast/revLast*100,0,100);
  }
  function finMonthKeyAt(index){
    if(FIN_MONTH_KEYS[index])return FIN_MONTH_KEYS[index];
    var monthIndex=6+index; // июль 2026 = 6 при 0-based месяце
    var year=2026+Math.floor(monthIndex/12);
    var month=(monthIndex%12)+1;
    return year+'-'+String(month).padStart(2,'0');
  }
  function finPlanForBridge(){
    var res=computeFinance();
    return {
      months:res.months.map(function(label,i){
        return {
          key:finMonthKeyAt(i),
          label:label,
          netProfit:res.profit[i],
          revenue:res.revenue[i],
          cost:res.cost[i],
          traffic:res.visits[i],
          contacts:res.contacts[i],
          applications:res.apps[i],
          approvals:res.issues[i]
        };
      })
    };
  }
  if(typeof window!=='undefined'){
    window.CjmSegmentsBridge=window.CjmSegmentsBridge||{};
    window.CjmSegmentsBridge.getFunnel=finSegmentFunnel;
    window.CjmSegmentsBridge.getMarketingSharePct=finMarketingSharePct;
    window.CjmSegmentsBridge.getFinancePlan=finPlanForBridge;
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

  // Возвращает множитель контактов для источника.
  // Параметры:
  //   item.meta.key — ключ источника из FIN_SRC_META;
  //   revenueScale  — полный накопительный множитель спроса/выручки;
  //   paidShare     — доля [0..1] SEO-эффекта для paid/PR/other.
  // Формула: SEO = revenueScale; остальные = 1 + (revenueScale - 1) × paidShare.
  function finSourceResponseScale(item,revenueScale,paidShare){
    if(item&&item.meta&&item.meta.key==='Seo')return revenueScale;
    return 1+(revenueScale-1)*paidShare;
  }

  // Основной расчёт: возвращает помесячные ряды и агрегаты.
  //   exp(t)         = horizon × (t/horizon)^growthPower   — показатель, нормированный на горизонт
  //   после мая 2027 exp(t) дополнительно сглаживается через postMayGrowthFactor
  //   revenueScale_t = (1+g)^exp(t)   — монотонный рост выручки/спроса без взрыва
  //   costScale_t    = 1 + costGrowthMonthly × t — линейный рост расходов, не экспонента
  //   contacts_t     = Σ contacts_i0 × response_i(t), где SEO получает полный
  //                    накопительный эффект, а платные источники — только часть
  //   Для каждого сегмента i (доля share_i, посегментные CR):
  //     segContacts_i(t) = contacts_t × share_i
  //     segIssues_i(t)   = segContacts_i(t) × crCc_i × crCa_i × crAi_i
  //     segRevenue_i(t)  = segIssues_i(t) × payout_i
  //     segVisits_i(t)   = segContacts_i(t) / crVc_i        (визиты на маркетплейс)
  //   revenue_t = Σ segRevenue_i(t) (+ CF-выручка при cfPayout>0)
  //   costs_t   = trafficCost_t + FOT + Dev
  //   avg*_i    — взвешенные по долям средние (для отображения)
  function computeFinance(){
    var inp=finInputs();
    var g=inp.monthlyGrowth/100;
    var power=Number(inp.growthPower);
    if(!isFinite(power)||power<=0)power=1;
    var shares=finSharesNormalized(inp);
    var payouts=FIN_SEG_META.map(function(m){return Number(inp[m.payoutKey])||0;});
    // Посегментные CR (%) → доли (0..1). Clamp [0..100] на всякий случай.
    var crVc=FIN_SEG_META.map(function(m){return clamp(inp[m.crVcKey],0,100)/100;});
    var crCc=FIN_SEG_META.map(function(m){return clamp(inp[m.crCcKey],0,100)/100;});
    var crCa=FIN_SEG_META.map(function(m){return clamp(inp[m.crCaKey],0,100)/100;});
    var crAi=FIN_SEG_META.map(function(m){return clamp(inp[m.crAiKey],0,100)/100;});
    // Посегментные производные показатели
    var segConv=FIN_SEG_META.map(function(_m,i){return crCc[i]*crCa[i]*crAi[i];}); // Контакт → Апрув
    var segRevPerContact=FIN_SEG_META.map(function(_m,i){return segConv[i]*payouts[i];});
    // Взвешенные средние по долям — для карточек «сводных» показателей
    var avgVc=0,avgCc=0,avgCa=0,avgAi=0,avgConv=0,blendedRevPerContact=0;
    for(var si=0;si<shares.length;si++){
      avgVc+=shares[si]*crVc[si];
      avgCc+=shares[si]*crCc[si];
      avgCa+=shares[si]*crCa[si];
      avgAi+=shares[si]*crAi[si];
      avgConv+=shares[si]*segConv[si];
      blendedRevPerContact+=shares[si]*segRevPerContact[si];
    }
    // «Визиты на маркетплейс на один контакт», усреднённые по долям:
    //   visits_per_contact = Σ share_i / crVc_i   (агрегируем визиты, не CR)
    var visitsPerContact=0;
    for(var si2=0;si2<shares.length;si2++){
      if(crVc[si2]>0)visitsPerContact+=shares[si2]/crVc[si2];
    }
    // Blended payout (взвешенное среднее CPA) — используется для legacy-совместимости.
    var blendedPayout=0;
    for(var si3=0;si3<shares.length;si3++)blendedPayout+=shares[si3]*payouts[si3];
    var sources=finSourcesBreakdown(inp);
    var contacts0=sources.totalContacts;
    var trafficCost0=sources.totalBudget;
    var cfShare=clamp(inp.cfApprovalShare,0,100)/100;
    var costGrowth=clamp(inp.costGrowthMonthly,0,200)/100;
    var paidShare=clamp(inp.paidDemandShare,0,100)/100;
    var postMayGrowthFactor=clamp(inp.postMayGrowthFactor,0,100)/100;
    var taxRate=clamp(inp.taxRate,0,99.9)/100;
    var postMayStart=FIN_MONTHS.indexOf('Май 2027');
    var n=FIN_MONTHS.length;
    var horizon=n-1; // длина горизонта в шагах (t = 0..horizon)
    var finalCost=(trafficCost0*(1+costGrowth*horizon))+(inp.fotMonthly+inp.devMonthly);
    var targetProfit=Math.max(0,Number(inp.targetNetProfit)||0);
    var targetRevenue=(targetProfit+finalCost)/(1-taxRate);
    var startRevenue=Math.max(0,Number(inp.startRevenue)||0);
    var revPerContact=blendedRevPerContact+cfShare*avgConv*inp.cfPayout;
    var contacts=[],visits=[],apps=[],issues=[],revenue=[],cost=[],tax=[],profit=[],cumProfit=[],cumInvest=[],cfClients=[],cfRevenue=[],ppc=[],scales=[],costScales=[];
    // Помесячные ряды по сегментам (для раскрывающейся таблицы «Помесячный план»).
    // segMonthly[i] хранит месяц-за-месяцем контакты/заявки/выдачи/выручку/маркет-расход/CAC/прибыль сегмента.
    // CAC_i(t) = mediaCost_i(t) / issues_i(t), где mediaCost_i(t) — часть медиа-бюджета,
    // атрибутируемая сегменту через его долю контактов. CAC зависит от 4-х конверсий воронки:
    // при прочих равных, чем ниже crCc·crCa·crAi у сегмента, тем выше CAC этого сегмента.
    var segMonthly=FIN_SEG_META.map(function(){
      return {contacts:[],apps:[],issues:[],revenue:[],mediaCost:[],cac:[],profit:[],visits:[]};
    });
    // Посегментные ряды выручки/выдач (для карточек по сегментам и последнего месяца)
    var segIssuesLast=FIN_SEG_META.map(function(){return 0;});
    var segRevenueLast=FIN_SEG_META.map(function(){return 0;});
    var segCacLast=FIN_SEG_META.map(function(){return 0;});
    var runProfit=0,runInvest=0,peakNeed=0,paybackIdx=-1;
    var fixedMonthly=inp.fotMonthly+inp.devMonthly;
    for(var t=0;t<n;t++){
      // Рост выручки/спроса, нормированный на горизонт (устраняет «двойную экспоненту» и взрыв до млрд):
      //   exp(t)   = horizon · (t / horizon)^power   — показатель степени
      //   revenueScale_t  = (1 + g)^exp(t)
      // Свойства:
      //   • строго монотонно растёт по t (t/horizon ∈ [0..1], x^power возрастает при power>0),
      //     поэтому бизнес «всегда приростает» из месяца в месяц;
      //   • после мая 2027 дальнейший прирост exp(t) умножается на postMayGrowthFactor,
      //     поэтому лето–осень 2027 растут медленнее и без резкого взлёта;
      //   • power=1 → чистая экспонента (1+g)^t (прежнее поведение по умолчанию);
      //   • power>1 → рост back-loaded (медленный старт, разгон к концу — эффект накопленных
      //     вложений); power<1 → front-loaded (быстрый старт, насыщение).
      var rawExpT=horizon>0?horizon*Math.pow(t/horizon,power):0;
      var expT=rawExpT;
      if(postMayStart>=0&&t>postMayStart){
        var startExp=horizon>0?horizon*Math.pow(postMayStart/horizon,power):0;
        expT=startExp+(rawExpT-startExp)*postMayGrowthFactor;
      }
      var revenueScale=Math.pow(1+g,expT);
      var costScale=1+costGrowth*t;
      scales.push(revenueScale);
      costScales.push(costScale);
      var sourceScaledContacts=sources.items.reduce(function(sum,it){
        return sum+it.contacts*finSourceResponseScale(it,revenueScale,paidShare);
      },0);
      var mediaTotal=trafficCost0*costScale;
      var revPlan=startRevenue>0?startRevenue*revenueScale:(targetRevenue*Math.pow(horizon>0?t/horizon:1,power));
      var totalScaledContacts=revPerContact>0?revPlan/revPerContact:sourceScaledContacts;
      // Аггрегация по сегментам: контакты дробятся по долям, каждый сегмент даёт
      // свой поток заявок/выдач/выручки и свой объём визитов.
      var totalApps=0,totalIss=0,totalRev=0,totalVis=0;
      var segCache=[];
      for(var i=0;i<FIN_SEG_META.length;i++){
        var segC=totalScaledContacts*shares[i];
        var segClick=segC*crCc[i];
        var segApp=segClick*crCa[i];
        var segIss=segApp*crAi[i];
        var segRev=segIss*payouts[i];
        var segVis=crVc[i]>0?segC/crVc[i]:0;
        // Аллокация медиа-бюджета на сегмент = доля контактов сегмента × общий media_t.
        var segMedia=mediaTotal*shares[i];
        var segCac=segIss>0?segMedia/segIss:0;
        totalApps+=segApp;
        totalIss+=segIss;
        totalRev+=segRev;
        totalVis+=segVis;
        segCache.push({contacts:segC,apps:segApp,issues:segIss,revenue:segRev,mediaCost:segMedia,cac:segCac,visits:segVis});
        if(t===n-1){segIssuesLast[i]=segIss;segRevenueLast[i]=segRev;segCacLast[i]=segCac;}
      }
      var cfCl=totalIss*cfShare;
      var cfRev=cfCl*inp.cfPayout;
      var rev=totalRev+cfRev;
      var c=mediaTotal+fixedMonthly;
      var revenueTax=rev*taxRate;
      var p=rev-c-revenueTax;
      // Разносим фиксированные расходы по сегментам пропорционально долям (для отображения прибыли сегмента).
      // Прибыль сегмента = выручка − медиа-аллокация − доля фикс-косты. CF-выручка добавляется в общий итог,
      // а не в отдельный сегмент, поэтому сумма Σ segProfit_i может отличаться от общего profit_t на cfRev.
      for(var k=0;k<FIN_SEG_META.length;k++){
        var sc=segCache[k];
        var segFixed=fixedMonthly*shares[k];
        var segTax=revenueTax*shares[k];
        var segProfit=sc.revenue-sc.mediaCost-segFixed-segTax;
        segMonthly[k].contacts.push(sc.contacts);
        segMonthly[k].apps.push(sc.apps);
        segMonthly[k].issues.push(sc.issues);
        segMonthly[k].revenue.push(sc.revenue);
        segMonthly[k].mediaCost.push(sc.mediaCost);
        segMonthly[k].cac.push(sc.cac);
        segMonthly[k].profit.push(segProfit);
        segMonthly[k].visits.push(sc.visits);
      }
      runProfit+=p;runInvest+=c;
      if(runProfit<0)peakNeed=Math.max(peakNeed,-runProfit);
      if(paybackIdx<0&&runProfit>=0&&t>0)paybackIdx=t;
      contacts.push(totalScaledContacts);visits.push(totalVis);apps.push(totalApps);issues.push(totalIss);
      revenue.push(rev);cost.push(c);tax.push(revenueTax);profit.push(p);
      cumProfit.push(runProfit);cumInvest.push(runInvest);cfClients.push(cfCl);cfRevenue.push(cfRev);
      ppc.push(totalIss>0?p/totalIss:0);
    }
    var lastRev=revenue[n-1],target=targetProfit;
    var neededGrowth=null;
    if(revPerContact>0&&contacts0>0&&n>1){
      var neededEndContacts=targetRevenue/revPerContact;
      if(horizon>0){
        var seoBase=0,paidBase=0;
        sources.items.forEach(function(it){
          if(it.meta.key==='Seo')seoBase+=it.contacts;
          else paidBase+=it.contacts;
        });
        // Ищем нужный месячный темп в диапазоне −50%…+200%.
        var lo=-0.5,hi=2;
        for(var bi=0;bi<MAX_GROWTH_BISECTION_ITERATIONS;bi++){
          var mid=(lo+hi)/2;
          var sEnd=Math.pow(1+mid,horizon);
          var endContacts=seoBase*sEnd+paidBase*(1+(sEnd-1)*paidShare);
          if(endContacts>=neededEndContacts)hi=mid;else lo=mid;
          if(Math.abs(hi-lo)<GROWTH_BISECTION_EPSILON)break;
        }
        var foundScale=Math.pow(1+hi,horizon);
        var foundContacts=seoBase*foundScale+paidBase*(1+(foundScale-1)*paidShare);
        neededGrowth=foundContacts>=neededEndContacts*0.999?hi*100:null;
      }
    }
    // Blended CAC = общий медиа-бюджет / общие выдачи (сводный по всему горизонту).
    // На конец горизонта считаем отдельно, чтобы отобразить в KPI.
    var totalMedia=cost.reduce(function(a,c,i){return a+(c-fixedMonthly);},0);
    var totalIssuesHz=issues.reduce(function(a,x){return a+x;},0);
    var blendedCac=totalIssuesHz>0?totalMedia/totalIssuesHz:0;
    var mediaLast=cost[n-1]-fixedMonthly;
    var blendedCacLast=issues[n-1]>0?mediaLast/issues[n-1]:0;
    return {
      inp:inp,months:FIN_MONTHS,shares:shares,payouts:payouts,
      crVc:crVc,crCc:crCc,crCa:crCa,crAi:crAi,segConv:segConv,segRevPerContact:segRevPerContact,
      avgVc:avgVc,avgCc:avgCc,avgCa:avgCa,avgAi:avgAi,avgConv:avgConv,
      blendedPayout:blendedPayout,
      blendedRevPerContact:blendedRevPerContact,visitsPerContact:visitsPerContact,
      revPerContact:revPerContact,sources:sources,scales:scales,costScales:costScales,growthPower:power,postMayGrowthFactor:postMayGrowthFactor,
      contacts:contacts,visits:visits,apps:apps,issues:issues,revenue:revenue,cost:cost,tax:tax,profit:profit,
      cumProfit:cumProfit,cumInvest:cumInvest,cfClients:cfClients,cfRevenue:cfRevenue,ppc:ppc,
      segIssuesLast:segIssuesLast,segRevenueLast:segRevenueLast,segCacLast:segCacLast,
      segMonthly:segMonthly,fixedMonthly:fixedMonthly,
      blendedCac:blendedCac,blendedCacLast:blendedCacLast,
      lastRevenue:lastRev,lastProfit:profit[n-1],lastCumProfit:cumProfit[n-1],totalInvest:cumInvest[n-1],
      lastPpc:ppc[n-1],peakNeed:peakNeed,paybackIdx:paybackIdx,target:target,targetRevenue:targetRevenue,
      targetHit:profit[n-1]>=target,neededGrowth:neededGrowth
    };
  }

  function millions(v){var a=Math.abs(Number(v)||0);if(a<1000000)return fmt(v)+' ₽';var m=(Number(v)||0)/1000000;return m.toLocaleString('ru-RU',{maximumFractionDigits:m>=10?1:2})+' млн ₽';}

  // --- Funnel computation ---------------------------------------------------
  // Воронка последовательная: Visit → Контакт → Клик по офферу → Заявка → Выдача.
  // Каждый следующий шаг считается от предыдущего (Контакт — от Visit, Клик — от
  // Контакта, Заявка — от Клика, Выдача — от Заявки). Так посегментная воронка
  // совпадает с Финмоделью 2027 (crCc_* = Контакт → Клик по офферу).
  function funnelFor(id,opts){
    opts=opts||{};
    var m=manualFor(id);
    var visit=BASE_VISITS;
    var crVC=clamp(m.visitContact,0,100);     // Визит → Контакт (общая)
    var crVK=clamp(m.visitClick,0,100);       // Контакт → Клик по офферу (по сегменту)
    var crKA=clamp(m.clickApp,0,100);         // Клик → Заявка
    var crAI=clamp(m.appIssue,0,100);         // Заявка → Выдача
    crVC=Math.min(crVC,100);crVK=Math.min(crVK,100);crKA=Math.min(crKA,100);crAI=Math.min(crAI,100);
    var contact=Math.round(visit*crVC/100);
    var click=Math.round(contact*crVK/100);
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
  function drawChart(id,config){var canvas=$(id);if(!canvas)return;if(typeof Chart==='undefined'){console.warn('CJM dashboard: custom Chart renderer is unavailable; ensure chart-lib.js is loaded before cjm-unit-dashboard.js');return;}clearChart(id);charts[id]=new Chart(canvas,config);}

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
    html+='<button class="cjm-seg-tab is-matrix'+(current==='finance100'?' active':'')+'" type="button" data-seg="finance100">'+
      '<span>Финмодель 100 млн ₽</span>'+
      '<span class="cjm-seg-share">цель</span>'+
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
    var finance100=isFinance100View();
    var innerNav=$('cjmInnerTabs');
    if(innerNav)innerNav.style.display='none';
    document.querySelectorAll('.cjm-panel').forEach(function(panel){panel.classList.remove('active');});
    if(finance100){
      if(window.Finance100&&window.Finance100.ensurePanel)window.Finance100.ensurePanel();
      var fp100=$('cjm-tab-finance100');if(fp100)fp100.classList.add('active');
    }else if(finance){
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
    if(isFinance100View()){
      eyebrow.textContent='Раздел сайта · Финмодель 100 млн ₽';
      title.textContent='Финансовая модель выхода на 100 млн ₽ чистой прибыли в месяц';
      lead.textContent='';
    }else if(isFinanceView()){
      eyebrow.textContent='Раздел сайта · Финмодель до декабря 2027';
      title.textContent='Финмодель 2027';
      lead.textContent='';
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
        ['Клик по офферу',f.click,pct(f.crVK,1)+' Контакт → Клик по офферу'],
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
      ['Клик по офферу',f.click,pct(f.crVK,1)+' Контакт → Клик по офферу'],
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
      {key:'visitClick',label:'CR · Контакт → Клик по офферу',suffix:'%',step:'0.1',min:0,max:100},
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
        ['CR · Контакт → Клик по офферу',s.justify.visitClick],
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
        {n:'3. Клик по офферу',v:fmt(c.f.click),sub:pct(c.f.crVK,1)+' Контакт → Клик по офферу'},
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
        '<div class="cjm-scn-row"><span class="scn-l">Клики по офферу<span class="scn-sub">'+esc(pct(scn.f.crVK,1))+' Контакт → Клик</span></span><span class="scn-v">'+esc(fmt(scn.f.click))+'</span></div>'+
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
      ['Клик по офферу',f.click,pct(f.crVK)+' от контакта',pct(f.click/f.visit*100)],
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
      {key:'startRevenue',label:'Стартовая выручка',suffix:'₽',step:'50000',min:0,max:1000000000},
      {key:'monthlyGrowth',label:'Темп роста в месяц (база экспоненты)',suffix:'%',step:'0.5',min:-50,max:200},
      {key:'growthPower',label:'Степень роста выручки — форма траектории',suffix:'',step:'0.05',min:0.1,max:5},
      {key:'postMayGrowthFactor',label:'Скорость роста после мая 2027',suffix:'%',step:'1',min:0,max:100},
      {key:'costGrowthMonthly',label:'Линейный прирост расходов в месяц',suffix:'%',step:'0.5',min:0,max:200},
      {key:'paidDemandShare',label:'Доля SEO-эффекта для платных каналов',suffix:'%',step:'1',min:0,max:100}
    ],
    finInputsSegCr:(function(){
      // 5 сегментов × 4 стадии воронки — генерируется по FIN_SEG_META, СЕГМЕНТ-МАЖОРНО
      // (4 стадии одного сегмента идут подряд), чтобы рендерить их табами по сегментам.
      // Значения этих полей по умолчанию подтягиваются из блока «Ручной ввод показателей»
      // (см. finSegSourcedCr) — правка любого поля меняет тот же источник, что и вкладка сегмента.
      var out=[];
      var stages=[
        {label:'Визит → Контакт',keyGetter:function(m){return m.crVcKey;}},
        {label:'Контакт → Клик оффера',keyGetter:function(m){return m.crCcKey;}},
        {label:'Клик → Заявка',keyGetter:function(m){return m.crCaKey;}},
        {label:'Заявка → Апрув',keyGetter:function(m){return m.crAiKey;}}
      ];
      FIN_SEG_META.forEach(function(m){
        stages.forEach(function(st){
          out.push({key:st.keyGetter(m),label:m.name+' · '+st.label,stage:st.label,
            seg:m.key,segName:m.name,segColor:m.color,suffix:'%',step:'0.1',min:0,max:100});
        });
      });
      return out;
    })(),
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
      {key:'taxRate',label:'Налог от общей выручки',suffix:'%',step:'0.1',min:0,max:99.9},
      {key:'cfApprovalShare',label:'Доля выдач в Центрофинанс',suffix:'%',step:'1',min:0,max:100},
      {key:'cfPayout',label:'Выплата Центрофинанс за клиента',suffix:'₽',step:'50',min:0,max:1000000},
      {key:'targetNetProfit',label:'Цель прибыли · декабрь 2027',suffix:'₽',step:'100000',min:0,max:1000000000}
    ]
  };

  function finColor(name){
    var v=getComputedStyle(document.documentElement).getPropertyValue('--'+name);
    return (v||'').trim()||'#0071e3';
  }

  function finFieldHtml(f,value,edited,opts){
    opts=opts||{};
    var label=opts.label!=null?opts.label:f.label;
    var hint=edited
      ?' <span class="cjm-manual-suffix" title="Изменено в едином источнике сегментов">· изменено</span>'
      :(opts.sourceHint?' <span class="cjm-manual-suffix" title="Единый источник: вкладка соответствующего сегмента (конверсии, CPA/стоимость лида, доля)">· из сегментов</span>':'');
    return '<label>'+
      '<span class="cjm-manual-label">'+esc(label)+' <span class="cjm-manual-suffix">'+esc(f.suffix)+'</span>'+hint+
      '</span>'+
      '<input type="number" inputmode="decimal" min="'+f.min+'" max="'+f.max+'" step="'+f.step+'" '+
        'value="'+esc(value)+'" data-fin="'+esc(f.key)+'"'+(edited?' class="is-edited"':'')+'>'+
    '</label>';
  }

  // Активный таб конверсий (по ключу сегмента FIN_SEG_META). По умолчанию — первый.
  var finSegCrActiveTab=FIN_SEG_META[0].key;
  // Рендерит настройку посегментных конверсий табами по сегментам. Значения по умолчанию
  // «всегда заполнены из сегментов» (finSegSourcedCr); правка здесь меняет тот же
  // источник, что и вкладка конкретного сегмента.
  function renderFinSegCrTabs(host,inp){
    var fields=FIN_FIELD_GROUPS.finInputsSegCr;
    if(!FIN_SEG_META.some(function(m){return m.key===finSegCrActiveTab;}))finSegCrActiveTab=FIN_SEG_META[0].key;
    var tabsHtml=FIN_SEG_META.map(function(m){
      var active=m.key===finSegCrActiveTab?' active':'';
      var edited=fields.some(function(f){return f.seg===m.key&&finIsEdited(f.key);});
      return '<button type="button" class="cjm-seg-tab'+active+'" data-fin-crtab="'+esc(m.key)+'">'+
        '<span class="cjm-seg-dot" style="background:'+esc(m.color)+'"></span>'+esc(m.name)+
        (edited?'<span class="cjm-seg-share" title="Есть ручные правки в едином источнике">изм.</span>':'')+
      '</button>';
    }).join('');
    var panelsHtml=FIN_SEG_META.map(function(m){
      var hidden=m.key===finSegCrActiveTab?'':' hidden';
      var body=fields.filter(function(f){return f.seg===m.key;}).map(function(f){
        return finFieldHtml(f,inp[f.key],finIsEdited(f.key),{label:f.stage,sourceHint:true});
      }).join('');
      return '<div class="fin-crtab-panel"'+hidden+' data-fin-crpanel="'+esc(m.key)+'">'+
        '<div class="cjm-manual-grid">'+body+'</div></div>';
    }).join('');
    host.innerHTML=
      '<div class="cjm-seg-tabs fin-crtabs" role="tablist">'+tabsHtml+'</div>'+
      '<p class="fin-crtab-note">Это те же значения, что и в блоке «Ручной ввод показателей» по каждому сегменту. Правка здесь сразу меняет вкладку сегмента, а правка во вкладке сегмента сразу меняет финмодель. Очистите поле, чтобы вернуться к дефолту сегмента.</p>'+
      panelsHtml;
    host.querySelectorAll('[data-fin-crtab]').forEach(function(btn){
      btn.addEventListener('click',function(){
        finSegCrActiveTab=btn.getAttribute('data-fin-crtab');
        host.querySelectorAll('[data-fin-crtab]').forEach(function(b){b.classList.toggle('active',b===btn);});
        host.querySelectorAll('[data-fin-crpanel]').forEach(function(p){
          p.hidden=p.getAttribute('data-fin-crpanel')!==finSegCrActiveTab;
        });
      });
    });
  }

  function renderFinanceInputs(){
    var inp=finInputs();
    Object.keys(FIN_FIELD_GROUPS).forEach(function(hostId){
      var host=$(hostId);if(!host)return;
      if(hostId==='finInputsSegCr'){renderFinSegCrTabs(host,inp);return;}
      host.innerHTML=FIN_FIELD_GROUPS[hostId].map(function(f){
        var linked=!!FIN_SEG_LINKED_KEYS[f.key];
        return finFieldHtml(f,inp[f.key],finIsEdited(f.key),linked?{sourceHint:true}:{});
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
        if(FIN_SEG_LINKED_KEYS[key]){
          var fresh=finInputs();
          panel.querySelectorAll('input[data-fin]').forEach(function(input){
            var k=input.getAttribute('data-fin');
            if(!FIN_SEG_LINKED_KEYS[k]||input===el)return;
            input.value=fresh[k];
            input.classList.toggle('is-edited',finIsEdited(k));
          });
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
      {tone:'blue',label:'Выручка · декабрь 2027',value:millions(res.lastRevenue),sub:'Общая выручка, от неё считается налог'},
      {tone:res.lastProfit>=0?'green':'red',label:'Прибыль · декабрь 2027',value:millions(res.lastProfit),sub:'Чистыми в месяц на конец горизонта'},
      {tone:'violet',label:'CAC · декабрь 2027',value:rub(res.blendedCacLast),sub:'Медиа-бюджет / выдачи · зависит от 4 конверсий'},
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
    var progress=res.target>0?clamp(res.lastProfit/res.target*100,0,100):0;
    var gap=res.target-res.lastProfit;
    var strip=$('finTargetStrip');
    if(strip){
      var statusItem=res.targetHit
        ?'<div class="fin-target-item is-hit"><span class="fin-target-num">Цель достигнута</span><span class="fin-target-cap">Прибыль ≥ цели</span></div>'
        :'<div class="fin-target-item is-gap"><span class="fin-target-num">'+esc(millions(gap))+'</span><span class="fin-target-cap">Осталось до цели</span></div>';
      strip.innerHTML=
        '<div class="fin-target-item"><span class="fin-target-num">'+esc(millions(inp.startRevenue))+'</span><span class="fin-target-cap">Стартовая выручка</span></div>'+
        '<div class="fin-target-item"><span class="fin-target-num">'+esc(millions(res.lastRevenue))+'</span><span class="fin-target-cap">Выручка на конец</span></div>'+
        '<div class="fin-target-item"><span class="fin-target-num">'+esc(millions(res.target))+'</span><span class="fin-target-cap">Цель прибыли · декабрь 2027</span></div>'+
        statusItem+
        '<div class="fin-target-item"><span class="fin-target-num">'+esc(pct(inp.taxRate,1))+'</span><span class="fin-target-cap">Налог от общей выручки</span></div>'+
        '<div class="fin-target-item"><span class="fin-target-num">'+esc(pct(inp.costGrowthMonthly,1))+'</span><span class="fin-target-cap">Расходы: линейный прирост в месяц</span></div>'+
        '<div class="fin-progress"><span style="width:'+progress.toFixed(1)+'%"></span></div>';
    }
    // Источники трафика — таблица (контакты, доли, бюджет, CPL).
    var srcHost=$('finSourcesRow');
    if(srcHost){
      var src=res.sources;
      var rowsHtml=src.items.map(function(it){
        var shareTxt=src.totalContacts>0?pct(it.contacts/src.totalContacts*100,0):'—';
        var noteTxt=it.meta.key==='Seo'?'полный накопительный SEO-эффект':'частичный бренд/SEO-эффект';
        return '<tr>'+
          '<td><span class="fin-simple-dot" style="background:'+esc(it.meta.color)+'"></span>'+esc(it.meta.name)+'<span class="fin-simple-note">'+esc(noteTxt)+'</span></td>'+
          '<td>'+esc(fmt(it.contacts))+'</td>'+
          '<td>'+esc(shareTxt)+'</td>'+
          '<td>'+esc(rub(it.budget))+'</td>'+
          '<td>'+esc(rub(it.cpl))+'</td>'+
        '</tr>';
      }).join('');
      srcHost.innerHTML='<div class="fin-simple-table-wrap"><table class="fin-simple-table">'+
        '<thead><tr><th>Источник</th><th>Контакты / мес</th><th>Доля</th><th>Бюджет / мес</th><th>CPL</th></tr></thead>'+
        '<tbody>'+rowsHtml+'</tbody>'+
        '<tfoot><tr><td>Итого · старт</td><td>'+esc(fmt(src.totalContacts))+'</td><td>100%</td><td>'+esc(rub(src.totalBudget))+'</td><td>'+esc(rub(src.avgCpl))+' (средневзв.)</td></tr></tfoot>'+
      '</table></div>';
    }
    // Необходимые инвестиции для старта: сколько денег нужно, чтобы прожить 3-4 месяца
    // при слабой выручке начального периода. Разбивка: медиа по каналам + ФОТ + Разработка.
    var startupEl=$('finStartupRow');
    if(startupEl){
      // Берём 4 месяца — верхняя граница диапазона «3-4 месяца» из требования, чтобы
      // сформированного бюджета хватало с запасом до полноценного помесячного плана.
      var startupMonths=Math.min(4,n);
      // Кассовый разрыв за первые startupMonths месяцев (макс. накопленный минус)
      var runNet=0,startupNeed=0;
      for(var st=0;st<startupMonths;st++){
        runNet+=res.profit[st];
        if(runNet<0&&-runNet>startupNeed)startupNeed=-runNet;
      }
      // Если модель уже в плюсе на старте — хотя бы совокупные расходы за 4 месяца
      // как минимальный «запас», чтобы не оставлять кассу пустой.
      var startupCostSum=0;
      for(var sc2=0;sc2<startupMonths;sc2++)startupCostSum+=res.cost[sc2];
      var startupBudget=Math.max(startupNeed,startupCostSum);
      // Разбивка вложений: медиа по каналам (сумма за первые startupMonths месяцев с учётом линейного роста)
      // + ФОТ + Разработка. costGrowthMonthly уже применён к mediaTotal через costScales.
      var mediaTotalStart=0;
      for(var mi=0;mi<startupMonths;mi++)mediaTotalStart+=res.cost[mi]-res.fixedMonthly;
      var mediaBaseSum=res.sources.items.reduce(function(a,it){return a+it.budget;},0);
      var costScaleSum=0;
      for(var cs=0;cs<startupMonths;cs++)costScaleSum+=res.costScales[cs];
      var fotSum=inp.fotMonthly*startupMonths;
      var devSum=inp.devMonthly*startupMonths;
      var breakdownRows=res.sources.items.map(function(it){
        var chSum=mediaBaseSum>0?it.budget*costScaleSum:0;
        var chShare=startupBudget>0?chSum/startupBudget*100:0;
        return '<tr>'+
          '<td><span class="fin-simple-dot" style="background:'+esc(it.meta.color)+'"></span>'+esc(it.meta.name)+'</td>'+
          '<td>'+esc(rub(chSum))+'</td>'+
          '<td>'+esc(pct(chShare,0))+'</td>'+
        '</tr>';
      }).join('');
      var fotShare=startupBudget>0?fotSum/startupBudget*100:0;
      var devShare=startupBudget>0?devSum/startupBudget*100:0;
      var totalBreakdown=mediaTotalStart+fotSum+devSum;
      startupEl.innerHTML=
        '<div class="fin-startup-headline">'+
          '<span class="fin-startup-val">'+esc(millions(startupBudget))+'</span>'+
          '<span class="fin-startup-cap">Бюджет для запуска на первые <b>'+startupMonths+' мес.</b> · далее двигаемся по помесячному плану · пиковый кассовый разрыв за горизонт: <b>'+esc(millions(res.peakNeed))+'</b></span>'+
        '</div>'+
        '<div class="fin-simple-table-wrap"><table class="fin-simple-table">'+
          '<thead><tr><th>Статья</th><th>Сумма за '+startupMonths+' мес</th><th>Доля</th></tr></thead>'+
          '<tbody>'+breakdownRows+
            '<tr><td>ФОТ</td><td>'+esc(rub(fotSum))+'</td><td>'+esc(pct(fotShare,0))+'</td></tr>'+
            '<tr><td>Разработка / интеграции</td><td>'+esc(rub(devSum))+'</td><td>'+esc(pct(devShare,0))+'</td></tr>'+
          '</tbody>'+
          '<tfoot><tr><td>Итого расходов за '+startupMonths+' мес</td><td>'+esc(rub(totalBreakdown))+'</td><td>100%</td></tr></tfoot>'+
        '</table></div>';
    }
    // Segment shares normalization footer
    var rawSum=FIN_SEG_META.reduce(function(a,m){return a+(Number(inp[m.shareKey])||0);},0);
    var normEl=$('finSharesNorm');
    if(normEl){
      normEl.className='fin-norm'+(Math.abs(rawSum-100)>0.5?' is-warn':'');
      var normed=res.shares.map(function(x,i){return FIN_SEG_META[i].name+' '+pct(x*100,0);}).join(' · ');
      normEl.innerHTML='<span>Введено суммарно: <b>'+pct(rawSum,0)+'</b></span><span>После нормировки: '+esc(normed)+'</span>';
    }
    // Segment revenue breakdown removed per spec — экономика уже отображается в
    // сегментных вкладках и раскрытии Помесячного плана по сегментам.
    // CF tracker row — теперь внутри карточки «Помесячный план» как трекер лида.
    var cfEl=$('finCfRow');
    if(cfEl){
      cfEl.innerHTML=
        '<div class="fin-cf-cell"><span class="fin-cf-cap">Клиентов Центрофинанс в месяц</span><span class="fin-cf-val">'+esc(fmt(res.cfClients[last]))+'</span><span class="fin-cf-note">Декабрь 2027 · '+esc(pct(inp.cfApprovalShare,0))+' выдач уходит в Центрофинанс</span></div>'+
        '<div class="fin-cf-cell"><span class="fin-cf-cap">Выручка от Центрофинанс</span><span class="fin-cf-val">'+esc(rub(res.cfRevenue[last]))+'</span><span class="fin-cf-note">По вашей ставке · продажа лида обратно по 3000 ₽ убрана из расчёта</span></div>'+
        '<div class="fin-cf-cell"><span class="fin-cf-cap">Ставка Центрофинанс за клиента</span><span class="fin-cf-val">'+esc(rub(inp.cfPayout))+'</span><span class="fin-cf-note">0 ₽ означает, что лид обратно в Центрофинанс не продаём</span></div>';
    }
    // Monthly table — с раскрывающимися строками по сегментам.
    // Каждая строка месяца имеет data-fin-month. Клик по стрелке раскрывает 5 суб-строк
    // (по сегментам): трафик/визиты, контакты, заявки, выдачи, выручка, CAC, прибыль — считаются
    // из массивов res.segMonthly[i], т.е. работают ДЛЯ ЛЮБОГО МЕСЯЦА (не только последнего).
    var tbl=$('finTable');
    if(tbl){
      var head='<thead><tr><th style="width:28px"></th><th>Месяц</th><th>Трафик, визиты</th><th>Контакты</th><th>Заявки</th><th>Выдачи</th><th>Выручка</th><th>Расходы</th><th>Налог от выручки</th><th>CAC</th><th>Прибыль</th><th>Прибыль / 1 чел</th><th>Накопл. прибыль</th></tr></thead>';
      var rows='';
      for(var t=0;t<n;t++){
        var pc=res.profit[t]>=0?'fin-pos':'fin-neg';
        var cc=res.cumProfit[t]>=0?'fin-pos':'fin-neg';
        var ppcCls=res.ppc[t]>=0?'fin-pos':'fin-neg';
        var mediaT=res.cost[t]-res.fixedMonthly;
        var cacT=res.issues[t]>0?mediaT/res.issues[t]:0;
        rows+='<tr class="fin-row-month'+(t===last?' is-target':'')+'" data-fin-month="'+t+'">'+
          '<td><button type="button" class="fin-expand-btn" data-fin-toggle="'+t+'" aria-expanded="false" aria-label="Раскрыть сегменты">▸</button></td>'+
          '<td>'+esc(res.months[t])+'</td>'+
          '<td>'+esc(fmt(res.visits[t]))+'</td>'+
          '<td>'+esc(fmt(res.contacts[t]))+'</td>'+
          '<td>'+esc(fmt(res.apps[t]))+'</td>'+
          '<td>'+esc(fmt(res.issues[t]))+'</td>'+
          '<td>'+esc(rub(res.revenue[t]))+'</td>'+
          '<td>'+esc(rub(res.cost[t]))+'</td>'+
          '<td>'+esc(rub(res.tax[t]))+'</td>'+
          '<td>'+esc(rub(cacT))+'</td>'+
          '<td class="'+pc+'">'+esc(rub(res.profit[t]))+'</td>'+
          '<td class="'+ppcCls+'">'+esc(rub(res.ppc[t]))+'</td>'+
          '<td class="'+cc+'">'+esc(rub(res.cumProfit[t]))+'</td>'+
        '</tr>';
        // Скрытые суб-строки по сегментам этого месяца.
        for(var si=0;si<FIN_SEG_META.length;si++){
          var sm=res.segMonthly[si];
          var sProfit=sm.profit[t];
          var sProfitCls=sProfit>=0?'fin-pos':'fin-neg';
          var sPpc=sm.issues[t]>0?sProfit/sm.issues[t]:0;
          var sPpcCls=sPpc>=0?'fin-pos':'fin-neg';
          rows+='<tr class="fin-row-seg" data-fin-seg-of="'+t+'" style="display:none;background:var(--surface-2,rgba(127,127,127,.06));">'+
            '<td></td>'+
            '<td style="padding-left:28px;color:var(--muted);"><span class="fin-seg-dot" style="display:inline-block;width:8px;height:8px;border-radius:50%;margin-right:6px;background:'+esc(FIN_SEG_META[si].color)+'"></span>'+esc(FIN_SEG_META[si].name)+'</td>'+
            '<td>'+esc(fmt(sm.visits[t]))+'</td>'+
            '<td>'+esc(fmt(sm.contacts[t]))+'</td>'+
            '<td>'+esc(fmt(sm.apps[t]))+'</td>'+
            '<td>'+esc(fmt(sm.issues[t]))+'</td>'+
            '<td>'+esc(rub(sm.revenue[t]))+'</td>'+
            '<td>'+esc(rub(sm.mediaCost[t]))+' · медиа</td>'+
            '<td>'+esc(rub(res.tax[t]*(res.shares[si]||0)))+'</td>'+
            '<td>'+esc(rub(sm.cac[t]))+'</td>'+
            '<td class="'+sProfitCls+'">'+esc(rub(sProfit))+'</td>'+
            '<td class="'+sPpcCls+'">'+esc(rub(sPpc))+'</td>'+
            '<td style="color:var(--muted);">доля '+esc(pct(res.shares[si]*100,0))+'</td>'+
          '</tr>';
        }
      }
      tbl.innerHTML=head+'<tbody>'+rows+'</tbody>';
      // Делегированный обработчик клика по кнопке раскрытия (переживает перерисовку).
      if(!tbl._finExpandWired){
        tbl._finExpandWired=true;
        tbl.addEventListener('click',function(ev){
          var btn=ev.target.closest?ev.target.closest('[data-fin-toggle]'):null;
          if(!btn)return;
          var idx=btn.getAttribute('data-fin-toggle');
          var subs=tbl.querySelectorAll('tr.fin-row-seg[data-fin-seg-of="'+idx+'"]');
          var open=btn.getAttribute('aria-expanded')==='true';
          subs.forEach(function(row){row.style.display=open?'none':'';});
          btn.setAttribute('aria-expanded',open?'false':'true');
          btn.textContent=open?'▸':'▾';
        });
      }
    }
    // Блок «Резюме для презентации» удалён по требованию — итоги считываются
    // напрямую из KPI-карточек и посегментных карточек выше.
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
      {label:'Выручка для цели прибыли, млн ₽',data:res.revenue.map(function(){return toM(res.targetRevenue);}),borderColor:cViolet,borderWidth:1.5}
    ]}});
    drawChart('finChartPnl',{type:'bar',data:{labels:labels,datasets:[
      {label:'Выручка, млн ₽',data:res.revenue.map(toM),backgroundColor:cGreen+'cc'},
      {label:'Расходы, млн ₽',data:res.cost.map(toM),backgroundColor:cRed+'99'},
      {label:'Налог, млн ₽',data:res.tax.map(toM),backgroundColor:cYellow+'99'},
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
    if(isFinance100View()){
      if(window.Finance100&&window.Finance100.render)window.Finance100.render();
    }else if(isFinanceView()){
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

  // Version switcher removed: dashboard now ships only in the new (CJM) layout.

  function init(){
    applyStoredShares();
    initInnerTabs();
    initTheme();
    initShareLink();
    initFinShareTools();
    renderAll();
    if(urlStateApplied){
      updateSharedStatus();
    }else{
      loadSharedState(function(changed){
        if(changed){applyStoredShares();renderAll();}
        else updateSharedStatus();
      });
    }
  }

  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init);
  else init();
})();
