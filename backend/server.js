
app.get("/api/models", async (_req, res) => {
  try {
    const apiKey = process.env.GEMINI_API_KEY;
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models?key=${encodeURIComponent(apiKey)}`
    );
    const data = await response.json();

    if (!response.ok) {
      return res.status(502).json({
        error: data.error?.message || "Model list unavailable",
      });
    }

    const models = (data.models || [])
      .filter(
        (m) =>
          m.name?.includes("gemini") &&
          m.supportedGenerationMethods?.includes("generateContent")
      )
      .map((m) => ({
        name: m.name,
        displayName: m.displayName,
      }));

    res.json({ count: models.length, models });
  } catch (error) {
    console.error("Model discovery failed:", error);
    res.status(502).json({ error: "Model discovery failed" });
  }
});
