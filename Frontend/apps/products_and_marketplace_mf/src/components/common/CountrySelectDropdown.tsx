import { useState, useRef, useEffect, useMemo } from "react";
import { COUNTRIES, type Country } from "../../data/countries";
import { Icon } from "./Icon";
import "./CountrySelectDropdown.css";

interface CountrySelectDropdownProps {
  value: string; // ISO2 code e.g. "IN"
  onChange: (country: Country) => void;
}

export function CountrySelectDropdown({ value, onChange }: CountrySelectDropdownProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [search, setSearch] = useState("");
  const containerRef = useRef<HTMLDivElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);

  const selectedCountry = useMemo(
    () => COUNTRIES.find((c) => c.iso2 === value) || COUNTRIES[0],
    [value]
  );

  const filteredCountries = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return COUNTRIES;
    const cleanNumQuery = q.replace("+", "");

    return COUNTRIES.filter((c) => {
      const nameMatch = c.name.toLowerCase().includes(q);
      const isoMatch = c.iso2.toLowerCase().includes(q);
      const codeMatch = c.dialCode.includes(cleanNumQuery);
      const flagMatch = c.flag.includes(q);
      return nameMatch || isoMatch || codeMatch || flagMatch;
    });
  }, [search]);

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
      setTimeout(() => searchInputRef.current?.focus(), 50);
    } else {
      setSearch("");
    }
  }, [isOpen]);

  const handleSelect = (c: Country) => {
    onChange(c);
    setIsOpen(false);
  };

  return (
    <div className="pm-country-select" ref={containerRef}>
      <button
        type="button"
        className={`pm-country-select-trigger ${isOpen ? "open" : ""}`}
        onClick={() => setIsOpen((prev) => !prev)}
        aria-haspopup="listbox"
        aria-expanded={isOpen}
      >
        <img
          src={`https://flagcdn.com/w40/${selectedCountry.iso2.toLowerCase()}.png`}
          alt={selectedCountry.name}
          className="pm-country-flag-img"
          onError={(e) => {
            (e.target as HTMLImageElement).style.display = "none";
          }}
        />
        <span className="pm-country-code-text">+{selectedCountry.dialCode}</span>
        <span className={`pm-country-arrow ${isOpen ? "up" : ""}`}>
          <Icon name="chevron-down" size={14} />
        </span>
      </button>

      {isOpen && (
        <div className="pm-country-dropdown-menu">
          <div className="pm-country-search-wrap">
            <input
              ref={searchInputRef}
              type="text"
              className="pm-country-search-input"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>

          <ul className="pm-country-options-list" role="listbox">
            {filteredCountries.length > 0 ? (
              filteredCountries.map((c) => (
                <li
                  key={`${c.iso2}-${c.dialCode}`}
                  className={`pm-country-option-item ${c.iso2 === selectedCountry.iso2 ? "selected" : ""}`}
                  onClick={() => handleSelect(c)}
                  role="option"
                  aria-selected={c.iso2 === selectedCountry.iso2}
                >
                  <div className="pm-country-option-left">
                    <img
                      src={`https://flagcdn.com/w40/${c.iso2.toLowerCase()}.png`}
                      alt={c.name}
                      className="pm-country-flag-img"
                      onError={(e) => {
                        (e.target as HTMLImageElement).style.display = "none";
                      }}
                    />
                    <span className="pm-country-option-name">{c.name}</span>
                  </div>
                  <span className="pm-country-option-dial">+{c.dialCode}</span>
                </li>
              ))
            ) : (
              <div className="pm-country-no-results">No countries found</div>
            )}
          </ul>
        </div>
      )}
    </div>
  );
}
