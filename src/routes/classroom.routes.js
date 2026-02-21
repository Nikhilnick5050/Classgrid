import express from "express";
import { isAuthenticated, requireRole } from "../middleware/auth.middleware.js";
import { requireClassroomMember, requireClassroomOwner } from "../middleware/classroom.middleware.js";
import Classroom from "../models/Classroom.js";
import ClassroomMembership from "../models/ClassroomMembership.js";
import Notification from "../models/Notification.js";
import ActivityLog from "../models/ActivityLog.js";

const router = express.Router();
import multer from "multer";

const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 40 * 1024 * 1024 } // 40MB per file
});

// ─────────────────────────────────────────────
// CREATE CLASSROOM (Teacher only)
// ─────────────────────────────────────────────
router.post("/", isAuthenticated, requireRole("teacher"), async (req, res) => {
    try {
        const { name, description, subject, subjectSlug, settings } = req.body;

        if (!name || !subject) {
            return res.status(400).json({ message: "Name and subject are required" });
        }

        const classroomData = {
            name,
            description: description || "",
            subject,
            subjectSlug: subjectSlug || subject.toLowerCase().replace(/\s+/g, "-"),
            teacher: req.user._id,
        };

        // Merge settings if provided
        if (settings) {
            classroomData.settings = {
                allowJoinRequests: settings.allowJoinRequests !== undefined ? settings.allowJoinRequests : true,
                maxStudents: settings.maxStudents || 200,
                isArchived: false,
            };
        }

        const classroom = await Classroom.create(classroomData);

        res.status(201).json({
            message: "Classroom created successfully",
            classroom,
        });
    } catch (err) {
        console.error("Create classroom error:", err);
        if (err.code === 11000) {
            return res.status(400).json({ message: "A classroom with that code already exists. Please try again." });
        }
        res.status(500).json({ message: "Server error creating classroom" });
    }
});

// ─────────────────────────────────────────────
// LIST CLASSROOMS (role-aware)
// ─────────────────────────────────────────────
router.get("/", isAuthenticated, async (req, res) => {
    try {
        if (req.user.role === "teacher") {
            // Teachers see their own classrooms
            const classrooms = await Classroom.find({ teacher: req.user._id })
                .populate("teacher", "name email profilePicture qualification department bio")
                .sort({ createdAt: -1 })
                .lean();

            // Attach pending request counts
            const classroomIds = classrooms.map(c => c._id);
            const pendingCounts = await ClassroomMembership.aggregate([
                { $match: { classroom: { $in: classroomIds }, status: "pending" } },
                { $group: { _id: "$classroom", count: { $sum: 1 } } },
            ]);

            const pendingMap = {};
            pendingCounts.forEach(p => { pendingMap[p._id.toString()] = p.count; });

            const enriched = classrooms.map(c => ({
                ...c,
                pendingRequests: pendingMap[c._id.toString()] || 0,
            }));

            return res.json({ classrooms: enriched });
        }

        // Students: show approved + pending classrooms
        const memberships = await ClassroomMembership.find({
            student: req.user._id,
            status: { $in: ["approved", "pending"] },
        })
            .populate({
                path: "classroom",
                populate: { path: "teacher", select: "name email profilePicture qualification department bio" },
            })
            .lean();

        const myClassrooms = memberships.map(m => ({
            ...m.classroom,
            membershipStatus: m.status,
            membershipId: m._id,
        }));

        return res.json({ classrooms: myClassrooms });
    } catch (err) {
        console.error("List classrooms error:", err);
        res.status(500).json({ message: "Server error" });
    }
});

// ─────────────────────────────────────────────
// DISCOVER / BROWSE CLASSROOMS (Students)
// ─────────────────────────────────────────────
router.get("/discover", isAuthenticated, async (req, res) => {
    try {
        const { search, subject } = req.query;

        const filter = {
            "settings.isArchived": false,
            "settings.allowJoinRequests": true,
        };

        if (subject) filter.subject = subject.toLowerCase();
        if (search) filter.name = { $regex: search, $options: "i" };

        const classrooms = await Classroom.find(filter)
            .populate("teacher", "name email profilePicture")
            .sort({ createdAt: -1 })
            .limit(50)
            .lean();

        // Check existing memberships for this student
        const classroomIds = classrooms.map(c => c._id);
        const existingMemberships = await ClassroomMembership.find({
            student: req.user._id,
            classroom: { $in: classroomIds },
        }).lean();

        const membershipMap = {};
        existingMemberships.forEach(m => {
            membershipMap[m.classroom.toString()] = m.status;
        });

        const enriched = classrooms.map(c => ({
            ...c,
            membershipStatus: membershipMap[c._id.toString()] || null,
        }));

        res.json({ classrooms: enriched });
    } catch (err) {
        console.error("Discover classrooms error:", err);
        res.status(500).json({ message: "Server error" });
    }
});

// ─────────────────────────────────────────────
// JOIN BY CLASS CODE (Student) - AUTO APPROVE
// ─────────────────────────────────────────────
router.post("/join-by-code", isAuthenticated, async (req, res) => {
    try {
        const { classCode, requestMessage } = req.body;

        if (!classCode) {
            return res.status(400).json({ message: "Class code is required" });
        }

        const classroom = await Classroom.findOne({
            classCode: classCode.toUpperCase().trim(),
        });

        if (!classroom) {
            return res.status(404).json({ message: "Invalid class code. No classroom found." });
        }

        // Allow joining even if requests are disabled, as code implies invite? 
        // Or strictly follow settings? User said "direct join". Usually code overrides "request" setting.
        // But let's respect "isArchived" if any. 
        if (classroom.settings.isArchived) {
            return res.status(403).json({ message: "This classroom is archived" });
        }

        // Check if teacher is trying to join their own classroom
        if (classroom.teacher.toString() === req.user._id.toString()) {
            return res.status(400).json({ message: "You are the owner of this classroom" });
        }

        // Check existing membership
        let membership = await ClassroomMembership.findOne({
            classroom: classroom._id,
            student: req.user._id,
        });

        if (membership) {
            if (membership.status === "approved") {
                return res.status(400).json({ message: "You are already a member of this classroom" });
            }
            // If pending or rejected, upgrade to approved since they have the code
            membership.status = "approved";
            membership.joinedAt = new Date();
            membership.respondedAt = new Date();
            membership.respondedBy = classroom.teacher; // System/Teacher
            membership.rejectionReason = "";
            await membership.save();

            // Increment count
            await Classroom.findByIdAndUpdate(classroom._id, { $inc: { memberCount: 1 } });

            return res.json({
                message: "Joined classroom successfully!",
                membership,
                classroomName: classroom.name
            });
        }

        // Check max students
        const currentCount = await ClassroomMembership.countDocuments({
            classroom: classroom._id,
            status: "approved",
        });

        if (currentCount >= classroom.settings.maxStudents) {
            return res.status(400).json({ message: "Classroom is full" });
        }

        // Create APPROVED membership
        membership = await ClassroomMembership.create({
            classroom: classroom._id,
            student: req.user._id,
            status: "approved", // Direct join
            joinedAt: new Date(),
            requestMessage: requestMessage || "Joined via Class Code",
        });

        // Increment count
        await Classroom.findByIdAndUpdate(classroom._id, { $inc: { memberCount: 1 } });

        // Notify Teacher
        await Notification.create({
            recipient: classroom.teacher,
            type: "system",
            title: "New Student Joined",
            message: `${req.user.name} joined "${classroom.name}" via class code.`,
            link: `/manage-classroom.html?id=${classroom._id}&tab=members`,
            createdAt: new Date()
        });

        res.status(201).json({
            message: "Joined classroom successfully!",
            membership,
            classroomName: classroom.name,
        });
    } catch (err) {
        console.error("Join by code error:", err);
        if (err.code === 11000) {
            return res.status(400).json({ message: "You are already in this classroom" });
        }
        res.status(500).json({ message: "Server error" });
    }
});

// ─────────────────────────────────────────────
// REQUEST TO JOIN (Student, by classroom ID)
// ─────────────────────────────────────────────
router.post("/:id/join", isAuthenticated, async (req, res) => {
    try {
        const classroom = await Classroom.findById(req.params.id);

        if (!classroom) {
            return res.status(404).json({ message: "Classroom not found" });
        }

        if (!classroom.settings.allowJoinRequests) {
            return res.status(403).json({ message: "This classroom is not accepting join requests" });
        }

        if (classroom.teacher.toString() === req.user._id.toString()) {
            return res.status(400).json({ message: "You own this classroom" });
        }

        // Check existing
        const existing = await ClassroomMembership.findOne({
            classroom: classroom._id,
            student: req.user._id,
        });

        if (existing) {
            if (existing.status === "approved") {
                return res.status(400).json({ message: "Already a member" });
            }
            if (existing.status === "pending") {
                return res.status(400).json({ message: "Request already pending" });
            }
            // rejected — allow re-request
            existing.status = "pending";
            existing.requestedAt = new Date();
            existing.requestMessage = req.body.requestMessage || "";
            existing.respondedAt = null;
            existing.respondedBy = null;
            existing.rejectionReason = "";
            await existing.save();

            // Notify Teacher of re-request
            await Notification.create({
                recipient: classroom.teacher,
                type: "system",
                title: "Join Re-request",
                message: `${req.user.name} has re-requested to join "${classroom.name}".`,
                link: "/manage-classroom.html#requests",
                relatedId: existing._id,
                createdAt: new Date()
            });

            return res.json({ message: "Join request re-submitted", membership: existing });
        }

        const membership = await ClassroomMembership.create({
            classroom: classroom._id,
            student: req.user._id,
            requestMessage: req.body.requestMessage || "",
        });

        // Notify Teacher
        await Notification.create({
            recipient: classroom.teacher,
            type: "system",
            title: "New Join Request",
            message: `${req.user.name} has requested to join "${classroom.name}".`,
            link: "/manage-classroom.html#requests",
            relatedId: membership._id,
            createdAt: new Date()
        });

        // Notify Student
        await Notification.create({
            recipient: req.user._id,
            type: "system",
            title: "Request Sent",
            message: `Your request to join "${classroom.name}" has been sent successfully.`,
            relatedId: classroom._id,
            createdAt: new Date()
        });

        res.status(201).json({
            message: "Join request sent!",
            membership,
        });
    } catch (err) {
        console.error("Join request error:", err);
        if (err.code === 11000) {
            return res.status(400).json({ message: "Request already exists" });
        }
        res.status(500).json({ message: "Server error" });
    }
});

// ─────────────────────────────────────────────
// GET JOIN REQUESTS (Teacher)
// ─────────────────────────────────────────────
router.get("/:id/requests", isAuthenticated, requireClassroomOwner, async (req, res) => {
    try {
        const { status } = req.query;
        const filter = { classroom: req.params.id };
        if (status) filter.status = status;

        const requests = await ClassroomMembership.find(filter)
            .populate("student", "name email profilePicture role")
            .sort({ requestedAt: -1 })
            .lean();

        res.json({ requests });
    } catch (err) {
        console.error("Get requests error:", err);
        res.status(500).json({ message: "Server error" });
    }
});

// ─────────────────────────────────────────────
// APPROVE / REJECT REQUEST (Teacher)
// ─────────────────────────────────────────────
router.put("/:id/requests/:requestId", isAuthenticated, requireClassroomOwner, async (req, res) => {
    try {
        const { action, rejectionReason } = req.body;

        if (!["approve", "reject"].includes(action)) {
            return res.status(400).json({ message: "Action must be 'approve' or 'reject'" });
        }

        const membership = await ClassroomMembership.findOne({
            _id: req.params.requestId,
            classroom: req.params.id,
        });

        if (!membership) {
            return res.status(404).json({ message: "Request not found" });
        }

        if (membership.status !== "pending") {
            return res.status(400).json({ message: `Request is already ${membership.status}` });
        }

        membership.status = action === "approve" ? "approved" : "rejected";
        membership.respondedAt = new Date();
        membership.respondedBy = req.user._id;
        if (action === "reject" && rejectionReason) {
            membership.rejectionReason = rejectionReason;
        }

        await membership.save();

        // Update member count on classroom
        if (action === "approve") {
            await Classroom.findByIdAndUpdate(req.params.id, { $inc: { memberCount: 1 } });

            // Create Notification
            await Notification.create({
                recipient: membership.student,
                type: "request_approved",
                title: "Join Request Approved",
                message: `Your request to join "${req.classroom.name}" has been accepted by ${req.user.name}.`,
                link: `/view-classroom.html?id=${req.params.id}`,
                relatedId: req.params.id
            });
        }

        res.json({
            message: `Request ${action}d successfully`,
            membership,
        });
    } catch (err) {
        console.error("Approve/reject error:", err);
        res.status(500).json({ message: "Server error" });
    }
});

// ─────────────────────────────────────────────
// BULK APPROVE/REJECT REQUESTS (Teacher)
// ─────────────────────────────────────────────
router.put("/:id/requests-bulk", isAuthenticated, requireClassroomOwner, async (req, res) => {
    try {
        const { requestIds, action } = req.body;

        if (!requestIds || !Array.isArray(requestIds) || requestIds.length === 0) {
            return res.status(400).json({ message: "requestIds array required" });
        }

        if (!["approve", "reject"].includes(action)) {
            return res.status(400).json({ message: "Action must be 'approve' or 'reject'" });
        }

        const newStatus = action === "approve" ? "approved" : "rejected";

        // If approving, fetch pending memberships first to notify students
        let pendingMemberships = [];
        if (action === "approve") {
            pendingMemberships = await ClassroomMembership.find({
                _id: { $in: requestIds },
                classroom: req.params.id,
                status: "pending",
            });
        }

        const result = await ClassroomMembership.updateMany(
            {
                _id: { $in: requestIds },
                classroom: req.params.id,
                status: "pending",
            },
            {
                $set: {
                    status: newStatus,
                    respondedAt: new Date(),
                    respondedBy: req.user._id,
                },
            }
        );

        // Update member count & Notify
        if (action === "approve") {
            await Classroom.findByIdAndUpdate(req.params.id, {
                $inc: { memberCount: result.modifiedCount },
            });

            // Send Notifications
            if (pendingMemberships.length > 0) {
                const notifications = pendingMemberships.map(m => ({
                    recipient: m.student,
                    type: "request_approved",
                    title: "Join Request Approved",
                    message: `Your request to join "${req.classroom.name}" has been accepted by ${req.user.name}.`,
                    link: `/view-classroom.html?id=${req.params.id}`,
                    relatedId: req.params.id,
                    createdAt: new Date()
                }));
                await Notification.insertMany(notifications);
            }
        }


        res.json({
            message: `${result.modifiedCount} requests ${action}d`,
            modifiedCount: result.modifiedCount,
        });
    } catch (err) {
        console.error("Bulk action error:", err);
        res.status(500).json({ message: "Server error" });
    }
});

// ─────────────────────────────────────────────
// GET CLASSROOM DETAILS (Members only)
// ─────────────────────────────────────────────
router.get("/:id", isAuthenticated, requireClassroomMember, async (req, res) => {
    try {
        const classroom = await Classroom.findById(req.params.id)
            .populate("teacher", "name email profilePicture subject qualification department bio")
            .lean();

        if (!classroom) {
            return res.status(404).json({ message: "Classroom not found" });
        }

        res.json({ classroom, isOwner: req.isClassroomOwner });
    } catch (err) {
        console.error("Get classroom error:", err);
        res.status(500).json({ message: "Server error" });
    }
});

// ─────────────────────────────────────────────
// UPDATE CLASSROOM (Owner only)
// ─────────────────────────────────────────────
router.put("/:id", isAuthenticated, requireClassroomOwner, async (req, res) => {
    try {
        const allowedUpdates = ["name", "description", "coverImage", "settings"];
        const updates = {};

        allowedUpdates.forEach(field => {
            if (req.body[field] !== undefined) {
                updates[field] = req.body[field];
            }
        });

        const classroom = await Classroom.findByIdAndUpdate(
            req.params.id,
            { $set: updates },
            { new: true, runValidators: true }
        );

        res.json({ message: "Classroom updated", classroom });
    } catch (err) {
        console.error("Update classroom error:", err);
        res.status(500).json({ message: "Server error" });
    }
});

// ─────────────────────────────────────────────
// DELETE CLASSROOM (Owner only)
// ─────────────────────────────────────────────
router.delete("/:id", isAuthenticated, requireClassroomOwner, async (req, res) => {
    try {
        // Delete all related data
        await Promise.all([
            ClassroomMembership.deleteMany({ classroom: req.params.id }),
            ActivityLog.deleteMany({ classroom: req.params.id }),
            Classroom.findByIdAndDelete(req.params.id),
        ]);

        res.json({ message: "Classroom deleted successfully" });
    } catch (err) {
        console.error("Delete classroom error:", err);
        res.status(500).json({ message: "Server error" });
    }
});

// ─────────────────────────────────────────────
// GET MEMBERS (Owner only)
// ─────────────────────────────────────────────
router.get("/:id/members", isAuthenticated, requireClassroomOwner, async (req, res) => {
    try {
        const members = await ClassroomMembership.find({
            classroom: req.params.id,
            status: "approved",
        })
            .populate("student", "name email profilePicture role lastLoginAt")
            .sort({ requestedAt: 1 })
            .lean();

        res.json({ members, total: members.length });
    } catch (err) {
        console.error("Get members error:", err);
        res.status(500).json({ message: "Server error" });
    }
});

// ─────────────────────────────────────────────
// REMOVE MEMBER (Owner only)
// ─────────────────────────────────────────────
router.delete("/:id/members/:userId", isAuthenticated, requireClassroomOwner, async (req, res) => {
    try {
        const result = await ClassroomMembership.findOneAndDelete({
            classroom: req.params.id,
            student: req.params.userId,
        });

        if (!result) {
            return res.status(404).json({ message: "Member not found" });
        }

        if (result.status === "approved") {
            await Classroom.findByIdAndUpdate(req.params.id, { $inc: { memberCount: -1 } });
        }

        res.json({ message: "Member removed" });
    } catch (err) {
        console.error("Remove member error:", err);
        res.status(500).json({ message: "Server error" });
    }
});


// ─────────────────────────────────────────────
// GENERATE SIGNED UPLOAD URLS (Avoids 413 & RLS)
// ─────────────────────────────────────────────
router.post("/:id/upload-urls", isAuthenticated, requireClassroomOwner, async (req, res) => {
    try {
        const { files } = req.body;
        if (!files || !Array.isArray(files)) return res.status(400).json({ message: "Files array required" });

        const { createClient } = await import("@supabase/supabase-js");
        const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_KEY;
        const supabase = createClient(process.env.SUPABASE_URL, supabaseKey);

        const urls = [];
        for (const file of files) {
            const path = `${req.params.id}/${Date.now()}_${Math.floor(Math.random() * 1000)}_${file.name.replace(/[^a-zA-Z0-9.-]/g, '_')}`;
            const { data, error } = await supabase.storage
                .from('notes-files')
                .createSignedUploadUrl(path);

            if (error) throw error;
            urls.push({
                originalname: file.name,
                path: path,
                token: data.token
            });
        }
        res.json({ urls });
    } catch (err) {
        console.error("Upload URL error:", err);
        res.status(500).json({ message: "Server error generating URLs" });
    }
});
// ─────────────────────────────────────────────
// CREATE CONTENT (Teacher / Owner only)
// ─────────────────────────────────────────────
router.post("/:id/content/:type", isAuthenticated, requireClassroomOwner, upload.array('files', 10), async (req, res) => {
    try {
        const { type } = req.params;
        if (!["materials", "announcements", "quizzes"].includes(type)) {
            return res.status(400).json({ message: "Invalid content type" });
        }

        const { title, description, message, tags, link, provider } = req.body;
        const classroomId = req.params.id;

        // Import supabase client
        const { createClient } = await import("@supabase/supabase-js");
        const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_KEY;
        const supabase = createClient(process.env.SUPABASE_URL, supabaseKey);

        const classroom = await Classroom.findById(classroomId);
        if (!classroom) return res.status(404).json({ message: "Classroom not found" });

        const slug = classroom.subjectSlug || "general";
        let insertedItems = [];

        if (type === "materials") {
            const oldFiles = req.files || [];
            const uploadedFiles = req.body.uploaded_files || [];

            if (!oldFiles.length && !uploadedFiles.length) {
                return res.status(400).json({ message: "At least one file is required for materials" });
            }

            // Path A: Frontend uploaded to Supabase directly (Avoids 413 Payload Too Large)
            if (uploadedFiles.length > 0) {
                for (let i = 0; i < uploadedFiles.length; i++) {
                    const fileObj = uploadedFiles[i];

                    const dbData = {
                        title: (uploadedFiles.length === 1 && title) ? title : (title ? `${title} - ${fileObj.originalname}` : fileObj.originalname),
                        subject_slug: slug,
                        file_url: fileObj.fileurl,
                        uploaded_by: req.user.name,
                        type: fileObj.fileExt,
                        classroom_id: classroomId
                    };

                    const { data, error } = await supabase
                        .from(type)
                        .insert([dbData])
                        .select()
                        .single();

                    if (error) throw error;
                    insertedItems.push(data);
                }
            }
            // Path B: Fallback for old FormData requests (May fail with 413 on large files via Vercel)
            else if (oldFiles.length > 0) {
                for (let i = 0; i < oldFiles.length; i++) {
                    const file = oldFiles[i];
                    const fileExt = file.originalname.split('.').pop();
                    const fileName = `${classroomId}/${Date.now()}_${i}_${file.originalname.replace(/[^a-zA-Z0-9.-]/g, '_')}`;

                    const { error: uploadError } = await supabase.storage
                        .from('notes-files')
                        .upload(fileName, file.buffer, {
                            contentType: file.mimetype,
                            upsert: false
                        });

                    if (uploadError) throw uploadError;

                    const { data: { publicUrl } } = supabase.storage
                        .from('notes-files')
                        .getPublicUrl(fileName);

                    const dbData = {
                        title: (oldFiles.length === 1 && title) ? title : (title ? `${title} - ${file.originalname}` : file.originalname),
                        subject_slug: slug,
                        file_url: publicUrl,
                        uploaded_by: req.user.name,
                        type: fileExt,
                        classroom_id: classroomId
                    };

                    const { data, error } = await supabase
                        .from(type)
                        .insert([dbData])
                        .select()
                        .single();

                    if (error) throw error;
                    insertedItems.push(data);
                }
            }
        } else if (type === "quizzes") {
            if (!title || !link) return res.status(400).json({ message: "Title and link are required" });
            const dbData = {
                title,
                subject_slug: slug,
                quiz_url: link,
                provider: provider || 'Google Forms',
                classroom_id: classroomId
            };

            const { data, error } = await supabase
                .from(type)
                .insert([dbData])
                .select()
                .single();

            if (error) throw error;
            insertedItems.push(data);
        } else if (type === "announcements") {
            if (!message) return res.status(400).json({ message: "Message is required" });
            const dbData = {
                message,
                subject_slug: slug,
                posted_by: req.user.name,
                tags: tags ? (Array.isArray(tags) ? tags : [tags]) : ["General"],
                classroom_id: classroomId
            };

            const { data, error } = await supabase
                .from(type)
                .insert([dbData])
                .select()
                .single();

            if (error) throw error;
            insertedItems.push(data);
        }

        // Notify students (wrapped in try-catch so failures do not crash the file upload)
        try {
            const members = await ClassroomMembership.find({ classroom: classroomId, status: "approved" }).select("student");
            if (members.length > 0) {
                const notifTitle = type === 'materials'
                    ? `New Material${insertedItems.length > 1 ? 's' : ''}`
                    : type === 'quizzes' ? 'New Quiz' : 'New Announcement';
                const notifMsg = type === 'materials' && insertedItems.length > 1
                    ? `${insertedItems.length} new files uploaded to ${classroom.name}`
                    : `New content added to ${classroom.name}: ${title || (message && message.substring(0, 30) + '...') || 'Untitled'}`;

                const notifications = members.map(m => ({
                    recipient: m.student,
                    type: "content_update", // Added "content_update" to the enum in Notification.js
                    title: notifTitle,
                    message: notifMsg,
                    link: `/view-classroom.html?id=${classroomId}`,
                    relatedId: classroomId,
                    createdAt: new Date()
                }));
                await Notification.insertMany(notifications);
            }
        } catch (notifErr) {
            console.error(`Failed to send notifications for ${type}:`, notifErr);
            // Do not throw the error; allow the upload to succeed
        }

        res.status(201).json({
            message: `${insertedItems.length} item(s) uploaded successfully`,
            items: insertedItems,
            item: insertedItems[0]
        });

    } catch (err) {
        console.error(`Create ${req.params.type} error:`, err);
        res.status(500).json({ message: "Server error creating content" });
    }
});

// ─────────────────────────────────────────────
// GET CONTENT (Materials, Announcements, Quizzes)
// ─────────────────────────────────────────────
router.get("/:id/content/:type", isAuthenticated, requireClassroomMember, async (req, res) => {
    try {
        const { type } = req.params;
        if (!["materials", "announcements", "quizzes"].includes(type)) {
            return res.status(400).json({ message: "Invalid content type" });
        }

        // Import supabase client
        const { createClient } = await import("@supabase/supabase-js");
        const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_KEY;
        const supabase = createClient(process.env.SUPABASE_URL, supabaseKey);

        let content = [];
        let source = "subject_slug";

        // Strategy 1: Try classroom_id first (if column exists)
        try {
            const { data, error } = await supabase
                .from(type)
                .select("*")
                .eq("classroom_id", req.params.id)
                .order("created_at", { ascending: false });

            if (!error && data && data.length > 0) {
                content = data;
                source = "classroom";
            }
        } catch (e) {
            // classroom_id column likely doesn't exist, ignore
        }

        // Strategy 2: Fall back to subject_slug matching (only if no classroom_id results)
        if (content.length === 0 && req.classroom.subjectSlug) {
            const { data: fallbackData, error: fallbackError } = await supabase
                .from(type)
                .select("*")
                .eq("subject_slug", req.classroom.subjectSlug)
                .order("created_at", { ascending: false });

            if (!fallbackError && fallbackData) {
                content = fallbackData;
                source = "subject_slug";
            }
        }

        // Strategy 3: Try classroom's subject field (only if still no results)
        if (content.length === 0 && req.classroom.subject) {
            const { data: subjectData, error: subjectError } = await supabase
                .from(type)
                .select("*")
                .eq("subject_slug", req.classroom.subject)
                .order("created_at", { ascending: false });

            if (!subjectError && subjectData) {
                content = subjectData;
                source = "subject";
            }
        }

        // Deduplicate by id to prevent the same item appearing twice
        const seen = new Set();
        content = content.filter(item => {
            if (seen.has(item.id)) return false;
            seen.add(item.id);
            return true;
        });

        // Normalize announcements: map "message" to "title"/"content" for frontend
        if (type === "announcements") {
            content = content.map(a => ({
                ...a,
                title: a.title || a.message || "",
                content: a.content || a.message || "",
            }));
        }

        res.json({ content, source });
    } catch (err) {
        console.error(`Get ${req.params.type} error:`, err);
        res.status(500).json({ message: "Server error fetching content" });
    }
});

// ─────────────────────────────────────────────
// NOTIFY CLASSROOM MEMBERS (Owner only)
// ─────────────────────────────────────────────
router.post("/:id/notify", isAuthenticated, requireClassroomOwner, async (req, res) => {
    try {
        const { title, message, type, link } = req.body;

        if (!title || !message) {
            return res.status(400).json({ message: "Title and message are required" });
        }

        // Get all approved members
        const members = await ClassroomMembership.find({
            classroom: req.params.id,
            status: "approved"
        }).select("student");

        if (members.length === 0) {
            return res.json({ message: "No members to notify" });
        }

        const notifications = members.map(m => ({
            recipient: m.student,
            type: type || "system",
            title,
            message,
            link: link || `/view-classroom.html?id=${req.params.id}`,
            relatedId: req.params.id,
            createdAt: new Date()
        }));

        await Notification.insertMany(notifications);

        res.json({ message: "Notifications sent", count: members.length });
    } catch (err) {
        console.error("Notify classroom error:", err);
        res.status(500).json({ message: "Server error" });
    }
});

// ─────────────────────────────────────────────
// GET STUDENTS LIST (Any member can see classmates)
// ─────────────────────────────────────────────
router.get("/:id/students", isAuthenticated, requireClassroomMember, async (req, res) => {
    try {
        const members = await ClassroomMembership.find({
            classroom: req.params.id,
            status: "approved",
        })
            .populate("student", "name email profilePicture role")
            .sort({ joinedAt: 1 })
            .lean();

        const students = members.map(m => ({
            _id: m.student?._id,
            name: m.student?.name || 'Unknown',
            email: m.student?.email || '',
            profilePicture: m.student?.profilePicture || '',
            role: m.student?.role || 'student',
            joinedAt: m.joinedAt || m.requestedAt
        }));

        res.json({ students, total: students.length });
    } catch (err) {
        console.error("Get students error:", err);
        res.status(500).json({ message: "Server error" });
    }
});

// ─────────────────────────────────────────────
// UPDATE CONTENT (Teacher / Owner only)
// ─────────────────────────────────────────────
router.put("/:id/content/:type/:contentId", isAuthenticated, requireClassroomOwner, async (req, res) => {
    try {
        const { type, contentId } = req.params;
        if (!["materials", "announcements", "quizzes"].includes(type)) {
            return res.status(400).json({ message: "Invalid content type" });
        }

        const { createClient } = await import("@supabase/supabase-js");
        const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_KEY;
        const supabase = createClient(process.env.SUPABASE_URL, supabaseKey);

        // Build update object from allowed fields
        const updates = {};
        const allowedFields = {
            materials: ["title", "description", "file_url"],
            announcements: ["title", "content", "message"],
            quizzes: ["title", "description", "duration"]
        };

        (allowedFields[type] || []).forEach(field => {
            if (req.body[field] !== undefined) updates[field] = req.body[field];
        });

        if (Object.keys(updates).length === 0) {
            return res.status(400).json({ message: "No valid fields to update" });
        }

        const { data, error } = await supabase
            .from(type)
            .update(updates)
            .eq("id", contentId)
            .select()
            .single();

        if (error) throw error;

        res.json({ message: "Content updated", item: data });
    } catch (err) {
        console.error(`Update ${req.params.type} error:`, err);
        res.status(500).json({ message: "Server error updating content" });
    }
});

// ─────────────────────────────────────────────
// DELETE CONTENT (Teacher / Owner only)
// ─────────────────────────────────────────────
router.delete("/:id/content/:type/:contentId", isAuthenticated, requireClassroomOwner, async (req, res) => {
    try {
        const { type, contentId } = req.params;
        if (!["materials", "announcements", "quizzes"].includes(type)) {
            return res.status(400).json({ message: "Invalid content type" });
        }

        const { createClient } = await import("@supabase/supabase-js");
        const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_KEY;
        const supabase = createClient(process.env.SUPABASE_URL, supabaseKey);

        const { error } = await supabase
            .from(type)
            .delete()
            .eq("id", contentId);

        if (error) throw error;

        res.json({ message: "Content deleted successfully" });
    } catch (err) {
        console.error(`Delete ${req.params.type} error:`, err);
        res.status(500).json({ message: "Server error deleting content" });
    }
});

export default router;

