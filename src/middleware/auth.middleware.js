import jwt from "jsonwebtoken";
import User from "../models/User.js";

const JWT_SECRET = process.env.JWT_SECRET || "dev_secret";

export const isAuthenticated = async (req, res, next) => {
    let token;

    if (req.cookies && req.cookies.jwt) {
        token = req.cookies.jwt;
    } else if (req.headers.authorization && req.headers.authorization.startsWith("Bearer ")) {
        token = req.headers.authorization.split(" ")[1];
    }

    if (!token) {
        return res.status(401).json({ message: "Not authenticated" });
    }

    try {
        console.log("Auth Middleware: Verifying token...");
        const decoded = jwt.verify(token, JWT_SECRET);
        console.log("Auth Middleware: Token verified. finding User ID:", decoded.id);

        // Attach full user object (including role) for downstream use
        // Add maxTimeMS to fail fast if DB is slow
        const user = await User.findById(decoded.id).select("-password -verificationToken").maxTimeMS(5000); // 5s timeout

        if (!user) {
            console.log("Auth Middleware: User not found");
            return res.status(401).json({ message: "User no longer exists" });
        }

        console.log("Auth Middleware: User found:", user.email);
        req.user = user;
        next();
    } catch (err) {
        console.error("Auth Middleware Error:", err.message);
        return res.status(401).json({ message: "Token invalid" });
    }
};

/**
 * Role-based access control middleware.
 * Usage: router.post("/admin-action", isAuthenticated, requireRole("teacher"), handler)
 */
export const requireRole = (...roles) => {
    return (req, res, next) => {
        if (!req.user || !roles.includes(req.user.role)) {
            return res.status(403).json({
                message: `Access denied. Required role: ${roles.join(" or ")}`
            });
        }
        next();
    };
};
