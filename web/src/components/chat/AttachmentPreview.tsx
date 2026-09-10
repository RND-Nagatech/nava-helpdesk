import { ImageIcon, X } from "lucide-react";
import { useState } from "react";
import { api } from "../../services/api";
import type { Attachment } from "../../types";

function ChatImage({ item }: { item: Attachment }) {
  const primaryUrl = api.imageUrl(item.url);
  const fallbackUrl = api.imageFallbackUrl(item.url);
  const [src, setSrc] = useState(primaryUrl);
  const [broken, setBroken] = useState(false);

  function handleError() {
    if (fallbackUrl && src !== fallbackUrl) {
      setSrc(fallbackUrl);
      return;
    }
    setBroken(true);
  }

  return (
    <a className={`attachment-card ${broken ? "is-broken" : ""}`} href={src || primaryUrl} target="_blank" rel="noreferrer" title="Buka gambar">
      {!broken && (
        <img
          src={src}
          alt={item.original_name}
          loading="lazy"
          onError={handleError}
        />
      )}
      <span className="attachment-fallback">
        <ImageIcon size={16} />
        Buka gambar
      </span>
      <small>{item.original_name}</small>
    </a>
  );
}

export function AttachmentGrid({ attachments = [] }: { attachments?: Attachment[] }) {
  if (!attachments.length) return null;
  return (
    <div className="attachment-grid">
      {attachments.map((item) => (
        <ChatImage item={item} key={item.filename} />
      ))}
    </div>
  );
}

export function PendingFiles({ files, onRemove }: { files: File[]; onRemove: (index: number) => void }) {
  if (!files.length) return null;
  return (
    <div className="pending-files">
      {files.map((file, index) => (
        <span key={`${file.name}-${index}`}>
          {file.name}
          <button type="button" title="Hapus gambar" onClick={() => onRemove(index)}>
            <X size={14} />
          </button>
        </span>
      ))}
    </div>
  );
}
