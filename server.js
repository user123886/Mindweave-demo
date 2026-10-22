import "dotenv/config";
import express from "express";
import { GoogleGenAI } from "@google/genai";
import { TinyFish } from "@tiny-fish/sdk";
import fs from "fs";
import path from "path";

const app = express();
const port = 3000;

// Initialize Google Gen AI SDK & TinyFish SDK[cite: 1]
const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
const tinyfish = new TinyFish();

app.use(express.json());
app.use(express.static("public"));

function cleanHtmlOutput(text) {
  return text
    .replace(/^```html\s*/i, "")
    .replace(/^```\s*/, "")
    .replace(/```$/, "")
    .trim();
}

// Retry wrapper with "Keep Trying" logic
async function generateWithRetry(prompt, maxRetries = 3, delayMs = 2000) {
  let attempt = 0;
  while (attempt < maxRetries) {
    try {
      attempt++;
      console.log(`[Attempt ${attempt}/${maxRetries}] Generating content with Gemini...`);
      const response = await ai.models.generateContent({
        model: "gemini-flash-latest", 
        contents: prompt,
      });
      return response;
    } catch (error) {
      console.warn(`Attempt ${attempt} failed: ${error.message}`);
      if (attempt >= maxRetries) {
        throw new Error(`Failed after ${maxRetries} attempts. Last error: ${error.message}`);
      }
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }
}

app.post("/api/generate", async (req, res) => {
  const { concept } = req.body;

  if (!concept) {
    return res.status(400).json({ error: "No concept provided." });
  }

  let liveWebContext = "";

  try {
    console.log(`🌐 TinyFish AI fetching live web context for: "${concept}"...`);
    
    // Use TinyFish Fetch API to retrieve live web documentation/search results
    const searchUrl = `[https://html.duckduckgo.com/html/?q=$](https://html.duckduckgo.com/html/?q=$){encodeURIComponent(concept + " explanation physics or mechanics")}`;
    const tinyFishResponse = await tinyfish.fetch.get_contents([searchUrl], {
      format: "markdown",
      per_url_timeout_ms: 15000
    });

    if (tinyFishResponse && tinyFishResponse.results && tinyFishResponse.results.length > 0) {
      liveWebContext = tinyFishResponse.results[0].content || "";
      console.log("✅ TinyFish successfully fetched live web data!");
    }
  } catch (tfError) {
    console.warn("⚠️ TinyFish fetch encountered an issue, proceeding with direct Gemini knowledge:", tfError.message);
  }

  try {
    const prompt = `
You are an expert interactive visual developer and educator.
Create a complete, single-file HTML page containing inline JavaScript and CSS that provides:
1. A clear, comprehensive written explanation of the concept: "${concept}".
2. A fully functional, visually appealing interactive web simulation explaining or demonstrating the concept: "${concept}".
3. An interactive quiz section placed immediately below the simulation containing 3 multiple-choice questions with instant feedback and a score tracker to test the user's understanding of "${concept}".

Live Web Context retrieved via TinyFish AI (use for accurate grounding):
${liveWebContext.substring(0, 3000)}

Requirements:
- Use modern, responsive CSS styling for a clean dark-mode UI (readable explanation typography, simulation controls, nicely spaced layout, and clear interactive quiz cards).
- Use HTML5 Canvas/SVG for the simulation logic, and standard JavaScript for quiz selection, answer validation, and score updates.
- Output ONLY valid, clean HTML code inside an <html> document. Do NOT include markdown explanations, intro/outro text, or markdown code blocks outside the pure source code.
`;

    const response = await generateWithRetry(prompt, 3, 2000);
    const rawCode = response.text;
    const cleanedHtml = cleanHtmlOutput(rawCode);

    const fileName = "simulation.html";
    const filePath = path.join(process.cwd(), "public", fileName);
    fs.writeFileSync(filePath, cleanedHtml, "utf8");

    res.json({ success: true, fileUrl: `/${fileName}` });
  } catch (error) {
    console.error("Error generating explanation and simulation:", error);
    res.status(500).json({ error: "Failed to generate explanation, simulation and quiz after multiple attempts. Please try again." });
  }
});

app.listen(port, () => {
  console.log(`Server running at http://localhost:${port}`);
});