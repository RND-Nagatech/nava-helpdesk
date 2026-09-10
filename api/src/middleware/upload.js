import path from "node:path";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import multer from "multer";

const API_ROOT_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
export const UPLOAD_ROOT_DIR = path.join(API_ROOT_DIR, "uploads");
const HELP_DESK_UPLOAD_DIR = path.join(UPLOAD_ROOT_DIR, "helpdesk");
const MAX_FILE_SIZE = 5 * 1024 * 1024;
const MAX_FILES = 5;
const ALLOWED_MIME_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
]);

fs.mkdirSync(HELP_DESK_UPLOAD_DIR, { recursive: true });

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, HELP_DESK_UPLOAD_DIR),
  filename: (req, file, cb) => {
    const extension = path.extname(file.originalname || "").toLowerCase();
    const safeName = `${Date.now()}-${Math.random().toString(16).slice(2)}${extension}`;
    cb(null, safeName);
  },
});

function fileFilter(req, file, cb) {
  if (!ALLOWED_MIME_TYPES.has(file.mimetype)) {
    return cb(new Error("Format gambar tidak didukung. Gunakan JPG, JPEG, PNG, WEBP, atau GIF."));
  }
  cb(null, true);
}

export const uploadHelpdeskImages = multer({
  storage,
  fileFilter,
  limits: {
    fileSize: MAX_FILE_SIZE,
    files: MAX_FILES,
  },
}).array("images", MAX_FILES);

export function filesToAttachments(files = []) {
  return files.map((file) => ({
    filename: file.filename,
    original_name: file.originalname,
    mime_type: file.mimetype,
    size: file.size,
    url: `/uploads/helpdesk/${file.filename}`,
  }));
}
