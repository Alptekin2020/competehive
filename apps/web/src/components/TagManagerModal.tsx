"use client";

import { useState, useEffect, useCallback } from "react";

interface Tag {
  id: string;
  name: string;
  color: string;
  productCount: number;
}

const PRESET_COLORS = [
  "#F59E0B",
  "#EF4444",
  "#10B981",
  "#3B82F6",
  "#8B5CF6",
  "#EC4899",
  "#F97316",
  "#06B6D4",
];

interface TagManagerModalProps {
  onClose: () => void;
  onUpdated: () => void;
}

export default function TagManagerModal({ onClose, onUpdated }: TagManagerModalProps) {
  const [tags, setTags] = useState<Tag[]>([]);
  const [newName, setNewName] = useState("");
  const [newColor, setNewColor] = useState("#F59E0B");
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState("");
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const fetchTags = useCallback(async () => {
    try {
      const res = await fetch("/api/tags");
      if (res.ok) {
        const data = await res.json();
        setTags(data.tags || []);
      }
    } catch {
      // silently fail
    }
  }, []);

  useEffect(() => {
    fetchTags();
  }, [fetchTags]);

  const handleCreate = async () => {
    if (!newName.trim()) return;
    setError("");
    setCreating(true);
    try {
      const res = await fetch("/api/tags", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: newName.trim(), color: newColor }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setNewName("");
      fetchTags();
      onUpdated();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Etiket oluşturulamadı");
    } finally {
      setCreating(false);
    }
  };

  const handleDelete = async (tagId: string) => {
    try {
      await fetch(`/api/tags?id=${tagId}`, { method: "DELETE" });
      fetchTags();
      onUpdated();
    } catch {
      // silently fail
    }
    setDeletingId(null);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center px-6">
      <div className="fixed inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />
      <div className="bg-[#111113] border border-[#1F1F23] rounded-2xl p-6 w-full max-w-md relative z-10 max-h-[80vh] overflow-y-auto">
        <div className="flex items-center justify-between mb-6">
          <h2 className="text-lg font-bold text-white">Etiketleri Yönet</h2>
          <button onClick={onClose} className="text-gray-500 hover:text-white transition">
            <svg
              className="w-5 h-5"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
            >
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>

        {error && (
          <div className="bg-red-500/10 border border-red-500/20 text-red-400 text-sm rounded-xl px-4 py-3 mb-4">
            {error}
          </div>
        )}

        {/* Create new tag */}
        <div className="flex gap-2 mb-6">
          <div className="flex-1 flex gap-2">
            <input
              type="text"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleCreate()}
              className="flex-1 bg-[#0A0A0B] border border-[#1F1F23] rounded-xl px-3 py-2 text-white text-sm placeholder-gray-600 focus:outline-none focus:border-amber-500/50 transition"
              placeholder="Yeni etiket adı..."
              maxLength={30}
            />
            {/* Color picker */}
            <div className="flex items-center gap-1">
              {PRESET_COLORS.slice(0, 4).map((color) => (
                <button
                  key={color}
                  onClick={() => setNewColor(color)}
                  className={`w-5 h-5 rounded-full transition ${newColor === color ? "ring-2 ring-white ring-offset-1 ring-offset-[#111113]" : ""}`}
                  style={{ backgroundColor: color }}
                />
              ))}
            </div>
          </div>
          <button
            onClick={handleCreate}
            disabled={creating || !newName.trim()}
            className="bg-amber-500 hover:bg-amber-400 disabled:opacity-50 text-black px-4 py-2 rounded-xl text-sm font-semibold transition"
          >
            {creating ? "..." : "Ekle"}
          </button>
        </div>

        {/* More colors */}
        <div className="flex items-center gap-1.5 mb-6">
          <span className="text-gray-600 text-xs mr-1">Renkler:</span>
          {PRESET_COLORS.map((color) => (
            <button
              key={color}
              onClick={() => setNewColor(color)}
              className={`w-6 h-6 rounded-full transition ${newColor === color ? "ring-2 ring-white ring-offset-1 ring-offset-[#111113]" : "hover:scale-110"}`}
              style={{ backgroundColor: color }}
            />
          ))}
        </div>

        {/* Tag list */}
        {tags.length === 0 ? (
          <p className="text-gray-500 text-sm text-center py-4">Henüz etiket oluşturmadınız.</p>
        ) : (
          <div className="space-y-2">
            {tags.map((tag) => (
              <div
                key={tag.id}
                className="flex items-center gap-3 px-3 py-2.5 rounded-xl bg-[#0A0A0B] border border-[#1F1F23]"
              >
                <span
                  className="w-3 h-3 rounded-full shrink-0"
                  style={{ backgroundColor: tag.color }}
                />
                <span className="text-white text-sm flex-1">{tag.name}</span>
                <span className="text-gray-600 text-xs">{tag.productCount} ürün</span>

                {deletingId === tag.id ? (
                  <div className="flex items-center gap-1">
                    <button
                      onClick={() => handleDelete(tag.id)}
                      className="text-xs text-red-400 hover:text-red-300 transition"
                    >
                      Evet
                    </button>
                    <span className="text-gray-600 text-xs">/</span>
                    <button
                      onClick={() => setDeletingId(null)}
                      className="text-xs text-gray-400 hover:text-white transition"
                    >
                      Hayır
                    </button>
                  </div>
                ) : (
                  <button
                    onClick={() => setDeletingId(tag.id)}
                    className="text-gray-600 hover:text-red-400 transition"
                  >
                    <svg
                      className="w-4 h-4"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    >
                      <polyline points="3 6 5 6 21 6" />
                      <path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2" />
                    </svg>
                  </button>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
