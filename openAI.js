const express = require("express");
const bodyParser = require("body-parser");
const OpenAI = require("openai");
const mongoose = require('mongoose');
const app = express();
app.use(bodyParser.json());

mongoose.connect('mongodb://127.0.0.1:27017/invoiceChat', {
    useNewUrlParser: true,
    useUnifiedTopology: true,
})
    .then(() => console.log("✅ MongoDB connected"))
    .catch((err) => console.error("❌ MongoDB connection error:", err));

const conversationSchema = new mongoose.Schema({
    sessionId: String,
    messages: [
        {
            role: { type: String, enum: ["user", "assistant", "system"] },
            content: String,
        },
    ],
});
const Conversation = mongoose.model("Conversation", conversationSchema);

const client = new OpenAI({ apiKey: "" });

const SYSTEM_PROMPT = `
You are an invoice assistant. Ask one question at a time to collect:
customer_name, amount, currency, customer_address, customer_email.
When all are collected, return ONLY valid JSON invoice with:
- customer_name
- customer_address
- customer_email
- amount
- currency
- invoice_number (unique INVxxxx)
- invoice_date (YYYY-MM-DD).
If user goes off-topic, reply: "Please answer invoice-related questions only."
`;

function genInvoiceNumber() {
    const n = Math.floor(Math.random() * 1_000_000).toString().padStart(6, "0");
    return `INV${n}`;
}

function todayYYYYMMDD() {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

app.post("/chat", async (req, res) => {
    try {
        const { sessionId, message } = req.body;
        if (!sessionId || !message) {
            return res.status(400).json({ error: "sessionId and message are required" });
        }

        let convo = await Conversation.findOne({ sessionId });
        if (!convo) {
            convo = new Conversation({
                sessionId,
                messages: [{ role: "system", content: SYSTEM_PROMPT }],
            });
        }

        convo.messages.push({ role: "user", content: message });

        const completion = await client.chat.completions.create({
            model: "gpt-4.1-mini",
            messages: convo.messages,
            temperature: 0,
            max_tokens: 600,
        });

        const assistantReply = completion.choices[0].message.content.trim();

        convo.messages.push({ role: "assistant", content: assistantReply });
        await convo.save();

        let parsed = null;
        try {
            let cleaned = assistantReply
                .replace(/^```json\s*/, "")
                .replace(/^```\s*/, "")
                .replace(/```$/, "")
                .trim();
            if (cleaned.startsWith("{")) {
                parsed = JSON.parse(cleaned);
            }
        } catch (e) { }

        if (parsed) {
            if (!parsed.invoice_number) parsed.invoice_number = genInvoiceNumber();
            if (!parsed.invoice_date) parsed.invoice_date = todayYYYYMMDD();
            return res.json({ reply: assistantReply, invoice: parsed, done: true });
        }

        return res.json({ reply: assistantReply, done: false });
    } catch (err) {
        console.error("Error:", err);
        return res.status(500).json({ error: "Internal server error" });
    }
});

app.listen(3000, () => console.log("✅ Server running on http://localhost:3000"));