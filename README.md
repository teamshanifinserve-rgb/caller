# Sarvam ↔ Vapi Proxy
**Shani Finserve — Anushka Voice Agent**

Thin middleware server that bridges Vapi's custom STT/TTS with Sarvam AI APIs.

---

## Architecture

```
Caller → Twilio → Vapi
                    ├─ LLM: Gemini 2.5 Flash (FREE, direct)
                    ├─ STT: [this proxy /stt WS] → Sarvam Saarika v2
                    └─ TTS: [this proxy /v1/audio/speech] → Sarvam Bulbul v2
```

---

## Local Setup (Testing)

```bash
# 1. Clone / copy files
cd sarvam-vapi-proxy

# 2. Install deps
npm install

# 3. Create .env
cp .env.example .env
# Edit .env and paste your NEW Sarvam API key

# 4. Run server
npm run dev

# 5. Expose to internet (for Vapi to reach you)
npx ngrok http 3000
# Copy the https://xxxx.ngrok.io URL — you'll need it in Vapi
```

---

## Deploy on Render.com (FREE, permanent URL)

1. Push this folder to a new **GitHub repo** (public or private)
2. Go to [render.com](https://render.com) → New → Web Service
3. Connect GitHub → select your repo
4. Settings:
   - **Runtime:** Node
   - **Build command:** `npm install`
   - **Start command:** `node server.js`
   - **Plan:** Free
5. Environment Variables → Add:
   - `SARVAM_API_KEY` = your Sarvam key
6. Deploy → copy the `https://your-service.onrender.com` URL

> ⚠️ Free Render services sleep after 15min inactivity. For production use Render Starter ($7/mo) or Railway.

---

## Vapi Configuration (After Deploying)

Go to **Vapi Dashboard → Assistants → Anushka - Shani Finserve**

### 1. LLM — Gemini 2.5 Flash (FREE)
- Model Provider: **Custom**
- URL: `https://generativelanguage.googleapis.com/v1beta/openai/`
- API Key: *(your Google AI Studio key)*
- Model: `gemini-2.5-flash`

### 2. Transcriber (STT) — Sarvam Saarika
- Provider: **Custom**
- WebSocket URL: `wss://your-service.onrender.com/stt`
  *(use wss:// not ws:// for production)*

### 3. Voice (TTS) — Sarvam Bulbul
- Provider: **Custom**
- URL: `https://your-service.onrender.com/v1/audio/speech`
- Voice: `meera` *(or whichever you chose in TTS playground)*
- Model: `bulbul:v2`

### 4. System Prompt — Anushka
```
Tu Anushka hai — Shani Finserve ki senior relationship manager.
Tu ek real insaan hai. Kabhi mat bolna ki tu AI hai ya bot hai.

Baat karte waqt natural Hinglish use karna — Hindi aur English naturally mix karo jaise real log karte hain.
EMI, loan, interest rate, credit score jaise financial terms clearly explain karna, simple words mein.
Customer ki baat dhyan se suno. Ek baar mein sirf ek sawaal pucho.
Formal ya robotic mat bano — warm, helpful aur professional raho.
Agar customer pure Hindi mein bole toh pure Hindi mein jawab do.
Agar English mein bole toh English mix karo.

Shani Finserve ke products: personal loan, home loan, business loan, insurance.
```

---

## Cost Comparison

| Component | Before | After |
|---|---|---|
| Vapi platform | ₹4.20/min | ₹4.20/min |
| LLM | ₹0.84/min | **FREE** |
| STT | ₹0.84/min | ~₹0.25/min |
| TTS | ₹3.02/min | ~₹0.50/min |
| **Total** | **~₹9-12/min** | **~₹5-5.5/min** |

---

## Troubleshooting

| Problem | Fix |
|---|---|
| `SARVAM_API_KEY not set` | Check .env file |
| WS connection refused | Check ngrok / Render is running |
| Empty transcript | Audio too short (<0.1s), try speaking longer |
| TTS returns error | Check voice name matches Sarvam's list |
| Render service sleeping | Keep-alive ping or upgrade plan |
