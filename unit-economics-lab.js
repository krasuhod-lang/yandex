/*
 * Юнит-экономика · штаб принятия решений (B2B full-stack)
 * Самодостаточный модуль: не зависит от CJM-слоя dashboard-app.js и не меняет его.
 * Считает маркетинговый и полный CAC, срок окупаемости, LTV с оттоком, воронку, точку
 * безубыточности, симулятор «Что, если…», таблицу чувствительности и локальный
 * детерминированный ИИ-аналитик отклонений План/Факт.
 */
(function () {
  'use strict';

  var STORE_FACT = 'ue_lab_fact_v1';
  var STORE_PLAN = 'ue_lab_plan_v1';

  // Фактические вводные (значения по умолчанию — типовой B2B-кейс).
  var DEFAULT_FACT = {
    traffic: 85000,   // визиты в месяц
    cpc: 18,          // ₽ за клик
    c1: 3.5,          // % сайт → лид
    c2: 22,           // % лид → сделка
    salesCycle: 45,   // дней
    salesFix: 240000, // ₽/мес фикс. ФОТ продаж
    salesBonus: 5,    // % бонуса от суммы сделки
    crm: 30000,       // ₽/мес лицензии CRM
    telephony: 15000, // ₽/мес телефония
    avgCheck: 18000,  // ₽ средний чек сделки
    arpu: 9000,       // ₽/мес выручка с клиента
    cogs: 3000,       // ₽/мес себестоимость обслуживания
    churn: 6          // % клиентов в месяц
  };

  // Плановые значения ключевых метрик (модальное окно «Задать план»).
  var DEFAULT_PLAN = {
    traffic: 100000,
    cpl: 450,
    c1: 4.0,
    fullCAC: 2800,
    unitMargin: 320,
    churn: 5
  };

  var fact = load(STORE_FACT, DEFAULT_FACT);
  var plan = load(STORE_PLAN, DEFAULT_PLAN);

  // Состояние симулятора (оверрайды поверх факта).
  var sim = freshSim();
  function freshSim() {
    return { dC1: 0, dC2: 0, checkMul: 1, cplMul: 1, churnAbs: null, arpuMul: 1 };
  }

  /* ----------------------------- утилиты ----------------------------- */
  function load(key, fallback) {
    try {
      var raw = localStorage.getItem(key);
      if (!raw) return Object.assign({}, fallback);
      var obj = JSON.parse(raw);
      return Object.assign({}, fallback, obj);
    } catch (e) { return Object.assign({}, fallback); }
  }
  function save(key, obj) { try { localStorage.setItem(key, JSON.stringify(obj)); } catch (e) {} }
  function num(n) { return Math.round(Number(n) || 0).toLocaleString('ru-RU'); }
  function money(n) { return num(n) + ' ₽'; }
  function money1(n) {
    var v = Number(n) || 0;
    return v.toLocaleString('ru-RU', { maximumFractionDigits: 1 }) + ' ₽';
  }
  function pct(n) { return (Number(n) || 0).toLocaleString('ru-RU', { maximumFractionDigits: 1 }) + '%'; }
  function esc(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function clamp(v, a, b) { return Math.min(b, Math.max(a, v)); }
  // Карточка в стиле дашборда (единый шрифт/радиусы/тени).
  function card(title, sub, body) {
    return '<div class="card ue-card"><div class="card-title"><div><h3>' + esc(title) + '</h3>' +
      (sub ? '<p>' + esc(sub) + '</p>' : '') + '</div></div>' + body + '</div>';
  }

  /* --------------------------- модель расчёта --------------------------- */
  // Считает все метрики из набора вводных (опционально с оверрайдами симулятора).
  function compute(f, ov) {
    ov = ov || {};
    var c1 = clamp((Number(f.c1) || 0) + (ov.dC1 || 0), 0, 100);
    var c2 = clamp((Number(f.c2) || 0) + (ov.dC2 || 0), 0, 100);
    var cpc = (Number(f.cpc) || 0) * (ov.cplMul || 1);
    var avgCheck = (Number(f.avgCheck) || 0) * (ov.checkMul || 1);
    var arpu = (Number(f.arpu) || 0) * (ov.arpuMul || 1);
    var cogs = Number(f.cogs) || 0;
    var churn = (ov.churnAbs != null ? ov.churnAbs : (Number(f.churn) || 0));
    churn = clamp(churn, 0.1, 100);

    var traffic = Number(f.traffic) || 0;
    var budget = traffic * cpc;                 // маркетинговый расход, ₽/мес
    var leads = traffic * c1 / 100;
    var deals = leads * c2 / 100;               // новые клиенты
    var cpl = leads > 0 ? budget / leads : 0;

    var salesBonus = deals * avgCheck * (Number(f.salesBonus) || 0) / 100;
    var salesCosts = (Number(f.salesFix) || 0) + salesBonus + (Number(f.crm) || 0) + (Number(f.telephony) || 0);

    var marketingCAC = deals > 0 ? budget / deals : 0;
    var fullCAC = deals > 0 ? (budget + salesCosts) / deals : 0;

    var contribMonthly = arpu - cogs;           // вклад клиента в месяц
    var grossMargin = arpu > 0 ? contribMonthly / arpu * 100 : 0;
    var payback = contribMonthly > 0 ? fullCAC / contribMonthly : Infinity;
    var ltv = churn > 0 ? contribMonthly / (churn / 100) : 0;
    var unitMargin = ltv - fullCAC;
    var romi = fullCAC > 0 ? unitMargin / fullCAC * 100 : 0;

    return {
      traffic: traffic, cpc: cpc, c1: c1, c2: c2, budget: budget, leads: leads, deals: deals,
      cpl: cpl, salesBonus: salesBonus, salesCosts: salesCosts, avgCheck: avgCheck,
      arpu: arpu, cogs: cogs, churn: churn, contribMonthly: contribMonthly, grossMargin: grossMargin,
      marketingCAC: marketingCAC, fullCAC: fullCAC, payback: payback, ltv: ltv,
      unitMargin: unitMargin, romi: romi
    };
  }

  function paybackTone(p) {
    if (!isFinite(p)) return 'red';
    if (p < 6) return 'green';
    if (p <= 12) return 'yellow';
    return 'red';
  }
  function paybackText(p) { return isFinite(p) ? p.toLocaleString('ru-RU', { maximumFractionDigits: 1 }) + ' мес.' : 'не окупается'; }

  /* ------------------------------- рендер ------------------------------- */
  var aiTimer = null;

  function render() {
    var host = document.getElementById('ueLab');
    if (!host) return;
    var m = compute(fact);

    host.innerHTML =
      inputsHtml(m) +
      resultHtml(m) +
      funnelHtml(m) +
      breakevenHtml(m) +
      simulatorHtml(m) +
      planFactHtml(m) +
      aiPanelHtml();

    wireInputs();
    wireSimulator(m);
    wirePlanFact();
    renderSimOutputs(m);   // первичный расчёт симулятора
    scheduleAi(false);     // ИИ при первой загрузке — сразу
  }

  /* --- блок вводных, сгруппированный по секциям --- */
  function inputCell(key, label, unit, val, step) {
    return '<div class="ue-cell ue-input">' +
      '<label>' + esc(label) + (unit ? ' <span class="ue-unit">' + esc(unit) + '</span>' : '') + '</label>' +
      '<input type="number" inputmode="decimal" data-ue-fact="' + key + '" value="' + esc(val) +
      '" step="' + (step || 'any') + '" min="0" autocomplete="off"></div>';
  }
  function calcCell(label, unit, valHtml, tone) {
    return '<div class="ue-cell ue-calc' + (tone ? ' ' + tone : '') + '">' +
      '<label>' + esc(label) + (unit ? ' <span class="ue-unit">' + esc(unit) + '</span>' : '') + '</label>' +
      '<div class="ue-calc-box">' + valHtml + '</div></div>';
  }

  function inputsHtml(m) {
    var mkt =
      '<div class="ue-section ue-sec-mkt"><div class="ue-section-head"><span class="ue-sh-title">Маркетинг</span><span class="ue-sh-note">привлечение трафика</span></div>' +
      '<div class="ue-grid">' +
      inputCell('traffic', 'Трафик', 'визиты/мес', fact.traffic, 1000) +
      inputCell('cpc', 'CPC', '₽/клик', fact.cpc, 1) +
      calcCell('Бюджет', '₽/мес', money(m.budget)) +
      calcCell('CPL', '₽/лид', money1(m.cpl)) +
      '</div><div class="ue-edit-note">Редактируйте только <b>жёлтые</b> поля — серые ячейки пересчитываются по формулам.</div></div>';

    var sales =
      '<div class="ue-section ue-sec-sales"><div class="ue-section-head"><span class="ue-sh-title">Продажи</span><span class="ue-sh-note">воронка и затраты отдела</span></div>' +
      '<div class="ue-grid">' +
      inputCell('c1', 'Конверсия C1', '% сайт→лид', fact.c1, 0.1) +
      inputCell('c2', 'Конверсия C2', '% лид→сделка', fact.c2, 0.5) +
      calcCell('Лиды', 'в месяц', num(m.leads)) +
      calcCell('Сделки', 'клиентов/мес', num(m.deals)) +
      inputCell('salesCycle', 'Цикл сделки', 'дней', fact.salesCycle, 1) +
      inputCell('salesFix', 'Фикс. ФОТ продаж', '₽/мес', fact.salesFix, 5000) +
      inputCell('salesBonus', 'Бонус', '% от сделки', fact.salesBonus, 0.5) +
      inputCell('crm', 'Лицензии CRM', '₽/мес', fact.crm, 1000) +
      inputCell('telephony', 'Телефония', '₽/мес', fact.telephony, 1000) +
      calcCell('Бонусы продаж', '₽/мес', money(m.salesBonus)) +
      '</div><div class="ue-edit-note">Редактируйте только <b>жёлтые</b> поля.</div></div>';

    var gmTone = m.grossMargin > 0 ? 'is-pos' : 'is-bad';
    var econ =
      '<div class="ue-section ue-sec-econ"><div class="ue-section-head"><span class="ue-sh-title">Экономика</span><span class="ue-sh-note">чек, маржа, удержание</span></div>' +
      '<div class="ue-grid">' +
      inputCell('avgCheck', 'Средний чек', '₽/сделка', fact.avgCheck, 1000) +
      inputCell('arpu', 'ARPU', '₽/мес', fact.arpu, 500) +
      inputCell('cogs', 'Себестоимость', '₽/мес', fact.cogs, 500) +
      inputCell('churn', 'Отток (Churn)', '%/мес', fact.churn, 0.5) +
      calcCell('Валовая маржа', '%', pct(m.grossMargin), gmTone) +
      calcCell('Вклад клиента', '₽/мес', money(m.contribMonthly), m.contribMonthly > 0 ? 'is-pos' : 'is-bad') +
      calcCell('LTV', '₽', money(m.ltv), m.ltv > 0 ? 'is-pos' : 'is-bad') +
      '</div><div class="ue-edit-note">Редактируйте только <b>жёлтые</b> поля. LTV = (ARPU × Валовая маржа) ÷ Отток.</div></div>';

    return '<div class="grid two" style="grid-template-columns:1fr;gap:16px">' + mkt + sales + econ + '</div>';
  }

  /* --- секция «Итог»: KPI-карточки + предупреждения --- */
  function kpiCard(label, value, sub, tone, badge) {
    return '<div class="ue-kpi tone-' + tone + '">' +
      '<span class="ue-kpi-label">' + esc(label) + '</span>' +
      '<span class="ue-kpi-value">' + value + '</span>' +
      (badge ? '<span class="ue-badge ' + badge.tone + '">' + esc(badge.text) + '</span>' : '') +
      (sub ? '<span class="ue-kpi-sub">' + sub + '</span>' : '') +
      '</div>';
  }

  function resultHtml(m) {
    var pTone = paybackTone(m.payback);
    var umTone = m.unitMargin >= 0 ? 'green' : 'red';
    var romiTone = m.romi >= 0 ? 'green' : 'red';
    var fullExceeds = m.fullCAC > m.marketingCAC * 1.5;

    var kpis =
      kpiCard('Маркетинговый CAC', money(m.marketingCAC), 'только маркетинговый бюджет ÷ сделки', 'blue') +
      kpiCard('Полный CAC', money(m.fullCAC), 'маркетинг + ФОТ + бонусы + CRM + телефония', fullExceeds ? 'red' : 'blue',
        fullExceeds ? { tone: 'red', text: 'операционка искажает' } : null) +
      kpiCard('Срок окупаемости', paybackText(m.payback), 'Полный CAC ÷ вклад клиента в месяц', pTone,
        { tone: pTone, text: pTone === 'green' ? 'до 6 мес.' : pTone === 'yellow' ? '6–12 мес.' : 'дольше 12 мес.' }) +
      kpiCard('LTV', money(m.ltv), 'выручка с клиента за весь срок', 'blue') +
      kpiCard('Юнит-маржа', money(m.unitMargin), 'LTV − Полный CAC на одного клиента', umTone) +
      kpiCard('ROMI', pct(m.romi), 'Юнит-маржа ÷ Полный CAC', romiTone);

    var warns = '';
    if (fullExceeds) {
      warns += '<div class="ue-warn-row"><span class="ue-warn-dot"></span>Операционные затраты на продажи искажают экономику: Полный CAC (' +
        money(m.fullCAC) + ') превышает Маркетинговый CAC (' + money(m.marketingCAC) + ') более чем в 1,5 раза.</div>';
    }
    if (m.payback > 12) {
      warns += '<div class="ue-warn-row"><span class="ue-warn-dot"></span>Срок окупаемости ' + paybackText(m.payback) +
        ' — клиент возвращает затраты слишком долго. Нужен оборотный капитал на кассовый разрыв.</div>';
    }
    if (Number(fact.churn) > 10) {
      warns += '<div class="ue-warn-row tone-warn"><span class="ue-warn-dot"></span>Отток ' + pct(fact.churn) +
        ' в месяц критически снижает LTV. Внедрите онбординг-цепочку в первые 30 дней.</div>';
    }
    if (Number(fact.salesCycle) > 60) {
      var d = new Date(); d.setDate(d.getDate() + Number(fact.salesCycle));
      warns += '<div class="ue-warn-row tone-warn"><span class="ue-warn-dot"></span>Цикл сделки ' + num(fact.salesCycle) +
        ' дней: расходы этого месяца отобьются только к ' + d.toLocaleDateString('ru-RU') +
        '. Убедитесь в наличии оборотного капитала.</div>';
    }

    return '<div class="ue-section ue-sec-result"><div class="ue-section-head"><span class="ue-sh-title">Итог</span><span class="ue-sh-note">ключевые метрики и светофор</span></div>' +
      '<div style="padding:18px;display:flex;flex-direction:column;gap:14px">' +
      '<div class="ue-kpi-grid">' + kpis + '</div>' +
      (warns ? warns : '') +
      '</div></div>';
  }

  /* --- воронка с подсветкой узкого места --- */
  function funnelHtml(m) {
    var maxV = Math.max(m.traffic, 1);
    var h = function (v) { return Math.max(40, Math.round(v / maxV * 150)); };
    var bottleneck = m.c1 <= m.c2 ? 1 : 2; // 1 = переход C1, 2 = переход C2
    var bar = function (val, name, isBottle) {
      return '<div class="ue-funnel-bar' + (isBottle ? ' is-bottleneck' : '') + '">' +
        '<div class="ue-funnel-fill" style="height:' + h(val) + 'px">' + num(val) + '</div>' +
        '<div class="ue-funnel-name">' + esc(name) + '</div></div>';
    };
    var arrow = function (label, isBottle) {
      return '<div class="ue-funnel-arrow"><span class="ue-conv-badge' + (isBottle ? ' is-bottleneck' : '') + '">' + label + '</span><span>→</span></div>';
    };
    var note = bottleneck === 1
      ? 'Узкое место — конверсия сайт→лид (C1 ' + pct(m.c1) + '). Работайте над посадочными и оффером.'
      : 'Узкое место — конверсия лид→сделка (C2 ' + pct(m.c2) + '). Работайте над квалификацией и отделом продаж.';

    return card('Воронка привлечения', 'Трафик → Лиды → Сделки. Самый узкий переход подсвечен как узкое место.',
      '<div class="ue-funnel">' +
      bar(m.traffic, 'Трафик', false) +
      arrow('C1 ' + pct(m.c1), bottleneck === 1) +
      bar(m.leads, 'Лиды', bottleneck === 1) +
      arrow('C2 ' + pct(m.c2), bottleneck === 2) +
      bar(m.deals, 'Сделки', bottleneck === 2) +
      '</div><div class="ue-bottleneck-note">' + esc(note) + '</div>');
  }

  /* --- график окупаемости когорты (SVG) --- */
  function breakevenHtml(m) {
    return card('Точка окупаемости когорты',
      'Накопленная прибыль с клиента по месяцам против горизонтальной линии Полный CAC. Пересечение — срок окупаемости.',
      '<div class="ue-chart-host" id="ueBreakeven">' + breakevenSvg(m) + '</div>' +
      '<div class="ue-legend"><span><i style="border-color:var(--green)"></i>Накопленный вклад клиента</span>' +
      '<span><i style="border-color:var(--red);border-top-style:dashed"></i>Полный CAC (константа)</span></div>');
  }

  function breakevenSvg(m) {
    var W = 720, H = 280, padL = 64, padR = 20, padT = 18, padB = 34;
    var months = 24;
    var contrib = m.contribMonthly;
    var maxCum = Math.max(contrib * months, m.fullCAC * 1.2, 1);
    var x = function (mo) { return padL + (mo / months) * (W - padL - padR); };
    var y = function (val) { return H - padB - (val / maxCum) * (H - padT - padB); };

    // оси и сетка
    var grid = '';
    for (var gi = 0; gi <= 4; gi++) {
      var gv = maxCum * gi / 4;
      var gy = y(gv);
      grid += '<line x1="' + padL + '" y1="' + gy + '" x2="' + (W - padR) + '" y2="' + gy + '" stroke="var(--line)" stroke-width="1"/>';
      grid += '<text x="' + (padL - 8) + '" y="' + (gy + 4) + '" text-anchor="end" font-size="10" fill="var(--faint)">' + Math.round(gv / 1000) + 'К</text>';
    }
    var xticks = '';
    for (var t = 0; t <= months; t += 6) {
      xticks += '<text x="' + x(t) + '" y="' + (H - padB + 18) + '" text-anchor="middle" font-size="10" fill="var(--faint)">' + t + ' мес</text>';
    }

    // линия накопленного вклада
    var pts = [];
    for (var mo = 0; mo <= months; mo++) pts.push(x(mo) + ',' + y(contrib * mo));
    var cumLine = '<polyline points="' + pts.join(' ') + '" fill="none" stroke="var(--green)" stroke-width="2.5"/>';

    // линия Полный CAC
    var cacY = y(Math.min(m.fullCAC, maxCum));
    var cacLine = '<line x1="' + padL + '" y1="' + cacY + '" x2="' + (W - padR) + '" y2="' + cacY +
      '" stroke="var(--red)" stroke-width="2" stroke-dasharray="6 5"/>';

    // маркер окупаемости
    var marker = '';
    if (contrib > 0 && isFinite(m.payback) && m.payback <= months) {
      var mx = x(m.payback), my = cacY;
      marker = '<circle cx="' + mx + '" cy="' + my + '" r="6" fill="var(--blue)" stroke="#fff" stroke-width="2"/>' +
        '<line x1="' + mx + '" y1="' + my + '" x2="' + mx + '" y2="' + (H - padB) + '" stroke="var(--blue)" stroke-width="1" stroke-dasharray="3 3"/>' +
        '<text x="' + clamp(mx, padL + 4, W - padR - 90) + '" y="' + (padT + 14) + '" font-size="11" font-weight="700" fill="var(--blue)">Окупаемость: ' + paybackText(m.payback) + '</text>';
    } else if (contrib <= 0) {
      marker = '<text x="' + (W / 2) + '" y="' + (H / 2) + '" text-anchor="middle" font-size="12" fill="var(--red)">Вклад клиента ≤ 0 — окупаемости нет</text>';
    }

    return '<svg viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="График окупаемости когорты">' +
      '<title>График окупаемости когорты</title>' +
      '<desc>Накопленный вклад клиента по месяцам (сплошная зелёная линия) против постоянной линии Полного CAC (пунктир). Точка пересечения — срок окупаемости ' + paybackText(m.payback) + '.</desc>' +
      grid + xticks +
      '<line x1="' + padL + '" y1="' + (H - padB) + '" x2="' + (W - padR) + '" y2="' + (H - padB) + '" stroke="var(--line-strong)" stroke-width="1"/>' +
      cacLine + cumLine + marker + '</svg>';
  }

  /* --- симулятор «Что, если…» --- */
  function simSlider(key, label, valLabel, min, max, step, value, loLabel, hiLabel) {
    return '<div class="ue-slider-row">' +
      '<div class="ue-slider-head"><span class="ue-sl-label">' + esc(label) + '</span><span class="ue-sl-val" data-ue-simval="' + key + '">' + valLabel + '</span></div>' +
      '<input type="range" data-ue-sim="' + key + '" min="' + min + '" max="' + max + '" step="' + step + '" value="' + value + '">' +
      '<div class="ue-slider-meta"><span>' + esc(loLabel) + '</span><span>' + esc(hiLabel) + '</span></div></div>';
  }

  function simulatorHtml(m) {
    var sliders =
      simSlider('dC1', 'Конверсия C1 (сайт→лид)', '+0 п.п.', -5, 5, 0.1, 0, '−5 п.п.', '+5 п.п.') +
      simSlider('dC2', 'Конверсия C2 (лид→сделка)', '+0 п.п.', -10, 10, 0.5, 0, '−10 п.п.', '+10 п.п.') +
      simSlider('checkMul', 'Средний чек', '×1.00', 0.7, 1.3, 0.01, 1, '−30%', '+30%') +
      simSlider('cplMul', 'CPL / стоимость лида', '×1.00', 0.6, 1.4, 0.01, 1, '−40%', '+40%') +
      simSlider('churnAbs', 'Отток (Churn)', pct(m.churn), 1, 30, 0.5, m.churn, '1%', '30%') +
      simSlider('arpuMul', 'ARPU клиента', '×1.00', 0.5, 1.5, 0.01, 1, '−50%', '+50%');

    var body =
      '<div class="ue-sim-grid">' +
      '<div class="ue-sliders">' + sliders +
      '<button class="ue-action ghost" type="button" id="ueSimReset" style="align-self:flex-start;margin-top:4px">Сбросить к фактическим значениям</button></div>' +
      '<div class="ue-sim-out">' +
      '<div class="ue-sim-insight" id="ueSimInsight"></div>' +
      '<div id="ueSimRows"></div>' +
      '<h4 style="margin:6px 0 0;font-size:12px;text-transform:uppercase;letter-spacing:.06em;color:var(--muted)">Чувствительность юнит-маржи · C1 × CPL</h4>' +
      '<div class="ue-sens-wrap"><table class="ue-sens" id="ueSens"></table></div>' +
      '</div></div>';

    return card('Симулятор «Что, если…»',
      'Двигайте ползунки — KPI, воронка, точка безубыточности и таблица чувствительности пересчитываются мгновенно.',
      body);
  }

  function renderSimOutputs(base) {
    var b = base || compute(fact);
    var cur = compute(fact, sim);
    var ref = compute(fact); // факт без оверрайдов

    // подписи ползунков
    setSimVal('dC1', (sim.dC1 >= 0 ? '+' : '') + sim.dC1.toFixed(1) + ' п.п.');
    setSimVal('dC2', (sim.dC2 >= 0 ? '+' : '') + sim.dC2.toFixed(1) + ' п.п.');
    setSimVal('checkMul', '×' + sim.checkMul.toFixed(2));
    setSimVal('cplMul', '×' + sim.cplMul.toFixed(2));
    setSimVal('churnAbs', pct(sim.churnAbs != null ? sim.churnAbs : ref.churn));
    setSimVal('arpuMul', '×' + sim.arpuMul.toFixed(2));

    // выходные строки
    var rows = document.getElementById('ueSimRows');
    if (rows) {
      rows.innerHTML =
        simRow('Полный CAC', money(cur.fullCAC), cur.fullCAC - ref.fullCAC, true) +
        simRow('LTV', money(cur.ltv), cur.ltv - ref.ltv, false) +
        simRow('Срок окупаемости', paybackText(cur.payback),
          (isFinite(cur.payback) ? cur.payback : 99) - (isFinite(ref.payback) ? ref.payback : 99), true, ' мес.') +
        simRowStrong('Юнит-маржа', cur.unitMargin, cur.unitMargin - ref.unitMargin) +
        simRowStrong('ROMI', cur.romi, cur.romi - ref.romi, '%');
    }

    // динамический инсайт: эффект +1 п.п. C1
    var insight = document.getElementById('ueSimInsight');
    if (insight) {
      var plus = compute(fact, Object.assign({}, sim, { dC1: sim.dC1 + 1 }));
      var dMargin = plus.unitMargin - cur.unitMargin;
      var dRomi = plus.romi - cur.romi;
      insight.innerHTML = 'Если увеличить C1 на <b>+1 п.п.</b>, Юнит-маржа изменится на <b>' +
        (dMargin >= 0 ? '+' : '') + money(dMargin) + '</b>, а ROMI — на <b>' +
        (dRomi >= 0 ? '+' : '') + pct(dRomi) + '</b>.';
    }

    renderSensitivity();
    // обновляем зависимые виджеты под текущий симулятор
    refreshDependent(cur);
  }

  function simRow(label, val, delta, lowerBetter, unit) {
    var cls = nearZero(delta) ? 'flat' : ((lowerBetter ? delta < 0 : delta > 0) ? 'good' : 'bad');
    var dtxt = nearZero(delta) ? '•' : ((delta > 0 ? '+' : '−') + Math.abs(delta).toLocaleString('ru-RU', { maximumFractionDigits: 1 }) + (unit || ' ₽'));
    return '<div class="ue-sim-out-row"><span>' + esc(label) + '</span><b>' + val + '</b><span class="ue-sim-delta ' + cls + '">' + dtxt + '</span></div>';
  }
  function simRowStrong(label, val, delta, unit) {
    var pos = val >= 0;
    var valTxt = unit === '%' ? pct(val) : money(val);
    var cls = nearZero(delta) ? 'flat' : (delta > 0 ? 'good' : 'bad');
    var dtxt = nearZero(delta) ? '•' : ((delta > 0 ? '+' : '−') + Math.abs(delta).toLocaleString('ru-RU', { maximumFractionDigits: 1 }) + (unit === '%' ? ' п.п.' : ' ₽'));
    return '<div class="ue-sim-out-row strong"><span>' + esc(label) + '</span><b class="' + (pos ? 'pos' : 'neg') + '">' + valTxt + '</b><span class="ue-sim-delta ' + cls + '">' + dtxt + '</span></div>';
  }
  function nearZero(x) { return Math.abs(x) < 0.05; }

  function renderSensitivity() {
    var el = document.getElementById('ueSens');
    if (!el) return;
    var c1Steps = [2, 0, -2];        // п.п.
    var cplSteps = [0.8, 1, 1.2];    // множители CPL
    var head = '<thead><tr><th></th><th>CPL −20%</th><th>CPL факт</th><th>CPL +20%</th></tr></thead>';
    var body = '<tbody>';
    c1Steps.forEach(function (dc1) {
      var rowLabel = dc1 === 0 ? 'C1 факт' : 'C1 ' + (dc1 > 0 ? '+' : '−') + Math.abs(dc1) + ' п.п.';
      body += '<tr><td class="rowhead">' + rowLabel + '</td>';
      cplSteps.forEach(function (cplMul) {
        var ov = Object.assign({}, sim, { dC1: sim.dC1 + dc1, cplMul: sim.cplMul * cplMul });
        var um = compute(fact, ov).unitMargin;
        var isCenter = (dc1 === 0 && cplMul === 1);
        var cls = um >= 0 ? 'cell-pos' : 'cell-neg';
        body += '<td class="' + cls + (isCenter ? ' is-center' : '') + '">' + (um >= 0 ? '+' : '−') + money(Math.abs(um)) + '</td>';
      });
      body += '</tr>';
    });
    body += '</tbody>';
    el.innerHTML = head + body;
  }

  // Симулятор обновляет воронку и график окупаемости под текущие оверрайды.
  function refreshDependent(cur) {
    var fn = document.querySelector('#ueLab .ue-funnel');
    var be = document.getElementById('ueBreakeven');
    if (be) be.innerHTML = breakevenSvg(cur);
    if (fn) {
      var wrap = document.createElement('div');
      wrap.innerHTML = funnelHtml(cur);
      var newFn = wrap.querySelector('.ue-funnel');
      var newNote = wrap.querySelector('.ue-bottleneck-note');
      fn.replaceWith(newFn);
      var oldNote = document.querySelector('#ueLab .ue-bottleneck-note');
      if (oldNote && newNote) oldNote.replaceWith(newNote);
    }
  }

  /* --- План/Факт + панель ИИ-аналитика --- */
  function planFactHtml(m) {
    var rows = [
      ['Трафик', fact.traffic, plan.traffic, num, false],
      ['CPL, ₽', m.cpl, plan.cpl, function (v) { return money1(v); }, true],
      ['Конверсия C1, %', fact.c1, plan.c1, function (v) { return pct(v); }, false],
      ['Полный CAC, ₽', m.fullCAC, plan.fullCAC, money, true],
      ['Юнит-маржа, ₽', m.unitMargin, plan.unitMargin, money, false],
      ['Отток, %', fact.churn, plan.churn, function (v) { return pct(v); }, true]
    ];
    var trs = rows.map(function (r) {
      var f = Number(r[1]), p = Number(r[2]);
      var d = p ? (f - p) / Math.abs(p) * 100 : 0;
      var lowerBetter = r[4];
      var good = lowerBetter ? d <= 0 : d >= 0;
      var cls = Math.abs(d) < 1 ? 'flat' : (good ? 'good' : 'bad');
      var dtxt = (d > 0 ? '+' : '') + d.toLocaleString('ru-RU', { maximumFractionDigits: 1 }) + '%';
      return '<tr><td class="rowhead" style="text-align:left">' + esc(r[0]) + '</td><td>' + r[3](f) + '</td><td>' + r[3](p) +
        '</td><td><span class="ue-sim-delta ' + cls + '">' + dtxt + '</span></td></tr>';
    }).join('');

    var table = '<div class="ue-sens-wrap"><table class="ue-sens"><thead><tr><th style="text-align:left">Метрика</th><th>Факт</th><th>План</th><th>Δ</th></tr></thead><tbody>' + trs + '</tbody></table></div>';

    return card('План против факта',
      'Сравнение текущих фактических метрик с планом на месяц. Дельта Δ = (Факт − План) ÷ |План| × 100%. Изменить план — кнопка «Задать план на месяц» наверху.',
      table);
  }

  function aiPanelHtml() {
    return '<div class="ue-ai"><div class="ue-ai-inner" id="ueAiInner"></div></div>';
  }

  // Локальный детерминированный ИИ-аналитик: анализирует отклонения План/Факт.
  function buildInsights() {
    var m = compute(fact);
    var metrics = {
      traffic: { fact: fact.traffic, plan: plan.traffic, lowerBetter: false, label: 'Трафик' },
      cpl: { fact: m.cpl, plan: plan.cpl, lowerBetter: true, label: 'CPL' },
      c1: { fact: fact.c1, plan: plan.c1, lowerBetter: false, label: 'конверсия C1' },
      fullCAC: { fact: m.fullCAC, plan: plan.fullCAC, lowerBetter: true, label: 'Полный CAC' },
      unitMargin: { fact: m.unitMargin, plan: plan.unitMargin, lowerBetter: false, label: 'Юнит-маржа' },
      churn: { fact: fact.churn, plan: plan.churn, lowerBetter: true, label: 'отток' }
    };
    // дельта «полезности»: положительная = хуже плана
    var harms = Object.keys(metrics).map(function (k) {
      var x = metrics[k];
      var p = Number(x.plan) || 0;
      var rel = p ? (x.fact - p) / Math.abs(p) * 100 : 0;
      var harm = x.lowerBetter ? rel : -rel; // больше — хуже
      return { key: k, harm: harm, rel: rel, m: x };
    });
    harms.sort(function (a, b) { return b.harm - a.harm; });

    var worst = harms.filter(function (h) { return h.harm > 1; });
    var status, statusText;
    if (m.unitMargin < 0 || m.romi < 0) { status = 'red'; statusText = 'Критические просадки'; }
    else if (worst.length || m.payback > 12 || Number(fact.churn) > 10) { status = 'yellow'; statusText = 'Есть отклонения'; }
    else { status = 'green'; statusText = 'Всё по плану'; }

    var rootCause, actions;
    if (status === 'green') {
      rootCause = 'Все ключевые метрики на уровне плана или лучше: Юнит-маржа ' + money(m.unitMargin) +
        ', ROMI ' + pct(m.romi) + ', срок окупаемости ' + paybackText(m.payback) +
        '. Экономика устойчива — есть запас для масштабирования.';
      actions = [
        'Увеличить бюджет в Яндекс.Директ на 20–30% по самым окупаемым кампаниям, удерживая CPL ниже ' + money1(plan.cpl) + '.',
        'Запустить второй канал привлечения (CPA-витрины) с лимитом CAC до ' + money(m.fullCAC) + ' для проверки масштаба без потери маржи.',
        'Зафиксировать onboarding-цепочку: при текущем оттоке ' + pct(fact.churn) + ' каждый −1 п.п. оттока добавляет к LTV ' +
          money(m.contribMonthly / (Math.max(0.1, fact.churn - 1) / 100) - m.ltv) + '.'
      ];
    } else {
      var top = worst.slice(0, 2);
      var causeParts = top.map(function (h) {
        return esc(h.m.label) + ' ' + (h.rel > 0 ? '+' : '') + h.rel.toLocaleString('ru-RU', { maximumFractionDigits: 1 }) + '%';
      });
      var driver = '';
      var hasCpl = top.some(function (h) { return h.key === 'cpl'; });
      var hasC1 = top.some(function (h) { return h.key === 'c1'; });
      if (hasCpl && hasC1) driver = ' Главный драйвер — рост аукциона и выгорание креативов в Яндекс.Директ при падении конверсии посадочных.';
      else if (hasCpl) driver = ' Главный драйвер — рост ставки в аукционе Яндекс.Директ.';
      else if (hasC1) driver = ' Главный драйвер — падение конверсии посадочных страниц.';
      else if (top.some(function (h) { return h.key === 'churn'; })) driver = ' Главный драйвер — рост оттока и недостаточное удержание в первые 30 дней.';
      rootCause = (causeParts.length ? 'Отклонения ' + causeParts.join(' и ') + ' ' : 'Совокупность отклонений ') +
        'опустили юнит-маржу до ' + money(m.unitMargin) + ' (ROMI ' + pct(m.romi) + ').' + driver;

      actions = [];
      if (hasCpl) actions.push('Снизить ставки в Директе на 15–20% и перераспределить бюджет в CPA-витрины со стабильным CPL ниже ' + money1(plan.cpl) + '.');
      if (hasC1) actions.push('Запустить A/B-тест новых посадочных страниц для восстановления C1 до ' + pct(plan.c1) + '.');
      if (top.some(function (h) { return h.key === 'churn'; }) || Number(fact.churn) > 10)
        actions.push('Внедрить онбординг-цепочку в первые 30 дней: отток ' + pct(fact.churn) + ' напрямую режет LTV.');
      if (top.some(function (h) { return h.key === 'fullCAC'; }))
        actions.push('Сократить операционные затраты на продажи (ФОТ/бонусы/CRM) или поднять C2 — Полный CAC ' + money(m.fullCAC) + ' выше плана.');
      if (m.payback > 12) actions.push('Поднять ARPU или валовую маржу: при сроке окупаемости ' + paybackText(m.payback) + ' нужен оборотный капитал.');
      // добиваем до трёх конкретных рекомендаций
      var fillers = [
        'Поднять средний чек на 10% через пакетные тарифы — Полный CAC окупится быстрее.',
        'Усилить квалификацию лидов, чтобы поднять C2 и снизить нагрузку на отдел продаж.',
        'Перенести часть бюджета на ретаргетинг тёплой базы для роста конверсии в сделку.'
      ];
      var fi = 0;
      while (actions.length < 3 && fi < fillers.length) { if (actions.indexOf(fillers[fi]) === -1) actions.push(fillers[fi]); fi++; }
      actions = actions.slice(0, 3);
    }
    return { status: status, statusText: statusText, rootCause: rootCause, actions: actions };
  }

  function renderAi() {
    var inner = document.getElementById('ueAiInner');
    if (!inner) return;
    var r = buildInsights();
    inner.innerHTML =
      '<div class="ue-ai-head"><div class="ue-ai-title"><h3>ИИ-аналитик отклонений</h3>' +
      '<p>Автоматическая диагностика План/Факт и рекомендации действий.</p></div>' +
      '<span class="ue-ai-status ' + r.status + '">' + esc(r.statusText) + '</span></div>' +
      '<div class="ue-ai-block"><h4>Почему так произошло</h4><div class="ue-ai-rootcause">' + esc(r.rootCause) + '</div></div>' +
      '<div class="ue-ai-block"><h4>Что делать прямо сейчас</h4><ul class="ue-ai-actions">' +
      r.actions.map(function (a) { return '<li>' + esc(a) + '</li>'; }).join('') + '</ul></div>' +
      '<div class="ue-ai-foot"><span class="ue-ai-meta">Обновлено: <time datetime="' + new Date().toISOString() + '">' + new Date().toLocaleTimeString('ru-RU') +
      '</time> · локальный детерминированный анализ</span><button class="ue-ai-reanalyze" type="button" id="ueAiReanalyze">Переанализировать</button></div>';
    var btn = document.getElementById('ueAiReanalyze');
    if (btn) btn.addEventListener('click', function () { scheduleAi(true); });
  }

  function showAiLoading() {
    var inner = document.getElementById('ueAiInner');
    if (!inner) return;
    inner.innerHTML = '<div class="ue-ai-loading"><div class="ue-ai-loading-txt">ИИ анализирует данные…</div>' +
      '<div class="ue-skel" style="width:90%"></div><div class="ue-skel" style="width:75%"></div><div class="ue-skel" style="width:82%"></div></div>';
  }

  // Debounce 2 c при изменении фактических данных; при ручном/первом запуске — сразу.
  function scheduleAi(immediate) {
    if (aiTimer) clearTimeout(aiTimer);
    showAiLoading();
    var delay = immediate ? 500 : 2000;
    aiTimer = setTimeout(renderAi, delay);
  }

  /* ------------------------------ события ------------------------------ */
  function wireInputs() {
    document.querySelectorAll('#ueLab [data-ue-fact]').forEach(function (inp) {
      inp.addEventListener('input', function () {
        var k = inp.getAttribute('data-ue-fact');
        var v = Number(inp.value);
        if (!isFinite(v)) v = 0;
        fact[k] = v;
        save(STORE_FACT, fact);
        // лёгкий перерасчёт без полного ререндера полей (чтобы не терять фокус)
        partialRecalc();
        scheduleAi(false);
      });
    });
  }

  // Пересчитывает все производные блоки, не трогая сами input-поля (сохраняет фокус).
  function partialRecalc() {
    var m = compute(fact);
    // перерисовать результат, воронку, график, план/факт; вводные оставить
    replaceBlock('.ue-sec-result', resultHtml(m));
    // обновить серые расчётные ячейки в секциях вводных
    updateCalcCells(m);
    // воронка/график/план-факт
    replaceFunnel(m);
    var be = document.getElementById('ueBreakeven');
    if (be) be.innerHTML = breakevenSvg(m);
    replacePlanFact(m);
    // симулятор: пересчитать выводы (база поменялась)
    renderSimOutputs(m);
  }

  function updateCalcCells(m) {
    var boxes = document.querySelectorAll('#ueLab .ue-sec-mkt .ue-calc-box, #ueLab .ue-sec-sales .ue-calc-box, #ueLab .ue-sec-econ .ue-calc-box');
    // порядок соответствует разметке inputsHtml
    var vals = [
      money(m.budget), money1(m.cpl),                       // mkt: бюджет, CPL
      num(m.leads), num(m.deals), money(m.salesBonus),       // sales: лиды, сделки, бонусы
      pct(m.grossMargin), money(m.contribMonthly), money(m.ltv) // econ
    ];
    boxes.forEach(function (b, i) { if (vals[i] != null) b.innerHTML = vals[i]; });
  }

  function replaceBlock(selector, html) {
    var el = document.querySelector('#ueLab ' + selector);
    if (!el) return;
    var wrap = document.createElement('div');
    wrap.innerHTML = html;
    el.replaceWith(wrap.firstElementChild);
  }
  function replaceFunnel(m) {
    var fn = document.querySelector('#ueLab .ue-funnel');
    if (!fn) return;
    var cardEl = fn.closest('.ue-card');
    if (!cardEl) return;
    var wrap = document.createElement('div');
    wrap.innerHTML = funnelHtml(m);
    cardEl.replaceWith(wrap.firstElementChild);
  }
  function replacePlanFact(m) {
    var target = null;
    document.querySelectorAll('#ueLab .ue-card').forEach(function (c) {
      var h = c.querySelector('h3'); if (h && h.textContent.indexOf('План против факта') === 0) target = c;
    });
    if (!target) return;
    var wrap = document.createElement('div');
    wrap.innerHTML = planFactHtml(m);
    target.replaceWith(wrap.firstElementChild);
  }

  function setSimVal(key, txt) {
    var el = document.querySelector('#ueLab [data-ue-simval="' + key + '"]');
    if (el) el.textContent = txt;
  }

  function wireSimulator(base) {
    document.querySelectorAll('#ueLab [data-ue-sim]').forEach(function (inp) {
      inp.addEventListener('input', function () {
        var k = inp.getAttribute('data-ue-sim');
        var v = Number(inp.value);
        if (k === 'dC1' || k === 'dC2') sim[k] = v;
        else if (k === 'churnAbs') sim.churnAbs = v;
        else sim[k] = v; // multipliers
        renderSimOutputs();
      });
    });
    var reset = document.getElementById('ueSimReset');
    if (reset) reset.addEventListener('click', function () {
      sim = freshSim();
      document.querySelectorAll('#ueLab [data-ue-sim]').forEach(function (inp) {
        var k = inp.getAttribute('data-ue-sim');
        if (k === 'dC1' || k === 'dC2') inp.value = 0;
        else if (k === 'churnAbs') inp.value = Number(fact.churn) || 0;
        else inp.value = 1;
      });
      renderSimOutputs();
    });
  }

  /* --- модальное окно «Задать план» --- */
  function wirePlanFact() {
    var openBtn = document.getElementById('uePlanBtn');
    var resetBtn = document.getElementById('ueResetBtn');
    var modal = document.getElementById('uePlanModal');
    if (openBtn && modal) openBtn.addEventListener('click', openPlanModal);
    if (modal) modal.querySelectorAll('[data-ue-modal-close]').forEach(function (b) {
      b.addEventListener('click', function () { modal.hidden = true; });
    });
    var saveBtn = document.getElementById('uePlanSave');
    if (saveBtn) saveBtn.addEventListener('click', function () {
      document.querySelectorAll('#uePlanFields [data-ue-plan]').forEach(function (inp) {
        var k = inp.getAttribute('data-ue-plan');
        var v = Number(inp.value); if (isFinite(v)) plan[k] = v;
      });
      save(STORE_PLAN, plan);
      document.getElementById('uePlanModal').hidden = true;
      partialRecalc();
      scheduleAi(true);
    });
    if (resetBtn) resetBtn.addEventListener('click', function () {
      fact = Object.assign({}, DEFAULT_FACT);
      save(STORE_FACT, fact);
      sim = freshSim();
      render();
    });
  }

  function openPlanModal() {
    var box = document.getElementById('uePlanFields');
    if (!box) return;
    var fields = [
      ['traffic', 'Трафик, визиты/мес', 1000],
      ['cpl', 'CPL, ₽/лид', 10],
      ['c1', 'Конверсия C1, %', 0.1],
      ['fullCAC', 'Полный CAC, ₽', 100],
      ['unitMargin', 'Юнит-маржа, ₽', 50],
      ['churn', 'Отток, %/мес', 0.5]
    ];
    box.innerHTML = fields.map(function (f) {
      return '<div class="ue-cell ue-input"><label>' + esc(f[1]) + '</label>' +
        '<input type="number" inputmode="decimal" data-ue-plan="' + f[0] + '" value="' + esc(plan[f[0]]) + '" step="' + f[2] + '"></div>';
    }).join('');
    document.getElementById('uePlanModal').hidden = false;
  }

  /* ------------------------------- init ------------------------------- */
  function init() {
    if (!document.getElementById('ueLab')) return;
    if (document.getElementById('ueLab').dataset.source === 'dashboard-cjm') return;
    render();
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
