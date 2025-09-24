require("dotenv").config();
const express = require("express");
const bodyParser = require("body-parser");
const cors = require("cors");
// const mongoose = require("mongoose");
const { RtcTokenBuilder, RtcRole } = require("agora-access-token");
const Tesseract = require("tesseract.js");
const multer = require("multer");
const path = require("path");
const sharp = require("sharp");  //resize, convert, compress, crop, rotate, format change
const formData = require("form-data");
const axios = require("axios");
const fs = require("fs");

const app = express();
exports.app = app;
const PORT = process.env.PORT || 5000;

app.use(cors(
  {
    origin: '*',
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization']
  }));
app.use(bodyParser.json());
app.use(express.static(__dirname));
app.use(express.static(path.join(__dirname, 'public')));
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const uploadDir = 'uploads/';
    if (!fs.existsSync(uploadDir)) {
      fs.mkdirSync(uploadDir, { recursive: true });
    }
    cb(null, uploadDir);
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, uniqueSuffix + path.extname(file.originalname));
  }
});

// const allowedMimeTypes = [
//   'image/jpeg',
//   'image/png',
//   'image/bmp',
//   'image/tiff',
//   'application/pdf'
// ];

// const fileFilter = (req, file, cb) => {
//   if (allowedMimeTypes.includes(file.mimetype)) {
//     cb(null, true);
//   } else {
//     cb(new Error('Invalid file type. Only .jpg, .jpeg, .png, .bmp, .tiff, .tif, .pdf are allowed!'), false);
//   }
// };

// const storage = multer.memoryStorage();
const upload = multer({
  storage,
  // fileFilter,
});


// ----------------- MongoDB Connection -----------------
// mongoose.connect(process.env.MONGO_URI, {
//   useNewUrlParser: true,
//   useUnifiedTopology: true,
// })
//   .then(() => console.log("✅ MongoDB connected"))
//   .catch((err) => console.error("❌ MongoDB connection error:", err));

// // ----------------- Mongoose Model -----------------
// const verificationSchema = new mongoose.Schema(
//   {
//     userId: { type: String, required: true },
//     idVerified: { type: Boolean, default: false },
//     idInfo: {
//       idNumber: String,
//       name: String,
//       dob: String,
//       gender: String,
//       mobile: String,
//       address: String,
//     },
//     idCard: { type: String, default: null },
//     hand: { type: Boolean, default: false },
//     head: { type: Boolean, default: false },
//     blink: { type: Boolean, default: false },
//     fingers: { type: Boolean, default: false },
//   },
//   { timestamps: true, collection: "verification_status" }
// );

// const VerificationState = mongoose.model("verification_status", verificationSchema);

// ----------------- Agora Config -----------------
const APP_ID = process.env.AGORA_APP_ID;
const APP_CERTIFICATE = process.env.AGORA_APP_CERTIFICATE;






// ----------------- API Routes -----------------

//for video calling this api only return channel name and uid related WEBRTCTOKEN
app.post("/api/agora-token", upload.none(), (req, res) => {
  const { channelName, uid } = req.body;
  if (!channelName || !uid) {
    return res.status(400).json({ error: "Channel name and UID are required" });
  }

  try {
    const role = RtcRole.PUBLISHER;
    const expirationTimeInSeconds = 3600;          // 1 Hour
    const currentTimestamp = Math.floor(Date.now() / 1000);
    const privilegeExpiredTs = currentTimestamp + expirationTimeInSeconds;

    const token = RtcTokenBuilder.buildTokenWithUid(
      APP_ID,
      APP_CERTIFICATE,
      channelName,
      uid,
      role,
      privilegeExpiredTs
    );

    res.json({ token, appId: APP_ID });
  } catch (error) {
    console.error("Agora token error:", error);
    res.json({ error: error.message });
  }
});

// 2. Add/Update verification step
app.post("/api/update-verification", upload.none(), async (req, res) => {
  const { userId, step, value } = req.body;
  if (!userId || step === undefined || value === undefined) {
    return res.status(400).json({ error: "Invalid request" });
  }

  try {
    const update = { [step]: value };
    const findUser = await VerificationState.findOne({ userId: userId });
    if (findUser) {
      await VerificationState.findOneAndUpdate({ userId: userId }, { $set: update }, { new: true });
    } else {
      await VerificationState.create({ userId, ...update });
    }
    res.json({ success: true });
  } catch (error) {
    console.error("Update verification error:", error);
    res.status(500).json({ error: error.message });
  }
});

//==============================================================================
// Nanonets OCR route
//==============================================================================
// const { NANONETS_API_KEY, NANONETS_MODEL_ID } = process.env;

// if (!NANONETS_API_KEY || !NANONETS_MODEL_ID) {
//   console.error("❌ Please set NANONETS_API_KEY and NANONETS_MODEL_ID in .env");
//   process.exit(1);
// }

// function pickNameAndId(predictions, minScore = 0.55) {
//   const fields = Array.isArray(predictions) ? predictions : [];

//   const norm = fields.map((f) => {
//     const label = String(f.label || "").toLowerCase().trim();
//     const text = (f.ocr_text ?? f.text ?? "").toString().trim();
//     const score = typeof f.score === "number" ? f.score : (f.confidence ?? null);
//     return { label, text, score };
//   });

//   const LABELS = {
//     firstName: [
//       "first_name",
//       "given_name",
//       "given_names",
//       "forename",
//       "holder_first_name",
//       "name_first",
//     ],
//     lastName: [
//       "last_name",
//       "surname",
//       "family_name",
//       "holder_last_name",
//       "name_last",
//     ],
//     fullName: [
//       "full_name",
//       "fullname",
//       "name",
//       "holder_name",
//       "complete_name",
//     ],
//     idNumber: [
//       "id_number",
//       "document_number",
//       "identification_number",
//       "card_number",
//       "number",
//       "license_number",
//       "driving_license_number",
//       "passport_number",
//       "aadhaar_number",
//       "pan",
//       "pan_number",
//       "nric",
//       "nin",
//       "ic_number",
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

//   let fullName = fFull?.text || null;
//   let fullNameConfidence = fFull?.score ?? null;

//   if (!fullName) {
//     const firstText = fFirst?.text || "";
//     const lastText = fLast?.text || "";
//     const composed = `${firstText} ${lastText}`.trim().replace(/\s+/g, " ");
//     if (composed) {
//       fullName = composed;
//       // conservative: min of available confidences (or 1.0 if one part missing)
//       const firstC = fFirst?.score ?? 1;
//       const lastC = fLast?.score ?? 1;
//       fullNameConfidence = Math.min(firstC, lastC);
//     }
//   }

//   return {
//     firstName: fFirst?.text || null,
//     lastName: fLast?.text || null,
//     fullName: fullName || null,
//     idNumber: fId?.text || null,
//     confidences: {
//       firstName: fFirst?.score ?? null,
//       lastName: fLast?.score ?? null,
//       fullName: fullNameConfidence ?? null,
//       idNumber: fId?.score ?? null,
//     },
//     allFields: norm, // helpful for debugging; remove in prod if not needed
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
//       return res
//         .status(400)
//         .json({ success: false, error: "No file uploaded (field: imageData)" });
//     }

//     // full path of stored file
//     const filePath = path.join(__dirname, req.file.path);

//     // ✅ Prepare form-data with file stream
//     const form = new formData();
//     form.append("file", fs.createReadStream(filePath));

//     const url = `https://app.nanonets.com/api/v2/OCR/Model/${process.env.NANONETS_MODEL_ID}/LabelFile/`;

//     const { data } = await axios.post(url, form, {
//       auth: { username: process.env.NANONETS_API_KEY, password: "" },
//       headers: form.getHeaders(),
//       maxBodyLength: Infinity,
//       timeout: 60_000,
//     });

//     // ✅ Extract predictions
//     const predictions = extractPredictions(data);
//     const picked = pickNameAndId(predictions);

//     if (!picked.idNumber && !picked.fullName) {
//       return res.status(400).json({ success: false, error: "No valid ID information could be extracted" });
//     }


//     const idInfo = {
//       idNumber: picked.idNumber || null,
//       name: picked.fullName || null,
//     };

//     // ✅ Save file path + OCR results in DB
//     await VerificationState.findOneAndUpdate(
//       { userId },
//       { idInfo, idCard: req.file.filename },
//       { new: true }
//     );

//     return res.json({
//       success: true,
//       firstName: picked.firstName,
//       fullName: picked.fullName,
//       idNumber: picked.idNumber,
//       debugAllFields: picked.allFields,
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

// 4. Check verification status
app.get("/api/verification-status/:userId", async (req, res) => {
  try {
    const { userId } = req.params;
    const state = (await VerificationState.findOne({ userId }).lean()) || {
      handMoved: false,
      idVerified: false,
      idInfo: null,
    };
    res.json(state);
  } catch (error) {
    console.error("Verification status error:", error);
    res.status(500).json({ error: error.message });
  }
});




//==============================================================================
// tesseract route
//==============================================================================
// ─────────────── Regex patterns ───────────────
const rx = {
  SG_ID_STRICT: /\b([STFG]\d{7}[A-Z])\b/i, // Singapore NRIC
  AADHAAR_12: /\b\d{4}\s?\d{4}\s?\d{4}\b/, // Aadhaar 12 digits
  PASSPORT: /\b([A-PR-WYa-pr-wy][0-9]{7})\b/, // Passport: Letter + 7 digits
  GENERIC_ID: /\b([A-Z0-9]{6,12})\b/, // fallback generic ID
};

const whiteListForTesseract =
  'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789:/-.,()\'" <>';

// ─────────────── OCR helpers ───────────────
const cleanLine = (l) =>
  l.replace(/[|]+/g, "I")
    .replace(/[—–]/g, "-")
    .replace(/[“”]/g, '"')
    .replace(/[’]/g, "'")
    .replace(/\s{2,}/g, " ")
    .trim();

const normalize = (raw) =>
  raw.replace(/\r/g, "")
    .split("\n")
    .map((l) => cleanLine(l))
    .filter((l) => l && !/</.test(l));

// ─────────────── Document type detection ───────────────
function detectDocumentType(text, lines) {
  const t = text.toLowerCase();

  // Aadhaar check → unique 12-digit number + "Government of India"
  if (rx.AADHAAR_12.test(text) && /government\s+of\s+india/i.test(text)) {
    return "Aadhaar Card";
  }

  // NRIC check → "Republic of Singapore" or NRIC format
  if (rx.SG_ID_STRICT.test(text) || /republic\s+of\s+singapore/i.test(text)) {
    return "Singapore NRIC Card";
  }

  // Passport check → regex + keyword
  if (rx.PASSPORT.test(text) || /passport/i.test(t)) {
    return "Passport";
  }

  // PAN card
  if (/permanent\s+account\s+number/i.test(t) || /\b[A-Z]{5}[0-9]{4}[A-Z]\b/.test(text)) {
    return "PAN Card";
  }

  // Voter ID
  if (/election\s+commission|voter\s+id/i.test(t)) {
    return "Voter ID";
  }

  // Driving License
  if (/driving\s+licence|driver'?s\s+license/i.test(t)) {
    return "Driving Licence";
  }

  // Nepal ID
  if (/nepal/i.test(t)) {
    return "Nepal Identity Card";
  }

  // Generic fallback
  if (/identity\s*card/i.test(t)) {
    return "Generic Identity Card";
  }

  return "Unknown Document Type";
}

// ─────────────── Parser ───────────────
function parseIdAndType(ocrText) {
  const lines = normalize(ocrText);

  let idNumber = null;
  if (rx.SG_ID_STRICT.test(ocrText)) idNumber = ocrText.match(rx.SG_ID_STRICT)[1].toUpperCase();
  else if (rx.AADHAAR_12.test(ocrText)) idNumber = ocrText.match(rx.AADHAAR_12)[0].replace(/\s/g, "");
  else if (rx.PASSPORT.test(ocrText)) idNumber = ocrText.match(rx.PASSPORT)[1];
  else if (rx.GENERIC_ID.test(ocrText)) idNumber = ocrText.match(rx.GENERIC_ID)[1];

  const docType = detectDocumentType(ocrText, lines);

  return { idNumber: idNumber || null, documentType: docType, raw: ocrText };
}

// ─────────────── API Endpoint ─────────────── 
app.post("/api/verify-id", upload.single("imageData"), async (req, res) => {
  try {
    count++
    // console.log("🚀 ~ count:", count)
    if (!req.file) return res.status(400).json({ error: "Image file is required" });

    // const preprocessed = await sharp(req.file.buffer)
    //   .rotate()
    //   .removeAlpha()
    //   .resize({ width: 2200, withoutEnlargement: false })
    //   .grayscale()
    //   .normalize()
    //   .sharpen()
    //   .linear(1.25, -10)
    //   .toBuffer();

    // const { data } = await Tesseract.recognize(preprocessed, "eng", {
    //   tessedit_char_whitelist: whiteListForTesseract,
    //   preserve_interword_spaces: "1",
    // });

    // const parsed = parseIdAndType(data.text || "");
    // const success = parsed.documentType !== "Unknown Document Type";

    // return res.json({
    //   success,
    //   fields: parsed,
    //   message: success
    //     ? "Document type detected successfully"
    //     : "Could not detect document type",
    // });
  } catch (err) {
    console.error("ID verification error:", err);
    return res.status(500).json({ error: "Failed to verify ID" });
  }
});

app.post("/api/screenRecorder", upload.single("video"), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: "Image file is required" });

    return res.json({
      status: "success", message: "done"
    });

    // const preprocessed = await sharp(req.file.buffer)
    //   .rotate()
    //   .removeAlpha()
    //   .resize({ width: 2200, withoutEnlargement: false })
    //   .grayscale()
    //   .normalize()
    //   .sharpen()
    //   .linear(1.25, -10)
    //   .toBuffer();

    // const { data } = await Tesseract.recognize(preprocessed, "eng", {
    //   tessedit_char_whitelist: whiteListForTesseract,
    //   preserve_interword_spaces: "1",
    // });

    // const parsed = parseIdAndType(data.text || "");
    // const success = parsed.documentType !== "Unknown Document Type";

    // return res.json({
    //   success,
    //   fields: parsed,
    //   message: success
    //     ? "Document type detected successfully"
    //     : "Could not detect document type",
    // });
  } catch (err) {
    console.error("ID verification error:", err);
    return res.status(500).json({ error: "Failed to verify ID" });
  }
});


app.get('/index4', (req, res) =>
  res.sendFile(path.join(__dirname, 'index4.html'))
);


if (process.env.NODE_ENV !== "production") {
  app.listen(3000, () => console.log("Running on http://localhost:3000"));
}
