/*
 * Юнит-экономика «Выручай» · сегментный дашборд LTV / CAC / ROMI.
 * Реализация ТЗ: 4 сегмента (Новый, Повторный, Просроченный, Спящий),
 * настройки общих метрик, воронки и кросс-сейла, расчёт LTV_0/1/2 с дисконтом,
 * Blended CAC, Average ARPU, Payback period, переключаемая CJM-воронка,
 * когортный график накопленного LTV против CAC.
 *
 * Модуль самодостаточен: рендерит весь UI внутри #ueLab, не зависит от
 * dashboard-app.js и активируется, когда у контейнера атрибут
 * data-source="segments-v2".
 */
(function () {
  'use strict';

  var STORE_KEY = 'ue_segments_v1';
  var SLOTS_KEY = 'ue_segments_slots_v1';      // именованные сценарии пользователя (≤ 5)
  var COMPARE_KEY = 'ue_segments_compare_v1';  // {a:slotId, b:slotId} для split-view
  var THRESH_KEY = 'ue_segments_thresholds_v1';// настраиваемые пороги светофора
  var REPEAT_AB_KEY = 'ue_repeat_ab_v1';       // параметры A/B повторных (CF vs Own)
  var INSIGHTS_KEY = 'ue_insights_rules_v1';   // JSON-конфиг правил выводов
  var MODE_KEY = 'ue_segments_mode_v1';        // 'asis' | 'tobe' — переключатель модели
  var TAB_KEY = 'ue_segments_tab_v1';          // активный таб внутри #ueLab
  var COHORT_SIZE = 1000;                       // эталонная когорта по ТЗ
  var DEFAULT_CF_SECOND_CONTRACT = 60;          // % «Новых», возвращающихся во второй договор ЦФ (дефолт)

  // ---- Константы целевой модели «To-Be» (ТЗ §2) ----
  var USERS_BASE = 10000;        // фикс-база сценария окупаемости (10 000 пользователей)
  var QUIZ_UPLIFT = 0.20;        // +20% к CR Visit→Lead Нового сегмента за счёт интерактивного Квиза
  // Табы модуля (ТЗ-Дополнение №2 §6). id → заголовок ленты.
  var TABS = [
    { id: 'overview', name: 'Обзор · KPI' },
    { id: 'segments', name: 'Сегменты' },
    { id: 'funnel',   name: 'Воронка & когорты' },
    { id: 'scenario', name: 'Сценарий 10 000' },
    { id: 'ab',       name: 'A/B & сравнение' }
  ];

  // ---- Сегменты и стартовые значения (из ТЗ) ----
  var SEGMENTS = [
    { id: 'new',      name: 'Новый',       short: 'Нов.',   accent: 'var(--blue)' },
    { id: 'repeat',   name: 'Повторный',   short: 'Повт.',  accent: 'var(--green)' },
    { id: 'overdue',  name: 'Просроченный',short: 'Просроч.', accent: 'var(--orange)' },
    { id: 'sleep',    name: 'Спящий',      short: 'Сонн.',  accent: 'var(--violet)' }
  ];

  // Базовая («As-Is») модель: все вводные откалиброваны так, чтобы общий Blended LTV/CAC ≈ 0.56x
  // (проект убыточен) — это исходная точка модели. Целевые оптимизации (Quiz,
  // Traffic Mix, Smart Safe Router → БФЛ) накладываются поверх через applyMode(mode='tobe')
  // и поднимают Blended LTV/CAC до ≈ 2.6x. Значения не «исторический факт», а согласованный
  // базовый сценарий, относительно которого считается эффект To-Be.
  var DEFAULT_PARAMS = {
    // Общие
    epl: 1600,
    opex: 120,
    revShare: 30,   // %
    discount: 20,   // %
    // Воронка (As-Is базовые конверсии; To-Be поднимает их за счёт квиз-преквалификации)
    crVisitLead: 8,        // %
    crLeadClickout: 55,    // %
    crClickoutIssue: 55,   // %
    // Кросс-сейл
    crCross: 10,           // %
    crossEpl: 1200,
    // Настройки Smart Safe Router
    cfRejectRate: 70,      // % отказов ЦФ (Soft Reject)
    cfSecondContract: 60,  // % клиентов «Нового» сегмента, возвращающихся во второй договор ЦФ.
                           // Остальные становятся спящими/отказными и не пользуются услугами МФО (доход 0).
    crCrossBank: 5,        // % кросс-сейл некредитных продуктов (Банки/РКО)
    crLeadBfl: 10,         // % в квалифицированный лид БФЛ
    eplBfl: 3000,          // Выплата БФЛ (EPL) в ₽
    // Сегменты: CAC, retention 1y, retention 2y, доля сегмента в общем трафике (%)
    // Базовая («As-Is») модель: Blended LTV/CAC ≈ 0.56x — проект убыточен.
    seg: {
      new:     { cac: 1200, ret1: 25, ret2: 15, share: 45, funnelMul: 1.00 },
      repeat:  { cac:  450, ret1: 45, ret2: 30, share: 25, funnelMul: 1.30 },
      overdue: { cac:  800, ret1: 35, ret2: 20, share: 20, funnelMul: 0.85 },
      sleep:   { cac:  350, ret1: 30, ret2: 18, share: 10, funnelMul: 0.70 }
    }
  };

  // ---- Целевая модель «To-Be» (Router & Quiz). Накладывается ПОВЕРХ базовых
  //      вводных при mode === 'tobe'. Источник правды — ТЗ-1 §2:
  //   • Реструктуризация трафика: Повторные 40 / Новые 30 / Просроченные 20 / Спящие 10.
  //   • Квиз: +20% к CR Visit→Lead Нового → CAC Нового 1200 → 700 ₽; квиз преквалифицирует
  //     лиды, поэтому растут downstream-конверсии и средний EPL (динамические тарифы).
  //   • Smart Safe Router: «Просроченные» маршрутизируются на офферы БФЛ, фикс-EPL 10 000 ₽.
  //   Калибровка даёт Blended LTV/CAC ≈ 2.6x (> 2.5x целевого порога).
  function applyMode(base, mode) {
    var p = deepCopy(base);
    if (mode !== 'tobe') {
      p.isRouterActive = false;
      return p;
    }
    p.isRouterActive = true;
    // ─────────────────────────────────────────────────────────────────────────
    // ЗА СЧЁТ ЧЕГО МЕТРИКИ РАСТУТ (действие → цифра → показатель → почему).
    // Все сдвиги ниже — это не «нарисованная» выручка, а следствие конкретных
    // продуктовых действий поверх As-Is базы. Каждый блок описывает рычаг.
    // ─────────────────────────────────────────────────────────────────────────

    // [Рычаг 1] КВИЗ-СЕНСЕЙ на входе (сегмент «Новый»).
    // Действие: интерактивная преквалификация до формы лида.
    // Цифра: CR Visit→Lead 8% → 9,6% (+20%, QUIZ_UPLIFT). Почему: квиз вовлекает и
    // отсеивает нецелевых ещё до лида, поэтому до лида доходит более качественный трафик.
    p.crVisitLead = Math.round(base.crVisitLead * (1 + QUIZ_UPLIFT) * 10) / 10;
    // [Рычаг 1, продолжение] Преквалифицированный лид лучше конвертится дальше по воронке.
    // Цифра: CR Lead→Clickout 55% → 80% и CR Clickout→Issue 55% → 80%. Почему: квиз уже
    // собрал параметры запроса, поэтому пользователю показывается релевантный оффер и он
    // реже отваливается на клик-ауте и одобрении.
    p.crLeadClickout = 80;
    p.crClickoutIssue = 80;
    // [Рычаг 1, продолжение] Средний payout (EPL) растёт с 1600 → 3000 ₽. Почему: квиз
    // позволяет включить динамические тарифы и направлять лид на внешние источники
    // (БФЛ/CPA/банки) с более высокой подтверждённой выплатой, а не только на дешёвую выдачу.
    p.epl = 3000;
    p.crossEpl = 3000;
    // [Рычаг 4] Кросс-сейл некредитных банковских продуктов (Банки/РКО) для «Повторных»/«Спящих».
    // Цифра: CR кросс-сейла 5% → 60%. Почему: для уже знакомой базы предлагаем карты/РКО/страховки —
    // короткий и дешёвый второй заход монетизации, который в As-Is не использовался.
    p.crCrossBank = 60;
    // [Рычаг 3] Квалификация в лид БФЛ для «Просроченных».
    // Цифра: CR Lead→БФЛ 10% → 35% и фикс-payout БФЛ 3000 → 10000 ₽. Почему: просроченный интент
    // отправляем не на заведомо отказную выдачу, а на профильного партнёра БФЛ/рефинанс с высокой выплатой.
    p.crLeadBfl = 35;
    p.eplBfl = 10000;
    // [Рычаг 5] РЕСТРУКТУРИЗАЦИЯ ТРАФИК-МИКСА (снижает Blended CAC без новых затрат).
    // Действие: перераспределяем бюджет с дорогих Новых на дешёвых Повторных.
    // Цифра: доли Новый 45→30, Повторный 25→40, Просроченный 20, Спящий 10. Почему: CAC повторного
    // (450 ₽) кратно ниже CAC нового (1200 ₽), поэтому сам сдвиг долей тянет Blended CAC вниз.
    p.seg.new.share = 30;
    p.seg.repeat.share = 40;
    p.seg.overdue.share = 20;
    p.seg.sleep.share = 10;
    // [Рычаг 1, итог по CAC] CAC Нового 1200 → 700 ₽ (−42%). Почему: рост CR Visit→Lead на +20%
    // означает, что тот же рекламный бюджет даёт больше лидов → стоимость одного лида падает.
    p.seg.new.cac = 700;
    // [Рычаг 2] CRM-УПЛИФТ ПОВТОРНЫХ (удержание → выше LTV₂).
    // Действие: триггерные коммуникации и кабинет для возвратных сделок.
    // Цифра: retention 1y 45% → 55%, retention 2y 30% → 38%. Почему: удержанный клиент приносит
    // дисконтированный доход в 12 и 24 мес, поэтому LTV₂ повторного сегмента растёт.
    p.seg.repeat.ret1 = 55;
    p.seg.repeat.ret2 = 38;
    // [Рычаг 3, итог по CAC] CAC Просроченного 800 → 650 ₽. Почему: профильный источник БФЛ/CPA
    // монетизирует именно просроченный интент, поэтому платный трафик на него обходится дешевле.
    p.seg.overdue.cac = 650;
    // §2.3 Smart Safe Router → жёстко маршрутизирует «Просроченных» в ветку БФЛ.
    p.seg.overdue.router = 'bfl';
    p.seg.overdue.eplBfl = p.eplBfl;
    p.seg.overdue.crLeadBfl = p.crLeadBfl;
    return p;
  }

  // Шаги CJM-воронки по сегментам (тексты CTA отличаются согласно листам Excel).
  var FUNNEL_STEPS = {
    new: [
      { label: 'Трафик · SEO/соцсети/Директ',      cta: 'Узнать, на что хватит'   },
      { label: 'Осознание нужды · Start Quiz',     cta: 'Пройти Квиз-Сенсей'      },
      { label: 'Сбор данных · форма Лида',         cta: 'Подобрать оффер'         },
      { label: 'Выбор предложения · клик-аут',     cta: 'Перейти к партнёру'      },
      { label: 'Монетизация · Approved / EPL',     cta: 'Выдача займа'            }
    ],
    repeat: [
      { label: 'База CRM · повторный визит',       cta: 'Войти в кабинет'         },
      { label: 'Активация сессии',                 cta: 'Открыть новое решение'   },
      { label: 'Подтверждение данных · Lead',      cta: 'Обновить параметры'      },
      { label: 'Клик-аут по релевантным офферам',  cta: 'Взять у проверенного партнёра' },
      { label: 'Выдача · повторная сделка',        cta: 'Approved · EPL+Cross'    }
    ],
    overdue: [
      { label: 'Трафик · сегмент с просрочкой',    cta: 'Узнать варианты'         },
      { label: 'Скоринг ситуации · Quiz Risk',     cta: 'Подобрать перекредитование' },
      { label: 'Лид · согласие на проверку БКИ',   cta: 'Отправить заявку'        },
      { label: 'Клик-аут · БФЛ / рефинанс',        cta: 'Перейти к партнёру'      },
      { label: 'Монетизация · одобрение',          cta: 'Approved · CPA / EPL'    }
    ],
    sleep: [
      { label: 'Реактивационный канал',            cta: 'Письмо/Push · Вернуться' },
      { label: 'Возврат на сайт · Start Quiz',     cta: 'Что нового · подобрать оффер' },
      { label: 'Лид · обновлённые данные',         cta: 'Подтвердить параметры'   },
      { label: 'Клик-аут · топ-оффер',             cta: 'Забрать предложение'     },
      { label: 'Монетизация · возврат к выдачам',  cta: 'Approved · EPL'          }
    ]
  };

  // ---- утилиты ----
  function load() {
    try {
      var raw = localStorage.getItem(STORE_KEY);
      if (!raw) return deepCopy(DEFAULT_PARAMS);
      var obj = JSON.parse(raw);
      return mergeParams(deepCopy(DEFAULT_PARAMS), obj);
    } catch (e) { return deepCopy(DEFAULT_PARAMS); }
  }
  function save(p) { try { localStorage.setItem(STORE_KEY, JSON.stringify(p)); } catch (e) {} }
  function loadMode() { try { return localStorage.getItem(MODE_KEY) === 'tobe' ? 'tobe' : 'asis'; } catch (e) { return 'asis'; } }
  function saveMode(m) { try { localStorage.setItem(MODE_KEY, m === 'tobe' ? 'tobe' : 'asis'); } catch (e) {} }
  function loadTab() {
    try { var t = localStorage.getItem(TAB_KEY); return TABS.some(function (x) { return x.id === t; }) ? t : 'overview'; }
    catch (e) { return 'overview'; }
  }
  function saveTab(t) { try { localStorage.setItem(TAB_KEY, t); } catch (e) {} }
  function deepCopy(o) { return JSON.parse(JSON.stringify(o)); }
  function mergeParams(base, overlay) {
    Object.keys(overlay || {}).forEach(function (k) {
      if (k === 'seg' && overlay.seg) {
        Object.keys(base.seg).forEach(function (sid) {
          base.seg[sid] = Object.assign({}, base.seg[sid], overlay.seg[sid] || {});
        });
      } else if (typeof base[k] === 'number') base[k] = Number(overlay[k]) || base[k];
    });
    return base;
  }
  function clamp(v, a, b) { return Math.min(b, Math.max(a, v)); }

  // ---- Пресеты сценариев (ТЗ §2.2.2) ----
  // Базируется на DEFAULT_PARAMS, в пресетах двигаются только ключевые ручки воронки/CAC.
  function presetParams(kind) {
    var p = deepCopy(DEFAULT_PARAMS);
    if (kind === 'pessimistic') {
      p.crVisitLead = 5;  p.crLeadClickout = 26; p.crClickoutIssue = 26; p.crCross = 6;
      p.seg.new.cac = 3200;  p.seg.repeat.cac = 600;  p.seg.overdue.cac = 1100; p.seg.sleep.cac = 480;
      p.seg.new.ret1 = 18;   p.seg.repeat.ret1 = 35; p.seg.overdue.ret1 = 25; p.seg.sleep.ret1 = 20;
    } else if (kind === 'optimistic') {
      p.crVisitLead = 11; p.crLeadClickout = 44; p.crClickoutIssue = 44; p.crCross = 16;
      p.seg.new.cac = 2000;  p.seg.repeat.cac = 320;  p.seg.overdue.cac = 600;  p.seg.sleep.cac = 240;
      p.seg.new.ret1 = 32;   p.seg.repeat.ret1 = 55; p.seg.overdue.ret1 = 45; p.seg.sleep.ret1 = 38;
    }
    return p;
  }
  var PRESETS = [
    { id: 'pessimistic', name: 'Пессимистичный' },
    { id: 'base',        name: 'База' },
    { id: 'optimistic',  name: 'Оптимистичный' }
  ];

  // ---- Конфиг порогов «светофора» (ТЗ §4: масштаб/контроль/ремонт) ----
  // Green   — масштабируем: LTV/CAC ≥ 2.5 И реальный Payback ≤ 24 мес. И маржа на лида > 0.
  // Yellow  — зона контроля: LTV/CAC от 1 до 2.5.
  // Red     — убыток / ремонт: LTV/CAC < 1 ИЛИ маржа на лида ≤ 0.
  var DEFAULT_THRESHOLDS = {
    ltvCacGreen: 2.5,
    ltvCacYellow: 1.0,
    paybackGreenMax: 24,
    paybackYellowMax: 36
  };
  var LEGACY_PAYBACK_GREEN_MAX = 2;
  var LEGACY_PAYBACK_YELLOW_MAX = 12;
  function loadThresholds() {
    try {
      var raw = localStorage.getItem(THRESH_KEY);
      if (!raw) return Object.assign({}, DEFAULT_THRESHOLDS);
      var saved = JSON.parse(raw);
      var merged = Object.assign({}, DEFAULT_THRESHOLDS, saved);
      // Миграция старой цели «окупиться за 2 месяца»: если пользователь не задавал
      // новый реальный горизонт вручную, возвращаем дефолт 24 месяца. В старом
      // хранилище не было признака ручного изменения, поэтому точно выставленные
      // пользователем legacy-значения 2/12 не перетираем.
      if (saved._realPaybackV2 !== true) {
        if ((Number(merged.paybackGreenMax) || 0) < LEGACY_PAYBACK_GREEN_MAX) merged.paybackGreenMax = DEFAULT_THRESHOLDS.paybackGreenMax;
        if ((Number(merged.paybackYellowMax) || 0) < LEGACY_PAYBACK_YELLOW_MAX) merged.paybackYellowMax = DEFAULT_THRESHOLDS.paybackYellowMax;
        merged._realPaybackV2 = true;
        saveThresholds(merged);
      }
      return merged;
    }
    catch (e) { return Object.assign({}, DEFAULT_THRESHOLDS); }
  }
  function saveThresholds(t) { try { localStorage.setItem(THRESH_KEY, JSON.stringify(t)); } catch (e) {} }

  // ---- Параметры A/B для сегмента «Повторные» (ТЗ §2.5) ----
  var CF_EXTERNAL_REVENUE = 0; // ₽, ЦФ — внутренний маршрут без выручки Выручай.ру
  var DEFAULT_REPEAT_AB = {
    cfApproval: 65,        // %, доля одобренных ЦФ заявок
    ownAov: 9000,          // ₽, средний чек собственной монетизации
    ownMargin: 25,         // %, ставка маржинальности
    ownServiceCost: 150,   // ₽, издержки на обслуживание лида
    repeatOrders: 1.4      // среднее число повторных сделок на лида сегмента в год
  };
  function normalizeRepeatAB(obj) {
    var normalized = Object.assign({}, DEFAULT_REPEAT_AB, obj || {});
    delete normalized.cfCommission;
    return normalized;
  }
  function loadRepeatAB() {
    try {
      var raw = localStorage.getItem(REPEAT_AB_KEY);
      return normalizeRepeatAB(raw ? JSON.parse(raw) : null);
    }
    catch (e) { return normalizeRepeatAB(); }
  }
  function saveRepeatAB(o) { try { localStorage.setItem(REPEAT_AB_KEY, JSON.stringify(normalizeRepeatAB(o))); } catch (e) {} }

  // ---- Конфиг правил автовыводов (ТЗ §2.4.3) ----
  // Каждое правило — JSON: { scope:'seg'|'portfolio', when:{...}, text:'...' }
  // when для seg: { romiGt, romiLt, ltvCacLt, paybackGt, marginLt } — все опциональны (AND).
  var DEFAULT_INSIGHTS_RULES = [
    { scope: 'seg', when: { ltvCacGte: 3, romiGte: 50 }, text: 'Сегмент {name} — самый рентабельный: ROMI = {romi}%, Payback = {payback} → масштабировать.' },
    { scope: 'seg', when: { marginLte: 0 }, text: 'Сегмент {name} убыточен на лид (маржа {margin} ₽) → снизить CAC канала или отключить.' },
    { scope: 'seg', when: { ltvCacLt: 1.5 }, text: 'Сегмент {name}: LTV/CAC = {ltvCac} ниже минимально допустимого — пересмотреть CAC и retention.' },
    { scope: 'portfolio', when: { blendedLtvCacGte: 3 }, text: 'Портфель в зелёной зоне: Blended LTV/CAC = {blendedRatio}. Можно увеличивать закупку трафика.' },
    { scope: 'portfolio', when: { blendedLtvCacLt: 3 }, text: 'Портфель под таргетом: Blended LTV/CAC = {blendedRatio}. Сократить CAC у худшего сегмента и повысить retention.' }
  ];
  function loadInsightsRules() {
    try { var raw = localStorage.getItem(INSIGHTS_KEY); if (!raw) return deepCopy(DEFAULT_INSIGHTS_RULES); return JSON.parse(raw); }
    catch (e) { return deepCopy(DEFAULT_INSIGHTS_RULES); }
  }
  function saveInsightsRules(r) { try { localStorage.setItem(INSIGHTS_KEY, JSON.stringify(r)); } catch (e) {} }

  // ---- Слоты пользовательских сценариев (ТЗ §2.2.2) ----
  function loadSlots() {
    try { var raw = localStorage.getItem(SLOTS_KEY); if (!raw) return []; return JSON.parse(raw) || []; }
    catch (e) { return []; }
  }
  function saveSlots(list) { try { localStorage.setItem(SLOTS_KEY, JSON.stringify((list || []).slice(0, 5))); } catch (e) {} }
  function loadCompare() {
    try { var raw = localStorage.getItem(COMPARE_KEY); if (!raw) return { a: '', b: '' }; return JSON.parse(raw); }
    catch (e) { return { a: '', b: '' }; }
  }
  function saveCompare(c) { try { localStorage.setItem(COMPARE_KEY, JSON.stringify(c || {})); } catch (e) {} }

  function num(n) { return Math.round(Number(n) || 0).toLocaleString('ru-RU'); }
  function money(n) { return num(n) + ' ₽'; }
  function money1(n) { return (Number(n) || 0).toLocaleString('ru-RU', { maximumFractionDigits: 1 }) + ' ₽'; }
  function pct(n) { return (Number(n) || 0).toLocaleString('ru-RU', { maximumFractionDigits: 1 }) + '%'; }
  function ratio(n) { return (Number(n) || 0).toLocaleString('ru-RU', { maximumFractionDigits: 2 }) + 'x'; }
  function signedRatioDelta(n) {
    var v = Number(n) || 0;
    return (v >= 0 ? '+' : '') + v.toLocaleString('ru-RU', { maximumFractionDigits: 2 }) + 'x';
  }
  function esc(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  /* ============================== РАСЧЁТЫ ============================== */

  // Метрики на один лид: gross/net revenue per lead, конверсия лида в выдачу.
  // ТЗ §2.4.1: RPL = Σ выручки / число лидов; здесь rpl = ожидаемая выручка на ОДИН лид с учётом CR.
  function leadEconomics(p) {
    var gross = p.epl + (p.crCross / 100) * p.crossEpl;
    var net = gross * (1 - p.revShare / 100) - p.opex;
    var crApprove = (p.crLeadClickout / 100) * (p.crClickoutIssue / 100);
    return { gross: gross, net: net, crApprove: crApprove };
  }

  // LTV по сегменту: LTV_0 = Net * (CR_clickout * CR_approved) с поправкой funnelMul,
  // LTV_1 / LTV_2 — накопительно с дисконтированием по ставке.
  function segmentEconomics(p, segId) {
    var s = p.seg[segId];
    var le = leadEconomics(p);
    var d = p.discount / 100;
    // Сегментный коэффициент подстраивает CR под особенности CJM (повторные конвертят выше,
    // спящие — ниже). LTV_0 — ценность лида сегмента в нулевой период.
    var crSegment = le.crApprove * (s.funnelMul || 1);
    var ltv0, ltv1, ltv2;
    var isBfl = s.router === 'bfl';

    if (p.isRouterActive) {
      if (segId === 'new') {
        // Новый: Выдача ЦФ = 0 ₽. Маркетплейс зарабатывает только с отказников (Soft Reject).
        var rejectRate = (p.cfRejectRate || 70) / 100;
        var revReject = p.epl * (1 - p.revShare / 100);
        ltv0 = rejectRate * revReject * crSegment;
        // Второй договор: только доля cfSecondContract клиентов возвращается во второй договор ЦФ
        // и снова частично уходит в Soft Reject МФО (повторный доход Выручай.ру). Остальные
        // становятся спящими/отказными и не пользуются услугами МФО → повторного дохода нет.
        var secondShare = (p.cfSecondContract != null ? p.cfSecondContract : DEFAULT_CF_SECOND_CONTRACT) / 100;
        ltv1 = ltv0 + (ltv0 * (s.ret1 / 100) * secondShare) / (1 + d);
        ltv2 = ltv1 + (ltv0 * (s.ret2 / 100) * secondShare) / Math.pow(1 + d, 2);
      } else if (segId === 'repeat' || segId === 'sleep') {
        // Действующий и Спящий: Кредиты блокируются, заработок с кросс-сейла некредитных продуктов.
        var crossBankRev = (p.crossEpl || 1200) * (1 - p.revShare / 100);
        var crossCr = (p.crCrossBank || 5) / 100;
        crSegment = crossCr;
        ltv0 = crossBankRev * crossCr;
        ltv1 = ltv0; // Без retention хвоста, так как это разовая продажа банковского продукта
        ltv2 = ltv0;
      } else if (segId === 'overdue' || isBfl) {
        // Просроченный: Монетизация через БФЛ
        var revBfl = (p.eplBfl || 3000) * (1 - p.revShare / 100);
        crSegment = (p.crLeadBfl || 10) / 100;
        ltv0 = revBfl * crSegment;
        ltv1 = ltv0;
        ltv2 = ltv0;
        isBfl = true;
      }
    } else {
      if (isBfl) {
        // Поддержка принудительной маршрутизации в БФЛ в классической воронке (если явно включено)
        var revBflAsIs = (p.eplBfl || 3000) * (1 - p.revShare / 100);
        crSegment = (p.crLeadBfl || 10) / 100;
        ltv0 = revBflAsIs * crSegment;
        ltv1 = ltv0;
        ltv2 = ltv0;
      } else {
        ltv0 = le.net * crSegment;
        ltv1 = ltv0 + (ltv0 * (s.ret1 / 100)) / (1 + d);
        ltv2 = ltv1 + (ltv0 * (s.ret2 / 100)) / Math.pow(1 + d, 2);
      }
    }

    var roi = s.cac > 0 ? (ltv2 - s.cac) / s.cac * 100 : 0;
    var ltvCac = s.cac > 0 ? ltv2 / s.cac : 0;
    // Срок окупаемости (месяцы): классическая линейная интерполяция накопленного LTV
    // по горизонту 0 / 12 / 24 мес. В нулевой месяц накопленный доход = 0,
    // дальше он равномерно накапливается до LTV₁ к 12-му месяцу.
    var payback = paybackMonths(ltv0, ltv1, ltv2, s.cac);
    // ТЗ §2.4.1: RPL (Revenue per Lead) = выручка сегмента / число лидов. Берём LTV₂ как
    // ожидаемую совокупную выручку с одного привлечённого лида за 2 года.
    var rpl = ltv2;
    // Маржа на лида = RPL − CAC − COGS_на_лида. В нашей модели COGS_на_лида = OPEX (на лида).
    var marginPerLead = rpl - s.cac - p.opex;
    return {
      seg: s, segId: segId, name: SEGMENTS.find(function(x){return x.id===segId;}).name,
      ltv0: ltv0, ltv1: ltv1, ltv2: ltv2, cac: s.cac, roi: roi, ltvCac: ltvCac,
      payback: payback, crSegment: crSegment, share: s.share,
      rpl: rpl, marginPerLead: marginPerLead
    };
  }

  function paybackMonths(ltv0, ltv1, ltv2, cac) {
    if (cac <= 0) return 0;
    // Между 0 и 12 мес растёт линейно от 0 до LTV₁.
    if (ltv1 >= cac) {
      var t = cac / Math.max(0.0001, ltv1);
      // Модель помесячная: субмесячную окупаемость не обещаем, минимум отображения — 1 месяц.
      return clamp(t * 12, 1, 12);
    }
    // Между 12 и 24 мес добираем от LTV₁ до LTV₂.
    if (ltv2 >= cac) {
      var t2 = (cac - ltv1) / Math.max(0.0001, (ltv2 - ltv1));
      return clamp(12 + t2 * 12, 12, 24);
    }
    return Infinity;
  }

  // Сводные KPI по всем сегментам, взвешенные по доле сегмента.
  function blendedKpis(p) {
    var totalShare = SEGMENTS.reduce(function (a, s) { return a + (p.seg[s.id].share || 0); }, 0) || 1;
    var blendedCac = 0, avgArpu = 0, blendedLtv2 = 0;
    var paybackWeighted = 0, paybackHasInf = false, paybackWeightFinite = 0;
    var perSeg = SEGMENTS.map(function (s) {
      var e = segmentEconomics(p, s.id);
      var w = (p.seg[s.id].share || 0) / totalShare;
      blendedCac += e.cac * w;
      avgArpu += e.ltv2 * w;            // ARPU за 2 года жизни клиента
      blendedLtv2 += e.ltv2 * w;
      if (isFinite(e.payback)) { paybackWeighted += e.payback * w; paybackWeightFinite += w; }
      else paybackHasInf = true;
      e.weight = w;
      return e;
    });
    var blendedRatio = blendedCac > 0 ? blendedLtv2 / blendedCac : 0;
    var payback = paybackWeightFinite > 0 ? paybackWeighted / paybackWeightFinite : Infinity;
    return {
      perSeg: perSeg, blendedCac: blendedCac, avgArpu: avgArpu, blendedLtv2: blendedLtv2,
      blendedRatio: blendedRatio, payback: payback, paybackHasInf: paybackHasInf,
      totalShare: totalShare
    };
  }

  // ---- Светофор сегмента (ТЗ §4) ----
  // Red    — маржа на лида ≤ 0 ИЛИ LTV/CAC < ltvCacYellow → ремонт / отключение канала.
  // Yellow — ltvCacYellow ≤ LTV/CAC < ltvCacGreen → зона контроля.
  // Green  — LTV/CAC ≥ ltvCacGreen И Payback ≤ paybackGreenMax → масштабируем.
  function segmentLight(e, th) {
    if (!th) th = loadThresholds();
    if (e.marginPerLead <= 0) return { tone: 'red',    label: 'Ремонт' };
    if (e.ltvCac < (th.ltvCacYellow || 1)) return { tone: 'red', label: 'Ремонт' };
    var okRatio = e.ltvCac >= th.ltvCacGreen;
    var okPb = isFinite(e.payback) && e.payback <= th.paybackGreenMax;
    if (okRatio && okPb) return { tone: 'green', label: 'Масштабируем' };
    return { tone: 'yellow', label: 'Контроль' };
  }

  // ---- A/B экономика повторных: Центр Финансов vs Своя монетизация (ТЗ §2.5) ----
  function repeatAB(p, ab) {
    if (!ab) ab = loadRepeatAB();
    var leadsApproved = (p.crLeadClickout / 100) * (p.crClickoutIssue / 100) * (p.seg.repeat.funnelMul || 1);
    // A. Передача в Центр Финансов: одобренные ЦФ-заявки = 0 ₽ (внутренний маршрут без выручки
    //    Выручай.ру). Отказники (1 − % одобрения ЦФ) монетизируются через Soft Reject МФО,
    //    поэтому % одобрения напрямую влияет на маржу маршрута A: чем ниже одобрение, тем больше
    //    отказников уходит на платную МФО-витрину.
    var revReject = p.epl * (1 - p.revShare / 100);
    var rejectShareA = Math.max(0, 1 - ab.cfApproval / 100);
    var revenueA = revReject * rejectShareA * leadsApproved;
    var marginA = revenueA - p.seg.repeat.cac;
    // B. Своя монетизация: доход = AOV × ставка маржинальности × повторные сделки; издержки = сервис на лида
    var revenueB = ab.ownAov * (ab.ownMargin / 100) * ab.repeatOrders;
    var marginB = revenueB - ab.ownServiceCost - p.seg.repeat.cac;
    var winner = marginA >= marginB ? 'A' : 'B';
    var delta = Math.abs(marginA - marginB);
    return { marginA: marginA, marginB: marginB, winner: winner, delta: delta, leadsApproved: leadsApproved, revenueA: revenueA, revenueB: revenueB, params: ab };
  }

  // ---- Автовыводы по правилам (ТЗ §2.4.3) ----
  function compileInsights(k, th, rules) {
    if (!rules) rules = loadInsightsRules();
    var out = [];
    rules.forEach(function (rule) {
      if (rule.scope === 'seg') {
        k.perSeg.forEach(function (e) {
          if (matchSeg(e, rule.when)) out.push({ scope: 'seg', name: e.name, text: fillTokens(rule.text, segTokens(e)) });
        });
      } else if (rule.scope === 'portfolio') {
        if (matchPortfolio(k, rule.when)) out.push({ scope: 'portfolio', text: fillTokens(rule.text, portfolioTokens(k)) });
      }
    });
    // Гарантируем минимум: ≥1 вывод на сегмент + ≥1 общий по портфелю (ТЗ §2.4.3)
    SEGMENTS.forEach(function (s) {
      var e = k.perSeg.find(function (x) { return x.segId === s.id; });
      if (!e) return;
      if (!out.some(function (o) { return o.scope === 'seg' && o.name === e.name; })) {
        var lt = segmentLight(e, th);
        var hint = lt.tone === 'green' ? 'удержать долю и нарастить'
          : (lt.tone === 'yellow' ? 'наблюдать: один из KPI вне таргета' : 'снизить CAC или ограничить долю');
        out.push({ scope: 'seg', name: e.name, text: 'Сегмент ' + e.name + ': ROMI ' + Math.round(e.roi) + '%, LTV/CAC ' + e.ltvCac.toFixed(2) + ' → ' + hint + '.' });
      }
    });
    if (!out.some(function (o) { return o.scope === 'portfolio'; })) {
      out.push({ scope: 'portfolio', text: 'Портфель: Blended LTV/CAC = ' + k.blendedRatio.toFixed(2) + ' при таргете ≥ ' + th.ltvCacGreen + '.' });
    }
    return out;
  }
  function matchSeg(e, w) {
    if (!w) return true;
    if (w.romiGte != null && !(e.roi >= w.romiGte)) return false;
    if (w.romiLt  != null && !(e.roi <  w.romiLt))  return false;
    if (w.ltvCacGte != null && !(e.ltvCac >= w.ltvCacGte)) return false;
    if (w.ltvCacLt  != null && !(e.ltvCac <  w.ltvCacLt))  return false;
    if (w.paybackGt != null && !(isFinite(e.payback) && e.payback > w.paybackGt)) return false;
    if (w.marginLte != null && !(e.marginPerLead <= w.marginLte)) return false;
    return true;
  }
  function matchPortfolio(k, w) {
    if (!w) return true;
    if (w.blendedLtvCacGte != null && !(k.blendedRatio >= w.blendedLtvCacGte)) return false;
    if (w.blendedLtvCacLt  != null && !(k.blendedRatio <  w.blendedLtvCacLt))  return false;
    return true;
  }
  function segTokens(e) {
    return {
      name: e.name, romi: Math.round(e.roi), ltvCac: e.ltvCac.toFixed(2),
      payback: paybackText(e.payback), margin: Math.round(e.marginPerLead),
      rpl: Math.round(e.rpl), cac: Math.round(e.cac)
    };
  }
  function portfolioTokens(k) {
    return {
      blendedRatio: k.blendedRatio.toFixed(2),
      blendedCac: Math.round(k.blendedCac),
      avgArpu: Math.round(k.avgArpu)
    };
  }
  function fillTokens(tpl, tok) {
    return String(tpl || '').replace(/\{(\w+)\}/g, function (_, k) {
      return tok[k] == null ? '{' + k + '}' : tok[k];
    });
  }

  // ---- Прозрачный алгоритм: пошаговый расчёт на эталонной когорте 1 000 лидов (ТЗ §2.3) ----
  function cohortBreakdown(p, segId) {
    var s = p.seg[segId];
    var e = segmentEconomics(p, segId);
    var leads = COHORT_SIZE;
    var clickouts = leads * (p.crLeadClickout / 100) * Math.sqrt(s.funnelMul || 1);
    var issues = clickouts * (p.crClickoutIssue / 100) * Math.sqrt(s.funnelMul || 1);
    var le = leadEconomics(p);
    var grossRevenue = issues * le.gross;
    var revShareCost = grossRevenue * (p.revShare / 100);
    var opexCost = leads * p.opex;
    var netRevenue = grossRevenue - revShareCost - opexCost;
    var cacTotal = leads * s.cac;
    var marginTotal = netRevenue - cacTotal;
    var romi = cacTotal > 0 ? marginTotal / cacTotal * 100 : 0;
    return {
      segId: segId, segName: e.name, leads: leads, clickouts: clickouts, issues: issues,
      grossRevenue: grossRevenue, revShareCost: revShareCost, opexCost: opexCost,
      netRevenue: netRevenue, cacTotal: cacTotal, marginTotal: marginTotal, romi: romi,
      cr1: p.crLeadClickout * Math.sqrt(s.funnelMul || 1),
      cr2: p.crClickoutIssue * Math.sqrt(s.funnelMul || 1),
      gross: le.gross, cac: s.cac, opex: p.opex, revShare: p.revShare,
      rplCohort: netRevenue / leads, marginPerLead: marginTotal / leads
    };
  }

  /* ============================== РЕНДЕР ============================== */

  var baseParams = load();         // редактируемая «As-Is» база (панель управления, слоты, пресеты)
  var currentMode = loadMode();    // 'asis' | 'tobe'
  var activeTab = loadTab();
  var params = applyMode(baseParams, currentMode); // производные вводные активной модели (для расчётов/графиков)
  var activeFunnelSeg = 'new';
  var scenarioUsers = USERS_BASE;

  // Пересчитать производные вводные активной модели из базы (вызывается перед каждым рендером).
  function refreshViewParams() { params = applyMode(baseParams, currentMode); }

  function render() {
    var host = document.getElementById('ueLab');
    if (!host) return;
    refreshViewParams();
    host.innerHTML =
      '<div class="ue2">' +
        '<aside class="ue2-side">' + sidebarHtml() + '</aside>' +
        '<div class="ue2-main">' + mainHtml() + '</div>' +
      '</div>' +
      explainModalHtml();
    wire();
    drawCharts();
  }

  // Шапка модели (Toggle As-Is/To-Be) + лента табов + панель активного таба.
  function mainHtml() {
    return modeToggleHtml() + tabsNavHtml() +
      '<div class="ue2-tabpanel" id="ueTabPanel" role="tabpanel">' + tabPanelHtml(activeTab) + '</div>';
  }

  // ---- Toggle [As-Is] / [To-Be] (ТЗ-1 §3.1) ----
  function modeToggleHtml() {
    var k = blendedKpis(params);
    var baseK = blendedKpis(baseParams);
    var growthPill = currentMode === 'tobe'
      ? '<span class="ue2-mode-pill tone-green">Рост к As-Is ' + signedRatioDelta(k.blendedRatio - baseK.blendedRatio) + '</span>'
      : '';
    var tone = ltvCacTone(k.blendedRatio);
    return '<div class="ue2-modebar">' +
      '<div class="ue2-mode-switch" role="tablist" aria-label="Модель юнит-экономики">' +
        '<button type="button" class="ue2-mode-btn' + (currentMode === 'asis' ? ' is-active' : '') + '"' +
          ' role="tab" aria-selected="' + (currentMode === 'asis') + '" data-ue-mode="asis">Текущая модель · As-Is</button>' +
        '<button type="button" class="ue2-mode-btn' + (currentMode === 'tobe' ? ' is-active' : '') + '"' +
          ' role="tab" aria-selected="' + (currentMode === 'tobe') + '" data-ue-mode="tobe">Целевая · Router &amp; Quiz · To-Be</button>' +
      '</div>' +
      '<div class="ue2-mode-meta">' +
        '<span class="ue2-mode-pill tone-' + tone + '">Blended LTV/CAC ' + ratio(k.blendedRatio) + '</span>' +
        growthPill +
        '<span class="ue2-mode-hint">' + (currentMode === 'tobe'
          ? 'Где зарабатываем: Квиз снижает CAC новых, Router монетизирует отказников через БФЛ и CPA-витрину.'
          : 'Текущая выручка проекта без рычагов масштабирования — Blended LTV/CAC ниже таргета.') + '</span>' +
      '</div>' +
    '</div>';
  }

  // ---- Лента табов (ARIA tablist) ----
  function tabsNavHtml() {
    var btns = TABS.map(function (t) {
      var active = t.id === activeTab;
      return '<button type="button" class="ue2-tab' + (active ? ' is-active' : '') + '"' +
        ' role="tab" id="ueTab-' + t.id + '" aria-selected="' + active + '" aria-controls="ueTabPanel"' +
        ' data-ue-tab="' + t.id + '" tabindex="' + (active ? '0' : '-1') + '">' + esc(t.name) + '</button>';
    }).join('');
    return '<div class="ue2-tabs" role="tablist" aria-label="Разделы юнит-экономики">' + btns + '</div>';
  }

  // ---- Контент активного таба (переиспользует существующие рендереры) ----
  function tabPanelHtml(tab) {
    switch (tab) {
      case 'segments':
        return tzSegmentLightHtml() + rplBarChartHtml() + segmentMatrixHtml();
      case 'funnel':
        return '<div class="ue2-row">' + funnelCardHtml() + cohortCardHtml() + '</div>';
      case 'scenario':
        return scenario10kHtml();
      case 'ab':
        return repeatABHtml() + insightsHtml() + presetBarHtml() + compareSplitHtml();
      case 'overview':
      default:
        return managementDecisionHtml() + kpiHtml() + waterfallHtml() + tzSegmentLightHtml() + summaryHtml();
    }
  }

  /* ---------- Sidebar (панель управления) ---------- */
  function sliderRow(key, label, unit, min, max, step, value, hint) {
    var v = Number(value);
    return '<div class="ue2-slider" data-row="' + key + '">' +
      '<div class="ue2-slider-head"><label>' + esc(label) +
        (unit ? ' <span class="ue2-unit">' + esc(unit) + '</span>' : '') +
        '</label><input type="number" class="ue2-num" data-ue-param="' + key + '"' +
        ' min="' + min + '" max="' + max + '" step="' + step + '" value="' + v + '"></div>' +
      '<input type="range" class="ue2-range" data-ue-param="' + key + '"' +
        ' min="' + min + '" max="' + max + '" step="' + step + '" value="' + v + '">' +
      (hint ? '<div class="ue2-hint">' + esc(hint) + '</div>' : '') +
    '</div>';
  }
  function segSliderRow(segId, field, label, unit, min, max, step, value, hint) {
    var key = 'seg.' + segId + '.' + field;
    return sliderRow(key, label, unit, min, max, step, value, hint);
  }

  function sidebarHtml() {
    var bp = params; // показываем вводные АКТИВНОЙ модели (As-Is или производные To-Be), чтобы
                     // при переключении модели цифры слева тоже менялись; правка пишется в As-Is базу.
    var common =
      '<div class="ue2-side-group">' +
        '<h4>Общие метрики</h4>' +
        sliderRow('epl',      'EPL',      '₽ за выдачу',    100, 3000, 10,  bp.epl,
          'Доход партнёрской программы за одобренную выдачу.') +
        sliderRow('opex',     'OPEX',     '₽ на лида',      0,   600,  5,   bp.opex,
          'Переменные технические и операционные расходы на обработку одного лида. Постоянный ФОТ команды и инфраструктура сюда НЕ входят — они учтены отдельной фиксированной строкой в общей PnL.') +
        sliderRow('revShare', 'Rev Share','%',              0,   80,   1,   bp.revShare,
          'Доля партнёра/паблишера в валовом доходе с одной выдачи.') +
        sliderRow('discount', 'Дисконт',  '%/год',          0,   60,   1,   bp.discount,
          'Ставка дисконтирования будущих когортных доходов.') +
      '</div>';

    var funnel =
      '<div class="ue2-side-group">' +
        '<h4>Метрики воронки</h4>' +
        sliderRow('crVisitLead',    'CR Visit → Lead',      '%', 0, 30, 0.5, bp.crVisitLead) +
        sliderRow('crLeadClickout', 'CR Lead → Click-out',  '%', 0, 90, 1,   bp.crLeadClickout) +
        sliderRow('crClickoutIssue','CR Click-out → Выдача','%', 0, 90, 1,   bp.crClickoutIssue) +
      '</div>';

    var cross =
      '<div class="ue2-side-group">' +
        '<h4>Кросс-сейл</h4>' +
        sliderRow('crCross',  'CR Cross-sell', '%',           0, 60,   1,  bp.crCross) +
        sliderRow('crossEpl', 'Доп. EPL',     '₽ за выдачу',  0, 3000, 10, bp.crossEpl) +
      '</div>';

    var routerGroup =
      '<div class="ue2-side-group">' +
        '<h4>Smart Safe Router</h4>' +
        sliderRow('cfRejectRate', 'Доля отказов ЦФ (Soft Reject)', '%', 0, 100, 1, bp.cfRejectRate || 70, 'Влияет на объём трафика, уходящего на внешнюю CPA-витрину') +
        sliderRow('cfSecondContract', 'Второй договор ЦФ (Новые)', '%', 0, 100, 1, bp.cfSecondContract != null ? bp.cfSecondContract : DEFAULT_CF_SECOND_CONTRACT, 'Доля «Новых», возвращающихся во второй договор ЦФ. Остальные становятся спящими/отказными и не пользуются МФО. По умолчанию 60%.') +
        sliderRow('crCrossBank', 'CR кросс-сейл (некредиты)', '%', 0, 60, 1, bp.crCrossBank || 5, 'Для действующих и спящих клиентов') +
        sliderRow('crLeadBfl', 'CR квал. лид БФЛ', '%', 0, 90, 1, bp.crLeadBfl || 10) +
        sliderRow('eplBfl', 'Выплата БФЛ (EPL)', '₽', 0, 10000, 100, bp.eplBfl || 3000) +
      '</div>';

    var segs = SEGMENTS.map(function (s) {
      var sp = bp.seg[s.id];
      return '<div class="ue2-side-group ue2-seg-group" data-seg="' + s.id + '" style="--seg-accent:' + s.accent + '">' +
        '<h4><span class="ue2-seg-dot" style="background:' + s.accent + '"></span>Сегмент · ' + esc(s.name) + '</h4>' +
        segSliderRow(s.id, 'cac',       'CAC',         '₽',  0, 5000, 50, sp.cac) +
        segSliderRow(s.id, 'ret1',      'Retention 1 год', '%', 0, 90, 1, sp.ret1) +
        segSliderRow(s.id, 'ret2',      'Retention 2 год', '%', 0, 90, 1, sp.ret2) +
        segSliderRow(s.id, 'share',     'Доля сегмента',   '%', 0, 100, 1, sp.share) +
        segSliderRow(s.id, 'funnelMul', 'Коэф. воронки',   '×', 0.3, 1.6, 0.05, sp.funnelMul,
          'Поправка к (CR Lead→Click-out × CR Click-out→Выдача) для специфики сегмента.') +
      '</div>';
    }).join('');

    var modeNote = currentMode === 'tobe'
      ? '<p class="ue2-side-note">Активна <b>целевая модель (To-Be)</b>: значения ниже показаны уже с учётом Квиза, нового Traffic&nbsp;Mix и Smart&nbsp;Safe&nbsp;Router&nbsp;→&nbsp;БФЛ. Правка ползунков меняет базовый («As-Is») сценарий, поверх которого пересчитывается To-Be.</p>'
      : '';
    return '<div class="ue2-side-head"><h3>Панель управления</h3>' +
      '<button class="ue2-reset" type="button" id="ueResetParams">Сбросить</button></div>' +
      '<p class="ue2-side-lead">Все вводные из листа «Вводные» Excel-модели. Двигайте ползунки или вводите значение — все KPI, графики и P&amp;L пересчитываются мгновенно.</p>' +
      modeNote +
      common + funnel + cross + routerGroup + thresholdsSidebarHtml() + segs;
  }

  /* ---------- Top cards (сводные KPI) ---------- */
  function kpiCard(label, value, sub, tone, badgeText) {
    return '<div class="ue2-kpi tone-' + tone + '">' +
      '<span class="ue2-kpi-label">' + esc(label) + '</span>' +
      '<span class="ue2-kpi-value">' + value + '</span>' +
      (badgeText ? '<span class="ue2-kpi-badge tone-' + tone + '">' + esc(badgeText) + '</span>' : '') +
      (sub ? '<span class="ue2-kpi-sub">' + sub + '</span>' : '') +
      '</div>';
  }
  function ltvCacTone(r) { return r >= 2.5 ? 'green' : r >= 1 ? 'yellow' : 'red'; }
  function ltvCacBadge(r) { return r >= 2.5 ? 'таргет ≥ 2.5' : r >= 1 ? 'ниже таргета' : 'убыток'; }
  function yearWord(n) {
    var x = Math.abs(Math.round(n)) % 100;
    var y = x % 10;
    if (x > 10 && x < 20) return 'лет';
    if (y === 1) return 'год';
    if (y >= 2 && y <= 4) return 'года';
    return 'лет';
  }
  function paybackText(p) {
    if (!isFinite(p)) return 'не окупается';
    if (p < 1) return '≈ ' + Math.max(1, Math.round(p * 30)).toLocaleString('ru-RU') + ' дн.';
    if (p < 12) return p.toLocaleString('ru-RU', { maximumFractionDigits: 1 }) + ' мес.';
    var years = Math.floor(p / 12);
    var months = Math.floor(p % 12);
    return years.toLocaleString('ru-RU') + ' ' + yearWord(years) + (months > 0 ? ' ' + months + ' мес.' : '');
  }
  function paybackTone(p) {
    if (!isFinite(p)) return 'red';
    var th = loadThresholds();
    if (p <= th.paybackGreenMax) return 'green';
    if (p <= th.paybackYellowMax) return 'yellow';
    return 'red';
  }

  function kpiHtml() {
    var k = blendedKpis(params);
    var ratioTone = ltvCacTone(k.blendedRatio);
    var pTone = paybackTone(k.payback);
    var perSegHtml = k.perSeg.map(function (e) {
      var t = ltvCacTone(e.ltvCac);
      return '<div class="ue2-kpi-mini tone-' + t + '">' +
        '<span class="ue2-mini-name">' + esc(e.name) + '</span>' +
        '<span class="ue2-mini-val">' + ratio(e.ltvCac) + '</span>' +
        '<span class="ue2-mini-sub">LTV ' + money(e.ltv2) + ' · CAC ' + money(e.cac) + '</span>' +
      '</div>';
    }).join('');

    var cards =
      kpiCard('Blended CAC', money(k.blendedCac),
        'Σ доля сегмента × CAC сегмента', 'blue') +
      kpiCard('Average ARPU', money(k.avgArpu),
        'Средняя выручка с лида за 2 года (LTV₂, взвешенно)', 'blue') +
      kpiCard('LTV / CAC (общий)', ratio(k.blendedRatio),
        'Blended ARPU ÷ Blended CAC · целевой порог ≥ 2.5', ratioTone, ltvCacBadge(k.blendedRatio)) +
      kpiCard('Payback period', paybackText(k.payback),
        'Срок окупаемости когорты · CAC ↔ накопительный LTV', pTone,
        pTone === 'green' ? 'быстро' : pTone === 'yellow' ? 'умеренно' : 'долго');

    return '<div class="ue2-kpis">' + cards + '</div>' +
      '<div class="ue2-kpi-mini-row">' + perSegHtml + '</div>';
  }

  /* ---------- PnL Waterfall ---------- */
  function waterfallHtml() {
    var r = scenario10k(params, scenarioUsers || 10000);
    var totalInvest = r.tot.cacTotal + r.tot.opexTotal;
    
    var rowNew = r.rows.find(function(x){ return x.seg.id === 'new'; });
    var rowRepeat = r.rows.find(function(x){ return x.seg.id === 'repeat'; });
    var rowSleep = r.rows.find(function(x){ return x.seg.id === 'sleep'; });
    var rowOverdue = r.rows.find(function(x){ return x.seg.id === 'overdue'; });

    var rejectRev = rowNew ? rowNew.revenue : 0;
    var crossRev = (rowRepeat ? rowRepeat.revenue : 0) + (rowSleep ? rowSleep.revenue : 0);
    var overdueRev = rowOverdue ? rowOverdue.revenue : 0;
    
    var totalRev = rejectRev + crossRev + overdueRev;
    var margin = totalRev - totalInvest;
    var isGreen = margin >= 0;
    
    // Длина бара считается от самой большой величины строки (инвестиции или суммарная выручка)
    // и применяется к гибкому треку, а НЕ ко всей строке — иначе бар перекрывал бы подпись и «уезжал».
    var maxVal = Math.max(totalInvest, totalRev, 1);
    function barWidth(v) { return clamp((Math.abs(v) / maxVal) * 100, 1, 100) + '%'; }

    // Каждая строка = grid из трёх колонок: подпись (фикс.) · трек (растягивается) · сумма (по содержимому).
    // Заливка-бар лежит внутри трека, поэтому её ширина в % всегда относится к свободному месту, без overflow.
    function wfRow(num, label, valueText, fillStyle, fillW, opts) {
      opts = opts || {};
      var labelStyle = opts.bold ? ' style="font-weight:700;"' : '';
      var rowStyle = opts.total ? ' style="margin-top:6px;padding-top:10px;border-top:1px solid var(--line);"' : '';
      var fill = fillW === null
        ? '<span class="ue2-wf-zero">Внутренняя синергия</span>'
        : '<span class="ue2-wf-fill" style="' + fillStyle + 'width:' + fillW + '"></span>';
      return '<div class="ue2-wf-row"' + rowStyle + '>' +
        '<div class="ue2-wf-label"' + labelStyle + '>' + num + '. ' + esc(label) + '</div>' +
        '<div class="ue2-wf-track">' + fill + '</div>' +
        '<div class="ue2-wf-val"' + labelStyle + '>' + valueText + '</div>' +
      '</div>';
    }

    var styles = '<style>' +
      '.ue2-waterfall { margin-top: 16px; }' +
      '.ue2-wf-row { display: grid; grid-template-columns: minmax(170px, 230px) 1fr minmax(96px, auto); align-items: center; gap: 12px; margin-bottom: 8px; }' +
      '.ue2-wf-label { font-weight: 500; color: var(--text); }' +
      '.ue2-wf-track { position: relative; height: 22px; background: var(--surface-2, rgba(127,127,127,.12)); border-radius: 5px; overflow: hidden; }' +
      '.ue2-wf-fill { display: block; height: 100%; border-radius: 5px; min-width: 2px; }' +
      '.ue2-wf-zero { display: inline-flex; align-items: center; height: 100%; padding-left: 8px; font-size: 12px; color: var(--faint); }' +
      '.ue2-wf-val { text-align: right; font-variant-numeric: tabular-nums; white-space: nowrap; font-weight: 600; }' +
      '@media (max-width: 560px) { .ue2-wf-row { grid-template-columns: 1fr auto; } .ue2-wf-track { grid-column: 1 / -1; order: 3; } }' +
    '</style>';

    return '<div class="ue2-card">' + styles +
      '<div class="ue2-card-head">' +
        '<h2>PnL Waterfall · Окупаемость внешнего трафика</h2>' +
        '<p>Мы тратим маркетинговый бюджет на Новых, отдаём лучших клиентов в ЦФ бесплатно, но всё равно окупаем CAC за счёт монетизации отказников, действующих и спящих через Роутер.</p>' +
      '</div>' +
      '<div class="ue2-waterfall">' +
        wfRow(1, 'Инвестиции (CAC+OPEX)', '−' + money(totalInvest), 'background:var(--red);', barWidth(totalInvest)) +
        wfRow(2, 'Одобренные ЦФ (передача)', '0 ₽', '', null) +
        wfRow(3, 'Компенсация: Soft Reject МФО', '+' + money(rejectRev), 'background:var(--blue);', barWidth(rejectRev)) +
        wfRow(4, 'Компенсация: Банки/РКО', '+' + money(crossRev), 'background:var(--green);', barWidth(crossRev)) +
        wfRow(5, 'Компенсация: БФЛ/HR', '+' + money(overdueRev), 'background:var(--orange);', barWidth(overdueRev)) +
        wfRow(6, 'Итог (Чистая маржа)', (isGreen ? '+' : '') + money(margin),
          'background:var(--' + (isGreen ? 'green' : 'red') + ');', barWidth(margin), { bold: true, total: true }) +
      '</div>' +
    '</div>';
  }

  /* ---------- Управленческий вывод ---------- */
  function managementDecisionHtml() {
    var k = blendedKpis(params);
    var th = loadThresholds();
    var seg = function (id) { return segmentEconomics(params, id); };
    var eNew = seg('new'), eRepeat = seg('repeat'), eOverdue = seg('overdue'), eSleep = seg('sleep');
    var ab = repeatAB(params);
    var portfolioOk = k.blendedRatio >= th.ltvCacGreen;
    var tone = portfolioOk ? 'green' : (k.blendedRatio >= th.ltvCacYellow ? 'yellow' : 'red');
    var decision = portfolioOk
      ? 'Запускать управляемый To-Be пилот: масштаб — только через прибыльные ветки, не «заливать» весь трафик одинаково.'
      : 'As-Is в масштаб не запускать: сначала включить Quiz + Smart Safe Router и довести экономику до зелёного коридора.';
    var talkTrack = currentMode === 'tobe'
      ? 'Мы не продаём идею квиза как интерфейс. Мы показываем, что квиз и Router — это экономический фильтр: снижают CAC Новых, целевых клиентов ЦФ отдаёт без выручки Выручай.ру, а деньги зарабатывает на внешних ветках БФЛ/CPA/банков.'
      : 'По текущей модели ответ честный: без маршрутизации и квиза экономика не является инвестиционным кейсом. Решение — не спорить с цифрами, а запускать только рычаги, где выручка появляется от внешних партнёров, а ЦФ-target считать внутренней синергией.';

    var card = function (toneCard, title, metric, decisionText, proof) {
      return '<article class="ue2-decision-card tone-' + toneCard + '">' +
        '<span class="ue2-decision-tag">' + esc(metric) + '</span>' +
        '<h3>' + esc(title) + '</h3>' +
        '<p>' + decisionText + '</p>' +
        '<div class="ue2-decision-proof">' + proof + '</div>' +
      '</article>';
    };
    var repeatRoute = ab.winner === 'A' ? 'Центр Финансов (0 ₽ выручки Выручай.ру)' : 'своя монетизация';
    var repeatProof = 'LTV/CAC <b>' + ratio(eRepeat.ltvCac) + '</b>, маржа/лид <b>' + money(eRepeat.marginPerLead) + '</b>; A/B показывает маршрут: <b>' + esc(repeatRoute) + '</b>.';
    var overdueProof = 'LTV/CAC <b>' + ratio(eOverdue.ltvCac) + '</b>, маржа/лид <b>' + money(eOverdue.marginPerLead) + '</b>; Router переводит рискованный интент в БФЛ/CPA вместо потери лида.';
    var newProof = 'LTV/CAC <b>' + ratio(eNew.ltvCac) + '</b>, маржа/лид <b>' + money(eNew.marginPerLead) + '</b>; рост только через квиз, лимит CAC и контроль CR Visit→Lead.';
    var sleepProof = 'LTV/CAC <b>' + ratio(eSleep.ltvCac) + '</b>, маржа/лид <b>' + money(eSleep.marginPerLead) + '</b>; использовать дешёвую реактивацию, без дорогой закупки.';

    return '<div class="ue2-card ue2-decision-board tone-' + tone + '">' +
      '<div class="ue2-card-head">' +
        '<span class="eyebrow">Управленческий вывод · решение по запуску</span>' +
        '<h2>Где «секс» экономики: Повторные + Просроченные через Router; Новые — только через квиз и CAC-лимит</h2>' +
      '</div>' +
      '<div class="ue2-decision-hero">' +
        '<div><span>Главное решение</span><b>' + esc(decision) + '</b></div>' +
      '</div>' +
      '<div class="ue2-decision-grid">' +
        card(segmentLight(eRepeat, th).tone, 'Удар №1 · Повторные', 'масштабировать первыми', 'Не отдавать сегмент автоматически в один канал: каждый повторный лид сравниваем Own vs CF и фиксируем победителя в Smart Safe Router.', repeatProof) +
        card(segmentLight(eOverdue, th).tone, 'Удар №2 · Просроченные', 'монетизировать, не списывать', 'Не пытаться продавить классическую выдачу. Отдельная ветка БФЛ/рефинанс/HR превращает «непроходной» поток в доход.', overdueProof) +
        card(segmentLight(eNew, th).tone, 'Новые', 'пилот под лимитами', 'Запускать не как широкий медиабюджет, а как управляемый тест квиза: режем CAC, повышаем CR и быстро отключаем неокупаемые источники.', newProof) +
        card(segmentLight(eSleep, th).tone, 'Спящие', 'дешёвая реактивация', 'Держать как low-cost CRM-контур: прогрев, обновление данных, возврат в квиз; платный трафик сюда не масштабировать.', sleepProof) +
      '</div>' +
    '</div>';
  }

  /* ---------- Матрица: плюсы / минусы каждого сегмента ---------- */
  var SEGMENT_NOTES = {
    new: {
      pros: ['Самый ёмкий рынок входящего трафика', 'Высокий потенциал LTV при удержании', 'Полная конверсия по основному EPL-офферу'],
      cons: ['Самый дорогой CAC', 'Retention 1 год ниже, чем у повторных', 'Чувствительность к качеству посадочной и квиза']
    },
    repeat: {
      pros: ['Дешёвый CAC (CRM-каналы)', 'Лучший Retention и cross-sell', 'Быстрая окупаемость когорты'],
      cons: ['Объём ограничен размером базы', 'Каннибализация органики при перегрузе push/email', 'Чувствителен к качеству оффера и тарифам партнёра']
    },
    overdue: {
      pros: ['Тёплый интент: ищут перекредитование/БФЛ', 'Высокий EPL у профильных партнёров (БФЛ)', 'Чёткий CJM-сценарий → стабильный Click-out'],
      cons: ['Подавляющая часть пользователей вне базы ЦФ — нужен Smart Safe Router', 'Низкий approval у банков, требуется CPA-витрина', 'Регуляторные риски при коммуникациях']
    },
    sleep: {
      pros: ['Минимальный CAC (push, email, retargeting)', 'Часть базы можно реактивировать без новых расходов', 'Хороший канал для тестов офферов'],
      cons: ['Ниже funnelMul и Retention — нужно «прогревать»', 'Низкая срочность интента → длиннее CJM', 'Часть базы выгорает, требует чистки']
    }
  };

  // Дополнительные «Плюсы» целевой модели (ТЗ-1 §3.3).
  var SEGMENT_NOTES_TOBE = {
    new: ['Оптимизация CAC за счёт квиза и более качественных источников'],
    repeat: ['Рост за счёт банков/CPA вместо бесплатной внутренней передачи'],
    overdue: ['Высокая маржинальность за счёт продажи лидов на БФЛ'],
    sleep: ['Рост за счёт дешёвой реактивации и CPA-кросс-сейла']
  };

  // Подпись Payback всегда показывает реальный расчётный срок, без подмены на «до 2 мес».
  function paybackDisplay(e) {
    return paybackText(e.payback);
  }

  function segmentMatrixHtml() {
    var cards = SEGMENTS.map(function (s) {
      var e = segmentEconomics(params, s.id);
      var t = ltvCacTone(e.ltvCac);
      var pTone = paybackTone(e.payback);
      var n = SEGMENT_NOTES[s.id];
      var prosArr = n.pros.slice();
      // В целевой модели сегменты с положительной маржей показывают рост от внедрения источников.
      var passed = currentMode === 'tobe' && e.marginPerLead > 0 && e.ltvCac >= 1;
      if (currentMode === 'tobe' && SEGMENT_NOTES_TOBE[s.id]) prosArr = SEGMENT_NOTES_TOBE[s.id].concat(prosArr);
      var pros = prosArr.map(function (x, i) {
        var hot = currentMode === 'tobe' && SEGMENT_NOTES_TOBE[s.id] && i < SEGMENT_NOTES_TOBE[s.id].length;
        return '<li' + (hot ? ' class="ue2-pro-hot"' : '') + '>' + esc(x) + '</li>';
      }).join('');
      var cons = n.cons.map(function (x) { return '<li>' + esc(x) + '</li>'; }).join('');
      var pTone2 = passed ? 'green' : pTone;
      
      var tag = '';
      if (params.isRouterActive) {
        var tStyle = 'font-size:10px; padding:2px 6px; border-radius:4px; ';
        if (s.id === 'new') {
          tag = '<div class="ue2-seg-tags" style="margin-bottom:8px; display:flex; gap:4px; flex-wrap:wrap;"><span class="ue2-tag tone-gray" style="' + tStyle + 'background:#f3f4f6;">[Внутренняя синергия с ЦФ]</span><span class="ue2-tag tone-blue" style="' + tStyle + 'background:var(--blue); color:#fff;">[Внешняя CPA-монетизация]</span></div>';
        } else if (s.id === 'repeat' || s.id === 'sleep') {
          tag = '<div class="ue2-seg-tags" style="margin-bottom:8px;"><span class="ue2-tag tone-green" style="' + tStyle + 'background:var(--green); color:#fff;">[Zero-Waste кросс-сейл]</span></div>';
        } else if (s.id === 'overdue') {
          tag = '<div class="ue2-seg-tags" style="margin-bottom:8px;"><span class="ue2-tag tone-orange" style="' + tStyle + 'background:var(--orange); color:#fff;">[Токсичный трафик → NPL монетизация]</span></div>';
        }
      }

      return '<div class="ue2-seg-card' + (passed ? ' is-target-green' : '') + '" style="--seg-accent:' + s.accent + '">' +
        tag + 
        '<div class="ue2-seg-head"><span class="ue2-seg-dot" style="background:' + s.accent + '"></span>' +
          '<h3>' + esc(s.name) + '</h3>' +
          (passed ? '<span class="ue2-seg-target-badge">рост</span>' : '') +
          '<span class="ue2-seg-share">' + pct(e.share) + ' трафика</span></div>' +
        '<div class="ue2-seg-metrics">' +
          '<div><span>LTV₂</span><b>' + money(e.ltv2) + '</b></div>' +
          '<div><span>CAC</span><b>' + money(e.cac) + '</b></div>' +
          '<div><span>LTV/CAC</span><b class="tone-' + t + '">' + ratio(e.ltvCac) + '</b></div>' +
          '<div><span>ROMI</span><b class="tone-' + (e.roi >= 0 ? 'green' : 'red') + '">' + pct(e.roi) + '</b></div>' +
          '<div><span>Payback</span><b class="tone-' + pTone2 + '">' + esc(paybackDisplay(e)) + '</b></div>' +
          '<div><span>CR лида → выдача</span><b>' + pct(e.crSegment * 100) + '</b></div>' +
        '</div>' +
        '<div class="ue2-seg-prosc">' +
          '<div class="ue2-seg-pros"><h5>Плюсы</h5><ul>' + pros + '</ul></div>' +
          '<div class="ue2-seg-cons"><h5>Минусы</h5><ul>' + cons + '</ul></div>' +
        '</div>' +
      '</div>';
    }).join('');
    return '<div class="ue2-card ue2-seg-grid-card">' +
      '<div class="ue2-card-head"><h2>Сегменты · выгоды и риски каждого</h2>' +
        '<p>Чекер через ЦФ — это <b>дополнительный</b> инструмент перенаправления трафика. Большая доля пользователей не находится в базе ЦФ, поэтому каждый сегмент остаётся ценным и не отсекается, а монетизируется через свой CJM-маршрут.</p></div>' +
      '<div class="ue2-seg-grid">' + cards + '</div>' +
    '</div>';
  }

  /* ================= ТАБ «Сценарий 10 000 пользователей» ================= */
  // Расчёт окупаемости на фиксированной базе привлечённого трафика N.
  // Работает в обоих режимах Toggle: p — это уже производные вводные активной модели.
  function scenario10k(p, N) {
    N = (isFinite(N) && N > 0) ? N : USERS_BASE;
    var totalShare = SEGMENTS.reduce(function (a, s) { return a + (p.seg[s.id].share || 0); }, 0) || 1;
    var rows = SEGMENTS.map(function (s) {
      var sp = p.seg[s.id];
      var e = segmentEconomics(p, s.id);
      var users = N * (sp.share || 0) / totalShare;
      var isBfl = sp.router === 'bfl' || (p.isRouterActive && s.id === 'overdue');
      // Лиды считаем по классической математике visit→lead; CR БФЛ применяется следующим шагом
      // и уже учтён в LTV лида, чтобы не занижать выручку двойным умножением.
      var leadCr = p.crVisitLead;
      var leads = users * leadCr / 100;
      // Промежуточные шаги воронки (для таблицы).
      var clickouts, issues;
      if (isBfl) {
        var bflLeadCr = (p.crLeadBfl !== undefined && p.crLeadBfl !== null) ? p.crLeadBfl : DEFAULT_PARAMS.crLeadBfl;
        clickouts = leads * bflLeadCr / 100;           // квал. БФЛ-лиды
        issues = clickouts;                            // квалифицированный лид = «выдача» дохода
      } else {
        var mulSqrt = Math.sqrt(sp.funnelMul || 1);
        clickouts = leads * (p.crLeadClickout / 100) * mulSqrt;
        issues = leads * e.crSegment; // = leads × CR_clickout × CR_issue × funnelMul
      }
      var revenue = leads * e.ltv2;             // выручка = лиды × доход на лида (LTV₂)
      var cacTotal = leads * e.cac;             // маркетинговый расход на привлечение
      var opexTotal = leads * p.opex;           // операционка на обработку лидов
      var margin = revenue - cacTotal - opexTotal;
      var romi = cacTotal > 0 ? margin / cacTotal * 100 : 0;
      return {
        seg: s, isBfl: isBfl, users: users, leads: leads, clickouts: clickouts, issues: issues,
        revenue: revenue, cacTotal: cacTotal, opexTotal: opexTotal, margin: margin, romi: romi,
        ltv2: e.ltv2, cac: e.cac, ltvCac: e.ltvCac, leadCr: leadCr
      };
    });
    var tot = rows.reduce(function (a, r) {
      a.users += r.users; a.leads += r.leads; a.clickouts += r.clickouts; a.issues += r.issues;
      a.revenue += r.revenue; a.cacTotal += r.cacTotal; a.opexTotal += r.opexTotal; a.margin += r.margin;
      return a;
    }, { users: 0, leads: 0, clickouts: 0, issues: 0, revenue: 0, cacTotal: 0, opexTotal: 0, margin: 0 });
    var spendTotal = tot.cacTotal + tot.opexTotal;
    var romiTotal = tot.cacTotal > 0 ? tot.margin / tot.cacTotal * 100 : 0;
    var k = blendedKpis(p);
    var arpu = N > 0 ? tot.revenue / N : 0;       // выручка на привлечённого пользователя
    var marginPerUser = N > 0 ? tot.margin / N : 0;
    // Точка безубыточности: во сколько раз нужно изменить blended CAC, чтобы маржа = 0.
    var cacBreakevenMult = tot.cacTotal > 0 ? (tot.revenue - tot.opexTotal) / tot.cacTotal : 0;
    return {
      N: N, rows: rows, tot: tot, spendTotal: spendTotal, romiTotal: romiTotal,
      blendedRatio: k.blendedRatio, arpu: arpu, marginPerUser: marginPerUser,
      cacBreakevenMult: cacBreakevenMult
    };
  }

  function scenarioTone(margin, ratio) {
    if (margin >= 0 && ratio > 2.5) return 'green';
    if (margin >= 0 || ratio >= 1) return 'yellow';
    return 'red';
  }

  function scenario10kHtml() {
    return '<div class="ue2-card ue2-scenario-card">' +
      '<div class="ue2-card-head ue2-row-between">' +
        '<div><h2>Сценарий на 10 000 пользователей</h2>' +
          '<p>Прогон фиксированной базы привлечённого трафика через юнит-экономику активной модели: ' +
          'визиты → лиды → клик-ауты → выдачи / квал. лиды → доход → расход (CAC + OPEX) → маржа → ROMI. ' +
          'Переключайте <b>As-Is / To-Be</b> сверху — видно, при каких цифрах экономика сходится.</p></div>' +
        '<label class="ue2-seg-select">База пользователей' +
          '<input type="number" id="ueScenarioN" class="ue2-num" min="100" max="10000000" step="100" value="' + scenarioUsers + '"></label>' +
      '</div>' +
      '<div id="ueScenarioBody">' + scenario10kBodyHtml() + '</div>' +
    '</div>';
  }

  function nfmt(n) { return Math.round(Number(n) || 0).toLocaleString('ru-RU'); }

  function scenario10kBodyHtml() {
    var r = scenario10k(params, scenarioUsers);
    var tone = scenarioTone(r.tot.margin, r.blendedRatio);
    var modeLabel = currentMode === 'tobe' ? 'Целевая · To-Be' : 'Текущая · As-Is';

    // --- Воронка на N (таблица) ---
    var funnelRows = r.rows.map(function (x) {
      return '<tr>' +
        '<td class="ue2-t-name"><span class="ue2-seg-dot" style="background:' + x.seg.accent + '"></span>' + esc(x.seg.name) +
          (x.isBfl ? ' <span class="ue2-bfl-tag">БФЛ</span>' : '') + '</td>' +
        '<td class="ue2-t-num">' + nfmt(x.users) + '</td>' +
        '<td class="ue2-t-num">' + nfmt(x.leads) + '<span class="ue2-t-sub">' + pct(x.leadCr) + '</span></td>' +
        '<td class="ue2-t-num">' + nfmt(x.clickouts) + '</td>' +
        '<td class="ue2-t-num">' + nfmt(x.issues) + (x.isBfl ? '<span class="ue2-t-sub">квал. лиды</span>' : '') + '</td>' +
        '<td class="ue2-t-num">' + money(x.revenue) + '</td>' +
      '</tr>';
    }).join('');
    var funnelTable =
      '<div class="ue2-scn-block"><h3>Воронка на ' + nfmt(r.N) + ' пользователей</h3>' +
      '<div class="ue2-table-wrap"><table class="ue2-scn-table">' +
        '<thead><tr><th>Сегмент</th><th>Визиты</th><th>Лиды</th><th>Клик-ауты</th><th>Выдачи / квал. лиды</th><th>Доход</th></tr></thead>' +
        '<tbody>' + funnelRows + '</tbody>' +
        '<tfoot><tr><td class="ue2-t-name">Итого</td>' +
          '<td class="ue2-t-num">' + nfmt(r.tot.users) + '</td>' +
          '<td class="ue2-t-num">' + nfmt(r.tot.leads) + '</td>' +
          '<td class="ue2-t-num">' + nfmt(r.tot.clickouts) + '</td>' +
          '<td class="ue2-t-num">' + nfmt(r.tot.issues) + '</td>' +
          '<td class="ue2-t-num">' + money(r.tot.revenue) + '</td></tr></tfoot>' +
      '</table></div></div>';

    // --- P&L на N (таблица) ---
    var pnlRows = r.rows.map(function (x) {
      return '<tr>' +
        '<td class="ue2-t-name"><span class="ue2-seg-dot" style="background:' + x.seg.accent + '"></span>' + esc(x.seg.name) + '</td>' +
        '<td class="ue2-t-num">' + money(x.revenue) + '</td>' +
        '<td class="ue2-t-num">' + money(x.cacTotal) + '</td>' +
        '<td class="ue2-t-num">' + money(x.opexTotal) + '</td>' +
        '<td class="ue2-t-num tone-' + (x.margin >= 0 ? 'green' : 'red') + '">' + money(x.margin) + '</td>' +
        '<td class="ue2-t-num tone-' + (x.romi >= 0 ? 'green' : 'red') + '">' + pct(x.romi) + '</td>' +
      '</tr>';
    }).join('');
    var pnlTable =
      '<div class="ue2-scn-block"><h3>P&amp;L на ' + nfmt(r.N) + ' пользователей · ' + modeLabel + '</h3>' +
      '<div class="ue2-table-wrap"><table class="ue2-scn-table">' +
        '<thead><tr><th>Сегмент</th><th>Доход</th><th>CAC</th><th>OPEX</th><th>Маржа</th><th>ROMI</th></tr></thead>' +
        '<tbody>' + pnlRows + '</tbody>' +
        '<tfoot><tr class="tone-' + tone + '"><td class="ue2-t-name">Итого</td>' +
          '<td class="ue2-t-num">' + money(r.tot.revenue) + '</td>' +
          '<td class="ue2-t-num">' + money(r.tot.cacTotal) + '</td>' +
          '<td class="ue2-t-num">' + money(r.tot.opexTotal) + '</td>' +
          '<td class="ue2-t-num tone-' + (r.tot.margin >= 0 ? 'green' : 'red') + '">' + money(r.tot.margin) + '</td>' +
          '<td class="ue2-t-num tone-' + (r.romiTotal >= 0 ? 'green' : 'red') + '">' + pct(r.romiTotal) + '</td></tr></tfoot>' +
      '</table></div></div>';

    // --- Сводные плитки ---
    var summary =
      '<div class="ue2-scn-tiles">' +
        scnTile('Выручка', money(r.tot.revenue), 'blue') +
        scnTile('Расходы (CAC + OPEX)', money(r.spendTotal), 'orange') +
        scnTile('Маржа', money(r.tot.margin), r.tot.margin >= 0 ? 'green' : 'red') +
        scnTile('ROMI', pct(r.romiTotal), r.romiTotal >= 0 ? 'green' : 'red') +
        scnTile('Blended LTV/CAC', ratio(r.blendedRatio), ltvCacTone(r.blendedRatio)) +
        scnTile('Маржа на пользователя', money1(r.marginPerUser), r.marginPerUser >= 0 ? 'green' : 'red') +
      '</div>';

    // --- Блок окупаемости ---
    var verdict = r.tot.margin >= 0 && r.blendedRatio > 2.5
      ? 'Сценарий окупается: маржа положительна, Blended LTV/CAC выше целевого порога (≥ 2.5x).'
      : (r.tot.margin >= 0
        ? 'Зона контроля: проект в плюсе, но Blended LTV/CAC ещё не достиг таргета 2.5x.'
        : 'Убыток: на базе ' + nfmt(r.N) + ' пользователей расходы превышают доход. Нужны рычаги To-Be.');
    var tobeDefaults = applyMode(DEFAULT_PARAMS, 'tobe');
    var tobeMix = [
      tobeDefaults.seg.repeat.share,
      tobeDefaults.seg.new.share,
      tobeDefaults.seg.overdue.share,
      tobeDefaults.seg.sleep.share
    ].join('/');
    var breakeven =
      '<div class="ue2-scn-block ue2-scn-breakeven tone-' + tone + '">' +
        '<h3>Точка безубыточности · при каких цифрах сходится</h3>' +
        '<p class="ue2-scn-verdict">' + verdict + '</p>' +
        '<ul class="ue2-scn-thresholds">' +
          '<li>Маржа = 0 при blended CAC ≈ <b>' + money(r.tot.leads > 0 ? (r.tot.revenue - r.tot.opexTotal) / r.tot.leads : 0) + '</b> на лида ' +
            '(текущий blended ≈ ' + money(r.tot.leads > 0 ? r.tot.cacTotal / r.tot.leads : 0) + ').</li>' +
          '<li>Допустимый рост CAC до нуля прибыли: <b>×' + (Number(r.cacBreakevenMult) || 0).toLocaleString('ru-RU', { maximumFractionDigits: 2 }) + '</b> от текущего.</li>' +
          '<li>Целевые рычаги To-Be: CR&nbsp;Visit→Lead Нового +' + pct(QUIZ_UPLIFT * 100) + ' (квиз) → CAC 1200→' + money(tobeDefaults.seg.new.cac) + '; ' +
            'EPL&nbsp;БФЛ ' + money(tobeDefaults.eplBfl) + ' при CR&nbsp;' + pct(tobeDefaults.crLeadBfl) + '; банковский/CPA-кросс ' + pct(tobeDefaults.crCrossBank) + '; Traffic&nbsp;Mix ' + tobeMix + ' → Blended&nbsp;LTV/CAC&nbsp;&gt;&nbsp;' + ratio(DEFAULT_THRESHOLDS.ltvCacGreen) + '.</li>' +
        '</ul>' +
      '</div>';

    // --- Оценка реалистичности ---
    var realism = scenarioRealismHtml();

    return summary + funnelTable + pnlTable + breakeven + realism;
  }

  function scnTile(label, val, tone) {
    return '<div class="ue2-scn-tile tone-' + tone + '">' +
      '<span class="ue2-scn-tile-label">' + esc(label) + '</span>' +
      '<span class="ue2-scn-tile-val">' + val + '</span></div>';
  }

  // Коридоры правдоподобности ключевых допущений (financial-marketplace mindset).
  function scenarioRealismHtml() {
    var checks = [
      { name: 'Квиз +20% к CR Visit→Lead', tone: 'green',
        note: 'Реалистично: интерактивный пред-скоринг типично даёт +15–30% к конверсии в лид.' },
      { name: 'CAC Нового 1200 → 700 ₽', tone: 'green',
        note: 'Достижимо за счёт роста CR при той же ставке закупки трафика.' },
      { name: 'CR лид → квал. БФЛ 35%', tone: 'yellow',
        note: 'Проверяется пилотом: тёплый интент на банкротство/рефинанс должен подтверждать высокий CR к квал. лиду.' },
      { name: 'EPL БФЛ 10 000 ₽ за лид', tone: 'yellow',
        note: 'Требует подтверждённого партнёрского источника и контроля качества лида.' },
      { name: 'Traffic Mix 40/30/20/10', tone: 'yellow',
        note: 'Требует зрелой CRM-базы: повторные 40% достижимы на горизонте 6–12 мес.' },
      { name: 'Downstream CR 80% (To-Be)', tone: 'yellow',
        note: 'Оптимистично: квиз-преквалификация поднимает клик-аут и выдачу, но проверять A/B.' }
    ];
    var items = checks.map(function (c) {
      return '<li class="ue2-real-item tone-' + c.tone + '">' +
        '<span class="ue2-real-dot"></span>' +
        '<span class="ue2-real-name">' + esc(c.name) + '</span>' +
        '<span class="ue2-real-note">' + esc(c.note) + '</span></li>';
    }).join('');
    return '<div class="ue2-scn-block ue2-scn-realism">' +
      '<h3>Оценка реалистичности допущений</h3>' +
      '<p>Светофор по «коридорам правдоподобности»: показывает, какие цифры арбитража/финмаркетплейса достижимы, а какие требуют проверки.</p>' +
      '<ul class="ue2-real-list">' + items + '</ul>' +
      '<div class="ue2-scn-scenarios">' +
        '<div class="ue2-scn-sc"><h5>Консервативный</h5><p>Только квиз (CAC↓). Просрочка в классике. Проект около нуля — Blended ≈ 1.0–1.4x.</p></div>' +
        '<div class="ue2-scn-sc"><h5>Базовый</h5><p>Квиз + Router БФЛ, Mix частично сдвинут. Blended ≈ 1.8–2.2x, маржа в плюсе.</p></div>' +
        '<div class="ue2-scn-sc ue2-scn-sc-target"><h5>Целевой (To-Be)</h5><p>Квиз + Router + Mix 40/30/20/10 + downstream-уплифт. Blended &gt; 2.5x, маржа уверенно положительна.</p></div>' +
      '</div>' +
    '</div>';
  }

  /* ---------- CJM-воронка с переключателем сегмента ---------- */
  function funnelCardHtml() {
    var opts = SEGMENTS.map(function (s) {
      return '<option value="' + s.id + '"' + (s.id === activeFunnelSeg ? ' selected' : '') + '>' + esc(s.name) + '</option>';
    }).join('');
    return '<div class="ue2-card ue2-funnel-card">' +
      '<div class="ue2-card-head ue2-row-between">' +
        '<div><h2>CJM-воронка сегмента</h2>' +
          '<p>Шаги, CTA и значения конверсии — из листов Excel «Выручай» для каждого сегмента.</p></div>' +
        '<label class="ue2-seg-select">Сегмент' +
          '<select id="ueFunnelSeg">' + opts + '</select></label>' +
      '</div>' +
      '<div id="ueFunnel"></div>' +
    '</div>';
  }

  function renderFunnel() {
    var host = document.getElementById('ueFunnel');
    if (!host) return;
    var segId = activeFunnelSeg;
    var steps = FUNNEL_STEPS[segId];
    var s = params.seg[segId];
    // 5 шагов: visits → quiz_start → leads → click-outs → выдачи
    // Считаем относительные доли. Принимаем 100 000 визитов сегмента как опорное значение.
    var visits = 100000;
    var quizStart = visits;                          // вход воронки = визит, далее CR Visit→Lead
    var leads = visits * (params.crVisitLead / 100);
    var clickouts = leads * (params.crLeadClickout / 100) * (s.funnelMul || 1);
    // funnelMul применяем равномерно к двум последним переходам через корень — чтобы суммарный
    // эффект совпадал с crSegment в расчётах LTV.
    var mulSqrt = Math.sqrt(s.funnelMul || 1);
    var clickouts2 = leads * (params.crLeadClickout / 100) * mulSqrt;
    var issues = clickouts2 * (params.crClickoutIssue / 100) * mulSqrt;
    var stages = [
      { val: visits,    crLabel: '100% база' },
      { val: leads,     crLabel: 'CR Visit→Lead · ' + pct(params.crVisitLead) },
      { val: clickouts2,crLabel: 'CR Lead→Click-out · ' + pct(params.crLeadClickout * mulSqrt) },
      { val: issues,    crLabel: 'CR Click-out→Выдача · ' + pct(params.crClickoutIssue * mulSqrt) }
    ];
    // У спецификации 5 «логических» шагов: ставим квиз = визит, и далее ↓.
    // Объединим логические лейблы с расчётными значениями.
    var values = [visits, visits, leads, clickouts2, issues];
    var maxV = Math.max.apply(null, values);
    var rowsHtml = steps.map(function (st, i) {
      var v = values[i];
      var w = Math.max(8, v / maxV * 100);
      var prev = i > 0 ? values[i - 1] : v;
      var conv = i > 0 ? (prev > 0 ? v / prev * 100 : 0) : 100;
      var convTxt = i === 0 ? '' : '<span class="ue2-funnel-conv">CR · ' + pct(conv) + '</span>';
      return '<div class="ue2-funnel-row">' +
        '<div class="ue2-funnel-meta">' +
          '<span class="ue2-funnel-step">' + esc(st.label) + '</span>' +
          '<span class="ue2-funnel-cta">CTA: ' + esc(st.cta) + '</span>' +
        '</div>' +
        '<div class="ue2-funnel-bar">' +
          '<div class="ue2-funnel-fill" style="width:' + w + '%">' + num(v) + '</div>' +
          convTxt +
        '</div>' +
      '</div>';
    }).join('');
    host.innerHTML = '<div class="ue2-funnel">' + rowsHtml + '</div>' +
      '<div class="ue2-funnel-foot">База расчёта · 100 000 визитов сегмента «' + esc(SEGMENTS.find(function(x){return x.id===segId;}).name) + '». Тексты CTA и шаги отличаются от других сегментов (см. CJM в Excel).</div>';
  }

  /* ---------- Когортный график накопленного LTV ---------- */
  function cohortCardHtml() {
    return '<div class="ue2-card ue2-cohort-card">' +
      '<div class="ue2-card-head"><h2>Когортный LTV · 2 года</h2>' +
        '<p>Накопленный LTV по сегментам против горизонтальной линии CAC. Точка пересечения линии сегмента с его пунктиром CAC — окупаемость когорты.</p></div>' +
      '<div id="ueCohort" class="ue2-chart-host"></div>' +
      '<div id="ueCohortLegend" class="ue2-legend"></div>' +
    '</div>';
  }

  function drawCohort() {
    var host = document.getElementById('ueCohort');
    if (!host) return;
    var W = 720, H = 320, padL = 60, padR = 22, padT = 18, padB = 36;
    var months = 24;
    var data = SEGMENTS.map(function (s) {
      var e = segmentEconomics(params, s.id);
      // три опорных точки: 0, 12, 24 → линейная интерполяция помесячно
      var pts = [];
      for (var m = 0; m <= months; m++) {
        var v;
        if (m === 0) v = 0;
        else if (m <= 12) v = e.ltv1 * (m / 12);
        else v = e.ltv1 + (e.ltv2 - e.ltv1) * ((m - 12) / 12);
        pts.push(v);
      }
      return { id: s.id, name: s.name, color: s.accent, pts: pts, cac: e.cac, ltv2: e.ltv2, payback: e.payback };
    });
    var allVals = data.reduce(function (a, d) { return a.concat(d.pts, [d.cac]); }, []);
    var maxV = Math.max.apply(null, allVals) * 1.05 || 1;
    var x = function (m) { return padL + m / months * (W - padL - padR); };
    var y = function (v) { return H - padB - v / maxV * (H - padT - padB); };

    var svg = '<svg viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="Когортный LTV против CAC">';
    svg += '<title>Когортный LTV против CAC</title>';
    // сетка
    for (var gi = 0; gi <= 4; gi++) {
      var gv = maxV * gi / 4;
      var gy = y(gv);
      svg += '<line x1="' + padL + '" y1="' + gy + '" x2="' + (W - padR) + '" y2="' + gy + '" stroke="var(--line)" stroke-width="1"/>';
      svg += '<text x="' + (padL - 8) + '" y="' + (gy + 4) + '" text-anchor="end" font-size="10" fill="var(--faint)">' + (gv >= 1000 ? Math.round(gv / 1000) + 'К ₽' : Math.round(gv) + ' ₽') + '</text>';
    }
    // оси X
    [0, 6, 12, 18, 24].forEach(function (m) {
      var label = m === 0 ? 'Мес 0' : (m === 12 ? 'Год 1' : (m === 24 ? 'Год 2' : 'Мес ' + m));
      svg += '<text x="' + x(m) + '" y="' + (H - padB + 18) + '" text-anchor="middle" font-size="10" fill="var(--faint)">' + label + '</text>';
    });
    svg += '<line x1="' + padL + '" y1="' + (H - padB) + '" x2="' + (W - padR) + '" y2="' + (H - padB) + '" stroke="var(--line-strong)" stroke-width="1"/>';

    // линии LTV и CAC по сегментам
    data.forEach(function (d) {
      var pts = d.pts.map(function (v, m) { return x(m) + ',' + y(v); }).join(' ');
      svg += '<polyline points="' + pts + '" fill="none" stroke="' + d.color + '" stroke-width="2.4" stroke-linejoin="round" stroke-linecap="round"/>';
      var cy = y(Math.min(d.cac, maxV));
      svg += '<line x1="' + padL + '" y1="' + cy + '" x2="' + (W - padR) + '" y2="' + cy + '" stroke="' + d.color + '" stroke-width="1.4" stroke-dasharray="5 5" opacity="0.65"/>';
      if (isFinite(d.payback) && d.payback <= months) {
        var mx = x(d.payback);
        svg += '<circle cx="' + mx + '" cy="' + cy + '" r="4.5" fill="' + d.color + '" stroke="#fff" stroke-width="1.5"/>';
      }
    });
    svg += '</svg>';
    host.innerHTML = svg;
    var legend = document.getElementById('ueCohortLegend');
    if (legend) {
      legend.innerHTML = data.map(function (d) {
        return '<span class="ue2-leg-item"><i style="background:' + d.color + '"></i>' + esc(d.name) +
          ' · LTV₂ ' + money(d.ltv2) + ' · CAC ' + money(d.cac) +
          ' · payback ' + paybackText(d.payback) + '</span>';
      }).join('');
    }
  }

  /* ---------- Waterfall · структура доходов и расходов на лид ---------- */
  function waterfallCardHtml() {
    return '<div class="ue2-card ue2-waterfall-card">' +
      '<div class="ue2-card-head ue2-row-between">' +
        '<div><h2>Структура доходов и расходов на 1 лид</h2>' +
          '<p>EPL + Cross-sell − OPEX − RevShare − CAC × (CR лид→выдача) = Маржа на выданный кредит. Положительные бары — доходы, отрицательные — расходы.</p></div>' +
        '<label class="ue2-seg-select">Сегмент' +
          '<select id="ueWaterSeg">' +
            SEGMENTS.map(function (s) { return '<option value="' + s.id + '"' + (s.id === activeFunnelSeg ? ' selected' : '') + '>' + esc(s.name) + '</option>'; }).join('') +
          '</select></label>' +
      '</div>' +
      '<div id="ueWaterfall" class="ue2-chart-host"></div>' +
    '</div>';
  }

  function drawWaterfall() {
    var host = document.getElementById('ueWaterfall');
    if (!host) return;
    var p = params;
    var segId = activeFunnelSeg;
    var s = p.seg[segId];
    var crSegment = (p.crLeadClickout / 100) * (p.crClickoutIssue / 100) * (s.funnelMul || 1);
    // На одного «лида» считаем ожидаемую маржу. EPL и Cross-sell реализуются только при выдаче,
    // поэтому масштабируем их на crSegment. CAC распределён на всех лидов (CAC*crSegment ≈ CAC на выдачу).
    var epl = p.epl * crSegment;
    var crossRev = (p.crCross / 100) * p.crossEpl * crSegment;
    var grossRev = epl + crossRev;
    var revShareCost = grossRev * (p.revShare / 100);
    var opex = p.opex;
    var cacPerLead = s.cac * crSegment; // CAC, проецированный на ожидание выдачи с лида
    var profit = grossRev - revShareCost - opex - cacPerLead;

    var items = [
      { label: 'EPL', value: epl, type: 'pos' },
      { label: 'Cross-sell', value: crossRev, type: 'pos' },
      { label: 'RevShare', value: -revShareCost, type: 'neg' },
      { label: 'OPEX', value: -opex, type: 'neg' },
      { label: 'CAC (доля)', value: -cacPerLead, type: 'neg' },
      { label: 'Profit', value: profit, type: 'total' }
    ];

    var W = 720, H = 300, padL = 70, padR = 24, padT = 20, padB = 50;
    var n = items.length;
    var bw = (W - padL - padR) / n - 14;
    var cumul = 0;
    // диапазон Y по накопительной сумме
    var path = [0];
    items.forEach(function (it, i) {
      if (it.type === 'total') path.push(it.value);
      else { cumul += it.value; path.push(cumul); }
    });
    var ymax = Math.max.apply(null, path.concat([0])) * 1.1 || 1;
    var ymin = Math.min.apply(null, path.concat([0])) * 1.1;
    if (ymin >= 0) ymin = -ymax * 0.15;
    var span = ymax - ymin;
    var y = function (v) { return padT + (ymax - v) / span * (H - padT - padB); };

    var svg = '<svg viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="Водопад маржи на лид">';
    svg += '<title>Водопад P&L на 1 лид</title>';
    // нулевая ось
    var y0 = y(0);
    svg += '<line x1="' + padL + '" y1="' + y0 + '" x2="' + (W - padR) + '" y2="' + y0 + '" stroke="var(--line-strong)" stroke-width="1"/>';
    // подписи Y
    for (var gi = 0; gi <= 4; gi++) {
      var gv = ymin + span * gi / 4;
      var gy = y(gv);
      svg += '<line x1="' + padL + '" y1="' + gy + '" x2="' + (W - padR) + '" y2="' + gy + '" stroke="var(--line)" stroke-width="1" opacity="0.6"/>';
      svg += '<text x="' + (padL - 8) + '" y="' + (gy + 4) + '" text-anchor="end" font-size="10" fill="var(--faint)">' + Math.round(gv) + ' ₽</text>';
    }
    cumul = 0;
    items.forEach(function (it, i) {
      var cx = padL + i * (bw + 14) + 7;
      var top, bottom, color;
      if (it.type === 'total') {
        top = y(Math.max(0, it.value));
        bottom = y(Math.min(0, it.value));
        color = it.value >= 0 ? 'var(--blue)' : 'var(--red)';
      } else if (it.type === 'pos') {
        top = y(cumul + it.value);
        bottom = y(cumul);
        color = 'var(--green)';
        cumul += it.value;
      } else {
        top = y(cumul);
        bottom = y(cumul + it.value);
        color = 'var(--red)';
        cumul += it.value;
      }
      var height = Math.max(2, bottom - top);
      svg += '<rect x="' + cx + '" y="' + top + '" width="' + bw + '" height="' + height + '" fill="' + color + '" rx="4" opacity="0.92"/>';
      var labelY = it.value >= 0 ? (top - 6) : (bottom + 14);
      svg += '<text x="' + (cx + bw / 2) + '" y="' + labelY + '" text-anchor="middle" font-size="11" font-weight="700" fill="' + color + '">' +
        (it.value > 0 ? '+' : '') + Math.round(it.value) + ' ₽</text>';
      svg += '<text x="' + (cx + bw / 2) + '" y="' + (H - padB + 16) + '" text-anchor="middle" font-size="11" fill="var(--muted)">' + esc(it.label) + '</text>';
    });
    svg += '</svg>';
    host.innerHTML = svg +
      '<div class="ue2-waterfall-foot">Сегмент <b>' + esc(SEGMENTS.find(function(x){return x.id===segId;}).name) +
      '</b> · ожидаемая маржа на лид <b class="tone-' + (profit >= 0 ? 'green' : 'red') + '">' + money1(profit) + '</b>' +
      ' · CR лида→выдача <b>' + pct(crSegment * 100) + '</b></div>';
  }

  function drawCharts() { renderFunnel(); drawCohort(); drawWaterfall(); }

  /* ---------- Итоговая записка ---------- */
  function summaryHtml() {
    var k = blendedKpis(params);
    var best = k.perSeg.slice().sort(function (a, b) { return b.ltvCac - a.ltvCac; })[0];
    var worst = k.perSeg.slice().sort(function (a, b) { return a.ltvCac - b.ltvCac; })[0];
    return '<div class="ue2-card ue2-summary-card">' +
      '<div class="ue2-card-head"><h2>Итог</h2>' +
        '<p>Краткая выжимка: каждый сегмент сохраняем, но управляем долями и CAC, чтобы Blended LTV/CAC удерживать выше 3.0.</p></div>' +
      '<ul class="ue2-summary-list">' +
        '<li><b>Лучший сегмент по LTV/CAC:</b> ' + esc(best.name) + ' (' + ratio(best.ltvCac) + ', payback ' + paybackText(best.payback) + ').</li>' +
        '<li><b>Самый требовательный сегмент:</b> ' + esc(worst.name) + ' (' + ratio(worst.ltvCac) + '). Нужен Smart Safe Router и CPA-витрина для тех, кого нет в базе ЦФ.</li>' +
        '<li><b>Blended LTV/CAC:</b> ' + ratio(k.blendedRatio) + ' при таргете &gt; 3.0 · Blended CAC ' + money(k.blendedCac) + ' · Avg ARPU ' + money(k.avgArpu) + '.</li>' +
        '<li><b>Окупаемость когорты:</b> ' + paybackText(k.payback) + (k.paybackHasInf ? ' (часть сегментов не окупается — следите за CAC и Retention).' : '.') + '</li>' +
      '</ul>' +
    '</div>';
  }

  /* ============================== СОБЫТИЯ ============================== */

  /* ====================== ТЗ-расширения: пресеты, светофор, A/B, инсайты, объяснение ====================== */

  // ---- Пресеты + слоты пользовательских сценариев + кнопка «Как считаем?» ----
  function presetBarHtml() {
    var slots = loadSlots();
    var cmp = loadCompare();
    var slotOpts = function (selected) {
      return '<option value="">— нет —</option>' +
        slots.map(function (s) { return '<option value="' + esc(s.id) + '"' + (selected === s.id ? ' selected' : '') + '>' + esc(s.name) + '</option>'; }).join('');
    };
    var slotChips = slots.length
      ? slots.map(function (s) { return '<span class="ue2-slot-chip"><b>' + esc(s.name) + '</b><button type="button" data-ue-load-slot="' + esc(s.id) + '">загрузить</button><button type="button" data-ue-del-slot="' + esc(s.id) + '" title="Удалить">×</button></span>'; }).join('')
      : '<span class="ue2-muted">Пока нет сохранённых сценариев. Сохраните текущий, чтобы быстро сравнивать варианты.</span>';

    return '<div class="ue2-card ue2-preset-bar">' +
      '<div class="ue2-card-head ue2-row-between">' +
        '<div><h2>Лаборатория сценариев</h2>' +
          '<p>Пресеты, сохранённые сценарии и сравнение бок о бок. Все изменения применяются мгновенно (&lt; 300 мс) — без перезагрузки страницы.</p></div>' +
        '<div class="ue2-preset-actions">' +
          PRESETS.map(function (p) { return '<button class="ue2-preset-btn" type="button" data-ue-preset="' + p.id + '">' + esc(p.name) + '</button>'; }).join('') +
          '<button class="ue2-preset-btn primary" type="button" id="ueExplainOpen">Как считаем?</button>' +
        '</div>' +
      '</div>' +
      '<div class="ue2-slot-row">' +
        '<input class="ue2-slot-name" id="ueSlotName" type="text" placeholder="Имя сценария (макс. 5 слотов)" maxlength="40">' +
        '<button class="ue2-preset-btn" type="button" id="ueSlotSave">Сохранить как сценарий</button>' +
        '<button class="ue2-preset-btn" type="button" id="ueCompareToggle">Split-view: сравнить два сценария</button>' +
      '</div>' +
      '<div class="ue2-slot-chips">' + slotChips + '</div>' +
      '<div class="ue2-compare-row">' +
        '<label>Сценарий A <select id="ueCmpA">' + slotOpts(cmp.a) + '</select></label>' +
        '<label>Сценарий B <select id="ueCmpB">' + slotOpts(cmp.b) + '</select></label>' +
      '</div>' +
    '</div>';
  }

  // ---- Карточки сегментов со светофором, RPL / Margin / LTV/CAC / Payback / ROMI (ТЗ §2.4.1-2) ----
  function tzSegmentLightHtml() {
    var k = blendedKpis(params);
    var th = loadThresholds();
    var cards = k.perSeg.map(function (e) {
      var lt = segmentLight(e, th);
      return '<div class="ue2-tz-card tone-' + lt.tone + '">' +
        '<div class="ue2-tz-head"><span class="ue2-tz-dot tone-' + lt.tone + '"></span>' +
          '<h3>' + esc(e.name) + '</h3>' +
          '<span class="ue2-tz-status tone-' + lt.tone + '">' + esc(lt.label) + '</span></div>' +
        '<div class="ue2-tz-metrics">' +
          '<div><span>Доход на лида (RPL)</span><b>' + money(e.rpl) + '</b></div>' +
          '<div><span>Маржа на лида</span><b class="tone-' + (e.marginPerLead > 0 ? 'green' : 'red') + '">' + money(e.marginPerLead) + '</b></div>' +
          '<div><span>LTV / CAC</span><b class="tone-' + ltvCacTone(e.ltvCac) + '">' + ratio(e.ltvCac) + '</b></div>' +
          '<div><span>Payback</span><b class="tone-' + paybackTone(e.payback) + '">' + paybackText(e.payback) + '</b></div>' +
          '<div><span>ROMI</span><b class="tone-' + (e.roi >= 0 ? 'green' : 'red') + '">' + pct(e.roi) + '</b></div>' +
          '<div><span>CAC</span><b>' + money(e.cac) + '</b></div>' +
        '</div>' +
      '</div>';
    }).join('');
    return '<div class="ue2-card">' +
      '<div class="ue2-card-head ue2-row-between">' +
        '<div><h2>Сегменты · решение по каждому каналу</h2>' +
          '<p>Маржа на лида, LTV/CAC, окупаемость — основа решения «масштабировать / контролировать / ремонтировать». Пороги настраиваются в боковой панели.</p></div>' +
        '<div class="ue2-thresh-mini">Масштабируем при LTV/CAC ≥ <b>' + th.ltvCacGreen + '</b> и Payback ≤ <b>' + th.paybackGreenMax + '</b> мес.</div>' +
      '</div>' +
      '<div class="ue2-tz-grid">' + cards + '</div>' +
    '</div>';
  }

  // ---- Бар-чарт RPL/Margin per Lead со светофорной заливкой (ТЗ §2.6) ----
  function rplBarChartHtml() {
    var k = blendedKpis(params);
    var th = loadThresholds();
    var maxV = Math.max(1, Math.max.apply(null, k.perSeg.map(function (e) { return Math.max(Math.abs(e.rpl), Math.abs(e.marginPerLead)); })));
    var rows = k.perSeg.map(function (e) {
      var lt = segmentLight(e, th);
      var rplW = Math.max(2, Math.abs(e.rpl) / maxV * 100);
      var mgW = Math.max(2, Math.abs(e.marginPerLead) / maxV * 100);
      var mgTone = e.marginPerLead > 0 ? 'green' : 'red';
      return '<div class="ue2-bar-row tone-' + lt.tone + '">' +
        '<div class="ue2-bar-name">' + esc(e.name) + '</div>' +
        '<div class="ue2-bar-group">' +
          '<div class="ue2-bar-label">RPL: ' + money(e.rpl) + '</div>' +
          '<div class="ue2-bar-track"><div class="ue2-bar-fill tone-' + lt.tone + '" style="width:' + rplW + '%"></div></div>' +
        '</div>' +
        '<div class="ue2-bar-group">' +
          '<div class="ue2-bar-label">Margin/Lead: ' + money(e.marginPerLead) + '</div>' +
          '<div class="ue2-bar-track"><div class="ue2-bar-fill tone-' + mgTone + '" style="width:' + mgW + '%"></div></div>' +
        '</div>' +
      '</div>';
    }).join('');
    return '<div class="ue2-card">' +
      '<div class="ue2-card-head"><h2>RPL vs Margin per Lead по сегментам</h2>' +
        '<p>Заливка — цвет светофора сегмента. Маржа красная, если &lt; 0.</p></div>' +
      '<div class="ue2-bar-chart">' + rows + '</div>' +
    '</div>';
  }

  // ---- A/B для повторных: Центр Финансов vs Своя монетизация (ТЗ §2.5) ----
  function repeatABHtml() {
    var ab = loadRepeatAB();
    var r = repeatAB(params, ab);
    var maxV = Math.max(Math.abs(r.marginA), Math.abs(r.marginB), 1);
    var wA = Math.max(4, Math.abs(r.marginA) / maxV * 100);
    var wB = Math.max(4, Math.abs(r.marginB) / maxV * 100);
    var winnerText = r.winner === 'A'
      ? 'При текущих параметрах выгоднее маршрут <b>Центр Финансов</b>: ΔМаржа = ' + money(r.delta) + ' на лида. Одобренные ЦФ дают 0 ₽, но доход формируют отказники через Soft Reject МФО (доход маршрута A: ' + money(r.revenueA) + ').'
      : 'При текущих параметрах выгоднее <b>Своя монетизация</b>: ΔМаржа = ' + money(r.delta) + ' на лида.';
    return '<div class="ue2-card ue2-repeat-ab">' +
      '<div class="ue2-card-head"><h2>Повторные · «Центр Финансов» vs «Своя монетизация»</h2>' +
        '<p>Сравнение маржи A/B на той же когорте повторных. Решение можно зафиксировать в Smart Safe Router (вкладка «CJM»).</p></div>' +
      '<div class="ue2-ab-grid">' +
        '<div class="ue2-ab-side' + (r.winner === 'A' ? ' is-winner' : '') + '">' +
          '<h4>A · Передача в Центр Финансов</h4>' +
          '<div class="ue2-ab-fields">' +
            '<div class="ue2-ab-static" title="Одобренные ЦФ — внутренний маршрут без выручки Выручай.ру; доход даёт только Soft Reject отказников">Выдача ЦФ: <b>' + money(CF_EXTERNAL_REVENUE) + '</b> · Soft Reject МФО: <b>' + money(r.revenueA) + '</b></div>' +
            '<label>Одобрение ЦФ, % <input type="number" min="0" max="100" step="0.5" data-ue-ab="cfApproval" value="' + ab.cfApproval + '"></label>' +
          '</div>' +
          '<div class="ue2-ab-margin">Маржа на лида: <b class="tone-' + (r.marginA >= 0 ? 'green' : 'red') + '">' + money(r.marginA) + '</b></div>' +
        '</div>' +
        '<div class="ue2-ab-side' + (r.winner === 'B' ? ' is-winner' : '') + '">' +
          '<h4>B · Своя монетизация</h4>' +
          '<div class="ue2-ab-fields">' +
            '<label>AOV, ₽ <input type="number" min="0" step="100" data-ue-ab="ownAov" value="' + ab.ownAov + '"></label>' +
            '<label>Маржинальность, % <input type="number" min="0" max="100" step="0.5" data-ue-ab="ownMargin" value="' + ab.ownMargin + '"></label>' +
            '<label>Сервис на лид, ₽ <input type="number" min="0" step="10" data-ue-ab="ownServiceCost" value="' + ab.ownServiceCost + '"></label>' +
            '<label>Повторных сделок/год <input type="number" min="0" step="0.1" data-ue-ab="repeatOrders" value="' + ab.repeatOrders + '"></label>' +
          '</div>' +
          '<div class="ue2-ab-margin">Маржа на лида: <b class="tone-' + (r.marginB >= 0 ? 'green' : 'red') + '">' + money(r.marginB) + '</b></div>' +
        '</div>' +
      '</div>' +
      '<div class="ue2-ab-bars">' +
        '<div class="ue2-ab-bar"><span>A · ЦФ</span><div class="ue2-bar-track"><div class="ue2-bar-fill tone-' + (r.marginA >= 0 ? 'green' : 'red') + '" style="width:' + wA + '%"></div></div><b>' + money(r.marginA) + '</b></div>' +
        '<div class="ue2-ab-bar"><span>B · Своя</span><div class="ue2-bar-track"><div class="ue2-bar-fill tone-' + (r.marginB >= 0 ? 'green' : 'red') + '" style="width:' + wB + '%"></div></div><b>' + money(r.marginB) + '</b></div>' +
      '</div>' +
      '<div class="ue2-ab-winner">' + winnerText + '</div>' +
      '<table class="ue2-ab-table"><thead><tr><th>Параметр</th><th>A · ЦФ</th><th>B · Своя</th></tr></thead>' +
        '<tbody>' +
          '<tr><td>Маржа на лида</td><td>' + money(r.marginA) + '</td><td>' + money(r.marginB) + '</td></tr>' +
          '<tr><td>Доход</td><td>' + money(r.revenueA) + ' <span class="ue2-t-sub">Soft Reject МФО с отказников ЦФ; выдача ЦФ = 0 ₽</span></td><td>' + money(ab.ownAov * (ab.ownMargin / 100) * ab.repeatOrders) + '</td></tr>' +
          '<tr><td>Издержки</td><td>0 ₽ сервис; CAC остаётся альтернативной стоимостью</td><td>' + money(ab.ownServiceCost) + ' (сервис)</td></tr>' +
          '<tr><td>CAC (общий)</td><td>' + money(params.seg.repeat.cac) + '</td><td>' + money(params.seg.repeat.cac) + '</td></tr>' +
        '</tbody>' +
      '</table>' +
      '<div class="ue2-ab-foot">' +
        '<button class="ue2-preset-btn primary" type="button" id="ueRouterFix">Зафиксировать решение в Smart Safe Router</button>' +
        '<span class="ue2-muted">Запишет выбор Own/CF в правила маршрутизации (используется на вкладке CJM).</span>' +
      '</div>' +
    '</div>';
  }

  // ---- Блок «Выводы» — автоинсайты (ТЗ §2.4.3) ----
  function insightsHtml() {
    var k = blendedKpis(params);
    var th = loadThresholds();
    var rules = loadInsightsRules();
    var items = compileInsights(k, th, rules);
    var list = items.map(function (it) {
      var tag = it.scope === 'portfolio' ? '<span class="ue2-ins-tag">портфель</span>' : '<span class="ue2-ins-tag">' + esc(it.name || '') + '</span>';
      return '<li>' + tag + ' ' + it.text + '</li>';
    }).join('');
    return '<div class="ue2-card">' +
      '<div class="ue2-card-head ue2-row-between">' +
        '<div><h2>Выводы · auto-insights</h2>' +
          '<p>Текст формируется по правилам из JSON-конфига. Каждый сегмент получает минимум 1 рекомендацию + 1 общий вывод по портфелю.</p></div>' +
        '<button class="ue2-preset-btn" type="button" id="ueInsightsEdit">Изменить правила (JSON)</button>' +
      '</div>' +
      '<ul class="ue2-insights">' + list + '</ul>' +
    '</div>';
  }

  // ---- Split-view: сравнение двух сохранённых сценариев ----
  function compareSplitHtml() {
    var cmp = loadCompare();
    var slots = loadSlots();
    if (!cmp.a || !cmp.b) return '';
    var a = slots.find(function (s) { return s.id === cmp.a; });
    var b = slots.find(function (s) { return s.id === cmp.b; });
    if (!a || !b) return '';
    var kA = blendedKpis(a.params);
    var kB = blendedKpis(b.params);
    var th = loadThresholds();
    function colHtml(name, k) {
      var perSeg = k.perSeg.map(function (e) {
        var lt = segmentLight(e, th);
        return '<tr><td>' + esc(e.name) + '</td><td><span class="ue2-tz-dot tone-' + lt.tone + '"></span></td><td>' + money(e.rpl) + '</td><td>' + money(e.marginPerLead) + '</td><td>' + ratio(e.ltvCac) + '</td><td>' + pct(e.roi) + '</td><td>' + paybackText(e.payback) + '</td></tr>';
      }).join('');
      return '<div class="ue2-cmp-col"><h3>' + esc(name) + '</h3>' +
        '<div class="ue2-cmp-kpis">' +
          '<div>Blended CAC: <b>' + money(k.blendedCac) + '</b></div>' +
          '<div>Avg ARPU: <b>' + money(k.avgArpu) + '</b></div>' +
          '<div>LTV/CAC: <b class="tone-' + ltvCacTone(k.blendedRatio) + '">' + ratio(k.blendedRatio) + '</b></div>' +
          '<div>Payback: <b>' + paybackText(k.payback) + '</b></div>' +
        '</div>' +
        '<table class="ue2-cmp-table"><thead><tr><th>Сегмент</th><th>Статус</th><th>RPL</th><th>Margin</th><th>LTV/CAC</th><th>ROMI</th><th>Payback</th></tr></thead><tbody>' + perSeg + '</tbody></table>' +
      '</div>';
    }
    return '<div class="ue2-card ue2-cmp-card">' +
      '<div class="ue2-card-head"><h2>Split-view · сравнение сценариев</h2>' +
        '<p>Выберите два сохранённых сценария в верхней панели — таблица обновится автоматически.</p></div>' +
      '<div class="ue2-cmp-grid">' + colHtml(a.name, kA) + colHtml(b.name, kB) + '</div>' +
    '</div>';
  }

  // ---- Модалка «Как считаем?» (ТЗ §2.3) ----
  function explainModalHtml() {
    return '<div id="ueExplainModal" class="ue-modal" hidden>' +
      '<div class="ue-modal-backdrop" data-ue-explain-close></div>' +
      '<div class="ue-modal-card ue2-explain-card" role="dialog" aria-modal="true" aria-labelledby="ueExplainTitle">' +
        '<div class="ue-modal-head">' +
          '<h3 id="ueExplainTitle">Как считаем? · прозрачный алгоритм</h3>' +
          '<div class="ue2-explain-actions">' +
            '<label class="ue2-seg-select">Сегмент <select id="ueExplainSeg">' +
              SEGMENTS.map(function (s) { return '<option value="' + s.id + '">' + esc(s.name) + '</option>'; }).join('') +
            '</select></label>' +
            '<button class="ue2-preset-btn" type="button" id="ueExplainPng">Экспорт PNG</button>' +
            '<button class="ue-modal-x" type="button" data-ue-explain-close>Закрыть</button>' +
          '</div>' +
        '</div>' +
        '<div id="ueExplainBody" class="ue2-explain-body"></div>' +
      '</div>' +
    '</div>';
  }

  function renderExplainBody(segId) {
    var body = document.getElementById('ueExplainBody');
    if (!body) return;
    var c = cohortBreakdown(params, segId);
    var fmtN = function (v) { return Math.round(v).toLocaleString('ru-RU'); };
    var formulas = [
      ['RPL (Revenue per Lead)', 'Σ выручки сегмента ÷ число лидов'],
      ['Маржа на лида', 'RPL − CAC − COGS_на_лида'],
      ['LTV',  'LTV₀ + LTV₁·(1−d) + LTV₂·(1−d)² (когортно)'],
      ['CAC', 'Затраты на привлечение ÷ число привлечённых лидов'],
      ['ROMI', '(Маржа − CAC × лиды) ÷ (CAC × лиды) × 100%'],
      ['Payback (мес.)', 'Месяц, в котором накопленный LTV покрывает CAC']
    ];
    var formulasHtml = '<table class="ue2-explain-tbl"><thead><tr><th>Метрика</th><th>Формула</th></tr></thead><tbody>' +
      formulas.map(function (f) { return '<tr><td>' + esc(f[0]) + '</td><td>' + esc(f[1]) + '</td></tr>'; }).join('') +
    '</tbody></table>';

    var stepRows = [
      ['1. База когорты', fmtN(c.leads) + ' лидов', 'Эталонная когорта по ТЗ — 1 000 лидов'],
      ['2. × CR Lead→Click-out (' + c.cr1.toFixed(1) + '%)', fmtN(c.clickouts) + ' click-out', 'CR с поправкой funnelMul сегмента'],
      ['3. × CR Click-out→Выдача (' + c.cr2.toFixed(1) + '%)', fmtN(c.issues) + ' выдач', 'CR с поправкой funnelMul'],
      ['4. × Gross EPL (' + fmtN(c.gross) + ' ₽)', fmtN(c.grossRevenue) + ' ₽ валовая выручка', 'EPL + cross-sell'],
      ['5. − Rev Share (' + c.revShare + '%)', '−' + fmtN(c.revShareCost) + ' ₽', 'Доля партнёра'],
      ['6. − OPEX (' + fmtN(c.opex) + ' ₽ × ' + fmtN(c.leads) + ' лидов)', '−' + fmtN(c.opexCost) + ' ₽', 'Операционные издержки'],
      ['7. = Net Revenue', fmtN(c.netRevenue) + ' ₽', 'Чистая выручка когорты'],
      ['8. − CAC (' + fmtN(c.cac) + ' ₽ × ' + fmtN(c.leads) + ' лидов)', '−' + fmtN(c.cacTotal) + ' ₽', 'Стоимость привлечения когорты'],
      ['9. = Маржа когорты', fmtN(c.marginTotal) + ' ₽', 'Net Revenue − CAC'],
      ['10. ROMI', c.romi.toFixed(1) + '%', 'Маржа ÷ CAC_total × 100%'],
      ['11. RPL', fmtN(c.rplCohort) + ' ₽', 'Net Revenue ÷ 1 000 лидов'],
      ['12. Маржа на лида', fmtN(c.marginPerLead) + ' ₽', 'Маржа когорты ÷ 1 000 лидов']
    ];
    var stepsHtml = '<table class="ue2-explain-tbl ue2-explain-steps"><thead><tr><th>Шаг</th><th>Значение</th><th>Источник параметра</th></tr></thead><tbody>' +
      stepRows.map(function (r) { return '<tr><td>' + esc(r[0]) + '</td><td><b>' + esc(r[1]) + '</b></td><td class="ue2-muted">' + esc(r[2]) + '</td></tr>'; }).join('') +
    '</tbody></table>';

    body.innerHTML =
      '<p class="ue-modal-sub">Сегмент: <b>' + esc(c.segName) + '</b>. Пример пересчитывается при изменении любого ползунка — это и есть «прозрачный алгоритм».</p>' +
      '<h4>Формулы</h4>' + formulasHtml +
      '<h4>Пошаговый расчёт на эталонной когорте 1 000 лидов</h4>' + stepsHtml +
      '<p class="ue2-muted">Источники: вводные «Общие метрики» и «Метрики воронки» (ручной ввод дашборда, по ТЗ — CRM/ручной ввод/CJM).</p>';
  }

  // Экспорт модалки в PNG (ТЗ §2.3.3) через SVG → canvas → PNG.
  function exportExplainPng() {
    var card = document.querySelector('#ueExplainModal .ue-modal-card');
    if (!card) return;
    // Сериализуем HTML модалки в SVG foreignObject, затем рисуем на canvas.
    var rect = card.getBoundingClientRect();
    var w = Math.ceil(rect.width), h = Math.ceil(rect.height);
    var clone = card.cloneNode(true);
    // Уберём кнопки экспорта/закрытия из клонированного скриншота.
    clone.querySelectorAll('button,.ue-modal-x').forEach(function (b) { b.remove(); });
    var style = '';
    try {
      // Соберём базовые стили текста, чтобы PNG выглядел читабельно (минимально).
      style = 'body,div,table,h3,h4,p,td,th,b,span{font-family:"Golos Text",-apple-system,Segoe UI,Roboto,sans-serif;color:#111}' +
        'table{border-collapse:collapse;width:100%;font-size:12px}td,th{border:1px solid #ddd;padding:6px 8px;text-align:left}' +
        'h3,h4{margin:8px 0}.ue-modal-card{padding:18px;background:#fff}';
    } catch (e) {}
    var html =
      '<svg xmlns="http://www.w3.org/2000/svg" width="' + w + '" height="' + h + '">' +
        '<foreignObject width="100%" height="100%">' +
          '<div xmlns="http://www.w3.org/1999/xhtml"><style>' + style + '</style>' + clone.outerHTML + '</div>' +
        '</foreignObject>' +
      '</svg>';
    var blob = new Blob([html], { type: 'image/svg+xml;charset=utf-8' });
    var url = URL.createObjectURL(blob);
    var img = new Image();
    img.onload = function () {
      try {
        var canvas = document.createElement('canvas');
        canvas.width = w * 2; canvas.height = h * 2;
        var ctx = canvas.getContext('2d');
        ctx.fillStyle = '#fff';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.setTransform(2, 0, 0, 2, 0, 0);
        ctx.drawImage(img, 0, 0);
        canvas.toBlob(function (b) {
          var a = document.createElement('a');
          a.href = URL.createObjectURL(b);
          a.download = 'ue-explain-' + new Date().toISOString().slice(0, 10) + '.png';
          document.body.appendChild(a); a.click(); a.remove();
          URL.revokeObjectURL(a.href); URL.revokeObjectURL(url);
        }, 'image/png');
      } catch (err) {
        // Fallback: если canvas заблокирован (CORS/foreignObject), скачиваем SVG.
        var a2 = document.createElement('a');
        a2.href = url;
        a2.download = 'ue-explain-' + new Date().toISOString().slice(0, 10) + '.svg';
        document.body.appendChild(a2); a2.click(); a2.remove();
      }
    };
    img.onerror = function () { URL.revokeObjectURL(url); alert('Не удалось сформировать PNG. SVG-копия скачана.'); };
    img.src = url;
  }

  // ---- Доп. секция сайдбара: пороги светофора (ТЗ §2.4.2) ----
  function thresholdsSidebarHtml() {
    var th = loadThresholds();
    return '<div class="ue2-side-group">' +
      '<h4>Пороги светофора</h4>' +
      '<div class="ue2-slider"><div class="ue2-slider-head"><label>LTV/CAC «зелёный» <span class="ue2-unit">≥</span></label>' +
        '<input type="number" class="ue2-num" data-ue-thresh="ltvCacGreen" min="1" max="10" step="0.1" value="' + th.ltvCacGreen + '"></div></div>' +
      '<div class="ue2-slider"><div class="ue2-slider-head"><label>Payback «зелёный» <span class="ue2-unit">≤ мес.</span></label>' +
        '<input type="number" class="ue2-num" data-ue-thresh="paybackGreenMax" min="1" max="36" step="1" value="' + th.paybackGreenMax + '"></div></div>' +
      '<div class="ue2-slider"><div class="ue2-slider-head"><label>Payback «жёлтый» <span class="ue2-unit">≤ мес.</span></label>' +
        '<input type="number" class="ue2-num" data-ue-thresh="paybackYellowMax" min="1" max="60" step="1" value="' + th.paybackYellowMax + '"></div></div>' +
    '</div>';
  }

  /* ====================== СОБЫТИЯ ====================== */

  function setParam(path, value) {
    var v = Number(value);
    if (!isFinite(v)) return;
    if (path.indexOf('seg.') === 0) {
      var parts = path.split('.');
      var sid = parts[1], field = parts[2];
      if (!baseParams.seg[sid]) return;
      baseParams.seg[sid][field] = v;
    } else {
      baseParams[path] = v;
    }
    save(baseParams);
  }

  function partialRefresh() {
    // Пересчитываем производные вводные активной модели и перерисовываем только панель таба
    // (без сайдбара, чтобы не терять фокус ползунков).
    refreshViewParams();
    var panel = document.getElementById('ueTabPanel');
    if (!panel) return;
    // Модебар содержит blended-метрику — её тоже надо освежить.
    var modebar = document.querySelector('#ueLab .ue2-modebar');
    if (modebar) modebar.outerHTML = modeToggleHtml();
    panel.innerHTML = tabPanelHtml(activeTab);
    wireMainOnly();
    drawCharts();
  }

  function wireMainOnly() {
    // Переключатель модели As-Is / To-Be
    document.querySelectorAll('#ueLab [data-ue-mode]').forEach(function (b) {
      b.addEventListener('click', function () {
        var m = b.getAttribute('data-ue-mode') === 'tobe' ? 'tobe' : 'asis';
        if (m === currentMode) return;
        currentMode = m; saveMode(m);
        render();
      });
    });
    // Лента табов (клик + клавиатура)
    var tabBtns = Array.prototype.slice.call(document.querySelectorAll('#ueLab [data-ue-tab]'));
    function activateTab(id) {
      if (id === activeTab) return;
      activeTab = id; saveTab(id);
      document.querySelectorAll('#ueLab [data-ue-tab]').forEach(function (x) {
        var on = x.getAttribute('data-ue-tab') === id;
        x.classList.toggle('is-active', on);
        x.setAttribute('aria-selected', on);
        x.tabIndex = on ? 0 : -1;
      });
      refreshViewParams();
      var panel = document.getElementById('ueTabPanel');
      if (panel) panel.innerHTML = tabPanelHtml(activeTab);
      wireMainOnly();
      drawCharts();
    }
    tabBtns.forEach(function (b, i) {
      b.addEventListener('click', function () { activateTab(b.getAttribute('data-ue-tab')); });
      b.addEventListener('keydown', function (e) {
        var idx = i;
        if (e.key === 'ArrowRight' || e.key === 'ArrowDown') { idx = (i + 1) % tabBtns.length; }
        else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') { idx = (i - 1 + tabBtns.length) % tabBtns.length; }
        else if (e.key === 'Home') { idx = 0; }
        else if (e.key === 'End') { idx = tabBtns.length - 1; }
        else if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); activateTab(b.getAttribute('data-ue-tab')); return; }
        else { return; }
        e.preventDefault();
        tabBtns[idx].focus();
        activateTab(tabBtns[idx].getAttribute('data-ue-tab'));
      });
    });
    // Калькулятор сценария на 10 000 пользователей
    var nInp = document.getElementById('ueScenarioN');
    if (nInp) nInp.addEventListener('input', function () {
      var v = Math.round(Number(nInp.value));
      if (!isFinite(v) || v < 100) v = 100;
      if (v > 10000000) v = 10000000;
      scenarioUsers = v;
      var body = document.getElementById('ueScenarioBody');
      if (body) body.innerHTML = scenario10kBodyHtml();
    });
    var fs = document.getElementById('ueFunnelSeg');
    if (fs) fs.addEventListener('change', function () {
      activeFunnelSeg = fs.value;
      var ws = document.getElementById('ueWaterSeg'); if (ws) ws.value = activeFunnelSeg;
      renderFunnel(); drawWaterfall();
    });
    var ws = document.getElementById('ueWaterSeg');
    if (ws) ws.addEventListener('change', function () {
      activeFunnelSeg = ws.value;
      var fs2 = document.getElementById('ueFunnelSeg'); if (fs2) fs2.value = activeFunnelSeg;
      renderFunnel(); drawWaterfall();
    });
    wireTzControls();
  }

  // Привязка только A/B-карты повторных (вход + кнопка фиксации решения). Вынесено отдельно,
  // чтобы перерисовывать карту точечно и не терять фокус ввода при наборе значений.
  function wireAbControls() {
    document.querySelectorAll('#ueLab [data-ue-ab]').forEach(function (inp) {
      inp.addEventListener('input', function () {
        var ab = loadRepeatAB();
        var k = inp.getAttribute('data-ue-ab');
        var v = Number(inp.value);
        if (isFinite(v)) ab[k] = v;
        saveRepeatAB(ab);
        refreshAbCard(k);
      });
    });
    // Зафиксировать решение A/B в роутере (ТЗ §2.5.2 + §3.3.4)
    var rfix = document.getElementById('ueRouterFix');
    if (rfix) rfix.addEventListener('click', function () {
      var r = repeatAB(params);
      try {
        var route = r.winner === 'A' ? 'CJM.Repeat.CF' : 'CJM.Repeat.Own';
        localStorage.setItem('ssr_repeat_decision_v1', JSON.stringify({
          winner: r.winner, route: route, marginA: r.marginA, marginB: r.marginB, ts: Date.now()
        }));
        // Уведомим вкладку CJM, если она открыта
        if (typeof window !== 'undefined' && typeof window.dispatchEvent === 'function') {
          window.dispatchEvent(new CustomEvent('ssr-repeat-decision', { detail: { winner: r.winner, route: route } }));
        }
        rfix.textContent = 'Решение зафиксировано (' + route + ')';
        setTimeout(function () { rfix.textContent = 'Зафиксировать решение в Smart Safe Router'; }, 2200);
      } catch (e) {}
    });
  }

  // Точечная перерисовка только A/B-карты. Сохраняет фокус и позицию каретки в редактируемом
  // поле, поэтому пользователь может вводить многозначные числа без потери выделения.
  function refreshAbCard(focusKey) {
    var card = document.querySelector('#ueLab .ue2-repeat-ab');
    if (!card) { partialRefresh(); return; }
    var active = document.activeElement;
    var key = focusKey || (active && active.getAttribute ? active.getAttribute('data-ue-ab') : null);
    var selStart = null, selEnd = null;
    if (active && key && typeof active.selectionStart === 'number') {
      selStart = active.selectionStart; selEnd = active.selectionEnd;
    }
    var wrap = document.createElement('div');
    wrap.innerHTML = repeatABHtml();
    var fresh = wrap.firstChild;
    card.parentNode.replaceChild(fresh, card);
    wireAbControls();
    if (key) {
      var el = document.querySelector('#ueLab [data-ue-ab="' + key + '"]');
      if (el) {
        el.focus();
        if (selStart != null) { try { el.setSelectionRange(selStart, selEnd); } catch (e) {} }
      }
    }
  }

  // Привязка управлений новых ТЗ-блоков (пресеты, слоты, A/B, инсайты, объяснение).
  function wireTzControls() {
    // Пресеты
    document.querySelectorAll('[data-ue-preset]').forEach(function (b) {
      b.addEventListener('click', function () {
        var kind = b.getAttribute('data-ue-preset');
        baseParams = kind === 'base' ? deepCopy(DEFAULT_PARAMS) : presetParams(kind);
        save(baseParams); render();
      });
    });
    // Сохранение слотов
    var saveBtn = document.getElementById('ueSlotSave');
    if (saveBtn) saveBtn.addEventListener('click', function () {
      var name = (document.getElementById('ueSlotName') || {}).value || '';
      name = String(name).trim();
      if (!name) { alert('Введите имя сценария.'); return; }
      var slots = loadSlots();
      if (slots.length >= 5) { alert('Достигнут лимит 5 слотов. Удалите ненужный.'); return; }
      slots.push({ id: 'sl-' + Date.now().toString(36), name: name, params: deepCopy(baseParams), ts: Date.now() });
      saveSlots(slots); partialRefresh();
    });
    document.querySelectorAll('[data-ue-load-slot]').forEach(function (b) {
      b.addEventListener('click', function () {
        var slots = loadSlots();
        var s = slots.find(function (x) { return x.id === b.getAttribute('data-ue-load-slot'); });
        if (!s) return;
        baseParams = mergeParams(deepCopy(DEFAULT_PARAMS), s.params);
        save(baseParams); render();
      });
    });
    document.querySelectorAll('[data-ue-del-slot]').forEach(function (b) {
      b.addEventListener('click', function () {
        var id = b.getAttribute('data-ue-del-slot');
        saveSlots(loadSlots().filter(function (x) { return x.id !== id; }));
        partialRefresh();
      });
    });
    // Split-view (сравнение)
    var cmpA = document.getElementById('ueCmpA');
    var cmpB = document.getElementById('ueCmpB');
    function applyCmp() { saveCompare({ a: cmpA ? cmpA.value : '', b: cmpB ? cmpB.value : '' }); partialRefresh(); }
    if (cmpA) cmpA.addEventListener('change', applyCmp);
    if (cmpB) cmpB.addEventListener('change', applyCmp);
    var cmpToggle = document.getElementById('ueCompareToggle');
    if (cmpToggle) cmpToggle.addEventListener('click', function () {
      var slots = loadSlots();
      if (slots.length < 2) { alert('Сохраните минимум 2 сценария, чтобы сравнить их бок о бок.'); return; }
      var cmp = loadCompare();
      if (!cmp.a) cmp.a = slots[0].id;
      if (!cmp.b) cmp.b = slots[Math.min(1, slots.length - 1)].id;
      saveCompare(cmp); partialRefresh();
    });
    // Пороги светофора
    document.querySelectorAll('[data-ue-thresh]').forEach(function (inp) {
      inp.addEventListener('input', function () {
        var th = loadThresholds();
        var k = inp.getAttribute('data-ue-thresh');
        var v = Number(inp.value);
        if (isFinite(v)) th[k] = v;
        saveThresholds(th); partialRefresh();
      });
    });
    // A/B повторных
    wireAbControls();
    // Правила выводов (JSON-редактор)
    var insBtn = document.getElementById('ueInsightsEdit');
    if (insBtn) insBtn.addEventListener('click', function () {
      var current = JSON.stringify(loadInsightsRules(), null, 2);
      var next = prompt('Правила автовыводов (JSON). Поля when: ltvCacGte, ltvCacLt, romiGte, romiLt, paybackGt, marginLte, blendedLtvCacGte, blendedLtvCacLt. Плейсхолдеры в тексте: {name},{romi},{ltvCac},{payback},{margin},{rpl},{cac},{blendedRatio},{blendedCac},{avgArpu}.', current);
      if (next == null) return;
      try {
        var parsed = JSON.parse(next);
        if (!Array.isArray(parsed)) throw new Error('Ожидается массив правил.');
        saveInsightsRules(parsed); partialRefresh();
      } catch (err) { alert('Невалидный JSON: ' + err.message); }
    });
    // Модалка «Как считаем?»
    var open = document.getElementById('ueExplainOpen');
    var modal = document.getElementById('ueExplainModal');
    if (open && modal) open.addEventListener('click', function () {
      modal.hidden = false;
      var sel = document.getElementById('ueExplainSeg');
      var segId = sel && sel.value ? sel.value : 'new';
      renderExplainBody(segId);
    });
    if (modal) modal.querySelectorAll('[data-ue-explain-close]').forEach(function (c) {
      c.addEventListener('click', function () { modal.hidden = true; });
    });
    var selExp = document.getElementById('ueExplainSeg');
    if (selExp) selExp.addEventListener('change', function () { renderExplainBody(selExp.value); });
    var png = document.getElementById('ueExplainPng');
    if (png) png.addEventListener('click', exportExplainPng);
  }

  function wire() {
    // Синхронизация ползунков и числовых полей по data-ue-param.
    document.querySelectorAll('#ueLab [data-ue-param]').forEach(function (inp) {
      inp.addEventListener('input', function () {
        var key = inp.getAttribute('data-ue-param');
        // обновляем парный input (range ↔ number) в той же строке
        var row = inp.closest('.ue2-slider');
        if (row) row.querySelectorAll('[data-ue-param="' + key + '"]').forEach(function (peer) {
          if (peer !== inp) peer.value = inp.value;
        });
        setParam(key, inp.value);
        partialRefresh();
      });
    });
    var reset = document.getElementById('ueResetParams');
    if (reset) reset.addEventListener('click', function () {
      baseParams = deepCopy(DEFAULT_PARAMS);
      save(baseParams);
      render();
    });
    wireMainOnly();
  }

  /* ============================== INIT ============================== */
  function init() {
    var host = document.getElementById('ueLab');
    if (!host) return;
    // Активируем модуль только если контейнер помечен как segments-v2.
    if (host.dataset.source !== 'segments-v2') return;
    render();
    // Перерисовываем SVG при изменении темы / переключении на вкладку.
    window.addEventListener('resize', function () {
      clearTimeout(window.__ueResizeT);
      window.__ueResizeT = setTimeout(drawCharts, 120);
    });
    var themeBtn = document.getElementById('themeToggle');
    if (themeBtn) themeBtn.addEventListener('click', function () {
      requestAnimationFrame(drawCharts);
    });
    var unitTab = document.querySelector('.tab[data-tab="unit"]');
    if (unitTab) unitTab.addEventListener('click', function () { requestAnimationFrame(drawCharts); });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
