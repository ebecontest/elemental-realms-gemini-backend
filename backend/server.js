
import express from "express";
import cors from "cors";

const app = express();
const port = Number(process.env.PORT || 3001);

const allowedOrigin = process.env.ALLOWED_ORIGIN || "*";

app.use(cors({
  origin: allowedOrigin === "*"
    ? true
    : allowedOrigin.split(",").map(v => v.trim())
}));

app.use(express.json({ limit: "2mb" }));

const SYSTEM_PROMPT = `
You are the creative production assistant inside ELEMENTAL REALMS Art Studio.

Help create colourful anime fantasy pixel-art assets for a 2.5D action RPG.

The world has seven elements:
Fire, Water, Leaf, Lightning, Chaos, Light, and Earth.

Help with:
- Character and monster design
- Pixel-art sprites and sprite sheets
- Animation frame specifications
- Game environments and props
- Colour palettes and visual direction
- Image-generation prompts
- Practical game-art production workflows

Give clear, detailed and practical answers.
Do not claim to have edited or exported files unless an actual tool did so.
`;

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

app.get("/health", (_req, res) => {
  res.json({
    ok: true,
    service: "elemental-realms-openai-backend"
  });
});

// Keep the existing frontend model-list contract.
app.get("/api/models", (_req, res) => {
  const model = process.env.OPENAI_MODEL || "gpt-5.5";

  res.json({
    count: 1,
    models: [{
      name: model,
      displayName: model
    }]
  });
});

async function requestOpenAI(payload) {
  const apiKey = process.env.OPENAI_API_KEY;

  if (!apiKey) {
    const error = new Error("OPENAI_API_KEY is missing.");
    error.status = 503;
    throw error;
  }

  let lastError;

  for (let attempt = 1; attempt <= 3; attempt++) {
    const response = await fetch(
      "https://api.openai.com/v1/responses",
      {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${apiKey}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify(payload)
      }
    );

    const data = await response.json().catch(() => ({}));

    if (response.ok) return data;

    lastError = {
      status: response.status,
      message: data.error?.message || "OpenAI request failed."
    };

    console.error("OpenAI API error:", {
      attempt,
      status: lastError.status,
      message: lastError.message
    });

    const temporary = [429, 500, 502, 503, 504]
      .includes(response.status);

    if (!temporary || attempt === 3) break;

    await sleep(1500 * (2 ** (attempt - 1)));
  }

  const error = new Error(lastError?.message || "OpenAI request failed.");
  error.status = lastError?.status || 502;
  throw error;
}

app.post("/api/chat", async (req, res) => {
  try {
    const message = typeof req.body?.message === "string"
      ? req.body.message.trim()
      : "";

    if (!message) {
      return res.status(400).json({
        error: "Message is required."
      });
    }

    if (message.length > 8000) {
      return res.status(413).json({
        error: "Message is too long (max 8,000 characters)."
      });
    }

    const history = Array.isArray(req.body?.history)
      ? req.body.history.slice(-12)
      : [];

    const input = history
      .filter(item =>
        ["user", "assistant"].includes(item?.role) &&
        typeof item?.text === "string"
      )
      .map(item => ({
        role: item.role,
        content: [{
          type: "input_text",
          text: item.text.slice(0, 8000)
        }]
      }));

    input.push({
      role: "user",
      content: [{
        type: "input_text",
        text: message
      }]
    });

    const model = process.env.OPENAI_MODEL || "gpt-5.5";

    const data = await requestOpenAI({
      model,
      instructions: SYSTEM_PROMPT,
      input,
      max_output_tokens: 1800,
      store: false
    });

    const answer = (data.output || [])
      .flatMap(item => item.content || [])
      .filter(item => item.type === "output_text")
      .map(item => item.text || "")
      .join("\n");

    if (!answer) {
      console.error("OpenAI returned no output text.");
      return res.status(502).json({
        error: "OpenAI returned an empty response. Please try again."
      });
    }

    return res.json({ text: answer });

  } catch (error) {
    console.error("Chat request failed:", {
      status: error.status,
      message: error.message
    });

    const status = [401, 429, 503].includes(error.status)
      ? error.status
      : 502;

    const messages = {
      401: "OpenAI API key is invalid or unauthorized. Check Render Environment.",
      429: "OpenAI API usage limit reached. Check API billing and limits.",
      503: "OpenAI backend is not configured or temporarily unavailable.",
      502: "OpenAI request failed. Check Render logs."
    };

    return res.status(status).json({
      error: messages[status]
    });
  }
});

app.listen(port, () => {
  console.log(
    `ELEMENTAL REALMS OpenAI backend listening on ${port}`
  );
});
