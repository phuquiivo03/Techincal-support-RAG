import { Router } from "express";
import multer from "multer";
import { asyncHandler, HttpError } from "../../lib/errors.js";
import {
  detectSourceType,
  isPdfBuffer,
  parsePdf,
  parsePlainText,
  titleFromFileName,
} from "./parser.js";
import { deleteDocument, getStats, ingestDocument, listDocuments } from "./service.js";

const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_UPLOAD_BYTES, files: 1 },
});

export const documentsRouter = Router();

documentsRouter.get(
  "/",
  asyncHandler(async (req, res) => {
    res.json({ documents: await listDocuments() });
  }),
);

documentsRouter.get(
  "/stats",
  asyncHandler(async (req, res) => {
    res.json(await getStats());
  }),
);

documentsRouter.post(
  "/",
  upload.single("file"),
  asyncHandler(async (req, res) => {
    const file = req.file;
    if (!file) throw new HttpError(400, "No file uploaded — send multipart/form-data with a `file` field");

    const sourceType = detectSourceType(file.originalname);
    if (!sourceType) {
      throw new HttpError(415, "Unsupported file type", "Only .pdf, .md and .txt files are accepted");
    }
    if (sourceType === "pdf" && !isPdfBuffer(file.buffer)) {
      throw new HttpError(422, "File has a .pdf extension but is not a valid PDF");
    }

    const content =
      sourceType === "pdf" ? await parsePdf(file.buffer) : parsePlainText(file.buffer.toString("utf-8"));

    const summary = await ingestDocument({
      title: titleFromFileName(file.originalname),
      fileName: file.originalname,
      sourceType,
      content,
    });

    res.status(201).json({ document: summary });
  }),
);

documentsRouter.delete(
  "/:id",
  asyncHandler(async (req, res) => {
    const id = String(req.params.id);
    res.json({ deleted: true, document: await deleteDocument(id) });
  }),
);
