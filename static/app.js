'use strict';

/* =============== estado e API =============== */
let DATA = [];
let META = { ts: null };

const $ = s => document.querySelector(s);
const fmt = n => n > 0 ? n : '–';
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const imgSrc = d => d.foto ? `data:${d.foto.mime};base64,${d.foto.b64}` : null;
const catList = () => [...new Set(DATA.map(d => d.cat))];
const byId = id => DATA.find(d => d.id === id);

function showBanner(kind, msg, ts) {
  const b = $('#banner'); b.className = 'banner ' + kind; b.style.display = 'block';
  $('#bmsg').textContent = msg; $('#bts').textContent = ts || '';
}

async function api(path, opts) {
  const res = await fetch('/api' + path, {
    headers: { 'Content-Type': 'application/json' },
    ...opts,
  });
  if (!res.ok) {
    let msg = 'Erro ' + res.status;
    try { const j = await res.json(); if (j.error) msg = j.error; } catch (_) {}
    throw new Error(msg);
  }
  if (res.status === 204) return null;
  return res.json();
}

async function loadAll() {
  const data = await api('/items');
  DATA = data.items;
  META.ts = data.ts;
}

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

/* =============== filtros e grid =============== */
const state = { q: '', cat: '', f: new Set() };
function refreshCatSelect() {
  const cur = state.cat;
  $('#fcat').innerHTML = '<option value="">Todas as categorias</option>' +
    catList().map(c => `<option${c === cur ? ' selected' : ''}>${esc(c)}</option>`).join('');
}
document.querySelectorAll('.chip').forEach(ch => ch.onclick = () => {
  const f = ch.dataset.f;
  state.f.has(f) ? state.f.delete(f) : state.f.add(f);
  ch.classList.toggle('on'); render();
});
$('#q').oninput = e => { state.q = e.target.value.toLowerCase(); render(); };
$('#fcat').onchange = e => { state.cat = e.target.value; render(); };

function status(d) {
  if (d.dv > 0) return 'dv'; if (d.em > 0) return 'em';
  if (d.sr + d.sn > 0) return 'ok'; return 'zero';
}
function match(d) {
  if (state.cat && d.cat !== state.cat) return false;
  if (state.f.size) {
    if (state.f.has('dv') && !(d.dv > 0)) return false;
    if (state.f.has('em') && !(d.em > 0)) return false;
    if (state.f.has('ok') && !(d.sr > 0)) return false;
  }
  if (state.q) {
    const hay = `${d.desc} ${d.codNovo} ${d.codRec} ${d.ref} ${d.fogo}`.toLowerCase();
    if (!hay.includes(state.q)) return false;
  }
  return true;
}
function card(d) {
  const st = status(d);
  const src = imgSrc(d);
  const ph = src ? `<div class="ph"><img loading="lazy" src="${src}" alt=""></div>`
    : `<div class="ph nophoto">SEM FOTO</div>`;
  return `<div class="tag" data-id="${d.id}" role="button" tabindex="0" aria-label="${esc(d.desc)}">
    <span class="punch"></span>${d.novo ? '<span class="new">NOVA</span>' : ''}
    <div class="thead">${ph}
      <div class="tinfo">${d.fogo ? `<span class="fogo">${esc(d.fogo)}</span>` : ''}
        <div class="desc">${esc(d.desc)}</div></div></div>
    <div class="cods"><span>NOVO <b>${esc(d.codNovo ?? '–')}</b></span><span>REC <b>${esc(d.codRec ?? '–')}</b></span></div>
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
function render() {
  refreshCatSelect();
  if (!DATA.length) {
    $('#cnt').textContent = '';
    $('#main').innerHTML = `<div class="empty"><b>Catálogo vazio.</b><br><br>
      Para montar o catálogo, clique em <b>⟳ Importar Excel</b> e selecione o relatório gerencial
      "Saldos Peças-Consertados" — o app lê os itens, os saldos <b>e as fotos embutidas</b> na planilha automaticamente.<br><br>
      Ou clique em <b>＋ Adicionar peça</b> para cadastrar manualmente.</div>`;
    return;
  }
  const vis = DATA.filter(match);
  $('#cnt').innerHTML = `<b>${vis.length}</b> / ${DATA.length} itens`;
  if (!vis.length) { $('#main').innerHTML = `<div class="empty">Nenhuma peça corresponde aos filtros.</div>`; return; }
  let html = '';
  for (const c of catList()) {
    const grp = vis.filter(d => d.cat === c);
    if (!grp.length) continue;
    html += `<div class="catlab">${esc(c)} · ${grp.length}</div><div class="grid">${grp.map(card).join('')}</div>`;
  }
  $('#main').innerHTML = html;
}

/* =============== ficha =============== */
document.addEventListener('click', e => {
  const t = e.target.closest('.tag'); if (t) openFicha(t.dataset.id);
  if (e.target.id === 'ov') $('#ov').classList.remove('open');
  if (e.target.id === 'ov2') $('#ov2').classList.remove('open');
  if (e.target.closest('[data-close]')) $('#' + e.target.closest('[data-close]').dataset.close).classList.remove('open');
});
document.addEventListener('keydown', e => {
  if (e.key === 'Escape') { $('#ov').classList.remove('open'); $('#ov2').classList.remove('open'); }
  if (e.key === 'Enter' && document.activeElement.classList?.contains('tag')) openFicha(document.activeElement.dataset.id);
});
function openFicha(id) {
  const d = byId(id); if (!d) return;
  const src = imgSrc(d);
  $('#ficha').innerHTML = `
    <div class="fh"><span class="fogo">${esc(d.fogo || ('ITEM ' + (d.n ?? '')))}</span><button class="fx" data-close="ov">✕</button></div>
    <div class="fbody">
      ${src ? `<div class="fimg"><img src="${src}" alt="${esc(d.desc)}"></div>` : ''}
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
      <div class="factions">
        <button class="btn danger" id="btnDel">🗑 Excluir</button>
        <button class="btn primary" id="btnEdit">✎ Editar</button>
      </div>
    </div>`;
  $('#ov').classList.add('open');
  $('#btnDel').onclick = () => delItem(id);
  $('#btnEdit').onclick = () => { $('#ov').classList.remove('open'); openForm(id); };
}
async function delItem(id) {
  const d = byId(id);
  if (!confirm(`Excluir a peça "${d.desc}"?`)) return;
  try {
    await api(`/items/${id}`, { method: 'DELETE' });
    DATA = DATA.filter(x => x.id !== id);
    refreshKpis(); render();
    $('#ov').classList.remove('open');
    showBanner('ok', `Peça excluída: ${d.desc}`, '');
  } catch (err) { showBanner('err', 'Falha ao excluir: ' + err.message, ''); }
}

/* =============== formulário =============== */
let formImg = null, formMime = null, editId = null;
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
$('#btnAdd').onclick = () => openForm(null);
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
    refreshKpis(); render();
    $('#ov2').classList.remove('open');
  } catch (e2) { return err(e2.message); }
  finally { $('#btnSave').disabled = false; }
};

/* =============== importar Excel (dados + fotos embutidas) =============== */
const HDR_MAP = { 'SALDO NOVO': 'sn', 'P/ CONSERTO': 'pc', 'SALDO REC': 'sr', 'EM MANUT': 'em', 'DEVENDO': 'dv' };
const norm = s => String(s ?? '').replace(/\s+/g, ' ').trim().toUpperCase();

async function extractPhotos(buf) {
  const zip = await JSZip.loadAsync(buf);
  const out = {};
  const drawingFiles = Object.keys(zip.files).filter(f => /^xl\/drawings\/drawing\d+\.xml$/.test(f));
  for (const df of drawingFiles) {
    const xml = await zip.file(df).async('string');
    const relsPath = df.replace('drawings/', 'drawings/_rels/') + '.rels';
    const relsFile = zip.file(relsPath); if (!relsFile) continue;
    const rels = await relsFile.async('string');
    const rid2img = {};
    for (const m of rels.matchAll(/Id="(rId\d+)"[^>]*Target="\.\.\/media\/([^"]+)"/g)) rid2img[m[1]] = m[2];
    for (const m of xml.matchAll(/<xdr:(?:twoCell|oneCell)Anchor[\s\S]*?<\/xdr:(?:twoCell|oneCell)Anchor>/g)) {
      const a = m[0];
      const fr = a.match(/<xdr:from>[\s\S]*?<xdr:row>(\d+)<\/xdr:row>/);
      const rid = a.match(/r:embed="(rId\d+)"/);
      if (!fr || !rid || !rid2img[rid[1]]) continue;
      const excelRow = +fr[1] + 1;
      if (out[excelRow]) continue;
      const mediaFile = zip.file('xl/media/' + rid2img[rid[1]]);
      if (!mediaFile) continue;
      const blob = await mediaFile.async('blob');
      const b64 = await new Promise((res, rej) => {
        const img = new Image();
        img.onload = () => { try { res(compressToJpeg(img, 300)); } catch (e) { rej(e); } finally { URL.revokeObjectURL(img.src); } };
        img.onerror = () => { URL.revokeObjectURL(img.src); res(null); };
        img.src = URL.createObjectURL(blob);
      });
      if (b64) out[excelRow] = { b64, mime: 'image/jpeg' };
    }
  }
  return out;
}

$('#xlfile').addEventListener('change', async e => {
  const file = e.target.files[0]; if (!file) return;
  $('#lblImport').textContent = '⏳ Importando…';
  try {
    const buf = await file.arrayBuffer();
    const wb = XLSX.read(buf, { type: 'array' });
    const shName = wb.SheetNames.find(n => n.toUpperCase().includes('CH570')) || wb.SheetNames[0];
    const rows = XLSX.utils.sheet_to_json(wb.Sheets[shName], { header: 1, defval: null });

    let hri = -1, cols = {};
    for (let i = 0; i < Math.min(rows.length, 15); i++) {
      const r = (rows[i] || []).map(norm);
      if (r.includes('ITEM') && r.some(c => c.includes('DEVENDO'))) {
        hri = i;
        r.forEach((h, ci) => { for (const k in HDR_MAP) if (h.includes(k)) cols[HDR_MAP[k]] = ci;
          if (h.includes('CHB') && h.includes('NOVO')) cols.codNovo = ci;
          if (h.includes('CHB') && h.includes('RECOND')) cols.codRec = ci;
          if (h.includes('FOGO')) cols.fogo = ci;
          if (h.includes('DESCRI')) cols.desc = ci;
          if (h.includes('REFER')) cols.ref = ci; });
        break;
      }
    }
    if (hri < 0 || cols.codNovo == null) throw new Error('Cabeçalho não encontrado (ITEM / CÓD CHB / DEVENDO). Verifique se é o relatório gerencial CH570.');

    const fotos = await extractPhotos(buf);
    let cat = 'Geral';
    const items = [];
    for (let i = hri + 1; i < rows.length; i++) {
      const r = rows[i] || [];
      const a = r[0];
      if (typeof a === 'string' && a.trim() && r[cols.codNovo] == null) {
        const t = a.trim(); if (!/^TOTAL/i.test(t)) cat = t.replace(/\b\w/g, c => c.toUpperCase());
        continue;
      }
      if (r[cols.codNovo] == null || typeof a !== 'number') continue;
      const cn = r[cols.codNovo], cr = r[cols.codRec];
      const num = c => { const v = r[cols[c]]; return (typeof v === 'number') ? v : 0; };
      const excelRow = i + 1;
      const item = {
        n: a, cat,
        codNovo: cn, codRec: cr ?? null,
        fogo: String(r[cols.fogo] ?? '').trim(), desc: String(r[cols.desc] ?? '').trim(),
        ref: String(r[cols.ref] ?? '').trim(),
        sn: num('sn'), pc: num('pc'), sr: num('sr'), em: num('em'), dv: num('dv'),
      };
      if (fotos[excelRow]) item.foto = fotos[excelRow];
      items.push(item);
    }
    if (!items.length) throw new Error('Nenhum item reconhecido na planilha.');

    const result = await api('/items/bulk', { method: 'POST', body: JSON.stringify({ items }) });
    await loadAll();
    refreshKpis(); render();
    $('#updDate').textContent = META.ts;
    showBanner('ok', `Importação concluída: ${result.added} item(ns) novo(s), ${result.updated} atualizado(s).`, 'Arquivo: ' + file.name + ' · ' + META.ts);
  } catch (err) { showBanner('err', 'Falha ao importar: ' + err.message, ''); }
  $('#lblImport').textContent = '⟳ Importar Excel';
  e.target.value = '';
});

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
  XLSX.writeFile(wb, 'Saldos_Pecas_CH570_' + new Date().toISOString().slice(0, 10) + '.xlsx');
  showBanner('ok', 'Planilha exportada com o estado atual do catálogo.', '');
};

/* =============== boot =============== */
(async () => {
  refreshKpis();
  try {
    await loadAll();
    refreshKpis(); render();
    if (META.ts) {
      $('#updDate').textContent = META.ts;
      showBanner('info', 'Catálogo carregado.', 'Última atualização: ' + META.ts);
    }
  } catch (err) {
    showBanner('err', 'Falha ao carregar catálogo: ' + err.message, '');
    render();
  }
})();
