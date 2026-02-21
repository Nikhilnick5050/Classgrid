import express from "express";
import User from "../models/User.js";
import jwt from "jsonwebtoken";

const router = express.Router();

// =======================
// JWT AUTH MIDDLEWARE
// =======================
const protect = async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;

    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      return res.status(401).json({ message: "Not authorized" });
    }

    const token = authHeader.split(" ")[1];
    const decoded = jwt.verify(
      token,
      process.env.JWT_SECRET || "dev_secret"
    );

    req.userId = decoded.id;
    next();
  } catch (error) {
    return res.status(401).json({ message: "Invalid token" });
  }
};

// =======================
// GET USER PROFILE
// =======================
router.get("/profile", protect, async (req, res) => {
  try {
    const user = await User.findById(req.userId).select(
      "-password -verificationToken"
    );

    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    res.json({
      user: {
        id: user._id,
        name: user.name,
        email: user.email,
        role: user.role,
        phoneNumber: user.phoneNumber || "",
        profilePicture: user.profilePicture || "",
        qualification: user.qualification || "",
        department: user.department || "",
        bio: user.bio || "",
        authProvider: user.authProvider,
        lastLoginAt: user.lastLoginAt,
        createdAt: user.createdAt,
      },
    });
  } catch (error) {
    console.error("PROFILE ERROR:", error.message);
    res.status(500).json({ message: "Server error" });
  }
});

// =======================
// UPDATE USER PROFILE
// =======================
router.put("/update", protect, async (req, res) => {
  try {
    const { name, phoneNumber, profilePicture, qualification, department, bio } = req.body;

    // Safety check: Don't allow empty name
    if (name !== undefined && (name === null || name.trim() === "")) {
      return res.status(400).json({ message: "Name cannot be empty" });
    }

    // Build update object
    const updateData = {};
    if (name) updateData.name = name.trim();
    if (phoneNumber !== undefined) updateData.phoneNumber = phoneNumber;
    if (profilePicture !== undefined) updateData.profilePicture = profilePicture;
    if (qualification !== undefined) updateData.qualification = qualification;
    if (department !== undefined) updateData.department = department;
    if (bio !== undefined) updateData.bio = (bio || '').substring(0, 300);

    // Use findByIdAndUpdate
    const user = await User.findByIdAndUpdate(
      req.userId,
      { $set: updateData },
      { new: true, runValidators: true } // Return updated doc, validate
    ).select("-password -verificationToken");

    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    res.json({
      message: "Profile updated successfully",
      user: {
        id: user._id,
        name: user.name,
        email: user.email,
        role: user.role,
        phoneNumber: user.phoneNumber || "",
        profilePicture: user.profilePicture || "",
        qualification: user.qualification || "",
        department: user.department || "",
        bio: user.bio || "",
        authProvider: user.authProvider,
        lastLoginAt: user.lastLoginAt,
        createdAt: user.createdAt,
      }
    });

  } catch (error) {
    console.error("UPDATE PROFILE ERROR:", error.message);
    res.status(500).json({ message: "Server error updating profile" });
  }
});

export default router;
