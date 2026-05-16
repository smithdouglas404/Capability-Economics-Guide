import { useEffect, useRef, useState } from "react";
import { useRoute } from "wouter";
import { Mic, MicOff, Loader2, X } from "lucide-react";

/**
 * Voice advisor — a floating mic button mounted in the global layout.
 * Click + hold (or click once + click again to stop) to record audio,
 * release/stop to send to /api/voice/converse, then plays the spoken
 * response. Auto-detects current capability detail page to pass
 * capabilityId for grounded responses.
 *
 * States: idle | recording | processing | playing | error
 *
 * Permission flow: requests mic on first click. If denied, shows a
 * one-line explainer with re-request button.
 */
export function VoiceAdvisor() {
  const [state, setState] = useState<"idle" | "recording" | "processing" | "playing" | "error">("idle");
  const [permission, setPermission] = useState<"granted" | "denied" | "unknown">("unknown");
  const [transcript, setTranscript] = useState<string>("");
  const [response, setResponse] = useState<string>("");
  const [errorMsg, setErrorMsg] = useState<string>("");
  const [open, setOpen] = useState(false);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const audioElRef = useRef<HTMLAudioElement | null>(null);

  // Detect capabilityId from URL so we can pass it as context
  const [, capParams] = useRoute<{ id: string }>("/capability/:id");
  const capabilityId = capParams?.id ? Number(capParams.id) : null;

  useEffect(() => {
    return () => {
      mediaRecorderRef.current?.stream.getTracks().forEach(t => t.stop());
    };
  }, []);

  const startRecording = async () => {
    setErrorMsg("");
    setTranscript("");
    setResponse("");
    setOpen(true);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      setPermission("granted");
      const mr = new MediaRecorder(stream, { mimeType: "audio/webm" });
      audioChunksRef.current = [];
      mr.ondataavailable = (e) => {
        if (e.data.size > 0) audioChunksRef.current.push(e.data);
      };
      mr.onstop = async () => {
        const blob = new Blob(audioChunksRef.current, { type: "audio/webm" });
        await sendAudio(blob);
        stream.getTracks().forEach(t => t.stop());
      };
      mr.start();
      mediaRecorderRef.current = mr;
      setState("recording");
    } catch (err) {
      setPermission("denied");
      setErrorMsg(err instanceof Error ? err.message : "Microphone access denied");
      setState("error");
    }
  };

  const stopRecording = () => {
    if (mediaRecorderRef.current && mediaRecorderRef.current.state === "recording") {
      mediaRecorderRef.current.stop();
      setState("processing");
    }
  };

  const sendAudio = async (blob: Blob) => {
    try {
      const form = new FormData();
      form.append("audio", blob, "voice.webm");
      if (capabilityId != null) form.append("capabilityId", String(capabilityId));
      const resp = await fetch("/api/voice/converse", { method: "POST", credentials: "include", body: form });
      if (!resp.ok) {
        const errJson = await resp.json().catch(() => ({}));
        throw new Error(errJson.error ?? `HTTP ${resp.status}`);
      }
      const transcriptHeader = decodeURIComponent(resp.headers.get("X-Voice-Transcript") ?? "");
      const responseHeader = decodeURIComponent(resp.headers.get("X-Voice-Response") ?? "");
      setTranscript(transcriptHeader);
      setResponse(responseHeader);

      const audioBuffer = await resp.arrayBuffer();
      const url = URL.createObjectURL(new Blob([audioBuffer], { type: "audio/mpeg" }));
      if (audioElRef.current) {
        audioElRef.current.src = url;
        audioElRef.current.onended = () => { setState("idle"); URL.revokeObjectURL(url); };
        setState("playing");
        await audioElRef.current.play().catch(() => {
          // autoplay blocked — user can click play
          setState("idle");
        });
      } else {
        setState("idle");
      }
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : "Voice round-trip failed");
      setState("error");
    }
  };

  return (
    <div className="fixed bottom-4 right-4 z-50">
      {open && (state === "recording" || state === "processing" || state === "playing" || state === "error" || transcript) && (
        <div className="mb-2 w-80 bg-card border border-border p-3 text-sm shadow-lg">
          <div className="flex items-start justify-between gap-2">
            <div className="flex-1 space-y-2 min-w-0">
              {state === "recording" && <div className="text-xs uppercase tracking-[0.18em] text-rose-600 font-mono">Recording… click mic to stop</div>}
              {state === "processing" && (
                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                  <Loader2 className="w-3 h-3 animate-spin" /> Processing… (Whisper + Sonnet + TTS)
                </div>
              )}
              {transcript && (
                <div>
                  <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground mb-0.5">You said</div>
                  <div className="text-xs italic">"{transcript}"</div>
                </div>
              )}
              {response && (
                <div>
                  <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground mb-0.5">Inflexcvi answered</div>
                  <div className="text-xs">{response}</div>
                </div>
              )}
              {errorMsg && (
                <div className="text-xs text-red-600">{errorMsg}</div>
              )}
              {permission === "denied" && (
                <div className="text-xs text-muted-foreground">
                  Mic access blocked. Re-enable in browser settings, then click mic again.
                </div>
              )}
            </div>
            <button
              onClick={() => { setOpen(false); setTranscript(""); setResponse(""); setErrorMsg(""); setState("idle"); }}
              className="text-muted-foreground hover:text-foreground p-1"
              aria-label="Close"
            >
              <X className="w-3 h-3" />
            </button>
          </div>
        </div>
      )}
      <button
        onClick={state === "recording" ? stopRecording : startRecording}
        disabled={state === "processing"}
        className={`w-14 h-14 rounded-full flex items-center justify-center shadow-lg transition-colors ${
          state === "recording"
            ? "bg-rose-600 text-white animate-pulse"
            : state === "processing"
            ? "bg-muted text-muted-foreground"
            : state === "error" || permission === "denied"
            ? "bg-amber-500/90 text-white"
            : "bg-foreground text-background hover:bg-foreground/90"
        }`}
        title={state === "recording" ? "Stop recording" : "Ask Inflexcvi by voice"}
      >
        {state === "processing"
          ? <Loader2 className="w-5 h-5 animate-spin" />
          : permission === "denied"
          ? <MicOff className="w-5 h-5" />
          : <Mic className="w-5 h-5" />}
      </button>
      <audio ref={audioElRef} hidden />
    </div>
  );
}
