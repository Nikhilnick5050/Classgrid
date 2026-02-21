
import express from 'express';
import multer from 'multer';
import { getChatReply, getVisionReply } from '../services/chat.js';
import { parsePDF } from '../services/file-parser.js';

const router = express.Router();

// Memory storage for Vercel/Serverless compatibility
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024, files: 1 } // 5MB limit
});

router.post('/', upload.single('file'), async (req, res) => {
  try {
    let message = req.body.message || '';
    const file = req.file;

    // If file is present
    if (file) {
      console.log(`Processing file: ${file.originalname} (${file.mimetype})`);

      if (file.mimetype === 'application/pdf') {
        // Parse PDF text
        const pdfText = await parsePDF(file.buffer);
        // Append PDF content to message
        message += `\n\n[Attached PDF Content: ${file.originalname}]\n${pdfText}\n[End of PDF]`;

        // Get standard text reply
        const reply = await getChatReply(message, req.body.model);
        return res.json({ reply });

      } else if (file.mimetype.startsWith('image/')) {
        // Use Vision Model
        // Convert buffer to base64
        const base64Image = file.buffer.toString('base64');
        const mimeType = file.mimetype;

        // Call vision service
        const reply = await getVisionReply(message, base64Image, mimeType, req.body.model);
        return res.json({ reply });
      }
    }

    // Standard text-only chat
    const reply = await getChatReply(message, req.body.model);
    res.json({ reply });

  } catch (error) {
    console.error('Chat API Error:', error);
    res.status(500).json({ error: 'Failed to process request', details: error.message });
  }
});

export default router;
