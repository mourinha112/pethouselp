import React, { useState, useEffect, useRef, useMemo } from 'react';
import api from '../api';
import { useAviso } from './Aviso';
import { combina, textoDoProduto } from '../lib/busca';
import { prepararFoto, enviarFoto } from '../lib/foto';
import {
  Plus, Pencil, Trash2, PackagePlus, X, Upload, Search, ImageOff, Eye, EyeOff,
} from 'lucide-react';

/* Cadastro de produtos do catalogo, com foto. */

const CATEGORIAS = [
  ['racao', 'Ração'], ['sache', 'Sachê'], ['petisco', 'Petisco'],
  ['medicamento', 'Medicamento'], ['acessorio', 'Acessório'],
  ['higiene', 'Higiene'], ['outros', 'Outros'],
];
const ESPECIES = [['', 'Não filtra por espécie'], ['cao', 'Cão'], ['gato', 'Gato']];
const PORTES = [['', 'Serve todos os portes'], ['pequena', 'Raças pequenas'], ['media', 'Porte médio'], ['grande', 'Porte grande']];
const PERFIS = [['', 'Sem fase definida'], ['filhote', 'Filhote'], ['adulto', 'Adulto'], ['castrado', 'Castrado'], ['senior', 'Sênior']];

const brl = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
const money = (v) => brl.format(Number(v) || 0);

const VAZIO = {
  nome: '', marca: '', categoria: 'racao',
  especie: '', porte: '', perfil: '', foto_url: '',
  visivel_loja: true, vende_fracionado: true,
  peso_saco_kg: '', preco_saco_fechado: '', preco_por_kg: '', preco_unitario: '',
  custo_saco: '', custo_unitario: '',
  estoque_kg: '', estoque_unidade: '',
  estoque_minimo_dias: '', estoque_minimo_unidade: '',
  promo_qtd: '', promo_preco: '',
};

const ehRacao = (c) => !c || c === 'racao';

export default function Produtos() {
  const aviso = useAviso();
  const [produtos, setProdutos] = useState([]);
  const [carregando, setCarregando] = useState(true);
  const [busca, setBusca] = useState('');
  const [soSemFoto, setSoSemFoto] = useState(false);
  const [vitrine, setVitrine] = useState('todos');   // todos | dentro | fora

  const [form, setForm] = useState(VAZIO);
  const [editandoId, setEditandoId] = useState(null);
  const [aberto, setAberto] = useState(false);
  const [salvando, setSalvando] = useState(false);
  const [enviandoFoto, setEnviandoFoto] = useState(false);

  const [estoqueDe, setEstoqueDe] = useState(null);
  const [entrada, setEntrada] = useState({ kg: '', un: '', motivo: 'Reposição' });
  const [apagando, setApagando] = useState(null);

  const fotoRef = useRef(null);

  useEffect(() => { carregar(); }, []);

  async function carregar() {
    try {
      const res = await api.get('/products');
      setProdutos(Array.isArray(res.data) ? res.data : []);
    } catch (err) {
      aviso.erro('Erro ao carregar os produtos');
    } finally {
      setCarregando(false);
    }
  }

  const lista = useMemo(() => produtos.filter((p) => {
    if (soSemFoto && p.foto_url) return false;
    if (vitrine === 'dentro' && p.visivel_loja !== true) return false;
    if (vitrine === 'fora' && p.visivel_loja === true) return false;
    if (busca && !combina(textoDoProduto(p), busca)) return false;
    return true;
  }), [produtos, busca, soSemFoto, vitrine]);

  const naVitrine = useMemo(
    () => produtos.filter((p) => p.visivel_loja === true).length,
    [produtos],
  );

  /*
   * Publicar e despublicar acontece no proprio card, num clique: com 242
   * produtos, abrir o formulario de cada um para marcar uma caixinha seria
   * inviavel. A lista muda na hora e so depois espera o servidor — se der
   * erro, volta atras.
   */
  async function alternarVitrine(produto) {
    const novo = produto.visivel_loja !== true;
    setProdutos((atual) => atual.map(
      (x) => (x.id === produto.id ? { ...x, visivel_loja: novo } : x)));
    try {
      await api.put(`/products/${produto.id}`, { visivel_loja: novo });
    } catch (err) {
      setProdutos((atual) => atual.map(
        (x) => (x.id === produto.id ? { ...x, visivel_loja: !novo } : x)));
      aviso.erro('Não consegui mudar a vitrine');
    }
  }

  function mudar(e) {
    const { name, type, value, checked } = e.target;
    setForm((f) => ({ ...f, [name]: type === 'checkbox' ? checked : value }));
  }

  function abrirNovo() {
    setForm(VAZIO); setEditandoId(null); setAberto(true);
  }

  function abrirEdicao(p) {
    setForm({
      nome: p.nome || '', marca: p.marca || '', categoria: p.categoria || 'racao',
      especie: p.especie || '', porte: p.porte || '',
      perfil: p.perfil || '', foto_url: p.foto_url || '',
      visivel_loja: p.visivel_loja !== false, vende_fracionado: p.vende_fracionado !== false,
      peso_saco_kg: p.peso_saco_kg ?? '', preco_saco_fechado: p.preco_saco_fechado ?? '',
      preco_por_kg: p.preco_por_kg ?? '', preco_unitario: p.preco_unitario ?? '',
      custo_saco: p.custo_saco ?? '', custo_unitario: p.custo_unitario ?? '',
      estoque_kg: p.estoque_kg ?? '', estoque_unidade: p.estoque_unidade ?? '',
      estoque_minimo_dias: p.estoque_minimo_dias ?? '',
      estoque_minimo_unidade: p.estoque_minimo_unidade ?? '',
      promo_qtd: p.promo_qtd ?? '', promo_preco: p.promo_preco ?? '',
    });
    setEditandoId(p.id);
    setAberto(true);
  }

  async function enviarFotoDoProduto(e) {
    const arquivo = e.target.files?.[0];
    if (e.target) e.target.value = '';
    if (!arquivo) return;
    if (!arquivo.type.startsWith('image/')) { aviso.erro('Isso não é uma imagem'); return; }

    setEnviandoFoto(true);
    try {
      const { blob, transparente } = await prepararFoto(arquivo, true);
      const base = editandoId ? `produto-${editandoId}` : `novo-${Date.now()}`;
      const url = await enviarFoto(base, blob, transparente);
      setForm((f) => ({ ...f, foto_url: url }));
      aviso.sucesso('Foto pronta. Salve o produto para valer.');
    } catch (err) {
      aviso.erro(err.message || 'Não consegui enviar a foto');
    } finally {
      setEnviandoFoto(false);
    }
  }

  async function salvar(e) {
    e.preventDefault();
    if (!form.nome.trim()) { aviso.erro('Informe o nome do produto'); return; }

    const racao = ehRacao(form.categoria);
    const n = (v) => parseFloat(String(v).replace(',', '.')) || 0;

    if (racao && n(form.preco_por_kg) <= 0 && n(form.preco_saco_fechado) <= 0) {
      aviso.erro('Informe o preço por kg ou o preço do saco fechado');
      return;
    }
    if (!racao && n(form.preco_unitario) <= 0) {
      aviso.erro('Informe o preço unitário');
      return;
    }

    const dados = {
      nome: form.nome.trim(),
      marca: form.marca.trim(),
      categoria: form.categoria,
      especie: form.especie || null,
      porte: form.porte || null,
      perfil: form.perfil || null,
      foto_url: form.foto_url.trim() || null,
      visivel_loja: !!form.visivel_loja,
      vende_fracionado: racao ? !!form.vende_fracionado : false,
      peso_saco_kg: racao ? n(form.peso_saco_kg) : 0,
      preco_saco_fechado: racao ? n(form.preco_saco_fechado) : 0,
      preco_por_kg: racao ? n(form.preco_por_kg) : 0,
      preco_unitario: racao ? 0 : n(form.preco_unitario),
      // Custo e margem sao do PDV; aqui so guardamos o custo para os
      // relatorios de la nao ficarem com margem zerada. O `custo_por_kg` e
      // derivado do saco, exatamente como a tela da gestao calcula.
      custo_saco: racao ? n(form.custo_saco) : 0,
      custo_por_kg: racao && n(form.peso_saco_kg) > 0
        ? Math.round((n(form.custo_saco) / n(form.peso_saco_kg)) * 10000) / 10000
        : 0,
      custo_unitario: racao ? 0 : n(form.custo_unitario),
      estoque_minimo_dias: racao ? (n(form.estoque_minimo_dias) || 7) : 0,
      estoque_minimo_unidade: racao ? 0 : n(form.estoque_minimo_unidade),
      // Promocao "leve X por Y": so em unidade, e so com os dois campos.
      // Um deles vazio limpa a promocao inteira — o banco recusa metade.
      promo_qtd: !racao && Math.round(n(form.promo_qtd)) >= 2 && n(form.promo_preco) > 0
        ? Math.round(n(form.promo_qtd)) : null,
      promo_preco: !racao && Math.round(n(form.promo_qtd)) >= 2 && n(form.promo_preco) > 0
        ? n(form.promo_preco) : null,
    };

    // Estoque so entra no cadastro; depois muda pela entrada de estoque,
    // que deixa historico.
    if (!editandoId) {
      dados.estoque_kg = racao ? n(form.estoque_kg) : 0;
      dados.estoque_unidade = racao ? 0 : Math.round(n(form.estoque_unidade));
    }

    setSalvando(true);
    try {
      if (editandoId) await api.put(`/products/${editandoId}`, dados);
      else await api.post('/products', dados);
      aviso.sucesso(editandoId ? 'Produto atualizado' : 'Produto cadastrado');
      setAberto(false);
      carregar();
    } catch (err) {
      aviso.erro(err.response?.data?.error || 'Não consegui salvar');
    } finally {
      setSalvando(false);
    }
  }

  async function darEntrada(e) {
    e.preventDefault();
    const kg = parseFloat(String(entrada.kg).replace(',', '.')) || 0;
    const un = parseInt(entrada.un, 10) || 0;
    if (kg <= 0 && un <= 0) { aviso.erro('Informe a quantidade'); return; }
    try {
      await api.post(`/products/${estoqueDe.id}/stock-entry`,
        kg > 0
          ? { quantidade_kg: kg, motivo: entrada.motivo }
          : { quantidade_unidade: un, motivo: entrada.motivo });
      aviso.sucesso('Estoque atualizado');
      setEstoqueDe(null);
      setEntrada({ kg: '', un: '', motivo: 'Reposição' });
      carregar();
    } catch (err) {
      aviso.erro(err.response?.data?.error || 'Não consegui atualizar');
    }
  }

  async function apagar() {
    try {
      await api.delete(`/products/${apagando.id}`);
      aviso.sucesso('Produto removido do catálogo');
      setApagando(null);
      carregar();
    } catch (err) {
      aviso.erro('Não consegui remover');
    }
  }

  const racaoNoForm = ehRacao(form.categoria);
  const semFoto = produtos.filter((p) => !p.foto_url).length;

  return (
    <div className="pn-pagina">
      <header className="pn-cabecalho">
        <h1>Produtos</h1>
        <button className="pn-btn pn-btn-primario" onClick={abrirNovo}>
          <Plus size={17} /> Novo produto
        </button>
      </header>

      <div className="pn-barra-busca">
        <div className="pn-busca">
          <Search size={17} />
          <input value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Buscar por nome ou marca…" />
        </div>
        <div className="pn-abas-vitrine">
          {[['todos', 'Todos'], ['dentro', `Na loja (${naVitrine})`], ['fora', 'Fora da loja']].map(
            ([valor, rotulo]) => (
              <button
                key={valor}
                type="button"
                className={`pn-aba ${vitrine === valor ? 'ativa' : ''}`}
                onClick={() => setVitrine(valor)}
              >
                {rotulo}
              </button>
            ))}
        </div>
        <label className="pn-marcador">
          <input type="checkbox" checked={soSemFoto} onChange={(e) => setSoSemFoto(e.target.checked)} />
          <span>Só sem foto {semFoto > 0 && `(${semFoto})`}</span>
        </label>
      </div>

      {carregando ? (
        <div className="pn-carregando">Carregando…</div>
      ) : lista.length === 0 ? (
        <div className="pn-vazio">
          {produtos.length === 0 ? 'Nenhum produto cadastrado ainda. Comece pelo botão “Novo produto”.' : 'Nada encontrado com esse filtro.'}
        </div>
      ) : (
        <div className="pn-grade">
          {lista.map((p) => (
            <article className="pn-produto" key={p.id}>
              <div className="pn-produto-foto">
                {p.foto_url ? <img src={p.foto_url} alt="" loading="lazy" /> : <ImageOff size={26} />}
                <button
                  type="button"
                  className={`pn-produto-visivel ${p.visivel_loja === true ? '' : 'oculto'}`}
                  onClick={() => alternarVitrine(p)}
                  title={p.visivel_loja === true ? 'Na loja — clique para tirar' : 'Fora da loja — clique para publicar'}
                >
                  {p.visivel_loja === true ? <Eye size={13} /> : <EyeOff size={13} />}
                </button>
              </div>

              <div className="pn-produto-corpo">
                <div className="pn-produto-marca">{p.marca || 'sem marca'}</div>
                <div className="pn-produto-nome">{p.nome}</div>
                <div className="pn-produto-preco">
                  {ehRacao(p.categoria) ? (
                    <>
                      {Number(p.preco_saco_fechado) > 0 && <span>{money(p.preco_saco_fechado)} o saco</span>}
                      {Number(p.preco_por_kg) > 0 && <span>{money(p.preco_por_kg)}/kg</span>}
                    </>
                  ) : (
                    <span>{money(p.preco_unitario)}</span>
                  )}
                </div>
                <div className={`pn-produto-estoque ${(Number(p.estoque_kg) > 0 || Number(p.estoque_unidade) > 0) ? '' : 'zerado'}`}>
                  {Number(p.estoque_kg) > 0 ? `${p.estoque_kg} kg`
                    : Number(p.estoque_unidade) > 0 ? `${p.estoque_unidade} un` : 'sem estoque'}
                </div>
              </div>

              <div className="pn-produto-acoes">
                <button className="pn-btn pn-btn-claro pn-btn-mini" onClick={() => abrirEdicao(p)} title="Editar">
                  <Pencil size={15} />
                </button>
                <button className="pn-btn pn-btn-claro pn-btn-mini" onClick={() => setEstoqueDe(p)} title="Entrada de estoque">
                  <PackagePlus size={15} />
                </button>
                <button className="pn-btn pn-btn-perigo pn-btn-mini" onClick={() => setApagando(p)} title="Remover">
                  <Trash2 size={15} />
                </button>
              </div>
            </article>
          ))}
        </div>
      )}

      {/* ---------------- cadastro / edicao ---------------- */}
      {aberto && (
        <div className="pn-modal-fundo" onClick={() => setAberto(false)}>
          <form className="pn-modal pn-modal-largo" onClick={(e) => e.stopPropagation()} onSubmit={salvar}>
            <div className="pn-modal-topo">
              <h2>{editandoId ? 'Editar produto' : 'Novo produto'}</h2>
              <button type="button" onClick={() => setAberto(false)}><X size={18} /></button>
            </div>

            <div className="pn-modal-corpo">
              <div className="pn-foto-campo">
                <div className="pn-foto-quadro">
                  {form.foto_url
                    ? <img src={form.foto_url} alt="" onError={(e) => { e.currentTarget.style.opacity = 0.2; }} />
                    : <ImageOff size={26} />}
                </div>
                <div className="pn-foto-lado">
                  <div className="pn-foto-botoes">
                    <button type="button" className="pn-btn pn-btn-claro" disabled={enviandoFoto}
                      onClick={() => fotoRef.current?.click()}>
                      <Upload size={15} /> {enviandoFoto ? 'Enviando…' : 'Enviar foto'}
                    </button>
                    {form.foto_url && (
                      <button type="button" className="pn-btn pn-btn-perigo pn-btn-mini"
                        onClick={() => setForm((f) => ({ ...f, foto_url: '' }))}>
                        <Trash2 size={15} />
                      </button>
                    )}
                  </div>
                  <input name="foto_url" value={form.foto_url} onChange={mudar} placeholder="ou cole um link https://…" />
                  <small>Encolhe, centraliza e tira o fundo sozinho quando o fundo é liso.</small>
                </div>
                <input ref={fotoRef} type="file" accept="image/*" style={{ display: 'none' }} onChange={enviarFotoDoProduto} />
              </div>

              <div className="pn-linha">
                <label className="pn-campo">
                  <span>Nome *</span>
                  <input name="nome" value={form.nome} onChange={mudar} placeholder="Ex: Fórmula Filhotes Frango" required />
                </label>
                <label className="pn-campo">
                  <span>Marca</span>
                  <input name="marca" value={form.marca} onChange={mudar} placeholder="Ex: Golden" />
                </label>
              </div>

              <div className="pn-linha">
                <label className="pn-campo">
                  <span>Categoria</span>
                  <select name="categoria" value={form.categoria} onChange={mudar}>
                    {CATEGORIAS.map(([v, r]) => <option key={v} value={v}>{r}</option>)}
                  </select>
                </label>
                <label className="pn-campo">
                  <span>{racaoNoForm ? 'Custo do saco (opcional)' : 'Custo unitário (opcional)'}</span>
                  <input
                    name={racaoNoForm ? 'custo_saco' : 'custo_unitario'}
                    value={racaoNoForm ? form.custo_saco : form.custo_unitario}
                    onChange={mudar} placeholder="0,00" inputMode="decimal"
                  />
                </label>
              </div>

              <div className="pn-divisor"><span>Preço e estoque</span></div>

              {racaoNoForm ? (
                <>
                  <div className="pn-linha">
                    <label className="pn-campo">
                      <span>Peso do saco (kg)</span>
                      <input name="peso_saco_kg" value={form.peso_saco_kg} onChange={mudar} placeholder="15" inputMode="decimal" />
                    </label>
                    <label className="pn-campo">
                      <span>Preço do saco fechado</span>
                      <input name="preco_saco_fechado" value={form.preco_saco_fechado} onChange={mudar} placeholder="229,90" inputMode="decimal" />
                    </label>
                    <label className="pn-campo">
                      <span>Preço por kg</span>
                      <input name="preco_por_kg" value={form.preco_por_kg} onChange={mudar} placeholder="17,50" inputMode="decimal" />
                    </label>
                  </div>
                  <div className="pn-linha">
                    {!editandoId && (
                      <label className="pn-campo">
                        <span>Estoque inicial (kg)</span>
                        <input name="estoque_kg" value={form.estoque_kg} onChange={mudar} placeholder="0" inputMode="decimal" />
                      </label>
                    )}
                    <label className="pn-campo">
                      <span>Avisar quando faltarem menos de (dias)</span>
                      <input name="estoque_minimo_dias" value={form.estoque_minimo_dias} onChange={mudar} placeholder="7" inputMode="numeric" />
                    </label>
                  </div>
                  <label className="pn-marcador">
                    <input type="checkbox" name="vende_fracionado" checked={!!form.vende_fracionado} onChange={mudar} />
                    <span>Pode ser vendido fracionado por kg</span>
                  </label>
                </>
              ) : (
                <div className="pn-linha">
                  <label className="pn-campo">
                    <span>Preço unitário *</span>
                    <input name="preco_unitario" value={form.preco_unitario} onChange={mudar} placeholder="18,90" inputMode="decimal" />
                  </label>
                  {!editandoId && (
                    <label className="pn-campo">
                      <span>Estoque inicial (unidades)</span>
                      <input name="estoque_unidade" value={form.estoque_unidade} onChange={mudar} placeholder="0" inputMode="numeric" />
                    </label>
                  )}
                  <label className="pn-campo">
                    <span>Avisar abaixo de (un)</span>
                    <input name="estoque_minimo_unidade" value={form.estoque_minimo_unidade} onChange={mudar} placeholder="0" inputMode="numeric" />
                  </label>
                </div>
              )}

              {!racaoNoForm && (
                <>
                  <div className="pn-divisor"><span>Promoção “leve X por Y”</span></div>
                  <div className="pn-linha">
                    <label className="pn-campo">
                      <span>Leve (unidades)</span>
                      <input name="promo_qtd" value={form.promo_qtd} onChange={mudar} placeholder="4" inputMode="numeric" />
                    </label>
                    <label className="pn-campo">
                      <span>Por (R$)</span>
                      <input name="promo_preco" value={form.promo_preco} onChange={mudar} placeholder="12,00" inputMode="decimal" />
                    </label>
                  </div>
                  <p className="pn-ajuda">
                    Quem levar múltiplos dessa quantidade paga o preço do combo; o que sobrar
                    sai no preço unitário. Deixe os dois vazios para não ter promoção.
                    {Math.round(parseFloat(String(form.promo_qtd).replace(',', '.')) || 0) >= 2
                      && (parseFloat(String(form.promo_preco).replace(',', '.')) || 0) > 0
                      && (parseFloat(String(form.preco_unitario).replace(',', '.')) || 0) > 0 && (
                        <strong style={{ display: 'block', marginTop: 4 }}>
                          {`Sai a ${money(parseFloat(String(form.promo_preco).replace(',', '.')) / Math.round(parseFloat(String(form.promo_qtd).replace(',', '.'))))} cada, em vez de ${money(parseFloat(String(form.preco_unitario).replace(',', '.')))}.`}
                        </strong>
                      )}
                  </p>
                </>
              )}

              {editandoId && (
                <p className="pn-dica">
                  O estoque não se edita aqui: use a <strong>entrada de estoque</strong> na lista,
                  que guarda o histórico do que entrou.
                </p>
              )}

              <div className="pn-divisor"><span>Como aparece no catálogo</span></div>

              <label className="pn-marcador">
                <input type="checkbox" name="visivel_loja" checked={!!form.visivel_loja} onChange={mudar} />
                <span>Aparece no catálogo para o cliente</span>
              </label>

              <div className="pn-linha">
                <label className="pn-campo">
                  <span>Espécie</span>
                  <select name="especie" value={form.especie} onChange={mudar}>
                    {ESPECIES.map(([v, r]) => <option key={v} value={v}>{r}</option>)}
                  </select>
                </label>
                <label className="pn-campo">
                  <span>Fase / condição</span>
                  <select name="perfil" value={form.perfil} onChange={mudar}>
                    {PERFIS.map(([v, r]) => <option key={v} value={v}>{r}</option>)}
                  </select>
                </label>
                {form.especie === 'cao' && (
                  <label className="pn-campo">
                    <span>Porte do cão</span>
                    <select name="porte" value={form.porte} onChange={mudar}>
                      {PORTES.map(([v, r]) => <option key={v} value={v}>{r}</option>)}
                    </select>
                  </label>
                )}
              </div>
              <p className="pn-dica">
                Esses três campos são o que faz os filtros do catálogo e os recortes do
                painel funcionarem. Vale preencher pelo menos nos produtos que mais vendem.
              </p>
            </div>

            <div className="pn-modal-acoes">
              <button type="button" className="pn-btn pn-btn-claro" onClick={() => setAberto(false)}>Cancelar</button>
              <button type="submit" className="pn-btn pn-btn-primario" disabled={salvando}>
                {salvando ? 'Salvando…' : editandoId ? 'Salvar' : 'Cadastrar'}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* ---------------- entrada de estoque ---------------- */}
      {estoqueDe && (
        <div className="pn-modal-fundo" onClick={() => setEstoqueDe(null)}>
          <form className="pn-modal" onClick={(e) => e.stopPropagation()} onSubmit={darEntrada}>
            <div className="pn-modal-topo">
              <h2>Entrada de estoque</h2>
              <button type="button" onClick={() => setEstoqueDe(null)}><X size={18} /></button>
            </div>
            <p className="pn-modal-texto">
              <strong>{estoqueDe.marca} {estoqueDe.nome}</strong><br />
              Hoje: {Number(estoqueDe.estoque_kg) > 0 ? `${estoqueDe.estoque_kg} kg` : `${estoqueDe.estoque_unidade} un`}
            </p>
            {ehRacao(estoqueDe.categoria) ? (
              <label className="pn-campo">
                <span>Quantos kg entraram?</span>
                <input value={entrada.kg} onChange={(e) => setEntrada({ ...entrada, kg: e.target.value })}
                  placeholder="Ex: 45" inputMode="decimal" autoFocus />
              </label>
            ) : (
              <label className="pn-campo">
                <span>Quantas unidades entraram?</span>
                <input value={entrada.un} onChange={(e) => setEntrada({ ...entrada, un: e.target.value })}
                  placeholder="Ex: 12" inputMode="numeric" autoFocus />
              </label>
            )}
            <label className="pn-campo">
              <span>Motivo</span>
              <input value={entrada.motivo} onChange={(e) => setEntrada({ ...entrada, motivo: e.target.value })} />
            </label>
            <div className="pn-modal-acoes">
              <button type="button" className="pn-btn pn-btn-claro" onClick={() => setEstoqueDe(null)}>Cancelar</button>
              <button type="submit" className="pn-btn pn-btn-primario">Lançar entrada</button>
            </div>
          </form>
        </div>
      )}

      {/* ---------------- remocao ---------------- */}
      {apagando && (
        <div className="pn-modal-fundo" onClick={() => setApagando(null)}>
          <div className="pn-modal" onClick={(e) => e.stopPropagation()}>
            <div className="pn-modal-topo">
              <h2>Remover do catálogo?</h2>
              <button onClick={() => setApagando(null)}><X size={18} /></button>
            </div>
            <p className="pn-modal-texto">
              <strong>{apagando.marca} {apagando.nome}</strong> some do catálogo e do cadastro.
              Os pedidos antigos que tinham esse produto continuam intactos.
            </p>
            <div className="pn-modal-acoes">
              <button className="pn-btn pn-btn-claro" onClick={() => setApagando(null)}>Voltar</button>
              <button className="pn-btn pn-btn-perigo" onClick={apagar}>Remover</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
