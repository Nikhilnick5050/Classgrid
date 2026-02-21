import jwt from "jsonwebtoken";
import User from "../models/User.js";
import Verification from "../models/Verification.js";
import { sendEmail } from "../services/brevo.service.js";
import {
    getWelcomeEmailHtml,
    getWelcomePlainText,
    getLoginNotificationHtml,
    getLoginNotificationPlainText,
} from "../services/email-templates.service.js";

const JWT_SECRET = process.env.JWT_SECRET || "dev_secret";

// Function to get the correct frontend URL based on environment
const getFrontendUrl = () => {
    if (process.env.VERCEL) {
        return process.env.FRONTEND_URL_PROD || "https://www.classgrid.in";
    }
    return process.env.FRONTEND_URL || "http://localhost:3000";
};

// ─────────────────────────────────────────────
// Email helpers using centralized templates
// ─────────────────────────────────────────────

const sendFirstGoogleLoginEmail = async (user) => {
    try {
        await sendEmail({
            to: user.email,
            subject: "🎉 Welcome to Classgrid - Account Created Successfully",
            html: getWelcomeEmailHtml(user, "google"),
            text: getWelcomePlainText(user, "google"),
        });
        console.log("📧 Google welcome email sent to:", user.email);
    } catch (err) {
        console.error("Google Welcome Email Error:", err.message);
    }
};

const sendGoogleLoginNotification = async (user) => {
    try {
        await sendEmail({
            to: user.email,
            subject: "🔐 Classgrid - Account Login Notification",
            html: getLoginNotificationHtml(user, "google"),
            text: getLoginNotificationPlainText(user, "google"),
        });
        console.log("📧 Google login notification sent to:", user.email);
    } catch (err) {
        console.error("Google Login Notification Error:", err.message);
    }
};

// ─────────────────────────────────────────────
// Provider Isolation Check
// ─────────────────────────────────────────────

const checkGoogleOAuthBlock = async (email) => {
    console.log(`🔍 Checking Google OAuth permissions for: ${email}`);

    // Block if pending verification exists (manual signup in progress)
    const pendingVerification = await Verification.findOne({ email });
    if (pendingVerification) {
        console.log("🚫 BLOCKED: Email has pending verification");
        throw new Error(
            "Email verification pending. Please complete email verification first."
        );
    }

    console.log("✅ Google OAuth permitted for this email");
    return true;
};

// ─────────────────────────────────────────────
// Google OAuth Callback (custom handler)
// ─────────────────────────────────────────────

export const googleCallback = async (req, res) => {
    const FRONTEND_URL = getFrontendUrl();

    try {
        console.log("=== GOOGLE AUTHENTICATION START ===");

        if (!req.user) {
            console.error("❌ No user data received from Google");
            return res.redirect(`${FRONTEND_URL}/login?error=no_user_data`);
        }

        const { id, displayName, emails, photos } = req.user;
        const email = emails && emails[0] ? emails[0].value : null;
        const name = displayName || "Google User";
        const picture = photos && photos[0] ? photos[0].value : "";

        if (!email) {
            return res.redirect(`${FRONTEND_URL}/login?error=no_email`);
        }

        if (!id) {
            return res.redirect(`${FRONTEND_URL}/login?error=no_google_id`);
        }

        // Check if Google OAuth should be blocked (provider isolation)
        try {
            await checkGoogleOAuthBlock(email);
        } catch (blockError) {
            console.error("🚫 Google OAuth blocked:", blockError.message);
            return res.redirect(
                `${FRONTEND_URL}/login?error=google_blocked&message=${encodeURIComponent(blockError.message)}`
            );
        }

        // Find user by googleId first, then by email (to allow linking)
        let user = await User.findOne({
            $or: [{ googleId: id }, { email: email }],
        });

        if (!user) {
            // ──── NEW USER ────
            console.log("👤 Creating new Google user");
            user = new User({
                name,
                email,
                authProvider: "google",
                linkedProviders: ["google"],
                googleId: id,
                isEmailVerified: true,
                lastLoginAt: new Date(),
            });

            await user.save();
            console.log("✅ Google user created successfully");

            // Send welcome email (non-blocking)
            sendFirstGoogleLoginEmail(user);

        } else {
            // ──── EXISTING USER (OR ACCOUNT LINKING) ────
            console.log("👤 Updating existing user via Google Login");

            const isFirstLogin = !user.lastLoginAt;

            // Set current session provider
            user.authProvider = "google";

            // Link Google if not already linked
            if (!user.linkedProviders.includes("google")) {
                console.log("🔗 Linking Google to existing account");
                user.linkedProviders.push("google");
            }

            user.googleId = id;
            user.isEmailVerified = true;
            user.lastLoginAt = new Date();

            if (picture && !user.profilePicture) {
                user.profilePicture = picture;
            }
            if (!user.name && name) {
                user.name = name;
            }

            await user.save();

            // Send appropriate email (non-blocking)
            if (isFirstLogin) {
                sendFirstGoogleLoginEmail(user);
            } else {
                sendGoogleLoginNotification(user);
            }
        }

        // Generate JWT token
        const tokenPayload = {
            id: user._id.toString(),
            email: user.email,
            name: user.name,
            authProvider: user.authProvider,
        };

        const token = jwt.sign(tokenPayload, JWT_SECRET, { expiresIn: "7d" });
        console.log("✅ JWT token generated");

        const redirectUrl = `${FRONTEND_URL}/classroom?token=${token}&google_auth=true`;
        console.log("=== GOOGLE AUTHENTICATION END ===");

        res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, private");
        res.redirect(redirectUrl);

    } catch (error) {
        console.error("❌ Google authentication error:", error.message);
        const errorUrl = `${FRONTEND_URL}/login?error=google_auth_failed&message=${encodeURIComponent(error.message)}`;
        res.redirect(errorUrl);
    }
};

// Test endpoint for debugging
export const testGoogleAuth = async (req, res) => {
    res.json({
        status: "Google Authentication API operational",
        timestamp: new Date().toISOString(),
        frontendUrl: getFrontendUrl(),
        googleClientId: process.env.GOOGLE_CLIENT_ID ? "CONFIGURED" : "NOT CONFIGURED",
        nodeEnv: process.env.NODE_ENV,
        vercel: process.env.VERCEL ? "YES" : "NO",
    });
};

// Get Google OAuth URL
export const getGoogleAuthUrl = async (req, res) => {
    try {
        const callbackUrl = process.env.VERCEL
            ? process.env.GOOGLE_CALLBACK_URL_PROD
            : process.env.GOOGLE_CALLBACK_URL;

        const clientId = process.env.GOOGLE_CLIENT_ID;

        if (!clientId) {
            return res.status(500).json({ error: "Google Client ID not configured" });
        }

        const authUrl = `https://accounts.google.com/o/oauth2/v2/auth?client_id=${clientId}&redirect_uri=${encodeURIComponent(callbackUrl)}&response_type=code&scope=profile email&access_type=offline&prompt=select_account`;

        res.json({
            authUrl,
            callbackUrl,
            clientId: clientId.substring(0, 10) + "...",
        });
    } catch (error) {
        console.error("Error generating Google auth URL:", error);
        res.status(500).json({ error: "Failed to generate authentication URL" });
    }
};
