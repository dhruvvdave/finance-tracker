"use strict";

(() => {
  const STORAGE_KEY = "transactions";
  const THEME_KEY = "theme";
  const PAGE_SIZE = 10;

  const CATEGORIES = {
    income: [
      { value: "salary", label: "Salary" },
      { value: "freelance", label: "Freelance" },
      { value: "investment", label: "Investment" },
      { value: "other", label: "Other income" },
    ],
    expense: [
      { value: "food", label: "Food & dining" },
      { value: "transportation", label: "Transport" },
      { value: "bills", label: "Bills & utilities" },
      { value: "entertainment", label: "Entertainment" },
      { value: "healthcare", label: "Healthcare" },
      { value: "shopping", label: "Shopping" },
      { value: "other", label: "Other expense" },
    ],
  };

  const currency = new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
  });
  const compactCurrency = new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    notation: "compact",
    maximumFractionDigits: 1,
  });

  // ----- Dates ------------------------------------------------------------
  // Dates are stored as local "YYYY-MM-DD" strings. Parsing them through
  // `new Date(string)` would treat them as UTC and shift the day in western
  // timezones, so they're split by hand everywhere.

  const pad = (n) => String(n).padStart(2, "0");

  const toDateKey = (d) =>
    `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

  const parseDateKey = (key) => {
    const [y, m, d] = key.split("-").map(Number);
    return new Date(y, m - 1, d);
  };

  const formatDateKey = (key) =>
    parseDateKey(key).toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
    });

  const monthKeyOf = (dateKey) => dateKey.slice(0, 7);

  const formatMonthKey = (mk, opts = { month: "long", year: "numeric" }) => {
    const [y, m] = mk.split("-").map(Number);
    return new Date(y, m - 1, 1).toLocaleDateString("en-US", opts);
  };

  const prevMonthKey = (mk) => {
    let [y, m] = mk.split("-").map(Number);
    if (--m === 0) {
      m = 12;
      y--;
    }
    return `${y}-${pad(m)}`;
  };

  const plural = (n, one, many = `${one}s`) => (n === 1 ? one : many);

  const uid = () =>
    typeof crypto !== "undefined" && crypto.randomUUID
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;

  // ----- Storage ----------------------------------------------------------

  function persist(list) {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(list));
    } catch {
      showToast("Couldn't save — browser storage is full or blocked.");
    }
  }

  // Loads saved transactions, upgrading records from earlier versions of the
  // app (no ids, ISO datetime dates) in place.
  function loadTransactions() {
    let raw = null;
    try {
      raw = JSON.parse(localStorage.getItem(STORAGE_KEY));
    } catch {
      /* corrupted storage — start fresh */
    }
    if (!Array.isArray(raw)) return [];

    let changed = false;
    const list = raw
      .filter(
        (t) =>
          t &&
          typeof t.description === "string" &&
          Number.isFinite(t.amount) &&
          (t.type === "income" || t.type === "expense")
      )
      .map((t) => {
        const next = { ...t };
        if (!next.id) {
          next.id = uid();
          changed = true;
        }
        if (typeof next.date !== "string" || next.date.length < 10) {
          next.date = toDateKey(new Date());
          changed = true;
        } else if (next.date.length > 10) {
          next.date = next.date.slice(0, 10);
          changed = true;
        }
        if (!Number.isFinite(next.createdAt)) {
          next.createdAt = Date.parse(t.date) || Date.now();
          changed = true;
        }
        if (typeof next.category !== "string") {
          next.category = "other";
          changed = true;
        }
        return next;
      });

    if (changed || list.length !== raw.length) persist(list);
    return list;
  }

  // ----- State ------------------------------------------------------------

  const state = {
    transactions: loadTransactions(),
    filters: { month: "all", category: "all", search: "", sort: "date-desc" },
    page: 1,
  };

  const $ = (id) => document.getElementById(id);

  const els = {
    form: $("transaction-form"),
    description: $("description"),
    amount: $("amount"),
    category: $("category"),
    date: $("date"),
    descriptionError: $("description-error"),
    amountError: $("amount-error"),
    dateError: $("date-error"),

    summaryIncome: $("summary-income"),
    summaryExpenses: $("summary-expenses"),
    summaryBalance: $("summary-balance"),
    summaryIncomeNote: $("summary-income-note"),
    summaryExpensesNote: $("summary-expenses-note"),
    summaryBalanceNote: $("summary-balance-note"),

    searchInput: $("search-input"),
    monthFilter: $("month-filter"),
    categoryFilter: $("category-filter"),
    sortSelect: $("sort-select"),

    list: $("transaction-list"),
    listCount: $("list-count"),
    rowTemplate: $("tx-row-template"),
    emptyState: $("empty-state"),
    emptyTitle: $("empty-title"),
    emptyText: $("empty-text"),
    clearFilters: $("clear-filters-btn"),

    pagination: $("pagination"),
    pagePrev: $("page-prev"),
    pageNext: $("page-next"),
    pageStatus: $("page-status"),

    statAvgDaily: $("stat-avg-daily"),
    statLargest: $("stat-largest"),
    statCount: $("stat-count"),
    statSavings: $("stat-savings"),

    exportBtn: $("export-btn"),
    themeToggle: $("theme-toggle"),
    toastRegion: $("toast-region"),
    chartsUnavailable: $("charts-unavailable"),
  };

  function categoryLabel(type, value) {
    const found = (CATEGORIES[type] || []).find((c) => c.value === value);
    return found ? found.label : "Other";
  }

  function selectedType() {
    return els.form.elements.type.value;
  }

  // ----- Filtering --------------------------------------------------------

  const comparators = {
    "date-desc": (a, b) =>
      b.date.localeCompare(a.date) || b.createdAt - a.createdAt,
    "date-asc": (a, b) =>
      a.date.localeCompare(b.date) || a.createdAt - b.createdAt,
    "amount-desc": (a, b) => b.amount - a.amount,
    "amount-asc": (a, b) => a.amount - b.amount,
  };

  function applyFilters(month = state.filters.month) {
    const { category, search, sort } = state.filters;
    const q = search.trim().toLowerCase();

    const list = state.transactions.filter((t) => {
      if (month !== "all" && monthKeyOf(t.date) !== month) return false;
      if (category !== "all") {
        const [ct, cv] = category.split(":");
        if (t.type !== ct || t.category !== cv) return false;
      }
      if (q) {
        const haystack = `${t.description} ${categoryLabel(t.type, t.category)}`.toLowerCase();
        if (!haystack.includes(q)) return false;
      }
      return true;
    });

    return list.sort(comparators[sort] || comparators["date-desc"]);
  }

  const totalsOf = (list) =>
    list.reduce(
      (acc, t) => {
        acc[t.type === "income" ? "income" : "expenses"] += t.amount;
        return acc;
      },
      { income: 0, expenses: 0 }
    );

  // ----- Rendering --------------------------------------------------------

  function rebuildMonthOptions() {
    const keys = [...new Set(state.transactions.map((t) => monthKeyOf(t.date)))]
      .sort()
      .reverse();

    if (state.filters.month !== "all" && !keys.includes(state.filters.month)) {
      state.filters.month = "all";
    }

    els.monthFilter.replaceChildren(
      new Option("All months", "all"),
      ...keys.map((k) => new Option(formatMonthKey(k), k))
    );
    els.monthFilter.value = state.filters.month;
  }

  function changeNote(el, current, previous, prevKey, downIsGood) {
    el.classList.remove("is-up", "is-down");
    const prevLabel = formatMonthKey(prevKey, { month: "short" });
    if (previous <= 0) {
      el.textContent = current > 0 ? `No data for ${prevLabel}` : "";
      return;
    }
    const pct = ((current - previous) / previous) * 100;
    if (Math.abs(pct) < 0.05) {
      el.textContent = `Same as ${prevLabel}`;
      return;
    }
    const arrow = pct > 0 ? "↑" : "↓";
    el.textContent = `${arrow} ${Math.abs(pct).toFixed(1)}% vs ${prevLabel}`;
    const good = downIsGood ? pct < 0 : pct > 0;
    el.classList.add(good ? "is-up" : "is-down");
  }

  function renderSummary(filtered) {
    const { income, expenses } = totalsOf(filtered);
    const balance = income - expenses;

    els.summaryIncome.textContent = currency.format(income);
    els.summaryExpenses.textContent = currency.format(expenses);
    els.summaryBalance.textContent = currency.format(balance);
    els.summaryBalance.classList.toggle("is-negative", balance < 0);

    const month = state.filters.month;
    if (month === "all") {
      const incomeCount = filtered.filter((t) => t.type === "income").length;
      els.summaryIncomeNote.textContent = `${incomeCount} ${plural(incomeCount, "entry", "entries")}`;
      els.summaryIncomeNote.className = "summary-note";
      const expenseCount = filtered.length - incomeCount;
      els.summaryExpensesNote.textContent = `${expenseCount} ${plural(expenseCount, "entry", "entries")}`;
      els.summaryExpensesNote.className = "summary-note";
      els.summaryBalanceNote.textContent = "All months";
    } else {
      const prevKey = prevMonthKey(month);
      const prev = totalsOf(applyFilters(prevKey));
      changeNote(els.summaryIncomeNote, income, prev.income, prevKey, false);
      changeNote(els.summaryExpensesNote, expenses, prev.expenses, prevKey, true);
      els.summaryBalanceNote.textContent = formatMonthKey(month);
    }
  }

  function renderList(filtered) {
    const total = state.transactions.length;
    els.listCount.textContent =
      filtered.length === total
        ? `${total} ${plural(total, "transaction")}`
        : `${filtered.length} of ${total}`;

    const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
    state.page = Math.min(state.page, totalPages);
    const start = (state.page - 1) * PAGE_SIZE;
    const pageItems = filtered.slice(start, start + PAGE_SIZE);

    els.list.replaceChildren(
      ...pageItems.map((t) => {
        const row = els.rowTemplate.content.firstElementChild.cloneNode(true);
        row.dataset.id = t.id;
        const dot = row.querySelector(".tx-dot");
        if (t.type === "income") {
          dot.classList.add("is-income");
        } else {
          dot.style.setProperty("--dot", `var(--cat-${t.category})`);
        }
        row.querySelector(".tx-desc").textContent = t.description;
        row.querySelector(".tx-meta").textContent =
          `${categoryLabel(t.type, t.category)} · ${formatDateKey(t.date)}`;
        const amount = row.querySelector(".tx-amount");
        amount.textContent =
          (t.type === "income" ? "+" : "−") + currency.format(t.amount);
        amount.classList.toggle("is-income", t.type === "income");
        row
          .querySelector(".tx-delete")
          .setAttribute("aria-label", `Delete ${t.description}`);
        return row;
      })
    );

    const empty = pageItems.length === 0;
    els.emptyState.hidden = !empty;
    if (empty) {
      const noData = total === 0;
      els.emptyTitle.textContent = noData
        ? "No transactions yet"
        : "Nothing matches";
      els.emptyText.textContent = noData
        ? "Add your first income or expense above to get started."
        : "Try a different search or widen the filters.";
      els.clearFilters.hidden = noData;
    }

    els.pagination.hidden = totalPages <= 1;
    els.pageStatus.textContent = `Page ${state.page} of ${totalPages}`;
    els.pagePrev.disabled = state.page <= 1;
    els.pageNext.disabled = state.page >= totalPages;
  }

  function renderStats(filtered) {
    const expenses = filtered.filter((t) => t.type === "expense");
    const { income, expenses: totalExp } = totalsOf(filtered);
    const month = state.filters.month;

    let avg;
    if (month === "all") {
      const cutoff = new Date();
      cutoff.setDate(cutoff.getDate() - 30);
      const cutoffKey = toDateKey(cutoff);
      const recent = expenses.filter((t) => t.date >= cutoffKey);
      avg = recent.reduce((s, t) => s + t.amount, 0) / 30;
    } else {
      const [y, m] = month.split("-").map(Number);
      const now = new Date();
      const isCurrent = now.getFullYear() === y && now.getMonth() === m - 1;
      const days = isCurrent ? now.getDate() : new Date(y, m, 0).getDate();
      avg = totalExp / days;
    }

    els.statAvgDaily.textContent = currency.format(avg);
    els.statLargest.textContent = currency.format(
      expenses.length ? Math.max(...expenses.map((t) => t.amount)) : 0
    );
    els.statCount.textContent = String(filtered.length);
    els.statSavings.textContent =
      income > 0 ? `${(((income - totalExp) / income) * 100).toFixed(1)}%` : "—";
  }

  // ----- Charts -----------------------------------------------------------

  let charts = null;

  const cssVar = (name) =>
    getComputedStyle(document.documentElement).getPropertyValue(name).trim();

  function chartTheme() {
    return {
      income: cssVar("--chart-income"),
      expense: cssVar("--chart-expense"),
      grid: cssVar("--chart-grid"),
      tick: cssVar("--text-faint"),
      label: cssVar("--text-muted"),
      surface: cssVar("--surface"),
    };
  }

  function initCharts() {
    if (typeof Chart === "undefined") {
      els.chartsUnavailable.hidden = false;
      document.querySelectorAll(".chart").forEach((f) => (f.hidden = true));
      return;
    }

    Chart.defaults.font.family = getComputedStyle(document.body).fontFamily;
    Chart.defaults.font.size = 12;

    const doughnutOpts = (extraTooltip) => ({
      responsive: true,
      maintainAspectRatio: false,
      cutout: "68%",
      plugins: {
        legend: {
          position: "bottom",
          labels: { usePointStyle: true, boxWidth: 8, padding: 14 },
        },
        tooltip: {
          callbacks: {
            label: (ctx) =>
              ` ${ctx.label}: ${currency.format(ctx.parsed)}${
                extraTooltip ? extraTooltip(ctx) : ""
              }`,
          },
        },
      },
    });

    charts = {
      balance: new Chart($("chart-balance"), {
        type: "doughnut",
        data: {
          labels: ["Income", "Expenses"],
          datasets: [{ data: [0, 0], borderWidth: 2 }],
        },
        options: doughnutOpts(),
      }),

      category: new Chart($("chart-category"), {
        type: "doughnut",
        data: { labels: [], datasets: [{ data: [], borderWidth: 2 }] },
        options: doughnutOpts((ctx) => {
          const total = ctx.dataset.data.reduce((a, b) => a + b, 0);
          return total ? ` (${((ctx.parsed / total) * 100).toFixed(1)}%)` : "";
        }),
      }),

      trend: new Chart($("chart-trend"), {
        type: "bar",
        data: {
          labels: [],
          datasets: [
            { label: "Income", data: [], borderRadius: 4, maxBarThickness: 14 },
            { label: "Expenses", data: [], borderRadius: 4, maxBarThickness: 14 },
          ],
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          plugins: {
            legend: {
              position: "bottom",
              labels: { usePointStyle: true, boxWidth: 8, padding: 14 },
            },
            tooltip: {
              callbacks: {
                label: (ctx) =>
                  ` ${ctx.dataset.label}: ${currency.format(ctx.parsed.y)}`,
              },
            },
          },
          scales: {
            y: {
              beginAtZero: true,
              border: { display: false },
              ticks: {
                maxTicksLimit: 5,
                callback: (v) => compactCurrency.format(v),
              },
            },
            x: {
              grid: { display: false },
              border: { display: false },
            },
          },
        },
      }),
    };
  }

  function trendData() {
    const now = new Date();
    const months = [];
    for (let i = 5; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      months.push(`${d.getFullYear()}-${pad(d.getMonth() + 1)}`);
    }
    const byMonth = Object.fromEntries(
      months.map((k) => [k, { income: 0, expenses: 0 }])
    );
    for (const t of state.transactions) {
      const bucket = byMonth[monthKeyOf(t.date)];
      if (bucket) bucket[t.type === "income" ? "income" : "expenses"] += t.amount;
    }
    return {
      labels: months.map((k, i) =>
        i === 0 || k.endsWith("-01")
          ? formatMonthKey(k, { month: "short", year: "2-digit" })
          : formatMonthKey(k, { month: "short" })
      ),
      income: months.map((k) => byMonth[k].income),
      expenses: months.map((k) => byMonth[k].expenses),
    };
  }

  function refreshCharts(filtered) {
    if (!charts) return;
    const theme = chartTheme();
    const { income, expenses } = totalsOf(filtered);

    Chart.defaults.color = theme.label;

    // Income vs expenses
    const balanceEmpty = income === 0 && expenses === 0;
    $("chart-balance-note").hidden = !balanceEmpty;
    charts.balance.canvas.parentElement.hidden = balanceEmpty;
    const balanceSet = charts.balance.data.datasets[0];
    balanceSet.data = [income, expenses];
    balanceSet.backgroundColor = [theme.income, theme.expense];
    balanceSet.borderColor = theme.surface;
    charts.balance.update();

    // Spending by category, largest first
    const byCategory = new Map();
    for (const t of filtered) {
      if (t.type !== "expense") continue;
      byCategory.set(t.category, (byCategory.get(t.category) || 0) + t.amount);
    }
    const sorted = [...byCategory.entries()].sort((a, b) => b[1] - a[1]);
    const categoryEmpty = sorted.length === 0;
    $("chart-category-note").hidden = !categoryEmpty;
    charts.category.canvas.parentElement.hidden = categoryEmpty;
    charts.category.data.labels = sorted.map(([v]) => categoryLabel("expense", v));
    const categorySet = charts.category.data.datasets[0];
    categorySet.data = sorted.map(([, amt]) => amt);
    categorySet.backgroundColor = sorted.map(([v]) => cssVar(`--cat-${v}`));
    categorySet.borderColor = theme.surface;
    charts.category.update();

    // Six-month trend (always across all transactions)
    const trend = trendData();
    charts.trend.data.labels = trend.labels;
    charts.trend.data.datasets[0].data = trend.income;
    charts.trend.data.datasets[0].backgroundColor = theme.income;
    charts.trend.data.datasets[1].data = trend.expenses;
    charts.trend.data.datasets[1].backgroundColor = theme.expense;
    charts.trend.options.scales.y.grid = { color: theme.grid };
    charts.trend.options.scales.y.ticks.color = theme.tick;
    charts.trend.options.scales.x.ticks = { color: theme.tick };
    charts.trend.update();
  }

  let lastFiltered = [];

  function renderAll() {
    rebuildMonthOptions();
    lastFiltered = applyFilters();
    renderSummary(lastFiltered);
    renderList(lastFiltered);
    renderStats(lastFiltered);
    refreshCharts(lastFiltered);
  }

  // ----- Toast ------------------------------------------------------------

  let toastTimer = null;

  function showToast(message, action) {
    clearTimeout(toastTimer);

    const toast = document.createElement("div");
    toast.className = "toast";
    toast.setAttribute("role", "status");

    const text = document.createElement("span");
    text.textContent = message;
    toast.append(text);

    if (action) {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.textContent = action.label;
      btn.addEventListener("click", () => {
        clearTimeout(toastTimer);
        els.toastRegion.replaceChildren();
        action.run();
      });
      toast.append(btn);
    }

    els.toastRegion.replaceChildren(toast);
    toastTimer = setTimeout(
      () => els.toastRegion.replaceChildren(),
      action ? 6000 : 3200
    );
  }

  // ----- Mutations --------------------------------------------------------

  function setFieldError(input, errorEl, message) {
    const invalid = Boolean(message);
    input.setAttribute("aria-invalid", invalid ? "true" : "false");
    if (invalid) {
      errorEl.textContent = message;
      input.setAttribute("aria-describedby", errorEl.id);
    } else {
      input.removeAttribute("aria-describedby");
    }
    errorEl.hidden = !invalid;
  }

  function addTransaction(event) {
    event.preventDefault();

    const description = els.description.value.trim();
    const amount = Math.round(parseFloat(els.amount.value) * 100) / 100;
    const date = els.date.value;

    setFieldError(
      els.description,
      els.descriptionError,
      description ? "" : "Enter a short description."
    );
    setFieldError(
      els.amount,
      els.amountError,
      Number.isFinite(amount) && amount > 0
        ? ""
        : "Enter an amount greater than zero."
    );
    setFieldError(
      els.date,
      els.dateError,
      /^\d{4}-\d{2}-\d{2}$/.test(date) ? "" : "Pick a valid date."
    );

    const firstInvalid = els.form.querySelector('[aria-invalid="true"]');
    if (firstInvalid) {
      firstInvalid.focus();
      return;
    }

    state.transactions.push({
      id: uid(),
      description,
      amount,
      type: selectedType(),
      category: els.category.value,
      date,
      createdAt: Date.now(),
    });
    persist(state.transactions);

    // Keep the new entry visible if a different month was selected.
    if (state.filters.month !== "all" && state.filters.month !== monthKeyOf(date)) {
      state.filters.month = monthKeyOf(date);
    }
    state.page = 1;

    els.description.value = "";
    els.amount.value = "";
    els.description.focus();
    renderAll();
  }

  function removeTransaction(id) {
    const index = state.transactions.findIndex((t) => t.id === id);
    if (index === -1) return;

    const [removed] = state.transactions.splice(index, 1);
    persist(state.transactions);
    renderAll();

    const short =
      removed.description.length > 28
        ? `${removed.description.slice(0, 28)}…`
        : removed.description;
    showToast(`Deleted “${short}”`, {
      label: "Undo",
      run: () => {
        state.transactions.splice(
          Math.min(index, state.transactions.length),
          0,
          removed
        );
        persist(state.transactions);
        renderAll();
      },
    });
  }

  // ----- Export -----------------------------------------------------------

  function csvCell(value) {
    let s = String(value);
    // Neutralize spreadsheet formula injection from user-entered text.
    if (/^[=+@\t]/.test(s)) s = `'${s}`;
    return `"${s.replace(/"/g, '""')}"`;
  }

  function exportCSV() {
    if (lastFiltered.length === 0) {
      showToast("Nothing to export for the current filters.");
      return;
    }

    const rows = [["Date", "Description", "Category", "Type", "Amount"]];
    for (const t of lastFiltered) {
      rows.push([
        t.date,
        t.description,
        categoryLabel(t.type, t.category),
        t.type,
        (t.type === "expense" ? -t.amount : t.amount).toFixed(2),
      ]);
    }

    // BOM so Excel opens the file as UTF-8.
    const csv =
      "\uFEFF" + rows.map((r) => r.map(csvCell).join(",")).join("\r\n");
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = `finance-tracker-${toDateKey(new Date())}.csv`;
    a.click();
    URL.revokeObjectURL(url);

    const n = lastFiltered.length;
    showToast(`Exported ${n} ${plural(n, "transaction")}.`);
  }

  // ----- Theme ------------------------------------------------------------

  function syncThemeToggle() {
    const dark = document.documentElement.dataset.theme === "dark";
    els.themeToggle.setAttribute(
      "aria-label",
      dark ? "Switch to light theme" : "Switch to dark theme"
    );
  }

  function toggleTheme() {
    const dark = document.documentElement.dataset.theme === "dark";
    if (dark) {
      delete document.documentElement.dataset.theme;
    } else {
      document.documentElement.dataset.theme = "dark";
    }
    try {
      localStorage.setItem(THEME_KEY, dark ? "light" : "dark");
    } catch {
      /* theme just won't persist */
    }
    syncThemeToggle();
    refreshCharts(lastFiltered);
  }

  // ----- Wiring -----------------------------------------------------------

  function buildCategoryOptions() {
    els.category.replaceChildren(
      ...CATEGORIES[selectedType()].map((c) => new Option(c.label, c.value))
    );
  }

  function buildCategoryFilter() {
    const groups = [
      ["Expenses", "expense"],
      ["Income", "income"],
    ].map(([label, type]) => {
      const group = document.createElement("optgroup");
      group.label = label;
      group.append(
        ...CATEGORIES[type].map((c) => new Option(c.label, `${type}:${c.value}`))
      );
      return group;
    });
    els.categoryFilter.replaceChildren(
      new Option("All categories", "all"),
      ...groups
    );
  }

  const debounce = (fn, ms) => {
    let timer;
    return (...args) => {
      clearTimeout(timer);
      timer = setTimeout(() => fn(...args), ms);
    };
  };

  function init() {
    els.date.value = toDateKey(new Date());
    buildCategoryOptions();
    buildCategoryFilter();
    syncThemeToggle();

    els.form.addEventListener("submit", addTransaction);
    for (const radio of els.form.querySelectorAll('input[name="type"]')) {
      radio.addEventListener("change", buildCategoryOptions);
    }
    for (const input of [els.description, els.amount, els.date]) {
      input.addEventListener("input", () => {
        const errorEl = $(`${input.id}-error`);
        if (errorEl) setFieldError(input, errorEl, "");
      });
    }

    els.list.addEventListener("click", (event) => {
      const btn = event.target.closest(".tx-delete");
      if (btn) removeTransaction(btn.closest(".tx").dataset.id);
    });

    const onFilterChange = (key) => (event) => {
      state.filters[key] = event.target.value;
      state.page = 1;
      renderAll();
    };
    els.monthFilter.addEventListener("change", onFilterChange("month"));
    els.categoryFilter.addEventListener("change", onFilterChange("category"));
    els.sortSelect.addEventListener("change", onFilterChange("sort"));
    els.searchInput.addEventListener(
      "input",
      debounce((event) => {
        state.filters.search = event.target.value;
        state.page = 1;
        renderAll();
      }, 200)
    );

    els.clearFilters.addEventListener("click", () => {
      state.filters = { month: "all", category: "all", search: "", sort: state.filters.sort };
      els.searchInput.value = "";
      els.categoryFilter.value = "all";
      state.page = 1;
      renderAll();
    });

    els.pagePrev.addEventListener("click", () => {
      state.page--;
      renderList(lastFiltered);
    });
    els.pageNext.addEventListener("click", () => {
      state.page++;
      renderList(lastFiltered);
    });

    els.exportBtn.addEventListener("click", exportCSV);
    els.themeToggle.addEventListener("click", toggleTheme);

    initCharts();
    renderAll();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
