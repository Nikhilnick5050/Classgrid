
import express from 'express';
import { createClient } from '@supabase/supabase-js';
import { isAuthenticated } from '../middleware/auth.middleware.js';
import { requireClassroomMember } from '../middleware/classroom.middleware.js';

const router = express.Router();

// Initialize Supabase Client for Chat (Project 2)
// Using Service Role Key (secure backend-only) or Anon Key (with RLS disabled for service role)
const supabaseUrl = process.env.SUPABASE_CHAT_URL;
const supabaseKey = process.env.SUPABASE_CHAT_KEY;

// Lazy initialization to avoid crash if env vars missing
let supabase;

const getSupabase = () => {
    if (!supabase) {
        if (!supabaseUrl || !supabaseKey) {
            throw new Error('Supabase Chat credentials missing in .env');
        }
        supabase = createClient(supabaseUrl, supabaseKey);
    }
    return supabase;
};

// ─────────────────────────────────────────────
// GET MESSAGES
// ─────────────────────────────────────────────
router.get('/:id', isAuthenticated, requireClassroomMember, async (req, res) => {
    try {
        const { id } = req.params;
        const { limit = 50, before } = req.query;
        const sb = getSupabase();

        let query = sb
            .from('classroom_messages')
            .select('*')
            .eq('classroom_id', id)
            .order('created_at', { ascending: false })
            .limit(parseInt(limit));

        if (before) {
            query = query.lt('created_at', before);
        }

        const { data, error } = await query;

        if (error) throw error;

        // Return reversed (chronological) for frontend
        res.json({ messages: data.reverse() });

    } catch (err) {
        console.error('Chat fetch error:', err);
        res.status(500).json({ message: 'Error fetching messages', error: err.message });
    }
});

// ─────────────────────────────────────────────
// SEND MESSAGE
// ─────────────────────────────────────────────
router.post('/:id', isAuthenticated, requireClassroomMember, async (req, res) => {
    try {
        const { id } = req.params;
        const { message } = req.body;
        const user = req.user;
        const sb = getSupabase();

        if (!message || !message.trim()) {
            return res.status(400).json({ message: 'Message content required' });
        }

        const newMessage = {
            classroom_id: id,
            sender_id: user._id.toString(),
            sender_name: user.name,
            user_avatar: user.profilePicture, // Optional
            message: message.trim(),
            created_at: new Date().toISOString()
        };

        const { data, error } = await sb
            .from('classroom_messages')
            .insert([newMessage])
            .select()
            .single();

        if (error) throw error;

        res.status(201).json({ message: data });

    } catch (err) {
        console.error('Chat send error:', err);
        res.status(500).json({ message: 'Error sending message', error: err.message });
    }
});

export default router;
