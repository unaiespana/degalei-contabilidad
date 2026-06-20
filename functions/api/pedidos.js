// Cloudflare Pages Function — lee los PEDIDOS REALES de Shopify en directo.
// Usa las credenciales secretas configuradas en las variables de entorno de Cloudflare.
// Ruta pública: /api/pedidos

export async function onRequestGet(context) {
  const { env } = context;

  const cors = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  };

  const STORE = env.SHOPIFY_STORE || 'degalei.myshopify.com';
  const CLIENT_ID = env.SHOPIFY_CLIENT_ID;
  const CLIENT_SECRET = env.SHOPIFY_CLIENT_SECRET;

  if (!CLIENT_ID || !CLIENT_SECRET) {
    return new Response(JSON.stringify({ error: 'Faltan SHOPIFY_CLIENT_ID o SHOPIFY_CLIENT_SECRET en Cloudflare' }), {
      status: 400, headers: { 'Content-Type': 'application/json', ...cors }
    });
  }

  try {
    // 1) Pedir un token de acceso a Shopify usando client_credentials
    const tokenResp = await fetch(`https://${STORE}/admin/oauth/access_token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        client_id: CLIENT_ID,
        client_secret: CLIENT_SECRET,
        grant_type: 'client_credentials'
      })
    });

    if (!tokenResp.ok) {
      const t = await tokenResp.text();
      return new Response(JSON.stringify({ error: 'No se pudo obtener el token de Shopify', detail: t.substring(0, 300) }), {
        status: 502, headers: { 'Content-Type': 'application/json', ...cors }
      });
    }

    const tokenData = await tokenResp.json();
    const TOKEN = tokenData.access_token;

    if (!TOKEN) {
      return new Response(JSON.stringify({ error: 'Shopify no devolvió un token válido', detail: tokenData }), {
        status: 502, headers: { 'Content-Type': 'application/json', ...cors }
      });
    }

    // 2) Consultar los últimos 100 pedidos mediante GraphQL
    const query = `{
      orders(first: 100, sortKey: CREATED_AT, reverse: true) {
        edges {
          node {
            id
            name
            createdAt
            totalPriceSet {
              presentmentMoney {
                amount
              }
            }
            displayFinancialStatus
            displayFulfillmentStatus
            customer {
              firstName
              lastName
            }
            lineItems(first: 10) {
              edges {
                node {
                  title
                  quantity
                }
              }
            }
          }
        }
      }
    }`;

    const resp = await fetch(`https://${STORE}/admin/api/2026-04/graphql.json`, {
      method: 'POST',
      headers: {
        'X-Shopify-Access-Token': TOKEN,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ query })
    });

    if (!resp.ok) {
      const t = await resp.text();
      return new Response(JSON.stringify({ error: 'Error de GraphQL en Shopify', detail: t.substring(0, 300) }), {
        status: 502, headers: { 'Content-Type': 'application/json', ...cors }
      });
    }

    const data = await resp.json();
    const edges = (data && data.data && data.data.orders && data.data.orders.edges) || [];
    const pedidos = [];

    edges.forEach(e => {
      const node = e.node;
      if (!node) return;

      const customerName = node.customer 
        ? `${node.customer.firstName || ''} ${node.customer.lastName || ''}`.trim() 
        : 'Cliente Shopify';

      const productsSummary = node.lineItems && node.lineItems.edges
        ? node.lineItems.edges.map(le => `${le.node.title} (x${le.node.quantity})`).join(', ')
        : '—';

      pedidos.push({
        shopify_id: node.id,
        numero: node.name || '',
        cliente: customerName || 'Sin nombre',
        producto: productsSummary,
        fecha: node.createdAt ? node.createdAt.split('T')[0] : new Date().toISOString().split('T')[0],
        total: parseFloat(node.totalPriceSet?.presentmentMoney?.amount) || 0,
        estado_pago: (node.displayFinancialStatus || '').toLowerCase(),
        estado_envio: (node.displayFulfillmentStatus || '').toLowerCase()
      });
    });

    return new Response(JSON.stringify({ ok: true, pedidos }), {
      status: 200, headers: { 'Content-Type': 'application/json', ...cors }
    });

  } catch (err) {
    return new Response(JSON.stringify({ error: 'Error del servidor', detail: String(err) }), {
      status: 500, headers: { 'Content-Type': 'application/json', ...cors }
    });
  }
}

export async function onRequestOptions() {
  return new Response(null, {
    status: 204,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    }
  });
}
