import mongoose from "mongoose";

const userSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: true,
      trim: true,
    },

    email: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      trim: true,
    },

    // 🎓 Role-based access (determines dashboard view)
    role: {
      type: String,
      enum: ["student", "teacher"],
      default: "student",
    },

    // 📚 Subject assignment (for teachers only)
    subject: {
      type: String,
      enum: ["chemistry", "physics", "cpp", "mathematics", null],
      default: null,
    },

    profilePicture: {
      type: String,
      default: "",
    },

    phoneNumber: {
      type: String,
      default: "",
    },

    // 🎓 Faculty profile fields
    qualification: {
      type: String,
      default: "",
    },

    department: {
      type: String,
      default: "",
    },

    bio: {
      type: String,
      default: "",
      maxlength: 300,
    },

    // 🔐 hashed password (for manual auth)
    password: {
      type: String, // hashed
      default: null,
      select: false, // Don't return by default
    },

    // ⏳ password expiry (optional policy)
    passwordExpiresAt: {
      type: Date,
      default: null,
    },

    // Password Reset
    resetPasswordToken: { type: String, default: null },
    resetPasswordExpires: { type: Date, default: null },

    // List of all auth providers used by this user
    linkedProviders: {
      type: [String],
      default: ["manual"],
    },

    // Current/Most recent auth provider used for this session
    authProvider: {
      type: String,
      enum: ["manual", "google", "facebook", "github", "linkedin"],
      default: "manual",
    },

    // Social IDs
    googleId: { type: String, unique: true, sparse: true },
    facebookId: { type: String, unique: true, sparse: true },
    githubId: { type: String, unique: true, sparse: true },
    linkedinId: { type: String, unique: true, sparse: true },

    isEmailVerified: {
      type: Boolean,
      default: false,
    },

    verificationToken: {
      type: String,
      default: null,
    },

    lastLoginAt: {
      type: Date,
      default: null,
    },
  },
  {
    timestamps: true,
  }
);

export default mongoose.model("User", userSchema);
