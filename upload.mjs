import express from "express";
import cors from "cors";
import multer from "multer";
import { OpenAI } from "openai";
import dotenv from "dotenv";
import fetch from "node-fetch";
import { Readable } from "stream";

dotenv.config();
const app = express();
const port = process.env.PORT || 3000;

// Middleware pour body brut (si ce n’est pas du multipart)
app.use(express.raw({ type: "application/octet-stream", limit: "50mb" }));

const upload = multer();
app.use(cors());

const apiKey = process.env.OPENAI_API_KEY;
const assistantId = process.env.OPENAI_ASSISTANT_ID;
const vectorStoreId = process.env.OPENAI_VECTOR_STORE_ID;

const openai = new OpenAI({ apiKey });

// Vérification config
if (!apiKey || !assistantId || !vectorStoreId) {
  console.error(
    "❌ ERREUR DE CONFIGURATION - Variables manquantes :",
    {
      OPENAI_API_KEY: !!apiKey,
      OPENAI_ASSISTANT_ID: !!assistantId,
      OPENAI_VECTOR_STORE_ID: !!vectorStoreId,
    }
  );
  process.exit(1);
}

// Vérification /status
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
    console.error("❌ Connexion OpenAI impossible :", e);
  }

  res.json(status);
});

// Fonction pour lister les fichiers
async function fetchVectorStoreFiles() {
  console.log("🔍 Récupération de la liste des fichiers…");
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
  console.log(`📂 ${data.data?.length || 0} fichiers trouvés`);
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
        console.error(`⚠️ Impossible de récupérer le détail du fichier ${f.id}`, err);
        return { id: f.id, name: "Inconnu", created_at: "Inconnu" };
      }
    })
  );
}

// Endpoint upload (multipart OU brut)
app.post("/files", upload.single("file"), async (req, res) => {
  try {
    let fileName;
    let fileBuffer;

    // Cas 1 : multipart (depuis app Shopify/admin)
    if (req.file) {
      fileName = req.file.originalname;
      fileBuffer = req.file.buffer;
    }
    // Cas 2 : upload brut (depuis curl.exe ou script)
    else if (req.headers["content-type"] === "application/octet-stream") {
      fileName = "upload-raw.bin";
      fileBuffer = req.body;
    } else {
      return res.status(400).json({ error: "Aucun fichier reçu" });
    }

    console.log("📤 Début upload :", fileName);

    // Convertir le buffer en flux lisible (obligatoire pour OpenAI)
    const stream = new Readable();
    stream.push(fileBuffer);
    stream.push(null);

    console.log("➡️ Upload via SDK OpenAI…");
    const uploadedFile = await openai.files.create({
      file: stream,
      purpose: "assistants",
      filename: fileName,
    });

    // Associer au Vector Store
    await openai.vectorStores.files.create(vectorStoreId, {
      file_id: uploadedFile.id,
    });

    console.log(`✅ Fichier "${fileName}" ajouté et lié à ${vectorStoreId}`);

    // Relier le Vector Store à l’assistant
    try {
      await openai.assistants.update(assistantId, {
        tool_resources: { file_search: { vector_store_ids: [vectorStoreId] } },
      });
      console.log("✅ Vector Store lié à l’assistant");
    } catch (err) {
      console.error("⚠️ Impossible de lier le Vector Store à l’assistant :", err);
    }

    const files = await fetchVectorStoreFiles();
    res.json({ success: true, files });
  } catch (err) {
    console.error("❌ Erreur interne upload (SDK):", err);
    res.status(500).json({ error: err.message || "Erreur serveur lors de l'upload" });
  }
});

// Liste fichiers
app.get("/files", async (req, res) => {
  try {
    const files = await fetchVectorStoreFiles();
    res.json({ success: true, files });
  } catch (err) {
    console.error("❌ Erreur liste fichiers :", err);
    res.status(500).json({ error: "Erreur serveur" });
  }
});

// Suppression fichier
app.delete("/files/:id", async (req, res) => {
  const fileId = req.params.id;
  console.log(`🗑️ Suppression fichier : ${fileId}`);
  try {
    const delRes = await fetch(
      `https://api.openai.com/v1/vector_stores/${vectorStoreId}/files/${fileId}`,
      { method: "DELETE", headers: { Authorization: `Bearer ${apiKey}` } }
    );
    console.log(`🔎 Réponse suppression vector store (code ${delRes.status})`);
    await openai.files.del(fileId);
    const files = await fetchVectorStoreFiles();
    res.json({ success: true, files });
  } catch (err) {
    console.error("❌ Erreur suppression fichier :", err);
    res.status(500).json({ error: "Erreur serveur suppression" });
  }
});

// Page test
app.get("/", (req, res) =>
  res.send("API MasdelInc Chatbot - Compatible multipart + octet-stream (SDK)")
);

app.listen(port, () => console.log(`🚀 API démarrée sur http://localhost:${port}`));
