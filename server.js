/**
 * Sarvam <-> Vapi Proxy Server
 * Bridges Vapi's custom STT/TTS with Sarvam AI APIs
 * + Groq LLM Proxy (Free tier)
 *
 * Endpoints:
 *   GET  /                    → health check
 *   POST /v1/audio/speech     → TTS (OpenAI-compatible, for Vapi TTS)
 *   POST /v1/chat/completions → LLM proxy (Groq - Llama 3.1)
 *   WS   /stt                 → WebSocket STT proxy (for Vapi transcriber)
 */

const express   = require('express');
const { WebSocketServer } = require('ws');
const fetch     = require('node-fetch');
const FormData  = require('form-data');

const app  = express();
app.use(express.json());

const PORT           = process.env.PORT || 3000;
const SARVAM_API_KEY = process.env.SARVAM_API_KEY;
const GROQ_API_KEY   = process.env.GROQ_API_KEY;

if (!SARVAM_API_KEY) {
  console.error('❌ SARVAM_API_KEY not set in environment!');
  process.exit(1);
}

if (!GROQ_API_KEY) {
  console.error('❌ GROQ_API_KEY not set in environment!');
  process.exit(1);
}

// ─────────────────────────────────────────────
// Health Check
// ─────────────────────────────────────────────
app.get('/', (req, res) => {
  res.json({
    status: 'ok',
    service: 'Sarvam Vapi Proxy',
    version: '2.0.0',
    endpoints: {
      tts: 'POST /v1/audio/speech',
      llm: 'POST /v1/chat/completions',
      stt: 'WS   /stt'
    }
  });
});

// ─────────────────────────────────────────────
// LLM Proxy — Groq (Llama 3.1 - Free)
// ─────────────────────────────────────────────
app.post('/v1/chat/completions', async (req, res) => {
  try {
    console.log('[LLM] Groq request:', req.body?.messages?.length, 'messages');

    const groqRes = await fetch(
      'https://api.groq.com/openai/v1/chat/completions',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${GROQ_API_KEY}`
        },
        body: JSON.stringify({
          ...req.body,
          model: 'llama-3.1-8b-instant'
        })
      }
    );

    const data = await groqRes.json();

    if (!groqRes.ok) {
      console.error('[LLM] Groq error:', groqRes.status, JSON.stringify(data));
    } else {
      console.log('[LLM] ✅ Groq response OK');
    }

    res.status(groqRes.status).json(data);

  } catch (err) {
    console.error('[LLM] Proxy error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ─────────────────────────────────────────────
// TTS — OpenAI-compatible wrapper for Sarvam Bulbul
// Vapi sends model:'tts-1' which we ignore — always use bulbul:v2
// ─────────────────────────────────────────────
app.post('/v1/audio/speech', async (req, res) => {
  const input = req.body.input || req.body.text;
  const voice = 'anushka'; // Always anushka — ignore jo bhi Vapi bheje
  // Always hardcode Sarvam model — ignore whatever Vapi sends (tts-1 etc)

  if (!input) {
    return res.status(400).json({ error: 'input field is required' });
  }

  try {
    console.log('[TTS] Sarvam request voice:', voice, '| text:', input.substring(0, 50));

    const sarvamRes = await fetch('https://api.sarvam.ai/text-to-speech', {
      method: 'POST',
      headers: {
        'api-subscription-key': SARVAM_API_KEY,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        inputs: [input],
        target_language_code: 'hi-IN',
        speaker: voice,
        model: 'bulbul:v2',
        pitch: 0,
        pace: 1.05,
        loudness: 1.0,
        enable_preprocessing: true,
        speech_sample_rate: 22050
      })
    });

    if (!sarvamRes.ok) {
      const errText = await sarvamRes.text();
      console.error('[TTS] Sarvam error:', sarvamRes.status, errText);
      return res.status(502).json({ error: 'Sarvam TTS failed', detail: errText });
    }

    const data = await sarvamRes.json();

    if (!data.audios || !data.audios[0]) {
      return res.status(502).json({ error: 'Empty audio response from Sarvam' });
    }

    const audioBuffer = Buffer.from(data.audios[0], 'base64');
    res.set('Content-Type', 'audio/wav');
    res.set('Content-Length', audioBuffer.length);
    res.send(audioBuffer);

    console.log(`[TTS] ✅ Synthesized ${input.length} chars → ${audioBuffer.length} bytes`);

  } catch (err) {
    console.error('[TTS] Proxy error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ─────────────────────────────────────────────
// Start HTTP server
// ─────────────────────────────────────────────
const server = app.listen(PORT, () => {
  console.log(`\n🚀 Sarvam Vapi Proxy running on port ${PORT}`);
  console.log(`   Health: GET  http://localhost:${PORT}/`);
  console.log(`   LLM:    POST http://localhost:${PORT}/v1/chat/completions`);
  console.log(`   TTS:    POST http://localhost:${PORT}/v1/audio/speech`);
  console.log(`   STT:    WS   ws://localhost:${PORT}/stt\n`);
});

// ─────────────────────────────────────────────
// STT — WebSocket bridge for Sarvam Saarika
// ─────────────────────────────────────────────
const wss = new WebSocketServer({ server, path: '/stt' });

function buildWavHeader(pcmLength, sampleRate = 16000, channels = 1, bitDepth = 16) {
  const buf = Buffer.alloc(44);
  buf.write('RIFF', 0);
  buf.writeUInt32LE(36 + pcmLength, 4);
  buf.write('WAVE', 8);
  buf.write('fmt ', 12);
  buf.writeUInt32LE(16, 16);
  buf.writeUInt16LE(1, 20);
  buf.writeUInt16LE(channels, 22);
  buf.writeUInt32LE(sampleRate, 24);
  buf.writeUInt32LE(sampleRate * channels * (bitDepth / 8), 28);
  buf.writeUInt16LE(channels * (bitDepth / 8), 32);
  buf.writeUInt16LE(bitDepth, 34);
  buf.write('data', 36);
  buf.writeUInt32LE(pcmLength, 40);
  return buf;
}

wss.on('connection', (socket, req) => {
  const ip = req.socket.remoteAddress;
  console.log(`[STT] 🔗 Vapi connected from ${ip}`);

  const pcmChunks  = [];
  let silenceTimer = null;
  let processing   = false;

  const sendTranscript = (text, isFinal = true) => {
    if (socket.readyState === 1) {
      socket.send(JSON.stringify({
        type:           'transcript',
        transcriptType: isFinal ? 'final' : 'partial',
        transcript:     text
      }));
      console.log(`[STT] 📝 Sent: "${text}"`);
    }
  };

  const processPCM = async () => {
    if (processing || pcmChunks.length === 0) return;
    processing = true;

    const rawPCM = Buffer.concat(pcmChunks.splice(0));

    if (rawPCM.length < 3200) {
      processing = false;
      return;
    }

    const wavBuf = Buffer.concat([buildWavHeader(rawPCM.length), rawPCM]);

    try {
      const form = new FormData();
      form.append('file', wavBuf, {
        filename:    'audio.wav',
        contentType: 'audio/wav'
      });
      form.append('model',           'saarika:v2');
      form.append('language_code',   'hi-IN');
      form.append('with_timestamps', 'false');

      const sarvamRes = await fetch('https://api.sarvam.ai/speech-to-text', {
        method: 'POST',
        headers: {
          'api-subscription-key': SARVAM_API_KEY,
          ...form.getHeaders()
        },
        body: form
      });

      if (!sarvamRes.ok) {
        const err = await sarvamRes.text();
        console.error('[STT] Sarvam error:', sarvamRes.status, err);
        processing = false;
        return;
      }

      const json = await sarvamRes.json();

      if (json.transcript && json.transcript.trim().length > 0) {
        sendTranscript(json.transcript.trim(), true);
      }

    } catch (err) {
      console.error('[STT] Proxy error:', err.message);
    } finally {
      processing = false;
    }
  };

  socket.on('message', (data, isBinary) => {
    if (isBinary) {
      pcmChunks.push(Buffer.from(data));
      clearTimeout(silenceTimer);
      silenceTimer = setTimeout(processPCM, 500);
    } else {
      try {
        const msg = JSON.parse(data.toString());
        console.log('[STT] Control:', msg.type ?? JSON.stringify(msg));
      } catch (_) { }
    }
  });

  socket.on('close', (code) => {
    clearTimeout(silenceTimer);
    console.log(`[STT] 🔌 Vapi disconnected (code: ${code})`);
  });

  socket.on('error', (err) => {
    console.error('[STT] Socket error:', err.message);
  });
});
