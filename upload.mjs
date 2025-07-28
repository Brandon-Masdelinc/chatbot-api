import express from "express";
import cors from "cors";
import multer from "multer";
import { OpenAI } from "openai";
import dotenv from "dotenv";
import { Readable } from "stream";
import fetch from "node-fetch";

dotenv.config();
const app = express();
const port = process.env.PORT || 3000;

const upload = multer();
app.use(cors());

const apiKey = process.env.OPENAI_API_KEY;
const assistantId = process.env.OPENAI_ASSISTANT_ID;
const vectorStoreId = process.env.OPENAI_VECTOR_STORE_ID;

const openai = new OpenAI({ apiKey });

// Vérification au démarrage
if (!apiKey || !assistantId || !vectorStoreId) {
  console.error(
    "❌ ERREUR DE CONFIGURATION : Vérifie ton .env ou les variables Render.\n" +
      `OPENAI_API_KEY: ${apiKey ? "OK" : "ABSENT"}\n` +
      `OPENAI_ASSISTANT_ID: ${assistantId ? "OK" : "ABSENT"}\n` +
      `OPENAI_VECTOR_STORE_ID: ${vectorStoreId ? "OK" : "ABSENT"}`
  );
  process.exit(1);
}

// Endpoint /status pour tester la config et la connexion OpenAI
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
  } catch (e) {
    status.openaiConnection = false;
  }

  res.json(status);
});

// Fonction pour lister les fichiers
async function fetchVectorStoreFiles() {
  const response = await fetch(
    `https://api.openai.com/v1/vector_stores/${vectorStoreId}/files`,
    {
      method: "GET",
      headers: { Authorization: `Bearer ${apiKey}` },
    }
  );

  if (!response.ok) {
    const text = await response.text();
    console.error("❌ Erreur lors de la récupération des fichiers :", text);
    throw new Error("Impossible de lister les fichiers.");
  }

  const data = await response.json();
  const files = await Promise.all(
    (data.data || []).map(async (f) => {
      const full = await openai.files.retrieve(f.id);
      return {
        id: full.id,
        name: full.filename,
        created_at: new Date(full.created_at * 1000).toLocaleString(),
      };
    })
  );
  return files;
}

// Upload d'un fichier vers le Vector Store
app.post("/files", upload.single("file"), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: "Aucun fichier reçu" });

    const bufferStream = new Readable();
    bufferStream.push(req.file.buffer);
    bufferStream.push(null);

    const uploadResponse = await fetch(
      `https://api.openai.com/v1/vector_stores/${vectorStoreId}/files`,
      {
        method: "POST",
        headers: { Authorization: `Bearer ${apiKey}` },
        body: bufferStream,
      }
    );

    if (!uploadResponse.ok) {
      const text = await uploadResponse.text();
      console.error("❌ Erreur upload fichier :", text);
      return res.status(500).json({ error: "Erreur lors de l'upload" });
    }

    await openai.assistants.update(assistantId, {
      tool_resources: { file_search: { vector_store_ids: [vectorStoreId] } },
    });

    console.log(`✅ Fichier "${req.file.originalname}" ajouté et lié à l’assistant.`);

    const files = await fetchVectorStoreFiles();
    res.json({ success: true, files });
  } catch (error) {
    console.error("❌ Erreur lors de l'upload :", error);
    res.status(500).json({ error: "Erreur serveur lors de l'upload" });
  }
});

// Endpoint pour lister les fichiers
app.get("/files", async (req, res) => {
  try {
    const files = await fetchVectorStoreFiles();
    res.json({ success: true, files });
  } catch (error) {
    console.error("❌ Erreur lors de la récupération des fichiers :", error);
    res.status(500).json({ error: "Erreur serveur lors de la récupération" });
  }
});

// Endpoint pour supprimer un fichier
app.delete("/files/:id", async (req, res) => {
  try {
    const fileId = req.params.id;

    await fetch(
      `https://api.openai.com/v1/vector_stores/${vectorStoreId}/files/${fileId}`,
      {
        method: "DELETE",
        headers: { Authorization: `Bearer ${apiKey}` },
      }
    );

    await openai.files.del(fileId);

    console.log(`🗑️ Fichier supprimé : ${fileId}`);

    const files = await fetchVectorStoreFiles();
    res.json({ success: true, files });
  } catch (error) {
    console.error("❌ Erreur suppression fichier :", error);
    res.status(500).json({ error: "Erreur serveur lors de la suppression" });
  }
});

// Page d’accueil simple
app.get("/", (req, res) => {
  res.send("API MasdelInc Chatbot en ligne (Vector Store actif)");
});

app.listen(port, () => {
  console.log(`🚀 Serveur API démarré sur http://localhost:${port}`);
});
