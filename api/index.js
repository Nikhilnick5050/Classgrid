import express from "express";
import cors from "cors";
import path from "path";
import { fileURLToPath } from "url";
import passport from "passport";
import cookieParser from "cookie-parser";

import connectDB from "../config/db.js";
import passportConfig from "../src/services/passport.service.js";

import authRoutes from "../src/routes/auth.routes.js";
import userRoutes from "../src/routes/user.routes.js";
import chatRoutes from "../src/routes/chat.routes.js";
import notesRoutes from "../src/routes/notes.routes.js";
import classroomRoutes from "../src/routes/classroom.routes.js";
import activityRoutes from "../src/routes/activity.routes.js";
import messagingRoutes from "../src/routes/messaging.routes.js";
import classroomChatRoutes from "../src/routes/classroom_chat.routes.js";
import notificationRoutes from "../src/routes/notification.routes.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();

/* ---------- DB ---------- */
connectDB();

/* ---------- CONFIG ---------- */
passportConfig(); // Initialize passport strategies

/* ---------- MIDDLEWARE ---------- */
app.use(
  cors({
    origin: [
      "http://localhost:3000",
      "http://127.0.0.1:3000",
      "https://www.quantumchem.site",
      "https://quantumchem.site"
    ],
    credentials: true
  })
);

app.use(express.json({ limit: '2mb' }));
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser(process.env.COOKIE_SECRET)); // Use cookie parser
app.use(passport.initialize());

// Debug Middleware: Log all requests
app.use((req, res, next) => {
  console.log(`➡️  ${req.method} ${req.originalUrl}`);
  next();
});

/* ---------- STATIC FILES ---------- */
app.use(express.static(path.join(__dirname, "../public")));

/* ---------- API ROUTES ---------- */
app.use("/api/auth", authRoutes);
app.use("/api/user", userRoutes);
app.use("/api/chat", chatRoutes);
app.use("/api/notifications", notificationRoutes);
app.use("/api/notes", notesRoutes);
app.use("/api/classrooms", classroomRoutes);
app.use("/api/classroom", classroomRoutes); // Fix: Alias for singular access
app.use("/api/activity", activityRoutes);
app.use("/api/messages", messagingRoutes);
app.use("/api/classroom-chat", classroomChatRoutes);

/* ---------- HEALTH ---------- */
app.get("/api/health", (req, res) => {
  res.json({
    status: "OK",
    env: process.env.NODE_ENV || "development"
  });
});

/* ---------- CLEAN URL HANDLER ---------- */
app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "../public/index.html"));
});

app.get("/:page", (req, res, next) => {
  if (req.path.startsWith("/api")) return next();

  const filePath = path.join(
    __dirname,
    "../public",
    `${req.params.page}.html`
  );

  res.sendFile(filePath, err => {
    if (err) next();
  });
});

/* ---------- FINAL FALLBACK ---------- */
app.get("*", (req, res) => {
  if (req.path.startsWith("/api")) {
    return res.status(404).json({ error: "API not found" });
  }

  res.sendFile(path.join(__dirname, "../public/login.html"));
});

export default app;
