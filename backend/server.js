
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

Help create colourful anime fantasy pixel-art assets
for a 2.5D action RPG.

The seven elements are:
Fire, Water, Leaf, Lightning, Chaos, Light, and Earth.

Help with:
- Character and monster design
- Pixel-art sprites and sprite sheets
- Animation frame specifications
- Game environments and props
- Colour palettes
- Image-generation prompts
- Unity and Godot asset specifications
- Game development and debugging

Give practical, detailed and clear answers.
Use headings and lists when useful.
Never claim to have exported files unless an actual tool did so.
`;

const sleep = ms =>
  new Promise(resolve => setTimeout(resolve, ms));

// HEALTH CHECK
app.get("/health", (_req, res) => {
  res.json({
    ok: true,
    service: "elemental-realms-gemini-backend"
  });
});

// MODEL LIST
app.get("/api/models", (_req, res) => {
  const model = process.env.GEMINI_MODEL || "gemini-3.8-flash";

  res.json({
    count: 1,
    models: [{
      name: model,
      displayName: model
    }]
  });
});

// GEMINI REQUEST WITH RETRIES
async function requestGemini(url, options) {
  let lastError;

  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const response = await fetch(url, options);
      const data = await response.json().catch(() => ({}));

      if (response.ok) return data;

      lastError = {
        status: response.status,
        message: data.error?.message || "Unknown Gemini error"
      };

      console.error("Gemini API error:", {
        attempt,
        ...lastError
      });

      const temporary = [
        429, 500, 502, 503, 504
      ].includes(response.status);

      if (!temporary || attempt === 3) break;

    } catch (error) {
      lastError = {
        status: 502,
        message: error.message
      };

      console.error("Gemini network error:", error.message);

      if (attempt === 3) break;
    }

    await sleep(1500 * (2 ** (attempt - 1)));
  }

  const error = new Error(
    lastError?.message || "Gemini request failed."
  );

  error.status = lastError?.status || 502;

  throw error;
}

// CHAT ENDPOINT
app.post("/api/chat", async (req, res) => {
  try {
    const apiKey = process.env.GEMINI_API_KEY;

    if (!apiKey) {
      return res.status(503).json({
        error: "GEMINI_API_KEY is missing."
      });
    }

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

    const contents = history
      .filter(item =>
        ["user", "assistant"].includes(item?.role) &&
        typeof item?.text === "string"
      )
      .map(item => ({
        role: item.role === "assistant" ? "model" : "user",
        parts: [{
          text: item.text.slice(0, 8000)
        }]
      }));

    contents.push({
      role: "user",
      parts: [{
        text: message
      }]
    });

    const model =
      process.env.GEMINI_MODEL || "gemini-3.8-flash";

    const url =
      `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`;

    const data = await requestGemini(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        systemInstruction: {
          parts: [{
            text: SYSTEM_PROMPT
          }]
        },
        contents,
        generationConfig: {
          maxOutputTokens: 1800
        }
      })
    });

    const answer = (data.candidates?.[0]?.content?.parts || [])
      .map(part => part.text || "")
      .join("\n");

    if (!answer) {
      console.error("Gemini returned empty response:", {
        finishReason: data.candidates?.[0]?.finishReason
      });

      return res.status(502).json({
        error: "Gemini returned an empty response. Please try again."
      });
    }

    return res.json({
      text: answer
    });

  } catch (error) {
    console.error("Gemini chat failed:", {
      status: error.status,
      message: error.message
    });

    const status = [429, 503].includes(error.status)
      ? error.status
      : 502;

    let message;

    if (status === 429) {
      message = "Gemini API limit reached. Please try again later.";
    } else if (status === 503) {
      message = "Gemini is temporarily unavailable.";
    } else {
      message = "Gemini request failed. Check Render logs.";
    }

    return res.status(status).json({
      error: message
    });
  }
});

// START SERVER
app.listen(port, () => {
  console.log(
    `ELEMENTAL REALMS Gemini backend listening on ${port}`
  );
});
