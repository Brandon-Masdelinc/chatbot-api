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

// Chargement des variables d'environnement
const apiKey = process.env.OPENAI_API_KEY;
const assistantId = process.env.OPENAI_ASSISTANT_ID;
const vectorStoreId = process.env.OPENAI_VECTOR_STORE_ID;

// Initialisation du client OpenAI
const openai = new OpenAI({ apiKey });

// Vérification de la configuration
if (!apiKey || !assistantId || !vectorStoreId) {
  console.error(
    "❌ ERREUR DE CONFIGURATION : Certaines variables sont manquantes.\n" +
      `OPENAI_API_KEY: ${apiKey ? "OK" : "ABSENT"}\n` +
      `OPENAI_ASSISTANT_ID: ${assistantId ? "OK" : "ABSENT"}\n` +
      `OPENAI_VECTOR_STORE_ID: ${vectorStoreId ? "OK" : "ABSENT"}`
  );
  process.exit(1);
}

// Vérification du statut
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

// Récupération de la liste des fichiers du Vector Store
async function fetchVectorStoreFiles() {
  const response = await fetch(
    `https://api.openai.com/v1/vector_stores/${vectorStoreId}/files`,
    { headers: { Authorization: `Bearer ${apiKey}` } }
  );

  if (!response.ok) {
    const text = await response.text();
    console.error(`❌ Échec récupération fichiers (code ${response.status}):`, text);
    throw new Error(`Impossible de lister les fichiers`);
  }

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

// Upload d’un fichier vers le Vector Store
app.post("/files", upload.single("file"), async (req, res) => {
  console.log("📤 Début upload :", req.file?.originalname || "Aucun fichier");
  try {
    if (!req.file) return res.status(400).json({ error: "Aucun fichier reçu" });

    const form = new FormData();
    form.append("file", req.file.buffer, req.file.originalname);

    console.log("➡️ Envoi du fichier à OpenAI (Vector Store)…");
    const uploadResponse = await fetch(
      `https://api.openai.com/v1/vector_stores/${vectorStoreId}/files`,
      {
        method: "POST",
        headers: { Authorization: `Bearer ${apiKey}`, ...form.getHeaders() },
        body: form,
      }
    );

    const raw = await uploadResponse.text();
    if (!uploadResponse.ok) {
      console.error(`❌ Upload refusé (code ${uploadResponse.status}):`, raw);
      return res.status(500).json({ error: `Upload refusé : ${raw}` });
    }

    console.log("✅ Upload réussi :", raw);

    // Associer le Vector Store à l'assistant
    try {
      await openai.assistants.update(assistantId, {
        tool_resources: { file_search: { vector_store_ids: [vectorStoreId] } },
      });
    } catch (err) {
      console.error("⚠️ Impossible de lier le Vector Store :", err);
    }

    const files = await fetchVectorStoreFiles();
    res.json({ success: true, files });
  } catch (err) {
    console.error("❌ Erreur interne upload :", err);
    res.status(500).json({ error: "Erreur serveur lors de l'upload" });
  }
});

// Liste des fichiers
app.get("/files", async (req, res) => {
  try {
    const files = await fetchVectorStoreFiles();
    res.json({ success: true, files });
  } catch (err) {
    res.status(500).json({ error: "Erreur serveur" });
  }
});

// Suppression d’un fichier
app.delete("/files/:id", async (req, res) => {
  const fileId = req.params.id;
  console.log(`🗑️ Suppression fichier : ${fileId}`);
  try {
    await fetch(
      `https://api.openai.com/v1/vector_stores/${vectorStoreId}/files/${fileId}`,
      { method: "DELETE", headers: { Authorization: `Bearer ${apiKey}` } }
    );
    await openai.files.del(fileId);
    const files = await fetchVectorStoreFiles();
    res.json({ success: true, files });
  } catch (err) {
    console.error("❌ Erreur suppression :", err);
    res.status(500).json({ error: "Erreur suppression" });
  }
});

// Page d'accueil simple
app.get("/", (req, res) => res.send("API MasdelInc Chatbot (Vector Store v2025)"));

app.listen(port, () => console.log(`🚀 API démarrée sur http://localhost:${port}`));
