
import express from "express";
import cors from "cors";

const app = express();
const port = Number(process.env.PORT || 3001);
const allowedOrigin = process.env.ALLOWED_ORIGIN || "*";

app.use(
  cors({
    origin:
      allowedOrigin === "*"
        ? true
        : allowedOrigin.split(",").map((v) => v.trim()),
  })
);

app.use(express.json({ limit: "2mb" }));

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

app.get("/health", (_req, res) => {
  res.json({
    ok: true,
    service: "elemental-realms-gemini-backend",
  });
});

async function requestGeminiWithRetry(url, options) {
  const maxAttempts = 3;
  let lastResponse;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const response = await fetch(url, options);

    if (response.ok) return response;

    const data = await response.json().catch(() => ({}));

    console.error("Gemini API error:", {
      attempt,
      status: response.status,
      message: data.error?.message || "Unknown Gemini API error",
    });

    lastResponse = {
      status: response.status,
      data,
    };

    const temporaryError = [429, 500, 502, 503, 504].includes(
      response.status
    );

    if (!temporaryError || attempt === maxAttempts) break;

    const delay = 1500 * 2 ** (attempt - 1);
    console.log(`Retrying Gemini in ${delay}ms...`);
    await sleep(delay);
  }

  const error = new Error(
    lastResponse?.data?.error?.message || "Gemini request failed."
  );

  error.status = lastResponse?.status || 502;
  throw error;
}

app.post("/api/chat", async (req, res) => {
  try {
    const apiKey = process.env.GEMINI_API_KEY;

    if (!apiKey) {
      return res.status(503).json({
        error: "Backend is not configured: GEMINI_API_KEY is missing.",
      });
    }

    const message =
      typeof req.body?.message === "string"
        ? req.body.message.trim()
        : "";

    if (!message) {
      return res.status(400).json({
        error: "Message is required.",
      });
    }

    if (message.length > 8000) {
      return res.status(413).json({
        error: "Message is too long (max 8,000 characters).",
      });
    }

    const history = Array.isArray(req.body?.history)
      ? req.body.history.slice(-12)
      : [];

    const contents = history
      .filter(
        (item) =>
          ["user", "assistant"].includes(item?.role) &&
          typeof item?.text === "string"
      )
      .map((item) => ({
        role: item.role === "assistant" ? "model" : "user",
        parts: [{ text: item.text.slice(0, 8000) }],
      }));

    contents.push({
      role: "user",
      parts: [{ text: message }],
    });

    const model = process.env.GEMINI_MODEL || "gemini-3.8-flash";

    const url =
      `https://generativelanguage.googleapis.com/v1beta/models/` +
      `${encodeURIComponent(model)}:generateContent?key=` +
      `${encodeURIComponent(apiKey)}`;

    const upstream = await requestGeminiWithRetry(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        systemInstruction: {
          parts: [
            {
              text:
                "You are the creative production assistant inside ELEMENTAL REALMS Art Studio. " +
                "Help create colourful anime fantasy pixel-art assets for a 2.5D action RPG. " +
                "The world has seven elements: Fire, Water, Leaf, Lightning, Chaos, Light, and Earth. " +
                "Give practical sprite specifications, readable silhouettes, palette suggestions, " +
                "frame-by-frame animation plans, and concise prompts. " +
                "Do not claim to have edited or exported files unless an actual tool did so.",
            },
          ],
        },
        contents,
        generationConfig: {
          maxOutputTokens: 1800,
        },
      }),
    });

    const data = await upstream.json();

    const text = (data.candidates?.[0]?.content?.parts || [])
      .map((part) => part.text || "")
      .join("\n");

    if (!text) {
      return res.status(502).json({
        error: "Gemini returned an empty response. Please try again.",
      });
    }

    return res.json({ text });
  } catch (error) {
    console.error("Gemini request failed:", error);

    const status = [429, 503].includes(error.status)
      ? error.status
      : 502;

    return res.status(status).json({
      error:
        status === 503
          ? "Gemini is temporarily busy. Please try again shortly."
          : status === 429
            ? "Gemini request limit reached. Please try again later."
            : "Gemini request failed. Check backend logs for details.",
    });
  }
});

app.listen(port, () => {
  console.log(
    `ELEMENTAL REALMS Gemini backend listening on ${port}`
  );
});
