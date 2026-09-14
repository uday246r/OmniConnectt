import { useState, useRef, useEffect, useMemo } from "react";
import { Icon } from "./Icon";
import "./CustomSelect.css";

export interface CustomSelectOption {
  value: string;
  label: string;
  sublabel?: string;
}

interface CustomSelectProps {
  options: (CustomSelectOption | string)[];
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  disabled?: boolean;
  error?: boolean;
  className?: string;
  searchable?: boolean;
}

export function CustomSelect({
  options,
  value,
  onChange,
  placeholder = "Select...",
  disabled = false,
  error = false,
  className = "",
  searchable,
}: CustomSelectProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [search, setSearch] = useState("");
  const containerRef = useRef<HTMLDivElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);

  const normalizedOptions: CustomSelectOption[] = useMemo(() => {
    return options.map((opt) => {
      if (typeof opt === "string") {
        return { value: opt, label: opt };
      }
      return opt;
    });
  }, [options]);

  const showSearch = searchable ?? (normalizedOptions.length >= 3);

  const selectedOption = useMemo(
    () => normalizedOptions.find((o) => o.value === value),
    [normalizedOptions, value]
  );

  const filteredOptions = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return normalizedOptions;
    return normalizedOptions.filter(
      (o) =>
        o.label.toLowerCase().includes(q) ||
        (o.sublabel && o.sublabel.toLowerCase().includes(q))
    );
  }, [normalizedOptions, search]);

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  useEffect(() => {
    if (isOpen) {
      if (showSearch) {
        setTimeout(() => searchInputRef.current?.focus(), 50);
      }
    } else {
      setSearch("");
    }
  }, [isOpen, showSearch]);

  const handleSelect = (val: string) => {
    onChange(val);
    setIsOpen(false);
  };

  return (
    <div
      className={`pm-custom-select-container ${disabled ? "disabled" : ""} ${className}`}
      ref={containerRef}
    >
      <button
        type="button"
        className={`pm-custom-select-trigger ${isOpen ? "open" : ""} ${error ? "pm-input-invalid" : ""}`}
        onClick={() => !disabled && setIsOpen((prev) => !prev)}
        disabled={disabled}
        aria-haspopup="listbox"
        aria-expanded={isOpen}
      >
        <span className={`pm-custom-select-value ${!selectedOption ? "placeholder" : ""}`}>
          {selectedOption ? (
            <>
              <span className="pm-custom-select-label-text">{selectedOption.label}</span>
              {selectedOption.sublabel && (
                <span className="pm-custom-select-sublabel-text">({selectedOption.sublabel})</span>
              )}
            </>
          ) : (
            placeholder
          )}
        </span>
        <span className={`pm-custom-select-arrow ${isOpen ? "up" : ""}`}>
          <Icon name="chevron-down" size={16} />
        </span>
      </button>

      {isOpen && (
        <div className="pm-custom-select-dropdown">
          {showSearch && (
            <div className="pm-custom-select-search-wrap">
              <Icon name="search" size={14} />
              <input
                ref={searchInputRef}
                type="text"
                className="pm-custom-select-search-input"
                placeholder="Search options..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
              {search && (
                <button
                  type="button"
                  className="pm-custom-select-search-clear"
                  onClick={() => setSearch("")}
                >
                  <Icon name="close" size={12} />
                </button>
              )}
            </div>
          )}

          <ul className="pm-custom-select-options-list" role="listbox">
            {filteredOptions.length > 0 ? (
              filteredOptions.map((opt) => {
                const isSelected = opt.value === value;
                return (
                  <li
                    key={opt.value}
                    className={`pm-custom-select-option ${isSelected ? "selected" : ""}`}
                    onClick={() => handleSelect(opt.value)}
                    role="option"
                    aria-selected={isSelected}
                  >
                    <div className="pm-custom-select-option-content">
                      <span className="pm-custom-select-option-title">{opt.label}</span>
                      {opt.sublabel && (
                        <span className="pm-custom-select-option-sub">({opt.sublabel})</span>
                      )}
                    </div>
                    {isSelected && <Icon name="check" size={14} className="pm-custom-select-check" />}
                  </li>
                );
              })
            ) : (
              <div className="pm-custom-select-no-results">No matches found</div>
            )}
          </ul>
        </div>
      )}
    </div>
  );
}

