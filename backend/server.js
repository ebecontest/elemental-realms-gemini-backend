
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

You help create colourful anime fantasy pixel-art assets for a 2.5D action RPG.

The world has seven elements:
Fire, Water, Leaf, Lightning, Chaos, Light, and Earth.

Help with:
- Character and monster design
- Pixel-art sprites and sprite sheets
- Animation frame specifications
- Game environments and props
- Colour palettes and visual direction
- Image-generation prompts
- Game-art production workflows
- Unity and Godot asset specifications

Give clear, detailed and practical answers.
Use headings and lists when useful.
Do not claim to have edited or exported files unless an actual tool did so.
`;

const sleep = ms =>
  new Promise(resolve => setTimeout(resolve, ms));

// HEALTH CHECK
app.get("/health", (_req, res) => {
  res.json({
    ok: true,
    service: "elemental-realms-openai-backend"
  });
});

// MODEL INFORMATION
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

// OPENAI REQUEST WITH RETRIES
async function requestOpenAI(payload) {
  const apiKey = process.env.OPENAI_API_KEY;

  if (!apiKey) {
    const error = new Error("OPENAI_API_KEY is missing.");
    error.status = 503;
    throw error;
  }

  let lastError;

  for (let attempt = 1; attempt <= 3; attempt++) {
    let response;
    let data;

    try {
      response = await fetch(
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

      data = await response.json().catch(() => ({}));

    } catch (networkError) {
      lastError = {
        status: 502,
        message: networkError.message
      };

      console.error("OpenAI network error:", lastError);

      if (attempt === 3) break;

      await sleep(1500 * (2 ** (attempt - 1)));
      continue;
    }

    if (response.ok) {
      return data;
    }

    lastError = {
      status: response.status,
      message: data.error?.message || "Unknown OpenAI error"
    };

    console.error("OpenAI API error:", {
      attempt,
      status: lastError.status,
      message: lastError.message
    });

    const temporary = [
      429, 500, 502, 503, 504
    ].includes(response.status);

    if (!temporary || attempt === 3) {
      break;
    }

    await sleep(1500 * (2 ** (attempt - 1)));
  }

  const error = new Error(
    lastError?.message || "OpenAI request failed."
  );

  error.status = lastError?.status || 502;

  throw error;
}

// CHAT ENDPOINT
app.post("/api/chat", async (req, res) => {
  try {
    const message =
      typeof req.body?.message === "string"
        ? req.body.message.trim()
        : "";

    if (!message) {
      return res.status(400).json({
        error: "Message is required."
      });
    }

    if (message.length > 8000) {
      return res.status(413).json({
        error: "Message is too long. Maximum 8,000 characters."
      });
    }

    const history = Array.isArray(req.body?.history)
      ? req.body.history.slice(-12)
      : [];

    // Use plain string content for both user and assistant.
    // This avoids incorrect input_text/output_text type errors.
    const input = history
      .filter(item =>
        ["user", "assistant"].includes(item?.role) &&
        typeof item?.text === "string"
      )
      .map(item => ({
        role: item.role,
        content: item.text.slice(0, 8000)
      }));

    // Add the latest user message.
    input.push({
      role: "user",
      content: message
    });

    const model =
      process.env.OPENAI_MODEL || "gpt-5.5";

    const data = await requestOpenAI({
      model,
      instructions: SYSTEM_PROMPT,
      input,
      max_output_tokens: 1800,
      store: false
    });

    // Extract generated text from Responses API output.
    const answer = (data.output || [])
      .flatMap(item => item.content || [])
      .filter(item => item.type === "output_text")
      .map(item => item.text || "")
      .join("\n");

    if (!answer) {
      console.error(
        "OpenAI returned an empty response."
      );

      return res.status(502).json({
        error: "OpenAI returned an empty response. Please try again."
      });
    }

    return res.json({
      text: answer
    });

  } catch (error) {
    console.error("Chat request failed:", {
      status: error.status,
      message: error.message
    });

    const status = [
      401, 429, 503
    ].includes(error.status)
      ? error.status
      : 502;

    let message;

    if (status === 401) {
      message = "OpenAI API key is invalid or unauthorized.";
    } else if (status === 429) {
      message = "OpenAI usage limit reached. Check API billing.";
    } else if (status === 503) {
      message = "OpenAI backend is not configured or unavailable.";
    } else {
      message = "OpenAI request failed. Check Render logs.";
    }

    return res.status(status).json({
      error: message
    });
  }
});

// START SERVER
app.listen(port, () => {
  console.log(
    `ELEMENTAL REALMS OpenAI backend listening on ${port}`
  );
});
