// ==================== DADOS PADRÃO E ESTADO ====================
const STORAGE_KEY = 'sorriso_vida_db_v1';
const DEFAULT_GAS_URL = 'https://script.google.com/macros/s/AKfycbx2ym4O9HINtC26-yedpYkSl8CyiBdfdFgZh5DYlBaZi8R-hYFo8YqRzdRTt6sGzRvS/exec';

const DEFAULT_CONFIG = {
  senha: '1234',
  gasUrl: DEFAULT_GAS_URL,
  dentistas: [
    { id: 'd1', nome: 'Dr. Pedro', cro: 'CRO-CE 0001' },
    { id: 'd2', nome: 'Dra. Parceira', cro: 'CRO-CE 0002' }
  ],
  especialidades: [
    { nome: 'IMPLANTE', percentual: 30 },
    { nome: 'PROTESE', percentual: 25 },
    { nome: 'ORTO', percentual: 30 },
    { nome: 'ENDO', percentual: 30 },
    { nome: 'FACETA', percentual: 30 },
    { nome: 'CLINICO', percentual: 25 }
  ],
  taxas: [
    { id: 'dinheiro', nome: 'Dinheiro', taxa: 0 },
    { id: 'pix', nome: 'Pix', taxa: 0 },
    { id: 'debito', nome: 'Débito', taxa: 2 },
    { id: 'credito_3x', nome: 'Crédito até 3x', taxa: 7 },
    { id: 'credito_6x', nome: 'Crédito até 6x', taxa: 10 },
    { id: 'credito_12x', nome: 'Crédito até 12x', taxa: 15 }
  ],
  categoriasSaida: [
    'LABORATÓRIO',
    'PROD. LIMP/HIG.',
    'IMPOSTOS',
    'SALÁRIOS',
    'MARKETING',
    'ALUGUEL',
    'MERCANTIL',
    'SERV. ESSENCIAIS',
    'FAXINA',
    'PAG. DENTISTAS',
    'GRAF./PAPELARIA',
    'MANUTENÇÃO',
    'OUTROS'
  ]
};

let db = carregarDB();
let abasDesbloqueadas = { geral: false, config: false };
let abaPendenteSenha = null;

function carregarDB() {
  const salvo = localStorage.getItem(STORAGE_KEY);
  if (salvo) {
    try {
      const parsed = JSON.parse(salvo);
      const senhaSalva = parsed.config?.senha ? String(parsed.config.senha).trim() : '';
      return {
        config: {
          ...DEFAULT_CONFIG,
          ...parsed.config,
          senha: senhaSalva || '1234',
          gasUrl: parsed.config?.gasUrl || DEFAULT_GAS_URL
        },
        atendimentos: parsed.atendimentos || [],
        saidas: parsed.saidas || [],
        pagamentosDentistas: parsed.pagamentosDentistas || {},
        filaSync: parsed.filaSync || []
      };
    } catch (e) {
      console.error('Erro ao ler storage local:', e);
    }
  }
  return {
    config: structuredClone(DEFAULT_CONFIG),
    atendimentos: [],
    saidas: [],
    pagamentosDentistas: {},
    filaSync: []
  };
}

function salvarDB() {
  if (!db.config.senha || !String(db.config.senha).trim()) {
    db.config.senha = '1234';
  }
  localStorage.setItem(STORAGE_KEY, JSON.stringify(db));
  atualizarBadgePendentes();
}

// ==================== UTILITÁRIOS ====================
const fmtBRL = (val) =>
  Number(val || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

const hojeISO = () => {
  const d = new Date();
  d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
  return d.toISOString().split('T')[0];
};

const getDataAtiva = () => document.getElementById('dataAtiva').value || hojeISO();

const gerarId = () => Date.now().toString(36) + Math.random().toString(36).substring(2, 7);

// ==================== INICIALIZAÇÃO ====================
document.addEventListener('DOMContentLoaded', async () => {
  lucide.createIcons();

  const inputData = document.getElementById('dataAtiva');
  inputData.value = hojeISO();
  inputData.addEventListener('change', renderizarTudo);

  configurarNavegacao();
  configurarModalSenha();
  configurarFormularios();
  popularSelects();
  renderizarTudo();
  configurarConexao();
});

// ==================== CONEXÃO & SINCRONIZAÇÃO BIDIRECIONAL ====================
function configurarConexao() {
  const atualizarStatus = async () => {
    const badge = document.getElementById('statusConexao');
    const txt = document.getElementById('statusTexto');
    if (navigator.onLine) {
      badge.className = 'status-badge online';
      txt.textContent = 'Online';
      await sincronizarFila();
      await buscarDadosDaNuvem();
    } else {
      badge.className = 'status-badge offline';
      txt.textContent = 'Offline (Local)';
    }
  };

  window.addEventListener('online', atualizarStatus);
  window.addEventListener('offline', atualizarStatus);
  document.getElementById('btnSincronizar').addEventListener('click', async () => {
    await sincronizarFila(true);
    await buscarDadosDaNuvem();
  });
  atualizarStatus();
}

function enfileirarSync(acao, payload) {
  db.filaSync.push({
    id: gerarId(),
    timestamp: new Date().toISOString(),
    acao,
    payload
  });
  salvarDB();
  if (navigator.onLine) sincronizarFila();
}

function atualizarBadgePendentes() {
  document.getElementById('badgePendentes').textContent = db.filaSync.length;
}

async function sincronizarFila(manual = false) {
  atualizarBadgePendentes();
  if (!navigator.onLine) {
    if (manual) alert('Sem conexão com a internet. Os dados estão salvos localmente e serão enviados quando a rede voltar.');
    return;
  }
  if (!db.config.gasUrl) return;
  if (db.filaSync.length === 0) return;

  const txt = document.getElementById('statusTexto');
  txt.textContent = 'Enviando...';

  try {
    const lote = [...db.filaSync];
    const resp = await fetch(db.config.gasUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({ tipo: 'SYNC_LOTE', itens: lote })
    });

    if (!resp.ok) throw new Error('Falha HTTP ' + resp.status);

    const idsEnviados = new Set(lote.map((i) => i.id));
    db.filaSync = db.filaSync.filter((i) => !idsEnviados.has(i.id));
    salvarDB();
    txt.textContent = 'Online';
    if (manual) alert('Dados enviados para o Google Sheets com sucesso!');
  } catch (err) {
    console.error('Erro na sincronização:', err);
    txt.textContent = 'Erro Sync (Retentará)';
  }
}

async function buscarDadosDaNuvem() {
  if (!navigator.onLine || !db.config.gasUrl || db.filaSync.length > 0) return;

  const txt = document.getElementById('statusTexto');
  txt.textContent = 'Atualizando...';

  try {
    const resp = await fetch(db.config.gasUrl);
    const json = await resp.json();

    if (json.status === 'ok') {
      db.atendimentos = json.atendimentos || [];
      db.saidas = json.saidas || [];
      db.pagamentosDentistas = json.pagamentosDentistas || {};
      if (json.config) {
        const senhaNuvem = json.config.senha ? String(json.config.senha).trim() : '';
        db.config = {
          ...db.config,
          ...json.config,
          senha: senhaNuvem || db.config.senha || '1234',
          gasUrl: db.config.gasUrl
        };
      }
      salvarDB();
      popularSelects();
      renderizarTudo();
    }
    txt.textContent = 'Online';
  } catch (err) {
    console.error('Erro ao baixar dados da planilha:', err);
    txt.textContent = 'Online (Local)';
  }
}

// ==================== NAVEGAÇÃO & PROTEÇÃO POR SENHA ====================
function configurarNavegacao() {
  document.querySelectorAll('.tab-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      const target = btn.dataset.tab;
      const isProtected = btn.dataset.protected === 'true';

      if (isProtected && !abasDesbloqueadas[target]) {
        abaPendenteSenha = target;
        abrirModalSenha();
        return;
      }
      ativarAba(target);
    });
  });

  document.getElementById('btnBloquearGeral').addEventListener('click', () => {
    abasDesbloqueadas.geral = false;
    ativarAba('mapa');
  });

  document.getElementById('btnBloquearConfig').addEventListener('click', () => {
    abasDesbloqueadas.config = false;
    ativarAba('mapa');
  });
}

function ativarAba(tabName) {
  document.querySelectorAll('.tab-btn').forEach((b) => b.classList.toggle('active', b.dataset.tab === tabName));
  document.querySelectorAll('.tab-content').forEach((s) => s.classList.toggle('active', s.id === `tab-${tabName}`));
  renderizarTudo();
}

function configurarModalSenha() {
  const modal = document.getElementById('modalSenha');
  const input = document.getElementById('inputSenhaAcesso');
  const erro = document.getElementById('erroSenha');

  const validar = () => {
    const senhaDigitada = input.value.trim();
    const senhaCorreta = String(db.config.senha || '1234').trim();

    if (senhaDigitada === senhaCorreta) {
      abasDesbloqueadas[abaPendenteSenha] = true;
      modal.classList.add('hidden');
      erro.classList.add('hidden');
      input.value = '';
      ativarAba(abaPendenteSenha);
    } else {
      erro.classList.remove('hidden');
    }
  };

  document.getElementById('btnConfirmarSenha').addEventListener('click', validar);
  input.addEventListener('keypress', (e) => { if (e.key === 'Enter') validar(); });
  document.getElementById('btnCancelarSenha').addEventListener('click', () => {
    modal.classList.add('hidden');
    erro.classList.add('hidden');
    input.value = '';
  });
}

function abrirModalSenha() {
  const modal = document.getElementById('modalSenha');
  modal.classList.remove('hidden');
  setTimeout(() => document.getElementById('inputSenhaAcesso').focus(), 50);
}

// ==================== POPULAR LISTAS SUSPENSAS ====================
function popularSelects() {
  const optsDentistas = db.config.dentistas
    .map((d) => `<option value="${d.id}">${d.nome} (${d.cro})</option>`)
    .join('');

  document.getElementById('mDentistaVenda').innerHTML = optsDentistas;
  document.getElementById('mDentistaExec').innerHTML = optsDentistas;
  document.getElementById('sDentista').innerHTML = `<option value="">-- Nenhum (Despesa Geral) --</option>` + optsDentistas;

  document.getElementById('mEspecialidade').innerHTML = db.config.especialidades
    .map((e) => `<option value="${e.nome}">${e.nome} (${e.percentual}%)</option>`)
    .join('');

  document.getElementById('mFormaPagamento').innerHTML = db.config.taxas
    .map((t) => `<option value="${t.id}">${t.nome} (-${t.taxa}%)</option>`)
    .join('');

  document.getElementById('sDescricao').innerHTML = db.config.categoriasSaida
    .map((c) => `<option value="${c}">${c}</option>`)
    .join('');

  const anoAtual = new Date().getFullYear();
  const selectAno = document.getElementById('filtroAno');
  if (!selectAno.innerHTML) {
    for (let a = anoAtual; a >= anoAtual - 3; a--) {
      selectAno.innerHTML += `<option value="${a}">${a}</option>`;
    }
    selectAno.addEventListener('change', renderizarGeral);
  }
}

// ==================== CÁLCULOS E FORMULÁRIOS ====================
function calcularValoresMapa() {
  const espNome = document.getElementById('mEspecialidade').value;
  const formaId = document.getElementById('mFormaPagamento').value;
  const valorPago = parseFloat(document.getElementById('mValorPago').value) || 0;
  const valorExecBruto = parseFloat(document.getElementById('mValorExecBruto').value) || 0;
  const valorLab = parseFloat(document.getElementById('mValorLab').value) || 0;

  const espObj = db.config.especialidades.find((e) => e.nome === espNome) || { percentual: 0 };
  const taxaObj = db.config.taxas.find((t) => t.id === formaId) || { taxa: 0, nome: '' };

  const fatorLiquido = 1 - taxaObj.taxa / 100;
  const valorFinal = valorPago * fatorLiquido;
  const comissaoVenda = valorFinal * (espObj.percentual / 100);

  const valorExecLiquido = valorExecBruto * fatorLiquido;
  const baseExecucao = Math.max(0, valorExecLiquido - valorLab);
  const comissaoExec = baseExecucao * (espObj.percentual / 100);
  const comissaoTotal = comissaoVenda + comissaoExec;

  return {
    espNome,
    formaId,
    formaNome: taxaObj.nome,
    taxaAplicada: taxaObj.taxa,
    percEspecialidade: espObj.percentual,
    valorPago,
    valorFinal,
    comissaoVenda,
    valorExecBruto,
    valorExecLiquido,
    valorLab,
    comissaoExec,
    comissaoTotal
  };
}

function atualizarPreviewMapa() {
  const c = calcularValoresMapa();
  document.getElementById('prevValorFinal').textContent = fmtBRL(c.valorFinal);
  document.getElementById('prevComVenda').textContent = fmtBRL(c.comissaoVenda);
  document.getElementById('prevExecLiq').textContent = fmtBRL(c.valorExecLiquido);
  document.getElementById('prevComExec').textContent = fmtBRL(c.comissaoExec);
  document.getElementById('prevComTotal').textContent = fmtBRL(c.comissaoTotal);
}

function configurarFormularios() {
  const inpPago = document.getElementById('mValorPago');
  const inpExec = document.getElementById('mValorExecBruto');
  inpPago.addEventListener('input', () => {
    if (!inpExec.dataset.editadoManualmente) {
      inpExec.value = inpPago.value;
    }
    atualizarPreviewMapa();
  });
  inpExec.addEventListener('input', () => {
    inpExec.dataset.editadoManualmente = 'true';
    atualizarPreviewMapa();
  });

  ['mEspecialidade', 'mFormaPagamento', 'mValorLab'].forEach((id) => {
    document.getElementById(id).addEventListener('change', atualizarPreviewMapa);
    document.getElementById(id).addEventListener('input', atualizarPreviewMapa);
  });

  document.getElementById('formMapa').addEventListener('submit', (e) => {
    e.preventDefault();
    const calc = calcularValoresMapa();
    const novo = {
      id: gerarId(),
      data: getDataAtiva(),
      paciente: document.getElementById('mPaciente').value.trim(),
      procedimento: document.getElementById('mProcedimento').value.trim(),
      dentistaVendaId: document.getElementById('mDentistaVenda').value,
      dentistaExecId: document.getElementById('mDentistaExec').value,
      ...calc
    };

    db.atendimentos.push(novo);
    salvarDB();
    enfileirarSync('ADD_ATENDIMENTO', novo);

    e.target.reset();
    document.getElementById('mValorLab').value = '0';
    delete inpExec.dataset.editadoManualmente;
    atualizarPreviewMapa();
    renderizarTudo();
  });

  const selDesc = document.getElementById('sDescricao');
  selDesc.addEventListener('change', () => {
    const val = selDesc.value;
    document.getElementById('boxOutros').classList.toggle('hidden', val !== 'OUTROS');
    document.getElementById('boxDentistaDesconto').classList.toggle('hidden', val !== 'PAG. DENTISTAS');
  });

  document.getElementById('formSaidas').addEventListener('submit', (e) => {
    e.preventDefault();
    const categoria = selDesc.value;
    const outrosTxt = document.getElementById('sOutrosTexto').value.trim();
    const dentistaId = document.getElementById('sDentista').value;

    const novaSaida = {
      id: gerarId(),
      data: getDataAtiva(),
      categoria,
      descricaoFinal: categoria === 'OUTROS' && outrosTxt ? `OUTROS: ${outrosTxt}` : categoria,
      dentistaId: dentistaId || null,
      origem: document.getElementById('sOrigem').value,
      valor: parseFloat(document.getElementById('sValor').value) || 0,
      obs: document.getElementById('sObs').value.trim()
    };

    db.saidas.push(novaSaida);
    salvarDB();
    enfileirarSync('ADD_SAIDA', novaSaida);

    e.target.reset();
    document.getElementById('boxOutros').classList.add('hidden');
    document.getElementById('boxDentistaDesconto').classList.add('hidden');
    renderizarTudo();
  });

  document.getElementById('formAddDentista').addEventListener('submit', (e) => {
    e.preventDefault();
    db.config.dentistas.push({
      id: 'd_' + gerarId(),
      nome: document.getElementById('cfgDentistaNome').value.trim(),
      cro: document.getElementById('cfgDentistaCro').value.trim()
    });
    salvarDB();
    enfileirarSync('UPDATE_CONFIG', db.config);
    e.target.reset();
    popularSelects();
    renderizarConfig();
  });

  document.getElementById('formAddEspecialidade').addEventListener('submit', (e) => {
    e.preventDefault();
    db.config.especialidades.push({
      nome: document.getElementById('cfgEspNome').value.trim().toUpperCase(),
      percentual: parseFloat(document.getElementById('cfgEspPerc').value) || 0
    });
    salvarDB();
    enfileirarSync('UPDATE_CONFIG', db.config);
    e.target.reset();
    popularSelects();
    renderizarConfig();
  });

  document.getElementById('formAddSaidaCat').addEventListener('submit', (e) => {
    e.preventDefault();
    const cat = document.getElementById('cfgSaidaNome').value.trim().toUpperCase();
    if (!db.config.categoriasSaida.includes(cat)) {
      db.config.categoriasSaida.push(cat);
      salvarDB();
      enfileirarSync('UPDATE_CONFIG', db.config);
      popularSelects();
      renderizarConfig();
    }
    e.target.reset();
  });

  document.getElementById('btnSalvarSistema').addEventListener('click', () => {
    const url = document.getElementById('cfgGasUrl').value.trim();
    const novaSenha = document.getElementById('cfgNovaSenha').value.trim();
    if (url) db.config.gasUrl = url;
    if (novaSenha) db.config.senha = novaSenha;
    salvarDB();
    enfileirarSync('UPDATE_CONFIG', db.config);
    alert('Configurações salvas e sincronizadas com o Drive!');
  });
}

// ==================== RENDERIZAÇÃO DAS ABAS ====================
function renderizarTudo() {
  renderizarMapa();
  renderizarSaidas();
  renderizarDiarioCaixa();
  renderizarPagamentosDentistas();
  if (abasDesbloqueadas.geral) renderizarGeral();
  if (abasDesbloqueadas.config) renderizarConfig();
}

const nomeDentista = (id) => {
  const d = db.config.dentistas.find((x) => x.id === id);
  return d ? d.nome : 'Removido';
};

function renderizarMapa() {
  const data = getDataAtiva();
  const lista = db.atendimentos.filter((a) => a.data === data);
  const tbody = document.querySelector('#tabelaMapa tbody');

  let somaLiquida = 0;
  tbody.innerHTML = lista
    .map((item) => {
      somaLiquida += item.valorFinal;
      return `
      <tr>
        <td><strong>${item.paciente}</strong></td>
        <td>${item.procedimento}<br><small class="hint">${item.espNome} (${item.percEspecialidade}%)</small></td>
        <td>${item.formaNome}<br><small class="hint">Taxa: ${item.taxaAplicada}%</small></td>
        <td>${fmtBRL(item.valorPago)}</td>
        <td><strong>${fmtBRL(item.valorFinal)}</strong></td>
        <td>${nomeDentista(item.dentistaVendaId)}<br><span class="text-success">${fmtBRL(item.comissaoVenda)}</span></td>
        <td>${fmtBRL(item.valorExecLiquido)}</td>
        <td>${fmtBRL(item.valorLab)}</td>
        <td>${nomeDentista(item.dentistaExecId)}<br><span class="text-success">${fmtBRL(item.comissaoExec)}</span></td>
        <td><strong>${fmtBRL(item.comissaoTotal)}</strong></td>
        <td><button class="btn-danger-sm" onclick="excluirAtendimento('${item.id}')">Excluir</button></td>
      </tr>`;
    })
    .join('');

  document.getElementById('mapaTotalLiquido').textContent = fmtBRL(somaLiquida);
}

window.excluirAtendimento = (id) => {
  if (!confirm('Deseja excluir este atendimento?')) return;
  db.atendimentos = db.atendimentos.filter((a) => a.id !== id);
  salvarDB();
  enfileirarSync('DELETE_ATENDIMENTO', { id });
  renderizarTudo();
};

function renderizarSaidas() {
  const data = getDataAtiva();
  const lista = db.saidas.filter((s) => s.data === data);
  const tbody = document.querySelector('#tabelaSaidas tbody');

  let totalSaidas = 0;
  tbody.innerHTML = lista
    .map((s) => {
      totalSaidas += s.valor;
      return `
      <tr>
        <td><strong>${s.descricaoFinal}</strong></td>
        <td>${s.dentistaId ? nomeDentista(s.dentistaId) : '-'}</td>
        <td>${s.origem}</td>
        <td class="text-danger"><strong>${fmtBRL(s.valor)}</strong></td>
        <td>${s.obs || '-'}</td>
        <td><button class="btn-danger-sm" onclick="excluirSaida('${s.id}')">Excluir</button></td>
      </tr>`;
    })
    .join('');

  document.getElementById('saidasTotalDia').textContent = fmtBRL(totalSaidas);
}

window.excluirSaida = (id) => {
  if (!confirm('Deseja excluir esta saída?')) return;
  db.saidas = db.saidas.filter((s) => s.id !== id);
  salvarDB();
  enfileirarSync('DELETE_SAIDA', { id });
  renderizarTudo();
};

function renderizarDiarioCaixa() {
  const data = getDataAtiva();
  const atendDia = db.atendimentos.filter((a) => a.data === data);
  const saidasDia = db.saidas.filter((s) => s.data === data);

  let bruto = 0, liquido = 0, dinheiroEnt = 0;
  const porModalidade = {};

  atendDia.forEach((a) => {
    bruto += a.valorPago;
    liquido += a.valorFinal;
    if (a.formaId === 'dinheiro') dinheiroEnt += a.valorPago;

    if (!porModalidade[a.formaNome]) porModalidade[a.formaNome] = { bruto: 0, liquido: 0 };
    porModalidade[a.formaNome].bruto += a.valorPago;
    porModalidade[a.formaNome].liquido += a.valorFinal;
  });

  const saidasGaveta = saidasDia
    .filter((s) => s.origem === 'Gaveta')
    .reduce((acc, s) => acc + s.valor, 0);

  const totalSaidas = saidasDia
    .filter((s) => s.origem !== 'Desconto Produção')
    .reduce((acc, s) => acc + s.valor, 0);

  document.getElementById('cxBruto').textContent = fmtBRL(bruto);
  document.getElementById('cxLiquido').textContent = fmtBRL(liquido);
  document.getElementById('cxGaveta').textContent = fmtBRL(dinheiroEnt - saidasGaveta);
  document.getElementById('cxSaidas').textContent = fmtBRL(totalSaidas);

  document.getElementById('cxModalidadesBody').innerHTML = Object.entries(porModalidade)
    .map(([mod, vals]) => `<tr><td>${mod}</td><td>${fmtBRL(vals.bruto)}</td><td><strong>${fmtBRL(vals.liquido)}</strong></td></tr>`)
    .join('') || '<tr><td colspan="3">Sem movimentação nesta data.</td></tr>';

  const creditoMap = {};
  db.atendimentos
    .filter((a) => a.formaId.startsWith('credito'))
    .forEach((a) => {
      if (!creditoMap[a.formaNome]) creditoMap[a.formaNome] = { qtd: 0, total: 0 };
      creditoMap[a.formaNome].qtd += 1;
      creditoMap[a.formaNome].total += a.valorPago;
    });

  const rankingOrdenado = Object.entries(creditoMap).sort((a, b) => b[1].qtd - a[1].qtd);
  document.getElementById('cxRankingCreditoBody').innerHTML = rankingOrdenado
    .map(([nome, info]) => `<tr><td><strong>${nome}</strong></td><td>${info.qtd} vendas</td><td>${fmtBRL(info.total)}</td></tr>`)
    .join('') || '<tr><td colspan="3">Nenhuma venda no crédito registrada ainda.</td></tr>';
}

function renderizarPagamentosDentistas() {
  const data = getDataAtiva();
  const atendDia = db.atendimentos.filter((a) => a.data === data);
  const saidasDia = db.saidas.filter((s) => s.data === data);
  const tbody = document.querySelector('#tabelaPagamentos tbody');

  tbody.innerHTML = db.config.dentistas
    .map((d) => {
      const totalVendido = atendDia
        .filter((a) => a.dentistaVendaId === d.id)
        .reduce((acc, a) => acc + a.valorFinal, 0);

      const comVenda = atendDia
        .filter((a) => a.dentistaVendaId === d.id)
        .reduce((acc, a) => acc + a.comissaoVenda, 0);

      const comExec = atendDia
        .filter((a) => a.dentistaExecId === d.id)
        .reduce((acc, a) => acc + a.comissaoExec, 0);

      const producao = comVenda + comExec;

      const descontos = saidasDia
        .filter((s) => s.dentistaId === d.id)
        .reduce((acc, s) => acc + s.valor, 0);

      const totalLiquidoDentista = Math.max(0, producao - descontos);
      const chavePag = `${data}_${d.id}`;
      const valorPago = parseFloat(db.pagamentosDentistas[chavePag]) || 0;
      const saldo = Math.max(0, totalLiquidoDentista - valorPago);

      return `
      <tr>
        <td><strong>${d.nome}</strong><br><small class="hint">${d.cro}</small></td>
        <td>${fmtBRL(totalVendido)}</td>
        <td>${fmtBRL(comVenda)}</td>
        <td>${fmtBRL(comExec)}</td>
        <td><strong>${fmtBRL(producao)}</strong></td>
        <td class="text-danger">${fmtBRL(descontos)}</td>
        <td><strong>${fmtBRL(totalLiquidoDentista)}</strong></td>
        <td>
          <input type="number" step="0.01" min="0" max="${totalLiquidoDentista.toFixed(2)}"
            value="${valorPago}"
            onchange="registrarPagamentoDentista('${d.id}', this.value, ${totalLiquidoDentista})"
            style="width: 110px;" />
        </td>
        <td class="${saldo > 0 ? 'text-danger' : 'text-success'}"><strong>${fmtBRL(saldo)}</strong></td>
      </tr>`;
    })
    .join('');
}

window.registrarPagamentoDentista = (dentistaId, valorStr, maxPermitido) => {
  const data = getDataAtiva();
  let val = parseFloat(valorStr) || 0;
  if (val < 0) val = 0;
  if (val > maxPermitido) {
    alert(`O valor pago (${fmtBRL(val)}) não pode ser maior que o total a receber (${fmtBRL(maxPermitido)}) para não gerar saldo negativo.`);
    val = maxPermitido;
  }
  const chave = `${data}_${dentistaId}`;
  db.pagamentosDentistas[chave] = val;
  salvarDB();
  enfileirarSync('PAGAMENTO_DENTISTA', { data, dentistaId, valorPago: val });
  renderizarPagamentosDentistas();
};

function renderizarGeral() {
  const ano = document.getElementById('filtroAno').value;
  const mesesNomes = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez'];

  const atendAno = db.atendimentos.filter((a) => a.data.startsWith(ano));
  const saidasAno = db.saidas.filter((s) => s.data.startsWith(ano) && s.origem !== 'Desconto Produção');

  const tbodyMeses = document.querySelector('#tabelaGeralMeses tbody');
  tbodyMeses.innerHTML = mesesNomes
    .map((nomeMes, idx) => {
      const mesStr = `${ano}-${String(idx + 1).padStart(2, '0')}`;
      const aMes = atendAno.filter((a) => a.data.startsWith(mesStr));
      const sMes = saidasAno.filter((s) => s.data.startsWith(mesStr));

      const receita = aMes.reduce((acc, a) => acc + a.valorFinal, 0);
      const despesa = sMes.reduce((acc, s) => acc + s.valor, 0);
      const lucro = receita - despesa;

      const din = aMes.filter((a) => a.formaId === 'dinheiro').reduce((acc, a) => acc + a.valorFinal, 0);
      const pix = aMes.filter((a) => a.formaId === 'pix').reduce((acc, a) => acc + a.valorFinal, 0);
      const deb = aMes.filter((a) => a.formaId === 'debito').reduce((acc, a) => acc + a.valorFinal, 0);
      const cred = aMes.filter((a) => a.formaId.startsWith('credito')).reduce((acc, a) => acc + a.valorFinal, 0);

      return `
      <tr>
        <td><strong>${nomeMes}/${ano}</strong></td>
        <td>${fmtBRL(receita)}</td>
        <td class="text-danger">${fmtBRL(despesa)}</td>
        <td class="${lucro >= 0 ? 'text-success' : 'text-danger'}"><strong>${fmtBRL(lucro)}</strong></td>
        <td>${fmtBRL(din)}</td>
        <td>${fmtBRL(pix)}</td>
        <td>${fmtBRL(deb)}</td>
        <td>${fmtBRL(cred)}</td>
      </tr>`;
    })
    .join('');

  const totalDespAno = saidasAno.reduce((acc, s) => acc + s.valor, 0);
  const despPorCat = {};
  saidasAno.forEach((s) => {
    despPorCat[s.categoria] = (despPorCat[s.categoria] || 0) + s.valor;
  });

  document.getElementById('geralDespesasBody').innerHTML = Object.entries(despPorCat)
    .sort((a, b) => b[1] - a[1])
    .map(([cat, val]) => {
      const perc = totalDespAno > 0 ? ((val / totalDespAno) * 100).toFixed(1) : '0.0';
      return `<tr><td>${cat}</td><td><strong>${fmtBRL(val)}</strong></td><td>${perc}%</td></tr>`;
    })
    .join('') || '<tr><td colspan="3">Sem despesas registradas no ano.</td></tr>';

  const espMap = {};
  atendAno.forEach((a) => {
    if (!espMap[a.espNome]) espMap[a.espNome] = { qtd: 0, total: 0 };
    espMap[a.espNome].qtd += 1;
    espMap[a.espNome].total += a.valorFinal;
  });

  document.getElementById('geralEspecialidadesBody').innerHTML = Object.entries(espMap)
    .sort((a, b) => b[1].total - a[1].total)
    .map(([esp, info]) => `<tr><td><strong>${esp}</strong></td><td>${info.qtd}</td><td>${fmtBRL(info.total)}</td></tr>`)
    .join('') || '<tr><td colspan="3">Sem vendas registradas no ano.</td></tr>';
}

function renderizarConfig() {
  document.getElementById('cfgGasUrl').value = db.config.gasUrl || '';

  document.getElementById('listaDentistas').innerHTML = db.config.dentistas
    .map((d, idx) => `
      <li>
        <span><strong>${d.nome}</strong> — ${d.cro}</span>
        <button class="btn-danger-sm" onclick="removerConfigItem('dentistas', ${idx})">Remover</button>
      </li>`)
    .join('');

  document.getElementById('listaEspecialidades').innerHTML = db.config.especialidades
    .map((e, idx) => `
      <li>
        <span><strong>${e.nome}</strong></span>
        <div>
          <input type="number" class="inline-edit" step="0.5" value="${e.percentual}"
            onchange="editarPercentualEsp(${idx}, this.value)" /> %
          <button class="btn-danger-sm" onclick="removerConfigItem('especialidades', ${idx})">X</button>
        </div>
      </li>`)
    .join('');

  document.getElementById('listaTaxas').innerHTML = db.config.taxas
    .map((t, idx) => `
      <li>
        <span><strong>${t.nome}</strong></span>
        <div>
          <input type="number" class="inline-edit" step="0.1" value="${t.taxa}"
            onchange="editarTaxaMaquineta(${idx}, this.value)" /> %
        </div>
      </li>`)
    .join('');

  document.getElementById('listaSaidasCat').innerHTML = db.config.categoriasSaida
    .map((c, idx) => `
      <li>
        <span>${c}</span>
        <button class="btn-danger-sm" onclick="removerConfigItem('categoriasSaida', ${idx})">Remover</button>
      </li>`)
    .join('');
}

window.editarPercentualEsp = (idx, val) => {
  db.config.especialidades[idx].percentual = parseFloat(val) || 0;
  salvarDB();
  enfileirarSync('UPDATE_CONFIG', db.config);
  popularSelects();
};

window.editarTaxaMaquineta = (idx, val) => {
  db.config.taxas[idx].taxa = parseFloat(val) || 0;
  salvarDB();
  enfileirarSync('UPDATE_CONFIG', db.config);
  popularSelects();
};

window.removerConfigItem = (chave, idx) => {
  db.config[chave].splice(idx, 1);
  salvarDB();
  enfileirarSync('UPDATE_CONFIG', db.config);
  popularSelects();
  renderizarConfig();
};