/* economics-model.js — единый расчётный слой юнит-экономики «Выручай.ру».
 *
 * Назначение (см. ТЗ):
 *   Inputs  →  Channel UE  →  CJM Router / Cross-sell / Repeat / Tier  →  PnL  →  KPIs
 *
 * Модуль не зависит от DOM и от Chart — он только считает. Все рендереры в
 * dashboard-app.js читают результат через единственную точку входа
 * `EconomicsModel.build(inputs, base)`.
 *
 * Ключевые формулы:
 *   CAC_канала   = (медиа_канала + аллокация_фикса_по_визитам) /
 *                   (выдачи_первичные + π · выдачи_роутера)
 *   LTV_канала   = маржа_первая_сделка
 *                 + Σ маржа_повторов · (1 − churn)^t   (t = 1..12)
 *                 + маржа_кросс
 *   Blended CAC  = (медиа_всего − выручка_роутера − кросс) / целевые_конверсии
 *   payback_M    = первый месяц, где накопл. маржа ≥ накопл. инвестиций
 *
 * Все пороги, presets и validators сосредоточены здесь, чтобы UI не дублировал
 * бизнес-логику.
 */
(function (global) {
  'use strict';

  // ===== Маркетплейс-эффекты (раздел 2 ТЗ) =====
  // Параметры по умолчанию = "База" из PNL. Любой пресет переопределяет это.
  var DEFAULT_INPUTS = {
    // §1 Маркетинг
    cpc: { direct: 23, seo: 0, pr: 0 },
    brandShare: 0.18,
    // §1 Воронка
    funnel: {
      crVisitToOffer: 0.32,        // визит → клик по офферу
      crClickToApplication: 0.34,  // клик → заявка
      crApplicationToApproval: 0.29, // заявка → апрув
      issuedToApprovalRate: 0.76,  // апрув → выдача
      rejectReasons: { pdn: 0.42, region: 0.14, age: 0.08, scoring: 0.21, other: 0.15 }
    },
    // §1 Партнёры
    partners: {
      payout: { pdl: 2400, il: 3500, card: 1800, insurance: 900 },
      productMix: { pdl: 0.55, il: 0.14, card: 0.12, insurance: 0.06, repeat: 0.08, other: 0.05 }
    },
    // §2.1 Smart Safe Router как ревенью-машина
    router: {
      matchRate: 0.42,           // доля отказов, у которых есть совпадение в базе ЦФ
      pApprovalStep2: 0.18,      // вероятность апрува у partner #2
      pApprovalStep3: 0.09,      // вероятность апрува у partner #3
      payoutSecondary: 2400,     // выплата за выдачу partner #2
      payoutTertiary: 4500,      // выплата за выдачу partner #3 (банк/БФЛ)
      attributionShare: 1.0      // π — какая доля рекавера атрибутируется каналу-источнику
    },
    // §2.2 Кросс-продажи
    cross: {
      pCard: 0.12,               // доля апрувов, которым продаём карту
      pInsurance: 0.07,          // …и страховку
      payoutCross: 1500          // средний payout за кросс
    },
    // §2.3 Повторные сделки (CRM)
    crm: {
      repeatRate12m: 0.30,       // итоговая доля клиентов, сделавших повтор за 12 мес.
      marginRepeat: 1800,        // маржа на повтор
      churnMonthly: 0.10         // отток в месяц после первой сделки
    },
    // §2.4 Динамические тарифы партнёров от объёма
    tier: {
      bonusPerTier: 0.06,        // +6% к payout за каждый tier
      volumePerTier: 5000        // выдач в месяц на один tier
    },
    // §1 Фикс-косты (берутся из PNL baseline, тут только overrides)
    fixedCostMultiplier: 1.0,
    // Светофор-пороги (раздел 2)
    thresholds: {
      ltvCacGreen: 3.0,
      ltvCacYellow: 1.5,
      paybackGreenMonths: 6,
      paybackYellowMonths: 9
    },
    // Базовые legacy-параметры (для совместимости с существующими виджетами)
    issuedToApprovalRate: 0.76,
    ltvFactor: 1.34,
    partnerPayout: 2400,
    targetRepeatShare: 0.06,
    centrofinansBaseSize: 1.5,
    centrofinansMatchRate: 0.42
  };

  // ===== Коридоры правдоподобности (раздел 2 ТЗ) =====
  // Если значение outside corridor → validator выдаёт warning / error и блокирует
  // зелёный статус юнит-экономики до исправления.
  var CORRIDORS = [
    { path: 'funnel.crApplicationToApproval', label: 'CR в апрув (PDL)', min: 0.18, max: 0.35 },
    { path: 'crm.repeatRate12m',              label: 'Repeat-rate за 12 мес.', min: 0.25, max: 0.55 },
    { path: 'router.matchRate',               label: 'Match-rate роутера', min: 0.40, max: 0.70 },
    { path: 'tier.bonusPerTier',              label: 'Бонус payout за tier', min: 0,    max: 0.25 },
    { path: 'router.pApprovalStep2',          label: 'p(apv) шаг #2 роутера', min: 0.08, max: 0.35 },
    { path: 'router.pApprovalStep3',          label: 'p(apv) шаг #3 роутера', min: 0.04, max: 0.20 },
    { path: 'cross.pCard',                    label: 'Доля кросс-продажи карты', min: 0, max: 0.30 },
    { path: 'cross.pInsurance',               label: 'Доля кросс-продажи страховки', min: 0, max: 0.25 }
  ];

  // ===== Пресеты сценариев (раздел 5 ТЗ, блок C2) =====
  // "Базовый" обязан собирать PnL в районе PNL-плана (75.9 млн ₽ выручки за 18 мес).
  // "Маркетплейс зрелый" — это сценарий E1: payback ≤6 мес SEO/PR, ≤9 мес Директ,
  //   суммарный PnL в плюс с M+6, при правдоподобных вводных.
  // "Консервативный" — стресс-тест: маркетплейс-эффекты выключены, чтобы видеть
  //   "голую" экономику без роутера/повторов.
  var PRESETS = [
    {
      id: 'conservative',
      label: 'Консервативный',
      note: 'Без маркетплейс-эффектов: только первая сделка, без роутера и повторов',
      patch: {
        router: { matchRate: 0.0, pApprovalStep2: 0, pApprovalStep3: 0 },
        cross:  { pCard: 0, pInsurance: 0 },
        crm:    { repeatRate12m: 0.05, marginRepeat: 1200, churnMonthly: 0.18 },
        tier:   { bonusPerTier: 0 },
        ltvFactor: 1.05, targetRepeatShare: 0.04
      }
    },
    {
      id: 'base',
      label: 'Базовый',
      note: 'Текущая модель PNL: умеренный роутер, репит 30%, без тиров',
      patch: {
        router: { matchRate: 0.42, pApprovalStep2: 0.18, pApprovalStep3: 0.09,
                  payoutSecondary: 2400, payoutTertiary: 4500 },
        cross:  { pCard: 0.12, pInsurance: 0.07, payoutCross: 1500 },
        crm:    { repeatRate12m: 0.30, marginRepeat: 1800, churnMonthly: 0.10 },
        tier:   { bonusPerTier: 0.06, volumePerTier: 5000 },
        ltvFactor: 1.34, targetRepeatShare: 0.06
      }
    },
    {
      id: 'marketplace_mature',
      label: 'Маркетплейс зрелый',
      note: 'Все 4 механики: match 55%, repeat 35%, cross-card 18%, tier +12%',
      patch: {
        router: { matchRate: 0.55, pApprovalStep2: 0.22, pApprovalStep3: 0.12,
                  payoutSecondary: 2600, payoutTertiary: 5000, attributionShare: 1.0 },
        cross:  { pCard: 0.18, pInsurance: 0.10, payoutCross: 1700 },
        crm:    { repeatRate12m: 0.35, marginRepeat: 2100, churnMonthly: 0.07 },
        tier:   { bonusPerTier: 0.12, volumePerTier: 4000 },
        ltvFactor: 1.62, targetRepeatShare: 0.10,
        issuedToApprovalRate: 0.80
      }
    }
  ];

  // ===== Утилиты =====
  function clone(x) { return JSON.parse(JSON.stringify(x)); }
  function get(obj, path) {
    return path.split('.').reduce(function (o, k) { return o == null ? undefined : o[k]; }, obj);
  }
  function set(obj, path, value) {
    var keys = path.split('.'); var cur = obj;
    for (var i = 0; i < keys.length - 1; i++) {
      if (cur[keys[i]] == null) cur[keys[i]] = {};
      cur = cur[keys[i]];
    }
    cur[keys[keys.length - 1]] = value;
    return obj;
  }
  function deepMerge(target, patch) {
    if (!patch) return target;
    Object.keys(patch).forEach(function (k) {
      var v = patch[k];
      if (v && typeof v === 'object' && !Array.isArray(v) && target[k] && typeof target[k] === 'object') {
        deepMerge(target[k], v);
      } else {
        target[k] = v;
      }
    });
    return target;
  }
  function sum(a) { return a.reduce(function (x, y) { return x + (Number(y) || 0); }, 0); }
  function cumulative(a) {
    var out = []; var s = 0;
    for (var i = 0; i < a.length; i++) { s += Number(a[i]) || 0; out.push(s); }
    return out;
  }

  // ===== Маркетплейс-механики =====

  // §2.1: Smart Safe Router — отказы партнёра №1 уходят к №2/№3 с p(apv).
  // Возвращает доп. выдачи и доп. выручку на канал, плюс blended-метрики.
  function applyRouter(channelInfo, router) {
    var rejected = Math.max(0, channelInfo.approvals_potential - channelInfo.approvals_primary);
    var routed = rejected * (router.matchRate || 0);
    var savedStep2 = routed * (router.pApprovalStep2 || 0);
    var savedStep3 = (routed - savedStep2) * (router.pApprovalStep3 || 0);
    var routerIssuances = savedStep2 + savedStep3;
    var routerRevenue =
      savedStep2 * (router.payoutSecondary || 0) +
      savedStep3 * (router.payoutTertiary || 0);
    var attributed = routerRevenue * (router.attributionShare == null ? 1 : router.attributionShare);
    return {
      routed: routed,
      routerIssuances: routerIssuances,
      routerRevenue: routerRevenue,
      attributedRevenue: attributed
    };
  }

  // §2.2 + §2.3: Кросс-продажи и повторы поверх первой сделки.
  function applyRepeatAndCross(issuances, cross, crm) {
    var crossRevenue = issuances * (
      (cross.pCard || 0) * (cross.payoutCross || 0) +
      (cross.pInsurance || 0) * (cross.payoutCross || 0) * 0.8
    );
    // Геометрический хвост: за 12 мес. суммарно ≈ repeatRate12m выдач на каждого
    // первичного клиента, с ежемесячным оттоком churnMonthly.
    var rate = crm.repeatRate12m || 0;
    var churn = crm.churnMonthly || 0;
    var tail = 0;
    for (var t = 1; t <= 12; t++) tail += Math.pow(1 - churn, t);
    var repeatsPerClient = rate * (tail / 12);
    var repeatIssuances = issuances * repeatsPerClient;
    var repeatRevenue = repeatIssuances * (crm.marginRepeat || 0);
    return {
      crossRevenue: crossRevenue,
      repeatIssuances: repeatIssuances,
      repeatRevenue: repeatRevenue,
      ltvLiftPerIssuance: issuances > 0 ? (crossRevenue + repeatRevenue) / issuances : 0
    };
  }

  // §2.4: динамические тарифы партнёров от месячного объёма.
  function tierMultiplier(monthlyIssuances, tier) {
    if (!tier || !tier.volumePerTier) return 1.0;
    var tiers = Math.floor((monthlyIssuances || 0) / tier.volumePerTier);
    return 1 + (tier.bonusPerTier || 0) * tiers;
  }

  // ===== Validators (раздел 2) =====
  function validateCorridors(inputs) {
    var warnings = [];
    CORRIDORS.forEach(function (c) {
      var v = Number(get(inputs, c.path));
      if (!Number.isFinite(v)) return;
      if (v < c.min) warnings.push({
        path: c.path, label: c.label, value: v, severity: 'error',
        message: 'ниже коридора ' + c.min + '–' + c.max
      });
      else if (v > c.max) warnings.push({
        path: c.path, label: c.label, value: v, severity: 'error',
        message: 'выше коридора ' + c.min + '–' + c.max
      });
    });
    return warnings;
  }

  // ===== Главное: buildModel(inputs, base) =====
  // base = {months, revenue[], expenses[], visits[], offerClicks[], applications[],
  //         approvals[], trafficSEO[], trafficPPC[], trafficPR[], repeat[],
  //         budgetSEO[], budgetDirect[], budgetPR[], totals:{...}}
  function build(inputs, base) {
    inputs = deepMerge(clone(DEFAULT_INPUTS), inputs || {});
    var months = base.months || [];
    var n = months.length || base.revenue.length;

    // 1) Воронка → выдачи_первичные
    var primaryIssued = (base.approvals || []).map(function (a) {
      return a * (inputs.issuedToApprovalRate || 0.76);
    });

    // 2) Channel UE
    var channelDefs = [
      { key: 'SEO',           rev: base.revenueSEO,  cost: base.expensesSEO,  traffic: base.trafficSEO,  approvals_share: shareOf(base.trafficSEO, base.visits) },
      { key: 'Яндекс.Директ', rev: base.revenuePPC,  cost: base.expensesPPC,  traffic: base.trafficPPC,  approvals_share: shareOf(base.trafficPPC, base.visits) },
      { key: 'PR',            rev: base.revenuePR,   cost: base.expensesPR,   traffic: base.trafficPR,   approvals_share: shareOf(base.trafficPR,  base.visits) },
      { key: 'Повторный',     rev: base.revenueRepeat, cost: base.expensesRepeat, traffic: base.repeat,  approvals_share: base.repeat.map(function () { return 0; }) }
    ];

    // Аллокация фикс-костов по доле визитов (TZ §B3, через визиты по умолчанию).
    var totalVisitsByMonth = (base.visits || []).slice();
    var fixedCosts = (base.expensesFixed || []).map(function (v) {
      return v * (inputs.fixedCostMultiplier || 1);
    });

    var channels = channelDefs.map(function (cd) {
      var primaryIssuedCh = primaryIssued.map(function (v, i) {
        return v * (cd.approvals_share[i] || 0);
      });
      var routedAcc = { routed: 0, issuances: 0, revenue: 0, attributed: 0 };
      var monthly = [];
      var tierMonthly = [];
      for (var i = 0; i < n; i++) {
        var monthly_primary = primaryIssuedCh[i];
        var approvals_potential = (base.applications || [])[i] * (cd.approvals_share[i] || 0);
        var routerOut = applyRouter({
          approvals_potential: approvals_potential,
          approvals_primary: (base.approvals || [])[i] * (cd.approvals_share[i] || 0)
        }, inputs.router);
        var tierM = tierMultiplier(monthly_primary, inputs.tier);
        var firstRevenue = (cd.rev || [])[i] * tierM;
        var extras = applyRepeatAndCross(monthly_primary, inputs.cross, inputs.crm);
        var allocFixed = (fixedCosts[i] || 0) *
          ((totalVisitsByMonth[i] || 1) > 0 ? ((cd.traffic || [])[i] || 0) / (totalVisitsByMonth[i] || 1) : 0);
        var mediaCost = (cd.cost || [])[i] || 0;
        var fullCost = mediaCost + allocFixed;
        var revenue = firstRevenue + routerOut.attributedRevenue + extras.crossRevenue + extras.repeatRevenue;
        var totalIssued = monthly_primary + routerOut.routerIssuances;
        var cac = totalIssued > 0 ? fullCost / totalIssued : 0;
        var ltvPer = monthly_primary > 0 ? (firstRevenue + extras.crossRevenue + extras.repeatRevenue) / monthly_primary : 0;
        monthly.push({
          revenue: revenue,
          cost: fullCost,
          mediaCost: mediaCost,
          allocFixed: allocFixed,
          margin: revenue - fullCost,
          primaryIssued: monthly_primary,
          routerIssued: routerOut.routerIssuances,
          routerRevenue: routerOut.attributedRevenue,
          crossRevenue: extras.crossRevenue,
          repeatRevenue: extras.repeatRevenue,
          cac: cac,
          ltvPer: ltvPer,
          tierMult: tierM
        });
        tierMonthly.push(tierM);
        routedAcc.routed += routerOut.routed;
        routedAcc.issuances += routerOut.routerIssuances;
        routedAcc.revenue += routerOut.routerRevenue;
        routedAcc.attributed += routerOut.attributedRevenue;
      }
      var totalRev = sum(monthly.map(function (m) { return m.revenue; }));
      var totalCost = sum(monthly.map(function (m) { return m.cost; }));
      var totalIssued = sum(monthly.map(function (m) { return m.primaryIssued + m.routerIssued; }));
      var cac = totalIssued > 0 ? totalCost / totalIssued : 0;
      var ltvPer = sum(monthly.map(function (m) { return m.primaryIssued; })) > 0
        ? totalRev / sum(monthly.map(function (m) { return m.primaryIssued; }))
        : 0;
      var ltvCac = cac > 0 ? ltvPer / cac : Infinity;
      // payback_M: первый месяц, где накопл. маржа канала >= 0.
      var cumM = cumulative(monthly.map(function (m) { return m.margin; }));
      var paybackIdx = cumM.findIndex(function (v) { return v >= 0; });
      return {
        key: cd.key,
        monthly: monthly,
        totals: {
          revenue: totalRev,
          cost: totalCost,
          margin: totalRev - totalCost,
          issued: totalIssued,
          primaryIssued: sum(monthly.map(function (m) { return m.primaryIssued; })),
          routerIssued: routedAcc.issuances,
          routerRevenue: routedAcc.attributed,
          cac: cac,
          ltvPer: ltvPer,
          ltvCac: ltvCac,
          paybackMonth: paybackIdx >= 0 ? paybackIdx : null,
          paybackLabel: paybackIdx >= 0 && months[paybackIdx] ? months[paybackIdx] : '—'
        }
      };
    });

    // 3) CJM-граф (для виджета waterfall) — 4 ветки: target / rejected / noncore / overdue.
    var cjm = buildCjm(channels, base, inputs);

    // 4) Сводный PnL — складываем revenue/cost по каналам, сравниваем с baseline.
    var totalRevenueMonthly = months.map(function (_, i) {
      return channels.reduce(function (acc, ch) { return acc + ch.monthly[i].revenue; }, 0);
    });
    var totalCostMonthly = months.map(function (_, i) {
      return channels.reduce(function (acc, ch) { return acc + ch.monthly[i].cost; }, 0);
    });
    var totalMarginMonthly = totalRevenueMonthly.map(function (v, i) { return v - totalCostMonthly[i]; });
    var cumMargin = cumulative(totalMarginMonthly);
    var firstProfitIdx = totalMarginMonthly.findIndex(function (v) { return v > 0; });
    var paybackIdx = cumMargin.findIndex(function (v) { return v >= 0; });

    var pnl = {
      months: months,
      revenue: totalRevenueMonthly,
      cost: totalCostMonthly,
      margin: totalMarginMonthly,
      cumMargin: cumMargin,
      firstProfitMonth: firstProfitIdx >= 0 ? months[firstProfitIdx] : null,
      firstProfitIndex: firstProfitIdx,
      paybackMonth: paybackIdx >= 0 ? months[paybackIdx] : null,
      paybackIndex: paybackIdx,
      maxDrawdown: Math.min.apply(null, cumMargin),
      totals: {
        revenue: sum(totalRevenueMonthly),
        cost: sum(totalCostMonthly),
        margin: sum(totalMarginMonthly)
      }
    };

    // 5) KPI блок + светофор юнит-экономики
    var kpis = computeKpis(channels, pnl, inputs);

    // 6) Validators
    var validators = validateCorridors(inputs);

    return {
      inputs: inputs,
      channels: channels,
      cjm: cjm,
      pnl: pnl,
      kpis: kpis,
      validators: validators
    };
  }

  function shareOf(arr, total) {
    return (arr || []).map(function (v, i) {
      var t = (total || [])[i] || 0;
      return t > 0 ? (v || 0) / t : 0;
    });
  }

  // CJM ветки — Target (ЦФ), Rejected (CPA), Non-core (банк), Overdue (БФЛ).
  function buildCjm(channels, base, inputs) {
    var monthCount = (base.months || []).length || 1;
    var totalApprovals = sum(base.approvals || []);
    var totalApplications = sum(base.applications || []);
    var totalVisits = sum(base.visits || []);
    var rejected = Math.max(0, totalApplications - totalApprovals);
    var marketingSpend = sum(base.expenses || []);

    var matchRate = inputs.router.matchRate || 0;
    var routed = rejected * matchRate;
    var step2 = routed * (inputs.router.pApprovalStep2 || 0);
    var step3 = (routed - step2) * (inputs.router.pApprovalStep3 || 0);

    var noncoreUsers = (base.cjmNoncoreUsers || 0) || 126000;
    var overdueUsers = (base.cjmOverdueUsers || 0) || 92000;

    var primaryIssued = totalApprovals * (inputs.issuedToApprovalRate || 0.76);
    var targetRevenue = primaryIssued * ((base.totals && base.totals.revenue) || 0) /
      Math.max(1, totalApprovals * (inputs.issuedToApprovalRate || 0.76));

    var branches = [
      {
        id: 'target', name: 'Целевые (ЦФ)',
        traffic: totalVisits * matchRate,
        approvals: primaryIssued,
        revenue: targetRevenue,
        payout: inputs.partners.payout.pdl || inputs.partnerPayout || 2400,
        cost: marketingSpend * 0.55,
        cr_to_deal: primaryIssued > 0 ? primaryIssued / Math.max(1, totalVisits * matchRate) : 0
      },
      {
        id: 'rejected', name: 'Отказники (роутер)',
        traffic: rejected,
        approvals: step2,
        revenue: step2 * (inputs.router.payoutSecondary || 2400),
        payout: inputs.router.payoutSecondary || 2400,
        cost: marketingSpend * 0.20,
        cr_to_deal: rejected > 0 ? step2 / rejected : 0
      },
      {
        id: 'noncore', name: 'Непрофильные (банк)',
        traffic: noncoreUsers,
        approvals: noncoreUsers * 0.04,
        revenue: noncoreUsers * 0.04 * (inputs.partners.payout.il || 3500),
        payout: inputs.partners.payout.il || 3500,
        cost: marketingSpend * 0.15,
        cr_to_deal: 0.04
      },
      {
        id: 'overdue', name: 'Перегруженные (БФЛ)',
        traffic: overdueUsers,
        approvals: step3 + overdueUsers * 0.02,
        revenue: step3 * (inputs.router.payoutTertiary || 4500) + overdueUsers * 0.02 * (inputs.router.payoutTertiary || 4500),
        payout: inputs.router.payoutTertiary || 4500,
        cost: marketingSpend * 0.10,
        cr_to_deal: overdueUsers > 0 ? (step3 + overdueUsers * 0.02) / (overdueUsers + step3) : 0
      }
    ];
    branches.forEach(function (b) {
      b.arpu = b.traffic > 0 ? b.revenue / b.traffic : 0;
      b.cac = b.approvals > 0 ? b.cost / b.approvals : 0;
      b.romi = b.cost > 0 ? (b.revenue - b.cost) / b.cost * 100 : 0;
      b.traffic_monthly = b.traffic / monthCount;
    });

    var totalRevenue = branches.reduce(function (a, b) { return a + b.revenue; }, 0);
    var targetConversions = Math.max(1, branches[0].approvals);
    var blendedCac = Math.max(1,
      (marketingSpend - branches[1].revenue - branches[2].revenue - branches[3].revenue) / targetConversions);
    var baseCac = marketingSpend / targetConversions;

    return {
      branches: branches,
      globalMetrics: {
        marketingSpend: marketingSpend,
        totalRevenue: totalRevenue,
        margin: totalRevenue - marketingSpend,
        romi: marketingSpend > 0 ? (totalRevenue - marketingSpend) / marketingSpend * 100 : 0,
        baseCac: baseCac,
        blendedCac: blendedCac,
        cacReductionPct: baseCac > 0 ? (baseCac - blendedCac) / baseCac * 100 : 0
      }
    };
  }

  function computeKpis(channels, pnl, inputs) {
    var th = inputs.thresholds || DEFAULT_INPUTS.thresholds;
    var perChannel = channels.map(function (ch) {
      var lc = ch.totals.ltvCac;
      var pb = ch.totals.paybackMonth;
      var status = 'red';
      if (Number.isFinite(lc) && lc >= th.ltvCacGreen && pb !== null && pb <= th.paybackGreenMonths) status = 'green';
      else if (Number.isFinite(lc) && lc >= th.ltvCacYellow && (pb === null || pb <= th.paybackYellowMonths)) status = 'yellow';
      return { key: ch.key, ltvCac: lc, paybackMonth: pb, paybackLabel: ch.totals.paybackLabel, status: status };
    });
    var totalLtvPer = pnl.totals.revenue && channels.length
      ? channels.reduce(function (a, ch) { return a + ch.totals.ltvPer * ch.totals.primaryIssued; }, 0) /
        Math.max(1, channels.reduce(function (a, ch) { return a + ch.totals.primaryIssued; }, 0))
      : 0;
    var totalCac = pnl.totals.cost / Math.max(1,
      channels.reduce(function (a, ch) { return a + ch.totals.issued; }, 0));
    return {
      perChannel: perChannel,
      totalLtvPer: totalLtvPer,
      totalCac: totalCac,
      totalLtvCac: totalCac > 0 ? totalLtvPer / totalCac : Infinity,
      paybackMonth: pnl.paybackMonth,
      paybackIndex: pnl.paybackIndex,
      firstProfitMonth: pnl.firstProfitMonth
    };
  }

  // ===== PnL diff vs baseline JSON =====
  // Возвращает помесячные дельты модель vs PNL для smoke-теста (раздел F2+F3).
  function comparePnl(model, baseline) {
    if (!baseline || !baseline.summary) return null;
    var monthsBase = baseline.summary.revenue_total || [];
    var monthsMdl = model.pnl.revenue || [];
    var n = Math.min(monthsBase.length, monthsMdl.length);
    var rows = [];
    var worst = { revenue: 0, profit: 0 };
    for (var i = 0; i < n; i++) {
      var revPlan = monthsBase[i] || 0;
      var revMdl = monthsMdl[i] || 0;
      var profitPlan = (baseline.summary.profit_total || [])[i] || 0;
      var profitMdl = (model.pnl.margin || [])[i] || 0;
      var dRev = revPlan ? (revMdl - revPlan) / revPlan : 0;
      var dProfit = profitPlan ? (profitMdl - profitPlan) / Math.abs(profitPlan) : 0;
      rows.push({
        month: baseline.months[i], revPlan: revPlan, revModel: revMdl,
        revDelta: dRev, profitPlan: profitPlan, profitModel: profitMdl, profitDelta: dProfit
      });
      if (Math.abs(dRev) > Math.abs(worst.revenue)) worst.revenue = dRev;
      if (Math.abs(dProfit) > Math.abs(worst.profit)) worst.profit = dProfit;
    }
    return { rows: rows, worst: worst };
  }

  // ===== SEO stages: shift SEO traffic curve (раздел D2) =====
  // Берёт массив этапов с {stage_no, week_start, week_end, traffic_uplift_pct,
  // approval_uplift_pct, checked}, возвращает множитель на каждый месяц горизонта.
  function seoUpliftSeries(stages, monthsCount, weeksPerMonth) {
    weeksPerMonth = weeksPerMonth || 4;
    var trafficMult = new Array(monthsCount).fill(1);
    var approvalMult = new Array(monthsCount).fill(1);
    (stages || []).forEach(function (st) {
      if (!st.checked) return;
      var mStart = Math.max(0, Math.floor(((st.week_start || 1) - 1) / weeksPerMonth));
      var mEnd = Math.min(monthsCount - 1, Math.floor(((st.week_end || 4) - 1) / weeksPerMonth));
      var trafBoost = (st.traffic_uplift_pct || 0) / 100;
      var apvBoost = (st.approval_uplift_pct || 0) / 100;
      for (var i = mStart; i <= mEnd; i++) {
        // линейное нарастание эффекта в окне этапа
        var progress = (mEnd - mStart) > 0 ? (i - mStart) / (mEnd - mStart) : 1;
        trafficMult[i] *= 1 + trafBoost * (0.4 + 0.6 * progress);
        approvalMult[i] *= 1 + apvBoost * (0.4 + 0.6 * progress);
      }
    });
    return { trafficMult: trafficMult, approvalMult: approvalMult };
  }

  // ===== Экспорт API =====
  global.EconomicsModel = {
    DEFAULT_INPUTS: DEFAULT_INPUTS,
    CORRIDORS: CORRIDORS,
    PRESETS: PRESETS,
    build: build,
    applyRouter: applyRouter,
    applyRepeatAndCross: applyRepeatAndCross,
    tierMultiplier: tierMultiplier,
    validateCorridors: validateCorridors,
    comparePnl: comparePnl,
    seoUpliftSeries: seoUpliftSeries,
    deepMerge: deepMerge,
    clone: clone,
    get: get,
    set: set
  };
})(typeof window !== 'undefined' ? window : globalThis);
