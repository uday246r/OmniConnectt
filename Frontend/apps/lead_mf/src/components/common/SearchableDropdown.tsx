import React, { useState, useRef, useEffect } from 'react';
import { ChevronDown, X, Check } from 'lucide-react';
import { DropdownOption } from '../../types/lead';
import styles from './SearchableDropdown.module.css';

interface SearchableDropdownProps {
  id?: string;
  label?: string;
  placeholder?: string;
  options: DropdownOption[];
  value: string;
  onChange: (value: string) => void;
  onBlur?: () => void;
  required?: boolean;
  error?: string;
  disabled?: boolean;
  emptyMessage?: string;
}

export const SearchableDropdown: React.FC<SearchableDropdownProps> = ({
  id,
  label,
  placeholder = 'Select an option',
  options = [],
  value,
  onChange,
  onBlur,
  required = false,
  error,
  disabled = false,
  emptyMessage = 'No options available',
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [highlightedIndex, setHighlightedIndex] = useState(-1);
  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Find currently selected option object
  const selectedOption = options.find((opt) => opt.value === value);

  // Synchronize input term when value changes or when closed
  useEffect(() => {
    if (!isOpen) {
      setSearchTerm(selectedOption ? selectedOption.label : '');
    }
  }, [value, selectedOption, isOpen]);

  // Close dropdown on outside click
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        if (isOpen) {
          setIsOpen(false);
          setSearchTerm(selectedOption ? selectedOption.label : '');
          if (onBlur) onBlur();
        }
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [isOpen, selectedOption, onBlur]);

  // Filter options based on direct input search term
  const filteredOptions = options.filter((opt) =>
    opt.label.toLowerCase().includes((isOpen ? searchTerm : '').toLowerCase())
  );

  const handleInputFocus = () => {
    if (disabled) return;
    setIsOpen(true);
    setSearchTerm(''); // Clear text on focus so all options show initially
    setHighlightedIndex(-1);
  };

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (disabled) return;
    setSearchTerm(e.target.value);
    if (!isOpen) setIsOpen(true);
    setHighlightedIndex(0);
  };

  const handleSelect = (option: DropdownOption) => {
    onChange(option.value);
    setSearchTerm(option.label);
    setIsOpen(false);
    setHighlightedIndex(-1);
    if (onBlur) onBlur();
  };

  const handleClear = (e: React.MouseEvent) => {
    e.stopPropagation();
    onChange('');
    setSearchTerm('');
    setIsOpen(true);
    if (inputRef.current) inputRef.current.focus();
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (disabled) return;

    if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (!isOpen) {
        setIsOpen(true);
        setHighlightedIndex(0);
      } else {
        setHighlightedIndex((prev) =>
          prev < filteredOptions.length - 1 ? prev + 1 : 0
        );
      }
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      if (isOpen) {
        setHighlightedIndex((prev) =>
          prev > 0 ? prev - 1 : filteredOptions.length - 1
        );
      }
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (isOpen && highlightedIndex >= 0 && highlightedIndex < filteredOptions.length) {
        handleSelect(filteredOptions[highlightedIndex]);
      }
    } else if (e.key === 'Escape') {
      setIsOpen(false);
      setSearchTerm(selectedOption ? selectedOption.label : '');
    }
  };

  return (
    <div className="form-field-group" ref={containerRef} id={id}>
      {label && (
        <label className="form-label">
          {label} {required && <span className="required-asterisk">*</span>}
        </label>
      )}

      <div className={`dropdown-container ${styles.container}`}>
        {/* Unified Searchable Input Field */}
        <div
          className={`dropdown-trigger ${isOpen ? 'open' : ''} ${error ? 'has-error' : ''} ${styles.trigger}`}
        >
          <input
            ref={inputRef}
            type="text"
            /* NOT `form-input`: the `.dropdown-trigger` wrapper already paints the field's
               background, border and radius, so a second bordered box rendered inside it — the
               "two input boxes" on the Create Lead product picker. `.input` deliberately sets
               `border: none; background: transparent; padding: 0`, and lost to the global class. */
            className={styles.input}
            placeholder={placeholder}
            value={isOpen ? searchTerm : selectedOption ? selectedOption.label : ''}
            onFocus={handleInputFocus}
            onChange={handleInputChange}
            onKeyDown={handleKeyDown}
            disabled={disabled}
          />

          <div className={styles.triggerActions}>
            {selectedOption && !disabled && (
              <button
                type="button"
                onClick={handleClear}
                className={styles.chevron}
                title="Clear selection"
              >
                <X size={14} />
              </button>
            )}
            <ChevronDown
              size={16}
              className={`${styles.chevronIcon}${isOpen ? ` ${styles.chevronOpen}` : ''}`}
            />
          </div>
        </div>

        {/* Dynamic Suggestions List */}
        {isOpen && (
          <div
            className={`dropdown-menu ${styles.menu}`}
          >
            {options.length === 0 ? (
              <div className={`dropdown-empty-state ${styles.emptyState}`}>
                {emptyMessage}
              </div>
            ) : filteredOptions.length === 0 ? (
              <div className={`dropdown-empty-state ${styles.emptyState}`}>
                No matching options
              </div>
            ) : (
              filteredOptions.map((opt, idx) => (
                <div
                  key={opt.value}
                  className={`dropdown-option ${styles.option} ${
                    opt.value === value ? `selected ${styles.optionSelected}` : ''
                  } ${idx === highlightedIndex ? `highlighted ${styles.optionHighlighted}` : ''}`}
                  onMouseDown={(e) => {
                    e.preventDefault(); // Prevent input blur before click registers
                    handleSelect(opt);
                  }}
                  onMouseEnter={() => setHighlightedIndex(idx)}
                >
                  <span>{opt.label}</span>
                  {opt.value === value && <Check size={15} className={styles.optionMeta} />}
                </div>
              ))
            )}
          </div>
        )}
      </div>

      {error && <div className="field-error-message">{error}</div>}
    </div>
  );
};
