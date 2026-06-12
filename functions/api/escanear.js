// Cloudflare Pages Function — intermediario seguro con Claude API
// La clave NUNCA se expone al navegador: vive en una variable de entorno secreta.

export async function onRequestPost(context) {
  const { request, env } = context;

  // Cabeceras CORS para que el navegador pueda llamar
  const cors = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  };

  try {
    const body = await request.json();
    const { imageBase64, mediaType } = body;

    if (!imageBase64) {
      return new Response(JSON.stringify({ error: 'No se recibió ninguna imagen' }), {
        status: 400, headers: { 'Content-Type': 'application/json', ...cors }
      });
    }

    const prompt = `Eres un asistente de contabilidad. Analiza esta factura y extrae EXACTAMENTE estos datos en formato JSON, sin texto adicional, sin markdown:
{
  "proveedor": "nombre de la empresa que emite la factura",
  "fecha": "fecha en formato YYYY-MM-DD",
  "total": número total con IVA incluido (solo el número, punto decimal),
  "tipo_iva": "21", "10", "4" o "0" según el IVA aplicado,
  "numero_factura": "número de la factura si aparece, si no cadena vacía"
}
Si no encuentras algún dato, usa: proveedor "" , fecha de hoy, total 0, tipo_iva "21", numero_factura "".
Responde SOLO el JSON, nada más.`;

    const anthropicResp = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 512,
        messages: [{
          role: 'user',
          content: [
            { type: 'image', source: { type: 'base64', media_type: mediaType || 'image/jpeg', data: imageBase64 } },
            { type: 'text', text: prompt }
          ]
        }]
      })
    });

    if (!anthropicResp.ok) {
      const errText = await anthropicResp.text();
      return new Response(JSON.stringify({ error: 'Error de la IA', detail: errText }), {
        status: 502, headers: { 'Content-Type': 'application/json', ...cors }
      });
    }

    const data = await anthropicResp.json();
    let text = '';
    if (Array.isArray(data.content)) {
      text = data.content.filter(b => b.type === 'text').map(b => b.text).join('');
    }
    // Limpiar posibles ```json
    text = text.replace(/```json/g, '').replace(/```/g, '').trim();

    let parsed;
    try { parsed = JSON.parse(text); }
    catch (e) {
      return new Response(JSON.stringify({ error: 'No se pudo leer la factura', raw: text }), {
        status: 422, headers: { 'Content-Type': 'application/json', ...cors }
      });
    }

    return new Response(JSON.stringify({ ok: true, datos: parsed }), {
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
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    }
  });
}
