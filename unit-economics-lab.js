/*
 * Юнит-экономика «Выручай» · сегментный дашборд LTV / CAC / ROMI.
 * Реализация ТЗ: 4 сегмента (Новый, Повторный, Просроченный, Спящий),
 * настройки общих метрик, воронки и кросс-сейла, расчёт LTV_0/1/2 с дисконтом,
 * Blended CAC, Average ARPU, Payback period, переключаемая CJM-воронка,
 * когортный график накопленного LTV против CAC и P&L-водопад.
 *
 * Модуль самодостаточен: рендерит весь UI внутри #ueLab, не зависит от
 * dashboard-app.js и активируется, когда у контейнера атрибут
 * data-source="segments-v2".
 */
(function () {
  'use strict';

  var STORE_KEY = 'ue_segments_v1';

  // ---- Сегменты и стартовые значения (из ТЗ) ----
  var SEGMENTS = [
    { id: 'new',      name: 'Новый',       short: 'Нов.',   accent: 'var(--blue)' },
    { id: 'repeat',   name: 'Повторный',   short: 'Повт.',  accent: 'var(--green)' },
    { id: 'overdue',  name: 'Просроченный',short: 'Просроч.', accent: 'var(--orange)' },
    { id: 'sleep',    name: 'Спящий',      short: 'Сонн.',  accent: 'var(--violet)' }
  ];

  var DEFAULT_PARAMS = {
    // Общие
    epl: 800,
    opex: 120,
    revShare: 30,   // %
    discount: 20,   // %
    // Воронка
    crVisitLead: 8,        // %
    crLeadClickout: 35,    // %
    crClickoutIssue: 35,   // %
    // Кросс-сейл
    crCross: 10,           // %
    crossEpl: 600,
    // Сегменты: CAC, retention 1y, retention 2y, доля сегмента в общем трафике (%)
    seg: {
      new:     { cac: 2500, ret1: 25, ret2: 15, share: 45, funnelMul: 1.00 },
      repeat:  { cac:  450, ret1: 45, ret2: 30, share: 25, funnelMul: 1.30 },
      overdue: { cac:  800, ret1: 35, ret2: 20, share: 20, funnelMul: 0.85 },
      sleep:   { cac:  350, ret1: 30, ret2: 18, share: 10, funnelMul: 0.70 }
    }
  };

  // Шаги CJM-воронки по сегментам (тексты CTA отличаются согласно листам Excel).
  var FUNNEL_STEPS = {
    new: [
      { label: 'Трафик · поисковый/PR-визит',      cta: 'Узнать, на что хватит'   },
      { label: 'Осознание нужды · Start Quiz',     cta: 'Пройти Квиз-Сенсей'      },
      { label: 'Сбор данных · форма Лида',         cta: 'Подобрать оффер'         },
      { label: 'Выбор предложения · Click-out',    cta: 'Перейти к партнёру'      },
      { label: 'Монетизация · Approved / EPL',     cta: 'Выдача займа'            }
    ],
    repeat: [
      { label: 'База CRM · повторный визит',       cta: 'Войти в кабинет'         },
      { label: 'Активация сессии',                 cta: 'Открыть новое решение'   },
      { label: 'Подтверждение данных · Lead',      cta: 'Обновить параметры'      },
      { label: 'Click-out по релевантным офферам', cta: 'Взять у проверенного партнёра' },
      { label: 'Выдача · повторная сделка',        cta: 'Approved · EPL+Cross'    }
    ],
    overdue: [
      { label: 'Трафик · сегмент с просрочкой',    cta: 'Узнать варианты'         },
      { label: 'Скоринг ситуации · Quiz Risk',     cta: 'Подобрать перекредитование' },
      { label: 'Лид · согласие на проверку БКИ',   cta: 'Отправить заявку'        },
      { label: 'Click-out · БФЛ / рефинанс',       cta: 'Перейти к партнёру'      },
      { label: 'Монетизация · одобрение',          cta: 'Approved · CPA / EPL'    }
    ],
    sleep: [
      { label: 'Реактивационный канал',            cta: 'Письмо/Push · Вернуться' },
      { label: 'Возврат на сайт · Start Quiz',     cta: 'Что нового · подобрать оффер' },
      { label: 'Лид · обновлённые данные',         cta: 'Подтвердить параметры'   },
      { label: 'Click-out · топ-оффер',            cta: 'Забрать предложение'     },
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
  function num(n) { return Math.round(Number(n) || 0).toLocaleString('ru-RU'); }
  function money(n) { return num(n) + ' ₽'; }
  function money1(n) { return (Number(n) || 0).toLocaleString('ru-RU', { maximumFractionDigits: 1 }) + ' ₽'; }
  function pct(n) { return (Number(n) || 0).toLocaleString('ru-RU', { maximumFractionDigits: 1 }) + '%'; }
  function ratio(n) { return (Number(n) || 0).toLocaleString('ru-RU', { maximumFractionDigits: 2 }) + 'x'; }
  function esc(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  /* ============================== РАСЧЁТЫ ============================== */

  // Метрики на один лид: gross/net revenue per lead, конверсия лида в выдачу.
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
    var ltv0 = le.net * crSegment;
    var ltv1 = ltv0 + (ltv0 * (s.ret1 / 100)) / (1 + d);
    var ltv2 = ltv1 + (ltv0 * (s.ret2 / 100)) / Math.pow(1 + d, 2);
    var roi = s.cac > 0 ? (ltv2 - s.cac) / s.cac * 100 : 0;
    var ltvCac = s.cac > 0 ? ltv2 / s.cac : 0;
    // Срок окупаемости (месяцы): линейная интерполяция по точкам 0 / 12 / 24 мес.
    var payback = paybackMonths(ltv0, ltv1, ltv2, s.cac);
    return {
      seg: s, segId: segId, name: SEGMENTS.find(function(x){return x.id===segId;}).name,
      ltv0: ltv0, ltv1: ltv1, ltv2: ltv2, cac: s.cac, roi: roi, ltvCac: ltvCac,
      payback: payback, crSegment: crSegment, share: s.share
    };
  }

  function paybackMonths(ltv0, ltv1, ltv2, cac) {
    if (cac <= 0) return 0;
    // Если выручка нулевого периода уже покрывает CAC, окупаемость условно — первый месяц.
    if (ltv0 >= cac) return ltv0 > 0 ? Math.min(1, cac / ltv0) : 1;
    // Между 0 и 12 мес растёт линейно от ltv0 до ltv1
    if (ltv1 >= cac) {
      var t = (cac - ltv0) / Math.max(0.0001, (ltv1 - ltv0));
      return clamp(0.5 + t * 11.5, 0.5, 12);
    }
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

  /* ============================== РЕНДЕР ============================== */

  var params = load();
  var activeFunnelSeg = 'new';

  function render() {
    var host = document.getElementById('ueLab');
    if (!host) return;
    host.innerHTML =
      '<div class="ue2">' +
        '<aside class="ue2-side">' + sidebarHtml() + '</aside>' +
        '<div class="ue2-main">' +
          kpiHtml() +
          segmentMatrixHtml() +
          '<div class="ue2-row">' +
            funnelCardHtml() +
            cohortCardHtml() +
          '</div>' +
          waterfallCardHtml() +
          summaryHtml() +
        '</div>' +
      '</div>';
    wire();
    drawCharts();
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
    var common =
      '<div class="ue2-side-group">' +
        '<h4>Общие метрики</h4>' +
        sliderRow('epl',      'EPL',      '₽ за выдачу',    100, 3000, 10,  params.epl,
          'Доход партнёрской программы за одобренную выдачу.') +
        sliderRow('opex',     'OPEX',     '₽ на лида',      0,   600,  5,   params.opex,
          'Технические и операционные расходы на обработку одного лида.') +
        sliderRow('revShare', 'Rev Share','%',              0,   80,   1,   params.revShare,
          'Доля партнёра/паблишера в валовом доходе с одной выдачи.') +
        sliderRow('discount', 'Дисконт',  '%/год',          0,   60,   1,   params.discount,
          'Ставка дисконтирования будущих когортных доходов.') +
      '</div>';

    var funnel =
      '<div class="ue2-side-group">' +
        '<h4>Метрики воронки</h4>' +
        sliderRow('crVisitLead',    'CR Visit → Lead',      '%', 0, 30, 0.5, params.crVisitLead) +
        sliderRow('crLeadClickout', 'CR Lead → Click-out',  '%', 0, 90, 1,   params.crLeadClickout) +
        sliderRow('crClickoutIssue','CR Click-out → Выдача','%', 0, 90, 1,   params.crClickoutIssue) +
      '</div>';

    var cross =
      '<div class="ue2-side-group">' +
        '<h4>Кросс-сейл</h4>' +
        sliderRow('crCross',  'CR Cross-sell', '%',           0, 60,   1,  params.crCross) +
        sliderRow('crossEpl', 'Доп. EPL',     '₽ за выдачу',  0, 3000, 10, params.crossEpl) +
      '</div>';

    var segs = SEGMENTS.map(function (s) {
      var sp = params.seg[s.id];
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

    return '<div class="ue2-side-head"><h3>Панель управления</h3>' +
      '<button class="ue2-reset" type="button" id="ueResetParams">Сбросить</button></div>' +
      '<p class="ue2-side-lead">Все вводные из листа «Вводные» Excel-модели. Двигайте ползунки или вводите значение — все KPI, графики и P&amp;L пересчитываются мгновенно.</p>' +
      common + funnel + cross + segs;
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
  function ltvCacTone(r) { return r >= 3 ? 'green' : r >= 1.5 ? 'yellow' : 'red'; }
  function ltvCacBadge(r) { return r >= 3 ? 'таргет ≥ 3.0' : r >= 1.5 ? 'ниже таргета' : 'критически низко'; }
  function paybackText(p) {
    if (!isFinite(p)) return 'не окупается';
    if (p < 1) return 'до 1 мес.';
    if (p < 12) return p.toLocaleString('ru-RU', { maximumFractionDigits: 1 }) + ' мес.';
    var y = p / 12;
    return y.toLocaleString('ru-RU', { maximumFractionDigits: 1 }) + ' года';
  }
  function paybackTone(p) {
    if (!isFinite(p)) return 'red';
    if (p <= 6) return 'green';
    if (p <= 12) return 'yellow';
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
        'Blended ARPU ÷ Blended CAC · таргет инвесткомитета &gt; 3.0', ratioTone, ltvCacBadge(k.blendedRatio)) +
      kpiCard('Payback period', paybackText(k.payback),
        'Срок окупаемости когорты · CAC ↔ накопительный LTV', pTone,
        pTone === 'green' ? 'быстро' : pTone === 'yellow' ? 'умеренно' : 'долго');

    return '<div class="ue2-kpis">' + cards + '</div>' +
      '<div class="ue2-kpi-mini-row">' + perSegHtml + '</div>';
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

  function segmentMatrixHtml() {
    var cards = SEGMENTS.map(function (s) {
      var e = segmentEconomics(params, s.id);
      var t = ltvCacTone(e.ltvCac);
      var pTone = paybackTone(e.payback);
      var n = SEGMENT_NOTES[s.id];
      var pros = n.pros.map(function (x) { return '<li>' + esc(x) + '</li>'; }).join('');
      var cons = n.cons.map(function (x) { return '<li>' + esc(x) + '</li>'; }).join('');
      return '<div class="ue2-seg-card" style="--seg-accent:' + s.accent + '">' +
        '<div class="ue2-seg-head"><span class="ue2-seg-dot" style="background:' + s.accent + '"></span>' +
          '<h3>' + esc(s.name) + '</h3>' +
          '<span class="ue2-seg-share">' + pct(e.share) + ' трафика</span></div>' +
        '<div class="ue2-seg-metrics">' +
          '<div><span>LTV₂</span><b>' + money(e.ltv2) + '</b></div>' +
          '<div><span>CAC</span><b>' + money(e.cac) + '</b></div>' +
          '<div><span>LTV/CAC</span><b class="tone-' + t + '">' + ratio(e.ltvCac) + '</b></div>' +
          '<div><span>ROMI</span><b class="tone-' + (e.roi >= 0 ? 'green' : 'red') + '">' + pct(e.roi) + '</b></div>' +
          '<div><span>Payback</span><b class="tone-' + pTone + '">' + paybackText(e.payback) + '</b></div>' +
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
        if (m === 0) v = e.ltv0;
        else if (m <= 12) v = e.ltv0 + (e.ltv1 - e.ltv0) * (m / 12);
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
      '<div class="ue2-card-head"><h2>Итог для инвесткомитета</h2>' +
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

  function setParam(path, value) {
    var v = Number(value);
    if (!isFinite(v)) return;
    if (path.indexOf('seg.') === 0) {
      var parts = path.split('.');
      var sid = parts[1], field = parts[2];
      if (!params.seg[sid]) return;
      params.seg[sid][field] = v;
    } else {
      params[path] = v;
    }
    save(params);
  }

  function partialRefresh() {
    // Обновляем KPI, матрицу, графики и итог без перерисовки сайдбара (чтобы не терять фокус).
    var main = document.querySelector('#ueLab .ue2-main');
    if (!main) return;
    main.innerHTML =
      kpiHtml() + segmentMatrixHtml() +
      '<div class="ue2-row">' + funnelCardHtml() + cohortCardHtml() + '</div>' +
      waterfallCardHtml() + summaryHtml();
    wireMainOnly();
    drawCharts();
  }

  function wireMainOnly() {
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
      params = deepCopy(DEFAULT_PARAMS);
      save(params);
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
