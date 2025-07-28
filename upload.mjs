import express from "express";
import cors from "cors";
import multer from "multer";
import { OpenAI } from "openai";
import dotenv from "dotenv";
import fetch from "node-fetch";
import FormData from "form-data";

dotenv.config();
const app = express();
const port = process.env.PORT || 3000;

const upload = multer();
app.use(cors());

const apiKey = process.env.OPENAI_API_KEY;
const assistantId = process.env.OPENAI_ASSISTANT_ID;
const vectorStoreId = process.env.OPENAI_VECTOR_STORE_ID;

const openai = new OpenAI({ apiKey });

// Vérification config
if (!apiKey || !assistantId || !vectorStoreId) {
  console.error("❌ Variables d'environnement manquantes !");
  process.exit(1);
}

// Vérifier OpenAI
app.get("/status", async (req, res) => {
  const status = {
    OPENAI_API_KEY: !!apiKey,
    OPENAI_ASSISTANT_ID: !!assistantId,
    OPENAI_VECTOR_STORE_ID: !!vectorStoreId,
    openaiConnection: false,
  };

  try {
    const resp = await fetch(`https://api.openai.com/v1/vector_stores/${vectorStoreId}/files`, {
      headers: { Authorization: `Bearer ${apiKey}` },
    });
    status.openaiConnection = resp.ok;
  } catch {
    status.openaiConnection = false;
  }

  res.json(status);
});

// Récupérer fichiers
async function fetchVectorStoreFiles() {
  const response = await fetch(
    `https://api.openai.com/v1/vector_stores/${vectorStoreId}/files`,
    { headers: { Authorization: `Bearer ${apiKey}` } }
  );
  if (!response.ok) throw new Error(`Erreur API (code ${response.status})`);
  const data = await response.json();

  return Promise.all(
    (data.data || []).map(async (f) => {
      try {
        const full = await openai.files.retrieve(f.id);
        return {
          id: full.id,
          name: full.filename,
          created_at: new Date(full.created_at * 1000).toLocaleString(),
        };
      } catch {
        return { id: f.id, name: "Inconnu", created_at: "Inconnu" };
      }
    })
  );
}

// Upload fichier
app.post("/files", upload.single("file"), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: "Aucun fichier reçu" });

    const form = new FormData();
    form.append("file", req.file.buffer, req.file.originalname);

    const uploadResponse = await fetch(
      `https://api.openai.com/v1/vector_stores/${vectorStoreId}/files`,
      { method: "POST", headers: { Authorization: `Bearer ${apiKey}` }, body: form }
    );

    if (!uploadResponse.ok) {
      const text = await uploadResponse.text();
      console.error(`❌ Erreur upload (${req.file.originalname}):`, text);
      return res.status(500).json({ error: text });
    }

    await openai.assistants.update(assistantId, {
      tool_resources: { file_search: { vector_store_ids: [vectorStoreId] } },
    });

    console.log(`✅ Fichier "${req.file.originalname}" ajouté.`);
    const files = await fetchVectorStoreFiles();
    res.json({ success: true, files });
  } catch (err) {
    console.error("❌ Erreur upload serveur:", err);
    res.status(500).json({ error: "Erreur interne lors de l'upload" });
  }
});

// Liste fichiers
app.get("/files", async (req, res) => {
  try {
    const files = await fetchVectorStoreFiles();
    res.json({ success: true, files });
  } catch (err) {
    res.status(500).json({ error: "Impossible de récupérer les fichiers" });
  }
});

// Suppression fichier
app.delete("/files/:id", async (req, res) => {
  try {
    const fileId = req.params.id;
    await fetch(
      `https://api.openai.com/v1/vector_stores/${vectorStoreId}/files/${fileId}`,
      { method: "DELETE", headers: { Authorization: `Bearer ${apiKey}` } }
    );
    await openai.files.del(fileId);
    const files = await fetchVectorStoreFiles();
    res.json({ success: true, files });
  } catch (err) {
    res.status(500).json({ error: "Erreur lors de la suppression" });
  }
});

// Page test
app.get("/", (req, res) => res.send("API Chatbot Render OK"));

app.listen(port, () => console.log(`🚀 API démarrée sur http://localhost:${port}`));
