import { createClient } from '@supabase/supabase-js';
// A conta da promocao "leve X por Y" e a mesma que a loja usa na tela.
import { temPromocao, totalUnidades } from '../src/lib/promocao.mjs';

const supabaseUrl = process.env.SUPABASE_URL || process.env.VERCEL_SUPABASE_URL || 'https://jkbugbsnmygvrejjurvi.supabase.co';
const supabaseKey = process.env.SUPABASE_KEY || process.env.SUPABASE_ANON_KEY || process.env.VERCEL_SUPABASE_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImprYnVnYnNubXlndnJlamp1cnZpIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzE5MzA3MTQsImV4cCI6MjA4NzUwNjcxNH0.Q_Yho42qCLyMCUVwvG1bW6OzB9TI-0VRA4U2QeH5YTk';

let supabase;
try {
  supabase = createClient(supabaseUrl, supabaseKey);
} catch (e) {
  console.error('Supabase init error:', e);
  supabase = null;
}

const hashPassword = (password) => {
  // Simple hash without crypto
  let hash = 0;
  for (let i = 0; i < password.length; i++) {
    const char = password.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash;
  }
  return Math.abs(hash).toString(16);
};

function safePath(rawUrl) {
  const urlOnly = (rawUrl || '').split('?')[0].trim() || '';
  if (urlOnly.startsWith('http')) {
    try { return new URL(urlOnly).pathname; } catch (_) { return urlOnly; }
  }
  return urlOnly.startsWith('/') ? urlOnly : '/' + urlOnly;
}

const emptyDashboard = () => ({
  faturamento_dia: 0,
  vendas_dia: 0,
  ticket_medio: 0,
  faturamento_mes: 0,
  custo_dia: 0,
  custo_mes: 0,
  lucro_dia: 0,
  lucro_mes: 0,
  estoque_total_kg: 0,
  estoque_total_unidade: 0,
  valor_estoque: 0,
  total_produtos: 0,
  total_clientes: 0,
  despesas_pendentes: 0,
  meta_diaria: 500,
  meta_percent: 0,
  pagamentos: {},
  vendas_por_pagamento: [],
  ultimas_vendas: [],
  top_produtos: [],
  alertas_estoque: [],
  estoque_baixo: [],
});

export default async function handler(req, res) {
  const method = req.method || 'GET';
  const rawUrl = req.url || req.path || '';
  const url = safePath(rawUrl);

  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  
  if (method === 'OPTIONS') {
    return res.status(200).end();
  }

  const isDashboard = url === '/api/dashboard' || url.endsWith('api/dashboard');
  const isAlerts = url === '/api/dashboard/alerts' || url.endsWith('api/dashboard/alerts');

  try {
    if (!supabase && (isDashboard || isAlerts)) {
      if (isAlerts) return res.status(200).json([]);
      return res.status(200).json(emptyDashboard());
    }
    // Auth check
    if (url === '/api/auth/check' || url === '/api/auth') {
      try {
        const { data, error } = await supabase.from('users').select('id').limit(1);
        if (error) {
          console.error('Auth check error:', error);
          return res.json({ hasUsers: false, error: error.message });
        }
        return res.json({ hasUsers: data?.length > 0 });
      } catch (e) {
        return res.json({ hasUsers: false, error: e.message });
      }
    }
    
    // Auth login/register
    if (url.includes('/auth/login') || url.includes('/auth/setup')) {
      if (method !== 'POST') {
        return res.status(405).json({ error: 'Method not allowed' });
      }
      const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
      const { action, login, senha, nome } = body;
      
      if (action === 'login') {
        const { data, error } = await supabase
          .from('users')
          .select('*')
          .eq('login', login)
          .eq('senha_hash', hashPassword(senha))
          .single();

        if (error || !data) {
          return res.status(401).json({ error: 'Login ou senha incorretos' });
        }

        const token = Buffer.from(`${data.id}:${Date.now()}`).toString('base64');
        return res.json({
          token,
          user: { id: data.id, nome: data.nome, login: data.login, role: data.role }
        });
      }

      if (action === 'register') {
        const { data: existing } = await supabase
          .from('users')
          .select('id')
          .eq('login', login)
          .single();

        if (existing) {
          return res.status(400).json({ error: 'Login já existe' });
        }

        const { data: newUser, error } = await supabase
          .from('users')
          .insert([{ nome: nome || login, login, senha_hash: hashPassword(senha), role: 'admin' }])
          .select()
          .single();

        if (error) throw error;

        const token = Buffer.from(`${newUser.id}:${Date.now()}`).toString('base64');
        return res.json({
          token,
          user: { id: newUser.id, nome: newUser.nome, login: newUser.login, role: newUser.role }
        });
      }
    }

    // Dashboard
    if (url === '/api/dashboard' && method === 'GET') {
      try {
        const now = new Date();
        const todayStr = now.toISOString().split('T')[0];
        const todayStart = todayStr + 'T00:00:00.000Z';
        const todayEnd = todayStr + 'T23:59:59.999Z';
        const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().split('T')[0];

        const { data: todaySales, error: salesError } = await supabase
          .from('sales')
          .select('id, total, forma_pagamento, created_at')
          .gte('created_at', todayStart)
          .lte('created_at', todayEnd);

        if (salesError) {
          console.error('Dashboard sales error:', salesError);
        }

        const todayTotal = (todaySales || []).reduce((sum, s) => sum + (s.total || 0), 0);
        const todayCount = todaySales?.length || 0;
        const ticketMedio = todayCount > 0 ? todayTotal / todayCount : 0;

        const { data: monthSales } = await supabase
          .from('sales')
          .select('id, total')
          .gte('created_at', monthStart);
        const monthTotal = monthSales?.reduce((sum, s) => sum + (s.total || 0), 0) || 0;

        let products;
        const productsFull = await supabase
          .from('products')
          .select('id, nome, marca, categoria, estoque_kg, estoque_unidade, preco_por_kg, preco_unitario, custo_unitario, custo_por_kg, custo_saco, peso_saco_kg')
          .eq('ativo', 1);
        if (productsFull.error) {
          const productsMin = await supabase
            .from('products')
            .select('id, nome, marca, categoria, estoque_kg, estoque_unidade, preco_por_kg, preco_unitario, custo_unitario')
            .eq('ativo', 1);
          if (productsMin.error) {
            console.error('Dashboard products error:', productsFull.error);
            products = [];
          } else {
            products = productsMin.data;
          }
        } else {
          products = productsFull.data;
        }
        if (!Array.isArray(products)) products = [];

        const isRacao = (p) => !p.categoria || p.categoria === 'racao';

        async function custoDasVendas(saleIds) {
          if (!saleIds?.length) return 0;
          const { data: items, error: itemsErr } = await supabase.from('sale_items').select('product_id, quantidade_kg').in('sale_id', saleIds);
          if (itemsErr) return 0;
          let custo = 0;
          for (const item of items || []) {
            const prod = products?.find(x => x.id === item.product_id);
            if (!prod) continue;
            const qty = item.quantidade_kg || 0;
            if (!isRacao(prod)) {
              custo += qty * (prod.custo_unitario || 0);
            } else if (prod.peso_saco_kg && prod.custo_saco) {
              const numSacos = qty / (prod.peso_saco_kg || 1);
              custo += numSacos * (prod.custo_saco || 0);
            } else {
              custo += qty * (prod.custo_por_kg || 0);
            }
          }
          return custo;
        }

        const todaySaleIds = (todaySales || []).map(s => s.id).filter(Boolean);
        const monthSaleIds = (monthSales || []).map(s => s.id).filter(Boolean);
        const custoDia = await custoDasVendas(todaySaleIds);
        const custoMes = await custoDasVendas(monthSaleIds);
        const lucroDia = todayTotal - custoDia;
        const lucroMes = monthTotal - custoMes;

        const totalEstoqueKg = products?.reduce((sum, p) => sum + (isRacao(p) ? (p.estoque_kg || 0) : 0), 0) || 0;
        const totalEstoqueUn = products?.reduce((sum, p) => sum + (!isRacao(p) ? (p.estoque_unidade ?? 0) : 0), 0) || 0;
        const valorEstoque = products?.reduce((sum, p) => {
          if (isRacao(p)) return sum + ((p.estoque_kg || 0) * (p.preco_por_kg || 0));
          return sum + ((p.estoque_unidade ?? 0) * (p.preco_unitario || 0));
        }, 0) || 0;

        const mesInicio = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().split('T')[0];
        const mesFim = new Date(now.getFullYear(), now.getMonth() + 1, 0).toISOString().split('T')[0];
        let despesasPendentes = 0;
        try {
          const { data: noMes } = await supabase.from('expenses').select('id, valor, pago').gte('data_vencimento', mesInicio).lte('data_vencimento', mesFim);
          const { data: rec } = await supabase.from('expenses').select('id, valor, pago').or('recorrente.eq.1,recorrente.is.true');
          const seen = new Set((noMes || []).map(e => e.id));
          const recUniq = (rec || []).filter(e => !seen.has(e.id) && seen.add(e.id));
          const todasDoMes = [...(noMes || []), ...recUniq];
          despesasPendentes = todasDoMes.filter(e => !e.pago).reduce((s, e) => s + (Number(e.valor) || 0), 0);
        } catch (_) {}

        const { data: metaData } = await supabase.from('settings').select('value').eq('key', 'meta_diaria').maybeSingle();
        const metaDiaria = parseFloat(metaData?.value || '500');
        const metaPercent = metaDiaria > 0 ? Math.min(100, Math.round((todayTotal / metaDiaria) * 100)) : 0;

        let ultimasVendas = [];
        const uvRes = await supabase.from('sales').select('*, clients(nome)').order('created_at', { ascending: false }).limit(5);
        if (uvRes.error) {
          const uvMin = await supabase.from('sales').select('id, total, created_at, forma_pagamento').order('created_at', { ascending: false }).limit(5);
          ultimasVendas = (uvMin.data || []).map(s => ({ ...s, clients: { nome: '' } }));
        } else {
          ultimasVendas = uvRes.data || [];
        }

        const paymentsObj = {};
        const paymentsQtd = {};
        (todaySales || []).forEach(s => {
          const forma = s.forma_pagamento || 'outros';
          paymentsObj[forma] = (paymentsObj[forma] || 0) + (s.total || 0);
          paymentsQtd[forma] = (paymentsQtd[forma] || 0) + 1;
        });
        const vendasPorPagamento = Object.entries(paymentsObj).map(([forma_pagamento, total]) => ({
          forma_pagamento,
          total,
          qtd: paymentsQtd[forma_pagamento] || 0,
        }));

        const last30 = new Date();
        last30.setDate(last30.getDate() - 30);
        const since = last30.toISOString();
        const { data: sales30 } = await supabase.from('sales').select('id').gte('created_at', since);
        const saleIds = (sales30 || []).map(s => s.id);
        let topProdutos = [];
        if (saleIds.length > 0) {
          const { data: items } = await supabase.from('sale_items').select('product_id, quantidade_kg, subtotal').in('sale_id', saleIds);
          const byProduct = {};
          (items || []).forEach(item => {
            const id = item.product_id;
            if (!byProduct[id]) byProduct[id] = { product_id: id, quantidade_kg: 0, total: 0 };
            byProduct[id].quantidade_kg += item.quantidade_kg || 0;
            byProduct[id].total += item.subtotal || 0;
          });
          topProdutos = Object.values(byProduct)
            .sort((a, b) => b.total - a.total)
            .slice(0, 5)
            .map(p => {
              const prod = products?.find(x => x.id === p.product_id);
              return {
                nome: prod?.nome || 'Produto',
                marca: prod?.marca || '',
                total: p.total,
                total_kg: p.quantidade_kg || 0,
              };
            });
        }

        const isRacaoAlert = (p) => !p.categoria || p.categoria === 'racao';
        const estoqueBaixo = (products || [])
          .filter(p => isRacaoAlert(p) ? (p.estoque_kg || 0) < 10 : (p.estoque_unidade ?? 0) < (p.estoque_minimo_unidade ?? 1))
          .slice(0, 10)
          .map(p => isRacaoAlert(p)
            ? { id: p.id, nome: p.nome, marca: p.marca || '', tipo_estoque: 'kg', estoque_kg: p.estoque_kg, estoque_unidade: null, estoque_minimo_dias: p.estoque_minimo_dias || 7 }
            : { id: p.id, nome: p.nome, marca: p.marca || '', tipo_estoque: 'un', estoque_kg: null, estoque_unidade: p.estoque_unidade ?? 0, estoque_minimo_unidade: p.estoque_minimo_unidade || 0 });

        let totalClientes = 0;
        try {
          const { count } = await supabase.from('clients').select('*', { count: 'exact', head: true });
          totalClientes = count ?? 0;
        } catch (_) {}

        return res.json({
          faturamento_dia: todayTotal,
          vendas_dia: todayCount,
          ticket_medio: ticketMedio,
          faturamento_mes: monthTotal,
          custo_dia: custoDia,
          custo_mes: custoMes,
          lucro_dia: lucroDia,
          lucro_mes: lucroMes,
          estoque_total_kg: totalEstoqueKg,
          estoque_total_unidade: totalEstoqueUn,
          valor_estoque: valorEstoque,
          total_produtos: products?.length || 0,
          total_clientes: totalClientes,
          despesas_pendentes: despesasPendentes,
          meta_diaria: metaDiaria,
          meta_percent: metaPercent,
          pagamentos: paymentsObj,
          vendas_por_pagamento: vendasPorPagamento,
          ultimas_vendas: ultimasVendas,
          top_produtos: topProdutos,
          alertas_estoque: estoqueBaixo || [],
          estoque_baixo: estoqueBaixo || [],
        });
      } catch (err) {
        console.error('Dashboard error:', err);
        return res.status(200).json({
          faturamento_dia: 0,
          vendas_dia: 0,
          ticket_medio: 0,
          faturamento_mes: 0,
          custo_dia: 0,
          custo_mes: 0,
          lucro_dia: 0,
          lucro_mes: 0,
          estoque_total_kg: 0,
          estoque_total_unidade: 0,
          valor_estoque: 0,
          total_produtos: 0,
          total_clientes: 0,
          despesas_pendentes: 0,
          meta_diaria: 500,
          meta_percent: 0,
          pagamentos: {},
          vendas_por_pagamento: [],
          ultimas_vendas: [],
          top_produtos: [],
          alertas_estoque: [],
          estoque_baixo: [],
        });
      }
    }

    // Dashboard - alerts
    if (url === '/api/dashboard/alerts' && method === 'GET') {
      try {
        let products;
        const { data: dataFull, error: prodErr } = await supabase
          .from('products')
          .select('id, nome, marca, estoque_kg, estoque_minimo_dias, categoria, estoque_unidade, estoque_minimo_unidade')
          .eq('ativo', 1);

        if (prodErr) {
          const { data: dataMin, error: minErr } = await supabase
            .from('products')
            .select('id, nome, estoque_kg')
            .eq('ativo', 1);
          if (minErr) {
            console.error('Dashboard alerts products error:', prodErr);
            return res.status(200).json([]);
          }
          products = (dataMin || []).map(p => ({ ...p, marca: '', estoque_minimo_dias: 7, categoria: 'racao', estoque_unidade: 0, estoque_minimo_unidade: 0 }));
        } else {
          products = dataFull || [];
        }

        const last30Days = new Date();
        last30Days.setDate(last30Days.getDate() - 30);
        const since = last30Days.toISOString();

        const { data: salesList } = await supabase
          .from('sales')
          .select('id')
          .gte('created_at', since);

        const saleIds = (salesList || []).map(s => s.id);
        const salesByProduct = {};

        if (saleIds.length > 0) {
          const { data: items } = await supabase
            .from('sale_items')
            .select('product_id, quantidade_kg')
            .in('sale_id', saleIds);
          (items || []).forEach(item => {
            salesByProduct[item.product_id] = (salesByProduct[item.product_id] || 0) + (item.quantidade_kg || 0);
          });
        }

        const isRacao = (p) => !p.categoria || p.categoria === 'racao';
        const alerts = products.filter(p => {
          const isR = isRacao(p);
          if (isR) {
            const totalVendido30d = salesByProduct[p.id] || 0;
            const mediaDiaria = totalVendido30d / 30;
            const diasEstoque = mediaDiaria > 0 ? (p.estoque_kg || 0) / mediaDiaria : 999;
            return (p.estoque_kg || 0) > 0 && diasEstoque < (p.estoque_minimo_dias ?? 7);
          }
          return (p.estoque_unidade ?? 0) > 0 && (p.estoque_unidade ?? 0) < (p.estoque_minimo_unidade || 1);
        }).map(p => {
          const isR = isRacao(p);
          return isR
            ? { id: p.id, nome: p.nome, marca: p.marca || '', estoque_kg: p.estoque_kg, estoque_minimo_dias: p.estoque_minimo_dias ?? 7 }
            : { id: p.id, nome: p.nome, marca: p.marca || '', estoque_unidade: p.estoque_unidade ?? 0, estoque_minimo_unidade: p.estoque_minimo_unidade ?? 0 };
        });

        return res.json(alerts);
      } catch (err) {
        console.error('Dashboard alerts error:', err);
        return res.status(200).json([]);
      }
    }

    // Products - list
    if (url === '/api/products' && method === 'GET') {
      try {
        const { data, error } = await supabase
          .from('products')
          .select('*')
          .eq('ativo', 1)
          .order('nome');
        
        if (error) {
          console.error('Products list error:', error);
          return res.status(500).json({ error: 'Erro ao buscar produtos' });
        }
        return res.json(data || []);
      } catch (err) {
        console.error('Products error:', err);
        return res.status(500).json({ error: err.message });
      }
    }

    // Products - search
    if (url.includes('/products/search/') && method === 'GET') {
      const term = decodeURIComponent(url.split('/products/search/')[1] || '');

      const semAcento = (t) => String(t || '')
        .toLowerCase()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '');

      // tira o "s" do plural: procurar "filhote" acha "Filhote" e "Filhotes"
      const radical = (w) => (w.length > 3 && w.endsWith('s') ? w.slice(0, -1) : w);

      const termos = semAcento(term).split(/\s+/).filter(Boolean).map(radical);
      if (termos.length === 0) return res.json([]);

      // A primeira palavra corta no banco; as demais afinam aqui. Assim
      // "Golden Formula Filhotes" acha, mesmo com a marca num campo e o
      // resto no outro.
      const primeira = termos[0];
      const { data, error } = await supabase
        .from('products')
        .select('*')
        .eq('ativo', 1)
        .or(`nome.ilike.%${primeira}%,marca.ilike.%${primeira}%`)
        .limit(200);

      if (error) throw error;

      const achados = (data || []).filter((prod) => {
        const alvo = semAcento(`${prod.marca || ''} ${prod.nome || ''}`);
        return termos.every((t) => alvo.includes(t));
      });

      return res.json(achados.slice(0, 25));
    }

    // Products - create
    if (url === '/api/products' && method === 'POST') {
      const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
      const { data, error } = await supabase.from('products').insert([body]).select();
      if (error) throw error;
      return res.status(201).json(data[0]);
    }

    // Products - update
    if (url.includes('/products/') && method === 'PUT') {
      const id = url.split('/products/')[1];
      const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
      const { data, error } = await supabase
        .from('products')
        .update({ ...body, updated_at: new Date().toISOString() })
        .eq('id', id)
        .select();
      if (error) throw error;
      return res.json(data[0]);
    }

    // Products - delete
    if (url.includes('/products/') && method === 'DELETE') {
      const id = url.split('/products/')[1].split('/')[0];
      const { error } = await supabase
        .from('products')
        .update({ ativo: 0 })
        .eq('id', id);
      if (error) throw error;
      return res.json({ success: true });
    }

    // Products - entrada de estoque (kg ou unidade)
    if (url.match(/^\/api\/products\/\d+\/stock-entry$/) && method === 'POST') {
      try {
        const id = url.replace(/^\/api\/products\//, '').replace(/\/stock-entry$/, '');
        const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
        const { data: product, error: getErr } = await supabase.from('products').select('categoria, estoque_kg, estoque_unidade').eq('id', id).single();
        if (getErr || !product) return res.status(404).json({ error: 'Produto não encontrado' });
        const isUnit = product.categoria && product.categoria !== 'racao';
        if (isUnit && (body.quantidade_unidade != null)) {
          const qty = parseInt(body.quantidade_unidade, 10) || 0;
          if (qty <= 0) return res.status(400).json({ error: 'Quantidade inválida' });
          const newUn = (product.estoque_unidade || 0) + qty;
          await supabase.from('products').update({ estoque_unidade: newUn }).eq('id', id);
          await supabase.from('stock_movements').insert([{ product_id: id, tipo: 'entrada', quantidade_kg: qty, motivo: body.motivo || 'Entrada manual' }]);
          return res.json({ success: true, estoque_unidade: newUn });
        }
        const qtyKg = parseFloat(body.quantidade_kg) || 0;
        if (qtyKg <= 0) return res.status(400).json({ error: 'Quantidade inválida' });
        const newKg = (product.estoque_kg || 0) + qtyKg;
        await supabase.from('products').update({ estoque_kg: newKg }).eq('id', id);
        await supabase.from('stock_movements').insert([{ product_id: id, tipo: 'entrada', quantidade_kg: qtyKg, motivo: body.motivo || 'Entrada manual' }]);
        return res.json({ success: true, estoque_kg: newKg });
      } catch (err) {
        console.error('Stock entry error:', err);
        return res.status(500).json({ error: err.message });
      }
    }

    // Sales - list
    if (url === '/api/sales' && method === 'GET') {
      try {
        let query = {};
        try {
          if (rawUrl.includes('?')) {
            query = Object.fromEntries(new URLSearchParams(rawUrl.split('?')[1]));
          }
        } catch (_) {}
        const dataInicio = query.data_inicio || new Date().toISOString().split('T')[0];
        const dataFim = query.data_fim || dataInicio;
        const { data, error } = await supabase
          .from('sales')
          .select('*, clients(nome)')
          .gte('created_at', dataInicio)
          .lte('created_at', dataFim + 'T23:59:59.999Z')
          .order('created_at', { ascending: false });
        if (error) {
          console.error('Sales list error:', error);
        }
        const list = (data || []).map(s => ({ ...s, client_nome: s.clients?.nome || null }));
        return res.json(list);
      } catch (err) {
        console.error('Sales error:', err);
        return res.json([]);
      }
    }

    // Sales - detalhe por id (para relatório / reimprimir)
    if (url.match(/^\/api\/sales\/\d+$/) && method === 'GET') {
      try {
        const id = url.replace(/^\/api\/sales\//, '');
        const { data: sale, error: e1 } = await supabase.from('sales').select('*, clients(nome)').eq('id', id).single();
        if (e1 || !sale) return res.status(404).json({ error: 'Venda não encontrada' });
        const { data: items, error: e2 } = await supabase.from('sale_items').select('*, products(nome)').eq('sale_id', id);
        if (e2) throw e2;
        const itemsMap = (items || []).map(it => ({
          ...it,
          product_nome: it.products?.nome || '',
        }));
        return res.json({
          ...sale,
          client_nome: sale.clients?.nome || null,
          items: itemsMap,
        });
      } catch (err) {
        console.error('Sales detail error:', err);
        return res.status(500).json({ error: err.message });
      }
    }

    // Sales - create
    if (url === '/api/sales' && method === 'POST') {
      const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
      const { items, ...saleData } = body;

      // Garantir que total existe - calcular dos itens se não enviado
      if (!saleData.total && items && items.length > 0) {
        const subtotalItens = items.reduce((sum, it) => sum + (it.subtotal || 0), 0);
        saleData.total = subtotalItens - (saleData.desconto || 0);
      }

      const { data: newSale, error: saleError } = await supabase
        .from('sales')
        .insert([saleData])
        .select();

      if (saleError) throw saleError;
      const saleId = newSale[0].id;

      for (const item of items) {
        const { data: prod } = await supabase.from('products').select('categoria, preco_por_kg, preco_saco_fechado, peso_saco_kg, preco_unitario, estoque_kg, estoque_unidade').eq('id', item.product_id).single();
        const isUnit = prod && prod.categoria && prod.categoria !== 'racao';
        let precoUnit = item.preco_unitario;
        let subtotal = item.subtotal;
        if (precoUnit == null || subtotal == null) {
          if (isUnit) {
            precoUnit = prod.preco_unitario || 0;
            subtotal = (item.quantidade_kg || 0) * precoUnit;
          } else if (item.tipo_venda === 'saco') {
            precoUnit = prod.preco_saco_fechado || 0;
            const numSacos = Math.round((item.quantidade_kg || 0) / (prod.peso_saco_kg || 1));
            subtotal = numSacos * precoUnit;
          } else {
            precoUnit = prod.preco_por_kg || 0;
            subtotal = (item.quantidade_kg || 0) * precoUnit;
          }
        }
        await supabase.from('sale_items').insert([{
          sale_id: saleId,
          product_id: item.product_id,
          tipo_venda: item.tipo_venda,
          quantidade_kg: item.quantidade_kg,
          preco_unitario: precoUnit,
          subtotal
        }]);

        const qtyKg = item.tipo_venda === 'saco' ? item.quantidade_kg * (item.peso_saco || prod?.peso_saco_kg || 1) : item.quantidade_kg;
        if (isUnit) {
          const un = Math.round(item.quantidade_kg || 0);
          const newUn = Math.max(0, (prod.estoque_unidade || 0) - un);
          await supabase.from('products').update({ estoque_unidade: newUn }).eq('id', item.product_id);
          await supabase.from('stock_movements').insert([{ product_id: item.product_id, tipo: 'saida', quantidade_kg: -un, motivo: `Venda #${saleId}`, sale_id: saleId }]);
        } else {
          const newKg = Math.max(0, (prod.estoque_kg || 0) - qtyKg);
          await supabase.from('products').update({ estoque_kg: newKg }).eq('id', item.product_id);
          await supabase.from('stock_movements').insert([{ product_id: item.product_id, tipo: 'saida', quantidade_kg: -qtyKg, motivo: `Venda #${saleId}`, sale_id: saleId }]);
        }
      }

      return res.status(201).json(newSale[0]);
    }

    // Clients
    if (url === '/api/clients') {
      try {
        if (method === 'GET') {
          const { data, error } = await supabase.from('clients').select('*').order('nome');
          if (error) {
            console.error('Clients list error:', error);
            return res.status(500).json({ error: 'Erro ao buscar clientes' });
          }
          return res.json(data || []);
        }
        if (method === 'POST') {
          const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
          const { data, error } = await supabase.from('clients').insert([body]).select();
          if (error) {
            console.error('Clients insert error:', error);
            return res.status(500).json({ error: 'Erro ao cadastrar cliente' });
          }
          return res.status(201).json(data[0]);
        }
      } catch (err) {
        console.error('Clients error:', err);
        return res.status(500).json({ error: err.message });
      }
    }

    // Expenses - summary (por mês: total, pago, pendente, por_categoria)
    if ((url === '/api/expenses/summary' || url === '/api/expenses/summary/') && method === 'GET') {
      try {
        let qs = {};
        try { if (rawUrl.includes('?')) qs = Object.fromEntries(new URLSearchParams(rawUrl.split('?')[1])); } catch (_) {}
        const mes = qs.mes || new Date().toISOString().slice(0, 7);
        const [y, m] = mes.split('-').map(Number);
        const mesInicio = new Date(y, m - 1, 1).toISOString().split('T')[0];
        const mesFim = new Date(y, m, 0).toISOString().split('T')[0];
        let noMes = [];
        let rec = [];
        try { const { data } = await supabase.from('expenses').select('id, valor, pago, categoria').gte('data_vencimento', mesInicio).lte('data_vencimento', mesFim); noMes = data || []; } catch (_) {}
        try { const { data } = await supabase.from('expenses').select('id, valor, pago, categoria').or('recorrente.eq.1,recorrente.is.true'); rec = data || []; } catch (_) {}
        const seen = new Set(noMes.map(e => e.id));
        const recUniq = rec.filter(e => !seen.has(e.id) && seen.add(e.id));
        const items = [...noMes, ...recUniq];
        const total = items.reduce((s, e) => s + (Number(e.valor) || 0), 0);
        const pago = items.filter(e => e.pago).reduce((s, e) => s + (Number(e.valor) || 0), 0);
        const pendente = total - pago;
        const porCat = {};
        items.forEach(e => { const c = e.categoria || 'outros'; porCat[c] = (porCat[c] || 0) + (Number(e.valor) || 0); });
        const por_categoria = Object.entries(porCat).map(([categoria, total]) => ({ categoria, total }));
        return res.json({ total, pago, pendente, por_categoria });
      } catch (err) {
        console.error('Expenses summary error:', err);
        return res.json({ total: 0, pago: 0, pendente: 0, por_categoria: [] });
      }
    }

    // Expenses - lista (filtro por mês: despesas do mês + recorrentes)
    if (url === '/api/expenses' || url === '/api/expenses/') {
      if (method === 'GET') {
        try {
          let qs = {};
          try { if (rawUrl.includes('?')) qs = Object.fromEntries(new URLSearchParams(rawUrl.split('?')[1])); } catch (_) {}
          const mes = qs.mes || new Date().toISOString().slice(0, 7);
          const [y, m] = mes.split('-').map(Number);
          const mesInicio = new Date(y, m - 1, 1).toISOString().split('T')[0];
          const mesFim = new Date(y, m, 0).toISOString().split('T')[0];
          let noMes = [];
          let rec = [];
          try { const { data } = await supabase.from('expenses').select('*').gte('data_vencimento', mesInicio).lte('data_vencimento', mesFim).order('data_vencimento', { ascending: true }); noMes = data || []; } catch (_) {}
          try { const { data } = await supabase.from('expenses').select('*').or('recorrente.eq.1,recorrente.is.true').order('data_vencimento', { ascending: true }); rec = data || []; } catch (_) {}
          const seen = new Set(noMes.map(e => e.id));
          const noMesDesc = new Set(noMes.map(e => `${e.descricao}|${e.categoria || ''}`));
          const recUniq = rec.filter(e => {
            if (seen.has(e.id)) return false;
            const expMes = e.data_vencimento ? e.data_vencimento.slice(0, 7) : '';
            if (expMes === mes) return seen.add(e.id);
            if (noMesDesc.has(`${e.descricao}|${e.categoria || ''}`)) return false;
            return seen.add(e.id);
          });
          let list = [...noMes, ...recUniq].map(e => {
            const isRec = e.recorrente === 1 || e.recorrente === true;
            const expMes = e.data_vencimento ? e.data_vencimento.slice(0, 7) : '';
            if (isRec && expMes !== mes) return { ...e, pago: 0, data_vencimento: mesInicio };
            return e;
          }).sort((a, b) => (a.data_vencimento || '').localeCompare(b.data_vencimento || ''));
          return res.json(list);
        } catch (err) {
          console.error('Expenses list error:', err);
          return res.json([]);
        }
      }
      if (method === 'POST') {
        try {
          const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
          const row = {
            descricao: body.descricao,
            categoria: body.categoria || 'outros',
            valor: Number(body.valor) || 0,
            pago: body.pago === true || body.pago === 1 ? 1 : 0,
            recorrente: body.recorrente === true || body.recorrente === 1 ? 1 : 0,
          };
          row.data_vencimento = (body.data_vencimento && body.data_vencimento !== '')
            ? body.data_vencimento
            : new Date().toISOString().slice(0, 7) + '-01';
          const { data, error } = await supabase.from('expenses').insert([row]).select();
          if (error) console.error('Expenses insert error:', error);
          return res.status(201).json(data?.[0] || {});
        } catch (err) {
          console.error('Expenses insert error:', err);
          return res.status(201).json({});
        }
      }
    }

    // Expenses - toggle pago (marcar como pago/pendente). Se recorrente e mes diferente, cria cópia do mês.
    if (url.match(/^\/api\/expenses\/\d+\/toggle-pago$/) && method === 'PUT') {
      try {
        const id = url.replace(/^\/api\/expenses\//, '').replace(/\/toggle-pago$/, '');
        const qs = rawUrl.includes('?') ? new URLSearchParams(rawUrl.split('?')[1]) : null;
        const mesParam = qs && qs.get('mes');
        const { data: expense, error: getErr } = await supabase.from('expenses').select('*').eq('id', id).single();
        if (getErr || !expense) return res.status(404).json({ error: 'Despesa não encontrada' });
        const expMes = expense.data_vencimento ? expense.data_vencimento.slice(0, 7) : '';
        const isRec = expense.recorrente === 1 || expense.recorrente === true;
        const mes = mesParam || expMes || new Date().toISOString().slice(0, 7);
        if (isRec && expMes !== mes) {
          const mesInicio = mes + '-01';
          const { data: existing } = await supabase.from('expenses').select('id, pago').eq('descricao', expense.descricao).eq('categoria', expense.categoria || 'outros').eq('data_vencimento', mesInicio).maybeSingle();
          if (existing) {
            const novoPago = existing.pago ? 0 : 1;
            const { data: updated } = await supabase.from('expenses').update({ pago: novoPago, data_pagamento: novoPago ? new Date().toISOString().split('T')[0] : null }).eq('id', existing.id).select().single();
            return res.json(updated);
          }
          const { data: newRow, error: insErr } = await supabase.from('expenses').insert([{
            descricao: expense.descricao,
            categoria: expense.categoria || 'outros',
            valor: expense.valor,
            data_vencimento: mesInicio,
            pago: 1,
            data_pagamento: new Date().toISOString().split('T')[0],
            recorrente: 0,
            tipo_recorrencia: expense.tipo_recorrencia || 'nenhum',
          }]).select().single();
          if (insErr) throw insErr;
          return res.json(newRow);
        }
        const novoPago = expense.pago ? 0 : 1;
        const { data, error } = await supabase.from('expenses').update({ pago: novoPago, data_pagamento: novoPago ? new Date().toISOString().split('T')[0] : null }).eq('id', id).select().single();
        if (error) throw error;
        return res.json(data);
      } catch (err) {
        console.error('Expenses toggle-pago error:', err);
        return res.status(500).json({ error: err.message });
      }
    }

    // Expenses - delete
    if (url.match(/^\/api\/expenses\/\d+$/) && method === 'DELETE') {
      try {
        const id = url.replace(/^\/api\/expenses\//, '');
        const { error } = await supabase.from('expenses').delete().eq('id', id);
        if (error) throw error;
        return res.json({ success: true });
      } catch (err) {
        console.error('Expenses delete error:', err);
        return res.status(500).json({ error: err.message });
      }
    }

    // Cashier - current session (retorna formato esperado pelo front: open, session, resumo, por_pagamento, movements)
    if (url === '/api/cashier/current') {
      try {
        const { data: session, error } = await supabase
          .from('cash_sessions')
          .select('*')
          .eq('status', 'aberto')
          .order('opened_at', { ascending: false })
          .limit(1)
          .single();
        
        if (error && error.code !== 'PGRST116') {
          console.error('Cashier current error:', error);
          throw error;
        }
        
        if (!session) return res.json(null);
        
        const { data: movements } = await supabase
          .from('cash_movements')
          .select('*')
          .eq('session_id', session.id)
          .order('created_at', { ascending: false });
        const movs = movements || [];
        
        const openedAt = session.opened_at;
        const { data: sessionSales } = await supabase
          .from('sales')
          .select('total, forma_pagamento')
          .gte('created_at', openedAt);
        const salesList = sessionSales || [];
        const totalVendas = salesList.reduce((s, v) => s + (Number(v.total) || 0), 0);
        const porPagamento = {};
        salesList.forEach(v => {
          const fp = v.forma_pagamento || 'dinheiro';
          porPagamento[fp] = (porPagamento[fp] || 0) + (Number(v.total) || 0);
        });
        const suprimentos = movs.filter(m => m.tipo === 'suprimento').reduce((s, m) => s + (Number(m.valor) || 0), 0);
        const sangrias = movs.filter(m => m.tipo === 'sangria').reduce((s, m) => s + (Number(m.valor) || 0), 0);
        const saldoInicial = Number(session.saldo_inicial) || 0;
        const saldoEstimado = saldoInicial + totalVendas + suprimentos - sangrias;
        
        const payload = {
          open: true,
          session: { ...session, id: session.id },
          resumo: {
            total_vendas: totalVendas,
            total_recebido: totalVendas,
            saldo_inicial: saldoInicial,
            suprimentos,
            sangrias,
            saldo_estimado: saldoEstimado,
            lucro_bruto: totalVendas
          },
          por_pagamento: Object.entries(porPagamento).map(([forma_pagamento, total]) => ({ forma_pagamento, total })),
          movements: movs
        };
        return res.json(payload);
      } catch (err) {
        console.error('Cashier error:', err);
        return res.status(500).json({ error: err.message });
      }
    }

    // Cashier - open
    if (url === '/api/cashier/open' && method === 'POST') {
      const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
      const { saldo_inicial } = body;
      
      const { data: existing } = await supabase
        .from('cash_sessions')
        .select('id')
        .eq('status', 'aberto')
        .single();
      
      if (existing) {
        return res.status(400).json({ error: 'Já existe uma sessão aberta' });
      }
      
      const { data, error } = await supabase
        .from('cash_sessions')
        .insert([{ saldo_inicial: saldo_inicial || 0, status: 'aberto' }])
        .select()
        .single();
      
      if (error) throw error;
      
      await supabase.from('cash_movements').insert([{
        session_id: data.id,
        tipo: 'abertura',
        valor: saldo_inicial || 0,
        descricao: 'Abertura de caixa'
      }]);
      
      return res.json(data);
    }

    // Cashier - close (aceita só observacao; id e saldo_final sao obtidos da sessao aberta)
    if (url === '/api/cashier/close' && method === 'POST') {
      try {
        const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
        const { id: bodyId, saldo_final: bodySaldo, observacao } = body;
        
        const { data: openSession, error: findErr } = await supabase
          .from('cash_sessions')
          .select('*')
          .eq('status', 'aberto')
          .single();
        if (findErr || !openSession) {
          return res.status(400).json({ error: 'Nenhuma sessão de caixa aberta' });
        }
        const sessionId = bodyId || openSession.id;
        const { data: movs } = await supabase
          .from('cash_movements')
          .select('tipo, valor')
          .eq('session_id', sessionId);
        const salesRes = await supabase
          .from('sales')
          .select('total')
          .gte('created_at', openSession.opened_at);
        const totalVendas = (salesRes.data || []).reduce((s, v) => s + (Number(v.total) || 0), 0);
        const suprimentos = (movs || []).filter(m => m.tipo === 'suprimento').reduce((s, m) => s + (Number(m.valor) || 0), 0);
        const sangrias = (movs || []).filter(m => m.tipo === 'sangria').reduce((s, m) => s + (Number(m.valor) || 0), 0);
        const saldoFinal = bodySaldo != null ? Number(bodySaldo) : (Number(openSession.saldo_inicial) || 0) + totalVendas + suprimentos - sangrias;
        
        await supabase.from('cash_movements').insert([{
          session_id: sessionId,
          tipo: 'fechamento',
          valor: saldoFinal,
          descricao: 'Fechamento de caixa'
        }]);
        
        const { data, error } = await supabase
          .from('cash_sessions')
          .update({ status: 'fechado', saldo_final: saldoFinal, observacao_fechamento: observacao || '', closed_at: new Date().toISOString() })
          .eq('id', sessionId)
          .select()
          .single();
        if (error) throw error;
        return res.json(data);
      } catch (err) {
        console.error('Cashier close error:', err);
        return res.status(500).json({ error: err.message });
      }
    }

    // Cashier - movement
    if (url === '/api/cashier/movement' && method === 'POST') {
      const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
      const { session_id, tipo, valor, descricao } = body;
      
      const { data, error } = await supabase
        .from('cash_movements')
        .insert([{ session_id, tipo, valor, descricao }])
        .select()
        .single();
      
      if (error) throw error;
      return res.json(data);
    }

    // Cashier - history (com total_vendas e qtd_vendas por sessao)
    if (url === '/api/cashier/history') {
      try {
        const { data: sessions, error } = await supabase
          .from('cash_sessions')
          .select('*')
          .eq('status', 'fechado')
          .order('closed_at', { ascending: false })
          .limit(20);
        if (error) throw error;
        const list = sessions || [];
        const withTotals = await Promise.all(list.map(async (s) => {
          const { data: sales } = await supabase
            .from('sales')
            .select('total')
            .gte('created_at', s.opened_at)
            .lte('created_at', (s.closed_at || new Date().toISOString()));
          const total = (sales || []).reduce((a, v) => a + (Number(v.total) || 0), 0);
          return { ...s, total_vendas: total, qtd_vendas: (sales || []).length };
        }));
        return res.json(withTotals);
      } catch (err) {
        console.error('Cashier history error:', err);
        return res.status(500).json({ error: err.message });
      }
    }

    // Cashier - detalhe de sessao por id (para caixas anteriores)
    if (url.match(/^\/api\/cashier\/\d+$/) && method === 'GET') {
      try {
        const id = url.replace(/^\/api\/cashier\//, '');
        const { data: session, error: sessErr } = await supabase
          .from('cash_sessions')
          .select('*')
          .eq('id', id)
          .single();
        if (sessErr || !session) return res.status(404).json({ error: 'Sessão não encontrada' });
        const { data: movements } = await supabase
          .from('cash_movements')
          .select('*')
          .eq('session_id', session.id)
          .order('created_at', { ascending: true });
        const movs = movements || [];
        const { data: sessionSales } = await supabase
          .from('sales')
          .select('total, forma_pagamento')
          .gte('created_at', session.opened_at)
          .lte('created_at', (session.closed_at || new Date().toISOString()));
        const salesList = sessionSales || [];
        const totalVendas = salesList.reduce((s, v) => s + (Number(v.total) || 0), 0);
        const porPagamento = {};
        salesList.forEach(v => {
          const fp = v.forma_pagamento || 'dinheiro';
          porPagamento[fp] = (porPagamento[fp] || 0) + (Number(v.total) || 0);
        });
        const payload = {
          session,
          resumo: {
            total_vendas: totalVendas,
            saldo_inicial: Number(session.saldo_inicial) || 0,
            saldo_final: Number(session.saldo_final) ?? 0
          },
          por_pagamento: Object.entries(porPagamento).map(([forma_pagamento, total]) => ({ forma_pagamento, total })),
          movements: movs
        };
        return res.json(payload);
      } catch (err) {
        console.error('Cashier detail error:', err);
        return res.status(500).json({ error: err.message });
      }
    }

    // Cashier - supply (suprimento) e withdraw (sangria) usando sessao atual
    if ((url === '/api/cashier/supply' || url === '/api/cashier/withdraw') && method === 'POST') {
      try {
        const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
        const { data: openSession, error: findErr } = await supabase
          .from('cash_sessions')
          .select('id')
          .eq('status', 'aberto')
          .single();
        if (findErr || !openSession) {
          return res.status(400).json({ error: 'Nenhuma sessão de caixa aberta' });
        }
        const tipo = url === '/api/cashier/supply' ? 'suprimento' : 'sangria';
        const valor = Number(body.valor) || 0;
        const descricao = body.descricao || (tipo === 'suprimento' ? 'Suprimento de Caixa' : 'Sangria de Caixa');
        const { data, error } = await supabase
          .from('cash_movements')
          .insert([{ session_id: openSession.id, tipo, valor, descricao }])
          .select()
          .single();
        if (error) throw error;
        return res.json(data);
      } catch (err) {
        console.error('Cashier supply/withdraw error:', err);
        return res.status(500).json({ error: err.message });
      }
    }

    // Cashier - reset (forçar fechamento de todas as sessões)
    if (url === '/api/cashier/reset' && method === 'POST') {
      await supabase
        .from('cash_sessions')
        .update({ status: 'fechado', closed_at: new Date().toISOString() })
        .eq('status', 'aberto');

      return res.json({ success: true });
    }

    // ========== REPORTS ==========

    // Custos fixos (alias /api/costs -> fixed_costs)
    if (url === '/api/costs' && method === 'GET') {
      const { data, error } = await supabase.from('fixed_costs').select('*').order('id');
      if (error) throw error;
      return res.json(data || []);
    }
    if (url === '/api/costs' && method === 'POST') {
      const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
      const { data, error } = await supabase.from('fixed_costs').insert([body]).select();
      if (error) throw error;
      return res.status(201).json(data[0]);
    }
    if (url.startsWith('/api/costs/') && method === 'DELETE') {
      const id = url.split('/api/costs/')[1];
      const { error } = await supabase.from('fixed_costs').delete().eq('id', id);
      if (error) throw error;
      return res.json({ success: true });
    }

    // Reports - Resumo mensal
    if ((url === '/api/reports/summary' || url.startsWith('/api/reports/summary?')) && method === 'GET') {
      try {
        const queryStr = (req.url || '').split('?')[1] || '';
        const params = new URLSearchParams(queryStr);
        const mes = params.get('mes') || new Date().toISOString().slice(0, 7);
        const [y, m] = mes.split('-').map(Number);
        const mesInicio = new Date(y, m - 1, 1).toISOString().split('T')[0];
        const mesFim = new Date(y, m, 0).toISOString().split('T')[0];

        const { data: sales } = await supabase
          .from('sales')
          .select('id, total, forma_pagamento, created_at')
          .gte('created_at', mesInicio)
          .lte('created_at', mesFim + 'T23:59:59');

        const faturamento_mes = (sales || []).reduce((s, v) => s + (v.total || 0), 0);
        const total_vendas = (sales || []).length;

        const saleIds = (sales || []).map(s => s.id).filter(Boolean);
        const { data: products } = await supabase
          .from('products')
          .select('id, nome, categoria, custo_por_kg, custo_saco, peso_saco_kg, custo_unitario')
          .eq('ativo', 1);

        const isRacao = (p) => !p.categoria || p.categoria === 'racao';
        let custo_produtos = 0;
        if (saleIds.length > 0) {
          const { data: items } = await supabase.from('sale_items').select('product_id, quantidade_kg, tipo_venda').in('sale_id', saleIds);
          for (const item of items || []) {
            const prod = (products || []).find(x => x.id === item.product_id);
            if (!prod) continue;
            const qty = item.quantidade_kg || 0;
            if (!isRacao(prod)) {
              custo_produtos += qty * (prod.custo_unitario || 0);
            } else if (item.tipo_venda === 'saco') {
              custo_produtos += (qty / (prod.peso_saco_kg || 1)) * (prod.custo_saco || 0);
            } else {
              custo_produtos += qty * (prod.custo_por_kg || 0);
            }
          }
        }

        const lucro_bruto = faturamento_mes - custo_produtos;

        const { data: fixedCosts } = await supabase.from('fixed_costs').select('valor');
        const custos_fixos = (fixedCosts || []).reduce((s, c) => s + (Number(c.valor) || 0), 0);

        const { data: expensesData } = await supabase
          .from('expenses')
          .select('valor, pago, categoria')
          .gte('data_vencimento', mesInicio)
          .lte('data_vencimento', mesFim);
        const despesas_mes = (expensesData || []).reduce((s, e) => s + (Number(e.valor) || 0), 0);
        const despesas_pagas = (expensesData || []).filter(e => e.pago).reduce((s, e) => s + (Number(e.valor) || 0), 0);

        const despCat = {};
        (expensesData || []).forEach(e => {
          const c = e.categoria || 'outros';
          despCat[c] = (despCat[c] || 0) + (Number(e.valor) || 0);
        });
        const despesas_por_categoria = Object.entries(despCat).map(([categoria, total]) => ({ categoria, total }));

        const { data: taxaData } = await supabase.from('settings').select('value').eq('key', 'taxa_maquininha').maybeSingle();
        const taxa_maquininha = parseFloat(taxaData?.value || '0');
        const vendas_cartao = (sales || []).filter(s => s.forma_pagamento === 'cartao' || s.forma_pagamento === 'debito' || s.forma_pagamento === 'credito');
        const total_cartao = vendas_cartao.reduce((s, v) => s + (v.total || 0), 0);
        const custo_maquininha = total_cartao * (taxa_maquininha / 100);

        const lucro_liquido = lucro_bruto - custos_fixos - custo_maquininha - despesas_mes;

        const pagMap = {};
        (sales || []).forEach(s => {
          const f = s.forma_pagamento || 'outros';
          if (!pagMap[f]) pagMap[f] = { vendas: 0, total: 0 };
          pagMap[f].vendas++;
          pagMap[f].total += s.total || 0;
        });
        const vendas_por_pagamento = Object.entries(pagMap).map(([forma_pagamento, d]) => ({ forma_pagamento, ...d }));

        let top_produtos = [];
        if (saleIds.length > 0) {
          const { data: allItems } = await supabase.from('sale_items').select('product_id, subtotal, quantidade_kg').in('sale_id', saleIds);
          const prodMap = {};
          (allItems || []).forEach(i => {
            if (!prodMap[i.product_id]) prodMap[i.product_id] = { total: 0, qty: 0 };
            prodMap[i.product_id].total += i.subtotal || 0;
            prodMap[i.product_id].qty += i.quantidade_kg || 0;
          });
          const prodNames = {};
          (products || []).forEach(p => { prodNames[p.id] = p; });
          top_produtos = Object.entries(prodMap)
            .map(([id, d]) => ({ id, nome: prodNames[id]?.nome || 'Desconhecido', total: d.total, quantidade: d.qty }))
            .sort((a, b) => b.total - a.total)
            .slice(0, 10);
        }

        const vendas_por_dia = [];
        const diasNoMes = new Date(y, m, 0).getDate();
        for (let d = 1; d <= diasNoMes; d++) {
          const dia = `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
          const vendasDia = (sales || []).filter(s => s.created_at && s.created_at.startsWith(dia));
          vendas_por_dia.push({
            dia: String(d).padStart(2, '0'),
            data: dia,
            vendas: vendasDia.length,
            faturamento: vendasDia.reduce((s, v) => s + (v.total || 0), 0)
          });
        }

        return res.json({
          mes,
          faturamento_mes,
          total_vendas,
          custo_produtos,
          lucro_bruto,
          custos_fixos,
          despesas_mes,
          despesas_pagas,
          despesas_por_categoria,
          custo_maquininha,
          taxa_maquininha,
          lucro_liquido,
          vendas_por_pagamento,
          top_produtos,
          vendas_por_dia,
          ticket_medio: total_vendas > 0 ? faturamento_mes / total_vendas : 0,
          margem_bruta: faturamento_mes > 0 ? (lucro_bruto / faturamento_mes) * 100 : 0,
          margem_liquida: faturamento_mes > 0 ? (lucro_liquido / faturamento_mes) * 100 : 0,
        });
      } catch (err) {
        console.error('Reports summary error:', err);
        return res.status(500).json({ error: err.message });
      }
    }

    // Reports - Faturamento diário
    if ((url === '/api/reports/daily' || url.startsWith('/api/reports/daily?')) && method === 'GET') {
      try {
        const queryStr = (req.url || '').split('?')[1] || '';
        const params = new URLSearchParams(queryStr);
        const dias = parseInt(params.get('dias')) || 30;
        const dataInicio = new Date();
        dataInicio.setDate(dataInicio.getDate() - dias);
        const inicio = dataInicio.toISOString().split('T')[0];

        const { data: sales } = await supabase
          .from('sales')
          .select('id, total, created_at')
          .gte('created_at', inicio)
          .order('created_at', { ascending: true });

        const byDay = {};
        (sales || []).forEach(s => {
          const dia = s.created_at?.split('T')[0] || '';
          if (!byDay[dia]) byDay[dia] = { data: dia, vendas: 0, faturamento: 0 };
          byDay[dia].vendas++;
          byDay[dia].faturamento += s.total || 0;
        });

        const result = [];
        const current = new Date(inicio);
        const today = new Date();
        while (current <= today) {
          const dia = current.toISOString().split('T')[0];
          result.push(byDay[dia] || { data: dia, vendas: 0, faturamento: 0 });
          current.setDate(current.getDate() + 1);
        }

        return res.json(result);
      } catch (err) {
        return res.status(500).json({ error: err.message });
      }
    }

    // Reports - Faturamento mensal
    if ((url === '/api/reports/monthly' || url.startsWith('/api/reports/monthly?')) && method === 'GET') {
      try {
        const queryStr = (req.url || '').split('?')[1] || '';
        const params = new URLSearchParams(queryStr);
        const meses = parseInt(params.get('meses')) || 12;
        const dataInicio = new Date();
        dataInicio.setMonth(dataInicio.getMonth() - meses);
        dataInicio.setDate(1);
        const inicio = dataInicio.toISOString().split('T')[0];

        const { data: sales } = await supabase
          .from('sales')
          .select('id, total, created_at')
          .gte('created_at', inicio)
          .order('created_at', { ascending: true });

        const byMonth = {};
        (sales || []).forEach(s => {
          const mes = s.created_at?.slice(0, 7) || '';
          if (!byMonth[mes]) byMonth[mes] = { mes, vendas: 0, faturamento: 0 };
          byMonth[mes].vendas++;
          byMonth[mes].faturamento += s.total || 0;
        });

        const result = [];
        const current = new Date(dataInicio);
        const now = new Date();
        while (current <= now) {
          const mes = current.toISOString().slice(0, 7);
          result.push(byMonth[mes] || { mes, vendas: 0, faturamento: 0 });
          current.setMonth(current.getMonth() + 1);
        }

        return res.json(result);
      } catch (err) {
        return res.status(500).json({ error: err.message });
      }
    }

    // Reports - Vendas detalhadas
    if ((url === '/api/reports/sales-detail' || url.startsWith('/api/reports/sales-detail?')) && method === 'GET') {
      try {
        const queryStr = (req.url || '').split('?')[1] || '';
        const params = new URLSearchParams(queryStr);
        const mes = params.get('mes') || new Date().toISOString().slice(0, 7);
        const [y, m] = mes.split('-').map(Number);
        const mesInicio = new Date(y, m - 1, 1).toISOString().split('T')[0];
        const mesFim = new Date(y, m, 0).toISOString().split('T')[0];

        const { data, error } = await supabase
          .from('sales')
          .select('*, clients(nome), sale_items(*, products(nome, categoria))')
          .gte('created_at', mesInicio)
          .lte('created_at', mesFim + 'T23:59:59')
          .order('created_at', { ascending: false });

        if (error) throw error;
        return res.json(data || []);
      } catch (err) {
        return res.status(500).json({ error: err.message });
      }
    }

    // ==================================================================
    // MARKETING - o que mais vendeu, por periodo e por segmento de pet
    // ==================================================================
    if ((url === '/api/marketing/ranking' || url.startsWith('/api/marketing/ranking?')) && method === 'GET') {
      let q = {};
      try {
        if (rawUrl.includes('?')) q = Object.fromEntries(new URLSearchParams(rawUrl.split('?')[1]));
      } catch (_) {}

      const dias = Math.min(365, Math.max(1, parseInt(q.dias, 10) || 7));
      const inicio = new Date(Date.now() - dias * 24 * 60 * 60 * 1000).toISOString();

      const { data: vendas, error: e1 } = await supabase
        .from('sales')
        .select('id, created_at, total')
        .gte('created_at', inicio)
        .limit(5000);
      if (e1) throw e1;

      const idsVenda = (vendas || []).map(v => v.id);
      if (idsVenda.length === 0) {
        return res.json({
          periodo: { dias, inicio, vendas: 0 },
          total: { faturamento: 0, itens: 0, produtos: 0 },
          ranking: [],
          sem_classificacao: 0,
        });
      }

      const { data: itens, error: e2 } = await supabase
        .from('sale_items')
        .select('product_id, tipo_venda, quantidade_kg, subtotal')
        .in('sale_id', idsVenda)
        .limit(20000);
      if (e2) throw e2;

      const { data: produtos, error: e3 } = await supabase
        .from('products')
        .select('id, nome, marca, tipo, categoria, especie, porte, perfil, peso_saco_kg, estoque_kg, estoque_unidade')
        .limit(3000);
      if (e3) throw e3;

      const porId = {};
      for (const p of produtos || []) porId[p.id] = p;

      // Quando os campos da loja nao foram preenchidos, cai no "tipo" que o
      // PDV ja usa desde sempre.
      const especieDe = (p) => p.especie || (p.tipo === 'cao' || p.tipo === 'gato' ? p.tipo : null);
      const perfilDe = (p) => p.perfil || (p.tipo === 'filhote' || p.tipo === 'castrado' ? p.tipo : null);

      const acumulado = {};
      for (const it of itens || []) {
        if (!it.product_id) continue;
        const p = porId[it.product_id];
        if (!p) continue;

        const linha = acumulado[it.product_id] || (acumulado[it.product_id] = {
          id: p.id,
          nome: p.nome,
          marca: p.marca || '',
          categoria: p.categoria || 'racao',
          especie: especieDe(p),
          porte: p.porte || null,
          perfil: perfilDe(p),
          estoque_kg: p.estoque_kg || 0,
          estoque_unidade: p.estoque_unidade || 0,
          vezes: 0,
          quilos: 0,
          faturamento: 0,
        });

        linha.vezes += 1;
        linha.faturamento += Number(it.subtotal) || 0;

        const qtd = Number(it.quantidade_kg) || 0;
        if (it.tipo_venda === 'saco') linha.quilos += qtd * (p.peso_saco_kg || 0);
        else if (it.tipo_venda === 'kg') linha.quilos += qtd;
      }

      let lista = Object.values(acumulado);
      const semClassificacao = lista.filter(l => !l.especie).length;

      const querido = (campo, valor) => !valor || valor === 'todos' || campo === valor;
      lista = lista.filter(l =>
        querido(l.especie, q.especie)
        && querido(l.porte, q.porte)
        && querido(l.perfil, q.perfil)
        && querido(l.categoria, q.categoria));

      const faturamentoTotal = lista.reduce((soma, l) => soma + l.faturamento, 0);
      const itensTotal = lista.reduce((soma, l) => soma + l.vezes, 0);

      lista.sort((a, b) => b.faturamento - a.faturamento);

      const ranking = lista.slice(0, 40).map(l => ({
        ...l,
        quilos: Math.round(l.quilos * 10) / 10,
        faturamento: Math.round(l.faturamento * 100) / 100,
        participacao: faturamentoTotal > 0
          ? Math.round((l.faturamento / faturamentoTotal) * 1000) / 10
          : 0,
      }));

      return res.json({
        periodo: { dias, inicio, vendas: idsVenda.length },
        total: {
          faturamento: Math.round(faturamentoTotal * 100) / 100,
          itens: itensTotal,
          produtos: lista.length,
        },
        ranking,
        sem_classificacao: semClassificacao,
      });
    }

    // ==================================================================
    // SETTINGS (chave/valor) - usado pela loja online e pelo PDV
    // ==================================================================
    if (url === '/api/settings' && method === 'GET') {
      const { data, error } = await supabase.from('settings').select('*');
      if (error) throw error;
      const obj = {};
      for (const row of data || []) obj[row.key] = row.value;
      return res.json(obj);
    }

    if (url === '/api/settings' && method === 'PUT') {
      const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
      for (const [key, value] of Object.entries(body || {})) {
        await supabase.from('settings').upsert({ key, value: String(value ?? '') }, { onConflict: 'key' });
      }
      return res.json({ success: true });
    }

    // ==================================================================
    // LOJA ONLINE (rotas publicas - sem login)
    // ==================================================================

    // Config publica da loja
    if (url === '/api/shop/config' && method === 'GET') {
      const { data } = await supabase.from('settings').select('*');
      const s = {};
      for (const row of data || []) s[row.key] = row.value;
      return res.json({
        loja_aberta: s.loja_aberta !== 'false',
        whatsapp_loja: s.whatsapp_loja || '',
        endereco_loja: s.endereco_loja || 'Rua Bernardo Vasconcelos, 304 - Vila Maria Helena',
        frete_valor: parseFloat(s.frete_valor || '9.90') || 0,
        frete_gratis_acima: parseFloat(s.frete_gratis_acima || '99') || 0,
        pedido_minimo: parseFloat(s.pedido_minimo || '0') || 0,
      });
    }

    // Catalogo publico
    if (url === '/api/shop/products' && method === 'GET') {
      const { data, error } = await supabase
        .from('products')
        .select('*')
        .eq('ativo', 1)
        .order('nome');
      if (error) throw error;

      const list = (data || [])
        .filter(p => p.visivel_loja === true)
        .map(p => {
          const isRacao = !p.categoria || p.categoria === 'racao';
          const temSaco = isRacao && p.preco_saco_fechado > 0 && p.peso_saco_kg > 0;
          const temKg = isRacao && p.vende_fracionado !== false && p.preco_por_kg > 0;
          const temUnidade = !isRacao && p.preco_unitario > 0;
          return {
            id: p.id,
            nome: p.nome,
            marca: p.marca || '',
            categoria: p.categoria || 'racao',
            especie: p.especie || (p.tipo === 'cao' || p.tipo === 'gato' ? p.tipo : null),
            porte: p.porte || null,
            perfil: p.perfil || (p.tipo === 'filhote' || p.tipo === 'castrado' ? p.tipo : null),
            foto_url: p.foto_url || null,
            peso_saco_kg: p.peso_saco_kg || 0,
            preco_saco_fechado: p.preco_saco_fechado || 0,
            preco_por_kg: p.preco_por_kg || 0,
            preco_unitario: p.preco_unitario || 0,
            promo_qtd: temPromocao(p) ? Number(p.promo_qtd) : null,
            promo_preco: temPromocao(p) ? Number(p.promo_preco) : null,
            estoque_kg: p.estoque_kg || 0,
            estoque_unidade: p.estoque_unidade || 0,
            tem_saco: temSaco,
            tem_kg: temKg,
            tem_unidade: temUnidade,
          };
        })
        .filter(p => p.tem_saco || p.tem_kg || p.tem_unidade);

      return res.json(list);
    }

    // Mais pedidos da loja: ranking real pelas vendas dos ultimos 90 dias
    /* ================================================================
       KITS PROMOCIONAIS
       Um kit junta produtos existentes num preco so. Ele nunca vira
       linha de pedido por si: no fechamento, abre em uma linha por
       componente, e dali em diante e um pedido comum.
       ================================================================ */

    // Monta a visao completa de um kit: componentes com foto, preco cheio
    // (soma dos componentes a preco normal) e se ha estoque para todos.
    async function montarKits(filtroVitrine) {
      let q = supabase.from('kits').select('*, kit_itens(*)').eq('ativo', true).order('created_at', { ascending: false });
      if (filtroVitrine) q = q.eq('visivel_loja', true);
      const { data: kits, error } = await q;
      if (error) throw error;

      const ids = [...new Set((kits || []).flatMap(k => (k.kit_itens || []).map(i => i.product_id)))];
      const { data: prods } = ids.length
        ? await supabase.from('products').select('*').in('id', ids)
        : { data: [] };
      const porId = Object.fromEntries((prods || []).map(p => [p.id, p]));

      return (kits || []).map(k => {
        let precoCheio = 0;
        let disponivel = true;
        const componentes = (k.kit_itens || []).map(i => {
          const p = porId[i.product_id];
          const qtd = Number(i.quantidade) || 0;
          if (!p || p.ativo !== 1) { disponivel = false; return null; }
          let unit = 0;
          let temEstoque = false;
          if (i.tipo_venda === 'saco') {
            unit = Number(p.preco_saco_fechado) || 0;
            temEstoque = (Number(p.estoque_kg) || 0) >= qtd * (Number(p.peso_saco_kg) || 0);
          } else if (i.tipo_venda === 'kg') {
            unit = Number(p.preco_por_kg) || 0;
            temEstoque = (Number(p.estoque_kg) || 0) >= qtd;
          } else {
            unit = Number(p.preco_unitario) || 0;
            temEstoque = (Number(p.estoque_unidade) || 0) >= qtd;
          }
          if (!temEstoque) disponivel = false;
          precoCheio += unit * qtd;
          return {
            product_id: p.id, nome: p.nome, marca: p.marca || '', foto_url: p.foto_url || null,
            tipo_venda: i.tipo_venda, quantidade: qtd, preco_cheio_unit: unit,
            peso_saco_kg: Number(p.peso_saco_kg) || 0,
          };
        }).filter(Boolean);

        return {
          id: k.id, nome: k.nome, descricao: k.descricao || '', preco: Number(k.preco) || 0,
          foto_url: k.foto_url || null, visivel_loja: k.visivel_loja !== false,
          preco_cheio: Math.round(precoCheio * 100) / 100,
          disponivel: disponivel && componentes.length > 0,
          componentes,
        };
      });
    }

    if (url === '/api/shop/kits' && method === 'GET') {
      return res.json(await montarKits(true));
    }

    if (url === '/api/kits' && method === 'GET') {
      return res.json(await montarKits(false));
    }

    // Grava cabecalho e troca os componentes de uma vez. `itens` chega
    // como [{product_id, tipo_venda, quantidade}].
    async function salvarKit(id, body) {
      const nome = String(body.nome || '').trim();
      const preco = Number(body.preco) || 0;
      const itens = Array.isArray(body.itens) ? body.itens : [];
      if (!nome) return { erro: 'Informe o nome do kit' };
      if (preco <= 0) return { erro: 'Informe o preco do kit' };
      if (itens.length === 0) return { erro: 'Um kit precisa de pelo menos um produto' };

      const cabecalho = {
        nome, preco,
        descricao: String(body.descricao || '').trim() || null,
        foto_url: String(body.foto_url || '').trim() || null,
        visivel_loja: body.visivel_loja !== false,
        updated_at: new Date().toISOString(),
      };

      let kitId = id;
      if (kitId) {
        const { error } = await supabase.from('kits').update(cabecalho).eq('id', kitId);
        if (error) throw error;
        await supabase.from('kit_itens').delete().eq('kit_id', kitId);
      } else {
        const { data, error } = await supabase.from('kits').insert([cabecalho]).select('id').single();
        if (error) throw error;
        kitId = data.id;
      }

      const linhas = itens
        .map(i => ({
          kit_id: kitId,
          product_id: Number(i.product_id),
          tipo_venda: ['saco', 'kg', 'unidade'].includes(i.tipo_venda) ? i.tipo_venda : 'unidade',
          quantidade: Number(i.quantidade) || 1,
        }))
        .filter(i => i.product_id > 0 && i.quantidade > 0);
      const { error: e2 } = await supabase.from('kit_itens').insert(linhas);
      if (e2) throw e2;
      return { id: kitId };
    }

    if (url === '/api/kits' && method === 'POST') {
      const body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body || {});
      const r = await salvarKit(null, body);
      if (r.erro) return res.status(400).json({ error: r.erro });
      return res.status(201).json(r);
    }

    if (url.match(/^\/api\/kits\/\d+$/) && method === 'PUT') {
      const id = Number(url.match(/(\d+)$/)[1]);
      const body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body || {});
      // Mudar so a vitrine nao precisa mandar os itens de novo
      if (body.itens === undefined && body.nome === undefined) {
        const { error } = await supabase.from('kits')
          .update({ visivel_loja: body.visivel_loja !== false, updated_at: new Date().toISOString() })
          .eq('id', id);
        if (error) throw error;
        return res.json({ id });
      }
      const r = await salvarKit(id, body);
      if (r.erro) return res.status(400).json({ error: r.erro });
      return res.json(r);
    }

    if (url.match(/^\/api\/kits\/\d+$/) && method === 'DELETE') {
      const id = Number(url.match(/(\d+)$/)[1]);
      const { error } = await supabase.from('kits').update({ ativo: false, updated_at: new Date().toISOString() }).eq('id', id);
      if (error) throw error;
      return res.json({ success: true });
    }

    if (url === '/api/shop/destaques' && method === 'GET') {
      const desde = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString();
      const { data: vendas } = await supabase
        .from('sales')
        .select('id')
        .gte('created_at', desde)
        .limit(2000);

      const ids = (vendas || []).map(v => v.id);
      if (ids.length === 0) return res.json([]);

      const { data: itens } = await supabase
        .from('sale_items')
        .select('product_id, quantidade_kg')
        .in('sale_id', ids)
        .limit(5000);

      const contagem = {};
      for (const it of itens || []) {
        if (!it.product_id) continue;
        contagem[it.product_id] = (contagem[it.product_id] || 0) + 1;
      }

      const ranking = Object.keys(contagem)
        .map(id => ({ id: Number(id), vezes: contagem[id] }))
        .sort((a, b) => b.vezes - a.vezes)
        .slice(0, 6)
        .map(r => r.id);

      return res.json(ranking);
    }

    // Meus pedidos: historico do cliente pelo WhatsApp, para a loja mostrar
    // "voce ja pediu isso" sem precisar de cadastro nem senha.
    if (url.startsWith('/api/shop/orders') && method === 'GET') {
      let query = {};
      try {
        if (rawUrl.includes('?')) query = Object.fromEntries(new URLSearchParams(rawUrl.split('?')[1]));
      } catch (_) {}

      const whatsapp = String(query.whatsapp || '').replace(/\D/g, '');
      if (whatsapp.length < 10) return res.json([]);

      const { data, error } = await supabase
        .from('orders')
        .select('id, created_at, status, tipo_entrega, janela, endereco, subtotal, frete, total, assinatura, frequencia, order_items(*)')
        .eq('cliente_whatsapp', whatsapp)
        .order('created_at', { ascending: false })
        .limit(20);

      if (error) throw error;
      return res.json(data || []);
    }

    // Criar pedido a partir da loja
    if (url === '/api/shop/orders' && method === 'POST') {
      const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
      const items = Array.isArray(body.items) ? body.items : [];

      if (!body.cliente_nome || !String(body.cliente_nome).trim()) {
        return res.status(400).json({ error: 'Informe seu nome' });
      }
      const whatsapp = String(body.cliente_whatsapp || '').replace(/\D/g, '');
      if (whatsapp.length < 10) {
        return res.status(400).json({ error: 'Informe um WhatsApp valido com DDD' });
      }
      if (items.length === 0) {
        return res.status(400).json({ error: 'Pedido sem itens' });
      }
      const tipoEntrega = body.tipo_entrega === 'retirada' ? 'retirada' : 'entrega';
      if (tipoEntrega === 'entrega' && !String(body.endereco || '').trim()) {
        return res.status(400).json({ error: 'Informe o endereco de entrega' });
      }

      // Precos e estoque sao recalculados aqui no servidor - o que vem do
      // navegador serve so para saber o que a pessoa escolheu.
      const linhas = [];
      let subtotal = 0;

      // Kits abrem em uma linha por componente ANTES da conta comecar. O
      // preco fechado do kit e rateado entre as linhas na proporcao do
      // preco cheio de cada uma (a ultima absorve o centavo do arredondamento),
      // assim a soma bate exatamente com o que o cliente viu, e cada linha
      // baixa o estoque do seu proprio produto no fluxo normal.
      const itensAbertos = [];
      for (const item of items) {
        if (!item.kit_id) { itensAbertos.push(item); continue; }
        const vezes = Math.max(1, Math.round(parseFloat(item.quantidade_kg) || 1));
        const kit = (await montarKits(true)).find(k => k.id === Number(item.kit_id));
        if (!kit) return res.status(409).json({ error: 'Um dos kits saiu do catalogo. Revise o carrinho.' });
        if (!kit.disponivel) return res.status(409).json({ error: kit.nome + ': um dos produtos do kit esta sem estoque.' });

        const totalKit = Math.round(kit.preco * vezes * 100) / 100;
        const base = kit.preco_cheio > 0 ? kit.preco_cheio : kit.componentes.reduce((s, c) => s + c.quantidade, 0);
        let distribuido = 0;
        kit.componentes.forEach((c, idx) => {
          const peso = kit.preco_cheio > 0 ? (c.preco_cheio_unit * c.quantidade) / base : c.quantidade / base;
          const ultimo = idx === kit.componentes.length - 1;
          const parte = ultimo ? Math.round((totalKit - distribuido) * 100) / 100 : Math.round(totalKit * peso * 100) / 100;
          distribuido += parte;
          itensAbertos.push({
            product_id: c.product_id,
            tipo_venda: c.tipo_venda,
            quantidade_kg: c.quantidade * vezes,
            subtotal_fixo: parte,
            rotulo_kit: kit.nome,
          });
        });
      }

      for (const item of itensAbertos) {
        const { data: prod } = await supabase
          .from('products')
          .select('*')
          .eq('id', item.product_id)
          .single();

        if (!prod || prod.ativo !== 1 || prod.visivel_loja !== true) {
          return res.status(409).json({ error: 'Um dos produtos saiu do catalogo. Revise o carrinho.' });
        }

        const qtd = parseFloat(item.quantidade_kg) || 0;
        if (qtd <= 0) continue;

        const isRacao = !prod.categoria || prod.categoria === 'racao';
        let tipoVenda = item.tipo_venda;
        if (!isRacao) tipoVenda = 'unidade';
        else if (tipoVenda !== 'saco') tipoVenda = 'kg';

        let precoUnit = 0;
        let kgEquivalente = 0;

        if (tipoVenda === 'saco') {
          precoUnit = prod.preco_saco_fechado || 0;
          kgEquivalente = qtd * (prod.peso_saco_kg || 0);
        } else if (tipoVenda === 'kg') {
          precoUnit = prod.preco_por_kg || 0;
          kgEquivalente = qtd;
        } else {
          precoUnit = prod.preco_unitario || 0;
        }

        if (precoUnit <= 0) {
          return res.status(409).json({ error: prod.nome + ' esta sem preco cadastrado.' });
        }

        if (tipoVenda === 'unidade') {
          if ((prod.estoque_unidade || 0) < qtd) {
            return res.status(409).json({ error: prod.nome + ': restam ' + (prod.estoque_unidade || 0) + ' unidade(s) em estoque.' });
          }
        } else if ((prod.estoque_kg || 0) < kgEquivalente) {
          return res.status(409).json({ error: prod.nome + ': restam ' + (prod.estoque_kg || 0).toFixed(1) + ' kg em estoque.' });
        }

        // Em unidade, o combo "leve X por Y" pode baixar o subtotal da linha.
        // O preco unitario gravado passa a ser a media efetiva, para que
        // quantidade x preco continue batendo com o subtotal nos relatorios.
        const emPromocao = tipoVenda === 'unidade' && temPromocao(prod);
        const vemDeKit = item.subtotal_fixo !== undefined;
        const linhaSubtotal = vemDeKit
          ? item.subtotal_fixo
          : emPromocao
            ? totalUnidades(prod, qtd)
            : Math.round(qtd * precoUnit * 100) / 100;
        if ((emPromocao || vemDeKit) && qtd > 0) precoUnit = Math.round((linhaSubtotal / qtd) * 10000) / 10000;
        subtotal += linhaSubtotal;

        let descricao = (vemDeKit ? 'Kit ' + item.rotulo_kit + ': ' : '') + (prod.marca ? prod.marca + ' ' : '') + prod.nome;
        if (tipoVenda === 'saco') descricao += ' - Saco ' + prod.peso_saco_kg + ' kg';
        else if (tipoVenda === 'kg') descricao += ' - Fracionado ' + qtd + ' kg';
        else descricao += ' - ' + qtd + ' un' + (emPromocao && qtd >= prod.promo_qtd ? ' (promo ' + prod.promo_qtd + ' por ' + Number(prod.promo_preco).toFixed(2).replace('.', ',') + ')' : '');

        linhas.push({
          product_id: prod.id,
          descricao,
          tipo_venda: tipoVenda,
          quantidade_kg: qtd,
          preco_unitario: precoUnit,
          subtotal: linhaSubtotal,
        });
      }

      if (linhas.length === 0) {
        return res.status(400).json({ error: 'Pedido sem itens validos' });
      }

      subtotal = Math.round(subtotal * 100) / 100;

      const { data: cfgRows } = await supabase.from('settings').select('*');
      const cfg = {};
      for (const row of cfgRows || []) cfg[row.key] = row.value;

      const freteValor = parseFloat(cfg.frete_valor || '9.90') || 0;
      const freteGratisAcima = parseFloat(cfg.frete_gratis_acima || '99') || 0;
      const pedidoMinimo = parseFloat(cfg.pedido_minimo || '0') || 0;

      if (pedidoMinimo > 0 && subtotal < pedidoMinimo) {
        return res.status(400).json({ error: 'Pedido minimo de R$ ' + pedidoMinimo.toFixed(2) });
      }

      const frete = tipoEntrega === 'entrega' && subtotal < freteGratisAcima ? freteValor : 0;
      const total = Math.round((subtotal + frete) * 100) / 100;

      // Cliente: reaproveita pelo WhatsApp, cadastra se for novo
      let clientId = null;
      const { data: achado } = await supabase
        .from('clients')
        .select('id')
        .eq('whatsapp', whatsapp)
        .limit(1);

      if (achado && achado.length > 0) {
        clientId = achado[0].id;
      } else {
        const { data: novo } = await supabase
          .from('clients')
          .insert([{
            nome: String(body.cliente_nome).trim(),
            whatsapp,
            tipo_pet: body.tipo_pet || '',
            racao_utilizada: linhas[0] ? linhas[0].descricao : '',
          }])
          .select();
        if (novo && novo.length > 0) clientId = novo[0].id;
      }

      const { data: pedido, error: erroPedido } = await supabase
        .from('orders')
        .insert([{
          client_id: clientId,
          cliente_nome: String(body.cliente_nome).trim(),
          cliente_whatsapp: whatsapp,
          tipo_entrega: tipoEntrega,
          endereco: tipoEntrega === 'entrega' ? String(body.endereco || '').trim() : null,
          referencia: body.referencia || null,
          janela: body.janela || null,
          observacao: body.observacao || null,
          subtotal,
          frete,
          total,
          status: 'novo',
          assinatura: !!body.assinatura,
          frequencia: body.assinatura ? (body.frequencia || 'quinzenal') : null,
        }])
        .select();

      if (erroPedido) throw erroPedido;
      const pedidoId = pedido[0].id;

      for (const linha of linhas) {
        await supabase.from('order_items').insert([Object.assign({ order_id: pedidoId }, linha)]);
      }

      return res.status(201).json(Object.assign({}, pedido[0], { items: linhas }));
    }

    // ==================================================================
    // PEDIDOS (lado do PDV)
    // ==================================================================
    if (url === '/api/orders' && method === 'GET') {
      let query = {};
      try {
        if (rawUrl.includes('?')) query = Object.fromEntries(new URLSearchParams(rawUrl.split('?')[1]));
      } catch (_) {}

      let q = supabase
        .from('orders')
        .select('*, order_items(*)')
        .order('created_at', { ascending: false })
        .limit(200);

      if (query.status && query.status !== 'todos') q = q.eq('status', query.status);
      if (query.data_inicio) q = q.gte('created_at', query.data_inicio);
      if (query.data_fim) q = q.lte('created_at', query.data_fim + 'T23:59:59.999Z');

      const { data, error } = await q;
      if (error) throw error;
      return res.json(data || []);
    }

    // Metricas dos pedidos online (o dinheiro que entrou pela internet)
    if ((url === '/api/orders/resumo' || url.startsWith('/api/orders/resumo?')) && method === 'GET') {
      const agora = new Date();
      const inicioDia = new Date(agora.getFullYear(), agora.getMonth(), agora.getDate()).toISOString();
      const inicioMes = new Date(agora.getFullYear(), agora.getMonth(), 1).toISOString();

      const { data, error } = await supabase
        .from('orders')
        .select('status, subtotal, frete, total, created_at, sale_id')
        .gte('created_at', inicioMes)
        .limit(2000);

      if (error) throw error;

      const CONTA_COMO_VENDA = ['confirmado', 'separando', 'pronto', 'entregue'];
      const vazio = () => ({ pedidos: 0, produtos: 0, frete: 0, total: 0 });
      const hoje = vazio();
      const mes = vazio();
      let aguardando = 0;
      let canceladosMes = 0;

      for (const p of data || []) {
        if (p.status === 'novo') aguardando++;
        if (p.status === 'cancelado') { canceladosMes++; continue; }
        if (!CONTA_COMO_VENDA.includes(p.status)) continue;

        const somar = (alvo) => {
          alvo.pedidos++;
          alvo.produtos += Number(p.subtotal) || 0;
          alvo.frete += Number(p.frete) || 0;
          alvo.total += Number(p.total) || 0;
        };
        somar(mes);
        if (p.created_at >= inicioDia) somar(hoje);
      }

      const arredonda = (o) => ({
        pedidos: o.pedidos,
        produtos: Math.round(o.produtos * 100) / 100,
        frete: Math.round(o.frete * 100) / 100,
        total: Math.round(o.total * 100) / 100,
      });

      // Contagens de apoio do painel da loja. `head: true` traz so o total,
      // sem puxar as linhas.
      const [{ count: clientes }, { count: produtos }] = await Promise.all([
        supabase.from('clients').select('id', { count: 'exact', head: true }),
        supabase.from('products').select('id', { count: 'exact', head: true })
          .eq('ativo', 1).eq('visivel_loja', true),
      ]);

      return res.json({
        hoje: arredonda(hoje),
        mes: arredonda(mes),
        aguardando,
        cancelados_mes: canceladosMes,
        ticket_medio_mes: mes.pedidos > 0 ? Math.round((mes.produtos / mes.pedidos) * 100) / 100 : 0,
        clientes: clientes || 0,
        produtos: produtos || 0,
      });
    }

    if (url.match(/^\/api\/orders\/\d+$/) && method === 'GET') {
      const id = url.replace(/^\/api\/orders\//, '');
      const { data, error } = await supabase
        .from('orders')
        .select('*, order_items(*)')
        .eq('id', id)
        .single();
      if (error || !data) return res.status(404).json({ error: 'Pedido nao encontrado' });
      return res.json(data);
    }

    if (url.match(/^\/api\/orders\/\d+\/status$/) && method === 'PUT') {
      const id = url.match(/^\/api\/orders\/(\d+)\/status$/)[1];
      const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
      const permitidos = ['novo', 'confirmado', 'separando', 'pronto', 'entregue', 'cancelado'];
      if (!permitidos.includes(body.status)) {
        return res.status(400).json({ error: 'Status invalido' });
      }
      const { data, error } = await supabase
        .from('orders')
        .update({ status: body.status, updated_at: new Date().toISOString() })
        .eq('id', id)
        .select();
      if (error) throw error;
      return res.json(data[0]);
    }

    // Confirmar pedido: vira venda no PDV e baixa o estoque
    if (url.match(/^\/api\/orders\/\d+\/confirm$/) && method === 'POST') {
      const id = url.match(/^\/api\/orders\/(\d+)\/confirm$/)[1];
      const body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body || {});
      const formaPagamento = ['dinheiro', 'pix', 'cartao'].includes(body.forma_pagamento)
        ? body.forma_pagamento : 'pix';

      const { data: pedido, error: e1 } = await supabase
        .from('orders')
        .select('*, order_items(*)')
        .eq('id', id)
        .single();

      if (e1 || !pedido) return res.status(404).json({ error: 'Pedido nao encontrado' });
      if (pedido.sale_id) return res.status(409).json({ error: 'Pedido ja foi lancado como venda' });
      if (pedido.status === 'cancelado') return res.status(409).json({ error: 'Pedido cancelado' });

      const itens = pedido.order_items || [];
      if (itens.length === 0) return res.status(400).json({ error: 'Pedido sem itens' });

      // A venda registra os produtos. O frete fica so no pedido, para nao
      // inflar o faturamento com taxa de entrega.
      const { data: novaVenda, error: e2 } = await supabase
        .from('sales')
        .insert([{
          client_id: pedido.client_id,
          total: pedido.subtotal,
          desconto: 0,
          forma_pagamento: formaPagamento,
        }])
        .select();

      if (e2) throw e2;
      const saleId = novaVenda[0].id;

      for (const item of itens) {
        await supabase.from('sale_items').insert([{
          sale_id: saleId,
          product_id: item.product_id,
          tipo_venda: item.tipo_venda === 'unidade' ? 'kg' : item.tipo_venda,
          quantidade_kg: item.quantidade_kg,
          preco_unitario: item.preco_unitario,
          subtotal: item.subtotal,
        }]);

        const { data: prod } = await supabase
          .from('products')
          .select('categoria, peso_saco_kg, estoque_kg, estoque_unidade')
          .eq('id', item.product_id)
          .single();

        if (!prod) continue;

        if (item.tipo_venda === 'unidade') {
          const un = Math.round(item.quantidade_kg || 0);
          const novoEstoque = Math.max(0, (prod.estoque_unidade || 0) - un);
          await supabase.from('products').update({ estoque_unidade: novoEstoque }).eq('id', item.product_id);
          await supabase.from('stock_movements').insert([{
            product_id: item.product_id, tipo: 'saida', quantidade_kg: -un,
            motivo: 'Pedido online #' + id, sale_id: saleId,
          }]);
        } else {
          const qtyKg = item.tipo_venda === 'saco'
            ? (item.quantidade_kg || 0) * (prod.peso_saco_kg || 1)
            : (item.quantidade_kg || 0);
          const novoEstoque = Math.max(0, (prod.estoque_kg || 0) - qtyKg);
          await supabase.from('products').update({ estoque_kg: novoEstoque }).eq('id', item.product_id);
          await supabase.from('stock_movements').insert([{
            product_id: item.product_id, tipo: 'saida', quantidade_kg: -qtyKg,
            motivo: 'Pedido online #' + id, sale_id: saleId,
          }]);
        }
      }

      if (pedido.client_id) {
        await supabase
          .from('clients')
          .update({ ultima_compra: new Date().toISOString() })
          .eq('id', pedido.client_id);
      }

      const { data: atualizado } = await supabase
        .from('orders')
        .update({ status: 'confirmado', sale_id: saleId, updated_at: new Date().toISOString() })
        .eq('id', id)
        .select();

      return res.json(Object.assign({}, (atualizado && atualizado[0]) || pedido, { sale_id: saleId }));
    }

    return res.status(404).json({ error: 'Route not found' });

  } catch (error) {
    console.error('API Error:', error);
    if (isDashboard) return res.status(200).json(emptyDashboard());
    if (isAlerts) return res.status(200).json([]);
    return res.status(500).json({ error: error.message });
  }
};
