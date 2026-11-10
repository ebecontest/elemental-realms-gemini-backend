import express from 'express';
import cors from 'cors';

const app = express();
const port = Number(process.env.PORT || 3001);

const allowedOrigin = process.env.ALLOWED_ORIGIN || '*';

app.use(cors({
  origin: allowedOrigin === '*'
    ? true
    : allowedOrigin.split(',').map(v => v.trim())
}));

app.use(express.json({ limit: '2mb' }));

app.get('/health', (_req, res) => {
  res.json({
    ok: true,
    service: 'elemental-realms-gemini-backend'
  });
});

app.post('/api/chat', async (req, res) => {
  try {
    const apiKey = process.env.GEMINI_API_KEY;

    if (!apiKey) {
      return res.status(503).json({
        error: 'GEMINI_API_KEY is missing.'
      });
    }

    const message = typeof req.body?.message === 'string'
      ? req.body.message.trim()
      : '';

    if (!message) {
      return res.status(400).json({
        error: 'Message is required.'
      });
    }

    if (message.length > 8000) {
      return res.status(413).json({
        error: 'Message too long.'
      });
    }

    const history = Array.isArray(req.body?.history)
      ? req.body.history.slice(-12)
      : [];

    const contents = history
      .filter(item =>
        ['user', 'assistant'].includes(item?.role) &&
        typeof item?.text === 'string'
      )
      .map(item => ({
        role: item.role === 'assistant' ? 'model' : 'user',
        parts: [{ text: item.text.slice(0, 8000) }]
      }));

    contents.push({
      role: 'user',
      parts: [{ text: message }]
    });

    const model = process.env.GEMINI_MODEL || 'gemini-2.5-flash';

    const upstream = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(apiKey)}`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          systemInstruction: {
            parts: [{
              text: 'You are the creative AI assistant for ELEMENTAL REALMS Art Studio. Help design anime fantasy pixel-art characters, monsters, items, seven elements Fire Water Leaf Lightning Chaos Light Earth, sprite specifications and animation plans.'
            }]
          },
          contents,
          generationConfig: {
            maxOutputTokens: 1800
          }
        })
      }
    );

    const data = await upstream.json();

    if (!upstream.ok) {
      console.error(data);
      return res.status(502).json({
        error: 'Gemini API request failed. Check API key or quota.'
      });
    }

    const text = (data.candidates?.[0]?.content?.parts || [])
      .map(part => part.text || '')
      .join('\n');

    res.json({ text });

  } catch (error) {
    console.error(error);

    res.status(500).json({
      error: 'Backend server error.'
    });
  }
});

app.listen(port, () => {
  console.log(
    `ELEMENTAL REALMS Gemini backend running on ${port}`
  );
});
