export const ACCEPT_ATTR = ".pdf,.jpg,.jpeg,.png";
export const MAX_FILE_SIZE_BYTES = 5 * 1024 * 1024; // 5MB

export function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function validateFile(file: File): string | null {
  if (!file) return "File is required.";
  if (file.size > MAX_FILE_SIZE_BYTES) return "File size must be less than 5MB.";

  const allowed = ["application/pdf", "image/jpeg", "image/jpg", "image/png"];
  const extension = file.name.split(".").pop()?.toLowerCase();
  const allowedExts = ["pdf", "jpg", "jpeg", "png"];

  if (!allowed.includes(file.type) && (!extension || !allowedExts.includes(extension))) {
    return "Only PDF, JPG, and PNG files are allowed.";
  }
  return null;
}
