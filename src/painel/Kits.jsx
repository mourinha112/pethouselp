import React, { useState, useEffect, useMemo } from 'react';
import api from '../api';
import { useAviso } from './Aviso';
import { combina, textoDoProduto } from '../lib/busca';
import {
  Plus, Pencil, Trash2, X, Search, ImageOff, Eye, EyeOff, Gift,
} from 'lucide-react';

/*
 * Kits promocionais: "Ração Quatree 10 kg + 10 sachês por R$ 179,90".
 *
 * Um kit nao e um produto novo — ele aponta para produtos que ja existem.
 * Por isso aqui so se escolhe o que entra, quanto de cada um e o preco
 * fechado. Estoque, foto e nome vem do cadastro de cada componente.
 */

const brl = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
const money = (v) => brl.format(Number(v) || 0);
const num = (v) => parseFloat(String(v ?? '').replace(',', '.')) || 0;

const VAZIO = { nome: '', descricao: '', preco: '', foto_url: '', visivel_loja: true, itens: [] };

const ROTULO_TIPO = { saco: 'saco fechado', kg: 'por kg', unidade: 'unidade' };

// Quais formas de venda um produto aceita, para o seletor do componente.
function tiposDoProduto(p) {
  const racao = !p.categoria || p.categoria === 'racao';
  const tipos = [];
  if (racao && Number(p.preco_saco_fechado) > 0 && Number(p.peso_saco_kg) > 0) tipos.push('saco');
  if (racao && Number(p.preco_por_kg) > 0) tipos.push('kg');
  if (!racao && Number(p.preco_unitario) > 0) tipos.push('unidade');
  return tipos;
}

function precoDoComponente(p, tipo) {
  if (tipo === 'saco') return Number(p.preco_saco_fechado) || 0;
  if (tipo === 'kg') return Number(p.preco_por_kg) || 0;
  return Number(p.preco_unitario) || 0;
}

export default function Kits() {
  const aviso = useAviso();
  const [kits, setKits] = useState([]);
  const [produtos, setProdutos] = useState([]);
  const [carregando, setCarregando] = useState(true);

  const [form, setForm] = useState(VAZIO);
  const [editandoId, setEditandoId] = useState(null);
  const [aberto, setAberto] = useState(false);
  const [salvando, setSalvando] = useState(false);
  const [buscaProduto, setBuscaProduto] = useState('');
  const [apagando, setApagando] = useState(null);

  useEffect(() => { carregar(); }, []);

  async function carregar() {
    try {
      const [k, p] = await Promise.all([api.get('/kits'), api.get('/products')]);
      setKits(Array.isArray(k.data) ? k.data : []);
      setProdutos(Array.isArray(p.data) ? p.data : []);
    } catch (err) {
      aviso.erro('Erro ao carregar os kits');
    } finally {
      setCarregando(false);
    }
  }

  const porId = useMemo(() => Object.fromEntries(produtos.map((p) => [p.id, p])), [produtos]);

  // Sugestoes de produto para entrar no kit: so quem tem alguma forma de venda
  const sugestoes = useMemo(() => {
    if (!buscaProduto.trim()) return [];
    const jaEsta = new Set(form.itens.map((i) => i.product_id));
    return produtos
      .filter((p) => !jaEsta.has(p.id) && tiposDoProduto(p).length > 0)
      .filter((p) => combina(textoDoProduto(p), buscaProduto))
      .slice(0, 8);
  }, [produtos, buscaProduto, form.itens]);

  // Preco cheio do que esta no formulario, para mostrar a economia na hora
  const precoCheio = useMemo(() => form.itens.reduce((s, i) => {
    const p = porId[i.product_id];
    return p ? s + precoDoComponente(p, i.tipo_venda) * num(i.quantidade) : s;
  }, 0), [form.itens, porId]);

  function abrirNovo() {
    setForm(VAZIO); setEditandoId(null); setBuscaProduto(''); setAberto(true);
  }

  function abrirEdicao(k) {
    setForm({
      nome: k.nome, descricao: k.descricao || '', preco: k.preco, foto_url: k.foto_url || '',
      visivel_loja: k.visivel_loja !== false,
      itens: (k.componentes || []).map((c) => ({
        product_id: c.product_id, tipo_venda: c.tipo_venda, quantidade: c.quantidade,
      })),
    });
    setEditandoId(k.id); setBuscaProduto(''); setAberto(true);
  }

  function incluirProduto(p) {
    const tipo = tiposDoProduto(p)[0];
    setForm((f) => ({ ...f, itens: f.itens.concat([{ product_id: p.id, tipo_venda: tipo, quantidade: 1 }]) }));
    setBuscaProduto('');
  }

  function mudarItem(idx, campo, valor) {
    setForm((f) => ({
      ...f,
      itens: f.itens.map((i, k) => (k === idx ? { ...i, [campo]: valor } : i)),
    }));
  }

  function tirarItem(idx) {
    setForm((f) => ({ ...f, itens: f.itens.filter((_, k) => k !== idx) }));
  }

  async function salvar(e) {
    e.preventDefault();
    if (!form.nome.trim()) { aviso.erro('Dê um nome ao kit'); return; }
    if (num(form.preco) <= 0) { aviso.erro('Informe o preço do kit'); return; }
    if (form.itens.length === 0) { aviso.erro('Escolha pelo menos um produto'); return; }
    if (form.itens.some((i) => num(i.quantidade) <= 0)) { aviso.erro('Tem produto com quantidade zero'); return; }

    setSalvando(true);
    try {
      const dados = {
        nome: form.nome.trim(),
        descricao: form.descricao.trim() || null,
        preco: num(form.preco),
        foto_url: form.foto_url.trim() || null,
        visivel_loja: !!form.visivel_loja,
        itens: form.itens.map((i) => ({
          product_id: i.product_id, tipo_venda: i.tipo_venda, quantidade: num(i.quantidade),
        })),
      };
      if (editandoId) await api.put(`/kits/${editandoId}`, dados);
      else await api.post('/kits', dados);
      aviso.sucesso(editandoId ? 'Kit atualizado' : 'Kit criado');
      setAberto(false);
      carregar();
    } catch (err) {
      aviso.erro(err.response?.data?.error || 'Não consegui salvar o kit');
    } finally {
      setSalvando(false);
    }
  }

  async function alternarVitrine(k) {
    const novo = k.visivel_loja === false;
    setKits((atual) => atual.map((x) => (x.id === k.id ? { ...x, visivel_loja: novo } : x)));
    try {
      await api.put(`/kits/${k.id}`, { visivel_loja: novo });
    } catch (err) {
      setKits((atual) => atual.map((x) => (x.id === k.id ? { ...x, visivel_loja: !novo } : x)));
      aviso.erro('Não consegui mudar a vitrine');
    }
  }

  async function apagar() {
    try {
      await api.delete(`/kits/${apagando.id}`);
      aviso.sucesso('Kit removido');
      setApagando(null);
      carregar();
    } catch (err) {
      aviso.erro('Não consegui remover');
    }
  }

  return (
    <div className="pn-pagina">
      <header className="pn-cabecalho">
        <h1>Kits promocionais</h1>
        <button className="pn-btn pn-btn-primario" onClick={abrirNovo}>
          <Plus size={17} /> Novo kit
        </button>
      </header>

      <p className="pn-secao-nota" style={{ marginBottom: 18 }}>
        Um kit junta produtos do seu cadastro num preço só. Na loja ele aparece como
        card de promoção; no pedido, cada produto do kit baixa o próprio estoque.
      </p>

      {carregando ? (
        <div className="pn-carregando">Carregando…</div>
      ) : kits.length === 0 ? (
        <div className="pn-vazio">
          Nenhum kit ainda. Exemplo: “Ração Quatree Gourmet 10 kg + 10 sachês” por um preço fechado.
        </div>
      ) : (
        <div className="pn-grade">
          {kits.map((k) => {
            const economia = Math.max(0, k.preco_cheio - k.preco);
            const principal = k.componentes?.[0];
            return (
              <article className="pn-produto" key={k.id}>
                <div className="pn-produto-foto">
                  {k.foto_url ? <img src={k.foto_url} alt="" loading="lazy" />
                    : principal?.foto_url ? <img src={principal.foto_url} alt="" loading="lazy" />
                      : <ImageOff size={26} />}
                  <button
                    type="button"
                    className={`pn-produto-visivel ${k.visivel_loja !== false ? '' : 'oculto'}`}
                    onClick={() => alternarVitrine(k)}
                    title={k.visivel_loja !== false ? 'Na loja — clique para tirar' : 'Fora da loja — clique para publicar'}
                  >
                    {k.visivel_loja !== false ? <Eye size={13} /> : <EyeOff size={13} />}
                  </button>
                  {!k.disponivel && <span className="pn-kit-esgotado">sem estoque</span>}
                </div>

                <div className="pn-produto-corpo">
                  <div className="pn-produto-marca"><Gift size={12} /> kit</div>
                  <div className="pn-produto-nome">{k.nome}</div>
                  <div className="pn-kit-itens">
                    {(k.componentes || []).map((c) => (
                      <span key={c.product_id}>{c.quantidade}× {c.nome}</span>
                    ))}
                  </div>
                  <div className="pn-produto-preco">
                    {economia > 0 && <s>{money(k.preco_cheio)}</s>}
                    <span>{money(k.preco)}</span>
                  </div>
                  {economia > 0 && <div className="pn-kit-economia">cliente economiza {money(economia)}</div>}
                </div>

                <div className="pn-produto-acoes">
                  <button className="pn-btn pn-btn-claro pn-btn-mini" onClick={() => abrirEdicao(k)} title="Editar">
                    <Pencil size={15} />
                  </button>
                  <button className="pn-btn pn-btn-claro pn-btn-mini" onClick={() => setApagando(k)} title="Remover">
                    <Trash2 size={15} />
                  </button>
                </div>
              </article>
            );
          })}
        </div>
      )}

      {aberto && (
        <div className="pn-modal-fundo" onClick={() => setAberto(false)}>
          <form className="pn-modal pn-modal-larga" onClick={(e) => e.stopPropagation()} onSubmit={salvar}>
            <div className="pn-modal-topo">
              <h2>{editandoId ? 'Editar kit' : 'Novo kit'}</h2>
              <button type="button" onClick={() => setAberto(false)}><X size={18} /></button>
            </div>

            <label className="pn-campo">
              <span>Nome do kit *</span>
              <input value={form.nome} onChange={(e) => setForm({ ...form, nome: e.target.value })}
                placeholder="Ex: Kit Quatree Gourmet + 10 sachês" autoFocus />
            </label>

            <div className="pn-divisor"><span>O que vai no kit</span></div>

            {form.itens.length > 0 && (
              <div className="pn-kit-lista">
                {form.itens.map((i, idx) => {
                  const p = porId[i.product_id];
                  if (!p) return null;
                  const tipos = tiposDoProduto(p);
                  return (
                    <div className="pn-kit-linha" key={i.product_id}>
                      <div className="pn-kit-linha-foto">
                        {p.foto_url ? <img src={p.foto_url} alt="" /> : <ImageOff size={16} />}
                      </div>
                      <div className="pn-kit-linha-nome">
                        <strong>{p.nome}</strong>
                        <span>{p.marca || 'sem marca'} · {money(precoDoComponente(p, i.tipo_venda))} {ROTULO_TIPO[i.tipo_venda]}</span>
                      </div>
                      <input
                        className="pn-kit-qtd" value={i.quantidade} inputMode="decimal"
                        onChange={(e) => mudarItem(idx, 'quantidade', e.target.value)} aria-label="Quantidade"
                      />
                      {tipos.length > 1 ? (
                        <select value={i.tipo_venda} onChange={(e) => mudarItem(idx, 'tipo_venda', e.target.value)} className="pn-kit-tipo">
                          {tipos.map((t) => <option key={t} value={t}>{ROTULO_TIPO[t]}</option>)}
                        </select>
                      ) : (
                        <span className="pn-kit-tipo-fixo">{ROTULO_TIPO[i.tipo_venda]}</span>
                      )}
                      <button type="button" className="pn-btn pn-btn-claro pn-btn-mini" onClick={() => tirarItem(idx)} aria-label="Tirar do kit">
                        <X size={14} />
                      </button>
                    </div>
                  );
                })}
              </div>
            )}

            <div className="pn-busca pn-kit-busca">
              <Search size={17} />
              <input value={buscaProduto} onChange={(e) => setBuscaProduto(e.target.value)}
                placeholder="Buscar produto para adicionar…" />
            </div>
            {sugestoes.length > 0 && (
              <div className="pn-kit-sugestoes">
                {sugestoes.map((p) => (
                  <button type="button" key={p.id} onClick={() => incluirProduto(p)}>
                    <strong>{p.nome}</strong>
                    <span>{p.marca || 'sem marca'} · {tiposDoProduto(p).map((t) => `${money(precoDoComponente(p, t))} ${ROTULO_TIPO[t]}`).join(' · ')}</span>
                  </button>
                ))}
              </div>
            )}

            <div className="pn-divisor"><span>Preço</span></div>

            <div className="pn-linha">
              <label className="pn-campo">
                <span>Preço do kit *</span>
                <input value={form.preco} onChange={(e) => setForm({ ...form, preco: e.target.value })}
                  placeholder="179,90" inputMode="decimal" />
              </label>
              <div className="pn-campo">
                <span>Somando tudo separado</span>
                <div className="pn-kit-cheio">{money(precoCheio)}</div>
              </div>
            </div>
            {precoCheio > 0 && num(form.preco) > 0 && (
              <p className="pn-ajuda">
                {num(form.preco) < precoCheio
                  ? <strong>O cliente economiza {money(precoCheio - num(form.preco))} levando o kit.</strong>
                  : <strong style={{ color: '#C4392F' }}>Atenção: o kit está saindo mais caro que os produtos separados.</strong>}
              </p>
            )}

            <div className="pn-divisor"><span>Opcional</span></div>

            <label className="pn-campo">
              <span>Foto do kit (link)</span>
              <input value={form.foto_url} onChange={(e) => setForm({ ...form, foto_url: e.target.value })}
                placeholder="Se vazio, a loja monta com as fotos dos produtos" />
            </label>
            <label className="pn-campo">
              <span>Descrição</span>
              <input value={form.descricao} onChange={(e) => setForm({ ...form, descricao: e.target.value })}
                placeholder="Uma linha que ajude a vender" />
            </label>
            <label className="pn-marcador">
              <input type="checkbox" checked={!!form.visivel_loja} onChange={(e) => setForm({ ...form, visivel_loja: e.target.checked })} />
              <span>Aparece na loja</span>
            </label>

            <div className="pn-modal-acoes">
              <button type="button" className="pn-btn pn-btn-claro" onClick={() => setAberto(false)}>Cancelar</button>
              <button type="submit" className="pn-btn pn-btn-primario" disabled={salvando}>
                {salvando ? 'Salvando…' : editandoId ? 'Salvar' : 'Criar kit'}
              </button>
            </div>
          </form>
        </div>
      )}

      {apagando && (
        <div className="pn-modal-fundo" onClick={() => setApagando(null)}>
          <div className="pn-modal" onClick={(e) => e.stopPropagation()}>
            <div className="pn-modal-topo">
              <h2>Remover “{apagando.nome}”?</h2>
              <button onClick={() => setApagando(null)}><X size={18} /></button>
            </div>
            <p className="pn-modal-texto">O kit some da loja. Os produtos dele continuam no cadastro.</p>
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
