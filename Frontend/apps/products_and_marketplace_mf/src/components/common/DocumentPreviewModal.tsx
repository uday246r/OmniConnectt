import { Icon } from "./Icon";
import "./DocumentPreviewModal.css";

interface DocumentPreviewModalProps {
  isOpen: boolean;
  title: string;
  fileUrl: string | null;
  fileName?: string;
  onClose: () => void;
}

export function DocumentPreviewModal({
  isOpen,
  title,
  fileUrl,
  fileName,
  onClose,
}: DocumentPreviewModalProps) {
  if (!isOpen || !fileUrl) return null;

  const isImage =
    fileName?.match(/\.(png|jpe?g|gif|webp|svg)$/i) ||
    fileUrl.match(/\.(png|jpe?g|gif|webp|svg)($|\?)/i) ||
    fileUrl.startsWith("data:image/");

  return (
    <div className="pm-doc-preview-overlay" onClick={onClose} role="dialog" aria-modal="true">
      <div className="pm-doc-preview-card" onClick={(e) => e.stopPropagation()}>
        <header className="pm-doc-preview-header">
          <div className="pm-doc-preview-title-wrap">
            <div className="pm-doc-preview-icon">
              <Icon name="eye" size={18} />
            </div>
            <h3 className="pm-doc-preview-title">{title || fileName || "Document Preview"}</h3>
          </div>
          <button className="pm-icon-btn" onClick={onClose} aria-label="Close preview" title="Close preview">
            <Icon name="close" size={16} />
          </button>
        </header>

        <div className="pm-doc-preview-body">
          {isImage ? (
            <img src={fileUrl} alt={fileName || "Document preview"} className="pm-doc-preview-img" />
          ) : (
            <iframe
              src={fileUrl}
              title={fileName || "Document content"}
              className="pm-doc-preview-frame"
            />
          )}
        </div>

        <footer className="pm-doc-preview-footer">
          <a
            href={fileUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="pm-btn pm-btn-outline"
            style={{ fontSize: 13 }}
          >
            <Icon name="external-link" size={14} /> Open in New Tab
          </a>
          <button className="pm-btn pm-btn-primary" onClick={onClose} style={{ fontSize: 13 }}>
            Close
          </button>
        </footer>
      </div>
    </div>
  );
}
