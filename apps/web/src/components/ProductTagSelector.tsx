"use client";

import { useState, useEffect, useRef } from "react";

interface Tag {
  id: string;
  name: string;
  color: string;
}

interface ProductTagSelectorProps {
  productId: string;
  currentTagIds: string[];
  onUpdated: () => void;
}

export default function ProductTagSelector({
  productId,
  currentTagIds,
  onUpdated,
}: ProductTagSelectorProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [allTags, setAllTags] = useState<Tag[]>([]);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set(currentTagIds));
  const [saving, setSaving] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (isOpen) {
      fetch("/api/tags")
        .then((r) => r.json())
        .then((data) => setAllTags(data.tags || []))
        .catch(() => {});
    }
  }, [isOpen]);

  // Close on outside click
  useEffect(() => {
    if (!isOpen) return;
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [isOpen]);

  const toggleTag = async (tagId: string) => {
    const next = new Set(selectedIds);
    if (next.has(tagId)) next.delete(tagId);
    else next.add(tagId);
    setSelectedIds(next);

    setSaving(true);
    try {
      await fetch(`/api/products/${productId}/tags`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tagIds: Array.from(next) }),
      });
      onUpdated();
    } catch {
      // silently fail
    }
    setSaving(false);
  };

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          setIsOpen(!isOpen);
        }}
        className="text-gray-600 hover:text-amber-500 transition p-1"
        title="Etiket ekle"
      >
        <svg
          className="w-3.5 h-3.5"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M20.59 13.41l-7.17 7.17a2 2 0 01-2.83 0L2 12V2h10l8.59 8.59a2 2 0 010 2.82z" />
          <line x1="7" y1="7" x2="7.01" y2="7" />
        </svg>
      </button>

      {isOpen && (
        <div
          className="absolute right-0 top-full mt-1 w-48 bg-[#111113] border border-[#1F1F23] rounded-xl shadow-2xl shadow-black/50 z-50 p-2"
          onClick={(e) => e.stopPropagation()}
        >
          {allTags.length === 0 ? (
            <p className="text-gray-500 text-xs p-2 text-center">Etiket oluşturun</p>
          ) : (
            <div className="space-y-0.5">
              {allTags.map((tag) => (
                <button
                  key={tag.id}
                  onClick={() => toggleTag(tag.id)}
                  disabled={saving}
                  className="w-full flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-xs hover:bg-[#1A1A1E] transition"
                >
                  <span
                    className="w-3 h-3 rounded-full shrink-0 border-2"
                    style={{
                      backgroundColor: selectedIds.has(tag.id) ? tag.color : "transparent",
                      borderColor: tag.color,
                    }}
                  />
                  <span className={selectedIds.has(tag.id) ? "text-white" : "text-gray-400"}>
                    {tag.name}
                  </span>
                  {selectedIds.has(tag.id) && (
                    <svg
                      className="w-3 h-3 text-amber-500 ml-auto"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="3"
                    >
                      <polyline points="20 6 9 17 4 12" />
                    </svg>
                  )}
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
