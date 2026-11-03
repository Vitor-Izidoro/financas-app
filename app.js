'use strict';
/* =========================================================
   Finanças — controle financeiro pessoal (PWA, offline)
   Todos os dados ficam no localStorage do aparelho.
   ========================================================= */

const CHAVE = 'financas-app:v1';
const CORES = ['#0f766e', '#2563eb', '#7c3aed', '#db2777', '#dc2626', '#ea580c', '#ca8a04', '#65a30d', '#0891b2', '#475569'];
const DIAS_LEMBRETE_BACKUP = 14;
const COR_FIXOS = '#7c3aed', COR_PARCELAS = '#ea580c';

/* ---------- Utilidades ---------- */
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const formatador = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
const formatadorCurto = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL', notation: 'compact', maximumFractionDigits: 1 });
const moeda = v => formatador.format(Math.round((v || 0) * 100) / 100);
const moedaCurta = v => formatadorCurto.format(v || 0);
const arred = v => Math.round(v * 100) / 100;
const soma = (lista, f = x => x) => arred(lista.reduce((s, x) => s + f(x), 0));
const uid = () => (crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).slice(2));
const pad = n => String(n).padStart(2, '0');

/** Aceita "1.234,56", "1234,56", "1234.56", "R$ 50", "-150". */
function lerValor(t) {
  t = String(t || '').trim().replace(/[R$\s]/g, '');
  if (!t) return NaN;
  if (t.includes(',')) t = t.replace(/\./g, '').replace(',', '.');
  const v = Number(t);
  return Number.isFinite(v) ? arred(v) : NaN;
}
const valorParaCampo = v => (v || v === 0) ? String(v.toFixed(2)).replace('.', ',') : '';

/* ---------- Datas (formato 'AAAA-MM-DD' e 'AAAA-MM') ---------- */
function hoje() { const d = new Date(); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; }
const mesAtual = () => hoje().slice(0, 7);
function somarMeses(ym, n) {
  let [a, m] = ym.split('-').map(Number);
  m += n;
  a += Math.floor((m - 1) / 12);
  m = (((m - 1) % 12) + 12) % 12 + 1;
  return `${a}-${pad(m)}`;
}
function diasNoMes(ym) { const [a, m] = ym.split('-').map(Number); return new Date(a, m, 0).getDate(); }
const dataNoMes = (ym, dia) => `${ym}-${pad(Math.min(dia, diasNoMes(ym)))}`;
const somarMesesData = (iso, n) => dataNoMes(somarMeses(iso.slice(0, 7), n), Number(iso.slice(8, 10)));
const diaMes = iso => `${iso.slice(8, 10)}/${iso.slice(5, 7)}`;
function nomeMes(ym, curto = false) {
  const [a, m] = ym.split('-').map(Number);
  const d = new Date(a, m - 1, 1);
  if (curto) return d.toLocaleDateString('pt-BR', { month: 'short' }).replace('.', '') + '/' + String(a).slice(2);
  const s = d.toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' });
  return s.charAt(0).toUpperCase() + s.slice(1);
}
function nomeDia(iso) {
  const [a, m, d] = iso.split('-').map(Number);
  const s = new Date(a, m - 1, d).toLocaleDateString('pt-BR', { weekday: 'long', day: '2-digit', month: 'short' });
  return s.charAt(0).toUpperCase() + s.slice(1).replace('.', '');
}
const diasEntre = (isoA, isoB) => Math.round((new Date(isoB) - new Date(isoA)) / 86400000);

/* ---------- Estado e armazenamento ---------- */
function estadoInicial() {
  return {
    versao: 1,
    contas: [],       // {id,nome,uso,cor,saldoInicial}
    cartoes: [],      // {id,nome,contaId,diaFechamento,diaVencimento,limite,cor,faturasPagas:{ym:valor}}
    categorias: [
      { id: 'cat-fixos', nome: 'Fixos', cor: '#7c3aed', tipo: 'saida', limite: 0 },
      { id: 'cat-alimentacao', nome: 'Alimentação', cor: '#ea580c', tipo: 'saida', limite: 0 },
      { id: 'cat-transporte', nome: 'Transporte', cor: '#2563eb', tipo: 'saida', limite: 0 },
      { id: 'cat-lazer', nome: 'Lazer', cor: '#db2777', tipo: 'saida', limite: 0 },
      { id: 'cat-saude', nome: 'Saúde', cor: '#0891b2', tipo: 'saida', limite: 0 },
      { id: 'cat-outros', nome: 'Outros', cor: '#475569', tipo: 'saida', limite: 0 },
      { id: 'cat-salario', nome: 'Salário', cor: '#15803d', tipo: 'entrada', limite: 0 },
      { id: 'cat-outros-ganhos', nome: 'Outros ganhos', cor: '#65a30d', tipo: 'entrada', limite: 0 },
    ],
    // {id,tipo,valor,data,contaId,contaDestinoId,categoriaId,descricao,nota,pago,grupoId,parcela,totalParcelas,cartaoId,fatura}
    lancamentos: [],
    // {id,tipo,valor,dia,contaId,categoriaId,descricao,nota,inicio,fim,pagos:{ym:valor},pulados:[ym]}
    recorrentes: [],
    ultimoBackup: null,
    config: { backupAuto: false, backupDias: 7, graficoInicio: 'renda' },
  };
}
function normalizar(d) {
  const base = estadoInicial();
  const s = { ...base, ...d };
  for (const k of ['contas', 'cartoes', 'categorias', 'lancamentos', 'recorrentes']) if (!Array.isArray(s[k])) s[k] = base[k];
  for (const r of s.recorrentes) { r.pagos = r.pagos || {}; r.pulados = r.pulados || []; }
  for (const k of s.cartoes) k.faturasPagas = k.faturasPagas || {};
  s.config = { ...base.config, ...(d.config || {}) };
  return s;
}
function carregar() {
  try {
    const t = localStorage.getItem(CHAVE);
    if (t) return normalizar(JSON.parse(t));
  } catch (e) { console.error('Falha ao carregar dados', e); }
  return estadoInicial();
}
function salvar() {
  invalidarCache();
  try { localStorage.setItem(CHAVE, JSON.stringify(S)); }
  catch (e) { console.error('Falha ao salvar', e); toast('Erro ao salvar os dados!'); }
}

let S = carregar();
const UI = { aba: 'inicio', mes: mesAtual(), conta: null, persistente: null };

const conta = id => S.contas.find(c => c.id === id);
const cartao = id => S.cartoes.find(c => c.id === id);
const categoria = id => S.categorias.find(c => c.id === id);
const recorrente = id => S.recorrentes.find(r => r.id === id);
const lancamento = id => S.lancamentos.find(l => l.id === id);

/* ---------- Cartões de crédito ---------- */
/** Mês (AAAA-MM) da fatura em que cai uma compra feita na data informada (identificado pelo mês de vencimento). */
function faturaDe(k, iso) {
  const ym = iso.slice(0, 7), dia = Number(iso.slice(8, 10));
  const mesFechamento = dia >= k.diaFechamento ? somarMeses(ym, 1) : ym;
  return k.diaVencimento > k.diaFechamento ? mesFechamento : somarMeses(mesFechamento, 1);
}
const faturaAberta = k => faturaDe(k, hoje());
const faturaPaga = (cartaoId, ym) => cartao(cartaoId)?.faturasPagas[ym] != null;
const comprasDaFatura = (cartaoId, ym) => S.lancamentos.filter(l => l.cartaoId === cartaoId && l.fatura === ym);
const totalFatura = (cartaoId, ym) => soma(comprasDaFatura(cartaoId, ym), l => l.valor);
const limiteUsado = k => soma(S.lancamentos.filter(l => l.cartaoId === k.id && !faturaPaga(k.id, l.fatura)), l => l.valor);
const estaPago = l => l.cartaoId ? faturaPaga(l.cartaoId, l.fatura) : !!l.pago;

/* ---------- Cálculos ---------- */
let cacheMes = new Map();
function invalidarCache() { cacheMes = new Map(); }

/** Itens de um mês: lançamentos da conta, ocorrências dos fixos e faturas dos cartões. (Não altere o array retornado.) */
function itensDoMes(ym) {
  if (cacheMes.has(ym)) return cacheMes.get(ym);
  const itens = [];
  for (const l of S.lancamentos) if (!l.cartaoId && l.data.slice(0, 7) === ym) itens.push({ ...l, origem: 'lanc' });
  for (const r of S.recorrentes) {
    if (r.inicio > ym || (r.fim && r.fim < ym) || r.pulados.includes(ym)) continue;
    const pago = r.pagos[ym] != null;
    itens.push({
      origem: 'rec', id: r.id, mes: ym, tipo: r.tipo, valor: pago ? r.pagos[ym] : r.valor,
      data: dataNoMes(ym, r.dia), contaId: r.contaId, categoriaId: r.categoriaId,
      descricao: r.descricao, nota: r.nota, pago,
    });
  }
  for (const k of S.cartoes) {
    const compras = comprasDaFatura(k.id, ym);
    const pagoV = k.faturasPagas[ym];
    if (!compras.length && pagoV == null) continue;
    itens.push({
      origem: 'fatura', id: k.id, cartaoId: k.id, mes: ym, tipo: 'saida',
      valor: pagoV != null ? pagoV : soma(compras, l => l.valor), total: soma(compras, l => l.valor),
      data: dataNoMes(ym, k.diaVencimento), contaId: k.contaId, categoriaId: null,
      descricao: `Fatura ${k.nome}`, pago: pagoV != null, compras,
    });
  }
  cacheMes.set(ym, itens);
  return itens;
}

/** Quanto um item mexe no saldo de uma conta. */
function efeito(it, contaId) {
  if (it.tipo === 'transferencia') {
    let e = 0;
    if (it.contaId === contaId) e -= it.valor;
    if (it.contaDestinoId === contaId) e += it.valor;
    return e;
  }
  if (it.contaId !== contaId) return 0;
  return it.tipo === 'entrada' ? it.valor : -it.valor;
}

/** Como um item conta no resumo (com ou sem filtro de conta). Transferência só conta quando há filtro. */
function classificar(it, contaId) {
  if (it.tipo === 'transferencia') {
    if (!contaId) return null;
    const e = efeito(it, contaId);
    return e ? { tipo: e > 0 ? 'entrada' : 'saida', v: Math.abs(e) } : null;
  }
  if (contaId && it.contaId !== contaId) return null;
  return { tipo: it.tipo, v: it.valor };
}

/** Saldo atual de uma conta (só o que já foi pago/recebido). */
function saldoConta(c) {
  let s = c.saldoInicial || 0;
  for (const l of S.lancamentos) if (!l.cartaoId && l.pago) s += efeito(l, c.id);
  for (const r of S.recorrentes)
    for (const v of Object.values(r.pagos)) if (v != null) s += efeito({ ...r, valor: v }, c.id);
  for (const k of S.cartoes) if (k.contaId === c.id) for (const v of Object.values(k.faturasPagas)) s -= v;
  return arred(s);
}
const saldoAtual = contaId => contaId ? saldoConta(conta(contaId)) : soma(S.contas, saldoConta);

/** Soma do efeito dos itens de um mês no saldo (só pagos ou só pendentes). */
function efeitoMes(ym, contaId, pagos) {
  let s = 0;
  for (const it of itensDoMes(ym)) {
    if (!!it.pago !== pagos) continue;
    const c = classificar(it, contaId);
    if (c) s += c.tipo === 'entrada' ? c.v : -c.v;
  }
  return s;
}
/** Saldo (previsto, para meses futuros) no fim de um mês. */
function saldoFimMes(ym, contaId = null) {
  const atual = mesAtual();
  let s = saldoAtual(contaId);
  if (ym >= atual) for (let k = atual; k <= ym; k = somarMeses(k, 1)) s += efeitoMes(k, contaId, false);
  else for (let k = somarMeses(ym, 1); k <= atual; k = somarMeses(k, 1)) s -= efeitoMes(k, contaId, true);
  return arred(s);
}

/** Resumo do mês (opcionalmente filtrado por conta). */
function resumo(ym, contaId = null) {
  const r = { entradas: 0, saidas: 0, recebido: 0, pago: 0, porCat: {}, qtdPendente: 0, fixos: 0, parcelas: 0, faturas: 0 };
  for (const it of itensDoMes(ym)) {
    const c = classificar(it, contaId);
    if (!c) continue;
    if (!it.pago) r.qtdPendente++;
    if (c.tipo === 'entrada') { r.entradas += c.v; if (it.pago) r.recebido += c.v; continue; }
    r.saidas += c.v; if (it.pago) r.pago += c.v;
    if (it.tipo === 'transferencia') continue;
    if (it.origem === 'fatura') {
      r.faturas += c.v;
      for (const l of it.compras) {
        const k = l.categoriaId || '_';
        r.porCat[k] = (r.porCat[k] || 0) + l.valor;
        if (l.grupoId) r.parcelas += l.valor;
      }
    } else {
      const k = it.categoriaId || '_';
      r.porCat[k] = (r.porCat[k] || 0) + c.v;
      if (it.origem === 'rec') r.fixos += c.v;
      else if (it.grupoId) r.parcelas += c.v;
    }
  }
  for (const k of ['entradas', 'saidas', 'recebido', 'pago', 'fixos', 'parcelas', 'faturas']) r[k] = arred(r[k]);
  r.sobra = arred(r.entradas - r.saidas);
  r.livre = arred(r.entradas - r.fixos - r.parcelas);
  return r;
}

/** Grupos de parcelamento (agrupados por grupoId). */
function parcelamentos() {
  const g = {};
  for (const l of S.lancamentos) if (l.grupoId) (g[l.grupoId] = g[l.grupoId] || []).push(l);
  return Object.entries(g).map(([id, ps]) => {
    ps.sort((a, b) => a.parcela - b.parcela);
    const ultima = ps[ps.length - 1];
    return {
      id, parcelas: ps, descricao: ps[0].descricao, tipo: ps[0].tipo, total: ps[0].totalParcelas,
      pagas: ps.filter(estaPago).length,
      restante: soma(ps.filter(p => !estaPago(p)), p => p.valor),
      valorTotal: soma(ps, p => p.valor),
      fim: ultima.cartaoId ? ultima.fatura : ultima.data.slice(0, 7),
      contaId: ps[0].contaId, cartaoId: ps[0].cartaoId || null, categoriaId: ps[0].categoriaId,
    };
  });
}

/* ---------- Componentes visuais ---------- */
function anel(segmentos, { tamanho = 120, espessura = 14 } = {}) {
  const r = (tamanho - espessura) / 2, C = 2 * Math.PI * r, c = tamanho / 2;
  const total = segmentos.reduce((s, x) => s + x.valor, 0);
  let acum = 0, arcos = '';
  if (total > 0) for (const sg of segmentos) {
    const len = (sg.valor / total) * C;
    if (len <= 0) continue;
    const vao = segmentos.length > 1 && len > 4 ? 2 : 0;
    arcos += `<circle cx="${c}" cy="${c}" r="${r}" fill="none" stroke="${sg.cor}" stroke-width="${espessura}"
      stroke-dasharray="${Math.max(len - vao, 0.01)} ${C}" stroke-dashoffset="${-acum}" stroke-linecap="butt"
      transform="rotate(-90 ${c} ${c})"/>`;
    acum += len;
  }
  return `<svg viewBox="0 0 ${tamanho} ${tamanho}" aria-hidden="true">
    <circle cx="${c}" cy="${c}" r="${r}" fill="none" stroke="var(--cartao-2)" stroke-width="${espessura}"/>${arcos}</svg>`;
}

/** Anel de proporção (0..1+): verde, amarelo a partir de 80%, vermelho a partir de 100%. */
function anelProporcao(prop) {
  const cor = prop >= 1 ? 'var(--saida)' : prop >= 0.8 ? 'var(--alerta)' : 'var(--entrada)';
  const r = 52, C = 2 * Math.PI * r, len = Math.min(Math.max(prop, 0), 1) * C;
  return `<svg viewBox="0 0 120 120" aria-hidden="true">
    <circle cx="60" cy="60" r="${r}" fill="none" stroke="var(--cartao-2)" stroke-width="14"/>
    <circle cx="60" cy="60" r="${r}" fill="none" stroke="${cor}" stroke-width="14" stroke-linecap="round"
      stroke-dasharray="${Math.max(len, 0.01)} ${C}" transform="rotate(-90 60 60)"/></svg>`;
}

/** Gráfico de linhas em SVG. series: [{valores, cor, tracejado, area}] */
function graficoLinha({ series, rotulos, marcador = null, H = 180 }) {
  const W = 320, pt = 18, pb = 22, pl = 16, pr = 16;
  const todos = series.flatMap(s => s.valores);
  let min = Math.min(0, ...todos), max = Math.max(0, ...todos);
  if (max === min) max = min + 1;
  const n = rotulos.length;
  const X = i => pl + (n <= 1 ? (W - pl - pr) / 2 : i * (W - pl - pr) / (n - 1));
  const Y = v => pt + (max - v) / (max - min) * (H - pt - pb);
  let g = `<line x1="0" x2="${W}" y1="${Y(0)}" y2="${Y(0)}" stroke="var(--borda)" stroke-width="1"/>`;
  if (marcador != null) g += `<line x1="${X(marcador)}" x2="${X(marcador)}" y1="${pt - 6}" y2="${H - pb}" stroke="var(--primaria)" stroke-width="1.5" stroke-dasharray="3 3"/>`;
  for (const s of series) {
    const d = s.valores.map((v, i) => `${i ? 'L' : 'M'}${X(i).toFixed(1)},${Y(v).toFixed(1)}`).join('');
    if (s.area) g += `<path d="${d}L${X(n - 1).toFixed(1)},${Y(0)}L${X(0).toFixed(1)},${Y(0)}Z" fill="${s.cor}" fill-opacity=".14" stroke="none"/>`;
    g += `<path d="${d}" fill="none" stroke="${s.cor}" stroke-width="2.5" ${s.tracejado ? 'stroke-dasharray="5 4"' : ''}/>`;
    if (s.pontos) s.valores.forEach((v, i) => { g += `<circle cx="${X(i)}" cy="${Y(v)}" r="3" fill="${s.cor}" stroke="none"/>`; });
  }
  rotulos.forEach((r, i) => {
    if (!r) return;
    g += `<text x="${X(i)}" y="${H - 6}" text-anchor="middle">${esc(r)}</text>`;
  });
  g += `<text x="0" y="10">${esc(moedaCurta(max))}</text>`;
  if (min < 0) g += `<text x="0" y="${H - pb - 4}">${esc(moedaCurta(min))}</text>`;
  return `<svg viewBox="0 0 ${W} ${H}" role="img">${g}</svg>`;
}
const legendaH = itens => `<div class="legenda-h">${itens.map(([cor, nome, tracejado]) =>
  `<span><i style="background:${cor}${tracejado ? ';opacity:.6' : ''}"></i>${esc(nome)}</span>`).join('')}</div>`;

function iconeItem(it) {
  if (it.origem === 'fatura') return `<div class="item-icone" style="--cor:${cartao(it.cartaoId)?.cor || '#64748b'}">💳</div>`;
  if (it.tipo === 'transferencia') return `<div class="item-icone" style="--cor:#64748b">⇄</div>`;
  const cat = categoria(it.categoriaId);
  const letra = (cat?.nome || it.descricao || '?').trim().charAt(0).toUpperCase();
  return `<div class="item-icone" style="--cor:${cat?.cor || '#64748b'}">${esc(letra)}</div>`;
}

const botaoCheck = (pago, ref) => `<button class="check ${pago ? 'feito' : ''}" data-acao="alternar-pago" ${ref}
  aria-label="${pago ? 'Marcar como pendente' : 'Marcar como pago'}"><svg viewBox="0 0 24 24"><path d="M5 12l5 5L20 7"/></svg></button>`;

function linhaItem(it, { mostrarData = false } = {}) {
  const ref = `data-origem="${it.origem}" data-id="${it.id}" data-mes="${it.mes || ''}"`;

  if (it.origem === 'fatura') {
    const k = cartao(it.cartaoId);
    return `<div class="item ${it.pago ? '' : 'pendente'}" role="button" tabindex="0" data-acao="abrir-item" ${ref}>
      ${iconeItem(it)}
      <div class="item-meio">
        <div class="item-titulo">${esc(it.descricao)}${it.pago ? '' : '<span class="selo pend">Pendente</span>'}</div>
        <div class="item-sub">${it.compras.length} compra(s) · paga com ${esc(conta(k?.contaId)?.nome || '?')}</div>
      </div>
      <div class="item-dir"><span class="item-valor negativo">− ${moeda(it.valor)}</span>${botaoCheck(it.pago, ref)}</div>
    </div>`;
  }

  const cat = categoria(it.categoriaId), ct = conta(it.contaId), k = it.cartaoId ? cartao(it.cartaoId) : null;
  const pago = estaPago(it);
  let sinal = it.tipo === 'entrada' ? '+' : it.tipo === 'saida' ? '−' : '';
  let classe = it.tipo === 'entrada' ? 'positivo' : it.tipo === 'saida' ? 'negativo' : '';
  if (it.tipo === 'transferencia' && UI.conta) {
    const e = efeito(it, UI.conta);
    sinal = e > 0 ? '+' : '−'; classe = e > 0 ? 'positivo' : 'negativo';
  }
  const selos = [];
  if (it.origem === 'rec') selos.push('<span class="selo">Fixo</span>');
  if (it.grupoId) selos.push(`<span class="selo">${it.parcela}/${it.totalParcelas}</span>`);
  if (k) selos.push(`<span class="selo">fatura ${esc(nomeMes(it.fatura, true))}</span>`);
  else if (!pago) selos.push('<span class="selo pend">Pendente</span>');
  let sub = it.tipo === 'transferencia'
    ? `${esc(ct?.nome || '?')} → ${esc(conta(it.contaDestinoId)?.nome || '?')}`
    : `${esc(cat?.nome || 'Sem categoria')} · ${k ? '💳 ' + esc(k.nome) : esc(ct?.nome || 'Sem conta')}`;
  if (mostrarData) sub = `${diaMes(it.data)} · ${sub}`;
  return `<div class="item ${pago || k ? '' : 'pendente'}" role="button" tabindex="0" data-acao="abrir-item" ${ref}>
    ${iconeItem(it)}
    <div class="item-meio">
      <div class="item-titulo">${esc(it.descricao)}${selos.join('')}</div>
      <div class="item-sub">${sub}</div>
      ${it.nota ? `<div class="item-nota">${esc(it.nota)}</div>` : ''}
    </div>
    <div class="item-dir">
      <span class="item-valor ${classe}">${sinal} ${moeda(it.valor)}</span>
      ${k ? '' : botaoCheck(pago, ref)}
    </div>
  </div>`;
}

/* ---------- Gráficos ---------- */
const GRAFICOS = {
  renda: { nome: 'Renda comprometida', desc: 'Quanto das entradas do mês já está comprometido com saídas.' },
  disponivel: { nome: 'Gasto × dinheiro disponível', desc: 'Saídas do mês comparadas ao saldo das contas + entradas.' },
  livre: { nome: 'Sobra após fixos e parcelas', desc: 'Quanto sobra da renda depois de pagar contas fixas e parcelas.' },
  ritmo: { nome: 'Gasto ao longo do mês', desc: 'Gasto acumulado dia a dia × ritmo ideal para não estourar.' },
  saldo: { nome: 'Evolução do saldo', desc: 'Saldo no fim de cada mês: passado e previsão.' },
  categorias: { nome: 'Saídas por categoria', desc: 'Para onde está indo o dinheiro do mês.' },
  contas: { nome: 'Gastos por conta e cartão', desc: 'Quanto sai de cada conta e de cada fatura.' },
  meses: { nome: 'Próximos 6 meses', desc: 'Entradas × saídas previstas e a sobra de cada mês.' },
};

function htmlGrafico(chave, ym, contaId, rs) {
  switch (chave) {
    case 'disponivel': return grafDisponivel(ym, contaId);
    case 'livre': return grafLivre(ym, contaId);
    case 'ritmo': return grafRitmo(ym, contaId, rs);
    case 'saldo': return grafSaldo(ym, contaId);
    case 'categorias': return grafCategorias(rs);
    case 'contas': return grafContas(ym);
    case 'meses': return graficoMeses(ym, 6);
    default: return '';
  }
}

function grafDisponivel(ym, contaId) {
  const ini = saldoFimMes(somarMeses(ym, -1), contaId), rs = resumo(ym, contaId);
  const disp = arred(ini + rs.entradas), fim = arred(disp - rs.saidas);
  const prop = disp > 0 ? rs.saidas / disp : (rs.saidas > 0 ? 1 : 0);
  let porConta = '';
  if (!contaId && S.contas.length > 1) {
    porConta = S.contas.map(c => {
      const i = saldoFimMes(somarMeses(ym, -1), c.id), r = resumo(ym, c.id);
      const d = arred(i + r.entradas), p = d > 0 ? r.saidas / d : (r.saidas > 0 ? 1 : 0);
      const cor = p >= 1 ? 'var(--saida)' : p >= .8 ? 'var(--alerta)' : c.cor;
      return `<div class="cat-linha"><div class="cat-topo" style="--cor:${c.cor}"><span><i></i>${esc(c.nome)}</span><b>${moeda(r.saidas)}</b></div>
        <div class="barra"><div style="width:${Math.min(p, 1) * 100}%;--cor:${cor}"></div></div>
        <div class="cat-info">de ${moeda(d)} disponível · fica ${moeda(d - r.saidas)}</div></div>`;
    }).join('');
    porConta = `<div style="margin-top:12px">${porConta}</div>`;
  }
  return `<div class="resumo">
      <div class="resumo-anel">${anelProporcao(prop)}
        <div class="anel-centro"><b>${Math.round(prop * 100)}%</b><span>do dinheiro<br>disponível</span></div></div>
      <dl class="info-tabela" style="flex:1;margin:0;font-size:.85rem">
        <dt>Início do mês</dt><dd>${moeda(ini)}</dd>
        <dt>+ Entradas</dt><dd class="positivo">${moeda(rs.entradas)}</dd>
        <dt>− Saídas</dt><dd class="negativo">${moeda(rs.saidas)}</dd>
        <dt>Fim do mês</dt><dd class="${fim < 0 ? 'negativo' : ''}">${moeda(fim)}</dd>
      </dl>
    </div>${porConta}`;
}

function grafLivre(ym, contaId) {
  const meses = Array.from({ length: 6 }, (_, i) => somarMeses(ym, i));
  const dados = meses.map(m => ({ m, ...resumo(m, contaId) }));
  const max = Math.max(1, ...dados.map(d => Math.max(d.entradas, d.fixos + d.parcelas)));
  const W = 320, H = 180, base = 150, alt = 118, larg = W / 6, bw = Math.min(26, larg * .55);
  let g = `<line x1="0" y1="${base}" x2="${W}" y2="${base}" stroke="var(--borda)" stroke-width="1"/>`;
  dados.forEach((d, i) => {
    const x = i * larg + (larg - bw) / 2;
    let y = base;
    for (const [v, cor] of [[d.fixos, COR_FIXOS], [d.parcelas, COR_PARCELAS], [Math.max(d.livre, 0), 'var(--entrada)']]) {
      const h = v / max * alt;
      if (h > 0) { y -= h; g += `<rect x="${x}" y="${y}" width="${bw}" height="${h}" rx="2" fill="${cor}"/>`; }
    }
    g += `<text x="${x + bw / 2}" y="${y - 5}" text-anchor="middle" class="${d.livre < 0 ? 'txt-neg' : 'txt-pos'}">${esc(moedaCurta(d.livre))}</text>
      <text x="${x + bw / 2}" y="${base + 16}" text-anchor="middle">${esc(nomeMes(d.m, true))}</text>`;
  });
  const a = dados[0], variaveis = arred(a.saidas - a.fixos - a.parcelas);
  return `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Sobra após fixos e parcelas por mês">${g}</svg>
    ${legendaH([[COR_FIXOS, 'Fixos'], [COR_PARCELAS, 'Parcelas'], ['var(--entrada)', 'Livre']])}
    <dl class="info-tabela" style="margin-top:14px">
      <dt>Entradas de ${esc(nomeMes(ym, true))}</dt><dd class="positivo">${moeda(a.entradas)}</dd>
      <dt>− Contas fixas</dt><dd>${moeda(a.fixos)}</dd>
      <dt>− Parcelas</dt><dd>${moeda(a.parcelas)}</dd>
      <dt><b>= Livre para o dia a dia</b></dt><dd class="${a.livre < 0 ? 'negativo' : 'positivo'}">${moeda(a.livre)}</dd>
      <dt>Já gasto no dia a dia</dt><dd>${moeda(variaveis)}</dd>
      <dt>Ainda livre</dt><dd class="${a.livre - variaveis < 0 ? 'negativo' : ''}">${moeda(a.livre - variaveis)}</dd>
    </dl>`;
}

function grafRitmo(ym, contaId, rs = resumo(ym, contaId)) {
  const n = diasNoMes(ym);
  const porDia = new Array(n).fill(0);
  for (const it of itensDoMes(ym)) {
    const c = classificar(it, contaId);
    if (c && c.tipo === 'saida') porDia[Number(it.data.slice(8, 10)) - 1] += c.v;
  }
  let ac = 0;
  const acum = porDia.map(v => (ac += v));
  const ideal = porDia.map((_, i) => rs.entradas * (i + 1) / n);
  const marcos = new Set([1, 5, 10, 15, 20, 25, n]);
  const rotulos = porDia.map((_, i) => marcos.has(i + 1) ? String(i + 1) : '');
  const atual = ym === mesAtual(), d = Number(hoje().slice(8, 10)) - 1;
  let info;
  if (atual) {
    const dif = acum[d] - ideal[d];
    info = `Até hoje: <b>${moeda(acum[d])}</b> · ritmo ideal: ${moeda(ideal[d])}<br>` +
      (rs.entradas ? (dif > 0 ? `<span class="negativo">${moeda(dif)} acima do ritmo</span>` : `<span class="positivo">${moeda(-dif)} abaixo do ritmo</span>`) : '');
  } else info = `Total do mês: <b>${moeda(acum[n - 1])}</b> de ${moeda(rs.entradas)} de entradas`;
  return graficoLinha({
    series: [{ valores: ideal, cor: 'var(--texto-2)', tracejado: true }, { valores: acum, cor: 'var(--saida)', area: true }],
    rotulos, marcador: atual ? d : null,
  }) + legendaH([['var(--saida)', 'Gasto acumulado'], ['var(--texto-2)', 'Ritmo ideal', true]]) +
    `<p class="ajuda" style="margin:10px 0 0">${info}<br>Inclui o que já está previsto (fixos, parcelas e faturas) nos dias de vencimento.</p>`;
}

function grafSaldo(ym, contaId) {
  const meses = Array.from({ length: 9 }, (_, i) => somarMeses(ym, i - 3));
  const valores = meses.map(m => saldoFimMes(m, contaId));
  const idx = meses.indexOf(mesAtual());
  return graficoLinha({
    series: [{ valores, cor: 'var(--primaria)', area: true, pontos: true }],
    rotulos: meses.map(m => nomeMes(m, true)), marcador: idx >= 0 ? idx : null,
  }) + `<dl class="info-tabela" style="margin-top:12px">
      <dt>Saldo hoje</dt><dd>${moeda(saldoAtual(contaId))}</dd>
      <dt>Fim de ${esc(nomeMes(ym, true))}</dt><dd class="${valores[3] < 0 ? 'negativo' : ''}">${moeda(valores[3])}</dd>
      <dt>Fim de ${esc(nomeMes(meses[8], true))} (previsto)</dt><dd class="${valores[8] < 0 ? 'negativo' : ''}">${moeda(valores[8])}</dd>
    </dl><p class="ajuda" style="margin:6px 0 0">Meses futuros consideram tudo o que está previsto (fixos, parcelas, faturas e lançamentos pendentes).</p>`;
}

function grafCategorias(rs) {
  const cats = Object.entries(rs.porCat).map(([id, v]) => {
    const c = categoria(id);
    return { id, nome: c?.nome || 'Sem categoria', cor: c?.cor || '#94a3b8', valor: v };
  }).sort((a, b) => b.valor - a.valor);
  const total = cats.reduce((s, c) => s + c.valor, 0);
  if (!cats.length) return `<div class="vazio">Nenhuma saída neste mês.</div>`;
  return `<div class="donut-wrap">
      <div class="donut">${anel(cats, { tamanho: 150, espessura: 22 })}
        <div class="anel-centro"><b>${moeda(total)}</b><span>em saídas</span></div></div>
      <div class="legenda">${cats.slice(0, 7).map(c => `<div style="--cor:${c.cor}"><i></i><span>${esc(c.nome)}</span>
        <b>${Math.round(c.valor / total * 100)}%</b></div>`).join('')}</div>
    </div>`;
}

function grafOrcamento(rs) {
  return S.categorias.filter(c => c.tipo === 'saida' && (c.limite > 0 || rs.porCat[c.id]))
    .map(c => ({ ...c, valor: rs.porCat[c.id] || 0 })).sort((a, b) => b.valor - a.valor)
    .map(c => {
      const temLimite = c.limite > 0;
      const prop = temLimite ? c.valor / c.limite : (rs.entradas ? c.valor / rs.entradas : 0);
      const corBarra = temLimite && prop >= 1 ? 'var(--saida)' : temLimite && prop >= .8 ? 'var(--alerta)' : c.cor;
      const info = temLimite
        ? (c.valor <= c.limite ? `Restam ${moeda(c.limite - c.valor)} de ${moeda(c.limite)}` : `<span class="negativo">Passou ${moeda(c.valor - c.limite)} do limite de ${moeda(c.limite)}</span>`)
        : (rs.entradas ? `${Math.round(prop * 100)}% da renda do mês · sem limite definido` : 'Sem limite definido');
      return `<div class="cat-linha"><div class="cat-topo" style="--cor:${c.cor}"><span><i></i>${esc(c.nome)}</span><b>${moeda(c.valor)}</b></div>
        <div class="barra"><div style="width:${Math.min(prop, 1) * 100}%;--cor:${corBarra}"></div></div>
        <div class="cat-info">${info}</div></div>`;
    }).join('');
}

function grafContas(ym) {
  const itens = itensDoMes(ym);
  const linhas = [
    ...S.contas.map(c => ({
      nome: c.nome, cor: c.cor, sub: 'conta (sem faturas)',
      v: soma(itens.filter(it => it.origem !== 'fatura' && it.tipo === 'saida' && it.contaId === c.id), it => it.valor),
    })),
    ...S.cartoes.map(k => ({ nome: '💳 ' + k.nome, cor: k.cor, sub: `fatura · vence dia ${k.diaVencimento}`, v: totalFatura(k.id, ym) })),
  ].sort((a, b) => b.v - a.v);
  if (!linhas.length) return `<div class="vazio">Cadastre contas e cartões em Ajustes.</div>`;
  const max = Math.max(1, ...linhas.map(l => l.v));
  return linhas.map(l => `<div class="cat-linha"><div class="cat-topo" style="--cor:${l.cor}"><span><i></i>${esc(l.nome)}</span><b>${moeda(l.v)}</b></div>
      <div class="barra"><div style="width:${l.v / max * 100}%;--cor:${l.cor}"></div></div><div class="cat-info">${esc(l.sub)}</div></div>`).join('');
}

function graficoMeses(inicio, n) {
  const meses = Array.from({ length: n }, (_, i) => somarMeses(inicio, i));
  const dados = meses.map(m => ({ m, ...resumo(m, UI.conta) }));
  const max = Math.max(1, ...dados.map(d => Math.max(d.entradas, d.saidas)));
  const W = 320, H = 170, base = 140, alt = 120, larg = W / n, bw = Math.min(16, larg / 3.2);
  let barras = '';
  dados.forEach((d, i) => {
    const x = i * larg + larg / 2;
    const he = d.entradas / max * alt, hs = d.saidas / max * alt;
    barras += `<rect x="${x - bw - 1}" y="${base - he}" width="${bw}" height="${Math.max(he, 0)}" rx="3" fill="var(--entrada)"/>
      <rect x="${x + 1}" y="${base - hs}" width="${bw}" height="${Math.max(hs, 0)}" rx="3" fill="var(--saida)"/>
      <text x="${x}" y="${base + 16}" text-anchor="middle">${esc(nomeMes(d.m, true))}</text>`;
  });
  const linhas = dados.map(d => `<button class="mes-linha" data-acao="ir-mes" data-mes="${d.m}">
      <span>${esc(nomeMes(d.m))}<small>entra ${moeda(d.entradas)} · sai ${moeda(d.saidas)}</small></span>
      <b class="${d.sobra < 0 ? 'negativo' : 'positivo'}">${moeda(d.sobra)}</b></button>`).join('');
  return `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Entradas e saídas previstas por mês">
      <line x1="0" y1="${base}" x2="${W}" y2="${base}" stroke="var(--borda)" stroke-width="1"/>${barras}</svg>
    ${legendaH([['var(--entrada)', 'Entradas'], ['var(--saida)', 'Saídas']])}
    <div style="margin:10px -16px -16px;border-top:1px solid var(--borda)">${linhas}</div>`;
}

/* ---------- Telas ---------- */
function render() {
  invalidarCache();
  const comMes = UI.aba === 'inicio' || UI.aba === 'graficos';
  $('#topo-mes').hidden = !comMes;
  $('#topo-texto').hidden = comMes;
  $('#topo-texto').textContent = { planejados: 'Planejados', ajustes: 'Ajustes' }[UI.aba] || '';
  $('#titulo-mes').innerHTML = esc(nomeMes(UI.mes)) + (UI.mes !== mesAtual() ? '<small>toque para voltar ao mês atual</small>' : '');
  $$('.abas button').forEach(b => b.classList.toggle('ativa', b.dataset.aba === UI.aba));
  const telas = { inicio: telaInicio, graficos: telaGraficos, planejados: telaPlanejados, ajustes: telaAjustes };
  $('#view').innerHTML = telas[UI.aba]();
}

function bannerBackup() {
  if (!S.lancamentos.length && !S.recorrentes.length) return '';
  if (S.config.backupAuto) return '';
  const dias = S.ultimoBackup ? diasEntre(S.ultimoBackup.slice(0, 10), hoje()) : Infinity;
  if (dias < DIAS_LEMBRETE_BACKUP) return '';
  const txt = S.ultimoBackup ? `Último backup há ${dias} dias.` : 'Você ainda não fez nenhum backup.';
  return `<div class="banner">💾 <span>${txt}</span><button class="btn peq" data-acao="exportar">Fazer agora</button></div>`;
}

function blocoContas() {
  if (!S.contas.length) return `<div class="cartao vazio"><b>Cadastre suas contas</b>
    Adicione os bancos/carteiras que você usa para registrar o que entra e sai de cada um.
    <div style="margin-top:14px"><button class="btn primario" data-acao="nova-conta">+ Adicionar conta</button></div></div>`;
  const total = saldoAtual(null);
  return `<div class="contas-lista">
    <button class="conta-chip ${UI.conta ? '' : 'ativa'}" data-acao="filtrar-conta" data-id="">
      <div class="nome">Todas as contas</div><div class="saldo ${total < 0 ? 'negativo' : ''}">${moeda(total)}</div></button>
    ${S.contas.map(c => {
      const s = saldoConta(c);
      return `<button class="conta-chip ${UI.conta === c.id ? 'ativa' : ''}" style="--cor:${c.cor}" data-acao="filtrar-conta" data-id="${c.id}">
        <div class="nome">${esc(c.nome)}</div><div class="saldo ${s < 0 ? 'negativo' : ''}">${moeda(s)}</div></button>`;
    }).join('')}
    ${S.cartoes.map(k => {
      const ym = faturaAberta(k);
      return `<button class="conta-chip cartao-chip" style="--cor:${k.cor}" data-acao="ver-cartao" data-id="${k.id}">
        <div class="nome">💳 ${esc(k.nome)}</div><div class="saldo">${moeda(totalFatura(k.id, ym))}</div>
        <div class="nome">fatura ${esc(nomeMes(ym, true))}</div></button>`;
    }).join('')}
  </div>`;
}

function cartaoResumo(rs, { trocar = false } = {}) {
  const cls = rs.sobra < 0 ? 'negativo' : 'positivo';
  const pct = rs.entradas > 0 ? Math.round(rs.saidas / rs.entradas * 100) : null;
  const prop = rs.entradas > 0 ? rs.saidas / rs.entradas : (rs.saidas > 0 ? 1 : 0);
  return `<div class="cartao">
    ${trocar ? `<div class="grafico-topo"><h2>${GRAFICOS.renda.nome}</h2><button class="btn-link" data-acao="trocar-grafico">Trocar gráfico</button></div>` : ''}
    <div class="resumo">
      <div class="resumo-anel">${anelProporcao(prop)}
        <div class="anel-centro"><b>${pct == null ? '—' : pct + '%'}</b><span>da renda<br>comprometida</span></div>
      </div>
      <div class="resumo-linhas">
        <div class="resumo-linha"><div class="rotulo">Entradas</div><div class="valor positivo">${moeda(rs.entradas)}</div>
          <div class="detalhe">recebido ${moeda(rs.recebido)}</div></div>
        <div class="resumo-linha"><div class="rotulo">Saídas</div><div class="valor negativo">${moeda(rs.saidas)}</div>
          <div class="detalhe">pago ${moeda(rs.pago)}</div></div>
      </div>
    </div>
    <div class="pode-gastar"><span>${rs.sobra < 0 ? 'Faltando no mês' : 'Ainda pode gastar'}</span><b class="${cls}">${moeda(rs.sobra)}</b></div>
  </div>`;
}

function cartaoResumoCompacto(rs) {
  return `<div class="cartao">
    <div class="linha-2">
      <div class="resumo-linha"><div class="rotulo">Entradas</div><div class="valor positivo">${moeda(rs.entradas)}</div></div>
      <div class="resumo-linha"><div class="rotulo">Saídas</div><div class="valor negativo">${moeda(rs.saidas)}</div></div>
    </div>
    <div class="pode-gastar"><span>${rs.sobra < 0 ? 'Faltando no mês' : 'Ainda pode gastar'}</span><b class="${rs.sobra < 0 ? 'negativo' : 'positivo'}">${moeda(rs.sobra)}</b></div>
  </div>`;
}

function cartaoGrafico(titulo, corpo, { trocar = false } = {}) {
  return `<div class="cartao grafico">
    ${trocar ? `<div class="grafico-topo"><h2>${esc(titulo)}</h2><button class="btn-link" data-acao="trocar-grafico">Trocar gráfico</button></div>` : `<h2>${esc(titulo)}</h2>`}
    ${corpo}</div>`;
}

function telaInicio() {
  const rs = resumo(UI.mes, UI.conta);
  let itens = itensDoMes(UI.mes).slice();
  if (UI.conta) itens = itens.filter(it => it.contaId === UI.conta || it.contaDestinoId === UI.conta);
  itens.sort((a, b) => b.data.localeCompare(a.data) || (a.pago - b.pago));

  let lista = '';
  if (!itens.length) {
    lista = `<div class="cartao vazio"><b>Nada neste mês</b>Toque no <b style="display:inline">+</b> para registrar uma entrada, saída, parcela ou conta fixa.</div>`;
  } else {
    const porDia = {};
    for (const it of itens) (porDia[it.data] = porDia[it.data] || []).push(it);
    lista = Object.entries(porDia).map(([d, its]) =>
      `<div class="dia-titulo">${esc(nomeDia(d))}</div><div class="lista">${its.map(it => linhaItem(it)).join('')}</div>`).join('');
  }
  const chave = GRAFICOS[S.config.graficoInicio] ? S.config.graficoInicio : 'renda';
  const topo = chave === 'renda'
    ? cartaoResumo(rs, { trocar: true })
    : cartaoGrafico(GRAFICOS[chave].nome, htmlGrafico(chave, UI.mes, UI.conta, rs), { trocar: true }) + cartaoResumoCompacto(rs);
  return bannerBackup() + blocoContas() + topo +
    `<div class="secao-titulo"><span>Lançamentos${UI.conta ? ' · ' + esc(conta(UI.conta)?.nome) : ''}</span>
      ${rs.qtdPendente ? `<span class="aviso-cor">${rs.qtdPendente} pendente(s)</span>` : ''}</div>` + lista;
}

function telaGraficos() {
  const rs = resumo(UI.mes, UI.conta);
  const filtro = UI.conta ? ` · ${conta(UI.conta)?.nome}` : '';
  const orc = grafOrcamento(rs);
  return cartaoResumo(rs) +
    cartaoGrafico(GRAFICOS.disponivel.nome + filtro, grafDisponivel(UI.mes, UI.conta)) +
    cartaoGrafico(GRAFICOS.livre.nome + filtro, grafLivre(UI.mes, UI.conta)) +
    cartaoGrafico(GRAFICOS.ritmo.nome + filtro, grafRitmo(UI.mes, UI.conta, rs)) +
    cartaoGrafico(GRAFICOS.saldo.nome + filtro, grafSaldo(UI.mes, UI.conta)) +
    cartaoGrafico(GRAFICOS.categorias.nome + filtro, grafCategorias(rs)) +
    (orc ? `<div class="cartao"><h2>Orçamento por categoria</h2>${orc}<div class="ajuda">Defina limites em Ajustes → Categorias.</div></div>` : '') +
    cartaoGrafico(GRAFICOS.contas.nome, grafContas(UI.mes)) +
    cartaoGrafico(GRAFICOS.meses.nome + filtro, graficoMeses(UI.mes, 6));
}

function linhaParcelamento(p) {
  const k = p.cartaoId ? cartao(p.cartaoId) : null;
  return `<div class="item" role="button" tabindex="0" data-acao="ver-parcelamento" data-id="${p.id}">
      ${iconeItem(p)}
      <div class="item-meio"><div class="item-titulo">${esc(p.descricao)}<span class="selo">${p.pagas}/${p.total} pagas</span></div>
        <div class="item-sub">${p.total}x de ${moeda(p.parcelas[0].valor)} · ${k ? '💳 ' + esc(k.nome) + ' · ' : ''}termina em ${esc(nomeMes(p.fim, true))}</div></div>
      <div class="item-dir"><span class="item-valor negativo">${moeda(p.restante)}</span></div></div>`;
}

function linhaCartao(k) {
  const ym = faturaAberta(k), usado = limiteUsado(k);
  return `<div class="item" role="button" tabindex="0" data-acao="ver-cartao" data-id="${k.id}">
    <div class="item-icone" style="--cor:${k.cor}">💳</div>
    <div class="item-meio"><div class="item-titulo">${esc(k.nome)}</div>
      <div class="item-sub">Fatura ${esc(nomeMes(ym, true))} vence ${diaMes(dataNoMes(ym, k.diaVencimento))} · ${esc(conta(k.contaId)?.nome || '?')}</div>
      ${k.limite ? `<div class="item-sub">Limite usado ${moeda(usado)} de ${moeda(k.limite)}</div>` : ''}</div>
    <div class="item-dir"><span class="item-valor negativo">${moeda(totalFatura(k.id, ym))}</span></div></div>`;
}

function telaPlanejados() {
  const atual = mesAtual();
  const ativos = S.recorrentes.filter(r => !r.fim || r.fim >= atual);
  const encerrados = S.recorrentes.filter(r => r.fim && r.fim < atual);
  const entFix = soma(ativos.filter(r => r.tipo === 'entrada'), r => r.valor);
  const saiFix = soma(ativos.filter(r => r.tipo === 'saida'), r => r.valor);

  const linhaRec = r => {
    const cat = categoria(r.categoriaId), ct = conta(r.contaId);
    return `<div class="item" role="button" tabindex="0" data-acao="editar-recorrente" data-id="${r.id}">
      <div class="item-icone" style="--cor:${cat?.cor || '#64748b'}">${esc((cat?.nome || r.descricao).charAt(0).toUpperCase())}</div>
      <div class="item-meio"><div class="item-titulo">${esc(r.descricao)}</div>
        <div class="item-sub">Todo dia ${r.dia} · ${esc(ct?.nome || 'Sem conta')}${r.fim ? ' · até ' + esc(nomeMes(r.fim, true)) : ''}</div></div>
      <div class="item-dir"><span class="item-valor ${r.tipo === 'entrada' ? 'positivo' : 'negativo'}">${moeda(r.valor)}</span></div></div>`;
  };

  const ps = parcelamentos().filter(p => p.fim >= atual).sort((a, b) => a.fim.localeCompare(b.fim));
  const psConta = ps.filter(p => !p.cartaoId), psCartao = ps.filter(p => p.cartaoId);

  const proximos = Array.from({ length: 12 }, (_, i) => somarMeses(atual, i)).map(m => {
    const rs = resumo(m);
    const det = [rs.parcelas ? `parcelas ${moeda(rs.parcelas)}` : '', rs.faturas ? `faturas ${moeda(rs.faturas)}` : ''].filter(Boolean).join(' · ');
    return `<button class="mes-linha" data-acao="ir-mes" data-mes="${m}">
      <span>${esc(nomeMes(m))}<small>saídas ${moeda(rs.saidas)}${det ? ` (${det})` : ''}</small></span>
      <b class="${rs.sobra < 0 ? 'negativo' : 'positivo'}">${moeda(rs.sobra)}</b></button>`;
  }).join('');

  return `<div class="cartao"><h2>Fixos mensais</h2>
      <dl class="info-tabela"><dt>Entradas fixas</dt><dd class="positivo">${moeda(entFix)}</dd>
      <dt>Saídas fixas</dt><dd class="negativo">${moeda(saiFix)}</dd>
      <dt>Sobra fixa</dt><dd class="${entFix - saiFix < 0 ? 'negativo' : ''}">${moeda(entFix - saiFix)}</dd></dl></div>
    <div class="secao-titulo"><span>Contas e ganhos fixos</span><button class="btn-link" data-acao="novo-recorrente">+ Novo</button></div>
    ${ativos.length ? `<div class="lista">${ativos.sort((a, b) => a.tipo.localeCompare(b.tipo) || a.dia - b.dia).map(linhaRec).join('')}</div>`
      : `<div class="cartao vazio">Cadastre salário, aluguel, internet… Eles aparecem sozinhos todo mês.</div>`}
    <div class="secao-titulo"><span>Cartões de crédito</span><button class="btn-link" data-acao="novo-cartao">+ Novo</button></div>
    ${S.cartoes.length ? `<div class="lista">${S.cartoes.map(linhaCartao).join('')}</div>`
      : `<div class="cartao vazio">Cadastre seus cartões para lançar compras e ver as faturas.</div>`}
    <div class="secao-titulo"><span>Parcelamentos nos cartões</span></div>
    ${psCartao.length ? `<div class="lista">${psCartao.map(linhaParcelamento).join('')}</div>`
      : `<div class="cartao vazio">Nenhuma compra parcelada no cartão.</div>`}
    <div class="secao-titulo"><span>Parcelamentos na conta</span></div>
    ${psConta.length ? `<div class="lista">${psConta.map(linhaParcelamento).join('')}</div>`
      : `<div class="cartao vazio">Nenhuma compra parcelada direto na conta (boleto, carnê…).</div>`}
    <div class="secao-titulo"><span>Próximos 12 meses</span><span style="text-transform:none;letter-spacing:0">sobra prevista</span></div>
    <div class="lista">${proximos}</div>
    ${encerrados.length ? `<div class="secao-titulo"><span>Fixos encerrados</span></div><div class="lista">${encerrados.map(linhaRec).join('')}</div>` : ''}`;
}

function telaAjustes() {
  const contas = S.contas.map(c => `<div class="item" role="button" tabindex="0" data-acao="editar-conta" data-id="${c.id}">
      <div class="item-icone" style="--cor:${c.cor}">${esc(c.nome.charAt(0).toUpperCase())}</div>
      <div class="item-meio"><div class="item-titulo">${esc(c.nome)}</div><div class="item-sub">${esc(c.uso || 'Toque para editar')}</div></div>
      <div class="item-dir"><span class="item-valor">${moeda(saldoConta(c))}</span></div></div>`).join('');
  const cartoes = S.cartoes.map(k => `<div class="item" role="button" tabindex="0" data-acao="editar-cartao" data-id="${k.id}">
      <div class="item-icone" style="--cor:${k.cor}">💳</div>
      <div class="item-meio"><div class="item-titulo">${esc(k.nome)}</div>
        <div class="item-sub">Fecha dia ${k.diaFechamento} · vence dia ${k.diaVencimento} · ${esc(conta(k.contaId)?.nome || '?')}</div></div></div>`).join('');
  const linhaCat = c => `<div class="item" role="button" tabindex="0" data-acao="editar-categoria" data-id="${c.id}">
      <div class="item-icone" style="--cor:${c.cor}">${esc(c.nome.charAt(0).toUpperCase())}</div>
      <div class="item-meio"><div class="item-titulo">${esc(c.nome)}</div>
        <div class="item-sub">${c.tipo === 'entrada' ? 'Entrada' : 'Saída'}${c.limite > 0 ? ' · limite ' + moeda(c.limite) + '/mês' : ''}</div></div></div>`;
  const ultimo = S.ultimoBackup ? new Date(S.ultimoBackup).toLocaleString('pt-BR') : 'nunca';
  return `<div class="secao-titulo"><span>Contas</span><button class="btn-link" data-acao="nova-conta">+ Nova</button></div>
    ${contas ? `<div class="lista">${contas}</div>` : `<div class="cartao vazio">Nenhuma conta cadastrada.</div>`}
    <div class="secao-titulo"><span>Cartões de crédito</span><button class="btn-link" data-acao="novo-cartao">+ Novo</button></div>
    ${cartoes ? `<div class="lista">${cartoes}</div>` : `<div class="cartao vazio">Nenhum cartão cadastrado.</div>`}
    <div class="secao-titulo"><span>Gráfico da tela inicial</span></div>
    <div class="lista"><button class="item" data-acao="trocar-grafico"><div class="item-meio"><div class="item-titulo">${esc(GRAFICOS[S.config.graficoInicio]?.nome || GRAFICOS.renda.nome)}</div>
      <div class="item-sub">Toque para trocar</div></div></button></div>
    <div class="secao-titulo"><span>Categorias de saída</span><button class="btn-link" data-acao="nova-categoria" data-tipo="saida">+ Nova</button></div>
    <div class="lista">${S.categorias.filter(c => c.tipo === 'saida').map(linhaCat).join('')}</div>
    <div class="secao-titulo"><span>Categorias de entrada</span><button class="btn-link" data-acao="nova-categoria" data-tipo="entrada">+ Nova</button></div>
    <div class="lista">${S.categorias.filter(c => c.tipo === 'entrada').map(linhaCat).join('')}</div>
    <div class="secao-titulo"><span>Backup</span></div>
    <div class="cartao">
      <p style="margin:0 0 12px;font-size:.9rem">Seus dados ficam <b>somente neste aparelho</b>. Faça backup de vez em quando e guarde o arquivo no Google Drive.</p>
      <p class="ajuda" style="margin:0 0 12px">Último backup: ${esc(ultimo)}</p>
      <label class="switch" style="margin:0 0 10px"><span>Backup automático<br><small class="ajuda">Salva um arquivo em Downloads no primeiro toque ao abrir o app, quando estiver na hora.</small></span>
        <input type="checkbox" id="cfg-backup-auto" ${S.config.backupAuto ? 'checked' : ''}></label>
      <label class="campo" style="margin:0 0 12px" ${S.config.backupAuto ? '' : 'hidden'} id="cfg-dias-wrap"><span>Frequência</span>
        <select id="cfg-backup-dias">${[[1, 'Todo dia'], [3, 'A cada 3 dias'], [7, 'Toda semana'], [15, 'A cada 15 dias']]
          .map(([v, t]) => `<option value="${v}" ${S.config.backupDias === v ? 'selected' : ''}>${t}</option>`).join('')}</select></label>
      <div class="pilha">
        <button class="btn primario" data-acao="exportar">Exportar backup</button>
        <button class="btn" data-acao="importar">Importar backup</button>
      </div>
    </div>
    <div class="secao-titulo"><span>Zona de perigo</span></div>
    <div class="cartao"><button class="btn perigo bloco" data-acao="apagar-tudo">Apagar todos os dados</button></div>
    <p class="rodape">Finanças · funciona offline${UI.persistente == null ? '' : ' · armazenamento ' + (UI.persistente ? 'protegido' : 'padrão')}</p>`;
}

/* ---------- Folha inferior (sheet) ---------- */
let sheetAberto = false;
function abrirSheet(html, montar) {
  $('#sheet-corpo').innerHTML = html;
  $('#sheet').classList.add('aberto');
  $('#sheet').setAttribute('aria-hidden', 'false');
  document.body.classList.add('travado');
  $('.sheet-painel').scrollTop = 0;
  if (!sheetAberto) { history.pushState({ sheet: true }, ''); sheetAberto = true; }
  if (montar) montar($('#sheet-corpo'));
}
function esconderSheet() {
  $('#sheet').classList.remove('aberto');
  $('#sheet').setAttribute('aria-hidden', 'true');
  document.body.classList.remove('travado');
}
function fecharSheet() { if (sheetAberto) history.back(); else esconderSheet(); }
window.addEventListener('popstate', () => { if (sheetAberto) { sheetAberto = false; esconderSheet(); } });
/** Salva, fecha a folha, redesenha e mostra uma mensagem. */
function concluir(msg) { salvar(); fecharSheet(); render(); if (msg) toast(msg); }

let toastTimer;
function toast(msg) {
  const t = $('#toast');
  t.textContent = msg; t.classList.add('visivel');
  clearTimeout(toastTimer); toastTimer = setTimeout(() => t.classList.remove('visivel'), 2600);
}

/* Helpers de formulário */
const seg = (nome, opcoes, atual, extra = '') => `<div class="seg ${extra}" data-seg="${nome}">${opcoes.map(([v, t]) =>
  `<button type="button" data-v="${v}" class="${v === atual ? 'ativa' : ''}">${t}</button>`).join('')}</div>`;
function ligarSeg(root, nome, aoMudar) {
  const el = root.querySelector(`[data-seg="${nome}"]`);
  if (!el) return;
  el.addEventListener('click', e => {
    const b = e.target.closest('button[data-v]'); if (!b) return;
    marcarSeg(root, nome, b.dataset.v);
    aoMudar(b.dataset.v);
  });
}
const marcarSeg = (root, nome, v) => root.querySelectorAll(`[data-seg="${nome}"] button`).forEach(x => x.classList.toggle('ativa', x.dataset.v === v));
const opcoesContas = (sel, excluir) => S.contas.filter(c => c.id !== excluir)
  .map(c => `<option value="${c.id}" ${c.id === sel ? 'selected' : ''}>${esc(c.nome)}</option>`).join('');
function opcoesPagarCom(contaSel, cartaoSel) {
  const contas = S.contas.map(c => `<option value="conta:${c.id}" ${!cartaoSel && c.id === contaSel ? 'selected' : ''}>${esc(c.nome)}</option>`).join('');
  const cartoes = S.cartoes.map(k => `<option value="cartao:${k.id}" ${k.id === cartaoSel ? 'selected' : ''}>💳 ${esc(k.nome)}</option>`).join('');
  return `<optgroup label="Contas">${contas}</optgroup>` + (cartoes ? `<optgroup label="Cartões de crédito">${cartoes}</optgroup>` : '');
}
function chipsCategorias(tipo, sel) {
  return S.categorias.filter(c => c.tipo === tipo).map(c =>
    `<button type="button" class="chip ${c.id === sel ? 'ativa' : ''}" data-cat="${c.id}" style="--cor:${c.cor}"><i></i>${esc(c.nome)}</button>`).join('')
    + `<button type="button" class="chip" data-acao="nova-categoria-rapida" data-tipo="${tipo}">+ Nova</button>`;
}
const escolhaCores = sel => `<div class="cores">${CORES.map(c => `<button type="button" class="cor-op ${c === sel ? 'ativa' : ''}" data-cor="${c}" style="--cor:${c}" aria-label="Cor ${c}"></button>`).join('')}</div>`;
function ligarCores(root, aoMudar) {
  root.querySelector('.cores').addEventListener('click', e => {
    const b = e.target.closest('[data-cor]'); if (!b) return;
    root.querySelectorAll('.cor-op').forEach(x => x.classList.toggle('ativa', x === b));
    aoMudar(b.dataset.cor);
  });
}
function precisaConta() {
  if (S.contas.length) return false;
  abrirSheet(`<h2>Primeiro, uma conta</h2><p class="sub">Cadastre pelo menos uma conta (banco, carteira…) para registrar movimentações.</p>
    <button class="btn primario bloco" data-acao="nova-conta">+ Adicionar conta</button>`);
  return true;
}
/** Folha de confirmação com um botão extra (vermelho) para ações destrutivas. */
function confirmarPerigo({ titulo, texto, botao, aoConfirmar }) {
  abrirSheet(`<h2>${esc(titulo)}</h2><div class="sub">${texto}</div>
    <div class="acoes"><button class="btn" data-acao="fechar-sheet">Cancelar</button>
    <button class="btn perigo-forte" id="perigo-ok">${esc(botao)}</button></div>`, root => {
    $('#perigo-ok', root).addEventListener('click', aoConfirmar);
  });
}

/* ---------- Formulário: lançamento ---------- */
function formLancamento(l = null, opts = {}) {
  if (precisaConta()) return;
  const editando = !!l;
  const f = {
    tipo: l?.tipo || 'saida',
    modo: 'unica',
    base: 'total',
    catId: l?.categoriaId || null,
    contaId: l?.contaId || UI.conta || S.contas[0].id,
    destId: l?.contaDestinoId || null,
    cartaoId: l?.cartaoId || opts.cartaoId || null,
    pagoTocado: editando,
  };
  if (!conta(f.contaId)) f.contaId = S.contas[0].id;
  const dataPadrao = l?.data || (UI.mes === mesAtual() ? hoje() : `${UI.mes}-01`);
  const parcInfo = l?.grupoId ? `<p class="sub">Parcela ${l.parcela} de ${l.totalParcelas}. Alterações valem só para esta parcela.</p>` : '';

  abrirSheet(`<h2>${editando ? 'Editar lançamento' : f.cartaoId ? 'Nova compra no cartão' : 'Novo lançamento'}</h2>${parcInfo}
    ${l?.grupoId ? '' : seg('tipo', [['saida', 'Saída'], ['entrada', 'Entrada'], ['transferencia', 'Transferência']], f.tipo, 'tipo')}
    <label class="campo"><span>Valor</span><input id="f-valor" class="valor-grande" inputmode="decimal" placeholder="0,00" value="${valorParaCampo(l?.valor)}"></label>
    <div id="f-modo-wrap">${editando ? '' : `<div class="campo"><span>Como é</span>${seg('modo', [['unica', 'Única'], ['parcelada', 'Parcelada'], ['fixa', 'Todo mês']], 'unica')}</div>`}</div>
    <div id="f-parc" hidden>
      <div class="linha-2">
        <label class="campo"><span>Nº de parcelas</span><input id="f-nparc" type="number" inputmode="numeric" min="2" max="120" value="2"></label>
        <div class="campo"><span>O valor digitado é</span>${seg('base', [['total', 'Total'], ['parcela', 'Parcela']], 'total')}</div>
      </div>
      <div class="ajuda" id="f-parc-prev"></div>
    </div>
    <label class="campo"><span>Descrição</span><input id="f-desc" maxlength="60" placeholder="Ex.: Mercado, Uber, Geladeira" value="${esc(l?.descricao || '')}"></label>
    <div id="f-contas"></div>
    <div class="campo" id="f-cat-wrap"><span>Categoria</span><div class="chips" id="f-cats"></div></div>
    <label class="campo"><span id="f-data-rot">Data</span><input id="f-data" type="date" value="${dataPadrao}"></label>
    <label class="campo"><span>Anotação</span><textarea id="f-nota" rows="2" placeholder="Onde foi, com quem, detalhes…">${esc(l?.nota || '')}</textarea></label>
    <label class="switch" id="f-pago-wrap"><span id="f-pago-txt">Já foi pago</span><input type="checkbox" id="f-pago"></label>
    <div class="acoes">
      ${editando ? `<button class="btn perigo" id="f-excluir">Excluir</button>` : `<button class="btn" data-acao="fechar-sheet">Cancelar</button>`}
      <button class="btn primario" id="f-salvar">Salvar</button>
    </div>`, root => {
    const pago = $('#f-pago', root);
    pago.checked = editando ? !!l.pago : dataPadrao <= hoje();
    const usaCartao = () => f.tipo === 'saida' && !!f.cartaoId && !!cartao(f.cartaoId);

    const desenharContas = () => {
      const box = $('#f-contas', root);
      if (f.tipo === 'transferencia') {
        if (!f.destId || f.destId === f.contaId) f.destId = S.contas.find(c => c.id !== f.contaId)?.id || f.contaId;
        box.innerHTML = `<div class="linha-2">
          <label class="campo"><span>Sai de</span><select id="f-conta">${opcoesContas(f.contaId)}</select></label>
          <label class="campo"><span>Vai para</span><select id="f-conta-dest">${opcoesContas(f.destId)}</select></label></div>`;
      } else if (f.tipo === 'entrada') {
        box.innerHTML = `<label class="campo"><span>Conta</span><select id="f-conta">${opcoesContas(f.contaId)}</select></label>`;
      } else {
        box.innerHTML = `<label class="campo"><span>Pagar com</span><select id="f-pagar">${opcoesPagarCom(f.contaId, f.cartaoId)}</select></label>
          <div class="ajuda" id="f-fatura-info"></div>`;
      }
    };
    const desenharCats = () => {
      if (f.tipo === 'transferencia') { $('#f-cat-wrap', root).hidden = true; return; }
      $('#f-cat-wrap', root).hidden = false;
      if (f.catId && categoria(f.catId)?.tipo !== f.tipo) f.catId = null;
      if (!f.catId) f.catId = S.categorias.find(c => c.tipo === f.tipo)?.id || null;
      $('#f-cats', root).innerHTML = chipsCategorias(f.tipo, f.catId);
    };
    const atualizarPrevia = () => {
      const v = lerValor($('#f-valor', root).value), n = parseInt($('#f-nparc', root).value, 10);
      const ini = $('#f-data', root).value || hoje();
      const k = usaCartao() ? cartao(f.cartaoId) : null;
      const info = $('#f-fatura-info', root);
      if (info) {
        if (k) {
          const fat = faturaDe(k, ini);
          info.textContent = `Cai na fatura de ${nomeMes(fat)} (vence ${diaMes(dataNoMes(fat, k.diaVencimento))})` +
            (f.modo === 'parcelada' && n >= 2 ? ` até a de ${nomeMes(somarMeses(fat, n - 1), true)}` : '');
        } else info.textContent = '';
      }
      const prev = $('#f-parc-prev', root);
      if (!(v > 0) || !(n >= 2)) { prev.textContent = ''; return; }
      const porParc = f.base === 'total' ? v / n : v, total = f.base === 'total' ? v : v * n;
      const m0 = k ? faturaDe(k, ini) : ini.slice(0, 7);
      prev.textContent = `${n}x de ${moeda(porParc)} = ${moeda(total)} · de ${nomeMes(m0, true)} até ${nomeMes(somarMeses(m0, n - 1), true)}`;
    };
    const atualizarTextos = () => {
      const cartaoSel = usaCartao();
      if (cartaoSel && f.modo === 'fixa') { f.modo = 'unica'; marcarSeg(root, 'modo', 'unica'); }
      const btnFixa = root.querySelector('[data-seg="modo"] button[data-v="fixa"]');
      if (btnFixa) btnFixa.hidden = cartaoSel;
      $('#f-parc', root).hidden = f.modo !== 'parcelada';
      $('#f-modo-wrap', root).hidden = f.tipo === 'transferencia';
      $('#f-pago-wrap', root).hidden = cartaoSel;
      $('#f-data-rot', root).textContent = f.modo === 'parcelada' ? (cartaoSel ? 'Data da compra' : 'Data da 1ª parcela') : f.modo === 'fixa' ? 'Começa em (o dia se repete todo mês)' : cartaoSel ? 'Data da compra' : 'Data';
      $('#f-pago-txt', root).textContent = f.tipo === 'transferencia' ? 'Já foi feita' :
        (f.modo === 'parcelada' ? '1ª parcela já foi ' : 'Já foi ') +
        (f.tipo === 'entrada' ? 'recebida' : 'paga') + (f.modo === 'fixa' ? ' neste mês' : '');
      atualizarPrevia();
    };

    desenharContas(); desenharCats(); atualizarTextos();
    ligarSeg(root, 'tipo', v => {
      f.tipo = v;
      if (v === 'transferencia') { f.modo = 'unica'; marcarSeg(root, 'modo', 'unica'); }
      desenharContas(); desenharCats(); atualizarTextos();
    });
    ligarSeg(root, 'modo', v => { f.modo = v; atualizarTextos(); });
    ligarSeg(root, 'base', v => { f.base = v; atualizarPrevia(); });
    $('#f-contas', root).addEventListener('change', e => {
      if (e.target.id === 'f-pagar') {
        const [t, id] = e.target.value.split(':');
        if (t === 'cartao') f.cartaoId = id; else { f.cartaoId = null; f.contaId = id; }
        atualizarTextos();
      } else if (e.target.id === 'f-conta') f.contaId = e.target.value;
      else if (e.target.id === 'f-conta-dest') f.destId = e.target.value;
    });
    $('#f-cats', root).addEventListener('click', e => {
      const b = e.target.closest('[data-cat]'); if (!b) return;
      f.catId = b.dataset.cat; desenharCats();
    });
    ['#f-valor', '#f-nparc'].forEach(s => $(s, root).addEventListener('input', atualizarPrevia));
    $('#f-data', root).addEventListener('change', () => { if (!f.pagoTocado) pago.checked = $('#f-data', root).value <= hoje(); atualizarPrevia(); });
    pago.addEventListener('change', () => f.pagoTocado = true);

    $('#f-salvar', root).addEventListener('click', () => {
      const valor = lerValor($('#f-valor', root).value);
      if (!(valor > 0)) return toast('Informe um valor válido');
      const data = $('#f-data', root).value;
      if (!data) return toast('Informe a data');
      const k = usaCartao() ? cartao(f.cartaoId) : null;
      const contaId = k ? null : f.contaId;
      const contaDestinoId = f.tipo === 'transferencia' ? f.destId : null;
      if (f.tipo === 'transferencia' && contaId === contaDestinoId) return toast('Escolha contas diferentes');
      const categoriaId = f.tipo === 'transferencia' ? null : f.catId;
      const descricao = $('#f-desc', root).value.trim() || (f.tipo === 'transferencia' ? 'Transferência' : categoria(categoriaId)?.nome || 'Lançamento');
      const nota = $('#f-nota', root).value.trim();
      const n = f.modo === 'parcelada' ? parseInt($('#f-nparc', root).value, 10) : 1;
      if (f.modo === 'parcelada' && !(n >= 2 && n <= 120)) return toast('Parcelas: de 2 a 120');

      if (k && k.limite > 0 && !editando) {
        const novo = f.modo === 'parcelada' && f.base === 'parcela' ? valor * n : valor;
        const usado = limiteUsado(k);
        if (usado + novo > k.limite && !confirm(`Essa compra passa do limite do cartão ${k.nome}.\nUsado: ${moeda(usado)} de ${moeda(k.limite)}.\n\nSalvar mesmo assim?`)) return;
      }
      const dadosCartao = (iso, i = 0) => k ? { cartaoId: k.id, fatura: somarMeses(faturaDe(k, iso), i) } : { cartaoId: null, fatura: null };

      if (editando) {
        Object.assign(l, { tipo: f.tipo, valor, data, contaId, contaDestinoId, categoriaId, descricao, nota, pago: k ? false : pago.checked, ...dadosCartao(data, l.grupoId ? l.parcela - 1 : 0) });
      } else if (f.modo === 'parcelada') {
        const totalCent = Math.round((f.base === 'total' ? valor : valor * n) * 100);
        const baseCent = Math.floor(totalCent / n), resto = totalCent - baseCent * n;
        const grupoId = uid();
        for (let i = 0; i < n; i++) {
          S.lancamentos.push({
            id: uid(), tipo: f.tipo, valor: (baseCent + (i < resto ? 1 : 0)) / 100,
            data: k ? data : somarMesesData(data, i), // no cartão, todas as parcelas guardam a data da compra
            contaId, contaDestinoId: null, categoriaId, descricao, nota, pago: !k && i === 0 && pago.checked,
            grupoId, parcela: i + 1, totalParcelas: n, ...dadosCartao(data, i),
          });
        }
      } else if (f.modo === 'fixa') {
        const ym = data.slice(0, 7);
        S.recorrentes.push({
          id: uid(), tipo: f.tipo, valor, dia: Number(data.slice(8, 10)), contaId, categoriaId, descricao, nota,
          inicio: ym, fim: null, pagos: pago.checked ? { [ym]: valor } : {}, pulados: [],
        });
      } else {
        S.lancamentos.push({ id: uid(), tipo: f.tipo, valor, data, contaId, contaDestinoId, categoriaId, descricao, nota, pago: !k && pago.checked, ...dadosCartao(data) });
      }
      concluir(editando ? 'Alterado' : f.modo === 'parcelada' ? 'Parcelas criadas' : f.modo === 'fixa' ? 'Fixo criado' : k ? 'Compra lançada no cartão' : 'Lançamento salvo');
    });

    $('#f-excluir', root)?.addEventListener('click', () => {
      if (l.grupoId) {
        const todas = confirm(`Excluir TODAS as ${l.totalParcelas} parcelas de "${l.descricao}"?\n\nOK = todas · Cancelar = escolher só esta`);
        if (todas) S.lancamentos = S.lancamentos.filter(x => x.grupoId !== l.grupoId);
        else if (confirm('Excluir só esta parcela?')) S.lancamentos = S.lancamentos.filter(x => x.id !== l.id);
        else return;
      } else {
        if (!confirm('Excluir este lançamento?')) return;
        S.lancamentos = S.lancamentos.filter(x => x.id !== l.id);
      }
      concluir('Excluído');
    });
  });
}

/* ---------- Ocorrência de um fixo em um mês ---------- */
function verOcorrencia(recId, ym) {
  const r = recorrente(recId); if (!r) return;
  const pago = r.pagos[ym] != null;
  const cat = categoria(r.categoriaId), ct = conta(r.contaId);
  const verbo = r.tipo === 'entrada' ? 'recebido' : 'pago';
  abrirSheet(`<h2>${esc(r.descricao)}</h2><p class="sub">Fixo mensal · ${esc(nomeMes(ym))}</p>
    <dl class="info-tabela">
      <dt>Valor</dt><dd class="${r.tipo === 'entrada' ? 'positivo' : 'negativo'}">${moeda(pago ? r.pagos[ym] : r.valor)}</dd>
      <dt>Vencimento</dt><dd>dia ${r.dia}</dd>
      <dt>Conta</dt><dd>${esc(ct?.nome || '—')}</dd>
      <dt>Categoria</dt><dd>${esc(cat?.nome || '—')}</dd>
      ${r.nota ? `<dt>Anotação</dt><dd>${esc(r.nota)}</dd>` : ''}
      <dt>Situação</dt><dd class="${pago ? 'positivo' : 'aviso-cor'}">${pago ? (r.tipo === 'entrada' ? 'Recebido' : 'Pago') : 'Pendente'}</dd>
    </dl>
    ${pago ? '' : `<label class="campo"><span>Valor deste mês (se for diferente)</span><input id="o-valor" inputmode="decimal" value="${valorParaCampo(r.valor)}"></label>`}
    <div class="pilha" style="margin-top:16px">
      <button class="btn primario" id="o-pagar">${pago ? 'Desmarcar ' + verbo : 'Marcar como ' + verbo}</button>
      <button class="btn" data-acao="editar-recorrente" data-id="${r.id}">Editar fixo</button>
      <div class="linha-2">
        <button class="btn" id="o-pular">Pular este mês</button>
        <button class="btn perigo" id="o-encerrar">Encerrar fixo</button>
      </div>
    </div>`, root => {
    $('#o-pagar', root).addEventListener('click', () => {
      if (pago) delete r.pagos[ym];
      else {
        const v = lerValor($('#o-valor', root).value);
        if (!(v > 0)) return toast('Valor inválido');
        r.pagos[ym] = v;
      }
      concluir();
    });
    $('#o-pular', root).addEventListener('click', () => {
      if (!confirm(`Não cobrar "${r.descricao}" em ${nomeMes(ym)}?`)) return;
      r.pulados.push(ym); delete r.pagos[ym];
      concluir('Mês pulado');
    });
    $('#o-encerrar', root).addEventListener('click', () => {
      if (!confirm(`Encerrar "${r.descricao}"? Ele deixa de aparecer depois de ${nomeMes(ym)}. O histórico fica guardado.`)) return;
      r.fim = ym;
      concluir('Fixo encerrado');
    });
  });
}

/* ---------- Formulário: fixo (recorrente) ---------- */
function formRecorrente(r = null) {
  if (precisaConta()) return;
  const editando = !!r;
  const f = { tipo: r?.tipo || 'saida', catId: r?.categoriaId || null };
  abrirSheet(`<h2>${editando ? 'Editar fixo' : 'Nova conta/ganho fixo'}</h2>
    <p class="sub">Repete todo mês automaticamente.${editando ? ' Mudar o valor não altera meses já pagos.' : ''}</p>
    ${seg('tipo', [['saida', 'Conta (saída)'], ['entrada', 'Ganho (entrada)']], f.tipo, 'tipo')}
    <label class="campo"><span>Valor mensal</span><input id="r-valor" class="valor-grande" inputmode="decimal" placeholder="0,00" value="${valorParaCampo(r?.valor)}"></label>
    <label class="campo"><span>Descrição</span><input id="r-desc" maxlength="60" placeholder="Ex.: Salário, Aluguel, Internet" value="${esc(r?.descricao || '')}"></label>
    <div class="linha-2">
      <label class="campo"><span>Dia do mês</span><input id="r-dia" type="number" inputmode="numeric" min="1" max="31" value="${r?.dia || Number(hoje().slice(8))}"></label>
      <label class="campo"><span>Conta</span><select id="r-conta">${opcoesContas(r?.contaId || UI.conta || S.contas[0].id)}</select></label>
    </div>
    <div class="campo"><span>Categoria</span><div class="chips" id="r-cats"></div></div>
    <div class="linha-2">
      <label class="campo"><span>Começa em</span><input id="r-inicio" type="month" value="${r?.inicio || UI.mes}"></label>
      <label class="campo"><span>Termina em (opcional)</span><input id="r-fim" type="month" value="${r?.fim || ''}"></label>
    </div>
    <label class="campo"><span>Anotação</span><textarea id="r-nota" rows="2">${esc(r?.nota || '')}</textarea></label>
    <div class="acoes">
      ${editando ? `<button class="btn perigo" id="r-excluir">Excluir</button>` : `<button class="btn" data-acao="fechar-sheet">Cancelar</button>`}
      <button class="btn primario" id="r-salvar">Salvar</button>
    </div>`, root => {
    const desenharCats = () => {
      if (f.catId && categoria(f.catId)?.tipo !== f.tipo) f.catId = null;
      if (!f.catId) f.catId = (f.tipo === 'saida' ? categoria('cat-fixos') : categoria('cat-salario'))?.id || S.categorias.find(c => c.tipo === f.tipo)?.id || null;
      $('#r-cats', root).innerHTML = chipsCategorias(f.tipo, f.catId);
    };
    desenharCats();
    ligarSeg(root, 'tipo', v => { f.tipo = v; desenharCats(); });
    $('#r-cats', root).addEventListener('click', e => { const b = e.target.closest('[data-cat]'); if (b) { f.catId = b.dataset.cat; desenharCats(); } });

    $('#r-salvar', root).addEventListener('click', () => {
      const valor = lerValor($('#r-valor', root).value);
      if (!(valor > 0)) return toast('Informe um valor válido');
      const dia = parseInt($('#r-dia', root).value, 10);
      if (!(dia >= 1 && dia <= 31)) return toast('Dia deve ser de 1 a 31');
      const inicio = $('#r-inicio', root).value, fim = $('#r-fim', root).value || null;
      if (!inicio) return toast('Informe o mês de início');
      if (fim && fim < inicio) return toast('O fim é antes do início');
      const dados = {
        tipo: f.tipo, valor, dia, contaId: $('#r-conta', root).value, categoriaId: f.catId,
        descricao: $('#r-desc', root).value.trim() || categoria(f.catId)?.nome || 'Fixo',
        nota: $('#r-nota', root).value.trim(), inicio, fim,
      };
      if (editando) Object.assign(r, dados);
      else S.recorrentes.push({ id: uid(), ...dados, pagos: {}, pulados: [] });
      concluir('Fixo salvo');
    });
    $('#r-excluir', root)?.addEventListener('click', () => {
      if (!confirm(`Excluir "${r.descricao}" e TODO o seu histórico (inclusive meses já pagos)?\n\nPara só parar de cobrar, use "Termina em".`)) return;
      S.recorrentes = S.recorrentes.filter(x => x.id !== r.id);
      concluir('Fixo excluído');
    });
  });
}

/* ---------- Detalhe de um parcelamento ---------- */
function verParcelamento(grupoId) {
  const p = parcelamentos().find(x => x.id === grupoId); if (!p) return;
  const k = p.cartaoId ? cartao(p.cartaoId) : null;
  abrirSheet(`<h2>${esc(p.descricao)}</h2>
    <p class="sub">${p.total}x · total ${moeda(p.valorTotal)} · ${k ? '💳 ' + esc(k.nome) : esc(conta(p.contaId)?.nome || '')}</p>
    <dl class="info-tabela"><dt>Pagas</dt><dd>${p.pagas} de ${p.total}</dd><dt>Falta pagar</dt><dd class="negativo">${moeda(p.restante)}</dd></dl>
    ${k ? '<p class="ajuda">No cartão, cada parcela é considerada paga quando a fatura dela é paga.</p>' : ''}
    <div class="lista">${p.parcelas.map(x => linhaItem({ ...x, origem: 'lanc' })).join('')}</div>
    <div class="acoes"><button class="btn perigo" id="p-excluir">Excluir parcelamento</button></div>`, root => {
    $('#p-excluir', root).addEventListener('click', () => {
      if (!confirm(`Excluir as ${p.total} parcelas de "${p.descricao}"?`)) return;
      S.lancamentos = S.lancamentos.filter(x => x.grupoId !== grupoId);
      concluir('Parcelamento excluído');
    });
  });
}

/* ---------- Cartão: detalhe, fatura e formulário ---------- */
function verCartao(id) {
  const k = cartao(id); if (!k) return;
  const usado = limiteUsado(k), aberta = faturaAberta(k);
  const faturas = Array.from({ length: 7 }, (_, i) => somarMeses(aberta, i - 1)).map(ym => {
    const total = totalFatura(k.id, ym), paga = k.faturasPagas[ym] != null;
    if (!total && !paga && ym < aberta) return '';
    return `<button class="mes-linha" data-acao="ver-fatura" data-id="${k.id}" data-mes="${ym}">
      <span>Fatura ${esc(nomeMes(ym))}<small>vence ${diaMes(dataNoMes(ym, k.diaVencimento))}${ym === aberta ? ' · aberta agora' : ''}${paga ? ' · paga' : ''}</small></span>
      <b class="${paga ? 'positivo' : 'negativo'}">${moeda(paga ? k.faturasPagas[ym] : total)}</b></button>`;
  }).join('');
  const ps = parcelamentos().filter(p => p.cartaoId === k.id && p.restante > 0);
  abrirSheet(`<h2>💳 ${esc(k.nome)}</h2>
    <p class="sub">Fecha dia ${k.diaFechamento} · vence dia ${k.diaVencimento} · paga com ${esc(conta(k.contaId)?.nome || '?')}</p>
    ${k.limite ? `<div class="cat-topo"><span>Limite usado</span><b>${moeda(usado)} de ${moeda(k.limite)}</b></div>
      <div class="barra"><div style="width:${Math.min(usado / k.limite, 1) * 100}%;--cor:${usado / k.limite >= .8 ? 'var(--alerta)' : k.cor}"></div></div>
      <div class="cat-info">Disponível: ${moeda(k.limite - usado)} (inclui parcelas futuras)</div>` : ''}
    <div class="secao-titulo"><span>Faturas</span></div>
    <div class="lista">${faturas}</div>
    ${ps.length ? `<div class="secao-titulo"><span>Parcelamentos neste cartão</span></div><div class="lista">${ps.map(linhaParcelamento).join('')}</div>` : ''}
    <div class="acoes"><button class="btn" data-acao="editar-cartao" data-id="${k.id}">Editar cartão</button>
      <button class="btn primario" data-acao="nova-compra-cartao" data-id="${k.id}">+ Compra</button></div>`);
}

function verFatura(id, ym) {
  const k = cartao(id); if (!k) return;
  const compras = comprasDaFatura(id, ym).slice().sort((a, b) => b.data.localeCompare(a.data));
  const total = totalFatura(id, ym), pagoV = k.faturasPagas[ym], paga = pagoV != null;
  abrirSheet(`<h2>Fatura ${esc(k.nome)}</h2>
    <p class="sub">${esc(nomeMes(ym))} · vence ${diaMes(dataNoMes(ym, k.diaVencimento))}</p>
    <dl class="info-tabela">
      <dt>Total das compras</dt><dd class="negativo">${moeda(total)}</dd>
      <dt>Paga com</dt><dd>${esc(conta(k.contaId)?.nome || '?')}</dd>
      <dt>Situação</dt><dd class="${paga ? 'positivo' : 'aviso-cor'}">${paga ? 'Paga · ' + moeda(pagoV) : 'Em aberto'}</dd>
    </dl>
    ${paga && Math.abs(pagoV - total) > 0.009 ? `<p class="ajuda">O valor pago é diferente do total atual das compras.</p>` : ''}
    ${paga ? '' : `<label class="campo"><span>Valor a pagar</span><input id="fa-valor" inputmode="decimal" value="${valorParaCampo(total)}"></label>`}
    <div class="pilha" style="margin-top:14px">
      <button class="btn primario" id="fa-pagar">${paga ? 'Desmarcar pagamento' : 'Marcar fatura como paga'}</button>
      <button class="btn" data-acao="nova-compra-cartao" data-id="${k.id}">+ Compra neste cartão</button>
    </div>
    <div class="secao-titulo"><span>Compras (${compras.length})</span></div>
    ${compras.length ? `<div class="lista">${compras.map(l => linhaItem({ ...l, origem: 'lanc' }, { mostrarData: true })).join('')}</div>`
      : '<div class="vazio">Nenhuma compra nesta fatura.</div>'}`, root => {
    $('#fa-pagar', root).addEventListener('click', () => {
      if (paga) delete k.faturasPagas[ym];
      else {
        const v = lerValor($('#fa-valor', root).value);
        if (!(v >= 0)) return toast('Valor inválido');
        k.faturasPagas[ym] = v;
      }
      concluir(paga ? 'Pagamento desmarcado' : 'Fatura paga');
    });
  });
}

function formCartao(k = null) {
  if (precisaConta()) return;
  const editando = !!k;
  let cor = k?.cor || CORES[(S.cartoes.length + 3) % CORES.length];
  abrirSheet(`<h2>${editando ? 'Editar cartão' : 'Novo cartão de crédito'}</h2>
    <label class="campo"><span>Nome</span><input id="k-nome" maxlength="30" placeholder="Ex.: Nubank Roxinho, Itaú Visa" value="${esc(k?.nome || '')}"></label>
    <label class="campo"><span>Conta que paga a fatura</span><select id="k-conta">${opcoesContas(k?.contaId || UI.conta || S.contas[0].id)}</select></label>
    <div class="linha-2">
      <label class="campo"><span>Dia que fecha</span><input id="k-fecha" type="number" inputmode="numeric" min="1" max="31" value="${k?.diaFechamento || ''}" placeholder="Ex.: 3"></label>
      <label class="campo"><span>Dia que vence</span><input id="k-vence" type="number" inputmode="numeric" min="1" max="31" value="${k?.diaVencimento || ''}" placeholder="Ex.: 10"></label>
    </div>
    <div class="ajuda">Compras feitas a partir do dia de fechamento vão para a fatura seguinte.</div>
    <label class="campo"><span>Limite (opcional)</span><input id="k-limite" inputmode="decimal" placeholder="Sem limite" value="${k?.limite ? valorParaCampo(k.limite) : ''}"></label>
    <div class="campo"><span>Cor</span>${escolhaCores(cor)}</div>
    <div class="acoes">
      ${editando ? `<button class="btn perigo" id="k-excluir">Excluir</button>` : `<button class="btn" data-acao="fechar-sheet">Cancelar</button>`}
      <button class="btn primario" id="k-salvar">Salvar</button>
    </div>`, root => {
    ligarCores(root, v => cor = v);
    $('#k-salvar', root).addEventListener('click', () => {
      const nome = $('#k-nome', root).value.trim();
      if (!nome) return toast('Dê um nome para o cartão');
      const fecha = parseInt($('#k-fecha', root).value, 10), vence = parseInt($('#k-vence', root).value, 10);
      if (!(fecha >= 1 && fecha <= 31) || !(vence >= 1 && vence <= 31)) return toast('Dias de fechamento e vencimento: de 1 a 31');
      const lt = $('#k-limite', root).value.trim();
      const limite = lt ? lerValor(lt) : 0;
      if (!Number.isFinite(limite) || limite < 0) return toast('Limite inválido');
      const dados = { nome, contaId: $('#k-conta', root).value, diaFechamento: fecha, diaVencimento: vence, limite, cor };
      if (editando) Object.assign(k, dados);
      else S.cartoes.push({ id: uid(), ...dados, faturasPagas: {} });
      concluir('Cartão salvo');
    });
    $('#k-excluir', root)?.addEventListener('click', () => {
      const qtd = S.lancamentos.filter(l => l.cartaoId === k.id).length;
      confirmarPerigo({
        titulo: `Excluir o cartão "${k.nome}"?`,
        texto: qtd ? `Também serão apagadas <b>${qtd} compra(s)/parcela(s)</b> lançadas nele e o histórico de faturas pagas (o saldo da conta que pagava volta a ficar como se não tivessem sido pagas).` : 'Nenhuma compra lançada nele.',
        botao: 'Sim, excluir cartão',
        aoConfirmar: () => {
          S.lancamentos = S.lancamentos.filter(l => l.cartaoId !== k.id);
          S.cartoes = S.cartoes.filter(x => x.id !== k.id);
          concluir('Cartão excluído');
        },
      });
    });
  });
}

/* ---------- Formulário: conta ---------- */
function formConta(c = null) {
  const editando = !!c;
  let cor = c?.cor || CORES[S.contas.length % CORES.length];
  abrirSheet(`<h2>${editando ? 'Editar conta' : 'Nova conta'}</h2>
    <label class="campo"><span>Nome</span><input id="c-nome" maxlength="30" placeholder="Ex.: Nubank, Itaú, Carteira" value="${esc(c?.nome || '')}"></label>
    <label class="campo"><span>Para que serve (opcional)</span><input id="c-uso" maxlength="60" placeholder="Ex.: Salário e contas da casa" value="${esc(c?.uso || '')}"></label>
    <label class="campo"><span>Saldo atual</span><input id="c-saldo" inputmode="decimal" placeholder="0,00" value="${editando ? valorParaCampo(saldoConta(c)) : ''}"></label>
    <div class="ajuda">${editando ? 'Se mudar, o app ajusta o saldo inicial para bater com o valor informado.' : 'Quanto tem na conta hoje. Pode ser negativo (ex.: -150,00).'}</div>
    <div class="campo"><span>Cor</span>${escolhaCores(cor)}</div>
    <div class="acoes">
      ${editando ? `<button class="btn perigo" id="c-excluir">Excluir</button>` : `<button class="btn" data-acao="fechar-sheet">Cancelar</button>`}
      <button class="btn primario" id="c-salvar">Salvar</button>
    </div>`, root => {
    ligarCores(root, v => cor = v);
    $('#c-salvar', root).addEventListener('click', () => {
      const nome = $('#c-nome', root).value.trim();
      if (!nome) return toast('Dê um nome para a conta');
      const txt = $('#c-saldo', root).value.trim();
      const saldo = txt ? lerValor(txt) : 0;
      if (!Number.isFinite(saldo)) return toast('Saldo inválido');
      const uso = $('#c-uso', root).value.trim();
      if (editando) {
        const movimentado = saldoConta(c) - (c.saldoInicial || 0);
        Object.assign(c, { nome, uso, cor, saldoInicial: arred(saldo - movimentado) });
      } else {
        S.contas.push({ id: uid(), nome, uso, cor, saldoInicial: saldo });
      }
      concluir('Conta salva');
    });
    $('#c-excluir', root)?.addEventListener('click', () => confirmarExcluirConta(c));
  });
}

/** Exclusão de conta com tudo o que está ligado a ela (precisa de um segundo botão de confirmação). */
function confirmarExcluirConta(c) {
  const lancs = S.lancamentos.filter(l => l.contaId === c.id && l.tipo !== 'transferencia').length;
  const transf = S.lancamentos.filter(l => l.tipo === 'transferencia' && (l.contaId === c.id || l.contaDestinoId === c.id)).length;
  const recs = S.recorrentes.filter(r => r.contaId === c.id).length;
  const cartoes = S.cartoes.filter(k => k.contaId === c.id);
  const compras = S.lancamentos.filter(l => cartoes.some(k => k.id === l.cartaoId)).length;
  const itens = [
    lancs && `<li>${lancs} lançamento(s) da conta</li>`,
    recs && `<li>${recs} conta(s)/ganho(s) fixo(s)</li>`,
    cartoes.length && `<li>${cartoes.length} cartão(ões) que ela paga (${esc(cartoes.map(k => k.nome).join(', '))}) e ${compras} compra(s) neles</li>`,
  ].filter(Boolean).join('');
  confirmarPerigo({
    titulo: `Excluir a conta "${c.nome}"?`,
    texto: (itens ? `Serão apagados junto:<ul>${itens}</ul>` : 'A conta não tem lançamentos.') +
      (transf ? `<p>${transf} transferência(s) com outras contas viram entrada/saída comum na outra conta, para o saldo dela não mudar.</p>` : '') +
      '<p><b>Isso não pode ser desfeito.</b> Se quiser, faça um backup antes.</p>',
    botao: 'Sim, excluir tudo',
    aoConfirmar: () => {
      for (const l of S.lancamentos) {
        if (l.tipo !== 'transferencia') continue;
        if (l.contaId === c.id && l.contaDestinoId !== c.id) {
          Object.assign(l, { tipo: 'entrada', contaId: l.contaDestinoId, contaDestinoId: null, descricao: `${l.descricao} (de ${c.nome})` });
        } else if (l.contaDestinoId === c.id && l.contaId !== c.id) {
          Object.assign(l, { tipo: 'saida', contaDestinoId: null, descricao: `${l.descricao} (para ${c.nome})` });
        }
      }
      const idsCartoes = new Set(cartoes.map(k => k.id));
      S.lancamentos = S.lancamentos.filter(l => l.contaId !== c.id && l.contaDestinoId !== c.id && !idsCartoes.has(l.cartaoId));
      S.recorrentes = S.recorrentes.filter(r => r.contaId !== c.id);
      S.cartoes = S.cartoes.filter(k => !idsCartoes.has(k.id));
      S.contas = S.contas.filter(x => x.id !== c.id);
      if (UI.conta === c.id) UI.conta = null;
      concluir('Conta excluída');
    },
  });
}

/* ---------- Formulário: categoria ---------- */
function formCategoria(c = null, tipoInicial = 'saida', aoCriar = null) {
  const editando = !!c;
  let cor = c?.cor || CORES[S.categorias.length % CORES.length];
  let tipo = c?.tipo || tipoInicial;
  abrirSheet(`<h2>${editando ? 'Editar categoria' : 'Nova categoria'}</h2>
    ${seg('tipo', [['saida', 'Saída'], ['entrada', 'Entrada']], tipo, 'tipo')}
    <label class="campo"><span>Nome</span><input id="g-nome" maxlength="25" placeholder="Ex.: Mercado, Pets, Academia" value="${esc(c?.nome || '')}"></label>
    <div id="g-limite-wrap"><label class="campo"><span>Limite mensal (opcional)</span><input id="g-limite" inputmode="decimal" placeholder="Sem limite" value="${c?.limite ? valorParaCampo(c.limite) : ''}"></label>
      <div class="ajuda">Com limite, o gráfico mostra quanto ainda pode gastar nessa categoria.</div></div>
    <div class="campo"><span>Cor</span>${escolhaCores(cor)}</div>
    <div class="acoes">
      ${editando ? `<button class="btn perigo" id="g-excluir">Excluir</button>` : `<button class="btn" data-acao="fechar-sheet">Cancelar</button>`}
      <button class="btn primario" id="g-salvar">Salvar</button>
    </div>`, root => {
    const atualizar = () => $('#g-limite-wrap', root).hidden = tipo !== 'saida';
    atualizar();
    ligarSeg(root, 'tipo', v => { tipo = v; atualizar(); });
    ligarCores(root, v => cor = v);
    $('#g-salvar', root).addEventListener('click', () => {
      const nome = $('#g-nome', root).value.trim();
      if (!nome) return toast('Dê um nome para a categoria');
      const lt = $('#g-limite', root).value.trim();
      const limite = tipo === 'saida' && lt ? lerValor(lt) : 0;
      if (!Number.isFinite(limite) || limite < 0) return toast('Limite inválido');
      if (editando) Object.assign(c, { nome, cor, tipo, limite });
      else {
        const nova = { id: uid(), nome, cor, tipo, limite };
        S.categorias.push(nova);
        if (aoCriar) { salvar(); aoCriar(nova); return; }
      }
      concluir('Categoria salva');
    });
    $('#g-excluir', root)?.addEventListener('click', () => {
      const qtd = S.lancamentos.filter(l => l.categoriaId === c.id).length + S.recorrentes.filter(r => r.categoriaId === c.id).length;
      if (!confirm(`Excluir a categoria "${c.nome}"?${qtd ? `\n\n${qtd} lançamento(s) ficarão "Sem categoria".` : ''}`)) return;
      S.categorias = S.categorias.filter(x => x.id !== c.id);
      S.lancamentos.forEach(l => { if (l.categoriaId === c.id) l.categoriaId = null; });
      S.recorrentes.forEach(r => { if (r.categoriaId === c.id) r.categoriaId = null; });
      concluir('Categoria excluída');
    });
  });
}

/* ---------- Escolha do gráfico da tela inicial ---------- */
function escolherGrafico() {
  const atual = S.config.graficoInicio;
  abrirSheet(`<h2>Gráfico da tela inicial</h2><p class="sub">Escolha qual gráfico aparece no Início.</p>
    <div class="lista">${Object.entries(GRAFICOS).map(([k, g]) => `<button class="item" data-acao="definir-grafico" data-id="${k}">
      <div class="item-meio"><div class="item-titulo">${esc(g.nome)}</div><div class="item-sub quebra">${esc(g.desc)}</div></div>
      ${k === atual ? '<span class="positivo" style="font-weight:700">✓</span>' : ''}</button>`).join('')}</div>`);
}

/* ---------- Pagar / desfazer rápido ---------- */
function alternarPago(origem, id, ym) {
  if (origem === 'rec') {
    const r = recorrente(id); if (!r) return;
    if (r.pagos[ym] != null) delete r.pagos[ym]; else r.pagos[ym] = r.valor;
  } else if (origem === 'fatura') {
    const k = cartao(id); if (!k) return;
    if (k.faturasPagas[ym] != null) delete k.faturasPagas[ym]; else k.faturasPagas[ym] = totalFatura(id, ym);
  } else {
    const l = lancamento(id); if (!l || l.cartaoId) return;
    l.pago = !l.pago;
  }
  salvar();
  if (sheetAberto && origem === 'lanc' && lancamento(id)?.grupoId) verParcelamento(lancamento(id).grupoId);
  render();
}

/* ---------- Backup ---------- */
function marcarBackup() { S.ultimoBackup = new Date().toISOString(); salvar(); render(); }
function arquivoBackup() {
  const conteudo = JSON.stringify({ app: 'financas-app', versao: 1, exportadoEm: new Date().toISOString(), dados: S }, null, 2);
  return new File([conteudo], `financas-backup-${hoje()}.json`, { type: 'application/json' });
}
/** Baixa o backup direto para a pasta Downloads (precisa ser chamado dentro de um toque). */
function baixarBackup() {
  const arquivo = arquivoBackup();
  const url = URL.createObjectURL(arquivo);
  const a = Object.assign(document.createElement('a'), { href: url, download: arquivo.name });
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
  marcarBackup();
}
async function exportar() {
  const arquivo = arquivoBackup();
  if (navigator.canShare && navigator.canShare({ files: [arquivo] })) {
    try {
      await navigator.share({ files: [arquivo], title: 'Backup Finanças' });
      marcarBackup(); toast('Backup compartilhado');
      return;
    } catch (e) {
      if (e.name === 'AbortError') return; // usuário cancelou
    }
  }
  baixarBackup();
  toast('Backup salvo em Downloads');
}
let backupAgendado = false;
/** Backup automático: se estiver na hora, salva no primeiro toque do usuário. */
function agendarBackupAutomatico() {
  if (!S.config.backupAuto) return;
  if (!S.lancamentos.length && !S.recorrentes.length) return;
  const dias = S.ultimoBackup ? diasEntre(S.ultimoBackup.slice(0, 10), hoje()) : Infinity;
  if (dias < S.config.backupDias || backupAgendado) return;
  backupAgendado = true;
  document.addEventListener('pointerup', function aoTocar() {
    document.removeEventListener('pointerup', aoTocar, true);
    backupAgendado = false;
    if (!S.config.backupAuto) return;
    try { baixarBackup(); toast('Backup automático salvo em Downloads'); }
    catch (err) { console.error('Falha no backup automático', err); }
  }, true);
}
$('#arquivo-import').addEventListener('change', async e => {
  const arq = e.target.files[0]; e.target.value = '';
  if (!arq) return;
  try {
    const json = JSON.parse(await arq.text());
    const d = json.dados || json;
    if (!Array.isArray(d.contas) || !Array.isArray(d.lancamentos)) throw new Error('formato');
    const resumoTxt = `${d.contas.length} conta(s), ${(d.cartoes || []).length} cartão(ões), ${d.lancamentos.length} lançamento(s), ${(d.recorrentes || []).length} fixo(s)`;
    if (!confirm(`Importar backup com ${resumoTxt}?\n\nIsso SUBSTITUI todos os dados atuais deste aparelho.`)) return;
    S = normalizar(d);
    UI.conta = null;
    salvar(); render(); toast('Backup importado');
  } catch (err) {
    console.error('Falha ao importar backup', err);
    toast('Arquivo de backup inválido');
  }
});

/* ---------- Eventos globais ---------- */
document.addEventListener('click', e => {
  const aba = e.target.closest('[data-aba]');
  if (aba) { UI.aba = aba.dataset.aba; render(); window.scrollTo(0, 0); return; }
  const el = e.target.closest('[data-acao]');
  if (!el) return;
  const { acao, id, mes, origem, tipo } = el.dataset;
  switch (acao) {
    case 'mes-anterior': UI.mes = somarMeses(UI.mes, -1); render(); break;
    case 'mes-proximo': UI.mes = somarMeses(UI.mes, 1); render(); break;
    case 'mes-hoje': UI.mes = mesAtual(); render(); break;
    case 'ir-mes': UI.mes = mes; UI.aba = 'inicio'; if (sheetAberto) fecharSheet(); render(); window.scrollTo(0, 0); break;
    case 'filtrar-conta': UI.conta = id || null; render(); break;
    case 'novo-lancamento': formLancamento(); break;
    case 'abrir-item':
      if (origem === 'rec') verOcorrencia(id, mes);
      else if (origem === 'fatura') verFatura(id, mes);
      else { const l = lancamento(id); if (l) formLancamento(l); }
      break;
    case 'alternar-pago': e.stopPropagation(); alternarPago(origem, id, mes); break;
    case 'novo-recorrente': formRecorrente(); break;
    case 'editar-recorrente': formRecorrente(recorrente(id)); break;
    case 'ver-parcelamento': verParcelamento(id); break;
    case 'nova-conta': formConta(); break;
    case 'editar-conta': formConta(conta(id)); break;
    case 'novo-cartao': formCartao(); break;
    case 'editar-cartao': formCartao(cartao(id)); break;
    case 'ver-cartao': verCartao(id); break;
    case 'ver-fatura': verFatura(id, mes); break;
    case 'nova-compra-cartao': formLancamento(null, { cartaoId: id }); break;
    case 'trocar-grafico': escolherGrafico(); break;
    case 'definir-grafico': S.config.graficoInicio = id; concluir('Gráfico da tela inicial alterado'); break;
    case 'nova-categoria': formCategoria(null, tipo); break;
    case 'nova-categoria-rapida':
      // Cria categoria a partir do formulário de lançamento e volta para um formulário novo
      formCategoria(null, tipo, () => { fecharSheet(); render(); toast('Categoria criada — selecione-a no lançamento'); setTimeout(() => formLancamento(), 350); });
      break;
    case 'editar-categoria': formCategoria(categoria(id)); break;
    case 'fechar-sheet': fecharSheet(); break;
    case 'exportar': exportar(); break;
    case 'importar': $('#arquivo-import').click(); break;
    case 'apagar-tudo':
      if (!confirm('Apagar TODOS os dados deste aparelho? Isso não pode ser desfeito.')) return;
      if (prompt('Para confirmar, digite APAGAR') !== 'APAGAR') return toast('Cancelado');
      S = estadoInicial(); UI.conta = null; salvar(); render(); toast('Dados apagados');
      break;
  }
});
// Configurações de backup automático
document.addEventListener('change', e => {
  if (e.target.id === 'cfg-backup-auto') {
    S.config.backupAuto = e.target.checked; salvar(); render();
    toast(S.config.backupAuto ? 'Backup automático ligado' : 'Backup automático desligado');
  } else if (e.target.id === 'cfg-backup-dias') {
    S.config.backupDias = Number(e.target.value); salvar();
  }
});
// Teclado: Enter/Espaço em itens com role="button"
document.addEventListener('keydown', e => {
  if ((e.key === 'Enter' || e.key === ' ') && e.target.matches('[role="button"][data-acao]')) { e.preventDefault(); e.target.click(); }
});

/* ---------- Inicialização ---------- */
render();
agendarBackupAutomatico();
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') agendarBackupAutomatico(); });

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => navigator.serviceWorker.register('sw.js').catch(err => console.error('Falha ao registrar service worker', err)));
}
// Pede ao navegador para não apagar os dados quando faltar espaço
if (navigator.storage && navigator.storage.persist) {
  navigator.storage.persist().then(ok => { UI.persistente = ok; if (UI.aba === 'ajustes') render(); }).catch(() => {});
}
