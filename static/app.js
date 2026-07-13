'use strict';

/* =============== estado e API =============== */
let DATA = [];
let AGGS = [];
let MOVS = [];
let REQS = [];
let USERS = [];
let META = { ts: null };
let ME = null;
const can = {
  create: () => ME && ['admin', 'gestor'].includes(ME.role),
  delete: () => ME && ME.role === 'admin',
};

const $ = s => document.querySelector(s);
const fmt = n => n > 0 ? n : '–';
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const imgSrc = d => d.foto ? `data:${d.foto.mime};base64,${d.foto.b64}` : null;
const catList = () => [...new Set(DATA.map(d => d.cat))];
const byId = id => DATA.find(d => d.id === id);
const itemName = id => byId(id)?.desc || '(peça removida)';
const aggByFogo = f => AGGS.find(a => a.fogo === f);
const aggsOf = itemId => AGGS.filter(a => a.itemId === itemId);
const abertos = itemId => MOVS.filter(m => m.itemId === itemId && m.status === 'NO_FORNECEDOR');

document.addEventListener('animationend', e => {
  if (e.animationName === 'cardDrop') e.target.classList.remove('tag-enter');
});

function showBanner(kind, msg, ts) {
  const b = $('#banner'); b.className = 'banner ' + kind; b.style.display = 'block';
  $('#bmsg').textContent = msg; $('#bts').textContent = ts || '';
}

async function api(path, opts) {
  const res = await fetch('/api' + path, {
    headers: { 'Content-Type': 'application/json' },
    ...opts,
  });
  if (res.status === 401) { window.location.href = '/login'; throw new Error('Sessão expirada.'); }
  if (!res.ok) {
    let msg = 'Erro ' + res.status;
    try { const j = await res.json(); if (j.error) msg = j.error; } catch (_) {}
    throw new Error(msg);
  }
  if (res.status === 204) return null;
  return res.json();
}

async function loadAll() {
  const [items, aggs, movs, reqs] = await Promise.all([
    api('/items'), api('/aggregates'), api('/movs'), api('/requisitions'),
  ]);
  DATA = items.items;
  META.ts = items.ts;
  META.mariadbTs = items.mariadbTs;
  AGGS = aggs;
  MOVS = movs;
  REQS = reqs;
}

let refreshing = false;
async function refreshData(silent) {
  if (refreshing) return;
  refreshing = true;
  const btn = $('#btnRefresh');
  const prevLabel = btn.textContent;
  btn.textContent = '⏳';
  try {
    await loadAll();
    if (usersLoaded && ME?.role === 'admin') USERS = await api('/users');
    refreshKpis(); updateNav(); render();
    if (META.mariadbTs) $('#updDate').textContent = META.mariadbTs;
    if (!silent) showBanner('info', 'Dados sincronizados.', new Date().toLocaleTimeString('pt-BR'));
  } catch (e) {
    if (!silent) showBanner('err', 'Falha ao sincronizar: ' + e.message, '');
  } finally {
    btn.textContent = prevLabel;
    refreshing = false;
  }
}
$('#btnRefresh').onclick = () => refreshData(false);

/* =============== datas =============== */
const todayISO = () => new Date().toISOString().slice(0, 10);
const br = iso => iso ? iso.split('-').reverse().join('/') : '–';
function diasEntreDatas(a, b) {
  if (!a || !b) return 0;
  return Math.floor((new Date(b + 'T00:00:00') - new Date(a + 'T00:00:00')) / 86400000);
}
function atrasado(m) {
  return m.status === 'NO_FORNECEDOR' && m.previsaoRetorno && m.previsaoRetorno < todayISO();
}
function diasFora(m) {
  const fim = m.status === 'RETORNADO' && m.dataRetorno ? m.dataRetorno : todayISO();
  return diasEntreDatas(m.dataEnvio, fim);
}
function diasAplicado(r) {
  const fim = r.status === 'DEVOLVIDO' && r.dataDev ? r.dataDev : todayISO();
  return diasEntreDatas(r.dataReq, fim);
}

/* =============== operador =============== */
function getOperator() {
  return localStorage.getItem('operador') || '';
}
function trocarOperador() {
  const n = prompt('Seu nome (fica registrado nas ações):', getOperator());
  if (n && n.trim()) { localStorage.setItem('operador', n.trim()); return n.trim(); }
  return getOperator();
}
function ensureOperator() {
  return getOperator() || trocarOperador();
}

/* =============== situacao de agregado =============== */
const SIT_LABEL = {
  DISPONIVEL_NOVO: 'Disponível novo', DISPONIVEL_RECOND: 'Disponível recond.',
  P_CONSERTO: 'P/ conserto', NO_FORNECEDOR: 'No fornecedor',
  APLICADO: 'Aplicado na máquina', BAIXADO: 'Baixado',
};
const SIT_CLS = {
  DISPONIVEL_NOVO: 'sit-dn', DISPONIVEL_RECOND: 'sit-dr',
  P_CONSERTO: 'sit-pc', NO_FORNECEDOR: 'sit-nf',
  APLICADO: 'sit-am', BAIXADO: 'sit-bx',
};
const sitChip = s => `<span class="sit ${SIT_CLS[s] || ''}">${SIT_LABEL[s] || s}</span>`;

/* =============== KPIs =============== */
function refreshKpis() {
  const t = k => DATA.reduce((s, d) => s + (+d[k] || 0), 0);
  const kpis = [
    ['Saldo novo', t('sn'), 'var(--blue)', 'peças novas em estoque'],
    ['P/ conserto', t('pc'), 'var(--amber)', 'aguardando envio'],
    ['Saldo recond.', t('sr'), 'var(--green)', 'prontas para uso'],
    ['Em manutenção', t('em'), '#F07E3C', 'em recondicionamento'],
    ['Devendo', t('dv'), 'var(--red)', 'pendências de fornecedor'],
  ];
  $('#kpis').innerHTML = kpis.map(([l, v, c, s]) =>
    `<div class="kpi" style="--k:${c}"><div class="lab">${l}</div><div class="val">${v}</div><div class="sub">${s}</div></div>`).join('');
}

/* =============== navegacao por modulos =============== */
const state = { q: '', cat: '', f: new Set(), view: 'pecas', mtab: 'aberto', gtab: 'DISPONIVEL_RECOND', relForn: null };

function updateNav() {
  $('#nv-pecas').textContent = DATA.length + ' peças';
  $('#nv-aggs').textContent = AGGS.length + ' cadastrados';
  const noForn = MOVS.filter(m => m.status === 'NO_FORNECEDOR').length;
  const atrasados = MOVS.filter(atrasado).length;
  $('#nv-movs').textContent = noForn + ' no fornecedor' + (atrasados ? ` · ${atrasados} atrasado(s)` : '');
  const aplicadas = REQS.filter(r => r.status === 'APLICADO').length;
  const cascos = REQS.filter(r => r.cascoStatus === 'PENDENTE').length;
  $('#nv-reqs').textContent = aplicadas + ' na frota' + (cascos ? ` · ${cascos} casco(s) pend.` : '');
}

function setView(v) {
  state.view = v;
  document.querySelectorAll('.mod').forEach(m => m.classList.toggle('on', m.dataset.v === v));
  const isPecas = v === 'pecas';
  $('#fcat').style.display = isPecas ? '' : 'none';
  document.querySelectorAll('.tools .chip').forEach(c => c.style.display = isPecas ? '' : 'none');
  $('#btnExport').style.display = isPecas ? '' : 'none';
  const qEl = $('#q');
  qEl.style.display = v === 'rel' ? 'none' : '';
  qEl.value = ''; state.q = '';
  qEl.placeholder = {
    pecas: 'Buscar descrição, código CHB, referência, base de fogo…',
    aggs: 'Buscar por número de fogo…',
    movs: 'Buscar por fornecedor ou peça…',
    reqs: 'Buscar por frota ou peça…',
    usuarios: 'Buscar por nome ou usuário…',
  }[v] || '';
  const addLabel = {
    pecas: '＋ Adicionar peça', aggs: '＋ Cadastrar agregado',
    movs: '🔧 Enviar ao fornecedor', reqs: '🚜 Nova requisição',
    usuarios: '＋ Novo usuário',
  }[v];
  const needsCreatePerm = v !== 'usuarios';
  const allowed = addLabel && (v === 'usuarios' ? ME?.role === 'admin' : (!needsCreatePerm || can.create()));
  $('#btnAdd').style.display = allowed ? '' : 'none';
  if (addLabel) $('#btnAdd').textContent = addLabel;
  render();
  if (v === 'rel' || v === 'reqs') refreshData(true);
}
document.querySelectorAll('.mod').forEach(m => m.onclick = () => setView(m.dataset.v));

/* =============== filtros e grid (catalogo) =============== */
function refreshCatSelect() {
  const cur = state.cat;
  $('#fcat').innerHTML = '<option value="">Todas as categorias</option>' +
    catList().map(c => `<option${c === cur ? ' selected' : ''}>${esc(c)}</option>`).join('');
}
document.querySelectorAll('.tools .chip').forEach(ch => ch.onclick = () => {
  const f = ch.dataset.f;
  state.f.has(f) ? state.f.delete(f) : state.f.add(f);
  ch.classList.toggle('on'); render();
});
$('#q').oninput = e => { state.q = e.target.value.toLowerCase(); render(); };
$('#fcat').onchange = e => { state.cat = e.target.value; render(); };

function status(d) {
  if (d.dv > 0) return 'dv'; if (abertos(d.id).length) return 'em';
  if (d.sr + d.sn > 0) return 'ok'; return 'zero';
}
function match(d) {
  if (state.cat && d.cat !== state.cat) return false;
  if (state.f.size) {
    if (state.f.has('dv') && !(d.dv > 0)) return false;
    if (state.f.has('fr') && !abertos(d.id).length) return false;
    if (state.f.has('ok') && !(d.sr > 0)) return false;
  }
  if (state.q) {
    const hay = `${d.desc} ${d.codNovo} ${d.codRec} ${d.ref} ${d.fogo}`.toLowerCase();
    if (!hay.includes(state.q)) return false;
  }
  return true;
}
let firstPaint = true;
function card(d, idx) {
  const st = status(d);
  const src = imgSrc(d);
  const ph = src ? `<div class="ph"><img loading="lazy" src="${src}" alt=""></div>`
    : `<div class="ph nophoto">SEM FOTO</div>`;
  const enterClass = firstPaint ? ' tag-enter' : '';
  const enterStyle = firstPaint ? ` style="animation-delay:${Math.min(idx * 16, 480)}ms"` : '';
  const abrt = abertos(d.id);
  const fornBlock = abrt.length ? `<div class="forn">🔧 FORNECEDOR · ${abrt.reduce((s, m) => s + m.qtd, 0)} un · desde ${br(abrt[0].dataEnvio)}${abrt.some(atrasado) ? ' <b style="color:var(--red)">· ATRASADO</b>' : ''}</div>` : '';
  return `<div class="tag${enterClass}" data-id="${d.id}" role="button" tabindex="0" aria-label="${esc(d.desc)}"${enterStyle}>
    <span class="punch"></span>${d.novo ? '<span class="new">NOVA</span>' : ''}
    <div class="thead">${ph}
      <div class="tinfo">${d.fogo ? `<span class="fogo">${esc(d.fogo)}</span>` : ''}
        <div class="desc">${esc(d.desc)}</div></div></div>
    <div class="cods"><span>NOVO <b>${esc(d.codNovo ?? '–')}</b></span><span>REC <b>${esc(d.codRec ?? '–')}</b></span></div>
    ${fornBlock}
    <div class="saldos">
      <div class="sd ${d.sn > 0 ? 'hot-b' : ''}"><div class="v">${fmt(d.sn)}</div><div class="l">Novo</div></div>
      <div class="sd ${d.pc > 0 ? 'hot-a' : ''}"><div class="v">${fmt(d.pc)}</div><div class="l">P/ Cons.</div></div>
      <div class="sd ${d.sr > 0 ? 'hot-g' : ''}"><div class="v">${fmt(d.sr)}</div><div class="l">Recond.</div></div>
      <div class="sd ${d.em > 0 ? 'hot-o' : ''}"><div class="v">${fmt(d.em)}</div><div class="l">Manut.</div></div>
      <div class="sd ${d.dv > 0 ? 'hot-r' : ''}"><div class="v">${fmt(d.dv)}</div><div class="l">Devendo</div></div>
    </div>
    <div class="strip st-${st}"></div>
  </div>`;
}
function renderPecas() {
  refreshCatSelect();
  if (!DATA.length) {
    $('#cnt').textContent = '';
    $('#main').innerHTML = `<div class="empty"><b>Catálogo vazio.</b><br><br>
      Clique em <b>＋ Adicionar peça</b> para cadastrar a primeira peça.</div>`;
    return;
  }
  const vis = DATA.filter(match);
  $('#cnt').innerHTML = `<b>${vis.length}</b> / ${DATA.length} itens`;
  if (!vis.length) { $('#main').innerHTML = `<div class="empty">Nenhuma peça corresponde aos filtros.</div>`; return; }
  let html = '';
  let idx = 0;
  for (const c of catList()) {
    const grp = vis.filter(d => d.cat === c);
    if (!grp.length) continue;
    html += `<div class="catlab">${esc(c)} · ${grp.length}</div><div class="grid">${grp.map(d => card(d, idx++)).join('')}</div>`;
  }
  $('#main').innerHTML = html;
  firstPaint = false;
}

function render() {
  $('#cnt').textContent = '';
  if (state.view === 'pecas') return renderPecas();
  if (state.view === 'aggs') return renderAggs();
  if (state.view === 'movs') return renderMovs();
  if (state.view === 'reqs') return renderReqs();
  if (state.view === 'rel') return renderRel();
  if (state.view === 'usuarios') return renderUsers();
}

/* =============== ficha da peca =============== */
document.addEventListener('click', e => {
  const t = e.target.closest('.tag'); if (t && state.view === 'pecas') openFicha(t.dataset.id);
  const overlayIds = ['ov', 'ov2', 'ov3', 'ov4', 'ov5', 'ov6', 'ov7', 'ov8'];
  if (overlayIds.includes(e.target.id)) $('#' + e.target.id).classList.remove('open');
  if (e.target.closest('[data-close]')) $('#' + e.target.closest('[data-close]').dataset.close).classList.remove('open');
  const chip = e.target.closest('.aggchip'); if (chip) openAggFicha(chip.dataset.fogo);
  const mrow = e.target.closest('.mrowcard'); if (mrow && !e.target.closest('button')) openMovDetail(mrow.dataset.id);
  const rlink = e.target.closest('[data-relgo]'); if (rlink) relGo(rlink.dataset.relgo, rlink.dataset.arg);
});
document.addEventListener('keydown', e => {
  if (document.activeElement && ['INPUT', 'SELECT', 'TEXTAREA'].includes(document.activeElement.tagName)) {
    if (e.key === 'Escape') document.activeElement.blur();
    return;
  }
  const anyOpen = ['ov', 'ov2', 'ov3', 'ov4', 'ov5', 'ov6', 'ov7', 'ov8'].some(id => $('#' + id).classList.contains('open'));
  if (e.key === 'Escape') { ['ov', 'ov2', 'ov3', 'ov4', 'ov5', 'ov6', 'ov7', 'ov8'].forEach(id => $('#' + id).classList.remove('open')); return; }
  if (anyOpen) return;
  if (e.key === 'Enter' && document.activeElement.classList?.contains('tag')) return openFicha(document.activeElement.dataset.id);
  if (['1', '2', '3', '4', '5'].includes(e.key)) {
    setView(['pecas', 'aggs', 'movs', 'reqs', 'rel'][+e.key - 1]);
  } else if (e.key === '/') { e.preventDefault(); $('#q').focus(); }
  else if (e.key.toLowerCase() === 'n') { $('#btnAdd').click(); }
  else if (e.key.toLowerCase() === 'p' && state.view === 'rel') { window.print(); }
});

function checkConsist(d) {
  const cadastrados = aggsOf(d.id).length;
  const saldoTotal = (d.sn || 0) + (d.pc || 0) + (d.sr || 0) + (d.em || 0);
  if (!cadastrados && !saldoTotal) return null;
  if (cadastrados !== saldoTotal) {
    return `Saldo total (${saldoTotal}) diverge da quantidade de agregados cadastrados (${cadastrados}).`;
  }
  return null;
}

function movHtml(m) {
  const done = m.status === 'RETORNADO';
  return `<div class="mov ${done ? 'done' : ''}">
    <div class="mrow">
      <div><b>${esc(m.fornecedor)}</b>${m.fogoAgg ? ` <span style="color:var(--mut);font-family:var(--mono)">· ${esc(m.fogoAgg)}</span>` : ''}</div>
      ${done ? `<span style="color:var(--green)">RETORNADO ${br(m.dataRetorno)}</span>` : `<button class="btn primary" style="padding:5px 10px;font-size:12px" data-retorno="${m.id}">✔ Registrar retorno</button>`}
    </div>
    <div class="mmeta">Enviado ${br(m.dataEnvio)} · qtd ${m.qtd}${m.previsaoRetorno ? ` · previsão ${br(m.previsaoRetorno)}` : ''}${!done && atrasado(m) ? ' <span class="late">· ATRASADO</span>' : ''}</div>
  </div>`;
}

function openFicha(id) {
  const d = byId(id); if (!d) return;
  const src = imgSrc(d);
  const divergencia = checkConsist(d);
  const chips = aggsOf(d.id).map(a => `<span class="aggchip" data-fogo="${esc(a.fogo)}"><span class="af">${esc(a.fogo)}</span>${sitChip(a.situacao)}</span>`).join('') || '<span style="color:var(--mut);font-size:12px">Nenhum agregado cadastrado.</span>';
  const movsHist = MOVS.filter(m => m.itemId === d.id).sort((a, b) => (b.dataEnvio || '').localeCompare(a.dataEnvio || ''));
  $('#ficha').innerHTML = `
    <div class="fh"><span class="fogo">${esc(d.fogo || ('ITEM ' + (d.n ?? '')))}</span><button class="fx" data-close="ov">✕</button></div>
    <div class="fbody">
      ${src ? `<div class="fimg"><img src="${src}" alt="${esc(d.desc)}"></div>` : ''}
      ${divergencia ? `<div class="banner err" style="display:block;margin:0 0 12px;padding:0"><div class="inner">⚠ ${esc(divergencia)}</div></div>` : ''}
      <div class="ftitle">${esc(d.desc)}</div>
      <div class="fmeta">
        <div><div class="k">Cód. CHB Novo</div><div class="v">${esc(d.codNovo ?? '–')}</div></div>
        <div><div class="k">Cód. CHB Recond.</div><div class="v">${esc(d.codRec ?? '–')}</div></div>
        <div><div class="k">Referência</div><div class="v">${esc(d.ref || '–')}</div></div>
        <div><div class="k">Categoria</div><div class="v">${esc(d.cat)}</div></div>
      </div>
      <div class="fsaldos">
        <div class="fs"><div class="v" style="color:var(--blue)">${fmt(d.sn)}</div><div class="l">Saldo novo</div></div>
        <div class="fs"><div class="v" style="color:var(--amber)">${fmt(d.pc)}</div><div class="l">P/ conserto</div></div>
        <div class="fs"><div class="v" style="color:var(--green)">${fmt(d.sr)}</div><div class="l">Recond.</div></div>
        <div class="fs"><div class="v" style="color:#F07E3C">${fmt(d.em)}</div><div class="l">Em manut.</div></div>
        <div class="fs"><div class="v" style="color:var(--red)">${fmt(d.dv)}</div><div class="l">Devendo</div></div>
      </div>
      <div class="sect">Agregados cadastrados</div>
      <div>${chips}</div>
      ${movsHist.length ? `<div class="sect">Agregado no fornecedor</div>${movsHist.map(movHtml).join('')}` : ''}
      <div class="factions">
        ${can.delete() ? '<button class="btn danger" id="btnDel">🗑 Excluir</button>' : ''}
        ${can.create() ? '<button class="btn amber" id="btnEnviarForn">🔧 Enviar p/ fornecedor</button>' : ''}
        ${can.create() ? '<button class="btn" id="btnNovoAgg">🏷️ Cadastrar agregado</button>' : ''}
        ${can.create() ? '<button class="btn primary" id="btnEdit">✎ Editar</button>' : ''}
      </div>
    </div>`;
  $('#ov').classList.add('open');
  $('#btnDel') && ($('#btnDel').onclick = () => delItem(id));
  $('#btnEdit') && ($('#btnEdit').onclick = () => { $('#ov').classList.remove('open'); openForm(id); });
  $('#btnEnviarForn') && ($('#btnEnviarForn').onclick = () => { $('#ov').classList.remove('open'); openEnvio(id); });
  $('#btnNovoAgg') && ($('#btnNovoAgg').onclick = () => { $('#ov').classList.remove('open'); openAggForm(null, id); });
  $('#ficha [data-retorno]').forEach(btn => btn.onclick = () => registrarRetorno(btn.dataset.retorno));
}
async function delItem(id) {
  const d = byId(id);
  if (!confirm(`Excluir a peça "${d.desc}"?`)) return;
  try {
    await api(`/items/${id}`, { method: 'DELETE' });
    DATA = DATA.filter(x => x.id !== id);
    refreshKpis(); updateNav(); render();
    $('#ov').classList.remove('open');
    showBanner('ok', `Peça excluída: ${d.desc}`, '');
  } catch (err) { showBanner('err', 'Falha ao excluir: ' + err.message, ''); }
}

/* =============== formulário de peça =============== */
let formImg = null, formMime = null, editId = null;
let cascoReqId = null;
function fillCatOptions(sel) {
  const cats = catList();
  $('#f_cat').innerHTML = (cats.length ? cats : ['Geral']).map(c => `<option${c === sel ? ' selected' : ''}>${esc(c)}</option>`).join('') +
    `<option value="__nova__">+ Nova categoria…</option>`;
}
$('#f_cat').addEventListener('change', e => {
  if (e.target.value === '__nova__') {
    const n = prompt('Nome da nova categoria:');
    if (n && n.trim()) { const v = n.trim().replace(/\b\w/g, c => c.toUpperCase());
      e.target.insertAdjacentHTML('afterbegin', `<option selected>${esc(v)}</option>`); }
    else fillCatOptions(catList()[0]);
  }
});
$('#btnAdd').onclick = () => {
  if (state.view === 'pecas') openForm(null);
  else if (state.view === 'aggs') openAggForm(null);
  else if (state.view === 'movs') openEnvio(null);
  else if (state.view === 'reqs') openReqForm(null);
  else if (state.view === 'usuarios') openUserForm(null);
};
function openForm(id) {
  editId = id;
  const d = id ? byId(id) : null;
  $('#formTitle').textContent = d ? 'Editar peça' : 'Adicionar peça';
  fillCatOptions(d ? d.cat : catList()[0]);
  $('#f_desc').value = d ? d.desc : '';
  $('#f_fogo').value = d ? (d.fogo || '') : '';
  $('#f_cn').value = d ? (d.codNovo ?? '') : '';
  $('#f_cr').value = d ? (d.codRec ?? '') : '';
  $('#f_ref').value = d ? (d.ref || '') : '';
  for (const k of ['sn', 'pc', 'sr', 'em', 'dv']) $('#f_' + k).value = d ? (d[k] || 0) : 0;
  formImg = d && d.foto ? d.foto.b64 : null; formMime = d && d.foto ? d.foto.mime : null;
  $('#f_pv').innerHTML = formImg ? `<img src="data:${formMime};base64,${formImg}">`
    : '<span style="color:#8CA096;font-size:10px;font-family:var(--disp);letter-spacing:.1em">SEM FOTO</span>';
  $('#ferr').style.display = 'none';
  $('#ov2').classList.add('open');
  $('#f_desc').focus();
}
function compressToJpeg(imgEl, max) {
  const sc = Math.min(1, max / Math.max(imgEl.width, imgEl.height));
  const cv = document.createElement('canvas');
  cv.width = Math.round(imgEl.width * sc); cv.height = Math.round(imgEl.height * sc);
  const cx = cv.getContext('2d');
  cx.fillStyle = '#fff'; cx.fillRect(0, 0, cv.width, cv.height);
  cx.drawImage(imgEl, 0, 0, cv.width, cv.height);
  return cv.toDataURL('image/jpeg', .78).split(',')[1];
}
$('#f_img').addEventListener('change', e => {
  const f = e.target.files[0]; if (!f) return;
  const img = new Image();
  img.onload = () => {
    formImg = compressToJpeg(img, 380); formMime = 'image/jpeg';
    $('#f_pv').innerHTML = `<img src="data:image/jpeg;base64,${formImg}">`;
    URL.revokeObjectURL(img.src);
  };
  img.onerror = () => { $('#ferr').textContent = 'Não foi possível ler a imagem. Use JPG ou PNG.'; $('#ferr').style.display = 'block'; };
  img.src = URL.createObjectURL(f);
  e.target.value = '';
});
$('#btnSave').onclick = async () => {
  const desc = $('#f_desc').value.trim().toUpperCase();
  const cn = $('#f_cn').value.trim();
  const err = m => { $('#ferr').textContent = m; $('#ferr').style.display = 'block'; };
  $('#f_desc').classList.toggle('err', !desc); $('#f_cn').classList.toggle('err', !cn);
  if (!desc) return err('Informe a descrição da peça.');
  if (!cn) return err('Informe o código CHB novo.');
  const cr = $('#f_cr').value.trim();
  const rec = {
    desc, cat: $('#f_cat').value,
    fogo: $('#f_fogo').value.trim().toUpperCase(),
    codNovo: isNaN(+cn) ? cn : +cn,
    codRec: cr === '' ? null : (isNaN(+cr) ? cr : +cr),
    ref: $('#f_ref').value.trim(),
    sn: +$('#f_sn').value || 0, pc: +$('#f_pc').value || 0, sr: +$('#f_sr').value || 0,
    em: +$('#f_em').value || 0, dv: +$('#f_dv').value || 0,
  };
  if (formImg) rec.foto = { b64: formImg, mime: formMime };
  $('#btnSave').disabled = true;
  try {
    let saved;
    if (editId) {
      saved = await api(`/items/${editId}`, { method: 'PUT', body: JSON.stringify(rec) });
      Object.assign(byId(editId), saved);
      showBanner('ok', `Peça atualizada: ${desc}`, '');
    } else {
      saved = await api('/items', { method: 'POST', body: JSON.stringify(rec) });
      DATA.push(saved);
      showBanner('ok', `Peça adicionada: ${desc}`, '');
    }
    refreshKpis(); updateNav(); render();
    $('#ov2').classList.remove('open');
  } catch (e2) { return err(e2.message); }
  finally { $('#btnSave').disabled = false; }
};

/* =============== modulo: agregados =============== */
function fillItemSelect(sel, cur) {
  sel.innerHTML = catList().map(c => `<optgroup label="${esc(c)}">${DATA.filter(d => d.cat === c)
    .map(d => `<option value="${d.id}"${d.id === cur ? ' selected' : ''}>${esc(d.desc)}${d.fogo ? ' · ' + esc(d.fogo) : ''}</option>`).join('')}</optgroup>`).join('');
}
function openAggForm(aggId, prefillItemId) {
  const a = aggId ? AGGS.find(x => x.id === aggId) : null;
  $('#aggTitle').textContent = a ? 'Editar agregado' : 'Cadastrar agregado';
  $('#g_fogo').value = a ? a.fogo : '';
  $('#g_fogo').disabled = !!a;
  fillItemSelect($('#g_item'), a ? a.itemId : prefillItemId);
  $('#g_sit').value = a ? a.situacao : 'DISPONIVEL_NOVO';
  const bloqueio = a ? MOVS.some(m => m.fogoAgg === a.fogo && m.status === 'NO_FORNECEDOR') || REQS.some(r => r.fogoAgg === a.fogo && r.status === 'APLICADO') : false;
  $('#g_sit').disabled = bloqueio;
  $('#g_serie').value = a ? (a.serie || '') : '';
  $('#g_maq').value = a ? (a.maquina || '') : '';
  $('#g_obs').value = a ? (a.obs || '') : '';
  $('#gerr').style.display = 'none';
  $('#btnAgg').dataset.id = a ? a.id : '';
  $('#ov4').classList.add('open');
}
$('#btnAgg').onclick = async () => {
  const fogo = $('#g_fogo').value.trim().toUpperCase();
  const err = m => { $('#gerr').textContent = m; $('#gerr').style.display = 'block'; };
  if (!fogo) return err('Informe o número de fogo.');
  const itemId = $('#g_item').value;
  if (!itemId) return err('Selecione a peça.');
  const payload = {
    fogo, itemId, situacao: $('#g_sit').value,
    serie: $('#g_serie').value.trim(), maquina: $('#g_maq').value.trim(), obs: $('#g_obs').value.trim(),
  };
  const id = $('#btnAgg').dataset.id;
  $('#btnAgg').disabled = true;
  try {
    let saved;
    if (id) { saved = await api(`/aggregates/${id}`, { method: 'PUT', body: JSON.stringify(payload) }); Object.assign(AGGS.find(a => a.id === id), saved); }
    else { saved = await api('/aggregates', { method: 'POST', body: JSON.stringify(payload) }); AGGS.push(saved); }
    updateNav(); render();
    $('#ov4').classList.remove('open');
    showBanner('ok', `Agregado ${fogo} salvo.`, '');
  } catch (e) { return err(e.message); }
  finally { $('#btnAgg').disabled = false; }
};
async function delAgg(id) {
  const a = AGGS.find(x => x.id === id); if (!a) return;
  if (!confirm(`Excluir o agregado ${a.fogo}?`)) return;
  try {
    await api(`/aggregates/${id}`, { method: 'DELETE' });
    AGGS = AGGS.filter(x => x.id !== id);
    updateNav(); render();
    showBanner('ok', `Agregado ${a.fogo} excluído.`, '');
  } catch (e) { showBanner('err', 'Falha ao excluir: ' + e.message, ''); }
}
function openAggFicha(fogo) {
  const a = aggByFogo(fogo); if (!a) return;
  const eventos = [
    ...MOVS.filter(m => m.fogoAgg === fogo).flatMap(m => [
      { data: m.dataEnvio, txt: `Enviado a ${m.fornecedor}` },
      ...(m.dataRetorno ? [{ data: m.dataRetorno, txt: `Retornou de ${m.fornecedor}` }] : []),
    ]),
    ...REQS.filter(r => r.fogoAgg === fogo).flatMap(r => [
      { data: r.dataReq, txt: `Aplicado na frota ${r.frota}` },
      ...(r.dataDev ? [{ data: r.dataDev, txt: `Devolvido da frota ${r.frota}` }] : []),
    ]),
  ].filter(e => e.data).sort((x, y) => x.data.localeCompare(y.data));
  $('#ficha').innerHTML = `
    <div class="fh"><span class="fogo">${esc(a.fogo)}</span><button class="fx" data-close="ov">✕</button></div>
    <div class="fbody">
      <div class="ftitle">${esc(itemName(a.itemId))}</div>
      <div class="fmeta">
        <div><div class="k">Situação</div><div class="v">${sitChip(a.situacao)}</div></div>
        <div><div class="k">Máquina</div><div class="v">${esc(a.maquina || '–')}</div></div>
        <div><div class="k">Série</div><div class="v">${esc(a.serie || '–')}</div></div>
        <div><div class="k">Cadastrado em</div><div class="v">${esc(a.criadoEm || '–')}</div></div>
      </div>
      ${a.obs ? `<div style="margin:10px 0;color:var(--mut);font-size:13px">${esc(a.obs)}</div>` : ''}
      <div class="sect">Linha do tempo</div>
      ${eventos.length ? eventos.map(e => `<div class="mov"><div class="mrow"><div>${esc(e.txt)}</div><div class="mmeta">${br(e.data)}</div></div></div>`).join('') : '<span style="color:var(--mut);font-size:12px">Sem eventos registrados.</span>'}
      <div class="factions">
        ${can.delete() ? '<button class="btn danger" id="btnDelAgg">🗑 Excluir</button>' : ''}
        ${can.create() && ['DISPONIVEL_NOVO', 'DISPONIVEL_RECOND'].includes(a.situacao) ? '<button class="btn amber" id="btnReqAgg">🚜 Requisitar</button>' : ''}
        ${can.create() ? '<button class="btn primary" id="btnEditAgg">✎ Editar</button>' : ''}
      </div>
    </div>`;
  $('#ov').classList.add('open');
  $('#btnDelAgg') && ($('#btnDelAgg').onclick = () => { $('#ov').classList.remove('open'); delAgg(a.id); });
  $('#btnEditAgg') && ($('#btnEditAgg').onclick = () => { $('#ov').classList.remove('open'); openAggForm(a.id); });
  $('#btnReqAgg') && ($('#btnReqAgg').onclick = () => { $('#ov').classList.remove('open'); openReqForm(a.fogo); });
}
function aggCard(a) {
  const disponivel = ['DISPONIVEL_NOVO', 'DISPONIVEL_RECOND'].includes(a.situacao);
  return `<div class="tag" style="cursor:pointer">
    <div class="thead" data-fogo="${esc(a.fogo)}"><div class="tinfo">
      <span class="fogo">${esc(a.fogo)}</span>
      <div class="desc">${esc(itemName(a.itemId))}</div>
    </div></div>
    <div class="cods"><span>${sitChip(a.situacao)}</span>${a.maquina ? `<span>${esc(a.maquina)}</span>` : ''}</div>
    ${disponivel && can.create() ? `<div style="padding:0 14px 12px"><button class="btn amber" style="width:100%" data-requisitar="${esc(a.fogo)}">🚜 Requisitar</button></div>` : ''}
  </div>`;
}
function renderAggs() {
  const sits = ['DISPONIVEL_NOVO', 'DISPONIVEL_RECOND', 'P_CONSERTO', 'NO_FORNECEDOR', 'APLICADO', 'BAIXADO'];
  const tabs = sits.map(s => `<span class="mtab ${state.gtab === s ? 'on' : ''}" data-gtab="${s}">${SIT_LABEL[s]} · ${AGGS.filter(a => a.situacao === s).length}</span>`).join('');
  let list = AGGS.filter(a => a.situacao === state.gtab);
  if (state.q) list = list.filter(a => a.fogo.toLowerCase().includes(state.q) || itemName(a.itemId).toLowerCase().includes(state.q));
  $('#cnt').innerHTML = `<b>${list.length}</b> / ${AGGS.length} agregados`;
  $('#main').innerHTML = `<div class="mtabs">${tabs}</div>` +
    (list.length ? `<div class="grid">${list.map(aggCard).join('')}</div>` : `<div class="empty">Nenhum agregado nesta situação.</div>`);
  $('#main').querySelectorAll('.mtab').forEach(t => t.onclick = () => { state.gtab = t.dataset.gtab; render(); });
  $('#main').querySelectorAll('[data-fogo]').forEach(el => el.onclick = () => openAggFicha(el.dataset.fogo));
  $('#main').querySelectorAll('[data-requisitar]').forEach(b => b.onclick = e => { e.stopPropagation(); openReqForm(b.dataset.requisitar); });
}

/* =============== modulo: manutencoes (fornecedor) =============== */
function syncAggCheckboxes() {
  const checked = [...$('#e_agglist').querySelectorAll('input:checked')];
  const has = checked.length > 0;
  $('#e_qtd').value = has ? checked.length : $('#e_qtd').value;
  $('#e_qtd').disabled = has;
  $('#e_origemwrap').style.display = has ? 'none' : '';
}
function fillEnvioAgglist(itemId) {
  const disponiveis = aggsOf(itemId).filter(a => ['DISPONIVEL_NOVO', 'DISPONIVEL_RECOND', 'P_CONSERTO'].includes(a.situacao));
  $('#e_agglist').innerHTML = disponiveis.length
    ? disponiveis.map(a => `<label><input type="checkbox" value="${esc(a.fogo)}"><span class="af">${esc(a.fogo)}</span>${sitChip(a.situacao)}</label>`).join('')
    : '<span class="none">Nenhum agregado disponível cadastrado para esta peça.</span>';
  $('#e_agglist').querySelectorAll('input').forEach(cb => cb.onchange = syncAggCheckboxes);
  syncAggCheckboxes();
}
function openEnvio(itemId) {
  fillItemSelect($('#e_item'), itemId);
  if (!itemId) itemId = $('#e_item').value;
  fillEnvioAgglist(itemId);
  $('#e_item').onchange = () => fillEnvioAgglist($('#e_item').value);
  const forns = [...new Set(MOVS.map(m => m.fornecedor))];
  $('#fornList').innerHTML = forns.map(f => `<option value="${esc(f)}">`).join('');
  $('#e_forn').value = ''; $('#e_qtd').value = 1; $('#e_origem').value = 'pc';
  $('#e_data').value = todayISO(); $('#e_prev').value = '';
  $('#e_nf').value = ''; $('#e_serv').value = ''; $('#e_obs').value = '';
  $('#eerr').style.display = 'none';
  $('#ov3').classList.add('open');
}
$('#btnEnvio').onclick = async () => {
  const err = m => { $('#eerr').textContent = m; $('#eerr').style.display = 'block'; };
  const itemId = $('#e_item').value;
  const fornecedor = $('#e_forn').value.trim();
  if (!itemId) return err('Selecione a peça.');
  if (!fornecedor) return err('Informe o fornecedor.');
  const op = ensureOperator();
  const base = {
    itemId, fornecedor,
    dataEnvio: $('#e_data').value || todayISO(),
    previsaoRetorno: $('#e_prev').value || null,
    nfRemessa: $('#e_nf').value.trim(),
    servicos: $('#e_serv').value.trim(),
    obs: $('#e_obs').value.trim(),
    registradoPor: op,
  };
  const checked = [...$('#e_agglist').querySelectorAll('input:checked')].map(c => c.value);
  $('#btnEnvio').disabled = true;
  try {
    if (checked.length) {
      for (const fogo of checked) {
        const agg = aggByFogo(fogo);
        const origem = agg?.situacao === 'P_CONSERTO' ? 'pc' : 'nenhum';
        const saved = await api('/movs', { method: 'POST', body: JSON.stringify({ ...base, fogoAgg: fogo, qtd: 1, origem }) });
        MOVS.push(saved);
      }
    } else {
      const qtd = +$('#e_qtd').value || 1;
      const saved = await api('/movs', { method: 'POST', body: JSON.stringify({ ...base, qtd, origem: $('#e_origem').value }) });
      MOVS.push(saved);
    }
    const fresh = await api('/items'); DATA = fresh.items;
    const freshAggs = await api('/aggregates'); AGGS = freshAggs;
    refreshKpis(); updateNav(); render();
    $('#ov3').classList.remove('open');
    showBanner('ok', `Envio registrado: ${fornecedor}.`, '');
  } catch (e) { return err(e.message); }
  finally { $('#btnEnvio').disabled = false; }
};
async function registrarRetorno(movId) {
  if (!confirm('Confirmar retorno deste envio?')) return;
  const nfDevolucao = prompt('Nota de devolução (opcional):', '') || '';
  try {
    const saved = await api(`/movs/${movId}/retorno`, { method: 'POST', body: JSON.stringify({ nfDevolucao, retornadoPor: ensureOperator() }) });
    Object.assign(MOVS.find(m => m.id === movId), saved);
    const fresh = await api('/items'); DATA = fresh.items;
    const freshAggs = await api('/aggregates'); AGGS = freshAggs;
    refreshKpis(); updateNav(); render();
    $('#ov').classList.remove('open');
    showBanner('ok', 'Retorno registrado.', '');
  } catch (e) { showBanner('err', 'Falha: ' + e.message, ''); }
}
function openDocs(movId) {
  const m = MOVS.find(x => x.id === movId); if (!m) return;
  $('#d_nf').value = m.nfRemessa || ''; $('#d_orc').value = m.orcamento || '';
  $('#d_ped').value = m.pedidoCompra || ''; $('#d_nfdev').value = m.nfDevolucao || '';
  $('#d_serv').value = m.servicos || ''; $('#d_obs').value = m.obs || '';
  $('#btnDocs').dataset.id = movId;
  $('#ov6').classList.add('open');
}
$('#btnDocs').onclick = async () => {
  const id = $('#btnDocs').dataset.id;
  const payload = {
    nfRemessa: $('#d_nf').value.trim(), orcamento: $('#d_orc').value.trim(),
    pedidoCompra: $('#d_ped').value.trim(), nfDevolucao: $('#d_nfdev').value.trim(),
    servicos: $('#d_serv').value.trim(), obs: $('#d_obs').value.trim(),
  };
  try {
    const saved = await api(`/movs/${id}/docs`, { method: 'PUT', body: JSON.stringify(payload) });
    Object.assign(MOVS.find(m => m.id === id), saved);
    $('#ov6').classList.remove('open');
    showBanner('ok', 'Documentos atualizados.', '');
  } catch (e) { showBanner('err', 'Falha: ' + e.message, ''); }
};
function printPeritagem(movId) {
  const m = MOVS.find(x => x.id === movId); if (!m) return;
  const lote = MOVS.filter(x => x.fornecedor === m.fornecedor && x.nfRemessa === m.nfRemessa && x.nfRemessa);
  const linhas = (lote.length ? lote : [m]);
  $('#perPrint').innerHTML = `
    <div class="pt1">CRV Industrial · Unidade Capinópolis/MG</div>
    <div class="pt2">Peritagem — Remessa ao fornecedor ${esc(m.fornecedor)}</div>
    <div class="pt3">Nota de remessa: ${esc(m.nfRemessa || '–')} · Data: ${br(m.dataEnvio)}</div>
    <table class="ptable">
      <thead><tr><th>Peça</th><th>Fogo</th><th>Qtd</th><th>Serviços</th></tr></thead>
      <tbody>${linhas.map(l => `<tr><td>${esc(itemName(l.itemId))}</td><td class="pc">${esc(l.fogoAgg || '–')}</td><td class="pc">${l.qtd}</td><td>${esc((l.servicos || '').replace(/\n/g, ', '))}</td></tr>`).join('')}</tbody>
    </table>
    <div class="psign">
      <div><div class="pline"></div>RESPONSÁVEL PELO ENVIO</div>
      <div><div class="pline"></div>RECEBIDO PELO FORNECEDOR — DATA/ASSINATURA</div>
    </div>`;
  document.body.classList.add('per-mode');
  window.print();
  setTimeout(() => document.body.classList.remove('per-mode'), 500);
}
function openMovDetail(movId) {
  const m = MOVS.find(x => x.id === movId); if (!m) return;
  $('#ficha').innerHTML = `
    <div class="fh"><span class="fogo">${esc(m.fornecedor)}</span><button class="fx" data-close="ov">✕</button></div>
    <div class="fbody">
      <div class="ftitle">${esc(itemName(m.itemId))}</div>
      <div class="fmeta">
        <div><div class="k">Fogo</div><div class="v">${esc(m.fogoAgg || '–')}</div></div>
        <div><div class="k">Quantidade</div><div class="v">${m.qtd}</div></div>
        <div><div class="k">Envio</div><div class="v">${br(m.dataEnvio)}</div></div>
        <div><div class="k">Previsão</div><div class="v">${br(m.previsaoRetorno)}</div></div>
        <div><div class="k">Status</div><div class="v">${m.status === 'RETORNADO' ? 'Retornado ' + br(m.dataRetorno) : (atrasado(m) ? 'Atrasado' : 'No fornecedor')}</div></div>
        <div><div class="k">Dias fora</div><div class="v">${diasFora(m)}</div></div>
      </div>
      ${m.servicos ? `<div class="sect">Peritagem</div><div style="white-space:pre-line;font-size:13px">${esc(m.servicos)}</div>` : ''}
      ${m.obs ? `<div class="sect">Observação</div><div style="font-size:13px">${esc(m.obs)}</div>` : ''}
      <div class="factions">
        ${can.create() ? '<button class="btn" id="btnDocsFicha">📄 Docs</button>' : ''}
        <button class="btn" id="btnPeritFicha">🖨 Peritagem</button>
        ${m.status === 'NO_FORNECEDOR' ? '<button class="btn primary" id="btnRetFicha">✔ Registrar retorno</button>' : ''}
      </div>
    </div>`;
  $('#ov').classList.add('open');
  $('#btnDocsFicha') && ($('#btnDocsFicha').onclick = () => { $('#ov').classList.remove('open'); openDocs(m.id); });
  $('#btnPeritFicha').onclick = () => printPeritagem(m.id);
  $('#btnRetFicha') && ($('#btnRetFicha').onclick = () => registrarRetorno(m.id));
}
function movRowCard(m) {
  const done = m.status === 'RETORNADO';
  const late = atrasado(m);
  return `<div class="mrowcard ${done ? 'done' : late ? 'late' : ''}" data-id="${m.id}">
    <div class="mtop">
      <div class="mpart">${m.fogoAgg ? `<span class="fogo">${esc(m.fogoAgg)}</span>` : ''}${esc(itemName(m.itemId))}${late && !done ? '<span class="latebadge" style="margin-left:8px">ATRASADO</span>' : ''}</div>
      <div class="mforn">${esc(m.fornecedor)}</div>
    </div>
    <div class="mdet">
      <div>Enviado <b>${br(m.dataEnvio)}</b></div>
      <div>Qtd <b>${m.qtd}</b></div>
      ${m.previsaoRetorno ? `<div>Previsão <b>${br(m.previsaoRetorno)}</b></div>` : ''}
      <div class="mdias">${diasFora(m)}<div class="dl">dias</div></div>
    </div>
  </div>`;
}
function renderMovs() {
  const tabDefs = [
    ['aberto', 'No fornecedor', MOVS.filter(m => m.status === 'NO_FORNECEDOR')],
    ['atrasado', 'Atrasados', MOVS.filter(atrasado)],
    ['retornado', 'Retornados', MOVS.filter(m => m.status === 'RETORNADO')],
    ['todos', 'Todos', MOVS],
  ];
  const tabs = tabDefs.map(([k, l, arr]) => `<span class="mtab ${state.mtab === k ? 'on' : ''} ${k === 'atrasado' ? 't-late' : k === 'retornado' ? 't-done' : ''}" data-mtab="${k}">${l} · ${arr.length}</span>`).join('');
  let list = tabDefs.find(t => t[0] === state.mtab)[2];
  if (state.q) list = list.filter(m => m.fornecedor.toLowerCase().includes(state.q) || itemName(m.itemId).toLowerCase().includes(state.q));
  list = [...list].sort((a, b) => (b.dataEnvio || '').localeCompare(a.dataEnvio || ''));
  $('#cnt').innerHTML = `<b>${list.length}</b> / ${MOVS.length} envios`;
  $('#main').innerHTML = `<div class="mtabs">${tabs}</div>` +
    (list.length ? list.map(movRowCard).join('') : `<div class="empty">Nenhum envio nesta aba.</div>`);
  $('#main').querySelectorAll('.mtab').forEach(t => t.onclick = () => { state.mtab = t.dataset.mtab; render(); });
}

/* =============== modulo: requisicoes (frota) =============== */
function fillAggSelect(sel) {
  const disponiveis = AGGS.filter(a => ['DISPONIVEL_NOVO', 'DISPONIVEL_RECOND'].includes(a.situacao));
  sel.innerHTML = disponiveis.length
    ? disponiveis.map(a => `<option value="${esc(a.fogo)}">${esc(a.fogo)} · ${esc(itemName(a.itemId))} (${SIT_LABEL[a.situacao]})</option>`).join('')
    : '<option value="">Nenhum agregado disponível</option>';
}
function openReqForm(prefillFogo) {
  fillAggSelect($('#q_agg'));
  if (prefillFogo) $('#q_agg').value = prefillFogo;
  $('#q_frotacod').value = ''; $('#q_frota').value = '';
  $('#q_matricula').value = ''; $('#q_solic').value = '';
  $('#q_temcasco').checked = false;
  $('#q_obs').value = '';
  $('#qerr').style.display = 'none';
  $('#ov5').classList.add('open');
}
async function lookupInto(codeInputSel, targetInputSel, path, resultKey, notFoundMsg) {
  const code = $(codeInputSel).value.trim();
  if (!code) return;
  try {
    const r = await api(`${path}/${encodeURIComponent(code)}`);
    $(targetInputSel).value = r[resultKey];
  } catch (e) {
    showBanner('err', notFoundMsg + ': ' + e.message, '');
  }
}
$('#q_frotacod').addEventListener('blur', () => lookupInto('#q_frotacod', '#q_frota', '/lookup/frota', 'descricao', 'Frota não encontrada'));
$('#q_matricula').addEventListener('blur', () => lookupInto('#q_matricula', '#q_solic', '/lookup/funcionario', 'nome', 'Matrícula não encontrada'));
$('#btnReq').onclick = async () => {
  const err = m => { $('#qerr').textContent = m; $('#qerr').style.display = 'block'; };
  const fogo = $('#q_agg').value;
  const frota = $('#q_frota').value.trim();
  const solicitante = $('#q_solic').value.trim();
  if (!fogo) return err('Selecione um agregado disponível.');
  if (!frota) return err('Informe a frota/equipamento.');
  const temCasco = $('#q_temcasco').checked;
  if (temCasco && !solicitante) return err('Informe o funcionário responsável pelo casco.');
  const agg = aggByFogo(fogo);
  const payload = {
    itemId: agg.itemId, fogoAgg: fogo, frota,
    solicitante, obs: $('#q_obs').value.trim(),
    dataReq: todayISO(), registradoPor: ensureOperator(),
    cascoStatus: temCasco ? 'PENDENTE' : null,
    cascoFunc: temCasco ? solicitante : null,
  };
  $('#btnReq').disabled = true;
  try {
    const saved = await api('/requisitions', { method: 'POST', body: JSON.stringify(payload) });
    REQS.push(saved);
    const freshAggs = await api('/aggregates'); AGGS = freshAggs;
    updateNav(); render();
    $('#ov5').classList.remove('open');
    showBanner('ok', `Requisição criada para ${frota}.`, '');
  } catch (e) { return err(e.message); }
  finally { $('#btnReq').disabled = false; }
};
async function confirmarEntrega(reqId) {
  try {
    const saved = await api(`/requisitions/${reqId}/entrega`, { method: 'POST', body: JSON.stringify({ entreguePor: ensureOperator() }) });
    Object.assign(REQS.find(r => r.id === reqId), saved);
    render();
    showBanner('ok', 'Entrega confirmada.', '');
  } catch (e) { showBanner('err', 'Falha: ' + e.message, ''); }
}
function syncCascoEntregue() {
  const naoEntregue = $('#c_entregue').value === 'N';
  $('#c_fogo').disabled = naoEntregue;
  if (naoEntregue) $('#c_fogo').value = '';
}
$('#c_entregue').addEventListener('change', syncCascoEntregue);
function receberCasco(reqId) {
  const r = REQS.find(x => x.id === reqId); if (!r) return;
  cascoReqId = reqId;
  $('#c_info').textContent = `${itemName(r.itemId)} · Frota ${r.frota}${r.cascoFunc ? ' · Funcionário: ' + r.cascoFunc : ''}`;
  $('#c_entregue').value = 'S';
  $('#c_data').value = todayISO();
  $('#c_quem').value = r.cascoFunc || '';
  $('#c_fogo').value = '';
  $('#c_obs').value = '';
  syncCascoEntregue();
  $('#cerr').style.display = 'none';
  $('#ov7').classList.add('open');
}
$('#btnSaveCasco').onclick = async () => {
  const err = m => { $('#cerr').textContent = m; $('#cerr').style.display = 'block'; };
  const quem = $('#c_quem').value.trim();
  const data = $('#c_data').value;
  if (!quem) return err('Informe quem entregou o casco.');
  if (!data) return err('Informe a data.');
  const payload = {
    entregue: $('#c_entregue').value,
    data, quem,
    cascoFogo: $('#c_fogo').value.trim(),
    obs: $('#c_obs').value.trim(),
    cascoRecebidoPor: ensureOperator(),
  };
  $('#btnSaveCasco').disabled = true;
  try {
    const saved = await api(`/requisitions/${cascoReqId}/casco`, { method: 'POST', body: JSON.stringify(payload) });
    Object.assign(REQS.find(r => r.id === cascoReqId), saved);
    const fresh = await api('/items'); DATA = fresh.items;
    const freshAggs = await api('/aggregates'); AGGS = freshAggs;
    refreshKpis(); updateNav(); render();
    $('#ov7').classList.remove('open');
    showBanner('ok', payload.entregue === 'S' ? 'Casco recebido.' : 'Registrado: casco ainda não devolvido.', '');
  } catch (e) { return err(e.message); }
  finally { $('#btnSaveCasco').disabled = false; }
};
async function devolverReq(reqId) {
  const destino = confirm('A peça devolvida precisa de conserto?\nOK = vai para P/ Conserto · Cancelar = fica disponível') ? 'pc' : 'disponivel';
  try {
    const saved = await api(`/requisitions/${reqId}/devolucao`, { method: 'POST', body: JSON.stringify({ destino, registradoPor: ensureOperator() }) });
    Object.assign(REQS.find(r => r.id === reqId), saved);
    const fresh = await api('/items'); DATA = fresh.items;
    const freshAggs = await api('/aggregates'); AGGS = freshAggs;
    refreshKpis(); updateNav(); render();
    showBanner('ok', 'Requisição devolvida.', '');
  } catch (e) { showBanner('err', 'Falha: ' + e.message, ''); }
}
async function excluirReq(reqId) {
  const r = REQS.find(x => x.id === reqId); if (!r) return;
  let msg;
  if (r.cascoStatus === 'DEVOLVIDO') {
    msg = null; // backend vai bloquear e explicar
  } else if (r.status === 'DEVOLVIDO') {
    msg = `Excluir o registro desta requisição (${itemName(r.itemId)} · ${r.frota})? Os saldos não serão alterados, só o histórico é removido.`;
  } else {
    msg = `Excluir esta requisição (${itemName(r.itemId)} · ${r.frota})? O agregado volta para disponível` +
      (r.cascoStatus === 'PENDENTE' ? ' e a pendência de casco é removida.' : '.');
  }
  if (msg !== null && !confirm(msg)) return;
  try {
    await api(`/requisitions/${reqId}`, { method: 'DELETE' });
    REQS = REQS.filter(x => x.id !== reqId);
    const freshAggs = await api('/aggregates'); AGGS = freshAggs;
    updateNav(); render();
    showBanner('ok', `Requisição excluída: ${itemName(r.itemId)} · ${r.frota}.`, '');
  } catch (e) { showBanner('err', 'Falha: ' + e.message, ''); }
}
function reqCard(r) {
  return `<div class="mrowcard ${r.status === 'DEVOLVIDO' ? 'done' : ''}">
    <div class="mtop">
      <div class="mpart">${r.fogoAgg ? `<span class="fogo">${esc(r.fogoAgg)}</span>` : ''}${esc(itemName(r.itemId))}</div>
      <div class="mforn">${esc(r.frota)}</div>
    </div>
    <div class="mdet">
      <div>Aplicado <b>${br(r.dataReq)}</b></div>
      <div>Entrega <b>${r.entrega === 'ENTREGUE' ? 'Confirmada' : 'Pendente'}</b></div>
      ${r.cascoStatus ? `<div>Casco <b>${r.cascoStatus === 'DEVOLVIDO' ? 'Devolvido' : r.cascoStatus === 'NAO_DEVOLVIDO' ? 'Não devolvido' : 'Pendente'}</b></div>` : ''}
      <div class="mdias">${diasAplicado(r)}<div class="dl">dias</div></div>
    </div>
    ${r.cascoStatus === 'DEVOLVIDO' ? `<div class="mmeta" style="margin-top:6px">Casco entregue por <b>${esc(r.cascoEntreguePor || '–')}</b> · conf. <b>${esc(r.cascoRecebidoPor || '–')}</b> · ${br(r.dataCasco)}</div>` : ''}
    ${r.cascoStatus === 'NAO_DEVOLVIDO' ? `<div class="latebadge" style="display:inline-block;margin-top:6px">🔩 CASCO NÃO DEVOLVIDO</div><div class="mmeta">${br(r.dataCasco)} · ${esc(r.cascoEntreguePor || '–')}${r.cascoObs ? ' · ' + esc(r.cascoObs) : ''}</div>` : ''}
    <div class="factions" style="margin-top:10px">
      ${r.entrega === 'PENDENTE' ? `<button class="btn" data-entrega="${r.id}">📦 Confirmar entrega</button>` : ''}
      ${r.status === 'APLICADO' && r.entrega === 'ENTREGUE' && (!r.cascoStatus || r.cascoStatus === 'PENDENTE' || r.cascoStatus === 'NAO_DEVOLVIDO') ? `<button class="btn amber" data-casco="${r.id}">🔩 Receber casco</button>` : ''}
      ${r.status === 'APLICADO' ? `<button class="btn primary" data-devolver="${r.id}">↩ Devolver</button>` : ''}
      ${can.delete() ? `<button class="btn danger" title="Excluir requisição" data-excluirreq="${r.id}">🗑</button>` : ''}
    </div>
  </div>`;
}
function renderReqs() {
  let list = state.q ? REQS.filter(r => r.frota.toLowerCase().includes(state.q) || itemName(r.itemId).toLowerCase().includes(state.q)) : REQS;
  list = [...list].sort((a, b) => (b.dataReq || '').localeCompare(a.dataReq || ''));
  $('#cnt').innerHTML = `<b>${list.length}</b> requisições`;
  $('#main').innerHTML = list.length ? list.map(reqCard).join('') : `<div class="empty">Nenhuma requisição registrada.</div>`;
  $('#main').querySelectorAll('[data-entrega]').forEach(b => b.onclick = () => confirmarEntrega(b.dataset.entrega));
  $('#main').querySelectorAll('[data-casco]').forEach(b => b.onclick = () => receberCasco(b.dataset.casco));
  $('#main').querySelectorAll('[data-devolver]').forEach(b => b.onclick = () => devolverReq(b.dataset.devolver));
  $('#main').querySelectorAll('[data-excluirreq]').forEach(b => b.onclick = () => excluirReq(b.dataset.excluirreq));
}

/* =============== modulo: relatorios =============== */
function relGo(tipo, arg) {
  if (tipo === 'item') { setView('pecas'); state.q = ''; $('#q').value = ''; setTimeout(() => openFicha(arg), 50); }
  else if (tipo === 'forn') { state.mtab = 'aberto'; setView('movs'); state.q = arg.toLowerCase(); $('#q').value = arg; render(); }
  else if (tipo === 'cat') { setView('pecas'); state.cat = arg; render(); }
  else if (tipo === 'sit') { state.gtab = arg; setView('aggs'); }
}
function barRow(label, val, max, color) {
  const pct = max ? Math.round((val / max) * 100) : 0;
  return `<div class="rrow"><div class="rl">${esc(label)}</div><div class="rn">${val}</div><div class="rbar"><div style="width:${pct}%;background:${color}"></div></div></div>`;
}
function renderRel() {
  $('#cnt').textContent = '';
  const totalSaldo = DATA.reduce((s, d) => s + d.sn + d.sr, 0);
  const forNaoRetornados = MOVS.filter(m => m.status === 'NO_FORNECEDOR');
  const atrasados = forNaoRetornados.filter(atrasado);
  const aplicadas = REQS.filter(r => r.status === 'APLICADO');
  const cascosPend = REQS.filter(r => r.cascoStatus === 'PENDENTE');

  // consistencia
  const divergentes = DATA.map(d => ({ d, msg: checkConsist(d) })).filter(x => x.msg);

  // por fornecedor
  const byForn = {};
  for (const m of forNaoRetornados) {
    byForn[m.fornecedor] = byForn[m.fornecedor] || { envios: 0, pecas: new Set(), dias: [], atraso: 0 };
    byForn[m.fornecedor].envios++; byForn[m.fornecedor].pecas.add(m.itemId);
    byForn[m.fornecedor].dias.push(diasFora(m));
    if (atrasado(m)) byForn[m.fornecedor].atraso++;
  }

  // maior tempo fora
  const maisTempo = [...forNaoRetornados].sort((a, b) => diasFora(b) - diasFora(a)).slice(0, 8);
  const maxDias = Math.max(1, ...maisTempo.map(diasFora));

  // requisicoes por frota
  const byFrota = {};
  for (const r of aplicadas) byFrota[r.frota] = (byFrota[r.frota] || 0) + 1;

  // situacao agregados
  const bySit = {};
  for (const a of AGGS) bySit[a.situacao] = (bySit[a.situacao] || 0) + 1;
  const maxSit = Math.max(1, ...Object.values(bySit));

  // saldos por categoria
  const cats = catList();

  $('#main').innerHTML = `
    <div class="relhead"><h2 style="font-family:var(--disp);text-transform:uppercase;letter-spacing:.1em">Relatórios gerenciais</h2>
      <button class="btn primary" id="btnPrintRel">🖨 Imprimir / salvar PDF</button></div>

    <div class="rsec"><div class="rtitle">Resumo executivo</div>
      <table class="rtable"><tr>
        <th>Peças</th><th>Agregados</th><th>Saldo disponível</th><th>No fornecedor</th><th>Atrasados</th><th>Na frota</th><th>Cascos pend.</th>
      </tr><tr>
        <td class="num">${DATA.length}</td><td class="num">${AGGS.length}</td><td class="num" style="color:var(--green)">${totalSaldo}</td>
        <td class="num" style="color:var(--amber)">${forNaoRetornados.length}</td><td class="num" style="color:var(--red)">${atrasados.length}</td>
        <td class="num" style="color:#F07E3C">${aplicadas.length}</td><td class="num" style="color:var(--blue)">${cascosPend.length}</td>
      </tr></table>
    </div>

    <div class="rsec"><div class="rtitle">⚠ Consistência saldo × agregados cadastrados</div>
      ${divergentes.length ? divergentes.map(({ d, msg }) => `<div class="rrow rlink" data-relgo="item" data-arg="${d.id}"><div class="rl" style="width:auto;flex:1">${esc(d.desc)}</div><div style="color:var(--amber);font-size:12px">${esc(msg)}</div></div>`).join('') : '<span style="color:var(--mut);font-size:13px">Nenhuma divergência encontrada.</span>'}
    </div>

    <div class="rsec"><div class="rtitle">Agregados no fornecedor — por fornecedor</div>
      ${Object.keys(byForn).length ? `<table class="rtable"><tr><th>Fornecedor</th><th>Envios</th><th>Peças</th><th>Média dias</th><th>Atrasados</th></tr>
        ${Object.entries(byForn).map(([f, v]) => `<tr class="rlink" data-relgo="forn" data-arg="${esc(f)}">
          <td>${esc(f)}</td><td class="num">${v.envios}</td><td class="num">${v.pecas.size}</td>
          <td class="num">${Math.round(v.dias.reduce((a, b) => a + b, 0) / v.dias.length)}</td>
          <td class="num" style="color:${v.atraso ? 'var(--red)' : 'inherit'}">${v.atraso}</td></tr>`).join('')}</table>`
        : '<span style="color:var(--mut);font-size:13px">Nenhum envio em aberto.</span>'}
    </div>

    <div class="rsec"><div class="rtitle">Maior tempo no fornecedor</div>
      ${maisTempo.length ? maisTempo.map(m => barRow(`${itemName(m.itemId)} · ${m.fornecedor}`, diasFora(m), maxDias, atrasado(m) ? 'var(--red)' : 'var(--amber)')).join('') : '<span style="color:var(--mut);font-size:13px">Nenhum envio em aberto.</span>'}
    </div>

    <div class="rsec"><div class="rtitle">Requisições ativas por frota</div>
      ${Object.keys(byFrota).length ? `<table class="rtable"><tr><th>Frota</th><th>Peças aplicadas</th></tr>
        ${Object.entries(byFrota).map(([f, n]) => `<tr><td>${esc(f)}</td><td class="num">${n}</td></tr>`).join('')}</table>`
        : '<span style="color:var(--mut);font-size:13px">Nenhuma requisição ativa.</span>'}
    </div>

    <div class="rsec"><div class="rtitle">🔩 Cascos pendentes</div>
      ${cascosPend.length ? `<table class="rtable"><tr><th>Peça</th><th>Frota</th><th>Solicitante</th><th>Desde</th></tr>
        ${cascosPend.map(r => `<tr><td>${esc(itemName(r.itemId))}</td><td>${esc(r.frota)}</td><td>${esc(r.solicitante || '–')}</td><td>${br(r.dataReq)}</td></tr>`).join('')}</table>`
        : '<span style="color:var(--mut);font-size:13px">Nenhum casco pendente.</span>'}
    </div>

    <div class="rsec"><div class="rtitle">Situação dos agregados cadastrados</div>
      ${Object.keys(bySit).length ? Object.entries(bySit).map(([s, n]) => barRow(SIT_LABEL[s] || s, n, maxSit, 'var(--blue)')).join('') : '<span style="color:var(--mut);font-size:13px">Nenhum agregado cadastrado.</span>'}
    </div>

    <div class="rsec"><div class="rtitle">Saldos por categoria</div>
      <table class="rtable"><tr><th>Categoria</th><th>Novo</th><th>P/Cons.</th><th>Recond.</th><th>Manut.</th><th>Devendo</th></tr>
        ${cats.map(c => { const items = DATA.filter(d => d.cat === c); const t = k => items.reduce((s, d) => s + d[k], 0);
          return `<tr class="rlink" data-relgo="cat" data-arg="${esc(c)}"><td>${esc(c)}</td><td class="num">${t('sn')}</td><td class="num">${t('pc')}</td><td class="num">${t('sr')}</td><td class="num">${t('em')}</td><td class="num">${t('dv')}</td></tr>`; }).join('')}
        <tr style="font-weight:700"><td>TOTAL</td>${['sn', 'pc', 'sr', 'em', 'dv'].map(k => `<td class="num">${DATA.reduce((s, d) => s + d[k], 0)}</td>`).join('')}</tr>
      </table>
    </div>`;
  $('#btnPrintRel').onclick = () => window.print();
}

/* =============== modulo: usuarios (admin) =============== */
function openUserForm(userId) {
  const u = userId ? USERS.find(x => x.id === userId) : null;
  $('#userTitle').textContent = u ? 'Editar usuário' : 'Novo usuário';
  $('#u_name').value = u ? u.name : '';
  $('#u_username').value = u ? u.username : '';
  $('#u_username').disabled = !!u;
  $('#u_role').value = u ? u.role : 'gestor';
  $('#u_ativo').value = u ? (u.ativo ? '1' : '0') : '1';
  $('#u_password').value = '';
  $('#u_pwLabel').textContent = u ? 'Nova senha (deixe em branco p/ manter)' : 'Senha *';
  $('#uerr').style.display = 'none';
  $('#btnUser').dataset.id = u ? u.id : '';
  $('#ov8').classList.add('open');
}
$('#btnUser').onclick = async () => {
  const err = m => { $('#uerr').textContent = m; $('#uerr').style.display = 'block'; };
  const id = $('#btnUser').dataset.id;
  const name = $('#u_name').value.trim();
  const username = $('#u_username').value.trim().toLowerCase();
  const password = $('#u_password').value;
  if (!name) return err('Informe o nome completo.');
  if (!id && !username) return err('Informe o usuário (login).');
  if (!id && password.length < 4) return err('A senha precisa ter ao menos 4 caracteres.');
  const payload = { name, role: $('#u_role').value, ativo: $('#u_ativo').value === '1' };
  if (!id) payload.username = username;
  if (password) payload.password = password;
  $('#btnUser').disabled = true;
  try {
    let saved;
    if (id) { saved = await api(`/users/${id}`, { method: 'PUT', body: JSON.stringify(payload) }); Object.assign(USERS.find(u => u.id === id), saved); }
    else { saved = await api('/users', { method: 'POST', body: JSON.stringify(payload) }); USERS.push(saved); }
    updateNav(); render();
    $('#ov8').classList.remove('open');
    showBanner('ok', `Usuário ${saved.name} salvo.`, '');
  } catch (e) { return err(e.message); }
  finally { $('#btnUser').disabled = false; }
};
async function deleteUser(userId) {
  const u = USERS.find(x => x.id === userId); if (!u) return;
  if (!confirm(`Excluir o usuário ${u.name}?`)) return;
  try {
    await api(`/users/${userId}`, { method: 'DELETE' });
    USERS = USERS.filter(x => x.id !== userId);
    updateNav(); render();
    showBanner('ok', `Usuário ${u.name} excluído.`, '');
  } catch (e) { showBanner('err', 'Falha: ' + e.message, ''); }
}
function userCard(u) {
  return `<div class="mrowcard ${u.ativo ? '' : 'done'}">
    <div class="mtop">
      <div class="mpart">${esc(u.name)}${u.id === ME.id ? ' <span style="color:var(--mut);font-size:11px">(você)</span>' : ''}</div>
      <div class="mforn">${esc(u.roleLabel)}</div>
    </div>
    <div class="mdet">
      <div>Login <b>${esc(u.username)}</b></div>
      <div>Status <b>${u.ativo ? 'Ativo' : 'Inativo'}</b></div>
    </div>
    <div class="factions" style="margin-top:10px">
      <button class="btn" data-edituser="${u.id}">✎ Editar</button>
      ${u.id !== ME.id ? `<button class="btn danger" data-deluser="${u.id}">🗑 Excluir</button>` : ''}
    </div>
  </div>`;
}
let usersLoaded = false;
function renderUsers() {
  if (!usersLoaded) {
    $('#main').innerHTML = '<div class="loading"><span class="spin"></span>Carregando usuários…</div>';
    api('/users').then(list => { USERS = list; usersLoaded = true; if (state.view === 'usuarios') render(); })
      .catch(e => { $('#main').innerHTML = `<div class="empty">Falha ao carregar usuários: ${esc(e.message)}</div>`; });
    return;
  }
  let list = state.q ? USERS.filter(u => u.name.toLowerCase().includes(state.q) || u.username.toLowerCase().includes(state.q)) : USERS;
  $('#cnt').innerHTML = `<b>${list.length}</b> usuários`;
  $('#main').innerHTML = list.length ? list.map(userCard).join('') : `<div class="empty">Nenhum usuário cadastrado.</div>`;
  $('#main').querySelectorAll('[data-edituser]').forEach(b => b.onclick = () => openUserForm(b.dataset.edituser));
  $('#main').querySelectorAll('[data-deluser]').forEach(b => b.onclick = () => deleteUser(b.dataset.deluser));
}

/* =============== exportar Excel =============== */
$('#btnExport').onclick = () => {
  const header = ['ITEM', 'CÓD CHB NOVO', 'CÓD CHB RECOND', 'BASE Nº DE FOGO', 'DESCRIÇÃO GENÉRICA',
    'REFERÊNCIA', 'VERSÃO (ANO)', 'SALDO NOVO', 'P/ CONSERTO', 'SALDO REC', 'EM MANUT', 'DEVENDO'];
  const aoa = [['GESTÃO DE PEÇAS CH570 — EXPORTADO DO APLICATIVO EM ' + new Date().toLocaleString('pt-BR')], [], header];
  for (const c of catList()) {
    aoa.push([c]);
    for (const d of DATA.filter(x => x.cat === c))
      aoa.push([d.n ?? '', d.codNovo ?? '', d.codRec ?? '', d.fogo || '', d.desc, d.ref || '', 0, d.sn, d.pc, d.sr, d.em, d.dv]);
  }
  aoa.push([]);
  const t = k => DATA.reduce((s, d) => s + (+d[k] || 0), 0);
  aoa.push(['TOTAL GERAL', '', '', '', '', '', '', t('sn'), t('pc'), t('sr'), t('em'), t('dv')]);
  const ws = XLSX.utils.aoa_to_sheet(aoa);
  ws['!cols'] = [{ wch: 6 }, { wch: 12 }, { wch: 14 }, { wch: 10 }, { wch: 44 }, { wch: 14 }, { wch: 8 }, { wch: 10 }, { wch: 11 }, { wch: 10 }, { wch: 9 }, { wch: 9 }];
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'CH570');

  const aggAoa = [['AGREGADOS'], [], ['FOGO', 'PEÇA', 'SITUAÇÃO', 'MÁQUINA', 'SÉRIE']];
  for (const a of AGGS) aggAoa.push([a.fogo, itemName(a.itemId), SIT_LABEL[a.situacao] || a.situacao, a.maquina || '', a.serie || '']);
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(aggAoa), 'Agregados');

  const movAoa = [['MANUTENÇÕES'], [], ['PEÇA', 'FOGO', 'FORNECEDOR', 'QTD', 'ENVIO', 'PREVISÃO', 'STATUS', 'RETORNO']];
  for (const m of MOVS) movAoa.push([itemName(m.itemId), m.fogoAgg || '', m.fornecedor, m.qtd, br(m.dataEnvio), br(m.previsaoRetorno), m.status, br(m.dataRetorno)]);
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(movAoa), 'Manutencoes');

  const reqAoa = [['REQUISIÇÕES'], [], ['PEÇA', 'FOGO', 'FROTA', 'SOLICITANTE', 'DATA', 'STATUS', 'ENTREGA', 'CASCO STATUS', 'CASCO Nº FOGO', 'CASCO ENTREGUE POR', 'CONFERIDO POR (ALMOX.)']];
  for (const r of REQS) reqAoa.push([itemName(r.itemId), r.fogoAgg || '', r.frota, r.solicitante || '', br(r.dataReq), r.status, r.entrega, r.cascoStatus || '', r.cascoFogo || '', r.cascoEntreguePor || '', r.cascoRecebidoPor || '']);
  const wsReq = XLSX.utils.aoa_to_sheet(reqAoa);
  wsReq['!cols'] = [{ wch: 30 }, { wch: 10 }, { wch: 14 }, { wch: 16 }, { wch: 12 }, { wch: 12 }, { wch: 10 }, { wch: 14 }, { wch: 12 }, { wch: 18 }, { wch: 18 }];
  XLSX.utils.book_append_sheet(wb, wsReq, 'Requisicoes');

  XLSX.writeFile(wb, 'Saldos_Pecas_CH570_' + new Date().toISOString().slice(0, 10) + '.xlsx');
  showBanner('ok', 'Planilha exportada com o estado atual do catálogo.', '');
};

/* =============== tilt 3D no hover =============== */
let tiltCard = null;
document.addEventListener('mousemove', e => {
  const card = e.target.closest('.tag');
  if (card !== tiltCard) {
    if (tiltCard) tiltCard.style.transform = '';
    tiltCard = card;
  }
  if (!card) return;
  const r = card.getBoundingClientRect();
  const px = (e.clientX - r.left) / r.width;
  const py = (e.clientY - r.top) / r.height;
  const rotY = (px - 0.5) * 10;
  const rotX = (0.5 - py) * 10;
  card.style.transform = `perspective(800px) rotateX(${rotX}deg) rotateY(${rotY}deg) translateY(-4px) scale(1.02)`;
});
document.addEventListener('mouseleave', e => {
  if (tiltCard) { tiltCard.style.transform = ''; tiltCard = null; }
}, true);

/* =============== usuario logado =============== */
$('#btnLogout').onclick = async () => {
  try { await api('/logout', { method: 'POST' }); } catch (_) {}
  window.location.href = '/login';
};

/* =============== boot =============== */
(async () => {
  refreshKpis();
  try {
    ME = await api('/me');
    $('#uName').textContent = ME.name;
    $('#uRole').textContent = ME.roleLabel;
    if (ME.role === 'admin') $('#modUsuarios').style.display = '';

    await loadAll();
    refreshKpis(); updateNav(); render();
    if (META.mariadbTs) {
      $('#updDate').textContent = META.mariadbTs;
      showBanner('info', 'Catálogo carregado.', 'Última consulta ao banco: ' + META.mariadbTs);
    } else if (META.ts) {
      $('#updDate').textContent = META.ts;
      showBanner('info', 'Catálogo carregado.', 'Última atualização: ' + META.ts);
    }
  } catch (err) {
    showBanner('err', 'Falha ao carregar catálogo: ' + err.message, '');
    render();
  }
})();
