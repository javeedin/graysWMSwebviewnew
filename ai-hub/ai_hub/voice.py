"""Voice for the AI Agent: text-to-speech and speech-to-text behind one small interface.

TTS  elevenlabs (most natural; eleven_flash_v2_5 = low latency), azure (neural voices, SSML), polly (Amazon Polly
     generative / neural with the AWS credentials of a Bedrock provider), browser (the page speaks itself).
STT  elevenlabs (Scribe), azure (short-audio REST, 16 kHz WAV), whisper (faster-whisper on this PC - free, offline once
     the model is downloaded), browser (the page's own recogniser where the WebView has one).
The page records 16 kHz mono WAV and sends it base64; audio comes back base64 (mp3). Keys: secrets.py
(elevenlabs.api_key, azure_speech.key) - never in config.json, never returned.
"""
from __future__ import annotations

import base64
import html
import re
import threading
import time

import httpx

from . import secrets
from .config import HubConfig

TTS_PROVIDERS = ["browser", "piper", "elevenlabs", "azure", "polly"]

# Language → a female (F) and male (M) voice per provider. "voice" in the settings overrides this; empty = pick from here.
# piper: free neural voices that run on this PC (rhasspy/piper-voices, downloaded once, ~60 MB each)
LANGS: dict[str, dict] = {
    "en-US": {"name": "English (US)", "stt": "en", "piper": {"F": "en_US-amy-medium", "M": "en_US-ryan-high"},
              "azure": {"F": "en-US-AvaMultilingualNeural", "M": "en-US-AndrewMultilingualNeural"}, "polly": {"F": "Ruth", "M": "Matthew"}},
    "en-GB": {"name": "English (UK)", "stt": "en", "piper": {"F": "en_GB-alba-medium", "M": "en_GB-alan-medium"},
              "azure": {"F": "en-GB-SoniaNeural", "M": "en-GB-RyanNeural"}, "polly": {"F": "Amy", "M": "Brian"}},
    "fr-FR": {"name": "Français", "stt": "fr", "piper": {"F": "fr_FR-siwis-medium", "M": "fr_FR-tom-medium"},
              "azure": {"F": "fr-FR-DeniseNeural", "M": "fr-FR-HenriNeural"}, "polly": {"F": "Lea", "M": "Remi"}},
    "hi-IN": {"name": "हिन्दी (Hindi)", "stt": "hi", "piper": {"F": "hi_IN-priyamvada-medium", "M": "hi_IN-pratham-medium"},
              "azure": {"F": "hi-IN-SwaraNeural", "M": "hi-IN-MadhurNeural"}, "polly": {"F": "Kajal", "M": "Kajal"}},
    "ar-SA": {"name": "العربية (Arabic)", "stt": "ar", "piper": {"F": "ar_JO-kareem-medium", "M": "ar_JO-kareem-medium"},
              "azure": {"F": "ar-SA-ZariyahNeural", "M": "ar-SA-HamedNeural"}, "polly": {"F": "Hala", "M": "Zayd"}},
    "de-DE": {"name": "Deutsch", "stt": "de", "piper": {"F": "de_DE-kerstin-low", "M": "de_DE-thorsten-medium"},
              "azure": {"F": "de-DE-KatjaNeural", "M": "de-DE-ConradNeural"}, "polly": {"F": "Vicki", "M": "Daniel"}},
    "es-ES": {"name": "Español", "stt": "es", "piper": {"F": "es_ES-sharvard-medium", "M": "es_ES-davefx-medium"},
              "azure": {"F": "es-ES-ElviraNeural", "M": "es-ES-AlvaroNeural"}, "polly": {"F": "Lucia", "M": "Sergio"}},
    "zh-CN": {"name": "中文 (Chinese)", "stt": "zh", "piper": {"F": "zh_CN-huayan-medium", "M": "zh_CN-huayan-medium"},
              "azure": {"F": "zh-CN-XiaoxiaoNeural", "M": "zh-CN-YunxiNeural"}, "polly": {"F": "Zhiyu", "M": "Zhiyu"}},
}
ELEVEN_STOCK = {"F": "21m00Tcm4TlvDq8ikWAM", "M": "pNInz6obpgDQGcFmaJgB"}   # Rachel / Adam - multilingual with flash v2.5


def lang_of(cfg: HubConfig) -> str:
    code = cfg.voice.get("language") or "en-US"
    return code if code in LANGS else "en-US"


def gender_of(cfg: HubConfig) -> str:
    return "M" if str(cfg.voice.get("gender") or "female").lower().startswith("m") else "F"


def pick_voice(cfg: HubConfig, provider: str) -> str:
    """The voice for this provider: the explicit setting, else language + gender from LANGS."""
    explicit = cfg.voice["tts"].get("voice") or ""
    if explicit and cfg.voice["tts"].get("voice_provider", provider) == provider:
        return explicit
    g, lang = gender_of(cfg), LANGS[lang_of(cfg)]
    if provider == "elevenlabs":
        return ELEVEN_STOCK[g]
    return (lang.get(provider) or {}).get(g, "")
STT_PROVIDERS = ["browser", "elevenlabs", "azure", "whisper"]
SECRET_NAMES = ["elevenlabs.api_key", "azure_speech.key", "twilio.auth_token"]
MAX_TTS_CHARS = 2500
MAX_AUDIO_BYTES = 6 * 1024 * 1024

# what the model is told when its words are spoken (app voice mode) or it is on a phone call
VOICE_STYLE = """VOICE MODE - your words are spoken aloud by a natural voice and the user talks back. Sound like a helpful
colleague, not a report: short natural sentences, contractions, warm and direct, one idea at a time. No Markdown,
tables, bullet lists, links, code or emoji in what you say. Say numbers the way people say them ("about twelve and a half
thousand rupees", "three out of four orders"), round when exactness doesn't matter, dates like "Tuesday the 2nd". Never
read IDs or SQL aloud unless asked. For long results give the headline and offer the rest ("want me to go through
them?") - the full data still goes to the results panel on screen, so you can say "I've put the list on your screen".
Before a tool that takes a moment say a short filler first ("Let me check that."). Ask one question at a time. If you
did not catch something, say so and ask again. Keep each reply under about 60 words unless the user asks for more."""

PHONE_STYLE = """PHONE CALL - you are on a real phone call for {company}. Speak exactly as in VOICE MODE, even shorter (1-3
sentences per turn). You are an AI assistant and said so in the greeting; if asked, always confirm you are an AI.
Nothing that changes data, sends, prints, orders or approves can be done on a call - if the caller wants that, say you
will pass it to the team and use take_message. {access}
{goal}When the goal is reached or the caller wants to finish, say a friendly goodbye and call end_call."""

ACCESS_VERIFIED = "The caller is verified as app user {user}: you may look things up for them with your read-only tools."
ACCESS_UNVERIFIED = ("The caller is NOT verified: share no company data at all (no orders, trips, customers, amounts, names). "
                     "Take a message instead: their name, company, reason and a callback number - confirm it back, then take_message.")


class VoiceError(Exception):
    pass


def _key(name: str) -> str:
    v = secrets.get_secret(name)
    if not v:
        raise VoiceError(f"No key set for {name.split('.')[0]} - add it in AI Agent › Voice settings.")
    return v


def speakable(text: str) -> str:
    """Markdown → words a voice can read (links → their text, tables / code dropped, badges → label)."""
    t = re.sub(r"^\s*#{1,6}\s*(.+?)\s*$", r"\1.", text or "", flags=re.M)
    t = re.sub(r"```.*?```", " ", t, flags=re.S)
    t = re.sub(r"\[\[\w+:([^\]]+)\]\]", r"\1", t)
    t = re.sub(r"!?\[([^\]]+)\]\([^)]+\)", r"\1", t)
    t = re.sub(r"https?://\S+", "the link on your screen", t)
    t = "\n".join(line for line in t.split("\n") if not re.match(r"^\s*\|", line) and not re.match(r"^\s*>\s*\[!", line))
    t = re.sub(r"[*_`#>~=]+", "", t)
    t = re.sub(r"^\s*[-•]\s+", "", t, flags=re.M)
    return re.sub(r"\s+", " ", t).strip()


# ── TTS ──────────────────────────────────────────────────────────
def tts(cfg: HubConfig, text: str, provider: str | None = None, voice: str | None = None) -> dict:
    v = cfg.voice
    p = (provider or v["tts"]["provider"] or "browser").lower()
    text = speakable(text)[:MAX_TTS_CHARS]
    if not text:
        raise VoiceError("Nothing to say.")
    if p == "browser":
        return {"provider": "browser", "text": text}
    t0 = time.time()
    voice = voice or pick_voice(cfg, p)
    if p == "piper":
        audio, mime = _piper_say(cfg, text, voice), "audio/wav"
    elif p == "elevenlabs":
        vid = voice or ELEVEN_STOCK["F"]
        r = httpx.post(f"https://api.elevenlabs.io/v1/text-to-speech/{vid}", params={"output_format": "mp3_44100_128"},
                       headers={"xi-api-key": _key("elevenlabs.api_key"), "accept": "audio/mpeg"},
                       json={"text": text, "model_id": v["tts"].get("model") or "eleven_flash_v2_5", "language_code": LANGS[lang_of(cfg)]["stt"],
                             "voice_settings": {"stability": 0.45, "similarity_boost": 0.8, "style": 0.15, "speed": float(v["tts"].get("speed") or 1.0)}},
                       timeout=60)
        _ok(r, "ElevenLabs")
        audio, mime = r.content, "audio/mpeg"
    elif p == "azure":
        name = voice or LANGS["en-US"]["azure"]["F"]
        lang = "-".join(name.split("-")[:2])
        rate = f"{int((float(v['tts'].get('speed') or 1.0) - 1) * 100):+d}%"
        ssml = (f"<speak version='1.0' xmlns='http://www.w3.org/2001/10/synthesis' xml:lang='{lang}'><voice name='{html.escape(name)}'>"
                f"<prosody rate='{rate}'>{html.escape(text)}</prosody></voice></speak>")
        r = httpx.post(f"https://{v.get('azure_region') or 'westeurope'}.tts.speech.microsoft.com/cognitiveservices/v1",
                       headers={"Ocp-Apim-Subscription-Key": _key("azure_speech.key"), "Content-Type": "application/ssml+xml",
                                "X-Microsoft-OutputFormat": "audio-24khz-48kbitrate-mono-mp3", "User-Agent": "GraysAiHub"},
                       content=ssml.encode("utf-8"), timeout=60)
        _ok(r, "Azure Speech")
        audio, mime = r.content, "audio/mpeg"
    elif p == "polly":
        sess = _aws_session(cfg)
        engine = v["tts"].get("engine") or "generative"
        polly = sess.client("polly")
        try:
            r = polly.synthesize_speech(Text=text, OutputFormat="mp3", VoiceId=voice or "Ruth", Engine=engine)
        except Exception:  # noqa: BLE001 - not every voice has the generative engine: fall back to neural
            r = polly.synthesize_speech(Text=text, OutputFormat="mp3", VoiceId=voice or "Ruth", Engine="neural")
        audio, mime = r["AudioStream"].read(), "audio/mpeg"
    else:
        raise VoiceError(f"Unknown TTS provider {p} ({', '.join(TTS_PROVIDERS)}).")
    return {"provider": p, "mime": mime, "audio_b64": base64.b64encode(audio).decode(), "chars": len(text), "ms": int((time.time() - t0) * 1000)}


def voices(cfg: HubConfig, provider: str) -> list[dict]:
    p = (provider or "").lower()
    if p == "piper":
        return [{"id": v["piper"][g], "name": v["piper"][g], "info": f"{v['name']} · {'female' if g == 'F' else 'male'}"}
                for v in LANGS.values() for g in ("F", "M") if g == "F" or v["piper"]["M"] != v["piper"]["F"]]
    if p == "elevenlabs":
        r = httpx.get("https://api.elevenlabs.io/v1/voices", headers={"xi-api-key": _key("elevenlabs.api_key")}, timeout=30)
        _ok(r, "ElevenLabs")
        return [{"id": x["voice_id"], "name": x.get("name"), "info": " · ".join(str(v) for v in (x.get("labels") or {}).values())}
                for x in r.json().get("voices", [])]
    if p == "azure":
        r = httpx.get(f"https://{cfg.voice.get('azure_region') or 'westeurope'}.tts.speech.microsoft.com/cognitiveservices/voices/list",
                      headers={"Ocp-Apim-Subscription-Key": _key("azure_speech.key")}, timeout=30)
        _ok(r, "Azure Speech")
        return [{"id": x["ShortName"], "name": x.get("DisplayName"), "info": f"{x.get('Locale')} · {x.get('Gender')}"}
                for x in r.json() if str(x.get("Locale", "")).startswith(("en", "fr"))]
    if p == "polly":
        sess = _aws_session(cfg)
        engine = cfg.voice["tts"].get("engine") or "generative"
        vs = sess.client("polly").describe_voices(Engine=engine).get("Voices", [])
        return [{"id": x["Id"], "name": x.get("Name"), "info": f"{x.get('LanguageName')} · {x.get('Gender')}"} for x in vs]
    return []


# ── STT ──────────────────────────────────────────────────────────
_whisper = None
_whisper_lock = threading.Lock()


def stt(cfg: HubConfig, audio_b64: str, mime: str = "audio/wav", language: str | None = None, provider: str | None = None) -> dict:
    v = cfg.voice["stt"]
    p = (provider or v.get("provider") or "browser").lower()
    if p == "browser":
        raise VoiceError("Speech recognition is set to the browser - the page transcribes itself.")
    audio = base64.b64decode(audio_b64 or "")
    if not audio:
        raise VoiceError("No audio.")
    if len(audio) > MAX_AUDIO_BYTES:
        raise VoiceError("Audio too long (max about 3 minutes).")
    lang = (language or v.get("language") or LANGS[lang_of(cfg)]["stt"]).split("-")[0]
    t0 = time.time()
    if p == "elevenlabs":
        r = httpx.post("https://api.elevenlabs.io/v1/speech-to-text", headers={"xi-api-key": _key("elevenlabs.api_key")},
                       data={"model_id": v.get("model") or "scribe_v1", "language_code": lang, "tag_audio_events": "false"},
                       files={"file": ("speech.wav", audio, mime)}, timeout=60)
        _ok(r, "ElevenLabs")
        text = r.json().get("text", "")
    elif p == "azure":
        loc = language if language and "-" in language else {"en": "en-US", "fr": "fr-FR"}.get(lang, lang)
        r = httpx.post(f"https://{cfg.voice.get('azure_region') or 'westeurope'}.stt.speech.microsoft.com/speech/recognition/conversation/cognitiveservices/v1",
                       params={"language": loc, "format": "simple"},
                       headers={"Ocp-Apim-Subscription-Key": _key("azure_speech.key"), "Content-Type": "audio/wav; codecs=audio/pcm; samplerate=16000"},
                       content=audio, timeout=60)
        _ok(r, "Azure Speech")
        j = r.json()
        text = j.get("DisplayText", "") if j.get("RecognitionStatus") == "Success" else ""
    elif p == "whisper":
        text = _whisper_transcribe(audio, lang, v.get("whisper_size") or "base")
    else:
        raise VoiceError(f"Unknown STT provider {p} ({', '.join(STT_PROVIDERS)}).")
    return {"provider": p, "text": (text or "").strip(), "ms": int((time.time() - t0) * 1000)}


def _whisper_transcribe(audio: bytes, lang: str, size: str) -> str:
    global _whisper
    try:
        from faster_whisper import WhisperModel  # optional: pip install faster-whisper
    except ImportError as e:
        raise VoiceError("Local Whisper is not installed on the hub: run  .venv\\Scripts\\pip install faster-whisper") from e
    import io
    samples = wav_samples(audio)        # decode here: faster-whisper's own decoder (PyAV) breaks with PyAV 15+
    with _whisper_lock:
        if _whisper is None or _whisper[0] != size:
            _whisper = (size, WhisperModel(size, device="cpu", compute_type="int8"))
        segs, _ = _whisper[1].transcribe(samples if samples is not None else io.BytesIO(audio), language=lang, vad_filter=True, beam_size=1)
        return " ".join(s.text.strip() for s in segs)


def wav_samples(audio: bytes):
    """PCM WAV → mono float32 samples at 16 kHz (what Whisper wants), or None when it is not a plain PCM WAV."""
    import io
    import wave
    try:
        import numpy as np
        with wave.open(io.BytesIO(audio), "rb") as w:
            rate, ch, width, n = w.getframerate(), w.getnchannels(), w.getsampwidth(), w.getnframes()
            raw = w.readframes(n)
    except Exception:  # noqa: BLE001 - not a PCM WAV (e.g. webm): let Whisper decode it
        return None
    if width == 2:
        x = np.frombuffer(raw, dtype="<i2").astype(np.float32) / 32768.0
    elif width == 4:
        x = np.frombuffer(raw, dtype="<i4").astype(np.float32) / 2147483648.0
    elif width == 1:
        x = (np.frombuffer(raw, dtype=np.uint8).astype(np.float32) - 128.0) / 128.0
    else:
        return None
    if ch > 1:
        x = x.reshape(-1, ch).mean(axis=1)
    if rate != 16000 and len(x):
        t = np.arange(0, len(x) / rate, 1 / 16000)
        x = np.interp(t, np.arange(len(x)) / rate, x).astype(np.float32)
    return np.ascontiguousarray(x, dtype=np.float32)


# ── helpers ──────────────────────────────────────────────────────
def _ok(r: httpx.Response, who: str) -> None:
    if r.status_code >= 400:
        detail = r.text[:300]
        raise VoiceError(f"{who}: HTTP {r.status_code} {detail}")


def _aws_session(cfg: HubConfig):
    from .providers import BedrockConverseProvider
    pid = cfg.voice.get("aws_provider") or "bedrock"
    pc = cfg.providers.get(pid)
    if not pc:
        raise VoiceError(f"Amazon Polly uses the AWS credentials of provider '{pid}' - set that provider up first.")
    return BedrockConverseProvider(pid, pc)._session()


# ── Piper: free neural voices on this PC ──
PIPER_BASE = "https://huggingface.co/rhasspy/piper-voices/resolve/main"
_piper: dict = {}
_piper_lock = threading.Lock()


def piper_dir():
    from .config import home
    d = home() / "voices" / "piper"
    d.mkdir(parents=True, exist_ok=True)
    return d


def piper_download(name: str) -> None:
    """Downloads <name>.onnx + .onnx.json once (e.g. en_US-amy-medium)."""
    m = re.fullmatch(r"([a-z]{2})_([A-Z]{2})-([a-z0-9_]+)-(x_low|low|medium|high)", name or "")
    if not m:
        raise VoiceError(f"Not a Piper voice name: {name}")
    lang, locale, who, q = m.group(1), f"{m.group(1)}_{m.group(2)}", m.group(3), m.group(4)
    for ext in (".onnx.json", ".onnx"):
        f = piper_dir() / (name + ext)
        if f.exists() and f.stat().st_size > 0:
            continue
        url = f"{PIPER_BASE}/{lang}/{locale}/{who}/{q}/{name}{ext}"
        with httpx.stream("GET", url, follow_redirects=True, timeout=600) as r:
            if r.status_code >= 400:
                raise VoiceError(f"Voice {name} could not be downloaded (HTTP {r.status_code}).")
            tmp = f.with_suffix(f.suffix + ".part")
            with open(tmp, "wb") as out:
                for chunk in r.iter_bytes(1 << 16):
                    out.write(chunk)
            tmp.replace(f)


def _piper_say(cfg: HubConfig, text: str, name: str) -> bytes:
    try:
        from piper import PiperVoice  # optional: one click in Voice settings (pip install piper-tts)
    except ImportError as e:
        raise VoiceError("The free natural voice is not set up yet - Voice settings › Set up natural voice.") from e
    import io
    import wave
    name = name or LANGS["en-US"]["piper"]["F"]
    with _piper_lock:
        if name not in _piper:
            # a voice that cannot be downloaded falls back to the other gender of the language, then English
            lang = LANGS[lang_of(cfg)]["piper"]
            tried, err = [], None
            for cand in dict.fromkeys([name, lang["F"], lang["M"], LANGS["en-US"]["piper"]["F"]]):
                try:
                    piper_download(cand)
                    _piper[name] = PiperVoice.load(str(piper_dir() / (cand + ".onnx")))
                    break
                except Exception as e:  # noqa: BLE001
                    tried.append(cand)
                    err = e
            else:
                raise VoiceError(f"No natural voice could be loaded ({', '.join(tried)}): {err}")
        vo = _piper[name]
        speed = float(cfg.voice["tts"].get("speed") or 1.0)
        buf = io.BytesIO()
        with wave.open(buf, "wb") as wf:
            if hasattr(vo, "synthesize_wav"):          # piper-tts 1.3+
                try:
                    from piper import SynthesisConfig
                    vo.synthesize_wav(text, wf, syn_config=SynthesisConfig(length_scale=1.0 / speed))
                except ImportError:
                    vo.synthesize_wav(text, wf)
            else:                                      # piper-tts 1.2
                vo.synthesize(text, wf, length_scale=1.0 / speed)
        return buf.getvalue()


# ── free local recognition: install faster-whisper into the hub's own Python (one click from the page) ──
_wsetup: dict = {"state": "idle", "log": "", "error": None}


def whisper_installed() -> bool:
    import importlib.util
    return importlib.util.find_spec("faster_whisper") is not None


def whisper_status() -> dict:
    return {"installed": whisper_installed(), **_wsetup}


def whisper_install(cfg: HubConfig) -> dict:
    """pip install faster-whisper into this hub's Python, then load the model once (downloads it, ~150 MB for 'base')."""
    if _wsetup["state"] == "running":
        return whisper_status()
    import subprocess
    import sys

    def run():
        _wsetup.update(state="running", log="Installing faster-whisper…\n", error=None)
        try:
            # install, or upgrade a half-matching pair (an old faster-whisper next to PyAV 15+ broke its decoder)
            if True:
                p = subprocess.run([sys.executable, "-m", "pip", "install", "--upgrade", "--disable-pip-version-check", "faster-whisper"],
                                   capture_output=True, text=True, timeout=1800)
                _wsetup["log"] += (p.stdout or "")[-3000:] + (p.stderr or "")[-2000:]
                if p.returncode != 0:
                    raise VoiceError("pip install faster-whisper failed (see log)")
                import importlib
                importlib.invalidate_caches()
            size = cfg.voice["stt"].get("whisper_size") or "base"
            _wsetup["log"] += f"\nDownloading the '{size}' speech model (first time only)…\n"
            from faster_whisper import WhisperModel
            global _whisper
            with _whisper_lock:
                _whisper = (size, WhisperModel(size, device="cpu", compute_type="int8"))
            cfg.voice["stt"]["provider"] = "whisper"
            cfg.save()
            _wsetup.update(state="done", log=_wsetup["log"] + "Ready - speech recognition now runs on this PC.\n")
        except Exception as e:  # noqa: BLE001 - reported to the page
            _wsetup.update(state="error", error=f"{type(e).__name__}: {e}")

    threading.Thread(target=run, daemon=True, name="whisper-setup").start()
    _wsetup["state"] = "running"
    return whisper_status()


_psetup: dict = {"state": "idle", "log": "", "error": None}


def piper_installed() -> bool:
    import importlib.util
    return importlib.util.find_spec("piper") is not None


def piper_status(cfg: HubConfig | None = None) -> dict:
    have = sorted(p.name[:-5] for p in piper_dir().glob("*.onnx")) if piper_installed() else []
    return {"installed": piper_installed(), "voices": have, **_psetup}


def piper_install(cfg: HubConfig) -> dict:
    """pip install piper-tts into this hub's Python, download the voice for the chosen language + gender, use it."""
    if _psetup["state"] == "running":
        return piper_status(cfg)
    import subprocess
    import sys

    def run():
        _psetup.update(state="running", log="Installing the natural voice engine (piper-tts)…\n", error=None)
        try:
            if not piper_installed():
                p = subprocess.run([sys.executable, "-m", "pip", "install", "--disable-pip-version-check", "piper-tts"],
                                   capture_output=True, text=True, timeout=1800)
                _psetup["log"] += (p.stdout or "")[-2000:] + (p.stderr or "")[-2000:]
                if p.returncode != 0:
                    raise VoiceError("pip install piper-tts failed (see log)")
                import importlib
                importlib.invalidate_caches()
            name = pick_voice(cfg, "piper")
            _psetup["log"] += f"\nDownloading the voice {name} (first time only)…\n"
            piper_download(name)
            cfg.voice["tts"]["provider"] = "piper"
            cfg.save()
            _psetup.update(state="done", log=_psetup["log"] + "Ready.\n")
        except Exception as e:  # noqa: BLE001 - reported to the page
            _psetup.update(state="error", error=f"{type(e).__name__}: {e}")

    threading.Thread(target=run, daemon=True, name="piper-setup").start()
    _psetup["state"] = "running"
    return piper_status(cfg)


def status(cfg: HubConfig) -> dict:
    return {"voice": cfg.voice, "tts_providers": TTS_PROVIDERS, "stt_providers": STT_PROVIDERS,
            "keys": {n: secrets.has_secret(n) for n in SECRET_NAMES}, "whisper": whisper_status(), "piper": piper_status(cfg),
            "languages": {k: {"name": v["name"], "piper": v["piper"], "azure": v["azure"], "polly": v["polly"]} for k, v in LANGS.items()},
            "language": lang_of(cfg), "gender": "male" if gender_of(cfg) == "M" else "female"}
