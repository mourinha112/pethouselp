import React, { useState, useEffect, useMemo } from 'react';
import api from '../api';
import { combina } from '../lib/busca';
import './loja.css';

/* =====================================================================
   LOJA ONLINE - The Pet House
   App publico de pedidos. Le o catalogo do mesmo Supabase do PDV
   (precos, estoque, peso do saco) e grava o pedido em /api/shop/orders.
   ===================================================================== */

const CHAVE_CARRINHO = 'ph_loja_carrinho';
const CHAVE_CLIENTE = 'ph_loja_cliente';
const CHAVE_ULTIMO = 'ph_loja_ultimo_pedido';

const brl = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
const money = (v) => brl.format(Number(v) || 0);

const ROTULO_PERFIL = { filhote: 'Filhote', adulto: 'Adulto', castrado: 'Castrado', senior: 'Sênior' };
const ROTULO_PORTE = { pequena: 'Raças pequenas', media: 'Porte médio', grande: 'Porte grande' };

function lerJson(chave, padrao) {
  try {
    const bruto = localStorage.getItem(chave);
    return bruto ? JSON.parse(bruto) : padrao;
  } catch (_) {
    return padrao;
  }
}

function gravarJson(chave, valor) {
  try { localStorage.setItem(chave, JSON.stringify(valor)); } catch (_) {}
}

function soDigitos(txt) { return String(txt || '').replace(/\D/g, ''); }

function mascaraWhats(txt) {
  const d = soDigitos(txt).slice(0, 11);
  if (d.length <= 2) return d;
  if (d.length <= 6) return `(${d.slice(0, 2)}) ${d.slice(2)}`;
  if (d.length <= 10) return `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}`;
  return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`;
}

/** Janelas de horario que ainda dao tempo de acontecer hoje. */
function janelasDisponiveis(tipoEntrega) {
  const hora = new Date().getHours();
  const hoje = tipoEntrega === 'retirada'
    ? [{ label: 'Hoje, 9h às 12h', ate: 11 }, { label: 'Hoje, 14h às 18h', ate: 17 }]
    : [{ label: 'Hoje, 14h às 17h', ate: 16 }, { label: 'Hoje, 17h às 20h', ate: 19 }];
  const amanha = tipoEntrega === 'retirada'
    ? ['Amanhã, 9h às 12h', 'Amanhã, 14h às 18h']
    : ['Amanhã, 9h às 12h', 'Amanhã, 14h às 17h'];
  const lista = hoje.filter((j) => hora < j.ate).map((j) => j.label);
  return lista.concat(amanha).slice(0, 4);
}

function tagsDoProduto(p) {
  const partes = [];
  if (p.especie === 'cao') partes.push('Cão');
  else if (p.especie === 'gato') partes.push('Gato');
  if (p.perfil && ROTULO_PERFIL[p.perfil]) partes.push(ROTULO_PERFIL[p.perfil]);
  if (p.porte && ROTULO_PORTE[p.porte]) partes.push(ROTULO_PORTE[p.porte]);
  if (partes.length === 0) partes.push(p.categoria === 'racao' ? 'Ração' : 'Produto');
  return partes.join(' · ');
}

function precoInicial(p) {
  const valores = [];
  if (p.tem_saco) valores.push(p.preco_saco_fechado);
  if (p.tem_kg) valores.push(p.preco_por_kg);
  if (p.tem_unidade) valores.push(p.preco_unitario);
  return valores.length ? Math.min.apply(null, valores) : 0;
}

function temEstoque(p) {
  if (p.tem_unidade) return (p.estoque_unidade || 0) > 0;
  if (p.tem_saco && (p.estoque_kg || 0) >= (p.peso_saco_kg || 0)) return true;
  if (p.tem_kg && (p.estoque_kg || 0) >= 1) return true;
  return false;
}

/* --------------------------------------------------------------- icones */
const Ico = {
  // Os icones vem da arte de referencia do Anderson, recortados em PNG. As
  // versoes desenhadas em SVG nunca ficaram fieis — o cachorro lia como gato.
  Cao: (props) => (
    <img src="/icone-cachorro.png" width={props.s || 48} height={props.s || 48}
      alt="" aria-hidden="true" draggable="false"
      style={{ display: 'block', objectFit: 'contain' }} />
  ),
  Gato: (props) => (
    <img src="/icone-gato.png" width={props.s || 48} height={props.s || 48}
      alt="" aria-hidden="true" draggable="false"
      style={{ display: 'block', objectFit: 'contain' }} />
  ),
  Saco: ({ c1 = '#C88A22', c2 = '#9A5B00', w = 38, h = 49 }) => (
    <svg width={w} height={h} viewBox="0 0 60 76" aria-hidden="true">
      <path d="M11 4h38l-4 7H15z" fill={c2} />
      <path d="M8 11h44v58a5 5 0 0 1-5 5H13a5 5 0 0 1-5-5z" fill={c1} />
      <rect x="15" y="30" width="30" height="21" rx="5" fill="#FFF6DC" opacity="0.92" />
      <circle cx="24" cy="38" r="2.9" fill={c2} />
      <circle cx="30" cy="36" r="3.1" fill={c2} />
      <circle cx="36" cy="38" r="2.9" fill={c2} />
      <path d="M30 41c4 0 6.5 2.6 6.5 5.2 0 2.3-2.9 3.4-6.5 3.4s-6.5-1.1-6.5-3.4c0-2.6 2.5-5.2 6.5-5.2z" fill={c2} />
    </svg>
  ),
  Balde: ({ w = 30, h = 38 }) => (
    <svg width={w} height={h} viewBox="0 0 24 30" aria-hidden="true">
      <path d="M4 9h16l1.6 17.5a2 2 0 0 1-2 2.2H4.4a2 2 0 0 1-2-2.2z" fill="#C88A22" />
      <path d="M8 9V6.5a4 4 0 0 1 8 0V9" fill="none" stroke="#9A5B00" strokeWidth="2" />
      <path d="M8.5 17h7M12 13.5v7" stroke="#FFF6DC" strokeWidth="2.2" strokeLinecap="round" />
    </svg>
  ),
  Carrinho: ({ c = '#fff', s = 22 }) => (
    <svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke={c} strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M6 8h12l-1 12H7z" /><path d="M9 8V6a3 3 0 0 1 6 0v2" />
    </svg>
  ),
  Lista: ({ c = '#fff', s = 24 }) => (
    <svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke={c} strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="4" y="3" width="16" height="18" rx="3" /><path d="M8.5 8.5h7M8.5 12.5h7M8.5 16.5h4" />
    </svg>
  ),
  Casa: ({ c = '#fff', s = 24 }) => (
    <svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke={c} strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M4 11l8-6.5 8 6.5" /><path d="M6.5 10.5V20h11v-9.5" />
    </svg>
  ),
  Grade: ({ c = '#fff', s = 24 }) => (
    <svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke={c} strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="3.5" y="4" width="7" height="7" rx="2" /><rect x="13.5" y="4" width="7" height="7" rx="2" />
      <rect x="3.5" y="13.5" width="7" height="7" rx="2" /><rect x="13.5" y="13.5" width="7" height="7" rx="2" />
    </svg>
  ),
  Voltar: ({ c = '#FFF6DC', s = 21 }) => (
    <svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke={c} strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M15 5l-7 7 7 7" /></svg>
  ),
  Seta: ({ c = '#C81414', s = 20 }) => (
    <svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke={c} strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M9 5l7 7-7 7" /></svg>
  ),
  Mais: ({ c = '#FFF6DC', s = 22 }) => (
    <svg width={s} height={s} viewBox="0 0 24 24" stroke={c} strokeWidth="3.2" strokeLinecap="round" fill="none" aria-hidden="true"><path d="M6 12h12M12 6v12" /></svg>
  ),
  Menos: ({ c = '#C81414', s = 22 }) => (
    <svg width={s} height={s} viewBox="0 0 24 24" stroke={c} strokeWidth="3.2" strokeLinecap="round" fill="none" aria-hidden="true"><path d="M6 12h12" /></svg>
  ),
  Check: ({ c = '#1D7A38', s = 22 }) => (
    <svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke={c} strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M20 6.5L9.5 17 4 11.5" /></svg>
  ),
  Repetir: ({ c = '#7D0B0B', s = 24 }) => (
    <svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke={c} strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M4 12a8 8 0 1 1 2.6 5.9" /><path d="M4 19v-5h5" /></svg>
  ),
  Pino: ({ c = '#FFCF33', s = 18 }) => (
    <svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke={c} strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M12 21s7-6.3 7-11a7 7 0 1 0-14 0c0 4.7 7 11 7 11z" /><circle cx="12" cy="10" r="2.4" /></svg>
  ),
  Relogio: ({ c = '#C81414', s = 20 }) => (
    <svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke={c} strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="9" /><path d="M12 7.5V12l3 2" /></svg>
  ),
  Caminhao: ({ s = 26 }) => (
    <svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M2 7h11v9H2z" /><path d="M13 10h4.5l3.5 3.5V16h-8z" /><circle cx="6.5" cy="18" r="2" /><circle cx="17" cy="18" r="2" />
    </svg>
  ),
  Loja: ({ s = 26 }) => (
    <svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M4 10h16v10H4z" /><path d="M3 10l2-5h14l2 5" /><path d="M10 20v-5h4v5" />
    </svg>
  ),
  Zap: ({ s = 23, c = '#fff' }) => (
    <svg width={s} height={s} viewBox="0 0 24 24" fill={c} aria-hidden="true">
      <path d="M12 2a10 10 0 0 0-8.7 15L2 22l5.2-1.3A10 10 0 1 0 12 2zm5.3 14c-.2.6-1.3 1.2-1.8 1.2-.5.1-1 .1-1.7-.1a11 11 0 0 1-5.9-5.2c-.4-.7-.7-1.5-.7-2.2 0-.8.4-1.4.8-1.8.2-.2.4-.3.6-.3h.5c.2 0 .4 0 .6.4l.8 2c.1.2 0 .4-.1.5l-.4.5c-.1.2-.3.3-.1.6.5.9 1.1 1.5 2 2 .3.2.5.2.7 0l.7-.8c.2-.2.3-.2.6-.1l1.9.9c.3.1.4.2.4.4v.9z" />
    </svg>
  ),
};

function BarraProgresso({ ativa }) {
  if (!ativa) return null;
  return (
    <>
      <div className="lj-progresso"><i /></div>
      <div className="lj-pilula">
        <div className="lj-bolinhas"><i /><i /><i /></div>
      </div>
    </>
  );
}

const ROTULO_STATUS = {
  novo: { texto: 'Aguardando a loja', cor: '#8A5A00', fundo: '#FFF3C9' },
  confirmado: { texto: 'Confirmado', cor: '#14602B', fundo: '#E9F6EC' },
  separando: { texto: 'Separando', cor: '#8A5A00', fundo: '#FFF3C9' },
  pronto: { texto: 'Pronto', cor: '#14507A', fundo: '#E4F0FA' },
  entregue: { texto: 'Entregue', cor: '#6B5B53', fundo: '#F1EBE5' },
  cancelado: { texto: 'Cancelado', cor: '#9B1B1B', fundo: '#FDECEC' },
};

function dataCurta(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  return d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' })
    + ' às ' + d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
}

function Pulando({ texto }) {
  return (
    <div className="lj-pulando">
      <div className="lj-bolinhas"><i /><i /><i /></div>
      {texto && <span>{texto}</span>}
    </div>
  );
}

function Girando({ cor = 'currentColor' }) {
  return (
    <svg className="lj-girando" width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle cx="12" cy="12" r="9" stroke={cor} strokeWidth="3" opacity="0.28" />
      <path d="M21 12a9 9 0 0 0-9-9" stroke={cor} strokeWidth="3" strokeLinecap="round" />
    </svg>
  );
}

function EsqueletoProduto() {
  return (
    <div className="lj-produto lj-esqueleto">
      <div className="lj-foto lj-brilho" />
      <div style={{ flexGrow: 1 }}>
        <div className="lj-brilho" style={{ height: 11, width: '32%', borderRadius: 6 }} />
        <div className="lj-brilho" style={{ height: 15, width: '78%', borderRadius: 6, marginTop: 7 }} />
        <div className="lj-brilho" style={{ height: 11, width: '52%', borderRadius: 6, marginTop: 7 }} />
      </div>
    </div>
  );
}

function FotoProduto({ p, tamanho = 'card' }) {
  const grande = tamanho === 'grande';
  if (p.foto_url) {
    return (
      <div className="lj-foto" style={grande ? { width: 108, height: 124, borderRadius: 20 } : undefined}>
        <img src={p.foto_url} alt={p.nome} loading="lazy" />
      </div>
    );
  }
  const paletas = [
    ['#1E63B8', '#154A8C'], ['#D79A2B', '#B27A16'], ['#2E7D5B', '#1F5B42'],
    ['#6B3E9E', '#4E2B75'], ['#A33465', '#7C2549'], ['#C4571F', '#9B4216'],
  ];
  const cores = paletas[(p.id || 0) % paletas.length];
  return (
    <div className="lj-foto" style={grande ? { width: 108, height: 124, borderRadius: 20 } : undefined}>
      <Ico.Saco c1={cores[0]} c2={cores[1]} w={grande ? 64 : 38} h={grande ? 82 : 49} />
    </div>
  );
}

/* =================================================================== */

export default function Loja() {
  const [produtos, setProdutos] = useState([]);
  const [destaquesIds, setDestaquesIds] = useState([]);
  const [config, setConfig] = useState(null);
  const [carregando, setCarregando] = useState(true);
  const [falhou, setFalhou] = useState('');

  const [tela, setTela] = useState('home');
  const [especie, setEspecie] = useState('todos');
  const [porte, setPorte] = useState('todos');
  const [perfil, setPerfil] = useState('todos');
  const [busca, setBusca] = useState('');
  const [quantosMostrar, setQuantosMostrar] = useState(30);

  const [produtoId, setProdutoId] = useState(null);
  const [formato, setFormato] = useState('saco');
  const [quantia, setQuantia] = useState(1);

  const [carrinho, setCarrinho] = useState(() => lerJson(CHAVE_CARRINHO, []));
  const [ultimoPedido, setUltimoPedido] = useState(() => lerJson(CHAVE_ULTIMO, null));

  const [entrega, setEntrega] = useState('entrega');
  const [janela, setJanela] = useState('');
  const [assinar, setAssinar] = useState(false);
  const [frequencia, setFrequencia] = useState('quinzenal');

  const dadosSalvos = lerJson(CHAVE_CLIENTE, {});
  const [nome, setNome] = useState(dadosSalvos.nome || '');
  const [whats, setWhats] = useState(dadosSalvos.whatsapp ? mascaraWhats(dadosSalvos.whatsapp) : '');
  const [endereco, setEndereco] = useState(dadosSalvos.endereco || '');
  const [referencia, setReferencia] = useState(dadosSalvos.referencia || '');
  const [observacao, setObservacao] = useState('');

  const [navegando, setNavegando] = useState(false);
  const [meusPedidos, setMeusPedidos] = useState([]);
  const [carregandoMeus, setCarregandoMeus] = useState(false);
  const [whatsBusca, setWhatsBusca] = useState('');
  const [editandoEndereco, setEditandoEndereco] = useState(false);
  const [rascunhoEndereco, setRascunhoEndereco] = useState('');
  const [enviando, setEnviando] = useState(false);
  const [erroEnvio, setErroEnvio] = useState('');
  const [pedidoFeito, setPedidoFeito] = useState(null);

  useEffect(() => { carregar(); }, []);

  // A loja vive fora do layout do PDV, entao pinta o fundo da pagina.
  useEffect(() => {
    const anterior = document.body.style.background;
    document.body.style.background = '#EDE2D6';
    document.body.style.margin = '0';
    return () => { document.body.style.background = anterior; };
  }, []);
  useEffect(() => { gravarJson(CHAVE_CARRINHO, carrinho); }, [carrinho]);

  // Nome, WhatsApp e endereco ficam guardados nesse aparelho assim que sao
  // digitados - no proximo pedido ja vem tudo preenchido.
  useEffect(() => {
    if (!nome && !whats && !endereco) return;
    gravarJson(CHAVE_CLIENTE, {
      nome, whatsapp: soDigitos(whats), endereco, referencia,
    });
  }, [nome, whats, endereco, referencia]);
  useEffect(() => { window.scrollTo(0, 0); }, [tela, produtoId]);

  // Entrou em "Meus pedidos" com WhatsApp ja guardado: busca sozinho.
  useEffect(() => {
    if (tela === 'meus' && soDigitos(whats).length >= 10 && meusPedidos.length === 0 && !carregandoMeus) {
      carregarMeusPedidos(whats);
    }
  }, [tela]);

  // Barrinha no topo a cada troca de tela: sem ela a navegacao parece que
  // nao respondeu, porque tudo acontece na hora.
  useEffect(() => {
    setNavegando(true);
    const t = setTimeout(() => setNavegando(false), 420);
    return () => clearTimeout(t);
  }, [tela, produtoId]);
  useEffect(() => { setQuantosMostrar(30); }, [especie, porte, perfil, busca]);

  const janelas = useMemo(() => janelasDisponiveis(entrega), [entrega]);
  useEffect(() => { if (janelas.length && !janelas.includes(janela)) setJanela(janelas[0]); }, [janelas, janela]);

  async function carregarMeusPedidos(numero) {
    const digitos = soDigitos(numero);
    if (digitos.length < 10) { setMeusPedidos([]); return; }
    setCarregandoMeus(true);
    try {
      const res = await api.get(`/shop/orders?whatsapp=${digitos}`);
      setMeusPedidos(Array.isArray(res.data) ? res.data : []);
    } catch (err) {
      setMeusPedidos([]);
    } finally {
      setCarregandoMeus(false);
    }
  }

  function repetirPedido(pedido) {
    const itens = [];
    let faltou = 0;
    for (const it of pedido.order_items || []) {
      const prod = produtos.find((p) => p.id === it.product_id);
      if (!prod || !temEstoque(prod)) { faltou++; continue; }
      itens.push({
        key: `${prod.id}-${it.tipo_venda}`,
        product_id: prod.id,
        marca: prod.marca,
        nome: prod.nome,
        tipo_venda: it.tipo_venda,
        quantidade: Number(it.quantidade_kg) || 1,
        preco_unitario: it.tipo_venda === 'saco' ? prod.preco_saco_fechado
          : it.tipo_venda === 'kg' ? prod.preco_por_kg : prod.preco_unitario,
        peso_saco_kg: prod.peso_saco_kg,
        estoque_kg: prod.estoque_kg,
        estoque_unidade: prod.estoque_unidade,
      });
    }
    if (itens.length === 0) {
      setErroEnvio('Os produtos desse pedido estao sem estoque agora.');
      return;
    }
    setCarrinho(itens);
    setTela('carrinho');
    if (faltou > 0) setErroEnvio(`${faltou} item(ns) do pedido antigo estao sem estoque e ficaram de fora.`);
  }

  async function carregar() {
    setCarregando(true);
    setFalhou('');
    try {
      const [pRes, cRes, dRes] = await Promise.all([
        api.get('/shop/products'),
        api.get('/shop/config'),
        api.get('/shop/destaques').catch(() => ({ data: [] })),
      ]);
      setProdutos(Array.isArray(pRes.data) ? pRes.data : []);
      setConfig(cRes.data || {});
      setDestaquesIds(Array.isArray(dRes.data) ? dRes.data : []);
    } catch (err) {
      setFalhou('Não conseguimos carregar o catálogo agora. Tente de novo em instantes.');
    } finally {
      setCarregando(false);
    }
  }

  /* ------------------------------------------------------------ filtros */
  const filtrados = useMemo(() => {
    const termo = busca.trim().toLowerCase();
    return produtos.filter((p) => {
      if (especie !== 'todos' && p.especie && p.especie !== especie) return false;
      if (especie !== 'todos' && !p.especie) return false;
      if (perfil !== 'todos' && p.perfil !== perfil) return false;
      if (porte !== 'todos' && p.porte && p.porte !== porte) return false;
      if (termo && !combina(`${p.marca} ${p.nome}`, busca)) return false;
      return true;
    })
      // quem tem estoque aparece primeiro
      .sort((a, b) => (temEstoque(b) ? 1 : 0) - (temEstoque(a) ? 1 : 0));
  }, [produtos, especie, perfil, porte, busca]);

  const produto = useMemo(() => produtos.find((p) => p.id === produtoId) || null, [produtos, produtoId]);

  /* ---------------------------------------------------------- carrinho */
  const subtotal = carrinho.reduce((s, i) => s + i.preco_unitario * i.quantidade, 0);
  const freteGratisAcima = config?.frete_gratis_acima ?? 99;
  const freteValor = config?.frete_valor ?? 9.9;
  const frete = entrega === 'entrega' && subtotal < freteGratisAcima ? freteValor : 0;
  const total = subtotal + frete;
  const totalItens = carrinho.reduce((s, i) => s + 1, 0);

  function limiteDoItem(item) {
    if (item.tipo_venda === 'unidade') return Math.max(1, item.estoque_unidade || 0);
    if (item.tipo_venda === 'saco') return Math.max(1, Math.floor((item.estoque_kg || 0) / (item.peso_saco_kg || 1)));
    return Math.max(1, Math.floor(item.estoque_kg || 0));
  }

  function adicionarAoCarrinho() {
    if (!produto) return;
    const tipo = produto.tem_unidade ? 'unidade' : formato;
    const preco = tipo === 'saco' ? produto.preco_saco_fechado
      : tipo === 'kg' ? produto.preco_por_kg
        : produto.preco_unitario;

    const item = {
      key: `${produto.id}-${tipo}`,
      product_id: produto.id,
      marca: produto.marca,
      nome: produto.nome,
      tipo_venda: tipo,
      quantidade: quantia,
      preco_unitario: preco,
      peso_saco_kg: produto.peso_saco_kg,
      estoque_kg: produto.estoque_kg,
      estoque_unidade: produto.estoque_unidade,
    };

    setCarrinho((atual) => {
      const achou = atual.find((i) => i.key === item.key);
      if (!achou) return atual.concat([item]);
      const teto = limiteDoItem(achou);
      return atual.map((i) => (i.key === item.key
        ? { ...i, quantidade: Math.min(teto, i.quantidade + quantia) }
        : i));
    });
    setTela('carrinho');
  }

  function mudarQuantidade(key, delta) {
    setCarrinho((atual) => atual.flatMap((i) => {
      if (i.key !== key) return [i];
      const nova = i.quantidade + delta;
      if (nova <= 0) return [];
      return [{ ...i, quantidade: Math.min(limiteDoItem(i), nova) }];
    }));
  }

  // Um petisco/acessorio que combina com o que ja esta no carrinho.
  const sugestao = useMemo(() => {
    if (carrinho.length === 0) return null;
    const noCarrinho = carrinho.map((i) => i.product_id);
    return produtos.find((p) => p.categoria !== 'racao'
      && temEstoque(p)
      && noCarrinho.indexOf(p.id) < 0) || null;
  }, [produtos, carrinho]);

  function adicionarSugestao(p) {
    const item = {
      key: `${p.id}-unidade`,
      product_id: p.id,
      marca: p.marca,
      nome: p.nome,
      tipo_venda: 'unidade',
      quantidade: 1,
      preco_unitario: p.preco_unitario,
      peso_saco_kg: p.peso_saco_kg,
      estoque_kg: p.estoque_kg,
      estoque_unidade: p.estoque_unidade,
    };
    setCarrinho((atual) => (atual.find((i) => i.key === item.key) ? atual : atual.concat([item])));
  }

  function abrirProduto(p) {
    setProdutoId(p.id);
    const podeSaco = p.tem_saco && (p.estoque_kg || 0) >= (p.peso_saco_kg || 0);
    setFormato(podeSaco ? 'saco' : p.tem_kg ? 'kg' : 'saco');
    setQuantia(podeSaco || p.tem_unidade ? 1 : 3);
    setTela('produto');
  }

  function repetirUltimo() {
    if (!ultimoPedido?.itens?.length) return;
    setCarrinho(ultimoPedido.itens);
    setTela('carrinho');
  }

  /* ---------------------------------------------------------- checkout */
  async function enviarPedido() {
    setErroEnvio('');
    const digitos = soDigitos(whats);
    if (!nome.trim()) { setErroEnvio('Escreva seu nome.'); return; }
    if (digitos.length < 10) { setErroEnvio('Escreva um WhatsApp com DDD.'); return; }
    if (entrega === 'entrega' && !endereco.trim()) { setErroEnvio('Escreva o endereço da entrega.'); return; }

    setEnviando(true);
    try {
      const resposta = await api.post('/shop/orders', {
        cliente_nome: nome.trim(),
        cliente_whatsapp: digitos,
        tipo_entrega: entrega,
        endereco: endereco.trim(),
        referencia: referencia.trim(),
        janela,
        observacao: observacao.trim(),
        assinatura: assinar,
        frequencia,
        items: carrinho.map((i) => ({
          product_id: i.product_id,
          tipo_venda: i.tipo_venda,
          quantidade_kg: i.quantidade,
        })),
      });

      const pedido = resposta.data;
      gravarJson(CHAVE_CLIENTE, {
        nome: nome.trim(), whatsapp: digitos, endereco: endereco.trim(), referencia: referencia.trim(),
      });
      gravarJson(CHAVE_ULTIMO, { id: pedido.id, itens: carrinho, quando: new Date().toISOString() });
      setUltimoPedido({ id: pedido.id, itens: carrinho, quando: new Date().toISOString() });
      setPedidoFeito({ ...pedido, itens_local: carrinho, frete_local: frete, total_local: total });
      setCarrinho([]);
      setObservacao('');
      setTela('ok');
      carregarMeusPedidos(digitos);
    } catch (err) {
      setErroEnvio(err.response?.data?.error || 'Não conseguimos enviar o pedido. Tente de novo.');
    } finally {
      setEnviando(false);
    }
  }

  function linkWhatsApp() {
    const numero = soDigitos(config?.whatsapp_loja);
    if (!numero || !pedidoFeito) return null;
    const linhas = [
      `Olá! Fiz o pedido #${pedidoFeito.id} pelo site.`,
      '',
      ...(pedidoFeito.itens_local || []).map((i) => `• ${i.quantidade}x ${descricaoItem(i)}`),
      '',
      `${pedidoFeito.tipo_entrega === 'entrega' ? 'Entrega' : 'Retirada'}: ${pedidoFeito.janela || 'a combinar'}`,
      `Total: ${money(pedidoFeito.total)}`,
    ];
    return `https://wa.me/55${numero}?text=${encodeURIComponent(linhas.join('\n'))}`;
  }

  function descricaoItem(i) {
    const base = `${i.marca ? i.marca + ' ' : ''}${i.nome}`;
    if (i.tipo_venda === 'saco') return `${base} — saco de ${i.peso_saco_kg} kg`;
    if (i.tipo_venda === 'kg') return `${base} — fracionado`;
    return base;
  }

  /* ------------------------------------------------------------- telas */

  if (carregando) {
    return (
      <div className="lj-app">
        <BarraProgresso ativa={navegando} />
        <div className="lj-topo">
          <div className="lj-topo-linha">
            <img className="lj-topo-logo" src="/logo.png" alt="The Pet House" />
            <div style={{ flexGrow: 1 }}>
              <div className="lj-ttl lj-topo-oi">Oi! Bora abastecer o pote?</div>
              <div className="lj-topo-sub">The Pet House · Vila Maria Helena</div>
            </div>
          </div>
        </div>
        <div className="lj-conteudo lj-entra" key={tela}>
          <Pulando texto="Buscando as rações…" />
          <div className="lj-lista">
            <EsqueletoProduto /><EsqueletoProduto /><EsqueletoProduto />
          </div>
        </div>
      </div>
    );
  }

  if (falhou) {
    return (
      <div className="lj-app">
        <BarraProgresso ativa={navegando} />
        <div className="lj-conteudo" style={{ paddingTop: 60 }}>
          <div className="lj-erro">{falhou}</div>
          <button className="lj-btn lj-btn-primario lj-btn-largo" onClick={carregar}>Tentar de novo</button>
        </div>
      </div>
    );
  }

  const lojaFechada = config && config.loja_aberta === false;

  /* --------------------------------------------------------------- OK  */
  if (tela === 'ok' && pedidoFeito) {
    const zap = linkWhatsApp();
    return (
      <div className="lj-app" style={{ paddingBottom: 0 }}>
        <BarraProgresso ativa={navegando} />
        <div className="lj-ok">
          <div className="lj-ok-check"><Ico.Check c="#8A0C0C" s={48} /></div>
          <div className="lj-ttl" style={{ fontSize: 27, color: '#FFF6DC', marginTop: 18, textAlign: 'center' }}>Pedido enviado!</div>
          <div style={{ fontSize: 14.5, fontWeight: 700, color: 'rgba(255,246,220,0.88)', textAlign: 'center', marginTop: 6, maxWidth: 300 }}>
            A loja recebeu seu pedido e confirma em instantes.
          </div>

          <div className="lj-ok-cartao">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10 }}>
              <span style={{ fontSize: 12, fontWeight: 900, color: '#8A6A62', letterSpacing: 0.6 }}>PEDIDO #{pedidoFeito.id}</span>
              <span className="lj-selo">AGUARDANDO A LOJA</span>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {(pedidoFeito.itens_local || []).map((i) => (
                <div key={i.key} style={{ display: 'flex', justifyContent: 'space-between', gap: 10, fontSize: 13.5, fontWeight: 700 }}>
                  <span>{i.quantidade}x {descricaoItem(i)}</span>
                  <span>{money(i.preco_unitario * i.quantidade)}</span>
                </div>
              ))}
            </div>

            <div className="lj-divisor" />

            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <Ico.Relogio />
              <div>
                <div className="lj-ttl" style={{ fontSize: 15, lineHeight: 1.2 }}>
                  {pedidoFeito.tipo_entrega === 'entrega' ? 'Entrega' : 'Retirada'} · {pedidoFeito.janela || 'a combinar'}
                </div>
                <div style={{ fontSize: 12.5, fontWeight: 700, color: '#8A6A62' }}>
                  {pedidoFeito.tipo_entrega === 'entrega' ? pedidoFeito.endereco : config?.endereco_loja}
                </div>
              </div>
            </div>

            {pedidoFeito.assinatura && (
              <div className="lj-aviso" style={{ marginTop: 0 }}>
                <Ico.Repetir c="#8A5A00" s={20} />
                <span>Vai repetir {pedidoFeito.frequencia === 'semanal' ? 'toda semana' : pedidoFeito.frequencia === 'mensal' ? 'todo mês' : 'a cada 15 dias'}, no mesmo horário.</span>
              </div>
            )}

            <div className="lj-resumo-total">
              <span className="lj-ttl" style={{ fontSize: 16 }}>Total</span>
              <span className="valor">{money(pedidoFeito.total)}</span>
            </div>
          </div>

          {zap && (
            <a className="lj-btn lj-btn-zap lj-btn-largo" href={zap} target="_blank" rel="noopener noreferrer" style={{ marginTop: 18, textDecoration: 'none' }}>
              <Ico.Zap /> Falar no WhatsApp
            </a>
          )}

          <button
            className="lj-btn lj-btn-amarelo lj-btn-largo"
            style={{ marginTop: 12 }}
            onClick={() => { setPedidoFeito(null); setTela('home'); }}
          >
            Voltar ao início
          </button>
        </div>
      </div>
    );
  }

  /* ------------------------------------------------------------ PRODUTO */
  if (tela === 'produto' && produto) {
    const podeSaco = produto.tem_saco && (produto.estoque_kg || 0) >= (produto.peso_saco_kg || 0);
    const podeKg = produto.tem_kg && (produto.estoque_kg || 0) >= 1;
    const ehUnidade = produto.tem_unidade;

    const maxSacos = Math.max(1, Math.floor((produto.estoque_kg || 0) / (produto.peso_saco_kg || 1)));
    const maxKg = Math.max(1, Math.floor(produto.estoque_kg || 0));
    const maxUn = Math.max(1, produto.estoque_unidade || 0);
    const teto = ehUnidade ? maxUn : formato === 'saco' ? maxSacos : maxKg;

    const precoUnit = ehUnidade ? produto.preco_unitario
      : formato === 'saco' ? produto.preco_saco_fechado : produto.preco_por_kg;
    const totalItem = precoUnit * quantia;
    const semEstoque = !ehUnidade && !podeSaco && !podeKg;

    return (
      <div className="lj-app">
        <BarraProgresso ativa={navegando} />
        <div className="lj-barra">
          <button className="lj-icone-btn" onClick={() => setTela('catalogo')} aria-label="Voltar"><Ico.Voltar /></button>
          <div className="lj-ttl lj-barra-titulo">Montar o pedido</div>
        </div>

        <div className="lj-conteudo lj-entra" key={tela}>
          <div style={{ display: 'flex', gap: 14, alignItems: 'center' }}>
            <FotoProduto p={produto} tamanho="grande" />
            <div style={{ flexGrow: 1, minWidth: 0 }}>
              <div className="lj-marca">{produto.marca}</div>
              <div className="lj-ttl" style={{ fontSize: 21, lineHeight: 1.12 }}>{produto.nome}</div>
              <div style={{ display: 'inline-block', marginTop: 8, background: '#FFF3C9', borderRadius: 999, padding: '5px 11px', fontSize: 12, fontWeight: 800, color: '#8A5A00' }}>
                {tagsDoProduto(produto)}
              </div>
            </div>
          </div>

          {semEstoque ? (
            <div className="lj-fechada">Esse produto está sem estoque agora. Chame a loja no WhatsApp que a gente encomenda pra você.</div>
          ) : (
            <>
              {!ehUnidade && (
                <div>
                  <div className="lj-ttl lj-secao-titulo" style={{ fontSize: 18 }}>Como você quer levar?</div>
                  <div className="lj-formatos">
                    <button
                      className={`lj-formato ${formato === 'saco' ? 'is-on' : ''}`}
                      disabled={!podeSaco}
                      onClick={() => { setFormato('saco'); setQuantia(1); }}
                    >
                      <Ico.Saco w={30} h={38} />
                      <span>
                        <b>Saco fechado</b>
                        <small>{produto.peso_saco_kg} kg lacrado</small>
                      </span>
                    </button>
                    <button
                      className={`lj-formato ${formato === 'kg' ? 'is-on' : ''}`}
                      disabled={!podeKg}
                      onClick={() => { setFormato('kg'); setQuantia(Math.min(3, maxKg)); }}
                    >
                      <Ico.Balde />
                      <span>
                        <b>Por quilo</b>
                        <small>a gente fraciona</small>
                      </span>
                    </button>
                  </div>
                </div>
              )}

              {!ehUnidade && formato === 'saco' && (
                <button className="lj-opcao is-on" type="button">
                  <span className="lj-radio" />
                  <span style={{ flexGrow: 1, textAlign: 'left' }}>
                    <span className="lj-ttl" style={{ display: 'block', fontSize: 17, lineHeight: 1.15 }}>
                      Saco {produto.peso_saco_kg} kg
                    </span>
                    <span style={{ display: 'block', fontSize: 12, fontWeight: 700, color: '#8A6A62' }}>
                      sai a {money(produto.preco_saco_fechado / (produto.peso_saco_kg || 1))} o quilo
                    </span>
                  </span>
                  <span className="lj-ttl" style={{ fontSize: 18, color: '#7D0B0B' }}>{money(produto.preco_saco_fechado)}</span>
                </button>
              )}

              <div className="lj-caixa">
                <div style={{ fontSize: 13, fontWeight: 800, color: '#8A6A62' }}>
                  {ehUnidade ? 'Quantas unidades?' : formato === 'saco' ? 'Quantos sacos?' : 'Quantos quilos?'}
                </div>
                <div className="lj-stepper">
                  <button
                    className="lj-btn-redondo menos"
                    onClick={() => setQuantia((q) => Math.max(1, q - 1))}
                    disabled={quantia <= 1}
                    aria-label="Diminuir"
                  ><Ico.Menos /></button>

                  <div style={{ flexGrow: 1, textAlign: 'center' }}>
                    <div className="lj-ttl lj-quantia">
                      {quantia}{!ehUnidade && formato === 'kg' ? ' kg' : ''}
                    </div>
                    <div style={{ fontSize: 12.5, fontWeight: 800, color: '#8A6A62' }}>
                      {ehUnidade ? `${money(produto.preco_unitario)} cada`
                        : formato === 'saco' ? `${money(produto.preco_saco_fechado)} o saco · ${money(produto.preco_saco_fechado / (produto.peso_saco_kg || 1))} o kg`
                          : `${money(produto.preco_por_kg)} o quilo`}
                    </div>
                  </div>

                  <button
                    className="lj-btn-redondo mais"
                    onClick={() => setQuantia((q) => Math.min(teto, q + 1))}
                    disabled={quantia >= teto}
                    aria-label="Aumentar"
                  ><Ico.Mais /></button>
                </div>

                {!ehUnidade && formato === 'kg' && (
                  <div className="lj-aviso">
                    <Ico.Check c="#8A5A00" s={18} />
                    <span>Fracionado é pesado na hora, na sua frente.</span>
                  </div>
                )}
                {quantia >= teto && (
                  <div className="lj-aviso">
                    <span>É o máximo que temos em estoque agora.</span>
                  </div>
                )}
              </div>
            </>
          )}
        </div>

        <div className="lj-espaco-acao" />

        {!semEstoque && (
          <div className="lj-acao">
            <div style={{ flexShrink: 0 }}>
              <div style={{ fontSize: 11.5, fontWeight: 800, color: '#8A6A62' }}>Total</div>
              <div className="lj-ttl" style={{ fontSize: 23, color: '#7D0B0B', lineHeight: 1.05 }}>{money(totalItem)}</div>
            </div>
            <button className="lj-btn lj-btn-primario lj-btn-cresce" onClick={adicionarAoCarrinho}>
              <Ico.Carrinho c="#FFF6DC" /> Adicionar
            </button>
          </div>
        )}
      </div>
    );
  }

  /* ----------------------------------------------------------- CARRINHO */
  if (tela === 'carrinho' || tela === 'checkout') {
    const vazio = carrinho.length === 0;
    return (
      <div className="lj-app">
        <BarraProgresso ativa={navegando} />
        <div className="lj-barra">
          <button className="lj-icone-btn" onClick={() => setTela(tela === 'checkout' ? 'carrinho' : 'catalogo')} aria-label="Voltar"><Ico.Voltar /></button>
          <div className="lj-ttl lj-barra-titulo">{tela === 'checkout' ? 'Seus dados' : 'Seu pedido'}</div>
        </div>

        <div className="lj-conteudo lj-entra" key={tela}>
          {vazio && (
            <div className="lj-vazio">
              <Ico.Carrinho c="#E0C8BC" s={64} />
              <div className="lj-ttl" style={{ fontSize: 18, color: '#7D0B0B', marginTop: 12 }}>Seu carrinho está vazio</div>
              <div style={{ fontSize: 13.5, fontWeight: 700, marginTop: 4 }}>Escolha a ração do seu pet e volte aqui.</div>
              <button className="lj-btn lj-btn-primario" style={{ marginTop: 16, display: 'inline-flex' }} onClick={() => setTela('catalogo')}>
                Ver o catálogo
              </button>
            </div>
          )}

          {!vazio && tela === 'carrinho' && (
            <>
              <div className="lj-lista">
                {carrinho.map((i) => (
                  <div className="lj-item" key={i.key}>
                    <div style={{ flexGrow: 1, minWidth: 0 }}>
                      <div className="lj-ttl" style={{ fontSize: 15.5, lineHeight: 1.15 }}>{i.marca} {i.nome}</div>
                      <div style={{ fontSize: 12.5, fontWeight: 700, color: '#8A6A62', marginTop: 2 }}>
                        {i.tipo_venda === 'saco' ? `Saco fechado de ${i.peso_saco_kg} kg`
                          : i.tipo_venda === 'kg' ? 'Fracionado por quilo' : 'Unidade'}
                      </div>
                      <div className="lj-ttl lj-preco" style={{ marginTop: 4 }}>{money(i.preco_unitario * i.quantidade)}</div>
                    </div>
                    <div className="lj-qtd">
                      <button className="menos" onClick={() => mudarQuantidade(i.key, -1)} aria-label="Menos"><Ico.Menos s={16} /></button>
                      <span>{i.quantidade}{i.tipo_venda === 'kg' ? ' kg' : ''}</span>
                      <button className="mais" onClick={() => mudarQuantidade(i.key, 1)} aria-label="Mais"><Ico.Mais s={16} /></button>
                    </div>
                  </div>
                ))}
              </div>

              {sugestao && (
                <button className="lj-upsell" onClick={() => adicionarSugestao(sugestao)}>
                  <FotoProduto p={sugestao} />
                  <div style={{ flexGrow: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 11.5, fontWeight: 900, color: '#8A5A00', letterSpacing: 0.5 }}>LEVE TAMBÉM</div>
                    <div className="lj-ttl" style={{ fontSize: 15, color: '#7D0B0B', lineHeight: 1.15 }}>
                      {sugestao.marca} {sugestao.nome}
                    </div>
                    <div style={{ fontSize: 13, fontWeight: 800, color: '#7D0B0B' }}>{money(precoInicial(sugestao))}</div>
                  </div>
                  <div className="lj-upsell-mais"><Ico.Mais c="#7D0B0B" s={18} /></div>
                </button>
              )}

              <div>
                <div className="lj-ttl lj-secao-titulo" style={{ fontSize: 18 }}>Entrega ou retirada?</div>
                <div className="lj-entregas">
                  <button className={`lj-entrega ${entrega === 'entrega' ? 'is-on' : ''}`} onClick={() => setEntrega('entrega')}>
                    <Ico.Caminhao /><b>Entregar</b><small>na sua casa</small>
                  </button>
                  <button className={`lj-entrega ${entrega === 'retirada' ? 'is-on' : ''}`} onClick={() => setEntrega('retirada')}>
                    <Ico.Loja /><b>Retirar</b><small>na loja</small>
                  </button>
                </div>
              </div>

              <div className="lj-caixa">
                <div className="lj-rotulo">{entrega === 'entrega' ? 'QUANDO QUER RECEBER?' : 'QUANDO VAI BUSCAR?'}</div>
                <div className="lj-chips">
                  {janelas.map((j) => (
                    <button key={j} className={`lj-chip ${janela === j ? 'is-on' : ''}`} onClick={() => setJanela(j)}>{j}</button>
                  ))}
                </div>
                {entrega === 'retirada' && (
                  <div className="lj-aviso ok"><Ico.Pino c="#14602B" /> <span>{config?.endereco_loja}</span></div>
                )}
              </div>

              <button className={`lj-assinatura ${assinar ? 'is-on' : ''}`} onClick={() => setAssinar((v) => !v)}>
                <div style={{ flexGrow: 1 }}>
                  <div className="lj-ttl" style={{ fontSize: 15.5, color: '#7D0B0B', lineHeight: 1.15 }}>Repetir esse pedido sozinho</div>
                  <div style={{ fontSize: 12.5, fontWeight: 700, color: '#8A6A62', marginTop: 2 }}>Clube: chega sempre no mesmo dia, sem pedir de novo</div>
                </div>
                <div className={`lj-switch ${assinar ? 'is-on' : ''}`}><i /></div>
              </button>

              {assinar && (
                <div className="lj-caixa" style={{ background: '#FFF3C9', borderColor: '#FFCF33' }}>
                  <div className="lj-rotulo" style={{ color: '#8A5A00' }}>DE QUANTO EM QUANTO TEMPO?</div>
                  <div className="lj-chips">
                    {[['semanal', 'Semanal'], ['quinzenal', 'Quinzenal'], ['mensal', 'Mensal']].map(([v, l]) => (
                      <button key={v} className={`lj-chip lj-chip-grow ${frequencia === v ? 'is-on' : ''}`} onClick={() => setFrequencia(v)}>{l}</button>
                    ))}
                  </div>
                </div>
              )}

              {erroEnvio && <div className="lj-erro">{erroEnvio}</div>}

              <div className="lj-caixa lj-resumo">
                <div className="lj-resumo-linha"><span>Produtos</span><span>{money(subtotal)}</span></div>
                <div className="lj-resumo-linha">
                  <span>{entrega === 'entrega' ? 'Entrega' : 'Retirada na loja'}</span>
                  <span style={frete === 0 ? { fontWeight: 900, color: '#1D7A38' } : undefined}>{frete === 0 ? 'Grátis' : money(frete)}</span>
                </div>
                {entrega === 'entrega' && frete > 0 && (
                  <div style={{ fontSize: 12.5, fontWeight: 700, color: '#8A6A62' }}>
                    Falta {money(freteGratisAcima - subtotal)} para a entrega sair de graça.
                  </div>
                )}
                <div className="lj-divisor" />
                <div className="lj-resumo-total">
                  <span className="lj-ttl" style={{ fontSize: 17 }}>Total</span>
                  <span className="valor">{money(total)}</span>
                </div>
              </div>
            </>
          )}

          {!vazio && tela === 'checkout' && (
            <>
              {lojaFechada && (
                <div className="lj-fechada">A loja está fechada no momento. Você pode enviar o pedido e a gente confirma na abertura.</div>
              )}

              <div className="lj-campo">
                <label htmlFor="lj-nome">SEU NOME</label>
                <input id="lj-nome" value={nome} onChange={(e) => setNome(e.target.value)} placeholder="Como a gente te chama?" autoComplete="name" />
              </div>

              <div className="lj-campo">
                <label htmlFor="lj-whats">WHATSAPP</label>
                <input id="lj-whats" value={whats} onChange={(e) => setWhats(mascaraWhats(e.target.value))} placeholder="(21) 90000-0000" inputMode="numeric" autoComplete="tel" />
              </div>

              {entrega === 'entrega' ? (
                <>
                  <div className="lj-campo">
                    <label htmlFor="lj-end">ENDEREÇO DA ENTREGA</label>
                    <input id="lj-end" value={endereco} onChange={(e) => setEndereco(e.target.value)} placeholder="Rua, número, bairro" autoComplete="street-address" />
                  </div>
                  <div className="lj-campo">
                    <label htmlFor="lj-ref">PONTO DE REFERÊNCIA (opcional)</label>
                    <input id="lj-ref" value={referencia} onChange={(e) => setReferencia(e.target.value)} placeholder="Portão azul, ao lado da padaria…" />
                  </div>
                </>
              ) : (
                <div className="lj-caixa">
                  <div className="lj-rotulo">RETIRAR EM</div>
                  <div className="lj-ttl" style={{ fontSize: 15 }}>{config?.endereco_loja}</div>
                </div>
              )}

              <div className="lj-campo">
                <label htmlFor="lj-obs">OBSERVAÇÃO (opcional)</label>
                <textarea id="lj-obs" value={observacao} onChange={(e) => setObservacao(e.target.value)} placeholder="Ex.: pode entregar com o porteiro" />
              </div>

              <div className="lj-caixa lj-resumo">
                <div className="lj-resumo-linha">
                  <span>{entrega === 'entrega' ? 'Entrega' : 'Retirada'} · {janela}</span>
                </div>
                <div className="lj-resumo-linha"><span>Produtos</span><span>{money(subtotal)}</span></div>
                <div className="lj-resumo-linha">
                  <span>Frete</span>
                  <span style={frete === 0 ? { fontWeight: 900, color: '#1D7A38' } : undefined}>{frete === 0 ? 'Grátis' : money(frete)}</span>
                </div>
                <div className="lj-divisor" />
                <div className="lj-resumo-total">
                  <span className="lj-ttl" style={{ fontSize: 17 }}>Total</span>
                  <span className="valor">{money(total)}</span>
                </div>
              </div>

              {erroEnvio && <div className="lj-erro">{erroEnvio}</div>}
            </>
          )}
        </div>

        {!vazio && <div className="lj-espaco-acao com-abas" />}

        {!vazio && (
          <div className="lj-acao com-abas">
            {tela === 'carrinho' ? (
              <button className="lj-btn lj-btn-primario lj-btn-largo" onClick={() => setTela('checkout')}>
                Continuar — {money(total)}
              </button>
            ) : (
              <button className="lj-btn lj-btn-zap lj-btn-largo" onClick={enviarPedido} disabled={enviando}>
                {enviando ? <Girando cor="#fff" /> : <Ico.Zap />}
                {enviando ? 'Enviando seu pedido…' : `Enviar pedido — ${money(total)}`}
              </button>
            )}
          </div>
        )}

        <Abas tela={tela} setTela={setTela} totalItens={totalItens} aoAbrirMeus={() => carregarMeusPedidos(whats)} />
      </div>
    );
  }

  /* -------------------------------------------------------- MEUS PEDIDOS */
  if (tela === 'meus') {
    const numeroSalvo = soDigitos(whats);
    return (
      <div className="lj-app">
        <BarraProgresso ativa={navegando} />
        <div className="lj-barra">
          <div className="lj-ttl lj-barra-titulo">Meus pedidos</div>
        </div>

        <div className="lj-conteudo lj-entra" key={tela}>
          {numeroSalvo.length < 10 ? (
            <div className="lj-caixa">
              <div className="lj-ttl" style={{ fontSize: 17, color: '#7D0B0B' }}>Qual é o seu WhatsApp?</div>
              <div style={{ fontSize: 13.5, fontWeight: 700, color: '#8A6A62', margin: '4px 0 12px' }}>
                É por ele que a gente acha os seus pedidos. Não precisa de senha.
              </div>
              <div className="lj-campo">
                <input
                  value={whatsBusca}
                  onChange={(e) => setWhatsBusca(mascaraWhats(e.target.value))}
                  placeholder="(21) 90000-0000"
                  inputMode="numeric"
                />
              </div>
              <button
                className="lj-btn lj-btn-primario lj-btn-largo"
                style={{ marginTop: 12 }}
                disabled={soDigitos(whatsBusca).length < 10}
                onClick={() => { setWhats(whatsBusca); carregarMeusPedidos(whatsBusca); }}
              >
                Ver meus pedidos
              </button>
            </div>
          ) : carregandoMeus ? (
            <Pulando texto="Buscando seus pedidos…" />
          ) : meusPedidos.length === 0 ? (
            <div className="lj-vazio">
              <Ico.Lista c="#E0C8BC" s={56} />
              <div className="lj-ttl" style={{ fontSize: 18, color: '#7D0B0B', marginTop: 12 }}>Nenhum pedido ainda</div>
              <div style={{ fontSize: 13.5, fontWeight: 700, marginTop: 4 }}>
                Quando você fizer o primeiro, ele fica guardado aqui.
              </div>
              <button className="lj-btn lj-btn-primario" style={{ marginTop: 16, display: 'inline-flex' }} onClick={() => setTela('catalogo')}>
                Ver o catálogo
              </button>
            </div>
          ) : (
            <div className="lj-lista">
              {meusPedidos.map((pd) => {
                const st = ROTULO_STATUS[pd.status] || ROTULO_STATUS.novo;
                return (
                  <div className="lj-pedido" key={pd.id}>
                    <div className="lj-pedido-topo">
                      <div>
                        <div className="lj-ttl" style={{ fontSize: 16, color: '#3A1A17' }}>Pedido #{pd.id}</div>
                        <div style={{ fontSize: 12, fontWeight: 700, color: '#8A6A62' }}>{dataCurta(pd.created_at)}</div>
                      </div>
                      <span className="lj-pedido-status" style={{ color: st.cor, background: st.fundo }}>{st.texto}</span>
                    </div>

                    <div className="lj-pedido-itens">
                      {(pd.order_items || []).map((it) => (
                        <div key={it.id}>
                          <span>{it.tipo_venda === 'kg' ? `${it.quantidade_kg} kg` : `${it.quantidade_kg}x`} {it.descricao}</span>
                          <span>{money(it.subtotal)}</span>
                        </div>
                      ))}
                    </div>

                    <div className="lj-pedido-pe">
                      <span>{pd.tipo_entrega === 'entrega' ? 'Entrega' : 'Retirada'}{pd.janela ? ` · ${pd.janela}` : ''}</span>
                      <strong>{money(pd.total)}</strong>
                    </div>

                    {pd.status !== 'cancelado' && (
                      <button className="lj-btn lj-btn-vazio lj-btn-largo" onClick={() => repetirPedido(pd)}>
                        <Ico.Repetir c="#7D0B0B" s={18} /> Pedir de novo
                      </button>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>

        <Abas tela={tela} setTela={setTela} totalItens={totalItens} aoAbrirMeus={() => carregarMeusPedidos(whats)} />
      </div>
    );
  }

  /* -------------------------------------------------------------- CLUBE */
  if (tela === 'clube') {
    return (
      <div className="lj-app">
        <BarraProgresso ativa={navegando} />
        <div className="lj-topo" style={{ position: 'relative', overflow: 'hidden' }}>
          <div className="lj-topo-linha">
            <button className="lj-icone-btn" onClick={() => setTela('home')} aria-label="Voltar"><Ico.Voltar /></button>
            <div className="lj-ttl" style={{ fontSize: 18, color: '#FFF6DC' }}>Clube de assinatura</div>
          </div>
          <div className="lj-ttl" style={{ fontSize: 25, color: '#FFF6DC', lineHeight: 1.1, marginTop: 16, maxWidth: 210 }}>
            Seu pet nunca fica sem ração
          </div>
          <div style={{ fontSize: 13.5, fontWeight: 700, color: 'rgba(255,246,220,0.88)', marginTop: 6, maxWidth: 210 }}>
            Você pede uma vez e a entrega se repete no dia e horário que escolher.
          </div>
          <img src="/pet-clube.png" alt="" style={{ position: 'absolute', right: -10, bottom: -14, width: 138 }} />
        </div>

        <div className="lj-conteudo lj-entra" key={tela}>
          {[
            ['Dia e horário certos', 'semanal, quinzenal ou mensal'],
            ['Sem precisar pedir de novo', 'a gente avisa no dia anterior'],
            ['Pause quando quiser', 'adiar, trocar a ração ou cancelar'],
          ].map(([t, s]) => (
            <div key={t} style={{ display: 'flex', alignItems: 'center', gap: 13, background: '#fff', border: '2px solid #F0DED2', borderRadius: 20, padding: 13 }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', width: 46, height: 46, borderRadius: 15, background: '#FFCF33', flexShrink: 0 }}>
                <Ico.Repetir />
              </div>
              <div>
                <div className="lj-ttl" style={{ fontSize: 16, lineHeight: 1.15 }}>{t}</div>
                <div style={{ fontSize: 12.5, fontWeight: 700, color: '#8A6A62' }}>{s}</div>
              </div>
            </div>
          ))}
          <button className="lj-btn lj-btn-primario lj-btn-largo" onClick={() => { setAssinar(true); setTela('catalogo'); }}>
            Escolher minha ração
          </button>
        </div>

        <Abas tela={tela} setTela={setTela} totalItens={totalItens} aoAbrirMeus={() => carregarMeusPedidos(whats)} />
      </div>
    );
  }

  /* ----------------------------------------------------------- CATALOGO */
  if (tela === 'catalogo') {
    return (
      <div className="lj-app">
        <BarraProgresso ativa={navegando} />
        <div className="lj-barra" style={{ flexDirection: 'column', alignItems: 'stretch', gap: 12, paddingBottom: 16 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <div className="lj-ttl lj-barra-titulo">Escolher ração</div>
            <button className="lj-icone-btn" onClick={() => setTela('carrinho')} aria-label="Carrinho">
              <Ico.Carrinho />
              {totalItens > 0 && <span className="lj-badge" style={{ position: 'absolute', top: -4, right: -4, transform: 'none', background: '#FFCF33', color: '#7D0B0B' }}>{totalItens}</span>}
            </button>
          </div>
          <input
            value={busca}
            onChange={(e) => setBusca(e.target.value)}
            placeholder="Buscar marca ou ração"
            style={{ width: '100%', border: 0, borderRadius: 14, padding: '12px 13px', fontSize: 15, fontWeight: 700, background: '#FFF6DC', color: '#7D0B0B', outline: 'none' }}
          />
        </div>

        <div className="lj-conteudo lj-entra" key={tela}>
          <div className="lj-chips">
            {[['todos', 'Todos'], ['cao', 'Cão'], ['gato', 'Gato']].map(([v, l]) => (
              <button
                key={v}
                className={`lj-chip lj-chip-grow ${especie === v ? 'is-on' : ''}`}
                onClick={() => { setEspecie(v); if (v !== 'cao') setPorte('todos'); }}
              >{l}</button>
            ))}
          </div>

          {especie === 'cao' && (
            <div>
              <div className="lj-rotulo">PORTE DO CÃO</div>
              <div className="lj-chips">
                {[['todos', 'Todos'], ['pequena', 'Pequeno'], ['media', 'Médio'], ['grande', 'Grande']].map(([v, l]) => (
                  <button key={v} className={`lj-chip ${porte === v ? 'is-on' : ''}`} onClick={() => setPorte(v)}>{l}</button>
                ))}
              </div>
            </div>
          )}

          <div>
            <div className="lj-rotulo">FASE / CONDIÇÃO</div>
            <div className="lj-chips">
              {[['todos', 'Todas'], ['filhote', 'Filhote'], ['adulto', 'Adulto'], ['castrado', 'Castrado']].map(([v, l]) => (
                <button key={v} className={`lj-chip ${perfil === v ? 'is-on' : ''}`} onClick={() => setPerfil(v)}>{l}</button>
              ))}
            </div>
          </div>

          <div className="lj-divisor" />

          <div style={{ fontSize: 13.5, fontWeight: 800, color: '#8A6A62' }}>
            {filtrados.length === 0 ? 'Nada com esses filtros'
              : filtrados.length === 1 ? '1 produto encontrado'
                : `${filtrados.length} produtos encontrados`}
          </div>

          <div className="lj-lista">
            {filtrados.slice(0, quantosMostrar).map((p) => {
              const disponivel = temEstoque(p);
              return (
                <button key={p.id} className="lj-produto" onClick={() => abrirProduto(p)} disabled={!disponivel}>
                  <FotoProduto p={p} />
                  <div style={{ flexGrow: 1, minWidth: 0 }}>
                    <div className="lj-marca">{p.marca}</div>
                    <div className="lj-ttl lj-nome">{p.nome}</div>
                    <div className="lj-tags">{tagsDoProduto(p)}</div>
                    {disponivel ? (
                      <div style={{ display: 'flex', alignItems: 'baseline', gap: 6, marginTop: 5 }}>
                        <span className="lj-ttl lj-preco">{money(precoInicial(p))}</span>
                        {p.tem_kg && <span className="lj-preco-kg">ou {money(p.preco_por_kg)}/kg</span>}
                      </div>
                    ) : (
                      <span className="lj-esgotado">sem estoque</span>
                    )}
                  </div>
                  {disponivel && <Ico.Seta />}
                </button>
              );
            })}
          </div>

          {filtrados.length > quantosMostrar && (
            <button className="lj-btn lj-btn-vazio lj-btn-largo" onClick={() => setQuantosMostrar((n) => n + 30)}>
              Mostrar mais ({filtrados.length - quantosMostrar} restantes)
            </button>
          )}

          {filtrados.length === 0 && (
            <div style={{ textAlign: 'center', padding: '26px 14px', background: '#fff', border: '2px dashed #F0DED2', borderRadius: 20 }}>
              <div className="lj-ttl" style={{ fontSize: 16, color: '#7D0B0B' }}>Nada com esses filtros</div>
              <div style={{ fontSize: 13, fontWeight: 700, color: '#8A6A62', marginTop: 4 }}>
                Tire um filtro ou chame a gente no WhatsApp que encomendamos pra você.
              </div>
            </div>
          )}
        </div>

        <Abas tela={tela} setTela={setTela} totalItens={totalItens} aoAbrirMeus={() => carregarMeusPedidos(whats)} />
      </div>
    );
  }

  /* --------------------------------------------------------------- HOME */
  const emEstoque = produtos.filter(temEstoque);
  const ordenados = destaquesIds.length
    ? destaquesIds.map((id) => emEstoque.find((p) => p.id === id)).filter(Boolean)
    : [];
  const maisPedidos = ordenados
    .concat(emEstoque.filter((p) => !ordenados.includes(p)))
    .slice(0, 3);

  return (
    <div className="lj-app">
        <BarraProgresso ativa={navegando} />
      <div className="lj-topo">
        <div className="lj-topo-linha">
          <img className="lj-topo-logo" src="/logo.png" alt="The Pet House" />
          <div style={{ flexGrow: 1 }}>
            <div className="lj-ttl lj-topo-oi">Oi! Bora abastecer o pote?</div>
            <div className="lj-topo-sub">The Pet House · Vila Maria Helena</div>
          </div>
        </div>
        <div className="lj-topo-local">
          <Ico.Pino />
          <span style={{ flexGrow: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {endereco ? `Entregar em ${endereco}` : 'Entregar em Vila Maria Helena'}
          </span>
          <button onClick={() => { setRascunhoEndereco(endereco); setEditandoEndereco(true); }}>trocar</button>
        </div>
      </div>

      <div className="lj-conteudo lj-entra" key={tela}>
        {lojaFechada && (
          <div className="lj-fechada">A loja está fechada agora. Você pode montar o pedido e a gente confirma assim que abrir.</div>
        )}

        <div>
          <div className="lj-ttl lj-secao-titulo">Pra quem é a ração?</div>
          <div className="lj-secao-sub">Escolha e a gente já filtra pra você</div>
          <div className="lj-especies">
            <button className="lj-especie" onClick={() => { setEspecie('cao'); setPerfil('todos'); setPorte('todos'); setTela('catalogo'); }}>
              <Ico.Cao /><span className="lj-ttl">Cachorro</span>
            </button>
            <button className="lj-especie" onClick={() => { setEspecie('gato'); setPerfil('todos'); setPorte('todos'); setTela('catalogo'); }}>
              <Ico.Gato /><span className="lj-ttl">Gato</span>
            </button>
          </div>
        </div>

        <div>
          <div className="lj-ttl" style={{ fontSize: 14, color: '#8A6A62', letterSpacing: 0.4 }}>OU VÁ DIRETO PELO PERFIL</div>
          <div className="lj-chips" style={{ marginTop: 10 }}>
            {[
              ['Cão adulto', { especie: 'cao', perfil: 'adulto', porte: 'todos' }],
              ['Filhote', { especie: 'todos', perfil: 'filhote', porte: 'todos' }],
              ['Castrado', { especie: 'todos', perfil: 'castrado', porte: 'todos' }],
              ['Raça pequena', { especie: 'cao', perfil: 'todos', porte: 'pequena' }],
              ['Gato', { especie: 'gato', perfil: 'todos', porte: 'todos' }],
            ].map(([rotulo, filtro]) => (
              <button
                key={rotulo}
                className="lj-chip"
                onClick={() => { setEspecie(filtro.especie); setPerfil(filtro.perfil); setPorte(filtro.porte); setTela('catalogo'); }}
              >{rotulo}</button>
            ))}
          </div>
        </div>

        {ultimoPedido?.itens?.length > 0 && (
          <button className="lj-repetir" onClick={repetirUltimo}>
            <div className="lj-repetir-icone"><Ico.Repetir /></div>
            <div style={{ flexGrow: 1 }}>
              <div className="lj-ttl" style={{ fontSize: 16, color: '#7D0B0B', lineHeight: 1.15 }}>Pedir o mesmo de novo</div>
              <div style={{ fontSize: 12.5, fontWeight: 700, color: 'rgba(125,11,11,0.72)' }}>
                {descricaoItem(ultimoPedido.itens[0])}
                {ultimoPedido.itens.length > 1 ? ` + ${ultimoPedido.itens.length - 1}` : ''}
              </div>
            </div>
            <Ico.Seta c="#7D0B0B" />
          </button>
        )}

        <button
          className="lj-banner"
          onClick={() => { setEspecie('todos'); setPerfil('todos'); setPorte('todos'); setTela('catalogo'); }}
        >
          <img src="/banner-ofertas.jpg" alt="Ofertas especiais para seu pet: descontos em rações para cães e gatos" />
        </button>

        {maisPedidos.length > 0 && (
          <div>
            <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between' }}>
              <div className="lj-ttl" style={{ fontSize: 18, color: '#7D0B0B' }}>Mais pedidos da loja</div>
              <button style={{ background: 'transparent', fontSize: 13.5, fontWeight: 800, color: '#C81414', padding: 4 }} onClick={() => { setEspecie('todos'); setPerfil('todos'); setPorte('todos'); setTela('catalogo'); }}>
                ver tudo
              </button>
            </div>
            <div className="lj-lista" style={{ marginTop: 10 }}>
              {maisPedidos.map((p) => (
                <button key={p.id} className="lj-produto" onClick={() => abrirProduto(p)}>
                  <FotoProduto p={p} />
                  <div style={{ flexGrow: 1, minWidth: 0 }}>
                    <div className="lj-marca">{p.marca}</div>
                    <div className="lj-ttl lj-nome" style={{ fontSize: 15.5 }}>{p.nome}</div>
                    <div className="lj-tags">{tagsDoProduto(p)}</div>
                  </div>
                  <div style={{ textAlign: 'right', flexShrink: 0 }}>
                    <div style={{ fontSize: 11, fontWeight: 700, color: '#8A6A62' }}>a partir de</div>
                    <div className="lj-ttl" style={{ fontSize: 16, color: '#7D0B0B' }}>{money(precoInicial(p))}</div>
                  </div>
                </button>
              ))}
            </div>
          </div>
        )}

        {produtos.length === 0 && (
          <div className="lj-vazio">
            <div className="lj-ttl" style={{ fontSize: 17, color: '#7D0B0B' }}>Catálogo em montagem</div>
            <div style={{ fontSize: 13.5, fontWeight: 700, marginTop: 4 }}>
              Nenhum produto na vitrine ainda. Em /painel, na aba Produtos, clique no olho do produto para publicar.
            </div>
          </div>
        )}
      </div>

      <Abas tela={tela} setTela={setTela} totalItens={totalItens} aoAbrirMeus={() => carregarMeusPedidos(whats)} />

      {editandoEndereco && (
        <div className="lj-modal-fundo" onClick={() => setEditandoEndereco(false)}>
          <div className="lj-modal" onClick={(e) => e.stopPropagation()}>
            <div className="lj-ttl lj-secao-titulo" style={{ fontSize: 19 }}>Onde entregar?</div>
            <div className="lj-campo">
              <label htmlFor="lj-end-rapido">ENDEREÇO</label>
              <input
                id="lj-end-rapido"
                autoFocus
                value={rascunhoEndereco}
                onChange={(e) => setRascunhoEndereco(e.target.value)}
                placeholder="Rua, número, bairro"
              />
            </div>
            <div style={{ display: 'flex', gap: 10 }}>
              <button className="lj-btn lj-btn-vazio lj-btn-cresce" onClick={() => setEditandoEndereco(false)}>Voltar</button>
              <button
                className="lj-btn lj-btn-primario lj-btn-cresce"
                onClick={() => {
                  setEndereco(rascunhoEndereco.trim());
                  gravarJson(CHAVE_CLIENTE, { ...lerJson(CHAVE_CLIENTE, {}), endereco: rascunhoEndereco.trim() });
                  setEditandoEndereco(false);
                }}
              >Salvar</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */

function Abas({ tela, setTela, totalItens, aoAbrirMeus }) {
  const cor = (t) => (tela === t ? '#C81414' : '#BFA79E');
  return (
    <nav className="lj-abas">
      <button className={`lj-aba ${tela === 'home' ? 'is-on' : ''}`} onClick={() => setTela('home')}>
        <Ico.Casa c={cor('home')} /><span>Início</span>
      </button>
      <button className={`lj-aba ${tela === 'catalogo' ? 'is-on' : ''}`} onClick={() => setTela('catalogo')}>
        <Ico.Grade c={cor('catalogo')} /><span>Catálogo</span>
      </button>
      <button
        className={`lj-aba ${tela === 'meus' ? 'is-on' : ''}`}
        onClick={() => { setTela('meus'); if (aoAbrirMeus) aoAbrirMeus(); }}
      >
        <Ico.Lista c={cor('meus')} /><span>Pedidos</span>
      </button>
      <button className={`lj-aba ${tela === 'carrinho' || tela === 'checkout' ? 'is-on' : ''}`} onClick={() => setTela('carrinho')}>
        <Ico.Carrinho c={cor('carrinho')} s={24} /><span>Carrinho</span>
        {totalItens > 0 && <span className="lj-badge lj-pulsa" key={totalItens}>{totalItens}</span>}
      </button>
    </nav>
  );
}
