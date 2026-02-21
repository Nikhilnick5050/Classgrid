import User from "../models/User.js";
import Verification from "../models/Verification.js";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { v4 as uuidv4 } from "uuid";
import { sendEmail } from "../services/brevo.service.js";
import {
    getWelcomeEmailHtml,
    getWelcomePlainText,
    getLoginNotificationHtml,
    getLoginNotificationPlainText,
    getVerificationEmailHtml,
    getPasswordResetEmailHtml,
} from "../services/email-templates.service.js";

const JWT_SECRET = process.env.JWT_SECRET || "dev_secret";
const FRONTEND_URL = process.env.FRONTEND_URL || "http://localhost:3000";

// Helper: Token Generator
const generateToken = (id) => {
    return jwt.sign({ id }, JWT_SECRET, { expiresIn: "7d" });
};

// Helper: Set Cookie
const setTokenCookie = (res, token) => {
    const isProd = process.env.NODE_ENV === "production";
    res.cookie("jwt", token, {
        httpOnly: true,
        secure: isProd,
        sameSite: isProd ? "None" : "Lax",
        maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
    });
};

// ─────────────────────────────────────────────
// Helper: Send Welcome Email (First Login)
// ─────────────────────────────────────────────
const sendWelcomeEmail = async (user, provider = "manual") => {
    try {
        await sendEmail({
            to: user.email,
            subject: "🎉 Welcome to QuantumChem - Account Created Successfully",
            html: getWelcomeEmailHtml(user, provider),
            text: getWelcomePlainText(user, provider),
        });
        console.log(`📧 Welcome email sent to ${user.email} (${provider})`);
    } catch (err) {
        console.error("Welcome Email Error (non-critical):", err.message);
    }
};

// ─────────────────────────────────────────────
// Helper: Send Login Notification (Every Login)
// ─────────────────────────────────────────────
const sendLoginNotification = async (user, provider = "manual") => {
    try {
        await sendEmail({
            to: user.email,
            subject: "🔐 QuantumChem - Account Login Notification",
            html: getLoginNotificationHtml(user, provider),
            text: getLoginNotificationPlainText(user, provider),
        });
        console.log(`📧 Login notification sent to ${user.email} (${provider})`);
    } catch (err) {
        console.error("Login Notification Error (non-critical):", err.message);
    }
};

/* ==================== MANUAL AUTH ==================== */

// Initiate Signup (Step 1: Email & Name)
export const initiateSignup = async (req, res) => {
    try {
        const { name, email } = req.body;

        if (!name || !email) {
            return res.status(400).json({ message: "Name and email are required" });
        }

        // Check if a VERIFIED user already exists with this email
        const existingUser = await User.findOne({ email });
        if (existingUser && existingUser.isEmailVerified) {
            return res.status(400).json({ message: "Email already registered. Please login." });
        }

        // If an unverified user exists (from incomplete signup), delete them so we can redo
        if (existingUser && !existingUser.isEmailVerified) {
            await User.deleteOne({ _id: existingUser._id });
        }

        // Check if a verification is already pending
        let verification = await Verification.findOne({ email });
        const token = uuidv4();

        if (verification) {
            // Rate limit: max 2 sends per hour
            const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);
            const recentSendCount = (verification.lastResentAt && verification.lastResentAt > oneHourAgo)
                ? verification.resendCount
                : 0;

            if (recentSendCount >= 2) {
                return res.status(429).json({
                    message: "Verification email already sent. Please wait before requesting again (max 2 per hour)."
                });
            }

            // Update existing verification
            verification.verificationToken = token;
            verification.name = name;
            verification.expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);
            verification.resendCount = recentSendCount + 1;
            verification.lastResentAt = new Date();
            await verification.save();
        } else {
            // Create new verification
            verification = await Verification.create({
                name,
                email,
                verificationToken: token,
                expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
                resendCount: 1,
                lastResentAt: new Date(),
            });
        }

        // Send Verification Email (with logo)
        const apiVerifyLink = `${FRONTEND_URL}/api/auth/verify-token/${token}`;

        await sendEmail({
            to: email,
            subject: "📧 Verify Email - QuantumChem",
            html: getVerificationEmailHtml(name, apiVerifyLink),
            text: `Verify your email: ${apiVerifyLink} (Link expires in 24 hours)`,
        });

        res.json({ message: "Verification email sent. Please check your inbox." });

    } catch (err) {
        console.error("Initiate Signup Error:", err);
        res.status(500).json({ message: "Server error" });
    }
};

// Login (Manual)
export const login = async (req, res) => {
    try {
        let { email, password } = req.body;
        if (email) email = email.toLowerCase().trim();

        // Explicitly select password
        const user = await User.findOne({ email }).select("+password");
        if (!user) return res.status(401).json({ message: "Invalid credentials" });

        // Check password existence (if they only have social login, they won't have a password yet)
        if (!user.password) {
            const primaryProv = user.linkedProviders[0] || user.authProvider;
            return res.status(400).json({
                message: `This account does not have a password set. Please login using ${primaryProv} or use 'Forgot Password' to set a password.`
            });
        }

        // Check password
        const isMatch = await bcrypt.compare(password, user.password);
        if (!isMatch) return res.status(401).json({ message: "Invalid credentials" });

        // Check verified
        if (!user.isEmailVerified) {
            return res.status(403).json({ message: "Please verify your email first." });
        }

        // Check if First Login
        const isFirstLogin = !user.lastLoginAt;

        // Token
        const token = generateToken(user._id);
        setTokenCookie(res, token);

        // Update login time and session provider
        user.lastLoginAt = new Date();
        user.authProvider = "manual";

        // Ensure linkedProviders exists
        if (!user.linkedProviders) {
            user.linkedProviders = [];
        }

        // Ensure manual is in linkedProviders
        if (!user.linkedProviders.includes("manual")) {
            user.linkedProviders.push("manual");
        }

        await user.save();

        // Send emails (Blocking to ensure delivery in serverless environment)
        if (isFirstLogin) {
            await sendWelcomeEmail(user, "manual");
        } else {
            await sendLoginNotification(user, "manual");
        }

        res.json({
            message: "Login successful",
            token,
            firstLogin: isFirstLogin,
            user: {
                id: user._id,
                name: user.name,
                email: user.email,
                role: user.role,
                authProvider: user.authProvider,
            },
        });
    } catch (err) {
        console.error("Login Error:", err);
        res.status(500).json({ message: "Server error during login" });
    }
};

// Verify Signup Token (Step 2: Link Clicked)
export const verifySignupToken = async (req, res) => {
    try {
        const { token } = req.params;
        const verification = await Verification.findOne({ verificationToken: token });

        if (!verification) {
            return res.redirect(`${FRONTEND_URL}/login?error=InvalidToken`);
        }

        if (verification.expiresAt < new Date()) {
            return res.redirect(`${FRONTEND_URL}/login?error=TokenExpired`);
        }

        // Redirect to Frontend Signup Completion Page
        res.redirect(`${FRONTEND_URL}/signup-complete?token=${token}&email=${encodeURIComponent(verification.email)}&name=${encodeURIComponent(verification.name)}`);

    } catch (err) {
        console.error("Verify Token Error:", err);
        res.redirect(`${FRONTEND_URL}/login?error=ServerError`);
    }
};

// Complete Signup (Step 3: Set Password)
export const completeSignup = async (req, res) => {
    try {
        const { token, password, role } = req.body;

        if (!token || !password) {
            return res.status(400).json({ message: "Token and password are required" });
        }

        if (password.length < 6) {
            return res.status(400).json({ message: "Password must be at least 6 characters" });
        }

        // Validate role if provided
        const validRoles = ["student", "teacher"];
        const userRole = validRoles.includes(role) ? role : "student";

        const verification = await Verification.findOne({ verificationToken: token });
        if (!verification) {
            return res.status(400).json({ message: "Invalid or expired token" });
        }

        // Hash Password
        const hashedPassword = await bcrypt.hash(password, 10);

        // Create User
        const user = await User.create({
            name: verification.name,
            email: verification.email,
            password: hashedPassword,
            role: userRole,
            authProvider: "manual",
            linkedProviders: ["manual"],
            isEmailVerified: true,
            lastLoginAt: new Date()
        });

        // Delete verification doc
        await Verification.deleteOne({ _id: verification._id });

        // Send Welcome Email (with logo template)
        await sendWelcomeEmail(user, "manual");

        // Auto Login
        const jwtToken = generateToken(user._id);
        setTokenCookie(res, jwtToken);

        res.json({
            message: "Account created successfully",
            token: jwtToken,
            firstLogin: true,
            user: {
                id: user._id,
                name: user.name,
                email: user.email,
                role: user.role,
                authProvider: "manual"
            }
        });

    } catch (err) {
        console.error("Complete Signup Error:", err);
        res.status(500).json({ message: "Server error" });
    }
};

/* ==================== OAUTH CALLBACKS ==================== */

// Common OAuth callback handler (used by Google, GitHub, Facebook)
export const oauthCallback = async (req, res) => {
    // Passport populates req.user
    if (!req.user) {
        return res.redirect(`${FRONTEND_URL}/login?error=AuthFailed`);
    }

    // Determine provider
    const provider = req.user.authProvider || "social";

    // Check First Login
    const isFirstLogin = !req.user.lastLoginAt;

    // Update last login
    req.user.lastLoginAt = new Date();
    await req.user.save();

    const token = generateToken(req.user._id);
    setTokenCookie(res, token);

    // Send appropriate email (Blocking to ensure delivery in serverless environment)
    if (isFirstLogin) {
        await sendWelcomeEmail(req.user, provider);
    } else {
        await sendLoginNotification(req.user, provider);
    }

    const target = '/classroom';
    if (isFirstLogin) {
        res.redirect(`${FRONTEND_URL}${target}?welcome=true&token=${token}`);
    } else {
        res.redirect(`${FRONTEND_URL}${target}?token=${token}`);
    }
};

// Forgot Password
export const forgotPassword = async (req, res) => {
    try {
        const { email } = req.body;
        const user = await User.findOne({ email });

        if (!user || !user.isEmailVerified) {
            // Security: Don't reveal if user exists or is unverified
            return res.json({ message: "If that email exists and is verified, a reset link has been sent." });
        }

        const resetToken = uuidv4();
        user.resetPasswordToken = resetToken;
        user.resetPasswordExpires = Date.now() + 3600000; // 1 hour
        await user.save();

        const resetLink = `${FRONTEND_URL}/reset-password?token=${resetToken}`;

        await sendEmail({
            to: email,
            subject: "🔑 Reset Your Password - QuantumChem",
            html: getPasswordResetEmailHtml(resetLink),
            text: `Reset your password: ${resetLink} (Expires in 1 hour)`
        });

        res.json({ message: "If that email exists, a reset link has been sent." });

    } catch (err) {
        console.error("Forgot Password Error:", err);
        res.status(500).json({ message: "Server error" });
    }
};

// Reset Password
export const resetPassword = async (req, res) => {
    try {
        const { token, password } = req.body;

        if (!password || password.length < 6) {
            return res.status(400).json({ message: "Password must be at least 6 characters" });
        }

        const user = await User.findOne({
            resetPasswordToken: token,
            resetPasswordExpires: { $gt: Date.now() }
        });

        if (!user) {
            return res.status(400).json({ message: "Invalid or expired token" });
        }

        user.password = await bcrypt.hash(password, 10);
        user.resetPasswordToken = null;
        user.resetPasswordExpires = null;
        await user.save();

        res.json({ message: "Password reset successful. Please login." });

    } catch (err) {
        console.error("Reset Password Error:", err);
        res.status(500).json({ message: "Server error" });
    }
};

// Logout
export const logout = (req, res) => {
    res.cookie("jwt", "", { maxAge: 0 });
    res.status(200).json({ message: "Logged out successfully" });
};

// Get Me
export const getCurrentUser = async (req, res) => {
    try {
        // req.user is already populated by isAuthenticated middleware
        if (!req.user) {
            return res.status(401).json({ message: "Not authenticated" });
        }

        res.json({
            id: req.user._id,
            name: req.user.name,
            email: req.user.email,
            role: req.user.role,
            subject: req.user.subject || null,
            profilePicture: req.user.profilePicture || "",
            phoneNumber: req.user.phoneNumber || "",
            authProvider: req.user.authProvider,
            linkedProviders: req.user.linkedProviders,
            lastLoginAt: req.user.lastLoginAt,
            createdAt: req.user.createdAt,
        });
    } catch (err) {
        console.error("GetMe Error:", err);
        res.status(500).json({ message: "Server error" });
    }
};
