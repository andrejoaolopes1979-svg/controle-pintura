"use strict";

const STORAGE_KEY = "controle_pintura_pecas";

const STATUS = [
  { label: "Programação", short: "Programação", color: "s0" },
  { label: "Logística", short: "Logística", color: "s1" },
  { label: "Pintura", short: "Pintura", color: "s2" },
  { label: "Finalizadas", short: "Finalizadas", color: "s3" },
];

let pecas = [];
let currentId = null;
let editingId = null;
let selectedHistDay = null;

/* ============ Persistência ============ */

function readLocal(key) {
  try {
    return JSON.parse(localStorage.getItem(key)) || [];
  } catch (e) {
    return [];
  }
}

function normalizePeca(p) {
  p.liberadas = p.liberadas || 0;
  p.recebidas = p.recebidas || 0;
  p.pintadas = p.pintadas || 0;
  p.cor = p.cor || "";
  p.history = p.history || [];
  p.extra = !!p.extra;
  p.pre = !!p.pre;
  syncStatus(p, false);
}

function load() {
  pecas = readLocal(STORAGE_KEY);
  pecas.forEach(normalizePeca);
}

let persistTimer = null;

function persistLocal() {
  clearTimeout(persistTimer);
  persistTimer = setTimeout(() => {
    persistTimer = null;
    localStorage.setItem(STORAGE_KEY, JSON.stringify(pecas));
  }, 400);
}

function flushLocal() {
  if (persistTimer) {
    clearTimeout(persistTimer);
    persistTimer = null;
  }
  localStorage.setItem(STORAGE_KEY, JSON.stringify(pecas));
}

function save() {
  persistLocal();
}

function newId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

/* ============ Utils ============ */

function todayISO() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function formatDate(iso) {
  if (!iso) return "—";
  const [y, m, d] = iso.split("-");
  return `${d}/${m}/${y}`;
}

function isoOf(d) {
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function mondayOf(iso) {
  const d = new Date(iso + "T00:00:00");
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
  return d;
}

function weekKey(iso) {
  return isoOf(mondayOf(iso));
}

function weekLabel(mondayISO) {
  const m = new Date(mondayISO + "T00:00:00");
  const s = new Date(m);
  s.setDate(m.getDate() + 6);
  return `${formatDate(isoOf(m))} a ${formatDate(isoOf(s))}`;
}

const DIAS_SEMANA = ["DOMINGO", "SEGUNDA", "TERÇA", "QUARTA", "QUINTA", "SEXTA", "SÁBADO"];

function ordemDia(iso) {
  const dow = new Date(iso + "T00:00:00").getDay();
  return (dow + 6) % 7;
}

function diaSemana(iso) {
  return DIAS_SEMANA[new Date(iso + "T00:00:00").getDay()];
}

function groupByDia(list, getData) {
  const porDia = {};
  list.forEach((x) => {
    const data = getData(x);
    if (!porDia[data]) porDia[data] = [];
    porDia[data].push(x);
  });
  return Object.keys(porDia)
    .sort((a, b) => ordemDia(a) - ordemDia(b) || a.localeCompare(b))
    .map((data) => ({ data, itens: porDia[data] }));
}

function esc(s) {
  return String(s).replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])
  );
}

function showToast(msg) {
  const t = document.getElementById("toast");
  t.textContent = msg;
  t.classList.remove("hidden");
  t.classList.remove("show");
  void t.offsetWidth;
  t.classList.add("show");
  clearTimeout(showToast._t);
  showToast._t = setTimeout(() => t.classList.add("hidden"), 2200);
}

function metaEfetiva(p) {
  return Math.max(0, (p.meta || 0) - (p.compensado || 0));
}

function faltam(p) {
  return Math.max(0, metaEfetiva(p) - (p.liberadas || 0));
}

function faltamPintar(p) {
  return Math.max(0, metaEfetiva(p) - (p.pintadas || 0));
}

function faltamConfirmar(p) {
  return Math.max(0, (p.liberadas || 0) - (p.recebidas || 0));
}

/* Excedente de uma peça com saldo extra ativado: o que a logística pagou
   além da programação. Vira saldo extra salvo para o próximo lançamento. */
function excess(p) {
  if (!p.extra) return 0;
  return Math.max(0, (p.liberadas || 0) - (p.meta || 0));
}

function saldoExtra() {
  let s = 0;
  pecas.forEach((p) => {
    s += excess(p);
    s -= p.compensado || 0;
  });
  return Math.max(0, s);
}

function saldoExtraPorPN(pn) {
  const alvo = String(pn).toLowerCase();
  let s = 0;
  pecas.forEach((p) => {
    if (p.partNumber.toLowerCase() !== alvo) return;
    s += excess(p);
    s -= p.compensado || 0;
  });
  return Math.max(0, s);
}

function plural(n, singular, pluralStr) {
  return n === 1 ? singular : pluralStr;
}

function isMetaLivre(p) {
  return !p.meta || p.meta <= 0;
}

/* Pré-cadastro: registro criado só com PN e Nome (savePartPre). Não é uma
   peça em produção e não aparece nas listas até ser editada/completada. */
function isPreCadastro(p) {
  if (p.pre) return true;
  const semMovimento =
    !(p.liberadas || 0) && !(p.recebidas || 0) && !(p.pintadas || 0);
  return !(p.cor || "").trim() && isMetaLivre(p) && semMovimento;
}

function isAtrasada(p) {
  if ((p.status || 0) === 3) return false;
  if (!p.dataEntrada || p.dataEntrada >= todayISO()) return false;
  const semMovimento =
    !(p.liberadas || 0) && !(p.recebidas || 0) && !(p.pintadas || 0);
  if (isMetaLivre(p) && semMovimento) return false;
  return true;
}

function metaLabel(p) {
  return isMetaLivre(p) ? "Livre" : Number(p.meta).toLocaleString("pt-BR");
}

function dataFinalizacao(p) {
  const h = p.history || [];
  for (let i = h.length - 1; i >= 0; i--) {
    if (h[i].status === 3) return h[i].data;
  }
  return "";
}

/* Sincroniza o estágio da peça com a meta: quando a programação é registrada
   ela entra direto na pintura como recebimento confirmado, sem depender de logística. */
function syncStatus(p, record) {
  if (p.status === 3) return;
  let novo;
  if (isMetaLivre(p)) {
    novo = 2;
  } else {
    novo = (p.recebidas || 0) > 0 || (p.liberadas || 0) > 0 ? 2 : 1;
  }
  if (record !== false && novo > (p.status || 0)) {
    p.history.push({ status: novo, data: todayISO() });
  }
  p.status = novo;
}

/* ============ Navegação ============ */

const TAB_TITLES = {
  "view-dashboard": "Painel de produção",
  "view-logistica": "Recebimento",
  "view-primer": "Produção no Pintura",
  "view-historico": "Peças finalizadas",
  "view-insumos": "Cadastro de insumos",
  "view-retorno": "Retorno de peças",
};

function showView(id) {
  document.querySelectorAll(".view").forEach((v) => v.classList.remove("active"));
  document.getElementById(id).classList.add("active");
  window.scrollTo(0, 0);
}

function showTab(id, btn) {
  closeFabMenu();
  if (id === "view-logistica") {
    id = "view-primer";
    btn = document.querySelector('.nav-btn[data-view="view-primer"]') || btn;
  }
  document.querySelectorAll(".nav-btn").forEach((b) =>
    b.classList.toggle("active", b === btn)
  );
  document.getElementById("header-sub").textContent = TAB_TITLES[id] || "Painel de produção";

  if (id === "view-dashboard") renderDashboard();
  if (id === "view-primer") renderPrimer();
  if (id === "view-historico") renderHistorico();
  if (id === "view-insumos") renderInsumos();
  if (id === "view-retorno") renderRetornos();

  showView(id);
}

function goDashboard() {
  closeFabMenu();
  editingId = null;
  document.querySelectorAll(".nav-btn").forEach((b) =>
    b.classList.toggle("active", b.dataset.view === "view-dashboard")
  );
  document.getElementById("header-sub").textContent = TAB_TITLES["view-dashboard"];
  showView("view-dashboard");
  renderDashboard();
}

function goPrimer() {
  const btn = document.querySelector('.nav-btn[data-view="view-primer"]');
  showTab("view-primer", btn);
}

/* ============ Seleção por botões (chips) ============ */

const formSel = { pn: null, name: null, cor: null, verniz: null };
const renameSel = { pn: null, name: null };
const retornoSel = { name: null };
const insumoSel = { tipo: null };

const CORES_COM_VERNIZ = [
  "X01 - PRETO FOSCO",
];
const VERNIZ_OPCOES = ["Sem Verniz", "A24", "25%"];

function baseVerniz(cor) {
  if (!cor) return "";
  return CORES_COM_VERNIZ.find((c) => cor === c || cor.startsWith(c + " ")) || "";
}

function combinarVerniz(cor, verniz) {
  const base = baseVerniz(cor);
  if (!base) return cor;
  if (verniz && verniz !== "Sem Verniz") return `${base} ${verniz}`;
  return base;
}

function separarVerniz(cor) {
  if (!cor) return { cor: "", verniz: null };
  const base = baseVerniz(cor);
  if (!base) return { cor, verniz: null };
  const resto = cor.slice(base.length).trim();
  const v = VERNIZ_OPCOES.find((o) => o !== "Sem Verniz" && resto === o);
  return { cor: base, verniz: v || "Sem Verniz" };
}

function uniqueVals(arr) {
  return [...new Set(arr.filter(Boolean))].sort((a, b) => a.localeCompare(b, "pt-BR"));
}

function allPns() {
  return uniqueVals(pecas.map((p) => p.partNumber));
}

function allNames() {
  return uniqueVals(pecas.map((p) => p.partName));
}

function nomeDe(pn) {
  const p = pecas.find((x) => x.partNumber === pn);
  return p ? p.partName : "";
}

function pnDe(nome) {
  const p = pecas.find((x) => x.partName === nome);
  return p ? p.partNumber : "";
}

function montarChips(id, valores, atual, aoClicar) {
  const el = document.getElementById(id);
  if (!el) return;
  el.innerHTML = valores
    .map(
      (v) =>
        `<button type="button" class="chip ${atual === v ? "active" : ""}" data-v="${esc(v)}">${esc(v)}</button>`
    )
    .join("");
  el.querySelectorAll(".chip").forEach((b) => {
    b.addEventListener("click", () => aoClicar(b.dataset.v));
  });
}

function atualizarToggle(toggleId, valor, placeholder) {
  const el = document.getElementById(toggleId);
  if (!el) return;
  el.textContent = valor ? `\u2713 ${valor}` : placeholder;
  el.classList.toggle("selected", !!valor);
}

function renderPicker(cfg) {
  const input = cfg.search ? document.getElementById(cfg.search) : null;
  const termo = input ? (input.value || "").trim().toLowerCase() : "";
  let valores = cfg.getValues();
  if (termo) {
    valores = valores.filter((v) => v.toLowerCase().includes(termo));
    const digitado = input.value.trim();
    if (digitado && !valores.some((v) => v.toLowerCase() === digitado.toLowerCase())) {
      valores.push(digitado);
    }
  }
  montarChips(cfg.chips, valores, cfg.current(), (v) => {
    cfg.set(cfg.current() === v ? null : v);
    cfg.after && cfg.after();
    document.getElementById(cfg.picker).classList.add("hidden");
  });
}

function initPicker(cfg) {
  document.getElementById(cfg.toggle).addEventListener("click", () => {
    renderPicker(cfg);
    document.getElementById(cfg.picker).classList.toggle("hidden");
    if (cfg.search && !document.getElementById(cfg.picker).classList.contains("hidden")) {
      document.getElementById(cfg.search).focus();
    }
  });
  if (cfg.search) {
    document.getElementById(cfg.search).addEventListener("input", () => renderPicker(cfg));
  }
}

function updateFormSelecao() {
  atualizarToggle("f-pn-toggle", formSel.pn, "Escolher PN");
  atualizarToggle("f-name-toggle", formSel.name, "Escolher nome");
  atualizarToggle("f-cor-toggle", formSel.cor, "Escolher cor");
  const vernizField = document.getElementById("f-verniz-field");
  if (baseVerniz(formSel.cor || "")) {
    vernizField.classList.remove("hidden");
    if (!formSel.verniz) formSel.verniz = "Sem Verniz";
  } else {
    vernizField.classList.add("hidden");
    formSel.verniz = null;
  }
  atualizarToggle("f-verniz-toggle", formSel.verniz, "Escolher verniz");
  const hint = document.getElementById("f-extra-hint");
  if (hint) {
    const pool = formSel.pn ? saldoExtraPorPN(formSel.pn) : 0;
    hint.textContent =
      pool > 0 ? `Saldo extra salvo desta peça: ${pool.toLocaleString("pt-BR")}` : "";
  }
}

function updateRenameSelecao() {
  atualizarToggle("rn-pn-toggle", renameSel.pn, "Escolher PN");
  atualizarToggle("rn-name-toggle", renameSel.name, "Escolher nome");
}

function updateRetornoSelecao() {
  atualizarToggle("r-name-toggle", retornoSel.name, "Escolher nome");
}

function updateInsumoTipoSelecao() {
  atualizarToggle("i-tipo-toggle", insumoSel.tipo, "Escolher tipo");
}

const PICKER_FORM_PN = {
  toggle: "f-pn-toggle", picker: "f-pn-picker", chips: "f-pn-chips", search: "f-pn-search",
  getValues: allPns,
  current: () => formSel.pn,
  set: (v) => { formSel.pn = v; },
  after: () => {
    if (formSel.pn && !formSel.name) {
      const n = nomeDe(formSel.pn);
      if (n) formSel.name = n;
    }
    updateFormSelecao();
  },
};

const PICKER_FORM_NAME = {
  toggle: "f-name-toggle", picker: "f-name-picker", chips: "f-name-chips", search: "f-name-search",
  getValues: allNames,
  current: () => formSel.name,
  set: (v) => { formSel.name = v; },
  after: () => {
    if (formSel.name && !formSel.pn) {
      const p = pnDe(formSel.name);
      if (p) formSel.pn = p;
    }
    updateFormSelecao();
  },
};

const PICKER_FORM_COR = {
  toggle: "f-cor-toggle", picker: "f-cor-picker", chips: "f-cor-chips", search: "f-cor-search",
  getValues: () => uniqueVals(pecas.map((p) => p.cor)),
  current: () => formSel.cor,
  set: (v) => { formSel.cor = v; },
  after: () => updateFormSelecao(),
};

const PICKER_FORM_VERNIZ = {
  toggle: "f-verniz-toggle", picker: "f-verniz-picker", chips: "f-verniz-chips", search: null,
  getValues: () => [...VERNIZ_OPCOES],
  current: () => formSel.verniz,
  set: (v) => { formSel.verniz = v; },
  after: () => updateFormSelecao(),
};

const PICKER_RENAME_PN = {
  toggle: "rn-pn-toggle", picker: "rn-pn-picker", chips: "rn-pn-chips", search: "rn-pn-search",
  getValues: allPns,
  current: () => renameSel.pn,
  set: (v) => { renameSel.pn = v; },
  after: () => updateRenameSelecao(),
};

const PICKER_RENAME_NAME = {
  toggle: "rn-name-toggle", picker: "rn-name-picker", chips: "rn-name-chips", search: "rn-name-search",
  getValues: allNames,
  current: () => renameSel.name,
  set: (v) => { renameSel.name = v; },
  after: () => updateRenameSelecao(),
};

const PICKER_RETORNO_NAME = {
  toggle: "r-name-toggle", picker: "r-name-picker", chips: "r-name-chips", search: "r-name-search",
  getValues: allNames,
  current: () => retornoSel.name,
  set: (v) => { retornoSel.name = v; },
  after: () => updateRetornoSelecao(),
};

const PICKER_INSUMO_TIPO = {
  toggle: "i-tipo-toggle", picker: "i-tipo-picker", chips: "i-tipo-chips", search: null,
  getValues: () => [...TIPOS_INSUMO],
  current: () => insumoSel.tipo,
  set: (v) => { insumoSel.tipo = v; },
  after: () => updateInsumoTipoSelecao(),
};

let formExtra = false;

function updateFormExtraBtn() {
  const btn = document.getElementById("f-extra-btn");
  if (!btn) return;
  btn.classList.toggle("on", formExtra);
  btn.textContent = formExtra ? "Saldo Extra ativado ✓" : "Saldo Extra desativado";
}

function toggleFormExtra() {
  formExtra = !formExtra;
  updateFormExtraBtn();
}

function openFabMenu() {
  const menu = document.getElementById("fab-menu");
  const fab = document.querySelector(".nav-fab");
  if (fab) {
    const rect = fab.getBoundingClientRect();
    const menuWidth = Math.min(260, window.innerWidth - 24);
    const left = Math.max(12, Math.min(
      rect.left + (rect.width / 2) - (menuWidth / 2),
      window.innerWidth - menuWidth - 12
    ));
    menu.querySelector(".fab-menu-pop").style.left = `${left}px`;
    menu.querySelector(".fab-menu-pop").style.bottom = `${window.innerHeight - rect.top + 12}px`;
  }
  menu.classList.remove("hidden");
}

function closeFabMenu() {
  document.getElementById("fab-menu").classList.add("hidden");
}

function openForm() {
  editingId = null;
  formExtra = false;
  formSel.pn = null;
  formSel.name = null;
  formSel.cor = null;
  formSel.verniz = null;
  document.getElementById("form-title").textContent = "Lançar Programação";
  document.getElementById("f-pn-search").value = "";
  document.getElementById("f-name-search").value = "";
  document.getElementById("f-meta").value = "";
  document.getElementById("f-date").value = todayISO();
  document.getElementById("f-obs").value = "";
  const hint = document.getElementById("f-extra-hint");
  if (hint) hint.textContent = "";
  updateFormExtraBtn();
  updateFormSelecao();
  showView("view-form");
  document.getElementById("f-pn-toggle").focus();
}

function openDetail(id) {
  currentId = id;
  renderDetail();
  showView("view-detail");
}

function openEdit() {
  const p = pecas.find((x) => x.id === currentId);
  if (!p) return;
  editingId = currentId;
  const partes = separarVerniz(p.cor);
  formSel.pn = p.partNumber || null;
  formSel.name = p.partName || null;
  formSel.cor = partes.cor || null;
  formSel.verniz = partes.verniz;
  document.getElementById("form-title").textContent = "Editar Peça";
  document.getElementById("f-pn-search").value = "";
  document.getElementById("f-name-search").value = "";
  document.getElementById("f-meta").value = p.meta;
  document.getElementById("f-date").value = p.dataEntrada;
  document.getElementById("f-obs").value = p.obs || "";
  formExtra = !!p.extra;
  updateFormExtraBtn();
  const hint = document.getElementById("f-extra-hint");
  if (hint) hint.textContent = "";
  updateFormSelecao();
  showView("view-form");
}

/* ============ Card HTML ============ */

function extraBadgeHtml(p) {
  return p.extra ? `<span class="extra-badge">Saldo Extra</span>` : "";
}

function cardPart(p, extra) {
  const st = STATUS[p.status];
  const blink = faltamConfirmar(p) > 0 ? " pending-blink" : "";
  const livre = isMetaLivre(p);
  const fmt = (n) => n.toLocaleString("pt-BR");
  const libTxt = livre ? "—" : fmt(p.liberadas || 0);
  const recTxt = livre ? "—" : fmt(p.recebidas || 0);
  const metaTxt = `${livre ? "Livre" : fmt(metaEfetiva(p))}${extraBadgeHtml(p)}`;
  return `
    <div class="peca-card ${st.color}${blink}" onclick="openDetail('${p.id}')">
      <div class="peca-top">
        <div>
          <div class="peca-pn">${esc(p.partNumber)}</div>
          <div class="peca-name">${esc(p.partName)}</div>
        </div>
        <span class="badge ${st.color}">${st.short}</span>
      </div>
      ${isAtrasada(p) ? `<div class="atraso-row">⏰ Atrasada desde ${formatDate(p.dataEntrada)}</div>` : ""}
      <div class="peca-stats">
        <div class="pstat">
          <span class="pstat-label">Programação</span>
          <span class="pstat-value">${metaTxt}</span>
        </div>
        <div class="pstat">
          <span class="pstat-label">${plural(p.liberadas || 0, "Liberada", "Liberadas")}</span>
          <span class="pstat-value">${libTxt}</span>
        </div>
        <div class="pstat">
          <span class="pstat-label">${plural(p.recebidas || 0, "Recebida", "Recebidas")}</span>
          <span class="pstat-value">${recTxt}</span>
        </div>
        <div class="pstat">
          <span class="pstat-label">${plural(p.pintadas || 0, "Concluída", "Concluídas")}</span>
          <span class="pstat-value">${fmt(p.pintadas || 0)}</span>
        </div>
      </div>
      <div class="peca-meta">
        <span>Cor: <b>${esc(p.cor || "—")}</b></span>
        <span>Entrada: <b>${formatDate(p.dataEntrada)}</b></span>
      </div>
      ${p.obs ? `<div class="peca-obs">📝 ${esc(p.obs)}</div>` : ""}
      ${extra || ""}
    </div>`;
}

/* ============ Dashboard ============ */

let currentSegment = null;

const SEGMENTS = {
  total: {
    title: "Programação de hoje",
    sub: "Peças com entrada hoje",
    filter: (p) => !isPreCadastro(p) && p.dataEntrada === todayISO(),
    topTitle: "maiores programações",
    top: () =>
      topEntries(
        pecas.filter((p) => p.dataEntrada === todayISO() && (p.meta || 0) > 0),
        (p) => p.meta || 0
      ),
  },
  naoLiberadas: {
    title: "Aguardando liberação",
    sub: "Peças ainda não liberadas na Logística",
    filter: (p) =>
      !isPreCadastro(p) &&
      p.dataEntrada === todayISO() &&
      !isMetaLivre(p) &&
      (p.liberadas || 0) < metaEfetiva(p),
    topTitle: "aguardando mais liberação",
    top: () =>
      topEntries(
        pecas.filter(
          (p) =>
            p.dataEntrada === todayISO() &&
            !isMetaLivre(p) &&
            (p.liberadas || 0) < metaEfetiva(p)
        ),
        (p) => metaEfetiva(p) - (p.liberadas || 0)
      ),
  },
  logistica: {
    title: "Paradas na Logística",
    sub: "Peças liberadas aguardando confirmação da entrega",
    filter: (p) =>
      !isPreCadastro(p) &&
      p.dataEntrada === todayISO() &&
      (p.liberadas || 0) > (p.recebidas || 0),
    topTitle: "mais paradas na logística",
    top: () =>
      topEntries(
        pecas.filter(
          (p) =>
            p.dataEntrada === todayISO() &&
            (p.liberadas || 0) > (p.recebidas || 0)
        ),
        (p) => (p.liberadas || 0) - (p.recebidas || 0)
      ),
  },
  extra: {
    title: "Saldo extra",
    sub: "Peças com excedente salvo ou compensação aplicada",
    filter: (p) => !isPreCadastro(p) && (excess(p) > 0 || (p.compensado || 0) > 0),
    topTitle: "maior excedente salvo",
    top: () =>
      topEntries(
        pecas.filter((p) => excess(p) > 0),
        (p) => excess(p)
      ),
  },
  pintura: {
    title: "Paradas na Pintura",
    sub: "Peças recebidas aguardando pintura",
    filter: (p) =>
      !isPreCadastro(p) &&
      p.dataEntrada === todayISO() &&
      (p.recebidas || 0) - (p.pintadas || 0) - (p.compensado || 0) > 0,
    topTitle: "mais paradas na pintura",
    top: () =>
      topEntries(
        pecas.filter(
          (p) =>
            p.dataEntrada === todayISO() &&
            (p.recebidas || 0) - (p.pintadas || 0) - (p.compensado || 0) > 0
        ),
        (p) => (p.recebidas || 0) - (p.pintadas || 0) - (p.compensado || 0)
      ),
  },
  finalizadas: {
    title: "Finalizadas",
    sub: "Peças pintadas hoje",
    filter: (p) =>
      !isPreCadastro(p) &&
      p.dataEntrada === todayISO() &&
      (p.pintadas || 0) > 0,
    topTitle: "mais finalizadas",
    top: () =>
      topEntries(
        pecas.filter((p) => p.dataEntrada === todayISO() && (p.pintadas || 0) > 0),
        (p) => p.pintadas || 0
      ),
  },
};

function topEntries(list, qtdFn) {
  return list
    .map((p) => [p, qtdFn(p)])
    .filter(([, qtd]) => qtd > 0)
    .sort(
      (a, b) =>
        b[1] - a[1] ||
        a[0].partNumber.localeCompare(b[0].partNumber, undefined, { numeric: true })
    )
    .slice(0, 3);
}

function renderTop(containerId, seg) {
  const el = document.getElementById(containerId);
  if (!el) return;
  const entries = seg.top();
  if (entries.length === 0) {
    el.classList.add("hidden");
    el.innerHTML = "";
    return;
  }
  el.classList.remove("hidden");
  el.innerHTML =
    `<span class="retorno-top-title">Top 3 · ${esc(seg.topTitle)}</span>` +
    entries
      .map(
        ([p, qtd], i) => `
    <div class="retorno-top-item">
      <span class="retorno-top-rank">${i + 1}</span>
      <span class="retorno-top-name">${esc(p.partNumber)} — ${esc(p.partName)}</span>
      <span class="retorno-top-qtd">${qtd.toLocaleString("pt-BR")}</span>
    </div>`
      )
      .join("");
}

function openSegment(key) {
  const seg = SEGMENTS[key];
  if (!seg) return;
  currentSegment = key;
  document.getElementById("seg-title").textContent = seg.title;
  document.getElementById("seg-sub").textContent = seg.sub;
  const search = document.getElementById("seg-search-input");
  if (search) search.value = "";
  renderSegment();
  showView("view-segmento");
  window.scrollTo(0, 0);
}

function goRetorno() {
  const btn = document.querySelector('.nav-btn[data-view="view-retorno"]');
  showTab("view-retorno", btn);
}

function getSegmentFiltered() {
  const seg = SEGMENTS[currentSegment];
  if (!seg) return [];
  const q = document.getElementById("seg-search-input").value.trim().toLowerCase();
  const base = pecas.filter(seg.filter);
  if (!q) return base;
  return base.filter(
    (p) =>
      p.partNumber.toLowerCase().includes(q) ||
      p.partName.toLowerCase().includes(q)
  );
}

function renderSegment() {
  const list = getSegmentFiltered();
  const container = document.getElementById("seg-list");
  const empty = document.getElementById("seg-empty");

  if (list.length === 0) {
    container.innerHTML = "";
    empty.classList.remove("hidden");
    return;
  }
  empty.classList.add("hidden");

  container.innerHTML = list
    .sort((a, b) => {
      if (a.status !== b.status) return a.status - b.status;
      return b.id.localeCompare(a.id);
    })
    .map((p) => cardPart(p))
    .join("");
}

function renderSummary() {
  const sum = (list, f) => list.reduce((s, p) => s + f(p), 0);
  const doDia = pecas.filter((p) => p.dataEntrada === todayISO());
  const total = sum(doDia, (p) => p.meta || 0);
  const recebidas = sum(doDia, (p) => p.recebidas || 0);
  const emPintura = sum(
    doDia,
    (p) => Math.max(0, (p.recebidas || 0) - (p.pintadas || 0) - (p.compensado || 0))
  );
  const fin = sum(doDia, (p) => p.pintadas || 0);
  const pendentes = sum(
    doDia.filter((p) => !isMetaLivre(p) && (p.pintadas || 0) < metaEfetiva(p)),
    (p) => Math.max(0, metaEfetiva(p) - (p.pintadas || 0))
  );
  const extra = saldoExtra();
  const fmt = (n) => n.toLocaleString("pt-BR");
  const setLabel = (id, n, singular, pluralStr) => {
    const el = document.getElementById(id);
    if (el) el.textContent = plural(n, singular, pluralStr);
  };
  const resultEl = document.getElementById("kpi-result");
  if (resultEl) {
    resultEl.textContent = `${fmt(total)} ${plural(total, "peça", "peças")}`;
  }
  const miniTotal = document.getElementById("mini-total");
  const miniRecebidas = document.getElementById("mini-recebidas");
  const miniFinalizadas = document.getElementById("mini-finalizadas");
  const completion = total > 0 ? Math.round((fin / total) * 100) : 0;
  const progressEl = document.getElementById("panel-progress");
  const completionEl = document.getElementById("panel-completion");
  const panelFinalizadas = document.getElementById("panel-finalizadas");
  const panelEmPintura = document.getElementById("panel-em-pintura");
  const panelPendentes = document.getElementById("panel-pendentes");
  const panelFocus = document.getElementById("panel-focus");
  const focusRecebidas = document.getElementById("focus-recebidas");
  const focusPintura = document.getElementById("focus-pintura");
  const focusFinalizadas = document.getElementById("focus-finalizadas");
  const statusProd = document.getElementById("status-prod");
  const statusRecebidas = document.getElementById("status-recebidas");
  const statusFinalizadas = document.getElementById("status-finalizadas");
  if (miniTotal) miniTotal.textContent = fmt(total);
  if (miniRecebidas) miniRecebidas.textContent = fmt(recebidas);
  if (miniFinalizadas) miniFinalizadas.textContent = fmt(fin);
  if (progressEl) progressEl.style.width = `${completion}%`;
  if (completionEl) completionEl.textContent = `${completion}%`;
  if (panelFinalizadas) panelFinalizadas.textContent = fmt(fin);
  if (panelEmPintura) panelEmPintura.textContent = fmt(emPintura);
  if (panelPendentes) panelPendentes.textContent = fmt(pendentes);
  if (panelFocus) panelFocus.textContent = fmt(recebidas);
  if (focusRecebidas) focusRecebidas.textContent = fmt(recebidas);
  if (focusPintura) focusPintura.textContent = fmt(emPintura);
  if (focusFinalizadas) focusFinalizadas.textContent = fmt(fin);
  if (statusProd) statusProd.textContent = `${completion}%`;
  if (statusRecebidas) statusRecebidas.textContent = fmt(recebidas);
  if (statusFinalizadas) statusFinalizadas.textContent = fmt(fin);
  const statTotal = document.getElementById("stat-total");
  if (statTotal) statTotal.textContent = fmt(total);
  const statNaoLiber = document.getElementById("stat-nao-liberadas");
  if (statNaoLiber) statNaoLiber.textContent = fmt(pendentes);
  const statLog = document.getElementById("stat-logistica");
  if (statLog) statLog.textContent = fmt(recebidas);
  const statPint = document.getElementById("stat-pintura");
  if (statPint) statPint.textContent = fmt(emPintura);
  const statPrep = document.getElementById("stat-preparacao");
  if (statPrep) statPrep.textContent = fmt(fin);
  const extraEl = document.getElementById("stat-extra");
  if (extraEl) {
    extraEl.textContent = fmt(extra);
    extraEl.classList.toggle("accent", extra > 0);
  }
  setLabel("stat-logistica-label", recebidas, "Recebida", "Recebidas");
  setLabel("stat-pintura-label", emPintura, "Em pintura", "Em pintura");
  setLabel("stat-preparacao-label", fin, "Finalizada", "Finalizadas");

  const partTotals = new Map();
  doDia.forEach((p) => {
    const qtd = Math.max(0, Number(p.pintadas || 0));
    if (qtd <= 0) return;
    const key = p.partNumber || "—";
    const existing = partTotals.get(key) || { name: p.partName || "Peça", qtd: 0 };
    existing.qtd += qtd;
    partTotals.set(key, existing);
  });

  const topPart = [...partTotals.entries()]
    .map(([key, value]) => ({ key, name: value.name, qtd: value.qtd }))
    .sort((a, b) => b.qtd - a.qtd || a.key.localeCompare(b.key))[0];

  const colorTotals = new Map();
  doDia.forEach((p) => {
    const qtd = Math.max(0, Number(p.pintadas || 0));
    if (qtd <= 0) return;
    const cor = (p.cor || "Sem cor").trim() || "Sem cor";
    const existing = colorTotals.get(cor) || { qtd: 0 };
    existing.qtd += qtd;
    colorTotals.set(cor, existing);
  });

  const topColor = [...colorTotals.entries()]
    .map(([name, value]) => ({ name, qtd: value.qtd }))
    .sort((a, b) => b.qtd - a.qtd || a.name.localeCompare(b.name))[0];

  const insightMeta = document.getElementById("insight-meta");
  const insightStatus = document.getElementById("insight-status");
  const insightPendentes = document.getElementById("insight-pendentes");
  const insightPart = document.getElementById("insight-part");
  const insightColor = document.getElementById("insight-color");

  if (insightMeta) {
    const metaPct = total > 0 ? Math.min(100, Math.round((fin / total) * 100)) : 0;
    insightMeta.textContent = `${metaPct}%`;
  }
  if (insightStatus) {
    const metaPct = total > 0 ? Math.min(100, Math.round((fin / total) * 100)) : 0;
    insightStatus.textContent = metaPct >= 100 ? "Meta atingida" : metaPct >= 80 ? "Alta performance" : "Em execução";
  }
  if (insightPendentes) insightPendentes.textContent = fmt(pendentes);
  if (insightPart) insightPart.textContent = topPart ? `${esc(topPart.name || topPart.key)}` : "—";
  if (insightColor) insightColor.textContent = topColor ? `${esc(topColor.name)}` : "—";

  const dateOffset = (days) => {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    d.setDate(d.getDate() + days);
    return isoOf(d);
  };

  const valueForDate = (iso) =>
    pecas
      .filter((p) => p.dataEntrada === iso)
      .reduce((sum, p) => sum + Math.max(0, Number(p.pintadas || 0)), 0);

  const todayValue = valueForDate(todayISO());
  const yesterdayValue = valueForDate(dateOffset(-1));
  const currentWeekStart = weekKey(todayISO());
  const weekValue = pecas
    .filter((p) => p.dataEntrada >= currentWeekStart && p.dataEntrada <= todayISO())
    .reduce((sum, p) => sum + Math.max(0, Number(p.pintadas || 0)), 0);

  const compareToday = document.getElementById("compare-today");
  const compareYesterday = document.getElementById("compare-yesterday");
  const compareWeek = document.getElementById("compare-week");
  const compareDelta = document.getElementById("compare-delta");
  const deltaPct = yesterdayValue > 0 ? Math.round(((todayValue - yesterdayValue) / yesterdayValue) * 100) : (todayValue > 0 ? 100 : 0);

  if (compareToday) compareToday.textContent = fmt(todayValue);
  if (compareYesterday) compareYesterday.textContent = fmt(yesterdayValue);
  if (compareWeek) compareWeek.textContent = fmt(weekValue);
  if (compareDelta) compareDelta.textContent = `${deltaPct > 0 ? "+" : ""}${deltaPct}%`;

  const trendContainer = document.getElementById("trend-bars");
  if (trendContainer) {
    const trendDays = Array.from({ length: 7 }, (_, index) => {
      const d = new Date();
      d.setHours(0, 0, 0, 0);
      d.setDate(d.getDate() - (6 - index));
      return {
        iso: isoOf(d),
        label: d.toLocaleDateString("pt-BR", { weekday: "short" }).replace(".", ""),
      };
    });

    const maxTrend = Math.max(
      1,
      ...trendDays.map(({ iso }) =>
        pecas
          .filter((p) => p.dataEntrada === iso)
          .reduce((sum, p) => sum + Math.max(0, Number(p.pintadas || 0)), 0)
      )
    );

    trendContainer.innerHTML = trendDays
      .map(({ iso, label }) => {
        const value = pecas
          .filter((p) => p.dataEntrada === iso)
          .reduce((sum, p) => sum + Math.max(0, Number(p.pintadas || 0)), 0);
        const pct = Math.max(8, Math.round((value / maxTrend) * 100));
        return `
          <div class="trend-col">
            <div class="trend-bar-wrap">
              <div class="trend-bar" style="height: ${pct}%"></div>
            </div>
            <strong>${value}</strong>
            <span>${esc(label)}</span>
          </div>
        `;
      })
      .join("");
  }

  const focusMeta = document.getElementById("focus-meta");
  const focusAtraso = document.getElementById("focus-atraso");
  const focusRetorno = document.getElementById("focus-retorno");
  const focusAction = document.getElementById("focus-action");
  const focusCmd = document.getElementById("focus-cmd");
  const metaPct = total > 0 ? Math.min(100, Math.round((fin / total) * 100)) : 0;
  const actionState =
    metaPct >= 100 ? "Meta batida" : pendentes > 0 ? "Ajustar" : "Estável";

  if (focusMeta) focusMeta.textContent = `${metaPct}%`;
  if (focusAtraso) focusAtraso.textContent = fmt(pendentes);
  if (focusRetorno) focusRetorno.textContent = fmt(retornosHoje());
  if (focusAction) focusAction.textContent = actionState;
  if (focusCmd) focusCmd.textContent = actionState === "Meta batida" ? "Manter" : actionState === "Estável" ? "Monitorar" : "Acelerar";

  const ret = retornosHoje();
  const retEl = document.getElementById("stat-retorno");
  if (retEl) {
    retEl.textContent = fmt(ret);
    setLabel("stat-retorno-label", ret, "Retorno hoje", "Retornos hoje");
  }
  const topEl = document.getElementById("retorno-top");
  if (topEl) {
    const top = retornosTopHoje();
    if (top.length > 0) {
      topEl.classList.remove("hidden");
      topEl.innerHTML =
        `<span class="retorno-top-title">Top 3 retornos</span>` +
        top
          .map(
            ([nome, qtd], i) => `
        <div class="retorno-top-item">
          <span class="retorno-top-rank">${i + 1}</span>
          <span class="retorno-top-name">${esc(nome)}</span>
          <span class="retorno-top-qtd">${qtd.toLocaleString("pt-BR")}</span>
        </div>`
          )
          .join("");
    } else {
      topEl.classList.add("hidden");
    }
  }

  Object.keys(SEGMENTS).forEach((key) => renderTop("seg-top-" + key, SEGMENTS[key]));
}

function renderAlert() {
  const pending = pecas.reduce((s, p) => s + Math.max(0, (p.meta || 0) - (p.pintadas || 0)), 0);
  const banner = document.getElementById("alert-banner");
  if (pending > 0) {
    banner.classList.remove("hidden");
    document.getElementById("alert-text").textContent =
      pending === 1
        ? "1 peça aguardando avanço na pintura"
        : `${pending} peças aguardando avanço na pintura`;
  } else {
    banner.classList.add("hidden");
  }
}

function renderRankings() {
  const doDia = pecas.filter((p) => p.dataEntrada === todayISO());
  const byPart = new Map();
  const byColor = new Map();

  doDia.forEach((p) => {
    const qtd = Math.max(0, Number(p.pintadas || 0));
    const key = p.partNumber || "—";
    if (qtd > 0) {
      const existing = byPart.get(key) || { name: p.partName || "Peça", qtd: 0 };
      existing.qtd += qtd;
      byPart.set(key, existing);
    }

    const cor = (p.cor || "Sem cor").trim() || "Sem cor";
    const colorExisting = byColor.get(cor) || { qtd: 0 };
    colorExisting.qtd += qtd;
    byColor.set(cor, colorExisting);
  });

  const partsList = [...byPart.entries()]
    .map(([key, value]) => ({ key, name: value.name, qtd: value.qtd }))
    .sort((a, b) => b.qtd - a.qtd || a.key.localeCompare(b.key))
    .slice(0, 4);

  const colorsList = [...byColor.entries()]
    .map(([name, value]) => ({ name, qtd: value.qtd }))
    .sort((a, b) => b.qtd - a.qtd || a.name.localeCompare(b.name))
    .slice(0, 4);

  const partsContainer = document.getElementById("rank-parts-list");
  const colorsContainer = document.getElementById("rank-colors-list");

  if (partsContainer) {
    if (partsList.length === 0) {
      partsContainer.innerHTML = '<div class="leader-empty">Sem produção concluída</div>';
    } else {
      partsContainer.innerHTML = partsList
        .map(
          (item, index) => `
            <div class="leader-item">
              <div class="leader-rank">${index + 1}</div>
              <div class="leader-content">
                <span>${esc(item.name || item.key)}</span>
                <small>${esc(item.key)}</small>
              </div>
              <strong>${item.qtd.toLocaleString("pt-BR")}</strong>
            </div>`
        )
        .join("");
    }
  }

  if (colorsContainer) {
    if (colorsList.length === 0 || colorsList.every((item) => item.qtd <= 0)) {
      colorsContainer.innerHTML = '<div class="leader-empty">Sem cor ativa</div>';
    } else {
      colorsContainer.innerHTML = colorsList
        .map(
          (item, index) => `
            <div class="leader-item">
              <div class="leader-rank">${index + 1}</div>
              <div class="leader-content color-content">
                <span>${esc(item.name)}</span>
              </div>
              <strong>${item.qtd.toLocaleString("pt-BR")}</strong>
            </div>`
        )
        .join("");
    }
  }
}

function renderDashboard() {
  renderAlert();
  renderSummary();
  renderRankings();
}

/* ============ Logística ============ */

function logListFilter(p) {
  return (
    !isPreCadastro(p) &&
    !isMetaLivre(p) &&
    p.status !== 3 &&
    ((p.liberadas || 0) < metaEfetiva(p) ||
      (p.recebidas || 0) < (p.liberadas || 0) ||
      p.extra)
  );
}

function logCardHtml(p) {
  const meta = metaEfetiva(p);
  const livre = isMetaLivre(p);
  const lib = p.liberadas || 0;
  const falta = faltam(p);
  const pct = Math.min(100, Math.round((lib / meta) * 100));

  return `
    <div class="peca-card s1 log-card" data-id="${p.id}" onclick="openDetail('${p.id}')">
      <div class="peca-top">
        <div>
          <div class="peca-pn">${esc(p.partNumber)}</div>
          <div class="peca-name">${esc(p.partName)}</div>
        </div>
        <span class="badge s1">Logística</span>
      </div>
      ${isAtrasada(p) ? `<div class="atraso-row">⏰ Atrasada desde ${formatDate(p.dataEntrada)}</div>` : ""}
      <div class="peca-meta">
        <span>Entrada: <b>${formatDate(p.dataEntrada)}</b></span>
      </div>
      <div class="log-progress">
        <div class="log-row">
          <span>${plural(lib, "Liberada", "Liberadas")}: <b>${lib}</b>${livre ? " · programação livre" : ` de ${meta}`}</span>
          ${livre ? "" : `<span class="${falta <= 0 ? "ok-text" : "warn-text"}">${plural(falta, "Falta", "Faltam")}: <b>${falta}</b></span>`}
        </div>
        ${livre ? "" : `<div class="progress-track"><div class="progress-fill" style="width:${pct}%"></div></div>`}
      </div>
      <div class="log-hint">Liberadas caem automaticamente para a Pintura</div>
      <div class="log-actions" onclick="event.stopPropagation()">
        <button class="mini-btn" onclick="decLiberadas('${p.id}')">−</button>
        <button class="mini-btn" onclick="incLiberadas('${p.id}')">+</button>
      </div>
    </div>`;
}

function renderLogistica() {
  const list = pecas.filter(logListFilter).sort((a, b) => b.id.localeCompare(a.id));

  const container = document.getElementById("log-list");
  const empty = document.getElementById("log-empty");

  if (list.length === 0) {
    container.innerHTML = "";
    empty.classList.remove("hidden");
    return;
  }
  empty.classList.add("hidden");

  container.innerHTML = list.map(logCardHtml).join("");
}

function updateLogisticCard(p) {
  const container = document.getElementById("log-list");
  if (!container) return;
  const el = container.querySelector('.peca-card[data-id="' + p.id + '"]');
  if (logListFilter(p)) {
    if (el) {
      el.outerHTML = logCardHtml(p);
    } else {
      renderLogistica();
    }
  } else if (el) {
    el.remove();
    if (container.querySelectorAll(".peca-card").length === 0) {
      container.innerHTML = "";
      document.getElementById("log-empty").classList.remove("hidden");
    }
  }
}

function incLiberadas(id) {
  const p = pecas.find((x) => x.id === id);
  if (!p) return;
  if (!isMetaLivre(p) && !p.extra && p.liberadas >= metaEfetiva(p)) {
    showToast("Programação do dia já atingida.");
    return;
  }
  p.liberadas += 1;
  syncStatus(p);
  save();
  if (!isMetaLivre(p) && faltam(p) <= 0) showToast("Programação do dia atingida!");
  updateLogisticCard(p);
}

function decLiberadas(id) {
  const p = pecas.find((x) => x.id === id);
  if (!p || p.liberadas <= 0) return;
  if (p.recebidas >= p.liberadas) {
    showToast("Peças confirmadas pela Pintura não podem ser desliberadas.");
    return;
  }
  p.liberadas -= 1;
  save();
  updateLogisticCard(p);
}

/* ============ Primer ============ */

function primerCardHtml(p) {
  const meta = metaEfetiva(p);
  const livre = isMetaLivre(p);
  const lib = p.liberadas || 0;
  const rec = p.recebidas || 0;
  const pintadas = p.pintadas || 0;
  const falta = faltamPintar(p);
  const pendConfirm = faltamConfirmar(p);
  const pct = Math.min(100, Math.round((pintadas / meta) * 100));

  return `
    <div class="peca-card s2 log-card ${pendConfirm > 0 ? "pending-blink" : ""}" data-id="${p.id}" onclick="openDetail('${p.id}')">
      <div class="peca-top">
        <div>
          <div class="peca-pn">${esc(p.partNumber)}</div>
          <div class="peca-name">${esc(p.partName)}</div>
        </div>
        <span class="badge s2">Pintura</span>
      </div>
      ${isAtrasada(p) ? `<div class="atraso-row">⏰ Atrasada desde ${formatDate(p.dataEntrada)}</div>` : ""}
      <div class="peca-meta">
        <span>Cor: <b>${esc(p.cor || "—")}</b></span>
        <span>Entrada: <b>${formatDate(p.dataEntrada)}</b></span>
      </div>
      ${livre ? "" : pendConfirm > 0 ? `<div class="pending-row">${pendConfirm} ${plural(pendConfirm, "peça", "peças")} aguardando confirmação da entrega</div>` : ""}
      ${livre ? "" : `
      <div class="log-section">
        <div class="log-row">
          <span>${plural(rec, "Entrega confirmada", "Entregas confirmadas")}: <b>${rec}</b> de ${lib}</span>
        </div>
        <div class="log-actions" onclick="event.stopPropagation()">
          <button class="mini-btn" onclick="decRecebidas('${p.id}')">−</button>
          <button class="mini-btn" onclick="incRecebidas('${p.id}')">+</button>
        </div>
      </div>`}
      <div class="log-progress">
        <div class="log-row">
          <span>${plural(pintadas, "Pintada", "Pintadas")}: <b>${pintadas}</b>${livre ? ` · programação livre${p.extra ? " · Saldo Extra" : ""}` : ` de ${metaEfetiva(p)}${extraBadgeHtml(p)}`}</span>
          ${livre ? "" : `<span class="${falta <= 0 ? "ok-text" : "warn-text"}">${plural(falta, "Falta", "Faltam")}: <b>${falta}</b></span>`}
        </div>
        ${livre ? "" : `<div class="progress-track"><div class="progress-fill" style="width:${pct}%"></div></div>`}
      </div>
      <div class="log-actions" onclick="event.stopPropagation()">
        <button class="mini-btn" onclick="decPintadas('${p.id}')">−</button>
        <button class="mini-btn" onclick="incPintadas('${p.id}')">+</button>
      </div>
      ${podeConcluir(p) ? `
      <div class="log-actions" onclick="event.stopPropagation()">
        <button class="adv-mini-btn" onclick="concluirPrimer('${p.id}')">Concluir peça ✓</button>
      </div>` : ""}
    </div>`;
}

function renderPrimer() {
  const list = pecas
    .filter((p) => p.status === 2 && !isPreCadastro(p))
    .sort((a, b) => b.id.localeCompare(a.id));

  const container = document.getElementById("primer-list");
  const empty = document.getElementById("primer-empty");

  if (list.length === 0) {
    container.innerHTML = "";
    empty.classList.remove("hidden");
    return;
  }
  empty.classList.add("hidden");

  container.innerHTML = list.map(primerCardHtml).join("");
}

function updatePrimerCard(p) {
  const container = document.getElementById("primer-list");
  if (!container) return;
  const el = container.querySelector('.peca-card[data-id="' + p.id + '"]');
  if (p.status === 2) {
    if (el) {
      el.outerHTML = primerCardHtml(p);
    } else {
      renderPrimer();
    }
  } else if (el) {
    el.remove();
    if (container.querySelectorAll(".peca-card").length === 0) {
      container.innerHTML = "";
      document.getElementById("primer-empty").classList.remove("hidden");
    }
  }
}

function incRecebidas(id) {
  const p = pecas.find((x) => x.id === id);
  if (!p) return;
  if (p.recebidas >= p.liberadas) {
    showToast("Todas as entregas já foram confirmadas.");
    return;
  }
  p.recebidas += 1;
  save();
  updatePrimerCard(p);
}

function decRecebidas(id) {
  const p = pecas.find((x) => x.id === id);
  if (!p || p.recebidas <= 0) return;
  if (p.pintadas >= p.recebidas) {
    showToast("Já existem peças pintadas desta entrega.");
    return;
  }
  p.recebidas -= 1;
  save();
  updatePrimerCard(p);
}

function incPintadas(id) {
  const p = pecas.find((x) => x.id === id);
  if (!p) return;
  if (!isMetaLivre(p) && p.pintadas >= metaEfetiva(p)) {
    showToast("Programação do dia já atingida.");
    return;
  }
  if (p.pintadas >= p.recebidas && !isMetaLivre(p)) {
    showToast("Confirme a entrega das peças antes de pintar.");
    return;
  }
  p.pintadas += 1;
  syncStatus(p);
  save();
  if (!isMetaLivre(p) && faltamPintar(p) <= 0) showToast("Programação do dia atingida!");
  updatePrimerCard(p);
}

function decPintadas(id) {
  const p = pecas.find((x) => x.id === id);
  if (!p || p.pintadas <= 0) return;
  p.pintadas -= 1;
  syncStatus(p);
  save();
  updatePrimerCard(p);
}

function podeConcluir(p) {
  if (p.status === 3) return false;
  const pintadas = p.pintadas || 0;
  if (pintadas <= 0) return false;
  const alvo = isMetaLivre(p) ? p.recebidas || 0 : metaEfetiva(p);
  return pintadas >= alvo;
}

function concluirPrimer(id) {
  const p = pecas.find((x) => x.id === id);
  if (!p || p.status === 3) return;
  if (!podeConcluir(p)) {
    showToast("Conclua após pintar todas as peças.");
    return;
  }
  p.status = 3;
  p.history.push({ status: 3, data: todayISO() });
  save();
  showToast("Peça finalizada ✓");
  updatePrimerCard(p);
}

/* ============ Histórico ============ */

function renderHistorico() {
  const dias = [...new Set(pecas.map((p) => dataFinalizacao(p)).filter(Boolean))].sort();
  if (!selectedHistDay || !dias.includes(selectedHistDay)) {
    selectedHistDay = todayISO();
  }
  const sel = document.getElementById("h-date");
  if (sel) {
    sel.min = dias.length ? dias[0] : "";
    sel.max = todayISO();
    sel.value = selectedHistDay;
  }

  const list = pecas
    .filter(
      (p) =>
        p.status === 3 &&
        dataFinalizacao(p) &&
        dataFinalizacao(p) === selectedHistDay
    )
    .sort((a, b) => b.id.localeCompare(a.id));

  const totalPecas = list.reduce((s, p) => s + (p.pintadas || 0), 0);
  document.getElementById("hist-total").textContent = totalPecas.toLocaleString("pt-BR");
  const histLabel = document.getElementById("hist-label");
  if (histLabel)
    histLabel.textContent = plural(totalPecas, "Peça finalizada no dia", "Peças finalizadas no dia");

  const container = document.getElementById("hist-list");
  const empty = document.getElementById("hist-empty");

  if (list.length === 0) {
    container.innerHTML = "";
    empty.classList.remove("hidden");
    return;
  }
  empty.classList.add("hidden");

  container.innerHTML = groupByPN(list)
    .map(({ pn, name, itens }) => {
      const total = itens.reduce((s, p) => s + (p.pintadas || 0), 0);
      const cards = itens
        .map((p) => {
          const concluida = dataFinalizacao(p) || p.dataEntrada;
          return `
        <div class="peca-card s3" onclick="openDetail('${p.id}')">
          <div class="peca-top">
            <div>
              <div class="peca-pn">${esc(p.partNumber)}</div>
              <div class="peca-name">${esc(p.partName)}</div>
            </div>
            <span class="badge s3">Entregue</span>
          </div>
          <div class="peca-meta">
            <span>Programação: <b>${metaLabel(p)}</b></span>
            <span>Entrada: <b>${formatDate(p.dataEntrada)}</b></span>
          </div>
          <div class="peca-meta">
            <span>Entregue em: <b>${formatDate(concluida)}</b></span>
          </div>
        </div>`;
        })
        .join("");
      return `
      <div class="lista-dia dia-toggle" onclick="toggleDia(this)">
        <span class="dia-label">${esc(pn)} — ${esc(name)}</span>
        <span class="dia-count">${total.toLocaleString("pt-BR")}</span>
        <svg class="dia-chevron" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M6 9l6 6 6-6"/></svg>
      </div>
      <div class="dia-itens hidden">${cards}</div>`;
    })
    .join("");
}

function groupByPN(list) {
  const map = new Map();
  list.forEach((p) => {
    const k = p.partNumber;
    if (!map.has(k)) map.set(k, { pn: k, name: p.partName, itens: [] });
    map.get(k).itens.push(p);
  });
  return [...map.values()];
}

/* ============ Insumos ============ */

const TIPOS_INSUMO = ["Fita Adesiva", "Pano Liso", "Pega Pó"];
const INSUMOS_KEY = "controle_pintura_insumos";

let insumos = [];
let selectedWeek = null;

function loadInsumos() {
  insumos = readLocal(INSUMOS_KEY);
  selectedWeek = weekKey(todayISO());
}

function saveInsumos() {
  localStorage.setItem(INSUMOS_KEY, JSON.stringify(insumos));
}

function getSemanasFrom(datas) {
  const weeks = new Set([weekKey(todayISO())]);
  datas.forEach((d) => {
    if (d) weeks.add(weekKey(d));
  });
  return Array.from(weeks).sort();
}

function fillWeekSelect(sel, weeks, selected) {
  const atual = weekKey(todayISO());
  sel.innerHTML = weeks
    .map(
      (w) =>
        `<option value="${w}" ${w === selected ? "selected" : ""}>${weekLabel(w)}${
          w === atual ? " (atual)" : ""
        }</option>`
    )
    .join("");
}

function renderWeekSelect() {
  const sel = document.getElementById("i-week");
  const weeks = getSemanasFrom(insumos.map((i) => i.data));
  if (!selectedWeek || !weeks.includes(selectedWeek)) {
    selectedWeek = weekKey(todayISO());
  }
  fillWeekSelect(sel, weeks, selectedWeek);
}

function renderInsumos() {
  const dataInput = document.getElementById("i-data");
  if (!dataInput.value) dataInput.value = todayISO();

  renderWeekSelect();
  const week = selectedWeek;
  const daSemana = insumos.filter((i) => weekKey(i.data) === week);

  const somaPorTipo = {};
  TIPOS_INSUMO.forEach((t) => (somaPorTipo[t] = 0));
  let total = 0;
  daSemana.forEach((i) => {
    if (somaPorTipo[i.tipo] === undefined) somaPorTipo[i.tipo] = 0;
    somaPorTipo[i.tipo] += i.quantidade;
    total += i.quantidade;
  });

  document.getElementById("insumo-resumo").innerHTML =
    TIPOS_INSUMO.map(
      (t) => `
      <div class="stat">
        <span class="stat-value">${somaPorTipo[t].toLocaleString("pt-BR")}</span>
        <span class="stat-label">${esc(t)}</span>
      </div>`
    ).join("") +
    `<div class="stat">
      <span class="stat-value accent">${total.toLocaleString("pt-BR")}</span>
      <span class="stat-label">Total</span>
    </div>`;

  const sorted = daSemana
    .slice()
    .sort((a, b) => b.data.localeCompare(a.data) || b.id.localeCompare(a.id));

  const container = document.getElementById("insumo-list");
  const empty = document.getElementById("insumo-empty");

  if (sorted.length === 0) {
    container.innerHTML = "";
    empty.classList.remove("hidden");
    return;
  }
  empty.classList.add("hidden");

  container.innerHTML = groupByDia(sorted, (i) => i.data)
    .map(({ data, itens }) => {
      const cards = itens
        .map(
          (i) => `
        <div class="peca-card">
          <div class="peca-top">
            <div>
              <div class="peca-pn">${esc(i.tipo)}</div>
              <div class="peca-name">${formatDate(i.data)}</div>
            </div>
            <span class="badge">Qtd: ${i.quantidade}</span>
          </div>
          <div class="insumo-actions" onclick="event.stopPropagation()">
            <button class="mini-del" onclick="deleteInsumo('${i.id}')">Excluir</button>
          </div>
        </div>`
        )
        .join("");
      return `
      <div class="lista-dia dia-toggle" onclick="toggleDia(this)">
        <span class="dia-label">${diaSemana(data)} (${formatDate(data)})</span>
        <span class="dia-count">${itens.length}</span>
        <svg class="dia-chevron" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M6 9l6 6 6-6"/></svg>
      </div>
      <div class="dia-itens hidden">${cards}</div>`;
    })
    .join("");
}

function saveInsumo() {
  const data = document.getElementById("i-data").value;
  const tipo = insumoSel.tipo || "";
  const qtd = parseInt(document.getElementById("i-qtd").value, 10);
  if (!data || !tipo || !qtd || qtd <= 0) {
    showToast("Preencha Data, Tipo e Quantidade");
    return;
  }
  insumos.push({ id: newId(), data, tipo, quantidade: qtd });
  saveInsumos();
  selectedWeek = weekKey(data);
  showToast("Insumo lançado");
  document.getElementById("i-qtd").value = "";
  renderInsumos();
}

function deleteInsumo(id) {
  const i = insumos.find((x) => x.id === id);
  if (!i) return;
  if (!confirm(`Excluir lançamento de ${i.tipo}?`)) return;
  insumos = insumos.filter((x) => x.id !== id);
  saveInsumos();
  showToast("Lançamento excluído");
  renderInsumos();
}

function toggleDia(header) {
  const itens = header.nextElementSibling;
  const oculto = itens.classList.toggle("hidden");
  header.classList.toggle("open", !oculto);
}

function incQtd(id) {
  const el = document.getElementById(id);
  el.value = Math.max(0, (parseInt(el.value, 10) || 0) + 1);
}

function decQtd(id) {
  const el = document.getElementById(id);
  el.value = Math.max(0, (parseInt(el.value, 10) || 0) - 1);
}

/* ============ Retorno ============ */

const RETORNOS_KEY = "controle_pintura_retornos";

let retornos = [];

function loadRetornos() {
  retornos = readLocal(RETORNOS_KEY);
}

function saveRetornos() {
  localStorage.setItem(RETORNOS_KEY, JSON.stringify(retornos));
}

function retornosHoje() {
  const hoje = todayISO();
  return retornos
    .filter((r) => r.data === hoje)
    .reduce((s, r) => s + (r.qtd || 0), 0);
}

function retornosTopHoje() {
  const hoje = todayISO();
  const porNome = {};
  retornos
    .filter((r) => r.data === hoje)
    .forEach((r) => {
      const nome = (r.partName || "Sem identificação").trim() || "Sem identificação";
      porNome[nome] = (porNome[nome] || 0) + (r.qtd || 0);
    });
  return Object.entries(porNome)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, 3);
}

function renderRetornos() {
  const dataInput = document.getElementById("r-data");
  if (dataInput && !dataInput.value) dataInput.value = todayISO();

  const sorted = retornos
    .slice()
    .sort((a, b) => b.data.localeCompare(a.data) || b.id.localeCompare(a.id));

  const container = document.getElementById("retorno-list");
  const empty = document.getElementById("retorno-empty");

  if (sorted.length === 0) {
    container.innerHTML = "";
    empty.classList.remove("hidden");
    return;
  }
  empty.classList.add("hidden");

  container.innerHTML = groupByDia(sorted, (r) => r.data)
    .map(({ data, itens }) => {
      const total = itens.reduce((s, r) => s + (r.qtd || 0), 0);
      const cards = itens
        .map(
          (r) => `
        <div class="peca-card">
          <div class="peca-top">
            <div>
              <div class="peca-pn">${plural(r.qtd || 0, "Peça", "Peças")} retornada${plural(r.qtd || 0, "", "s")}</div>
              ${r.partName ? `<div class="peca-name">${esc(r.partName)}</div>` : ""}
            </div>
            <span class="badge">Qtd: ${r.qtd || 0}</span>
          </div>
          ${r.obs ? `<div class="peca-obs">📝 ${esc(r.obs)}</div>` : ""}
          <div class="insumo-actions" onclick="event.stopPropagation()">
            <button class="mini-del" onclick="deleteRetorno('${r.id}')">Excluir</button>
          </div>
        </div>`
        )
        .join("");
      return `
      <div class="lista-dia dia-toggle" onclick="toggleDia(this)">
        <span class="dia-label">${diaSemana(data)} (${formatDate(data)})</span>
        <span class="dia-count">${total.toLocaleString("pt-BR")}</span>
        <svg class="dia-chevron" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M6 9l6 6 6-6"/></svg>
      </div>
      <div class="dia-itens hidden">${cards}</div>`;
    })
    .join("");
}

function saveRetorno() {
  const data = document.getElementById("r-data").value;
  const partName = (retornoSel.name || "").trim();
  const qtd = parseInt(document.getElementById("r-qtd").value, 10);
  const obs = document.getElementById("r-obs").value.trim();
  if (!data || !qtd || qtd <= 0) {
    showToast("Preencha Data e Quantidade");
    return;
  }
  retornos.push({ id: newId(), data, partName, qtd, obs });
  saveRetornos();
  showToast("Retorno lançado");
  retornoSel.name = null;
  updateRetornoSelecao();
  document.getElementById("r-qtd").value = "";
  document.getElementById("r-obs").value = "";
  refreshActiveView();
}

function deleteRetorno(id) {
  const r = retornos.find((x) => x.id === id);
  if (!r) return;
  if (!confirm(`Excluir retorno de ${r.qtd || 0} peças?`)) return;
  retornos = retornos.filter((x) => x.id !== id);
  saveRetornos();
  showToast("Retorno excluído");
  refreshActiveView();
}

/* ============ Exportação WhatsApp ============ */

function exportWhats(msg) {
  if (!msg) {
    showToast("Nada para exportar.");
    return;
  }
  const url = "https://api.whatsapp.com/send?text=" + encodeURIComponent(msg);
  window.open(url, "_blank");
}

const EXPORTS = {
  logistica: [
    { label: "Todos", fn: () => exportLogistica("todos") },
    { label: "Liberadas", fn: () => exportLogistica("lib") },
    { label: "Não liberadas", fn: () => exportLogistica("naolib") }
  ],
  primer: [
    { label: "Todos", fn: () => exportPrimer("todos") },
    { label: "Liberadas", fn: () => exportPrimer("lib") },
    { label: "Não liberadas", fn: () => exportPrimer("naolib") },
    { label: "Pintadas", fn: () => exportPrimer("pintadas") }
  ],
  historico: [
    { label: "Dia", fn: () => exportHistorico("dia") },
    { label: "Semana", fn: () => exportHistorico("semana") },
    { label: "Mês", fn: () => exportHistorico("mes") },
    { label: "Peça", fn: () => exportHistorico("peca") }
  ],
  insumos: [{ label: "Semana", fn: () => exportInsumos() }]
};

function openExportPicker(key) {
  const opts = EXPORTS[key];
  if (!opts) return;
  if (opts.length === 1) {
    opts[0].fn();
    return;
  }
  document.getElementById("export-picker-list").innerHTML = opts
    .map((o, i) => `<button class="picker-item" onclick="runExport('${key}', ${i})">${o.label}</button>`)
    .join("");
  document.getElementById("export-picker").classList.remove("hidden");
}

function runExport(key, i) {
  closeExportPicker();
  EXPORTS[key][i].fn();
}

function closeExportPicker() {
  document.getElementById("export-picker").classList.add("hidden");
}

function exportLogistica(filtro) {
  let list = pecas.filter(
    (p) =>
      !isMetaLivre(p) &&
      p.status !== 3 &&
      ((p.liberadas || 0) < metaEfetiva(p) ||
        (p.recebidas || 0) < (p.liberadas || 0) ||
        p.extra)
  );
  if (filtro === "lib") list = list.filter((p) => (p.liberadas || 0) > 0);
  if (filtro === "naolib") list = list.filter((p) => (p.liberadas || 0) === 0);
  list.sort((a, b) => a.partNumber.localeCompare(b.partNumber, undefined, { numeric: true }));

  const rotulo =
    filtro === "lib" ? "LIBERADAS" : filtro === "naolib" ? "NÃO LIBERADAS" : "TODAS";
  const linhas = list.map(
    (p) =>
      `• ${p.partNumber} - ${p.partName}\n   Prog: ${metaLabel(p)} | ${plural(p.liberadas || 0, "Liberada", "Liberadas")}: ${p.liberadas || 0} | ${plural(faltam(p), "Falta", "Faltam")}: ${faltam(p)}\n   Cor: ${p.cor || "—"} | Entrada: ${formatDate(p.dataEntrada)}`
  );
  const totalProg = list.reduce((s, p) => s + (p.meta || 0), 0);
  const totalFaltam = list.reduce((s, p) => s + faltam(p), 0);
  const msg =
    `📦 LOGÍSTICA (${rotulo}) - ${formatDate(todayISO())}\n` +
    "━━━━━━━━━━━━━━━\n" +
    linhas.join("\n") +
    `\n━━━━━━━━━━━━━━━\n${plural(list.length, "Peça", "Peças")}: ${list.length} | Programação: ${totalProg.toLocaleString("pt-BR")} | ${plural(totalFaltam, "Falta", "Faltam")}: ${totalFaltam.toLocaleString("pt-BR")}`;
  exportWhats(msg);
}

function exportPrimer(filtro) {
  let list = pecas.filter((p) => p.status === 2 && !isPreCadastro(p));
  if (filtro === "lib") list = list.filter((p) => (p.liberadas || 0) > 0);
  if (filtro === "naolib") list = list.filter((p) => (p.liberadas || 0) === 0);
  if (filtro === "pintadas") list = list.filter((p) => (p.pintadas || 0) > 0);
  list.sort((a, b) => a.partNumber.localeCompare(b.partNumber, undefined, { numeric: true }));

  const rotulo =
    filtro === "lib"
      ? "LIBERADAS"
      : filtro === "naolib"
      ? "NÃO LIBERADAS"
      : filtro === "pintadas"
      ? "PINTADAS"
      : "TODAS";
  const linhas = list.map((p) => {
    const livre = isMetaLivre(p);
    const base = `• ${p.partNumber} - ${p.partName}\n   Prog: ${metaLabel(p)}`;
    if (livre) {
      return `${base} | ${plural(p.recebidas || 0, "Confirmada", "Confirmadas")}: ${p.recebidas || 0} | ${plural(p.pintadas || 0, "Pintada", "Pintadas")}: ${p.pintadas || 0}\n   Cor: ${p.cor || "—"} | Entrada: ${formatDate(p.dataEntrada)}`;
    }
    return `${base} | ${plural(p.liberadas || 0, "Liberada", "Liberadas")}: ${p.liberadas || 0} | ${plural(p.recebidas || 0, "Confirmada", "Confirmadas")}: ${p.recebidas || 0} | ${plural(p.pintadas || 0, "Pintada", "Pintadas")}: ${p.pintadas || 0} | ${plural(faltamPintar(p), "Falta", "Faltam")}: ${faltamPintar(p)}\n   Cor: ${p.cor || "—"} | Entrada: ${formatDate(p.dataEntrada)}`;
  });
  const totalPintadas = list.reduce((s, p) => s + (p.pintadas || 0), 0);
  const msg =
    `🎨 PINTURA (PRIMER) (${rotulo}) - ${formatDate(todayISO())}\n` +
    "━━━━━━━━━━━━━━━\n" +
    linhas.join("\n") +
    `\n━━━━━━━━━━━━━━━\n${plural(list.length, "Peça", "Peças")}: ${list.length} | ${plural(totalPintadas, "Pintada", "Pintadas")}: ${totalPintadas.toLocaleString("pt-BR")}`;
  exportWhats(msg);
}

function exportHistorico(filtro) {
  const dia = selectedHistDay || todayISO();
  let list;
  let titulo;

  if (filtro === "dia" || filtro === "peca") {
    list = pecas.filter((p) => p.status === 3 && dataFinalizacao(p) === dia);
    titulo = `✅ FINALIZADAS (DIA) - ${formatDate(dia)}`;
  } else if (filtro === "mes") {
    const mes = dia.slice(0, 7);
    const [y, m] = dia.split("-");
    list = pecas.filter((p) => p.status === 3 && dataFinalizacao(p).slice(0, 7) === mes);
    titulo = `✅ FINALIZADAS (MÊS) - ${m}/${y}`;
  } else {
    const week = weekKey(dia);
    list = pecas.filter(
      (p) => p.status === 3 && dataFinalizacao(p) && weekKey(dataFinalizacao(p)) === week
    );
    titulo = `✅ FINALIZADAS (SEMANA) - ${weekLabel(week)}`;
  }

  list = list
    .filter((p) => dataFinalizacao(p))
    .sort((a, b) => a.partNumber.localeCompare(b.partNumber, undefined, { numeric: true }));

  const item = (p) =>
    `• ${p.partNumber} - ${p.partName}\n   Qtd: ${p.pintadas || 0} | Cor: ${p.cor || "—"} | Entregue em: ${formatDate(dataFinalizacao(p))}`;
  const linhas =
    filtro === "semana" || filtro === "mes"
      ? groupByDia(list, (p) => dataFinalizacao(p))
          .map(({ data, itens }) => `${diaSemana(data)} (${formatDate(data)}):\n${itens.map(item).join("\n")}`)
          .join("\n\n")
      : list.map(item).join("\n");
  const total = list.reduce((s, p) => s + (p.pintadas || 0), 0);
  const msg =
    `${titulo}\n` +
    "━━━━━━━━━━━━━━━\n" +
    linhas +
    `\n━━━━━━━━━━━━━━━\n${plural(list.length, "Peça", "Peças")}: ${list.length} | Total: ${total.toLocaleString("pt-BR")}`;
  exportWhats(msg);
}

function exportInsumos() {
  const week = selectedWeek || weekKey(todayISO());
  const daSemana = insumos.filter((i) => weekKey(i.data) === week);

  const somaPorTipo = {};
  TIPOS_INSUMO.forEach((t) => (somaPorTipo[t] = 0));
  let total = 0;
  daSemana.forEach((i) => {
    if (somaPorTipo[i.tipo] === undefined) somaPorTipo[i.tipo] = 0;
    somaPorTipo[i.tipo] += i.quantidade;
    total += i.quantidade;
  });

  const resumo = TIPOS_INSUMO.map((t) => `${t}: ${somaPorTipo[t].toLocaleString("pt-BR")}`).join("\n");
  const lancamentos = groupByDia(daSemana, (i) => i.data)
    .map(({ data, itens }) => {
      const linhas = itens.map((i) => `- ${i.tipo} - ${i.quantidade}`).join("\n");
      return `${diaSemana(data)} (${formatDate(data)}):\n${linhas}`;
    })
    .join("\n\n");

  const msg =
    `🛠 INSUMOS - SEMANA ${weekLabel(week)}\n` +
    "━━━━━━━━━━━━━━━\n" +
    resumo +
    `\nTotal: ${total.toLocaleString("pt-BR")}` +
    (lancamentos ? `\n━━━━━━━━━━━━━━━\nLançamentos:\n${lancamentos}` : "");
  exportWhats(msg);
}

/* ============ Detalhe ============ */

function renderDetail() {
  const p = pecas.find((x) => x.id === currentId);
  if (!p) return goDashboard();

  document.getElementById("detail-badge").textContent =
    p.status === 3 ? "Entregue" : STATUS[p.status].label;
  document.getElementById("detail-badge").className = "badge " + STATUS[p.status].color;
  document.getElementById("detail-pn").textContent = p.partNumber;
  document.getElementById("detail-name").textContent = p.partName;
  document.getElementById("detail-meta").textContent =
    isMetaLivre(p) ? "Livre" : `${metaEfetiva(p).toLocaleString("pt-BR")} ${plural(metaEfetiva(p), "peça", "peças")}`;
  const metaEl = document.getElementById("detail-meta");
  if (p.extra && metaEl) metaEl.textContent += " · Saldo Extra ✓";
  const compItem = document.getElementById("detail-compensado-item");
  if (compItem) {
    const comp = p.compensado || 0;
    compItem.classList.toggle("hidden", isMetaLivre(p) || comp <= 0);
    document.getElementById("detail-compensado").textContent = comp.toLocaleString("pt-BR");
  }
  document.getElementById("detail-data").textContent = formatDate(p.dataEntrada);
  document.getElementById("detail-cor").textContent = p.cor || "—";
  document.getElementById("detail-liberadas-item").classList.toggle("hidden", isMetaLivre(p));
  document.getElementById("detail-recebidas-item").classList.toggle("hidden", isMetaLivre(p));
  document.getElementById("detail-liberadas").textContent =
    isMetaLivre(p)
      ? ""
      : `${p.liberadas} de ${metaEfetiva(p)} · ${plural(faltam(p), "falta", "faltam")} ${faltam(p)}`;
  document.getElementById("detail-recebidas").textContent =
    isMetaLivre(p)
      ? ""
      : `${p.recebidas} de ${p.liberadas} · ${plural(faltamConfirmar(p), "aguarda", "aguardam")} ${faltamConfirmar(p)}`;
  document.getElementById("detail-pintadas").textContent =
    isMetaLivre(p)
      ? `${p.pintadas} ${plural(p.pintadas, "pintada", "pintadas")} · programação livre`
      : `${p.pintadas} de ${metaEfetiva(p)} · ${plural(faltamPintar(p), "falta", "faltam")} ${faltamPintar(p)}`;

  const obsWrap = document.getElementById("detail-obs-wrap");
  if (p.obs) {
    obsWrap.classList.remove("hidden");
    document.getElementById("detail-obs").textContent = p.obs;
  } else {
    obsWrap.classList.add("hidden");
  }

  document.getElementById("concluir-btn").classList.toggle(
    "hidden",
    p.status !== 2 || !podeConcluir(p)
  );

  const steps = STATUS.map((s, i) => {
    const concluido = i < p.status || (i === p.status && p.status === STATUS.length - 1);
    let cls = concluido ? "done" : i === p.status ? "current" : "";
    const num = concluido ? "✓" : i + 1;
    return `
      <div class="step ${cls}">
        <div class="step-line"></div>
        <div class="step-dot">${num}</div>
        <span class="step-label">${s.short}</span>
      </div>`;
  }).join("");
  document.getElementById("stepper").innerHTML = steps;

  const pct =
    p.status === 3 ? 100 : p.meta ? Math.round((p.pintadas / metaEfetiva(p)) * 100) : 0;
  document.getElementById("progress-fill").style.width = pct + "%";
}

function openRename() {
  const p = pecas.find((x) => x.id === currentId);
  if (!p) return;
  renameSel.pn = p.partNumber || null;
  renameSel.name = p.partName || null;
  document.getElementById("rn-pn-search").value = "";
  document.getElementById("rn-name-search").value = "";
  updateRenameSelecao();
  document.getElementById("detail-rename").classList.remove("hidden");
  document.getElementById("rn-pn-toggle").focus();
}

function cancelRename() {
  document.getElementById("detail-rename").classList.add("hidden");
}

function saveRename() {
  const p = pecas.find((x) => x.id === currentId);
  if (!p) return;
  const pn = (renameSel.pn || "").trim();
  const name = (renameSel.name || "").trim();
  if (!pn || !name) return showToast("Preencha PN e Nome");
  p.partNumber = pn;
  p.partName = name;
  save();
  showToast("PN e nome atualizados");
  cancelRename();
  renderDetail();
  refreshAllViews();
}

function confirmDelete() {
  const p = pecas.find((x) => x.id === currentId);
  if (!p) return;
  if (!confirm(`Excluir a peça ${p.partNumber} - ${p.partName}?`)) return;
  pecas = pecas.filter((x) => x.id !== currentId);
  save();
  showToast("Peça excluída");
  goDashboard();
}

/* ============ Cadastro ============ */

function savePart() {
  const partNumber = (formSel.pn || "").trim();
  const partName = (formSel.name || "").trim();
  const cor = combinarVerniz(formSel.cor || "", formSel.verniz);
  const meta = Math.max(0, parseInt(document.getElementById("f-meta").value, 10) || 0);
  const dataEntrada = document.getElementById("f-date").value;
  const obs = document.getElementById("f-obs").value.trim();

  if (!partNumber || !partName || !cor || !dataEntrada) {
    showToast("Preencha PN, Nome, Cor e Data");
    return;
  }

  if (editingId) {
    const p = pecas.find((x) => x.id === editingId);
    if (p) {
      p.partNumber = partNumber;
      p.partName = partName;
      p.cor = cor;
      p.meta = meta;
      p.dataEntrada = dataEntrada;
      p.obs = obs;
      p.extra = formExtra;
      p.pre = false;
      if (isMetaLivre(p)) {
        p.compensado = 0;
        p.liberadas = 0;
        p.recebidas = 0;
      } else {
        const pool = pecas
          .filter((x) => x.id !== p.id && x.partNumber.toLowerCase() === partNumber.toLowerCase())
          .reduce((s, x) => s + excess(x) - (x.compensado || 0), 0);
        p.compensado = Math.min(Math.max(0, pool), meta);
        p.liberadas = meta;
        p.recebidas = meta;
      }
      syncStatus(p);
    }
  } else {
    const livre = isMetaLivre({ meta });
    const part = {
      id: newId(),
      partNumber,
      partName,
      cor,
      meta,
      dataEntrada,
      obs,
      extra: formExtra,
      liberadas: 0,
      recebidas: 0,
      pintadas: 0,
      status: 2,
      history: [{ status: 2, data: dataEntrada }],
    };
    if (!livre) {
      part.liberadas = meta;
      part.recebidas = meta;
      part.compensado = Math.min(Math.max(0, saldoExtraPorPN(partNumber)), meta);
    }
    pecas.push(part);
  }
  save();
  showToast(editingId ? "Peça atualizada" : "Peça cadastrada");
  editingId = null;
  goDashboard();
}

function savePartPre() {
  const partNumber = (formSel.pn || "").trim();
  const partName = (formSel.name || "").trim();
  if (!partNumber || !partName) {
    showToast("Preencha PN e Nome da Peça");
    return;
  }
  const part = {
    id: newId(),
    partNumber,
    partName,
    cor: "",
    meta: 0,
    dataEntrada: todayISO(),
    obs: "",
    extra: false,
    liberadas: 0,
    recebidas: 0,
    pintadas: 0,
    status: 2,
    pre: true,
    history: [{ status: 2, data: todayISO() }],
  };
  pecas.push(part);
  save();
  showToast("Peça pré-cadastrada");
  editingId = null;
  goDashboard();
}

/* ============ Eventos ============ */

document.getElementById("seg-search-input").addEventListener("input", renderSegment);
document.getElementById("i-week").addEventListener("change", (e) => {
  selectedWeek = e.target.value;
  renderInsumos();
});
document.getElementById("h-date").addEventListener("change", (e) => {
  selectedHistDay = e.target.value;
  renderHistorico();
});

/* Inicialização dos seletores por botão */
initPicker(PICKER_FORM_PN);
initPicker(PICKER_FORM_NAME);
initPicker(PICKER_FORM_COR);
initPicker(PICKER_FORM_VERNIZ);
initPicker(PICKER_RENAME_PN);
initPicker(PICKER_RENAME_NAME);
initPicker(PICKER_RETORNO_NAME);
initPicker(PICKER_INSUMO_TIPO);
updateFormSelecao();
updateRenameSelecao();
updateRetornoSelecao();
updateInsumoTipoSelecao();

/* ============ Refresh ============ */

function refreshActiveView() {
  const active = document.querySelector(".view.active");
  if (!active) return;
  const id = active.id;
  if (id === "view-dashboard") {
    renderAlert();
    renderSummary();
  } else if (id === "view-logistica") {
    renderLogistica();
  } else if (id === "view-primer") {
    renderPrimer();
  } else if (id === "view-historico") {
    renderHistorico();
  } else if (id === "view-insumos") {
    renderInsumos();
  } else if (id === "view-retorno") {
    renderRetornos();
  } else if (id === "view-segmento") {
    renderSegment();
  }
}

function refreshAllViews() {
  renderDashboard();
  renderLogistica();
  renderPrimer();
  renderHistorico();
  renderInsumos();
  renderRetornos();
  renderSegment();
}

window.addEventListener("pagehide", flushLocal);

/* ============ Init ============ */

load();
loadInsumos();
loadRetornos();
renderDashboard();
