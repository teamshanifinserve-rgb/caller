/**
 * Sarvam <-> Vapi Proxy Server
 * Bridges Vapi's custom STT/TTS/LLM with Sarvam + Gemini APIs
 */

const express = require('express');
const { WebSocketServer } = require('ws');
const fetch   = require('node-fetch');
const FormData = require('form-data');

const app = express();
app.use(express.json({ limit: '10mb' }));

const PORT           = process.env.PORT || 3000;
const SARVAM_API_KEY = process.env.SARVAM_API_KEY;
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;

if (!SARVAM_API_KEY) { console.error('❌ SARVAM_API_KEY not set!'); process.exit(1); }
if (!GEMINI_API_KEY) { console.error('❌ GEMINI_API_KEY not set!'); process.exit(1); }

app.get('/', (req, res) => res.json({ status: 'ok', version: '2.0.0' }));

app.post('/v1/chat/completions', async (req, res) => {
  try {
    const r = await fetch('https://generativelanguage.googleapis.com/v1beta/openai/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${GEMINI_API_KEY}` },
      body: JSON.stringify({ ...req.body, model: 'gemini-2.5-flash' })
    });
    const data = await r.json();
    res.status(r.status).json(data);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/v1/audio/speech', async (req, res) => {
  const input = req.body.input || req.body.text || req.body?.message?.text;
  if (!input) return res.status(400).json({ error: 'input required' });
  try {
    const r = await fetch('https://api.sarvam.ai/text-to-speech', {
      method: 'POST',
      headers: { 'api-subscription-key': SARVAM_API_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({ inputs: [input], target_language_code: 'hi-IN', speaker: 'anushka', model: 'bulbul:v2', pitch: 0, pace: 1.05, loudness: 1.0, enable_preprocessing: true, speech_sample_rate: 22050 })
    });
    if (!r.ok) { const e = await r.text(); return res.status(502).json({ error: e }); }
    const data = await r.json();
    if (!data.audios?.[0]) return res.status(502).json({ error: 'No audio from Sarvam' });
    const buf = Buffer.from(data.audios[0], 'base64');
    console.log('[TTS] ✅', buf.length, 'bytes');
    res.set('Content-Type', 'audio/wav').set('Content-Length', buf.length).send(buf);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

const server = app.listen(PORT, () => console.log(`🚀 Proxy on port ${PORT}`));
const wss = new WebSocketServer({ server, path: '/stt' });

function buildWavHeader(len) {
  const b = Buffer.alloc(44);
  b.write('RIFF',0); b.writeUInt32LE(36+len,4); b.write('WAVE',8); b.write('fmt ',12);
  b.writeUInt32LE(16,16); b.writeUInt16LE(1,20); b.writeUInt16LE(1,22);
  b.writeUInt32LE(16000,24); b.writeUInt32LE(32000,28); b.writeUInt16LE(2,32);
  b.writeUInt16LE(16,34); b.write('data',36); b.writeUInt32LE(len,40);
  return b;
}

wss.on('connection', (socket) => {
  const chunks = []; let timer = null, busy = false;
  const send = (text) => socket.readyState===1 && socket.send(JSON.stringify({ type:'transcript', transcriptType:'final', transcript:text }));
  const process_ = async () => {
    if (busy || !chunks.length) return; busy = true;
    const pcm = Buffer.concat(chunks.splice(0));
    if (pcm.length < 3200) { busy=false; return; }
    try {
      const form = new FormData();
      form.append('file', Buffer.concat([buildWavHeader(pcm.length), pcm]), { filename:'audio.wav', contentType:'audio/wav' });
      form.append('model','saarika:v2'); form.append('language_code','hi-IN'); form.append('with_timestamps','false');
      const r = await fetch('https://api.sarvam.ai/speech-to-text', { method:'POST', headers:{'api-subscription-key':SARVAM_API_KEY,...form.getHeaders()}, body:form });
      const j = await r.json();
      if (j.transcript?.trim()) { console.log('[STT]',j.transcript); send(j.transcript.trim()); }
    } catch(e) { console.error('[STT]',e.message); } finally { busy=false; }
  };
  socket.on('message',(d,bin)=>{ if(bin){chunks.push(Buffer.from(d));clearTimeout(timer);timer=setTimeout(process_,500);} });
  socket.on('close',()=>clearTimeout(timer));
});
