import express from "express";
import { isAuthenticated, requireRole } from "../middleware/auth.middleware.js";
import NoteView from "../models/NoteView.js";
import Quiz from "../models/Quiz.js";
import { verifyAndSummarize, generateQuizFromContent } from "../services/notes-ai.service.js";

const router = express.Router();

// ─────────────────────────────────────────────
// TRACK NOTE VIEW (Student opened a note)
// ─────────────────────────────────────────────
router.post("/view", isAuthenticated, async (req, res) => {
    try {
        const { noteId, noteTitle, uploadedBy } = req.body;

        if (!noteId || !noteTitle) {
            return res.status(400).json({ message: "noteId and noteTitle required" });
        }

        // Upsert: update viewedAt if already viewed, create if not
        await NoteView.findOneAndUpdate(
            { noteId, studentId: req.user._id },
            {
                noteId,
                noteTitle,
                studentId: req.user._id,
                studentName: req.user.name,
                studentEmail: req.user.email,
                uploadedBy: uploadedBy || "Unknown",
                viewedAt: new Date(),
            },
            { upsert: true, new: true }
        );

        res.json({ message: "View tracked" });
    } catch (err) {
        console.error("Track view error:", err);
        res.status(500).json({ message: "Server error" });
    }
});

// ─────────────────────────────────────────────
// GET NOTE VIEWERS (Teacher sees who viewed)
// ─────────────────────────────────────────────
router.get("/views/:noteId", isAuthenticated, requireRole("teacher"), async (req, res) => {
    try {
        const views = await NoteView.find({ noteId: req.params.noteId })
            .sort({ viewedAt: -1 })
            .lean();

        res.json({ views, total: views.length });
    } catch (err) {
        console.error("Get views error:", err);
        res.status(500).json({ message: "Server error" });
    }
});

// ─────────────────────────────────────────────
// GET ALL VIEWS FOR A TEACHER (engagement overview)
// ─────────────────────────────────────────────
router.get("/my-views", isAuthenticated, requireRole("teacher"), async (req, res) => {
    try {
        const views = await NoteView.find({ uploadedBy: req.user.email })
            .sort({ viewedAt: -1 })
            .lean();

        // Group by noteId
        const grouped = {};
        views.forEach((v) => {
            if (!grouped[v.noteId]) {
                grouped[v.noteId] = { noteTitle: v.noteTitle, noteId: v.noteId, viewers: [] };
            }
            grouped[v.noteId].viewers.push({
                name: v.studentName,
                email: v.studentEmail,
                viewedAt: v.viewedAt,
            });
        });

        res.json({
            totalViews: views.length,
            uniqueStudents: [...new Set(views.map((v) => v.studentEmail))].length,
            notes: Object.values(grouped),
        });
    } catch (err) {
        console.error("My views error:", err);
        res.status(500).json({ message: "Server error" });
    }
});

// ─────────────────────────────────────────────
// AI VERIFY & SUMMARIZE NOTE
// ─────────────────────────────────────────────
router.post("/verify", isAuthenticated, requireRole("teacher"), async (req, res) => {
    try {
        const { noteContent, noteTitle } = req.body;

        if (!noteContent || !noteTitle) {
            return res.status(400).json({ message: "noteContent and noteTitle required" });
        }

        const result = await verifyAndSummarize(noteContent, noteTitle);
        res.json(result);
    } catch (err) {
        console.error("AI verify error:", err);
        res.status(500).json({ message: "AI verification failed" });
    }
});

// ─────────────────────────────────────────────
// AI GENERATE QUIZ FROM NOTE
// ─────────────────────────────────────────────
router.post("/generate-quiz", isAuthenticated, requireRole("teacher"), async (req, res) => {
    try {
        const { noteContent, noteTitle, noteId } = req.body;

        if (!noteContent || !noteTitle || !noteId) {
            return res.status(400).json({ message: "noteContent, noteTitle, and noteId required" });
        }

        // Check if quiz already exists for this note
        let quiz = await Quiz.findOne({ noteId });
        if (quiz) {
            return res.json({ quiz, existing: true, message: "Quiz already exists for this note" });
        }

        // Generate via AI
        const questions = await generateQuizFromContent(noteContent, noteTitle);

        // Save to DB
        quiz = await Quiz.create({
            noteId,
            noteTitle,
            createdBy: req.user._id,
            questions,
        });

        res.json({ quiz, existing: false, message: "Quiz generated successfully" });
    } catch (err) {
        console.error("Generate quiz error:", err);
        res.status(500).json({ message: "Quiz generation failed" });
    }
});

// ─────────────────────────────────────────────
// GET QUIZ FOR A NOTE
// ─────────────────────────────────────────────
router.get("/quiz/:noteId", isAuthenticated, async (req, res) => {
    try {
        const quiz = await Quiz.findOne({ noteId: req.params.noteId });
        if (!quiz) {
            return res.status(404).json({ message: "No quiz found for this note" });
        }
        res.json({ quiz });
    } catch (err) {
        console.error("Get quiz error:", err);
        res.status(500).json({ message: "Server error" });
    }
});

// ─────────────────────────────────────────────
// SUBMIT QUIZ (Student submits answers)
// ─────────────────────────────────────────────
router.post("/quiz/:noteId/submit", isAuthenticated, async (req, res) => {
    try {
        const { answers } = req.body;
        const quiz = await Quiz.findOne({ noteId: req.params.noteId });

        if (!quiz) {
            return res.status(404).json({ message: "Quiz not found" });
        }

        if (!answers || !Array.isArray(answers)) {
            return res.status(400).json({ message: "Answers array required" });
        }

        // Grade the quiz
        let score = 0;
        const results = quiz.questions.map((q, i) => {
            const studentAnswer = answers[i] || "";
            const isCorrect = studentAnswer.trim().toLowerCase() === q.correctAnswer.trim().toLowerCase();
            if (isCorrect) score++;
            return {
                question: q.question,
                studentAnswer,
                correctAnswer: q.correctAnswer,
                isCorrect,
                explanation: q.explanation,
            };
        });

        const percentage = Math.round((score / quiz.questions.length) * 100);

        // Save attempt
        quiz.attempts.push({
            studentId: req.user._id,
            studentName: req.user.name,
            score,
            totalQuestions: quiz.questions.length,
            percentage,
            answers,
        });
        await quiz.save();

        res.json({ score, total: quiz.questions.length, percentage, results });
    } catch (err) {
        console.error("Submit quiz error:", err);
        res.status(500).json({ message: "Server error" });
    }
});

// ─────────────────────────────────────────────
// GET QUIZ ANALYTICS (Teacher)
// ─────────────────────────────────────────────
router.get("/quiz-analytics/:noteId", isAuthenticated, requireRole("teacher"), async (req, res) => {
    try {
        const quiz = await Quiz.findOne({ noteId: req.params.noteId });
        if (!quiz) {
            return res.status(404).json({ message: "No quiz found" });
        }

        const attempts = quiz.attempts || [];
        const avgScore = attempts.length > 0
            ? Math.round(attempts.reduce((sum, a) => sum + a.percentage, 0) / attempts.length)
            : 0;

        const topPerformers = [...attempts]
            .sort((a, b) => b.percentage - a.percentage)
            .slice(0, 5);

        res.json({
            totalAttempts: attempts.length,
            averageScore: avgScore,
            passRate: attempts.length > 0
                ? Math.round((attempts.filter((a) => a.percentage >= 50).length / attempts.length) * 100)
                : 0,
            topPerformers,
            attempts,
        });
    } catch (err) {
        console.error("Quiz analytics error:", err);
        res.status(500).json({ message: "Server error" });
    }
});

export default router;
