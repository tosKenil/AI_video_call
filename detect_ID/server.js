require('dotenv').config();
const express = require('express');
const multer = require('multer');
const fs = require('fs');
const axios = require('axios');
const FormData = require('form-data');
const path = require('path');

const app = express();
const upload = multer({ dest: 'uploads/' }); // temporary storage

const AZAPI_API_KEY = process.env.AZAPI_API_KEY;
const AZAPI_ENDPOINT = "https://ocr.azapi.ai/ind0006b"

if (!AZAPI_API_KEY) {
  console.error('ERROR: set AZAPI_API_KEY in .env');
  process.exit(1);
}

/**
 * Helper: try to extract name/id/type from Azapi response
 * (Azapi responses may vary by endpoint/version — this attempts common locations)
 */
function extractIdFields(apiRespJson) {
  // Default empty result
  const result = { name: null, id_number: null, id_type: null };

  // 1) Some providers return parsed fields under data or result
  const candidates = [
    apiRespJson,
    apiRespJson && apiRespJson.data,
    apiRespJson && apiRespJson.result,
    apiRespJson && apiRespJson.results && apiRespJson.results[0],
    apiRespJson && apiRespJson.parsed,
    apiRespJson && apiRespJson.predictions && apiRespJson.predictions[0],
    apiRespJson && apiRespJson.documents && apiRespJson.documents[0],
  ].filter(Boolean);

  for (const c of candidates) {
    // common direct keys
    if (!result.name && (c.name || c.full_name || c.FullName || c['Name'])) {
      result.name = c.name || c.full_name || c.FullName || c['Name'];
    }

    if (!result.id_number && (c.id_number || c.document_number || c.id || c['DocumentNumber'] || c['document_no'])) {
      result.id_number = c.id_number || c.document_number || c.id || c['DocumentNumber'] || c['document_no'];
    }

    if (!result.id_type && (c.document_type || c.type || c.doc_type || c['DocumentType'])) {
      result.id_type = c.document_type || c.type || c.doc_type || c['DocumentType'];
    }

    // If fields are inside a "fields" list
    if (c.fields && Array.isArray(c.fields)) {
      for (const f of c.fields) {
        const key = (f.name || f.key || '').toString().toLowerCase();
        const value = f.value || f.text || f.value_string || f['Value'] || null;
        if (!value) continue;

        if (!result.name && (key.includes('name') || key.includes('fullname') || key.includes('givenname'))) {
          result.name = value;
        }
        if (!result.id_number && (key.includes('id') || key.includes('number') || key.includes('cardno') || key.includes('document'))) {
          result.id_number = value;
        }
        if (!result.id_type && (key.includes('type') || key.includes('document'))) {
          result.id_type = value;
        }
      }
    }

    // If fields in key-value pairs
    if (c.key_values && Array.isArray(c.key_values)) {
      for (const kv of c.key_values) {
        const k = (kv.key || '').toString().toLowerCase();
        const v = kv.value || kv.value_string || kv.text || null;
        if (!v) continue;
        if (!result.name && k.includes('name')) result.name = v;
        if (!result.id_number && (k.includes('id') || k.includes('number') || k.includes('card'))) result.id_number = v;
        if (!result.id_type && k.includes('document')) result.id_type = v;
      }
    }
  }

  // final fallback: scan all strings in JSON for patterns (very weak)
  if (!result.id_number) {
    const jsonText = JSON.stringify(apiRespJson);
    // simple NRIC/PAN/Passport-ish patterns (very lenient)
    const pan = jsonText.match(/\b([A-Z]{5}\d{4}[A-Z])\b/); // PAN like pattern
    const passport = jsonText.match(/\b([A-Z]{1,2}\d{6,8})\b/);
    const anyDigits = jsonText.match(/\b([A-Z0-9\-]{6,20})\b/);
    if (pan) result.id_number = pan[0];
    else if (passport) result.id_number = passport[0];
    else if (anyDigits) result.id_number = anyDigits[0];
  }

  // Normalize whitespace
  for (const k of Object.keys(result)) {
    if (typeof result[k] === 'string') result[k] = result[k].trim();
  }

  return result;
}

/**
 * POST /upload
 * field: file (req.file)
 */
app.post('/api/verify-id', upload.single('imageData'), async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: 'No file uploaded. Use form field "file".' });
  }

  try {
    // Build form-data to Azapi
    const form = new FormData();
    const fileStream = fs.createReadStream(req.file.path);
    // Many Azapi endpoints accept "file" or "image" field; adjust if needed.
    form.append('file', fileStream, {
      filename: req.file.originalname || path.basename(req.file.path),
      contentType: req.file.mimetype || 'application/octet-stream',
    });

    // If endpoint expects additional params, append them:
    // form.append('doc_type', 'auto'); // example

    const headers = {
      ...form.getHeaders(),
      Authorization: `Bearer ${AZAPI_API_KEY}`, // common pattern; if Azapi uses different header change it
      Accept: 'application/json',
    };

    // Send to Azapi
    const azapiResp = await axios.post(AZAPI_ENDPOINT, form, { headers, maxBodyLength: Infinity, timeout: 60000 });

    // Cleanup uploaded temp file
    try { fs.unlinkSync(req.file.path); } catch (e) { /* ignore */ }

    // Extract name/id/type from response (robust to multiple shapes)
    const extracted = extractIdFields(azapiResp.data || {});

    // If nothing found, include raw response for debugging
    if (!extracted.name && !extracted.id_number && !extracted.id_type) {
      return res.status(200).json({
        message: 'No structured fields parsed. Returning raw API response for debugging.',
        raw: azapiResp.data,
      });
    }

    return res.json({
      name: extracted.name,
      id_number: extracted.id_number,
      id_type: extracted.id_type,
      raw: azapiResp.data, // optional: remove in production if you don't want to return raw
    });
  } catch (err) {
    // cleanup
    try { fs.unlinkSync(req.file.path); } catch (e) { /* ignore */ }

    console.error('Error contacting Azapi:', err?.response?.data || err.message);
    const status = err?.response?.status || 500;
    return res.status(status).json({
      error: 'Failed to process document with Azapi',
      details: err?.response?.data || err?.message,
    });
  }
});

const port = process.env.PORT || 3000;
app.listen(port, () => {
  console.log(`Server listening on ${port}. POST file as form-data field "file" to /upload`);
});






//formx.ai

// const express = require("express");
// const multer = require("multer");
// const fs = require("fs");
// const path = require("path");
// const axios = require("axios");
// const FormData = require("form-data");
// require("dotenv").config();

// const app = express();
// app.use(express.json());

// const upload = multer({ dest: "uploads/" });

// app.post("/api/verify-id", upload.single("imageData"), async (req, res) => {
//   if (!req.file) {
//     return res.status(400).json({ success: false, error: "No file uploaded" });
//   }

//   const filePath = path.resolve(req.file.path);

//   try {
//     const formData = new FormData();
//     formData.append("pdf_dpi", "150");
//     formData.append("async", "false");
//     formData.append("auto_adjust_image_size", "true");
//     formData.append("output_ocr", "false");
//     formData.append("processing_mode", "per-page");
//     formData.append("extractor_id", process.env.EXTRACTOR_ID);
//     formData.append("image", fs.createReadStream(filePath));

//     const response = await axios.post(
//       "https://worker.formextractorai.com/v2/extract",
//       formData,
//       {
//         headers: {
//           ...formData.getHeaders(),
//           "X-WORKER-TOKEN": process.env.FORMX_API_KEY,
//           accept: "application/json",
//         },
//         maxBodyLength: Infinity, // allow large files
//       }
//     );
//     console.log("response", response)

//     const data = response.data;

//     // Extract fields
//     // let name = null;
//     // let identity_number = null;
//     // let identity_type = null;

//     // if (data && data.documents && data.documents[0].data) {
//     //   const fields = data.documents[0].data;
//     //   console.log("🚀 ~ fields:", fields)
//     //   name = fields.given_name || null;
//     //   surname = fields.surname || null;
//     //   identity_number = fields.passport_number || null;
//     //   identity_type = fields.type || null;
//     // }

//     res.json({ success: true, data: data.documents[0].data, raw: data });

//   } catch (err) {
//     console.error("Error calling FormX:", err.message);
//     res.status(500).json({ success: false, error: "Extraction failed", details: err.response?.data || err.message, });
//   } finally {
//     // Cleanup uploaded file
//     fs.unlink(filePath, (unlinkErr) => {
//       if (unlinkErr) console.error("Error deleting temp file:", unlinkErr);
//     });
//   }
// });

// // Root route
// app.get("/", (req, res) => {
//   res.send("FormX ID Extractor running. POST /api/verify-id with form-data field 'imageData'.");
// });

// const PORT = process.env.PORT || 3000;
// app.listen(PORT, () => {
//   console.log(`Server running on port ${PORT}`);
// });





// NANONETS working

// require("dotenv").config();
// const express = require("express");
// const app = express();
// const bodyParser = require("body-parser");
// const multer = require("multer");
// const axios = require("axios");
// const fs = require("fs");
// const path = require("path");
// const FormData = require("form-data");
// const Tesseract = require("tesseract.js");
// const stringSimilarity = require("string-similarity");
// const cors = require("cors");

// app.use(bodyParser.json());
// app.use(express.static(__dirname));
// app.use(express.static(path.join(__dirname, 'public')));
// app.use('/uploads', express.static(path.join(__dirname, 'uploads')));
// app.use(cors());


// const storage = multer.diskStorage({
//   destination: function (req, file, cb) {
//     if (!fs.existsSync("uploads")) {
//       fs.mkdirSync("uploads");
//     }
//     cb(null, "uploads/");
//   },
//   filename: function (req, file, cb) {
//     cb(null, Date.now() + path.extname(file.originalname));
//   },
// });

// const upload = multer({ storage });


// const { NANONETS_API_KEY, NANONETS_MODEL_ID } = process.env;

// if (!NANONETS_API_KEY || !NANONETS_MODEL_ID) {
//   console.error("❌ Please set NANONETS_API_KEY and NANONETS_MODEL_ID in .env");
//   process.exit(1);
// }

// function pickNameIdAndDocType(predictions, minScore = 0.55) {
//   const fields = Array.isArray(predictions) ? predictions : [];

//   const norm = fields.map((f) => {
//     const label = String(f.label || "").toLowerCase().trim();
//     const text = (f.ocr_text ?? f.text ?? "").toString().trim();
//     const score = typeof f.score === "number" ? f.score : (f.confidence ?? null);
//     return { label, text, score };
//   });

//   const LABELS = {
//     firstName: ["first_name", "given_name", "given_names", "forename"],
//     lastName: ["last_name", "surname", "family_name"],
//     fullName: ["full_name", "fullname", "name", "holder_name"],
//     idNumber: [
//       "id_number",
//       "document_number",
//       "identification_number",
//       "card_number",
//       "number",
//       "aadhaar_number",
//       "pan_number",
//       "nric",
//       "ic_number",
//       "passport_number",
//     ],
//     docType: [
//       "document_type",
//       "id_type",
//       "type",
//       "doctype",
//       "card_type",
//     ],
//   };

//   const pickBest = (labels) => {
//     let best = null;
//     for (const f of norm) {
//       if (!f.text) continue;
//       if (f.score != null && f.score < minScore) continue;
//       if (labels.includes(f.label)) {
//         if (!best || (f.score ?? 0) > (best.score ?? 0)) best = f;
//       }
//     }
//     return best;
//   };

//   const fFirst = pickBest(LABELS.firstName);
//   const fLast = pickBest(LABELS.lastName);
//   const fFull = pickBest(LABELS.fullName);
//   const fId = pickBest(LABELS.idNumber);
//   const fDocType = pickBest(LABELS.docType);

//   // 🔹 Infer fullName if not directly given
//   let fullName = fFull?.text || null;
//   if (!fullName) {
//     const composed = `${fFirst?.text || ""} ${fLast?.text || ""}`.trim();
//     if (composed) fullName = composed;
//   }

//   // 🔹 Infer docType if missing
//   let docType = fDocType?.text || null;
//   if (!docType) {
//     // fallback heuristic: look at allFields text for keywords
//     const allText = norm.map((f) => f.text.toLowerCase()).join(" ");
//     if (/aadhaar/.test(allText)) docType = "Aadhaar";
//     else if (/pan/.test(allText)) docType = "PAN";
//     else if (/passport/.test(allText)) docType = "Passport";
//     else if (/nric|singapore/.test(allText)) docType = "Singapore NRIC";
//   }

//   return {
//     firstName: fFirst?.text || null,
//     lastName: fLast?.text || null,
//     fullName: fullName || null,
//     idNumber: fId?.text || null,
//     documentType: docType || null,
//     allFields: norm, // keep for debugging
//   };
// }

// function extractPredictions(nnResponseJson) {
//   const resultArr = nnResponseJson?.result || nnResponseJson?.data?.result || [];
//   if (!Array.isArray(resultArr) || resultArr.length === 0) return [];
//   const all = [];
//   for (const page of resultArr) {
//     if (Array.isArray(page?.prediction)) {
//       all.push(...page.prediction);
//     } else if (Array.isArray(page?.predictions)) {
//       all.push(...page.predictions);
//     }
//   }
//   return all;
// }

// app.post("/api/verify-id", upload.single("imageData"), async (req, res) => {
//   try {
//     const { userId } = req.body;
//     if (!req.file) {
//       return res.status(400).json({ success: false, error: "No file uploaded (field: imageData)" });
//     }

//     const filePath = path.join(__dirname, req.file.path);
//     const form = new FormData();
//     form.append("file", fs.createReadStream(filePath));

//     const url = `https://app.nanonets.com/api/v2/OCR/Model/${process.env.NANONETS_MODEL_ID}/LabelFile/`;

//     const { data } = await axios.post(url, form, {
//       auth: { username: NANONETS_API_KEY, password: "" },
//       headers: form.getHeaders(),
//       maxBodyLength: Infinity,
//       timeout: 60_000,
//     });

//     const predictions = extractPredictions(data);
//     const picked = pickNameIdAndDocType(predictions);

//     // if (!picked.idNumber && !picked.fullName) {
//     //   return res.status(400).json({ success: false, error: "No valid ID information could be extracted" });
//     // }

//     fs.unlinkSync(filePath);

//     const findDocument_type = picked.allFields.find(item => item.label == "document_type")
//     const idNumber = picked.allFields.find(item => item.label == "id_number");
//     const fullName = picked.allFields.find(item => item.label == "full_name");
//     const firstName = picked.allFields.find(item => item.label == "first_name");

//     return res.json({
//       success: true,
//       firstName: picked.firstName ? picked.firstName : firstName?.text || null,
//       fullName: picked.fullName ? picked.fullName : fullName?.text || null,
//       idNumber: picked.idNumber ? picked.idNumber : idNumber?.text || null,
//       documentType: picked.documentType ? picked.documentType : findDocument_type?.text || null,
//       debugAllFields: picked.allFields,
//       dataraw: data,
//     });
//   } catch (err) {
//     console.error("Nanonets error:", err?.response?.data || err.message);
//     return res.status(500).json({
//       success: false,
//       error: "OCR failed",
//       details: err?.response?.data || err.message,
//     });
//   }
// });

// const PORT = process.env.PORT || 5000;
// app.listen(PORT, () => console.log(`🚀 Server running on port ${PORT}`));
