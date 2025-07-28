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

// Variables d'environnement
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

// Endpoint /status
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
    console.error("❌ Erreur de connexion à OpenAI :", e);
  }

  res.json(status);
});

// Récupérer tous les fichiers
async function fetchVectorStoreFiles() {
  const response = await fetch(
    `https://api.openai.com/v1/vector_stores/${vectorStoreId}/files`,
    { headers: { Authorization: `Bearer ${apiKey}` } }
  );

  if (!response.ok) {
    const text = await response.text();
    console.error("❌ Erreur lors de la récupération des fichiers :", text);
    throw new Error(`Impossible de lister les fichiers (code ${response.status})`);
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
      } catch (err) {
        console.error(`⚠️ Impossible de récupérer les détails pour ${f.id}`, err);
        return { id: f.id, name: "Inconnu", created_at: "Inconnu" };
      }
    })
  );
}

// Upload d'un fichier
app.post("/files", upload.single("file"), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: "Aucun fichier reçu" });

    // Créer le formulaire compatible OpenAI
    const formData = new FormData();
    formData.append("file", req.file.buffer, req.file.originalname);

    const uploadResponse = await fetch(
      `https://api.openai.com/v1/vector_stores/${vectorStoreId}/files`,
      {
        method: "POST",
        headers: { Authorization: `Bearer ${apiKey}` },
        body: formData,
      }
    );

    if (!uploadResponse.ok) {
      const text = await uploadResponse.text();
      console.error(`❌ Erreur upload fichier (${req.file.originalname}) :`, text);
      return res.status(500).json({ error: `Erreur lors de l'upload (code ${uploadResponse.status})` });
    }

    // Associer le Vector Store à l'assistant
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

// Liste des fichiers
app.get("/files", async (req, res) => {
  try {
    const files = await fetchVectorStoreFiles();
    res.json({ success: true, files });
  } catch (error) {
    console.error("❌ Erreur lors de la récupération des fichiers :", error);
    res.status(500).json({ error: "Erreur serveur lors de la récupération" });
  }
});

// Suppression d'un fichier
app.delete("/files/:id", async (req, res) => {
  try {
    const fileId = req.params.id;

    await fetch(
      `https://api.openai.com/v1/vector_stores/${vectorStoreId}/files/${fileId}`,
      { method: "DELETE", headers: { Authorization: `Bearer ${apiKey}` } }
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

// Page par défaut
app.get("/", (req, res) => {
  res.send("API MasdelInc Chatbot en ligne (Vector Store actif)");
});

app.listen(port, () => {
  console.log(`🚀 Serveur API démarré sur http://localhost:${port}`);
});
