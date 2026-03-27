/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useState, useEffect, useRef, useCallback } from 'react';
import { GoogleGenAI, Modality, LiveServerMessage } from "@google/genai";
import { Mic, MicOff, Send, Volume2, VolumeX, Sparkles, MessageSquare, RotateCcw } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import MathRenderer from './components/MathRenderer';
import VisualAid from './components/VisualAid';
import { cn } from './lib/utils';

// --- Constants & Types ---
const SYSTEM_INSTRUCTION = `Identity: You are Harun (হারুন), a highly intelligent, warm, and professional math tutor. You don't just solve equations; you make math feel like a conversation between friends.

1. Persona & Voice (The Soul)
Personality: Encouraging, patient, and slightly witty. You celebrate wins ("দারুণ চিন্তা!", "You're a genius!") and treat mistakes as learning steps.
Voice-First Behavior: Keep spoken answers smooth and conversational. Pause naturally before revealing results. Read math aloud naturally: instead of saying "x^2", say "x squared" or "x-এর বর্গ".
Tone: Respectful but relatable. Avoid being a rigid calculator; be a supportive coach.

2. Language & Localization (The Bridge)
Bilingual Default: Detect the user's language. If they speak Bengali, English, or "Banglish," mirror their style naturally.
The "Harun Style" Bengali: Use natural spoken Bengali (চলতি ভাষা). Avoid overly formal or bookish words.
Term Mixing: Use English technical terms (e.g., Integration, Matrix, Derivative, Triangle) alongside Bengali explanations to ensure the user stays globally competitive.

3. Mathematical Pedagogy (The Brain)
Concept Over Calculation: Don't just give the answer. Explain the "Why" before the "How."
The 4-Step Solution:
Restate: Confirm you understood the problem.
Strategy: Briefly explain the concept (e.g., "We'll use the Pythagorean theorem here").
Execution: Solve step-by-step using clear logic.
Verification: Offer a quick way to check if the answer is correct.
Levels: Adapt to the user. Whether it's basic arithmetic for a school kid or complex calculus for a university student, adjust your jargon accordingly.

4. Visual Aids & Practice (NEW)
Visual Aids: When explaining a concept that can be visualized (geometry, calculus graphs, or data sets), generate a relevant visual aid. Use the following format:
<visual_aid>
{
  "type": "function" | "geometry" | "data",
  "data": [ { "x": number, "y": number } ] (for function) | [ { "name": string, "value": number } ] (for data),
  "config": {
    "label": "Description of the visual",
    "svgContent": "SVG inner elements" (for geometry),
    "viewBox": "0 0 200 200" (optional for geometry)
  }
}
</visual_aid>
Practice Quizzes: After explaining a topic and solving a problem, ALWAYS offer to create a short practice quiz (2-3 questions) on that specific concept. Keep it encouraging and at a similar difficulty level.

5. UI & Formatting (The Visuals)
Your responses must be beautiful and scannable. Use this structure:
## Problem: [The Question]
### Concept: [A 1-sentence explanation]
### Steps:
[Step one...]
[Step two...]
### Final Answer: [The Result]
💡 Harun's Tip: [A shortcut or common mistake to avoid]

6. Rules & Guardrails
LaTeX Usage: Use $inline$ for variables and $$display$$ for standalone formulas. Never use LaTeX for regular text.
Ambiguity: If a problem is unclear, ask for clarification instead of guessing.
Strictly Math: If asked about non-math topics, say: "I'm Harun, your math specialist! Let's get back to the numbers. Any math problems for me?"
Memory: Reference previous problems in the session.`;

// --- Helper for parsing visual aids ---
function parseContent(content: string) {
  const parts: { type: 'text' | 'visual', data?: any, text?: string }[] = [];
  const visualRegex = /<visual_aid>([\s\S]*?)<\/visual_aid>/g;
  let lastIndex = 0;
  let match;

  while ((match = visualRegex.exec(content)) !== null) {
    if (match.index > lastIndex) {
      parts.push({ type: 'text', text: content.substring(lastIndex, match.index) });
    }
    try {
      const visualData = JSON.parse(match[1]);
      parts.push({ type: 'visual', data: visualData });
    } catch (e) {
      console.error("Failed to parse visual aid JSON", e);
      parts.push({ type: 'text', text: match[0] }); // Fallback to raw text
    }
    lastIndex = visualRegex.lastIndex;
  }

  if (lastIndex < content.length) {
    parts.push({ type: 'text', text: content.substring(lastIndex) });
  }

  return parts;
}

interface Message {
  role: 'user' | 'harun';
  content: string;
  isVoice?: boolean;
}

// --- Audio Utilities ---
const SAMPLE_RATE = 16000;

function floatToPcm16(float32Array: Float32Array): Int16Array {
  const pcm16 = new Int16Array(float32Array.length);
  for (let i = 0; i < float32Array.length; i++) {
    const s = Math.max(-1, Math.min(1, float32Array[i]));
    pcm16[i] = s < 0 ? s * 0x8000 : s * 0x7FFF;
  }
  return pcm16;
}

function arrayBufferToBase64(buffer: ArrayBuffer): string {
  let binary = '';
  const bytes = new Uint8Array(buffer);
  const len = bytes.byteLength;
  for (let i = 0; i < len; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return window.btoa(binary);
}

// --- Main Component ---
export default function App() {
  const [messages, setMessages] = useState<Message[]>([
    { role: 'harun', content: "আসসালামু আলাইকুম! আমি হারুন। গণিতের যেকোনো সমস্যায় আমি তোমার বন্ধু হয়ে পাশে আছি। বলো, আজ আমরা কী শিখবো?" }
  ]);
  const [inputText, setInputText] = useState('');
  const [isLive, setIsLive] = useState(false);
  const [isMuted, setIsMuted] = useState(false);
  const [isConnecting, setIsConnecting] = useState(false);
  const [isThinking, setIsThinking] = useState(false);

  // Refs for Live API
  const audioContextRef = useRef<AudioContext | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const processorRef = useRef<ScriptProcessorNode | null>(null);
  const sessionRef = useRef<any>(null);
  const audioQueueRef = useRef<Int16Array[]>([]);
  const isPlayingRef = useRef(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  // --- Live API Logic ---
  const stopLive = useCallback(() => {
    if (sessionRef.current) {
      sessionRef.current.close();
      sessionRef.current = null;
    }
    if (processorRef.current) {
      processorRef.current.disconnect();
      processorRef.current = null;
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(track => track.stop());
      streamRef.current = null;
    }
    setIsLive(false);
    setIsConnecting(false);
  }, []);

  const playAudioQueue = useCallback(async () => {
    if (isPlayingRef.current || audioQueueRef.current.length === 0 || !audioContextRef.current) return;

    isPlayingRef.current = true;
    const ctx = audioContextRef.current;

    while (audioQueueRef.current.length > 0) {
      const pcmData = audioQueueRef.current.shift()!;
      const floatData = new Float32Array(pcmData.length);
      for (let i = 0; i < pcmData.length; i++) {
        floatData[i] = pcmData[i] / 32768.0;
      }

      const buffer = ctx.createBuffer(1, floatData.length, 24000); // Live API returns 24kHz
      buffer.getChannelData(0).set(floatData);

      const source = ctx.createBufferSource();
      source.buffer = buffer;
      source.connect(ctx.destination);
      
      const playPromise = new Promise<void>((resolve) => {
        source.onended = () => resolve();
      });

      source.start();
      await playPromise;
    }

    isPlayingRef.current = false;
  }, []);

  const startLive = async () => {
    if (isLive) {
      stopLive();
      return;
    }

    setIsConnecting(true);
    try {
      const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
      
      audioContextRef.current = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: SAMPLE_RATE });
      streamRef.current = await navigator.mediaDevices.getUserMedia({ audio: true });

      const session = await ai.live.connect({
        model: "gemini-3.1-flash-live-preview",
        config: {
          systemInstruction: SYSTEM_INSTRUCTION,
          responseModalities: [Modality.AUDIO],
          speechConfig: {
            voiceConfig: { prebuiltVoiceConfig: { voiceName: "Charon" } }
          },
          outputAudioTranscription: {},
          inputAudioTranscription: {},
        },
        callbacks: {
          onopen: () => {
            setIsLive(true);
            setIsConnecting(false);
            console.log("Live session opened");
            
            // Start sending audio
            const source = audioContextRef.current!.createMediaStreamSource(streamRef.current!);
            processorRef.current = audioContextRef.current!.createScriptProcessor(4096, 1, 1);
            
            processorRef.current.onaudioprocess = (e) => {
              if (isMuted) return;
              const inputData = e.inputBuffer.getChannelData(0);
              const pcm16 = floatToPcm16(inputData);
              const base64 = arrayBufferToBase64(pcm16.buffer);
              
              session.sendRealtimeInput({
                audio: { data: base64, mimeType: 'audio/pcm;rate=16000' }
              });
            };

            source.connect(processorRef.current);
            processorRef.current.connect(audioContextRef.current!.destination);
          },
          onmessage: (message: LiveServerMessage) => {
            // Handle audio output
            const audioData = message.serverContent?.modelTurn?.parts?.[0]?.inlineData?.data;
            if (audioData) {
              const binary = window.atob(audioData);
              const bytes = new Int16Array(binary.length / 2);
              for (let i = 0; i < bytes.length; i++) {
                bytes[i] = (binary.charCodeAt(i * 2) & 0xFF) | (binary.charCodeAt(i * 2 + 1) << 8);
              }
              audioQueueRef.current.push(bytes);
              playAudioQueue();
            }

            // Handle transcription for UI
            const transcription = message.serverContent?.modelTurn?.parts?.find(p => p.text)?.text;
            if (transcription) {
              setMessages(prev => {
                const last = prev[prev.length - 1];
                if (last && last.role === 'harun' && last.isVoice) {
                  return [...prev.slice(0, -1), { ...last, content: last.content + transcription }];
                }
                return [...prev, { role: 'harun', content: transcription, isVoice: true }];
              });
            }

            if (message.serverContent?.interrupted) {
              audioQueueRef.current = [];
              // In a real app, we'd stop the current source node
            }
          },
          onclose: () => stopLive(),
          onerror: (e) => {
            console.error("Live error:", e);
            stopLive();
          }
        }
      });

      sessionRef.current = session;
    } catch (err) {
      console.error("Failed to start live session:", err);
      setIsConnecting(false);
    }
  };

  // --- Text Chat Logic ---
  const handleSendText = async () => {
    if (!inputText.trim() || isThinking) return;

    const userMsg = inputText;
    setInputText('');
    setMessages(prev => [...prev, { role: 'user', content: userMsg }]);
    setIsThinking(true);

    try {
      const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
      const response = await ai.models.generateContentStream({
        model: "gemini-3-flash-preview",
        contents: userMsg,
        config: {
          systemInstruction: SYSTEM_INSTRUCTION,
        }
      });

      let fullText = '';
      setMessages(prev => [...prev, { role: 'harun', content: '' }]);

      for await (const chunk of response) {
        fullText += chunk.text;
        setMessages(prev => {
          const last = prev[prev.length - 1];
          return [...prev.slice(0, -1), { ...last, content: fullText }];
        });
      }
    } catch (err) {
      console.error("Chat error:", err);
      setMessages(prev => [...prev, { role: 'harun', content: "দুঃখিত, কোনো একটা সমস্যা হয়েছে। আবার চেষ্টা করবে কি?" }]);
    } finally {
      setIsThinking(false);
    }
  };

  return (
    <div className="flex flex-col h-screen bg-[#f5f5f0] font-serif text-[#1a1a1a]">
      {/* Header */}
      <header className="flex items-center justify-between px-6 py-4 bg-white border-b border-[#5A5A40]/10 shadow-sm">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-full bg-[#5A5A40] flex items-center justify-center text-white">
            <Sparkles size={20} />
          </div>
          <div>
            <h1 className="text-xl font-bold tracking-tight text-[#5A5A40]">হারুন (Harun)</h1>
            <p className="text-xs text-[#5A5A40]/60 italic">Your friendly math tutor</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button 
            onClick={() => setMessages([{ role: 'harun', content: "আসসালামু আলাইকুম! আমি হারুন। গণিতের যেকোনো সমস্যায় আমি তোমার বন্ধু হয়ে পাশে আছি। বলো, আজ আমরা কী শিখবো?" }])}
            className="p-2 text-[#5A5A40]/60 hover:text-[#5A5A40] transition-colors"
            title="Reset Conversation"
          >
            <RotateCcw size={20} />
          </button>
        </div>
      </header>

      {/* Chat Area */}
      <main className="flex-1 overflow-y-auto p-4 md:p-8 space-y-6">
        <AnimatePresence initial={false}>
          {messages.map((msg, idx) => (
            <motion.div
              key={idx}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              className={cn(
                "flex w-full",
                msg.role === 'user' ? "justify-end" : "justify-start"
              )}
            >
              <div className={cn(
                "max-w-[85%] md:max-w-[70%] p-4 rounded-2xl shadow-sm",
                msg.role === 'user' 
                  ? "bg-[#5A5A40] text-white rounded-tr-none" 
                  : "bg-white border border-[#5A5A40]/10 rounded-tl-none"
              )}>
                {parseContent(msg.content).map((part, pIdx) => (
                  part.type === 'visual' ? (
                    <VisualAid key={pIdx} type={part.data.type} data={part.data.data} config={part.data.config} />
                  ) : (
                    <MathRenderer 
                      key={pIdx}
                      content={part.text || ''} 
                      className={cn(
                        "prose prose-sm max-w-none",
                        msg.role === 'user' ? "text-white prose-invert" : "text-[#1a1a1a]"
                      )} 
                    />
                  )
                ))}
                {msg.isVoice && (
                  <div className="mt-2 flex items-center gap-1 text-[10px] opacity-50 italic">
                    <Volume2 size={10} /> Voice Response
                  </div>
                )}
              </div>
            </motion.div>
          ))}
        </AnimatePresence>
        {isThinking && (
          <div className="flex justify-start">
            <div className="bg-white border border-[#5A5A40]/10 p-4 rounded-2xl rounded-tl-none shadow-sm flex gap-1">
              <span className="w-2 h-2 bg-[#5A5A40]/40 rounded-full animate-bounce" style={{ animationDelay: '0ms' }} />
              <span className="w-2 h-2 bg-[#5A5A40]/40 rounded-full animate-bounce" style={{ animationDelay: '150ms' }} />
              <span className="w-2 h-2 bg-[#5A5A40]/40 rounded-full animate-bounce" style={{ animationDelay: '300ms' }} />
            </div>
          </div>
        )}
        <div ref={messagesEndRef} />
      </main>

      {/* Controls Area */}
      <footer className="p-4 md:p-6 bg-white border-t border-[#5A5A40]/10">
        <div className="max-w-4xl mx-auto flex flex-col gap-4">
          {/* Voice Controls */}
          <div className="flex items-center justify-center gap-4">
            <button
              onClick={startLive}
              disabled={isConnecting}
              className={cn(
                "group relative flex items-center justify-center w-16 h-16 rounded-full transition-all duration-300 shadow-lg",
                isLive 
                  ? "bg-red-500 hover:bg-red-600 scale-110" 
                  : "bg-[#5A5A40] hover:bg-[#4a4a35] hover:scale-105",
                isConnecting && "opacity-50 cursor-not-allowed"
              )}
            >
              {isConnecting ? (
                <div className="w-6 h-6 border-2 border-white border-t-transparent rounded-full animate-spin" />
              ) : isLive ? (
                <MicOff size={28} className="text-white" />
              ) : (
                <Mic size={28} className="text-white" />
              )}
              {isLive && (
                <span className="absolute -top-1 -right-1 flex h-4 w-4">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-400 opacity-75"></span>
                  <span className="relative inline-flex rounded-full h-4 w-4 bg-red-500"></span>
                </span>
              )}
            </button>

            {isLive && (
              <button
                onClick={() => setIsMuted(!isMuted)}
                className={cn(
                  "p-3 rounded-full border transition-all",
                  isMuted ? "bg-red-50 border-red-200 text-red-500" : "bg-gray-50 border-gray-200 text-gray-500"
                )}
              >
                {isMuted ? <VolumeX size={20} /> : <Volume2 size={20} />}
              </button>
            )}
          </div>

          {/* Text Input */}
          <div className="relative flex items-center gap-2">
            <input
              type="text"
              value={inputText}
              onChange={(e) => setInputText(e.target.value)}
              onKeyPress={(e) => e.key === 'Enter' && handleSendText()}
              placeholder={isLive ? "Harun is listening..." : "Type your math problem here..."}
              disabled={isLive || isThinking}
              className="flex-1 px-6 py-4 bg-[#f5f5f0] rounded-full border border-[#5A5A40]/10 focus:outline-none focus:ring-2 focus:ring-[#5A5A40]/20 transition-all font-serif italic"
            />
            <button
              onClick={handleSendText}
              disabled={!inputText.trim() || isLive || isThinking}
              className="p-4 bg-[#5A5A40] text-white rounded-full hover:bg-[#4a4a35] disabled:opacity-50 disabled:cursor-not-allowed transition-all shadow-md"
            >
              <Send size={20} />
            </button>
          </div>

          <div className="text-center text-[10px] text-[#5A5A40]/40 uppercase tracking-widest font-sans">
            {isLive ? "Live Voice Mode Active" : "Text Mode Active"}
          </div>
        </div>
      </footer>
    </div>
  );
}
