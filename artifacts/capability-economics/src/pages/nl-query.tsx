import { useState, useRef, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { MessageSquare, Send, Clock, Sparkles, Loader2 } from "lucide-react";

const API_BASE = "/api";

type Message = {
  role: "user" | "assistant";
  content: string;
  data?: any;
  durationMs?: number;
};

const SUGGESTIONS = [
  "Which capabilities have highest AI displacement risk?",
  "Show me EVaR leaders",
  "Strongest moats across all industries",
  "Banking capabilities ranked by score",
  "Active trade signals",
  "Which capabilities have lowest investment?",
];

export default function NLQuery() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [history, setHistory] = useState<Array<{ query: string; createdAt: string }>>([]);
  const bottomRef = useRef<HTMLDivElement>(null);
  const sessionToken = localStorage.getItem("ce_session_token") ?? "";

  useEffect(() => {
    fetch(`${API_BASE}/nl-query/history?sessionToken=${sessionToken}`)
      .then((r) => r.json())
      .then(setHistory)
      .catch(() => {});
  }, []);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const ask = async (query: string) => {
    if (!query.trim()) return;
    const userMsg: Message = { role: "user", content: query };
    setMessages((prev) => [...prev, userMsg]);
    setInput("");
    setLoading(true);

    try {
      const res = await fetch(`${API_BASE}/nl-query`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query, sessionToken }),
      });
      const data = await res.json();
      setMessages((prev) => [...prev, { role: "assistant", content: data.response, data: data.data, durationMs: data.durationMs }]);
    } catch (err) {
      setMessages((prev) => [...prev, { role: "assistant", content: "Sorry, something went wrong. Try again." }]);
    }
    setLoading(false);
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    ask(input);
  };

  return (
    <div className="container mx-auto px-4 py-8 max-w-4xl">
      <div className="mb-6">
        <Badge className="mb-2">AI</Badge>
        <div className="inline-flex items-center gap-2 mb-3">
          <span className="h-px w-5 bg-accent" />
          <span className="font-mono text-[10px] uppercase tracking-[0.24em] text-accent">Intelligence</span>
        </div>
        <h1 className="text-3xl font-serif tracking-tight">CE Search</h1>
        <p className="text-muted-foreground mt-1">Natural-language query across the full capability dataset — EVaR, moat scores, AI exposure, trade signals, dependency impact, and more.</p>
      </div>

      {/* Chat Area */}
      <Card className="mb-4">
        <CardContent className="p-0">
          <div className="h-[500px] overflow-y-auto p-4 space-y-4">
            {messages.length === 0 && (
              <div className="flex flex-col items-center justify-center h-full text-center">
                <Sparkles className="w-12 h-12 text-primary/30 mb-4" />
                <p className="text-muted-foreground mb-4">Ask a question about your capability data</p>
                <div className="flex flex-wrap gap-2 justify-center max-w-lg">
                  {SUGGESTIONS.map((s) => (
                    <Button key={s} size="sm" variant="outline" className="text-xs" onClick={() => ask(s)}>{s}</Button>
                  ))}
                </div>
              </div>
            )}

            {messages.map((msg, i) => (
              <div key={i} className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}>
                <div className={`max-w-[80%] rounded-none p-3 ${
                  msg.role === "user"
                    ? "bg-primary text-primary-foreground"
                    : "bg-muted"
                }`}>
                  <div className="whitespace-pre-wrap text-sm">
                    {msg.content.split(/(\*\*.*?\*\*)/).map((part, j) =>
                      part.startsWith("**") && part.endsWith("**")
                        ? <strong key={j}>{part.slice(2, -2)}</strong>
                        : part
                    )}
                  </div>
                  {msg.durationMs !== undefined && (
                    <div className="flex items-center gap-1 mt-1 text-xs opacity-60">
                      <Clock className="w-3 h-3" /> {msg.durationMs}ms
                    </div>
                  )}
                </div>
              </div>
            ))}

            {loading && (
              <div className="flex justify-start">
                <div className="bg-muted rounded-none p-3">
                  <Loader2 className="w-5 h-5 animate-spin text-primary" />
                </div>
              </div>
            )}

            <div ref={bottomRef} />
          </div>

          {/* Input */}
          <form onSubmit={handleSubmit} className="border-t p-3 flex gap-2">
            <Input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="Ask about capabilities, EVaR, moats, AI risk..."
              disabled={loading}
              className="flex-1"
            />
            <Button type="submit" disabled={loading || !input.trim()}>
              <Send className="w-4 h-4" />
            </Button>
          </form>
        </CardContent>
      </Card>

      {/* Recent Queries */}
      {history.length > 0 && (
        <Card>
          <CardHeader><CardTitle className="text-sm flex items-center gap-2"><Clock className="w-4 h-4" /> Recent Queries</CardTitle></CardHeader>
          <CardContent>
            <div className="flex flex-wrap gap-2">
              {history.slice(0, 10).map((h, i) => (
                <Button key={i} size="sm" variant="ghost" className="text-xs" onClick={() => ask(h.query)}>
                  {h.query.length > 50 ? h.query.slice(0, 50) + "..." : h.query}
                </Button>
              ))}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
