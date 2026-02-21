import express from "express";
import passport from "passport";
import * as authController from "../controllers/auth.controller.js";
import { isAuthenticated } from "../middleware/auth.middleware.js";

const router = express.Router();

// Manual Auth
router.post("/signup-init", authController.initiateSignup);
router.get("/verify-token/:token", authController.verifySignupToken);
router.post("/signup-complete", authController.completeSignup);

router.post("/login", authController.login);
router.post("/logout", authController.logout);
router.get("/me", isAuthenticated, authController.getCurrentUser);

router.post("/forgot-password", authController.forgotPassword);
router.post("/reset-password", authController.resetPassword);

// Google OAuth
router.get(
    "/google",
    passport.authenticate("google", { scope: ["profile", "email"] })
);
router.get(
    "/google/callback",
    (req, res, next) => {
        passport.authenticate("google", { session: false }, (err, user) => {
            if (err) {
                console.error("Google OAuth Error:", err.message);
                return res.redirect(`/login?error=google_blocked&message=${encodeURIComponent(err.message)}`);
            }
            if (!user) {
                return res.redirect("/login?error=AuthFailed");
            }
            req.user = user;
            next();
        })(req, res, next);
    },
    authController.oauthCallback
);

// Facebook OAuth
router.get(
    "/facebook",
    passport.authenticate("facebook")
);
router.get(
    "/facebook/callback",
    (req, res, next) => {
        passport.authenticate("facebook", { session: false }, (err, user) => {
            if (err) {
                console.error("Facebook OAuth Error:", err.message);
                return res.redirect(`/login?error=facebook_blocked&message=${encodeURIComponent(err.message)}`);
            }
            if (!user) {
                return res.redirect("/login?error=AuthFailed");
            }
            req.user = user;
            next();
        })(req, res, next);
    },
    authController.oauthCallback
);

// GitHub OAuth
router.get(
    "/github",
    passport.authenticate("github", { scope: ["user:email"] })
);
router.get(
    "/github/callback",
    (req, res, next) => {
        passport.authenticate("github", { session: false }, (err, user) => {
            if (err) {
                console.error("GitHub OAuth Error:", err.message);
                return res.redirect(`/login?error=github_blocked&message=${encodeURIComponent(err.message)}`);
            }
            if (!user) {
                return res.redirect("/login?error=AuthFailed");
            }
            req.user = user;
            next();
        })(req, res, next);
    },
    authController.oauthCallback
);

// LinkedIn OAuth
router.get(
    "/linkedin",
    passport.authenticate("linkedin", {
        session: false
    })
);

router.get(
    "/linkedin/callback",
    (req, res, next) => {
        passport.authenticate("linkedin", {
            session: false
        }, (err, user) => {
            if (err) {
                console.error("LinkedIn OAuth Error:", err.message);
                return res.redirect(`/login?error=linkedin_blocked&message=${encodeURIComponent(err.message)}`);
            }
            if (!user) {
                return res.redirect("/login?error=AuthFailed");
            }
            req.user = user;
            next();
        })(req, res, next);
    },
    authController.oauthCallback
);

export default router;
