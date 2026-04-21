import { useState } from 'react';
import type { Lang, SearchHit } from '../../types';
import { searchFts } from '../../lib/db';

interface Props {
  lang: Lang;
  onResults: (hits: SearchHit[]) => void;
  onSelect: (hit: SearchHit) => void;
  onClear: () => void;
}

export default function SearchBar({ lang, onResults, onSelect, onClear }: Props) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SearchHit[]>([]);
  const debounceRef = { current: 0 as ReturnType<typeof setTimeout> | 0 };

  function handleChange(value: string) {
    setQuery(value);
    clearTimeout(debounceRef.current);
    if (!value.trim()) {
      setResults([]);
      onResults([]);
      onClear();
      return;
    }
    debounceRef.current = setTimeout(async () => {
      try {
        const hits = await searchFts(value);
        setResults(hits);
        onResults(hits);
      } catch {
        setResults([]);
        onResults([]);
      }
    }, 200);
  }

  return (
    <div className="search-wrap">
      <input
        className="search-input mono"
        placeholder={lang === 'zh' ? '🔍 搜索...' : '🔍 Search...'}
        value={query}
        onChange={(e) => handleChange(e.target.value)}
      />
      {results.length > 0 && (
        <div className="search-results">
          {results.map((hit) => (
            <button
              type="button"
              key={`${hit.conversation_id}-${hit.message_id}`}
              className="search-hit"
              onClick={() => onSelect(hit)}
            >
              <div className="search-hit-title">{hit.conversation_title}</div>
              <div
                className="search-hit-snippet"
                dangerouslySetInnerHTML={{ __html: hit.snippet }}
              />
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
