"use client";

import { useState, useEffect } from "react";

interface Tag {
  id: string;
  name: string;
  color: string;
  productCount: number;
}

interface TagFilterBarProps {
  selectedTagId: string | null;
  onSelectTag: (tagId: string | null) => void;
  onManageTags: () => void;
}

export default function TagFilterBar({
  selectedTagId,
  onSelectTag,
  onManageTags,
}: TagFilterBarProps) {
  const [tags, setTags] = useState<Tag[]>([]);

  useEffect(() => {
    async function fetchTags() {
      try {
        const res = await fetch("/api/tags");
        if (res.ok) {
          const data = await res.json();
          setTags(data.tags || []);
        }
      } catch {
        // silently fail
      }
    }
    fetchTags();
  }, []);

  if (tags.length === 0) return null;

  return (
    <div className="flex items-center gap-2 mb-4 sm:mb-6 overflow-x-auto pb-1 scrollbar-hide">
      {/* All */}
      <button
        onClick={() => onSelectTag(null)}
        className={`shrink-0 px-3 py-2 rounded-lg text-xs font-medium transition border ${
          selectedTagId === null
            ? "bg-amber-500/10 text-amber-500 border-amber-500/30"
            : "text-gray-500 border-[#1F1F23] hover:text-white hover:border-[#2F2F33]"
        }`}
      >
        Tümü
      </button>

      {/* Tag pills */}
      {tags.map((tag) => (
        <button
          key={tag.id}
          onClick={() => onSelectTag(selectedTagId === tag.id ? null : tag.id)}
          className={`shrink-0 inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-medium transition border ${
            selectedTagId === tag.id
              ? "border-opacity-50 bg-opacity-10"
              : "border-[#1F1F23] text-gray-500 hover:text-white hover:border-[#2F2F33]"
          }`}
          style={
            selectedTagId === tag.id
              ? {
                  backgroundColor: `${tag.color}15`,
                  color: tag.color,
                  borderColor: `${tag.color}50`,
                }
              : undefined
          }
        >
          <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: tag.color }} />
          {tag.name}
          <span className="text-[10px] opacity-60">({tag.productCount})</span>
        </button>
      ))}

      {/* Manage button */}
      <button
        onClick={onManageTags}
        className="shrink-0 text-gray-600 hover:text-amber-500 transition p-1.5"
        title="Etiketleri düzenle"
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
          <circle cx="12" cy="12" r="1" />
          <circle cx="19" cy="12" r="1" />
          <circle cx="5" cy="12" r="1" />
        </svg>
      </button>
    </div>
  );
}
