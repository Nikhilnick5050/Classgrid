import mongoose from "mongoose";
import crypto from "crypto";

const classroomSchema = new mongoose.Schema(
    {
        name: {
            type: String,
            required: true,
            trim: true,
            maxlength: 100,
        },

        description: {
            type: String,
            default: "",
            maxlength: 500,
        },

        subject: {
            type: String,
            required: true,
            trim: true,
            lowercase: true,
        },

        // Unique class code for students to join (e.g., "CHEM-A3X9")
        classCode: {
            type: String,
            unique: true,
            uppercase: true,
            index: true,
        },

        // Owner teacher
        teacher: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "User",
            required: true,
            index: true,
        },

        // Cover image / banner
        coverImage: {
            type: String,
            default: "",
        },

        // Settings
        settings: {
            allowJoinRequests: {
                type: Boolean,
                default: true,
            },
            maxStudents: {
                type: Number,
                default: 200,
            },
            isArchived: {
                type: Boolean,
                default: false,
            },
        },

        // Cached counts for fast reads
        memberCount: {
            type: Number,
            default: 0,
        },

        // Supabase subject_slug mapping (for backward compatibility)
        subjectSlug: {
            type: String,
            index: true,
        },
    },
    {
        timestamps: true,
    }
);

// Auto-generate class code before saving
classroomSchema.pre("save", function () {
    if (!this.classCode) {
        // Generate a 6-char alphanumeric code
        const prefix = this.subject.substring(0, 3).toUpperCase();
        const random = crypto.randomBytes(3).toString("hex").toUpperCase().substring(0, 4);
        this.classCode = `${prefix}-${random}`;
    }
});

// Indexes for scalability
classroomSchema.index({ teacher: 1, createdAt: -1 });
// classroomSchema.index({ classCode: 1 }); // Redundant (unique: true)
// classroomSchema.index({ subjectSlug: 1 }); // Redundant (index: true)

export default mongoose.model("Classroom", classroomSchema);
